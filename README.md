# Castle Keys — Claude skills for our Craft CMS

A skill that lets Claude search and read the website's content, and prepare changes as
**drafts** you review and publish yourself. It cannot publish, delete, or edit live
content — those are blocked in code, not by instruction.

> **Keep this repo private.** It describes our content model and how to reach the CMS.
> It contains no token: the token lives only in each person's environment.

## What's in here

| Plugin | Skill | Use it when |
|---|---|---|
| `craft-cms` | [`craft-cms`](plugins/craft-cms/skills/craft-cms) | Looking something up on the website, auditing content, or preparing a wording or content change for review |

## The arrangement

```
Claude prepares a draft  →  you review it in the Craft control panel  →  you publish
```

| Claude can | Claude cannot |
|---|---|
| Search and read entries, fields, asset metadata | Publish a draft |
| Create a draft of an existing entry | Edit a live entry |
| Create new content as an unpublished draft | Delete anything |
| Write field values into a draft | Touch assets, categories, tags, globals, users |
| Introspect the GraphQL schema | Change templates, plugins, or config |

Enforcement lives in
[`scripts/lib/guard.mjs`](plugins/craft-cms/skills/craft-cms/scripts/lib/guard.mjs),
with 21 tests pinning it. Every mutation Claude can reach is built by the script from
an allowlist; free-form GraphQL is rejected outright if it contains a `mutation` or
`subscription`. See
[`references/draft-model.md`](plugins/craft-cms/skills/craft-cms/references/draft-model.md)
for why each line is drawn where it is.

## Install — Claude Code

Uses your local git credentials, so this repo being private is not a problem:

```
/plugin marketplace add khevamann/castle-keys
/plugin install craft-cms@castle-keys
```

To update later: `/plugin marketplace update castle-keys`.

Then set your credentials once — see
[`references/setup.md`](plugins/craft-cms/skills/craft-cms/references/setup.md) for the
full walkthrough, including which schema scope to grant the token:

```bash
mkdir -p ~/.config/craft-cms
cat > ~/.config/craft-cms/env <<'CONF'
CRAFT_GRAPHQL_ENDPOINT=https://YOUR-SITE.com/actions/graphql/api
CRAFT_GRAPHQL_TOKEN=your-token-here
CONF
chmod 600 ~/.config/craft-cms/env
```

Verify:

```bash
# from the installed plugin directory, or a clone of this repo
node plugins/craft-cms/skills/craft-cms/scripts/craft.mjs mutations
```

That prints what your token *could* mutate and what the tool blocks. Read it before
you start — if something on the blocked list alarms you, tighten the token's schema
so the capability does not exist at all.

### A note on claude.ai and Cowork

This skill only works in Claude Code. It needs network access to our CMS and a token
from your machine's environment, and the claude.ai code sandbox has neither. Uploading
it there would install a skill that cannot run.

## Requirements

- Claude Code, and Node 18 or newer (`node -v`). No npm dependencies.
- A Craft GraphQL token bound to a private schema. Admins create these in the control
  panel; see `references/setup.md`.

## Working on this repo

```bash
node --test plugins/craft-cms/skills/craft-cms/scripts/test/
```

Those tests are the safety contract. The guard tests run with no credentials, which
proves refusals happen before any network call. If you widen what the tool can do,
the diff must touch `guard.mjs` and its tests together — that visibility is the point.

Adding a skill: create `plugins/<plugin>/skills/<name>/SKILL.md`, where the directory
name matches the `name:` in the frontmatter, and register the plugin in
`.claude-plugin/marketplace.json`.
