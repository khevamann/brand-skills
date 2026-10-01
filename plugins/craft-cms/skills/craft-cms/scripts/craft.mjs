#!/usr/bin/env node
// craft — read + draft-only access to a Craft CMS GraphQL API.
//
// Reads are free-form but guarded. Writes are limited to three operations this
// file builds itself: create a draft of an existing entry, create brand-new
// unpublished-draft content, and set field values on a draft. Nothing here can
// publish, delete, or modify live content. See lib/guard.mjs.

import { readFileSync } from 'node:fs';
import { graphql, CraftError } from './lib/client.mjs';
import {
  assertReadOnly,
  assertDraftWrite,
  isDeniedMutation,
  DENIED_ARGUMENTS,
  GuardError,
} from './lib/guard.mjs';
import { rootFields, mutationField, typeFields, renderType, namedType } from './lib/introspect.mjs';

const USAGE = `craft — read and draft-only access to Craft CMS

READ
  craft sections                     Sections and entry types this token can see
  craft entries [opts]               Search entries
      --section <handle>  --type <handle>  --search "terms"
      --limit <n>         --status <live|disabled|all>
  craft entry <id>                   One entry with its scalar field values
  craft drafts <entryId>             Drafts of an entry
  craft drafts --unpublished         Drafts that have never been published
  craft fields <id>                  Fields settable on a draft of this entry
  craft query <file|->               Run a GraphQL query from a file or stdin
  craft query --q "{ ping }"         Run an inline GraphQL query
  craft schema [TypeName]            Query root fields, or one type's fields
  craft mutations                    What this token could mutate, and what is blocked

DRAFT — the only writes available
  craft draft-create <entryId> [--name "..."] [--notes "..."]
      New draft of an existing entry. Live content untouched.

  craft draft-new --section <handle> --type <handle> --title "..." [--field ...]
      Brand-new content as an unpublished draft. Nothing goes live.

  craft draft-set <draftEntryId> --field title="New title" \\
                                 --field body=@/path/to/file.md \\
                                 --json-field someMatrix='[{...}]'
      Write field values into an existing draft.

  Add --dry-run to any draft command to print the mutation without sending it.

BLOCKED BY DESIGN: publishing, deleting, editing live entries, assets,
categories, tags, globals, users, structure moves, config. Not reachable
through \`craft query\` either — that path rejects every mutation document.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const fields = [];
  const jsonFields = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--field' || arg === '--json-field') {
      const pair = argv[++i];
      if (!pair || !pair.includes('=')) throw new GuardError(`${arg} needs key=value`);
      const key = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      (arg === '--field' ? fields : jsonFields).push([key, value]);
    } else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, fields, jsonFields };
}

const out = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

// ----------------------------------------------------------------- read

async function cmdSections() {
  // Section metadata is not exposed as a query, so derive handles from the
  // generated per-section mutations, which are named for them.
  const mutations = await rootFields('mutation').catch(() => []);
  const bySection = new Map();
  for (const f of mutations) {
    const m = f.name.match(/^save_(.+?)_(.+?)_(Entry|Draft)$/);
    if (!m || m[1].endsWith('Field')) continue;
    if (!bySection.has(m[1])) bySection.set(m[1], new Set());
    bySection.get(m[1]).add(m[2]);
  }

  if (bySection.size > 0) {
    out(
      [...bySection.entries()]
        .sort()
        .map(([section, types]) => `${section}\n  types: ${[...types].sort().join(', ')}`)
        .join('\n'),
    );
    return;
  }

  out('This token exposes no entry mutations. Deriving handles from recent entries instead:');
  const query = `{ entries(limit: 200, status: null) { sectionHandle typeHandle } }`;
  assertReadOnly(query);
  const data = await graphql(query);
  const pairs = new Set(data.entries.map((e) => `${e.sectionHandle} / ${e.typeHandle}`));
  out([...pairs].sort().join('\n'));
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
        id title slug status sectionHandle typeHandle dateUpdated url
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
  out({ total: data.entryCount, showing: data.entries.length, entries: data.entries });
}

const CORE_ENTRY_FIELDS = `
  id title slug uri url status enabled
  sectionHandle typeHandle
  isDraft draftId draftName draftNotes isProvisionalDraft isUnpublishedDraft
  postDate dateUpdated __typename
