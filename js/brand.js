/* ============================================================================
   Viona Bangles — js/brand.js  (Day 11, Part 3)
   ----------------------------------------------------------------------------
   On page load, reads row id = 1 from public.brand_settings (via the existing
   Supabase client that js/auth.js already created) and fills:
       #brandTagline   (hero tagline under the heading)
       #aboutTitle     (About section heading)
       #aboutText      (About section body — line breaks preserved)
       #igLink         (footer Instagram icon; hidden if URL empty)
       #fbLink         (footer Facebook icon; hidden if URL empty)

   Safety rules:
     - If the row is missing, the fetch fails, or any field is empty, the
       default text already written inside index.html is kept as-is — the
       section is never blank and no error is thrown.
     - If the Supabase client is not ready yet, waits for VionaAuth.ready()
       (or retries briefly) before giving up.
     - Social links are only shown when the URL is a valid http(s) URL.
     - Safe to include on any page — missing elements are ignored.
   ============================================================================ */

(function () {
  'use strict';

  /* --------------------------------------------------------------------
     Tiny helpers
     -------------------------------------------------------------------- */
  function el(id) { return document.getElementById(id); }

  function isHttpUrl(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
  }

  /* Grab the shared Supabase client. Prefers the client that js/auth.js
     exposes (so we share the same session), then falls back to a fresh
     anon-only client using values from window.VIONA_CONFIG — the same
     pattern js/script.js already uses. Never hardcode keys. */
  function getClient() {
    if (window.VionaAuth && window.VionaAuth.client) return window.VionaAuth.client;
    if (window.vionaSupabase) return window.vionaSupabase;

    if (window.supabase && typeof window.supabase.createClient === 'function' &&
        window.VIONA_CONFIG &&
        window.VIONA_CONFIG.SUPABASE_URL &&
        window.VIONA_CONFIG.SUPABASE_ANON_KEY) {
      try {
        return window.supabase.createClient(
          window.VIONA_CONFIG.SUPABASE_URL,
          window.VIONA_CONFIG.SUPABASE_ANON_KEY
        );
      } catch (e) { return null; }
    }
    return null;
  }

  /* Set text only when the DB value is a non-empty string.
     Empty / null / whitespace → keep whatever the HTML already shows. */
  function setTextIfPresent(id, value) {
    if (value == null) return;
    var text = String(value).trim();
    if (!text) return;
    var node = el(id);
    if (node) node.textContent = text;
  }

  /* Show or hide a social link depending on whether the URL is valid http(s).
     Hidden by default in HTML so an empty DB field leaves the icon invisible. */
  function setSocialLink(anchorId, url) {
    var a = el(anchorId);
    if (!a) return;

    if (isHttpUrl(url)) {
      a.href = String(url).trim();
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.hidden = false;
    } else {
      a.hidden = true;
      a.removeAttribute('href');
    }
  }

  /* Apply the fetched row to the page (only non-empty fields). */
  function applyRow(row) {
    if (!row) return;

    // Tagline — single line under the hero heading.
    setTextIfPresent('brandTagline', row.tagline);

    // About heading — section title.
    setTextIfPresent('aboutTitle', row.about_title);

    // About body — textContent + CSS white-space:pre-line keeps the \n / \n\n
    // line breaks from the admin textarea exactly as typed.
    if (row.about_text != null) {
      var aboutBody = String(row.about_text);
      if (aboutBody.trim()) {
        var aboutNode = el('aboutText');
        if (aboutNode) aboutNode.textContent = aboutBody.trim();
      }
    }

    // Footer social icons — hide when URL is empty.
    setSocialLink('igLink', row.instagram_url);
    setSocialLink('fbLink', row.facebook_url);
  }

  /* Fetch row id = 1 and fill the page. Silent on any failure — HTML defaults
     stay, no console crash, no blank section. */
  async function loadBrand() {
    var sb = getClient();
    if (!sb) return; // HTML defaults stay

    try {
      var res = await sb
        .from('brand_settings')
        .select('tagline, about_title, about_text, instagram_url, facebook_url')
        .eq('id', 1)
        .maybeSingle();

      if (res && res.error) return; // silent — HTML defaults stay
      if (res && res.data) applyRow(res.data);
    } catch (e) {
      // silent — HTML defaults stay
    }
  }

  /* Boot — wait until the Supabase client exists, then load the brand row. */
  function boot() {
    // Best case: client is ready right now.
    if (getClient()) { loadBrand(); return; }

    // Wait for VionaAuth.ready() when available (script.js already awaits it,
    // but a direct visit to a page that only loads brand.js also works).
    if (window.VionaAuth && typeof window.VionaAuth.ready === 'function') {
      Promise.resolve(window.VionaAuth.ready())
        .then(function () { loadBrand(); })
        .catch(function () { /* HTML defaults stay */ });
      return;
    }

    // Last resort: poll briefly (about 4 seconds) then give up.
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (getClient()) {
        clearInterval(timer);
        loadBrand();
      } else if (tries > 40) {
        clearInterval(timer); // give up — HTML defaults stay
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
