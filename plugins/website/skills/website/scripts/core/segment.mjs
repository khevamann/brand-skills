// Turning a rendered page into blocks and fields, from the outside.
//
// Where a platform marks its own structure in the HTML, that is used: Shopify's
// section wrappers, Squarespace's section and block attributes, Elementor's element
// ids, Gutenberg's block classes. Anywhere else, the page's main content is unwrapped
// to its meaningful children. Either way the result has the same shape as a Craft
// export, so the audit, brief and scope code is shared.
//
// Every block gets a ref (its id in edits and manifests) and copy fields named for
// what they are: text_Heading1, text_Paragraph2, text_Button1. Header, footer and
// navigation are tagged as site chrome — shared by definition.

import { createHash } from 'node:crypto';
import { parse, find, findAll, findOutermost, isElement, classes, hasClass, text, pathOf } from './html.mjs';

const hash = (s, n = 6) => createHash('sha1').update(s).digest('hex').slice(0, n);
export const normaliseText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Same text, same fingerprint — the basis for spotting content shared across pages. */
export const fingerprint = (s) => {
  const n = normaliseText(s);
  return n.length >= 30 ? hash(n, 12) : null;
};

// ---------------------------------------------------------------- regions

function mainOf(root, platform) {
  const byPlatform = {
    shopify: (n) => n.attrs.id === 'MainContent' || (n.tag === 'main' && n.attrs.role === 'main'),
    squarespace: (n) => n.tag === 'main' && n.attrs.id === 'page',
  }[platform];
  return (byPlatform && find(root, byPlatform)) ??
    find(root, (n) => n.tag === 'main') ??
    find(root, (n) => n.attrs.role === 'main') ??
    find(root, (n) => n.tag === 'body') ??
    root;
}

/** Site chrome: header, footer and navigation outside the main content. */
function chromeOf(root, main, platform) {
  const inMain = (n) => {
    for (let p = n; p; p = p.parent) if (p === main) return true;
    return false;
  };
  const isChrome = (n) => {
    if (inMain(n) && main.tag !== 'body') return false;
    if (['header', 'footer', 'nav'].includes(n.tag)) return true;
    if (/^(header|footer|site-header|site-footer|masthead|colophon)$/i.test(n.attrs.id ?? '')) return true;
    if (n.attrs.role === 'banner' || n.attrs.role === 'contentinfo' || n.attrs.role === 'navigation') return true;
    if (platform === 'shopify' && /^shopify-section-sections--/.test(n.attrs.id ?? '')) return true;
    if (platform === 'wordpress' && /^(header|footer)$/.test(n.attrs['data-elementor-type'] ?? '')) return true;
    return false;
  };
  return findOutermost(root, (n) => n !== main && isChrome(n));
}

// ----------------------------------------------------------------- blocks

/** Elements that are a unit of content in themselves: never split them up. */
const CONTENT_UNITS = new Set(['section', 'article']);

/** Unwrap single-child wrappers until the content fans out. */
function unwrap(node) {
  let n = node;
  for (let i = 0; i < 12; i++) {
    const kids = n.children.filter((c) => isElement(c) && !['script', 'style', 'noscript', 'template', 'link', 'meta'].includes(c.tag));
    if (kids.length !== 1 || CONTENT_UNITS.has(kids[0].tag)) break;
    const total = text(n).length;
    if (total && text(kids[0]).length < total * 0.9) break;
    n = kids[0];
  }
  return n;
}

const significant = (n) =>
  !['script', 'style', 'noscript', 'template', 'link', 'meta', 'br', 'hr'].includes(n.tag) &&
  (text(n).length > 0 || find(n, (c) => c.tag === 'img' || c.tag === 'video' || c.tag === 'iframe') || ['img', 'video', 'iframe'].includes(n.tag));

