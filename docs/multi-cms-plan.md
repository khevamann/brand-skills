# Multi-CMS plan: Craft, WordPress, Shopify, Squarespace, and everything else

Research done 2026-10-25. Claims marked **(unverified)** came from third-party sources
or inference and need checking against a live site before code depends on them.

## The goal

The users aren't developers, but they know their own site. They work in **Claude
Desktop**, one folder per website project. They say "I'm working on example.com". The
skill then:

1. works out what the site runs on;
2. runs the same three flows as today, using the best tools for that platform:
   - **read and audit**: export, placeholders, broken links, repeated copy;
   - **design round trip**: design system, vocabulary, brief for Claude Design, diff, scope gate;
   - **apply as a draft**: through the admin in Claude Desktop's built-in browser, so a human publishes.

On any platform other than the four, the same flows still run. A generic adapter reads
the site from the outside, learns the admin by exploring it, and writes down what it
learned.

APIs and MCP servers are an optional speed-up for each platform. No flow depends on them.

---

## 1. What carries over from today's code

Most of the hard thinking is already platform-neutral; the Craft-specific part is thin.

| Today | Platform-neutral? | Becomes |
|---|---|---|
| `audit.mjs`: placeholders, empty blocks, duplicate copy, broken links | Yes, apart from the `ds_` regex and "Digistorm" pattern | core, with per-adapter "dynamic block" and placeholder lists |
| `fields.mjs`: copy vs presentation from value spread across the site | Yes | core. Shopify and Squarespace also declare the field kind, which beats inference |
| `designsystem.mjs`: CSS custom properties and classes from HTML | Yes | core, plus a known token-prefix map per adapter |
| `scope.mjs`: verdicts, manifest concerns, exit codes | Yes | core. Adapters supply "who else uses this?" |
| manifest `{pageId, edits, newBlocks, unmapped}` | Nearly: `blockId` assumes stable ids | core, with an adapter-defined `ref` (§3) |
| `client.mjs`, `introspect.mjs`, `page.mjs`, `grammar.mjs`, `guard.mjs` | No, Craft GraphQL | `adapters/craft/` |
| Hard-coded Kirby endpoint, `this-site.md` | No | per-site workspace (§5) |
| `references/learnings.md` inside the plugin | **Broken for users:** plugin dirs are replaced on update | per-site `learnings.md` in the workspace (§5) |

## 2. Detection

Fetch the homepage once (final URL, headers, cookies, HTML), then send at most about four
probes. Score each platform. Write our own rule table: webappanalyzer, the Wappalyzer fork,
is GPL-3.0, so don't copy its rules in.

| Platform | Strong signals | Confirming probe |
|---|---|---|
| Craft | `X-Powered-By: Craft CMS`, `CRAFT_CSRF_TOKEN` / `CraftSessionId` cookie | `POST {__typename}` to `/actions/graphql/api`, `/admin/actions/graphql/api`, `/api` |
| WordPress | `Link: <…/wp-json/>; rel="https://api.w.org/"`, `/wp-content/`, generator meta | `GET /wp-json/` |
| Shopify | `cdn.shopify.com`, `Shopify.theme` JS object, `x-shopid`, `_shopify_y` cookie | `GET /products.json`, `/sitemap.xml` |
| Squarespace | `Static.SQUARESPACE_CONTEXT`, `static1.squarespace.com`, `server: Squarespace` | `GET /?format=json-pretty` |
| Named only (generic path) | Wix, Webflow, Drupal, Ghost, HubSpot, Framer generator/header markers | none |

**Headless sites.** Kirby is one: a Nuxt front end, with the CMS on
`*.cms.digistormhosting.com.au`. Signs of a headless site:

- framework markers (`__NUXT__`, `__NEXT_DATA__`) with no CMS signal;
- asset or image hosts that differ from the page host;
- `cms.` host variants.

Probe those hosts as well, and record `{frontHost, cmsHost}`. Shopify Hydrogen means
there are no `shopify-section-*` wrappers and the theme editor does nothing. Say so,
and fall back to generic for the page layer.

**When detection isn't confident, ask, with choices:**

> Which platform is this site built on?
> WordPress · Shopify · Craft CMS · Squarespace · Other / not sure