`;

async function fetchEntryCore(id) {
  if (!id) throw new GuardError('An entry id is required.');
  const query = `query ($id: [QueryArgument]) { entry(id: $id, status: null) { ${CORE_ENTRY_FIELDS} } }`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(id)] });
  if (!data.entry) {
    throw new CraftError(`No entry visible with id ${id}. Check the id and the token's schema scope.`);
  }
  return data.entry;
}

async function cmdEntry(id) {
  const core = await fetchEntryCore(id);
  const type = await typeFields(core.__typename);

  // Select every leaf field. Anything needing a subselection (Matrix, relations)
  // is reported by name so it can be queried deliberately.
  const leaves = [];
  const complex = [];
  for (const f of type?.fields ?? []) {
    if (f.args?.length) continue;
    const named = namedType(f.type);
    if (named.kind === 'SCALAR' || named.kind === 'ENUM') leaves.push(f.name);
    else complex.push(`${f.name}: ${renderType(f.type)}`);
  }

  const query = `query ($id: [QueryArgument]) { entry(id: $id, status: null) { ${leaves.join(' ')} } }`;
  assertReadOnly(query);
  const data = await graphql(query, { id: [String(id)] });

  out({
    entry: data.entry,
    structuredFields: complex,
    hint: complex.length
      ? 'Those fields hold structured content — query them with `craft query` and a subselection.'
      : undefined,
  });
}

async function cmdDrafts(entryId, flags) {
  const unpublished = flags.unpublished === true || flags.unpublished === 'true';
  if (!unpublished && !entryId) {
    throw new GuardError('Pass a canonical entry id, or --unpublished.');
  }
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
    const type = await typeFields(typeName);
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
  const fields = await rootFields('mutation');
  const allowed = [];
  const denied = [];
  for (const f of fields) {
    if (isDeniedMutation(f.name)) {
      denied.push(f.name);
    } else if (f.name === 'createDraft') {
      allowed.push(`${f.name}  — draft of an existing entry`);
    } else if (/^save_[A-Za-z0-9_]+_Draft$/.test(f.name)) {
      allowed.push(`${f.name}  — draft writes only`);
    } else if (/^save_[A-Za-z0-9_]+_Entry$/.test(f.name)) {
      allowed.push(`${f.name}  — only when scoped with a draftId`);
    } else {
      denied.push(f.name);
    }
  }
  out(
    `This token's schema exposes ${fields.length} mutations.\n\n` +
      `REACHABLE THROUGH THIS TOOL (${allowed.length}):\n` +
      (allowed.sort().map((a) => `  ${a}`).join('\n') || '  none') +
      `\n\nBLOCKED (${denied.length}):\n` +
      (denied.sort().map((d) => `  ${d}`).join('\n') || '  none') +
      '\n\nBlocked mutations are unreachable: craft.mjs will not build them, and\n' +
      '`craft query` rejects every document containing a mutation.',
  );
}

// --------------------------------------------------------------- drafts

/**
 * Find the mutation to write a draft for this section/type. Craft 5 has a
 * dedicated save_..._Draft; Craft 4 only has save_..._Entry, which this tool
 * will use solely with a draftId.
 */
async function resolveDraftMutation(sectionHandle, typeHandle) {
  if (!sectionHandle || !typeHandle) {
    throw new CraftError(
      'No section/type handle available (nested entry?). This tool cannot derive its mutation.',
    );
  }
  for (const suffix of ['Draft', 'Entry']) {
    const name = `save_${sectionHandle}_${typeHandle}_${suffix}`;
    const field = await mutationField(name);
    if (field) return field;
  }
  throw new CraftError(
    `The schema exposes neither save_${sectionHandle}_${typeHandle}_Draft nor ` +
      `save_${sectionHandle}_${typeHandle}_Entry. The token's schema likely lacks write ` +
      'scope for that section — run `craft mutations`.',
  );
}

