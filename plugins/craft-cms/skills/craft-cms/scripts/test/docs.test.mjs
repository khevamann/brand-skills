// The skill's value depends on its instructions matching the tool. A command that
// exists but is undocumented will not get used; one documented but removed sends the
// model down a dead end. Both are caught here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const skillDir = dirname(scripts);

const cli = readFileSync(join(scripts, 'craft.mjs'), 'utf8');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

/** Command names from the dispatch switch, excluding the help aliases. */
function cliCommands() {
  const body = cli.slice(cli.indexOf('switch (command)'));
  const names = [...body.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => !['help', 'h'].includes(n));
}

test('every command is listed in the CLI usage text', () => {
  const usage = cli.slice(cli.indexOf('const USAGE'), cli.indexOf('function parseArgs'));
  for (const name of cliCommands()) {
    assert.match(usage, new RegExp(`craft ${name}\\b`), `\`${name}\` missing from --help`);
  }
});

test('every command is mentioned in SKILL.md', () => {
  for (const name of cliCommands()) {
    assert.match(skill, new RegExp(`\\b${name}\\b`), `\`${name}\` missing from SKILL.md`);
  }
});

test('SKILL.md documents no command the CLI does not have', () => {
  const known = new Set([...cliCommands(), 'help']);
  const mentioned = [...skill.matchAll(/\$CRAFT ([a-z][a-z-]*)/g)].map((m) => m[1]);
  for (const name of new Set(mentioned)) {
    assert.ok(known.has(name), `SKILL.md references \`craft ${name}\`, which does not exist`);
  }
});

test('SKILL.md keeps the read-only and scope promises', () => {
  assert.match(skill, /read-only/i, 'must state it is read-only');
  assert.match(skill, /craft scope|\$CRAFT scope/, 'must point at the scope gate');
  assert.match(skill, /exits? 0/i, 'must state what a safe scope verdict looks like');
});

test('every reference file SKILL.md names exists', () => {
  for (const m of skill.matchAll(/references\/([a-z-]+\.md)/g)) {
    assert.doesNotThrow(
      () => readFileSync(join(skillDir, 'references', m[1]), 'utf8'),
      `SKILL.md references missing file ${m[1]}`,
    );
  }
});

test('the frontmatter name matches the directory name', () => {
  const name = skill.match(/^---\n[\s\S]*?name:\s*(\S+)/)?.[1];
  assert.equal(name, skillDir.split('/').pop());
});

test('untested procedures are labelled as such', () => {
  const browser = readFileSync(join(skillDir, 'references', 'browser-apply.md'), 'utf8');
  // This file describes a control panel nobody has driven yet. If that changes, the
  // warning should go — and this test should be updated deliberately, not silently.
  assert.match(browser, /not been tested|unverified/i);
});
