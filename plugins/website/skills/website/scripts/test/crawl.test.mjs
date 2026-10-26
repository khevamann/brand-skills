// Finding pages politely: robots.txt rules, sitemaps, and page ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, allowedByRobots, parseSitemap, pageIdFor } from '../core/crawl.mjs';

test('robots.txt: only the * group applies, and the longest rule wins', () => {
  const robots = parseRobots([
    'User-agent: Googlebot', 'Disallow: /',
    '', 'User-agent: *', 'Disallow: /cart', 'Disallow: /*?q=', 'Allow: /cart/share', 'Crawl-delay: 2',
    'Sitemap: https://example.com/sitemap_index.xml',
  ].join('\n'));
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap_index.xml']);
  assert.equal(robots.crawlDelay, 2);
  assert.equal(allowedByRobots(robots, '/about'), true);
  assert.equal(allowedByRobots(robots, '/cart'), false);
  assert.equal(allowedByRobots(robots, '/cart/share'), true);
  assert.equal(allowedByRobots(robots, '/search?q=x'), false);
});

test('robots.txt: a staging site that blocks everything blocks everything', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(allowedByRobots(robots, '/'), false);
  assert.equal(allowedByRobots(robots, '/about'), false);
});

test('sitemaps and sitemap indexes', () => {
  const index = parseSitemap('<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(index, { isIndex: true, locs: ['https://x.com/a.xml'] });
  const set = parseSitemap('<urlset><url><loc><![CDATA[ https://x.com/a?b=1&amp;c=2 ]]></loc></url></urlset>');
  assert.deepEqual(set.locs, ['https://x.com/a?b=1&c=2']);
});

test('page ids are readable, stable and safe as file names', () => {
  assert.equal(pageIdFor('https://x.com/'), 'home');
  assert.equal(pageIdFor('https://x.com/About%20Us/'), 'about--us');
  assert.equal(pageIdFor('https://x.com/admissions/why-us'), 'admissions--why-us');
  assert.equal(pageIdFor('https://x.com/a/b.html?page=2'), 'a--b--page-2');
});
