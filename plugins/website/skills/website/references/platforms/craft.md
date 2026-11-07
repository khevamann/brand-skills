# Craft CMS

## What the scripts need

The Craft adapter reads over Craft's **public GraphQL schema**, with no token. `site
detect` probes the usual endpoints (`/api`, `/actions/graphql/api`,
`/admin/actions/graphql/api`) on the site and on `cms.` variants of its host, because
headless Craft often serves the front end and the CMS from different hosts. The endpoint
found is stored in the project's `site.yaml` as `craft.graphql`.

**If no public schema answers**, the scripts read the site from the outside instead, as
on any other platform (`references/platforms/other.md`). Headless Craft front ends often
render each block as `<section id="<entry id>">`, so the outside view can still carry
Craft's real block ids. Drafts are not visible that way. Apply through the control panel
per `craft-apply.md`. Recognise Craft's control panel by its **Entries** menu and
`/admin` address.

Every Craft site has its own content model — its own sections, entry types, block types
and field handles. Never assume names from the example below; read them with
`site sections`, `site blocks` and `site schema <Type>`.

## Worked example: an agency-built headless Craft site

Everything from here on was observed on one agency-built, headless Craft 5 site
(2026-09). Agencies often build every client site from the same house template, so
their other sites may match; other Craft sites will not. Re-check before relying on it:
`site sections`, then `site query --q '{ entry(id: <id>) { __typename } }'`.

It is **Craft 5**. Entry type object names have no section prefix
(`ds_StandardPage_Entry`, not `ds_Pages_ds_StandardPage_Entry`).

## Sections

| Section | Entry type |
|---|---|
| `ds_Pages` | `ds_StandardPage` |
| `ds_Homepage` | `ds_Homepage` |
| `ds_News` | `ds_News` |
| `ds_Events` | `ds_Events` |
| `ds_Videos` | `ds_VideosSection` |
| `ds_Popups` | `ds_PopupsSection` |
| `ds_PreFooter` | `ds_PreFooter` |

Of 208 entries on the test site, 166 were **nested entries** with a null
`sectionHandle` — page-builder blocks, not pages. Ignore them when looking for a
page, and remember that `entryCount` includes them.

## Pages are trees of nested entries

A page holds almost no content of its own. `ds_StandardPage_Entry` has:

- `internalPageBanner: [internalPageBanner_MatrixField]!` — the hero
- `contentBuilder: [contentBuilder_MatrixField]!` — the page body
- `hideBanner`, `showBreadcrumbs`, `pageVisibility`, `popup`, `preFooter`

`contentBuilder` holds blocks, and `ds_LayoutBlock_Entry` nests a *second* level via
`layout_contentBuilder`. So real copy sits two levels down:

```
ds_StandardPage_Entry
└── contentBuilder
    ├── ds_LayoutBlock_Entry          "Why Choose Us"
    │   └── layout_contentBuilder
    │       ├── ds_RichTextLayoutBlock_Entry   → richText_Text (HTML)
    │       └── ds_TileLayoutBlock_Entry       → tile_Heading / tile_TextOnHover
    ├── ds_RichTextBlock_Entry        → richText_Text (HTML)
    └── ds_FormBlock_Entry
