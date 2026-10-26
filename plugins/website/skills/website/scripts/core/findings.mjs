// Platform findings: how the skill finishes building itself.
//
// Each platform guide ends with a "First-time checklist": the questions only a real,
// logged-in site can answer (which button publishes, whether an admin link pattern
// works, how pasted text behaves). Nobody has a test site, so the first real project
// on a platform is the test. Its folder gets a platform-findings.md seeded from that
// checklist; the agent answers questions as it reaches them and records anything
// else it learns about the platform. The file then goes back to Kheva, who maintains
// the skill and folds the answers into the guide — see docs/folding-in-findings.md.
//
// Findings are about the platform in general. Facts about one site belong in its
// SITE.md and admin-guide.md instead.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SiteError, today } from './cli.mjs';
import { recordState } from './project.mjs';

const GUIDES = fileURLToPath(new URL('../../references/platforms/', import.meta.url));

/** Who maintains the skill, and so who findings files go back to. */
export const MAINTAINER = 'Kheva';
const CHECKLIST_HEADING = '## First-time checklist';
const OTHER_HEADING = '## Other findings';

export const findingsPath = (project) => join(project.paths.root, 'platform-findings.md');

/**
 * The checklist questions from a platform guide, in the order a real session reaches
 * them: [{ id, question, stage, askUser }]. Stages are the guide's `###` headings
 * (Logging in, Opening a page, Making a draft, Editing, Saving).
 */
