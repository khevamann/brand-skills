// Layout check: problems a visitor can SEE on the live site, at phone, tablet and
// desktop widths, without resizing the window. Read only: it clicks, types and
// submits nothing. Each page loads in a hidden same-origin <iframe> of each width
// (sandboxed, so the page can't navigate this tab or open popups), is scrolled
// through so lazy images load, then measured. The iframe is removed afterwards.
//
// HOW TO CALL. On a tab already open at the site's public origin, run ONE javascript
// tool call containing an options line, then this whole file:
//
//   var OPTIONS = { pages: ['/', '/about'], widths: [390, 768, 1280] };
//   <this file, unchanged>
//
// Use `var`, not `const`: a second run in the same tab would fail on `const`.
// The last expression is a Promise of the result; the tool returns it when it resolves.
// If the tool hands back {} or a pending Promise instead, run `window.__layoutCheck`
// in a second call (don't navigate the tab in between).
//
// OPTIONS, all optional:
//   pages     paths or same-origin URLs. Default: this tab's page. Two or three
//             pages per call; each takes about 3–8 s (all widths load at once).
//   widths    default [390, 768, 1280]
//   budgetMs  stop starting new pages after this long. Default 20000, so a call
//             stays under ~25 s. Pages not reached come back in `notChecked`:
//             call again with `pages: notChecked`.
//   here      true = no iframe: check this tab as it is, at the window's current
//             width (`pages` and `widths` are ignored). The fallback when a page
//             refuses to load in a frame: open it, resize the window, run with `here: true`.
//
// RETURNS { summary, counts, findings, checked, notChecked, notes }
//   findings  [{ severity: 'high'|'medium'|'low', kind, page, width, widths,
//                selector, text, detail, y }], high first. `width` is the narrowest
//                width it shows at, `widths` all of them; `y` is how far down the
//                page it is at that width (px), for scrolling to it.
//   kinds     sideways-scroll, cut-off-edge, cut-off-text, broken-image,
//             blurry-image, overlapping-text, squashed-button, tiny-text, empty-section
//   checked   [{ page, width, status, ms, note? }]; status is 'ok', or 'refused'
//             (the site won't load in a frame: use `here: true`), 'redirected',
//             'http-404' etc., 'timeout' or 'error'.
// Every finding is a lead, not a verdict: look at it in a screenshot at that width
// before telling the user.

