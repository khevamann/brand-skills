// Setup progress: the steps of a site's first session, and which are done.
//
// A field report showed the first session skipped entirely: Claude set up the folder,
// asked "what would you like to change?", and worked request by request for two
// sessions without anyone noticing. So each step is worked out from what it leaves
// behind in the folder (a review in audits/, the design system, site.yaml filled in),
// not from anyone remembering. A step done in the browser instead of by the scripts
// writes the same files, so it counts the same. `site start` leads with whatever is
// left, every session, until setup is finished.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SiteError, today } from './cli.mjs';
import { saveSite } from './project.mjs';

const has = (root, rel) => existsSync(join(root, rel));
const filesIn = (root, rel, pattern) =>
  existsSync(join(root, rel)) ? readdirSync(join(root, rel)).filter((f) => pattern.test(f)) : [];
const filled = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/**
 * The steps, in order. `check` returns null when done, or what is still missing.
 * `scripts` and `browser` say how to do the step either way.
 */
export const STEPS = [
  {
    id: 'checks',
    title: 'Check the setup',
    check: (p) => (p.site.onboarding?.checks ? null : 'run site setup and fix any problem it reports'),
    scripts: 'site setup runs the checks.',
  },
  {
    id: 'project',
    title: 'Confirm the folder and the platform, and set up the project',
    check: () => null, // a project exists, so this is done
  },
  {
    id: 'sign-in',
    title: 'Open the browser, have them sign in to the admin, and ask their role and plan',
    check: (p) => {
      const missing = [];
      if (!filled(p.site.adminUrl)) missing.push('adminUrl');
      if (!filled(p.site.account?.role)) missing.push('account.role');
      if (!filled(p.site.account?.plan)) missing.push('account.plan');
      if (!filled(p.site.access?.browser)) missing.push('access.browser');
      return missing.length ? `fill in ${missing.join(', ')} in site.yaml ("unknown" is fine if they don't know)` : null;
    },
  },
  {
    id: 'review',
    title: 'Snapshot every page and review it',
    check: (p) => (filesIn(p.paths.root, 'audits', /\.md$/).some((f) => !/^layout-/.test(f)) ? null : 'a review in audits/'),
    scripts: 'site export, then site audit --links (in the background).',
    browser: 'read every page in the sitemap through the browser; write the review to audits/review-<date>.md.',
  },
  {
    id: 'editor',
    title: 'Look through the editor without saving: what it can add, and how the admin works',
    check: (p) => {
      const missing = [];
      if (!has(p.paths.root, 'admin-guide.md')) missing.push('admin-guide.md');
      const craftApi = p.site.platform === 'craft' && p.site.craft?.graphql;
      if (!craftApi && !has(p.paths.root, 'design/available-blocks.md')) missing.push('design/available-blocks.md');
      return missing.length ? missing.join(' and ') : null;
    },
  },
  {
    id: 'layout',
    title: 'Check the main pages at phone, tablet and desktop widths for visible problems',
    check: (p) => (filesIn(p.paths.root, 'audits', /^layout-.*\.md$/).length ? null : 'audits/layout-<date>.md'),
    browser: 'scripts/browser/layout-check.js in a tab on the site, then screenshots to confirm.',
  },
  {
    id: 'design',
    title: 'Capture the design system and the blocks the pages use',
    check: (p) => {
      const missing = ['design/system/DESIGN-SYSTEM.md', 'design/blocks.md'].filter((f) => !has(p.paths.root, f));
      return missing.length ? missing.join(' and ') : null;
    },
    scripts: 'site blocks and site design-system (in the background, after the snapshot).',
    browser: 'read the styles and blocks from the pages; write the same two files.',
  },
  {
    id: 'structure',
    title: 'Write down how the site is built',
    check: (p) => {
      const missing = [];
      if (!filled(p.site.structure?.pages)) missing.push('structure.pages');
      if (!filled(p.site.structure?.shared)) missing.push('structure.shared');
      return missing.length ? `fill in ${missing.join(' and ')} in site.yaml` : null;
    },
  },
  {
    id: 'handover',
    title: 'Hand over: what we can do together, and one visible fix to try now',
    check: (p) => (p.site.onboarding?.handover ? null : 'run site onboarding done after handing over'),
  },
];

