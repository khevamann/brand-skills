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
import { relative, resolve } from 'node:path';
import { parseArgs, out, exitWith, GuardError, SiteError } from './core/cli.mjs';
import { detect, findCraftGraphql } from './core/detect.mjs';
import {
  PLATFORMS, loadProject, initProject, addNote, readNotes, projectPaths, writeClaudeMdBlock,
  CLAUDE_MD_START, bareHost, resolveProject, newProjectFolder,
} from './core/project.mjs';
import { ensureFindings, readFindings, recordFinding, nextQuestions, sendSuggestion, markSuggested, MAINTAINER } from './core/findings.mjs';
import * as craft from './adapters/craft/cli.mjs';
import * as generic from './adapters/generic/cli.mjs';

const ADAPTERS = { craft, generic };

/** The folder named by --project, or the current one. */
const baseFolder = (flags) => (typeof flags.project === 'string' ? flags.project : '.');

/** How to refer to a project folder in messages and in --project. */
const shortPath = (dir) => relative(process.cwd(), dir) || '.';

/**
 * The project a command is about, or a clear refusal. Several sites under one folder
 * need --project to say which; it is never guessed.
 */
function currentProject(flags, { required = true } = {}) {
  const { project, candidates } = resolveProject(baseFolder(flags));
  if (project) return project;
  if (candidates.length > 1) {
    throw new SiteError(
      'This folder holds several website projects:\n' +
        candidates.map((p) => `  ${shortPath(p.paths.root).padEnd(30)} ${p.site.url}`).join('\n') +
        '\nAsk the user which site, then pass --project <folder> to every command.',
    );
  }
  if (required) throw new SiteError('No website project here yet. Run `site start <url>` first.');
  return null;
}

/** Which adapter serves a project: Craft's API when it has one, else the outside view. */
function adapterName(site) {
  return site.platform === 'craft' && site.craft?.graphql ? 'craft' : 'generic';
}

const USAGE = `site — read-only tools for a website project

Run from the project folder (one folder per website).

PROJECT
  site start [url]                   Resume the project, or begin one for <url>
  site detect <url>                  Work out what platform a site runs on
  site init <url> --platform <p> --new
                                     Set up a project for a site: here if this folder is
                                     empty, otherwise in a new subfolder named after the site
      p = craft | wordpress | shopify | squarespace | other
      --confirmed-by user|detection  Who decided the platform (default: detection)
      --graphql <url>                Craft only: the GraphQL endpoint, if detection missed it
  site note "<text>"                 Add a dated note to SITE.md for future sessions
  site findings [--all]              The platform checklist: the questions to answer now
      --told                         Record that the user was asked to send the findings
  site finding <ID|new> "<text>"     Record what a real admin showed (platform-findings.md)

Every command takes --project <folder> to name the site's project folder. Without it,
the current folder is used if it is a project, else its only project subfolder.

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
        'Applying a change happens in the Craft control panel, in the browser, as a draft.',
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
      'Drafts and anything behind a login need the browser, following the guide; record what ' +
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

const NEW_SITE_QUESTION = [
  'FIRST, before setting anything up, ask the user in plain words:',
  '  "Is this the first time you\'re working on this site with Claude? If you\'ve worked on it',
  '   before, please open that same Cowork project instead, so its notes and what we learned',
  '   last time carry over."',
  '  - Worked on it before → stop here. Don\'t set anything up; help them find that project.',
  '  - New → carry on below, and pass --new to init to show you asked.',
];

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
  lines.push(...NEW_SITE_QUESTION, '');
  if (r.ask) {
    lines.push(
      'THEN ask which platform the site is built on, offering exactly these options:',
      `  ${options}`,
      'and run: site init <url> --platform <answer> --confirmed-by user --new',
    );
  } else {
    lines.push(
      `THEN tell the user it looks like ${name} and let them correct it, and run:`,
      `  site init ${r.url} --platform ${r.platform} --new` +
        (r.platform === 'craft' && r.craftGraphql ? ` --graphql ${r.craftGraphql}` : ''),
    );
  }
  return lines.join('\n');
}

async function cmdInit(url, flags) {
  if (!url) throw new SiteError('Usage: site init <url> --platform <craft|wordpress|shopify|squarespace|other> --new');
  if (!flags.new) {
    // A second project for a site splits its notes and learnings in two. Asking is cheap.
    throw new SiteError(['Not set up yet.', '', ...NEW_SITE_QUESTION].join('\n'));
  }
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

  const base = baseFolder(flags);
  const existing = resolveProject(base, { host: bareHost(target) }).project;
  if (existing) {
    throw new SiteError(`${target} is already set up in ${shortPath(existing.paths.root)}. Run \`site start ${target}\`.`);
  }
  const here = loadProject(base);
  if (here) {
    throw new SiteError(
      `This folder is already the project for ${here.site.url}. To work on ${target} as well, ask the user ` +
        'to attach a separate folder for it — or a parent folder that can hold both sites — in a new Cowork project.',
    );
  }
  const folder = typeof flags.project === 'string' ? flags.project : newProjectFolder(base, target);
  const project = initProject(folder, { url: target, platform, confirmedBy, detection, extra });
  const inSubfolder = resolve(folder) !== resolve('.');
  const questions = readFindings(project)?.questions.length ?? 0;
  const status = platformStatus(project.site);
  out(
    [
      `PROJECT SET UP — ${project.site.url} (${project.site.platformName})`,
      '',
      `Folder: ${project.paths.root}`,
      ...(inSubfolder
        ? [
            `  This folder already held other things, so the site got its own folder: ${shortPath(project.paths.root)}`,
            `  Pass --project ${shortPath(project.paths.root)} to every command from now on.`,
          ]
        : []),
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
      'If this is a Cowork project without Instructions yet, suggest these to the user once, so new',
      'conversations resume it: "This is a website project. Use the website skill: run its start',
      'command before anything else, then read SITE.md."',
      '',
      'NEXT: fill in "What we can do here" in SITE.md, then carry on with what the user asked for.',
    ].join('\n'),
  );
}

