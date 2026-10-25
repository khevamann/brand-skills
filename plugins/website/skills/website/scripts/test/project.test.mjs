// The project folder is the memory between sessions. These pin what a new session
// relies on finding, and that the user's own files are never clobbered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initProject, loadProject, addNote, readNotes, recordState, writeClaudeMdBlock,
  CLAUDE_MD_START, CLAUDE_MD_END,
} from '../core/project.mjs';
import { SiteError } from '../core/cli.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'site-project-'));
const setUp = (dir = fresh()) =>
  initProject(dir, { url: 'https://example.com/some/page', platform: 'shopify', confirmedBy: 'user' });

test('init writes the files a new session reads, and records the origin only', () => {
  const project = setUp();
  for (const f of ['siteJson', 'siteMd', 'learnings', 'claudeMd']) {
    assert.ok(existsSync(project.paths[f]), `${f} missing`);
  }
  const loaded = loadProject(project.paths.root);
  assert.equal(loaded.site.url, 'https://example.com');
  assert.equal(loaded.site.platform, 'shopify');
  assert.equal(loaded.site.confirmedBy, 'user');
  assert.match(readFileSync(project.paths.siteMd, 'utf8'), /Shopify \(confirmed by the user\)/);
});

test('init refuses an unknown platform and an already set-up folder', () => {
  assert.throws(() => initProject(fresh(), { url: 'https://x.com', platform: 'wix' }), SiteError);
  const project = setUp();
  assert.throws(() => setUp(project.paths.root), /already set up/);
});

test('a folder with no site.json is not a project', () => {
  assert.equal(loadProject(fresh()), null);
});

test('notes are dated, kept in order, and read back', () => {
  const project = setUp();
  addNote(project, 'Header is a section group — global.');
  addNote(project, 'Owner wants copy fixes kept separate\nfrom design changes.');
  const notes = readNotes(project);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^- \d{4}-\d{2}-\d{2} — Header is a section group/);
  assert.match(notes[1], /copy fixes kept separate from design changes\.$/);
  assert.doesNotMatch(readFileSync(project.paths.siteMd, 'utf8'), /No notes yet/);
});

test('notes land in the Notes section even when sections follow it', () => {
  const project = setUp();
  writeFileSync(project.paths.siteMd, '# x\n\n## Notes\n\n- 2026-01-01 — first\n\n## Later\n\nstuff\n');
  addNote(project, 'second');
  const body = readFileSync(project.paths.siteMd, 'utf8');
  assert.ok(body.indexOf('second') < body.indexOf('## Later'));
  assert.equal(readNotes(project).length, 2);
});

test('a note carrying a secret is refused', () => {
  const project = setUp();
  assert.throws(() => addNote(project, 'admin password is hunter2'), /never hold passwords/);
  assert.throws(() => addNote(project, 'token: abc123'), /never hold passwords/);
});

test("CLAUDE.md: the user's content is preserved, and the block is not duplicated", () => {
  const file = join(fresh(), 'CLAUDE.md');
  writeFileSync(file, '# My own notes\n\nKeep this.\n');
  assert.equal(writeClaudeMdBlock(file), 'appended');
  assert.equal(writeClaudeMdBlock(file), 'updated');
  const body = readFileSync(file, 'utf8');
  assert.match(body, /^# My own notes\n\nKeep this\./);
  assert.equal(body.split(CLAUDE_MD_START).length - 1, 1);
  assert.equal(body.split(CLAUDE_MD_END).length - 1, 1);
  assert.match(body, /read `SITE\.md`/);
});

test('state paths are stored relative to the project, so the folder can move', () => {
  const project = setUp();
  recordState(project, 'lastExport', { dir: join(project.paths.root, 'export'), pages: 3 });
  const { site } = loadProject(project.paths.root);
  assert.equal(site.state.lastExport.dir, 'export');
  assert.equal(site.state.lastExport.pages, 3);
  assert.match(site.state.lastExport.at, /^\d{4}-/);
});