/** Every step with its status: done (date), skipped (why), or what is missing. */
export function onboardingStatus(project) {
  const record = project.site.onboarding ?? {};
  const steps = STEPS.map((step) => {
    const missing = step.check(project);
    const skipped = record.skipped?.[step.id];
    return {
      ...step,
      done: !missing,
      at: !missing ? record[step.id] ?? null : null,
      missing,
      skipped: missing && skipped ? skipped : null,
    };
  });
  const open = steps.filter((s) => !s.done);
  return { steps, open, finished: open.length === 0 };
}

/**
 * Record what is done, dated, the first time each step is seen done. Called by
 * `start`, `setup` and `onboarding`, so the dates say when each step was finished.
 */
export function syncOnboarding(project) {
  const { steps } = onboardingStatus(project);
  const record = { ...(project.site.onboarding ?? {}) };
  let changed = false;
  for (const s of steps) {
    if (s.done && !record[s.id]) {
      record[s.id] = today();
      changed = true;
    }
    if (s.done && record.skipped?.[s.id]) {
      const { [s.id]: _, ...rest } = record.skipped;
      record.skipped = rest;
      changed = true;
    }
  }
  if (changed) {
    project.site.onboarding = record;
    saveSite(project);
  }
  return onboardingStatus(project);
}

/** Mark the hand-over done. Refuses while earlier steps are neither done nor skipped. */
export function finishOnboarding(project) {
  const { open } = onboardingStatus(project);
  const blocking = open.filter((s) => s.id !== 'handover' && !s.skipped);
  if (blocking.length) {
    throw new SiteError(
      ['Setup isn\'t finished. Still to do:', ...blocking.map((s) => `  - ${s.id}: ${s.title} (missing: ${s.missing})`)].join('\n'),
    );
  }
  project.site.onboarding = { ...(project.site.onboarding ?? {}), handover: today() };
  saveSite(project);
  return syncOnboarding(project);
}

/** Put a step off, with the reason, e.g. "they can't sign in until Monday". */
export function skipStep(project, id, why) {
  const step = STEPS.find((s) => s.id === id);
  if (!step) throw new SiteError(`No setup step \`${id}\`. Steps: ${STEPS.map((s) => s.id).join(', ')}.`);
  if (!String(why ?? '').trim()) throw new SiteError('Say why the step is put off: site onboarding skip <step> "<why>".');
  if (['checks', 'project', 'handover'].includes(id)) throw new SiteError(`\`${id}\` can't be skipped.`);
  const record = { ...(project.site.onboarding ?? {}) };
  record.skipped = { ...(record.skipped ?? {}), [id]: `${today()}: ${String(why).trim()}` };
  project.site.onboarding = record;
  saveSite(project);
}

/** The lines `start` and `setup` print about setup progress. Empty once finished. */
export function onboardingLines(project, { full = false } = {}) {
  const { steps, open, finished } = syncOnboarding(project);
  if (finished && !full) return [];
  const lines = [
    finished
      ? 'SETUP: finished.'
      : `SETUP NOT FINISHED — ${steps.length - open.length} of ${steps.length} steps done. Finish these before other work:`,
  ];
  for (const [n, s] of steps.entries()) {
    if (s.done && !full) continue;
    const mark = s.done ? '✓' : s.skipped ? '–' : ' ';
    lines.push(`  [${mark}] ${n + 1}. ${s.title}${s.done && s.at ? ` (${s.at})` : ''}`);
    if (!s.done) {
      lines.push(s.skipped ? `         put off: ${s.skipped}` : `         missing: ${s.missing}`);
      if (s.scripts) lines.push(`         with the scripts: ${s.scripts}`);
      if (s.browser) lines.push(`         in the browser:   ${s.browser}`);
    }
  }
  if (!finished) {
    lines.push(
      '  Make these your task list for this session (the app\'s to-do list), in this order.',
      '  If the user asks for something else first, say setup isn\'t finished and roughly how',
      '  long the rest takes, then do what they prefer; add their request to the end of the list.',
    );
  }
  return lines;
}
