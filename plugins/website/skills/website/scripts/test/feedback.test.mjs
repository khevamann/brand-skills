// The feedback bundle: a real zip, nothing personal or secret in it, transcripts a
// person can read, and only this project's own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipFiles, crc32 } from '../core/zip.mjs';
import { redact } from '../core/redact.mjs';
import { renderTranscript, findTranscripts } from '../core/transcript.mjs';
import { buildFeedback } from '../core/feedback.mjs';

const fresh = (prefix = 'site-feedback-') => mkdtempSync(join(tmpdir(), prefix));

const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const UNZIP = has('unzip', ['-v']);
const PYTHON = has('python3', ['--version']);

/**
 * { name: text } for every file in a zip, read by tools other than ours: `unzip -t`
 * checks structure and CRCs; Python's zipfile reads it (and honours the UTF-8 flag,
 * which macOS's unzip does not).
 */
function readZip(file) {
  const script = [
    'import sys, zipfile, json, base64',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'print(json.dumps({i.filename: base64.b64encode(z.read(i)).decode() for i in z.infolist()}))',
  ].join('\n');
  if (UNZIP) execFileSync('unzip', ['-tq', file]); // throws on a bad CRC or structure
  if (!PYTHON) {
    const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const read = (n) => {
      try {
        return execFileSync('unzip', ['-p', file, n], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return null; // an unzip built without UTF-8 name support
      }
    };
    return Object.fromEntries(names.map((n) => [n, read(n)]));
  }
  const encoded = JSON.parse(execFileSync('python3', ['-I', '-c', script, file], { encoding: 'utf8' }));
  return Object.fromEntries(Object.entries(encoded).map(([n, b64]) => [n, Buffer.from(b64, 'base64').toString('utf8')]));
}
const canReadZips = UNZIP || PYTHON;

// ── zip ─────────────────────────────────────────────────────────────────────

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('a zip round-trips through unzip or Python, deflated and stored, UTF-8 names', { skip: !canReadZips && 'no unzip or python3' }, () => {
  const dir = fresh();
  const big = 'The same line again and again.\n'.repeat(500);
  const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256)); // won't shrink
  const zip = zipFiles([
    { name: 'bundle/README.md', data: big, mtime: new Date('2026-11-06T10:47:00Z') },
    { name: 'bundle/notes/café — ünïcode.md', data: 'Héllo ✓' },
    { name: 'bundle/raw.bin', data: random },
    { name: 'bundle/empty.txt', data: '' },
  ]);
  assert.ok(zip.length < big.length, 'repetitive text should be deflated');
  const file = join(dir, 'out.zip');
  writeFileSync(file, zip);
  const files = readZip(file);
  assert.equal(files['bundle/README.md'], big);
  if (PYTHON) assert.equal(files['bundle/notes/café — ünïcode.md'], 'Héllo ✓');
  assert.equal(files['bundle/empty.txt'], '');
  if (PYTHON) assert.equal(files['bundle/raw.bin'], random.toString('utf8'));
  assert.equal(Object.keys(files).length, 4);
});

test('zip refuses names that escape the folder', () => {
  assert.throws(() => zipFiles([{ name: '../evil.md', data: 'x' }]), /Bad zip entry name/);
  assert.throws(() => zipFiles([{ name: 'a/../../evil.md', data: 'x' }]), /Bad zip entry name/);
});

// ── redact ──────────────────────────────────────────────────────────────────

test('redact replaces emails and phone numbers', () => {
  const cases = [
    ['Write to jane.doe+web@example.co.uk today', 'Write to [email] today'],
    ['office@example.org.', '[email].'],
    ['Call (555) 123-4567.', 'Call [phone].'],
    ['555-123-4567 or 555.123.4567 or 555 123 4567', '[phone] or [phone] or [phone]'],
    ['1-800-555-0199', '[phone]'],
    ['+1 555 123 4567, +44 20 7946 0958, +33 1 23 45 67 89', '[phone], [phone], [phone]'],
    ['tel: 020 7946 0958 / 07700 900123', 'tel: [phone] / [phone]'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input, { home: null }), expected, input);
});

test('redact leaves dates, times, prices, colours, ids, versions and file names alone', () => {
  const keep = [
    'Published 2026-11-06 at 10:47:12, updated 2026-11-06T20:45:58.868Z',
    'Range 2024-2026, 06/11/2026, 11.06.2026',
    'Price $1,234.56, €12.50, 1,234,567 visitors, 45%',
    'Colours #555123 #a1b2c3 #fff',
    'https://example.com/products/1234567890123?variant=40123456789012',
    'Entry 12345678901, order 1234567890',
    'uuid 12345678-1234-1234-1234-123456789012 and 3e97375d-bdc8-4da0-8a73-fb8761298424',
    'Craft 4.10.2, Windows 10.0.19045.1234, IP 192.168.100.200, node v18.19.0',
    'logo@2x.png, @types/node, lodash@4.17.21',
    '/entries/555-123-4567 and $555-123-4567',
    'input_tokens: 1234, max_tokens=5, Bearer authentication, git checkout -b feature',
  ];
  for (const text of keep) assert.equal(redact(text, { home: null }), text, text);
});