async function cmdFields(entryId) {
  const entry = await fetchEntryCore(entryId);
  const mutation = await resolveDraftMutation(entry.sectionHandle, entry.typeHandle);
  const blocked = new Set([...DENIED_ARGUMENTS, 'draftId', 'asUnpublishedDraft']);
  out({
    entry: { id: entry.id, title: entry.title, section: entry.sectionHandle, type: entry.typeHandle },
    mutation: mutation.name,
    settable: mutation.args
      .filter((a) => !blocked.has(a.name))
      .map((a) => `${a.name}: ${renderType(a.type)}`),
    refused: mutation.args.filter((a) => DENIED_ARGUMENTS.includes(a.name)).map((a) => a.name),
  });
}

async function cmdDraftCreate(entryId, flags) {
  const entry = await fetchEntryCore(entryId);
  if (entry.isDraft) {
    throw new CraftError(`${entryId} is already a draft. Pass the canonical entry id.`);
  }

  const variables = { id: Number(entry.id), name: flags.name ?? null, notes: flags.notes ?? null };
  assertDraftWrite('createDraft', variables);

  const document = `mutation CreateDraft($id: Int!, $name: String, $notes: String) {
  createDraft(id: $id, name: $name, notes: $notes)
}`;

  if (flags['dry-run']) return out({ dryRun: true, document, variables });

  await graphql(document, variables);

  // createDraft's return value has changed meaning across Craft versions, so
  // report the draft by reading it back instead of trusting it.
  const after = await graphql(
    `query ($id: QueryArgument) {
      entries(draftOf: $id, drafts: true, status: null, orderBy: "dateUpdated desc", limit: 1) {
        id draftId draftName dateUpdated
      }
    }`,
    { id: String(entry.id) },
  );
  const draft = after.entries[0];
  out({
    created: true,
    canonicalEntry: { id: entry.id, title: entry.title },
    draft,
    next: draft
      ? `craft draft-set ${draft.id} --field title="..."`
      : `Draft created but not returned — run \`craft drafts ${entry.id}\`.`,
  });
}

function coerce(key, rawValue, argType) {
  const named = namedType(argType);
  const isList =
    argType.kind === 'LIST' || (argType.kind === 'NON_NULL' && argType.ofType?.kind === 'LIST');
  if (named.kind === 'INPUT_OBJECT' || isList) {
    throw new GuardError(
      `Field \`${key}\` is ${renderType(argType)} — pass it with --json-field ${key}='<json>'.`,
    );
  }
  switch (named.name) {
    case 'Int':
      return Number.parseInt(rawValue, 10);
    case 'Float':
      return Number.parseFloat(rawValue);
    case 'Boolean':
      return rawValue === 'true' || rawValue === '1';
    default:
      return rawValue;
  }
}

/** Turn --field / --json-field pairs into typed variables for a mutation. */
function buildFieldVariables(mutation, fields, jsonFields, context) {
  const argByName = new Map(mutation.args.map((a) => [a.name, a]));
  const variables = {};
  const declarations = [];
  const callArgs = [];

  const add = (key, value, argType) => {
    variables[key] = value;
    declarations.push(`$${key}: ${renderType(argType)}`);
    callArgs.push(`${key}: $${key}`);
  };

  for (const [key, raw] of fields) {
    const arg = argByName.get(key);
    if (!arg) throw new GuardError(`\`${key}\` is not an argument of ${mutation.name}. ${context}`);
    const value = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw;
    add(key, coerce(key, value, arg.type), arg.type);
  }
  for (const [key, raw] of jsonFields) {
    const arg = argByName.get(key);
    if (!arg) throw new GuardError(`\`${key}\` is not an argument of ${mutation.name}. ${context}`);
    add(key, JSON.parse(raw), arg.type);
  }
  return { variables, declarations, callArgs };
}

