// What a block shares with other pages, seen from the outside.
//
// Two kinds of evidence. Platform rules know that some things are shared by
// construction: a Shopify section group is on every page, a Squarespace summary block
// shows another page's content, an Elementor global widget is one object used in many
// places. And the export itself shows sharing: the same block, the same section id,
// or the same sentence on more than one page.
//
// The outside view cannot tell a CMS-level shared component from text pasted into
// several pages, so any repeat is treated as shared and needs a person to decide.

import { RADIUS } from '../../core/scope.mjs';
import { normaliseText } from '../../core/segment.mjs';

/** Index an export: fingerprints, DOM ids and copy values → the pages carrying them. */
export function buildSharedIndex(corpus) {
  const byFingerprint = new Map();
  const byDomId = new Map();
  const byValue = new Map();
  const add = (map, key, pageId) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(pageId);
  };
  for (const { page, blocks, chrome = [] } of corpus) {
    for (const block of [...blocks, ...chrome]) {
      add(byFingerprint, block._fingerprint, page.id);
      add(byDomId, block._domId, page.id);
      for (const [field, value] of Object.entries(block)) {
        if (!field.startsWith('text_') || typeof value !== 'string') continue;
        const n = normaliseText(value);
        if (n.length >= 40) add(byValue, n, page.id);
      }
    }
  }
  return { byFingerprint, byDomId, byValue, pages: corpus.length };
}

const others = (set, pageId) => [...(set ?? [])].filter((p) => p !== pageId);

/**
 * Blocks repeated on most pages are site layout — navigation, footers, banners —
 * even when the HTML does not mark them as such. Moves them from `blocks` to
 * `chrome` with region `layout`. Needs a few pages to judge; does nothing below 3.
 */
export function markLayout(corpus) {
  if (corpus.length < 3) return 0;
  const counts = new Map();
  for (const { blocks } of corpus) {
    for (const fp of new Set(blocks.map((b) => b._fingerprint).filter(Boolean))) counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(corpus.length * 0.6));
  let moved = 0;
  for (const entry of corpus) {
    const keep = [];
    for (const b of entry.blocks) {
      const n = counts.get(b._fingerprint) ?? 0;
      if (n >= threshold) {
        entry.chrome = [...(entry.chrome ?? []), { ...b, _region: 'layout', _layoutShare: `${n} of ${corpus.length}` }];
        moved += 1;
      } else {
        keep.push(b);
      }
    }
    entry.blocks = keep;
  }
  return moved;
}

/** Other pages carrying this block or this field's current value. */
export function sharedWith(index, pageId, block, field) {
  const viaBlock = new Set([
    ...others(index.byFingerprint.get(block._fingerprint), pageId),
    ...others(index.byDomId.get(block._domId), pageId),
  ]);
  const value = typeof block[field] === 'string' ? normaliseText(block[field]) : '';
  const viaValue = value.length >= 40 ? others(index.byValue.get(value), pageId) : [];
  return { viaBlock: [...viaBlock], viaValue: viaValue.filter((p) => !viaBlock.has(p)) };
}

/** Shopify: other exported pages rendered from the same template as this block's section. */
export function sameTemplatePages(corpus, pageId, block) {
  const template = (block._domId ?? '').match(/^shopify-section-(template--\d+)__/)?.[1];
  if (!template) return [];
  return corpus
    .filter(({ page, blocks }) => page.id !== pageId && blocks.some((b) => (b._domId ?? '').startsWith(`shopify-section-${template}__`)))
    .map(({ page }) => page.id);
}

/**
 * Shared-by-construction rules per platform. Returns a scope item, or null when the
 * platform has nothing to say about this block.
 */
export function platformRule(platform, page, block) {
  const what = `${block.id} (${block.__typename})`;
  const ask = (why) => ({ radius: RADIUS.NEEDS_CONFIRMATION, what, why });

  if (block._region === 'layout') {
    return ask(`This is part of the site's layout, repeated on ${block._layoutShare} exported pages (navigation, a footer or similar). Changing it changes the whole site.`);
  }
  if (block._region !== 'main') {
    return ask(`This is the site ${block._region}, which appears on every page. Changing it changes the whole site.`);
  }

  if (platform === 'shopify') {
    const id = block._domId ?? '';
    if (/^shopify-section-sections--/.test(id)) {
      return ask('This section belongs to a Shopify section group (header, footer or similar), which is shown on every page.');
    }
    if (/^shopify-section-template--/.test(id) && !/^main/.test(block.__typename) && page.path !== '/') {
      return ask(
        "This section's settings live in the page's Shopify template, not on the page itself. " +
          'Every page assigned the same template changes too. To change only this page, create a new ' +
          'template for it first (see the Shopify guide).',
      );
    }
    if (/featured[-_]?collection|product[-_]?(grid|list|recommendations)|collection[-_]?list|featured[-_]?blog|related[-_]?products|recently[-_]?viewed/i.test(block.__typename)) {
      return ask(
        'This section lists products, collections or posts. Its titles and prices come from those items, ' +
          'so editing them here changes the item itself everywhere it appears. Edit the section heading only, or the item in the admin.',
      );
    }
    if (/^main/.test(block.__typename) && /^\/products\//.test(page.path)) {
      return { radius: RADIUS.PAGE, what, why: "The product's own content. Note that product text can also show on collection and search pages." };
    }
  }

  if (platform === 'squarespace') {
    if (block._parts.includes('summary')) {
      return ask('This contains a summary block, which displays content from another page or collection. Edit the source item instead, and check where else it shows.');
    }
    if (block._parts.some((p) => /^(code|embed)$/.test(p))) {
      return ask('This contains a code or embed block. Its content can affect more than what it shows, so a person should check it.');
    }
  }

  if (platform === 'wordpress') {
    if (block._global) {
      return ask('This is an Elementor global widget: one object used in several places. Editing it changes every copy.');
    }
    if (/template-part|wp-block-navigation|wp-block-block/.test(`${block.__typename} ${block._parts.join(' ')}`)) {
      return ask('This is a WordPress template part, navigation or synced pattern, which is shared with other pages.');
    }
  }

  return null;
}

/** Names of fields that are presentation settings rather than copy, in a manifest edit. */
export const isPresentationField = (field) =>
  !/^text_/.test(field) && /(colou?r|theme|style|class|align|size|spacing|padding|margin|width|height|font|layout|background|variant)/i.test(field);
