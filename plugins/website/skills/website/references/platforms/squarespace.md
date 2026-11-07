# Squarespace

> **Reading is scripted; applying is not.** `site export`, `audit`, `page`, `blocks`,
> `design-system`, `brief`, `diff` and `scope` read the public Squarespace site from the
> outside. Drafts and anything behind a login are done in the browser using this
> guide. The admin steps were researched 2026-10-25. Steps marked *(seen on 1 site)*
> were confirmed on one real 7.1 site; *(seen on 2 sites)* on two, in 2026-10 and
> 2026-11. The rest are still unverified. Treat
> unmarked steps as a hypothesis, and record what actually happens in the project's
> `admin-guide.md` and `learnings.md`.

**Saving is publishing.** The editor has no separate publish button: **Save** makes the
change live for visitors at once. Squarespace has no version history either, so once a
change is saved, the old version is gone. Always snapshot a page before touching it, and
never press Save on a live page without the user's go-ahead for that change.

## Before anything else

- **Version 7.1 or 7.0?** 7.1 pages are built from sections: the page source has
  `data-section-id` or `data-sqsp-section` attributes. 7.0 has no page sections and uses
  per-template layouts. Most sites are 7.1. Record it in `SITE.md`.
- **Which plan?** Page drafts exist only on some plans (see "Applying a change"). Ask
  the user or check Settings → Billing, and record it.
- **Suggest a contributor login.** The owner can invite a "Website editor" contributor,
  who can edit content on existing pages but not styles.
- **The admin is on its own address.** `<site>/config` redirects to
  `<random-name>.squarespace.com/config` *(seen on 2 sites)*, and the browser asks the
  user to allow that address separately from the public site *(seen on 1 site)*.
- **If the bare domain fails, try `www.`** One site's bare domain had no certificate
  (`ERR_CERT_COMMON_NAME_INVALID`) while `www.` worked *(seen on 1 site)*. Use the
  address that works, and add the certificate problem to the to-do list.

## Reading (no login needed)

The scripts do this: each page section is a block, its ref the section id, with the
Squarespace block types inside it listed as parts. `site design-system` reads
`site.css`, including the ten section themes. What they rely on, for when something
looks wrong:

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

## Never press — these delete or send *(seen on 1 site)*

- **The checkbox next to a category** in an item's Categories list selects that
  category **for deletion** (a red Delete appears). It does not assign it.
- **Email Campaigns save as you type** and have no Save button. Their only buttons are
  SEND TEST and SEND TO RECIPIENTS (with the recipient count). Never press either; the
  user sends.

## Always ask first — these change more than one page

- **Header and footer** — on every page. The editor says "Editing Site Footer · Global"
  when the footer is open *(seen on 1 site)*; saving it changes every page at once.
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

## When something looks wrong, check the settings before the page

What a page shows is often driven by a setting, not by the page's content
*(seen on 1 site)*:

- **Event and blog cards** (summary blocks) show each item's **Excerpt**, not its
  description.
- **A summary block filters by category or tag**, so an item without the category is
  missing from it. Event Settings → Options → Categories: type the name and click the
  suggestion to add it.
- **Event times are rendered on the server in the site's time zone** (Settings → Website
  → Regional Settings → Time Zone). If its rules for a region are out of date, every
  event shows an hour off while the event itself is right.

Compare the item's `?format=json` with what the page shows before editing anything.

## Applying a change

**Before editing, save the page's rendered HTML and `?format=json` output to
`snapshots/`.** There is no undo after saving.

**"Not Linked" doesn't hide a page from visitors** *(seen on 1 site)*. It only keeps the
page out of the menu: the page is still public at its URL and can stay in `sitemap.xml`.
New pages, blank or duplicated, start out enabled and public. To keep a page private,
open its Page Settings (the gear on its row in the Pages panel) → General → turn off
**Enable Page**. The editor header then says "Page · Disabled".

1. **If the plan has page drafts (7.1, higher plans; unverified which).** One site had
   no "Create draft" in Page Settings at all *(seen on 1 site)*.
   1. Pages panel → the page's gear → **Create draft**.
   2. Edit the draft and save it **as a draft**.
   3. The draft has a preview link for the user.
   4. **Never press "Publish and replace"** — that is the user's step.

   Drafts cannot change the header, footer or styles.
2. **Otherwise, work on a disabled copy:**
   1. Pages panel → gear → **Duplicate Page**. The copy lands in "Not Linked".
   2. **Before anything else, turn off Enable Page on the copy** and save. Until then
      the copy is public.
   3. Edit the copy. Saving it is safe while it is disabled.
   4. The user reviews it while logged in and swaps it in. Write them the steps: rename
      slugs, re-link the navigation, and check any forms, which may need reconnecting.

   A new design can be tried out the same way on a new blank page (Pages panel → Not
   Linked → **+** → Blank page), disabled first.