Users know their own platform, so a direct multiple-choice question beats trying to
infer it from clues. Ask the same question to confirm a confident detection when it
matters, for example before the first apply. Only on "not sure" fall back to "what do you
see in the left-hand menu when you log in?":

| What they see | Platform |
|---|---|
| Posts / Pages / Plugins | WordPress |
| Entries | Craft |
| Products / Orders | Shopify |
| Pages / Website | Squarespace |

Once the browser is logged in, the admin page itself is the best evidence. Whatever is
decided goes into `SITE.md` (§5), so no later session asks again.

## 3. The shared model and the adapter contract

```
Page  { ref, url, title, status, template?, blocks: [Block] }
Block { ref, type, fields: { name: { value, kind: copy|presentation|reference|code } },
        shared?: { kind, usedBy: [pageRef] }, children: [Block] }
```

Not every platform has a stable block id, so **`ref` belongs to the adapter**:

| Platform | Block ref |
|---|---|
| Craft | the entry id (stable, as today) |
| WordPress | structural path + text hash (core blocks have no ids) |
| Shopify | `template file` + section key + block index + type + current text, re-resolved at apply time |
| Squarespace | `data-section-id` / `block-…` id |
| Generic | CSS path + text hash |

Every adapter implements:

| Method | Purpose |
|---|---|
| `probe(host)` → `{confidence, evidence, cmsHost}` | detection |
| `capabilities` → `{publicRead, drafts, stableIds, applyVia}` | what to promise the user |
| `listPages()`, `readPage(ref)`, `export(dir)` | flow 1 |
| `vocabulary()`, `designSources()` | flow 2 (vocabulary is `null` for generic) |
| `sharedUsage(ref)` → affected pages | the scope gate's data source |
| `scopeRules` | platform-specific "always ask first" list (§4) |
| `applyGuide` | path to `references/platforms/<p>-apply.md`; the project's `admin-guide.md` overrides it |
| `verifyApplied(ref)` | an outside check that a draft exists |

**The Claude Design handoff becomes the same on every platform.** The returned standalone
HTML must carry `data-ck-ref` / `data-ck-field` on every editable element. `diff` then
reads edits straight from the HTML, and the manifest is something we check rather than
something we trust. `unmapped` stays.

Context on Claude Design:

- It cannot import a design system from a URL.
- `/design-sync` expects React components.
- So our upload package stays as it is: `DESIGN-SYSTEM.md`, `tokens.css`,
  `style-guide.html` and `brief.md`.
- Its standalone-HTML export is the return format.

## 4. Per-platform findings

### Craft CMS: move to an adapter, keep the behaviour

- **Code:** today's GraphQL code moves into an adapter unchanged, and the endpoint comes
  from detection instead of `client.mjs:9`.
- **Public schema:** the GraphQL schema is only public if the site enables it. When it
  doesn't, Tier 0 falls back to the generic HTML read. Kirby having it on is luck, not
  something to assume.
- **Drafts:** native, so Craft is the easiest apply.

### WordPress: Elementor support is required, not optional

WordPress has the most demand, and the most variation inside one platform.

**Builders change everything.** Share of WordPress homepages, HTTP Archive, April 2026:

| Builder | Share |
|---|---|
| Elementor | 32.7% |
| Block editor (Gutenberg) | 20.6% |
| WPBakery | 8.5% |
| Divi | 5.7% |
| Bricks | 0.3% |

Detect the builder alongside the platform:

| Builder | Markers |
|---|---|
| Gutenberg | `wp-block-*` |
| Elementor | `elementor-kit-N`, `data-widget_type` |
| Divi | `et_pb_*` |
| WPBakery | `vc_row` |
| Bricks | `brxe-` |

Treat the builder as a sub-adapter.

**Read, Tier 0:**

- `GET /wp-json/wp/v2/pages|posts?per_page=100` is public and returns `content.rendered`.
- Raw block markup (`content.raw`) and the block-type list need a login.
- Security plugins often block REST. Fall back to `wp-sitemap.xml` and crawl the HTML.

**Read, logged in:** the same REST endpoints with `context=edit` work through the user's
browser session. That gives raw blocks, synced patterns, template parts and global styles
with no token. This is the big upgrade over Tier 0.

