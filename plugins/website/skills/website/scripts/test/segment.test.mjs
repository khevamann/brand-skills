// Reading pages from the outside: the parser, the segmenter and the platform hints.
// Fixtures are trimmed from real markup seen on each platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, find, findAll, text } from '../core/html.mjs';
import { segmentPage, fieldsOf } from '../core/segment.mjs';

const fields = (html) => {
  const el = find(parse(html), (n) => n.attrs.id === 'x');
  return Object.fromEntries(Object.entries(fieldsOf(el)).map(([k, v]) => [k, v.value]));
};
const wrap = (main, { header = '<header><nav><a href="/">Home</a></nav></header>', footer = '<footer><p>© Example Ltd. All rights reserved, every year.</p></footer>' } = {}) =>
  `<!doctype html><html><head><title>Example &amp; Co</title></head><body>${header}<main>${main}</main>${footer}</body></html>`;

test('the parser survives bad markup and keeps every element', () => {
  const root = parse('<div class=a "broken""attr" data-id=x><p>One<p>Two<li>x<li>y<br/><img src=a.jpg / ></div><script>if (a<b) {}</script>tail');
  assert.equal(find(root, (n) => n.tag === 'div').attrs['data-id'], 'x');
  assert.deepEqual(findAll(root, (n) => n.tag === 'p').map(text), ['One', 'Two x y']);
  assert.ok(find(root, (n) => n.tag === 'img'));
  assert.doesNotMatch(text(root), /if \(a/, 'script text is not page text');
});

test('entities are decoded and whitespace collapsed', () => {
  assert.equal(text(parse('<p>Fish&nbsp;&amp;\n  chips &#8217;n&#x27; peas</p>')), 'Fish & chips ’n\' peas');
});

test('copy fields are named for what they are, and nothing is counted twice', () => {
  assert.deepEqual(fields('<section id=x><h2>Title</h2><p>Body with <a href=a>a link</a>.</p><ul><li><p>Nested</p></li><li>Plain</li></ul><a class="btn" href=b>Go</a></section>'), {
    text_Heading1: 'Title',
    text_Paragraph1: 'Body with a link.',
    text_Paragraph2: 'Nested',
    text_Item1: 'Plain',
    text_Button1: 'Go',
  });
});

test('a block that is itself a paragraph or heading is one field', () => {
  assert.deepEqual(fields('<p id=x>Lots of <a href=a>stats</a> here.</p>'), { text_Paragraph1: 'Lots of stats here.' });
  assert.deepEqual(fields('<h2 id=x>Heading</h2>'), { text_Heading1: 'Heading' });
});

test('words written straight into a container are kept with their links', () => {
  assert.deepEqual(fields('<div id=x><div>Call <a href=t>555</a> today</div></div>'), { text_Text1: 'Call 555 today' });
});

test('a repeated title (screen-reader or hover copy) is kept once', () => {
  assert.deepEqual(fields('<div id=x><a href=p>Mug</a><h3>Mug</h3><h3>Mug</h3><p>£10</p></div>'), {
    text_Link1: 'Mug',
    text_Paragraph1: '£10',
  });
});

test('generic pages: main content blocks, header and footer as chrome', () => {
  const page = segmentPage(wrap('<div><section class="hero"><h1>Welcome</h1></section><section class="intro"><p>About us, at length.</p></section></div>'), 'https://example.com/', 'other');
  assert.equal(page.title, 'Example & Co');
  assert.deepEqual(page.blocks.map((b) => b.__typename), ['section.hero', 'section.intro']);
  assert.deepEqual(page.chrome.map((b) => b._region), ['header', 'footer']);
});

test('an app shell wrapping everything is split down to the real blocks', () => {
  const sections = Array.from({ length: 4 }, (_, i) => `<section id="${100 + i}"><h2>Section ${i}</h2><p>${'Words '.repeat(30)}</p></section>`).join('');
  const page = segmentPage(`<html><body><main><div class="nav"><a href="/">Home</a></div><div class="content">${sections}</div><div class="foot">Small print</div></main></body></html>`, 'https://example.com/', 'other');
  assert.deepEqual(page.blocks.filter((b) => /^\d+$/.test(b.id)).map((b) => b.id), ['100', '101', '102', '103']);
});

test('Shopify: sections by their theme ids; section groups are site chrome', () => {
  const html = `<html><body>
    <div id="shopify-section-sections--111__header" class="shopify-section"><header><a href="/">Shop</a></header></div>
    <main id="MainContent" role="main">
      <div id="shopify-section-template--222__image_banner" class="shopify-section"><h2>Big news</h2></div>
      <div id="shopify-section-template--222__3fa85f64-5717-4562-b3fc-2c963f66afa6" class="shopify-section"><div class="multicolumn-card"><p>Card</p></div></div>
    </main></body></html>`;
  const page = segmentPage(html, 'https://shop.example/', 'shopify');
  assert.deepEqual(page.blocks.map((b) => [b.id, b.__typename]), [
    ['template--222__image_banner', 'image_banner'],
    ['template--222__3fa85f64-5717-4562-b3fc-2c963f66afa6', 'multicolumn-card'],
  ]);
  assert.equal(page.chrome[0]._domId, 'shopify-section-sections--111__header');
});

test('Squarespace: page sections with their block types', () => {
  const html = wrap(`<article class="sections">
    <section data-section-id="abc123" data-sqsp-section="fluid-engine" data-section-theme="dark">
      <div class="sqs-block" data-sqsp-block="text"><h1>Hello</h1></div>
      <div class="sqs-block" data-sqsp-block="button"><a class="sqs-block-button-element" href="/x">Book</a></div>
    </section></article>`).replace('<main>', '<main id="page">');
  const [block] = segmentPage(html, 'https://sqs.example/', 'squarespace').blocks;
  assert.equal(block.id, 'abc123');
  assert.equal(block.__typename, 'fluid-engine');
  assert.deepEqual(block._parts, ['text', 'button']);
  assert.equal(block._theme, 'dark');
});

test('WordPress: Gutenberg blocks are the content children; a listing makes one block per post', () => {
  const page = segmentPage(wrap('<article><div class="entry-content"><p>First para.</p><h2 class="wp-block-heading">Sub</h2><div class="wp-block-group"><p>Grouped</p></div></div></article>'), 'https://wp.example/about', 'wordpress');
  assert.deepEqual(page.blocks.map((b) => b.__typename), ['p', 'wp-block-heading', 'wp-block-group']);

  const listing = segmentPage(wrap('<article><div class="entry-content"><p>Post one</p></div></article><article><div class="entry-content"><p>Post two</p></div></article>'), 'https://wp.example/', 'wordpress');
  assert.deepEqual(listing.blocks.map((b) => b.__typename), ['post', 'post']);
});

test('WordPress: Elementor containers, old and new, are the blocks', () => {
  const html = wrap(`<div data-elementor-type="wp-page">
    <div data-element_type="e-div-block" data-id="aaa"><div data-element_type="widget" data-widget_type="heading.default"><h2>One</h2></div></div>
    <div data-element_type="container" data-id="bbb"><p>Two</p></div></div>`);
  const page = segmentPage(html, 'https://wp.example/', 'wordpress');
  assert.deepEqual(page.blocks.map((b) => [b.id, b.__typename]), [['aaa', 'elementor-e-div-block'], ['bbb', 'elementor-container']]);
  assert.deepEqual(page.blocks[0]._parts, ['heading']);
});

test('images, links and embeds are recorded, so media-only blocks are not empty', () => {
  const [block] = segmentPage(wrap('<section><img src="/a.jpg" alt=""><iframe src="https://video.example/1"></iframe><a href="/next">Next</a></section>'), 'https://example.com/', 'other').blocks;
  assert.deepEqual(block.images_Images, [{ url: 'https://example.com/a.jpg', alt: '' }]);
  assert.deepEqual(block.media_Embeds, [{ url: 'https://video.example/1' }]);
  assert.equal(block.links_Links[0].linkUrl, 'https://example.com/next');
});
