#!/usr/bin/env node
// craft — read-only access to the Craft CMS website.
//
// Searches and reads content. Cannot write: the site's public schema exposes no
// write mutations, requests carry no token, and lib/guard.mjs rejects any document
// containing a mutation. Content changes happen in the Craft control panel.

import { readFileSync } from 'node:fs';
import { graphql, ENDPOINT, CraftError } from './lib/client.mjs';
import { assertReadOnly, isDenied, GuardError } from './lib/guard.mjs';
import { rootFields, typeFields, renderType, namedType, needsArgs } from './lib/introspect.mjs';
import { cachedTypeFields, contentFieldsOf, fetchPageTree, flattenBlocks } from './lib/page.mjs';

const USAGE = `craft — read-only access to the Craft CMS website

  ${ENDPOINT}

FIND
  craft sections                     Sections and entry types on the site
  craft entries [opts]               Search or list entries
      --section <handle>  --type <handle>  --search "terms"
      --limit <n>         --status <live|disabled|all>
  craft drafts <entryId>             Drafts of an entry
  craft drafts --unpublished         Drafts that have never been published

READ
  craft page <id>                    A page's copy, walking the nested block tree
      --raw                          Full JSON instead of rendered text
      --depth <n>                    How far to follow nesting (default 3)
  craft entry <id>                   One entry's own fields
  craft blocks                       The block vocabulary: types, usage, which fields hold copy
  craft export [--out DIR]           Whole site to disk: block trees, rendered HTML, inventory
      --no-html                      Skip the rendered HTML fetches
  craft query <file|->               Run a GraphQL query from a file or stdin
  craft query --q "{ ping }"         Run an inline GraphQL query
  craft schema [TypeName]            Query root fields, or one type's fields
  craft mutations                    Audit: what the schema could write, and why none of it is reachable

This skill is read-only. There is no command that creates, edits, publishes or
deletes anything, and \`craft query\` refuses any document containing a mutation.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const out = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

// Presentation and plumbing fields, hidden when rendering copy. They are still
// present in --raw output.
const NOISE =
  /(Colo(u)?r|Palette|Padding|Spacing|SpaceBetween|Width|Align|Size|Opacity|Height|Position|Theme|Animation|Border|Divider|Columns|Overlay|ImageType|IconSize)|^(sortOrder|fieldId|fieldHandle|ownerId|uid|slug|uri|url|enabled|enabledForSite|status|language|siteHandle|siteId|siteSettingsId|structureId|lft|rgt|level|root|typeId|typeHandle|sectionId|sectionHandle|authorId|authorIds|canonicalId|canonicalUid|searchScore|seo|seomatic|archived|trashed|hideBanner|showBreadcrumbs|pageVisibility)$|^(date|post|expiry|is|draft|revision|_count)/;

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
      ? `This entry's content is in nested blocks — run \`craft page ${id}\` to read it.`
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
      `${core.__typename} has no nested content fields. Use \`craft entry ${id}\` instead.`,
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
    'entry type AND a matching Nuxt component — neither is reachable from this skill or',
    'from the GraphQL API, which cannot touch the content model at all. Design work must',
    'compose these, or use ds_EmbedBlock for raw HTML.',
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
  const dir = flags.out ?? 'site-export';
  const { mkdirSync, writeFileSync } = await import('node:fs');
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

Generated by \`craft export\`. Read-only snapshot of the live site.

- \`index.json\` — one row per page: id, uri, status, block count, block types used
- \`entries.json\` — every entry, split into pages and nested blocks
- \`pages/<id>.json\` — the page's full block tree, plus a flattened block list
- \`pages/<id>.html\` — the rendered page as served

${index.length} pages, ${nested.length} nested blocks.

## Block types by how many pages use them

${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t} — ${n} pages`).join('\n')}

## Caveats

- **Embed blocks render client-side.** Their markup is in the Nuxt payload and injected
  on hydration, so it is present in the JSON but absent from the saved HTML. Any page
  using \`ds_EmbedBlock\` needs a headless browser render for a faithful snapshot.
- The saved HTML references CSS and JS on Digistorm's CDN, so it needs a network
  connection to render — but no authentication.
- Disabled entries and drafts are included: the public schema exposes them.
`;
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
          "  craft query --q '{ entry(id: <id>) { __typename } }'",
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
      '  3. lib/guard.mjs rejects any document containing a mutation.\n' +
      '\nContent changes happen in the Craft control panel.',
  );
}

// ------------------------------------------------------------------ main

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return out(USAGE);
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

main().catch((err) => {
  if (err instanceof GuardError) {
    console.error(`BLOCKED: ${err.message}`);
    process.exit(2);
  }
  if (err instanceof CraftError) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
