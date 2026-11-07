// Setup: the checks that stop early, bringing an old folder up to date, and setup
// progress worked out from the folder rather than from anyone remembering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject, loadProject, saveSite } from '../core/project.mjs';
import { onboardingStatus, finishOnboarding, skipStep, syncOnboarding } from '../core/onboarding.mjs';
import { describeWorkspace, runChecks, tidyProject } from '../core/setup.mjs';
import { parseYaml } from '../core/yaml.mjs';
import { VERSION } from '../version.mjs';

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(scripts, 'site.mjs');
const fresh = () => mkdtempSync(join(tmpdir(), 'site-setup-'));

function run(args, cwd, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

test('the version matches plugin.json', () => {
  const plugin = JSON.parse(readFileSync(join(scripts, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(VERSION, plugin.version);
});

test('an old site.json moves into site.yaml, keeping every fact', () => {
  const dir = fresh();
  const old = { url: 'https://old.example', platform: 'craft', platformName: 'Craft CMS', confirmedBy: 'user', craft: { graphql: 'https://old.example/api' }, audit: { placeholders: ['Demo Company'] }, state: { lastExport: { pages: 3 } } };
  writeFileSync(join(dir, 'site.json'), JSON.stringify(old));
  const project = loadProject(dir);
  assert.equal(project.migrated, 'site.json');
  assert.ok(!existsSync(join(dir, 'site.json')));
  const site = parseYaml(readFileSync(join(dir, 'site.yaml'), 'utf8'));
  assert.equal(site.craft.graphql, 'https://old.example/api');
  assert.deepEqual(site.audit.placeholders, ['Demo Company']);
  assert.equal(site.state.lastExport.pages, 3);
  assert.equal(site.preferences.publishing, 'ask-first');
  assert.equal(loadProject(dir).migrated, undefined, 'migrates once');
});

test('a broken site.yaml is reported with its line, not silently replaced', () => {
  const dir = fresh();
  writeFileSync(join(dir, 'site.yaml'), 'url: https://a.example\nplatform: other\n  oops: 1\n');
  assert.throws(() => loadProject(dir), /site\.yaml can't be read \(line 3/);
});

test('setup progress comes from what is in the folder', () => {
  const dir = fresh();
  const project = initProject(dir, { url: 'https://a.example', platform: 'squarespace', confirmedBy: 'user' });
  let status = onboardingStatus(project);
  assert.deepEqual(status.steps.filter((s) => s.done).map((s) => s.id), ['project']);

  Object.assign(project.site, { adminUrl: 'https://a.example/config', account: { role: 'owner', plan: 'unknown' }, access: { browser: 'built-in', drafts: null } });
  project.site.onboarding.checks = '2026-11-07';
  saveSite(project);
  mkdirSync(join(dir, 'audits'));
  writeFileSync(join(dir, 'audits', 'review-2026-11-07.md'), '# review');
  status = syncOnboarding(project);
  assert.ok(status.steps.find((s) => s.id === 'sign-in').done);
  assert.ok(status.steps.find((s) => s.id === 'review').done);
  assert.ok(!status.steps.find((s) => s.id === 'layout').done, 'a review is not a layout check');
  assert.match(loadProject(dir).site.onboarding.review, /^\d{4}-\d{2}-\d{2}$/, 'dated once done');

  assert.throws(() => finishOnboarding(project), /Setup isn't finished[\s\S]*editor/);
  assert.throws(() => skipStep(project, 'handover', 'no'), /can't be skipped/);
  assert.throws(() => skipStep(project, 'editor', ''), /Say why/);
});

test('setup can finish with a step put off, and says why it was', () => {
  const dir = fresh();
  const project = initProject(dir, { url: 'https://a.example', platform: 'other', confirmedBy: 'user' });
  Object.assign(project.site, {
    adminUrl: 'https://a.example/admin', account: { role: 'editor', plan: 'n/a' }, access: { browser: 'claude-in-chrome' },
    structure: { pages: [{ path: '/', title: 'Home' }], shared: ['header', 'footer'] },
  });
  project.site.onboarding.checks = '2026-11-07';
  saveSite(project);
  for (const f of ['audits/review-x.md', 'audits/layout-x.md', 'admin-guide.md', 'design/system/DESIGN-SYSTEM.md', 'design/blocks.md']) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '#');
  }
  skipStep(project, 'editor', "they can't sign in to the editor until Monday");
  const done = finishOnboarding(project);
  assert.ok(!done.finished, 'a skipped step is still open');
  assert.match(done.steps.find((s) => s.id === 'editor').skipped, /until Monday/);
  writeFileSync(join(dir, 'design', 'available-blocks.md'), '#');
  assert.ok(syncOnboarding(loadProject(dir)).finished);
});

test('a plain chat stops setup with the fix; the user can say otherwise', async () => {
  const marker = fresh();
  const env = { WEBSITE_SKILL_CHAT_MARKER: marker };
  const dir = fresh();
  let r = await run(['setup'], dir, env);
  assert.equal(r.code, 4);
  assert.match(r.stdout, /STOP — setup is not ready/);
  assert.match(r.stdout, /This needs Claude Cowork/);
  r = await run(['init', 'https://a.example', '--platform', 'other', '--confirmed-by', 'user', '--new'], dir, env);
  assert.equal(r.code, 4, 'init refuses too');
  assert.ok(!existsSync(join(dir, 'site.yaml')));
  r = await run(['setup', '--folder-confirmed'], dir, env);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /STOP/);
});

test("Claude's own home folder is not a project folder unless the user says it is", async () => {
  const home = fresh();
  const checks = await runChecks({ cwd: home, env: { WEBSITE_SKILL_HOME: home, WEBSITE_SKILL_CHAT_MARKER: '/nonexistent' } });
  assert.deepEqual(checks.hard.map((c) => c.id), ['folder']);
  const ok = await runChecks({ cwd: home, folderConfirmed: true, env: { WEBSITE_SKILL_HOME: home, WEBSITE_SKILL_CHAT_MARKER: '/nonexistent' } });
  assert.equal(ok.hard.length, 0);
  assert.equal(describeWorkspace(join(home, 'Acme website'), { WEBSITE_SKILL_HOME: home, WEBSITE_SKILL_CHAT_MARKER: '/nonexistent' }).name, 'Acme website');
});

test('init can set up a project in a folder that does not exist yet', async () => {
  const parent = fresh();
  const target = join(parent, 'Acme website');
  const r = await run(['init', 'http://127.0.0.1:9', '--platform', 'other', '--confirmed-by', 'user', '--new', '--project', target], parent);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(target, 'site.yaml')));
});

test('tidying moves only known files, never over an existing one, and lists the rest', () => {
  const dir = fresh();
  const project = initProject(dir, { url: 'https://a.example', platform: 'other', confirmedBy: 'user' });
  writeFileSync(join(dir, 'DESIGN-SYSTEM.md'), 'old');
  writeFileSync(join(dir, 'blocks.md'), 'b');
  mkdirSync(join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'blocks.md'), 'already here');
  writeFileSync(join(dir, 'client brief.docx'), 'theirs');
  const { moved, unexpected } = tidyProject(project);
  assert.deepEqual(moved, ['DESIGN-SYSTEM.md → design/system/DESIGN-SYSTEM.md']);
  assert.deepEqual(unexpected.sort(), ['blocks.md', 'client brief.docx']);
  assert.equal(readFileSync(join(dir, 'design', 'blocks.md'), 'utf8'), 'already here');
});

test('setup on an existing folder brings it up to date and lists what is left', async () => {
  const dir = fresh();
  writeFileSync(join(dir, 'site.json'), JSON.stringify({ url: 'http://127.0.0.1:9', platform: 'wordpress', platformName: 'WordPress' }));
  const r = await run(['setup'], dir);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Moved the settings from site\.json into site\.yaml/);
  assert.match(r.stdout, new RegExp(`NEW IN ${VERSION.replace(/\./g, '\\.')}`));
  assert.match(r.stdout, /SETUP NOT FINISHED/);
  const start = await run(['start'], dir);
  assert.match(start.stdout, /SETUP NOT FINISHED/);
  assert.match(start.stdout, /finish setup/);
  assert.doesNotMatch(start.stdout, /UPDATED SKILL/);
});

test('start says when the folder was set up by an older version', async () => {
  const dir = fresh();
  const project = initProject(dir, { url: 'http://127.0.0.1:9', platform: 'other', confirmedBy: 'user' });
  project.site.skill.version = '0.6.0';
  saveSite(project);
  const r = await run(['start'], dir);
  assert.match(r.stdout, /UPDATED SKILL — this folder was set up by version 0\.6\.0/);
  assert.match(r.stdout, /Run site setup first/);
});
