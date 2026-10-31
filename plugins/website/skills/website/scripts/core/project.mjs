// The project folder: one folder per website, holding everything the skill produces
// and everything it has learned. A new session opened in the same folder reads it
// and carries on, so nobody has to keep one long conversation alive.
//
//   SITE.md         overview + dated notes. Read first, every session.
//   site.json       machine-readable facts and state
//   learnings.md    dated run log
//   TODO.md         things to fix or improve, found as work goes; raised each session
//   admin-guide.md  how this site's admin actually behaves (written once explored)
//   platform-findings.md  what this project taught us about the platform (see findings.mjs)
//   export/ audits/ design/ snapshots/
//   CLAUDE.md       a marked block pointing at SITE.md, so new sessions find it
//
// Nothing here is ever written to the plugin directory: that is replaced on update.
// Credentials are never written anywhere.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SiteError, today } from './cli.mjs';
import { ensureFindings } from './findings.mjs';

export const PLATFORMS = {
  craft: 'Craft CMS',
  wordpress: 'WordPress',
  shopify: 'Shopify',
  squarespace: 'Squarespace',
  other: 'Other',
};

export const CLAUDE_MD_START = '<!-- website-skill:start -->';
export const CLAUDE_MD_END = '<!-- website-skill:end -->';

const NOTES_HEADING = '## Notes';

/** A site's address reduced to its host, without `www.`: how sites are matched and named. */
export const bareHost = (url) => new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).host.replace(/^www\./, '');

/** Nothing in the folder but hidden files. */
export function isEmptyFolder(dir) {
  return !existsSync(dir) || readdirSync(dir).every((name) => name.startsWith('.'));
}

/** Projects in the immediate subfolders of `dir`: a folder that holds several sites. */
export function findProjects(dir = '.') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isDirectory())
    .map((name) => loadProject(join(dir, name)))
    .filter(Boolean);
}

/**
 * Which project a command is about. The folder itself when it is a project; otherwise
 * one of its subfolders — the one for `host` if given, or the only one there is. Users
 * attach whatever folder they have to hand, so a site's project may sit one level down.
 */
export function resolveProject(dir = '.', { host = null } = {}) {
  const here = loadProject(dir);
  if (here) return { project: here, candidates: [here] };
  const candidates = findProjects(dir);
  if (host) return { project: candidates.find((p) => bareHost(p.site.url) === host) ?? null, candidates };
  return { project: candidates.length === 1 ? candidates[0] : null, candidates };
}

/**
 * Where a new project for `url` goes: the folder itself when it is empty, otherwise a
 * subfolder named after the site, so nothing already there is mixed in with it.
 */
export function newProjectFolder(dir, url) {
  return isEmptyFolder(dir) ? dir : join(dir, bareHost(url));
}

/** Paths inside a project folder. */
export function projectPaths(dir) {
  const root = resolve(dir);
  return {
    root,
    siteJson: join(root, 'site.json'),
    siteMd: join(root, 'SITE.md'),
    learnings: join(root, 'learnings.md'),
    todo: join(root, 'TODO.md'),
    adminGuide: join(root, 'admin-guide.md'),
    claudeMd: join(root, 'CLAUDE.md'),
    export: join(root, 'export'),
    audits: join(root, 'audits'),
    design: join(root, 'design'),
    snapshots: join(root, 'snapshots'),
  };
}

/** The project in `dir`, or null when the folder has not been set up. */
export function loadProject(dir = '.') {
  const paths = projectPaths(dir);
  if (!existsSync(paths.siteJson)) return null;
  let site;
  try {
    site = JSON.parse(readFileSync(paths.siteJson, 'utf8'));
  } catch (err) {
    throw new SiteError(`${paths.siteJson} is not valid JSON: ${err.message}`);
  }
  return { paths, site };
}

export function saveSite(project) {
  writeFileSync(project.paths.siteJson, JSON.stringify(project.site, null, 2) + '\n');
}

/**
 * Record a piece of machine state, e.g. the last export, and save. Paths inside the
 * project are stored relative to it, so the folder can be moved or synced.
 */
export function recordState(project, key, value) {
  const rel = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      typeof v === 'string' && v.startsWith(project.paths.root) ? relative(project.paths.root, v) || '.' : v,
    ]),
  );
  project.site.state = { ...(project.site.state ?? {}), [key]: { ...rel, at: new Date().toISOString() } };
  saveSite(project);
}

/**
 * Set up a project folder. Refuses to overwrite an existing site.json, and never
 * touches a CLAUDE.md outside its own marked block.
 */
export function initProject(dir, { url, platform, confirmedBy, detection = null, extra = {} }) {
  if (!PLATFORMS[platform]) {
    throw new SiteError(
      `Unknown platform \`${platform}\`. Use one of: ${Object.keys(PLATFORMS).join(', ')}.`,
    );
  }
  const paths = projectPaths(dir);
  if (existsSync(paths.siteJson)) {
    throw new SiteError(`This folder is already set up (${paths.siteJson}). Run \`start\` to resume.`);
  }
  mkdirSync(paths.root, { recursive: true });

  const origin = new URL(url).origin;
  const site = {
    url: origin,
    platform,
    platformName: PLATFORMS[platform],
    confirmedBy,
    detectedAt: today(),
    detection: detection
      ? { platform: detection.platform, confidence: detection.confidence, evidence: detection.evidence }
      : null,
    ...extra,
    state: {},
  };
  const project = { paths, site };
  saveSite(project);

  if (!existsSync(paths.siteMd)) writeFileSync(paths.siteMd, siteMdTemplate(site));
  if (!existsSync(paths.learnings)) writeFileSync(paths.learnings, LEARNINGS_TEMPLATE);
  ensureTodo(project);
  ensureFindings(project);
  writeClaudeMdBlock(paths.claudeMd);
  return project;
}

