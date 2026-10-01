import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReadOnly,
  assertDraftWrite,
  isDeniedMutation,
  stripLiterals,
  DENIED_ARGUMENTS,
  GuardError,
} from '../lib/guard.mjs';

// ---------------------------------------------------- read-only gate

test('plain queries pass', () => {
  assert.doesNotThrow(() => assertReadOnly('{ entries { id title } }'));
  assert.doesNotThrow(() => assertReadOnly('query Foo($id: ID) { entry(id: $id) { title } }'));
});

test('every write operation in a free-form document is rejected', () => {
  for (const doc of [
    'mutation { save_news_article_Entry(title: "x") { id } }',
    'MUTATION { deleteEntry(id: 1) }',
    '  \n mutation Named { publishDraft(id: 1) }',
    'query A { entries { id } }\nmutation B { deleteEntry(id: 1) }',
    'subscription { thing }',
    'mutation { save_news_article_Draft(draftId: 1, title: "x") { id } }',
  ]) {
    assert.throws(() => assertReadOnly(doc), GuardError, `should block: ${doc}`);
  }
});

test('the word mutation inside a string or comment does not trip the guard', () => {
  assert.doesNotThrow(() => assertReadOnly('{ entries(search: "gene mutation research") { id } }'));
  assert.doesNotThrow(() => assertReadOnly('# mutation notes\n{ entries { id } }'));
  assert.doesNotThrow(() => assertReadOnly('{ entries(search: """a mutation, deleteEntry""") { id } }'));
});

test('denied operation names are rejected even inside a query document', () => {
  for (const doc of [
    '{ deleteEntry }',
    '{ x { publishDraft } }',
    '{ save_images_Asset }',
    '{ save_contentBuilderField_text_Draft }',
  ]) {
    assert.throws(() => assertReadOnly(doc), GuardError, `should block: ${doc}`);
  }
});

test('empty documents are rejected', () => {
  for (const doc of ['', '   ', undefined, null, 42]) {
    assert.throws(() => assertReadOnly(doc), GuardError);
  }
});

test('stripLiterals removes strings and comments', () => {
  assert.equal(stripLiterals('{ a(s: "mutation") } # mutation').trim(), '{ a(s: "") }');
});

// ------------------------------------------------------ deny list

test('isDeniedMutation covers the destructive surface', () => {
  for (const name of [
    'publishDraft',
    'deleteEntry',
    'deleteAsset',
    'deleteCategory',
    'deleteTag',
    'save_images_Asset',
    'save_newsCategories_Category',
    'save_siteInfo_GlobalSet',
    'save_bodyField_textBlock_Entry',
    'save_bodyField_textBlock_Draft',
    'createEntry',
    'resaveElements',
    'restoreEntry',
    'moveToSection',
  ]) {
    assert.equal(isDeniedMutation(name), true, `${name} should be denied`);
  }
  for (const name of ['createDraft', 'save_news_article_Entry', 'save_news_article_Draft']) {
    assert.equal(isDeniedMutation(name), false, `${name} should not be denied`);
  }
});

// ------------------------------------------------------ write gate

test('createDraft is allowed with a canonical entry id', () => {
  assert.equal(assertDraftWrite('createDraft', { id: 42 }), 'create-draft');
});

test('createDraft without an id, or asking for a provisional draft, is blocked', () => {
  assert.throws(() => assertDraftWrite('createDraft', {}), GuardError);
  assert.throws(() => assertDraftWrite("createDraft", { id: 1, provisional: true }), GuardError);
});

test('a Craft 4 entry save is allowed only when scoped to a draft', () => {
  assert.equal(
    assertDraftWrite('save_news_article_Entry', { draftId: '7', title: 'x' }),
    'save-draft-via-entry-mutation',
  );
  assert.throws(() => assertDraftWrite('save_news_article_Entry', { title: 'x' }), GuardError);
  for (const bad of [null, undefined, '', '   ']) {
    assert.throws(() => assertDraftWrite('save_news_article_Entry', { draftId: bad }), GuardError);
  }
});

test('a Craft 5 draft save needs a draftId or asUnpublishedDraft, not both and not neither', () => {
  assert.equal(
    assertDraftWrite('save_news_article_Draft', { draftId: '7', title: 'x' }),
    'save-existing-draft',
  );
  assert.equal(
    assertDraftWrite('save_news_article_Draft', { asUnpublishedDraft: true, title: 'x' }),
    'save-new-unpublished-draft',
  );
  assert.throws(() => assertDraftWrite('save_news_article_Draft', { title: 'x' }), GuardError);
  assert.throws(
    () => assertDraftWrite('save_news_article_Draft', { draftId: '7', asUnpublishedDraft: true }),
    GuardError,
  );
});

test('denied mutations are blocked even with a valid draftId', () => {
  for (const name of ['publishDraft', 'deleteEntry', 'save_images_Asset', 'save_siteInfo_GlobalSet']) {
    assert.throws(() => assertDraftWrite(name, { draftId: '1' }), GuardError, name);
  }
});

test('unknown mutation shapes are blocked', () => {
  for (const name of ['somethingElse', 'save_news_article', 'ping', '']) {
    assert.throws(() => assertDraftWrite(name, { draftId: '1' }), GuardError, name);
  }
});

test('every live-affecting argument is refused on a draft write', () => {
  for (const key of DENIED_ARGUMENTS) {
    assert.throws(
      () => assertDraftWrite('save_news_article_Draft', { draftId: '1', [key]: 'x' }),
      GuardError,
      `should block ${key}`,
    );
  }
});

test('the denied argument list includes the ones that reach past a draft', () => {
  for (const key of ['id', 'uid', 'siteId', 'authorId', 'postDate', 'expiryDate', 'provisional', 'appendTo', 'insertAfter']) {
    assert.ok(DENIED_ARGUMENTS.includes(key), `${key} should be denied`);
  }
});
