/* ============================================================================
   Viona Bangles — js/brand.js  (Day 12, Part 3)
   ----------------------------------------------------------------------------
   Loads every editable website text from public.site_content ONCE, then
   fills every element marked with:

       data-content="<key>"           → sets element.textContent (or .placeholder
                                         for <input>, or <option> text)
       data-content-href="<key>"      → sets href AND shows/hides the element
                                         (hidden when the URL is empty)

   Also exposes:
       window.SITE_CONTENT            → plain object { key: value, … }
       window.siteText(key, fallback) → returns value for key, or fallback
                                        when key is missing/empty

   Fires a "siteContentLoaded" event on document so js/script.js and any other
   script can re-render JS-built strings (product grid, order button, size
   popup, etc.) once the DB values are in.

   Size-related keys are NOT part of site_content — sizes are managed by the
   ALL_SIZES constant in js/script.js. brand.js simply ignores any such rows
   if they happen to exist.

   Safety:
     - If site_content is missing / Supabase not ready / fetch fails, the page
       keeps whatever defaults are already inside index.html.
     - Falls back to the Day 11 brand_settings row for tagline / about_title /
       about_text / instagram_url / facebook_url if site_content is empty.
     - Preserves line breaks in textareas by applying white-space: pre-line.
     - Never throws or logs errors into the console that break the page.
   ============================================================================ */

