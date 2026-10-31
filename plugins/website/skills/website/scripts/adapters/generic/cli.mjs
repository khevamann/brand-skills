// Generic adapter — any website, read from the outside the way a visitor sees it.
//
// Pages come from the sitemap (or by following links), each page is split into
// blocks with copy fields, and the export shows what repeats across pages. It runs on
// every platform without dedicated scripts, using platform hints where the HTML
// carries them, and on Craft sites with no public API.
//
// Read-only: plain GET requests for public pages, nothing else.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { out, section, today, SiteError } from '../../core/cli.mjs';
import { projectPaths, recordState, PLATFORMS } from '../../core/project.mjs';
import { discoverPages, fetchPages, getText, pageIdFor, assertHtml } from '../../core/crawl.mjs';
import { segmentPage, normaliseText } from '../../core/segment.mjs';
import { parse, findAll, text } from '../../core/html.mjs';
import {
  findPlaceholders, findEmptyBlocks, findDuplicateCopy, findBrokenInternalLinks, collectExternalLinks,
  isReferencePage,
} from '../../core/audit.mjs';
import { extractTokens, extractTokensFromCss, extractClasses, groupClasses, styleStats } from '../../core/designsystem.mjs';
import { RADIUS, manifestConcerns, overallVerdict, exitCodeFor } from '../../core/scope.mjs';
import { siteInfo, pageInfo } from '../../core/platforminfo.mjs';
import { saveSite } from '../../core/project.mjs';
import { buildSharedIndex, sharedWith, platformRule, isPresentationField, sameTemplatePages, markLayout } from './shared.mjs';

let ctx = { project: null, site: null, paths: projectPaths('.') };

export const USAGE = `Commands for any website — read from the outside, no login needed

START
  site overview                      What the scripts can do here, and what is exported

FIND
  site pages [--limit n]             The site's pages, from its sitemap or by following links

READ
  site page <page>                   One page split into blocks, with each block's copy fields
      --raw                          Full JSON instead of text
      --chrome                       Include the header, footer and navigation
      --live                         Fetch now, even if the page is in the export
  site export [--limit n]            Every page to disk: blocks, rendered HTML, what repeats
      --delay <ms>                   Pause between requests (default 400, or robots.txt's)
  site blocks                        Block types seen across the export, and how often
  site design-system [--url URL]     Tokens, colours, fonts and classes → design/system/
  site audit [--links]               Placeholders, empty blocks, broken links, repeated copy
  site brief <page>                  A design brief for one page → design/brief-<id>.md
  site diff <page> <file.json|.html> What an edited result would change
  site scope <page> <manifest.json>  How far a change reaches. Exit 0 = one page, 3 = ask first

<page> is a URL, a path (/about) or an export id (about). Everything is read over
plain HTTP, the way a visitor sees the site. Nothing is changed.
`;

export const COMMANDS = [
  'overview', 'pages', 'page', 'export', 'blocks', 'design-system', 'audit', 'brief', 'diff', 'scope',
];

const platform = () => ctx.site?.platform ?? 'other';
const platformName = () => PLATFORMS[platform()] ?? 'Other';
const log = (line) => process.stderr.write(`${line}\n`);

function origin() {
  if (!ctx.site?.url) throw new SiteError('No site set up in this folder. Run `site start <url>` first.');
  return ctx.site.url;
}

// ----------------------------------------------------------------- corpus

const exportDir = (flags = {}) => (typeof flags.from === 'string' ? flags.from : ctx.paths.export);

