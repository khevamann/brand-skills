// Craft CMS adapter — read-only access over Craft's public GraphQL API.
//
// Searches and reads content. Cannot write: requests carry no token, this CLI has
// no write command, and guard.mjs rejects any document containing a mutation.
// Content changes happen in the Craft control panel, as a draft.
//
// Dispatched to by scripts/site.mjs when the project folder's platform is Craft.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphql, endpoint, setEndpoint, CraftError } from './client.mjs';
import { assertReadOnly, isDenied, GuardError } from './guard.mjs';
import { rootFields, typeFields, renderType, namedType, needsArgs } from './introspect.mjs';
import { cachedTypeFields, contentFieldsOf, fetchPageTree, flattenBlocks, renderBlock } from './page.mjs';
import { buildGrammar, leafTypes } from './grammar.mjs';
import { extractTokens, extractClasses, groupClasses, extractModes } from '../../core/designsystem.mjs';
import {
  findPlaceholders, findEmptyBlocks, findDuplicateCopy, findBrokenInternalLinks,
  collectExternalLinks, copyValues, relationValues, isReferencePage,
} from '../../core/audit.mjs';
import { RADIUS, manifestConcerns, overallVerdict, exitCodeFor } from '../../core/scope.mjs';
import { profileFromCorpus, classifyField, COPY, PRESENTATION } from '../../core/fields.mjs';
import { out, section, today } from '../../core/cli.mjs';
import { projectPaths, recordState } from '../../core/project.mjs';

/** Set by run(): the project folder, if there is one, and where output goes. */
let ctx = { project: null, site: null, paths: projectPaths('.') };

/** The first embed-style block type, if the site has one — the escape hatch for raw HTML. */
const embedTypeOf = (types) =>
  types.map((t) => String(t).replace(/_Entry$/, '')).find((t) => /embed/i.test(t)) ?? null;

export const USAGE = `Craft CMS commands — read-only, over the site's public GraphQL API

START
  site overview [--from DIR]        What is here, what you can do, what you cannot

FIND
  site sections                     Sections and entry types on the site
  site entries [opts]               Search or list entries
      --section <handle>  --type <handle>  --search "terms"
      --limit <n>         --status <live|disabled|all>
  site drafts <entryId>             Drafts of an entry
  site drafts --unpublished         Drafts that have never been published

READ
  site page <id>                    A page's copy, walking the nested block tree
      --raw                          Full JSON instead of rendered text
      --depth <n>                    How far to follow nesting (default 3)
  site entry <id>                   One entry's own fields
  site blocks                       The block vocabulary: types, usage, which fields hold copy
  site export [--out DIR]           Whole site to disk: block trees, rendered HTML, inventory
      --no-html                      Skip the rendered HTML fetches
  site grammar                      Which block types are allowed inside which fields
  site design-system [--out DIR]    Extract the live tokens, classes, grammar and style guide
  site audit [--from DIR] [--links] Content checks: placeholders, empty blocks, broken links
      --include-reference-pages      Also report placeholders on component demo pages
  site brief <id> [--out FILE]      A paste-ready design brief for one page
  site diff <id> <file.json|.html>  What an edited artefact would change (checks only)
  site scope <id> <manifest.json>   Blast radius of a change: one page, or wider?
      --from DIR                     Use an exported corpus to detect repeated copy
      Exit 0 = single page, 3 = needs confirmation or impossible
  site query <file|->               Run a GraphQL query from a file or stdin
  site query --q "{ ping }"         Run an inline GraphQL query
  site schema [TypeName]            Query root fields, or one type's fields
  site mutations                    Audit: what the schema could write, and why none of it is reachable

This skill is read-only. There is no command that creates, edits, publishes or
deletes anything, and \`site query\` refuses any document containing a mutation.
`;

async function cmdSections() {
  const query = `{ entries(limit: 500, status: null) { sectionHandle typeHandle } }`;
  assertReadOnly(query);
  const data = await graphql(query);

  // Entries inside a Craft 5 nested-entry field belong to a field, not a section,
  // so they come back with a null sectionHandle. They are blocks, not pages.
  const sections = new Set();
  const nested = new Set();
  for (const e of data.entries) {
    if (e.sectionHandle) sections.add(`${e.sectionHandle} / ${e.typeHandle}`);
    else nested.add(e.typeHandle);
  }
  out(
    'SECTIONS (section / entry type):\n' +
      [...sections].sort().map((s) => `  ${s}`).join('\n') +
      `\n\nNESTED ENTRY TYPES (${nested.size}) — page-builder blocks, not pages:\n  ` +
      [...nested].sort().join(', '),
  );
}

const STATUS_MAP = { live: ['live'], disabled: ['disabled'], all: null };

async function cmdEntries(flags) {
  const status = flags.status ? (STATUS_MAP[flags.status] ?? [flags.status]) : ['live'];
  const query = `
    query ($section: [String], $type: [String], $search: String, $limit: Int, $status: [String]) {
      entryCount(section: $section, type: $type, search: $search, status: $status)
      entries(
        section: $section, type: $type, search: $search
        limit: $limit, status: $status, orderBy: "dateUpdated desc"
      ) {
        id title slug uri status sectionHandle typeHandle dateUpdated url
      }
    }`;
  assertReadOnly(query);
  const data = await graphql(query, {
    section: flags.section ? [flags.section] : null,
    type: flags.type ? [flags.type] : null,
    search: flags.search ?? null,
    limit: Number(flags.limit ?? 25),
    status,
  });
  out({
    total: data.entryCount,
    showing: data.entries.length,
    entries: data.entries,
    hint: data.entryCount === 0 && flags.search
      ? "Search found nothing. The index is not always current — list with --status all and filter, before concluding the page doesn't exist."
      : undefined,
  });
}

async function fetchEntryCore(id) {
  if (!id) throw new GuardError('An entry id is required.');
  const query = `query ($id: [QueryArgument]) {
    entry(id: $id, status: null) {
      id title slug uri url status sectionHandle typeHandle dateUpdated __typename
    }
  }`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(id)] });
  if (!data.entry) throw new CraftError(`No entry with id ${id}.`);
  return data.entry;
}

async function cmdEntry(id) {
  const core = await fetchEntryCore(id);
  const type = await typeFields(core.__typename);

  const leaves = [];
  const structured = [];
  for (const f of type?.fields ?? []) {
    if (needsArgs(f)) continue;
    const named = namedType(f.type);
    if (named.kind === 'SCALAR' || named.kind === 'ENUM') leaves.push(f.name);
    else structured.push(`${f.name}: ${renderType(f.type)}`);
  }

  const query = `query ($id: [QueryArgument]) { entry(id: $id, status: null) { ${leaves.join(' ')} } }`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(id)] });

  out({
    type: core.__typename,
    entry: data.entry,
    structuredFields: structured,
    hint: structured.some((f) => /_MatrixField/.test(f))
      ? `This entry's content is in nested blocks — run \`site page ${id}\` to read it.`
      : undefined,
  });
}