**Design system:**

| Source | Tokens |
|---|---|
| Block themes (public) | `--wp--preset--{color,font-size,spacing}--*` |
| Elementor kit | `--e-global-color-*`, `--e-global-typography-*` |
| Classic themes | no tokens: count colours and fonts |

**Always ask first** before editing any of these:

- synced patterns (`core/block` refs), template parts, templates
- navigation, widgets
- global styles / `theme.json`, Elementor kit
- Elementor/Divi global widgets, theme-builder templates
- Customizer settings

Synced patterns render inline and look like page copy, so the "copy repeated on other
pages" check is the backstop.

**Drafts: there is no draft of a published page in core**, and Update goes live.
Options, in order:

1. If Yoast Duplicate Post is installed, use **Rewrite & Republish** and stop before
   Republish.
2. Otherwise, create a new draft page holding the edited content, and the human swaps it
   in.
3. Small text edits in place, stopping before Update.

The Gutenberg Code editor accepts pasted block markup, which is deterministic but fails
on malformed markup. Elementor's editor is the hardest to automate, so keep it to
text-only edits.

**Tier 2:**

- WordPress.com and Jetpack sites: the official **WordPress.com Claude connector**
  (OAuth). It creates drafts, but edits to a live page publish immediately, so the skill
  must create new drafts only.
- Other sites: an **Application Password** through the one-click
  `authorize-application.php` approve screen, then REST draft writes.
- The core MCP Adapter is still a pre-1.0 plugin.

### Shopify: the theme makes "one page" a trap

- **Read, Tier 0:**
  - `sitemap.xml` is the page list.
  - Page HTML splits mechanically on `shopify-section-template--<id>__<key>` wrappers, as
    Craft's `<section id>` does.
  - The tokenless Storefront API returns clean page, article and product body HTML.
  - Theme JSON (templates, settings, schemas) is **not** public.
  - Block ids show only inside the theme editor.
- **Read, logged in:**
  - The theme editor's sidebar tree and `data-shopify-editor-block` attributes give the
    block map **(unverified)**.
  - The code editor in the admin shows `templates/*.json`.
- **Vocabulary:** Shopify declares setting types, so copy vs presentation is exact
  rather than inferred:

  | Kind | Setting types |
  |---|---|
  | Copy | `text`, `richtext`, `inline_richtext`, `textarea`, `html` |
  | Presentation | `color*`, `range`, `select`, `checkbox`, `font_picker` |
  | Reference | `product`, `collection`, `metaobject`, `link_list`, `url`, `image_picker` |

- **Design system:** inline `:root` variables. Dawn uses `--color-button`; Horizon, the
  default theme since 2025, uses names like `--font-body--family` and `--gap-md`. Colour
  schemes become `.color-scheme-N` classes on sections.
- **Scope rules: the strictest of the four.**
  - A section setting in `templates/page.json` changes **every page using that
    template**. `product.json` changes every product.
  - Header and footer groups, theme settings and colour schemes are global.
  - So are metaobjects, menus and `locales/*.json`.
  - A setting bound to a metafield writes the metafield.
  - App blocks and page builders (PageFly, GemPages) are not ours to edit.
  - Exit 0 only for:
    - a resource field (page body, product description), keeping in mind that product
      text also shows on collection cards;
    - `index.json`;
    - a brand-new alternate template.
- **Draft apply, Tier 1:**
  - **A section change confined to one page:** in the live theme, use
    "Create template → based on page.json", which is assigned to nothing. Edit it,
    preview it with `?view=<suffix>`, and the human assigns it to the page; that is the
    publish step.
  - **Global changes:** use a duplicated theme with a preview link. Warn that edits made
    to the live theme afterwards are lost when the copy is published. The limit is
    20 themes.
  - **Resource copy:** saving publishes immediately, so use a hidden duplicate or stop
    before Save.
- **Tier 2:**
  - **Shopify CLI** (`theme pull` / `theme push --unpublished` / `theme share`,
    browser login, no tokens) gives exact schemas and true draft themes.
  - The **official Shopify Claude connector** or `shopify store execute` handles
    resource content.
  - Avoid the alternatives:
    - **pasted Admin API tokens:** new legacy custom apps are blocked from 2026-01-01;
    - **`themeFilesUpsert`:** needs a Shopify exemption.
