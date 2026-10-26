import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnly, isDenied, stripLiterals, GuardError } from '../adapters/craft/guard.mjs';

test('plain queries pass', () => {
  assert.doesNotThrow(() => assertReadOnly('{ entries { id title } }'));
  assert.doesNotThrow(() => assertReadOnly('query Foo($id: ID) { entry(id: $id) { title } }'));
  assert.doesNotThrow(() => assertReadOnly('{ entry(id: 177) { ... on ds_StandardPage_Entry { title } } }'));
});

test('every write operation is rejected', () => {
  for (const doc of [
    'mutation { save_ds_Pages_ds_StandardPage_Entry(title: "x") { id } }',
    'MUTATION { deleteEntry(id: 1) }',
    '  \n mutation Named { publishDraft(id: 1) }',
    'query A { entries { id } }\nmutation B { deleteEntry(id: 1) }',
    'subscription { thing }',
    'mutation { createDraft(id: 177) }',
  ]) {
    assert.throws(() => assertReadOnly(doc), GuardError, `should block: ${doc}`);
  }
});

test('write operation names are rejected even inside a query document', () => {
  for (const doc of ['{ deleteEntry }', '{ x { publishDraft } }', '{ createDraft }', '{ save_anything }']) {
    assert.throws(() => assertReadOnly(doc), GuardError, `should block: ${doc}`);
  }
});

test('the word mutation inside a string or comment does not trip the guard', () => {
  assert.doesNotThrow(() => assertReadOnly('{ entries(search: "gene mutation research") { id } }'));
  assert.doesNotThrow(() => assertReadOnly('# mutation notes\n{ entries { id } }'));
  assert.doesNotThrow(() => assertReadOnly('{ entries(search: """a mutation, deleteEntry""") { id } }'));
});

test('empty documents are rejected', () => {
  for (const doc of ['', '   ', undefined, null, 42]) {
    assert.throws(() => assertReadOnly(doc), GuardError);
  }
});

test('stripLiterals removes strings and comments', () => {
  assert.equal(stripLiterals('{ a(s: "mutation") } # mutation').trim(), '{ a(s: "") }');
});

test('isDenied covers every write Craft exposes', () => {
  for (const name of [
    'createDraft', 'publishDraft', 'deleteEntry', 'deleteAsset', 'deleteCategory', 'deleteTag',
    'save_ds_Pages_ds_StandardPage_Entry', 'save_ds_Pages_ds_StandardPage_Draft',
    'save_images_Asset', 'save_siteInfo_GlobalSet', 'createEntry', 'resaveElements',
    'restoreEntry', 'moveToSection',
  ]) {
    assert.equal(isDenied(name), true, `${name} should be denied`);
  }
  for (const name of ['entries', 'entry', 'ping', 'entryCount', 'assets']) {
    assert.equal(isDenied(name), false, `${name} is a read, should not be denied`);
  }
});
