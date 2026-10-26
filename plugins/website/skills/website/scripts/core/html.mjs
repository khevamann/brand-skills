// A small, forgiving HTML parser. No dependencies, by design: the scripts must run on
// a bare Node install. It is not a spec-complete parser — it builds a tree good enough
// to find sections, headings, paragraphs, links and images on real-world pages, and
// it never throws on bad markup.
//
// Every element records its source offsets, so a block's original markup is
// html.slice(node.start, node.end) rather than a lossy re-serialisation.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'xmp']);

/** Starting one of these closes an open <p>. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);
/** Tags that implicitly close an open sibling of the same kind. */
const SELF_CLOSING_SIBLINGS = {
  li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr'], td: ['td', 'th'], th: ['td', 'th'],
  option: ['option'], thead: ['tbody', 'tfoot'], tbody: ['thead', 'tbody'], tfoot: ['thead', 'tbody'],
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function element(tag, attrs, parent, start) {
  return { type: 'element', tag, attrs, children: [], parent, start, end: start };
}

/** Parse a document. Returns the root node; elements are { tag, attrs, children, parent, start, end }. */
export function parse(html) {
  const root = element('#root', {}, null, 0);
  root.end = html.length;
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (index, at) => {
    while (stack.length - 1 >= index && stack.length > 1) {
      const node = stack.pop();
      node.end = at;
    }
  };
  const openIndex = (tag) => {
    for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) return i;
    return -1;
  };

  // A start tag runs to the first `>` outside quotes. Real pages carry malformed
  // attributes (stray quotes, duplicated values); a stricter pattern would drop the
  // whole element.
  const tagRe = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)[^>]*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m.index > last) top().children.push({ type: 'text', text: html.slice(last, m.index) });
    last = tagRe.lastIndex;

    if (m[1]) {
      // End tag: close back to the matching open element, if there is one.
      const i = openIndex(m[1].toLowerCase());
      if (i > 0) closeTo(i, tagRe.lastIndex);
      continue;
    }
    if (!m[2]) continue; // comment, doctype, CDATA, processing instruction

    const tag = m[2].toLowerCase();
    if (CLOSES_P.has(tag)) {
      const p = openIndex('p');
      if (p > 0 && stack.slice(p).every((n) => n.tag === 'p' || !CLOSES_P.has(n.tag))) closeTo(p, m.index);
    }
    const siblings = SELF_CLOSING_SIBLINGS[tag];
    if (siblings && siblings.includes(top().tag)) closeTo(stack.length - 1, m.index);

    const node = element(tag, parseAttrs(m[3] ?? ''), top(), m.index);
    top().children.push(node);

    if (VOID.has(tag) || m[4] === '/') {
      node.end = tagRe.lastIndex;
      continue;
    }
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'ig');
      close.lastIndex = tagRe.lastIndex;
      const c = close.exec(html);
      const endText = c ? c.index : html.length;
      // Title and textarea hold readable text; the rest is code or inert markup.
      node.children.push({ type: 'text', text: html.slice(tagRe.lastIndex, endText), raw: tag !== 'title' && tag !== 'textarea' });
      node.end = c ? close.lastIndex : html.length;
      tagRe.lastIndex = node.end;
      last = node.end;
      continue;
    }
    stack.push(node);
  }
  if (last < html.length) top().children.push({ type: 'text', text: html.slice(last) });
  closeTo(1, html.length);
  return root;
}

// ---------------------------------------------------------------- queries

export const isElement = (n) => n?.type === 'element';
export const classes = (n) => (n.attrs?.class ?? '').split(/\s+/).filter(Boolean);
export const hasClass = (n, c) => classes(n).includes(c);

/** Depth-first walk. Return false from `visit` to skip a node's children. */
export function walk(node, visit) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (visit(child) === false) continue;
    walk(child, visit);
  }
}

export function findAll(node, predicate) {
  const out = [];
  walk(node, (n) => {
    if (predicate(n)) out.push(n);
  });
  return out;
}

export function find(node, predicate) {
  let found = null;
  walk(node, (n) => {
    if (found) return false;
    if (predicate(n)) {
      found = n;
      return false;
    }
  });
  return found;
}

/** Topmost matches only: once a node matches, its descendants are not searched. */
export function findOutermost(node, predicate) {
  const out = [];
  walk(node, (n) => {
    if (predicate(n)) {
      out.push(n);
      return false;
    }
  });
  return out;
}

const HIDDEN_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'select']);

/** Visible text, whitespace-collapsed and entity-decoded. */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.raw ? '' : decodeEntities(node.text);
  if (HIDDEN_TEXT.has(node.tag)) return '';
  if (node.tag === 'br') return '\n';
  const block = /^(p|div|li|h[1-6]|section|article|tr|td|th|blockquote|figcaption|header|footer|nav|ul|ol)$/.test(node.tag);
  const inner = node.children.map(textOf).join('');
  return block ? ` ${inner} ` : inner;
}

export const cleanText = (s) => s.replace(/[ \t\r\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().replace(/\n+/g, ' ');

export const text = (node) => cleanText(textOf(node));

/** The original markup of an element. */
export const outerHtml = (html, node) => html.slice(node.start, node.end);

/** A readable, mostly stable path like `main > section:3 > div.hero`. */
export function pathOf(node, stopAt = null) {
  const parts = [];
  for (let n = node; n && n.tag !== '#root' && n !== stopAt; n = n.parent) {
    const siblings = (n.parent?.children ?? []).filter((c) => isElement(c) && c.tag === n.tag);
    const index = siblings.length > 1 ? `:${siblings.indexOf(n) + 1}` : '';
    parts.unshift(`${n.tag}${index}`);
  }
  return parts.join(' > ');
}
