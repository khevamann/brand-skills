# Brand Skills

Claude skills for working on brands and their websites, used in **Claude Cowork** on
the desktop.

| Plugin | What it does |
|---|---|
| [`website`](plugins/website/skills/website) | Read, audit and redesign a website, and make changes as drafts |

## The `website` skill

For websites built with **Craft CMS, WordPress, Shopify, Squarespace**, or anything
else. Tell Claude which site you're working on. It works out
what the site is built on, or asks you, and keeps everything it learns in your project
folder.

**Read-only.** The scripts never change the website. Changes are made as drafts in the
site's admin, and a person publishes them.

## Getting set up

To get someone started, send them a link to this section. The same steps ship inside
the skill ([`references/getting-set-up.md`](plugins/website/skills/website/references/getting-set-up.md)),
so Claude can walk them through any step that goes wrong.

**You'll need:** the Claude desktop app with Cowork, your website's address, and your
login for your website's editor.

1. **Let Claude run code.** Open **Settings → Capabilities** and turn on **Code execution
   and file creation**.
2. **Let Claude reach your website.** On the same page, allow network access for your
   site's address (for example `example.com`). On a Team or Enterprise plan, ask whoever
   manages Claude for your organization to allow it. If you can't, carry on: Claude can
   work through the browser instead.
3. **Install the skill.** Open **Customize → Plugins**, choose **Add marketplace** (it
   may be under **Add**) and enter `khevamann/brand-skills`. Find **website**, click
   **Install**, and turn on **Sync automatically** for the marketplace so updates arrive
   by themselves. On a Team or Enterprise plan, an Owner may first need to allow it
   under **Organization settings → Plugins & skills → Policy → User-created skills**.
4. **Make an empty folder** on your computer for the website, for example
   `Documents/Websites/Acme website`. One folder per site.
5. **Make a Cowork project** for the site (for example "Acme Website") and **attach that
   folder**. It needs no description or instructions.
6. **Have a browser ready.** If you use Chrome, install **Claude in Chrome**, so Claude
   can use the Chrome where you're already signed in. Otherwise Claude uses the app's
   built-in browser, and asks you to allow your site the first time.
7. **Start.** In that project, start a new chat and say **"Set up the website skill for
   example.com"** (your site's address), or type `/website setup example.com`.

Claude checks everything first and tells you if any step above needs fixing. Then it
asks you to sign in to your site's editor in the browser (you sign in yourself; Claude
never sees your password). While you watch, it captures your whole site: every page, a
check for problems on phones and desktops, how your editor works, and your colours,
fonts and building blocks. Nothing on your site is changed. It finishes with one fix to
try, as a test that everything works.

**Afterwards**, always start new chats inside that same Cowork project. That's how Claude
remembers your site.

- **Updates** arrive by themselves with **Sync automatically** on (or use **Check for
  updates** on the marketplace). After an update, say **"Update the website skill"** in
  each site's project: Claude brings the folder up to date and finishes anything new.
- **Feedback:** say **"Send feedback on the website skill"** (or `/website feedback`).
  Claude bundles what it learned and your conversations into one zip, with email
  addresses and phone numbers removed, to send to the skill author.