function loadIndex(flags) {
  const file = join(exportDir(flags), 'index.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function loadCorpus(flags, { required = true } = {}) {
  const dir = exportDir(flags);
  const index = loadIndex(flags);
  if (!index) {
    if (!required) return null;
    throw new SiteError(`No export at ${dir}. Run \`site export\` first (a few minutes).`);
  }
  const corpus = [];
  const htmlByPage = new Map();
  for (const row of index.pages) {
    const file = join(dir, 'pages', `${row.id}.json`);
    if (!existsSync(file)) continue;
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    corpus.push(entry);
    const htmlFile = join(dir, 'pages', `${row.id}.html`);
    htmlByPage.set(row.id, { uri: entry.page.uri, html: existsSync(htmlFile) ? readFileSync(htmlFile, 'utf8') : null });
  }
  return { corpus, htmlByPage, index, dir };
}

function pageRecord(url, seg, httpStatus = 200) {
  const { pathname } = new URL(url);
  return {
    id: pageIdFor(url),
    url,
    uri: pathname.replace(/^\/+|\/+$/g, ''),
    path: pathname,
    title: seg?.title ?? '',
    status: 'live',
    httpStatus,
  };
}

/** Turn what the user typed into a URL on this site. */
function resolvePage(ref, index) {
  if (!ref) throw new SiteError('Name a page: a URL, a path like /about, or an export id.');
  if (/^https?:\/\//.test(ref)) return ref;
  if (ref.startsWith('/')) return origin() + ref;
  const row = index?.pages.find((p) => p.id === ref || p.uri === ref.replace(/^\/+|\/+$/g, ''));
  // An export id maps back to its path: `admissions--why-kirby` → /admissions/why-kirby.
  return row?.url ?? `${origin()}/${ref === 'home' ? '' : ref.replace(/--/g, '/')}`;
}

async function readLive(url) {
  const res = await getText(url);
  assertHtml(res);
  const seg = segmentPage(res.text, res.url, platform());
  const page = withPlatformInfo(pageRecord(res.url, seg, res.status), res.text);
  return { page, blocks: seg.blocks, chrome: seg.chrome, html: res.text, source: 'live' };
}

/** The platform's own facts about a page (its CMS id, admin links), when it shows any. */
function withPlatformInfo(page, html) {
  const site = ctx.site?.platformInfo ?? siteInfo(html, platform());
  const info = pageInfo(html, page.url, platform(), site);
  return info ? { ...page, platform: info } : page;
}

/** Record site-wide platform facts (theme, version, store) in site.json for later sessions. */
function rememberSiteInfo(html) {
  const info = siteInfo(html, platform());
  if (!info || !ctx.project) return info;
  ctx.project.site.platformInfo = info;
  ctx.site = ctx.project.site;
  saveSite(ctx.project);
  return info;
}

/** A page from the export when it is there (so it matches the shared index), else live. */
async function getPage(ref, flags) {
  const index = loadIndex(flags);
  const url = resolvePage(ref, index);
  if (!flags.live && index) {
    const id = pageIdFor(url);
    const file = join(exportDir(flags), 'pages', `${id}.json`);
    if (existsSync(file)) {
      const entry = JSON.parse(readFileSync(file, 'utf8'));
      return { ...entry, source: `export of ${index.exportedAt?.slice(0, 10) ?? 'unknown date'}` };
    }
  }
  return readLive(url);
}

const allBlocks = (entry) => [...entry.blocks, ...(entry.chrome ?? [])];
const copyFields = (block) => Object.entries(block).filter(([k, v]) => k.startsWith('text_') && typeof v === 'string');

// ---------------------------------------------------------------- commands

async function cmdOverview(flags) {
  const index = loadIndex(flags);
  const state = ctx.site?.state ?? {};
  const lines = [
    `SITE: ${origin()}  (${platformName()} — read from the outside)`,
    '',
    `Export: ${index ? `${index.pages.length} pages, ${index.exportedAt.slice(0, 10)}${index.total > index.pages.length ? ` (of ${index.total} found)` : ''}` : 'none yet'}`,
    `Last audit: ${state.lastAudit ? `${state.lastAudit.at.slice(0, 10)} — ${state.lastAudit.file}` : 'none yet'}`,
    '',
    'WHAT THE SCRIPTS CAN DO HERE',
    '  List and export every public page, split into blocks with their copy.',
    '  Audit: placeholder copy, empty blocks, pages that fail to load, broken links,',
    '  copy repeated across pages.',
    '  Extract the design system as published: CSS tokens, colours, fonts, classes.',
    '  Brief Claude Design on one page, then check what comes back and how far it reaches.',
    '',
    'WHAT THEY CANNOT',
    '  See drafts, hidden pages, or anything behind a login.',
    "  Know for certain what the CMS shares between pages. Anything that repeats across",
    '  pages is treated as shared, and needs a person to decide.',
    '  Change anything. Changes are made in the admin, as a draft, and a person publishes.',
    '',
    'START HERE',
    '  site export                 take a snapshot (a few minutes)',
    '  site audit --links          what needs attention',
    '  site page /about            read one page',
    '  site brief /about           prepare a design change',
    '',
    `Guide: references/platforms/${platform()}.md`,
  ];
  out(lines.join('\n'));
}

async function cmdPages(flags) {
  const limit = Number(flags.limit ?? 500);
  const found = await discoverPages(origin(), { limit, log });
  if (!found.pages.length) throw new SiteError(NOTHING_FOUND);
  out([
    `PAGES — ${found.total} found (${found.source === 'sitemap' ? 'from the sitemap' : 'by following links'})` +
      (found.total > found.pages.length ? `, showing ${found.pages.length}` : ''),
    '',
    ...found.pages.map((u) => `  ${pageIdFor(u).padEnd(36)} ${u}`),
  ].join('\n'));
}

async function cmdPage(ref, flags) {
  const entry = await getPage(ref, flags);
  if (flags.raw) return out(entry);
  const lines = [
    `# ${entry.page.title || entry.page.url}`,
    entry.page.url,
    `page ${entry.page.id} · ${entry.blocks.length} blocks · from ${entry.source}`,
    ...adminLinks(entry.page),
    '',
    '--- main content ---',
  ];
  const render = (b) => {
    lines.push(`[${b.__typename} ${b.id}]${b._parts?.length ? `  parts: ${b._parts.slice(0, 8).join(', ')}` : ''}`);
    for (const [k, v] of copyFields(b)) lines.push(`  ${k}: ${v.length > 300 ? `${v.slice(0, 300)} …` : v}`);
    if (b.images_Images) {
      const alt = (i) => (i.alt === null ? '(no alt text)' : i.alt === '' ? '(decorative, empty alt)' : `"${i.alt}"`);
      lines.push(`  images: ${b.images_Images.map(alt).join(', ')}`);
    }
    if (b.media_Embeds) lines.push(`  embeds: ${b.media_Embeds.map((e) => e.url).join(', ')}`);
  };
  entry.blocks.forEach(render);
  if (flags.chrome) {
    lines.push('', '--- header, footer, navigation (on every page) ---');
    (entry.chrome ?? []).forEach(render);
  } else if (entry.chrome?.length) {
    lines.push('', `(${entry.chrome.length} header/footer/navigation blocks hidden — pass --chrome)`);
  }
  out(lines.join('\n'));
}

/** Admin links for a page, marked when the link pattern has not been confirmed yet. */
function adminLinks(page) {
  const p = page.platform;
  if (!p) return [];
  const mark = (link) => `${link.url}${link.verified ? '' : '  (link pattern unconfirmed — see the platform checklist)'}`;
  return [
    p.type || p.id ? `in ${platformName()}: ${p.type ?? 'item'}${p.id ? ` ${p.id}` : ''}` : null,
    p.editUrl ? `edit in the admin: ${mark(p.editUrl)}` : null,
    p.themeEditorUrl ? `theme editor: ${mark(p.themeEditorUrl)}` : null,
  ].filter(Boolean);
}

async function cmdExport(flags) {
  const dir = flags.out ?? ctx.paths.export;
  mkdirSync(join(dir, 'pages'), { recursive: true });
  const limit = Number(flags.limit ?? 200);

  log(`Finding pages on ${origin()}…`);
  const found = await discoverPages(origin(), { limit, log });
  if (!found.pages.length) throw new SiteError(NOTHING_FOUND);
  const delayMs = Number(flags.delay ?? (found.robots.crawlDelay ? Math.min(found.robots.crawlDelay * 1000, 10000) : 400));
  log(`${found.total} pages found; exporting ${found.pages.length}, ${delayMs}ms apart.`);

  const failed = [];
  const seen = new Set();
  const corpus = [];
  await fetchPages(found.pages, {
    delayMs,
    onPage: (res, i) => {
      const prefix = `  [${i + 1}/${found.pages.length}]`;
      if (!res.ok || !/html/i.test(res.type)) {
        failed.push({ url: res.url, status: res.status || res.error });
        log(`${prefix} ${res.url} — ${res.status || res.error}`);
        return;
      }
      const seg = segmentPage(res.text, res.url, platform());
      if (i === 0) rememberSiteInfo(res.text);
      const page = withPlatformInfo(pageRecord(res.url, seg, res.status), res.text);
      if (seen.has(page.id)) return; // two sitemap entries redirecting to one page
      seen.add(page.id);
      corpus.push({ page, blocks: seg.blocks, chrome: seg.chrome, htmlBytes: res.text.length });
      writeFileSync(join(dir, 'pages', `${page.id}.html`), res.text);
      log(`${prefix} ${page.id} — ${seg.blocks.length} blocks`);
    },
  });

  // Only now, with every page in hand, can repeated layout be told apart from content.
  const layoutBlocks = markLayout(corpus);
  const rows = [];
  for (const { htmlBytes, ...entry } of corpus) {
    writeFileSync(join(dir, 'pages', `${entry.page.id}.json`), JSON.stringify(entry, null, 2));
    rows.push({
      ...entry.page,
      blocks: entry.blocks.length,
      blockTypes: [...new Set(entry.blocks.map((b) => b.__typename))].sort(),
      htmlBytes,
    });
  }
  for (const entry of corpus) delete entry.htmlBytes;

  const shared = sharedSummary(corpus);
  const index = {
    site: origin(),
    platform: platform(),
    exportedAt: new Date().toISOString(),
    source: found.source,
    total: found.total,
    pages: rows,
    failed,
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2));
  writeFileSync(join(dir, 'shared.json'), JSON.stringify(shared, null, 2));
  writeFileSync(join(dir, 'README.md'), corpusReadme(index, shared));
  if (ctx.project) {
    recordState(ctx.project, 'lastExport', { dir, pages: rows.length, found: found.total, failed: failed.length });
  }
  out({
    exported: dir,
    pages: rows.length,
    found: found.total,
    capped: found.total > found.pages.length ? `only the first ${found.pages.length}; pass --limit to export more` : undefined,
    failedToLoad: failed.length,
    blocks: rows.reduce((n, r) => n + r.blocks, 0),
    layoutBlocks: layoutBlocks ? `${layoutBlocks} blocks repeated on most pages were treated as site layout` : undefined,
    repeatedAcrossPages: shared.filter((s) => s.region === 'main').length,
    files: ['index.json', 'shared.json', 'README.md', 'pages/<id>.json', 'pages/<id>.html'],
  });
}

const NOTHING_FOUND =
  'No pages found: no sitemap, and no links could be followed from the homepage. ' +
  'Try `site page <url>` for individual pages, or read the site in the browser.';

/** Blocks that appear on more than one page, most widespread first. */
function sharedSummary(corpus) {
  const groups = new Map();
  for (const { page, blocks, chrome = [] } of corpus) {
    for (const b of [...blocks, ...chrome]) {
      const key = b._fingerprint;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { region: b._region, type: b.__typename, sample: b._text.slice(0, 120), pages: new Set() });
      groups.get(key).pages.add(page.id);
    }
  }
  return [...groups.values()]
    .filter((g) => g.pages.size > 1)
    .map((g) => ({ ...g, count: g.pages.size, pages: [...g.pages] }))
    .sort((a, b) => b.count - a.count);
}