async function cmdDraftNew({ flags, fields, jsonFields }) {
  const { section, type, title } = flags;
  if (!section || !type) {
    throw new GuardError('--section and --type are required. Run `craft sections` to list them.');
  }
  const mutation = await resolveDraftMutation(section, type);
  if (!/_Draft$/.test(mutation.name)) {
    throw new CraftError(
      `This Craft version only exposes ${mutation.name}, which cannot create draft-only ` +
        'content from scratch. Create the entry in the control panel, then use ' +
        '`craft draft-create <id>`.',
    );
  }

  const allFields = title ? [['title', String(title)], ...fields] : fields;
  const built = buildFieldVariables(mutation, allFields, jsonFields, `Run \`craft schema\` for its args.`);

  const variables = { asUnpublishedDraft: true, ...built.variables };
  assertDraftWrite(mutation.name, variables);

  const document = `mutation NewDraft($asUnpublishedDraft: Boolean${built.declarations.length ? ', ' + built.declarations.join(', ') : ''}) {
  ${mutation.name}(asUnpublishedDraft: $asUnpublishedDraft${built.callArgs.length ? ', ' + built.callArgs.join(', ') : ''}) {
    id title isDraft draftId isUnpublishedDraft dateUpdated
  }
}`;

  if (flags['dry-run']) return out({ dryRun: true, document, variables });
  const data = await graphql(document, variables);
  out({ created: 'unpublished draft', draft: data[mutation.name], live: false });
}

async function cmdDraftSet(draftEntryId, { flags, fields, jsonFields }) {
  if (fields.length === 0 && jsonFields.length === 0) {
    throw new GuardError('Nothing to set. Pass at least one --field or --json-field.');
  }

  const draft = await fetchEntryCore(draftEntryId);
  if (!draft.isDraft) {
    throw new CraftError(
      `Entry ${draftEntryId} is live content, not a draft. Run ` +
        `\`craft draft-create ${draftEntryId}\` and set values on the draft it returns.`,
    );
  }
  if (!draft.draftId) throw new CraftError(`Draft ${draftEntryId} has no draftId; cannot save safely.`);
  if (draft.isProvisionalDraft) {
    throw new CraftError(
      `Draft ${draftEntryId} is provisional (someone's unsaved control-panel changes). Refusing to touch it.`,
    );
  }

  const mutation = await resolveDraftMutation(draft.sectionHandle, draft.typeHandle);
  const built = buildFieldVariables(mutation, fields, jsonFields, `Run \`craft fields ${draftEntryId}\`.`);

  const variables = { draftId: String(draft.draftId), ...built.variables };
  assertDraftWrite(mutation.name, variables);

  const document = `mutation SaveDraft($draftId: ID${built.declarations.length ? ', ' + built.declarations.join(', ') : ''}) {
  ${mutation.name}(draftId: $draftId${built.callArgs.length ? ', ' + built.callArgs.join(', ') : ''}) {
    id title isDraft draftId dateUpdated
  }
}`;

  if (flags['dry-run']) return out({ dryRun: true, document, variables });
  const data = await graphql(document, variables);
  out({ saved: true, draft: data[mutation.name] });
}

// ------------------------------------------------------------------ main

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const parsed = parseArgs(rest);
  const { positional, flags } = parsed;

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
    case 'drafts':
      return cmdDrafts(positional[0], flags);
    case 'fields':
      return cmdFields(positional[0]);
    case 'query':
      return cmdQuery(positional, flags);
    case 'schema':
      return cmdSchema(positional[0]);
    case 'mutations':
      return cmdMutations();
    case 'draft-create':
      return cmdDraftCreate(positional[0], flags);
    case 'draft-new':
      return cmdDraftNew(parsed);
    case 'draft-set':
      return cmdDraftSet(positional[0], parsed);
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
