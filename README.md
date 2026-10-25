# Castle Keys — a Claude skill for working on websites

One skill, `website`, for websites built with **Craft CMS, WordPress, Shopify,
Squarespace**, or anything else. Tell Claude which site you're working on. It works out
what the site is built on, or asks you, and keeps everything it learns in your project
folder.

**Read-only.** The scripts never change the website. Changes are made as drafts in the
site's admin, and a person publishes them.

## How people use it

1. In **Claude Desktop**, open a folder for the website (one folder per site).
2. Say "I'm working on example.com".
3. Claude detects the platform (or asks, offering WordPress · Shopify · Craft CMS ·
   Squarespace · Other) and sets up the folder:

   ```
   SITE.md        what the site is, where things stand, and notes from past sessions
   site.json      facts the scripts use
   learnings.md   what worked and what broke
   export/  audits/  design/  snapshots/
   ```

4. Next time, open the same folder and start a new conversation. Claude reads `SITE.md`
   and picks up where you left off.

When a change needs the site's admin, you log in yourself in the Claude Desktop app
browser. Claude never asks for or stores passwords.

## What works on each platform

| Platform | Today |
|---|---|
| Craft CMS (public GraphQL on) | Full scripts: export, audit, design system, design brief, diff, scope gate |
| WordPress, Shopify, Squarespace | Detection and project folder; reading, auditing and applying in the browser with a per-platform guide |
| Anything else | Detection and project folder; Claude reads the site from outside and learns the admin, writing down what it finds |

The plan for dedicated WordPress, Shopify and Squarespace support is in
[`docs/multi-cms-plan.md`](docs/multi-cms-plan.md).

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

## Install

```
/plugin marketplace add khevamann/castle-keys
/plugin install website@castle-keys
```

Update later with `/plugin marketplace update castle-keys`.

There is nothing to configure: the first conversation in a site's folder sets it up.

Requires Node 18+. No npm dependencies. Works in Claude Desktop and Claude Code.
claude.ai chat can't reach the website from its sandbox, so it isn't supported.

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
