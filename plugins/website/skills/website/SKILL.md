---
name: website
description: Use for any work on a website the user looks after (Craft CMS, WordPress, Shopify, Squarespace, or anything else), and whenever the user names a site they are working on ("I'm working on example.com", or just a site address). Also for "/website setup", "set up the website skill", "update the website skill", "please use the website skill" and "/website feedback" or "send feedback on the website skill". Covers setting up or resuming a website project folder, working out what platform a site runs on, reading or exporting pages, finding where copy lives, auditing for placeholder copy, broken links and layout problems, extracting the design system, briefing Claude Design, checking how far a change reaches, and applying a change as a draft through the site's admin in the browser. Read-only: the scripts never change the site.
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
**Never pipe `setup` or `start` through `head` or `tail`.** What they print last says
what to do next.

## What the user can ask for by name

- **"/website setup"**, "set up the website skill", "help me set up this site",
  "update the website skill", "please use the website skill": run `$SITE setup`
  (with the site's address if this folder isn't a project yet). On a new folder it
  checks everything and starts the first session. On an existing project, typically
  after the skill was updated, it brings the folder up to the current layout, says what
  changed, and lists any setup steps still missing; finish those.
- **"/website feedback"**, "send feedback on the website skill": bundle what this project learned for the skill author. See
  "Feedback for the skill author" below.
- **"I'm working on example.com"**, or just an address: `$SITE start example.com`. A
  new site goes through setup.

## 1. Every session starts by resuming

**One folder = one website project.** It holds everything produced and everything
learned, so a new session in the same folder carries on where the last one stopped.
`site.yaml` holds the settings and structured facts (platform, admin address, account,
preferences, how the site is built, setup progress); `SITE.md` holds the overview,
where things stand, and dated notes.

Run `$SITE start` before anything else, then **read `SITE.md` in full**. Read
`learnings.md` too before applying anything. If `start` leads with **SETUP NOT
FINISHED**, finish those steps first (below). If it says **UPDATED SKILL**, run
`$SITE setup` first.

**If a check says STOP, stop.** `setup`, `init` and `start` exit 4 and print
**STOP — setup is not ready** when this isn't a place a project can live: a plain
Claude chat instead of Cowork, or no folder the user attached. Tell the user in plain
words what is wrong and how to fix it (`references/getting-set-up.md`), and do nothing else
until it is fixed. Don't work around it: a project set up anywhere else is lost when
the session ends.

**If the scripts can't run.** They need Node.js 18 or newer where your commands run (in
Cowork, its sandbox).

- **"node: command not found", or a version below 18:** install it yourself if you can,
  using the sandbox's package manager or the official Node.js download. Don't ask the
  user to install anything on their computer; it wouldn't reach the sandbox.
- **Node can't be installed:** tell the user plainly that the scripts can't run here
  yet, and that setup can't continue until they can.
- **Cowork's shell on the user's computer doesn't start:** it needs up to about 17 GB
  of free disk *(seen once)*. Tell the user that freeing disk space fixes it.

**If the scripts can't reach the website.** `setup` and `start` check every session, so
never treat one failure as permanent, and never write it down as a fact. Access can
change in either direction:

- **Blocked for the first time** (`Reach: NO`, or `!` in the setup checks). Cowork's
  sandbox only reaches allowed sites, so ask the user once how to allow it, and wait
  for the answer. Cowork may offer to allow the site right in the conversation: ask them
  to approve it. On a personal plan they can also allow it in their own settings. On a
  Team or Enterprise plan, only an Owner of their Claude organization can:
  **Organization settings → Capabilities → Code execution**, turn on network access
  and add the site's domain. If they aren't the Owner, it may stay blocked for good.
  Then, and only then, use the browser route below.
- **Still blocked** (`NO since <date>`, already raised). Don't ask again unless they
  bring it up. Work through the browser.