test('redact drops secrets', () => {
  const cases = [
    ['Authorization: Bearer abc.def.ghi123456789', 'Authorization: [secret]'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz" url', 'curl -H "Authorization: [secret]" url'],
    ['token is Bearer eyJhbGciOiJIUzI1NiJ9xyz123', 'token is Bearer [secret]'],
    ['-H "Cookie: CraftSessionId=abc123; x=y"', '-H "Cookie: [secret]"'],
    ['Set-Cookie: sid=abc; HttpOnly', 'Set-Cookie: [secret]'],
    ['curl --cookie sid=abc123 url', 'curl --cookie [secret] url'],
    ['password=hunter22&user=x', 'password=[secret]&user=x'],
    ['{"password": "s3cret!", "api_key": "k-123"}', '{"password": "[secret]", "api_key": "[secret]"}'],
    ['SHOPIFY_ACCESS_TOKEN=shpat_0123456789abcdef0123456789abcdef', 'SHOPIFY_ACCESS_TOKEN=[secret]'],
    ['?token=abc123&next=1', '?token=[secret]&next=1'],
    ['https://admin:pw123@example.com/x', 'https://[secret]@example.com/x'],
    ['key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'key [secret]'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input, { home: null }), expected, input);
  assert.equal(redact('token=${SITE_TOKEN}', { home: null }), 'token=${SITE_TOKEN}', 'a variable reference is not a secret');
});

test('redact shortens the home folder to ~', () => {
  assert.equal(redact('cd /Users/someone/Sites/x', { home: '/Users/someone' }), 'cd ~/Sites/x');
});

// ── transcripts ─────────────────────────────────────────────────────────────

const line = (o) => JSON.stringify(o);
const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890';
const syntheticJsonl = (cwd = '/work/site') =>
  [
    line({ type: 'summary', summary: 'Website work' }),
    line({ type: 'user', timestamp: '2026-11-05T23:58:00Z', cwd, sessionId: SESSION,
      message: { role: 'user', content: 'Please check the homepage. Reach me at owner@example.com or (555) 123-4567.' } }),
    line({ type: 'user', timestamp: '2026-11-05T23:58:01Z', cwd, sessionId: SESSION, isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /plugins/website/skills/website\n\n# Website\nLots of instructions…' }] } }),
    line({ type: 'assistant', timestamp: '2026-11-05T23:59:00Z', cwd, sessionId: SESSION,
      message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'secret inner thoughts' },
        { type: 'text', text: 'Let me look at the site.' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { description: 'Detect the platform', command: `node site.mjs detect https://example.com ${'--flag '.repeat(40)}` } },
        { type: 'tool_use', id: 'tu2', name: 'WebFetch', input: { url: 'https://example.com/about', prompt: 'Summarise' } },
      ] } }),
    '{"type": "assistant", this line is broken',
    line({ type: 'user', timestamp: '2026-11-06T00:00:05Z', cwd, sessionId: SESSION,
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: 'About page\nwith two lines' }, { type: 'image', source: {} }] },
        { type: 'tool_result', tool_use_id: 'tu1', content: `Platform: craft\n${'x'.repeat(400)}` },
      ] } }),
    line({ type: 'user', timestamp: '2026-11-06T00:01:00Z', cwd, sessionId: SESSION,
      message: { role: 'user', content: [
        { type: 'text', text: 'Here is a screenshot <system-reminder>Do not mention this.</system-reminder>' },
        { type: 'image', source: { type: 'base64', data: 'AAAA' } },
      ] } }),
    line({ type: 'user', timestamp: '2026-11-06T00:01:30Z', cwd, sessionId: SESSION,
      message: { role: 'user', content: '<command-message>website</command-message>\n<command-name>/website</command-name>\n<command-args>feedback</command-args>' } }),
    line({ type: 'assistant', timestamp: '2026-11-06T00:02:00Z', cwd, sessionId: SESSION,
      message: { role: 'assistant', content: [{ type: 'text', text: 'It is Craft CMS.' }] } }),
    line({ type: 'assistant', isSidechain: true, timestamp: '2026-11-06T00:02:30Z', message: { role: 'assistant', content: 'sub-agent chatter' } }),
    line({ type: 'api-request-blob', message: { content: [{ type: 'text', text: 'request blob text' }] } }),
  ].join('\n');

