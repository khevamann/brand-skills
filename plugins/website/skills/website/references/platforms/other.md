# Any other site

For sites not on Craft, WordPress, Shopify or Squarespace: Wix, Webflow, Drupal, Ghost,
HubSpot, a custom build, or anything unrecognised. Detection names the platform where it
can. Record that name in `SITE.md`, and check the platform's own help pages for how
drafts work before touching anything.

Reading is scripted, from the outside; applying happens in the app browser.

## Reading from the outside (no login needed)

The scripts do all of this:

1. **Find the pages.** `site pages` reads `robots.txt` and the sitemap, or follows links
   from the homepage when there is none. Reading is polite: one page at a time with a
   pause, and capped at 200 pages unless `--limit` says otherwise.
2. **Split each page into blocks.** `site export` takes the main content (the `<main>`
   element, or failing that the body) down to its real sections, and gives each copy
   field a name: `text_Heading1`, `text_Paragraph2`, `text_Button1`.
3. **Audit.** `site audit` reports placeholder copy, empty blocks, pages that fail to
   load, images without alt text, broken links and repeated copy.
4. **Find what is shared.** Blocks repeated on most pages are treated as site layout
   (navigation, footer); anything repeated on a few pages is named. From the outside you
   can't tell a single shared component from text pasted into each page, so
   `site scope` treats any repeat as shared and asks.
5. **Design system.** `site design-system` collects CSS custom properties from the page
   and its stylesheets, plus the colours, fonts and sizes used most.

If a page comes out badly split (for example, a site drawn entirely by JavaScript has
little in its HTML), read it in the app browser instead and note that in `SITE.md`.

If `robots.txt` blocks automated reading, the scripts stop and say so. Ask the user;
only with their confirmation that the site is theirs, re-run with `--ignore-robots`.

## Learning the admin

The first time you need the admin:

1. Ask the user to log in to the admin in the **Claude Desktop app browser**. Never ask
   for or type their password or 2FA code.
2. Explore carefully, without saving anything. Find:
   - how to reach a page's editor (URL pattern, or the clicks);
   - whether there are drafts, previews or version history, and what the publish
     button is called;
   - how text is edited, and whether pasted formatting survives;
   - what is global: header, footer, styles, reusable sections.
3. Write it all to `admin-guide.md` in the project folder, dated, with exact button
   labels and a "never click" list. Add a one-line summary to `SITE.md`.
4. Before changing anything for real, find the safest draft mechanism this platform
   has:
   - a native draft;
   - a duplicate page that is hidden or unpublished;
   - an unpublished copy of the theme;
   - **failing all of those**, an edit left unsaved for the user to check.

   Tell the user which one you will use, and why.

## Applying a change

- Snapshot the page to `snapshots/` first.
- Make the smallest edit that does the job, in a draft or copy.
- Never publish. Name the button the user should press, and leave it to them.
- Afterwards, correct `admin-guide.md` with anything that turned out differently, and
  add a `learnings.md` entry.
