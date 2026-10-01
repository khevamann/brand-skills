import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyValues, findPlaceholders, findEmptyBlocks, findDuplicateCopy } from '../lib/audit.mjs';

const page = (id, uri) => ({ id, uri, title: uri, status: 'live' });

test('copyValues picks out copy and ignores settings and plumbing', () => {
  const block = {
    __typename: 'ds_TileLayoutBlock_Entry',
    id: '1',
    _depth: 0,
    tile_Heading: 'Intellectual Vitality and all that it entails for students',
    tile_ColorTheme: 'default',
    sortOrder: 2,
    notAFieldHandle: 'some long sentence that should be ignored entirely',
  };
  assert.deepEqual(copyValues(block).map((c) => c.field), ['tile_Heading']);
});

test('placeholder copy is found and attributed to a block and field', () => {
  const corpus = [{
    page: page('1', 'home'),
    blocks: [{ __typename: 'ds_RichTextBlock_Entry', id: '9', richText_Text: '<p>Lorem ipsum dolor sit amet, consectetur.</p>' }],
  }];
  const found = findPlaceholders(corpus);
  assert.equal(found.length, 1);
  assert.equal(found[0].blockId, '9');
  assert.equal(found[0].field, 'richText_Text');
  assert.match(found[0].issue, /lorem ipsum/i);
});

test('a block holding only an image, link or table is not reported as empty', () => {
  const corpus = [{
    page: page('1', 'home'),
    blocks: [
      { __typename: 'ds_ImageLayoutBlock_Entry', id: '2', image_Image: [{ id: '5', url: 'x.jpg' }] },
      { __typename: 'ds_LinksLayoutBlock_Entry', id: '3', links_Links: [{ linkUrl: '/apply' }] },
      { __typename: 'ds_TableBlock_Entry', id: '4', table_Table: { rows: [['a', 'b']] } },
      { __typename: 'ds_InternalPageBannerDefault_Entry', id: '5' },
    ],
  }];
  // Only the banner with nothing at all in it is a finding.
  assert.deepEqual(findEmptyBlocks(corpus).map((e) => e.blockId), ['5']);
});

test('revision history does not make a block look populated', () => {
  const corpus = [{
    page: page('1', 'home'),
    blocks: [{ __typename: 'ds_RichTextBlock_Entry', id: '1', revisions: [{ id: '9' }] }],
  }];
  assert.deepEqual(findEmptyBlocks(corpus).map((e) => e.blockId), ['1']);
});

test('repeated copy is reported only when it spans pages', () => {
  const shared = 'Ready to take the next step? Get in touch with our admissions team today.';
  const corpus = [
    { page: page('1', 'a'), blocks: [{ __typename: 'T', id: '1', richText_Text: shared }] },
    { page: page('2', 'b'), blocks: [{ __typename: 'T', id: '2', richText_Text: shared }] },
    { page: page('3', 'c'), blocks: [{ __typename: 'T', id: '3', richText_Text: 'Something else entirely, unique to this page alone.' }] },
  ];
  const dupes = findDuplicateCopy(corpus);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].pages, 2);
});

test('the same value twice on one page is not cross-page repetition', () => {
  const v = 'Ready to take the next step? Get in touch with our admissions team today.';
  const corpus = [{
    page: page('1', 'a'),
    blocks: [{ __typename: 'T', id: '1', richText_Text: v }, { __typename: 'T', id: '2', richText_Text: v }],
  }];
  assert.deepEqual(findDuplicateCopy(corpus), []);
});

test('listing and structural blocks are not reported as empty', () => {
  const corpus = [{
    page: page('1', 'home'),
    blocks: [
      { __typename: 'ds_NewsLayoutBlock_Entry', id: '1' },
      { __typename: 'ds_EventsLayoutBlock_Entry', id: '2' },
      { __typename: 'ds_EventsListingBlock_Entry', id: '3' },
      { __typename: 'ds_SpacerLayoutBlock_Entry', id: '4' },
      { __typename: 'ds_DividerBlock_Entry', id: '5' },
      { __typename: 'ds_FormBlock_Entry', id: '6' },
      { __typename: 'ds_RichTextBlock_Entry', id: '7' },
    ],
  }];
  // Only the rich text block holding nothing is a real finding.
  assert.deepEqual(findEmptyBlocks(corpus).map((e) => e.blockId), ['7']);
});

test('resource hints are not treated as links', async () => {
  const { collectExternalLinks, findBrokenInternalLinks } = await import('../lib/audit.mjs');
  const html = `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="/assets/app.css">
    <a href="https://example.com/real">real external</a>
    <a href="/about">real internal</a>
    <a href="/missing-page">broken internal</a>
  `;
  const byPage = new Map([['1', { uri: 'home', html }]]);

  const external = collectExternalLinks(byPage, 'https://site.test');
  assert.deepEqual([...external.keys()], ['https://example.com/real']);

  const internal = findBrokenInternalLinks(byPage, ['about'], 'https://site.test');
  assert.deepEqual(internal.map((f) => f.link), ['/missing-page']);
});

test('component demo pages are excluded from placeholder findings by default', async () => {
  const { isReferencePage } = await import('../lib/audit.mjs');
  assert.equal(isReferencePage({ title: 'Style Guide', uri: 'style-guide' }), true);
  assert.equal(isReferencePage({ title: 'Why Kirby?', uri: 'admissions/why-kirby' }), false);

  const lorem = { __typename: 'ds_RichTextBlock_Entry', id: '1', richText_Text: '<p>Lorem ipsum dolor sit.</p>' };
  const corpus = [
    { page: { ...page('1', 'style-guide'), title: 'Style Guide' }, blocks: [lorem] },
    { page: page('2', 'admissions/why-kirby'), blocks: [lorem] },
  ];
  assert.deepEqual(findPlaceholders(corpus).map((f) => f.pageId), ['2']);
  assert.equal(findPlaceholders(corpus, null, { includeReferencePages: true }).length, 2);
});
