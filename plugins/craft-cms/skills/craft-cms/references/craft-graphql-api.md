# Craft CMS GraphQL API

Working notes for Craft 4 and 5. Verified against the Craft docs and
`craftcms/cms` source (`src/gql/`). Where the two major versions differ, both are
given — run `craft mutations` to see which one this site is.

## Endpoint and auth

```
POST https://YOUR-SITE.com/actions/graphql/api
Content-Type: application/json
Authorization: Bearer <token>

{"query": "...", "variables": {...}}
```

`/index.php?action=graphql/api` is the same endpoint. A custom route may be mapped
to `graphql/api` in `config/routes.php`, so the public path can differ per site.

- Tokens are created in the control panel under **GraphQL → Tokens**, each bound to
  exactly one schema. The access token is 32 characters, shown once, and can be
  regenerated to revoke access.
- Tokens live in the database, not project config, so they are per-environment:
  a staging token will not work against production.
- Without a token the request falls back to the public schema, which is disabled by
  default. A `403` or an empty schema usually means a missing or wrong token.
- Errors come back as HTTP 200 with an `errors` array. Always check `errors`, not
  just the status code.

## Reading

Craft's query arguments mirror its element queries. The ones that matter here:

| Argument | Type | Notes |
|---|---|---|
| `id` | `[QueryArgument]` | One or more element ids |
| `section` | `[String]` | Section handles |
| `type` | `[String]` | Entry type handles |
| `search` | `String` | Craft's search index syntax, e.g. `"title:enrol*"` |
| `status` | `[String]` | `live`, `pending`, `expired`, `disabled`. Pass `null` for all |
| `limit` / `offset` | `Int` | Defaults to 100 if unset |
| `orderBy` | `String` | e.g. `"dateUpdated desc"`, `"title asc"` |
| `drafts` | `Boolean` | Include drafts in the results |
| `draftOf` | `QueryArgument` | Canonical entry id; `false` for unpublished drafts |
| `provisionalDrafts` | `Boolean` | Include the control panel's autosave drafts |
| `slug`, `uri`, `relatedTo`, `site` | | As per element queries |

```graphql
query ($section: [String], $search: String) {
  entryCount(section: $section, search: $search, status: null)
  entries(section: $section, search: $search, status: null, limit: 25, orderBy: "dateUpdated desc") {
    id title slug uri url status sectionHandle typeHandle dateUpdated
  }
}
```

Useful fields on `EntryInterface`: `id`, `uid`, `title`, `slug`, `uri`, `url`,
`status`, `enabled`, `sectionHandle`, `typeHandle`, `postDate`, `dateCreated`,
`dateUpdated`, `isDraft`, `draftId`, `draftName`, `draftNotes`,
`isProvisionalDraft`, `isUnpublishedDraft`, `ancestors`, `children`, `parent`,
`author { fullName }`.

**Entries are polymorphic.** `entries` returns `EntryInterface`; custom fields live
on the concrete per-entry-type types, named `<section>_<entryType>_Entry`. To read
custom fields across mixed types, use inline fragments:

```graphql
{
  entries(section: "news") {
    id title
    ... on news_article_Entry { summary featuredImage { url } }
  }
}
```

`craft entry <id>` does this for you by reading `__typename` first and then
selecting that type's leaf fields.

### Structured content

Matrix (Craft 4) and nested-entry fields (Craft 5) need explicit subselections and
are the fiddliest part of the API:

```graphql
# Craft 4 Matrix
{ entry(id: 123) { ... on pages_page_Entry {
  pageBuilder { __typename
    ... on pageBuilder_textBlock_BlockType { heading bodyText }
    ... on pageBuilder_imageBlock_BlockType { caption image { url alt } }
  } } } }

# Craft 5 nested entries
{ entry(id: 123) { ... on pages_page_Entry {
  pageBuilder { __typename
    ... on pageBuilder_textBlock_Entry { heading bodyText }
  } } } }
```

Other field shapes: rich text returns `String` of HTML; assets/categories/entries
relations return lists needing a subselection; `Money`, `Dropdown` and `Table`
fields have their own generated types. `craft schema <TypeName>` prints a type's
fields when you are unsure.

## Mutations

Craft generates mutations per section and entry type. Exact names:

