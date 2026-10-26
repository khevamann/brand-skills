// The skill's value depends on its instructions matching the tool. A command that
// exists but is undocumented will not get used; one documented but removed sends the
// model down a dead end. Both are caught here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMANDS as CRAFT_COMMANDS } from '../adapters/craft/cli.mjs';
import { COMMANDS as GENERIC_COMMANDS } from '../adapters/generic/cli.mjs';

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const skillDir = dirname(scripts);

const site = readFileSync(join(scripts, 'site.mjs'), 'utf8');
const craftCli = readFileSync(join(scripts, 'adapters', 'craft', 'cli.mjs'), 'utf8');
const genericCli = readFileSync(join(scripts, 'adapters', 'generic', 'cli.mjs'), 'utf8');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');

/** Project command names from site.mjs's dispatch switch, excluding help aliases. */
function projectCommands() {
  const body = site.slice(site.indexOf('switch (command)'), site.indexOf('// Everything else'));
  const names = [...body.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => n !== 'help');
}

test('every adapter command is dispatched by its adapter', () => {
  for (const [cli, commands] of [[craftCli, CRAFT_COMMANDS], [genericCli, GENERIC_COMMANDS]]) {
    const body = cli.slice(cli.indexOf('switch (command)'));
    const dispatched = new Set([...body.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]));
    for (const name of commands) assert.ok(dispatched.has(name), `\`${name}\` not dispatched`);
  }
});

test('every command is listed in its usage text', () => {
  for (const [cli, commands, label] of [[craftCli, CRAFT_COMMANDS, 'Craft'], [genericCli, GENERIC_COMMANDS, 'generic']]) {
    const usage = cli.slice(cli.indexOf('export const USAGE'), cli.indexOf('`;', cli.indexOf('export const USAGE')));
    for (const name of commands) {
      assert.match(usage, new RegExp(`site ${name}\\b`), `\`${name}\` missing from ${label} help`);
    }
  }
  const siteUsage = site.slice(site.indexOf('const USAGE'), site.indexOf('`;', site.indexOf('const USAGE')));
  for (const name of projectCommands()) {
    assert.match(siteUsage, new RegExp(`site ${name}\\b`), `\`${name}\` missing from site help`);
  }
});

test('every command is mentioned in SKILL.md', () => {
  for (const name of [...CRAFT_COMMANDS, ...GENERIC_COMMANDS, ...projectCommands()]) {
    assert.match(skill, new RegExp(`\\$SITE ${name}\\b`), `\`${name}\` missing from SKILL.md`);
  }
});

test('SKILL.md documents no command the CLI does not have', () => {
  const known = new Set([...CRAFT_COMMANDS, ...GENERIC_COMMANDS, ...projectCommands(), 'help']);
  const mentioned = [...skill.matchAll(/\$SITE ([a-z][a-z-]*)/g)].map((m) => m[1]);
  for (const name of new Set(mentioned)) {
    assert.ok(known.has(name), `SKILL.md references \`site ${name}\`, which does not exist`);
  }
});

test('SKILL.md keeps the read-only, scope and never-publish promises', () => {
  assert.match(skill, /read-only/i, 'must state it is read-only');
  assert.match(skill, /\$SITE scope/, 'must point at the scope gate');
  assert.match(skill, /exits? 0/i, 'must state what a safe scope verdict looks like');
  assert.match(skill, /never publish/i, 'must forbid publishing');
  assert.match(skill, /never .*password/i, 'must forbid handling passwords');
});

test('SKILL.md starts every session by resuming the project folder', () => {
  assert.match(skill, /\$SITE start/);
  assert.match(skill, /SITE\.md/);
  for (const option of ['WordPress', 'Shopify', 'Craft CMS', 'Squarespace', 'Other / not sure']) {
    assert.ok(skill.includes(option), `platform question is missing "${option}"`);
  }
});

test('SKILL.md walks the user through findings and names who they go to', () => {
  assert.match(skill, /\$SITE findings/);
  assert.match(skill, /one at a time/);
  assert.match(skill, /never turn it into a survey|Never show them the checklist/);
  assert.match(skill, /sends the findings to Kheva happens rarely, never per session/);
  assert.match(skill, /\$SITE findings --told/);
});

test('every reference file SKILL.md names exists', () => {
  const named = [...skill.matchAll(/references\/([a-z-]+(?:\/[a-z-]+)*\.md)/g)].map((m) => m[1]);
  assert.ok(named.length >= 5, 'expected SKILL.md to name its reference files');
  for (const file of named) {
    assert.ok(existsSync(join(skillDir, 'references', file)), `SKILL.md references missing file ${file}`);
  }
});

test('every platform the CLI accepts has a guide', async () => {
  const { PLATFORMS } = await import('../core/project.mjs');
  for (const platform of Object.keys(PLATFORMS)) {
    assert.ok(
      existsSync(join(skillDir, 'references', 'platforms', `${platform}.md`)),
      `no guide for ${platform}`,
    );
  }
});

test('the frontmatter name matches the directory name, and the description fits', () => {
  const name = skill.match(/^---\n[\s\S]*?name:\s*(\S+)/)?.[1];
  assert.equal(name, skillDir.split('/').pop());
  const description = skill.match(/^---\n[\s\S]*?description:\s*(.+)/)?.[1] ?? '';
  assert.ok(description.length > 100 && description.length <= 1024, `description is ${description.length} chars`);
});

test('untested procedures are labelled as such', () => {
  // These describe admin UIs nobody has driven yet. When one is verified, its warning
  // should go — and this test should be updated deliberately, not silently.
  for (const file of ['craft-apply.md', 'wordpress.md', 'shopify.md', 'squarespace.md']) {
    const body = readFileSync(join(skillDir, 'references', 'platforms', file), 'utf8');
    assert.match(body, /not been tested|not yet tried|unverified/i, file);
  }
});

test('nothing in the skill is tied to one particular site', () => {
  for (const file of [join(scripts, 'site.mjs'), join(scripts, 'adapters', 'craft', 'client.mjs'), join(skillDir, 'SKILL.md')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /ks-us-ca-1849|digistormhosting/i, file);
  }
});