function corpusReadme(index, shared) {
  const byType = {};
  for (const p of index.pages) for (const t of p.blockTypes) byType[t] = (byType[t] ?? 0) + 1;
  return `# Site export — ${index.site}

Generated by \`site export\` on ${index.exportedAt.slice(0, 10)}. A read-only snapshot of
the public site, as a visitor sees it.

- \`index.json\` — one row per page: id, url, title, block count, block types
- \`pages/<id>.json\` — the page split into blocks, with copy fields, images and links
- \`pages/<id>.html\` — the page as served
- \`shared.json\` — blocks that appear on more than one page

${index.pages.length} pages exported (${index.total} found ${index.source === 'sitemap' ? 'in the sitemap' : 'by following links'}).
${index.failed.length ? `${index.failed.length} failed to load: ${index.failed.slice(0, 5).map((f) => `${f.url} (${f.status})`).join(', ')}` : ''}

## Block types by how many pages use them

${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t} — ${n} pages`).join('\n')}

## Repeated across pages

${shared.filter((s) => s.region === 'main').slice(0, 15).map((s) => `- ${s.count} pages — ${s.type}: "${s.sample}"`).join('\n') || 'Nothing in the main content repeats.'}

## Caveats

- Only public pages. Drafts, hidden pages and anything behind a login are not here.
- Content drawn by JavaScript after the page loads may be missing from the HTML.
- A block that repeats may be one shared component or text pasted into each page; from
  the outside these look the same.
