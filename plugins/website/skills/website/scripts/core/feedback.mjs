// A feedback bundle: one zip holding what this site's project folder has learned,
// plus readable transcripts of the sessions, for the user to send to the skill author.
//
// Only the project's own notes and reports go in, redacted. Never the content export,
// snapshots, images, or anything outside the project folder.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { today } from './cli.mjs';
import { redact } from './redact.mjs';
import { renderTranscript } from './transcript.mjs';
import { zipFiles } from './zip.mjs';

export const MAX_FILE_BYTES = 400 * 1024;

// The project files worth sending, each with the line the README gives it.
const PROJECT_FILES = [
  ['SITE.md', 'Overview of the site and the dated notes kept between sessions'],
  ['site.yaml', "Machine-readable facts about the site and the skill's saved state"],
  ['site.json', "Machine-readable facts about the site and the skill's saved state (older format)"],
  ['learnings.md', 'Dated log of what each session did and learned'],
  ['TODO.md', 'Things found to fix or improve on the site'],
  ['admin-guide.md', "How this site's admin actually behaves"],
  ['platform-findings.md', 'What this site taught us about its platform'],
  ['design/system/DESIGN-SYSTEM.md', "The site's design system, as captured"],
  ['design/blocks.md', 'The blocks and sections the site uses'],
  ['design/available-blocks.md', 'The blocks the platform offers on this site'],
];

const NEWEST_AUDITS = 3;
const TEXT_EXT = /^\.(md|markdown|txt|ya?ml|json|csv|log)$/i;
const NEVER = /^(export|snapshots)(\/|$)/; // content exports and screenshots stay home

/** The site's host without `www.`, the way projects are named. */
const hostOf = (url) => new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).host.replace(/^www\./, '');

const toPosix = (p) => p.split(sep).join('/');

/** `name` relative to the project, or null when it points outside it (symlinks included). */
function insideProject(root, file) {
  const full = resolve(root, file);
  let real = full;
  try {
    real = realpathSync(full);
  } catch {
    // missing; checked by the caller
  }
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // ditto
  }
  const rel = relative(realRoot, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosix(relative(root, full));
}

