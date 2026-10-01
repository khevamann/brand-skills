# Craft CMS GraphQL API

Working notes for Craft 4 and 5. Verified against the Craft docs and
`craftcms/cms` source (`src/gql/`). Where the two major versions differ, both are
given — run `craft mutations` to see which one this site is.

## Endpoint

```
POST https://ks-us-ca-1849-website-2026.cms.digistormhosting.com.au/admin/actions/graphql/api
Content-Type: application/json

{"query": "...", "variables": {...}}
```

No `Authorization` header: this site's public schema is readable anonymously. Note the
`/admin/` prefix — the action route sits under the control-panel trigger, so the more
commonly documented `/actions/graphql/api` does not work here.

Errors come back as HTTP 200 with an `errors` array. Always check `errors`, not just
the status code.

**Worth knowing about this endpoint:** the public schema exposes more than published
pages. `status: null` and `drafts: true` both work with no token, so disabled entries
and in-progress drafts are readable by anyone who finds the URL. That is a property of
the site's configuration, not of this skill.

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
on the concrete per-entry-type types. Their names differ by major version:

| | Object type | Save mutation |
|---|---|---|
| Craft 4 | `<section>_<entryType>_Entry` | `save_<section>_<entryType>_Entry` |
| Craft 5 | `<entryType>_Entry` — **no section prefix** | `save_<section>_<entryType>_Entry` |

Craft 5 made entry types global rather than section-scoped, so the object type drops
the section but the mutation keeps it. Guessing the wrong form gets you Craft's
opaque "Something went wrong" error, so read the name off the data instead:

```graphql
{ entry(id: 177) { __typename } }
```

To read custom fields across mixed types, use inline fragments:

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

## Mutations — not available here

Craft does expose writes: per-section `save_<section>_<type>_Entry` and
`save_<section>_<type>_Draft` mutations, plus `createDraft`, `publishDraft` and
`deleteEntry`. None of them is reachable from this skill, and the detail is left out
on purpose rather than documented and then forbidden.

Three independent reasons they cannot be called:

1. **The schema has none of them.** This site's public schema grants View scope only,
   and scopes control which fields exist at all — not just which results come back.
   `ping` is the only mutation in it. A write returns `{"data":[]}` because the field
   does not exist.
2. **No token is sent.** Write mutations appear only in a private schema with Edit
   scope, which a token unlocks. `client.mjs` sends no `Authorization` header.
3. **The guard refuses them.** `assertReadOnly` rejects any document containing
   `mutation` or `subscription`, or naming a write field. This holds even if someone
   grants the public schema Edit scope later.

Run `craft mutations` to see the live position. Content changes happen in the control
panel.

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
- **Plugin fields can break an otherwise valid query.** SEOmatic declares `seomatic`
  as `String` but returns an object, so any query selecting it fails with
  `String cannot represent value: instance of ...MetaBundle`. Craft returns usable
  `data` alongside that error; `client.mjs` passes reads through with a warning
  rather than discarding the response.
- **"Something went wrong when processing the GraphQL query."** is Craft refusing to
  explain a validation failure. It nearly always means a name in the document does
  not exist — a misspelled fragment type, field, or argument. Bisect the document by
  dropping one fragment at a time.
- **What GraphQL cannot do at all:** templates, plugins, config, the content model,
  user accounts. Those are code and control-panel concerns.

## Sources

- [Craft 5 GraphQL docs](https://craftcms.com/docs/5.x/development/graphql.html)
- [Craft 4 GraphQL docs](https://craftcms.com/docs/4.x/graphql.html)
- [`src/gql/mutations/Entry.php`](https://github.com/craftcms/cms/blob/5.x/src/gql/mutations/Entry.php)
- [`src/gql/arguments/mutations/Draft.php`](https://github.com/craftcms/cms/blob/5.x/src/gql/arguments/mutations/Draft.php)