```

Block types seen: `ds_LayoutBlock`, `ds_RichTextBlock`, `ds_RichTextLayoutBlock`,
`ds_TileLayoutBlock`, `ds_QuoteLayoutBlock`, `ds_LinksLayoutBlock`,
`ds_EventsLayoutBlock`, `ds_VideoLayoutBlock`, `ds_FormBlock`,
`ds_InternalPageBannerDefault`, plus accordion, gallery, images, embed, divider.

## Field naming

Fields are prefixed with their block's handle, lower-camel before the underscore and
**PascalCase after it** — except the text body, which is lowercase-ish:

- `richText_Text` (HTML), `richText_Buttons`, `richText_ContainerWidth`
- `tile_Heading`, `tile_Subheading`, `tile_TextOnHover`, `tile_NumberCountValue`
- `layout_contentBuilder`, `layout_ColorTheme`, `layout_ContainerWidth`
- `links_Links`, `quote_QuoteItems`, `banner*`

The casing is inconsistent (`layout_contentBuilder` vs `layout_ColorTheme`), so never
infer a handle — run `site schema <Type>_Entry`.

Most blocks carry a dozen presentation fields (`_ColorTheme`, `_Padding`,
`_TopSpacing`, `_ContainerWidth`, `_ColorPalette`). For a copy change you want the
text field and nothing else.

## Where the copy actually lives

| Want to change | Field |
|---|---|
| A heading or paragraph | `richText_Text` on a RichText block — HTML, usually one `<h5>`/`<p>` |
| A feature card | `tile_Heading` + `tile_TextOnHover` on a Tile block |
| A statistic | `tile_NumberCountPrefix` / `tile_NumberCountValue` / `tile_NumberCountSuffix` |
| A link list | `links_Links` (a `HyperLinkInterface` list) |

## Gotchas found the hard way

- **`HyperLinkInterface` has no `HyperLink` implementing type.** A fragment
  `... on HyperLink { ... }` fails with Craft's opaque error. Introspect the
  interface's real `possibleTypes` before selecting into link fields.
- **SEOmatic breaks whole-type selections.** `seomatic` is declared `String` but
  returns a `MetaBundle` object. `site entry` tolerates this and warns.
- **The site's `url` host differs from the CMS host.** Content is served from
  `<site>.<agency-host>`; the control panel and GraphQL endpoint are at
  `<site>.cms.<agency-host>`. Detection finds this split by itself.
- **The endpoint answers at `/api` and under the CP trigger at
  `/admin/actions/graphql/api`.** The commonly documented `/actions/graphql/api` does
  not work there.
- **The template's demo copy** (the agency's sample organisation name) was left behind
  on the live site. Add a demo name like that to the audit's placeholder list in
  `site.yaml` (`audit.placeholders`), and the audit flags every page that still has it.
- **The public schema is enabled and read-only** — 208 entries readable with no token,
  and `ping` is the only mutation. Verified with no `Authorization` header at all.
- **Disabled entries and drafts are publicly readable.** `status: null` and
  `drafts: true` work unauthenticated. Harmless on a test site; worth checking before
  assuming production keeps unpublished content private.

## Worked example — reading a page

```bash
site entries --search "why choose us" --status all   # search index may be empty; fall back to:
site query --q '{ entries(status: null, limit: 300) { id title uri sectionHandle } }'
site page 101                                        # the copy, nesting walked for you
site page 101 --raw                                  # same as JSON, plus the query used
```

`site page` builds the two-level fragment query itself by introspecting the block
types, so the field-name inconsistencies above do not matter when reading.

The search index on the test site returned nothing for `why choose us` while the page
existed at `about/why-choose-us`. If a search comes back empty, list and filter
rather than concluding the page is absent.

## First-time checklist

Questions only a real, logged-in site can answer. Nobody had one to test on, so the
first project on Craft answers them, in the order a real session reaches them. Work
through them with the user as the work goes; never hand over this list. Answer what
you can see for yourself with `site finding <ID> "<answer>"`, saying how you know: the
label you saw, the URL that opened, what happened after a click. Questions marked
_(ask the user)_ need the person: ask each one in plain words, one at a time, when it
comes up. Record anything else you learn about Craft in general with
`site finding new "<text>"`. Never go looking for trouble to answer a question, and stop
at the first surprise.

### Logging in

- **CR-1** — _(ask the user)_ What is the control-panel address, and was there 2FA? (Later, note how long the login lasted.)

### Opening a page

- **CR-2** — What is the real URL for editing an entry? Does `/admin/entries/<section>/<id>` work?
- **CR-3** — Are block (nested entry) ids visible anywhere in the control panel?
- **CR-4** — How do nested blocks open for editing: inline, in a drawer, or in a modal?

### Making a draft

- **CR-5** — What is the exact control and label for creating a draft of an entry?

### Editing

- **CR-6** — What happens to pasted HTML in a rich-text field: kept, cleaned, or stripped? Do design-system classes survive?
- **CR-7** — Roughly how long did one field edit take, including checking it?

### Saving

- **CR-8** — After saving a draft, does `site drafts <id>` list it?