async function cmdDrafts(entryId, flags) {
  const unpublished = flags.unpublished === true || flags.unpublished === 'true';
  if (!unpublished && !entryId) throw new GuardError('Pass an entry id, or --unpublished.');
  const query = `
    query ($draftOf: QueryArgument) {
      entries(draftOf: $draftOf, drafts: true, status: null, orderBy: "dateUpdated desc") {
        id draftId draftName draftNotes isProvisionalDraft isUnpublishedDraft
        title sectionHandle typeHandle dateUpdated
      }
    }`;
  assertReadOnly(query);
  const data = await graphql(query, { draftOf: unpublished ? false : String(entryId) });
  out({ scope: unpublished ? 'unpublished drafts' : `drafts of ${entryId}`, drafts: data.entries });
}

// ------------------------------------------------- page content walking

async function cmdPage(id, flags) {
  const core = await fetchEntryCore(id);
  const { entry, query, contentFields } = await fetchPageTree(core, Number(flags.depth ?? 3));
  if (!entry) {
    throw new CraftError(
      `${core.__typename} has no nested content fields. Use \`site entry ${id}\` instead.`,
    );
  }
  if (flags.raw) return out({ query, entry });
  out(renderPage(entry, contentFields));
}

function renderPage(entry, contentFields) {
  const lines = [
    `# ${entry.title}`,
    `${entry.url ?? entry.uri}`,
    `entry ${entry.id} · ${entry.status} · updated ${entry.dateUpdated}`,
  ];
  for (const f of contentFields) {
    const blocks = entry[f.name];
    if (!Array.isArray(blocks) || blocks.length === 0) continue;
    lines.push('', `--- ${f.name} ---`);
    for (const b of blocks) renderBlock(b, 0, lines);
  }
  return lines.join('\n');
}

// ---------------------------------------------------- vocabulary + corpus

/** Every entry on the site, split into pages and nested blocks. */
async function fetchAllEntries() {
  const query = `{
    entries(limit: 1000, status: null, orderBy: "uri asc") {
      id title uri url status sectionHandle typeHandle dateUpdated
    }
  }`;
  assertReadOnly(query);
  const { entries } = await graphql(query);
  return {
    all: entries,
    pages: entries.filter((e) => e.sectionHandle),
    nested: entries.filter((e) => !e.sectionHandle),
  };
}

/**
 * Which block types exist, how often each is used, and which of their fields
 * actually hold copy. This is the vocabulary any design prompt has to stay inside.
 */
/**
 * Walk every page's block tree once. `entries()` does not return second-level
 * nested blocks, so this — not an entries query — is the only complete source of
 * what blocks exist and what is in them.
 */
async function walkSite(depth = 3, onPage = () => {}) {
  const { pages, nested } = await fetchAllEntries();
  const results = [];
  for (const page of pages) {
    const core = await fetchEntryCore(page.id);
    let tree = null;
    try {
      tree = await fetchPageTree(core, depth);
    } catch (err) {
      process.stderr.write(`  ! ${page.id} ${page.uri ?? ''}: ${err.message.split('\n')[0]}\n`);
    }
    const blocks = tree?.entry ? flattenBlocks(tree.entry, tree.contentFields) : [];
    const result = { page: core, tree: tree?.entry ?? null, contentFields: tree?.contentFields ?? [], blocks };
    results.push(result);
    onPage(result);
  }
  return { pages, nested, results };
}

/**
 * Which block types exist, how often each is used, and which of their fields hold
 * copy rather than presentation settings. This is the vocabulary any design work has
 * to stay inside, so it is derived from real page content, not guessed.
 */
async function cmdBlocks(flags) {
  const seen = new Map(); // typeHandle -> { count, pages:Set, fields: Map<field, values[]> }
  const { results } = await walkSite(Number(flags.depth ?? 3), (r) =>
    process.stderr.write(`  scanned ${r.page.id} ${r.page.uri ?? ''} (${r.blocks.length} blocks)\n`),
  );

  for (const { page, blocks } of results) {
    for (const b of blocks) {
      const handle = String(b.__typename ?? '?').replace(/_Entry$/, '');
      if (!seen.has(handle)) seen.set(handle, { count: 0, pages: new Set(), fields: new Map() });
      const rec = seen.get(handle);
      rec.count += 1;
      rec.pages.add(page.id);
      for (const [key, value] of Object.entries(b)) {
        if (typeof value !== 'string' || key.startsWith('_') || key === '__typename') continue;
        if (!/^[a-zA-Z]+_[A-Za-z]/.test(key)) continue;
        if (!rec.fields.has(key)) rec.fields.set(key, []);
        if (value) rec.fields.get(key).push(value);
      }
    }
  }

  // Craft types presentation settings and real copy identically — both plain Strings
  // — so classify from the values. A dropdown holds "md"; a copy field holds a
  // sentence or HTML.
  const report = [...seen.entries()]
    .map(([handle, rec]) => {
      const copy = [];
      const presentation = [];
      for (const [field, values] of rec.fields) {
        const isCopy = values.some((v) => v.includes('<') || (v.length > 25 && v.includes(' ')));
        if (isCopy) {
          copy.push({ field, example: [...values].sort((a, b) => b.length - a.length)[0].slice(0, 80) });
        } else {
          presentation.push({ field, values: [...new Set(values)].slice(0, 6) });
        }
      }
      return { handle, count: rec.count, pages: rec.pages.size, copy, presentation };
    })
    .sort((a, b) => b.count - a.count);

  if (flags.json) return out(report);

  const lines = [
    `BLOCK VOCABULARY — ${report.length} types in use across ${results.length} pages, ` +
      `${report.reduce((n, r) => n + r.count, 0)} instances`,
    '',
  ];
  for (const r of report) {
    lines.push(`${r.handle}  ×${r.count} on ${r.pages} page${r.pages === 1 ? '' : 's'}`);
    for (const c of r.copy) lines.push(`    COPY    ${c.field}  e.g. ${JSON.stringify(c.example)}`);
    if (!flags.terse) {
      for (const pf of r.presentation) {
        lines.push(`    style   ${pf.field}${pf.values.length ? `  [${pf.values.join(' | ')}]` : ''}`);
      }
    }
    lines.push('');
  }
  lines.push(
    'COPY fields hold editable text or HTML. style fields are presentation settings;',
    'the values shown are the options actually in use on the site.',
    '',
    'These are the only block types the front end can render. A new type needs a Craft',
    'entry type AND a matching front-end component — neither is reachable from this skill',
    'or from the GraphQL API, which cannot touch the content model at all. Design work',
    `must compose these${embedTypeOf(report.map((r) => r.handle)) ? `, or use ${embedTypeOf(report.map((r) => r.handle))} for raw HTML` : ''}.`,
    '',
    'Nested blocks are owned by one page (single ownerId) and cannot be shared between',
    'pages. A repeated pattern is a convention you apply, not an object you reuse.',
  );
  out(lines.join('\n'));
}

