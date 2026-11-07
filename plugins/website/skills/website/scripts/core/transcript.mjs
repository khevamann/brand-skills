// Readable transcripts of past Claude Code / Cowork sessions, for feedback bundles.
//
// A session is stored as JSONL: one JSON object per line, most of them bookkeeping.
// Only the conversation is kept: what the user said and Claude replied in full, each
// tool call as one line with its result shortened under it. Thinking, screenshots and
// text the harness injected (reminders, hook output, skill bodies) are left out.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { redact } from './redact.mjs';

const CALL_MAX = 160;
const RESULT_MAX = 200;

/** One line, at most `max` characters, ending in … when cut. */
export function oneLine(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Parse JSONL, skipping blank and malformed lines rather than failing the whole file. */
export function parseJsonl(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
    } catch {
      // a truncated last line, or not JSON at all
    }
  }
  return rows;
}

// Text the harness adds to a user turn. Each becomes a short placeholder, or nothing.
const INJECTED = [
  [/<system-reminder>[\s\S]*?<\/system-reminder>/g, '[system reminder omitted]'],
  [/<task-notification>[\s\S]*?<\/task-notification>/g, '[background task notification omitted]'],
  [/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '[command output omitted]'],
  [/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, '[command output omitted]'],
  [/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, ''],
  [/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, '[hook output omitted]'],
];

/** `<command-name>/website</command-name> … <command-args>feedback</command-args>` → `/website feedback`. */
function slashCommand(text) {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (!name) return text;
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text);
  const command = [name[1].trim(), args?.[1].trim()].filter(Boolean).join(' ');
  const rest = text.replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>\s*/g, '').trim();
  return rest ? `${command}\n${rest}` : command;
}

/** A user text block as it should read, or a placeholder when it is injected context. */
function cleanUserText(text, row) {
  if (/^\s*\[Image[:#\s]/.test(text) && row.isMeta) return '[image]';
  const skill = /^Base directory for this skill:\s*(\S+)/.exec(text);
  if (skill) return `[skill instructions loaded: ${basename(skill[1])}]`;
  if (row.isCompactSummary) return '[earlier conversation summarised; summary omitted]';
  if (row.isMeta) return '[injected context omitted]';
  let s = slashCommand(text);
  for (const [pattern, placeholder] of INJECTED) s = s.replace(pattern, placeholder);
  // Several placeholders in a row read as one.
  return s.replace(/(\[[^\]\n]+ omitted\])(\s*\1)+/g, '$1').trim();
}

/** Tool result content (string, or blocks of text and images) as one short line. */
function resultLine(block) {
  const parts = [];
  const content = block.content;
  if (typeof content === 'string') parts.push(content);
  else if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'text') parts.push(item.text);
      else if (item?.type === 'image') parts.push('[image]');
      else if (item?.type === 'tool_reference') parts.push(`[${item.tool_name ?? 'tool'}]`);
    }
  }
  let text = parts.join(' ');
  for (const [pattern, placeholder] of INJECTED) text = text.replace(pattern, placeholder ? ' ' : '');
  text = oneLine(text, RESULT_MAX - (block.is_error ? 7 : 0));
  if (!text) text = '(no output)';
  return block.is_error ? `error: ${text}` : text;
}

// What a tool call was aimed at, in the order worth showing.
const TARGET_KEYS = ['command', 'url', 'file_path', 'path', 'notebook_path', 'pattern', 'query', 'skill', 'prompt', 'subagent_type'];

/** "- `Bash` List files — `ls -la…`", at most CALL_MAX characters. */
function callLine(block) {
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  const name = String(block.name ?? 'tool');
  const description = typeof input.description === 'string' ? oneLine(input.description, 80) : '';
  const key = TARGET_KEYS.find((k) => typeof input[k] === 'string' && input[k].trim());
  let line = `- \`${name}\`${description ? ` ${description}` : ''}`;
  if (key) {
    const room = CALL_MAX - line.length - 5; // " — `" and closing "`"
    if (room > 10) line += ` — \`${oneLine(input[key].replace(/`/g, "'"), room)}\``;
  }
  return oneLine(line, CALL_MAX);
}

const dayOf = (ts) => (ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString().slice(0, 10) : null);
const timeOf = (ts) => (ts && !Number.isNaN(Date.parse(ts)) ? `${new Date(ts).toISOString().slice(11, 16)} UTC` : '');

/** The conversation as a list of entries: speech, tool calls (with results attached). */
function conversation(rows) {
  const entries = [];
  const calls = new Map();
  for (const row of rows) {
    if ((row.type !== 'user' && row.type !== 'assistant') || row.isSidechain) continue;
    const message = row.message;
    if (!message || typeof message !== 'object') continue;
    const who = row.type === 'user' ? 'User' : 'Claude';
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const at = row.timestamp;
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = who === 'User' ? cleanUserText(block.text, row) : block.text.trim();
        if (text) entries.push({ kind: 'say', who, at, text });
      } else if (block.type === 'image') {
        entries.push({ kind: 'say', who, at, text: '[image]' });
      } else if (block.type === 'tool_use') {
        const call = { kind: 'call', at, line: callLine(block), result: null };
        if (block.id) calls.set(block.id, call);
        entries.push(call);
      } else if (block.type === 'tool_result') {
        const call = calls.get(block.tool_use_id);
        if (call) call.result = resultLine(block);
        else entries.push({ kind: 'call', at, line: '- (result of an earlier call)', result: resultLine(block) });
      }
      // thinking, redacted_thinking and anything unknown: left out
    }
  }
  return entries;
}

