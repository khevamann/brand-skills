// Detection scoring, offline, against trimmed-down homepage responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResponse, candidateCmsHosts } from '../core/detect.mjs';

const page = ({ html = '<html></html>', headers = {}, cookies = '', status = 200 } = {}) => ({
  url: 'https://example.com/', status, headers, cookies, html,
});

test('WordPress from its REST discovery header and asset paths', () => {
  const r = scoreResponse(page({
    headers: { link: '<https://example.com/wp-json/>; rel="https://api.w.org/"' },
    html: '<link rel="stylesheet" href="/wp-content/themes/x/style.css">',
  }));
  assert.equal(r.platform, 'wordpress');
  assert.equal(r.confidence, 'high');
  assert.equal(r.ask, false);
});

test('Shopify from the theme object and CDN', () => {
  const r = scoreResponse(page({
    html: '<script>Shopify.theme = {"name":"Horizon"};</script><script src="//cdn.shopify.com/s/x.js"></script>',
  }));
  assert.equal(r.platform, 'shopify');
  assert.equal(r.confidence, 'high');
});

test('Squarespace from its context object', () => {
  const r = scoreResponse(page({ html: '<script>Static.SQUARESPACE_CONTEXT = {};</script>' }));
  assert.equal(r.platform, 'squarespace');
});

test('Craft from its CSRF cookie', () => {
  const r = scoreResponse(page({ cookies: 'CRAFT_CSRF_TOKEN=abc; Path=/' }));
  assert.equal(r.platform, 'craft');
});

test('a headless front end with no CMS signal asks, and says it looks headless', () => {
  const r = scoreResponse(page({ html: '<script>window.__NUXT__={}</script>' }));
  assert.equal(r.platform, 'other');
  assert.equal(r.confidence, 'none');
  assert.equal(r.ask, true);
  assert.deepEqual(r.headless, { framework: 'Nuxt' });
});

test('a headless Craft site is confirmed by its GraphQL probe', () => {
  const r = scoreResponse(page({ html: '<script>window.__NUXT__={}</script>' }), {
    craft: { ok: true, label: 'Craft GraphQL answers' },
  });
  assert.equal(r.platform, 'craft');
  assert.equal(r.confidence, 'high');
  assert.equal(r.headless, null);
});

test('a recognised other platform is named rather than asked about', () => {
  const r = scoreResponse(page({ html: '<meta name="generator" content="Wix.com Website Builder">' }));
  assert.equal(r.platform, 'other');
  assert.equal(r.otherName, 'Wix');
  assert.equal(r.ask, false);
});

test('one weak signal is not enough to skip asking', () => {
  const r = scoreResponse(page({ headers: { 'x-pingback': 'https://example.com/xmlrpc.php' } }));
  assert.equal(r.platform, 'wordpress');
  assert.equal(r.ask, true);
});

test('conflicting strong signals lower confidence', () => {
  const r = scoreResponse(page({
    html: '<script src="//cdn.shopify.com/x.js"></script><link href="/wp-content/x.css">',
  }));
  assert.notEqual(r.confidence, 'high');
  assert.equal(r.ask, true);
});

test('a bot-protection page is flagged', () => {
  const r = scoreResponse(page({ status: 403, html: '<title>Just a moment...</title>' }));
  assert.equal(r.blocked, true);
});

test('CMS host candidates include the split-host pattern used by headless Craft', () => {
  const hosts = candidateCmsHosts('https://client-site.agencyhosting.com/', '<img src="https://img.cms.other.net/a.jpg">');
  assert.ok(hosts.includes('client-site.agencyhosting.com'));
  assert.ok(hosts.includes('client-site.cms.agencyhosting.com'));
  assert.ok(hosts.includes('img.cms.other.net'));
});
