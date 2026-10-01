---
name: craft-cms
description: Use when reading, searching, auditing or planning changes to the Kirby school website (Craft CMS) — looking up a page, finding where a piece of copy lives, reading a page's text and HTML, taking stock of the block vocabulary before a design change, exporting the whole site to reason about it, or briefing a design tool. Read-only: it cannot change anything in the CMS.
---

# Craft CMS — read the website's content

Everything goes through `scripts/craft.mjs` in this skill's directory. The site is
hard-coded and no token is involved, so there is nothing to configure.

```bash
CRAFT="node <skill-dir>/scripts/craft.mjs"   # <skill-dir> is this skill's base directory
$CRAFT --help
```

## This skill is read-only

It can search and read. It has no command that creates, edits, publishes or deletes,
and `craft query` rejects any GraphQL document containing a mutation. Three separate
things make writing impossible: no token is sent, no write command exists, and
`scripts/lib/guard.mjs` blocks mutation documents.

When a request needs a change made, say so plainly and hand back exactly what to
change and where — the entry id, the block id, the field handle, and the new value.
Changes happen in the Craft control panel.

## Commands

| | |
|---|---|
| `$CRAFT sections` | Sections and entry types on the site |
| `$CRAFT entries --search "..." --status all` | Find entries |
| `$CRAFT page <id>` | **A page's copy**, walking the nested block tree |
| `$CRAFT page <id> --raw` | The same as JSON, with the query used |
| `$CRAFT entry <id>` | One entry's own fields |
| `$CRAFT blocks` | **The block vocabulary** — types, usage, which fields hold copy |
| `$CRAFT export --out DIR` | The whole site to disk: block trees, rendered HTML, inventory |
| `$CRAFT drafts <id>` | Drafts of an entry |
| `$CRAFT query <file>` / `--q "..."` | Any read query |
| `$CRAFT schema [Type]` | Query root fields, or one type's fields |
| `$CRAFT mutations` | Audit: what the schema could write, and why none is reachable |

## Reading a page

A page holds almost no content of its own. The copy sits **two levels down**, in
nested blocks under `contentBuilder`. `craft page <id>` walks that for you:

```bash
$CRAFT entries --search "why kirby" --status all   # find it
$CRAFT page 177                                    # read the copy
```

The output labels every block with its type and id, so a change can be described
precisely: *"block #5665, field `richText_Text`"*.

Use `craft entry <id>` only for an entry's own fields (title, slug, dates, status).
For news, events and other simple entries that is usually all there is.

## Before planning any change

Run `$CRAFT blocks`. It walks every page and reports the 30 block types actually in use,
which of their fields hold copy rather than presentation settings, and an example value
for each. That is the vocabulary any design work has to stay inside — the front end is a
separate Nuxt app that can only render block types it has components for.

Three constraints that come up every time:

- **A new block type is not possible from here.** Craft's GraphQL API cannot touch the
  content model at all — no mutation creates an entry type or a field. It needs a Craft
  settings change *and* a Nuxt component, both of which are Digistorm's.
- **`ds_EmbedBlock.embed_Code` stores raw HTML and `<script>` verbatim.** It is the
  escape hatch for a section the vocabulary cannot express. It renders client-side only.
- **Blocks cannot be shared between pages** — each has a single `ownerId`. A reusable
  pattern is a convention, not an object.

`references/design-handoff.md` has the full briefing format. Read it before handing work
to a design tool, and read `references/learnings.md` for what broke last time.

## Taking stock of the whole site

`$CRAFT export --out site-export` writes every page's block tree as JSON plus the
rendered HTML, with an inventory. Use it when a question spans pages: which pages use a
pattern, where placeholder copy survives, what a design change would have to respect.

Embed blocks render client-side, so their content is in the JSON but not the saved HTML.

## Rules

- **Never fabricate an id, handle, or field name.** Introspect first:
  `craft schema <Type>_Entry`, and get type names from `__typename`, never by guessing.
- **An empty search is not proof a page is absent.** The search index is not always
  current. List with `--status all` and filter before concluding anything.
- **Quote exactly.** When reporting copy, give the field's value verbatim — it is HTML
  in rich-text fields, plain text in tile fields. Do not tidy it silently.
- **Say which field a value came from.** "The heading" is ambiguous; `#5665
  richText_Text` is not.
- **If a command exits `BLOCKED`,** the request is a write. Report that; do not look
  for another route.
- **After any round trip through a design tool or the control panel, append to
  `references/learnings.md`.** What worked, what broke, and the concrete change for next
  time. That log is how this gets faster; skipping it wastes the iteration.

## Reference

- `references/this-site.md` — **read this first.** The site's content model: sections,
  the two-level block nesting, field naming, and where the copy really lives.
- `references/craft-graphql-api.md` — the Craft GraphQL API: endpoint, query
  arguments, structured content, and the errors Craft refuses to explain.
- `references/design-handoff.md` — briefing a design tool, and the edit-manifest format
  that makes the result applicable.
- `references/learnings.md` — the running log. Read before, append after.

Read the API reference before writing any non-trivial `craft query` document.