`;
}

async function cmdBlocks(flags) {
  const { corpus } = loadCorpus(flags);
  const types = new Map();
  const parts = new Map();
  for (const { page, blocks } of corpus) {
    for (const b of blocks) {
      if (!types.has(b.__typename)) types.set(b.__typename, { count: 0, pages: new Set(), fields: new Map(), example: null });
      const rec = types.get(b.__typename);
      rec.count += 1;
      rec.pages.add(page.id);
      for (const [k, v] of copyFields(b)) {
        const kind = k.replace(/\d+$/, '');
        rec.fields.set(kind, (rec.fields.get(kind) ?? 0) + 1);
        if (!rec.example && v.length > 20) rec.example = v.slice(0, 80);
      }
      for (const p of b._parts ?? []) parts.set(p, (parts.get(p) ?? 0) + 1);
    }
  }
  const report = [...types].map(([type, r]) => ({
    type, count: r.count, pages: r.pages.size, fields: Object.fromEntries(r.fields), example: r.example,
  })).sort((a, b) => b.count - a.count);
  if (flags.json) return out({ types: report, parts: Object.fromEntries(parts) });

  const lines = [`BLOCK TYPES — ${report.length} across ${corpus.length} pages`, ''];
  for (const r of report) {
    lines.push(`${r.type}  ×${r.count} on ${r.pages} page${r.pages === 1 ? '' : 's'}`);
    lines.push(`    copy: ${Object.entries(r.fields).map(([k, n]) => `${k.replace(/^text_/, '')}×${n}`).join(', ') || 'none'}`);
    if (r.example) lines.push(`    e.g. ${JSON.stringify(r.example)}`);
  }
  if (parts.size) {
    lines.push('', `PARTS INSIDE BLOCKS (${platformName()} block and widget types)`);
    for (const [p, n] of [...parts].sort((a, b) => b[1] - a[1]).slice(0, 40)) lines.push(`  ${p} ×${n}`);
  }
  lines.push(
    '',
    'These are inferred from the published pages, not read from the CMS. A design should',
    'reuse these patterns; anything new needs to be possible in the site\'s editor.',
  );
  out(saveBlocksReport(lines));
}

async function cmdDesignSystem(flags) {
  const dir = flags.out ?? join(ctx.paths.design, 'system');
  mkdirSync(dir, { recursive: true });
  const index = loadIndex(flags);
  const styleGuide = index?.pages.find((p) => isReferencePage(p));
  const sourceUrl = typeof flags.url === 'string' ? resolvePage(flags.url, index) : styleGuide?.url ?? `${origin()}/`;

  const res = await getText(sourceUrl);
  assertHtml(res);
  const html = res.text;
  const root = parse(html);

  // Linked stylesheets, wherever they are hosted — themes often serve CSS from a CDN.
  const hrefs = findAll(root, (n) => n.tag === 'link' && /stylesheet/i.test(n.attrs.rel ?? '') && n.attrs.href)
    .map((n) => new URL(n.attrs.href, res.url).href)
    .slice(0, 20);
  const sheets = [];
  for (const href of hrefs) {
    const css = await getText(href);
    if (css.ok && css.text.length < 3_000_000) sheets.push({ href, css: css.text });
  }
  const inline = findAll(root, (n) => n.tag === 'style').map((n) => n.children.map((c) => c.text ?? '').join('')).join('\n');
  const allCss = [inline, ...sheets.map((s) => s.css)].join('\n');

  const tokens = extractTokens(html);
  for (const { css } of sheets) {
    for (const [group, map] of extractTokensFromCss(css)) {
      if (!tokens.has(group)) tokens.set(group, new Map());
      for (const [k, v] of map) if (!tokens.get(group).has(k)) tokens.get(group).set(k, v);
    }
  }
  const stats = styleStats(allCss);
  const classes = extractClasses(html);
  const { groups } = groupClasses(classes);
  const vocabulary = index ? [...new Set(index.pages.flatMap((p) => p.blockTypes))].sort() : [];

  // A <base> tag lets the saved page load its CSS and images when opened locally.
  const saved = html.replace(/<head([^>]*)>/i, `<head$1><base href="${res.url}">`);
  writeFileSync(join(dir, 'style-guide.html'), saved);
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify(Object.fromEntries([...tokens].map(([g, m]) => [g, Object.fromEntries(m)])), null, 2));
  writeFileSync(join(dir, 'classes.json'), JSON.stringify(Object.fromEntries([...classes].sort((a, b) => b[1] - a[1])), null, 2));
  writeFileSync(join(dir, 'stats.json'), JSON.stringify(stats, null, 2));
  writeFileSync(join(dir, 'DESIGN-SYSTEM.md'), designSystemDoc({ url: res.url, tokens, stats, groups, classes, vocabulary, sheets }));

  out({
    written: dir,
    source: res.url,
    files: ['DESIGN-SYSTEM.md', 'tokens.json', 'classes.json', 'stats.json', 'style-guide.html'],
    stylesheets: sheets.length,
    tokenGroups: Object.fromEntries([...tokens].map(([g, m]) => [g, m.size])),
    topColours: stats.colours.slice(0, 6).map(([c]) => c),
    topFonts: stats.fonts.slice(0, 3).map(([f]) => f),
    next: 'Hand DESIGN-SYSTEM.md and style-guide.html to Claude Design. See references/design-handoff.md.',
  });
}

const PLATFORM_DESIGN_NOTES = {
  squarespace:
    'Squarespace sites take colour from a five-colour palette and ten section colour themes ' +
    '(the `theme:*` groups below). Those are the only colours a design can use without custom CSS. ' +
    'Fonts and button styles are set site-wide in Site Styles.',
  shopify:
    "Shopify themes take colour from the theme's colour schemes (the `scheme:*` groups below), " +
    'chosen per section. Fonts and spacing are theme settings, shared by every page.',
  wordpress:
    'WordPress block themes publish their presets as `--wp--preset--*` tokens; Elementor sites as ' +
    '`--e-global-*` tokens in the `elementor-kit` group. Prefer those over literal values.',
};

function designSystemDoc({ url, tokens, stats, groups, classes, vocabulary, sheets }) {
  const tokenSection = [...tokens].map(([group, map]) => {
    const rows = [...map].slice(0, 30).map(([k, v]) => `| \`${k}\` | \`${v.slice(0, 60)}\` |`).join('\n');
    return `### \`${group}\` (${map.size})\n\n| Token | Value |\n|---|---|\n${rows}${map.size > 30 ? `\n\n…and ${map.size - 30} more in \`tokens.json\`.` : ''}`;
  }).join('\n\n');
  const list = (pairs, n = 12) => pairs.slice(0, n).map(([v, c]) => `- \`${v}\` (${c}×)`).join('\n') || '- none found';

  return `# Design system — as published

Generated by \`site design-system\` from ${url}, using ${sheets.length} stylesheet${sheets.length === 1 ? '' : 's'}.
Read from the live site, so it shows what the site actually renders. Regenerate rather
than edit.

${PLATFORM_DESIGN_NOTES[platform()] ? `## ${platformName()}\n\n${PLATFORM_DESIGN_NOTES[platform()]}\n` : ''}
## Tokens

