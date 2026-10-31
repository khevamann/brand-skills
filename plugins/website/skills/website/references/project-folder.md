# The project folder

One folder per website. Everything the skill produces and everything it learns goes
here, so that **a new session opened in the same folder carries on where the last one
stopped**. Nobody should have to keep one long conversation alive.

```
<project folder>/
  SITE.md          overview + notes. Read first, every session.
  site.json        facts and state the scripts use (platform, endpoints, last export…)
  learnings.md     dated log: did / worked / broke / next time
  TODO.md          things to fix or improve, found as work goes; raised each session
  admin-guide.md   how THIS site's admin actually behaves (written once explored)
  platform-findings.md   what this project taught us about the PLATFORM, for the skill
  export/          the site, exported
  audits/          audit reports, one per run, dated
  design/          design system, briefs, results from Claude Design
  snapshots/       copies of a page taken before editing it
  CLAUDE.md        a marked block telling new sessions to read SITE.md
```

`site init` creates `SITE.md`, `site.json`, `learnings.md`, `TODO.md`,
`platform-findings.md` and the `CLAUDE.md` block. The rest appear as work happens.

## SITE.md

Written for a person as much as for Claude. Four sections:

- **What this site is** — address, platform and how it was decided (detected or
  confirmed by the user), the admin address, and the plan or theme where it matters
  ("Squarespace Core plan — no page drafts", "Shopify, Horizon theme, 14 of 20 theme
  slots used").
- **What we can do here** — plainly: which flows work, and which need someone logged in
  to the admin in the browser.
- **Current state** — where things stand: last export and audit with their headline
  numbers, any design change in progress and which step it is on, anything waiting on
  the user. Rewrite this section rather than appending to it.
- **Notes** — the project's memory. Dated bullets, added with `site note "<text>"`.

### What makes a good note

A note is a fact a future session would otherwise have to rediscover or ask again:

- Shared content and its reach: "Pre-footer 5037 is shared by 7 pages — always ask."
- Decisions and standing rules from the user: "Copy fixes and design changes go in
  separate rounds." "Never edit the Admissions page without asking Jo first."
- Facts about the setup: "Admin is at /cms, not /admin." "Login lasts about a day."
- Things that did not work, briefly, with a pointer to `learnings.md`.

Not a note: anything already in `site.json`, a diary of the session, or a secret.

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
it to Kheva, who maintains the skill and folds it into the bundled guide. That is how the
skill learns from its first real use on each platform.

## site.json

Machine-readable, maintained by the scripts. Hand-editable fields:

- `adminUrl` — where the user logs in.
- `audit.placeholders` — extra demo-copy phrases the audit should flag, such as a theme
  vendor's sample company name.
- `craft.graphql` — the Craft endpoint, if detection missed it.

## CLAUDE.md

Cowork does not promise to read `CLAUDE.md`, so the user's Cowork project carries the
real pointer in its Instructions ("This is a website project. Use the website skill: run
its start command before anything else, then read SITE.md."). The skill still keeps a
short block in `CLAUDE.md`, between `<!-- website-skill:start -->` and
`<!-- website-skill:end -->`, for tools that do read it (Claude Code). Anything outside
the markers belongs to the user and is never touched.