(async (OPTIONS) => {
  const opts = OPTIONS || {};
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 20000;
  const hardStop = t0 + budget + 4000;
  const widths = opts.widths?.length ? opts.widths : [390, 768, 1280];
  const pages = opts.pages?.length ? opts.pages : [location.pathname + location.search];
  const CAP = 5; // findings per kind, per page and width
  const SEV = { high: 0, medium: 1, low: 2 };
  const KINDS = ['sideways-scroll', 'cut-off-edge', 'cut-off-text', 'broken-image', 'overlapping-text',
    'blurry-image', 'squashed-button', 'empty-section', 'tiny-text'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = (window.__layoutCheck = { status: 'running', startedAt: new Date().toISOString() });

  // ---- small helpers ------------------------------------------------------------

  const clean = (s, n = 60) => {
    s = String(s ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const shortSrc = (src) => {
    try {
      const u = new URL(src, location.href);
      return clean((u.origin === location.origin ? '' : u.host) + u.pathname, 80);
    } catch { return clean(src, 80); }
  };
  // Ids and classes that read as words, not generated hashes.
  const goodId = (id) => id && id.length <= 40 && !/yui_|\d{4,}|[0-9a-f]{8,}/i.test(id);
  const goodClass = (c) => c.length <= 30 && !/\d{3,}|[0-9a-f]{8,}|^(js|is|has)-|__[a-z0-9]{5,}$/i.test(c)
    && !(/^[A-Za-z0-9]{8,}$/.test(c) && /[A-Z]/.test(c) && /[a-z]/.test(c) && /\d|[A-Z].*[A-Z].*[A-Z]/.test(c)); // CSS-module hashes
  const label = (el) => {
    const tag = el.tagName.toLowerCase();
    if (goodId(el.id)) return `${tag}#${el.id}`;
    const cls = [...el.classList].filter(goodClass).slice(0, 2);
    return tag + cls.map((c) => '.' + c).join('');
  };
  // A short, readable selector: the element, prefixed by the nearest ancestor with a
  // real id, or else the nearest landmark (header, nav, section, footer…).
  const selectorFor = (el) => {
    const own = label(el);
    if (goodId(el.id)) return own;
    for (let a = el.parentElement, i = 0; a && i < 12; a = a.parentElement, i++) {
      if (a.tagName === 'BODY') break;
      if (goodId(a.id)) return `${label(a)} ${own}`;
      if (/^(HEADER|NAV|FOOTER|SECTION|ASIDE|MAIN|ARTICLE|FORM|TABLE)$/.test(a.tagName)) return `${label(a)} ${own}`;
    }
    return own;
  };
  // The text as a visitor reads it (line breaks become spaces, hidden text left out).
  const textOf = (el) => (typeof el.innerText === 'string' && el.innerText.trim() ? el.innerText : el.textContent) || '';
  const CAROUSEL = /carousel|slider|slick|swiper|marquee|ticker|flickity|splide|glide|scroller|slideshow/i;

  // ---- measuring one document -----------------------------------------------------

  function measure(doc, win, width, page) {
    const out = [];
    const counts = {};
    const add = (f) => {
      counts[f.kind] = (counts[f.kind] || 0) + 1;
      if (counts[f.kind] <= CAP) out.push({ page, width, ...f });
    };
    const html = doc.documentElement;
    const body = doc.body;
    if (!body) return { findings: out, note: 'no body' };
    const vw = html.clientWidth;
    const scrollY = win.scrollY;
    const styles = new Map();
    const style = (el) => {
      let s = styles.get(el);
      if (!s) styles.set(el, (s = win.getComputedStyle(el)));
      return s;
    };
    const visCache = new Map();
    const visible = (el) => {
      if (visCache.has(el)) return visCache.get(el);
      let v;
      if (el.checkVisibility) v = el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      else {
        const s = style(el);
        v = s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.getClientRects().length > 0;
      }
      visCache.set(el, v);
      return v;
    };
    const fixedCache = new Map();
    const inFixed = (el) => {
      if (!el || el === body || el === html) return false;
      if (fixedCache.has(el)) return fixedCache.get(el);
      const v = style(el).position === 'fixed' || inFixed(el.parentElement);
      fixedCache.set(el, v);
      return v;
    };
    const opacityCache = new Map();
    const opacity = (el) => {
      if (!el || el === html) return 1;
      if (opacityCache.has(el)) return opacityCache.get(el);
      const v = Number(style(el).opacity) * opacity(el.parentElement);
      opacityCache.set(el, v);
      return v;
    };
    const inCarousel = (el) => {
      for (let a = el; a && a !== body; a = a.parentElement) {
        if (a.getAttribute('aria-roledescription') === 'carousel') return true;
        if (typeof a.className === 'string' && CAROUSEL.test(a.className)) return true;
      }
      return false;
    };
    const pageY = (r) => Math.round(r.top + scrollY);
    // Left of or above the page, where no one can scroll: the usual way to hide skip
    // links and screen-reader-only text (left: -10000px).
    const offPage = (r) => r.right + win.scrollX <= 0 || r.bottom + scrollY <= 0;
    const all = [...body.querySelectorAll('*')].filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|BR|WBR)$/.test(el.tagName));
    const rects = new Map();
    const rectOf = (el) => {
      let r = rects.get(el);
      if (!r) rects.set(el, (r = el.getBoundingClientRect()));
      return r;
    };

    const hides = (v) => v === 'hidden' || v === 'clip';
    // The visible area left after every ancestor that hides overflow has clipped.
    const clipCache = new Map();
    const clipOf = (el) => {
      if (!el || el === body || el === html) return { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
      if (clipCache.has(el)) return clipCache.get(el);
      const s = style(el);
      let c = s.position === 'fixed' ? clipOf(null) : clipOf(el.parentElement);
      if ((s.clip && s.clip !== 'auto' && /absolute|fixed/.test(s.position)) || /^inset\(\s*50%/.test(s.clipPath)) {
        c = { left: 0, right: 0, top: 0, bottom: 0 }; // the screen-reader-only pattern
      } else if (hides(s.overflowX) || hides(s.overflowY)) {
        const r = rectOf(el);
        c = { ...c };
        if (hides(s.overflowX)) { c.left = Math.max(c.left, r.left); c.right = Math.min(c.right, r.right); }
        if (hides(s.overflowY)) { c.top = Math.max(c.top, r.top); c.bottom = Math.min(c.bottom, r.bottom); }
      }
      clipCache.set(el, c);
      return c;
    };
    // Text squeezed into a box under 4px (screen-reader-only text) is never seen.
    const srOnly = (p) => { const c = clipOf(p); return c.right - c.left < 4 || c.bottom - c.top < 4; };
    // Rectangles of the text inside el (one per line fragment), leaving out text no one
    // can see. With `clipped`, only the parts left visible by boxes that hide overflow.
    const range = doc.createRange();
    const textRects = (el, clipped) => {
      const list = [];
      const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!/\S/.test(t.data)) continue;
        const p = t.parentElement;
        if (!p || !visible(p) || srOnly(p)) continue;
        const c = clipped ? clipOf(p) : null;
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) {
          const v = c ? { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) } : r;
          if (v.right - v.left > 1 && v.bottom - v.top > 1) list.push(c ? { ...v, width: v.right - v.left, height: v.bottom - v.top } : r);
        }
      }
      return list;
    };
    const union = (list) => list.reduce((u, r) => ({
      left: Math.min(u.left, r.left), right: Math.max(u.right, r.right),
      top: Math.min(u.top, r.top), bottom: Math.max(u.bottom, r.bottom),
    }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

    // Does the viewport itself hide sideways overflow (overflow-x on html, or body's
    // propagated to the viewport)? Then overflow is cut off rather than scrollable.
    const hs = style(html), bs = style(body);
    const viewportHidesX = hides(hs.overflowX) || (hs.overflowX === 'visible' && hides(bs.overflowX));

    // 1. Sticking out past the right edge: the page scrolls sideways (or, when the
    // page hides it, the content is cut off at the edge).
    if (html.scrollWidth > vw + 1 || body.scrollWidth > vw + 1) {
      const clippedInside = (el) => {
        for (let a = el.parentElement; a && a !== body && a !== html; a = a.parentElement) {
          const s = style(a);
          if (s.position === 'fixed') return true;
          if (s.overflowX !== 'visible' && rectOf(a).right <= vw + 1) return true;
        }
        return false;
      };
      const over = new Set();
      for (const el of all) {
        const r = rectOf(el);
        if (r.right <= vw + 1 || r.width === 0 || r.height === 0) continue;
        if (inFixed(el) || !visible(el) || clippedInside(el)) continue;
        over.add(el);
      }
      // Report the outermost offenders; name the deepest one inside when different.
      for (const el of over) {
        if (over.has(el.parentElement)) continue;
        const r = rectOf(el);
        if (viewportHidesX && (r.left >= vw || inCarousel(el))) continue; // off-screen, or a slider peeking in
        let deep = el;
        for (const d of over) if (d !== deep && deep.contains(d) && (d.tagName === 'IMG' || d.textContent.trim())) deep = d;
        const pic = el.tagName === 'IMG' ? el : el.querySelector('img');
        const what = clean(textOf(el)) || (pic ? shortSrc(pic.currentSrc || pic.src) : '');
        const inner = deep !== el ? ` (inside it: ${selectorFor(deep)})` : '';
        if (viewportHidesX) {
          add({ severity: 'medium', kind: 'cut-off-edge', selector: selectorFor(el), text: what, y: pageY(r),
            detail: `${Math.round(r.width)}px wide, runs ${Math.round(r.right - vw)}px past the right edge at ${width}px; the page hides the overflow, so it's cut off${inner}` });
        } else {
          add({ severity: 'high', kind: 'sideways-scroll', selector: selectorFor(el), text: what, y: pageY(r),
            detail: `page scrolls sideways at ${width}px (content ${html.scrollWidth}px wide): this is ${Math.round(r.width)}px wide and reaches ${Math.round(r.right)}px${inner}` });
        }
      }
    }

    // 2. Text cut off: headings, buttons, links and nav items whose text runs past a
    // box that hides overflow (their own, an ancestor's, or the page edge).
    const BUTTONISH = 'button,[role=button],a.button,a.btn,a[class*="button"],a[class*="btn"],.sqs-block-button-element';
    const CUTTABLE = `h1,h2,h3,h4,h5,h6,${BUTTONISH},nav a,nav li,a`;
    const seenCut = new Set();
    for (const el of body.querySelectorAll(CUTTABLE)) {
      if (!visible(el) || offPage(rectOf(el)) || inCarousel(el)) continue;
      // Report the outermost cut element only (a link inside a cut heading is the same thing).
      let skip = false;
      for (const s of seenCut) if (s.contains(el)) { skip = true; break; }
      if (skip) continue;
      const tr = textRects(el);
      if (!tr.length) continue;
      const u = union(tr);
      const fs = parseFloat(style(el).fontSize) || 16;
      let cut = null;
      const s0 = style(el);
      const clamp = s0.webkitLineClamp && s0.webkitLineClamp !== 'none';
      const ellipsis = s0.textOverflow === 'ellipsis';
      for (let a = el, i = 0; a && a !== body && a !== html && i < 15; a = a.parentElement, i++) {
        const s = style(a);
        if (s.position === 'fixed' && a !== el) break;
        if ((s.clip && s.clip !== 'auto') || (s.clipPath && s.clipPath !== 'none')) { cut = 'hidden'; break; }
        const cx = hides(s.overflowX), cy = hides(s.overflowY);
        if (!cx && !cy) continue;
        const c = rectOf(a);
        if (c.width < 4 || c.height < 4 || offPage(c)) { cut = 'hidden'; break; } // visually-hidden text
        const outX = cx && (u.right <= c.left || u.left >= c.right);
        const outY = cy && (u.bottom <= c.top || u.top >= c.bottom);
        if (outX || outY) { cut = 'hidden'; break; } // wholly hidden (a closed menu, a far slide)
        const overX = cx ? Math.max(c.left - u.left, u.right - c.right) : 0;
        const overY = cy ? Math.max(c.top - u.top, u.bottom - c.bottom) : 0;
        if (overX > 3 || overY > Math.max(4, 0.3 * fs)) { cut = { by: a, overX, overY }; break; }
      }
      if (!cut && viewportHidesX && u.right > vw + 3 && u.left < vw) cut = { by: html, overX: u.right - vw, overY: 0 };
      if (!cut || cut === 'hidden') continue;
      seenCut.add(el);
      const isHeading = /^H[1-6]$/.test(el.tagName);
      const isButton = el.matches(BUTTONISH);
      const how = clamp || ellipsis ? 'shortened with …'
        : cut.overX > 3 ? `${Math.round(cut.overX)}px of it runs past the edge of its box and is hidden`
        : `the bottom ${Math.round(cut.overY)}px is hidden`;
      const where = cut.by === el ? 'its own box' : cut.by === html ? 'the page edge' : selectorFor(cut.by);
      add({ severity: (isHeading || isButton) && !clamp && !ellipsis ? 'high' : 'medium', kind: 'cut-off-text',
        selector: selectorFor(el), text: clean(textOf(el)), y: pageY(rectOf(el)),
        detail: `${isHeading ? 'heading' : isButton ? 'button' : 'link'} text cut off at ${width}px: ${how} (clipped by ${where})` });
    }

    // 3. Broken and blurry images.
    const imgs = [...body.querySelectorAll('img')];
    const broken = [];
    // Phones and tablets are 2× (or more) screens; on desktop, only flag what's blurry at 1×.
    const dpr = width <= 1024 ? 2 : 1;
    for (const img of imgs) {
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src || src === 'about:blank') continue;
      if (!visible(img) || offPage(rectOf(img))) continue;
      if (img.complete && img.naturalWidth === 0) { broken.push(img); continue; }
      if (!img.complete || !img.naturalWidth) continue;
      const r = rectOf(img);
      if (r.width < 150 || r.height < 40) continue;
      if (/\.svg(\?|#|$)|image\/svg|format=svg/i.test(src)) continue;
      // naturalWidth is in CSS px: a 2× srcset candidate of 500 pixels reports 250.
      const nw = img.naturalWidth, nh = img.naturalHeight;
      // The width the whole image is drawn at, given object-fit.
      const fit = style(img).objectFit;
      const sx = r.width / nw, sy = r.height / nh;
      const shown = nw * (fit === 'cover' ? Math.max(sx, sy) : fit === 'contain' ? Math.min(sx, sy)
        : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, sx, sy) : sx);
      // The pixel width of the best file the page offers. A high-density phone gets a
      // bigger srcset candidate than this browser may have, so use the largest one; when
      // the size is picked by URL (?format=750w, ?w=…) the largest is unknown, so only
      // hold the image to this browser's own density.
      const srcset = img.getAttribute('srcset') || (img.parentElement?.tagName === 'PICTURE'
        ? [...img.parentElement.querySelectorAll('source')].map((s) => s.getAttribute('srcset') || '').join(',') : '');
      const ws = [...srcset.matchAll(/\s(\d+)w\b/g)].map((m) => +m[1]);
      const xs = [...srcset.matchAll(/\s(\d+(?:\.\d+)?)x\b/g)].map((m) => +m[1]);
      let bestPx = nw;
      let density = dpr;
      if (ws.length) bestPx = Math.max(...ws);
      else if (xs.length) bestPx = nw * Math.max(1, ...xs);
      else if (/[?&](format=\d+w|w=\d+|width=\d+)/i.test(src)) density = Math.min(dpr, win.devicePixelRatio || 1);
      const stretch = shown / bestPx; // > 1: enlarged beyond the file's pixels, blurry at 1×
      const need = stretch * density; // pixels needed per pixel available at this density
      if (stretch < 1.5 && need < 2.5) continue;
      // A lazy loader's low-res stand-in that hasn't been swapped for the real file yet.
      const real = (img.dataset.src || '').split('?')[0];
      const placeholder = Boolean(real) && !src.includes(real);
      add({ severity: placeholder ? 'low' : stretch >= 1.5 ? 'high' : 'medium', kind: 'blurry-image',
        selector: selectorFor(img), text: shortSrc(src), y: pageY(r),
        detail: `shown ${Math.round(shown)}px wide from a ${Math.round(bestPx)}px-wide file at ${width}px` +
          (stretch >= 1.5 ? ` (stretched ${stretch.toFixed(1)}×: blurry on every screen)` : ` (needs ~${Math.round(shown * density)}px to look sharp on ${density}× phone screens)`) +
          (placeholder ? '; may still be a loading placeholder' : '') });
    }

    // 4. Overlapping text: different, non-nested text elements whose lines overlap.
    const TEXTY = 'h1,h2,h3,h4,h5,h6,p,li,a,button,blockquote,figcaption';
    const own = new Map(); // element -> its own text rects
    {
      const walker = doc.createTreeWalker(body, 4);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!/\S/.test(t.data)) continue;
        const p = t.parentElement;
        const el = p?.closest(TEXTY);
        if (!el || !visible(p) || srOnly(p)) continue;
        if (!own.has(el)) {
          const ok = !offPage(rectOf(el)) && !inFixed(el) && !inCarousel(el) && !el.closest('[aria-hidden="true"]') && opacity(el) >= 0.4;
          own.set(el, ok ? [] : null);
        }
        const list = own.get(el);
        if (!list) continue;
        // Only the part of each line that isn't clipped away by a box that hides overflow.
        const c = clipOf(p);
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) {
          const v = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) };
          v.width = v.right - v.left; v.height = v.bottom - v.top;
          if (v.width > 1 && v.height > 1) list.push(v);
        }
      }
    }
    const boxes = [];
    for (const [el, list] of own) {
      if (!list?.length) continue;
      const u = union(list);
      boxes.push({ el, list, top: u.top, bottom: u.bottom, left: u.left, right: u.right });
    }
    boxes.sort((a, b) => a.top - b.top);
    for (let i = 0; i < boxes.length && (counts['overlapping-text'] || 0) < CAP; i++) {
      const A = boxes[i];
      for (let j = i + 1; j < boxes.length && boxes[j].top < A.bottom; j++) {
        const B = boxes[j];
        if (B.left >= A.right || B.right <= A.left) continue;
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        let hit = null;
        for (const ra of A.list) {
          for (const rb of B.list) {
            const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (ix > 4 && iy > 0.5 * Math.min(ra.height, rb.height)) { hit = { ix, iy }; break; }
          }
          if (hit) break;
        }
        if (!hit) continue;
        add({ severity: 'medium', kind: 'overlapping-text', selector: selectorFor(A.el), text: clean(textOf(A.el)),
          y: pageY(A), detail: `overlaps ${selectorFor(B.el)} "${clean(textOf(B.el), 40)}" at ${width}px (by ${Math.round(hit.ix)}×${Math.round(hit.iy)}px); confirm with a screenshot` });
        break;
      }
    }

    // 5. Squashed buttons: short button text wrapping onto three or more lines.
    for (const el of body.querySelectorAll(BUTTONISH)) {
      if (!visible(el) || offPage(rectOf(el)) || inFixed(el) || inCarousel(el)) continue;
      const txt = clean(textOf(el), 200);
      if (!txt || txt.length > 40) continue;
      const tops = new Set(textRects(el, true).map((r) => Math.round(r.top / 4)));
      if (tops.size < 3) continue;
      const r = rectOf(el);
      add({ severity: 'medium', kind: 'squashed-button', selector: selectorFor(el), text: txt, y: pageY(r),
        detail: `button only ${Math.round(r.width)}px wide at ${width}px, so "${clean(txt, 30)}" wraps onto ${tops.size} lines` });
    }

    // 6. Tiny text on phones: whole passages under 12px. One finding per page.
    if (width <= 480) {
      const tiny = [];
      const walker = doc.createTreeWalker(body, 4);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const p = t.parentElement;
        if (!p || t.data.replace(/\s/g, '').length < 20 || tiny.includes(p)) continue;
        if (parseFloat(style(p).fontSize) >= 12 || !visible(p) || srOnly(p) || inFixed(p)) continue;
        const r = rectOf(p);
        if (r.width < 4 || r.height < 4 || offPage(r)) continue;
        tiny.push(p);
      }
      if (tiny.length) {
        const ex = tiny[0];
        add({ severity: 'low', kind: 'tiny-text', selector: selectorFor(ex), text: clean(textOf(ex)), y: pageY(rectOf(ex)),
          detail: `${tiny.length} passage(s) under 12px at ${width}px, e.g. ${tiny.slice(0, 3).map((e) => `${selectorFor(e)} (${parseFloat(style(e).fontSize)}px)`).join(', ')}` });
      }
    }

    // 7. Empty sections: tall, visible, and nothing in them.
    for (const sec of body.querySelectorAll('section, .page-section')) {
      if (sec.parentElement?.closest('section, .page-section') || !visible(sec)) continue;
      const r = rectOf(sec);
      if (r.height <= 200 || r.width < vw / 2) continue;
      if ((sec.innerText || '').trim()) continue;
      if (sec.querySelector('img,picture,video,iframe,svg,canvas,object,embed,input,select,textarea')) continue;
      let painted = style(sec).backgroundImage !== 'none';
      const kids = sec.querySelectorAll('*');
      for (let k = 0; !painted && k < kids.length && k < 300; k++) painted = style(kids[k]).backgroundImage !== 'none';
      if (painted) continue;
      add({ severity: 'low', kind: 'empty-section', selector: selectorFor(sec), text: '', y: pageY(r),
        detail: `${Math.round(r.height)}px-tall section with no text or images at ${width}px: a block that didn't load, or a leftover spacer` });
    }

    // How much of the page's text is still faded out. Scroll-in animations that never
    // ran (a background tab that isn't painting) leave content at opacity 0, and
    // nothing faded out gets checked.
    let chars = 0, faded = 0;
    {
      const walker = doc.createTreeWalker(body, 4);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const p = t.parentElement;
        const n = t.data.trim().length;
        if (!n || !p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
        if (p.checkVisibility && !p.checkVisibility({ visibilityProperty: true })) continue;
        chars += n;
        if (!visible(p) && !inFixed(p)) faded += n;
      }
    }
    const note = chars > 200 && faded / chars > 0.3
      ? `${Math.round((100 * faded) / chars)}% of the text is still faded out (opacity 0), so it wasn't checked: bring the tab to the front and run again`
      : '';
    return { findings: [...out, ...broken.map((img) => ({ page, width, img }))], counts, note };
  }

  // A broken image is one the browser can't decode (an SVG without a size can also
  // report naturalWidth 0, so check with decode()).
  async function confirmBroken(found) {
    const res = [];
    let n = 0;
    for (const f of found) {
      if (!f.img) { res.push(f); continue; }
      const img = f.img;
      const ok = await Promise.race([img.decode().then(() => true, () => false), sleep(1500).then(() => true)]);
      if (ok || ++n > CAP) continue;
      const src = img.currentSrc || img.getAttribute('src');
      res.push({ page: f.page, width: f.width, severity: 'high', kind: 'broken-image', selector: selectorFor(img),
        text: shortSrc(src), y: Math.round(img.getBoundingClientRect().top + (img.ownerDocument.defaultView?.scrollY || 0)),
        detail: `image doesn't load (${shortSrc(src)})${img.alt ? `; visitors see its alt text "${clean(img.alt, 40)}"` : ''}` });
    }
    return res;
  }

  // Scroll a window top to bottom so lazy images and scroll animations fire, then
  // back to the top, and wait for images still loading.
  async function scrollThrough(win, doc, until) {
    const h = win.innerHeight || 800;
    const max = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0);
    const step = Math.max(h * 0.8, max / 25);
    for (let y = 0; y < max && Date.now() < until; y += step) {
      win.scrollTo(0, y);
      await sleep(90);
    }
    win.scrollTo(0, max);
    await sleep(150);
    win.scrollTo(0, 0);
    const pending = [...doc.images].filter((i) => !i.complete);
    const wait = Math.max(0, Math.min(2500, until - Date.now()));
    await Promise.race([
      Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))),
      sleep(wait),
    ]);
    // Web fonts change line widths: measure with the real ones.
    if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, sleep(Math.max(0, Math.min(3000, until - Date.now())))]);
    await sleep(Math.min(700, Math.max(0, until - Date.now()))); // let fade-in animations finish
  }

  // ---- one page in a frame at one width ------------------------------------------

  async function checkInFrame(url, page, width, deadline) {
    const started = Date.now();
    const height = opts.height || (width <= 480 ? 844 : width <= 1024 ? 1024 : 900);
    const f = document.createElement('iframe');
    // No allow-top-navigation, -forms, -popups or -modals: the page can't move this
    // tab, submit anything, open windows or block on alert().
    f.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    // On screen (lazy loaders only fire for frames inside the viewport) but invisible.
    f.style.cssText = `position:fixed;top:0;left:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-2147483647;`;
    const loaded = new Promise((r) => f.addEventListener('load', () => r(true), { once: true }));
    f.src = url;
    (document.body || document.documentElement).appendChild(f);
    const done = (status, note, findings = []) => ({ row: { page, width, status, ms: Date.now() - started, ...(note ? { note } : {}) }, findings });
    try {
      const inTime = await Promise.race([loaded, sleep(Math.max(0, deadline - 3000 - Date.now())).then(() => false)]);
      let doc = null;
      try { doc = f.contentDocument; } catch { /* cross-origin */ }
      if (doc && doc.URL === 'about:blank' && !inTime) return done('timeout', 'page did not start loading in time');
      if (!doc || doc.URL === 'about:blank') {
        return done('refused', 'the page would not load in a frame here (frame blocked or redirected to another origin): resize the window and run with here: true');
      }
      if (new URL(doc.URL).origin !== location.origin) return done('redirected', `went to ${doc.URL}`);
      if (!inTime && doc.readyState === 'loading') return done('timeout', 'page did not finish loading in time');
      const win = f.contentWindow;
      // Phones have overlay scrollbars; don't let a classic scrollbar eat the width.
      if (doc.documentElement.clientWidth < width && doc.head) {
        const s = doc.createElement('style');
        s.textContent = 'html{scrollbar-width:none}';
        doc.head.appendChild(s);
        await sleep(50);
      }
      await scrollThrough(win, doc, deadline - 1500);
      const m = measure(doc, win, width, page);
      const findings = await confirmBroken(m.findings);
      const note = [inTime ? '' : 'measured before the page finished loading', m.note].filter(Boolean).join('; ');
      return done('ok', note, findings);
    } catch (err) {
      return done('error', clean(err && err.message, 120));
    } finally {
      f.remove();
    }
  }

  // ---- run ------------------------------------------------------------------------

  const checked = [];
  const notChecked = [];
  const notes = [];
  let findings = [];
  const gen = document.querySelector('meta[name="generator"]')?.content || '';
  if (/wix/i.test(gen) && !opts.here) notes.push('Wix picks its phone layout by device, not width: phone-width results from frames may show the desktop layout. Confirm on a real phone view.');

  if (opts.here) {
    const keep = window.scrollY;
    const width = document.documentElement.clientWidth;
    const page = location.pathname + location.search;
    const started = Date.now();
    await scrollThrough(window, document, t0 + budget);
    const m = measure(document, window, width, page);
    findings = await confirmBroken(m.findings);
    window.scrollTo(0, keep);
    checked.push({ page, width, status: 'ok', ms: Date.now() - started, ...(m.note ? { note: m.note } : {}) });
  } else {
    let slowest = 0;
    for (const p of pages) {
      const started = Date.now();
      if (started - t0 + Math.max(slowest, 3000) > budget && checked.length) { notChecked.push(p); continue; }
      let url;
      try { url = new URL(p, location.href); } catch { checked.push({ page: p, status: 'error', note: 'not a URL' }); continue; }
      const page = url.origin === location.origin ? url.pathname + url.search : url.href;
      if (url.origin !== location.origin) {
        checked.push({ page, status: 'refused', note: `different origin from this tab (${location.origin}); open a tab at ${url.origin} and run there` });
        continue;
      }
      // Ask first: the status, where it redirects, and whether it allows framing.
      try {
        const res = await Promise.race([fetch(url.href, { credentials: 'same-origin' }), sleep(6000).then(() => null)]);
        if (res) {
          res.body?.cancel?.().catch(() => {});
          const final = new URL(res.url || url.href);
          if (final.origin !== location.origin) { checked.push({ page, status: 'redirected', note: `redirects to ${final.href}` }); continue; }
          if (res.status >= 400) { checked.push({ page, status: `http-${res.status}` }); continue; }
          const xfo = res.headers.get('x-frame-options') || '';
          const csp = res.headers.get('content-security-policy') || '';
          if (/deny/i.test(xfo) || /frame-ancestors\s+'none'/i.test(csp)) {
            checked.push({ page, status: 'refused', note: `the site forbids frames (${/deny/i.test(xfo) ? 'X-Frame-Options: DENY' : "frame-ancestors 'none'"}): resize the window and run with here: true` });
            continue;
          }
        }
      } catch { /* try the frame anyway */ }
      const deadline = Math.min(Date.now() + 15000, hardStop);
      const results = await Promise.all(widths.map((w) => checkInFrame(url.href, page, w, deadline)));
      for (const r of results) { checked.push(r.row); findings.push(...r.findings); }
      slowest = Math.max(slowest, Date.now() - started);
      state.partial = { checked: checked.length, findings: findings.length };
    }
  }

  // Merge the same problem seen at several widths into one finding.
  const merged = new Map();
  for (const f of findings) {
    const key = [f.kind, f.page, f.selector, f.text].join('|');
    const m = merged.get(key);
    if (!m) { merged.set(key, { ...f, widths: [f.width] }); continue; }
    if (!m.widths.includes(f.width)) m.widths.push(f.width);
    if (SEV[f.severity] < SEV[m.severity]) Object.assign(m, { severity: f.severity, detail: f.detail });
    if (f.width < m.width) Object.assign(m, { width: f.width, y: f.y, detail: f.detail });
  }
  let list = [...merged.values()].sort((a, b) => SEV[a.severity] - SEV[b.severity]
    || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || pages.indexOf(a.page) - pages.indexOf(b.page) || a.y - b.y);
  const counts = { high: 0, medium: 0, low: 0, byKind: {} };
  for (const f of list) { counts[f.severity]++; counts.byKind[f.kind] = (counts.byKind[f.kind] || 0) + 1; }
  const total = list.length;
  if (total > 40) { notes.push(`${total - 40} more findings not shown`); list = list.slice(0, 40); }
  const ok = checked.filter((c) => c.status === 'ok').length;
  if (checked.some((c) => /faded out/.test(c.note || ''))) notes.push('Some content was still faded out and went unchecked; see `checked`. Make sure the tab is in front (not minimised or behind another tab) and run again.');
  if (checked.some((c) => c.status === 'refused')) notes.push("Some pages refused to load in a frame. For those: open the page in this tab, resize the window to each width, and run again with here: true (or take screenshots).");
  const summary = `${counts.high} high, ${counts.medium} medium, ${counts.low} low from ${ok}/${checked.length} page-width checks in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    (list[0] ? `. Top: ${list[0].kind} on ${list[0].page} at ${list[0].width}px (${list[0].selector})` : '') +
    (notChecked.length ? `. Not reached: call again with pages: ${JSON.stringify(notChecked)}` : '') +
    (notes.length ? '. See notes.' : '');
  for (const f of list) f.widths.sort((a, b) => a - b);
  const result = { summary, counts, findings: list, checked, notChecked, notes };
  window.__layoutCheck = { status: 'done', ...result };
  return result;
})(typeof OPTIONS === 'undefined' ? {} : OPTIONS)
  .catch((err) => (window.__layoutCheck = { status: 'error', error: String(err && err.stack || err) }));