/**
 * Write the whole site to disk: content trees, rendered HTML, and an inventory.
 * The point is a corpus big enough to reason about the site as a whole — what
 * patterns repeat, what is broken, what a design change would have to respect.
 */
async function cmdExport(flags) {
  const dir = flags.out ?? ctx.paths.export;
  mkdirSync(`${dir}/pages`, { recursive: true });

  const index = [];
  const { pages, nested, results } = await walkSite(Number(flags.depth ?? 3));
  writeFileSync(`${dir}/entries.json`, JSON.stringify({ pages, nested }, null, 2));
  process.stderr.write(`${pages.length} pages, ${nested.length} nested blocks (top levels)\n`);

  for (const { page, tree, blocks } of results) {
    writeFileSync(
      `${dir}/pages/${page.id}.json`,
      JSON.stringify({ page, blocks, tree }, null, 2),
    );

    let html = null;
    if (page.url && !flags['no-html']) {
      try {
        const res = await fetch(page.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        html = await res.text();
        writeFileSync(`${dir}/pages/${page.id}.html`, html);
      } catch (err) {
        process.stderr.write(`  ! ${page.id} HTML: ${err.message}\n`);
      }
    }

    index.push({
      id: page.id,
      title: page.title,
      uri: page.uri,
      url: page.url,
      status: page.status,
      section: page.sectionHandle,
      type: page.typeHandle,
      blocks: blocks.length,
      blockTypes: [...new Set(blocks.map((b) => b.__typename))].sort(),
      htmlBytes: html?.length ?? null,
    });
    process.stderr.write(`  ${page.id} ${page.uri ?? ''} — ${blocks.length} blocks, ${html?.length ?? 0} bytes HTML\n`);
  }

  writeFileSync(`${dir}/index.json`, JSON.stringify(index, null, 2));
  writeFileSync(`${dir}/README.md`, corpusReadme(dir, index, nested));
  if (ctx.project) {
    recordState(ctx.project, 'lastExport', {
      dir, pages: index.length, blocks: index.reduce((n, p) => n + p.blocks, 0),
    });
  }
  out({
    exported: dir,
    pages: index.length,
    blocks: index.reduce((n, p) => n + p.blocks, 0),
    files: ['index.json', 'entries.json', 'README.md', `pages/<id>.json`, `pages/<id>.html`],
    note: 'Embed blocks render client-side, so their content is in the JSON but not the saved HTML.',
  });
}

function corpusReadme(dir, index, nested) {
  const byType = {};
  for (const p of index) for (const t of p.blockTypes) byType[t] = (byType[t] ?? 0) + 1;
  return `# Site corpus — ${dir}

Generated by \`site export\`. Read-only snapshot of the live site.

- \`index.json\` — one row per page: id, uri, status, block count, block types used
- \`entries.json\` — every entry, split into pages and nested blocks
- \`pages/<id>.json\` — the page's full block tree, plus a flattened block list
- \`pages/<id>.html\` — the rendered page as served

${index.length} pages, ${nested.length} nested blocks.

## Block types by how many pages use them

${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t} — ${n} pages`).join('\n')}

## Caveats

- **Embed-style blocks may render client-side.** On a headless front end their markup
  can be injected on hydration, so it is present in the JSON but absent from the saved
  HTML. Such pages need a browser render for a faithful snapshot.
- The saved HTML references the site's own CSS and JS, so it needs a network connection
  to render — but no authentication.
- Disabled entries and drafts are included: the public schema exposes them.
`;
}

/**
 * Which block types may be placed inside which fields. A page's existing blocks
 * show what someone chose; the schema's union types show what is allowed.
 */
async function cmdGrammar(flags) {
  const { pages } = await fetchAllEntries();
  const roots = [...new Set(pages.map((p) => `${p.typeHandle}_Entry`))].sort();
  const grammar = await buildGrammar(roots);

  const allTypes = [...new Set([...grammar.values()].flat())].sort();
  const leaves = leafTypes(grammar, allTypes);

  if (flags.json) {
    return out({ roots, grammar: Object.fromEntries(grammar), leaves });
  }

  const lines = ['COMPOSITION GRAMMAR', ''];
  for (const [slot, allowed] of [...grammar].sort()) {
    lines.push(`${slot}`);
    lines.push(`    ${allowed.length ? allowed.join(', ') : '(nothing)'}`);
    lines.push('');
  }
  lines.push(
    `LEAF BLOCKS (${leaves.length}) — these nest nothing, so this is where copy lives:`,
    '  ' + leaves.join(', '),
    '',
    'A design can only nest blocks where this grammar allows it. Anything else has to',
    embedTypeOf(allTypes)
      ? `go in ${embedTypeOf(allTypes)} as raw HTML, or be built by the site's developers as a new block type.`
      : "be built by the site's developers as a new block type.",
  );
  out(lines.join('\n'));
}

/**
 * Extract the live design system — tokens, modes, utility classes — plus the block
 * grammar, and write it as a reference a design tool can be briefed with.
 */
