// Transport. No credentials: this adapter only works against a public GraphQL
// schema that is readable anonymously, so requests carry no Authorization header.

import { SiteError } from '../../core/cli.mjs';

export class CraftError extends SiteError {}

// The endpoint comes from the project folder's site.json, found by detection —
// never from the environment, and never with a token.
let ENDPOINT = null;

export function setEndpoint(url) {
  ENDPOINT = url;
}

export function endpoint() {
  if (!ENDPOINT) {
    throw new CraftError(
      'No Craft GraphQL endpoint is set. Set up this folder for the site first ' +
        '(`site start <url>`), or pass --endpoint <url>.',
    );
  }
  return ENDPOINT;
}

/**
 * Send a read query. Callers must pass the document through assertReadOnly
 * first — this function deliberately knows nothing about permissions.
 *
 * Field-level errors are reported on stderr rather than thrown when usable data
 * came back. Plugins mis-declare field types often enough (SEOmatic declares
 * `seomatic` as String but returns an object) that one bad field would otherwise
 * make a whole entry unreadable.
 */
export async function graphql(query, variables = {}) {
  const ENDPOINT = endpoint();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new CraftError(`Could not reach ${ENDPOINT}\n${cause.message}`);
  }

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
    const usable = body.data && Object.values(body.data).some((v) => v !== null);
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
  if (!res.ok) throw new CraftError(`HTTP ${res.status} from Craft.`);
  return body.data;
}
