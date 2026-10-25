import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADIUS, manifestConcerns, overallVerdict, exitCodeFor } from '../core/scope.mjs';
import { classifyByName, profileFromCorpus, classifyField, COPY, PRESENTATION } from '../core/fields.mjs';

test('field names alone classify copy vs presentation correctly', () => {
  for (const field of [
    'richText_Text', 'tile_Heading', 'tile_Subheading', 'tile_TextOnHover',
    'accordionItem_BodyContent', 'form_Heading', 'embed_Code', 'quoteItem_Text',
  ]) {
    assert.equal(classifyByName(field), COPY, `${field} should be copy`);
  }
  for (const field of [
    'layout_SpaceBetween', 'tile_ColorTheme', 'tile_ColorPalette', 'tile_HeadingSize',
    'richText_ButtonAlignment', 'events_CardStyle', 'gallery_GalleryType',
    'divider_LineWeight', 'events_ShowTopLabel', 'images_ImagesPerRow',
    'events_ImageAspectRatio', 'tile_TextPosition', 'richText_ContainerWidth',
  ]) {
    assert.equal(classifyByName(field), PRESENTATION, `${field} should be presentation`);
  }
});

test('a corpus profile overrides the name rule using real value spread', () => {
  // A field whose values repeat from a tiny set is a setting, whatever it is called.
  const corpus = [{
    page: { id: '1' },
    blocks: Array.from({ length: 8 }, (_, i) => ({
      __typename: 'T', id: String(i), odd_Name: i % 2 ? 'md' : 'lg',
    })),
  }];
  const profile = profileFromCorpus(corpus);
  assert.equal(classifyField('T', 'odd_Name', profile), PRESENTATION);

  // A field that differs nearly every time is copy, whatever it is called.
  const varied = [{
    page: { id: '1' },
    blocks: Array.from({ length: 8 }, (_, i) => ({
      __typename: 'T', id: String(i), tile_Size: `A distinct sentence number ${i} of real copy`,
    })),
  }];
  assert.equal(classifyField('T', 'tile_Size', profileFromCorpus(varied)), COPY);
});

test('a plain single-page manifest raises no concerns', () => {
  const concerns = manifestConcerns({
    pageId: '177',
    edits: [{ blockId: '5665', field: 'richText_Text', value: '<h5>New</h5>' }],
  });
  assert.deepEqual(concerns, []);
});

test('design-system changes are refused as impossible, not merely flagged', () => {
  for (const key of ['styles', 'tokens', 'css', 'theme', 'global', 'siteWide']) {
    const concerns = manifestConcerns({ [key]: { '--color-brand-500': '#ff0000' } });
    assert.equal(concerns.length, 1, key);
    assert.equal(concerns[0].radius, RADIUS.NOT_POSSIBLE, key);
  }
});

test('an invented block type is refused', () => {
  const concerns = manifestConcerns({
    newBlocks: [{ afterBlockId: '1', type: 'HeroBanner', field: 'html', value: '<div/>' }],
  });
  assert.equal(concerns.length, 1);
  assert.equal(concerns[0].radius, RADIUS.NOT_POSSIBLE);
});

test('an existing block type in newBlocks is allowed through', () => {
  const concerns = manifestConcerns({
    newBlocks: [{ afterBlockId: '1', type: 'ds_EmbedBlock', field: 'embed_Code', value: '<div/>' }],
  });
  assert.deepEqual(concerns, []);
});

test('notes describing a site-wide change demand confirmation', () => {
  for (const note of [
    'Applied the new heading style to all pages',
    'Changed the brand colour site-wide',
    'Updated the footer across every page',
    'Adjusted the typography scale globally',
    'Restyled the navigation',
  ]) {
    const concerns = manifestConcerns({ unmapped: [note] });
    assert.equal(concerns.length, 1, note);
    assert.equal(concerns[0].radius, RADIUS.NEEDS_CONFIRMATION, note);
  }
});

test('an ordinary unmapped note does not demand confirmation', () => {
  const concerns = manifestConcerns({ unmapped: ['Reordered the stat tiles on this page'] });
  assert.deepEqual(concerns, []);
});

test('the most restrictive radius wins', () => {
  const page = { radius: RADIUS.PAGE };
  const confirm = { radius: RADIUS.NEEDS_CONFIRMATION };
  const impossible = { radius: RADIUS.NOT_POSSIBLE };

  assert.equal(overallVerdict([page, page]), RADIUS.PAGE);
  assert.equal(overallVerdict([page, confirm]), RADIUS.NEEDS_CONFIRMATION);
  assert.equal(overallVerdict([page, confirm, impossible]), RADIUS.NOT_POSSIBLE);
  assert.equal(overallVerdict([]), RADIUS.PAGE);
});

test('only a single-page verdict exits zero', () => {
  assert.equal(exitCodeFor(RADIUS.PAGE), 0);
  assert.equal(exitCodeFor(RADIUS.NEEDS_CONFIRMATION), 3);
  assert.equal(exitCodeFor(RADIUS.NOT_POSSIBLE), 3);
});
