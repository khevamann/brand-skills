# Field evidence ledger

What real use of the `website` skill has shown, and how much evidence each item has.
Maintained with the repo skill `reviewing-field-reports`
(`.claude/skills/reviewing-field-reports/SKILL.md`), which sets the bar for each kind of
item. Write problems, not solutions. No site addresses, names or page copy.

## Maintainer decisions

Already decided. Reviews report evidence that bears on these, but don't reopen them.

- **2026-10-30:** a site file in YAML (`site.yaml`) with a preferences section, including how cautious to be about publishing. The shipped default stays conservative.
- **2026-10-30:** the project folder splits into shareable files and a clearly marked internal folder that `start` rebuilds, plus handoff instructions for a teammate.

## Reports received

| ID | Received | Platform | Site | Work done | Skill version |
|---|---|---|---|---|---|
| R1 | 2026-10-30 | Craft 5.10 Pro, public GraphQL reads on (dev install) | Digistorm-built school site; the same site as `craft.md`'s worked example | ~3 weeks: ~10 pages redesigned or built as drafts, a site restructure | pre-0.3 (`craft` skill, no project folder) |

## Change now

Bugs and safety items. One report is enough.

### Bugs

- **`entries --status all` returns nothing.** `STATUS_MAP.all` is `null`, so `?? [flags.status]`
  sends `status: ["all"]`. *R1; reproduced 2026-10-30.*
- **One bad field fails the whole `page` read** (HTTP 500 on one entry; the other pages
  read fine). Needs a block-by-block fallback that names the field. *R1; reproduced 2026-10-30.*
- **`drafts` misses provisional drafts and a new page's unpublished draft.** It selects
  `isProvisionalDraft` without passing `provisionalDrafts: true`. *R1.*
- **A new page that is still an unpublished draft can't be read.** `fetchEntryCore` doesn't
  pass `drafts: true`, so `page`, `entry`, `brief`, `diff` and `scope` say "No entry with
  id". *R1; checked in the code.*
- **`scope` checks 0 items in `newBlocks`**, so a new block's copy is never compared
  with other pages. *R1.*
- **`export` and `design-system` write empty output when the front end is unreachable**,
  without saying so. *R1.*

### Safety warnings for `craft-apply.md`

These are Craft core behaviours that publish, edit live, or lose work. Add them now,
marked *(seen on 1 site)*.

- On a new, unpublished entry, the main button "Create entry" publishes it ("Create and continue editing" does too). Save with the menu → "Save draft". *R1*
- Globals (navigation, footer) have no drafts; every edit is live at once. *R1*
- An image field's "Replace" swaps the file everywhere the asset is used. *R1*
- Opening an entry can create a provisional draft, and "Create a draft" then turns it into the new draft, carrying someone's unsaved changes. *R1*
- Saving to a draft id that has since been applied silently creates a new draft. *R1*
- An open editor tab can autosave over changes made another way. *R1*
- Saving a nested block that still belongs to the live entry edits the live page. *R1*
- Inside a draft, clicking a nested block's name opens the live block's editor (marked "Current"). Use the card's edit button. *R1*
- Moves in the Pages structure view, and records kept by plugins (forms, redirects), have no drafts either. *R1*
- Pressing "Save draft" while a slideout is still saving drops that slideout's edits. A slideout that failed to close can write old values back. *R1*
- `craft-apply.md`'s "never touch a provisional draft" can't be followed: opening an entry creates one at once. Reword it around the "Showing your unsaved changes" notice. *R1*

## Platform facts on one site

Fold these into the guide marked *(seen on 1 site: Craft 5.10, 2026-10)*. Remove the
mark when a second site agrees.

- **CR-1:** the control-panel session lasted about a week.
- **CR-3:** block ids aren't shown in the UI, but the cards carry them in the page markup (partly answered).
- **CR-7:** about a minute per block once a helper was ready; 35–45 minutes for a page built by clicking.
- **CR-2:** `/admin/entries/<section>/<id>` redirects to `/admin/content/entries/<section>/<id>-<slug>`. Singles live under `/admin/content/entries/singles/<id>-<slug>`.
- **CR-4:** nested blocks show as cards and open in stacked slideouts. Save the inner one first, then the outer.
- **CR-5:** the button is "Create a draft". In a draft the buttons are "Save draft" and "Apply draft", and "Apply draft" publishes.
- **CR-6:** rich text is CKEditor 5. It keeps the configured style classes and `target="_blank"`.
- **CR-8:** `drafts` lists saved drafts. It doesn't list provisional drafts or a new page's draft (see Bugs).
- Preview links (`preview/create-token`) are snapshots, so make a fresh one after each round of edits.
- New nested entries need a Title, or saving fails with the error on a hidden tab.

## Ready

Candidates that have cleared their bar. The maintainer picks from here.

_None yet._

## Candidates

Each needs another independent site with the same problem before it changes the skill.

| Problem | Evidence | Possible answer |
|---|---|---|
| Building a page by clicking through the editor is slow (35–45 min per page) | R1 | Post a whole draft in one request from the logged-in admin (Craft's `elements/save-draft`). This is also a policy question for the maintainer |
| Long scripted jobs in the browser hit the browser tool's ~45 s timeout | R1 | Background job + poll pattern in the apply guide |
| Large content (an embed's code) has to get from the sandbox into the browser intact | R1 | Chunked transfer with a hash check |
| Images were placed without knowing their size, so they came out pixelated | R1 | Show asset sizes when listing or choosing images |
| Restructuring a site needed the page tree, with menu visibility and drafts marked | R1 | A page-tree view |
| Drafts across many pages were tracked by hand, and some had been published since | R1 | A list of open drafts, checked at `start` |
| Build sheets used field names and option values the site doesn't have | R1 | Check a build sheet against the site's schema |
| Layout structure (columns, top section, cell order) has no place in the manifest | R1 | A layout shape in the manifest |
| A design system couldn't be read when the sandbox couldn't reach the front end | R1 | Read tokens through the browser instead |
| Claude Design needed the token values as CSS, not just JSON | R1 | Ship `tokens.css` with the design system |
| Every link on a page had to open in a new tab | R1 | Probably a site preference, not a command |
| Forms had to be listed and created (Wheelform plugin) | R1 | Plugin-specific; likely never |
| Layout problems only showed in a preview at tablet and phone widths | R1 | Preview at three widths before handing back |
| A reused block kept hidden settings from its old use (text columns, dividers) | R1 | Show every setting of a reused block in `diff` |
| Publishing many dependent drafts meant a long, ordered checklist done by hand | R1 | Bears on the publishing preference (see Maintainer decisions) |
| `blocks` takes over 2 minutes | R1 | Cache it, or say how long it takes |

## Site preferences seen

Wants that belong in one site's preferences. If several sites set the same thing, make
it a named preference.

- Less caution about publishing. Said aloud, not in the files; the site owner's own written rule was "drafts only, a named person publishes". *R1*
- Preview at desktop, tablet and phone before every hand-back. *R1*

## Not for the skill

- Digistorm editor recipes (widget values, palette and theme ids, design rules such as "no dividers on bordered tiles"). These belong in that site's `admin-guide.md`. A second Digistorm site could justify a vendor section in `craft.md`.
- Test content in the R1 notes. Don't treat it as a rule.