async function cmdDesignSystem(flags) {
  const dir = flags.out ?? join(ctx.paths.design, 'system');
  mkdirSync(dir, { recursive: true });

  // A style-guide page demonstrates the whole vocabulary, so it is the best single
  // source for both the tokens and the markup patterns. Otherwise use --url.
  const source = typeof flags.url === 'string'
    ? { title: flags.url, url: flags.url }
    : await findStyleGuide();
  const html = flags.html && existsSync(flags.html)
    ? readFileSync(flags.html, 'utf8')
    : await (await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();

  const tokens = extractTokens(html);
  const modes = extractModes(tokens);
  const classes = extractClasses(html);
  const { groups, other } = groupClasses(classes);

  const { pages } = await fetchAllEntries();
  const roots = [...new Set(pages.map((p) => `${p.typeHandle}_Entry`))].sort();
  const grammar = await buildGrammar(roots);
  const allTypes = [...new Set([...grammar.values()].flat())].sort();

  writeFileSync(`${dir}/style-guide.html`, html);
  writeFileSync(
    `${dir}/tokens.json`,
    JSON.stringify(
      Object.fromEntries([...tokens].map(([sel, map]) => [sel, Object.fromEntries(map)])),
      null,
      2,
    ),
  );
  writeFileSync(
    `${dir}/classes.json`,
    JSON.stringify(Object.fromEntries([...classes].sort((a, b) => b[1] - a[1])), null, 2),
  );
  writeFileSync(`${dir}/grammar.json`, JSON.stringify(Object.fromEntries(grammar), null, 2));
  writeFileSync(
    `${dir}/DESIGN-SYSTEM.md`,
    designSystemDoc({ source, tokens, modes, groups, other, grammar, allTypes }),
  );

  out({
    written: dir,
    source: `${source.title} (${source.url})`,
    files: ['DESIGN-SYSTEM.md', 'tokens.json', 'classes.json', 'grammar.json', 'style-guide.html'],
    tokenGroups: [...tokens.keys()],
    modes,
    classes: classes.size,
    blockTypes: allTypes.length,
    next: 'Hand DESIGN-SYSTEM.md and style-guide.html to the design tool. See references/design-handoff.md.',
  });
}

async function findStyleGuide() {
  const { pages } = await fetchAllEntries();
  const sg = pages.find((p) => /style[- ]?guide/i.test(p.title ?? '') || /style-guide/.test(p.uri ?? ''));
  if (sg?.url) return sg;
  const home = pages.find((p) => p.uri === '__home__' || p.sectionHandle?.match(/home/i)) ?? pages.find((p) => p.url);
  if (!home?.url) throw new CraftError('No style-guide page found. Pass --url <page url> or --html <file>.');
  process.stderr.write(`No style-guide page found; reading the design system from ${home.url}\n`);
  return home;
}

function designSystemDoc({ source, tokens, modes, groups, other, grammar, allTypes }) {
  const root = tokens.get(':root') ?? new Map();
  const colour = [...root].filter(([k]) => /^--color-/.test(k));
  const sample = (map, pattern, limit = 40) =>
    [...map].filter(([k]) => pattern.test(k)).slice(0, limit)
      .map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join('\n');

  return `# Design system — extracted from the live site

Generated by \`site design-system\` from **${source.title}** (${source.url}).
Everything below is read off the rendered page, so it cannot drift from what the site
actually renders. Regenerate rather than edit.

## The one rule

**Designs must be built from the existing block types.** The front end renders one
template or component per Craft entry type, and a block type it has no template for
renders as nothing. New block types require both a Craft settings change and a
front-end change — neither is reachable through the CMS API, which cannot touch the
content model at all.

${embedTypeOf(allTypes)
  ? `Where a design genuinely cannot be expressed in these blocks, the escape hatch is
\`${embedTypeOf(allTypes)}\`, which holds raw HTML. Markup there should use the tokens and
classes below so it looks native.`
  : 'This site has no embed-style block, so there is no escape hatch for raw HTML.'}

## Display modes

${modes.map((m) => `- \`data-mode="${m}"\` — ${tokens.get(`mode:${m}`)?.size ?? 0} tokens`).join('\n')}

Each mode redefines the same token names, so a block's appearance comes from the mode
it sits in, not from hard-coded colours. **Never hard-code a colour**; use the token.

## Colour tokens

${colour.length} colour tokens on \`:root\`. The brand scale:

| Token | Value |
|---|---|
${sample(root, /^--color-brand-\d+$/, 14)}

Semantic colour tokens resolve per mode. Read \`tokens.json\` for the full set
including \`--color-neutral-*\`, \`--color-brand-opacity-*\` and \`--color-brand-accent\`.

## Typography and surface tokens

| Token | Value |
|---|---|
${sample(root, /^--(text|surface|font|leading|tracking)-/, 24)}

## Utility classes in use

These are the classes the site's own markup uses. Prefer them over ad-hoc styles.

${[...groups].filter(([, v]) => v.length).map(([prefix, list]) =>
  `### \`${prefix}-*\` (${list.length})\n\n${list.slice(0, 18).map((c) => `- \`${c.cls}\` (${c.n}×)`).join('\n')}`,
).join('\n\n')}

Plus ${other.length} generic utility classes (Tailwind spacing, flex, grid, responsive
prefixes). See \`classes.json\`.

## Block vocabulary

${allTypes.length} block types. Run \`site blocks\` for usage counts and, for each type,
which fields hold copy versus presentation settings, with real example values.

## Composition grammar

Which block types are allowed in which slots:

${[...grammar].sort().map(([slot, allowed]) =>
  `- **\`${slot}\`** → ${allowed.length ? allowed.map((a) => `\`${a}\``).join(', ') : '_nothing_'}`,
).join('\n')}

## Constraints a design must respect

1. Only the block types above exist. Nothing else renders.
2. Nesting must follow the grammar above.
3. Blocks cannot be shared between pages — each has a single owner. A repeated
   pattern is a convention applied per page, not one reusable object.
4. Colours and spacing come from tokens and utility classes, never literals.
5. Rich-text fields often keep classes, so copy can carry design-system classes. Check
   existing content before relying on it.
${embedTypeOf(allTypes)
  ? `6. \`${embedTypeOf(allTypes)}\` content may render client-side only — invisible to static
   snapshots and weaker for SEO. Use it deliberately, not by default.`
  : ''}

## Deliverable format

Any design change must come back as an edit manifest keyed by Craft block id, not as
HTML alone — see \`references/design-handoff.md\`. Every block renders as
\`<section id="<craft block id>">\`, so page-level mapping is mechanical, but nothing in
the markup says which element was which field.
`;
}

/**
 * Load a corpus written by `site export`, so audits and briefs run instantly
 * instead of re-crawling. Falls back to a live walk when no corpus is given.
 */
async function loadCorpus(flags) {
  const dir = flags.from;

  if (dir && existsSync(`${dir}/index.json`)) {
    const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
    const corpus = [];
    const htmlByPage = new Map();
    for (const row of index) {
      const file = `${dir}/pages/${row.id}.json`;
      if (!existsSync(file)) continue;
      const { page, blocks, tree } = JSON.parse(readFileSync(file, 'utf8'));
      corpus.push({ page, blocks, tree });
      const htmlFile = `${dir}/pages/${row.id}.html`;
      htmlByPage.set(row.id, {
        uri: page.uri,
        html: existsSync(htmlFile) ? readFileSync(htmlFile, 'utf8') : null,
      });
    }
    return { corpus, htmlByPage, source: dir, index };
  }

  if (dir) throw new CraftError(`No corpus at ${dir}. Run \`site export --out ${dir}\` first.`);

  process.stderr.write('No --from corpus given; walking the live site.\n');
  const { results } = await walkSite(Number(flags.depth ?? 3));
  return {
    corpus: results.map((r) => ({ page: r.page, blocks: r.blocks, tree: r.tree })),
    htmlByPage: new Map(),
    source: 'live',
  };
}