3. **Blog posts** have real drafts and scheduling, so use them.

In the editor, keep to text edits where you can. Moving or resizing blocks on the Fluid
Engine grid is fragile. Never press Save on a live page without the user's go-ahead.

## In the editor *(seen on 1 site: 7.1, Fluid Engine, 2026-10)*

- Page Settings has the tabs General, Navigation, SEO, Social Image and Advanced.
  General holds Page title, Navigation title, URL slug, QR code, **Enable Page**, a page
  lock, **Duplicate Page** and **Delete Page**.
- The toolbar has Save, Exit, undo/redo, a desktop/mobile toggle, Site Styles and a
  preview. The desktop/mobile toggle only shows when the window is at least 1280px wide.
- **The mobile layout is separate.** In Fluid Engine, moving a block in the mobile view
  doesn't touch desktop. Check both.
- **Text blocks** are a tiptap editor. Clicking a selected text block enters text
  editing, so deselect it before dragging. A paste event carrying `text/html` on the
  `.tiptap` element keeps headings, bold and links.
- **Code block** (Add Block, search "code") takes full HTML and CSS, grows to fit, and
  carries into the mobile layout. Its editor is CodeMirror 6: a paste event on
  `.cm-content` sets its content. Section-theme heading colours override h1–h3 inside
  it unless the CSS sets a colour. The trade-off: the owner can no longer edit that copy
  in the visual editor, so say so before using one for a whole design.
- Add Section → **Saved** reuses a section saved earlier. Edit Section → **Fill Screen**
  off removes the large section padding.
- Page titles get the site's title format appended (often " — SITE NAME"), so an SEO
  title shouldn't repeat the brand *(seen on 2 sites)*.
- **Collection items** (events, blog posts): Pages → the collection → hover the item →
  "…" → Settings. Event Settings has the tabs Content, Options, SEO, Social Image, Share
  and Location; SAVE and CANCEL appear top left once something changes, and saving is
  live *(seen on 1 site)*.

## Email Campaigns *(seen on 1 site, 2026-11)*

- Marketing → Campaigns. **Duplicate** on a sent campaign makes a draft copy, but the
  copy's **subject line comes back empty**; the preview text is kept.
- Text blocks are ProseMirror editors: a paste event carrying `text/html` replaces the
  content cleanly. The subject and preview are editable divs, not inputs.
- Links default to the style's **Link Color**, which can be invisible on a light
  section. Check it under Style → Email Styles.
- **Images can't be uploaded from the browser tools**: Replace opens the computer's own
  file picker. Prepare the image and ask the user to press Replace and choose it.

## Faster options for later

None. Squarespace has no API for pages or content: its developer APIs cover commerce
(products, orders, inventory) only, and its MCP server covers domains only. An
unofficial tool drives Squarespace's private save API with session cookies; don't use
it. It is unsupported and publishes live.

## First-time checklist

Questions only a real, logged-in site can answer. Nobody had one to test on, so the
first project on Squarespace answers them, in the order a real session reaches them. Work
through them with the user as the work goes; never hand over this list. Answer what
you can see for yourself with `site finding <ID> "<answer>"`, saying how you know: the
label you saw, the URL that opened, what happened after a click. Questions marked
_(ask the user)_ need the person: ask each one in plain words, one at a time, when it
comes up. Record anything else you learn about Squarespace in general with
`site finding new "<text>"`. Never go looking for trouble to answer a question, and stop
at the first surprise.

### Logging in

- **SQ-1** — _(ask the user)_ Are they the owner or a contributor (which role), and was there 2FA? (Later, note how long the login lasted.)
- **SQ-2** — _(ask the user)_ Which plan is the site on? Then check whether a page’s settings menu offers "Create draft".

### Opening a page

- **SQ-3** — Where does `<site>/config/pages` lead? Is there a direct link to one page’s editor?
- **SQ-4** — Do the section ids the scripts report (`data-section-id`) appear anywhere in the editor?

### Making a draft

- **SQ-5** — Page drafts: exact labels to create one, save it, and publish it ("Publish and replace"?), and what the preview link looks like.
- **SQ-6** — Duplicate Page: where does the copy land, what is its URL, and is it hidden from visitors?

### Editing

- **SQ-7** — In the editor, can the browser tool click into a text block and type? Is the page preview inside an iframe?
- **SQ-8** — Which colour theme names in the editor match the `theme:*` groups in the design system (white, light, dark…)?
- **SQ-10** — What does the editor offer? List the "Add Block" menu and the section templates under "Add Section", as labelled and grouped, and note anything locked to a higher plan. Close each menu without choosing; leave without saving.

### Saving

- **SQ-9** — After saving, is there any undo or history? What does Save / Exit look like?