${tokens.size ? tokenSection : 'This site publishes no CSS custom properties. Use the most frequent values below instead, and match them exactly.'}

## Most used values

**Colours**

${list(stats.colours)}

**Font families**

${list(stats.fonts, 6)}

**Font sizes**

${list(stats.sizes)}

## Classes in use

${[...groups].filter(([, v]) => v.length).map(([prefix, l]) => `- \`${prefix}-*\`: ${l.slice(0, 10).map((c) => `\`${c.cls}\``).join(', ')}`).join('\n') || `${classes.size} classes; see \`classes.json\`.`}

## Block types on this site

${vocabulary.length ? vocabulary.map((t) => `- \`${t}\``).join('\n') : 'Run `site export` and regenerate to list them.'}

## Constraints a design must respect

1. Build from the block types above. Each must be something the site's editor can make;
   anything new needs the site's developers.
2. Use the tokens or the most-used values above, never new colours or fonts.
3. The header, footer and navigation are shared by every page. Leave them alone unless
   the change is meant for the whole site.
4. Return standalone HTML plus an edit manifest, as the brief describes.
`;
}

async function cmdAudit(flags) {
  const { corpus, htmlByPage, index, dir } = loadCorpus(flags);
  const site = origin();
  const knownUris = index.pages.map((p) => p.uri);
  const extraPatterns = ctx.site?.audit?.placeholders ?? [];

  const placeholders = findPlaceholders(corpus, null, {
    includeReferencePages: Boolean(flags['include-reference-pages']),
    extraPatterns,
  });
  const empties = findEmptyBlocks(corpus, null);
  const duplicates = findDuplicateCopy(corpus, 60, null);
  const unmatched = findBrokenInternalLinks(htmlByPage, knownUris, site);
  const noContent = corpus.filter((c) => c.blocks.length === 0);
  const missingAlt = corpus.flatMap(({ page, blocks }) =>
    blocks.flatMap((b) => (b.images_Images ?? []).filter((i) => i.alt === null).map((i) => ({ page: page.uri || '/', blockId: b.id, url: i.url }))),
  );

  let brokenInternal = null;
  let brokenExternal = null;
  if (flags.links) {
    brokenInternal = [];
    const unique = [...new Set(unmatched.map((f) => f.link))];
    log(`verifying ${unique.length} internal links…`);
    const statuses = new Map();
    for (const link of unique) statuses.set(link, await status(site + link));
    for (const f of unmatched) if (statuses.get(f.link) !== 200) brokenInternal.push({ ...f, status: statuses.get(f.link) });

    brokenExternal = [];
    const external = collectExternalLinks(htmlByPage, site);
    log(`checking ${external.size} external links…`);
    for (const [url, pages] of external) {
      const s = await status(url, 'HEAD');
      if (s !== 200 && !(typeof s === 'number' && s < 400)) brokenExternal.push({ url, status: s, pages: [...pages] });
    }
  }

  const findings = {
    pagesThatFailedToLoad: index.failed.length,
    placeholderCopy: placeholders.length,
    emptyBlocks: empties.length,
    pagesWithNoContent: noContent.length,
    imagesWithoutAltText: missingAlt.length,
    internalLinksNotInExport: unmatched.length,
    internalLinksActuallyBroken: brokenInternal ? brokenInternal.length : 'not checked (pass --links)',
    brokenExternalLinks: brokenExternal ? brokenExternal.length : 'not checked (pass --links)',
    repeatedCopyAcrossPages: duplicates.length,
  };
  if (flags.json) return out({ findings, placeholders, empties, duplicates, unmatched, brokenInternal, brokenExternal, missingAlt, failed: index.failed });

  const lines = [`CONTENT AUDIT — ${corpus.length} pages (export of ${index.exportedAt.slice(0, 10)}, ${dir})`, ''];
  section(lines, `PAGES THAT FAILED TO LOAD (${index.failed.length})`,
    index.failed.map((f) => `  ${f.status}  ${f.url}`),
    index.failed.length ? '  These are listed in the sitemap but did not load — broken or stale sitemap entries.' : null);
  section(lines, `PLACEHOLDER COPY (${placeholders.length})`, placeholders.map(
    (f) => `  ${f.page || '/'}  ${f.blockId} ${f.field}\n        ${f.issue}: ${f.excerpt}`,
  ));
  section(lines, `PAGES WITH NO CONTENT (${noContent.length})`, noContent.map((c) => `  ${c.page.url}`),
    noContent.length ? '  Nothing found in the main content. It may be drawn by JavaScript; check in the browser.' : null);
  section(lines, `EMPTY BLOCKS (${empties.length})`, empties.slice(0, 25).map((f) => `  ${f.page || '/'}  ${f.blockId} ${f.type}`),
    empties.length > 25 ? `  … and ${empties.length - 25} more` : null);
  section(lines, `IMAGES WITHOUT ALT TEXT (${missingAlt.length})`, missingAlt.slice(0, 15).map((f) => `  ${f.page}  ${f.blockId}  ${f.url.slice(0, 90)}`),
    missingAlt.length > 15 ? `  … and ${missingAlt.length - 15} more` : null);
  if (brokenInternal) {
    section(lines, `BROKEN INTERNAL LINKS (${brokenInternal.length} verified)`, brokenInternal.map((f) => `  ${f.status}  ${f.page || '/'} → ${f.link}`));
    section(lines, `UNREACHABLE EXTERNAL LINKS (${brokenExternal.length})`, brokenExternal.map(
      (f) => `  ${f.status}  ${f.url}\n        on: ${f.pages.slice(0, 4).join(', ')}`,
    ), brokenExternal.length ? '  Some sites refuse automated checks (403/405/429); open those by hand before calling them broken.' : null);
  } else {
    const unique = [...new Set(unmatched.map((f) => f.link))];
    section(lines, `INTERNAL LINKS TO PAGES NOT IN THE EXPORT (${unique.length})`, unique.slice(0, 20).map((l) => `  ${l}`),
      unique.length
        ? index.total > index.pages.length
          ? `  The export holds ${index.pages.length} of ${index.total} pages, so most of these are real pages outside it.\n  Pass --links to check which are actually broken.`
          : '  Some may be routes the sitemap does not list. Pass --links to check which are broken.'
        : null);
  }
  section(lines, `COPY REPEATED ACROSS PAGES (${duplicates.length})`, duplicates.slice(0, 12).map(
    (d) => `  ${d.pages} pages  ${JSON.stringify(d.value.slice(0, 80))}\n        ${d.uses.map((u) => `${u.page || '/'}#${u.blockId}`).slice(0, 6).join(', ')}`,
  ), duplicates.length ? '  Editing one copy makes the pages diverge. Treat these as shared.' : null);

  if (ctx.project) {
    mkdirSync(ctx.paths.audits, { recursive: true });
    const file = join(ctx.paths.audits, `${today()}${flags.links ? '-links' : ''}.txt`);
    writeFileSync(file, lines.join('\n') + '\n');
    recordState(ctx.project, 'lastAudit', { file, ...findings });
    lines.push(`Saved to ${file}`);
  }
  out(lines.join('\n'));
}

async function status(url, method = 'GET') {
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; website-skill)' },
      signal: AbortSignal.timeout(12000),
    });
    // Some servers refuse HEAD; ask again properly before calling a link broken.
    if (method === 'HEAD' && (res.status === 405 || res.status === 403)) return status(url, 'GET');
    return res.status;
  } catch (err) {
    return err.cause?.code ?? err.message;
  }
}

async function cmdBrief(ref, flags) {
  const entry = await getPage(ref, flags);
  const index = loadIndex(flags);
  const vocabulary = index ? [...new Set(index.pages.flatMap((p) => p.blockTypes))].sort() : [...new Set(entry.blocks.map((b) => b.__typename))];
  // What the editor's menus offer, written while exploring the admin. The site only shows
  // what is in use; a design may use anything the editor can add.
  const availableFile = join(ctx.paths.design, 'available-blocks.md');
  const available = existsSync(availableFile) ? readFileSync(availableFile, 'utf8') : null;
  const lines = [
    `# Design brief — ${entry.page.title || entry.page.url}`,
    '',
    `Page: ${entry.page.url}`,
    `Site: ${platformName()} · page id \`${entry.page.id}\` · read ${entry.source}`,
    '',
    '## Non-negotiable constraints',
    '',
    ...(available
      ? [
          "- **Build only from the blocks the site's editor offers**, listed under \"Blocks the editor",
          '  offers\". Those already on the site are listed after them; reuse their patterns where',
          "  they fit. Anything else needs the site's developers.",
        ]
      : [
          "- **Build from the block types this site already uses** (listed below). Every block has to",
          "  be something the site's editor can create; anything new needs the site's developers.",
          "  The full list of blocks the editor offers has not been captured yet, so stay with these.",
        ]),
    '- **Use the design system in `DESIGN-SYSTEM.md`** and the rendered `style-guide.html`.',
    '  Colours, fonts and spacing come from there, never new values.',
    '- **Leave the header, footer and navigation alone.** They are on every page.',
    ...(PLATFORM_DESIGN_NOTES[platform()] ? ['', PLATFORM_DESIGN_NOTES[platform()]] : []),
    '',
    ...(available ? ['## Blocks the editor offers', '', available.replace(/^# .*\n+/, '').trim(), ''] : []),
    '## Block types on this site',
    '',
    vocabulary.map((t) => `\`${t}\``).join(', '),
    '',
    '## The page as it stands',
    '',
    'Each block has a ref, and each piece of copy a field name. **Keep them** — they are how',
    'your changes get applied.',
    '',
  ];
  for (const b of entry.blocks) {
    lines.push(`- **\`${b.id}\`** \`${b.__typename}\`${b._parts?.length ? ` (contains: ${b._parts.slice(0, 6).join(', ')})` : ''}`);
    for (const [k, v] of copyFields(b)) lines.push(`  - \`${k}\`: ${JSON.stringify(v.length > 200 ? `${v.slice(0, 200)} …` : v)}`);
    if (b.images_Images) lines.push(`  - images: ${b.images_Images.slice(0, 4).map((i) => i.alt ? JSON.stringify(i.alt) : '(no alt)').join(', ')}`);
  }
  lines.push(
    '',
    '## How to return the result',
    '',
    'Return **both**:',
    '',
    '1. **Standalone HTML** of the edited page. On every element whose copy you changed, keep or',
    '   add `data-ck-ref="<block ref>"` and `data-ck-field="<field name>"` from the list above.',
    '2. **An edit manifest** in exactly this shape:',
    '',
    '```json',
    '{',
    `  "pageId": "${entry.page.id}",`,
    '  "edits": [',
    '    { "blockId": "<block ref>", "field": "<field name>", "value": "<new text>" }',
    '  ],',
    '  "newBlocks": [',
    '    { "afterBlockId": "<block ref>", "type": "<a block type listed above>", "content": "<what it holds>" }',
    '  ],',
    '  "unmapped": ["anything you changed that does not fit a field above"]',
    '}',
    '```',
    '',
    'Put anything structural — reordering, a new kind of section, a style change — in `unmapped`',
    'rather than forcing it into a field. A person will review it.',
  );

  const doc = lines.join('\n');
  const target = flags.out ?? join(ctx.paths.design, `brief-${entry.page.id}.md`);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, doc);
  out({ written: target, page: entry.page.title, blocks: entry.blocks.length, source: entry.source });
}