/** Content checks: placeholders, empty blocks, broken links, repeated copy. */
async function cmdAudit(flags) {
  const { corpus, htmlByPage, source } = await loadCorpus(flags);
  const origin = corpus.find((c) => c.page.url)?.page.url?.match(/^https?:\/\/[^/]+/)?.[0] ?? '';
  const knownUris = corpus.map((c) => c.page.uri).filter(Boolean);

  const profile = profileFromCorpus(corpus);
  const extraPatterns = ctx.site?.audit?.placeholders ?? [];
  const placeholders = findPlaceholders(corpus, profile, {
    includeReferencePages: Boolean(flags['include-reference-pages']),
    extraPatterns,
  });
  const onReferencePages = flags['include-reference-pages']
    ? 0
    : findPlaceholders(corpus.filter((c) => isReferencePage(c.page)), profile, {
        includeReferencePages: true,
        extraPatterns,
      }).length;
  const empties = findEmptyBlocks(corpus, profile);
  const duplicates = findDuplicateCopy(corpus, 60, profile);
  const brokenInternal = htmlByPage.size ? findBrokenInternalLinks(htmlByPage, knownUris, origin) : [];
  const noBlocks = corpus.filter((c) => c.blocks.length === 0);

  let internalChecked = null;
  if (flags.links && brokenInternal.length && origin) {
    internalChecked = [];
    process.stderr.write(`verifying ${brokenInternal.length} internal links…\n`);
    const unique = [...new Set(brokenInternal.map((f) => f.link))];
    const statuses = new Map();
    for (const link of unique) {
      try {
        const res = await fetch(origin + link, { redirect: 'follow', signal: AbortSignal.timeout(12000) });
        statuses.set(link, res.status);
      } catch (err) {
        statuses.set(link, err.message);
      }
    }
    for (const f of brokenInternal) {
      const status = statuses.get(f.link);
      if (status !== 200) internalChecked.push({ ...f, status });
    }
  }

  let externalResults = [];
  if (flags.links && htmlByPage.size) {
    const links = collectExternalLinks(htmlByPage, origin);
    process.stderr.write(`checking ${links.size} external links…\n`);
    for (const [url, pages] of links) {
      let status = null;
      let error = null;
      try {
        const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000) });
        status = res.status;
      } catch (err) {
        error = err.message;
      }
      if (error || status >= 400) externalResults.push({ url, status, error, pages: [...pages] });
    }
  }

  const report = {
    source,
    pages: corpus.length,
    blocks: corpus.reduce((n, c) => n + c.blocks.length, 0),
    findings: {
      placeholderCopy: placeholders.length,
      placeholderCopyOnReferencePages: onReferencePages
        ? `${onReferencePages} excluded (component demo pages — expected there)`
        : 0,
      emptyBlocks: empties.length,
      pagesWithNoBlocks: noBlocks.length,
      internalLinksWithNoCraftPage: brokenInternal.length,
      internalLinksActuallyBroken: internalChecked ? internalChecked.length : 'not checked (pass --links)',
      repeatedCopyAcrossPages: duplicates.length,
      brokenExternalLinks: flags.links ? externalResults.length : 'not checked (pass --links)',
    },
  };

  if (flags.json) {
    return out({ ...report, placeholders, empties, duplicates, brokenInternal, externalResults });
  }

  const lines = [`CONTENT AUDIT — ${report.pages} pages, ${report.blocks} blocks (source: ${source})`, ''];

  section(lines, `PLACEHOLDER COPY (${placeholders.length})`, placeholders.map(
    (f) => `  ${f.status === 'live' ? 'LIVE' : f.status.toUpperCase()}  ${f.page}  #${f.blockId} ${f.field}\n        ${f.issue}: ${f.excerpt}`,
  ));

  if (onReferencePages) {
    lines.push(
      `  (${onReferencePages} further findings on component demo pages were excluded — ` +
        'placeholder text belongs there. Pass --include-reference-pages to see them.)',
      '',
    );
  }

  section(lines, `PAGES WITH NO CONTENT BLOCKS (${noBlocks.length})`, noBlocks.map(
    (c) => `  ${c.page.status}  ${c.page.uri ?? '(no uri)'} — ${c.page.title}`,
  ));

  section(lines, `EMPTY BLOCKS (${empties.length})`, empties.slice(0, 25).map(
    (f) => `  ${f.page}  #${f.blockId} ${f.type}`,
  ), empties.length > 25 ? `  … and ${empties.length - 25} more` : null);

  if (internalChecked) {
    section(lines, `BROKEN INTERNAL LINKS (${internalChecked.length} verified over HTTP)`,
      internalChecked.map((f) => `  ${f.status}  ${f.page} → ${f.link}`));
  } else {
    const unique = [...new Set(brokenInternal.map((f) => f.link))];
    section(lines, `INTERNAL LINKS WITH NO CRAFT ENTRY (${unique.length} distinct)`,
      unique.map((l) => `  ${l}  (on ${brokenInternal.filter((f) => f.link === l).length} pages)`),
      unique.length ? '  Some of these are front-end routes rather than broken. Pass --links to verify.' : null);
  }

  if (flags.links) {
    section(lines, `UNREACHABLE EXTERNAL LINKS (${externalResults.length})`, externalResults.map(
      (f) => `  ${f.status ?? 'ERR'}  ${f.url}\n        on: ${f.pages.slice(0, 4).join(', ')}`,
    ));
  } else {
    lines.push('EXTERNAL LINKS: not checked. Pass --links to verify them.', '');
  }

  section(lines, `COPY REPEATED ACROSS PAGES (${duplicates.length})`, duplicates.slice(0, 12).map(
    (d) => `  ${d.pages} pages  ${JSON.stringify(d.value.slice(0, 80))}\n        ${d.uses.map((u) => `${u.page}#${u.blockId}`).join(', ')}`,
  ), duplicates.length
    ? '  These are candidates for a shared component. This CMS cannot share a block\n  between pages, so they stay a convention — or become the case for a new block type.'
    : null);

  if (ctx.project) {
    mkdirSync(ctx.paths.audits, { recursive: true });
    const file = join(ctx.paths.audits, `${today()}${flags.links ? '-links' : ''}.txt`);
    writeFileSync(file, lines.join('\n') + '\n');
    recordState(ctx.project, 'lastAudit', { file, ...report.findings });
    lines.push(`Saved to ${file}`);
  }

  out(lines.join('\n'));
}

/**
 * Assemble a paste-ready brief for a design tool: the page as it stands with block
 * ids, what may be placed where, and the format the result has to come back in.
 */
