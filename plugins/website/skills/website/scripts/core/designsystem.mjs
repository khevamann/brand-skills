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
 * Collapse the selectors worth reporting and drop the rest. The root scale, display
 * modes and colour themes are what a design brief needs; per-component overrides
 * (hundreds of them on some sites) are not. A selector list maps to its first
 * recognised member.
 */
function normaliseSelector(selector) {
  for (const raw of selector.split(',')) {
    const part = raw.trim();
    if (part === ':root' || part === ':host' || part === 'html') return ':root';
    if (part === 'body') return 'body';
    if (part === '.prose') return '.prose';
    const mode = part.match(/^\[data-mode=["']?([a-z-]+)["']?\]$/);
    if (mode) return `mode:${mode[1]}`;
    // Squarespace section colour themes.
    const sqs = part.match(/^\[data-section-theme=["']?([a-z-]+)["']?\]$/);
    if (sqs) return `theme:${sqs[1]}`;
    // Shopify colour schemes (Dawn: .color-scheme-1; Horizon: .color-scheme-<id>).
    const scheme = part.match(/^\.color-(scheme-[\w-]+|background-\d+)$/);
    if (scheme) return `scheme:${scheme[1]}`;
    // Elementor's global kit.
    if (/^\.elementor-kit-\d+$/.test(part)) return 'elementor-kit';
  }
  return null;
}

/** Tokens from a stylesheet rather than a page. */
export function extractTokensFromCss(css) {
  return extractTokens(`<style>${css}</style>`);
}

/**
 * What a site without tokens actually uses: the most frequent colours, font
 * families and font sizes in its CSS. Literal values, so a brief can say "the
 * site's blue is #1a4d8f" even when nothing names it.
 */
export function styleStats(css) {
  const count = (re, normalise = (v) => v) => {
    const counts = new Map();
    for (const m of css.matchAll(re)) {
      const v = normalise(m[1].trim());
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  };
  const hex = (v) => {
    const h = v.toLowerCase();
    return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
  };
  return {
    colours: count(/(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g, (v) => (v.startsWith('#') ? hex(v) : v.replace(/\s+/g, ''))),
    fonts: count(/font-family\s*:\s*([^;}{]+)/g, (v) => (v.startsWith('var(') || v === 'inherit' ? null : v.replace(/\s*!important/, ''))),
    sizes: count(/font-size\s*:\s*([^;}{]+)/g, (v) => (v.startsWith('var(') || v === 'inherit' ? null : v.replace(/\s*!important/, ''))),
  };
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
