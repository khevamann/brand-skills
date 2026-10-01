# Briefing Claude Design, and getting the result back in

The round trip is: read the page → brief a design tool → get edited output → apply it in
the CMS. Two things make or break it, and both are about the handoff format rather than
the design work.

## 1. The design must stay inside the block vocabulary

Run `craft blocks` first, every time. It is the authoritative list of what the front end
can render, derived from the live site rather than guessed.

Three hard constraints to state in any design brief:

- **30 block types exist.** Anything outside them cannot be stored or rendered. A new
  type needs a Craft entry type *and* a matching Nuxt component. Neither is reachable
  through the API — Craft's GraphQL cannot touch the content model at all — so a new
  block type means a Digistorm change.
- **`ds_EmbedBlock` is the escape hatch.** Its `embed_Code` field stores raw HTML and
  `<script>` verbatim and injects it on hydration. Use it for a section the vocabulary
  cannot express. It renders client-side only, so it is invisible to a static HTML
  snapshot and weaker for SEO.
- **Blocks cannot be shared between pages.** Each nested block has a single `ownerId`.
  A "shared" component is a pattern you apply repeatedly, not one object. If a pattern
  recurs, that is the argument for asking Digistorm to make it a real block type.

The design system's utility classes are already in the shipped CSS — `surface-primary`,
`top-spacing-md`, `container-wide`, `lg:rounded-card-lg`, plus Tailwind utilities. Markup
in an Embed or rich-text field can reuse them and look native. Rich-text fields do keep
classes: existing content contains `<h4 class="text-lead-text">`.

## 2. The output must say which field changed

This is the part that decides whether applying the change takes seconds or an afternoon.

Every block renders as `<section id="<craft block id>">`, so an edited HTML file can be
diffed back against the corpus mechanically. But HTML alone is ambiguous *within* a
block — which element was `tile_Heading` and which was `tile_TextOnHover`.

**Ask for an edit manifest alongside the HTML**, in this shape:

```json
{
  "pageId": "177",
  "edits": [
    { "blockId": "5665", "field": "richText_Text", "value": "<h5>New heading copy</h5>" },
    { "blockId": "5666", "field": "tile_Heading", "value": "Intellectual Range" }
  ],
  "newBlocks": [
    { "afterBlockId": "6297", "type": "ds_EmbedBlock", "field": "embed_Code", "value": "<section>…</section>" }
  ],
  "unmapped": ["Changed the order of the stat tiles"]
}
```

`unmapped` matters more than it looks: it is where structural changes surface instead of
being silently dropped. Anything listed there needs a human decision — recompose with
existing blocks, move it into an Embed block, or drop it.

Without a manifest, fall back to diffing the edited HTML against
`site-export/pages/<id>.html` by section id, and expect to resolve within-block
ambiguity by hand.

## 3. Applying it

The skill is read-only, so applying is a separate step:

- **Browser MCP driving the Craft control panel.** No token needed. Slow and brittle —
  rich-text editors, nested block drawers, drag handles. Record what breaks in
  `learnings.md` so the next run is faster.
- **GraphQL with an Edit-scope token.** Deterministic, seconds per field. The code
  exists in git history at `a1b022a`. Worth knowing when asking for the token: a write
  token only automates typing a CP user could already do. It grants nothing structural,
  because the API cannot create block types or fields.

Either way, make the change as a **draft** and let a human publish.

## Before each round trip

1. `craft blocks` — the current vocabulary, with example copy per field.
2. `craft page <id>` — the page as it stands, with block ids.
3. `craft export --out site-export` — refresh the corpus if the site has moved on.
4. Read `learnings.md` — what broke last time.