async function cmdBrief(id, flags) {
  const core = await fetchEntryCore(id);
  const profile = flags.from ? profileFromCorpus((await loadCorpus(flags)).corpus) : null;
  const { entry, contentFields } = await fetchPageTree(core, Number(flags.depth ?? 3));
  if (!entry) throw new CraftError(`${core.__typename} has no nested content fields.`);
  const blocks = flattenBlocks(entry, contentFields);

  const rootType = core.__typename;
  const grammar = await buildGrammar([rootType]);
  const slots = [...grammar].filter(([slot]) => slot.startsWith(`${rootType}.`));

  const embed = embedTypeOf(grammar ? [...grammar.values()].flat() : []);
  const lines = [
    `# Design brief — ${entry.title}`,
    '',
    `Page: ${entry.url ?? entry.uri}`,
    `Craft entry: ${entry.id} (${rootType}), status ${entry.status}`,
    '',
    '## Non-negotiable constraints',
    '',
    'This page is stored in a CMS with a fixed set of block types, rendered by a separate',
    'front-end application. **Only the block types listed below exist.** A design using',
    'anything else cannot be stored or rendered, and the CMS API cannot create new block',
    'types — that needs a change by the agency that built the site.',
    '',
    'Use the design system in `DESIGN-SYSTEM.md` and the rendered reference in',
    '`style-guide.html`. Colours and spacing come from the tokens and utility classes',
    'documented there, never from literal values.',
    '',
    'Blocks cannot be shared between pages. A pattern repeated across pages is a',
    'convention applied per page, not one reusable object.',
    '',
    '## What may be placed on this page',
    '',
    ...slots.map(([slot, allowed]) =>
      `- \`${slot.split('.')[1]}\` accepts: ${allowed.map((a) => `\`${a.replace(/_Entry$/, '')}\``).join(', ')}`,
    ),
    '',
    'Where a block nests further, see `grammar.json`.',
    '',
    '## The page as it stands',
    '',
    'Each block below is a real CMS object. **Keep the ids** — they are how your changes',
    'get applied.',
    '',
  ];

  for (const b of blocks) {
    const indent = '  '.repeat(b._depth);
    lines.push(`${indent}- **#${b.id}** \`${String(b.__typename).replace(/_Entry$/, '')}\`${b.title ? ` — ${b.title}` : ''}`);
    for (const { field, value } of copyValues(b, profile)) {
      const text = value.replace(/\s+/g, ' ').trim();
      lines.push(`${indent}  - \`${field}\`: ${JSON.stringify(text.slice(0, 200))}${text.length > 200 ? ' …' : ''}`);
    }
    for (const { field, items } of relationValues(b)) {
      const described = items
        .map((it) => it.url ?? it.linkUrl ?? it.uri ?? it.title ?? it.linkText)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      if (described) lines.push(`${indent}  - \`${field}\` (image/link): ${described}`);
    }
  }

  lines.push(
    '',
    '## How to return the result',
    '',
    'Return **both**:',
    '',
    '1. The edited HTML.',
    '2. An edit manifest in exactly this shape, so the changes can be applied to the CMS:',
    '',
    '```json',
    '{',
    `  "pageId": "${entry.id}",`,
    '  "edits": [',
    '    { "blockId": "<id from the list above>", "field": "<field name from the list above>", "value": "<new value>" }',
    '  ],',
    '  "newBlocks": [',
    `    { "afterBlockId": "<id>", "type": "<a block type listed above>", "field": "<its copy field>", "value": "<content>" }`,
    '  ],',
    '  "unmapped": ["anything you changed that does not fit a field above"]',
    '}',
    '```',
    '',
    'The `unmapped` list matters: put anything structural there rather than forcing it',
    'into a field. It will be reviewed by a human instead of being silently dropped.',
    '',
    embed
      ? `\`${embed}\` is the only way to add markup the block types cannot express. Use it deliberately.`
      : 'This site has no embed block, so markup the block types cannot express is not possible.',
  );

  const doc = lines.join('\n');
  const target = flags.out ?? (ctx.project ? join(ctx.paths.design, `brief-${entry.id}.md`) : null);
  if (target) {
    mkdirSync(ctx.paths.design, { recursive: true });
    writeFileSync(target, doc);
    return out({ written: target, page: entry.title, blocks: blocks.length, slots: slots.length });
  }
  out(doc);
}

/**
 * Check what an edited artefact would change. Accepts an edit manifest (validated
 * against the live page) or an edited HTML file (compared by block id).
 */
