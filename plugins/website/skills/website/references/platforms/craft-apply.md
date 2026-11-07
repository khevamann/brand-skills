# Applying a change through the control panel

> **Partly tested.** One Craft 5.10 site was worked on for three weeks in 2026-10. What
> it showed is marked *(seen on 1 site)*. Steps still marked **(unverified)** have not
> been checked on a real control panel: treat them as a hypothesis, and record what
> actually happens.

## Things that change the live site or lose work *(seen on 1 site)*

Read this before touching the control panel.

- **On a new page, the main "Create entry" button publishes it**, and so does "Create
  and continue editing". Save a new page with the arrow menu next to it → **Save draft**.
- **Some things have no drafts at all:** Globals (navigation and footer links), moving
  pages in the Pages structure view, and records kept by plugins, such as forms and
  redirects. Any change to them is live at once, so ask first.
- **An image's "Replace" swaps the file everywhere** that asset is used. To change one
  image, remove it from the field and add another.
- **Inside a draft, clicking a nested block's name opens the live block's editor**
  (marked "Current"). Use the card's edit button instead.
- **Opening an entry can create a provisional draft** ("Showing your unsaved changes").
  "Create a draft" then folds those unsaved changes into the new draft. If that notice
  shows, run `site drafts <id>` and tell the user before going on.
- **Edits can be lost silently:**
  - Pressing "Save draft" while a nested block is still saving drops that block's edits.
  - A side panel that didn't close can write old values back when saved.
  - An editor tab left open can autosave over changes made another way.
  - Saving to a draft that has since been applied quietly creates a new draft.
- **Editing a block that still belongs to the live page edits the live page.** Only
  edit blocks reached through the draft.

This is the route when no API token is available. The skill works out *what* to change;
a browser where the user is logged in (Claude in Chrome, or Claude Desktop's browser), or a person makes the change in
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

Usually the CMS host plus `/admin` — the CMS host is the one in `site.yaml`'s
`craft.graphql`. The control-panel path can be renamed, so if `/admin` is not a login
page, ask the user what address they log in at, and record it in `SITE.md`.

Entry edit URLs follow `/admin/entries/<sectionHandle>/<entryId>`, which redirects to
`/admin/content/entries/<sectionHandle>/<entryId>-<slug>`. Singles, such as a homepage,
live under `/admin/content/entries/singles/<id>-<slug>` *(seen on 1 site)*. The
login lasted about a week *(seen on 1 site)*.

## The procedure

1. **Open the entry** and confirm the title matches what the skill reported. If it does
   not, stop — the id is wrong.
2. **Create a draft first.** The button is **Create a draft**. In a draft the buttons
   become **Save draft** and **Apply draft**, and Apply draft publishes *(seen on 1
   site)*. Everything after this point must happen inside
   the draft, never on the live entry. If you cannot confirm you are in a draft, stop.
3. **Find the block by id.** The page builder shows blocks in the same order as
   `site page <id>`. Nested blocks show as cards that open in stacked side panels: save
   the inner one first, then the outer. Ids aren't shown on screen, but the cards carry
   them in the page markup. Inside a draft, a block you touch gets a new id, so read ids
   again after saving *(seen on 1 site)*.
4. **Edit one field, then verify it**, before moving to the next. Rich text is CKEditor
   5. Setting it through the editor's own `setData` kept the site's style classes and
   formatting *(seen on 1 site)*. Compare what the editor holds against what you
   intended. A new nested block needs a Title, or saving fails with the error on a
   hidden tab.
5. **Save the draft.** Do not publish.
6. **Verify from the outside:** `site drafts <pageId>` should list the new draft.
   This is the real check — it reads Craft rather than trusting the browser.
7. **Preview** the draft at desktop, tablet and phone widths. Preview links show the
   draft as it was when the link was made, so make a new one after each round of edits
   *(seen on 1 site)*.
8. **Hand back to the user** with the draft name and what changed, for review and
   publishing.

## Hard rules

- **Never publish.** Publishing is the user's decision, made while looking at the result.
- **Never edit the live entry.** If a draft cannot be created, stop and say so.
- **Never fold someone's unsaved work into your draft.** If the entry opens with
  "Showing your unsaved changes", ask before pressing "Create a draft".
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