export function checklistFor(platform, guidesDir = GUIDES) {
  const file = join(guidesDir, `${platform}.md`);
  if (!existsSync(file)) return [];
  const body = readFileSync(file, 'utf8');
  const at = body.indexOf(CHECKLIST_HEADING);
  if (at < 0) return [];
  const section = body.slice(at + CHECKLIST_HEADING.length).split(/\n## /)[0];
  const items = [];
  let stage = null;
  for (const m of section.matchAll(/^### (.+)$|^- \*\*([A-Z]{2}-\d+)\*\* — ([\s\S]*?)(?=\n- \*\*[A-Z]{2}-\d+\*\*|\n\n|$)/gm)) {
    if (m[1]) {
      stage = m[1].trim();
      continue;
    }
    const raw = m[3].replace(/\s*\n\s*/g, ' ').trim();
    items.push({
      id: m[2],
      question: raw.replace(/^_\(ask the user\)_\s*/, ''),
      stage,
      askUser: raw.startsWith('_(ask the user)_'),
    });
  }
  return items;
}

/**
 * The questions to work on now: the open ones in the earliest stage that still has
 * any. Walking through them stage by stage, as the session gets there, is the point —
 * nobody should be handed the whole list.
 */
export function nextQuestions(project, guidesDir = GUIDES) {
  const findings = readFindings(project);
  if (!findings) return null;
  const guide = new Map(checklistFor(project.site.platform, guidesDir).map((q) => [q.id, q]));
  const open = findings.questions
    .filter((q) => q.status === 'open')
    .map((q) => ({ ...q, stage: guide.get(q.id)?.stage ?? null, askUser: guide.get(q.id)?.askUser ?? false }));
  const stage = open[0]?.stage ?? null;
  const now = open.filter((q) => q.stage === stage);
  return { findings, stage, now, later: open.length - now.length, answered: findings.questions.length - open.length };
}

/** One question in a project's findings file. `When:` is for the reader; status drives the walk-through. */
const entry = ({ id, question, stage, askUser }) => [
  `### ${id} — ${question}`,
  `When: ${stage ?? 'any time'}${askUser ? ' · ask the user' : ''}`,
  'Status: open',
  '',
];

function template(project, checklist) {
  const { site } = project;
  return [
    `# What we learned about ${site.platformName}`,
    '',
    `From working on ${site.url}, started ${today()}.`,
    '',
    `These are findings about ${site.platformName} in general: how its admin really behaves,`,
    'which links and buttons do what. They are not about this one site (that goes in SITE.md',
    'and admin-guide.md).',
    '',
    `Once enough is here, Claude will suggest sending this file to ${MAINTAINER}, who maintains`,
    `the website skill. ${MAINTAINER} folds the answers into the skill, so the next`,
    `${site.platformName} site starts from facts instead of guesses. It holds nothing private`,
    'about your site beyond its address.',
    '',
    CHECKLIST_HEADING.replace('First-time c', 'C'),
    '',
    ...checklist.flatMap(entry),
    OTHER_HEADING,
    '',
    '_None yet._',
    '',
  ].join('\n');
}

/**
 * Create the project's findings file, or add questions the guide has gained since.
 * Returns the number of questions added; 0 when there is no checklist.
 */
export function ensureFindings(project, guidesDir = GUIDES) {
  const checklist = checklistFor(project.site.platform, guidesDir);
  if (!checklist.length) return 0;
  const file = findingsPath(project);
  if (!existsSync(file)) {
    writeFileSync(file, template(project, checklist));
    return checklist.length;
  }
  const body = readFileSync(file, 'utf8');
  const missing = checklist.filter(({ id }) => !body.includes(`### ${id} — `));
  if (!missing.length) return 0;
  const block = missing.flatMap(entry).join('\n');
  const at = body.indexOf(OTHER_HEADING);
  writeFileSync(file, at < 0 ? `${body.trimEnd()}\n\n${block}` : `${body.slice(0, at)}${block}\n${body.slice(at)}`);
  return missing.length;
}

/** Every checklist question with its status and answers, plus the other findings. */
export function readFindings(project) {
  const file = findingsPath(project);
  if (!existsSync(file)) return null;
  const body = readFileSync(file, 'utf8');
  const otherAt = body.indexOf(OTHER_HEADING);
  const main = otherAt < 0 ? body : body.slice(0, otherAt);
  const questions = main.split(/\n(?=### [A-Z]{2}-\d+ — )/).slice(1).map((chunk) => {
    const [heading, ...rest] = chunk.split('\n');
    const m = heading.match(/^### ([A-Z]{2}-\d+) — (.*)$/);
    return {
      id: m[1],
      question: m[2],
      status: rest.find((l) => l.startsWith('Status:'))?.slice(7).trim() ?? 'open',
      answers: rest.filter((l) => l.startsWith('- ')),
    };
  });
  const other = otherAt < 0 ? [] : body.slice(otherAt).split('\n').filter((l) => l.startsWith('- '));
  return { file, questions, other };
}

/**
 * Record an answer to a checklist question (`id`), or a finding outside the checklist
 * (`id` = "new"). Answers accumulate: a later visit can confirm or correct an earlier one.
 */
export function recordFinding(project, id, text) {
  const note = String(text ?? '').trim().replace(/\s*\n\s*/g, ' ');
  if (!note) throw new SiteError('A finding needs some text: what you saw, and how you know.');
  if (/password|passwd|api[_ -]?key|secret|token\s*[:=]/i.test(note)) {
    throw new SiteError('Findings must never hold passwords, keys or tokens. Leave the secret out.');
  }
  const file = findingsPath(project);
  if (!existsSync(file)) ensureFindings(project);
  if (!existsSync(file)) throw new SiteError(`${project.site.platformName} has no first-time checklist.`);
  let body = readFileSync(file, 'utf8');
  const line = `- ${today()} — ${note}`;

  if (id === 'new') {
    const at = body.indexOf(OTHER_HEADING);
    const head = at < 0 ? `${body.trimEnd()}\n\n` : body.slice(0, at);
    const earlier = at < 0 ? [] : body.slice(at).split('\n').filter((l) => l.startsWith('- '));
    writeFileSync(file, `${head}${OTHER_HEADING}\n\n${[...earlier, line].join('\n')}\n`);
    return line;
  }

  const key = String(id).toUpperCase();
  const start = body.indexOf(`### ${key} — `);
  if (start < 0) throw new SiteError(`No checklist question ${key}. Run \`site findings\` for the list, or use \`new\`.`);
  const nextQ = body.indexOf('\n### ', start + 4);
  const nextH = body.indexOf(`\n${OTHER_HEADING}`, start);
  const end = [nextQ, nextH].filter((n) => n > 0).reduce((a, b) => Math.min(a, b), body.length);
  const chunk = body.slice(start, end).replace(/Status: open/, 'Status: answered').trimEnd();
  writeFileSync(file, `${body.slice(0, start)}${chunk}\n${line}\n${body.slice(end).replace(/^\n?/, '\n')}`);
  return line;
}

// ------------------------------------------------------------ sending back

/** How many new findings make another reminder worth it. */
const MORE_BEFORE_ASKING_AGAIN = 5;

/**
 * Whether now is the moment to suggest sending the findings to the maintainer. Once
 * enough has built up over a few sessions — half the checklist (at least five
 * findings), or all of it — and then again only after real progress. Never a nag.
 */
export function sendSuggestion(project) {
  const findings = readFindings(project);
  if (!findings) return { due: false };
  const total = findings.questions.length;
  const answered = findings.questions.filter((q) => q.status !== 'open').length;
  const count = answered + findings.other.length;
  const complete = total > 0 && answered === total;
  const last = project.site.state?.findingsSuggested;

  let due;
  if (!last) due = complete || count >= Math.max(MORE_BEFORE_ASKING_AGAIN, Math.ceil(total / 2));
  else due = count >= last.count + MORE_BEFORE_ASKING_AGAIN || (complete && !last.complete);
  return { due, count, answered, total, complete, file: findings.file };
}

/** Remember that the user has been told, so it is not mentioned again for a while. */
export function markSuggested(project) {
  const { count, complete } = sendSuggestion(project);
  recordState(project, 'findingsSuggested', { count: count ?? 0, complete: Boolean(complete) });
}
