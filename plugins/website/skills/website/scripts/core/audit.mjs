// Content checks over a site corpus. Nothing here talks to the site; it reads what
// `site export` wrote, so an audit can be re-run instantly while iterating.

import { classifyField, COPY } from './fields.mjs';

/**
 * Block types that legitimately store nothing. Listing and feed blocks render content
 * pulled from elsewhere; spacers and dividers are purely structural. Reporting these
 * as empty is noise, not a finding.
 */
const DYNAMIC_OR_STRUCTURAL =
  /^(?:[a-z]+_)?(News|Events|EventsCalendar|EventsCalendarWidget|NewsListing|EventsListing|SocialMediaFeed|BusinessDirectory|Snippet|Form|Spacer|Divider)[A-Za-z]*(Layout)?Block_Entry$/;

/** Built-in element relations, never content. */
const PLUMBING_RELATIONS =
  /^(revisions|drafts|localized|ancestors|descendants|children|siblings|parent|author|authors|draftCreator|revisionCreator|currentRevision|canonical|next|prev|owner|site|sites)$/;

const PLACEHOLDER = [
  { label: 'lorem ipsum', pattern: /lorem ipsum/i },
  { label: 'TODO / TBC / FIXME', pattern: /\b(TODO|TBC|TBD|FIXME|XXX)\b/ },
  { label: 'template placeholder', pattern: /\{\{|\[insert|your (school|company|business|text) here/i },
];

/**
 * Site-specific demo copy, e.g. the theme vendor's sample school name. Kept in the
 * project's site.json (`audit.placeholders`) because it differs per site.
 */
function placeholderPatterns(extra = []) {
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...PLACEHOLDER,
    ...extra.filter(Boolean).map((text) => ({ label: `demo copy "${text}"`, pattern: new RegExp(escape(text), 'i') })),
  ];
}

/**
 * Copy-bearing string values on a block, with their field names. Classification is
 * delegated so audits, briefs and the scope gate all agree: a short heading like
 * "Intellectual Vitality" is copy, while "md" is a spacing setting.
 */
export function copyValues(block, profile = null) {
  const out = [];
  for (const [key, value] of Object.entries(block)) {
    if (typeof value !== 'string' || !value || key.startsWith('_') || key === '__typename') continue;
    if (!/^[a-zA-Z]+_[A-Za-z]/.test(key)) continue;
    if (classifyField(block.__typename, key, profile) !== COPY) continue;
    out.push({ field: key, value });
  }
  return out;
}

/** Images and links on a block — content, even though they hold no text. */
export function relationValues(block) {
  const out = [];
  for (const [field, value] of Object.entries(block)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (field.startsWith('_')) continue; // adapter metadata, not content
    if (value.some((v) => v && v.__typename)) continue; // nested blocks, not relations
    if (PLUMBING_RELATIONS.test(field)) continue;
    out.push({ field, items: value });
  }
  return out;
}

/**
 * Pages that are meant to contain placeholder text. A component demo page is doing
 * its job when it says "Lorem ipsum", and on this site it accounts for most of the
 * findings — enough to drown the real ones.
 */
export function isReferencePage(page) {
  return /style[- ]?guide|component (library|demo)|kitchen sink/i.test(
    `${page.title ?? ''} ${page.uri ?? ''}`,
  );
}

export function findPlaceholders(corpus, profile = null, { includeReferencePages = false, extraPatterns = [] } = {}) {
  const patterns = placeholderPatterns(extraPatterns);
  const findings = [];
  for (const { page, blocks } of corpus) {
    if (!includeReferencePages && isReferencePage(page)) continue;
    for (const block of blocks) {
      for (const { field, value } of copyValues(block, profile)) {
        for (const { label, pattern } of patterns) {
          const m = value.match(pattern);
          if (!m) continue;
          findings.push({
            page: page.uri ?? page.title,
            pageId: page.id,
            status: page.status,
            blockId: block.id,
            type: block.__typename,
            field,
            issue: label,
            excerpt: excerpt(value, m.index),
          });
        }
      }
    }
  }
  return findings;
}

export function findEmptyBlocks(corpus, profile = null) {
  const findings = [];
  for (const { page, blocks } of corpus) {
    for (const block of blocks) {
      const hasCopy = copyValues(block, profile).length > 0;
      // Relation arrays (images, links, referenced entries) count as content, as do
      // nested blocks. A tile holding only a photograph is not an empty block.
      const hasRelations = relationValues(block).length > 0
        || Object.entries(block).some(([, v]) => Array.isArray(v) && v.some((c) => c?.__typename))
        // Some fields hold a single object rather than a list — a Table field's rows,
        // for instance. A populated one is content.
        || Object.entries(block).some(
          ([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && /^[a-zA-Z]+_[A-Za-z]/.test(k),
        );
      if (!hasCopy && !hasRelations && !DYNAMIC_OR_STRUCTURAL.test(block.__typename ?? '')) {
        findings.push({
          page: page.uri ?? page.title,
          pageId: page.id,
          blockId: block.id,
          type: block.__typename,
          issue: 'block holds no copy and nests nothing',
        });
      }
    }
  }
  return findings;
}

/**
 * Identical copy appearing on more than one page. These are the candidates for a
 * shared component — which this CMS cannot express as one object, so they are the
 * argument for either a convention or a new block type.
 */
export function findDuplicateCopy(corpus, minLength = 60, profile = null) {
  const byValue = new Map();
  for (const { page, blocks } of corpus) {
    for (const block of blocks) {
      for (const { field, value } of copyValues(block, profile)) {
        const key = value.replace(/\s+/g, ' ').trim();
        if (key.length < minLength) continue;
        if (!byValue.has(key)) byValue.set(key, []);
        byValue.get(key).push({ pageId: page.id, page: page.uri ?? page.title, blockId: block.id, field });
      }
    }
  }
  return [...byValue.entries()]
    .map(([value, uses]) => ({ value, uses, pages: new Set(uses.map((u) => u.pageId)).size }))
    .filter((d) => d.pages > 1)
    .sort((a, b) => b.pages - a.pages);
}

/** Internal links in rendered HTML that point at no known page. */
export function findBrokenInternalLinks(htmlByPage, knownUris, origin) {
  const findings = [];
  const known = new Set([...knownUris, '', '/', '__home__']);
  for (const [pageId, { uri, html }] of htmlByPage) {
    if (!html) continue;
    const seen = new Set();
    for (const m of html.matchAll(/<a\s[^>]*href="([^"#?]+)/gi)) {
      let href = m[1];
      if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      if (/^https?:\/\//i.test(href)) {
        if (origin && !href.startsWith(origin)) continue; // external, checked separately
        href = href.slice(origin.length);
      }
      if (!href.startsWith('/')) continue;
      const target = href.replace(/^\/+|\/+$/g, '');
      if (!target || known.has(target) || seen.has(target)) continue;
      // Skip asset and framework paths; they are not content pages.
      if (/^(_nuxt|assets|cdn-cgi|api|actions|admin)\b/.test(target)) continue;
      if (/\.[a-z0-9]{2,5}$/i.test(target)) continue;
      seen.add(target);
      findings.push({
        pageId,
        page: uri,
        link: `/${target}`,
        issue: 'no page in the export has this URI — may be a front-end route',
      });
    }
  }
  return findings;
}

/** External links, deduplicated across the site, ready for a reachability check. */
export function collectExternalLinks(htmlByPage, origin) {
  const links = new Map();
  for (const [pageId, { uri, html }] of htmlByPage) {
    if (!html) continue;
    for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/gi)) {
      const url = m[1];
      if (origin && url.startsWith(origin)) continue;
      if (/\.(css|js|woff2?|png|jpe?g|svg|webp|ico)(\?|$)/i.test(url)) continue;
      if (!links.has(url)) links.set(url, new Set());
      links.get(url).add(uri ?? pageId);
    }
  }
  return links;
}

function excerpt(value, index = 0) {
  const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const at = Math.max(0, Math.min(index, text.length - 1) - 40);
  return (at > 0 ? '…' : '') + text.slice(at, at + 110) + (text.length > at + 110 ? '…' : '');
}