**Without the marketplace.** If you can't add a marketplace, download
`website-skill.zip` from the [latest release](https://github.com/khevamann/brand-skills/releases/latest)
under **Assets** (not "Source code (zip)", which Claude rejects). Then open **Customize →
Skills**, click **+**, choose **Create skill → Upload a skill**, and pick the zip without
unzipping it. A zip doesn't update itself: to update, delete the old skill and upload the
new zip.

## Setup in detail

- **One folder per website, one Cowork project per folder.** Folders can live anywhere
  and nest however the user likes; the skill never touches anything outside the site's
  own folder. If the attached folder already holds other files, Claude puts the site in
  its own subfolder.
- **Setup stops early** when it isn't in Cowork, when no folder is attached, or when
  Node.js can't run, and says what to fix. If the site can't be reached, it asks the user
  to allow it before going on, and uses the browser only if it can't be allowed.

### What the first session does

1. **Checks the setup:** Cowork, the attached folder, access to the site, a browser.
2. **Confirms the folder and that the site is new**, and the platform (detected, or
   asked: WordPress · Shopify · Craft CMS · Squarespace · Other).
3. **Has the user sign in** to the site's editor in the browser, and asks their role
   and plan.
4. **Snapshots and reviews every page**, in the background.
5. **Looks through the editor** without saving: every block and section it offers, and
   how drafts and publishing work.
6. **Checks the main pages** at phone, tablet and desktop widths for visible problems.
7. **Captures the design system** and the blocks the pages use.
8. **Writes down how the site is built** in `site.yaml`.
9. **Hands over** with one visible fix to try now, and prompts for later.

The steps are Claude's task list for the session, and `site start` lists any that are
still missing in later sessions, so an interrupted setup gets finished. The folder ends
up as:

```
SITE.md               what the site is, where things stand, notes from past sessions
site.yaml             settings: admin address, account, preferences, how the site is built
learnings.md          what worked and what broke
TODO.md               things to fix, added as Claude finds them
admin-guide.md        how this site's editor works
platform-findings.md  what this project taught us about the platform itself
export/  audits/  design/  snapshots/  feedback/
```

When a change needs the site's admin, Claude works in a browser where the user is logged
in: Claude in Chrome (their own Chrome, with their saved logins) or Claude Desktop's
browser. The user logs in themselves; Claude never asks for or stores passwords.

## How the skill finishes itself

The admin steps for WordPress, Shopify and Squarespace were researched, not tested:
nobody had a logged-in site to try them on. So the first real project on each platform
is the test. Each platform guide carries a checklist of open questions, such as which
button publishes or whether an admin link works. Claude works through them step by step
as the real work reaches them, asking the user only what it can't see for itself, and
records the answers in `platform-findings.md`.

Claude asks the user to send that file to the skill author, who folds it
into the guide ([how](docs/folding-in-findings.md)). The next site on that platform
then starts from facts.

## What works on each platform

Every platform gets the same flows: export, audit, design system, design brief, diff
and the scope gate. What differs is how the site is read.

| Platform | Read through |
|---|---|
| Craft CMS, public GraphQL on | Craft's API: exact block ids and fields, drafts included |
| WordPress | Public pages, split by Gutenberg block or Elementor container |
| Shopify | Public pages, split by theme section; template and section-group sharing understood |
| Squarespace | Public pages, split by section and block; site styles and section themes from `site.css` |
| Anything else | Public pages, split by main content; layout repeated across pages detected |

Applying a change happens in the site's admin in the app browser, with a guide per
platform. Claude learns each site's admin and writes down what it finds.

## The three flows

1. **Read and audit.** Export the site, then look for placeholder copy, empty blocks,
   broken links and repeated copy.
2. **Prepare a design change.** Extract the live design system, brief Claude Design,
   then check what comes back with `diff` and `scope`.
3. **Apply it.** As a draft or preview through the admin. A person publishes.

### The scope gate

`site scope` is the safety rail. It exits `0` only when every proposed edit is confined
to one page. It exits `3`, with an explanation, when a change reaches further:

- a shared entry used by other pages, which it names;
- copy that appears elsewhere;
- a presentation setting;
- a design-system change;
- an invented block type.

Nothing beyond a single page is applied without a person deciding the scope.

## Before handing it out

- **Internet access for the scripts.** Cowork runs scripts in a sandbox whose internet
  access is limited to approved sites. On a Team or Enterprise plan, an organization
  Owner allows it under **Organization settings → Capabilities → Code execution**: turn
  on network egress and add the website's domain, or allow all domains. If the scripts
  can't reach a site, the skill says so and falls back to reading in the browser.
- **Node.js.** The scripts need Node 18 or newer inside that sandbox. The docs don't say
  whether it is always there. The skill checks first, and tries to install it if it is
  missing.

In Claude Code, the same marketplace works with `/plugin marketplace add
khevamann/brand-skills` and `/plugin install website@brand-skills`. claude.ai chat
can't keep a project folder or reach websites from its sandbox, so it isn't supported:
setup stops there and explains how to move to Cowork.

## Read-only, three ways

On Craft, nothing can be written:

1. **No token is sent.** Write mutations only exist in a private schema, which a token
   unlocks. The client sends no `Authorization` header at all.
2. **No write command exists.** `site --help` is the complete surface.
3. **[`guard.mjs`](plugins/website/skills/website/scripts/adapters/craft/guard.mjs)
   refuses them**, even if the public schema is granted Edit scope later.

## Working on this repo

```
plugins/website/skills/website/
  SKILL.md                     router: resume → identify → platform guide → flows
  references/                  getting set up, project folder, design hand-off, one guide per platform
  scripts/site.mjs             the one CLI
  scripts/version.mjs          the version (kept equal to plugin.json) and what's new in it
  scripts/core/                detection, project folder (site.yaml), setup checks and
                               progress, audit, scope, design tokens, feedback bundle
  scripts/browser/             scripts Claude runs inside a browser tab (layout check)
  scripts/adapters/craft/      Craft GraphQL: client, guard, page walking, commands
```

```bash
node --test 'plugins/website/skills/website/scripts/test/*.test.mjs'
```

**Releases.** The `Package skill` workflow runs the tests and builds `website-skill.zip`
on every push and pull request; the zip is kept with the run as an artifact. When `main`
has a version in `plugins/website/.claude-plugin/plugin.json` that has no release yet,
the workflow publishes release `v<version>` with the zip attached. To release, bump the
version there, in `.claude-plugin/marketplace.json` and in `scripts/version.mjs` (a test
checks they match), and update `WHATS_NEW` in `version.mjs`: `/website setup` shows it to
people updating.

**Field reports.** When someone sends back what happened on a real site (the zip from
`/website feedback`, a project folder, notes or findings), open Claude Code in this repo and say "review this field
report". The repo-only skill `.claude/skills/reviewing-field-reports` sorts each item
into one of three places: change the skill now, wait for evidence from another site, or
the user's own project. It keeps the tally in a private evidence ledger outside the repo (the
git-ignored `local/` folder), and that skill isn't shipped to users.

The tests run offline. They pin:

- the read-only contract;
- the project folder's behaviour;
- detection scoring;
- that the docs match the CLI.

If you ever widen what the tool can do, the diff must touch the guard and its tests
together.
