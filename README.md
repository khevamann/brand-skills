# Castle Keys — Claude skills for our website

A skill that lets Claude search and read the Kirby school website's content (Craft CMS).
**Read-only.** It cannot change anything in the CMS.

| Plugin | Skill | Use it when |
|---|---|---|
| `craft-cms` | [`craft-cms`](plugins/craft-cms/skills/craft-cms) | Looking something up on the website, finding where a piece of copy lives, reading a page's text, or auditing content |

## Start here

```bash
craft overview --from site-export   # what's here, what you can do, what you can't
```

That counts the site live and states the limits, so it stays true as things change.

## What it does

```bash
craft sections                            # the content model
craft entries --search "why kirby" --status all
craft page 177                            # a page's copy, nesting walked
craft blocks                              # the block vocabulary
craft grammar                             # what may be nested where
craft design-system --out design-system   # live tokens, classes, style guide
craft export --out site-export            # the whole site to disk
craft audit --from site-export --links    # placeholders, empty blocks, broken links
craft brief 177 --out brief.md            # a design brief for one page
craft diff 177 result.json                # are the proposed edits valid?
craft scope 177 result.json               # do they stay on one page?
```

Pages on this site hold almost no content of their own — the copy sits two levels down
in nested page-builder blocks. `craft page` walks that and labels every block with its
type and id, so a change can be described exactly: *block #5665, field `richText_Text`*.

### The scope gate

`craft scope` is the safety rail for automated editing. It exits `0` only when every
proposed edit is confined to one page, and `3` with an explanation when a change reaches
further — a shared entry referenced by other pages (it names them), copy that appears
elsewhere, a presentation setting, a design-system change, or an invented block type.

Nothing beyond a single page should be applied without a human deciding the scope.

## What it cannot do

Nothing in the CMS changes. There is no command that creates, edits, publishes or
deletes, and `craft query` rejects any document containing a mutation. Three separate
reasons, any one of which would be enough:

1. **No token is sent.** Write mutations only exist in a private schema with Edit
   scope, which a token unlocks. The client sends no `Authorization` header at all.
2. **No write command exists.** `craft --help` is the complete surface.
3. **[`guard.mjs`](plugins/craft-cms/skills/craft-cms/scripts/lib/guard.mjs) refuses
   them**, which holds even if the public schema is granted Edit scope later.

`craft mutations` prints the live position. 12 tests pin this, run offline.

Content changes happen in the Craft control panel.

## Install — Claude Code

Uses your local git credentials, so this repo being private is not a problem:

```
/plugin marketplace add khevamann/castle-keys
/plugin install craft-cms@castle-keys
```

Update later with `/plugin marketplace update castle-keys`.

**There is nothing to configure.** The endpoint is hard-coded in
[`scripts/lib/client.mjs`](plugins/craft-cms/skills/craft-cms/scripts/lib/client.mjs);
change that one line to point at another environment.

Requires Node 18+. No npm dependencies.

### A note on claude.ai and Cowork

Claude Code only. The skill needs network access to the CMS, which the claude.ai code
sandbox does not have.

## Two things worth knowing about the site

- **The public GraphQL schema is readable with no token** — all 208 entries.
- **Disabled entries and in-progress drafts are included.** `status: null` and
  `drafts: true` work unauthenticated. Harmless on a test site; worth checking before
  assuming production keeps unpublished content private.

## Working on this repo

```bash
node --test plugins/craft-cms/skills/craft-cms/scripts/test/
```

Those tests are the read-only contract. They run offline, which is what proves refusals
happen before any network call. If you ever widen what the tool can do, the diff must
touch `guard.mjs` and its tests together.

The draft-writing version of this skill — `createDraft` plus draft-scoped saves, with
publishing and deletion blocked — is in git history at `a1b022a`. It needs a token with
Edit scope on the sections you want; nothing here does.
