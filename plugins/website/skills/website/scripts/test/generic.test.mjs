// The generic adapter end to end, offline: a small export is written to a project
// folder from fixture HTML, then the real CLI reads it. These pin the scope gate's
// decisions, because a wrong "confined to this page" is the expensive mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initProject } from '../core/project.mjs';
import { segmentPage } from '../core/segment.mjs';
import { markLayout } from '../adapters/generic/shared.mjs';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'site.mjs');
const ORIGIN = 'https://shop.example';

const shell = (main) => `<html><head><title>Shop</title></head><body>
  <div id="shopify-section-sections--1__header" class="shopify-section"><header><a href="/">Shop</a><a href="/pages/about">About</a></header></div>
  <main id="MainContent">${main}</main>
  <div id="shopify-section-sections--2__footer" class="shopify-section"><footer><p>© Shop Example. Thanks for visiting, come back soon.</p></footer></div>
</body></html>`;

const PAGES = {
  '/': shell(`
    <div id="shopify-section-template--10__hero" class="shopify-section"><h1>Welcome to the shop</h1><p>Lorem ipsum dolor sit amet, placeholder text left over from the theme.</p></div>
    <div id="shopify-section-template--10__featured_collection" class="shopify-section"><a href="/products/mug">Mug</a><p>£10</p></div>`),
  '/pages/about': shell(`
    <div id="shopify-section-template--20__main" class="shopify-section"><h1>About us</h1><p>We started in a shed and we are still mostly in the shed.</p></div>
    <div id="shopify-section-template--20__banner" class="shopify-section"><h2>Free shipping over £50 on every single order we send out</h2></div>`),
  '/pages/faq': shell(`
    <div id="shopify-section-template--20__main" class="shopify-section"><h1>FAQ</h1><p>Questions people ask us, answered as plainly as we can manage.</p></div>
    <div id="shopify-section-template--20__banner" class="shopify-section"><h2>Free shipping over £50 on every single order we send out</h2></div>`),
};

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'site-generic-'));
  const p = initProject(dir, { url: ORIGIN, platform: 'shopify', confirmedBy: 'user' });
  mkdirSync(join(p.paths.export, 'pages'), { recursive: true });
  const corpus = Object.entries(PAGES).map(([path, html]) => {
    const seg = segmentPage(html, ORIGIN + path, 'shopify');
    const id = path === '/' ? 'home' : path.slice(1).replace(/\//g, '--');
    writeFileSync(join(p.paths.export, 'pages', `${id}.html`), html);
    return { page: { id, url: ORIGIN + path, uri: path.replace(/^\/|\/$/g, ''), path, title: seg.title, status: 'live' }, blocks: seg.blocks, chrome: seg.chrome };
  });
  markLayout(corpus);
  for (const entry of corpus) writeFileSync(join(p.paths.export, 'pages', `${entry.page.id}.json`), JSON.stringify(entry));
  writeFileSync(join(p.paths.export, 'index.json'), JSON.stringify({
    site: ORIGIN, platform: 'shopify', exportedAt: '2026-10-26T00:00:00Z', source: 'sitemap', total: 3, failed: [],
    pages: corpus.map(({ page, blocks }) => ({ ...page, blocks: blocks.length, blockTypes: [...new Set(blocks.map((b) => b.__typename))] })),
  }));
  return dir;
}

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
}

async function scope(cwd, page, edits) {
  writeFileSync(join(cwd, 'm.json'), JSON.stringify({ pageId: page, edits }));
  return run(cwd, ['scope', page, 'm.json']);
}

test('a Shopify project is served by the generic adapter', async () => {
  const dir = project();
  const { code, stdout } = await run(dir, ['page', 'home']);
  assert.equal(code, 0);
  assert.match(stdout, /\[hero template--10__hero\]/);
  assert.match(stdout, /text_Heading1: Welcome to the shop/);
});

test('homepage copy is confined to the page: exit 0', async () => {
  const { code, stdout } = await scope(project(), 'home', [{ blockId: 'template--10__hero', field: 'text_Heading1', value: 'Hello' }]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /VERDICT: PAGE/);
});