/** Markdown files in a project subfolder, newest first. */
function markdownIn(root, folder) {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && statSync(join(dir, name)).isFile())
    .map((name) => ({ name: `${folder}/${name}`, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
    .map((f) => f.name);
}

/** "2026-11-06" from an ISO timestamp, or the file's own date. */
const dayOf = (iso, file) => {
  if (iso && !Number.isNaN(Date.parse(iso))) return new Date(iso).toISOString().slice(0, 10);
  try {
    return statSync(file).mtime.toISOString().slice(0, 10);
  } catch {
    return today();
  }
};

/** What `findTranscripts` returns, or just a path. */
const asTranscript = (t) => (typeof t === 'string' ? { file: t } : t);

function readme({ host, site, date, skillVersion, files, skipped, transcriptCount }) {
  const platform = site.platformName ?? site.platform ?? 'not recorded';
  const lines = [
    `# Website skill feedback: ${host}`,
    '',
    'Feedback from using the website skill, for the skill author. It holds what the',
    "skill's project folder for this site has learned, and readable transcripts of the",
    'sessions, so the skill can be improved.',
    '',
    `- Site: ${site.url ?? host}`,
    `- Platform: ${platform}`,
    `- Skill version: ${skillVersion ?? 'not recorded'}`,
    `- Bundled: ${date}`,
    `- Sessions: ${transcriptCount}`,
    '',
    '## Files',
    '',
    ...files.map((f) => `- \`${f.name}\` — ${f.about}`),
    '',
  ];
  if (skipped.length) {
    lines.push('## Left out', '', ...skipped.map((s) => `- \`${s.name}\` — ${s.why}`), '');
  }
  lines.push(
    '## Privacy',
    '',
    'Email addresses and phone numbers were replaced with [email] and [phone], and anything',
    'that looked like a password, token or cookie with [secret]; the home folder in paths',
    'reads as ~. Transcripts leave out',
    "Claude's thinking, screenshots and instructions the app added, and shorten each tool",
    "call and its result to one line. The site's content export, snapshots and images are",
    'not included.',
    '',
  );
  return lines.join('\n');
}

/**
 * Write the feedback zip for a project.
 *   project: { paths: { root }, site: { url, platform, platformName } }
 *   transcripts: [{ file, sessionId, firstAt }] from findTranscripts, or paths
 *   extraFiles: more project files to include (paths relative to the project, or absolute),
 *               or generated ones as { name, data }
 * Returns { zipPath, included: [names inside the top folder], skipped: [{ name, why }] }.
 */
export function buildFeedback(project, { transcripts = [], extraFiles = [], outDir, skillVersion = null, date = today() } = {}) {
  const root = resolve(project.paths.root);
  const site = project.site ?? {};
  const host = site.url ? hostOf(site.url) : basename(root);
  const top = `website-feedback-${host}-${date}`;
  const files = []; // { name, data, about, mtime }
  const skipped = [];
  const taken = new Set();

  const add = (name, text, about, mtime) => {
    const data = Buffer.from(redact(text), 'utf8');
    if (data.length > MAX_FILE_BYTES) {
      skipped.push({ name, why: `over ${MAX_FILE_BYTES / 1024} KB (${Math.round(data.length / 1024)} KB)` });
      return;
    }
    files.push({ name, data, about, mtime });
    taken.add(name);
  };

  const addProjectFile = (rel, about) => {
    if (taken.has(rel)) return;
    const full = join(root, rel);
    const size = statSync(full).size;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ name: rel, why: `over ${MAX_FILE_BYTES / 1024} KB (${Math.round(size / 1024)} KB)` });
      return;
    }
    add(rel, readFileSync(full, 'utf8'), about, statSync(full).mtime);
  };

  // The project's own notes and reports.
  const hasYaml = existsSync(join(root, 'site.yaml'));
  for (const [rel, about] of PROJECT_FILES) {
    if (rel === 'site.json' && hasYaml) continue; // the legacy file only when there is no site.yaml
    if (existsSync(join(root, rel)) && insideProject(root, rel)) addProjectFile(rel, about);
  }
  for (const rel of markdownIn(root, 'audits').slice(0, NEWEST_AUDITS)) {
    addProjectFile(rel, `Site review or audit (${basename(rel, '.md')})`);
  }
  for (const rel of markdownIn(root, 'feedback')) {
    addProjectFile(rel, 'Notes written for the skill author');
  }

  // Anything else the caller asked for, within the same rules.
  for (const extra of extraFiles) {
    if (extra && typeof extra === 'object' && 'data' in extra) {
      const name = toPosix(String(extra.name)).replace(/^\/+/, '');
      if (!name || name.split('/').includes('..') || NEVER.test(name)) skipped.push({ name: String(extra.name), why: 'not a name allowed in the bundle' });
      else if (!TEXT_EXT.test(extname(name))) skipped.push({ name, why: 'not a text file' });
      else add(name, String(extra.data), extra.about ?? 'Added for this feedback');
      continue;
    }
    const rel = insideProject(root, String(extra));
    const shown = rel ?? String(extra);
    if (!rel) skipped.push({ name: basename(shown), why: 'outside the project folder' });
    else if (NEVER.test(rel)) skipped.push({ name: rel, why: 'content exports and snapshots are never included' });
    else if (!existsSync(join(root, rel)) || !statSync(join(root, rel)).isFile()) skipped.push({ name: rel, why: 'not found' });
    else if (!TEXT_EXT.test(extname(rel))) skipped.push({ name: rel, why: 'not a text file (images and binaries are never included)' });
    else addProjectFile(rel, 'Added for this feedback');
  }

  // Sessions, rendered readable.
  let transcriptCount = 0;
  for (const t of transcripts.map(asTranscript)) {
    const sessionId = t.sessionId ?? basename(t.file, '.jsonl');
    const day = dayOf(t.firstAt, t.file);
    let name = `transcripts/${day}-${sessionId.slice(0, 8)}.md`;
    for (let n = 2; taken.has(name); n++) name = `transcripts/${day}-${sessionId.slice(0, 8)}-${n}.md`;
    let jsonl;
    try {
      jsonl = readFileSync(t.file, 'utf8');
    } catch (err) {
      skipped.push({ name, why: `could not read the session (${err.code ?? err.message})` });
      continue;
    }
    const markdown = renderTranscript(jsonl, { title: `Session ${sessionId.slice(0, 8)} (${day})` });
    if (/_No conversation found in this session\._/.test(markdown)) {
      skipped.push({ name, why: 'no conversation in the session' });
      continue;
    }
    const before = files.length;
    add(name, markdown, `Transcript of the session on ${day}`, t.lastAt ? new Date(t.lastAt) : undefined);
    if (files.length > before) transcriptCount++;
  }

  const included = ['README.md', ...files.map((f) => f.name)];
  const readmeText = readme({ host, site, date, skillVersion, files, skipped, transcriptCount });
  const entries = [
    { name: `${top}/README.md`, data: redact(readmeText) },
    ...files.map((f) => ({ name: `${top}/${f.name}`, data: f.data, mtime: f.mtime })),
  ];

  const dir = resolve(outDir ?? join(root, 'feedback'));
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, `${top}.zip`);
  writeFileSync(zipPath, zipFiles(entries));
  return { zipPath, included, skipped };
}
