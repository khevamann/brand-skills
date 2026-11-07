#!/usr/bin/env node
// site — read-only tools for working on a website, whatever it is built on.
//
// Run it from the project folder: the folder the user opened for this website. It
// keeps everything there (SITE.md, site.yaml, learnings, exports, audits, designs)
// so a new session in the same folder carries on where the last one stopped.
//
// Platform-neutral commands live here. Everything else is dispatched to the
// adapter for the project's platform. Nothing here, or in any adapter, writes to
// the website: changes are made by a person, or as a draft through the admin in the
// browser, and a person publishes.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs, out, exitWith, GuardError, SiteError, today } from './core/cli.mjs';
import { detect, findCraftGraphql, checkReach } from './core/detect.mjs';
import {
  PLATFORMS, loadProject, initProject, addNote, readNotes, projectPaths, writeClaudeMdBlock, ensureTodo, readTodos,
  CLAUDE_MD_START, bareHost, resolveProject, newProjectFolder, recordState, saveSite, ensureLearnings,
} from './core/project.mjs';
import { ensureFindings, readFindings, recordFinding, nextQuestions, sendSuggestion, markSuggested, MAINTAINER } from './core/findings.mjs';
import { runChecks, checkLines, describeWorkspace, tidyProject } from './core/setup.mjs';
import { onboardingLines, finishOnboarding, skipStep, syncOnboarding } from './core/onboarding.mjs';
import { VERSION, WHATS_NEW } from './version.mjs';
import { buildFeedback } from './core/feedback.mjs';
import { findTranscripts } from './core/transcript.mjs';
import * as craft from './adapters/craft/cli.mjs';
import * as generic from './adapters/generic/cli.mjs';

const ADAPTERS = { craft, generic };

/** The folder named by --project, or the current one. */
const baseFolder = (flags) => (typeof flags.project === 'string' ? flags.project : '.');

/** How to refer to a project folder in messages and in --project. */
const shortPath = (dir) => relative(process.cwd(), dir) || '.';

/** A folder as it must be typed in a command: quoted when it has spaces or quotes. */
const shellArg = (dir) => {
  const p = shortPath(dir);
  return /^[\w./@+-]+$/.test(p) ? p : `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
};

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
  site setup [url]                   Check the workspace, folder and access, then set up a
                                     new project, or bring this one up to date after an update
      --folder-confirmed             The user confirmed this is the folder they made for the site
  site start [url]                   Resume the project, or begin one for <url>
  site detect <url>                  Work out what platform a site runs on
  site init <url> --platform <p> --new
                                     Set up a project for a site: here if this folder is
                                     empty, otherwise in a new subfolder named after the site
      p = craft | wordpress | shopify | squarespace | other
      --confirmed-by user|detection  Who decided the platform (default: detection)
      --graphql <url>                Craft only: the GraphQL endpoint, if detection missed it
  site onboarding                    Setup progress: which first-session steps are done
      done                           Record the hand-over, once every other step is done
      skip <step> "<why>"            Put a step off, e.g. the user can't sign in today
  site feedback                      Bundle what this project learned, and the session
                                     transcripts, into a zip for the skill author
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

const newSiteQuestion = (folder = describeWorkspace().name) => [
  'FIRST, before setting anything up, ask the user in plain words, in one message:',
  `  "I'll keep everything about this site in your folder “${folder}”. Is that the folder you`,
  '   made for it? And is this the first time you\'re working on this site with Claude? If you',
  '   have before, please open that same Cowork project instead, so its notes carry over."',
  '  - Wrong folder → stop. Ask them to attach the right one to this Cowork project.',
  '  - Worked on it before → stop here. Don\'t set anything up; help them find that project.',
  '  - Right folder, new site → carry on below, and pass --new to init to show you asked both.',
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
  lines.push(...newSiteQuestion(), '');
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
    throw new SiteError(['Not set up yet.', '', ...newSiteQuestion()].join('\n'));
  }
  // The same hard checks as setup: no project in a plain chat or in Claude's own
  // workspace. --new means the user confirmed the folder.
  const precheck = await runChecks({
    cwd: baseFolder(flags), folderConfirmed: true, appConfirmed: Boolean(flags['folder-confirmed']),
  });
  if (precheck.hard.length) return stopSetup(precheck);
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
            `  Pass --project ${shellArg(project.paths.root)} to every command from now on.`,
          ]
        : []),
      '  SITE.md       overview and notes — read first every session',
      '  site.yaml     settings and structured facts: account, preferences, how the site is built',
      '  learnings.md  dated log of what worked and what broke',
      '  TODO.md       things to fix, added as you find them; raised at the start of each session',
      '  CLAUDE.md     points new sessions at SITE.md',
      ...(questions ? [`  platform-findings.md  ${questions} open questions about ${project.site.platformName}, answered as you work`] : []),
      '',
      `What works here: ${status.summary}`,
      `Guide: ${status.guide}`,
      ...(platform === 'craft' && !extra.craft.graphql
        ? ['', 'No public Craft GraphQL endpoint was found. If the user knows one, re-run init with --graphql.']
        : []),
      '',
      ...onboardingLines(recordChecks(project), { full: true }),
      '',
      'NEXT: carry straight on with the first session (SKILL.md). Open the browser and have the user',
      'sign in to the admin now, then work through the steps above. Don\'t ask what they want to work on',
      'until the hand-over.',
    ].join('\n'),
  );
}

