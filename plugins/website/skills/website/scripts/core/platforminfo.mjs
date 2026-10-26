// What a platform reveals about itself in a public page: ids, theme, version — and
// from those, direct links into the admin for the apply step.
//
// The link patterns are the platforms' standard ones but have not been checked on a
// real admin yet, so every link is reported with `verified: false`. The first person to
// open one records whether it worked (platform checklist questions WP-2, SH-2, SQ-3),
// and the pattern gets fixed here if not.

const jsonAfter = (html, marker) => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  // Walk to the matching brace, respecting strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length && i < start + 2_000_000; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
};

const bodyClasses = (html) => (html.match(/<body[^>]*\sclass=["']([^"']*)["']/i)?.[1] ?? '').split(/\s+/);

// ------------------------------------------------------------------ site

/** Facts about the whole site, read from one page (usually the homepage). */
export function siteInfo(html, platform) {
  if (platform === 'shopify') {
    const theme = jsonAfter(html, 'Shopify.theme');
    const store = html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    return {
      store,
      storeHandle: store?.replace(/\.myshopify\.com$/, '') ?? null,
      theme: theme ? { name: theme.name, id: theme.id, schema: theme.schema_name, version: theme.schema_version, role: theme.role } : null,
      headless: !/shopify-section-/.test(html),
    };
  }
  if (platform === 'squarespace') {
    const ctx = jsonAfter(html, 'Static.SQUARESPACE_CONTEXT');
    return {
      version: ctx?.templateVersion ?? (/data-section-id|data-sqsp-section/.test(html) ? '7.1' : null),
      websiteId: ctx?.website?.id ?? null,
      fluidEngine: /data-sqsp-section=["']fluid-engine/.test(html) || /fluid-engine/.test(html),
    };
  }
  if (platform === 'wordpress') {
    const classes = bodyClasses(html);
    return {
      theme: classes.find((c) => c.startsWith('wp-theme-'))?.slice(9) ?? null,
      childTheme: classes.find((c) => c.startsWith('wp-child-theme-'))?.slice(15) ?? null,
      builder: /data-elementor-type/.test(html) ? 'elementor'
        : /et_pb_/.test(html) ? 'divi'
        : /\bvc_row\b/.test(html) ? 'wpbakery'
        : /brxe-/.test(html) ? 'bricks'
        : /wp-block-/.test(html) ? 'block editor' : 'classic',
      blockTheme: /wp-site-blocks/.test(html),
      wordpressCom: /generator[^>]+WordPress\.com/i.test(html),
    };
  }
  return null;
}

// ------------------------------------------------------------------ page

/**
 * Facts about one page: what kind of thing it is in the CMS, its id there, and links
 * into the admin. `site` is siteInfo() for the same site, when known.
 */
export function pageInfo(html, url, platform, site = null) {
  const { origin, pathname } = new URL(url);
  if (platform === 'wordpress') {
    const classes = bodyClasses(html);
    const pageId = classes.find((c) => /^page-id-\d+$/.test(c))?.slice(8);
    const postId = classes.find((c) => /^postid-\d+$/.test(c))?.slice(7);
    const id = pageId ?? postId ?? null;
    if (!id) return { type: classes.includes('home') || classes.includes('blog') ? 'listing' : null, id: null };
    const elementor = classes.includes(`elementor-page-${id}`) || /data-elementor-type=["']wp-(page|post)/.test(html);
    return {
      type: pageId ? 'page' : 'post',
      id: Number(id),
      editUrl: { url: `${origin}/wp-admin/post.php?post=${id}&action=${elementor ? 'elementor' : 'edit'}`, verified: false },
    };
  }

  if (platform === 'shopify') {
    const meta = jsonAfter(html, 'ShopifyAnalytics.meta.page') ?? jsonAfter(html, '"page":{');
    const resourceType = meta?.resourceType ?? html.match(/"resourceType":"([^"]+)"/)?.[1] ?? null;
    const resourceId = meta?.resourceId ?? html.match(/"resourceId":(\d+)/)?.[1] ?? null;
    const pageType = meta?.pageType ?? html.match(/"pageType":"([^"]+)"/)?.[1] ?? null;
    const handle = site?.storeHandle;
    const admin = handle ? `https://admin.shopify.com/store/${handle}` : null;
    const ADMIN_PATH = { page: 'pages', product: 'products', collection: 'collections', blog: 'blogs', article: 'articles' };
    return {
      type: pageType === 'index' ? 'homepage' : resourceType ?? pageType,
      id: resourceId ? Number(resourceId) : null,
      editUrl: admin && resourceId && ADMIN_PATH[resourceType]
        ? { url: `${admin}/${ADMIN_PATH[resourceType]}/${resourceId}`, verified: false }
        : null,
      themeEditorUrl: admin && site?.theme?.id
        ? { url: `${admin}/themes/${site.theme.id}/editor?previewPath=${encodeURIComponent(pathname)}`, verified: false }
        : null,
    };
  }

  if (platform === 'squarespace') {
    const ctx = jsonAfter(html, 'Static.SQUARESPACE_CONTEXT');
    const collection = ctx?.collection ?? null;
    return {
      type: ctx?.item ? 'item' : collection?.typeName ?? (collection ? 'page' : null),
      id: ctx?.item?.id ?? collection?.id ?? null,
      collectionId: collection?.id ?? null,
      editUrl: { url: `${origin}/config/pages`, verified: false },
    };
  }

  return null;
}
