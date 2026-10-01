// Walking a page's nested block tree: build the selection, render the result.
// Pages on this site hold almost no content of their own — the copy sits two levels
// down, under contentBuilder and then layout_contentBuilder.

import { graphql } from './client.mjs';
import { assertReadOnly } from './guard.mjs';
import { typeFields, possibleTypes, namedType, needsArgs } from './introspect.mjs';

/**
 * What to select from relation fields. Images and links are content — a tile with
 * only an image is not an empty block, and a link list is not empty either.
 */
const RELATION_SELECTIONS = {
  AssetInterface: 'id title url alt',
  HyperLinkInterface: 'linkText linkUrl url target newWindow type',
  EntryInterface: 'id title uri url status',
};

/**
 * Built-in element relations. They are the same GraphQL types as content relations,
 * so they must be excluded by name — selecting `revisions` would make every block
 * look like it holds content, and bloat every query.
 */
const PLUMBING_RELATIONS =
  /^(revisions|drafts|localized|ancestors|descendants|children|siblings|parent|author|authors|draftCreator|revisionCreator|currentRevision|canonical|next|prev|owner|site|sites)$/;

const typeCache = new Map();
export async function cachedTypeFields(name) {
  if (!typeCache.has(name)) typeCache.set(name, await typeFields(name));
  return typeCache.get(name);
}

/**
 * Build an inline-fragment selection for one block type, recursing into any
 * nested-entry fields it has. Depth is bounded because these trees can nest.
 */
export async function blockSelection(typeName, depth) {
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
    } else if (RELATION_SELECTIONS[named.name ?? ''] && !PLUMBING_RELATIONS.test(f.name)) {
      // Assets, links and entry relations. These interfaces have no implementing
      // types in this schema, so their fields are selected directly — an inline
      // fragment on them fails with Craft's opaque validation error.
      nestedParts.push(`${f.name} { ${RELATION_SELECTIONS[named.name]} }`);
    }
  }
  return `${leaves.join(' ')} ${nestedParts.join(' ')}`;
}

/** Build the selection set for a nested-entry field, one fragment per block type. */
export async function fieldSelection(matrixTypeName, depth) {
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


/** The nested-entry fields on an entry type — the ones holding page content. */
export function contentFieldsOf(type) {
  return (type?.fields ?? []).filter(
    (f) => !needsArgs(f) && /_MatrixField$/.test(namedType(f.type).name ?? ''),
  );
}

/** Fetch one page's full block tree. Returns { entry, query, contentFields }. */
export async function fetchPageTree(core, depth = 3) {
  const type = await cachedTypeFields(core.__typename);
  const contentFields = contentFieldsOf(type);
  if (contentFields.length === 0) return { entry: null, contentFields: [] };

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
  const data = await graphql(query, { id: [String(core.id)] });
  return { entry: data.entry, query, contentFields };
}

/** Every block in a tree, flattened, each tagged with its depth and parent. */
export function flattenBlocks(entry, contentFields) {
  const blocks = [];
  const walk = (block, depth, parentId, fieldName) => {
    blocks.push({ ...block, _depth: depth, _parent: parentId, _field: fieldName });
    for (const [key, value] of Object.entries(block)) {
      if (!Array.isArray(value)) continue;
      for (const child of value) {
        if (child && typeof child === 'object' && child.__typename) walk(child, depth + 1, block.id, key);
      }
    }
  };
  for (const f of contentFields) {
    for (const b of entry?.[f.name] ?? []) walk(b, 0, entry.id, f.name);
  }
  return blocks;
}
