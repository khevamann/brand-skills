// End-to-end refusals, offline. The guard must reject before any network call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'craft.mjs');

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test('help exits clean and names the site', async () => {
  const { code, stdout } = await run([]);
  assert.equal(code, 0);
  assert.match(stdout, /read-only access to the Craft CMS website/);
  assert.match(stdout, /cms\.digistormhosting\.com\.au/);
});

test('a mutation passed to `craft query` is blocked', async () => {
  const { code, stderr } = await run(['query', '--q', 'mutation { deleteEntry(id: 1) }']);
  assert.equal(code, 2);
  assert.match(stderr, /^BLOCKED:/m);
  assert.match(stderr, /read-only/);
});

test('a write operation named in a query document is blocked', async () => {
  for (const doc of ['{ publishDraft }', '{ createDraft }', '{ save_ds_Pages_ds_StandardPage_Entry }']) {
    const { code, stderr } = await run(['query', '--q', doc]);
    assert.equal(code, 2, doc);
    assert.match(stderr, /read-only/, doc);
  }
});

test('no write command exists', async () => {
  for (const cmd of [
    'publish', 'publish-draft', 'draft-create', 'draft-new', 'draft-set',
    'delete', 'delete-entry', 'update', 'edit', 'save',
  ]) {
    const { code, stderr } = await run([cmd, '1']);
    assert.equal(code, 2, `${cmd} should not exist`);
    assert.match(stderr, /Unknown command/, cmd);
  }
});

test('the no-token promise holds: the client sends no Authorization header', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(join(dirname(CLI), 'lib', 'client.mjs'), 'utf8');
  // Comments mention the absence deliberately, so compare against code only.
  const code = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /Authorization/i, 'client must not send an Authorization header');
  assert.doesNotMatch(code, /Bearer/i, 'client must not send a bearer token');
  assert.doesNotMatch(code, /process\.env/, 'client must not read credentials from the environment');
});
