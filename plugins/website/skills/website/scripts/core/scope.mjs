// Blast-radius rules for a proposed change.
//
// The danger in an automated round trip is not a wrong word on one page — it is a
// change that looks local and is not. Three things here are shared: entries
// referenced by relation fields (pre-footers, popups, videos) appear on many pages;
// a copy value repeated across pages diverges if you edit one copy; and the design
// system itself lives in the front end, where the CMS cannot reach at all.
//
// Nothing may be applied beyond a single page without explicit human confirmation.

export { classifyField, COPY, PRESENTATION } from './fields.mjs';

export const RADIUS = {
  PAGE: 'page',
  NEEDS_CONFIRMATION: 'needs-confirmation',
  NOT_POSSIBLE: 'not-possible',
};

const GLOBAL_MANIFEST_KEYS = ['styles', 'tokens', 'css', 'theme', 'global', 'siteWide'];

const GLOBAL_INTENT = /\b(all pages|every page|site[- ]?wide|globally|global style|design token|stylesheet|css|font family|brand colou?r|typography scale|navigation|header|footer)\b/i;

/**
 * Manifest-level checks, before any individual edit is considered. These catch a
 * design tool asking for something that is not a page edit at all.
 */
export function manifestConcerns(manifest, { knownTypes = null } = {}) {
  const concerns = [];
  const bare = (t) => String(t).replace(/_Entry$/, '');
  const known = knownTypes ? new Set([...knownTypes].map(bare)) : null;

  for (const key of GLOBAL_MANIFEST_KEYS) {
    if (manifest[key] !== undefined) {
      concerns.push({
        radius: RADIUS.NOT_POSSIBLE,
        what: `manifest key \`${key}\``,
        why:
          'The design system lives in the front-end application, not the CMS. Tokens, ' +
          'stylesheets and theme values cannot be changed through content at all.',
      });
    }
  }

  for (const note of manifest.unmapped ?? []) {
    if (GLOBAL_INTENT.test(String(note))) {
      concerns.push({
        radius: RADIUS.NEEDS_CONFIRMATION,
        what: `unmapped note: ${JSON.stringify(String(note).slice(0, 120))}`,
        why: 'Reads as a change beyond this page. Confirm the intended scope before acting.',
      });
    }
  }

  for (const nb of manifest.newBlocks ?? []) {
    if (!nb.type) continue;
    if (!known) {
      concerns.push({
        radius: RADIUS.NEEDS_CONFIRMATION,
        what: `new block \`${nb.type}\``,
        why: "The site's block types could not be checked, so this may be a type that does not exist.",
      });
    } else if (!known.has(bare(nb.type))) {
      concerns.push({
        radius: RADIUS.NOT_POSSIBLE,
        what: `new block type \`${nb.type}\``,
        why: "Not an existing block type on this site. New types need a change by the site's developers.",
      });
    }
  }
  return concerns;
}

/** The verdict for a whole run: the most restrictive radius wins. */
export function overallVerdict(items) {
  if (items.some((i) => i.radius === RADIUS.NOT_POSSIBLE)) return RADIUS.NOT_POSSIBLE;
  if (items.some((i) => i.radius === RADIUS.NEEDS_CONFIRMATION)) return RADIUS.NEEDS_CONFIRMATION;
  return RADIUS.PAGE;
}

export function exitCodeFor(verdict) {
  // 0 only when everything is confined to the one page. A pipeline halts otherwise.
  return verdict === RADIUS.PAGE ? 0 : 3;
}
