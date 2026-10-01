// Transport + credentials. Nothing in here decides what is allowed; see guard.mjs.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATH = process.env.CRAFT_CONFIG ?? join(homedir(), '.config', 'craft-cms', 'env');

export class CraftError extends Error {}

function readConfigFile() {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

export function loadConfig() {
  const file = readConfigFile();
  const endpoint = process.env.CRAFT_GRAPHQL_ENDPOINT ?? file.CRAFT_GRAPHQL_ENDPOINT;
  const token = process.env.CRAFT_GRAPHQL_TOKEN ?? file.CRAFT_GRAPHQL_TOKEN;

  if (!endpoint || !token) {
    throw new CraftError(
      'Missing credentials. Set CRAFT_GRAPHQL_ENDPOINT and CRAFT_GRAPHQL_TOKEN in the\n' +
        `environment, or create ${CONFIG_PATH} containing:\n\n` +
        '  CRAFT_GRAPHQL_ENDPOINT=https://your-site.com/actions/graphql/api\n' +
        '  CRAFT_GRAPHQL_TOKEN=your-private-schema-token\n\n' +
        'See the skill README for how to mint a read-only-ish token in Craft.',
    );
  }
  return { endpoint, token };
}

/**
 * Send a GraphQL request. Callers must have already passed the document through
 * the guard — this function deliberately knows nothing about permissions.
 *
 * `partial: true` accepts a response that carries both data and field-level
 * errors, reporting the errors on stderr instead of throwing. Plugins
 * mis-declare field types often enough (SEOmatic, for one) that one bad field
 * would otherwise make a whole entry unreadable. Writes never pass this.
 */
export async function graphql(query, variables = {}, { partial = false } = {}) {
  const { endpoint, token } = loadConfig();

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CraftError(
      `Craft returned non-JSON (HTTP ${res.status}). First 500 chars:\n${text.slice(0, 500)}`,
    );
  }

  if (body.errors?.length) {
    const messages = body.errors.map((e) => `  - ${e.message}`).join('\n');
    const usable = partial && body.data && Object.values(body.data).some((v) => v !== null);
    if (!usable) {
      // Craft masks validation failures behind one opaque message, so say what
      // it usually means rather than leaving the caller to guess.
      const opaque = body.errors.some((e) => /Something went wrong when processing/i.test(e.message));
      const hint = opaque
        ? '\n\nThat message is Craft refusing to explain itself. It almost always means a ' +
          'name in the document does not exist: a misspelled fragment type, field, or argument. ' +
          'Bisect the document — drop one fragment at a time — or check names with `craft schema <Type>`.'
        : '';
      throw new CraftError(`GraphQL errors (HTTP ${res.status}):\n${messages}${hint}`);
    }
    console.error(`WARNING: ${body.errors.length} field error(s), returning partial data:\n${messages}`);
  }
  if (!res.ok) {
    throw new CraftError(`HTTP ${res.status} from Craft.`);
  }
  return body.data;
}
