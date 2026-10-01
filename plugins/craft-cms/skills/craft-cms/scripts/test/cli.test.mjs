// End-to-end refusals. These run with no credentials configured, which proves the
// guard rejects the request before any network call is attempted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'craft.mjs');

function run(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, CRAFT_GRAPHQL_ENDPOINT: '', CRAFT_GRAPHQL_TOKEN: '', CRAFT_CONFIG: '/nonexistent' } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test('help exits clean', async () => {
  const { code, stdout } = await run([]);
  assert.equal(code, 0);
  assert.match(stdout, /draft-only access to Craft CMS/);
});

test('a mutation passed to `craft query` is blocked before any network call', async () => {
  const { code, stderr } = await run(['query', '--q', 'mutation { deleteEntry(id: 1) }']);
  assert.equal(code, 2, 'should exit with the BLOCKED code, not the credentials error');
  assert.match(stderr, /^BLOCKED:/m);
  assert.doesNotMatch(stderr, /Missing credentials/);
});

test('publishing via a query document is blocked', async () => {
  const { code, stderr } = await run(['query', '--q', '{ publishDraft }']);
  assert.equal(code, 2);
  assert.match(stderr, /denied operation/);
});

test('unknown commands are refused', async () => {
  const { code, stderr } = await run(['publish', '123']);
  assert.equal(code, 2);
  assert.match(stderr, /Unknown command/);
});

test('there is no command that publishes or deletes', async () => {
  for (const cmd of ['publish', 'publish-draft', 'delete', 'delete-entry', 'update', 'entry-save']) {
    const { code, stderr } = await run([cmd, '1']);
    assert.equal(code, 2, `${cmd} should not exist`);
    assert.match(stderr, /Unknown command/, cmd);
  }
});

test('a read command without credentials fails on credentials, not silently', async () => {
  const { code, stderr } = await run(['entries']);
  assert.equal(code, 1);
  assert.match(stderr, /Missing credentials/);
});