/** The block elements in the main content, with a type for each. */
function blockElements(main, platform, root) {
  if (platform === 'shopify') {
    const sections = findOutermost(main, (n) => /^shopify-section-/.test(n.attrs.id ?? ''));
    if (sections.length) {
      return sections.map((el) => {
        const key = el.attrs.id.replace(/^shopify-section-(template--\d+__|sections--\d+__)?/, '');
        // Generated suffixes are six mixed-case characters (`_DJXemm`); words like `_banner` stay.
        const named = key.replace(/_(?=[a-z0-9]*[A-Z0-9])[A-Za-z0-9]{6}$/, '');
        // Sections added in the editor can have generated keys; fall back to a class name.
        return { el, type: /^[a-z][a-z_-]*[a-z]$/i.test(named) && !/^[0-9a-f-]{20,}$/.test(named) ? named : shopifyClassType(el) };
      });
    }
  }
  if (platform === 'squarespace') {
    const sections = findOutermost(main, (n) => n.tag === 'section' && (n.attrs['data-section-id'] || n.attrs['data-sqsp-section']));
    if (sections.length) return sections.map((el) => ({ el, type: el.attrs['data-sqsp-section'] ?? 'section' }));
    const blocks = findOutermost(main, (n) => hasClass(n, 'sqs-block'));
    if (blocks.length) return blocks.map((el) => ({ el, type: el.attrs['data-sqsp-block'] ?? sqsBlockType(el) }));
  }
  if (platform === 'wordpress') {
    const elementor = find(root, (n) => /^(wp-page|wp-post|single-page|single-post)$/.test(n.attrs['data-elementor-type'] ?? ''));
    if (elementor) {
      // Any Elementor element that is not a widget is structure: section and container
      // in older versions, e-div-block and e-flexbox in Elementor 4.
      const structural = (n) => n.attrs['data-element_type'] && !/^(widget|e-form)/.test(n.attrs['data-element_type']);
      let top = findOutermost(elementor, structural);
      for (let i = 0; i < 4 && top.length === 1; i++) {
        const inner = findOutermost(top[0], (n) => n !== top[0] && structural(n));
        if (inner.length < 2) break;
        top = inner;
      }
      if (top.length) return top.map((el) => ({ el, type: `elementor-${el.attrs['data-element_type']}` }));
    }
    const isContent = (n) => ['entry-content', 'wp-block-post-content', 'page-content', 'post-content'].some((c) => hasClass(n, c));
    const contents = findOutermost(main, isContent);
    if (contents.length > 1) {
      // A listing: the blog page, an archive. Each post is a block.
      return contents.map((c) => {
        let el = c;
        for (let p = c.parent; p && p !== main; p = p.parent) if (p.tag === 'article') el = p;
        return { el, type: 'post' };
      });
    }
    const content = contents[0];
    if (content) {
      return content.children.filter(isElement).filter(significant).map((el) => ({
        el,
        type: classes(el).find((c) => /^wp-block-[a-z]/.test(c) && !/^wp-block-(post-content|template-part)$/.test(c)) ?? el.tag,
      }));
    }
  }
  const container = unwrap(main);
  const kidsOf = (n) => n.children.filter(isElement).filter(significant);
  let kids = kidsOf(container);
  // When one child holds most of the page's words (an app shell wrapping navigation,
  // content and footer), its children are the real blocks.
  for (let i = 0; i < 4 && kids.length; i++) {
    const total = kids.reduce((n, k) => n + text(k).length, 0);
    const big = kids.find((k) => !CONTENT_UNITS.has(k.tag) && text(k).length >= total * 0.7);
    const inner = big ? kidsOf(unwrap(big)) : [];
    if (inner.length < 2) break;
    kids = kids.flatMap((k) => (k === big ? inner : [k]));
  }
  return (kids.length ? kids : [container]).map((el) => ({ el, type: genericType(el) }));
}

const SHOPIFY_GENERIC_CLASSES = /^(shopify-section|section|page-width|color-|gradient|isolate|full-width|spaced-section|scroll-trigger|animate)/;

