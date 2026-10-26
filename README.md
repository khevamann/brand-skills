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

## Setup

### 1. Install the plugin (once)

1. In Claude Desktop, open **Customize → Plugins → Add → Add marketplace** and enter
   `khevamann/brand-skills`.
2. Find **website** under **Discover** and install it.
3. Turn on **Sync automatically** for the marketplace, or use **Check for updates**
   from time to time.

### 2. Make a folder for the site

**One folder per website.** Start with a new, empty folder for the site you're working
on, for example `Acme website`. Everything Claude produces and learns about that site
goes in it.

If you look after more than one site, give each its own folder. Where those folders
live is up to you. You can keep them side by side under a parent folder, or anywhere
else that suits you:

```
Websites/                  ← yours to organise; the skill never touches it
  Acme website/            ← one site
  Kirby School website/    ← another site
  Clients/Bakery website/  ← nest them however you like
```

The skill only works inside a site's own folder. It never creates, moves or tidies the
folders around it.

### 3. Create a Cowork project for the site

In **Claude Cowork**, create a project for the site, attach **that site's folder**, and
paste this into the project's **Instructions**:

> This is a website project. Use the website skill: run its start command before
> anything else, then read SITE.md.

One Cowork project per site, each with that site's folder.

### 4. Start working

Say "I'm working on example.com". Claude then:

1. **Checks it's a new site.** It asks whether this is the first time you've worked on
   this site with Claude. If you have before, it asks you to open that earlier project
   instead, so notes and learnings stay in one place.
2. **Works out the platform** (or asks, offering WordPress · Shopify · Craft CMS ·
   Squarespace · Other).
3. **Sets up the folder:**

   ```
   SITE.md               what the site is, where things stand, notes from past sessions
   site.json             facts the scripts use
   learnings.md          what worked and what broke
   platform-findings.md  what this project taught us about the platform itself
   export/  audits/  design/  snapshots/
   ```

Next time, start a new conversation in the same Cowork project. Claude reads `SITE.md`
and picks up where you left off.

If the attached folder already had other files in it, Claude puts the site in its own
subfolder instead of mixing it in. It's still simplest to give each site an empty
folder of its own.

When a change needs the site's admin, Claude works in a browser where you are logged in:
Claude in Chrome (your own Chrome, with your saved logins) or Claude Desktop's browser.
You log in yourself; Claude never asks for or stores passwords.

## How the skill finishes itself

The admin steps for WordPress, Shopify and Squarespace were researched, not tested:
nobody had a logged-in site to try them on. So the first real project on each platform
is the test. Each platform guide carries a checklist of open questions, such as which
button publishes or whether an admin link works. Claude works through them step by step
as the real work reaches them, asking the user only what it can't see for itself, and
records the answers in `platform-findings.md`.

Claude asks the user to send that file to Kheva, who maintains the skill and folds it
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
platform. Claude learns each site's admin and writes down what it finds. The plan for
deeper per-platform support is in [`docs/multi-cms-plan.md`](docs/multi-cms-plan.md).

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
can't reach websites from its sandbox, so it isn't supported.

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
  references/                  project folder, design hand-off, one guide per platform
  scripts/site.mjs             the one CLI
  scripts/core/                detection, project folder, audit, scope, design tokens
  scripts/adapters/craft/      Craft GraphQL: client, guard, page walking, commands
```

```bash
node --test 'plugins/website/skills/website/scripts/test/*.test.mjs'
```

The tests run offline. They pin:

- the read-only contract;
- the project folder's behaviour;
- detection scoring;
- that the docs match the CLI.

If you ever widen what the tool can do, the diff must touch the guard and its tests
together.
