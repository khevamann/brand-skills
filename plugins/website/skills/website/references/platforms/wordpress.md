# WordPress

> **Reading is scripted; applying is not.** `site export`, `audit`, `page`, `blocks`,
> `design-system`, `brief`, `diff` and `scope` read the public WordPress site from the
> outside. Drafts and anything behind a login are done in the browser using this
> guide. The admin steps were researched 2026-10-25 and are unverified on a real
> site: treat each one as a hypothesis, and record what actually happens in the
> project's `admin-guide.md` and `learnings.md`.

## First, find out which editor the site uses

Most of what follows depends on it. Look at the page source, or open a page in the
admin and see which editor appears:

| Editor | How to tell | Share of WordPress sites (2026) |
|---|---|---|
| Elementor | `elementor-` classes; "Edit with Elementor" button | ~33% |
| Block editor (Gutenberg) | `wp-block-` classes; the default editor | ~21% |
| WPBakery | `vc_row` classes | ~9% |
| Divi | `et_pb_` classes | ~6% |
| Bricks, Beaver Builder | `brxe-`, `fl-builder` | small |

Record it in `SITE.md` ("WordPress, Elementor"). Block themes (the Site Editor) also
matter: look for `wp-site-blocks` in the source.

## Reading (no login needed)

The scripts do this. They split pages by Gutenberg block (`wp-block-*`), by Elementor
container (old `container`/`section` and Elementor 4's `e-div-block`/`e-flexbox`), and
make one block per post on blog listings. Header, footer and anything repeated on most
pages count as site layout. What they rely on, for when something looks wrong:

- Page and post list: `<site>/wp-json/wp/v2/pages?per_page=100` and `/posts`. Public
  for published content; returns rendered HTML only, not the block structure. Security
  plugins often switch it off; then use `<site>/wp-sitemap.xml` (or Yoast's
  `sitemap_index.xml`) and read pages directly.
- Design tokens are often in the page source as CSS custom properties:
  `--wp--preset--color--*`, `--wp--preset--font-size--*` (block themes), and
  `--e-global-color-*`, `--e-global-typography-*` (Elementor).
- Caching plugins and CDNs can serve stale pages. If something looks out of date,
  compare with the admin.

## Reading (logged in)

With the user logged in to the admin in the browser, the same REST API returns
much more when called from that browser tab with `?context=edit`: the raw block markup,
synced patterns, template parts and global styles **(unverified)**.

## Always ask first — these change more than one page

- **Synced patterns** (formerly "reusable blocks"). They look like ordinary page
  content but appear everywhere they are used. Copy that appears word-for-word on
  several pages is the tell.
- **Template parts and templates** — header, footer, and Site Editor templates.
- **Menus, widgets, Customizer settings.**
- **Global styles / theme.json**, and Elementor's **Site Settings** (global colours
  and fonts).
- **Elementor global widgets and Theme Builder templates**, **Divi Theme Builder and
  global modules**.
- Any presentation setting (colour, alignment, size), and any block type the site does
  not already use.

## Applying a change — the dangerous part

**WordPress has no draft of a page that is already published.** On a published page the
button says **Update**, and pressing it makes the change live immediately. Never press
Update or Publish. Options, safest first:

1. **If the site has the Yoast Duplicate Post plugin**, use **Rewrite & Republish** on
   the page. That makes a linked draft copy. Edit the copy, save it as a draft, and stop.
   The user reviews it and presses Republish.
2. **Otherwise, make a new draft page** holding the edited content. Name it clearly,
   e.g. "DRAFT — About us (edits 2026-10-25)", and save it as a draft. The user reviews
   it and copies the changes over, or swaps it in.
3. **For a small text fix the user has approved**, edit in place and leave it
   **unsaved** for the user to check and press Update themselves.

Editor notes **(unverified)**:

- **Block editor.** Clicking into a block and typing is the safest way to make a copy
  edit. The Code editor view (Options menu → Code editor) takes pasted block markup,
  but invalid markup breaks the block ("This block contains unexpected or invalid
  content").
- **Elementor.** Edit text in the left panel, one widget at a time. Avoid dragging.

Before editing, save the page's current HTML to `snapshots/`.

## Faster options for later (advanced)

- **WordPress.com and Jetpack-connected sites:** the official WordPress.com connector
  for Claude can create drafts directly. Edits to a published page made through it go
  live, so only ever create new drafts.
- **Other sites:** an Application Password, approved by the user on a one-click screen
  at `wp-admin/authorize-application.php`, allows reading raw content and creating
  drafts over the REST API.

Neither is built into this skill yet.

## First-time checklist

Questions only a real, logged-in site can answer. Nobody had one to test on, so the
first project on WordPress answers them, in the order a real session reaches them. Work
through them with the user as the work goes; never hand over this list. Answer what
you can see for yourself with `site finding <ID> "<answer>"`, saying how you know: the
label you saw, the URL that opened, what happened after a click. Questions marked
_(ask the user)_ need the person: ask each one in plain words, one at a time, when it
comes up. Record anything else you learn about WordPress in general with
`site finding new "<text>"`. Never go looking for trouble to answer a question, and stop
at the first surprise.

### Logging in

- **WP-1** — _(ask the user)_ How did they log in: the login address, 2FA or a WordPress.com sign-in? (Later, note how long the login lasted.)

### Opening a page

- **WP-2** — Does the edit link `site page` shows (`wp-admin/post.php?post=<id>&action=edit`, or `&action=elementor`) open that page’s editor?
- **WP-3** — Which editor opened: the block editor, Elementor, the classic editor, another builder? Does it match the `builder` the scripts detected?
- **WP-4** — Logged in, does `/wp-json/wp/v2/pages/<id>?context=edit` opened in the browser show the raw block markup?

### Making a draft

- **WP-5** — Is there a way to draft changes to a published page — "Rewrite & Republish" (Yoast Duplicate Post), PublishPress Revisions, or nothing? Exact label and where it is.
- **WP-6** — On a published page, which buttons appear (Update, Save draft, Switch to draft, Publish)? Which one makes changes live?

### Editing

- **WP-7** — Block editor: can the browser tool click into a block and type? Is the page canvas inside an iframe?
- **WP-8** — What happens to pasted text in a paragraph block: is formatting kept, cleaned, or stripped?
- **WP-9** — Elementor: is text edited in the left panel or on the page, and does the editor load reliably in the browser?
- **WP-10** — Are synced patterns and template parts marked in the editor, so they can be told apart from the page’s own content?