| Mutation | Arguments | Returns |
|---|---|---|
| `save_<section>_<type>_Entry` | entry args + custom fields | the entry |
| `save_<section>_<type>_Draft` | draft args + custom fields | the entry (Craft 5) |
| `createDraft` | `id: Int!`, `name: String`, `notes: String`, `provisional: Boolean`, `creatorId: Int` | `ID` |
| `publishDraft` | `id: Int!`, `provisional: Boolean` | `ID` |
| `deleteEntry` | `id: Int!`, `siteId: Int`, `hardDelete: Boolean` | `Boolean` |
| `save_<volume>_Asset`, `deleteAsset` | | |
| `save_<group>_Category`, `deleteCategory` | | |
| `save_<group>_Tag`, `deleteTag` | | |
| `save_<set>_GlobalSet` | | |
| `save_<field>Field_<type>_Entry` / `_Draft` | nested entry fields (Craft 5) | |

Shared entry arguments (`src/gql/arguments/mutations/Entry.php`): `id`, `uid`,
`title`, `slug`, `enabled`, `authorId`, `authorIds`, `postDate`, `expiryDate`,
`siteId`, `revisionNotes`. Structure sections add `prependTo`, `appendTo`,
`prependToRoot`, `appendToRoot`, `insertBefore`, `insertAfter`.

Draft-specific arguments (`src/gql/arguments/mutations/Draft.php`) — everything
above except `id` and `uid`, plus:

| Argument | Type | Meaning |
|---|---|---|
| `draftId` | `ID` | The draft to write to. Omit only when creating an unpublished draft |
| `asUnpublishedDraft` | `Boolean` | Create brand-new content that has never been live |
| `draftName` | `String` | Shown in the control panel's draft list |
| `draftNotes` | `String` | Free-text note on the draft |
| `provisional` | `Boolean` | Target the autosave draft. Avoid |

**The critical detail:** `save_<section>_<type>_Entry` writes to the *live* entry
unless `draftId` is supplied. Craft 5's `save_<section>_<type>_Draft` can only ever
write to a draft. This is why `guard.mjs` requires a `draftId` on the `_Entry` form
and prefers the `_Draft` form when the schema has it.

### The draft round-trip

```graphql
# 1. Make the draft. 101 is the canonical entry id.
mutation { createDraft(id: 101, name: "Shorter intro", notes: "Prepared for review") }

# 2. Write to it. draftId is the value from EntryInterface.draftId, not the entry id.
mutation ($draftId: ID) {
  save_news_article_Draft(draftId: $draftId, title: "New title") { id title draftId }
}

# 3. A human publishes it in the control panel. publishDraft is blocked here.
```

`createDraft`'s return value has meant different things across Craft versions, so
read the draft back with `entries(draftOf: 101, drafts: true, status: null)` rather
than trusting it. `craft draft-create` already does this.

## Gotchas

- **`draftId` ≠ the draft's entry `id`.** A draft is a row with its own element
  `id`; `draftId` is a separate drafts-table key. `save_..._Draft` wants `draftId`.
  `entry(id:)` and `craft draft-set` want the element id.
- **`status: null` is required to see drafts and disabled entries.** The default
  status filter hides them, which reads as "the entry doesn't exist".
- **Field handles are the agency's choice.** Never guess them; introspect.
- **The schema is scoped to the token.** A missing mutation usually means the token's
  schema lacks write scope for that section, not that Craft cannot do it.
- **Nested entries may have no `sectionHandle`.** Entries inside a Craft 5
  nested-entry field belong to a field, not a section, so no per-section mutation
  exists for them.
- **Multi-site.** `siteId` / `site` arguments select the site; omitting them uses
  the primary site. This tool refuses to set `siteId` on writes, so drafts land on
  the primary site.
- **What GraphQL cannot do at all:** templates, plugins, config, the content model,
  user accounts. Those are code and control-panel concerns.

## Sources

- [Craft 5 GraphQL docs](https://craftcms.com/docs/5.x/development/graphql.html)
- [Craft 4 GraphQL docs](https://craftcms.com/docs/4.x/graphql.html)
- [`src/gql/mutations/Entry.php`](https://github.com/craftcms/cms/blob/5.x/src/gql/mutations/Entry.php)
- [`src/gql/arguments/mutations/Draft.php`](https://github.com/craftcms/cms/blob/5.x/src/gql/arguments/mutations/Draft.php)