async function cmdDiff(ref, file, flags) {
  if (!file) throw new SiteError('Pass the edited file: `site diff <page> <file.json|file.html>`');
  const body = readFileSync(file, 'utf8');
  const entry = await getPage(ref, flags);
  const byId = new Map(allBlocks(entry).map((b) => [String(b.id), b]));

  if (file.endsWith('.json')) {
    const manifest = JSON.parse(body);
    const checks = (manifest.edits ?? []).map((edit) => {
      const block = byId.get(String(edit.blockId));
      if (!block) return { ok: false, ...edit, problem: 'no such block on this page' };
      const exists = typeof block[edit.field] === 'string';
      return {
        ok: exists,
        blockId: edit.blockId,
        type: block.__typename,
        field: edit.field,
        problem: exists ? undefined : `\`${edit.field}\` is not a copy field of ${edit.blockId}`,
        unchanged: exists && normaliseText(block[edit.field]) === normaliseText(edit.value) ? true : undefined,
        from: exists ? block[edit.field].slice(0, 160) : undefined,
        to: String(edit.value ?? '').slice(0, 160),
      };
    });
    return out({
      page: { id: entry.page.id, title: entry.page.title },
      pageMismatch: manifest.pageId && String(manifest.pageId) !== entry.page.id ? 'manifest targets a different page' : undefined,
      valid: checks.filter((c) => c.ok && !c.unchanged).length,
      problems: checks.filter((c) => !c.ok),
      noChange: checks.filter((c) => c.unchanged).length,
      edits: checks,
      newBlocks: manifest.newBlocks ?? [],
      unmapped: manifest.unmapped ?? [],
      note: 'Nothing has been applied. Apply in the site admin, as a draft, after `site scope` exits 0.',
    });
  }

  // HTML: read the tagged elements back into a manifest.
  const root = parse(body);
  const tagged = findAll(root, (n) => n.attrs['data-ck-ref'] && n.attrs['data-ck-field']);
  const edits = [];
  const problems = [];
  for (const el of tagged) {
    const blockId = el.attrs['data-ck-ref'];
    const field = el.attrs['data-ck-field'];
    const block = byId.get(blockId);
    if (!block || typeof block[field] !== 'string') {
      problems.push({ blockId, field, problem: block ? 'no such field on this block' : 'no such block on this page' });
      continue;
    }
    const value = text(el);
    if (normaliseText(value) !== normaliseText(block[field])) edits.push({ blockId, field, value, from: block[field] });
  }
  const refsInFile = new Set(tagged.map((el) => el.attrs['data-ck-ref']));
  out({
    page: { id: entry.page.id, title: entry.page.title },
    taggedElements: tagged.length,
    changed: edits.length,
    problems,
    blocksNotInFile: entry.blocks.filter((b) => !refsInFile.has(String(b.id))).map((b) => b.id),
    manifest: { pageId: entry.page.id, edits: edits.map(({ from, ...e }) => e), newBlocks: [], unmapped: [] },
    edits,
    note: tagged.length
      ? 'Save `manifest` as a .json file and run `site scope` on it. Untagged changes are not detected — check `blocksNotInFile` and the design itself.'
      : 'No data-ck-ref/data-ck-field tags found. Ask Claude Design for an edit manifest, or to keep the tags from the brief.',
  });
}

