# Any other site

For sites not on Craft, WordPress, Shopify or Squarespace: Wix, Webflow, Drupal, Ghost,
HubSpot, a custom build, or anything unrecognised. Detection names the platform where it
can. Record that name in `SITE.md`, and check the platform's own help pages for how
drafts work before touching anything.

> **No generic scripts yet.** Everything here is done in the app browser and recorded in
> the project folder. A scripted generic reader is planned.

## Reading from the outside (no login needed)

1. **Find the pages.** Check `<site>/robots.txt` for `Sitemap:` lines, then try
   `<site>/sitemap.xml`. With no sitemap, follow links from the homepage. Read politely:
   one page at a time, and ask before going past about 200 pages.
2. **Take the main content** of each page: the `<main>` element if there is one. Save
   pages to `export/` as you go, with a short `export/index.md` listing them.
3. **Audit** the same things as on Craft: placeholder copy (lorem ipsum, "your text
   here", template sample names), empty sections, broken links. Save the report to
   `audits/<date>.md`.
4. **Find what is shared.** A block of content that appears on most pages is site-wide
   (header, footer, navigation). One that appears on a few pages is shared between
   those pages: list them. From the outside you can't tell a single shared component
   from text pasted into each page, so treat any repeat as shared and ask.
5. **Design system.** Collect the CSS custom properties (`--…`) from the page source and
   stylesheets, plus the colours, fonts and sizes used most. Write
   `design/DESIGN-SYSTEM.md` and save a representative page as
   `design/style-guide.html`. Then follow `references/design-handoff.md`.

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
