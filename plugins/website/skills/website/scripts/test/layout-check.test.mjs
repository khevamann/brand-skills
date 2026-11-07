// browser/layout-check.js is pasted into a browser's javascript tool, not imported, so
// nothing here can run it. What can break without a browser: it stops parsing, a rerun
// in the same tab collides with its own declarations, the header stops matching what it
// returns, or it starts touching the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../browser/layout-check.js', import.meta.url)), 'utf8');
const header = src.slice(0, src.indexOf('\n(async'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('parses as a script and as an async function body, after the options line', () => {
  assert.doesNotThrow(() => new Function(`var OPTIONS = { pages: ['/'] };\n${src}`));
  assert.doesNotThrow(() => new AsyncFunction(`var OPTIONS = { pages: ['/'] };\n${src}`));
  assert.doesNotThrow(() => new Function(src), 'runs without an options line too');
});

test('is one expression, so the tool returns its value and a rerun declares nothing', () => {
  const code = src.replace(/^\s*\/\/.*$/gm, '').trim();
  assert.match(code, /^\(async \(OPTIONS\) => \{/);
  assert.match(code, /\}\)\(typeof OPTIONS === 'undefined' \? \{\} : OPTIONS\)\s*\.catch\([^;]*\);$/);
});

test('the header documents how to call it and what comes back', () => {
  assert.match(header, /var OPTIONS = \{ pages: \[/);
  for (const word of ['window.__layoutCheck', 'here: true', 'notChecked', 'budgetMs', 'widths', 'refused']) {
    assert.ok(header.includes(word), `header mentions ${word}`);
  }
  const kinds = new Set([...src.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(kinds.size >= 8);
  for (const kind of kinds) assert.ok(header.includes(kind), `header lists the ${kind} kind`);
});

test('reads only: no clicks, submits, writes or storage', () => {
  for (const bad of [/\.click\(/, /\.submit\(/, /dispatchEvent/, /method:\s*['"](POST|PUT|PATCH|DELETE)/i,
    /localStorage|sessionStorage/, /document\.cookie\s*=/]) {
    assert.doesNotMatch(src, bad);
  }
  assert.match(src, /sandbox', 'allow-same-origin allow-scripts'/);
});
