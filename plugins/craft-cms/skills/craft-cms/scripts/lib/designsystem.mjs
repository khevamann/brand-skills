// Extracting the live design system out of a rendered page.
//
// The front end ships its whole token system as inline CSS custom properties —
// ~1000 of them, organised into four display modes — plus a utility-class
// vocabulary. Both are read straight off a saved page rather than described from
// memory, so this cannot drift from what the site actually renders.

/** Every <style> block's contents, concatenated. */
export function inlineCss(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/**
 * Custom properties grouped by the selector that defines them. Themes live on
 * [data-mode=...] selectors; the shared scale lives on :root.
 */
export function extractTokens(html) {
  const css = inlineCss(html);
  const groups = new Map();

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, ' ');
    const body = rule[2];
    if (!body.includes('--')) continue;

    for (const decl of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+)/g)) {
      const key = normaliseSelector(selector);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(decl[1], decl[2].trim());
    }
  }
  return groups;
}

/**
 * Collapse the selectors worth reporting and drop the rest. Per-theme overrides
 * are keyed by numeric Craft ids and there are hundreds of them; the four modes
 * and the root scale are what a design brief needs.
 */
function normaliseSelector(selector) {
  if (/^:host,:root$|^:root$/.test(selector)) return ':root';
  const mode = selector.match(/^\[data-mode=["']?([a-z-]+)["']?\]$/);
  if (mode) return `mode:${mode[1]}`;
  if (selector === 'body') return 'body';
  if (selector === '.prose') return '.prose';
  return null;
}

/** Utility classes present in the markup, with how often each is used. */
export function extractClasses(html) {
  const counts = new Map();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls) counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Group the class vocabulary by its semantic prefix. The design system's own
 * classes (surface-, text-, button-, container-, top-spacing-) are the ones worth
 * naming in a brief; the rest is generic Tailwind.
 */
export function groupClasses(counts) {
  const PREFIXES = [
    'surface', 'text', 'button', 'container', 'top-spacing', 'card',
    'brand', 'menu', 'prose', 'icon', 'border',
  ];
  const groups = new Map(PREFIXES.map((p) => [p, []]));
  const other = [];

  for (const [cls, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const prefix = PREFIXES.find((p) => cls === p || cls.startsWith(`${p}-`));
    if (prefix) groups.get(prefix).push({ cls, n });
    else other.push({ cls, n });
  }
  return { groups, other };
}

/** The display modes the front end supports, read from the token selectors. */
export function extractModes(tokens) {
  return [...tokens.keys()].filter((k) => k.startsWith('mode:')).map((k) => k.slice(5)).sort();
}
