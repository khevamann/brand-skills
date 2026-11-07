// site.yaml is read by the scripts and edited by hand. These pin that what the writer
// emits reads back unchanged, and that ordinary hand-written YAML reads as expected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml, YamlError } from '../core/yaml.mjs';

test('what the writer emits reads back to the same value', () => {
  const value = {
    url: 'https://www.example.com',
    platform: 'squarespace',
    confirmedBy: 'user',
    detectedAt: '2026-11-07',
    count: 12,
    ratio: 0.5,
    on: true,
    nothing: null,
    empty: {},
    none: [],
    tricky: ['yes', 'null', '12', '- dash', 'a: b', 'x #y', ' padded', '', "it's", '"q"', '#hash', 'café ✓'],
    detection: { platform: 'squarespace', confidence: 'high', evidence: ['Static.SQUARESPACE_CONTEXT', 'site.css'] },
    pages: [
      { path: '/', title: 'Home', children: [] },
      { path: '/about', title: 'About: us', children: [{ path: '/about/team', title: 'Team' }] },
    ],
    nested: [[1, 2], ['a']],
    multi: 'line one\nline two\n',
    multiNoEnd: 'first\n\nthird',
    'odd key': 1,
    '2026': 'year',
  };
  const text = stringifyYaml(value, { header: ['Top comment', '', 'more'], comments: { platform: 'How it was decided' } });
  assert.deepEqual(parseYaml(text), value);
  assert.match(text, /^# Top comment\n#\n# more\n/);
  assert.match(text, /\n# How it was decided\nplatform: squarespace\n/);
});

test('hand-written YAML: comments, lists at key level, quotes, block strings, flow', () => {
  const doc = `
# settings
preferences:
  publishing: ask-first   # the default
  notes:
  - Keep copy fixes and design changes separate
  - 'Don''t touch Admissions'
account:
  role: owner
  plan: "Business"
  twoFactor: yes
structure:
  shared: [header, footer, "announcement bar"]
  sizes: {phone: 390, desktop: 1280}
about: |
  First line
  Second line
folded: >-
  one
  two
after: done
`;
  assert.deepEqual(parseYaml(doc), {
    preferences: {
      publishing: 'ask-first',
      notes: ['Keep copy fixes and design changes separate', "Don't touch Admissions"],
    },
    account: { role: 'owner', plan: 'Business', twoFactor: true },
    structure: { shared: ['header', 'footer', 'announcement bar'], sizes: { phone: 390, desktop: 1280 } },
    about: 'First line\nSecond line\n',
    folded: 'one two',
    after: 'done',
  });
});

test('an empty document is an empty map, and a URL with a colon stays a string', () => {
  assert.deepEqual(parseYaml(''), {});
  assert.deepEqual(parseYaml('# only a comment\n'), {});
  assert.deepEqual(parseYaml('url: https://a.example/x#frag\n'), { url: 'https://a.example/x#frag' });
});

test('mistakes are reported with the line number', () => {
  assert.throws(() => parseYaml('a: 1\n   b: 2\n'), /line 2/);
  assert.throws(() => parseYaml('a: 1\na: 2\n'), /appears twice/);
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), YamlError);
  assert.throws(() => parseYaml('list: [a, [b]]\n'), /nested/);
});