async function cmdDiff(id, file, flags) {
  if (!file) throw new GuardError('Pass the edited file: `site diff <pageId> <file.json|file.html>`');
  const body = readFileSync(file, 'utf8');

  const core = await fetchEntryCore(id);
  const { entry, contentFields } = await fetchPageTree(core, Number(flags.depth ?? 3));
  if (!entry) throw new CraftError(`${core.__typename} has no nested content fields.`);
  const blocks = flattenBlocks(entry, contentFields);
  const byId = new Map(blocks.map((b) => [String(b.id), b]));

  if (file.endsWith('.json')) {
    const manifest = JSON.parse(body);
    const checks = [];
    for (const edit of manifest.edits ?? []) {
      const block = byId.get(String(edit.blockId));
      if (!block) {
        checks.push({ ok: false, ...edit, problem: 'no such block on this page' });
        continue;
      }
      const type = await cachedTypeFields(block.__typename).catch(() => null);
      const exists = (type?.fields ?? []).some((f) => f.name === edit.field);
      const current = block[edit.field];
      checks.push({
        ok: exists,
        blockId: edit.blockId,
        type: block.__typename,
        field: edit.field,
        problem: exists ? undefined : `\`${edit.field}\` is not a field of ${block.__typename}`,
        unchanged: exists && current === edit.value ? true : undefined,
        from: typeof current === 'string' ? current.slice(0, 120) : current,
        to: typeof edit.value === 'string' ? edit.value.slice(0, 120) : edit.value,
      });
    }
    return out({
      page: { id: entry.id, title: entry.title },
      manifestFor: manifest.pageId,
      pageMismatch: String(manifest.pageId) !== String(entry.id) ? 'manifest targets a different page' : undefined,
      valid: checks.filter((c) => c.ok && !c.unchanged).length,
      problems: checks.filter((c) => !c.ok),
      noChange: checks.filter((c) => c.unchanged).length,
      edits: checks,
      newBlocks: manifest.newBlocks ?? [],
      unmapped: manifest.unmapped ?? [],
      note: 'This skill cannot apply changes. Apply them in the control panel, as a draft.',
    });
  }

  // HTML: every block renders as <section id="<block id>">, so compare by id.
  const sectionIds = [...body.matchAll(/<section[^>]*\sid="(\d+)"/g)].map((m) => m[1]);
  const present = new Set(sectionIds);
  const original = blocks.map((b) => String(b.id));

  const textOf = (html, blockId) => {
    const start = html.search(new RegExp(`<section[^>]*\\sid="${blockId}"`));
    if (start < 0) return null;
    return html.slice(start, start + 4000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const changed = [];
  for (const b of blocks) {
    if (!present.has(String(b.id))) continue;
    const editedText = textOf(body, b.id);
    for (const { field, value } of copyValues(b)) {
      const plain = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const probe = plain.slice(0, 60);
      if (probe && editedText && !editedText.includes(probe)) {
        changed.push({ blockId: b.id, type: b.__typename, field, currentValue: plain.slice(0, 120) });
      }
    }
  }

  out({
    page: { id: entry.id, title: entry.title },
    blocksInCms: original.length,
    blocksInFile: sectionIds.length,
    removed: original.filter((x) => !present.has(x)),
    added: sectionIds.filter((x) => !byId.has(x)),
    reordered: sectionIds.filter((x) => byId.has(x)).join(',') !== original.filter((x) => present.has(x)).join(','),
    fieldsWhoseTextNoLongerAppears: changed,
    note:
      'HTML alone cannot say which element holds which field, so this reports where a ' +
      'current value went missing, not the new value. Ask the design tool for an edit ' +
      'manifest (site brief includes the format) to get an exact changeset.',
  });
}

/**
 * Classify a proposed change by how far it reaches. The question is not whether an
 * edit is correct but whether it is confined to one page: shared entries, repeated
 * copy and design-system changes all look local in a manifest and are not.
 */
async function cmdScope(id, file, flags) {
  if (!file) throw new GuardError('Usage: site scope <pageId> <manifest.json>');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));

  const core = await fetchEntryCore(id);
  const { entry, contentFields } = await fetchPageTree(core, Number(flags.depth ?? 3));
  const owned = new Map((entry ? flattenBlocks(entry, contentFields) : []).map((b) => [String(b.id), b]));

  const knownTypes = (manifest.newBlocks ?? []).length
    ? [...(await buildGrammar([core.__typename])).values()].flat()
    : [];
  const items = [...manifestConcerns(manifest, { knownTypes })];
  const corpus = flags.from ? (await loadCorpus(flags)).corpus : null;
  const profile = corpus ? profileFromCorpus(corpus) : null;
  if (!profile) {
    process.stderr.write(
      'No --from corpus: falling back to field-name rules for copy vs presentation.\n' +
      'Pass --from <export dir> for a verdict based on how the site actually uses each field.\n',
    );
  }

  for (const edit of manifest.edits ?? []) {
    const blockId = String(edit.blockId);
    const block = owned.get(blockId);

    if (!block) {
      // Not part of this page's own content. Either it belongs to another page, or
      // it is a standalone entry referenced by relation — which is the genuinely
      // dangerous case, because one edit changes every page pointing at it.
      const referencing = await pagesReferencing(blockId);
      const target = await fetchEntryCore(blockId).catch(() => null);
      items.push({
        radius: RADIUS.NEEDS_CONFIRMATION,
        what: `#${blockId} ${edit.field}`,
        why: target?.sectionHandle
          ? `\`${target.title}\` is a shared ${target.sectionHandle} entry, referenced by ` +
            `${referencing.length} page${referencing.length === 1 ? '' : 's'}: ` +
            referencing.slice(0, 6).map((r) => r.uri ?? r.title).join(', ') +
            (referencing.length > 6 ? ', …' : '')
          : 'Not part of this page. Editing it changes content this page does not own.',
        affectedPages: referencing.map((r) => r.uri ?? r.title),
      });
      continue;
    }

    const kind = classifyField(block.__typename, edit.field, profile);

    // A value repeated on other pages: editing it here makes the pages diverge,
    // and editing it everywhere is a site-wide change.
    const elsewhere = corpus ? pagesWithSameValue(corpus, block[edit.field], id, profile) : [];
    if (elsewhere.length) {
      items.push({
        radius: RADIUS.NEEDS_CONFIRMATION,
        what: `#${blockId} ${edit.field}`,
        why:
          `The current value also appears on ${elsewhere.length} other page` +
          `${elsewhere.length === 1 ? '' : 's'}: ${elsewhere.slice(0, 5).join(', ')}. ` +
          'Changing it here alone makes them diverge.',
        affectedPages: elsewhere,
      });
      continue;
    }

    if (kind === PRESENTATION) {
      items.push({
        radius: RADIUS.NEEDS_CONFIRMATION,
        what: `#${blockId} ${edit.field}`,
        why:
          `\`${edit.field}\` is a presentation setting, not copy. These are usually meant ` +
          'to be consistent across the site, so confirm whether this is one page or all.',
      });
      continue;
    }

    items.push({
      radius: RADIUS.PAGE,
      what: `#${blockId} ${edit.field}`,
      why: `${kind === COPY ? 'Copy' : 'Content'} on a block owned only by this page.`,
    });
  }

  const verdict = overallVerdict(items);
  const grouped = {
    page: items.filter((i) => i.radius === RADIUS.PAGE),
    needsConfirmation: items.filter((i) => i.radius === RADIUS.NEEDS_CONFIRMATION),
    notPossible: items.filter((i) => i.radius === RADIUS.NOT_POSSIBLE),
  };

  if (flags.json) {
    out({ page: { id: core.id, title: core.title }, verdict, ...grouped });
  } else {
    const lines = [`SCOPE — ${core.title} (entry ${core.id})`, '', `VERDICT: ${verdict.toUpperCase()}`, ''];
    section(lines, `CONFINED TO THIS PAGE (${grouped.page.length})`,
      grouped.page.map((i) => `  ${i.what} — ${i.why}`));
    section(lines, `NEEDS YOUR CONFIRMATION (${grouped.needsConfirmation.length})`,
      grouped.needsConfirmation.map((i) => `  ${i.what}\n        ${i.why}`));
    section(lines, `NOT POSSIBLE THROUGH THE CMS (${grouped.notPossible.length})`,
      grouped.notPossible.map((i) => `  ${i.what}\n        ${i.why}`));
    lines.push(
      verdict === RADIUS.PAGE
        ? 'Everything is confined to this page. Safe to apply as a draft for review.'
        : 'Do not apply anything until the items above are confirmed by a person. ' +
          'Applying a single-page edit is fine; the flagged items are not single-page.',
    );
    out(lines.join('\n'));
  }

  process.exitCode = exitCodeFor(verdict);
}

/** Pages that reference an entry through a relation field. */
async function pagesReferencing(entryId) {
  const query = `query ($id: [QueryArgument]) {
    entries(relatedTo: $id, status: null, limit: 100) { id title uri sectionHandle }
  }`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(entryId)] }).catch(() => null);
  return data?.entries ?? [];
}

/** Other pages in the corpus carrying an identical copy value. */
function pagesWithSameValue(corpus, value, excludePageId, profile) {
  if (typeof value !== 'string' || value.replace(/\s+/g, ' ').trim().length < 40) return [];
  const needle = value.replace(/\s+/g, ' ').trim();
  const hits = new Set();
  for (const { page, blocks } of corpus) {
    if (String(page.id) === String(excludePageId)) continue;
    for (const block of blocks) {
      for (const { value: v } of copyValues(block, profile)) {
        if (v.replace(/\s+/g, ' ').trim() === needle) hits.add(page.uri ?? page.title);
      }
    }
  }
  return [...hits];
}

/**
 * Orientation for someone meeting this site for the first time: what is here, what
 * can be done, what cannot, and which command to run next. Everything is counted
 * live rather than asserted, so it stays true as the site changes.
 */
