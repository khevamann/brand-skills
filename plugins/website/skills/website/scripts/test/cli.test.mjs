// End-to-end refusals, offline. The guard must reject before any network call, so
// these point the Craft adapter at an address nothing listens on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(scripts, 'site.mjs');
const NOWHERE = 'http://127.0.0.1:9/api';

function run(args, cwd = mkdtempSync(join(tmpdir(), 'site-cli-'))) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd }, (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test('help exits clean and states the read-only promise', async () => {
  const { code, stdout } = await run([]);
  assert.equal(code, 0);
  assert.match(stdout, /read-only/);
  assert.match(stdout, /site start/);
});

test('an empty folder is told to set up a project, not given an error', async () => {
  const { code, stdout } = await run(['start']);
  assert.equal(code, 0);
  assert.match(stdout, /not set up as a website project/);
});

test('a mutation passed to `site query` is blocked', async () => {
  const { code, stderr } = await run(['query', '--endpoint', NOWHERE, '--q', 'mutation { deleteEntry(id: 1) }']);
  assert.equal(code, 2);
  assert.match(stderr, /^BLOCKED:/m);
  assert.match(stderr, /read-only/);
});

test('a write operation named in a query document is blocked', async () => {
  for (const doc of ['{ publishDraft }', '{ createDraft }', '{ save_ds_Pages_ds_StandardPage_Entry }']) {
    const { code, stderr } = await run(['query', '--endpoint', NOWHERE, '--q', doc]);
    assert.equal(code, 2, doc);
    assert.match(stderr, /read-only/, doc);
  }
});

test('no write command exists', async () => {
  for (const cmd of [
    'publish', 'publish-draft', 'draft-create', 'draft-new', 'draft-set',
    'delete', 'delete-entry', 'update', 'edit', 'save', 'apply', 'push',
  ]) {
    const { code, stderr } = await run([cmd, '1']);
    assert.equal(code, 2, `${cmd} should not exist`);
    assert.match(stderr, /Unknown command/, cmd);
  }
});

test('the no-token promise holds: the Craft client sends no Authorization header', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(join(scripts, 'adapters', 'craft', 'client.mjs'), 'utf8');
  // Comments mention the absence deliberately, so compare against code only.
  const code = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /Authorization/i, 'client must not send an Authorization header');
  assert.doesNotMatch(code, /Bearer/i, 'client must not send a bearer token');
  assert.doesNotMatch(code, /process\.env/, 'client must not read credentials from the environment');
});

test('no endpoint is hard-coded: it comes from the project folder', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(join(scripts, 'adapters', 'craft', 'client.mjs'), 'utf8');
  assert.doesNotMatch(client, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
});