async function cmdScope(ref, file, flags) {
  if (!file) throw new SiteError('Usage: site scope <page> <manifest.json>');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const entry = await getPage(ref, flags);
  const byId = new Map(allBlocks(entry).map((b) => [String(b.id), b]));
  const exported = loadCorpus(flags, { required: false });
  const vocabulary = exported ? exported.index.pages.flatMap((p) => p.blockTypes) : null;
  const index = exported ? buildSharedIndex(exported.corpus) : null;

  const items = [...manifestConcerns(manifest, { knownTypes: vocabulary })];
  if (!index) {
    items.push({
      radius: RADIUS.NEEDS_CONFIRMATION,
      what: 'no export',
      why: 'Without an export there is nothing to compare against, so sharing with other pages cannot be ruled out. Run `site export`.',
    });
  }
  const name = (id) => exported?.index.pages.find((p) => p.id === id)?.uri || (id === 'home' ? '/' : id);

  for (const edit of manifest.edits ?? []) {
    const blockId = String(edit.blockId);
    const what = `${blockId} ${edit.field}`;
    const block = byId.get(blockId);
    if (!block) {
      items.push({ radius: RADIUS.NEEDS_CONFIRMATION, what, why: 'Not a block on this page. Re-read the page; the edit may target a different one.' });
      continue;
    }
    if (isPresentationField(edit.field)) {
      items.push({ radius: RADIUS.NEEDS_CONFIRMATION, what, why: `\`${edit.field}\` is a presentation setting, not copy. These are usually meant to match across the site.` });
      continue;
    }
    if (typeof block[edit.field] !== 'string') {
      items.push({ radius: RADIUS.NEEDS_CONFIRMATION, what, why: `\`${edit.field}\` is not a copy field of this block.` });
      continue;
    }
    const rule = platformRule(platform(), entry.page, block);
    if (rule && rule.radius !== RADIUS.PAGE) {
      const siblings = exported ? sameTemplatePages(exported.corpus, entry.page.id, block) : [];
      items.push({
        ...rule,
        what,
        why: siblings.length
          ? `${rule.why} In the export, ${siblings.length} other page${siblings.length === 1 ? '' : 's'} use this template: ${siblings.slice(0, 6).map(name).join(', ')}${siblings.length > 6 ? ', …' : ''}.`
          : rule.why,
        affectedPages: siblings.length ? siblings.map(name) : undefined,
      });
      continue;
    }
    if (index) {
      const { viaBlock, viaValue } = sharedWith(index, entry.page.id, block, edit.field);
      if (viaBlock.length) {
        items.push({
          radius: RADIUS.NEEDS_CONFIRMATION,
          what,
          why: `This block also appears on ${viaBlock.length} other page${viaBlock.length === 1 ? '' : 's'}: ` +
            `${viaBlock.slice(0, 6).map(name).join(', ')}${viaBlock.length > 6 ? ', …' : ''}. It may be one shared ` +
            'component (editing it changes them all) or pasted copies (editing one makes them differ).',
          affectedPages: viaBlock.map(name),
        });
        continue;
      }
      if (viaValue.length) {
        items.push({
          radius: RADIUS.NEEDS_CONFIRMATION,
          what,
          why: `The current text also appears on ${viaValue.length} other page${viaValue.length === 1 ? '' : 's'}: ` +
            `${viaValue.slice(0, 6).map(name).join(', ')}. Changing it here alone makes them differ.`,
          affectedPages: viaValue.map(name),
        });
        continue;
      }
    }
    items.push({ radius: RADIUS.PAGE, what, why: rule?.why ?? 'Copy in a block found only on this page.' });
  }

  const verdict = overallVerdict(items);
  const grouped = {
    page: items.filter((i) => i.radius === RADIUS.PAGE),
    needsConfirmation: items.filter((i) => i.radius === RADIUS.NEEDS_CONFIRMATION),
    notPossible: items.filter((i) => i.radius === RADIUS.NOT_POSSIBLE),
  };
  if (flags.json) {
    out({ page: { id: entry.page.id, title: entry.page.title }, verdict, ...grouped });
  } else {
    const lines = [`SCOPE — ${entry.page.title || entry.page.url} (${entry.page.id}, read ${entry.source})`, '', `VERDICT: ${verdict.toUpperCase()}`, ''];
    section(lines, `CONFINED TO THIS PAGE (${grouped.page.length})`, grouped.page.map((i) => `  ${i.what} — ${i.why}`));
    section(lines, `NEEDS YOUR CONFIRMATION (${grouped.needsConfirmation.length})`, grouped.needsConfirmation.map((i) => `  ${i.what}\n        ${i.why}`));
    section(lines, `NOT POSSIBLE (${grouped.notPossible.length})`, grouped.notPossible.map((i) => `  ${i.what}\n        ${i.why}`));
    lines.push(
      verdict === RADIUS.PAGE
        ? 'Everything is confined to this page. Safe to apply as a draft for review.'
        : 'Do not apply anything until a person confirms the items above. The single-page edits are fine on their own.',
    );
    out(lines.join('\n'));
  }
  process.exitCode = exitCodeFor(verdict);
}

