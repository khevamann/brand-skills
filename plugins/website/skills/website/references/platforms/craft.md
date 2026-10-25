# Craft CMS

## What the scripts need

The Craft adapter reads over Craft's **public GraphQL schema**, with no token. `site
detect` probes the usual endpoints (`/api`, `/actions/graphql/api`,
`/admin/actions/graphql/api`) on the site and on `cms.` variants of its host, because
headless Craft often serves the front end and the CMS from different hosts. The endpoint
found is stored in the project's `site.json` as `craft.graphql`.

**If no public schema answers**, the scripts cannot read the site. Work as on any other
platform (`references/platforms/other.md`): read pages in the app browser, and apply
through the control panel per `craft-apply.md`. Recognise Craft's control panel by its
**Entries** menu and `/admin` address.

Every Craft site has its own content model — its own sections, entry types, block types
and field handles. Never assume names from the example below; read them with
`site sections`, `site blocks` and `site schema <Type>`.

## Worked example: a Digistorm school site

Everything from here on was observed on one Digistorm-built Craft 5 school site
(Kirby, 2026-09-30). Digistorm builds to a house pattern, so their other sites likely
match; other Craft sites will not. Re-check before relying on it:
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
  `*.digistormhosting.com.au`; the control panel and GraphQL endpoint are at
  `*.cms.digistormhosting.com.au`. Detection finds this split by itself.
- **The endpoint answers at `/api` and under the CP trigger at
  `/admin/actions/graphql/api`.** The commonly documented `/actions/graphql/api` does
  not work there.
- **Digistorm's demo copy** — "Digistorm School" — is left behind on new sites. Setting
  up a project for a Digistorm-hosted site adds it to the audit's placeholder list in
  `site.json` (`audit.placeholders`); add other sites' demo names there the same way.
- **The public schema is enabled and read-only** — 208 entries readable with no token,
  and `ping` is the only mutation. Verified with no `Authorization` header at all.
- **Disabled entries and drafts are publicly readable.** `status: null` and
  `drafts: true` work unauthenticated. Harmless on a test site; worth checking before
  assuming production keeps unpublished content private.

## Worked example — reading a page

```bash
site entries --search "why kirby" --status all     # search index may be empty; fall back to:
site query --q '{ entries(status: null, limit: 300) { id title uri sectionHandle } }'
site page 177                                      # the copy, nesting walked for you
site page 177 --raw                                # same as JSON, plus the query used
```

`site page` builds the two-level fragment query itself by introspecting the block
types, so the field-name inconsistencies above do not matter when reading.

The search index on the test site returned nothing for `why kirby` while the page
existed at `admissions/why-kirby`. If a search comes back empty, list and filter
rather than concluding the page is absent.