async function cmdOverview(flags) {
  const { pages, nested } = await fetchAllEntries();
  const bySection = new Map();
  for (const p of pages) {
    if (!bySection.has(p.sectionHandle)) bySection.set(p.sectionHandle, []);
    bySection.get(p.sectionHandle).push(p);
  }

  const roots = [...new Set(pages.map((p) => `${p.typeHandle}_Entry`))].sort();
  const grammar = await buildGrammar(roots);
  const allBlockTypes = [...new Set([...grammar.values()].flat())];

  // Usage needs a page walk: the entries query does not return second-level nested
  // blocks, so counting from it would report types as unused that are plainly in use.
  let usage = null;
  if (flags?.from) {
    const { corpus } = await loadCorpus(flags);
    const used = new Set(corpus.flatMap((c) => c.blocks.map((b) => b.__typename)));
    usage = {
      used: used.size,
      unused: allBlockTypes.filter((t) => !used.has(t)).sort(),
    };
  }

  const mutations = await rootFields('mutation').catch(() => []);

  const lines = [
    `SITE: ${ctx.site?.url ?? endpoint()}  (Craft GraphQL: ${endpoint()})`,
    '',
    'WHAT IS HERE',
    ...[...bySection.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([section, items]) => `  ${String(items.length).padStart(3)}  ${section}`),
    `  ${String(nested.length).padStart(3)}  nested page-builder blocks, top level (not pages)`,
    '',
    `  ${allBlockTypes.length} block types available.`,
  ];

  if (usage) {
    lines.push(
      `  ${usage.used} in use. Unused and available: ` +
        (usage.unused.map((t) => t.replace(/_Entry$/, '')).join(', ') || 'none'),
    );
  } else {
    lines.push('  Run `site blocks` for usage counts, or pass --from <export dir>.');
  }

  lines.push(
    '',
    'WHAT YOU CAN DO WITH THIS SKILL',
    "  Read and search any content, including disabled entries and drafts.",
    "  Read a page's copy with block ids, so a change can be named exactly.",
    '  Audit the site: placeholder copy, empty blocks, broken links, repeated copy.',
    '  Extract the live design system: tokens, utility classes, composition grammar.',
    '  Export everything to disk and reason about the site as a whole.',
    '  Brief a design tool, then check what came back and how far it reaches.',
    '',
    'WHAT YOU CANNOT DO WITH THIS SKILL',
    `  Change anything. This endpoint exposes ${mutations.length} mutation` +
      `${mutations.length === 1 ? '' : 's'} (${mutations.map((m) => m.name).join(', ') || 'none'})` +
      ' and no token is sent.',
    "  Create a new block type. Craft's API cannot touch the content model at all;",
    '  that needs both a Craft settings change and a front-end component.',
    '  Share a block between pages. Each nested block has a single owner.',
    '  Change the design system. Tokens and CSS live in the front-end application.',
    '',
    'HOW CHANGES ACTUALLY GET MADE',
    '  A person applies them in the Craft control panel, as a draft, and publishes',
    '  after review. This skill works out precisely what to change and whether it is',
    '  safe to change. See references/platforms/craft-apply.md for the control panel.',
    '',
    'START HERE',
    '  site export                               take a snapshot (a few minutes)',
    '  site audit --links                        what needs attention',
    '  site blocks                              the block vocabulary',
    '  site page <id>                           read one page',
    '  site brief <id>                           prepare a design change',
  );

  out(lines.join('\n'));
}

// --------------------------------------------------------------- schema

async function cmdQuery(positional, flags) {
  let document = typeof flags.q === 'string' ? flags.q : undefined;
  if (!document) {
    const source = positional[0];
    if (!source) throw new GuardError('Pass a file path, `-` for stdin, or --q "<query>".');
    document = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  }
  assertReadOnly(document);
  out(await graphql(document, flags.variables ? JSON.parse(flags.variables) : {}));
}

async function cmdSchema(typeName) {
  if (typeName) {
    // Craft 5 names entry types <entryType>_Entry, with no section prefix. Craft 4
    // uses <section>_<entryType>_Entry. Guessing wrong gets Craft's opaque error.
    const type = await typeFields(typeName).catch((err) => {
      throw new CraftError(
        `Could not introspect \`${typeName}\`.\n${err.message}\n\n` +
          'Read a type name off the data rather than guessing it:\n' +
          "  site query --q '{ entry(id: <id>) { __typename } }'",
      );
    });
    if (!type) throw new CraftError(`No type named ${typeName}.`);
    out({
      type: type.name,
      kind: type.kind,
      fields: (type.fields ?? []).map((f) => `${f.name}: ${renderType(f.type)}`),
    });
    return;
  }
  const fields = await rootFields('query');
  out(fields.map((f) => f.name).sort().join('\n'));
}

async function cmdMutations() {
  const fields = await rootFields('mutation').catch(() => []);
  const writes = fields.filter((f) => isDenied(f.name));
  out(
    `Mutations in the schema this endpoint serves: ${fields.length}\n` +
      (fields.length ? fields.map((f) => `  ${f.name}`).join('\n') + '\n' : '') +
      `\nWrite mutations: ${writes.length}\n` +
      (writes.length ? writes.map((f) => `  ${f.name}`).join('\n') + '\n' : '') +
      '\nNone of them is reachable from this skill, for three separate reasons:\n' +
      '  1. No token is sent, so no private schema with edit scope is unlocked.\n' +
      '  2. This CLI has no command that writes.\n' +
      '  3. adapters/craft/guard.mjs rejects any document containing a mutation.\n' +
      '\nContent changes happen in the Craft control panel.',
  );
}

// ------------------------------------------------------------------- run

const CORPUS_COMMANDS = ['audit', 'brief', 'scope', 'overview'];

/**
 * Run one Craft command. `context` is the project folder (or null) and its paths;
 * site.mjs builds it. An --endpoint flag overrides the project's endpoint.
 */
export async function run(command, positional, flags, context = {}) {
  ctx = { project: null, site: null, paths: projectPaths('.'), ...context };
  const graphqlUrl = typeof flags.endpoint === 'string' ? flags.endpoint : ctx.site?.craft?.graphql;
  if (graphqlUrl) setEndpoint(graphqlUrl);

  // Inside a project folder, read the latest export by default.
  if (flags.from === undefined && CORPUS_COMMANDS.includes(command) &&
      existsSync(join(ctx.paths.export, 'index.json'))) {
    flags.from = ctx.paths.export;
  }

  switch (command) {
    case 'help':
      return out(USAGE);
    case 'overview':
      return cmdOverview(flags);
    case 'sections':
      return cmdSections();
    case 'entries':
      return cmdEntries(flags);
    case 'entry':
      return cmdEntry(positional[0]);
    case 'page':
      return cmdPage(positional[0], flags);
    case 'blocks':
      return cmdBlocks(flags);
    case 'export':
      return cmdExport(flags);
    case 'grammar':
      return cmdGrammar(flags);
    case 'design-system':
      return cmdDesignSystem(flags);
    case 'audit':
      return cmdAudit(flags);
    case 'brief':
      return cmdBrief(positional[0], flags);
    case 'diff':
      return cmdDiff(positional[0], positional[1], flags);
    case 'scope':
      return cmdScope(positional[0], positional[1], flags);
    case 'drafts':
      return cmdDrafts(positional[0], flags);
    case 'query':
      return cmdQuery(positional, flags);
    case 'schema':
      return cmdSchema(positional[0]);
    case 'mutations':
      return cmdMutations();
    default:
      throw new GuardError(`Unknown command \`${command}\`.\n\n${USAGE}`);
  }
}

/** Every command this adapter answers, for site.mjs's dispatch and the docs tests. */
export const COMMANDS = [
  'overview', 'sections', 'entries', 'entry', 'page', 'blocks', 'export', 'grammar',
  'design-system', 'audit', 'brief', 'diff', 'scope', 'drafts', 'query', 'schema', 'mutations',
];
