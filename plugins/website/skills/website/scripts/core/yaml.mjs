// A small YAML reader and writer for site.yaml. The scripts have no dependencies, so
// this covers the subset a settings file needs, and that people write by hand:
//
//   - block maps and lists, nested by indentation (spaces only);
//   - lists of maps (`- key: value` with more keys indented under it);
//   - plain, 'single' and "double" quoted scalars; null/~, true/false, numbers;
//   - `|` and `>` block strings (with `-` to strip the final newline);
//   - flow `[a, b]` and `{a: 1}` holding plain scalars, and empty `[]` / `{}`;
//   - `#` comments, on their own line or after a value.
//
// Not covered: anchors, aliases, tags, multi-document files, multi-line flow
// collections, keys that are not scalars. The writer emits only what the reader reads,
// so a file the scripts write always reads back to the same value.

export class YamlError extends Error {}

// ------------------------------------------------------------------ reading

/** Parse a YAML document into plain values. An empty document is `{}`. */
export function parseYaml(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, i) => ({ raw, n: i + 1 }));
  const state = { lines, i: 0 };
  skipBlank(state);
  if (state.i >= lines.length) return {};
  const first = lines[state.i];
  const indent = indentOf(first.raw);
  const value = parseBlock(state, indent);
  skipBlank(state);
  if (state.i < lines.length) fail(lines[state.i], 'unexpected indentation');
  return value;
}

const indentOf = (raw) => {
  const m = raw.match(/^( *)(\t?)/);
  if (m[2]) throw new YamlError('Tabs are not allowed for indentation in YAML. Use spaces.');
  return m[1].length;
};