function shopifyClassType(el) {
  for (const n of [el, ...el.children.filter(isElement)]) {
    const c = classes(n).find((k) => /^[a-z]+(?:[-_][a-z0-9]+)+$/.test(k) && !SHOPIFY_GENERIC_CLASSES.test(k));
    if (c) return c;
  }
  return 'section';
}

function sqsBlockType(el) {
  return classes(el).find((c) => /^sqs-block-[a-z]/.test(c) && c !== 'sqs-block-content')?.replace(/^sqs-block-/, '') ?? 'block';
}

function genericType(el) {
  const cls = classes(el).find((c) => /^[a-z][a-z0-9-]{2,30}$/i.test(c) && !/^(container|row|col|wrapper|inner|clearfix|section|block|js-|is-|has-)/i.test(c));
  return cls ? `${el.tag}.${cls}` : el.tag;
}

/** Sub-block types inside a block: Squarespace blocks, Elementor widgets, Gutenberg blocks. */
function partsOf(el) {
  const parts = [];
  for (const n of findAll(el, () => true)) {
    if (n.attrs['data-sqsp-block']) parts.push(n.attrs['data-sqsp-block']);
    else if (hasClass(n, 'sqs-block')) parts.push(sqsBlockType(n));
    if (n.attrs['data-widget_type']) parts.push(n.attrs['data-widget_type'].replace(/\.default$/, ''));
    const wp = classes(n).find((c) => /^wp-block-[a-z]/.test(c));
    if (wp) parts.push(wp);
  }
  return [...new Set(parts)];
}

// ----------------------------------------------------------------- fields

const FIELD_KIND = {
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Paragraph', li: 'Item', blockquote: 'Quote', figcaption: 'Caption', dt: 'Term', dd: 'Definition',
  td: 'Cell', th: 'Cell', button: 'Button', label: 'Label', summary: 'Summary',
};
const TEXT_PARENTS = new Set(Object.keys(FIELD_KIND));
const STRUCTURE = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'ul', 'ol', 'dl', 'table', 'form', 'figure', ...TEXT_PARENTS]);

/** Holds its own words directly, not only inside child elements. */
const hasOwnText = (n) => n.children.some((c) => c.type === 'text' && !c.raw && c.text.trim());

/**
 * Copy fields of a block, in document order. A text element is captured whole unless
 * it holds other text elements (a list item wrapping paragraphs), in which case its
 * children are captured instead. Recursion stops at anything captured, so nothing is
 * counted twice. A standalone link styled as a button is a Button.
 */
export function fieldsOf(el) {
  const fields = {};
  const counters = {};
  let previous = null;
  const add = (kind, value, node) => {
    // Themes often repeat a title for screen readers or hover states; one copy is the copy.
    if (!value || value === previous) return;
    previous = value;
    counters[kind] = (counters[kind] ?? 0) + 1;
    fields[`text_${kind}${counters[kind]}`] = { value, path: pathOf(node, el) };
  };
  const visit = (n) => {
    for (const c of n.children) {
      if (!isElement(c)) continue;
      const kind = FIELD_KIND[c.tag];
      const hasTextChildren = kind && find(c, (d) => TEXT_PARENTS.has(d.tag) && d.tag !== 'button');
      if (kind && !hasTextChildren) {
        add(kind, text(c), c);
        continue;
      }
      if (hasOwnText(c) && !find(c, (d) => STRUCTURE.has(d.tag)) && c.tag !== 'a') {
        // Words written straight into a container, perhaps around links: keep them together.
        add('Text', text(c), c);
        continue;
      }
      if (c.tag === 'a') {
        const kindA = /btn|button|cta/i.test(classes(c).join(' ')) ? 'Button' : 'Link';
        const t = text(c);
        if (t) add(kindA, t, c);
        continue;
      }
      visit(c);
    }
  };
  const ownKind = FIELD_KIND[el.tag];
  if (ownKind && !find(el, (d) => TEXT_PARENTS.has(d.tag) && d.tag !== 'button')) {
    // The block is itself a paragraph, heading or the like (Gutenberg's top-level blocks).
    add(ownKind, text(el), el);
  } else if (hasOwnText(el) && !find(el, (d) => STRUCTURE.has(d.tag))) {
    add('Text', text(el), el);
  } else {
    visit(el);
  }
  if (!Object.keys(fields).length) {
    const t = text(el);
    if (t) fields.text_Content = { value: t, path: '' };
  }
  return fields;
}

