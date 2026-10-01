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
 */
export async function graphql(query, variables = {}) {
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
    throw new CraftError(`GraphQL errors (HTTP ${res.status}):\n${messages}`);
  }
  if (!res.ok) {
    throw new CraftError(`HTTP ${res.status} from Craft.`);
  }
  return body.data;
}
