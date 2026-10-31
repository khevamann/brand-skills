---
name: website
description: Use for any work on a website the user looks after — Craft CMS, WordPress, Shopify, Squarespace, or anything else. Covers resuming or setting up a website project folder, working out what platform a site runs on, reading or exporting pages, finding where a piece of copy lives, auditing for placeholder copy and broken links, extracting the design system, briefing Claude Design, checking how far a proposed change reaches, and applying a change as a draft through the site's admin in the browser. Read-only: the scripts never change the site.
---

# Website — read it, audit it, work out what to change

The people using this know their own website but are not developers. Speak plainly,
ask when unsure, and never assume they can run a terminal command themselves.

All scripted access goes through one command, run **from the project folder** (the
folder attached to the user's Cowork project):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/site.mjs start      # first, every session
```

Below, `$SITE` is shorthand for `node ${CLAUDE_SKILL_DIR}/scripts/site.mjs`. Write the
full command out every time: shell variables do not carry over between commands.

## 1. Every session starts by resuming

**One folder = one website project.** It holds everything produced and everything
learned, so a new session in the same folder carries on where the last one stopped.

**If the scripts can't run.** They need Node.js 18 or newer where your commands run (in
Cowork, its sandbox).

- **"node: command not found", or a version below 18:** install it yourself if you can,
  using the sandbox's package manager or the official Node.js download. Don't ask the
  user to install anything on their computer; it wouldn't reach the sandbox.
- **Node can't be installed:** tell the user plainly that the scripts can't run here
  yet, carry on by reading the site in the browser, and record it with
  `$SITE finding new` once a project exists. Otherwise put it in your reply.

**If the scripts can't reach the website** ("Could not reach", a timeout, or a refusal
from the network), Cowork's sandbox is probably not allowed onto that site. Tell the
user in plain words that an Owner of their Claude organization needs to allow it:
**Organization settings → Capabilities → Code execution**, turn on network access, and
add the site's domain. Meanwhile, read pages through the browser or your web-fetch tool,
and note the problem in `SITE.md`.

**Resuming a project.** The user's Cowork project should carry these Instructions: "This
is a website project. Use the website skill: run its start command before anything else,
then read SITE.md." If a project has none, suggest them once. `$SITE init` also writes a
pointer into `CLAUDE.md`, for tools that read it.

Run `$SITE start` before anything else, then **read `SITE.md` in full**. It is the
overview and the project's memory: what the site is, what has been done, and dated
notes from earlier sessions. Read `learnings.md` too before applying anything.

**Make sure they are in the right place.** A site's notes and learnings live in one
project folder; a second folder for the same site splits them in two. You can only see
the folder attached to this Cowork project, so ask rather than assume.

- **No project yet:** ask which website they are working on (the address), then
  `$SITE start <url>`. That detects the platform.
- **Before setting up anything, confirm it is new:** "Is this the first time you're
  working on this site with Claude? If you've worked on it before, please open that same
  Cowork project instead, so its notes carry over." If they have, stop and help them find
  it. Only for a genuinely new site run `init`, with `--new` to show you asked; `init`
  refuses without it.
- **Detection is confident:** tell the user what it found ("This looks like a Shopify
  store") and let them correct it. Then run `$SITE init <url> --platform <p> --new`.
- **Detection is unsure:** ask with these exact options — **WordPress · Shopify ·
  Craft CMS · Squarespace · Other / not sure** — then run
  `$SITE init <url> --platform <answer> --confirmed-by user --new`. Only if they pick
  "not sure", ask what they see in the left-hand menu when they log in: Posts / Pages /
  Plugins means WordPress, Entries means Craft, Products / Orders means Shopify,
  Pages / Website means Squarespace.
- **Where the project goes:** one folder per site, attached to that site's own Cowork
  project. Set up in the attached folder when it is empty. If it already holds other
  files, `init` makes a subfolder named after the site so nothing gets mixed in, and
  `$SITE start` then says to pass `--project <folder>` to every command. How the user
  arranges the folders around a site's folder (a parent "Websites" folder, client
  folders, anything) is theirs: never create, move, rename or tidy anything outside the
  site's own folder.
- **A different site from this folder's project:** ask which they meant. If it's this
  folder's site, carry on. If it's another site they've worked on before, they should open
  that site's Cowork project. If it's a new site, they should start a new Cowork project
  with its own empty folder. Never mix two sites in one project folder.

After `init`, carry straight on with the first session below.

### The first session: set up, snapshot, first review, done

By the end of one short session, the folder is set up, the whole site is snapshotted,
and what the first review found is on the to-do list. Then it ends. Getting through
onboarding is the goal: don't work on the findings, tour every feature, or open new
topics.

**How to talk during it.** Each message is one or two sentences: what is happening now,
roughly how long it takes, and what you need from them, if anything. Describe the work,
not the tools. Never mention commands, scripts, helper agents or output.

1. **Set up** (above). Tell them what you found and that this folder now holds
   everything about the site: "It's a Craft CMS site. I've set up this folder to keep
   everything about it."
2. **Start the snapshot without waiting for it.** Run `$SITE export` as a background task
   or hand it to a helper agent, whichever this app offers, so the conversation can go
   on. Say: "I'm taking a snapshot of every page now. It takes a few minutes."
3. **Meanwhile, ask for the one thing only they can do.** "While that runs, please sign
   in to your site's admin in the browser: [admin address]. Tell me when you're in."
   Once they are, check you can see the admin's list of pages and note the admin
   address in `SITE.md`. Explore no further. If they'd rather not sign in now, skip it:
   it's only needed for making changes. If the Cowork project has no Instructions yet,
   suggest them now, once.
4. **When the snapshot is done,** run `$SITE audit --links`. Put each problem worth
   fixing on the to-do list (`TODO.md`, see below), broken links and leftover placeholder
   copy first. Then tell them in two or three sentences what turned up, with counts and
   one example, and that it's all on their to-do list for a future session. If nothing
   turned up, say so plainly.
5. **Record it.** Fill in "What we can do here" and "Current state" in `SITE.md`, with
   the audit's headline.
6. **Close** with how to come back, including prompts they can copy, and stop:

   > You're set up. Whenever you want to work on the site, start a new conversation in
   > this project and say what you'd like, for example:
   > - "Let's work through my to-do list."
   > - "Let's update the About page."
   > - "Run an SEO check on the site." (page titles, descriptions, missing image text)
   > - "Run an accessibility check." (headings, link wording, contrast)
   >
   > I'll pick up from the notes in this folder.

## 2. Keep the project folder current — this is how the next session knows anything

| File | What goes in it | When |
|---|---|---|
| `SITE.md` → **Current state** | Where things stand: last audit's headline, a design change in progress and which step it is on | Whenever it changes |
| `SITE.md` → **Notes** | Durable facts about this site or these people. Use `$SITE note "<text>"` | As soon as you learn one |
| `learnings.md` | Dated log: did / worked / broke / next time | After any real piece of work |
| `TODO.md` | Things to fix or improve: `- [ ] date — what is wrong, on which page, where to fix it (how found)` | As soon as you find one, in any session. Tick it off when it's done |
| `admin-guide.md` | How *this* site's admin actually behaves: URLs, labels, how drafts work | The first time the admin is explored, then corrected |

Good notes: "Pre-footer is shared by 7 pages — always ask." "Owner wants copy fixes and
design changes kept separate." "Don't touch Admissions until the board signs off."

Rules: date everything, mark anything unchecked as unverified, correct stale entries
instead of adding contradictions, keep `SITE.md` under about 200 lines, and **never
write passwords, cookies or tokens anywhere.** See `references/project-folder.md`.

Say in your reply when you have updated the project notes, and what changed.

**The to-do list is how findings wait for later.** When you notice something worth fixing
outside the task in hand (a broken link, placeholder copy, a missing image description),
add it to `TODO.md` and mention it in a line. Don't stop the current work to fix it. Check
first that it isn't already listed. `$SITE start` shows the open items. If the user
hasn't said what they want to work on, mention them in a line and offer to start on one.

## 3. What works on each platform today

`$SITE start` says this for the current project; the platform guide has the details.

| Platform | How the scripts read it | Guide |
|---|---|---|
| Craft CMS, public API on | Craft's API: exact block ids and fields, drafts included | `references/platforms/craft.md` |
| WordPress | From the outside: public pages, with Gutenberg and Elementor structure | `references/platforms/wordpress.md` |
| Shopify | From the outside: public pages, split by theme section | `references/platforms/shopify.md` |
| Squarespace | From the outside: public pages, split by section and block | `references/platforms/squarespace.md` |
| Anything else, or Craft without an API | From the outside: public pages, split by main content | `references/platforms/other.md` |

Every flow below works on every platform. "From the outside" means the scripts see what
a visitor sees: no drafts, nothing behind a login, and they cannot be sure what the CMS
shares between pages, so anything repeated across pages is treated as shared. Applying
a change always happens in the browser.

## 4. The three flows

When asked "what can I do with this?", answer with these and say which one the request
belongs to. The commands are the same on every platform; `$SITE help` lists the extras.

**1. Read and audit** — no login needed.

```bash
$SITE export                     # whole site into export/ (a few minutes)
$SITE audit --links              # placeholders, empty blocks, broken links → audits/
$SITE page <page>                # one page's copy, block by block, with refs
$SITE pages                      # every page the sitemap lists (outside view)
$SITE entries --search "..." --status all     # Craft API: find an entry
```

A page is named by URL, by path (`/about`) or by its id in the export (`about`); on
Craft's API, by entry id.

There is no command for an SEO or accessibility check. When asked, read the pages in
`export/`: titles, descriptions, image descriptions (alt text), heading order and link
wording. Put what you find on the to-do list.

The scripts read the project's site even where its `robots.txt` asks automated tools to
stay away (staging sites usually do): it is the user's own site, read at their request.
Nothing to ask about or explain.

**2. Prepare a design change** — the round trip through Claude Design.

```bash
$SITE design-system              # tokens, colours, fonts, classes → design/system/
$SITE blocks                     # the block types this site uses
$SITE brief <page>               # → design/brief-<id>.md
# hand the brief + design/system/DESIGN-SYSTEM.md + style-guide.html to Claude Design;
# it returns edited HTML plus an edit manifest (format in the brief)
$SITE diff <page> result.json    # are the edits valid? (or result.html, read back via its tags)
$SITE scope <page> result.json   # do they stay on one page?
```

**3. Apply the change** — in the site's admin, in a browser where the user is logged
in: **Claude in Chrome** (their own Chrome, with their saved logins) or Claude
Desktop's browser. Always as a draft or preview. **The user publishes, never you.** The user logs in
themselves; never ask for, type or store a password or 2FA code. If the login has
expired, pause and ask them to log in again. Follow the platform's apply guide, and
the project's `admin-guide.md` where it says something more specific. `$SITE page
<page>` shows a direct link into the admin where the platform allows one (the page's
editor, or Shopify's theme editor at that page).

Be straight about limits when asked. They are structural, not missing features:

- **The scripts change nothing.** No write command exists, and `query` rejects any
  mutation document.
- **New block or section types are impossible** from here: they need the site's
  developers.
- **The design system is not editable here.** Tokens and CSS live in the theme or front end.

## 5. The scope rule — the one thing not to get wrong

**Never call a change ready to apply until it is confirmed to stay on one page.**
`$SITE scope` must exit 0; it exits 3 and explains itself otherwise. Run it against a
fresh export, because it compares the page with every other page. Also check the
platform guide's "always ask first" list: some sharing is invisible from outside.

Things that look local and are not:

- **Shared content** — a pre-footer, a Shopify template used by every product, a
  WordPress synced pattern, a header or footer. The output names the pages.
- **Copy that also appears elsewhere** — editing one copy makes them diverge.
- **A presentation setting** rather than copy — usually meant to be consistent.
- **A design-system change or a new block type** — not possible at all.

When anything is flagged, **stop and ask the user**: this page only, all affected
pages, or neither. Name the pages and how many. Do not choose for them, and do not
quietly apply the safe subset as though the whole change were approved. Record their
answer as a note if it is a standing rule.

## Commands

Project, on every site: `$SITE start [url]`, `$SITE detect <url>`, `$SITE init <url>
--platform <p> --new`, `$SITE note "<text>"`, `$SITE findings [--all|--told]`,
`$SITE finding <ID|new> "<text>"`, `$SITE help [craft|generic]`. Every command takes
`--project <folder>` when the site's project is in a subfolder.

On every site:

| | |
|---|---|
| `$SITE overview` | What is here, what you can do, what you cannot |
| `$SITE export` | Whole site to disk. Outside view: `[--limit n] [--delay ms]`; Craft: `[--no-html]` |
| `$SITE audit [--links]` | Placeholders, empty blocks, broken links, repeated copy → `audits/` |
| `$SITE page <page> [--raw]` | A page's copy, block by block. Outside view: `--chrome`, `--live` |
| `$SITE blocks` | The block types in use, and their copy fields |
| `$SITE design-system [--url URL]` | Live tokens, colours, fonts, classes → `design/system/` |
| `$SITE brief <page>` | A paste-ready design brief → `design/brief-<id>.md` |
| `$SITE diff <page> <file.json\|.html>` | What an edited result would change |
| `$SITE scope <page> <manifest.json>` | **Blast radius.** Exit 0 = one page, 3 = ask first |

Outside view only: `$SITE pages [--limit n]` lists the site's pages.

Craft's API only:

| | |
|---|---|
| `$SITE sections` | Sections and entry types |
| `$SITE entries [--section --type --search --limit --status]` | Find entries |
| `$SITE entry <id>` | One entry's own fields |
| `$SITE drafts <id>` / `--unpublished` | Existing drafts of an entry |
| `$SITE grammar` | Which block types are allowed inside which fields |
| `$SITE query <file\|->` / `--q "..."` | Any read query |
| `$SITE schema [TypeName]` | Query root fields, or one type's fields |
| `$SITE mutations` | Audit: what the schema could write, and why none is reachable |

Inside a project folder, `audit`, `brief`, `scope` and `overview` read `export/` by
default, and everything is written into the folder.

## Rules

- **Never fabricate an id, handle, or field name.** Read them from the site.
- **An empty search is not proof a page is absent.** List and filter first.
- **Quote exactly.** Give values verbatim; do not tidy silently.
- **Name the field.** "The heading" is ambiguous; `#5665 richText_Text` or
  `template--10__hero text_Heading1` is not.
- **Report a change as block → field → old value → new value.**
- **If a command exits `BLOCKED`,** the request is a write. Say so; do not find a way
  around it.
- **Never publish, and never press a button that publishes.** Every platform guide
  names the ones to avoid.

## The first real project on a platform is its test

Nobody had a logged-in WordPress, Shopify or Squarespace site to test the admin steps
on, so the guides' admin instructions are researched but unverified. The first person
to use the skill on a platform is the test, and Kheva, who maintains the skill, finishes
it from what that session records.

Each platform guide has a checklist of what only a real admin can answer, in the order
a session reaches it: logging in, opening a page, making a draft, editing, saving.
Each project folder has `platform-findings.md` to record the answers in. Walk the user
through it as the work goes; never turn it into a survey.

- **`$SITE start` says where the checklist stands.** When the work reaches a new step
  (logging in, opening the editor, making a draft), run `$SITE findings`. It shows only
  that step's open questions.
- **Answer what you can see for yourself** — you are driving the browser — with
  `$SITE finding <ID> "<what you saw, and how you know>"`. Include the exact label, the
  URL that opened, or what happened after the click. Do it as you see it, not at the end.
  Each answer shows the next question.
- **Ask the user only the questions marked "ask the user"** (their plan, their kind of
  account, how long the login lasted). Ask one at a time, in plain words, at the moment
  it matters: "Which Squarespace plan is this site on? It decides whether we can make
  a draft." Never show them the checklist or its IDs.
- **Do the work, carefully.** Treat the guide as a best guess. Don't go looking for
  trouble to answer a question. Stop at the first surprise: tell the user what you
  expected and what you saw, record it, and ask how to go on.
- **Anything else you learn about the platform in general** goes in
  `$SITE finding new "<text>"`. Facts about this one site go in `SITE.md`,
  `admin-guide.md` and `learnings.md` instead. Never put names, email addresses or
  anything private in a finding.
- **Suggesting the user sends the findings to Kheva happens rarely, never per session.**
  Only when `$SITE start` says enough has built up: about half the checklist over a few
  sessions, or all of it. Then mention it once, at a natural pause, in plain words: "Over
  the last few sessions we've worked out how [platform]'s editor really behaves. When
  you have a moment, please send the file platform-findings.md in this folder to Kheva,
  who maintains this skill, so the next site doesn't have to work it out again." Then
  run `$SITE findings --told`. Otherwise don't bring it up. If the user asks, it's fine
  to tell them.

The project's own files are read first in later sessions and override the bundled
guide. Never edit files inside this skill's directory: they are replaced on every update.

## Reference

- `references/project-folder.md` — the project folder, `SITE.md`, and note-keeping.
- `references/design-handoff.md` — briefing Claude Design, and the manifest format.
- `references/platforms/craft.md` — Craft's content model and quirks.
- `references/platforms/craft-apply.md` — applying a change in the Craft control panel. **Unverified.**
- `references/platforms/craft-graphql-api.md` — the Craft API, and the errors it refuses to explain.
- `references/platforms/wordpress.md` — WordPress and its page builders.
- `references/platforms/shopify.md` — Shopify themes, templates, and what is shared.
- `references/platforms/squarespace.md` — Squarespace 7.0/7.1, drafts and duplicates.
- `references/platforms/other.md` — any other site: read from outside, learn the admin.
