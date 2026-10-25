# Squarespace

> **No Squarespace scripts yet.** Detection and the project folder work; everything else
> is done in the app browser using this guide. Researched 2026-10-25, not yet tried on a
> real site: treat each step as a hypothesis, and record what actually happens in the
> project's `admin-guide.md` and `learnings.md`.

**Squarespace has no version history.** Once a change is saved, the old version is gone.
Always snapshot a page before touching it.

## Before anything else

- **Version 7.1 or 7.0?** 7.1 pages are built from sections: the page source has
  `data-section-id` or `data-sqsp-section` attributes. 7.0 has no page sections and uses
  per-template layouts. Most sites are 7.1. Record it in `SITE.md`.
- **Which plan?** Page drafts exist only on some plans (see "Applying a change"). Ask
  the user or check Settings → Billing, and record it.
- **Suggest a contributor login.** The owner can invite a "Website editor" contributor,
  who can edit content on existing pages but not styles.

## Reading (no login needed)

- Page list: `<site>/sitemap.xml`.
- Any page or collection with `?format=json-pretty` added returns its data. Blog and
  other collections include each item's full body. On 7.1 standalone pages, the
  section content is **not** in the JSON, only in the rendered page.
- In the rendered HTML, blocks carry `data-sqsp-block="<type>"`. Squarespace documents
  these as stable: `text`, `button`, `image`, `gallery`, `accordion`, `code`, `form`,
  `summary`, …. Sections carry `data-section-id` and `data-section-theme`. A July 2026
  change wraps sections in `section.region` inside `.page-regions`; older pages use
  `#sections`.
- **Design system:** `<site>/site.css?minify=false`.
  - The five-colour palette is `--white-hsl`, `--lightAccent-hsl`, `--accent-hsl`,
    `--darkAccent-hsl` and `--black-hsl`.
  - The ten section colour themes are `[data-section-theme="…"]` rules.
  - The site's own Custom CSS comes after the "Squarespace LESS Compiler" comment.

  Tell Claude Design that those palette colours and section themes are the only colours
  available.

## Always ask first — these change more than one page

- **Header and footer** — on every page.
- **Site Styles** (fonts, colours, buttons), and **editing a colour theme** itself,
  which recolours every section using it. Choosing a different theme for one section is
  local, but still a presentation change.
- **Custom CSS and Code Injection**, and any code or embed block.
- **Navigation, page titles and URL slugs.** Changing a slug breaks links.
- **Summary blocks.** They show content from a blog or other collection, so the real
  edit is on the source item.
- **Forms and newsletter blocks**, the announcement bar, popups.
- Section layout, grid position and section themes.

Saved sections are copies, not links, so the same text on several pages really is
duplicated. Each copy must be edited separately; ask whether all of them should change.

## Applying a change

**Before editing, save the page's rendered HTML and `?format=json` output to
`snapshots/`.** There is no undo after saving.

1. **If the plan has page drafts (7.1, higher plans; unverified which):**
   1. Pages panel → the page's gear → **Create draft**.
   2. Edit the draft and save it **as a draft**.
   3. The draft has a preview link for the user.
   4. **Never press "Publish and replace"** — that is the user's step.

   Drafts cannot change the header, footer or styles.
2. **Otherwise, duplicate the page:**
   1. Pages panel → gear → **Duplicate**. The copy lands in "Not Linked", where visitors
      can't reach it from the menu.
   2. Edit the copy.
   3. The user reviews it and swaps it in. Write them the steps: rename slugs, re-link
      the navigation, and check any forms, which may need reconnecting.
3. **Blog posts** have real drafts and scheduling, so use them.

In the editor, keep to text edits: click a text block, select, type. Moving or resizing
blocks on the Fluid Engine grid is fragile. Never press Save on the live page.

## Faster options for later

None. Squarespace has no API for pages or content: its developer APIs cover commerce
(products, orders, inventory) only, and its MCP server covers domains only. An
unofficial tool drives Squarespace's private save API with session cookies; don't use
it. It is unsupported and publishes live.
