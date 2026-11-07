// Platform findings: the first real project on a platform answers the guide's open
// questions, and the answers travel back to the skill. These pin that loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject, PLATFORMS } from '../core/project.mjs';
import { checklistFor, ensureFindings, readFindings, recordFinding, findingsPath, nextQuestions, sendSuggestion, markSuggested, MAINTAINER } from '../core/findings.mjs';
import { loadProject } from '../core/project.mjs';

const project = (platform = 'wordpress') =>
  initProject(mkdtempSync(join(tmpdir(), 'site-findings-')), { url: 'https://x.example', platform, confirmedBy: 'user' });

test('every platform guide has a first-time checklist with unique, prefixed ids', () => {
  const seen = new Set();
  for (const platform of Object.keys(PLATFORMS)) {
    const items = checklistFor(platform);
    assert.ok(items.length >= 5, `${platform} has ${items.length} checklist questions`);
    const prefix = items[0].id.split('-')[0];
    for (const { id, question } of items) {
      assert.ok(id.startsWith(`${prefix}-`), `${platform}: ${id} has a different prefix`);
      assert.ok(!seen.has(id), `${id} is used twice`);
      assert.ok(question.length > 20, `${id} has no real question`);
      seen.add(id);
    }
  }
});

test('every checklist follows a session: it starts at logging in, and every question has a step', () => {
  for (const platform of Object.keys(PLATFORMS)) {
    const items = checklistFor(platform);
    assert.equal(items[0].stage, 'Logging in', platform);
    assert.ok(items.every((q) => q.stage), `${platform}: a question has no step`);
    assert.ok(items.some((q) => q.askUser), `${platform}: nothing is marked for asking the user`);
    assert.ok(items.every((q) => !q.question.startsWith('_(')), 'the ask-the-user marker is stripped from the question');
  }
});

test('the walk-through offers one step at a time, and moves on as questions are answered', () => {
  const p = project('squarespace');
  let next = nextQuestions(p);
  assert.equal(next.stage, 'Logging in');
  assert.deepEqual(next.now.map((q) => q.id), ['SQ-1', 'SQ-2']);
  assert.ok(next.now.every((q) => q.askUser));
  assert.equal(next.later, checklistFor('squarespace').length - 2);

  recordFinding(p, 'SQ-1', 'Owner, no 2FA.');
  recordFinding(p, 'SQ-2', 'Core plan; no Create draft.');
  next = nextQuestions(p);
  assert.equal(next.stage, 'Opening a page');
  assert.equal(next.answered, 2);
});

test('the findings file says who to send it to', () => {
  assert.equal(MAINTAINER, 'the skill author');
  assert.match(readFileSync(findingsPath(project()), 'utf8'), /suggest sending this file to the skill author, who/);
});

test('sending the findings is suggested rarely: once enough builds up, then only after more', () => {
  let p = project('shopify'); // 10 questions
  const reload = () => (p = loadProject(p.paths.root));
  for (const id of ['SH-1', 'SH-2', 'SH-3', 'SH-4']) recordFinding(p, id, 'seen');
  assert.equal(sendSuggestion(p).due, false, 'four findings are not enough');
  recordFinding(p, 'SH-5', 'seen');
  assert.equal(sendSuggestion(p).due, true, 'half the checklist is');

  markSuggested(p);
  reload();
  assert.equal(sendSuggestion(p).due, false, 'not again straight away');
  for (const id of ['SH-6', 'SH-7', 'SH-8', 'SH-9']) recordFinding(p, id, 'seen');
  assert.equal(sendSuggestion(p).due, false, 'four more is not enough');
  recordFinding(p, 'SH-10', 'seen');
  assert.equal(sendSuggestion(p).due, true, 'five more, and the checklist complete');

  markSuggested(p);
  reload();
  recordFinding(p, 'new', 'one more thing');
  assert.equal(sendSuggestion(p).due, false, 'a single extra finding does not ask again');
});

test('a new project gets the platform checklist, all open', () => {
  const p = project('shopify');
  assert.equal(ensureFindings(p), 0, 'init already created it');
  const findings = readFindings(p);
  assert.equal(findings.questions.length, checklistFor('shopify').length);
  assert.ok(findings.questions.every((q) => q.status === 'open'));
  assert.match(readFileSync(findingsPath(p), 'utf8'), /^# What we learned about Shopify/);
});

test('answers accumulate under their question and mark it answered', () => {
  const p = project();
  recordFinding(p, 'wp-4', 'Update publishes at once.');
  recordFinding(p, 'WP-4', 'Same on a second page.');
  const q = readFindings(p).questions.find((x) => x.id === 'WP-4');
  assert.equal(q.status, 'answered');
  assert.equal(q.answers.length, 2);
  assert.match(q.answers[0], /^- \d{4}-\d{2}-\d{2} — Update publishes at once\.$/);
  assert.equal(readFindings(p).questions.find((x) => x.id === 'WP-5').status, 'open');
});

test('findings outside the checklist are kept in order', () => {
  const p = project();
  recordFinding(p, 'new', 'Login page renamed by a security plugin.');
  recordFinding(p, 'new', 'Editor slow to load.');
  assert.deepEqual(readFindings(p).other.map((l) => l.replace(/^- \S+ — /, '')), [
    'Login page renamed by a security plugin.',
    'Editor slow to load.',
  ]);
});

test('unknown ids and secrets are refused', () => {
  const p = project();
  assert.throws(() => recordFinding(p, 'WP-99', 'x'), /No checklist question WP-99/);
  assert.throws(() => recordFinding(p, 'WP-1', 'the password is hunter2'), /never hold passwords/);
  assert.throws(() => recordFinding(p, 'WP-1', ''), /needs some text/);
});

test('questions added to the guide later reach existing projects, answers intact', () => {
  const guides = mkdtempSync(join(tmpdir(), 'site-guides-'));
  const guide = (ids) => `# G\n\n## First-time checklist\n\nIntro.\n\n${ids.map((id) => `- **${id}** — Question ${id} about the admin?`).join('\n')}\n`;
  writeFileSync(join(guides, 'wordpress.md'), guide(['WP-1', 'WP-2']));
  const p = project();
  unlinkSync(findingsPath(p));
  assert.equal(ensureFindings(p, guides), 2);
  recordFinding(p, 'WP-1', 'Answered before the guide grew.');

  writeFileSync(join(guides, 'wordpress.md'), guide(['WP-1', 'WP-2', 'WP-3']));
  assert.equal(ensureFindings(p, guides), 1);
  const body = readFileSync(findingsPath(p), 'utf8');
  assert.match(body, /### WP-3 — /);
  assert.match(body, /Answered before the guide grew\./);
  assert.ok(body.indexOf('### WP-3') < body.indexOf('## Other findings'));
});
