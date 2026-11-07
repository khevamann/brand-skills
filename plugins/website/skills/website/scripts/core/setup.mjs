// Setup checks, and bringing an existing project folder up to date.
//
// A field report ran the skill in a plain chat: no folder attached, network access off.
// Claude worked around each problem as it hit it, set the project up in its own
// temporary workspace, and never did the first session. So setup checks what it can
// before anything else, and stops with the fix when something is wrong:
//
//   - the app: a plain claude.ai chat can't keep a project folder or reach sites;
//   - the folder: it must be one the user attached, not Claude's own workspace;
//   - the site: whether the scripts can reach it (asked about, not a hard stop,
//     because an organization may never allow it and the browser can do the work).
//
// The browser is checked by Claude, not here: the scripts can't see its tools.

import { accessSync, constants, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { checkReach } from './detect.mjs';

const MIN_NODE = 18;

/**
 * Where the scripts are running, as far as can be told from the file system. The
 * environment variables let tests describe a workspace without needing one.
 */
export function describeWorkspace(cwd = process.cwd(), env = process.env) {
  const dir = resolve(cwd);
  const home = resolve(env.WEBSITE_SKILL_HOME ?? homedir());
  const chatMarker = env.WEBSITE_SKILL_CHAT_MARKER ?? '/mnt/user-data';
  // claude.ai's chat sandbox: uploads and outputs under /mnt/user-data, work in
  // /home/claude. Cowork attaches the user's folder instead.
  const chat = existsSync(chatMarker) || dir === '/home/claude' || dir.startsWith('/home/claude/');
  const own = dir === home || dir === '/' || dir === resolve(home, '..');
  // A project folder that doesn't exist yet (init --project <new>) is created by
  // init, so what matters is whether its nearest existing parent can be written to.
  let existing = dir;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  let writable = true;
  try {
    accessSync(existing, constants.W_OK);
  } catch {
    writable = false;
  }
  return { dir, name: basename(dir), chat, own, writable };
}

/**
 * The checks setup runs. Each is { id, ok, label, detail, fix, hard }: a hard
 * failure stops setup; a soft one is raised with the user before going on.
 */
// folderConfirmed: the user said this is the folder they made for the site.
// appConfirmed: the user said this is Cowork with their folder attached, though it
//   looks like a plain chat (the signs used are a best guess).
// known: the folder already holds this site's project, so don't ask about it again.
export async function runChecks({
  cwd = process.cwd(), url = null, folderConfirmed = false, appConfirmed = false, known = false, env = process.env,
} = {}) {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    ok: major >= MIN_NODE,
    label: `Node.js ${process.versions.node}`,
    fix: `The scripts need Node.js ${MIN_NODE} or newer in this workspace. Install it with the workspace's package manager.`,
    hard: true,
  });

  const ws = describeWorkspace(cwd, env);
  checks.push({
    id: 'app',
    ok: !ws.chat || appConfirmed,
    label: ws.chat ? 'Looks like a plain Claude chat, not a Cowork project' : 'Running in a project workspace',
    fix:
      'This needs Claude Cowork. Ask the user to open Cowork, create a project for the site with an empty ' +
      'folder attached, and start a new chat in it (references/getting-set-up.md). Notes saved here would be lost. ' +
      'If they say they already are in Cowork with their folder attached, run site setup --folder-confirmed.',
    hard: true,
  });
  const folderOk = ws.writable && (folderConfirmed || !ws.own);
  checks.push({
    id: 'folder',
    ok: folderOk,
    label: folderOk
      ? `Folder: "${ws.name}"${folderConfirmed ? ' (confirmed by the user)' : ''}`
      : !ws.writable
        ? `Folder "${ws.name}" can't be written to`
        : `"${ws.dir}" looks like Claude's own workspace, not a folder the user attached`,
    detail: folderConfirmed
      ? null
      : `Confirm with the user: "I'll keep everything about the site in your folder “${ws.name}”. Is that the folder you made for it?" ` +
        'If yes, run site setup again with --folder-confirmed. If not, ask them to attach the right folder to this Cowork project.',
    fix:
      'Ask the user to attach a folder for the site to this Cowork project (an empty one they made for it), then start ' +
      'a new chat in the project. If the folder is attached but commands run elsewhere, find it and pass --project <folder>.',
    hard: true,
    needsConfirmation: !folderConfirmed && !known && folderOk,
  });

  if (url) {
    const reach = await checkReach(url);
    checks.push({
      id: 'reach',
      ok: reach.ok,
      label: reach.ok ? `Can reach ${url}` : `Can't reach ${url} (${reach.why})`,
      fix:
        "Ask the user to allow the site: Cowork may offer to allow it right in the conversation. Otherwise, on a personal plan, in Settings → Capabilities; on a Team or Enterprise plan an Owner allows it under Organization settings → Capabilities → Code execution (network access, add the site's domain). If it can't be allowed, the browser does the same work, more slowly.",
      hard: false,
      reach,
    });
  }
  return { checks, workspace: ws, hard: checks.filter((c) => !c.ok && c.hard), soft: checks.filter((c) => !c.ok && !c.hard) };
}