- **Never touch:** prices, variants, inventory, markets or translations without asking.

### Squarespace: the cleanest read, and no API at all

- **Read, Tier 0:**
  - `sitemap.xml`, then `?format=json` on every URL (page metadata, plus full item bodies
    for blog, events and other collections), then the rendered HTML.
  - **On 7.1 pages the section content is only in the HTML.**
  - Parse the official Custom Code Spec attributes `data-sqsp-section` and
    `data-sqsp-block`, which are stable, plus `data-section-id`.
  - Handle both the pre-July-2026 DOM (`#sections`) and the new one
    (`.page-regions > section.region`).
- **Design system:**
  - Source: `/site.css?minify=false`.
  - Palette: five colours as `--accent-hsl` and the like.
  - Section themes: ten `[data-section-theme=…]` blocks.
  - Custom CSS: the user's own sits after the LESS-compiler marker.
  - Tell Claude Design those are the only legal colour choices.
- **Vocabulary:** the official block list (text, button, image, gallery, accordion,
  code, …). There are no linked sections, because saved sections are copies, so repeated
  copy really is duplicated.
- **Always ask first** before editing any of these:
  - header/footer, Site Styles, palette or theme definitions
  - Custom CSS, code injection, code/embed blocks
  - navigation, titles, slugs
  - summary blocks, which show other pages' content
  - forms
  - announcement bar or popup
- **Draft apply:**
  - Page drafts exist ("Create draft" → "Publish and replace") but **only on Premium and
    Enterprise plans**, and they cannot touch the header, footer or styles.
  - Everyone else: Duplicate Page, which lands in Not Linked. Edit the copy and the owner
    swaps it in. This is clunky: slugs and form storage need care.
  - Blog posts have native drafts.
  - **There is no version history**, so the adapter must snapshot the HTML and JSON
    before any edit.
  - Suggest the owner invites a **Website editor** contributor: it can edit content but
    not styles.
- **Tier 2:**
  - None for content. The official APIs cover commerce only, and the official MCP covers
    domains only.
  - An unofficial MCP uses the private save API with session cookies. Don't ship it.

### Generic: any other site

- **Read:**
  1. Find pages from `robots.txt`, then the sitemap, then a polite breadth-first crawl
     (about one request a second, capped near 200 pages).
  2. Take the main content from `<main>`, or by text-density scoring.
- **Blast radius from the outside:** fingerprint every block subtree across pages.

  | Found on | Means |
  |---|---|
  | ≥80% of pages | site chrome |
  | 2…N pages | shared, so name the pages |
  | 1 page | local |

  The generic path can't tell a CMS global from pasted duplicates, so any repeat asks.
- **Design system:** the existing token extraction, plus counting colours, fonts and
  sizes in linked CSS. Optionally:
  - computed styles from Playwright;
  - **dembrandt** (MIT; crawl, DTCG tokens, its own MCP), called through `npx`
    rather than vendored.
- **Learning the admin:** the agent explores in the app browser, then writes
  `admin-guide.md` in the project folder with:
  - the admin URL and URL patterns;
  - how to open the editor;
  - how drafts, preview and publish work;
  - exact labels;
  - whether block ids are visible;
  - how rich text treats pasted HTML;
  - a "never click" list.

  Each fact is dated or marked unverified. The next session reads it first and corrects
  it. This is today's `browser-apply.md` discipline, made per-site and self-writing. The
  four named platforms also use it, to override their bundled apply guides with what this
  particular site actually does.

## 5. The project folder is the memory

**One folder per website project.** It holds everything the skill produces: the export,
audits, design-system files, briefs, snapshots, and what was learned. Opening a **new
session in the same folder** picks up where the last one left off, so nobody needs to
keep a long session alive.