/** Setup's hard checks passed for this project: record it as the first step done. */
function recordChecks(project) {
  if (!project.site.onboarding?.checks) {
    project.site.onboarding = { checks: today(), ...(project.site.onboarding ?? {}) };
    saveSite(project);
  }
  return project;
}

/** Print the checks and the fixes, and exit 4: setup can't go on until they are fixed. */
function stopSetup(result) {
  out(checkLines(result).join('\n'));
  process.exitCode = 4;
}

async function cmdSetup(url, flags) {
  const base = baseFolder(flags);
  const { project, candidates } = resolveProject(base, { host: url ? bareHost(url) : null });
  if (!project && candidates.length > 1 && !url) {
    return out(
      [
        'This folder holds several website projects:',
        ...candidates.map((p) => `  ${shortPath(p.paths.root).padEnd(30)} ${p.site.url}`),
        '',
        'NEXT: ask the user which site, then run: site setup <url>',
      ].join('\n'),
    );
  }
  const target = url ?? project?.site.url ?? null;
  const result = await runChecks({
    cwd: project ? project.paths.root : base,
    url: target,
    folderConfirmed: Boolean(flags['folder-confirmed']),
    appConfirmed: Boolean(flags['folder-confirmed'] || project?.site.access?.workspaceConfirmed),
    known: Boolean(project),
  });
  if (result.hard.length) return stopSetup(result);
  if (project && flags['folder-confirmed'] && describeWorkspace(project.paths.root).chat) {
    project.site.access = { ...(project.site.access ?? {}), workspaceConfirmed: today() };
  }

  if (!project) {
    const lines = checkLines(result).filter((l) => !l.startsWith('CONFIRM THE FOLDER'));
    if (!target) {
      lines.push('NEXT: ask the user which website they are working on (its address), then run: site setup <url>');
      return out(lines.join('\n'));
    }
    if (result.checks.find((c) => c.id === 'reach')?.ok) {
      out(lines.join('\n'));
      return cmdDetect(target);
    }
    // Can't reach it yet, so nothing to detect from: the user's answer decides.
    lines.push(
      ...newSiteQuestion(),
      '',
      'THEN ask which platform the site is built on, offering exactly these options:',
      '  WordPress · Shopify · Craft CMS · Squarespace · Other / not sure',
      `and run: site init ${target} --platform <answer> --confirmed-by user --new`,
    );
    return out(lines.join('\n'));
  }

  // An existing project: bring it up to the current layout, then say what is left.
  const changes = [];
  if (project.migrated) changes.push('Moved the settings from site.json into site.yaml.');
  const { moved, unexpected } = tidyProject(project);
  for (const m of moved) changes.push(`Moved ${m}.`);
  for (const [file, ensure] of [['TODO.md', ensureTodo], ['learnings.md', ensureLearnings], ['platform-findings.md', ensureFindings]]) {
    if (!existsSync(join(project.paths.root, file))) {
      ensure(project);
      changes.push(`Added ${file}.`);
    }
  }
  if (writeClaudeMdBlock(project.paths.claudeMd) !== 'updated') changes.push('Added the pointer to SITE.md in CLAUDE.md.');
  const before = project.site.skill?.version ?? null;
  if (before !== VERSION) {
    project.site.skill = { ...(project.site.skill ?? {}), version: VERSION };
    changes.push(before ? `Updated from version ${before} to ${VERSION}.` : `Recorded the skill version (${VERSION}).`);
  }
  saveSite(recordChecks(project));

  out(
    [
      ...checkLines(result).filter((l) => !l.startsWith('CONFIRM THE FOLDER')),
      `WEBSITE PROJECT — ${project.site.url} (${project.site.platformName}), skill ${VERSION}`,
      `Folder: ${project.paths.root}`,
      '',
      'BROUGHT UP TO DATE',
      ...(changes.length ? changes.map((c) => `  - ${c}`) : ['  - Nothing needed changing.']),
      ...(before !== VERSION ? ['', `NEW IN ${VERSION} (tell the user in a line or two)`, ...WHATS_NEW.map((w) => `  - ${w}`)] : []),
      ...(unexpected.length
        ? [
            '',
            'NOT PART OF THE PROJECT LAYOUT — ask the user before moving or deleting any of these;',
            'they may be theirs:',
            ...unexpected.map((u) => `  - ${u}`),
          ]
        : []),
      '',
      ...onboardingLines(project, { full: true }),
      '',
      'NEXT: read SITE.md in full. If setup isn\'t finished, finish it now (SKILL.md, "The first session").',
    ].join('\n'),
  );
}

