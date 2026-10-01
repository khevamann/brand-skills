import { graphql } from './client.mjs';

const TYPE_REF = `
  kind name
  ofType { kind name
    ofType { kind name
      ofType { kind name ofType { kind name } } } }
`;

/** Render a TypeRef back into GraphQL type syntax, e.g. [MatrixInput!]! */
export function renderType(ref) {
  if (!ref) return 'Unknown';
  if (ref.kind === 'NON_NULL') return `${renderType(ref.ofType)}!`;
  if (ref.kind === 'LIST') return `[${renderType(ref.ofType)}]`;
  return ref.name;
}

/** Unwrap NON_NULL/LIST to the underlying named type. */
export function namedType(ref) {
  let t = ref;
  while (t && !t.name) t = t.ofType;
  return t ?? { kind: 'SCALAR', name: 'Unknown' };
}

export async function rootFields(operation) {
  const data = await graphql(`
    { __schema { ${operation}Type { fields { name description } } } }
  `);
  return data.__schema[`${operation}Type`]?.fields ?? [];
}

export async function typeFields(name) {
  const data = await graphql(
    `query ($name: String!) {
      __type(name: $name) {
        name kind description
        fields { name description args { name type { kind } } type { ${TYPE_REF} } }
      }
    }`,
    { name },
  );
  return data.__type;
}

/** The concrete block types a nested-entry (Matrix) field can contain. */
export async function possibleTypes(name) {
  const data = await graphql(
    `query ($name: String!) { __type(name: $name) { kind possibleTypes { name } } }`,
    { name },
  );
  return data.__type?.possibleTypes ?? [];
}

/** True if the field cannot be selected without supplying an argument. */
export function needsArgs(field) {
  return (field.args ?? []).some((a) => a.type?.kind === 'NON_NULL');
}
