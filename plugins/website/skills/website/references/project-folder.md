# The project folder

One folder per website. Everything the skill produces and everything it learns goes
here, so that **a new session opened in the same folder carries on where the last one
stopped**. Nobody should have to keep one long conversation alive.

```
<project folder>/
  SITE.md          overview, current state and notes. Read first, every session.
  site.yaml        settings and structured facts: platform, admin address, account,
                   preferences, how the site is built, setup progress, scripts' state
  learnings.md     dated log: did / worked / broke / next time
  TODO.md          things to fix or improve, found as work goes; raised each session
  admin-guide.md   how THIS site's admin actually behaves (written once explored)
  platform-findings.md   what this project taught us about the PLATFORM, for the skill
  export/          the site, exported
  audits/          audit reports, one per run, dated
  design/          design system, blocks in use (blocks.md) and on offer (available-blocks.md),
                   briefs, Claude Design results
  snapshots/       copies of a page taken before editing it
  feedback/        notes and the zip made by `site feedback`, for the skill author
  CLAUDE.md        a marked block telling new sessions to read SITE.md
```

`site init` creates `SITE.md`, `site.yaml`, `learnings.md`, `TODO.md`,
`platform-findings.md` and the `CLAUDE.md` block. The rest appear as work happens.

**After an update.** `site setup` on an existing folder brings it up to the current
layout: a `site.json` from before 0.7.0 moves into `site.yaml` (every command also does
this on its own), known files in the wrong place move to where the skill looks (never
over an existing file), missing files are added, and anything else unexpected is listed
for Claude to ask the user about. Nothing is deleted.

## SITE.md

Written for a person as much as for Claude. Three sections:

- **What this site is** — a few plain sentences written during setup: who the site is
  for, what it offers, which pages matter most.
- **Current state** — where things stand: last export and audit with their headline
  numbers, any design change in progress and which step it is on, whether the scripts
  can reach the site (dated, with what was decided), anything waiting on the user.
  Rewrite this section rather than appending to it.
- **Notes** — the project's memory. Dated bullets, added with `site note "<text>"`.

Projects set up before 0.7.0 also have "What we can do here" and "How the site is
built". Move what they hold into `site.yaml` (`access`, `structure`) when you next
update them, and drop the sections.

### What makes a good note

A note is a fact a future session would otherwise have to rediscover or ask again:

- Shared content and its reach: "Pre-footer 1234 is shared by 7 pages — always ask."
- Decisions and standing rules from the user: "Copy fixes and design changes go in
  separate rounds." "Never edit the Pricing page without asking the owner first."
- Facts about the setup: "Admin is at /cms, not /admin." "Login lasts about a day."
- Things that did not work, briefly, with a pointer to `learnings.md`.

Not a note: anything already in `site.yaml`, a diary of the session, or a secret.

### Rules

- **Date everything.** Mark anything not yet checked as unverified.
- **Correct, don't contradict.** When a note turns out wrong, edit or delete it.
- **Keep it short** — under about 200 lines. Detail goes in `learnings.md` or
  `admin-guide.md`, and SITE.md points there.
- **Never write passwords, cookies, tokens or 2FA codes** — not in any file. Logins live
  only in the browser. `site note` refuses text that looks like a secret.

## TODO.md

The user's to-do list for the site, shared between them and Claude. Claude adds an item
as soon as it finds something worth fixing, in any session, without stopping the work in
hand: `- [ ] YYYY-MM-DD — what is wrong, on which page, where to fix it (how found)`.
`site start` lists the open items, so the next session can offer them. The user can tick,
reorder or delete items freely; never rewrite their wording.

## admin-guide.md

Written the first time anyone drives this site's admin, and corrected every time after.
It overrides the bundled platform guide, because it describes this site, not the
platform in general. Cover:

- The admin address and how to get to a page's editor (URL pattern, or the clicks).
- How a draft or preview works here, and **the exact label of every button that would
  publish** — these are the ones never to press.
- Exact labels for the controls used, and whether block or section ids are visible.
- How rich-text fields treat pasted HTML: kept, cleaned, or stripped.
- How long a typical edit took, and what was fiddly.
- A "never click" list.

Mark each item with the date it was checked.

## platform-findings.md

Seeded from the platform guide's "First-time checklist": the questions only a real,
logged-in admin can answer. Answer them with `site finding <ID> "<what you saw>"` as the
work reaches them, and add anything else about the platform with `site finding new`.
Questions come in the order a session reaches them, and `site findings` shows only the
current step's. This file is about the platform in general (WordPress, Shopify…), not
this site. Once enough has built up over a few sessions, Claude suggests, once, sending
it to the skill author, who folds it into the bundled guide. That is how the
skill learns from its first real use on each platform.

## site.yaml

Settings and structured facts, in YAML so a person can read and edit them. The scripts
and Claude both write it; comments added by hand are not kept when it is rewritten, so
lasting rules go in `preferences.notes`. Its sections:

- `url`, `platform`, `confirmedBy`, `detection`: what the site is and how that was
  decided.
- `adminUrl`: where the user signs in.
- `account`: `role` (owner, administrator, editor…) and `plan`. Asked during setup.
- `access`: `browser` (`claude-in-chrome` or `built-in`), `drafts` (whether the site
  can keep unpublished changes), and `workspaceConfirmed` when the user confirmed this
  is Cowork although it looked like a plain chat.
- `preferences`: `publishing` (`ask-first`, the default, or `drafts-only`) and `notes`,
  the site's standing rules. A preference can make Claude more careful, never less.
- `structure`: `pages` (main pages and how they nest: `path`, `title`, `children`),
  `shared` (header, navigation, footer, anything repeated), `styleGuide`. Other keys are
  fine: a site's structure is its own.
- `onboarding`: the date each setup step was done, and `skipped` steps with the reason.
  `site onboarding` shows what is left.
- `audit.placeholders`: extra demo-copy phrases the audit should flag, such as a theme
  vendor's sample company name.
- `craft.graphql`: the Craft endpoint, if detection missed it.
- `skill.version`: the skill version that last set up the folder.
- `state`: the scripts' own records (last export, last audit, reach). No need to edit.

## CLAUDE.md

New chats in the same Cowork project see the same folder, and the skill's own
`start` command is what resumes a project, so the Cowork project needs no Instructions.
The skill still keeps a short block in `CLAUDE.md`, between `<!-- website-skill:start -->` and
`<!-- website-skill:end -->`, for tools that do read it (Claude Code). Anything outside
the markers belongs to the user and is never touched.