function cmdFeedback(flags) {
  const project = currentProject(flags);
  const transcripts = findTranscripts({ projectRoot: project.paths.root, host: bareHost(project.site.url) });
  const r = buildFeedback(project, { transcripts, skillVersion: VERSION });
  out(
    [
      `FEEDBACK BUNDLE — ${shortPath(r.zipPath)}`,
      '',
      'Included (emails and phone numbers replaced):',
      ...r.included.map((f) => `  - ${f}`),
      ...(r.skipped.length ? ['', 'Left out:', ...r.skipped.map((x) => `  - ${x.name}: ${x.why}`)] : []),
      ...(transcripts.length
        ? []
        : [
            '',
            'No session transcripts were found. If feedback/ has no transcript yet, write a readable one of',
            'this session to feedback/transcript-<date>.md (SKILL.md, "Feedback for the skill author") and run',
            'site feedback again.',
          ]),
      '',
      'NEXT: tell the user where the zip is and what is in it, that they can open it to check, and to send',
      `it to ${MAINTAINER} (whoever shared the skill with them).`,
    ].join('\n'),
  );
}

function cmdOnboarding(positional, flags) {
  const project = currentProject(flags);
  const [action, step, ...why] = positional;
  if (action === 'done') {
    finishOnboarding(project);
    return out('Setup is finished and recorded. From now on, `site start` resumes the project as usual.');
  }
  if (action === 'skip') {
    skipStep(project, step, why.join(' '));
    return out(`Put off "${step}". \`site start\` keeps listing it until it is done. Add it to TODO.md too.`);
  }
  if (action) throw new SiteError('Usage: site onboarding [done | skip <step> "<why>"]');
  syncOnboarding(project);
  out(onboardingLines(project, { full: true }).join('\n'));
}

/** What `start` says about reaching the site: a new block, a known one, or one lifted. */
function reachLines(reach, { blockedSince, lifted, raisedBefore }) {
  if (reach.ok && lifted) {
    return [
      `Reach:     yes. It was blocked since ${lifted} and is allowed now. Correct what SITE.md says`,
      '           about it, and redo with the scripts anything that was done in the browser instead.',
    ];
  }
  if (reach.ok) return ['Reach:     yes, the scripts can read the site'];
  if (raisedBefore) {
    return [
      `Reach:     NO since ${blockedSince} (${reach.why}). Already raised with the user: see SITE.md for`,
      '           what was decided. Work through the browser; ask again only if they bring it up.',
    ];
  }
  return [
    `Reach:     NO (${reach.why}). The scripts can't read the site from here right now.`,
    '           Ask the user once to allow it, before going on (SKILL.md, "If the scripts can\'t',
    '           reach the website"). If it can\'t be allowed, work through the browser.',
  ];
}

