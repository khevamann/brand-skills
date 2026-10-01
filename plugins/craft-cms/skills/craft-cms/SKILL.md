---
name: craft-cms
description: Use when reading, searching, auditing or planning changes to the Kirby school website (Craft CMS) — looking up a page, finding where a piece of copy lives, reading a page's text and HTML, taking stock of the block vocabulary or design system before a design change, briefing a design tool, checking what an edited design would change, or auditing content for placeholders and broken links. Read-only: it cannot change anything in the CMS.
---

# Craft CMS — read, audit, and prepare changes

Everything goes through `scripts/craft.mjs` in this skill's directory. The site is
hard-coded and no token is involved, so there is nothing to configure.

```bash
CRAFT="node <skill-dir>/scripts/craft.mjs"   # <skill-dir> is this skill's base directory
$CRAFT --help
```

## This skill is read-only

No command creates, edits, publishes or deletes, and `craft query` rejects any GraphQL
document containing a mutation. Changes are made by a person in the Craft control panel.
What this skill does is work out **exactly** what should change, and whether it is safe
to change it.

## The scope rule — the one thing not to get wrong

**Never describe a change as ready to apply until `craft scope` says it is confined to a
single page.** Run it on every edit manifest:

```bash
$CRAFT scope <pageId> manifest.json --from site-export
```

Exit `0` means every edit touches only that page. Exit `3` means something reaches
further, and it will say what:

- **A shared entry.** Pre-footers, popups and videos are separate entries referenced by
  many pages. Editing one changes all of them — the output names the affected pages.
- **Copy that also appears elsewhere.** Changing it on one page makes the pages diverge.
- **A presentation setting**, not copy. These are usually meant to be consistent.
- **A design-system change** (tokens, CSS, theme) or **a new block type**. Not possible
  through the CMS at all.

When scope reports anything beyond one page, **stop and ask the user which they want**:
this page only, all affected pages, or neither. Say how many pages are affected and name
them. Do not pick on their behalf, and do not apply the safe subset silently as though
the whole manifest were approved.

## Commands

| | |
|---|---|
| `$CRAFT sections` | Sections and entry types |
| `$CRAFT entries --search "..." --status all` | Find entries |
| `$CRAFT page <id>` | A page's copy, walking the nested block tree |
| `$CRAFT entry <id>` | One entry's own fields |
| `$CRAFT blocks` | Block vocabulary: usage, and which fields hold copy |
| `$CRAFT grammar` | Which block types are allowed inside which fields |
| `$CRAFT design-system --out DIR` | Extract live tokens, classes, grammar, style guide |
| `$CRAFT export --out DIR` | Whole site to disk: block trees, rendered HTML, inventory |
| `$CRAFT audit --from DIR [--links]` | Placeholders, empty blocks, broken links, repeated copy |
| `$CRAFT brief <id> --out FILE` | A paste-ready design brief for one page |
| `$CRAFT diff <id> <file>` | What an edited manifest or HTML file would change |
| `$CRAFT scope <id> <manifest>` | **Blast radius.** Run before calling anything ready |
| `$CRAFT query <file>` / `--q "..."` | Any read query |
| `$CRAFT schema [Type]` | Query root fields, or one type's fields |
| `$CRAFT mutations` | Audit: what the schema could write, and why none is reachable |

## The design round trip

1. **Refresh the picture.** `$CRAFT export --out site-export`, then
   `$CRAFT design-system --out design-system`. Re-run when the site has moved on.
2. **Brief the design tool.** `$CRAFT brief <id> --from site-export --out brief.md`.
   Hand over `brief.md`, `design-system/DESIGN-SYSTEM.md` and
   `design-system/style-guide.html`. The brief already states the constraints and the
   manifest format to return.
3. **Check what came back.** `$CRAFT diff <id> result.json` validates every edit against
   the live page: block exists, field exists on that block type, value actually differs.
4. **Check how far it reaches.** `$CRAFT scope <id> result.json --from site-export`.
   Resolve anything it flags with the user before going further.
5. **Report the change, do not make it.** Give block id, field handle, old value and new
   value, in that order. Ask for it to be made as a draft and reviewed.
6. **Write down what happened.** Append to `references/learnings.md`.

## Reading a page

A page holds almost no content of its own. The copy sits two levels down, in nested
blocks under `contentBuilder`. `$CRAFT page <id>` walks that; every block is labelled
with its type and id, so a change can be named precisely: *block #5665, field
`richText_Text`*.

Use `$CRAFT entry <id>` only for an entry's own fields. For news and events that is
usually all there is.

## Rules

- **Never fabricate an id, handle, or field name.** Introspect first. Read type names
  from `__typename`, never by guessing.
- **An empty search is not proof a page is absent.** The index is not always current.
  List with `--status all` and filter before concluding anything.
- **Quote exactly.** Give a field's value verbatim — HTML in rich-text fields, plain text
  in tile fields. Do not tidy silently.
- **Say which field a value came from.** "The heading" is ambiguous; `#5665
  richText_Text` is not.
- **A new block type is not possible from here, or from the API.** Craft's GraphQL cannot
  touch the content model. Say so plainly rather than looking for a workaround;
  `ds_EmbedBlock` is the escape hatch for markup the vocabulary cannot express.
- **If a command exits `BLOCKED`,** the request is a write. Report that.
- **After any round trip, append to `references/learnings.md`** — what worked, what
  broke, the concrete change for next time. That log is how this gets faster.

## Reference

- `references/this-site.md` — **read first.** The content model and its quirks.
- `references/design-handoff.md` — briefing a design tool, the manifest format, and the
  scope gate.
- `references/craft-graphql-api.md` — the Craft GraphQL API and the errors it refuses to
  explain.
- `references/learnings.md` — the running log. Read before, append after.
