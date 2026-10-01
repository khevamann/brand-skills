# How Craft drafts work, and where the lines are drawn

## The three kinds of draft

| Kind | What it is | `isDraft` | `draftOf` |
|---|---|---|---|
| **Draft** | A named, saved alternative version of an existing entry | `true` | canonical id |
| **Unpublished draft** | Brand-new content that has never been live | `true` | `null` / `false` |
| **Provisional draft** | Craft's autosave buffer for someone editing in the CP | `true` | canonical id |

A draft is a real element row with its own `id`, plus a `draftId` key into Craft's
drafts table. Editing a draft never alters the canonical entry. Publishing copies
the draft's content onto the canonical entry and creates a revision.

This tool uses the first two kinds and refuses the third.

## Why provisional drafts are off limits

A provisional draft is a person's unsaved work in the control panel. Writing to one
would overwrite edits someone is in the middle of making, and they would see their
own changes silently replaced. `draft-set` checks `isProvisionalDraft` and refuses.

## Why `publishDraft` is blocked

Publishing is the moment content becomes public. That decision stays with a person
who can see the rendered result, which is the whole point of the arrangement:

```
Claude prepares a draft  →  you review it in the CP  →  you publish
```

Blocking publish also makes every other block cheap to trust. Even if the tool
wrote a wrong value into a draft, nothing reaches visitors.

## Why `save_*_Entry` needs a `draftId`

Craft 4 exposes only `save_<section>_<type>_Entry`. That mutation writes straight to
the live entry — unless `draftId` is supplied, in which case it writes to the draft.
So on Craft 4 the `draftId` is the only thing standing between a draft edit and a
live edit, and `guard.mjs` makes it mandatory.

Craft 5 adds `save_<section>_<type>_Draft`, which cannot write to live content at
all. The tool prefers it whenever the schema exposes it.

## Why these arguments are refused

`guard.mjs` refuses `id`, `uid`, `siteId`, `authorId`, `authorIds`, `postDate`,
`expiryDate`, `provisional`, and the six structure arguments (`prependTo`,
`appendTo`, `prependToRoot`, `appendToRoot`, `insertBefore`, `insertAfter`).

Each one reaches past the draft's content: they can retarget which element or site
is written, reassign authorship, schedule something to go live or expire, or move a
page in the site's structure tree. None of them is needed to prepare a content
change for review.

`enabled` is also refused — a draft does not need it, and on the Craft 4 path it
would be a way to switch live content on or off.

## What this means in practice

Things this tool cannot do, by construction, that you may still want:

- Publish. Do it in the CP.
- Upload or replace an image. Do it in the CP; this tool can read asset metadata.
- Move a page in the navigation structure. Do it in the CP.
- Edit nested-entry / Matrix content whose owner is a live entry. The nested-field
  mutations are blocked because their owner may be live. Edit the parent entry's
  draft in the CP instead.
- Schedule a post date. Do it in the CP.

Each of these is a deliberate limit, not a missing feature. Widening them means
editing `DENIED_MUTATION_PATTERNS` or `DENIED_ARGUMENTS` in `scripts/lib/guard.mjs`
and the tests that pin them — a visible, reviewable change, which is the point.
