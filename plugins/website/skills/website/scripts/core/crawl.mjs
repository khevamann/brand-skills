// Finding a site's pages from the outside, politely.
//
// robots.txt → its Sitemap: lines → sitemap.xml and sitemap indexes. Only when there
// is no sitemap, follow links from the homepage. One request at a time, with a pause
// between them, a capped page count, and robots.txt Disallow rules respected.

import { SiteError } from './cli.mjs';
import { parse, findAll } from './html.mjs';

export const UA = 'Mozilla/5.0 (compatible; website-skill/0.3; +https://github.com/khevamann/castle-keys)';

const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|json|xml|txt|zip|mp4|mp3|mov|docx?|xlsx?|pptx?|md|rss|atom)(\?|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch text, never throwing for HTTP status. */
export async function getText(url, { timeout = 20000, accept } = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
    return { url: res.url || url, status: res.status, ok: res.ok, type: res.headers.get('content-type') ?? '', text: await res.text() };
  } catch (err) {
    return { url, status: 0, ok: false, type: '', text: '', error: err.cause?.message ?? err.message };
  }
}

/** robots.txt rules for `*`, plus its sitemaps and crawl delay. */
export function parseRobots(text) {
  const sitemaps = [];
  const disallow = [];
  const allow = [];
  let crawlDelay = null;
  let applies = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      // Consecutive User-agent lines form one group.
      applies = (lastWasAgent && applies) || value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies) continue;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
    if (key === 'crawl-delay' && Number(value) > 0) crawlDelay = Number(value);
  }
  return { sitemaps, disallow, allow, crawlDelay };
}

const ruleMatches = (rule, path) => {
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
};

/** Longest matching rule wins, as robots.txt specifies. */
export function allowedByRobots(robots, path) {
  const best = (rules) => Math.max(-1, ...rules.filter((r) => ruleMatches(r, path)).map((r) => r.length));
  return best(robots.allow) >= best(robots.disallow);
}

/** <loc> entries from a sitemap or sitemap index. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&'),
  );
  return { isIndex: /<sitemapindex/i.test(xml), locs };
}

/**
 * Order matters when the page cap bites: content pages before product listings,
 * shallow paths before deep ones, and the homepage first.
 */
function priority(url) {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') return -1;
  let score = path.split('/').filter(Boolean).length;
  if (/\/(products?|collections?|shop|store|tag|tags|category|categories|author|page\/\d+)\//i.test(path)) score += 5;
  return score;
}

/**
 * Discover a site's pages. Returns { pages: [url], source, total, blockedByRobots, robots }.
 * `limit` caps how many are returned; `total` says how many were found and allowed.
 * `ignoreRobots` is for a site owner reading their own site — staging sites often
 * disallow everything — and must only ever be set on their explicit say-so.
 */
export async function discoverPages(origin, { limit = 200, log = () => {}, ignoreRobots = false } = {}) {
  const host = new URL(origin).host;
  const sameSite = (u) => {
    try {
      const url = new URL(u, origin);
      return url.host === host && /^https?:$/.test(url.protocol);
    } catch {
      return false;
    }
  };
  const normalise = (u) => {
    const url = new URL(u, origin);
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  };

  const robotsRes = await getText(`${origin}/robots.txt`);
  const robots = robotsRes.ok && !/<html/i.test(robotsRes.text.slice(0, 500))
    ? parseRobots(robotsRes.text)
    : parseRobots('');
  const permitted = (u) => ignoreRobots || allowedByRobots(robots, new URL(u).pathname + new URL(u).search);

  // Sitemaps declared in robots.txt, else the conventional locations until one works.
  const found = new Set();
  const seenMaps = new Set();
  const readMaps = async (start) => {
    const queue = [...start];
    while (queue.length && seenMaps.size < 60) {
      const map = queue.shift();
      if (seenMaps.has(map)) continue;
      seenMaps.add(map);
      const res = await getText(map, { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1' });
      if (!res.ok || !/<(urlset|sitemapindex)/i.test(res.text)) continue;
      const { isIndex, locs } = parseSitemap(res.text);
      log(`  sitemap ${map}: ${locs.length} ${isIndex ? 'sitemaps' : 'urls'}`);
      if (isIndex) {
        // Pages sitemaps before product ones, so content wins when the cap bites.
        queue.push(...locs.sort((x, y) => /product/i.test(x) - /product/i.test(y)));
      } else {
        for (const loc of locs) if (sameSite(loc) && !NOT_A_PAGE.test(loc)) found.add(normalise(loc));
      }
    }
  };
  await readMaps(robots.sitemaps);
  for (const map of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`]) {
    if (found.size) break;
    await readMaps([map]);
  }

  let source = 'sitemap';
  if (!found.size) {
    source = 'links';
    log('  no sitemap; following links from the homepage');
    const frontier = [normalise(origin + '/')];
    const visited = new Set();
    while (frontier.length && visited.size < Math.min(limit, 60)) {
      const url = frontier.shift();
      if (visited.has(url) || !permitted(url)) continue;
      visited.add(url);
      found.add(url);
      const res = await getText(url);
      if (!res.ok || !/html/i.test(res.type)) continue;
      for (const a of findAll(parse(res.text), (n) => n.tag === 'a' && n.attrs.href)) {
        const href = a.attrs.href;
        if (!sameSite(href) || NOT_A_PAGE.test(href) || /^(mailto|tel|javascript):/i.test(href)) continue;
        const next = normalise(href);
        if (!visited.has(next)) frontier.push(next);
      }
      await sleep(300);
    }
  }

  const all = [...found].filter(permitted);
  const pages = all.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).slice(0, limit);
  const home = normalise(origin + '/');
  if (!pages.includes(home) && permitted(home)) {
    pages.unshift(home);
    if (pages.length > limit) pages.pop();
  }
  return { pages, source, total: all.length, blockedByRobots: found.size - all.length, robots };
}

/** A page id that is readable, stable, and safe as a file name. */
export function pageIdFor(url) {
  const { pathname, search } = new URL(url);
  const slug = decodeURIComponent(pathname)
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '--')
    .toLowerCase();
  const query = search ? `--${search.slice(1).replace(/[^a-zA-Z0-9]+/g, '-')}` : '';
  return (slug || 'home') + query;
}

/** Fetch pages one at a time, pausing between requests. */
export async function fetchPages(urls, { delayMs = 400, onPage = () => {} } = {}) {
  const results = [];
  for (const [i, url] of urls.entries()) {
    const res = await getText(url);
    results.push(res);
    onPage(res, i);
    if (i < urls.length - 1) await sleep(delayMs);
  }
  return results;
}

export function assertHtml(res) {
  if (!res.ok) throw new SiteError(`Could not fetch ${res.url}: ${res.error ?? `HTTP ${res.status}`}`);
  if (!/html/i.test(res.type) && !/<html/i.test(res.text.slice(0, 1000))) {
    throw new SiteError(`${res.url} is not an HTML page (${res.type || 'unknown type'}).`);
  }
}