// -------------------------------------------------------------------- run

export async function run(command, positional, flags, context = {}) {
  ctx = { project: null, site: null, paths: projectPaths('.'), ...context };
  switch (command) {
    case 'help':
      return out(USAGE);
    case 'overview':
      return cmdOverview(flags);
    case 'pages':
      return cmdPages(flags);
    case 'page':
      return cmdPage(positional[0], flags);
    case 'export':
      return cmdExport(flags);
    case 'blocks':
      return cmdBlocks(flags);
    case 'design-system':
      return cmdDesignSystem(flags);
    case 'audit':
      return cmdAudit(flags);
    case 'brief':
      return cmdBrief(positional[0], flags);
    case 'diff':
      return cmdDiff(positional[0], positional[1], flags);
    case 'scope':
      return cmdScope(positional[0], positional[1], flags);
    default:
      throw new SiteError(`Unknown command \`${command}\`.\n\n${USAGE}`);
  }
}

/** Keep the block report in the project, so later sessions have it without a rescan. */
function saveBlocksReport(lines) {
  if (!ctx.project) return lines.join('\n');
  mkdirSync(ctx.paths.design, { recursive: true });
  const file = join(ctx.paths.design, 'blocks.md');
  writeFileSync(file, `# Blocks — ${today()}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  return `${lines.join('\n')}\n\nSaved to design/blocks.md`;
}
