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
| R2 | 2026-10-31 | Squarespace 7.1, Fluid Engine, plan unconfirmed | Small retail/craft business site, 15 pages | 1 day in Cowork: onboarding review, SEO audit, spacing audit at 10 widths, mobile layout fix, privacy page, footer link fix, a redesign built on a hidden test page | 0.4.0, installed from the zip (`site.json` doesn't record the version) |
| R3 | 2026-11-07 | Squarespace 7.1, plan unconfirmed | Farm and retreat-centre site, ~245 pages (blog, large events collection, email campaigns) | 2 short sessions: event time (fixed via site time zone), event category, SEO title, event excerpts, read-only site review, newsletter draft in Campaigns. **Onboarding skipped.** Ran in a claude.ai cloud workspace with network off and no attached folder | 0.6.0 or close to it (has the whole-site onboarding and SQ-10) |

## Open questions for reporters

- **R3:** was this Cowork with a folder attached, or a plain claude.ai chat with a Project? The transcript shows `/home/claude`, `/mnt/skills` and claude.ai Project writes, not an attached folder.

- **R2:** was the user asked before Claude saved the footer link change? It went live on every page, and the footer is on the "always ask first" list.
- **R1:** who applied the shared pre-footer draft that was "Published 2026-10-14"?

## Change now

Bugs and safety items still open. One report is enough.

- **One bad field fails the whole `page` read** (HTTP 500 on one entry; the other pages
  read fine). Needs a block-by-block fallback that names the field. *R1; reproduced 2026-10-30.*
- **`scope` checks 0 items in `newBlocks`**, so a new block's copy is never compared
  with other pages. *R1.*
- **`export` and `design-system` write empty output when the front end is unreachable**,
  without saying so. `start` now warns, but the commands themselves should too. *R1.*

## Ready

Candidates that have cleared their bar. The maintainer picks from here.

| Problem | Evidence | Possible answer |
|---|---|---|
| When the sandbox can't reach the site, everything the scripts produce had to be rebuilt by hand in the browser | **R1, R2, R3** (R3 then skipped the work altogether) | 0.5.0 warns at `start` and documents the browser route. Still open: an in-page script that writes the normal export format, so `audit`, `brief` and `scope` work on it |

## Done

### 0.7.0 (2026-11-07)

- **Setup can't be skipped or worked around** *(R3, maintainer)*:
  - The description now triggers on "I'm working on <site>", a bare address, "/website setup", "update the website skill" and "/website feedback".
  - `site setup` checks first: a plain chat or no attached folder is a STOP (exit 4) with the fix; an unreachable site is raised and waited on. `init` runs the same hard checks. SKILL.md: never pipe `setup`/`start` through `head`/`tail`.
  - The first-session steps are printed as a task list, each with a scripts route and a browser route. Progress is worked out from the files each step leaves, and `start` leads with SETUP NOT FINISHED until it is done. Steps can be put off with a reason.
  - Sign-in comes right after the project is set up, with the role and plan questions (SQ-1, SQ-2).
  - The hand-over ends with one visible fix to try now; `scripts/browser/layout-check.js` finds candidates at phone, tablet and desktop widths.
- **`site.yaml` replaces `site.json`** and takes the structured parts of `SITE.md` (account, access, preferences, structure, setup progress). Old folders migrate on load. `site setup` on an existing folder is the update path: migrate, tidy known files, list unknown ones, record the version, show what's new. *(maintainer decision 2026-10-30)*
- **`site feedback`** bundles the project's files and session transcripts, redacted, into a zip for the skill author. *(maintainer)*
- **Safety** *(R3)*: read a field back from the page before Save, never retype because a screenshot lags; Squarespace's category checkbox deletes, Campaigns autosave and only SEND.
- **Promoted** *(R2, R3)*: Squarespace `/config` redirect and the appended SEO title are now *(seen on 2 sites)*.
- **Folded in, seen once** *(R3)*: the admin domain needs its own browser approval; bare domain without a certificate; settings that drive what cards and summary blocks show; Campaigns facts; browser-reading pitfalls; images can't be uploaded through the browser tools.
- The skill no longer names its author: findings and feedback go to "the skill author".

### 0.5.1 (2026-10-31)

- **Reach isn't permanent.** R2's sandbox was blocked at first, then allowed once the user approved it in the conversation, but its `SITE.md` still said "cannot reach". `start` now separates three cases: blocked for the first time (ask once), still blocked (already raised, so don't ask again; on an organization account it may never be allowed), and allowed again after a block (correct `SITE.md` and redo the browser work with the scripts). *R2, maintainer.*

### 0.5.0 (2026-10-31)

- **Bugs fixed** *(R1, checked read-only against R1's API)*:
  - `entries --status all` returned nothing.
  - `entry`, `page`, `brief`, `diff` and `scope` couldn't read a new page that is still an unpublished draft (`drafts: null`).
  - `drafts` now lists provisional drafts, and says when the id is itself an unpublished draft.
- **Safety warnings** added to `craft-apply.md` *(R1)* and `squarespace.md` *(R2)*:
  - Squarespace: "Not Linked" pages are public; Enable Page off keeps a page private; the global footer label.
  - Squarespace: Save is publishing. The maintainer confirmed there is no publish button; R2's "PUBLISH" was a misreading.
- **Platform facts folded in,** marked *(seen on 1 site)*: Craft CR-1 to CR-8, previews and titles *(R1)*; Squarespace's editor section *(R2)*.
- **Ready items done:**
  - `start` checks whether the site is reachable and points to the browser route *(R1, R2)*.
  - SKILL.md notes on clicks that don't register *(R1, R2)*.
  - SKILL.md notes on putting rich text in through the editor's own interface *(R1, R2)*.
  - Checking three widths before handing back, and a layout check offered alongside SEO and accessibility *(R1, R2)*.
- **App limit:** the Cowork shell needs up to ~17 GB of free disk; added to SKILL.md, marked seen once *(R2)*.

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
| Claude Design needed the token values as CSS, not just JSON | R1 | Ship `tokens.css` with the design system |
| Every link on a page had to open in a new tab | R1 | Probably a site preference, not a command |
| Forms had to be listed and created (Wheelform plugin) | R1 | Plugin-specific; likely never |
| A reused block kept hidden settings from its old use (text columns, dividers) | R1 | Show every setting of a reused block in `diff` |
| Publishing many dependent drafts meant a long, ordered checklist done by hand | R1 | Bears on the publishing preference (see Maintainer decisions) |
| `blocks` takes over 2 minutes | R1 | Cache it, or say how long it takes |
| An SEO audit had to be put together by hand (titles, descriptions, social images, alt text, structured data, internal links) | R2 | The SKILL.md note may be enough; watch whether others ask |
| Without page drafts, a redesign was tested on a hidden page with the whole design in one Code block | R2 | Possibly a "test page" route in the Squarespace guide; the Code block trade-off (no visual editing) needs saying |
| Checklist answers were learned (SQ-7, SQ-9) but never recorded as findings; they ended up in learnings.md and admin-guide.md | R2, R3 (SQ-1 and SQ-2 never asked) | 0.7.0 asks SQ-1/SQ-2 at sign-in; watch whether the rest get recorded |
| The owner wanted a stricter check before every Save on a live site: read the real value, confirm nothing else changed, say old → new | R3 | The read-back is now the default (safety); `preferences.publishing: drafts-only` exists for sites that want stricter |
| The visible problem was an admin setting, not page content (time zone, a category filter, a card showing the excerpt) | R3 | In the Squarespace guide, seen once; a general SKILL.md note if another platform shows it |
| The bare domain failed (certificate only covers www) | R3 | `start`/`init` try `www.` when the bare address fails |

## Site preferences seen

Wants that belong in one site's preferences. If several sites set the same thing, make
it a named preference.

- Less caution about publishing. Said aloud, not in the files; the site owner's own written rule was "drafts only, a named person publishes". *R1*
- Preview at desktop, tablet and phone before every hand-back. *R1* (The problem behind it is now Ready.)

## Install and onboarding

- **R3 didn't follow the setup.** It ran in a cloud workspace with network access off and no attached folder, and the first message got a generic reply because the skill didn't load. The browser pane asked separately for the www domain and the `<random>.squarespace.com` admin domain.

- **R2 installed the skill from the zip in Cowork, and it worked.** The skill lived under `skills/synced/<id>/website`, and `init` ran. The upload wasn't rejected for the description's length, and the script path resolved.
- **R2 ran 0.4.0's onboarding.** The to-do list was used heavily: about 20 items, each with its page and where to fix it. There were no complaints about the first session.

## Not for the skill

- Digistorm editor recipes (widget values, palette and theme ids, design rules such as "no dividers on bordered tiles"). These belong in that site's `admin-guide.md`. A second Digistorm site could justify a vendor section in `craft.md`.
- Test content in the R1 notes. Don't treat it as a rule.
- R3's site specifics: the time zone fix, event categories and excerpts, the duplicate draft event, the newsletter, the bare-domain certificate. They live in its project notes.
- BC's permanent UTC-7 and Squarespace's outdated America/Vancouver rules: true today, but it's time-bound and regional. At most one line in the Squarespace guide.
- R2's site specifics: backup pages, the test page, palette and fonts, people, its title format, the footer link fixes. These are already in its project files.
