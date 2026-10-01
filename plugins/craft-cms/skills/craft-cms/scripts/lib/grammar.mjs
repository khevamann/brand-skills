// The composition grammar: which block types are allowed inside which fields.
//
// This is the part a design brief most needs and the part least visible from the
// content: a page's existing blocks show what someone chose, not what is possible.
// The schema's union types show what is possible.

import { cachedTypeFields, contentFieldsOf } from './page.mjs';
import { possibleTypes, namedType } from './introspect.mjs';

/**
 * Walk the type graph from a set of root entry types, recording for every
 * nested-entry field the block types it accepts.
 *
 * Returns a Map of `TypeName.fieldName` -> [allowed block type names].
 */
export async function buildGrammar(rootTypeNames, maxDepth = 4) {
  const grammar = new Map();
  const visited = new Set();

  async function visit(typeName, depth) {
    if (depth > maxDepth || visited.has(typeName)) return;
    visited.add(typeName);

    const type = await cachedTypeFields(typeName).catch(() => null);
    for (const field of contentFieldsOf(type)) {
      const unionName = namedType(field.type).name;
      const allowed = (await possibleTypes(unionName).catch(() => [])).map((t) => t.name);
      grammar.set(`${typeName}.${field.name}`, allowed);
      for (const child of allowed) await visit(child, depth + 1);
    }
  }

  for (const root of rootTypeNames) await visit(root, 0);
  return grammar;
}

/** Block types that accept no nesting — the leaves where copy actually lives. */
export function leafTypes(grammar, allTypes) {
  const parents = new Set([...grammar.keys()].map((k) => k.split('.')[0]));
  return allTypes.filter((t) => !parents.has(t)).sort();
}
