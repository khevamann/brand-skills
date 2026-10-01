// Enforcement layer. Prose in a skill file is a suggestion; this file is the rule.
//
// Three invariants:
//   1. Free-form GraphQL text can only ever be a read. Any `mutation` or
//      `subscription` operation in a passed-through document is rejected.
//   2. Mutations are never passed through as text at all. craft.mjs assembles
//      them from the allowlist below, so the only writes that can reach Craft
//      are ones this file has approved.
//   3. Every allowed mutation must be provably draft-scoped: it either creates a
//      draft, or writes to a specific existing draft, or creates an unpublished
//      draft. No code path can write to live content.

export class GuardError extends Error {}

/**
 * Mutations that may never be invoked, no matter what. Checked by name against
 * the live schema so `craft mutations` can report them as deliberately blocked
 * rather than merely absent.
 */
export const DENIED_MUTATION_PATTERNS = [
  /^publishDraft$/, // would push a draft live
  /^delete[A-Z]/, // deleteEntry, deleteAsset, deleteCategory, deleteTag, ...
  /^save_.+_Asset$/,
  /^save_.+_Category$/,
  /^save_.+_Tag$/,
  /^save_.+_GlobalSet$/,
  /^save_.+Field_.+_(Entry|Draft)$/, // nested-entry fields: owner may be live
  /^createEntry$/,
  /^resave/i,
  /^restore/i,
  /^moveTo/i,
];

/**
 * Arguments this tool will never set, because each one can reach past the draft
 * and change live content, authorship, publication timing, or structure.
 */
export const DENIED_ARGUMENTS = [
  'id',
  'uid',
  'siteId',
  'authorId',
  'authorIds',
  'postDate',
  'expiryDate',
  'provisional', // provisional drafts are Craft's unsaved-changes buffer
  'prependTo',
  'appendTo',
  'prependToRoot',
  'appendToRoot',
  'insertBefore',
  'insertAfter',
];

/** Strip comments and string literals so keyword detection cannot be fooled. */
export function stripLiterals(document) {
  return document
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/#[^\n]*/g, '');
}

/** Gate for every free-form GraphQL document. Throws unless it is read-only. */
export function assertReadOnly(document) {
  if (typeof document !== 'string' || document.trim() === '') {
    throw new GuardError('Empty GraphQL document.');
  }
  const bare = stripLiterals(document);

  const writeOp = bare.match(/\b(mutation|subscription)\b/i);
  if (writeOp) {
    throw new GuardError(
      `this document contains a \`${writeOp[1]}\` operation. Free-form GraphQL is ` +
        'read-only here. Use `craft draft-create`, `craft draft-new` or `craft draft-set` ' +
        'for the only writes this tool permits.',
    );
  }

  // Belt and braces: a document naming a blocked operation is blocked even if it
  // somehow parsed as a query.
  for (const word of bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (isDeniedMutation(word)) {
      throw new GuardError(`\`${word}\` is a denied operation for this project.`);
    }
  }
  return document;
}

export function isDeniedMutation(name) {
  return DENIED_MUTATION_PATTERNS.some((p) => p.test(name));
}

/**
 * The single approval point for every write. Returns the classification, or
 * throws. `args` is the fully resolved variable set that will be sent.
 */
export function assertDraftWrite(mutationName, args = {}) {
  if (isDeniedMutation(mutationName)) {
    throw new GuardError(`\`${mutationName}\` is on the deny list.`);
  }

  // createDraft is the one mutation that legitimately names a canonical entry id:
  // it reads that entry and writes a new draft row. Its arguments are allowlisted
  // rather than denylisted.
  if (mutationName === 'createDraft') {
    const allowed = new Set(['id', 'name', 'notes']);
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) {
        throw new GuardError(`createDraft accepts only id, name and notes — not \`${key}\`.`);
      }
    }
    if (!isPresent(args.id)) throw new GuardError('createDraft needs the canonical entry id.');
    return 'create-draft';
  }

  for (const forbidden of DENIED_ARGUMENTS) {
    if (forbidden in args) {
      throw new GuardError(
        `\`${forbidden}\` may not be set by this tool — it can affect live content, ` +
          'authorship, scheduling or structure.',
      );
    }
  }

  const isDraftMutation = /^save_[A-Za-z0-9_]+_Draft$/.test(mutationName);
  const isEntryMutation = /^save_[A-Za-z0-9_]+_Entry$/.test(mutationName);

  if (!isDraftMutation && !isEntryMutation) {
    throw new GuardError(`\`${mutationName}\` is not an allowed mutation.`);
  }

  // Craft 5 exposes save_<section>_<type>_Draft, which can only ever touch a
  // draft. Craft 4 only exposes save_<section>_<type>_Entry, which writes to the
  // live entry unless draftId is supplied — so there, draftId is mandatory.
  if (isEntryMutation) {
    if (!isPresent(args.draftId)) {
      throw new GuardError(
        `\`${mutationName}\` writes to the live entry unless it is scoped to a draft. ` +
          'Supply a draftId, or use the save_..._Draft mutation if this Craft version has one.',
      );
    }
    return 'save-draft-via-entry-mutation';
  }

  if (isPresent(args.draftId)) {
    if (args.asUnpublishedDraft) {
      throw new GuardError('draftId and asUnpublishedDraft are mutually exclusive.');
    }
    return 'save-existing-draft';
  }
  if (args.asUnpublishedDraft === true) {
    return 'save-new-unpublished-draft';
  }
  throw new GuardError(
    `\`${mutationName}\` needs either a draftId (edit an existing draft) or ` +
      'asUnpublishedDraft: true (create brand-new draft-only content).',
  );
}

function isPresent(value) {
  return value !== undefined && value !== null && `${value}`.trim() !== '';
}
