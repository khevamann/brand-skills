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
import { ensureFindings, readFindings, recordFinding, nextQuestions, findingsPath, MAINTAINER } from './core/findings.mjs';
import * as craft from './adapters/craft/cli.mjs';
import * as generic from './adapters/generic/cli.mjs';

const ADAPTERS = { craft, generic };

/** Which adapter serves a project: Craft's API when it has one, else the outside view. */
function adapterName(site) {
  return site.platform === 'craft' && site.craft?.graphql ? 'craft' : 'generic';
}

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
  site findings [--all]              The platform checklist: the questions to answer now
  site finding <ID|new> "<text>"     Record what a real admin showed (platform-findings.md)

PLATFORM COMMANDS
  Depend on the site. \`site help craft\` lists the Craft API ones; \`site help generic\`
  the ones for every other site: overview, pages, page, export, audit, blocks,
  design-system, brief, diff, scope.

Nothing here changes the website. There is no command that creates, edits,
publishes or deletes anything on the site.
`;

/** What the scripts can do today on each platform, said plainly. */
function platformStatus(site) {
  const guide = `references/platforms/${site.platform}.md`;
  if (adapterName(site) === 'craft') {
    return {
      adapter: 'craft',
      summary:
        "Full support over Craft's API: export, audit, design system, briefs, diff and the scope gate. " +
        'Applying a change happens in the Craft control panel, in the app browser, as a draft.',
      guide,
    };
  }
  const why = site.platform === 'craft'
    ? 'This Craft site has no public API, so the scripts read it from the outside, as a visitor sees it: '
    : site.platform === 'other'
      ? 'The scripts read the site from the outside, as a visitor sees it: '
      : `The scripts read ${site.platformName} sites from the outside, as a visitor sees it: `;
  return {
    adapter: 'generic',
    summary:
      why +
      'export, audit, design system, briefs, diff and the scope gate all work on public pages. ' +
      'Drafts and anything behind a login need the app browser, following the guide; record what ' +
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
  const questions = readFindings(project)?.questions.length ?? 0;
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
      ...(questions ? [`  platform-findings.md  ${questions} open questions about ${project.site.platformName}, answered as you work`] : []),
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

  ensureFindings(project);
  const next = nextQuestions(project);
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
    ...(next
      ? [
          `Platform checklist: ${next.answered} of ${next.findings.questions.length} answered` +
            (next.now.length ? ` — next at "${next.stage}"; run site findings when the work gets there` : ' — complete'),
          ...(next.answered || next.findings.other.length
            ? [`  This project has findings: remind the user to send platform-findings.md to ${MAINTAINER}.`]
            : []),
        ]
      : []),
    '',
    `NOTES (${notes.length}${notes.length > 12 ? ', latest 12' : ''})`,
    ...(notes.length ? notes.slice(-12).map((n) => `  ${n}`) : ['  none yet']),
    '',
    'NEXT: read SITE.md in full (and learnings.md before any apply), then carry on.',
  ];
  out(lines.join('\n'));
}

function cmdFindings(flags) {
  const project = loadProject('.');
  if (!project) throw new SiteError('No project in this folder. Run `site start <url>` first.');
  ensureFindings(project);
  const next = nextQuestions(project);
  if (!next) return out(`${project.site.platformName} has no first-time checklist.`);
  const { findings } = next;
  const total = findings.questions.length;
  const lines = [`PLATFORM CHECKLIST — ${project.site.platformName}: ${next.answered} of ${total} answered`, ''];
  const show = (q) => `  ${q.id}  ${q.askUser ? '[ask the user] ' : ''}${q.question}`;

  if (flags.all) {
    lines.push('ALL OPEN QUESTIONS (for you, not to show the user)');
    for (const q of findings.questions.filter((x) => x.status === 'open')) lines.push(`  ${q.id}  ${q.question}`);
  } else if (next.now.length) {
    lines.push(`NOW — when the work reaches "${next.stage}":`, ...next.now.map(show));
    if (next.later) lines.push('', `${next.later} more come up later in the session, as the work gets there.`);
  } else {
    lines.push('Every checklist question is answered.');
  }
  lines.push(
    '',
    'HOW TO WORK THROUGH THEM',
    '  - Never show the user this list. Take one question at a time, when the work reaches it.',
    '  - Answer what you can see yourself: site finding <ID> "<what you saw, and how you know>".',
    '  - Ask the user only the [ask the user] ones, in plain words, one at a time.',
    '  - Stop at the first surprise: tell the user what you expected and what you saw.',
    '',
    findings.questions.some((q) => q.status !== 'open') || findings.other.length
      ? `This project has findings. Before the session ends, ask the user to send ${findingsPath(project)}\n` +
          `to ${MAINTAINER}, who maintains the website skill.`
      : `Once anything is recorded, ask the user to send platform-findings.md to ${MAINTAINER}.`,
  );
  out(lines.join('\n'));
}

function cmdFinding(positional) {
  const project = loadProject('.');
  if (!project) throw new SiteError('No project in this folder. Run `site start <url>` first.');
  const [id, ...words] = positional;
  if (!id) throw new SiteError('Usage: site finding <ID|new> "<what you saw, and how you know>"');
  const line = recordFinding(project, id === 'new' ? 'new' : id, words.join(' '));
  const next = nextQuestions(project);
  out([
    `Recorded in platform-findings.md (${id}): ${line}`,
    next?.now.length
      ? `Next, when the work reaches "${next.stage}": ${next.now[0].id} — ${next.now[0].askUser ? '[ask the user] ' : ''}${next.now[0].question}`
      : 'Every checklist question is answered.',
    `Before the session ends, ask the user to send platform-findings.md to ${MAINTAINER}.`,
  ].join('\n'));
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
    case 'findings':
      return cmdFindings(flags);
    case 'finding':
      return cmdFinding(positional);
  }

  // Everything else belongs to a platform adapter.
  const project = loadProject('.');
  const name = typeof flags.endpoint === 'string' ? 'craft' : project ? adapterName(project.site) : null;
  const adapter = ADAPTERS[name];

  if (!adapter?.COMMANDS.includes(command)) {
    const known = Object.values(ADAPTERS).some((a) => a.COMMANDS.includes(command));
    if (!known) throw new GuardError(`Unknown command \`${command}\`.\n\n${USAGE}`);
    if (!project) throw new SiteError(`No project in this folder. Run \`site start <url>\` first.`);
    throw new SiteError(
      `\`${command}\` is not available for this site.\n${platformStatus(project.site).summary}\n` +
        `\`site help ${name}\` lists what is.`,
    );
  }

  return adapter.run(command, positional, flags, {
    project,
    site: project?.site ?? null,
    paths: project?.paths ?? projectPaths('.'),
  });
}

main().catch(exitWith);