function imagesOf(el, base) {
  return (el.tag === 'img' ? [el] : findAll(el, (n) => n.tag === 'img')).map((img) => ({
    url: absolute(img.attrs.src || img.attrs['data-src'] || img.attrs['data-image'] || '', base),
    alt: img.attrs.alt ?? null,
  })).filter((i) => i.url);
}

function embedsOf(el, base) {
  const nodes = ['iframe', 'video', 'embed', 'object'].includes(el.tag)
    ? [el]
    : findAll(el, (n) => ['iframe', 'video', 'embed', 'object'].includes(n.tag));
  return nodes
    .map((n) => absolute(n.attrs.src || n.attrs['data-src'] || n.attrs.data || find(n, (s) => s.tag === 'source')?.attrs.src || '', base))
    .filter(Boolean)
    .map((url) => ({ url }));
}

function linksOf(el, base) {
  return findAll(el, (n) => n.tag === 'a' && n.attrs.href).map((a) => ({
    linkUrl: absolute(a.attrs.href, base),
    linkText: text(a),
  }));
}

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// ------------------------------------------------------------------- page

/**
 * Segment one page. Returns { title, blocks, chrome } where blocks look like a Craft
 * export's (`__typename`, `id`, copy fields, `images_Images`, `links_Links`) plus
 * underscored metadata the audit ignores.
 */
export function segmentPage(html, url, platform = 'other') {
  const root = parse(html);
  const main = mainOf(root, platform);
  const title =
    text(find(root, (n) => n.tag === 'title') ?? { children: [] }) ||
    find(root, (n) => n.tag === 'meta' && n.attrs.property === 'og:title')?.attrs.content ||
    text(find(main, (n) => n.tag === 'h1') ?? { children: [] });

  const toBlock = ({ el, type }, index, region) => {
    const fields = fieldsOf(el);
    const all = text(el);
    const domId = el.attrs.id || el.attrs['data-section-id'] || el.attrs['data-id'] || null;
    const ref = domId
      ? domId.replace(/^shopify-section-/, '')
      : `${region === 'main' ? 'b' : region[0]}${index + 1}-${hash(normaliseText(all) || pathOf(el), 4)}`;
    const block = {
      __typename: type,
      id: ref,
      _depth: 0,
      _region: region,
      _domId: domId,
      _path: pathOf(el),
      _parts: partsOf(el),
      _fingerprint: fingerprint(all),
      _text: all.slice(0, 2000),
      _paths: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.path])),
    };
    for (const [k, f] of Object.entries(fields)) block[k] = f.value;
    const images = imagesOf(el, url);
    const links = linksOf(el, url);
    if (images.length) block.images_Images = images;
    if (links.length) block.links_Links = links;
    const embeds = embedsOf(el, url);
    if (embeds.length) block.media_Embeds = embeds;
    if (el.attrs['data-section-theme']) block._theme = el.attrs['data-section-theme'];
    if (hasClass(el, 'elementor-global') || classes(el).some((c) => /^elementor-global-\d+/.test(c))) block._global = true;
    return block;
  };

  const blocks = blockElements(main, platform, root).map((b, i) => toBlock(b, i, 'main'));
  const chrome = chromeOf(root, main, platform).map((el, i) => {
    const region = el.tag === 'footer' || /footer|contentinfo/i.test(`${el.attrs.id ?? ''} ${el.attrs.role ?? ''} ${el.attrs['data-elementor-type'] ?? ''}`)
      ? 'footer'
      : el.tag === 'nav' || el.attrs.role === 'navigation' ? 'nav' : 'header';
    return toBlock({ el, type: region }, i, region);
  });

  return { title: title?.trim() ?? '', blocks, chrome };
}