test('a section group (header) is site-wide: exit 3', async () => {
  const { code, stdout } = await scope(project(), 'home', [{ blockId: 'sections--1__header', field: 'text_Link1', value: 'Store' }]);
  assert.equal(code, 3);
  assert.match(stdout, /every page/);
});

test('a template section on a page names the other pages using that template: exit 3', async () => {
  const { code, stdout } = await scope(project(), 'pages--about', [{ blockId: 'template--20__banner', field: 'text_Heading1', value: 'Free shipping' }]);
  assert.equal(code, 3);
  assert.match(stdout, /template/);
  assert.match(stdout, /pages\/faq/);
});

test('a product listing is not the page’s own copy: exit 3', async () => {
  const { code, stdout } = await scope(project(), 'home', [{ blockId: 'template--10__featured_collection', field: 'text_Link1', value: 'Cup' }]);
  assert.equal(code, 3);
  assert.match(stdout, /lists products/);
});

test('presentation settings and unknown blocks need a person: exit 3', async () => {
  const dir = project();
  let r = await scope(dir, 'home', [{ blockId: 'template--10__hero', field: 'colorScheme', value: 'scheme-2' }]);
  assert.equal(r.code, 3);
  assert.match(r.stdout, /presentation setting/);
  r = await scope(dir, 'home', [{ blockId: 'nope', field: 'text_Heading1', value: 'x' }]);
  assert.equal(r.code, 3);
  assert.match(r.stdout, /Not a block on this page/);
});

test('the audit runs offline from the export and is saved to the project', async () => {
  const dir = project();
  const { code, stdout } = await run(dir, ['audit']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /PLACEHOLDER COPY \(1\)/);
  assert.match(stdout, /lorem ipsum/i);
  assert.equal(readdirSync(join(dir, 'audits')).length, 1);
  assert.ok(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')).state.lastAudit);
});

test('diff reads tagged HTML back into a manifest', async () => {
  const dir = project();
  writeFileSync(join(dir, 'result.html'), '<h1 data-ck-ref="template--10__hero" data-ck-field="text_Heading1">Hello there</h1>');
  const { code, stdout } = await run(dir, ['diff', 'home', 'result.html']);
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.deepEqual(out.manifest.edits, [{ blockId: 'template--10__hero', field: 'text_Heading1', value: 'Hello there' }]);
});

test('blocks repeated on most pages become site layout', () => {
  const block = (fp) => ({ __typename: 'div', id: fp, _fingerprint: fp, _region: 'main', _text: '' });
  const corpus = ['a', 'b', 'c', 'd'].map((id) => ({ page: { id }, blocks: [block('nav'), block(`own-${id}`)], chrome: [] }));
  assert.equal(markLayout(corpus), 4);
  assert.deepEqual(corpus[0].blocks.map((b) => b.id), ['own-a']);
  assert.equal(corpus[0].chrome[0]._region, 'layout');
});

test('blocks saves its report to the project, so later sessions have it', async () => {
  const dir = project();
  const { code, stdout } = await run(dir, ['blocks']);
  assert.equal(code, 0, stdout);
  const saved = readFileSync(join(dir, 'design', 'blocks.md'), 'utf8');
  assert.match(saved, /BLOCK TYPES/);
  assert.match(stdout, /Saved to design\/blocks\.md/);
});

test('the brief offers every block the editor has, once that list has been captured', async () => {
  const dir = project();
  let r = await run(dir, ['brief', 'home']);
  assert.equal(r.code, 0, r.stderr);
  const brief = () => readFileSync(join(dir, 'design', readdirSync(join(dir, 'design')).find((f) => f.startsWith('brief-'))), 'utf8');
  assert.match(brief(), /not been captured yet/);

  writeFileSync(join(dir, 'design', 'available-blocks.md'), '# Available blocks\n\n- Gallery: carousel, grid\n- Accordion\n');
  r = await run(dir, ['brief', 'home']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(brief(), /## Blocks the editor offers[\s\S]*Gallery: carousel, grid/);
  assert.doesNotMatch(brief(), /not been captured yet/);
});