(function () {
  'use strict';

  /* --------------------------------------------------------------------
     Shared state
     -------------------------------------------------------------------- */
  var SITE_CONTENT = Object.create(null);
  var LOADED_ONCE = false;
  var LOADING = false;

  /* Keys whose values are multi-line → keep white-space: pre-line */
  var MULTILINE_KEYS = {
    about_text: 1,
    hero_subtitle: 1,
    footer_text: 1,
    contact_address: 1,
    empty_products_message: 1
  };

  /* Keys we do NOT want to apply from site_content even if they exist,
     because sizes are managed in js/script.js (ALL_SIZES). */
  function isIgnoredKey(key) {
    if (!key) return true;
    if (key === 'all_sizes') return true;
    if (key.indexOf('size_') === 0) return true;
    return false;
  }

  /* --------------------------------------------------------------------
     Tiny helpers
     -------------------------------------------------------------------- */
  function el(id) { return document.getElementById(id); }

  function isHttpUrl(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
  }

  /* Get the shared Supabase client (same pattern as js/script.js / auth.js). */
  function getClient() {
    if (window.VionaAuth && window.VionaAuth.client) return window.VionaAuth.client;
    if (window.vionaSupabase) return window.vionaSupabase;

    var cfg = window.VIONA_CONFIG || {};
    if (window.supabase && typeof window.supabase.createClient === 'function' &&
        cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      try {
        return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      } catch (e) { return null; }
    }
    return null;
  }

  /* --------------------------------------------------------------------
     Fill a single element with a text value.
     Inputs use .placeholder; everything else uses .textContent.
     -------------------------------------------------------------------- */
  function applyText(node, value, key) {
    if (!node) return;
    var text = String(value == null ? '' : value);

    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      node.setAttribute('placeholder', text);
      if (node.getAttribute('data-content') === 'search_placeholder') {
        node.setAttribute('aria-label', text);
      }
      return;
    }

    if (tag === 'option') {
      node.textContent = text;
      return;
    }

    if (MULTILINE_KEYS[key]) {
      node.style.whiteSpace = 'pre-line';
    }

    node.textContent = text;
  }

  /* --------------------------------------------------------------------
     Apply every [data-content] element currently in the DOM.
     -------------------------------------------------------------------- */
  function applyTextBindings() {
    var nodes = document.querySelectorAll('[data-content]');
    Array.prototype.forEach.call(nodes, function (node) {
      var key = node.getAttribute('data-content');
      if (!key || isIgnoredKey(key)) return;
      if (!Object.prototype.hasOwnProperty.call(SITE_CONTENT, key)) return;
      var value = SITE_CONTENT[key];
      if (value == null || value === '') return;  // keep HTML default
      applyText(node, value, key);
    });
  }

  /* --------------------------------------------------------------------
     Apply every [data-content-href] element (social links etc.).
     Empty value → hide the element completely.
     -------------------------------------------------------------------- */
  function applyHrefBindings() {
    var nodes = document.querySelectorAll('[data-content-href]');
    Array.prototype.forEach.call(nodes, function (node) {
      var key = node.getAttribute('data-content-href');
      if (!key || isIgnoredKey(key)) return;
      var value = SITE_CONTENT[key];

      if (isHttpUrl(value)) {
        node.setAttribute('href', String(value).trim());
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener');
        node.hidden = false;
      } else {
        node.hidden = true;
        node.removeAttribute('href');
      }
    });
  }

  /* --------------------------------------------------------------------
     Load all rows from site_content in one query.
     -------------------------------------------------------------------- */
  async function fetchSiteContent(sb) {
    try {
      var res = await sb
        .from('site_content')
        .select('key,value');

      if (res && res.error) return null;
      return (res && res.data) || [];
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------------------------
     Fallback: read the Day 11 brand_settings row and use its values for
     any site_content key that has no value yet.
     -------------------------------------------------------------------- */
  async function fetchBrandFallback(sb) {
    try {
      var res = await sb
        .from('brand_settings')
        .select('tagline, about_title, about_text, instagram_url, facebook_url')
        .eq('id', 1)
        .maybeSingle();
      if (res && res.error) return null;
      return (res && res.data) || null;
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------------------------
     Merge DB rows into SITE_CONTENT (skip empty values, skip size keys).
     -------------------------------------------------------------------- */
  function mergeRows(rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach(function (row) {
      if (!row || row.key == null) return;
      if (isIgnoredKey(row.key)) return;
      var value = row.value;
      if (value == null) return;
      var text = String(value);
      if (!text.trim()) return;                 // never override with blank
      SITE_CONTENT[row.key] = text;
    });
  }

  function mergeBrandFallback(brand) {
    if (!brand) return;
    var map = {
      tagline:       brand.tagline,
      about_title:   brand.about_title,
      about_text:    brand.about_text,
      instagram_url: brand.instagram_url,
      facebook_url:  brand.facebook_url
    };
    Object.keys(map).forEach(function (k) {
      if (isIgnoredKey(k)) return;
      var v = map[k];
      if (v == null) return;
      var s = String(v);
      if (!s.trim()) return;
      if (!SITE_CONTENT[k]) SITE_CONTENT[k] = s;
    });
  }

  /* --------------------------------------------------------------------
     Public helpers
     -------------------------------------------------------------------- */
  window.SITE_CONTENT = SITE_CONTENT;

  window.siteText = function (key, fallback) {
    if (key == null) return fallback == null ? '' : fallback;
    var v = SITE_CONTENT[key];
    if (v == null || v === '') {
      return (fallback == null) ? '' : fallback;
    }
    return v;
  };

  /* --------------------------------------------------------------------
     Dispatch the event once when data is ready (either loaded or empty).
     -------------------------------------------------------------------- */
  function fireLoaded() {
    try {
      document.dispatchEvent(new CustomEvent('siteContentLoaded', {
        detail: { content: SITE_CONTENT }
      }));
    } catch (e) {
      try {
        var ev = document.createEvent('Event');
        ev.initEvent('siteContentLoaded', true, true);
        ev.content = SITE_CONTENT;
        document.dispatchEvent(ev);
      } catch (e2) { /* ignore */ }
    }
  }

  /* --------------------------------------------------------------------
     Main loader
     -------------------------------------------------------------------- */
  async function loadAll() {
    if (LOADING || LOADED_ONCE) return;
    LOADING = true;

    var sb = getClient();
    if (!sb) {
      LOADING = false;
      LOADED_ONCE = true;
      // Make sure any [data-content-href] anchors that start hidden stay
      // hidden when there is no client.
      applyHrefBindings();
      fireLoaded();
      return;
    }

    var rows  = await fetchSiteContent(sb);
    var brand = await fetchBrandFallback(sb);

    mergeRows(rows || []);
    mergeBrandFallback(brand);

    applyTextBindings();
    applyHrefBindings();

    LOADING = false;
    LOADED_ONCE = true;
    fireLoaded();
  }

  /* --------------------------------------------------------------------
     Boot — prefer VionaAuth.ready() so we share the same client.
     Falls back to a brief poll if that API is not present.
     -------------------------------------------------------------------- */
  function boot() {
    if (getClient()) { loadAll(); return; }

    if (window.VionaAuth && typeof window.VionaAuth.ready === 'function') {
      Promise.resolve(window.VionaAuth.ready())
        .then(function () { loadAll(); })
        .catch(function () { loadAll(); });   // loadAll() itself is safe
      return;
    }

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (getClient()) {
        clearInterval(timer);
        loadAll();
      } else if (tries > 40) {
        clearInterval(timer);
        loadAll();   // fire the event with empty content → HTML defaults stay
      }
    }, 100);
  }

  /* Re-apply bindings when new [data-content] nodes are inserted later. */
  function reapply() {
    if (!LOADED_ONCE) return;
    applyTextBindings();
    applyHrefBindings();
  }

  // Expose for other scripts — they can call window.vionaBrand.apply() after
  // injecting fresh DOM that uses data-content elements.
  window.vionaBrand = {
    apply: reapply,
    get: function (k) { return SITE_CONTENT[k]; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
