---
name: website
description: Use for any work on a website the user looks after — Craft CMS, WordPress, Shopify, Squarespace, or anything else. Covers resuming or setting up a website project folder, working out what platform a site runs on, reading or exporting pages, finding where a piece of copy lives, auditing for placeholder copy and broken links, extracting the design system, briefing Claude Design, checking how far a proposed change reaches, and applying a change as a draft through the site's admin in the browser. Read-only: the scripts never change the site.
---

# Website — read it, audit it, work out what to change

The people using this know their own website but are not developers. Speak plainly,
ask when unsure, and never assume they can run a terminal command themselves.

All scripted access goes through one command, run **from the project folder**:

```bash
SITE="node <skill-dir>/scripts/site.mjs"   # <skill-dir> is this skill's base directory
$SITE start                                # first, every session
```

## 1. Every session starts by resuming

**One folder = one website project.** It holds everything produced and everything
learned, so a new session in the same folder carries on where the last one stopped.

Run `$SITE start` before anything else, then **read `SITE.md` in full**. It is the
overview and the project's memory: what the site is, what has been done, and dated
notes from earlier sessions. Read `learnings.md` too before applying anything.

- **No project yet:** ask which website they are working on (the address), then
  `$SITE start <url>`. That detects the platform.
- **Detection is confident:** tell the user what it found ("This looks like a Shopify
  store") and let them correct it. Then run `$SITE init <url> --platform <p>`.
- **Detection is unsure:** ask with these exact options — **WordPress · Shopify ·
  Craft CMS · Squarespace · Other / not sure** — then run
  `$SITE init <url> --platform <answer> --confirmed-by user`. Only if they pick
  "not sure", ask what they see in the left-hand menu when they log in: Posts / Pages /
  Plugins means WordPress, Entries means Craft, Products / Orders means Shopify,
  Pages / Website means Squarespace.
- **A different site from this folder's:** each website needs its own folder. Ask the
  user to open or create one; do not mix two sites in one project.

After `init`, fill in "What we can do here" in `SITE.md`.

## 2. Keep the project folder current — this is how the next session knows anything

| File | What goes in it | When |
|---|---|---|
| `SITE.md` → **Current state** | Where things stand: last audit's headline, a design change in progress and which step it is on | Whenever it changes |
| `SITE.md` → **Notes** | Durable facts about this site or these people. Use `$SITE note "<text>"` | As soon as you learn one |
| `learnings.md` | Dated log: did / worked / broke / next time | After any real piece of work |
| `admin-guide.md` | How *this* site's admin actually behaves: URLs, labels, how drafts work | The first time the admin is explored, then corrected |

Good notes: "Pre-footer is shared by 7 pages — always ask." "Owner wants copy fixes and
design changes kept separate." "Don't touch Admissions until the board signs off."

Rules: date everything, mark anything unchecked as unverified, correct stale entries
instead of adding contradictions, keep `SITE.md` under about 200 lines, and **never
write passwords, cookies or tokens anywhere.** See `references/project-folder.md`.

Say in your reply when you have updated the project notes, and what changed.

## 3. What works on each platform today

`$SITE start` says this for the current project; the platform guide has the details.

| Platform | Scripts | Guide |
|---|---|---|
| Craft CMS (public GraphQL on) | Full: export, audit, design system, brief, diff, scope | `references/platforms/craft.md` |
| WordPress | Detection and project folder; the rest in the browser | `references/platforms/wordpress.md` |
| Shopify | Detection and project folder; the rest in the browser | `references/platforms/shopify.md` |
| Squarespace | Detection and project folder; the rest in the browser | `references/platforms/squarespace.md` |
| Anything else | Detection and project folder; explore and learn the admin | `references/platforms/other.md` |

Where there are no scripts yet, do the same flows by hand: read pages in the app
browser, write findings into the project folder (`audits/`, `design/`), and record
what you learn in `admin-guide.md` so the next session is faster.

## 4. The three flows

When asked "what can I do with this?", answer with these and say which one the request
belongs to. Commands below are the Craft ones; on other platforms follow the guide.

**1. Read and audit** — no login needed.

```bash
$SITE export                     # whole site into export/ (a few minutes)
$SITE audit --links              # placeholders, empty blocks, broken links → audits/
$SITE page <id>                  # one page's copy, with block ids
$SITE entries --search "..." --status all
```

**2. Prepare a design change** — the round trip through Claude Design.

```bash
$SITE design-system              # tokens, classes, grammar, style guide → design/system/
$SITE blocks                     # the block vocabulary and its copy fields
$SITE brief <id>                 # → design/brief-<id>.md
# hand the brief + design/system/DESIGN-SYSTEM.md + style-guide.html to Claude Design;
# it returns edited HTML plus an edit manifest (format in the brief)
$SITE diff <id> result.json      # are the edits valid?
$SITE scope <id> result.json     # do they stay on one page?
```

**3. Apply the change** — in the site's admin, in the **Claude Desktop app browser**,
always as a draft or preview. **The user publishes, never you.** The user logs in
themselves; never ask for, type or store a password or 2FA code. If the login has
expired, pause and ask them to log in again. Follow the platform's apply guide, and
the project's `admin-guide.md` where it says something more specific.

Be straight about limits when asked. They are structural, not missing features:

- **The scripts change nothing.** No write command exists, and `query` rejects any
  mutation document.
- **New block or section types are impossible** from here: they need the site's
  developers.
- **The design system is not editable here.** Tokens and CSS live in the theme or front end.

## 5. The scope rule — the one thing not to get wrong

**Never call a change ready to apply until it is confirmed to stay on one page.** On
Craft, `$SITE scope` must exit 0; it exits 3 and explains itself otherwise. On other
platforms, check the guide's "always ask first" list by hand.

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

## Craft commands

| | |
|---|---|
| `$SITE overview` | What is here, what you can do, what you cannot |
| `$SITE sections` | Sections and entry types |
| `$SITE entries [--section --type --search --limit --status]` | Find entries |
| `$SITE page <id> [--raw] [--depth n]` | A page's copy, walking the nested blocks |
| `$SITE entry <id>` | One entry's own fields |
| `$SITE drafts <id>` / `--unpublished` | Existing drafts of an entry |
| `$SITE blocks [--terse] [--json]` | Block vocabulary: usage, copy vs style fields |
| `$SITE grammar` | Which block types are allowed inside which fields |
| `$SITE design-system [--out DIR] [--url URL]` | Live tokens, classes, grammar, style guide |
| `$SITE export [--out DIR] [--no-html]` | Whole site to disk |
| `$SITE audit [--from DIR] [--links]` | Placeholders, empty blocks, broken links, repeated copy |
| `$SITE brief <id> [--out FILE]` | A paste-ready design brief for one page |
| `$SITE diff <id> <file.json\|.html>` | What an edited artefact would change |
| `$SITE scope <id> <manifest.json>` | **Blast radius.** Exit 0 = one page, 3 = ask first |
| `$SITE query <file\|->` / `--q "..."` | Any read query |
| `$SITE schema [TypeName]` | Query root fields, or one type's fields |
| `$SITE mutations` | Audit: what the schema could write, and why none is reachable |

Inside a project folder, `audit`, `brief`, `scope` and `overview` read `export/` by
default, and output goes into the folder. `--links` needs the HTML, so export without
`--no-html`.

Project commands: `$SITE start [url]`, `$SITE detect <url>`, `$SITE init <url>
--platform <p>`, `$SITE note "<text>"`, `$SITE help [craft]`.

## Rules

- **Never fabricate an id, handle, or field name.** Read them from the site.
- **An empty search is not proof a page is absent.** List and filter first.
- **Quote exactly.** Give values verbatim; do not tidy silently.
- **Name the field.** "The heading" is ambiguous; `#5665 richText_Text` is not.
- **Report a change as block → field → old value → new value.**
- **If a command exits `BLOCKED`,** the request is a write. Say so; do not find a way
  around it.
- **Never publish, and never press a button that publishes.** Every platform guide
  names the ones to avoid.

## When the bundled guides turn out wrong

Most apply guides are still unverified. When reality differs:

1. Record what actually happened in the project's `learnings.md` and `admin-guide.md`.
   Those are read first next time, and they override the bundled guide.
2. If the lesson applies to the platform in general, not just this site, tell the user
   so the skill's maintainer can fold it into the guide. Do not edit files inside this
   skill's directory: they are replaced on every update.

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
