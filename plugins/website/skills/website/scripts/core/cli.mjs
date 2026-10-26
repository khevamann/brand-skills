// Shared CLI plumbing: argument parsing, output, and the two error kinds every
// command reports the same way.

/** A refused request — something this tool will not do. Exit code 2. */
export class GuardError extends Error {}

/** Anything else that went wrong: unreachable site, missing page, bad input. Exit 1. */
export class SiteError extends Error {}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export const out = (value) =>
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

export function section(lines, heading, items, footer) {
  lines.push(heading);
  lines.push(items.length ? items.join('\n') : '  none');
  if (footer) lines.push(footer);
  lines.push('');
}

/** Report an error the way the skill's instructions expect, and set the exit code. */
export function exitWith(err) {
  if (err instanceof GuardError) {
    console.error(`BLOCKED: ${err.message}`);
    process.exit(2);
  }
  if (err instanceof SiteError) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
}

/**
 * Said whenever the site can't be reached. In Claude Cowork the scripts run in a
 * sandbox whose internet access is limited to approved sites, which is the usual cause.
 */
export const NETWORK_HINT =
  'If this is Claude Cowork, its sandbox is probably not allowed onto this site yet. An Owner of ' +
  'the Claude organization can allow it: Organization settings → Capabilities → Code execution, ' +
  "network access, add the site's domain. Until then, read pages in the browser.";

/** Today as YYYY-MM-DD, for dated notes and file names. */
export const today = () => new Date().toISOString().slice(0, 10);
