// Enforcement layer. Prose in a skill file is a suggestion; this file is the rule.
//
// This skill is read-only. Every GraphQL document it sends must be a query.
//
// Two things already make writing impossible: the site's public schema exposes no
// write mutations, and requests carry no token that could unlock any. This guard is
// the third line — it holds even if someone grants the public schema edit scope
// later, which would otherwise silently turn this tool into a writer.

import { GuardError } from '../../core/cli.mjs';

export { GuardError };

/**
 * Operations that must never be sent, named so they can be reported as
 * deliberately refused rather than merely absent from the schema.
 */
export const DENIED_PATTERNS = [
  /^publishDraft$/,
  /^createDraft$/,
  /^delete[A-Z]/,
  /^save_/,
  /^createEntry$/,
  /^resave/i,
  /^restore/i,
  /^moveTo/i,
];

/** Strip comments and string literals so keyword detection cannot be fooled. */
export function stripLiterals(document) {
  return document
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/#[^\n]*/g, '');
}

/** The only gate. Throws unless the document contains nothing but queries. */
export function assertReadOnly(document) {
  if (typeof document !== 'string' || document.trim() === '') {
    throw new GuardError('Empty GraphQL document.');
  }
  const bare = stripLiterals(document);

  const writeOp = bare.match(/\b(mutation|subscription)\b/i);
  if (writeOp) {
    throw new GuardError(
      `this document contains a \`${writeOp[1]}\` operation. This skill is read-only — ` +
        'it can search and read content, and nothing else. Make content changes in the ' +
        'Craft control panel.',
    );
  }

  for (const word of bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (isDenied(word)) {
      throw new GuardError(`\`${word}\` is a write operation. This skill is read-only.`);
    }
  }
  return document;
}

export function isDenied(name) {
  return DENIED_PATTERNS.some((p) => p.test(name));
}
