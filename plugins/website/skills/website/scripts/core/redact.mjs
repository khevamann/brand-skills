// Taking personal details and secrets out of text before it leaves the user's machine,
// e.g. in a feedback bundle. Errs towards leaving ordinary numbers alone: dates, times,
// prices, colours, ids and versions are what site work is full of, and a transcript
// with every number blanked out is useless. Phone numbers are recognised by shape.

import { homedir } from 'node:os';

const SECRET = '[secret]';

// Names whose value is a credential when written `name=value` or `name: value`,
// including prefixed forms like csrf_token, X-Api-Key or SHOPIFY_ACCESS_TOKEN.
const SECRET_KEY =
  /(?<![\w-])((?:[A-Za-z0-9]+[_-])*(?:password|passwd|passphrase|token|api[_-]?key|apikey|secret|client[_-]?secret|session[_-]?id|sessionid|private[_-]?key))(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'&,;)}\]]+)/gi;

// Well-known token shapes that are secret wherever they appear.
const TOKEN_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic style keys
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{20,}/g, // Shopify
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

/** Credentials: auth headers, cookies, key=value secrets, user:pass@ in URLs, known key shapes. */
function redactSecrets(text) {
  let s = text
    .replace(/((?:proxy-)?authorization["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\n"']+)/gi, `$1${SECRET}`)
    // A bearer token is long and has digits in it; "Bearer authentication" in prose is not one.
    .replace(/\bBearer\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}/g, `Bearer ${SECRET}`)
    .replace(/((?:set-)?cookie["']?\s*:\s*)("[^"\n]*"|'[^'\n]*'|[^\n"']+)/gi, `$1${SECRET}`)
    .replace(/(--cookie[\s=]+)("[^"\n]*"|'[^'\n]*'|\S+)/g, `$1${SECRET}`)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SECRET}@`)
    .replace(SECRET_KEY, (match, key, sep, value) => {
      const bare = value.replace(/^["']|["']$/g, '');
      if (!bare || bare === SECRET || /^\$\{?\w+\}?$/.test(bare)) return match; // empty or a ${VAR} reference
      const quote = /^["']/.test(value) ? value[0] : '';
      return `${key}${sep}${quote}${SECRET}${quote}`;
    });
  for (const shape of TOKEN_SHAPES) s = s.replace(shape, SECRET);
  return s;
}

// File names like logo@2x.png look like addresses; real top-level domains aren't these.
const FILE_EXT = /^(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|cjs|ts|json|html?|md|txt|pdf|map|woff2?|ttf|mp4|mov|zip)$/i;

function redactEmails(text) {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})\b/g, (match, tld) =>
    FILE_EXT.test(tld) ? match : '[email]',
  );
}

// Phone shapes. Each must stand alone: not glued to letters, other digits, a path, a
// price sign, a colour hash or an id separator, so 2026-11-06, #555123, /products/123
// and v1.2.3 never match. A bare run of digits is never a phone: those are ids.
const BEFORE = String.raw`(?<![\w$€£¥#/=.:@+\\-])`;
const AFTER = String.raw`(?![\w@%]|[.:/\\-]\w)`;
const SEP = String.raw`[ .-]`;
const PHONES = [
  // International: +44 20 7946 0958, +1 (555) 123-4567, +33 1 23 45 67 89
  new RegExp(String.raw`(?<![\w+])\+\d{1,3}(?:${SEP}?\(?\d{1,4}\)?){1,5}${AFTER}`, 'g'),
  // North American: (555) 123-4567, 555-123-4567, 555.123.4567, 1-800-555-0199
  new RegExp(String.raw`${BEFORE}(?:1${SEP})?(?:\(\d{3}\) ?|\d{3}${SEP})\d{3}${SEP}\d{4}${AFTER}`, 'g'),
  // National numbers with a trunk 0: 020 7946 0958, 07700 900123, 0171-234-5678
  new RegExp(String.raw`${BEFORE}0\d{2,4}[ -]\d{3,4}(?:[ -]?\d{3,4})?${AFTER}`, 'g'),
];

function redactPhones(text) {
  let s = text;
  for (const shape of PHONES) {
    s = s.replace(shape, (match) => {
      const digits = match.replace(/\D/g, '').length;
      if (digits < 9 || digits > 15) return match;
      // Dotted groups other than 3.3.4 are versions or IP addresses, not phones.
      if (!match.startsWith('+') && match.includes('.') && !/^(1\.)?\d{3}\.\d{3}\.\d{4}$/.test(match)) return match;
      return '[phone]';
    });
  }
  return s;
}

/** The user's home folder as `~`, so their account name doesn't travel with every path. */
function redactHome(text, home) {
  if (!home || home.length < 2 || home === '/') return text;
  return text.split(home).join('~');
}

/**
 * Text with secrets → [secret], email addresses → [email], phone numbers → [phone]
 * and the home folder → ~. Pass `{ home: null }` to keep paths as they are.
 */
export function redact(text, { home = homedir() } = {}) {
  if (text == null) return '';
  return redactHome(redactPhones(redactEmails(redactSecrets(String(text)))), home);
}
