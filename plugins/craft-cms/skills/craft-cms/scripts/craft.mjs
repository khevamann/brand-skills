#!/usr/bin/env node
// craft — read-only access to the Craft CMS website.
//
// Searches and reads content. Cannot write: the site's public schema exposes no
// write mutations, requests carry no token, and lib/guard.mjs rejects any document
// containing a mutation. Content changes happen in the Craft control panel.

import { readFileSync } from 'node:fs';
import { graphql, ENDPOINT, CraftError } from './lib/client.mjs';
import { assertReadOnly, isDenied, GuardError } from './lib/guard.mjs';
import { rootFields, typeFields, possibleTypes, renderType, namedType, needsArgs } from './lib/introspect.mjs';

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

const typeCache = new Map();
async function cachedTypeFields(name) {
  if (!typeCache.has(name)) typeCache.set(name, await typeFields(name));
  return typeCache.get(name);
}

/**
 * Build an inline-fragment selection for one block type, recursing into any
 * nested-entry fields it has. Depth is bounded because these trees can nest.
 */
async function blockSelection(typeName, depth) {
  const type = await cachedTypeFields(typeName);
  if (!type) return null;

  const leaves = ['__typename', 'id', 'title'];
  const nestedParts = [];

  for (const f of type.fields ?? []) {
    if (needsArgs(f) || leaves.includes(f.name)) continue;
    const named = namedType(f.type);
    if (named.kind === 'SCALAR' || named.kind === 'ENUM') {
      // SEOmatic lies about this field's type and poisons the whole selection.
      if (f.name === 'seomatic') continue;
      leaves.push(f.name);
    } else if (depth > 0 && /_MatrixField$/.test(named.name ?? '')) {
      const inner = await fieldSelection(named.name, depth - 1);
      if (inner) nestedParts.push(`${f.name} { ${inner} }`);
    }
  }
  return `${leaves.join(' ')} ${nestedParts.join(' ')}`;
}

/** Build the selection set for a nested-entry field, one fragment per block type. */
async function fieldSelection(matrixTypeName, depth) {
  const types = await possibleTypes(matrixTypeName);
  if (!types?.length) return null;
  const fragments = [];
  for (const t of types) {
    const sel = await blockSelection(t.name, depth);
    if (sel) fragments.push(`... on ${t.name} { ${sel} }`);
  }
  return fragments.length ? `__typename id ${fragments.join(' ')}` : null;
}

function renderBlock(block, indent, lines) {
  const pad = '  '.repeat(indent);
  const label = String(block.__typename ?? '?').replace(/^ds_/, '').replace(/_Entry$/, '');
  lines.push(`${pad}[${label} #${block.id}] ${block.title ?? ''}`.trimEnd());

  for (const [key, value] of Object.entries(block)) {
    if (['__typename', 'id', 'title'].includes(key)) continue;
    if (Array.isArray(value)) continue;
    if (value === null || value === '' || value === false) continue;
    if (NOISE.test(key)) continue;
    const text = String(value).trim();
    if (!text) continue;
    lines.push(`${pad}  ${key}: ${text.replace(/\n/g, `\n${pad}    `)}`);
  }
  for (const value of Object.values(block)) {
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (child && typeof child === 'object' && child.__typename) renderBlock(child, indent + 1, lines);
    }
  }
}

async function cmdPage(id, flags) {
  const core = await fetchEntryCore(id);
  const type = await cachedTypeFields(core.__typename);
  const depth = Number(flags.depth ?? 3);

  const contentFields = (type?.fields ?? []).filter(
    (f) => !needsArgs(f) && /_MatrixField$/.test(namedType(f.type).name ?? ''),
  );
  if (contentFields.length === 0) {
    throw new CraftError(
      `${core.__typename} has no nested content fields. Use \`craft entry ${id}\` instead.`,
    );
  }

  const parts = [];
  for (const f of contentFields) {
    const sel = await fieldSelection(namedType(f.type).name, depth - 1);
    if (sel) parts.push(`${f.name} { ${sel} }`);
  }

  const query = `query Page($id: [QueryArgument]) {
  entry(id: $id, status: null) {
    id title uri url status dateUpdated
    ... on ${core.__typename} { ${parts.join('\n      ')} }
  }
}`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(id)] });

  if (flags.raw) return out({ query, entry: data.entry });

  const entry = data.entry;
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
