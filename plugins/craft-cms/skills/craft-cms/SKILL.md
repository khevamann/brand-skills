---
name: craft-cms
description: Use for anything involving the Kirby school website (Craft CMS) — what can be done with the CMS, looking up a page, finding where a piece of copy lives, reading a page's text and HTML, auditing content for placeholders or broken links, taking stock of the block vocabulary or design system, briefing a design tool, checking what an edited design would change and whether it is safe, or applying a change through the control panel. Read-only: it cannot change anything in the CMS itself.
---

# Craft CMS — read the website, work out what to change

All access goes through `scripts/craft.mjs` in this skill's directory. The site is
hard-coded and no token is involved, so there is nothing to configure.

```bash
CRAFT="node <skill-dir>/scripts/craft.mjs"   # <skill-dir> is this skill's base directory
$CRAFT overview                              # start here, every time
```

**Run `$CRAFT overview` first in any new conversation about the site.** It counts what is
there live — sections, pages, block types in use — and states what is and is not possible.
Prefer its output to anything remembered, including anything written below.

## If asked "what can I do with the CMS?"

Answer with these three flows, and say which one the request belongs to.

**1. Read and audit** — no setup, works immediately.

```bash
$CRAFT page <id>                            # a page's copy, with block ids
$CRAFT entries --search "..." --status all  # find a page
$CRAFT export --out site-export             # whole site to disk (a few minutes)
$CRAFT audit --from site-export --links     # placeholders, empty blocks, broken links
```

**2. Prepare a design change** — the round trip through a design tool.

```bash
$CRAFT design-system --out design-system     # live tokens, classes, grammar, style guide
$CRAFT blocks                                # the block vocabulary and its copy fields
$CRAFT brief <id> --from site-export --out brief.md
# → hand brief.md + design-system/DESIGN-SYSTEM.md + design-system/style-guide.html
#   to the design tool; it returns edited HTML plus an edit manifest
$CRAFT diff <id> result.json                 # are the edits valid?
$CRAFT scope <id> result.json --from site-export   # do they stay on one page?
```

**3. Apply the change** — a browser driving the Craft control panel, because no API token
is available. See `references/browser-apply.md`. Always as a draft; the user publishes.

Be straight about the limits when asked, because they are structural rather than
missing features:

- **This skill changes nothing.** No write command exists, and `craft query` rejects any
  mutation document.
- **A new block type is impossible** through the CMS API, which cannot touch the content
  model at all. It needs a Craft settings change *and* a front-end component, both from
  the agency. `ds_EmbedBlock` is the escape hatch for markup the blocks cannot express.
- **Blocks cannot be shared between pages.** Each has one owner. A repeated pattern is a
  convention, not an object.
- **The design system is not editable here.** Tokens and CSS live in the front end.

## Every command

| | |
|---|---|
| `$CRAFT overview [--from DIR]` | What is here, what you can do, what you cannot |
| `$CRAFT sections` | Sections and entry types |
| `$CRAFT entries [--section --type --search --limit --status]` | Find entries |
| `$CRAFT page <id> [--raw] [--depth n]` | A page's copy, walking the nested blocks |
| `$CRAFT entry <id>` | One entry's own fields |
| `$CRAFT drafts <id>` / `--unpublished` | Existing drafts of an entry |
| `$CRAFT blocks [--terse] [--json]` | Block vocabulary: usage, copy vs style fields |
| `$CRAFT grammar` | Which block types are allowed inside which fields |
| `$CRAFT design-system [--out DIR]` | Live tokens, classes, grammar, style guide |
| `$CRAFT export [--out DIR] [--no-html]` | Whole site to disk |
| `$CRAFT audit [--from DIR] [--links]` | Placeholders, empty blocks, broken links, repeated copy |
| `$CRAFT brief <id> [--out FILE]` | A paste-ready design brief for one page |
| `$CRAFT diff <id> <file.json\|.html>` | What an edited artefact would change |
| `$CRAFT scope <id> <manifest.json>` | **Blast radius.** Exit 0 = one page, 3 = ask first |
| `$CRAFT query <file\|->` / `--q "..."` | Any read query |
| `$CRAFT schema [TypeName]` | Query root fields, or one type's fields |
| `$CRAFT mutations` | Audit: what the schema could write, and why none is reachable |

`--links` on `audit` needs the HTML in the corpus, so export **without** `--no-html`.
Without `--links` it only reports links with no matching Craft entry, which includes
legitimate front-end routes like `/search`.

## The scope rule — the one thing not to get wrong

**Never call a change ready to apply until `craft scope` exits 0.** It exits 3 and
explains itself when a change reaches past one page:

- **A shared entry.** Pre-footers, popups and videos are referenced by many pages;
  editing one changes all of them. The output names them.
- **Copy that also appears elsewhere** — editing one page makes them diverge.
- **A presentation setting** rather than copy, usually meant to be consistent.
- **A design-system change or a new block type** — not possible at all.

When anything is flagged, **stop and ask the user**: this page only, all affected pages,
or neither. Name the pages and how many. Do not choose for them, and do not quietly
apply the safe subset as though the whole manifest were approved.

## Keep this skill current

This workflow is a first draft. Nothing has been applied through the control panel yet,
so the "apply" flow is a hypothesis.

**After any real round trip, update this skill — not just the log:**

1. Append to `references/learnings.md`: what worked, what broke, the concrete change for
   next time.
2. Rewrite `references/browser-apply.md` with what the control panel actually does —
   real labels, whether block ids are visible in the UI, how rich-text fields treat
   pasted HTML, how long a field edit takes.
3. Correct the flows above if the real sequence differs. If a step turned out to be
   unnecessary, delete it. If one was missing, add it.
4. Say in your reply that you updated the skill, and what changed.

A workflow nobody corrects after contact with reality is worse than no workflow, because
it reads as tested. Anything still unverified must stay marked as such.

## Reading a page

A page holds almost no content of its own — the copy sits two levels down, in nested
blocks under `contentBuilder`. `$CRAFT page <id>` walks that and labels every block with
its type and id, so a change can be named precisely: *block #5665, field
`richText_Text`*. Use `$CRAFT entry <id>` only for an entry's own fields; for news and
events that is usually all there is.

## Rules

- **Never fabricate an id, handle, or field name.** Introspect first. Read type names
  from `__typename`, never by guessing.
- **An empty search is not proof a page is absent.** The index is not always current.
  List with `--status all` and filter first.
- **Quote exactly.** Give values verbatim — HTML in rich-text fields, plain text in tile
  fields. Do not tidy silently.
- **Name the field.** "The heading" is ambiguous; `#5665 richText_Text` is not.
- **Report a change as block id → field → old value → new value.** That is what someone
  can act on.
- **If a command exits `BLOCKED`,** the request is a write. Say so; do not find a way
  around it.

## Reference

- `references/this-site.md` — the content model and its quirks.
- `references/browser-apply.md` — applying a change in the control panel. **Unverified.**
- `references/design-handoff.md` — briefing a design tool and the manifest format.
- `references/craft-graphql-api.md` — the API, and the errors Craft refuses to explain.
- `references/learnings.md` — the running log. Read before, append after.
