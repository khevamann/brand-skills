// What platforms reveal about themselves in a public page, and the admin links built
// from it. Fixtures are trimmed from real pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteInfo, pageInfo } from '../core/platforminfo.mjs';

const SHOPIFY = `<script>Shopify.shop = "acme-store.myshopify.com";
Shopify.theme = {"name":"Acme\\/production","id":1234567,"schema_name":"Horizon","schema_version":"2.1.0","theme_store_id":null,"role":"main"};</script>
<script>var meta = {"page":{"pageType":"page","resourceType":"page","resourceId":98765}};</script>
<div id="shopify-section-template--1__main" class="shopify-section"></div>`;

test('Shopify: store, theme, and links to the page and the theme editor', () => {
  const site = siteInfo(SHOPIFY, 'shopify');
  assert.equal(site.storeHandle, 'acme-store');
  assert.deepEqual(site.theme, { name: 'Acme/production', id: 1234567, schema: 'Horizon', version: '2.1.0', role: 'main' });
  const page = pageInfo(SHOPIFY, 'https://acme.example/pages/about', 'shopify', site);
  assert.equal(page.type, 'page');
  assert.equal(page.id, 98765);
  assert.equal(page.editUrl.url, 'https://admin.shopify.com/store/acme-store/pages/98765');
  assert.equal(page.themeEditorUrl.url, 'https://admin.shopify.com/store/acme-store/themes/1234567/editor?previewPath=%2Fpages%2Fabout');
  assert.equal(page.editUrl.verified, false, 'unconfirmed until a real admin checks it');
});

test('WordPress: page id from the body class; Elementor pages open in Elementor', () => {
  const html = '<body class="page-template-default page page-id-42 wp-theme-astra elementor-page-42"><div data-elementor-type="wp-page"></div>';
  assert.equal(siteInfo(html, 'wordpress').builder, 'elementor');
  assert.equal(siteInfo(html, 'wordpress').theme, 'astra');
  const page = pageInfo(html, 'https://wp.example/about/', 'wordpress');
  assert.deepEqual([page.type, page.id], ['page', 42]);
  assert.equal(page.editUrl.url, 'https://wp.example/wp-admin/post.php?post=42&action=elementor');

  const post = pageInfo('<body class="single postid-7 wp-theme-x">', 'https://wp.example/hello/', 'wordpress');
  assert.equal(post.editUrl.url, 'https://wp.example/wp-admin/post.php?post=7&action=edit');
});

test('Squarespace: version and collection id from the page context', () => {
  const html = `<script>Static.SQUARESPACE_CONTEXT = {"templateVersion":"7.1","website":{"id":"w1"},"collection":{"id":"c1","typeName":"page"}};</script>`;
  assert.equal(siteInfo(html, 'squarespace').version, '7.1');
  const page = pageInfo(html, 'https://sqs.example/', 'squarespace');
  assert.deepEqual([page.type, page.id], ['page', 'c1']);
});

test('platforms without platform info return nothing', () => {
  assert.equal(siteInfo('<html></html>', 'other'), null);
  assert.equal(pageInfo('<html></html>', 'https://x.example/', 'other'), null);
});
