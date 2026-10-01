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

export async function mutationField(name) {
  const data = await graphql(
    `query ($name: String!) {
      __type(name: $name) {
        fields { name args { name description type { ${TYPE_REF} } } }
      }
    }`,
    { name: 'Mutation' },
  );
  return (data.__type?.fields ?? []).find((f) => f.name === name) ?? null;
}

export async function typeFields(name) {
  const data = await graphql(
    `query ($name: String!) {
      __type(name: $name) {
        name kind description
        fields { name description args { name } type { ${TYPE_REF} } }
      }
    }`,
    { name },
  );
  return data.__type;
}