```
<project folder>/
  SITE.md          # overview + notes. Read first, every session.
  site.json        # machine-readable: {url, frontHost, cmsHost, platform, builder,
                   #   confirmedBy, adminUrl, plan, lastExport, lastAudit}
  learnings.md     # dated run log: what worked, what broke, next time
  admin-guide.md   # how THIS site's admin actually behaves (self-written, see §4)
  export/          # site corpus
  audits/          # audit reports, dated
  design/          # DESIGN-SYSTEM.md, tokens.css, style-guide.html, briefs, results
  snapshots/       # pre-edit HTML/JSON (essential for Squarespace)
  CLAUDE.md        # a short marked block pointing at SITE.md (see below)
```

**`SITE.md`** is the overview, written for a person as much as for Claude:

- **What this site is:** URL, platform (e.g. "Shopify, Horizon theme"), how that was
  determined, the admin address, and the plan where it matters (Squarespace drafts,
  Shopify theme limit).
- **What we can do here:** which flows work and at which tier. Example: "reading works
  without logging in; applying needs you logged in to the admin in the app browser".
- **Current state:** last export, last audit with its headline numbers, any design
  round trip in progress and which step it is on.
- **Notes:** project memory, dated bullets. Examples:
  - "Pre-footer is shared by 6 pages — always ask."
  - "Owner wants copy fixes and design changes kept separate."
  - "Don't touch the Admissions page until the board signs off."

  The skill appends here whenever it learns something about the site or the people
  that a future session would need.

**Making a new session find it.** The skill writes a small marked block into the
folder's `CLAUDE.md`, saying "this folder is a website project; read `SITE.md` first".
Claude Desktop loads `CLAUDE.md` automatically, so a new session gets the context even
before the skill triggers. Append only inside the marked block, and never overwrite a
`CLAUDE.md` the user already has.

**Rules for the notes:**

- Date every entry.
- Mark anything not yet checked as unverified.
- Correct or delete stale entries instead of piling up contradictions.
- Keep `SITE.md` short (under ~200 lines): details go to `learnings.md` and
  `admin-guide.md`.
- **Never write passwords, cookies or tokens.**

**The plugin folder is never written to at runtime.** It is a versioned cache, replaced
on every update, which is why today's in-plugin `learnings.md` doesn't work for users.
It holds only code and the bundled per-platform guides.

## 6. Tiers

| Tier | Needs from the user | Gives |
|---|---|---|
| **0: outside** | a URL | detection, export, audit, design system, brief, scope (with a coarser blast radius) |
| **1: browser** | log in to the admin once, in Claude Desktop's built-in browser | richer reads (WP `context=edit`, Shopify editor tree), **apply as draft**, a self-written `admin-guide.md` |
| **2: connected** | approve one connector/CLI login | faster, deterministic reads and draft writes. WP.com connector or Application Password; Shopify CLI + connector; nothing for Squarespace |

Tier 2 ships as **separate optional plugins** that depend on the core, so that their
MCP servers load only when installed. For example: `castle-keys-shopify`,
`castle-keys-wordpress`.

The read-only contract holds at every tier. **Nothing is ever published.** Every apply
path ends at a draft, preview or unassigned template, and the human makes the change
live.

## 7. Where users run this: Claude Desktop and its built-in browser

- **The target:** Claude Desktop, with a project folder open, using the app's
  **built-in browser** for anything that needs a login.
  - No terminal.
  - Scripts get normal local network access.
  - The user types their own password and 2FA into the app browser, so Claude never
    handles credentials.
- **How login works:** the built-in browser keeps its own cookie store, separate from
  the user's everyday Chrome. So:
  - the first time, the user logs in to their admin inside the app browser;
  - in Cowork it can import cookies for a site from the user's browser instead
    **(unverified in the Code tab)**;
  - how long a login lasts between sessions is **unverified**. If it lapses, the skill
    pauses and asks the user to log in again, and notes that in `learnings.md`.
- **Fallback:** Claude in Chrome, when someone would rather use their everyday browser.
  The bundled apply guides should be written so they work in either browser.
- **Not supported:**
  - **claude.ai chat:** its sandbox can't reach the site.
  - **Computer use:** browsers are view-only under it.
- **Packaging constraint:** don't add a top-level `bin/` to the plugin. Chat and Cowork
  refuse plugins that have one.

## 8. Packaging

**One plugin, one router skill, a shared core, and adapters.** Users say "my website",
not "my Shopify". Per-platform skills would have near-identical trigger descriptions and
compete with each other.

