# Applying a change through the control panel

> **Nothing in this file has been tested yet.** It is the plan for the first run, not a
> record of one. Every step marked **(unverified)** needs checking against the real
> control panel, and this file should be rewritten with what actually happened —
> including exact labels and anything that broke. Until then, treat it as a hypothesis.

This is the route when no API token is available. The skill works out *what* to change;
a browser driven through MCP, or a person, makes the change in Craft.

## Before touching the control panel

1. `craft diff <pageId> result.json` — every edit valid? Block exists, field exists on
   that block type, value actually differs.
2. `craft scope <pageId> result.json --from site-export` — **must exit 0.** If it exits
   3, stop and resolve the flagged items with the user. A shared pre-footer edit changes
   six pages; that is not yours to decide.
3. Have the changeset in front of you as a list of `blockId → field → new value`. Work
   from that list, not from the design file.

## Control panel

```
https://ks-us-ca-1849-website-2026.cms.digistormhosting.com.au/admin
```

Entry edit URLs in Craft follow `/admin/entries/<sectionHandle>/<entryId>` **(unverified
on this install)**. For `admissions/why-kirby` that would be
`/admin/entries/ds_Pages/177`.

## The procedure

1. **Open the entry** and confirm the title matches what the skill reported. If it does
   not, stop — the id is wrong.
2. **Create a draft first.** Craft's entry editor has a drafts control near the save
   button **(unverified: exact label)**. Everything after this point must happen inside
   the draft, never on the live entry. If you cannot confirm you are in a draft, stop.
3. **Find the block by id.** The page builder shows blocks in the same order as
   `craft page <id>`, so the nth block in the list is the nth in that output. Block ids
   are not usually shown in the UI **(unverified — check whether they appear anywhere,
   because if they do this becomes far more reliable)**.
4. **Edit one field, then verify it**, before moving to the next. Rich-text fields are
   editor instances, so pasted HTML may be normalised or stripped; compare what the
   editor holds against what you intended.
5. **Save the draft.** Do not publish.
6. **Verify from the outside:** `craft drafts <pageId>` should list the new draft.
   This is the real check — it reads Craft rather than trusting the browser.
7. **Hand back to the user** with the draft name and what changed, for review and
   publishing.

## Hard rules

- **Never publish.** Publishing is the user's decision, made while looking at the result.
- **Never edit the live entry.** If a draft cannot be created, stop and say so.
- **Never touch a provisional draft** — that is someone's unsaved work in progress.
- **One page per session.** If `craft scope` flagged other pages, those are separate,
  individually confirmed jobs.
- **Stop on the first surprise.** A missing control or an unexpected layout means the
  assumptions here are wrong. Record it and ask, rather than clicking around.

## What to record on the first run

Append to `learnings.md`, and rewrite this file:

- The real URL pattern for editing an entry.
- The exact control and label for creating a draft.
- Whether block ids are visible anywhere in the UI. This is the single most valuable
  thing to find out — it decides whether block matching is reliable or positional.
- How rich-text fields handle pasted HTML: preserved, normalised, or stripped? Do
  design-system classes survive?
- How nested blocks are opened — inline, or a drawer or modal?
- Roughly how long one field edit takes, including verification.
- Everything that broke.

That last group is what decides whether this route is worth automating or whether the
effort belongs in asking for an Edit-scope token instead. The token route is a single
API call per field; the code for it is in git history at `a1b022a`.