/** The lines setup prints for its checks. */
export function checkLines({ checks, hard, soft }) {
  const lines = ['SETUP CHECKS'];
  for (const c of checks) lines.push(`  ${c.ok ? '✓' : c.hard ? '✗' : '!'} ${c.label}`);
  lines.push('  ? Browser: check for yourself that you have browser tools (Claude in Chrome, or the app\'s built-in');
  lines.push('    browser). Without one, stop and ask the user to turn one on (references/getting-set-up.md).');
  const confirm = checks.find((c) => c.needsConfirmation);
  if (hard.length) {
    lines.push('', 'STOP — setup is not ready. Tell the user in plain words what is wrong and how to fix it,');
    lines.push('and go no further until it is fixed:');
    for (const c of hard) lines.push(`  - ${c.fix}`);
  } else if (soft.length) {
    lines.push('', 'BEFORE GOING ON — raise this with the user now, and wait for their answer:');
    for (const c of soft) lines.push(`  - ${c.fix}`);
  }
  if (confirm && !hard.length) lines.push('', `CONFIRM THE FOLDER — ${confirm.detail}`);
  lines.push('');
  return lines;
}

// Files earlier versions, or people, put somewhere other than where the skill looks.
// Only these known files are moved; anything else is listed for Claude to ask about.
const KNOWN_MOVES = [
  [/^DESIGN-SYSTEM\.md$/, 'design/system'],
  [/^(blocks|available-blocks)\.md$/, 'design'],
  [/^(audit|site-review|review|layout|seo|accessibility)[-_].*\.md$/i, 'audits'],
];
const EXPECTED = new Set([
  'SITE.md', 'site.yaml', 'learnings.md', 'TODO.md', 'admin-guide.md', 'platform-findings.md', 'CLAUDE.md',
  'export', 'audits', 'design', 'snapshots', 'feedback',
]);

/**
 * Bring a project folder up to the current layout: move the known misplaced files
 * (never overwriting), and list everything else unexpected for Claude to ask about.
 * Nothing is deleted.
 */
export function tidyProject(project) {
  const root = project.paths.root;
  const moved = [];
  const unexpected = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith('.') || EXPECTED.has(name)) continue;
    const rule = statSync(join(root, name)).isFile() ? KNOWN_MOVES.find(([re]) => re.test(name)) : null;
    if (rule) {
      const toDir = join(root, rule[1]);
      const to = join(toDir, name);
      if (!existsSync(to)) {
        mkdirSync(toDir, { recursive: true });
        renameSync(join(root, name), to);
        moved.push(`${name} → ${rule[1]}/${name}`);
        continue;
      }
    }
    unexpected.push(name);
  }
  return { moved, unexpected };
}
