# Shopify

> **Reading is scripted; applying is not.** `site export`, `audit`, `page`, `blocks`,
> `design-system`, `brief`, `diff` and `scope` read the public Shopify store from the
> outside. Drafts and anything behind a login are done in the app browser using this
> guide. The admin steps were researched 2026-10-25 and are unverified on a real
> store: treat each one as a hypothesis, and record what actually happens in the
> project's `admin-guide.md` and `learnings.md`.

**Shopify's big trap: a change that looks like it is for one page usually changes many.**
Read "What is shared" before proposing anything.

## Before anything else

- **Theme:** the page source has a `Shopify.theme` object with the theme name. Record it
  in `SITE.md`. Horizon has been Shopify's default since 2025; Dawn before it.
- **Headless storefront:** no `shopify-section-` wrappers in the page and no
  `Shopify.theme` object means a custom front end. The theme editor will not change what
  visitors see. Say so, and treat the site as "other" for page content.
- **Store admin address:** `admin.shopify.com/store/<handle>`. The `<handle>.myshopify.com`
  name is often visible in the page source.
- **Never touch prices, variants, inventory, orders, markets or translations.**

## Reading (no login needed)

The scripts do this. Each theme section becomes a block whose ref is its section id
(`template--<n>__<key>`), so a scope check can tell a page's own content from template
and section-group settings, and name the other exported pages built from the same
template. What they rely on, for when something looks wrong:

- Page list: `<store>/sitemap.xml`, which links to product, collection, page and blog
  sitemaps.
- Each page's HTML splits into sections: `<div id="shopify-section-template--<n>__<key>">`
  is section `<key>` of that page's template. `shopify-section-sections--<n>__header`
  is part of a global group (header or footer).
- Clean page, article and product text is also public at `/pages/<handle>`,
  `/products/<handle>.js` and `/products.json`.
- Design tokens are CSS custom properties in the page source: on Dawn `--color-*` and
  `--font-body-family`; on Horizon `--font-body--family`, `--gap-md`,
  `--color-primary-button-background`. Colour schemes appear as `color-scheme-N` classes
  on sections.
- **Not public:** the theme's template files and section settings. Those need the
  admin.

## Where copy lives — decides how far a change reaches

| Copy is in… | Edited in | Reaches |
|---|---|---|
| A page's body, a blog post, a product or collection description | Admin → Online Store → Pages, Products… | That one item (product text also shows on collection and search cards) |
| A section or block setting in a **template** | Theme editor | **Every page using that template**: `page` = all default pages, `product` = every product |
| The header, footer, announcement bar | Theme editor (section groups) | **Every page** |
| Theme settings, colour schemes, fonts | Theme editor → Theme settings | **Everything** |
| Menus, metaobjects, metafields | Admin → Content / Navigation | Everywhere they are used |
| Theme text strings, hard-coded theme copy | Theme code (Edit default theme content / code editor) | Everywhere; needs a developer |
| App blocks, page-builder apps (PageFly, GemPages) | The app | Not ours to edit |

## Always ask first

Everything in that table except the first row, plus any setting that is presentation
(colour, scheme, spacing, alignment, font), and any section or block type the theme
does not already use. The only edits that are safe to treat as one page are:
- a single item's own text (first row);
- the homepage template (`index`), which only the homepage uses;
- a brand-new template assigned to nothing yet.

## Applying a change

Saving in Shopify publishes immediately. **Never press Save on the live theme, and never
press Publish on a theme.** Instead:

- **A section change for one page (unverified):**
  1. In the theme editor, use the template menu → **Create template**, based on the
     page's current template. The new template is assigned to nothing, so editing it
     changes nothing live.
  2. Edit it.
  3. Preview it at `/pages/<handle>?view=<template suffix>`.
  4. The user assigns the template to the page in the page's admin. That is the publish
     step, and it is theirs.
- **Theme-wide changes:** duplicate the live theme (Online Store → Themes → … →
  Duplicate) and edit the copy, then share its preview link. Warn the user that edits
  made to the live theme after the copy was taken are lost if the copy is published.
  Stores can hold 20 themes.
- **A page's or product's own text:** stage the edit and stop before Save for the user to
  review. Or create a hidden duplicate page, which is not visible to visitors.

Before editing, save the page's current HTML to `snapshots/`. Block ids in the theme
editor change, so identify blocks by section, position, type and current text, and
re-check them just before editing.

## Faster options for later (advanced)

- **Shopify CLI** (`shopify theme pull`, `shopify theme push --unpublished`): reads the
  real template files and pushes changes to an unpublished copy of the theme. Login is
  through the browser, with no token to handle.
- **The official Shopify connector for Claude**: works for store content such as pages
  and products. Reportedly it cannot edit themes **(unverified)**.
- **Avoid:**
  - **pasted Admin API tokens:** new custom apps of the old kind can't be created since
    January 2026;
  - **the theme-write API:** needs an exemption from Shopify.

Neither option is built into this skill yet.

## First-time checklist

Questions only a real, logged-in store can answer. Nobody had one to test on, so the
first project on Shopify answers them. As you reach each one in real work, record what you
saw with `site finding <ID> "<answer>"`, including how you know: the label you saw, the
URL that opened, what happened after a click. Record anything else you learn about
Shopify in general with `site finding new "<text>"`. Never go looking for trouble to
answer a question: answer it when the work takes you there, and stop at the first
surprise.

- **SH-1** — Do the admin links `site page` shows open the right place: `admin.shopify.com/store/<store>/pages/<id>` (and products, blogs, collections), and the theme editor link with `previewPath`?
- **SH-2** — In the theme editor sidebar, do section names match the section types the scripts report (`image_banner`, `rich_text`…)?
- **SH-3** — "Create template": where is it, what are its exact labels, and does a new template start as a copy of the one it is based on?
- **SH-4** — Does `/pages/<handle>?view=<template suffix>` preview a new template that is not assigned to the page yet?
- **SH-5** — Where is a template assigned to a page or product, and what is the control called?
- **SH-6** — Duplicating a theme: exact steps and labels, and can its preview link be shared with someone not logged in?
- **SH-7** — In the theme editor on the live theme, does Save publish immediately? Is any draft, schedule or rollout option visible?
- **SH-8** — Can block ids be seen in the editor (for example `data-shopify-editor-block` in the preview)?
- **SH-9** — For a page’s own content (Online Store → Pages): is there a Visible/Hidden control, and does a hidden duplicate page work as a draft?
- **SH-10** — Logging in: staff or collaborator account, 2FA, and how long did the login last?
