# Learnings log

Append after every round trip. The point is that iteration compounds: each pass should
make the next one cheaper, and the shortcuts only become visible once a few runs are
written down.

Keep entries short and specific. A learning is something that changes what we do next
time, not a diary.

## How to add an entry

```markdown
## YYYY-MM-DD — <page or task>

**Did:** what was attempted, which route (browser MCP / API / by hand)
**Worked:** what was faster or more reliable than expected
**Broke:** the specific failure, with the selector / field / error text
**Next time:** the concrete change to make
```

Promote anything that stops being a surprise into `design-handoff.md` or the skill
itself — the log is for open questions, not settled practice.

---

## 2026-09-30 — building the read side

**Did:** Built the read-only skill and ran it against the live test site.

**Worked:**
- Every Craft block renders as `<section id="<block id>">` — 23/23 on the page tested.
  The HTML↔CMS mapping is mechanical, which is what makes this whole workflow viable.
- Classifying copy vs presentation fields from observed *values* rather than the schema.
  Craft types both as plain `String`, so the schema cannot tell them apart.

**Broke:**
- `entries()` does not return second-level nested blocks. An inventory built from it
  missed `ds_TileLayoutBlock` and `ds_RichTextLayoutBlock` — the types holding most of
  the copy. Walk page trees instead; that is what `craft blocks` now does.
- SEOmatic declares `seomatic` as `String` but returns an object, failing any
  whole-type selection. Reads now tolerate partial data.
- Craft masks all validation failures as "Something went wrong when processing the
  GraphQL query." Bisect the document; there is no better signal.
- `HyperLinkInterface` has no `HyperLink` implementing type, so `... on HyperLink`
  fails with that same opaque error. Link fields are still unmapped.

**Next time:**
- Introspect `HyperLinkInterface.possibleTypes` so link fields can be read.
- Content issues found while scanning, worth an audit pass: leftover `Lorem ipsum` in
  live `quoteItem_Text` and `tabItem_BodyContent`, and "Digistorm School" demo copy
  still present where it should say Kirby.
- The `style-guide` page (id 2848, 64 blocks) appears to demo the whole vocabulary.
  Likely the single best reference to hand a design tool.

## 2026-09-30 — building the design round trip

**Did:** Added the vocabulary, design-system, audit, brief, diff and scope commands,
all read-only. Nothing has been through a real design tool yet.

**Worked:**
- `relatedTo` measures blast radius exactly. The pre-footer entry 5037 is referenced by
  6 pages, so an edit that looks local is not. This is what `craft scope` is built on.
- Classifying copy vs presentation from **value spread across the whole site** rather
  than from one value. "Intellectual Vitality" is 21 characters and is a heading; "md"
  is 2 characters and is a spacing setting. Length cannot tell them apart; a field whose
  values repeat from a set of three across 61 blocks is obviously a setting.
- `HyperLinkInterface` and `AssetInterface` have **no implementing types**, so their
  fields are selected directly. The earlier `... on HyperLink` failure was my error, not
  a schema limitation. Links and images are readable now.

**Broke:**
- Selecting every relation field pulled in `revisions`, which made every block look
  populated and hid genuinely empty ones. Built-in relations have to be excluded by
  name — they are the same GraphQL types as content relations.
- Skipping fields that have *any* arguments hid `contentBuilder` entirely. Craft's field
  arguments are all optional; only a required argument should disqualify a field.
- `/search` was reported as a broken link. It is a front-end route with no Craft entry.
  Internal links now need `--links` to be called broken rather than merely unmatched.
- Listing blocks (`ds_NewsLayoutBlock`, `ds_EventsLayoutBlock`) store nothing by design
  and were reported as empty. They render content pulled from elsewhere.

**Next time:**
- Nothing has been applied through the control panel yet. The first real round trip is
  where the brittle parts will show up — record which CP interactions are slow or
  fragile, because that is what decides whether browser automation is viable.
- No exact cross-page duplicate copy exists on this site today, so the divergence check
  in `craft scope` is unit-tested but unproven against real content.
- 28 real placeholder findings, not the 71 first reported: 43 were on the `style-guide`
  page, where placeholder text belongs. `findPlaceholders` now skips component demo
  pages by default. The lesson generalises — a count is not a finding until you know
  which pages are supposed to look like that.
- The remaining 28 are "Digistorm School" demo copy and `Lorem ipsum`, concentrated on
  the homepage (6), `academics/middle-school` (4), `admissions` (4) and the news and
  events sections. `admissions/why-kirby` has none, so it is the clean page to start on.
- Why it matters for a round trip: the brief shows the design tool the current copy, so
  placeholder text means layout decisions get made against text that will be replaced.
  It is also worth keeping copy fixes and design changes in separate manifests, or you
  cannot tell which change caused what.