/** Create TODO.md if it is missing (projects set up before it existed). Never overwrites. */
export function ensureTodo(project) {
  if (!existsSync(project.paths.todo)) writeFileSync(project.paths.todo, TODO_TEMPLATE);
}

/** The open items in TODO.md: unticked checkboxes, without the box. */
export function readTodos(project) {
  if (!existsSync(project.paths.todo)) return [];
  return readFileSync(project.paths.todo, 'utf8')
    .split('\n')
    .filter((l) => /^\s*- \[ \] /.test(l))
    .map((l) => l.replace(/^\s*- \[ \] /, '').trim());
}

/** Append a dated bullet under SITE.md's Notes heading. */
export function addNote(project, text) {
  const note = String(text ?? '').trim();
  if (!note) throw new SiteError('A note needs some text.');
  if (/password|passwd|api[_ -]?key|secret|token\s*[:=]/i.test(note)) {
    throw new SiteError('Notes must never hold passwords, keys or tokens. Leave the secret out.');
  }
  const { siteMd } = project.paths;
  const body = existsSync(siteMd) ? readFileSync(siteMd, 'utf8') : siteMdTemplate(project.site);
  const line = `- ${today()} — ${note.replace(/\s*\n\s*/g, ' ')}`;

  let next;
  const at = body.indexOf(NOTES_HEADING);
  if (at < 0) {
    next = `${body.trimEnd()}\n\n${NOTES_HEADING}\n\n${line}\n`;
  } else {
    // Insert at the end of the Notes section: before the next heading, or at EOF.
    const after = at + NOTES_HEADING.length;
    const nextHeading = body.slice(after).search(/\n## /);
    const end = nextHeading < 0 ? body.length : after + nextHeading;
    const head = body.slice(0, end).replace(/\n*$/, '').replace(/\n_No notes yet\._$/, '');
    next = `${head}\n${line}\n${body.slice(end)}`;
  }
  writeFileSync(siteMd, next);
  return line;
}

/** The Notes bullets from SITE.md, newest last. */
export function readNotes(project) {
  if (!existsSync(project.paths.siteMd)) return [];
  const body = readFileSync(project.paths.siteMd, 'utf8');
  const at = body.indexOf(NOTES_HEADING);
  if (at < 0) return [];
  const rest = body.slice(at + NOTES_HEADING.length);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((l) => l.startsWith('- '));
}

/**
 * Write or refresh the skill's block in CLAUDE.md. Content outside the markers
 * belongs to the user and is preserved exactly.
 */
export function writeClaudeMdBlock(file) {
  const block = [
    CLAUDE_MD_START,
    '## This folder is a website project',
    '',
    'Before anything else, read `SITE.md`: what the site is, what has been done, and the',
    'notes from earlier sessions. Then use the `website` skill and run its `start` command.',
    'Keep `SITE.md` and `learnings.md` current as you work, so the next session can carry on.',
    CLAUDE_MD_END,
  ].join('\n');

  if (!existsSync(file)) {
    writeFileSync(file, block + '\n');
    return 'created';
  }
  const body = readFileSync(file, 'utf8');
  const start = body.indexOf(CLAUDE_MD_START);
  const end = body.indexOf(CLAUDE_MD_END);
  if (start >= 0 && end > start) {
    writeFileSync(file, body.slice(0, start) + block + body.slice(end + CLAUDE_MD_END.length));
    return 'updated';
  }
  writeFileSync(file, `${body.trimEnd()}\n\n${block}\n`);
  return 'appended';
}

function siteMdTemplate(site) {
  return `# ${new URL(site.url).host}

## What this site is

- **Address:** ${site.url}
- **Platform:** ${site.platformName}${site.confirmedBy === 'user' ? ' (confirmed by the user)' : ' (detected)'}
- **Admin:** ${site.adminUrl ?? '_not recorded yet_'}

## What we can do here

_Fill in once known: which flows work on this site, and whether applying a change
needs someone logged in to the admin in the app browser._

## How the site is built

_Filled in during the first session: main pages and how they nest, what every page
shares (header, navigation, footer, anything repeated), the block types in use
(design/blocks.md), and the design system (design/system/DESIGN-SYSTEM.md)._

## Current state

_Nothing done yet._

${NOTES_HEADING}

_No notes yet._
`;
}

const TODO_TEMPLATE = `# To-do

Things to fix or improve on this site, found as we work. Claude adds to this list and
brings it up at the start of each session. Tick items off, reorder them or delete them
freely.

Item format: \`- [ ] YYYY-MM-DD — what is wrong, on which page, where to fix it (how found)\`

`;

const LEARNINGS_TEMPLATE = `# Learnings

A dated log of what was tried on this site, what worked, what broke, and what to do
differently next time. Read before starting work; append after.

Entry format:

    ## YYYY-MM-DD — <task>
    **Did:** what was attempted, and how (script, browser, by hand)
    **Worked:** what was faster or more reliable than expected
    **Broke:** the specific failure, with the label / field / error text
    **Next time:** the concrete change to make

Anything that stops being a surprise belongs in SITE.md or admin-guide.md instead.
`;
