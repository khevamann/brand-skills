---
name: craft-cms
description: Use when reading, searching, or drafting content on the Craft CMS website — looking up a page, entry, news item, event or staff profile, checking what a field contains, auditing content, or preparing a wording/content change for review. Covers Craft's GraphQL API. This skill can only read and write drafts; it cannot publish, delete, or change live content.
---

# Craft CMS — read and draft

All access goes through `scripts/craft.mjs` in this skill's directory. Never hand-write
HTTP requests to the CMS, and never use `curl`, `wget`, or a GraphQL client against it:
the safety rules live in the script, so bypassing it bypasses them.

```bash
CRAFT="node <skill-dir>/scripts/craft.mjs"   # resolve <skill-dir> from this skill's base directory
$CRAFT --help
```

## What is and is not possible

| Possible | Blocked |
|---|---|
| Search and read entries, fields, assets metadata | Publishing a draft |
| Create a draft of an existing entry | Editing a live entry |
| Create brand-new content as an unpublished draft | Deleting anything |
| Write field values into a draft | Assets, categories, tags, globals, users |
| Introspect the schema | Structure moves, scheduling, authorship |

The blocks are enforced in `scripts/lib/guard.mjs`, not by your judgment. If a request
needs something blocked, say so plainly and hand the user the draft to publish themselves
in the Craft control panel — that is the intended division of labour.

## The workflow

**The user reviews and publishes. You only ever prepare.** Say this when you hand work back.

1. **Orient.** `$CRAFT sections` for the content model, `$CRAFT mutations` to confirm what
   this token can reach. Do this once per session before any write.
2. **Find the entry.** `$CRAFT entries --search "..." --section news` or
   `--status all` to include disabled entries.
3. **Read it.** `$CRAFT entry <id>`. Structured fields (Matrix, relations) are listed
   separately — query those with `$CRAFT query` and an explicit subselection.
4. **Check what you may set.** `$CRAFT fields <id>` lists the settable arguments with their
   GraphQL types, and what the guard refuses.
5. **Make a draft.** `$CRAFT draft-create <entryId> --name "Claude: shorten intro"`.
   It prints the new draft's entry id. Live content is untouched.
6. **Write to the draft.** `$CRAFT draft-set <draftEntryId> --field title="..."`.
   Use `--field body=@/tmp/body.md` for long text and `--json-field x='[...]'` for
   anything that is not a plain scalar.
7. **Hand it back.** Give the user the draft name, the entry it belongs to, and what
   changed. They review it in the control panel and publish.

Brand-new content takes a different route: `$CRAFT draft-new --section news --type article
--title "..."` creates an unpublished draft. Nothing is live until the user publishes it.

Run any draft command with `--dry-run` first when the change is non-trivial — it prints
the exact mutation and variables without sending them. Show that to the user when they
ask what you are about to do.

## Rules

- **Never fabricate an id, handle, or field name.** Introspect first. A wrong handle is a
  confusing error; a guessed field name silently does nothing.
- **One draft per logical change,** named so the user can recognise it in the CP.
- **Quote the user's wording** when making a copy change. Do not improve prose that was
  not in scope.
- **A provisional draft is someone's unsaved work in progress.** The script refuses to
  touch them. Do not look for a way around that.
- **If a command exits `BLOCKED`,** the request is outside this skill's remit. Report it;
  do not reach for another route.
- **Report what actually happened.** `draft-set` returns the saved draft; if it did not
  return, say so rather than assuming.

## Reference

- `references/craft-graphql-api.md` — the Craft GraphQL API: endpoint, auth, query
  arguments, mutation names and signatures, Matrix/structured content, gotchas.
- `references/setup.md` — minting a token and the schema scope to give it.
- `references/draft-model.md` — how Craft drafts actually work, and why the guard draws
  the lines it does.

Read the API reference before writing any non-trivial `craft query` document.
