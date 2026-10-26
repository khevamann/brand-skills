// Finding pages politely: robots.txt hints, sitemaps, and page ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, parseSitemap, pageIdFor } from '../core/crawl.mjs';

test('robots.txt: sitemaps and crawl delay are read from the * group', () => {
  const robots = parseRobots([
    'User-agent: Googlebot', 'Crawl-delay: 9',
    '', 'User-agent: *', 'Disallow: /', 'Crawl-delay: 2',
    'Sitemap: https://example.com/sitemap_index.xml',
  ].join('\n'));
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap_index.xml']);
  assert.equal(robots.crawlDelay, 2);
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