/**
 * A session's JSONL as markdown: a heading per day (UTC), user and Claude text in
 * full, one line per tool call with its result under it. Redacted.
 */
export function renderTranscript(jsonlText, { title = 'Session transcript' } = {}) {
  const rows = parseJsonl(jsonlText);
  const entries = conversation(rows);
  const stamps = entries.map((e) => e.at).filter((t) => dayOf(t)).sort();
  const lines = [`# ${title}`, ''];
  if (stamps.length) lines.push(`${stamps[0].slice(0, 16).replace('T', ' ')} to ${stamps.at(-1).slice(0, 16).replace('T', ' ')} UTC.`);
  lines.push(
    'Thinking, screenshots and instructions the app added are left out; tool calls and their',
    'results are shortened to one line each. Emails and phone numbers are replaced.',
    '',
  );

  let day = null;
  let last = null; // the previous entry, so consecutive speech by one speaker shares a header
  for (const entry of entries) {
    const entryDay = dayOf(entry.at);
    if (entryDay && entryDay !== day) {
      day = entryDay;
      lines.push(`## ${day}`, '');
      last = null;
    }
    if (entry.kind === 'say') {
      if (!(last?.kind === 'say' && last.who === entry.who)) {
        if (last?.kind === 'call') lines.push('');
        const time = timeOf(entry.at);
        lines.push(`**${entry.who}**${time ? ` (${time})` : ''}:`, '');
      }
      lines.push(entry.text, '');
    } else {
      lines.push(entry.line);
      if (entry.result != null) lines.push(`    ↳ ${entry.result}`);
    }
    last = entry;
  }
  if (!entries.length) lines.push('_No conversation found in this session._', '');
  return redact(lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
}

/** Folders Claude Code and Cowork keep session transcripts in. */
export function defaultRoots() {
  const roots = [join(homedir(), '.claude', 'projects')];
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(join(process.env.CLAUDE_CONFIG_DIR, 'projects'));
  return [...new Set(roots.map((r) => resolve(r)))];
}

/** `*.jsonl` directly in a root, and one folder down (Claude Code keeps one folder per cwd). */
function jsonlFiles(root) {
  const found = [];
  const list = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const entry of list(root)) {
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(full);
    else if (entry.isDirectory()) {
      for (const inner of list(full)) {
        if (inner.isFile() && inner.name.endsWith('.jsonl')) found.push(join(full, inner.name));
      }
    }
  }
  return found;
}

/** Both the path as given and its real path, so /var and /private/var both match. */
function pathForms(p) {
  const forms = new Set([resolve(p)]);
  try {
    forms.add(realpathSync(p));
  } catch {
    // the folder may be gone; compare as written
  }
  return [...forms];
}

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** Every distinct `cwd`, the session id and first/last timestamps, without parsing each line. */
function scan(text) {
  const cwds = new Set();
  for (const m of text.matchAll(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    try {
      cwds.add(JSON.parse(m[1]));
    } catch {
      // malformed string
    }
  }
  const stamps = [...text.matchAll(/"timestamp"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).filter((t) => !Number.isNaN(Date.parse(t)));
  stamps.sort();
  const session = /"sessionId"\s*:\s*"([^"]+)"/.exec(text);
  return { cwds: [...cwds], firstAt: stamps[0] ?? null, lastAt: stamps.at(-1) ?? null, sessionId: session?.[1] ?? null };
}

/**
 * Session transcripts that worked on this project: some `cwd` is inside the project
 * folder, or the project sits inside the `cwd` and the session mentions the site's host.
 * Only files modified in the last `sinceDays`. Oldest first. Missing roots are fine.
 * Returns [{ file, sessionId, firstAt, lastAt }] with ISO timestamps.
 */
export function findTranscripts({ projectRoot, host = null, roots = defaultRoots(), sinceDays = 60 } = {}) {
  if (!projectRoot) return [];
  const projectForms = pathForms(projectRoot);
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const results = [];
  const seen = new Set();

  for (const root of roots ?? []) {
    if (!root || !existsSync(root)) continue;
    for (const file of jsonlFiles(root)) {
      let text;
      try {
        const real = realpathSync(file);
        if (seen.has(real) || statSync(file).mtimeMs < cutoff) continue;
        seen.add(real);
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const info = scan(text);
      const matches = info.cwds.some((cwd) =>
        pathForms(cwd).some((c) =>
          projectForms.some((p) => inside(c, p) || (host && inside(p, c) && text.includes(host))),
        ),
      );
      if (!matches) continue;
      results.push({
        file,
        sessionId: info.sessionId ?? basename(file, '.jsonl'),
        firstAt: info.firstAt,
        lastAt: info.lastAt,
      });
    }
  }
  return results.sort((a, b) => String(a.firstAt ?? '').localeCompare(String(b.firstAt ?? '')));
}
