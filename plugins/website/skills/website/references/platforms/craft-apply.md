# Applying a change through the control panel

> **Nothing in this file has been tested yet.** It is the plan for the first run, not a
> record of one. Every step marked **(unverified)** needs checking against the real
> control panel, and this file should be rewritten with what actually happened —
> including exact labels and anything that broke. Until then, treat it as a hypothesis.

This is the route when no API token is available. The skill works out *what* to change;
the Claude Desktop app browser, with the user logged in, or a person makes the change in
Craft. The user logs in themselves; never ask for or type a password or 2FA code.

**Check the project's `admin-guide.md` first.** Once someone has driven this site's
control panel, that file records what it really does, and it overrides this guide.

## Before touching the control panel

1. `site diff <pageId> result.json` — every edit valid? Block exists, field exists on
   that block type, value actually differs.
2. `site scope <pageId> result.json ` — **must exit 0.** If it exits
   3, stop and resolve the flagged items with the user. A shared pre-footer edit can
   change several pages at once; that is not yours to decide.
3. Have the changeset in front of you as a list of `blockId → field → new value`. Work
   from that list, not from the design file.

## Control panel

Usually the CMS host plus `/admin` — the CMS host is the one in `site.json`'s
`craft.graphql`. The control-panel path can be renamed, so if `/admin` is not a login
page, ask the user what address they log in at, and record it in `SITE.md`.

Entry edit URLs in Craft follow `/admin/entries/<sectionHandle>/<entryId>` **(unverified
on any install)**. For page 177 in section `ds_Pages` that would be
`/admin/entries/ds_Pages/177`.

## The procedure

1. **Open the entry** and confirm the title matches what the skill reported. If it does
   not, stop — the id is wrong.
2. **Create a draft first.** Craft's entry editor has a drafts control near the save
   button **(unverified: exact label)**. Everything after this point must happen inside
   the draft, never on the live entry. If you cannot confirm you are in a draft, stop.
3. **Find the block by id.** The page builder shows blocks in the same order as
   `site page <id>`, so the nth block in the list is the nth in that output. Block ids
   are not usually shown in the UI **(unverified — check whether they appear anywhere,
   because if they do this becomes far more reliable)**.
4. **Edit one field, then verify it**, before moving to the next. Rich-text fields are
   editor instances, so pasted HTML may be normalised or stripped; compare what the
   editor holds against what you intended.
5. **Save the draft.** Do not publish.
6. **Verify from the outside:** `site drafts <pageId>` should list the new draft.
   This is the real check — it reads Craft rather than trusting the browser.
7. **Hand back to the user** with the draft name and what changed, for review and
   publishing.

## Hard rules

- **Never publish.** Publishing is the user's decision, made while looking at the result.
- **Never edit the live entry.** If a draft cannot be created, stop and say so.
- **Never touch a provisional draft** — that is someone's unsaved work in progress.
- **One page per session.** If `site scope` flagged other pages, those are separate,
  individually confirmed jobs.
- **Stop on the first surprise.** A missing control or an unexpected layout means the
  assumptions here are wrong. Record it and ask, rather than clicking around.

## What to record on the first run

Answer the questions in the "First-time checklist" in `craft.md` as you reach them,
with `site finding CR-<n> "<answer>"`. Block-id visibility (CR-3) matters most: it
decides whether block matching is reliable or positional.

Whether this route is worth automating, or the effort belongs in asking for an
Edit-scope token instead, follows from those answers. The token route is a single API
call per field; the code for it is in git history at `a1b022a`.
