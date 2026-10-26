# Briefing Claude Design, and getting the result back in

The round trip is: read the page → brief a design tool → get edited output → apply it in
the CMS. Two things make or break it, and both are about the handoff format rather than
the design work.

This applies on every platform, with the same commands. Block refs and field names
differ: on Craft's API a block is an entry id and a field a Craft handle
(`5665` / `richText_Text`); read from the outside, a block is a section id or a
generated ref and a field is named for what it is (`template--10__hero` /
`text_Heading1`). The brief says which, and the manifest uses whatever the brief gave.
The worked examples come from a Digistorm-built Craft school site.

From the outside, ask Claude Design to keep `data-ck-ref` and `data-ck-field` on every
element it edits. Then `site diff <page> result.html` reads the edits straight back
into a manifest.

Claude Design cannot import a design system from a URL, so it gets files: the brief,
`DESIGN-SYSTEM.md`, and a rendered `style-guide.html`. Ask for standalone HTML back,
plus the edit manifest below.

## 1. The design must stay inside the block vocabulary

Run `site blocks` first, every time. It is the authoritative list of what the front end
can render, derived from the live site rather than guessed.

Three hard constraints to state in any design brief:

- **Only the block types in use exist.** Anything outside them cannot be stored or
  rendered. A new type needs a CMS change *and* a matching front-end template or
  component, from the site's developers. On Craft neither is reachable through the API,
  which cannot touch the content model at all.
- **An embed block, if the site has one, is the escape hatch.** On the Digistorm site,
  `ds_EmbedBlock`'s `embed_Code` stores raw HTML and injects it on hydration. Use it for
  a section the vocabulary cannot express. Client-side rendering makes it invisible to a
  static HTML snapshot and weaker for SEO.
- **Whether blocks can be shared differs by platform.** On Craft each nested block has a
  single owner, so a repeated pattern is a convention, not one object. On Shopify a
  section in a template is shared by every page using it — the opposite problem.

The design system's utility classes are usually already in the shipped CSS (on the
Digistorm site: `surface-primary`, `top-spacing-md`, `container-wide`, plus Tailwind).
Markup in an embed or rich-text field can reuse them and look native, if the rich-text
field keeps classes — check existing content first.

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
`export/pages/<id>.html` by section id, and expect to resolve within-block
ambiguity by hand.

## 3. Check the blast radius before calling anything ready

```bash
site diff <pageId> result.json                      # are the edits even valid?
site scope <pageId> result.json                     # do they stay on one page?
```

`scope` exits `0` only when every edit is confined to the page. It exits `3` and
explains itself when an edit touches a shared entry (naming the affected pages), changes
copy that appears elsewhere, changes a presentation setting, or asks for a design-system
change or a new block type.

**Anything beyond one page is the user's decision, not yours.** Report how many pages are
affected and which, then ask: this page only, all of them, or neither.

## 4. Applying it

The skill is read-only, so applying is a separate step:

- **The Claude Desktop app browser driving the admin**, with the user logged in. No
  token needed. Slow and brittle — rich-text editors, nested block drawers, drag
  handles. Record what breaks in the project's `learnings.md` and `admin-guide.md` so
  the next run is faster.
- **GraphQL with an Edit-scope token.** Deterministic, seconds per field. The code
  exists in git history at `a1b022a`. Worth knowing when asking for the token: a write
  token only automates typing a CP user could already do. It grants nothing structural,
  because the API cannot create block types or fields.

Either way, make the change as a **draft** and let a human publish.

## Before each round trip

1. `site blocks` — the current vocabulary, with example copy per field.
2. `site page <id>` — the page as it stands, with block ids.
3. `site export` — refresh the corpus if the site has moved on.
4. Read the project's `learnings.md` — what broke last time.
