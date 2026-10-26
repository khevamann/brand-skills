// Platform findings: how the skill finishes building itself.
//
// Each platform guide ends with a "First-time checklist": the questions only a real,
// logged-in site can answer (which button publishes, whether an admin link pattern
// works, how pasted text behaves). Nobody has a test site, so the first real project
// on a platform is the test. Its folder gets a platform-findings.md seeded from that
// checklist; the agent answers questions as it reaches them and records anything
// else it learns about the platform. The file then goes back to whoever maintains the
// skill, who folds the answers into the guide — see docs/folding-in-findings.md.
//
// Findings are about the platform in general. Facts about one site belong in its
// SITE.md and admin-guide.md instead.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SiteError, today } from './cli.mjs';

const GUIDES = fileURLToPath(new URL('../../references/platforms/', import.meta.url));
const CHECKLIST_HEADING = '## First-time checklist';
const OTHER_HEADING = '## Other findings';

export const findingsPath = (project) => join(project.paths.root, 'platform-findings.md');

/** The checklist questions from a platform guide: [{ id, question }]. */
export function checklistFor(platform, guidesDir = GUIDES) {
  const file = join(guidesDir, `${platform}.md`);
  if (!existsSync(file)) return [];
  const body = readFileSync(file, 'utf8');
  const at = body.indexOf(CHECKLIST_HEADING);
  if (at < 0) return [];
  const section = body.slice(at + CHECKLIST_HEADING.length).split(/\n## /)[0];
  const items = [];
  for (const m of section.matchAll(/^- \*\*([A-Z]{2}-\d+)\*\* — ([\s\S]*?)(?=\n- \*\*[A-Z]{2}-\d+\*\*|\n\n|$)/gm)) {
    items.push({ id: m[1], question: m[2].replace(/\s*\n\s*/g, ' ').trim() });
  }
  return items;
}

function template(project, checklist) {
  const { site } = project;
  return [
    `# What we learned about ${site.platformName}`,
    '',
    `From working on ${site.url}, started ${today()}.`,
    '',
    `These are findings about ${site.platformName} in general: how its admin really behaves,`,
    'which links and buttons do what. They are not about this one site (that goes in SITE.md',
    'and admin-guide.md). When the checklist is mostly answered, or something surprising',
    'happens, send this file to whoever maintains the website skill. Their next',
    `${site.platformName} site then starts from facts instead of guesses.`,
    '',
    CHECKLIST_HEADING.replace('First-time c', 'C'),
    '',
    ...checklist.flatMap(({ id, question }) => [`### ${id} — ${question}`, 'Status: open', '']),
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
  const block = missing.flatMap(({ id, question }) => [`### ${id} — ${question}`, 'Status: open', '']).join('\n');
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
