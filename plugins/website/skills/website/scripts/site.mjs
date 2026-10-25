#!/usr/bin/env node
// site — read-only tools for working on a website, whatever it is built on.
//
// Run it from the project folder: the folder the user opened for this website. It
// keeps everything there (SITE.md, site.json, learnings, exports, audits, designs)
// so a new session in the same folder carries on where the last one stopped.
//
// Platform-neutral commands live here. Everything else is dispatched to the
// adapter for the project's platform. Nothing here, or in any adapter, writes to
// the website: changes are made by a person, or as a draft through the admin in the
// browser, and a person publishes.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, out, exitWith, GuardError, SiteError } from './core/cli.mjs';
import { detect, findCraftGraphql } from './core/detect.mjs';
import {
  PLATFORMS, loadProject, initProject, addNote, readNotes, projectPaths, writeClaudeMdBlock,
  CLAUDE_MD_START,
} from './core/project.mjs';
import * as craft from './adapters/craft/cli.mjs';

const ADAPTERS = { craft };

const USAGE = `site — read-only tools for a website project

Run from the project folder (one folder per website).

PROJECT
  site start [url]                   Resume this folder's project, or begin one for <url>
  site detect <url>                  Work out what platform a site runs on
  site init <url> --platform <p>     Set up this folder for a site
      p = craft | wordpress | shopify | squarespace | other
      --confirmed-by user|detection  Who decided the platform (default: detection)
      --graphql <url>                Craft only: the GraphQL endpoint, if detection missed it
  site note "<text>"                 Add a dated note to SITE.md for future sessions

PLATFORM COMMANDS
  Depend on the project's platform. \`site help <platform>\` lists them.
  Craft CMS: overview, export, audit, page, blocks, design-system, brief, diff, scope, …

Nothing here changes the website. There is no command that creates, edits,
publishes or deletes anything on the site.
`;

/** What the scripts can do today on each platform, said plainly. */
function platformStatus(site) {
  const guide = `references/platforms/${site.platform}.md`;
  if (site.platform === 'craft') {
    return site.craft?.graphql
      ? {
          scripted: true,
          summary:
            'Full support: export, audit, design system, briefs, diff and the scope gate all run ' +
            'as scripts. Applying a change happens in the Craft control panel, in the app browser, as a draft.',
          guide,
        }
      : {
          scripted: false,
          summary:
            "This Craft site does not expose a public GraphQL API, so the scripts cannot read it yet. " +
            'Work through the browser instead, following the guide, and record what you learn.',
          guide,
        };
  }
  return {
    scripted: false,
    summary:
      `Dedicated ${site.platformName} scripts are not built yet. Detection and this project folder ` +
      'work; read, audit and apply through the app browser following the guide, and record what ' +
      'works in admin-guide.md and learnings.md.',
    guide,
  };
}

// --------------------------------------------------------------- commands

async function cmdDetect(url) {
  if (!url) throw new SiteError('Usage: site detect <url>');
  const result = await detect(url);
  out(describeDetection(result));
}

function describeDetection(r) {
  const name = r.platform === 'other' ? (r.otherName ? `Other (${r.otherName})` : 'Other / unknown') : PLATFORMS[r.platform];
  const lines = [
    `DETECTION — ${r.url}${r.title ? `  "${r.title}"` : ''}`,
    '',
    `Platform:   ${name}`,
    `Confidence: ${r.confidence}`,
  ];
  if (r.headless) lines.push(`Front end:  ${r.headless.framework} — probably a headless site with the CMS elsewhere`);
  if (r.craftGraphql) lines.push(`Craft API:  ${r.craftGraphql}`);
  if (r.blocked) lines.push('Note:       the site answered with a bot-protection page; detection may be incomplete.');
  lines.push('', 'Evidence:', ...(r.evidence.length ? r.evidence.map((e) => `  - ${e}`) : ['  - none']), '');

  const options = 'WordPress · Shopify · Craft CMS · Squarespace · Other / not sure';
  if (r.ask) {
    lines.push(
      'NEXT: ask the user which platform the site is built on, offering exactly these options:',
      `  ${options}`,
      'then run: site init <url> --platform <answer> --confirmed-by user',
    );
  } else {
    lines.push(
      `NEXT: tell the user it looks like ${name} and let them correct it, then run:`,
      `  site init ${r.url} --platform ${r.platform}` +
        (r.platform === 'craft' && r.craftGraphql ? ` --graphql ${r.craftGraphql}` : ''),
    );
  }
  return lines.join('\n');
}