async function cmdStart(url, flags) {
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

  // A project in a plain chat or in Claude's own workspace won't survive the session.
  const ws = describeWorkspace(paths.root);
  if (ws.chat && !site.access?.workspaceConfirmed) {
    const result = await runChecks({ cwd: paths.root, known: true, appConfirmed: Boolean(site.access?.workspaceConfirmed) });
    if (result.hard.length) return stopSetup(result);
  }

  // Keep the pointer for new sessions in place, without touching anything else.
  if (!existsSync(paths.claudeMd) || !readFileSync(paths.claudeMd, 'utf8').includes(CLAUDE_MD_START)) {
    writeClaudeMdBlock(paths.claudeMd);
  }

  ensureFindings(project);
  ensureTodo(project);
  const todos = readTodos(project);
  // Reach is checked fresh every session and never assumed: access can be granted mid-
  // conversation, or be blocked for good by an organization's policy. `since` marks
  // how long a block has lasted, so it is raised with the user once, not every session.
  const before = site.state?.reach;
  const reach = await checkReach(site.url);
  const blockedSince = reach.ok ? null : before && !before.ok ? before.since ?? before.at?.slice(0, 10) : today();
  const lifted = reach.ok && before && !before.ok ? before.since ?? before.at?.slice(0, 10) : null;
  recordState(project, 'reach', { ...reach, ...(blockedSince ? { since: blockedSince } : {}) });
  const next = nextQuestions(project);
  const status = platformStatus(site);
  const state = { ...(site.state ?? {}) };
  const notes = readNotes(project);
  const learningsCount = existsSync(paths.learnings)
    ? (readFileSync(paths.learnings, 'utf8').match(/^## \d{4}-\d{2}-\d{2}/gm) ?? []).length
    : 0;

  const setupLeft = onboardingLines(project);
  const outdated = (site.skill?.version ?? null) !== VERSION;
  const lines = [
    `WEBSITE PROJECT — ${site.url}`,
    '',
    ...(outdated
      ? [
          `UPDATED SKILL — this folder was set up by ${site.skill?.version ? `version ${site.skill.version}` : 'an older version'};`,
          `the skill is now ${VERSION}. Run site setup first: it brings the folder up to date.`,
          '',
        ]
      : []),
    ...(setupLeft.length ? [...setupLeft, ''] : []),
    `Platform:  ${site.platformName}${site.confirmedBy === 'user' ? ' (confirmed by the user)' : ' (detected)'}`,
    `Folder:    ${paths.root}`,
    ...(resolve(paths.root) !== resolve('.')
      ? [`           (a subfolder: pass --project ${shellArg(paths.root)} to every command)`]
      : []),
    `Last export: ${state.lastExport ? `${state.lastExport.at.slice(0, 10)} — ${state.lastExport.pages} pages` : 'none'}`,
    `Last audit:  ${state.lastAudit ? `${state.lastAudit.at.slice(0, 10)} — ${state.lastAudit.file}` : 'none'}`,
    `Learnings:   ${learningsCount} dated entr${learningsCount === 1 ? 'y' : 'ies'} in learnings.md`,
    `Admin guide: ${existsSync(paths.adminGuide) ? 'admin-guide.md' : 'not written yet — write one the first time the admin is explored'}`,
    '',
    ...reachLines(reach, { blockedSince, lifted, raisedBefore: Boolean(before && !before.ok) }),
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
    `TO-DO (${todos.length} open in TODO.md${todos.length > 5 ? ', first 5' : ''})`,
    ...(todos.length ? todos.slice(0, 5).map((t) => `  - ${t}`) : ['  none open']),
    '',
    `NOTES (${notes.length}${notes.length > 12 ? ', latest 12' : ''})`,
    ...(notes.length ? notes.slice(-12).map((n) => `  ${n}`) : ['  none yet']),
    '',
    setupLeft.length
      ? 'NEXT: read SITE.md in full, then finish setup (the steps at the top) before other work.'
      : 'NEXT: read SITE.md in full (and learnings.md before any apply), then carry on.',
    ...(!setupLeft.length && todos.length
      ? ['If the user has not said what to work on, mention the open to-dos in a line and offer to start on one.']
      : []),
  ];
  out(lines.join('\n'));
}

function cmdFindings(flags) {
  const project = currentProject(flags);
  ensureFindings(project);
  if (flags.told) {
    markSuggested(project);
    return out(`Noted. Sending it to ${MAINTAINER} won't be mentioned again until more findings have built up.`);
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
    case 'setup':
      return cmdSetup(positional[0], flags);
    case 'start':
      return cmdStart(positional[0], flags);
    case 'onboarding':
      return cmdOnboarding(positional, flags);
    case 'feedback':
      return cmdFeedback(flags);
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