function cmdStart(url, flags) {
  const base = baseFolder(flags);
  const here = loadProject(base);
  if (here && url && bareHost(url) !== bareHost(here.site.url)) {
    throw new SiteError(
      [
        `This folder is the project for ${here.site.url}, not ${url}.`,
        '',
        'Ask the user which they meant:',
        `  - ${here.site.url}: carry on here, with \`site start\`.`,
        `  - ${url}, worked on before: open that site's own Cowork project, so its notes carry over.`,
        `  - ${url}, new: start a new Cowork project with its own empty folder, and set it up there.`,
      ].join('\n'),
    );
  }
  const { project, candidates } = resolveProject(base, { host: url ? bareHost(url) : null });
  if (!project) {
    if (url) return cmdDetect(url);
    if (candidates.length > 1) {
      return out(
        [
          'This folder holds several website projects:',
          ...candidates.map((p) => `  ${shortPath(p.paths.root).padEnd(30)} ${p.site.url}`),
          '',
          'NEXT: ask the user which site they are working on today, then run: site start <url>',
        ].join('\n'),
      );
    }
    return out(
      [
        'This folder is not set up as a website project yet.',
        '',
        'NEXT: ask the user which website they are working on (its address), then run:',
        '  site start <url>',
        '',
        'If they have worked on a site with Claude before, this may be the wrong folder: ask',
        'them to open that earlier Cowork project instead, so its notes carry over.',
      ].join('\n'),
    );
  }

  const { site, paths } = project;

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
    ...(resolve(paths.root) !== resolve('.')
      ? [`           (a subfolder: pass --project ${shortPath(paths.root)} to every command)`]
      : []),
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
          ...(sendSuggestion(project).due
            ? [
                `  Enough has built up to be worth sending to ${MAINTAINER}. Mention it once this session, at a`,
                '  natural pause (see SKILL.md), then run: site findings --told',
              ]
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
  const project = currentProject(flags);
  ensureFindings(project);
  if (flags.told) {
    markSuggested(project);
    return out(`Noted. ${MAINTAINER} won't be mentioned again until more findings have built up.`);
  }
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
    `  - Don't mention sending this to ${MAINTAINER}; \`site start\` says when it is worth it.`,
  );
  out(lines.join('\n'));
}

function cmdFinding(positional, flags) {
  const project = currentProject(flags);
  const [id, ...words] = positional;
  if (!id) throw new SiteError('Usage: site finding <ID|new> "<what you saw, and how you know>"');
  const line = recordFinding(project, id === 'new' ? 'new' : id, words.join(' '));
  const next = nextQuestions(project);
  out([
    `Recorded in platform-findings.md (${id}): ${line}`,
    next?.now.length
      ? `Next, when the work reaches "${next.stage}": ${next.now[0].id} — ${next.now[0].askUser ? '[ask the user] ' : ''}${next.now[0].question}`
      : 'Every checklist question is answered.',
  ].join('\n'));
}

function cmdNote(positional, flags) {
  const project = currentProject(flags);
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
      return cmdStart(positional[0], flags);
    case 'detect':
      return cmdDetect(positional[0]);
    case 'init':
      return cmdInit(positional[0], flags);
    case 'note':
      return cmdNote(positional, flags);
    case 'findings':
      return cmdFindings(flags);
    case 'finding':
      return cmdFinding(positional, flags);
  }

  // Everything else belongs to a platform adapter.
  const project = currentProject(flags, { required: false });
  const name = typeof flags.endpoint === 'string' ? 'craft' : project ? adapterName(project.site) : null;
  const adapter = ADAPTERS[name];

  if (!adapter?.COMMANDS.includes(command)) {
    const known = Object.values(ADAPTERS).some((a) => a.COMMANDS.includes(command));
    if (!known) throw new GuardError(`Unknown command \`${command}\`.\n\n${USAGE}`);
    if (!project) throw new SiteError('No website project here yet. Run `site start <url>` first.');
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