const isBlank = (raw) => /^\s*(#.*)?$/.test(raw);

function skipBlank(state) {
  while (state.i < state.lines.length && isBlank(state.lines[state.i].raw)) state.i++;
}

function fail(line, why) {
  throw new YamlError(`line ${line.n}: ${why}: ${line.raw.trim()}`);
}

/** A block (map or list) whose lines start at exactly `indent`. */
function parseBlock(state, indent) {
  const line = state.lines[state.i];
  const body = line.raw.slice(indent);
  if (body === '-' || body.startsWith('- ')) return parseList(state, indent);
  return parseMap(state, indent);
}

function parseList(state, indent) {
  const out = [];
  while (true) {
    skipBlank(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i];
    const ind = indentOf(line.raw);
    if (ind < indent) break;
    if (ind > indent) fail(line, 'unexpected indentation');
    const body = line.raw.slice(indent);
    if (!(body === '-' || body.startsWith('- '))) break;
    const rest = stripComment(body.slice(1)).trim();
    state.i++;
    if (rest === '') {
      out.push(parseNested(state, indent, line));
      continue;
    }
    if (splitKey(rest) || rest === '-' || rest.startsWith('- ')) {
      // A map or list that starts on the dash line. Its entries line up with the
      // first one, so re-read the dash line as if the dash were a space.
      const after = body.slice(1);
      const childIndent = indent + 1 + (after.length - after.trimStart().length);
      state.lines[--state.i] = { raw: ' '.repeat(childIndent) + after.trimStart(), n: line.n };
      out.push(parseBlock(state, childIndent));
      continue;
    }
    out.push(parseInline(rest, line, state, indent));
  }
  return out;
}

function parseMap(state, indent) {
  const out = {};
  while (true) {
    skipBlank(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i];
    const ind = indentOf(line.raw);
    if (ind < indent) break;
    if (ind > indent) fail(line, 'unexpected indentation');
    const body = line.raw.slice(indent);
    if (body === '-' || body.startsWith('- ')) break;
    const kv = splitKey(body);
    if (!kv) fail(line, 'expected "key: value"');
    const key = kv.key;
    if (Object.prototype.hasOwnProperty.call(out, key)) fail(line, `"${key}" appears twice`);
    const rest = stripComment(kv.rest).trim();
    state.i++;
    out[key] = rest === '' ? parseNested(state, indent, line) : parseInline(rest, line, state, indent);
  }
  return out;
}

/** The value under a `key:` or `-` with nothing after it: a nested block, or null. */
function parseNested(state, parentIndent, line) {
  skipBlank(state);
  if (state.i >= state.lines.length) return null;
  const next = state.lines[state.i];
  const ind = indentOf(next.raw);
  const body = next.raw.slice(ind);
  // A list may sit at the same indent as its parent key (a common YAML style).
  if (ind > parentIndent || (ind === parentIndent && (body === '-' || body.startsWith('- ')) && line.raw.slice(parentIndent).match(/^[^-]/))) {
    return parseBlock(state, ind);
  }
  return null;
}

/** `key: rest`, with the key unquoted. Null when the text is not a key/value pair. */
function splitKey(text) {
  let key;
  let after;
  if (text[0] === '"' || text[0] === "'") {
    const end = closingQuote(text, 0);
    if (end < 0) return null;
    key = parseScalar(text.slice(0, end + 1));
    after = text.slice(end + 1);
    if (!/^:(\s|$)/.test(after)) return null;
    return { key: String(key), rest: after.slice(1) };
  }
  const m = text.match(/^([^\s#:"'[\]{},][^:#]*?|[^\s#:"'[\]{},][^#]*?)\s*:(\s|$)/);
  if (!m) return null;
  key = m[1].trim();
  return { key, rest: text.slice(m[0].length - (m[2] ? m[2].length : 0)) };
}

function closingQuote(text, start) {
  const q = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (q === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === q) {
      if (q === "'" && text[i + 1] === "'") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** Remove a trailing ` # comment` that is not inside quotes. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s[{,:]/.test(text[i - 1]))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

/** A value written on the same line as its key or dash. */
function parseInline(text, line, state, indent) {
  if (/^[|>][+-]?$/.test(text)) return parseBlockString(text, state, indent);
  if (text.startsWith('[') || text.startsWith('{')) return parseFlow(text, line);
  return parseScalar(text, line);
}

function parseBlockString(header, state, indent) {
  const folded = header[0] === '>';
  const chomp = header[1] ?? '';
  const rows = [];
  let blockIndent = null;
  while (state.i < state.lines.length) {
    const { raw } = state.lines[state.i];
    if (raw.trim() === '') {
      rows.push('');
      state.i++;
      continue;
    }
    const ind = raw.length - raw.trimStart().length;
    if (blockIndent === null) blockIndent = ind;
    if (ind <= indent || ind < blockIndent) break;
    rows.push(raw.slice(blockIndent));
    state.i++;
  }
  // Blank lines at the end of the block separate it from what follows.
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  let text = folded
    ? rows.reduce((acc, row, k) => {
        if (k === 0) return row;
        if (row === '') return acc + '\n';
        return acc + (acc.endsWith('\n') ? '' : ' ') + row;
      }, '')
    : rows.join('\n');
  if (chomp !== '-') text += '\n';
  return text;
}

function parseFlow(text, line) {
  const open = text[0];
  const close = open === '[' ? ']' : '}';
  if (!text.endsWith(close)) fail(line, `a ${open}…${close} list must close on the same line`);
  const inner = text.slice(1, -1).trim();
  if (inner === '') return open === '[' ? [] : {};
  const parts = splitFlow(inner, line);
  if (open === '[') return parts.map((p) => parseScalar(p, line));
  const out = {};
  for (const p of parts) {
    const kv = splitKey(p);
    if (!kv) fail(line, 'expected "key: value" inside {…}');
    out[kv.key] = parseScalar(kv.rest.trim(), line);
  }
  return out;
}

function splitFlow(text, line) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = closingQuote(text, i);
      if (end < 0) fail(line, 'unclosed quote');
      i = end;
    } else if (c === '[' || c === '{') {
      fail(line, 'nested […] or {…} is not supported here; use indented lines');
    } else if (c === ',') {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((p) => p !== '');
}

/** One scalar: quoted, or plain (null, booleans, numbers, else a string). */
export function parseScalar(text, line = { n: 0, raw: text }) {
  const t = text.trim();
  if (t[0] === '"') {
    if (closingQuote(t, 0) !== t.length - 1) fail(line, 'text after a closing quote');
    try {
      return JSON.parse(t.replace(/\\'/g, "'").replace(/\t/g, '\\t'));
    } catch {
      fail(line, 'bad "double-quoted" text');
    }
  }
  if (t[0] === "'") {
    if (closingQuote(t, 0) !== t.length - 1) fail(line, 'text after a closing quote');
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === '' || t === '~' || /^null$/i.test(t)) return null;
  if (/^(true|yes|on)$/i.test(t)) return true;
  if (/^(false|no|off)$/i.test(t)) return false;
  if (/^[-+]?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

// ------------------------------------------------------------------ writing

/**
 * Write a value as YAML. `comments` maps a top-level key to comment lines written
 * above it, and `header` is written at the top: how site.yaml explains itself.
 */
export function stringifyYaml(value, { header = [], comments = {} } = {}) {
  const lines = header.map((l) => (l ? `# ${l}` : '#'));
  if (lines.length) lines.push('');
  if (!isMap(value)) throw new YamlError('The top of a YAML settings file must be a map.');
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  keys.forEach((key, k) => {
    const note = comments[key];
    if (note && k > 0) lines.push('');
    if (note) lines.push(...[].concat(note).map((l) => (l ? `# ${l}` : '#')));
    lines.push(...writeEntry(key, value[key], 0));
  });
  return lines.join('\n') + '\n';
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function writeEntry(key, v, indent) {
  const pad = ' '.repeat(indent);
  const k = writeKey(key);
  if (isMap(v)) {
    const keys = Object.keys(v).filter((x) => v[x] !== undefined);
    if (!keys.length) return [`${pad}${k}: {}`];
    return [`${pad}${k}:`, ...keys.flatMap((x) => writeEntry(x, v[x], indent + 2))];
  }
  if (Array.isArray(v)) {
    if (!v.length) return [`${pad}${k}: []`];
    return [`${pad}${k}:`, ...v.flatMap((item) => writeItem(item, indent + 2))];
  }
  if (typeof v === 'string' && v.includes('\n')) return [`${pad}${k}: ${blockString(v, indent + 2)}`];
  return [`${pad}${k}: ${writeScalar(v)}`];
}

function writeItem(item, indent) {
  const pad = ' '.repeat(indent);
  if (isMap(item)) {
    const keys = Object.keys(item).filter((x) => item[x] !== undefined);
    if (!keys.length) return [`${pad}- {}`];
    const [first, ...rest] = keys.flatMap((x) => writeEntry(x, item[x], indent + 2));
    return [`${pad}- ${first.trimStart()}`, ...rest];
  }
  if (Array.isArray(item)) {
    if (!item.length) return [`${pad}- []`];
    const [first, ...rest] = item.flatMap((x) => writeItem(x, indent + 2));
    return [`${pad}- ${first.trimStart()}`, ...rest];
  }
  if (typeof item === 'string' && item.includes('\n')) return [`${pad}- ${blockString(item, indent + 2)}`];
  return [`${pad}- ${writeScalar(item)}`];
}

function blockString(text, indent) {
  const pad = ' '.repeat(indent);
  const keep = text.endsWith('\n');
  const body = (keep ? text.slice(0, -1) : text).split('\n');
  // A block string can't start with an indented line or hold trailing newlines beyond
  // one; fall back to a quoted string for those.
  if (/^\s/.test(body[0]) || body.some((l) => l !== l.trimEnd()) || text.endsWith('\n\n')) return JSON.stringify(text);
  return [keep ? '|' : '|-', ...body.map((l) => (l ? pad + l : ''))].join('\n');
}

function writeKey(key) {
  return /^[A-Za-z_][\w.-]*$/.test(key) && !looksSpecial(key) ? key : JSON.stringify(String(key));
}

const looksSpecial = (s) =>
  /^(~|null|true|false|yes|no|on|off)$/i.test(s) || /^[-+]?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(s);

export function writeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new YamlError(`Can't write ${v} in YAML.`);
    return String(v);
  }
  const s = String(v);
  // Plain when it reads back as the same string; quoted otherwise.
  const plain =
    s !== '' &&
    !looksSpecial(s) &&
    s === s.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) &&
    !/: |:$| #|[\n\t]/.test(s);
  return plain ? s : JSON.stringify(s);
}