test('a transcript renders speech in full and tool calls as one line each', () => {
  const md = renderTranscript(syntheticJsonl(), { title: 'Session abcdef12' });
  assert.match(md, /^# Session abcdef12\n/);
  // A heading per UTC day.
  assert.match(md, /## 2026-11-05[\s\S]*## 2026-11-06/);
  assert.match(md, /\*\*User\*\* \(23:58 UTC\):\n\nPlease check the homepage\. Reach me at \[email\] or \[phone\]\./);
  assert.match(md, /\*\*Claude\*\* \(23:59 UTC\):\n\nLet me look at the site\./);
  assert.match(md, /\[skill instructions loaded: website\]/);
  assert.doesNotMatch(md, /Lots of instructions/);
  assert.doesNotMatch(md, /secret inner thoughts/);
  assert.doesNotMatch(md, /Do not mention this/);
  assert.match(md, /Here is a screenshot \[system reminder omitted\]/);
  assert.match(md, /\[image\]/);
  assert.match(md, /^\/website feedback$/m);
  assert.doesNotMatch(md, /sub-agent chatter|request blob text|this line is broken/);

  const lines = md.split('\n');
  const bash = lines.findIndex((l) => l.startsWith('- `Bash` Detect the platform — `node site.mjs detect'));
  assert.ok(bash >= 0, 'Bash call line');
  assert.ok(lines[bash].length <= 160);
  assert.match(lines[bash + 1], /^ {4}↳ Platform: craft x+…$/, 'result under its own call');
  assert.ok(lines[bash + 1].replace(/^ {4}↳ /, '').length <= 200);
  assert.equal(lines[bash + 2], '- `WebFetch` — `https://example.com/about`');
  assert.equal(lines[bash + 3], '    ↳ About page with two lines [image]');
  assert.match(md, /\*\*Claude\*\* \(00:02 UTC\):\n\nIt is Craft CMS\./);
});

test('a transcript with nothing usable says so instead of failing', () => {
  const md = renderTranscript('not json\n{"type":"user"}\n\n', { title: 'Empty' });
  assert.match(md, /No conversation found/);
});

/** A roots folder laid out like ~/.claude/projects. */
function transcriptRoots(project) {
  const roots = fresh('site-roots-');
  const write = (folder, name, text, ageDays = 0) => {
    mkdirSync(join(roots, folder), { recursive: true });
    const file = join(roots, folder, name);
    writeFileSync(file, text);
    const when = new Date(Date.now() - ageDays * 86400000);
    utimesSync(file, when, when);
    return file;
  };
  const session = (cwd, at, extra = '') =>
    `${line({ type: 'user', timestamp: at, cwd, sessionId: `s-${at}`, message: { role: 'user', content: `hello ${extra}` } })}\n`;
  return {
    roots,
    inside: write('a', 'inside.jsonl', session(join(project, 'audits'), '2026-11-02T10:00:00Z')),
    exact: write('b', 'exact.jsonl', session(project, '2026-11-01T10:00:00Z')),
    parentWithHost: write('c', 'parent.jsonl', session(join(project, '..'), '2026-11-03T10:00:00Z', 'working on example.com')),
    parentNoHost: write('c', 'parent-other.jsonl', session(join(project, '..'), '2026-11-04T10:00:00Z', 'other site')),
    elsewhere: write('d', 'elsewhere.jsonl', session('/somewhere/else', '2026-11-04T10:00:00Z', 'example.com')),
    old: write('a', 'old.jsonl', session(project, '2026-08-01T10:00:00Z'), 90),
    tooDeep: write('a/s/subagents', 'deep.jsonl', session(project, '2026-11-05T10:00:00Z')),
  };
}

test('findTranscripts keeps sessions in or around the project, recent ones only, oldest first', () => {
  const project = fresh('site-proj-');
  const t = transcriptRoots(project);
  const found = findTranscripts({ projectRoot: project, host: 'example.com', roots: [t.roots, join(t.roots, 'missing')] });
  assert.deepEqual(found.map((f) => f.file), [t.exact, t.inside, t.parentWithHost]);
  assert.equal(found[0].sessionId, 's-2026-11-01T10:00:00Z');
  assert.equal(found[0].firstAt, '2026-11-01T10:00:00Z');
  assert.equal(findTranscripts({ projectRoot: project, host: 'example.com', roots: [t.roots], sinceDays: 120 }).length, 4);
});

test('findTranscripts does not throw when the roots do not exist', () => {
  assert.deepEqual(findTranscripts({ projectRoot: fresh(), host: 'x.com', roots: ['/no/such/folder'] }), []);
});

// ── the bundle ──────────────────────────────────────────────────────────────

function sampleProject() {
  const root = fresh('site-proj-');
  const put = (rel, text, ageDays = 0) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
    const when = new Date(Date.now() - ageDays * 86400000);
    utimesSync(join(root, rel), when, when);
  };
  put('SITE.md', '# example.com\n\nOwner: owner@example.com, 555-123-4567\n');
  put('site.yaml', 'url: https://www.example.com\nplatform: craft\n');
  put('site.json', '{"legacy": true}\n');
  put('learnings.md', '- 2026-11-06 — export worked\n');
  put('platform-findings.md', '# Findings\n');
  put('design/system/DESIGN-SYSTEM.md', '# Design system\n');
  put('design/blocks.md', '# Blocks\n');
  put('audits/review-2026-11-01.md', 'oldest', 4);
  put('audits/review-2026-11-02.md', 'old', 3);
  put('audits/layout-2026-11-03.md', 'newer', 2);
  put('audits/review-2026-11-04.md', 'newest', 1);
  put('feedback/notes.md', 'The owner says onboarding took too long. password=hunter22\n');
  put('export/entries.json', '{}');
  put('snapshots/home.png', 'png');
  put('huge.md', 'x'.repeat(401 * 1024));
  put('notes/extra.md', 'Extra note.\n');
  put('notes/photo.png', 'png');
  const outside = join(fresh('site-outside-'), 'secret.md');
  writeFileSync(outside, 'not part of the project');
  const transcript = join(fresh('site-t-'), `${SESSION}.jsonl`);
  writeFileSync(transcript, syntheticJsonl(root));
  return {
    root, outside, transcript,
    project: { paths: { root }, site: { url: 'https://www.example.com', platform: 'craft', platformName: 'Craft CMS' } },
  };
}

test('buildFeedback bundles the project, redacted, under one named folder', { skip: !canReadZips && 'no unzip or python3' }, () => {
  const s = sampleProject();
  const result = buildFeedback(s.project, {
    transcripts: [{ file: s.transcript, sessionId: SESSION, firstAt: '2026-11-05T23:58:00Z' }],
    extraFiles: ['notes/extra.md', 'notes/photo.png', 'export/entries.json', s.outside, 'huge.md',
      { name: 'feedback/summary.md', data: 'Call me on +44 20 7946 0958' }],
    skillVersion: '0.6.0',
    date: '2026-11-07',
  });
  const top = 'website-feedback-example.com-2026-11-07';
  assert.equal(result.zipPath, join(s.root, 'feedback', `${top}.zip`));

  assert.deepEqual(result.included.sort(), [
    'README.md', 'SITE.md', 'audits/layout-2026-11-03.md', 'audits/review-2026-11-02.md', 'audits/review-2026-11-04.md',
    'design/blocks.md', 'design/system/DESIGN-SYSTEM.md', 'feedback/notes.md', 'feedback/summary.md', 'learnings.md',
    'notes/extra.md', 'platform-findings.md', 'site.yaml', `transcripts/2026-11-05-abcdef12.md`,
  ]);
  const why = Object.fromEntries(result.skipped.map((x) => [x.name, x.why]));
  assert.match(why['huge.md'], /over 400 KB/);
  assert.match(why['notes/photo.png'], /not a text file/);
  assert.match(why['export/entries.json'], /never included/);
  assert.match(why['secret.md'], /outside the project/);

  const files = readZip(result.zipPath);
  assert.ok(Object.keys(files).every((n) => n.startsWith(`${top}/`)));
  assert.match(files[`${top}/SITE.md`], /Owner: \[email\], \[phone\]/);
  assert.match(files[`${top}/feedback/notes.md`], /password=\[secret\]/);
  assert.match(files[`${top}/feedback/summary.md`], /\[phone\]/);
  assert.match(files[`${top}/transcripts/2026-11-05-abcdef12.md`], /\*\*User\*\*/);
  assert.equal(files[`${top}/audits/review-2026-11-01.md`], undefined, 'only the 3 newest audits');

  const readme = files[`${top}/README.md`];
  assert.match(readme, /for the skill author/);
  assert.match(readme, /Platform: Craft CMS/);
  assert.match(readme, /Skill version: 0\.6\.0/);
  assert.match(readme, /2026-11-07/);
  assert.match(readme, /`SITE\.md` — /);
  assert.match(readme, /`transcripts\/2026-11-05-abcdef12\.md` — Transcript of the session on 2026-11-05/);
  assert.match(readme, /\[email\] and \[phone\]/);
});

test('buildFeedback falls back to site.json and honours outDir', () => {
  const root = fresh('site-proj-');
  writeFileSync(join(root, 'site.json'), '{"url": "https://example.org"}\n');
  const outDir = fresh('site-out-');
  const result = buildFeedback({ paths: { root }, site: { url: 'https://example.org', platform: 'other' } }, { outDir, date: '2026-11-07' });
  assert.equal(result.zipPath, join(outDir, 'website-feedback-example.org-2026-11-07.zip'));
  assert.deepEqual(result.included, ['README.md', 'site.json']);
  assert.ok(readFileSync(result.zipPath).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
});