- **Allowed now after being blocked.** Correct what `SITE.md` says about it. Then redo
  with the scripts whatever was done in the browser instead, such as the snapshot.

Record it in `SITE.md`'s Current state, dated, with what was decided: "2026-10-30:
blocked; the organization controls network access, and the Owner was asked." Rewrite
that line when it changes.

**The browser route does the same work, not less.** While the scripts are blocked,
read the site through the browser (Claude in Chrome, or the app's built-in browser),
which can reach it, and write the same files the scripts would. Being blocked is never
a reason to skip a step.

- **Read pages:** on a tab open at the site, `fetch` each page in the sitemap and parse
  it with DOMParser. `fetch` only works on the tab's own origin: read public pages from
  a tab on the public site, and the admin's own data from a tab on the admin.
- **Keep what you collect in a tab you don't navigate.** Navigating a tab wipes its
  variables *(seen once)*.
- **Check before reporting.** Text extraction joins lines split by `<br>` ("herAnnual")
  and repeated lines can vanish when de-duplicated: check every typo, missing space or
  missing cell in the raw HTML first. Reload an image before calling it broken
  *(seen once)*.
- **Leave out the header, footer and navigation** before counting words or judging a
  page thin. They repeat on every page and can add hundreds of words.
- **Design system:** read the CSS custom properties and computed fonts and colours from
  the page.
- **Save what you find** where the scripts would: the review in `audits/`, problems in
  `TODO.md`, the design system in `design/system/DESIGN-SYSTEM.md`, blocks in
  `design/blocks.md`.

**Make sure they are in the right place.** A site's notes and learnings live in one
project folder; a second folder for the same site splits them in two. You can only see
the folder attached to this Cowork project, so ask rather than assume.

- **A different site from this folder's project:** ask which they meant. If it's this
  folder's site, carry on. If it's another site they've worked on before, they should
  open that site's Cowork project. If it's a new site, they should start a new Cowork
  project with its own empty folder. Never mix two sites in one project folder.
- **Where the project goes:** set up in the attached folder when it is empty. If it
  already holds other files, `init` makes a subfolder named after the site so nothing
  gets mixed in, and `$SITE start` then says to pass `--project <folder>` to every
  command. How the user arranges the folders around a site's folder is theirs: never
  create, move, rename or tidy anything outside the site's own folder.

### The first session: set up, capture the whole site, then hand over

A user who sets up usually isn't here to change anything yet: they want everything
ready for later. By the end of the first session the folder holds everything a later
session needs, and the user has seen what this can do for their site. Don't ask what
they want to work on until the hand-over, and don't open other topics.

**Make the steps your task list.** `init` and `setup` print the steps. Put them in the
app's to-do list for this session before doing anything else, and tick each off as it
is done. `$SITE onboarding` shows where things stand; each step counts as done once its
files exist, whichever route made them. If the user asks for something else first, say
setup isn't finished and roughly how long the rest takes, then do what they prefer, and
add their request to the end of the list. A step that truly can't be done today (they
can't sign in until Monday) is put off with `$SITE onboarding skip <step> "<why>"`, and
added to `TODO.md`.

**How to talk during it.** Each message is one or two sentences: what is happening now,
roughly how long it takes, and what you need from them, if anything. Describe the work,
not the tools. Never mention commands, scripts, helper agents or output.

**Work in parallel.** Hand the long jobs to helper agents or background tasks, whichever
this app offers, while you work with the user. Only you write to `SITE.md`, `site.yaml`
and `TODO.md`: helpers write their own files and report back.

1. **Check the setup, before anything else.** Run `$SITE setup <url>` (or without the
   address, and ask for it). It checks this is Cowork with a folder attached, and
   whether the scripts can reach the site. Check for yourself that you have a browser
   (Claude in Chrome, or the app's built-in browser). Tell the user about every problem
   at once, in plain words, with the fix, before going on: "Before we start, two things
   need fixing: …". A STOP problem has to be fixed first. If the site isn't reachable,
   ask them to allow it and wait; use the browser route only if it can't be allowed.
2. **Confirm the folder and the site, and set up the project.** Ask the question
   `setup` prints, in one message: is this the folder they made for the site, and is
   this the first time they've worked on it with Claude? If they have before, stop and
   help them open that project instead. Then the platform:
   - **Detection is confident:** tell them what it found ("This looks like a Shopify
     store") and let them correct it. Then `$SITE init <url> --platform <p> --new`.
   - **Detection is unsure, or the site can't be reached:** ask with these exact
     options — **WordPress · Shopify · Craft CMS · Squarespace · Other / not sure** —
     then `$SITE init <url> --platform <answer> --confirmed-by user --new`. Only if
     they pick "not sure", ask what they see in the left-hand menu when they log in:
     Posts / Pages / Plugins means WordPress, Entries means Craft, Products / Orders
     means Shopify, Pages / Website means Squarespace.

   Tell them: "It's a Squarespace site. I've set up this folder to keep everything
   about it."
3. **Open the browser and have them sign in, straight away.** Everything after this
   uses the admin. Open the site's admin in the browser (Claude in Chrome when it is
   available, since it has their saved logins; otherwise the app's browser): "Please
   sign in to your site's editor in the browser: [admin address]. Tell me when you're
   in." They sign in themselves. While they do, ask the two questions that decide what
   we can do, one at a time: are they the owner or another role, and which plan is the
   site on (it decides whether drafts exist). Record in `site.yaml`: `adminUrl`,
   `account.role`, `account.plan` ("unknown" is fine), and `access.browser`
   (`claude-in-chrome` or `built-in`). Answer the platform checklist's login questions
   as you go.
4. **Snapshot and review, in the background.** Hand a helper `$SITE export` followed by
   `$SITE audit --links`. Say: "I'm taking a snapshot of every page and checking it for
   problems. It takes a few minutes." Browser route: read every page and write the
   review to `audits/review-<date>.md`.
5. **Meanwhile, look through the editor with them, without changing anything.** The
   public site only shows the blocks in use, but a design may use anything the editor
   can add, so this step decides what designs can be built from.
   - **What the editor offers.** Open a page in the editor, then the menu for adding a
     block, then the one for adding a section or layout. Write every option, as labelled
     and grouped, into `design/available-blocks.md`. Note any that are locked to a
     higher plan, and what each block's settings offer (a gallery's carousel or grid
     layouts, for example). Close each menu without choosing anything, and leave the
     editor without saving.
   - **Global styles as the editor names them:** fonts, colours and colour themes, and
     button styles, plus where any custom CSS or code injection lives.
   - **A style guide or component page** (often hidden from the menu). Note its address.
   - **How the admin works:** the pages list, where the header and footer are set, how
     drafts or previews work, and the exact label of every button that publishes or
     sends. Write this into `admin-guide.md`, answering the platform checklist as you go.

   On Craft with its API, `$SITE grammar` already lists what each field accepts, so
   `available-blocks.md` isn't needed there.
6. **Check the main pages for visible problems.** In a browser tab on the public site,
   run `scripts/browser/layout-check.js` (in this skill's folder; the comment at its top
   says how) on the home page and the four or five pages people visit most, at phone,
   tablet and desktop widths, two or three pages per call. It finds content running off
   the side, broken or blurry images, text cut off or overlapping, squashed buttons.
   Every finding is a lead: confirm each with a screenshot at that width before telling
   anyone. If a page comes back `refused` (the site forbids framing), follow the note it
   returns. Write the confirmed ones to `audits/layout-<date>.md`, worst first, with the
   page and width, and add each to `TODO.md`.
7. **Capture the design, and go over the review.** Hand a helper `$SITE blocks` (it
   needs the snapshot) and `$SITE design-system`, with `--url <page>` if you found a
   style guide page. Browser route: read the styles and blocks from the pages and write
   `design/system/DESIGN-SYSTEM.md` and `design/blocks.md`. Say: "While we go over what
   I found, I'm capturing your design: colours, fonts and the building blocks your pages
   use." Put each problem worth fixing on the to-do list (`TODO.md`, see below). Tell
   them in two or three sentences what turned up, with counts and one example.
8. **Write down how the site is built.** In `site.yaml` under `structure`: `pages`, the
   main pages and how they nest (`path`, `title`, `children`); `shared`, what every page
   shares (header, navigation, footer, anything repeated across pages such as a
   pre-footer or announcement bar); and `styleGuide` if there is one. Add the editor's
   names for styles to `design/system/DESIGN-SYSTEM.md` under "As named in the editor".
   In `SITE.md`, fill in "What this site is" in a few plain sentences, and "Current
   state".
9. **Hand over** in one message, then run `$SITE onboarding done`:
   - **What we can do together**, in three plain lines: redesign a page or build a new
     one, made as a draft or hidden copy for them to check; fix what's on the to-do
     list; check the site for SEO, accessibility or layout problems.
   - **One visible fix to try now**, as a first test that everything works. Make it the
     most striking thing you found, in this order:
     1. Something visibly broken on a page people see most: content running off the
        side on phones, a broken or blurry image, text cut off or overlapping, a button
        squashed or off-screen.
     2. Failing that, something to show off: a section of a main page rebuilt with a
        block the editor offers but the site doesn't use yet (a carousel of their own
        photos, a cleaner events list), on a draft or hidden copy.
     3. Failing both, a general suggestion, such as freshening up the top of the home
        page.

     Never pick an SEO title, image descriptions or a broken link for this: they matter,
     but nobody sees them change. Say it in one sentence with the page and the device:
     "On phones, the photo on the About page pushes the page sideways. Shall we fix
     that now, as a first test that everything works?"
   - **Three prompts for this site** they can paste in later. Each names a real page or
     gap you found, and only uses blocks the editor offers. Include one redesign and one
     new page, for example "Redesign the About page with a photo carousel at the top."
   - How to come back: "Start a new chat in this same project whenever you want to do
     one of these, and paste the prompt in. Everything is saved in this folder, so
     there's nothing for you to save, and I'll pick up from my notes."

## 2. Keep the project folder current — this is how the next session knows anything

| File | What goes in it | When |
|---|---|---|
| `site.yaml` | Settings and structured facts: admin address, account, `preferences`, `structure`, setup progress. Edit it directly; keep its keys | When one changes |
| `SITE.md` → **Current state** | Where things stand: last audit's headline, a design change in progress and which step it is on | Whenever it changes |
| `SITE.md` → **Notes** | Durable facts about this site or these people. Use `$SITE note "<text>"` | As soon as you learn one |
| `learnings.md` | Dated log: did / worked / broke / next time | After any real piece of work |
| `TODO.md` | Things to fix or improve: `- [ ] date — what is wrong, on which page, where to fix it (how found)` | As soon as you find one, in any session. Tick it off when it's done |
| `admin-guide.md` | How *this* site's admin actually behaves: URLs, labels, how drafts work | The first time the admin is explored, then corrected |

 **Preferences** live in `site.yaml` under `preferences`. `publishing` is `ask-first` (the
default: say old → new and wait for a yes before any save that goes live) or
`drafts-only` (never save a live page; work on a draft or hidden copy only). A site's
own standing rules ("keep copy fixes and design changes separate") go in
`preferences.notes`. Nothing there can make you less careful than these rules.

Good notes: "Pre-footer is shared by 7 pages — always ask." "Owner wants copy fixes and
design changes kept separate." "Don't touch the Pricing page until the owner signs off."

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

Driving an admin in the browser:

- **If a click does nothing**, as happens with menus and side panels, call the element's
  `.click()`, or dispatch pointer events, from JavaScript. Then check that the state
  really changed.
- **For formatted text,** go through the editor's own interface rather than typing: its
  API, or a paste event carrying `text/html`. Then read the field back.
- **Before every Save, read back what you changed** from the page itself (the field's
  `value` or text, through JavaScript), not from a screenshot. Screenshots lag: never
  type into a field again because a screenshot looks unchanged. On a platform where
  saving publishes, also check nothing else on the page changed, then tell the user
  old → new and wait for their yes. A retyped title went live doubled for a minute
  *(seen once)*.
- **Before handing a change back,** look at it at desktop, tablet and phone widths.
  Layout problems often only show on the narrower ones.

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

Project, on every site: `$SITE setup [url] [--folder-confirmed]`, `$SITE start [url]`,
`$SITE detect <url>`, `$SITE init <url> --platform <p> --new`, `$SITE onboarding
[done | skip <step> "<why>"]`, `$SITE note "<text>"`, `$SITE findings [--all|--told]`,
`$SITE finding <ID|new> "<text>"`, `$SITE feedback`, `$SITE help [craft|generic]`. Every command takes
`--project <folder>` when the site's project is in a subfolder.

On every site:

| | |
|---|---|
| `$SITE overview` | What is here, what you can do, what you cannot |
| `$SITE export` | Whole site to disk. Outside view: `[--limit n] [--delay ms]`; Craft: `[--no-html]` |
| `$SITE audit [--links]` | Placeholders, empty blocks, broken links, repeated copy → `audits/` |
| `$SITE page <page> [--raw]` | A page's copy, block by block. Outside view: `--chrome`, `--live` |
| `$SITE blocks` | The block types in use, and their copy fields → `design/blocks.md` |
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
- **Name the field.** "The heading" is ambiguous; `#1234 richText_Text` or
  `template--10__hero text_Heading1` is not.
- **Report a change as block → field → old value → new value.**
- **If a command exits `BLOCKED`,** the request is a write. Say so; do not find a way
  around it.
- **Never publish, and never press a button that publishes.** Every platform guide
  names the ones to avoid.

## The first real project on a platform is its test

Nobody had a logged-in WordPress, Shopify or Squarespace site to test the admin steps
on, so the guides' admin instructions are researched but unverified. The first person
to use the skill on a platform is the test, and the skill author finishes
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
- **Suggesting the user sends the findings to the skill author happens rarely, never per session.**
  Only when `$SITE start` says enough has built up: about half the checklist over a few
  sessions, or all of it. Then mention it once, at a natural pause, in plain words: "Over
  the last few sessions we've worked out how [platform]'s editor really behaves. When
  you have a moment, say "/website feedback" and send the file it makes to the skill
  author, so the next site doesn't have to work it out again." Then
  run `$SITE findings --told`. Otherwise don't bring it up. If the user asks, it's fine
  to tell them.

The project's own files are read first in later sessions and override the bundled
guide. Never edit files inside this skill's directory: they are replaced on every update.

## Feedback for the skill author

When the user says "/website feedback" (or asks how to send feedback on the skill):

1. Ask once: "Anything you'd like the skill author to know: what worked, what was
   confusing, what you wish it did?" Write their answer, in their words, to
   `feedback/notes.md`. Add your own short account below it: what the sessions set out
   to do, what went wrong or was slow, and anything the skill's instructions got wrong.
2. If you can't find this session's transcript (the bundle says when it found none),
   write a readable one to `feedback/transcript-<date>.md`: their messages and your
   replies in full, each tool call as one line, no screenshots.
3. Run `$SITE feedback`. It bundles the project's notes, learnings, findings, design
   files, recent reviews and session transcripts into one zip in `feedback/`, with
   email addresses and phone numbers replaced, and leaves out the export, snapshots
   and images.
4. Tell them where the zip is and what's in it, that they can open it to check, and to
   send it to the skill author (whoever shared the skill with them).

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
