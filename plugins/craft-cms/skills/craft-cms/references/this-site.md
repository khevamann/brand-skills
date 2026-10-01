# This site's content model

Observed from the test site on 2026-09-30. Digistorm builds these to a house
pattern, so production likely matches, but re-check before relying on it:
`craft sections`, then `craft query --q '{ entry(id: <id>) { __typename } }'`.

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
    ├── ds_LayoutBlock_Entry          "Why Families Choose Kirby"
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
infer a handle — run `craft schema <Type>_Entry`.

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
  returns a `MetaBundle` object. `craft entry` tolerates this and warns.
- **The site's `url` host differs from the CMS host.** Content is served from
  `*.digistormhosting.com.au`; the control panel and GraphQL endpoint are at
  `*.cms.digistormhosting.com.au`.
- **The endpoint is under the CP trigger:** `/admin/actions/graphql/api`, not
  `/actions/graphql/api`.
- **The public schema is enabled and read-only** — 208 entries readable with no token,
  and `ping` is the only mutation. Verified with no `Authorization` header at all.
- **Disabled entries and drafts are publicly readable.** `status: null` and
  `drafts: true` work unauthenticated. Harmless on a test site; worth checking before
  assuming production keeps unpublished content private.

## Worked example — reading a page

```bash
craft entries --search "why kirby" --status all     # search index may be empty; fall back to:
craft query --q '{ entries(status: null, limit: 300) { id title uri sectionHandle } }'
craft page 177                                      # the copy, nesting walked for you
craft page 177 --raw                                # same as JSON, plus the query used
```

`craft page` builds the two-level fragment query itself by introspecting the block
types, so the field-name inconsistencies above do not matter when reading.

The search index on the test site returned nothing for `why kirby` while the page
existed at `admissions/why-kirby`. If a search comes back empty, list and filter
rather than concluding the page is absent.
