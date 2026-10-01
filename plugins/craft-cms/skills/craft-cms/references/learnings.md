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