```
plugins/website/
  skills/website/
    SKILL.md                 router: detect → load platform guide → three flows (<500 lines)
    references/
      project-folder.md, design-handoff.md
      platforms/craft.md, craft-apply.md, craft-graphql-api.md,
                wordpress.md, shopify.md, squarespace.md, other.md
    scripts/
      site.mjs               one CLI: detect, overview, export, audit, design-system,
                             brief, diff, scope, …  (dispatches to the adapter)
      core/                  cli, detect, project, audit, fields, designsystem, scope
      adapters/craft/        (wordpress/ shopify/ squarespace/ generic/ to come)
plugins/castle-keys-shopify/             optional Tier 2: .mcp.json + guide
plugins/castle-keys-wordpress/           optional Tier 2
```

- Keep the description under 1,024 characters, with the trigger words first: website,
  page, CMS, the URL, and the platform names.
- No `craft` alias was kept: the `site` CLI replaced it outright (see step 1).

## 9. Suggested order of work

1. **Core refactor at Craft parity. Done 2026-10-25.** Verified live against the Kirby
   site: detection found its headless Craft API at `/api`; export, audit, page, brief,
   design-system and scope all ran from a project folder. The plain-text `page` view,
   which had been crashing, was fixed on the way.
   - Extract the core.
   - Make Craft an adapter.
   - Add `detect` (with the multiple-choice question as its fallback) and the project
     folder: `SITE.md`, `site.json`, `learnings.md`, the `CLAUDE.md` pointer, and a
     "resume" step at the start of every session.
   - Remove the Kirby hard-coding.
   - The existing tests must still pass. Port the read-only guard tests first.
2. **Generic adapter. Done 2026-10-26.** It now serves WordPress, Shopify, Squarespace,
   anything else, and Craft sites without a public schema. It includes the platform
   hints from steps 3–5's read paths: Shopify section ids, Squarespace section and
   block attributes, Gutenberg blocks, Elementor containers (including Elementor 4's).
   It also adds:
   - cross-page sharing detection and layout detection;
   - Shopify's template and section-group scope rules;
   - Squarespace summary and code-block rules;
   - WordPress synced-pattern, template-part and global-widget rules.

   Verified live on a WordPress block-editor blog, an Elementor site, a Shopify store, a
   Squarespace site, a Webflow site, and the Kirby Craft front end without its API.
   What steps 3–5 still add is mainly reading through each platform's own data (WP REST
   with a login, Shopify Storefront API, Squarespace `?format=json`) and the apply paths.
3. **WordPress**, Gutenberg plus Elementor: the biggest demand, and already reported to
   half-work.
4. **Squarespace.** A small adapter with a clean read; the work is the draft-or-duplicate
   apply path.
5. **Shopify.** The most scope rules and the most Tier 2 upside. Do it last, so the scope
   gate is mature by then.
6. **Tier 2 plugins.** Shopify CLI and connector, WP.com connector and Application
   Passwords.
7. **First real apply on each platform.** Rewrite each `<p>-apply.md` from what actually
   happened. **Nothing about apply is verified on any platform yet, Craft included.**

## 10. Biggest risks

1. **Draft semantics differ, and three of the four can publish by accident:**
   - WordPress Update, and Shopify Save on a resource, both go live.
   - Squarespace has no history to roll back.

   Each apply guide must name the exact button not to press, and Squarespace needs
   snapshots.
2. **Hidden shared content:**
   - Shopify templates, WordPress synced patterns and Squarespace summary blocks can look
     like one page's copy.
   - Cross-page fingerprinting is the backstop, so every adapter runs it.
3. **No stable block ids** on WordPress and Shopify. Refs must re-resolve at apply time
   and fail loudly on a mismatch.
4. **Page builders and apps** (Elementor, PageFly, app blocks) hold content outside the
   platform's own model.
5. **Undocumented read surfaces** can change without notice:
   - Shopify `/products.json`;
   - Squarespace `?format=json`, and its July 2026 DOM change.

   Each adapter needs a live smoke test.

## Open questions for you

- Which real sites can we test against: one of each platform, and ideally a Squarespace
  site on a plan with page drafts?
- Should Tier 2 exist at all for the first release, or wait until Tier 1 apply is proven?