async function cmdInit(url, flags) {
  if (!url) throw new SiteError('Usage: site init <url> --platform <craft|wordpress|shopify|squarespace|other>');
  const platform = String(flags.platform ?? '').toLowerCase().replace(/[\s-]*cms$/, '');
  if (!PLATFORMS[platform]) {
    throw new SiteError(
      'Pass --platform with one of: craft, wordpress, shopify, squarespace, other. ' +
        "If you don't know it, ask the user — they know what their site is built on.",
    );
  }

  // Detection is re-run so its evidence is recorded alongside the decision. It is
  // allowed to fail: the user's answer is enough to set up the folder.
  let detection = null;
  try {
    detection = await detect(url);
  } catch (err) {
    process.stderr.write(`Detection failed (${err.message.split('\n')[0]}); continuing with the user's answer.\n`);
  }

  const target = detection?.url ?? (/^https?:\/\//.test(url) ? url : `https://${url}`);
  const extra = {};
  if (platform === 'craft') {
    const graphql =
      (typeof flags.graphql === 'string' && flags.graphql) ||
      detection?.craftGraphql ||
      (await findCraftGraphql(target, '').catch(() => null));
    extra.craft = { graphql: graphql ?? null };
    // Digistorm builds school sites from a demo; its sample name is placeholder copy.
    if (/digistorm/i.test(`${target} ${graphql ?? ''}`)) extra.audit = { placeholders: ['Digistorm School'] };
  }

  const confirmedBy = flags['confirmed-by'] === 'user' ? 'user' : 'detection';
  if (detection && detection.platform !== platform && confirmedBy !== 'user') {
    process.stderr.write(
      `Note: detection suggested ${detection.platform}, but you chose ${platform}. ` +
        'If the user chose this, pass --confirmed-by user.\n',
    );
  }

  const project = initProject('.', { url: target, platform, confirmedBy, detection, extra });
  const status = platformStatus(project.site);
  out(
    [
      `PROJECT SET UP — ${project.site.url} (${project.site.platformName})`,
      '',
      `Folder: ${project.paths.root}`,
      '  SITE.md       overview and notes — read first every session',
      '  site.json     facts and state the scripts use',
      '  learnings.md  dated log of what worked and what broke',
      '  CLAUDE.md     points new sessions at SITE.md',
      '',
      `What works here: ${status.summary}`,
      `Guide: ${status.guide}`,
      ...(platform === 'craft' && !extra.craft.graphql
        ? ['', 'No public Craft GraphQL endpoint was found. If the user knows one, re-run init with --graphql.']
        : []),
      '',
      'NEXT: fill in "What we can do here" in SITE.md, then carry on with what the user asked for.',
    ].join('\n'),
  );
}

function cmdStart(url) {
  const project = loadProject('.');
  if (!project) {
    if (url) return cmdDetect(url);
    return out(
      [
        'This folder is not set up as a website project yet.',
        '',
        'NEXT: ask the user which website they are working on (its address), then run:',
        '  site start <url>',
      ].join('\n'),
    );
  }

  const { site, paths } = project;
  const bareHost = (u) => new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, '');
  if (url && bareHost(url) !== bareHost(site.url)) {
    throw new SiteError(
      `This folder is the project for ${site.url}, not ${url}. ` +
        'Each website needs its own folder: ask the user to open (or create) one for it.',
    );
  }

  // Keep the pointer for new sessions in place, without touching anything else.
  if (!existsSync(paths.claudeMd) || !readFileSync(paths.claudeMd, 'utf8').includes(CLAUDE_MD_START)) {
    writeClaudeMdBlock(paths.claudeMd);
  }

  const status = platformStatus(site);
  const state = site.state ?? {};
  const notes = readNotes(project);
  const learningsCount = existsSync(paths.learnings)
    ? (readFileSync(paths.learnings, 'utf8').match(/^## \d{4}-\d{2}-\d{2}/gm) ?? []).length
    : 0;

  const lines = [
    `WEBSITE PROJECT — ${site.url}`,
    '',
    `Platform:  ${site.platformName}${site.confirmedBy === 'user' ? ' (confirmed by the user)' : ' (detected)'}`,
    `Folder:    ${paths.root}`,
    `Last export: ${state.lastExport ? `${state.lastExport.at.slice(0, 10)} — ${state.lastExport.pages} pages` : 'none'}`,
    `Last audit:  ${state.lastAudit ? `${state.lastAudit.at.slice(0, 10)} — ${state.lastAudit.file}` : 'none'}`,
    `Learnings:   ${learningsCount} dated entr${learningsCount === 1 ? 'y' : 'ies'} in learnings.md`,
    `Admin guide: ${existsSync(paths.adminGuide) ? 'admin-guide.md' : 'not written yet — write one the first time the admin is explored'}`,
    '',
    `What works here: ${status.summary}`,
    `Guide: ${status.guide}`,
    '',
    `NOTES (${notes.length}${notes.length > 12 ? ', latest 12' : ''})`,
    ...(notes.length ? notes.slice(-12).map((n) => `  ${n}`) : ['  none yet']),
    '',
    'NEXT: read SITE.md in full (and learnings.md before any apply), then carry on.',
  ];
  out(lines.join('\n'));
}

function cmdNote(positional) {
  const project = loadProject('.');
  if (!project) throw new SiteError('No project in this folder. Run `site start <url>` first.');
  out(`Added to SITE.md: ${addNote(project, positional.join(' '))}`);
}

// ------------------------------------------------------------------- main

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h': {
      const adapter = ADAPTERS[positional[0]];
      return out(adapter ? adapter.USAGE : USAGE);
    }
    case 'start':
      return cmdStart(positional[0]);
    case 'detect':
      return cmdDetect(positional[0]);
    case 'init':
      return cmdInit(positional[0], flags);
    case 'note':
      return cmdNote(positional);
  }

  // Everything else belongs to a platform adapter.
  const project = loadProject('.');
  const platform = typeof flags.endpoint === 'string' ? 'craft' : project?.site.platform;
  const adapter = ADAPTERS[platform];

  if (!adapter?.COMMANDS.includes(command)) {
    const known = Object.values(ADAPTERS).some((a) => a.COMMANDS.includes(command));
    if (!known) throw new GuardError(`Unknown command \`${command}\`.\n\n${USAGE}`);
    if (!project) throw new SiteError(`No project in this folder. Run \`site start <url>\` first.`);
    const status = platformStatus(project.site);
    throw new SiteError(
      `\`${command}\` is not available for ${project.site.platformName} yet.\n${status.summary}\nGuide: ${status.guide}`,
    );
  }

  if (project && !platformStatus(project.site).scripted && typeof flags.endpoint !== 'string') {
    throw new SiteError(platformStatus(project.site).summary);
  }

  return adapter.run(command, positional, flags, {
    project,
    site: project?.site ?? null,
    paths: project?.paths ?? projectPaths('.'),
  });
}

main().catch(exitWith);
