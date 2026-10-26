// Working out what a site runs on, from the outside.
//
// One fetch of the homepage (headers, cookies, HTML), scored against signals per
// platform, then a few cheap probes to confirm. When the answer is not clear the
// caller asks the user — people know what their own site is built on, so a direct
// multiple-choice question beats guessing from weak clues.
//
// Signals are our own, not copied from Wappalyzer's GPL rule set.

import { SiteError } from './cli.mjs';
import { decodeEntities, cleanText } from './html.mjs';

const UA = 'Mozilla/5.0 (compatible; website-skill/0.2; +https://github.com/khevamann/castle-keys)';

/** The four platforms with dedicated support, plus the "other" fallback. */
export const SUPPORTED = ['craft', 'wordpress', 'shopify', 'squarespace'];

const h = (name, re) => (r) => re.test(r.headers[name] ?? '');
const body = (re) => (r) => re.test(r.html ?? '');
const cookie = (re) => (r) => re.test(r.cookies ?? '');

/** Weight 3 = decisive on its own; 1 = suggestive. */
export const SIGNALS = {
  craft: [
    { label: 'X-Powered-By: Craft CMS header', weight: 3, test: h('x-powered-by', /craft cms/i) },
    { label: 'Craft session or CSRF cookie', weight: 3, test: cookie(/CRAFT_CSRF_TOKEN|CraftSessionId/) },
    { label: 'Craft control-panel resources', weight: 2, test: body(/\/cpresources\//) },
    { label: 'Craft image transform paths', weight: 1, test: body(/\/_\d+x\d+_crop_/) },
  ],
  wordpress: [
    { label: 'REST API Link header (api.w.org)', weight: 3, test: h('link', /api\.w\.org/) },
    { label: 'REST API discovery link in HTML', weight: 3, test: body(/rel=["']https:\/\/api\.w\.org\/["']/) },
    { label: '/wp-content/ or /wp-includes/ assets', weight: 3, test: body(/\/wp-(content|includes)\//) },
    { label: 'WordPress generator meta', weight: 2, test: body(/<meta[^>]+generator[^>]+WordPress/i) },
    { label: 'X-Pingback header', weight: 1, test: h('x-pingback', /xmlrpc\.php/) },
  ],
  shopify: [
    { label: 'Shopify.theme object in page', weight: 3, test: body(/Shopify\.theme\s*=/) },
    { label: 'cdn.shopify.com assets', weight: 3, test: body(/cdn\.shopify\.com/) },
    { label: 'X-ShopId header', weight: 3, test: h('x-shopid', /\d/) },
    { label: 'Shopify cookies', weight: 2, test: cookie(/_shopify_[ys]=/) },
    { label: 'Powered-By: Shopify header', weight: 2, test: h('powered-by', /shopify/i) },
  ],
  squarespace: [
    { label: 'Static.SQUARESPACE_CONTEXT in page', weight: 3, test: body(/SQUARESPACE_CONTEXT/) },
    { label: 'Server: Squarespace header', weight: 3, test: h('server', /squarespace/i) },
    { label: 'Squarespace asset CDN', weight: 2, test: body(/static1\.squarespace\.com|images\.squarespace-cdn\.com/) },
  ],
};

/** Platforms we recognise by name but handle through the generic path. */
export const OTHER_SIGNALS = {
  Wix: [h('x-wix-request-id', /./), body(/<meta[^>]+generator[^>]+Wix\.com/i), body(/static\.parastorage\.com/)],
  Webflow: [body(/<meta[^>]+generator[^>]+Webflow/i), body(/data-wf-site=/)],
  Drupal: [h('x-generator', /drupal/i), h('x-drupal-cache', /./), body(/<meta[^>]+generator[^>]+Drupal/i)],
  Ghost: [body(/<meta[^>]+generator[^>]+Ghost/i), h('x-ghost-cache-status', /./)],
  'HubSpot CMS': [h('x-hs-hub-id', /./), body(/<meta[^>]+generator[^>]+HubSpot/i)],
  Framer: [body(/framerusercontent\.com/)],
  Joomla: [body(/<meta[^>]+generator[^>]+Joomla/i)],
};

/** Front-end frameworks: a site showing one of these and no CMS is probably headless. */
const FRAMEWORKS = {
  Nuxt: body(/window\.__NUXT__|\/_nuxt\//),
  'Next.js': body(/__NEXT_DATA__|\/_next\/static\//),
  Gatsby: body(/___gatsby/),
};

/** A bot-protection page rather than the site. */
export function isChallenge(r) {
  return (
    [403, 429, 503].includes(r.status) &&
    (/cf-mitigated|challenge/i.test(JSON.stringify(r.headers)) || /Just a moment|Attention Required|captcha/i.test(r.html ?? ''))
  );
}

/**
 * Score one homepage response. Pure: no network, so it can be tested offline.
 * Probe results, when available, add decisive evidence.
 */
export function scoreResponse(r, probes = {}) {
  const scores = {};
  const evidence = [];
  for (const [platform, signals] of Object.entries(SIGNALS)) {
    scores[platform] = 0;
    for (const s of signals) {
      if (s.test(r)) {
        scores[platform] += s.weight;
        evidence.push(`${platform}: ${s.label}`);
      }
    }
  }
  for (const [platform, probe] of Object.entries(probes)) {
    if (probe?.ok) {
      scores[platform] = (scores[platform] ?? 0) + 3;
      evidence.push(`${platform}: ${probe.label}`);
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  const runnerUp = ranked[1][1];

  const named = Object.entries(OTHER_SIGNALS).find(([, tests]) => tests.some((t) => t(r)))?.[0] ?? null;
  const framework = Object.entries(FRAMEWORKS).find(([, t]) => t(r))?.[0] ?? null;

  let platform = topScore > 0 ? top : 'other';
  let confidence =
    topScore >= 3 && topScore - runnerUp >= 2 ? 'high' : topScore >= 2 ? 'medium' : topScore > 0 ? 'low' : 'none';

  // A recognised non-supported platform with no supported-platform evidence is a
  // confident "other", which needs no question beyond a quick confirmation.
  if (named && topScore === 0) {
    platform = 'other';
    confidence = 'high';
    evidence.push(`other: looks like ${named}`);
  }

  return {
    platform,
    confidence,
    otherName: platform === 'other' ? named : null,
    headless: framework && topScore === 0 && !named ? { framework } : null,
    scores,
    evidence,
    blocked: isChallenge(r),
    ask: confidence !== 'high',
  };
}

// ----------------------------------------------------------------- network

/** GET a URL, returning what detection needs. Never throws for HTTP errors. */
export async function fetchPage(url, { timeout = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw new SiteError(`Could not reach ${url}\n${err.cause?.message ?? err.message}`);
  }
  const headers = {};
  res.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
  const cookies = (res.headers.getSetCookie?.() ?? []).join('\n');
  const html = await res.text().catch(() => '');
  return { url: res.url || url, status: res.status, headers, cookies, html };
}

async function probeJson(url, check, { method = 'GET', body: payload } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    return check(await res.json());
  } catch {
    return false;
  }
}

/**
 * Hosts that might serve a headless CMS for this front end: `cms.` variants of the
 * host, and any other host referenced in the page whose name says "cms". The
 * pattern `<site>.example.com` → `<site>.cms.example.com` is how Digistorm and
 * others split front end from CMS.
 */
export function candidateCmsHosts(pageUrl, html = '') {
  const host = new URL(pageUrl).host;
  const labels = host.split('.');
  const hosts = new Set([host]);
  if (labels.length >= 3) hosts.add([labels[0], 'cms', ...labels.slice(1)].join('.'));
  hosts.add(`cms.${host.replace(/^www\./, '')}`);
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]*\bcms\b[a-z0-9.-]*)/gi)) hosts.add(m[1].toLowerCase());
  return [...hosts].slice(0, 6);
}

const CRAFT_GRAPHQL_PATHS = ['/api', '/actions/graphql/api', '/admin/actions/graphql/api', '/index.php?action=graphql/api'];

/** Find a Craft GraphQL endpoint that answers anonymously. */
export async function findCraftGraphql(pageUrl, html) {
  const candidates = candidateCmsHosts(pageUrl, html).flatMap((host) =>
    CRAFT_GRAPHQL_PATHS.map((path) => `https://${host}${path}`),
  );
  const results = await Promise.all(
    candidates.map(async (url) => ((await probeJson(url, (j) => j?.data?.__typename === 'Query', {
      method: 'POST',
      body: { query: '{ __typename }' },
    })) ? url : null)),
  );
  return results.find(Boolean) ?? null;
}

/**
 * Detect the platform behind a URL. Returns the score report plus anything the
 * adapter will need later (e.g. Craft's GraphQL endpoint).
 */
export async function detect(input) {
  const url = /^https?:\/\//.test(input) ? input : `https://${input}`;
  const home = await fetchPage(url);
  const origin = new URL(home.url).origin;

  // Cheap confirmations. Each is a public, read-only request.
  const [wpJson, products, sqsJson, craftGraphql] = await Promise.all([
    probeJson(`${origin}/wp-json/`, (j) => Array.isArray(j?.namespaces)),
    probeJson(`${origin}/products.json`, (j) => Array.isArray(j?.products)),
    probeJson(`${origin}/?format=json-pretty`, (j) => Boolean(j?.website && j?.websiteSettings)),
    findCraftGraphql(home.url, home.html),
  ]);

  const result = scoreResponse(home, {
    wordpress: { ok: wpJson, label: '/wp-json/ answers with REST namespaces' },
    shopify: { ok: products, label: '/products.json answers' },
    squarespace: { ok: sqsJson, label: '?format=json returns Squarespace site data' },
    craft: { ok: Boolean(craftGraphql), label: `Craft GraphQL answers at ${craftGraphql}` },
  });

  return {
    input,
    url: origin,
    status: home.status,
    ...result,
    craftGraphql: craftGraphql ?? null,
    title: cleanText(decodeEntities(home.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')) || null,
  };
}
