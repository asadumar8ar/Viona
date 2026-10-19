/* ============================================================================
   Viona Bangles — js/script.js  (Day 12, Part 5)
   ----------------------------------------------------------------------------
   Public homepage logic. Plain vanilla JS, no build step.

   Uses:
     - window.VIONA_CONFIG  (js/config.js)
     - window.VionaAuth     (js/auth.js)  -> auth + login modal + profile
     - window.siteText / window.SITE_CONTENT (js/brand.js, Day 12)
     - supabase-js v2       (CDN global "supabase")

   What it does:
     - Loads products + site_settings from Supabase (defensive: learns columns
       by doing select * limit 1). No demo data anywhere.
     - Header search + suggestions, category strip, product grid.
     - Product modal with gallery, size chips, WhatsApp order button.
     - Offers banner from site_settings (hidden when empty).
     - Reviews: fetched once, grouped by product_id, shown per product.
     - Review form wired to VionaAuth (login required).
     - Mobile slide-in drawer (#mobileMenu).
     - Injects its own CSS so css/style.css does not need to change.

   DAY 12 (TASK 2) — Product sizes on the details view:
     - Master list comes from site_content.all_sizes (fallback "2.2, 2.4, 2.6, 2.8").
     - A size is AVAILABLE if it's inside the product's `sizes` column
       (parsed from array or text with commas / slashes / spaces, compared
       numerically so "2.4" === "2.40"). Available chips are normal and
       selectable — the selected size still flows into the WhatsApp order
       message exactly as before.
     - Sizes NOT in the product's sizes are UNAVAILABLE: dimmed grey, no
       hover, cursor not-allowed. Clicking one opens a premium navy + gold
       popup with size_unavailable_title / size_unavailable_message
       (prefixed with "Size X") / size_unavailable_button. It never selects
       the size.
     - If a product has no sizes value at all → the size section is hidden.
     - If the product is out_of_stock → all chips are disabled (existing
       behaviour), no popup is shown when clicking them.

   DAY 12 — editable strings:
     - Empty products message, order button label, size popup title/message/
       button, and any other string the script generates now reads
       window.siteText('key', 'fallback').
     - Re-renders those strings when the "siteContentLoaded" event fires
       (so brand.js loading late doesn't leave stale text in the UI).

   Earlier fixes retained:
     - C1: offer flag read from offer_active OR offer_enabled.
     - C2: sizes parsed JSON → array → CSV.
     - M2: offer_link used for "Shop now", hidden if empty.
     - M4: sizes default only when null/undefined.
     - Review bars: count from the currently-open product's reviews only,
       readRatingValue() handles rating/stars, no bars when total = 0,
       bars re-render on product switch and after submit.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIG + SUPABASE CLIENT
     ========================================================================== */

  var CFG = window.VIONA_CONFIG || {};
  var sb = null;
  var SUPABASE_READY = false;

  var REVIEW_BUCKET = 'review-images';
  var REVIEW_MAX_BYTES = 2 * 1024 * 1024;
  var REVIEW_MAX_WIDTH = 1200;

  function isPlaceholder(v) {
    return !v || typeof v !== 'string' ||
           v.indexOf('PASTE_') === 0 ||
           v.indexOf('PASTE_YOUR') !== -1 ||
           v.indexOf('.supabase.co') === -1;
  }

  function cfgLooksOk() {
    return !isPlaceholder(CFG.SUPABASE_URL) && !isPlaceholder(CFG.SUPABASE_ANON_KEY);
  }

  /* ==========================================================================
     2. SMALL UTILITY HELPERS
     ========================================================================== */

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escAttr(s) { return esc(s); }

  /* siteText wrapper — safe when brand.js is not loaded. */
  function t(key, fallback) {
    if (window.siteText && typeof window.siteText === 'function') {
      var v = window.siteText(key, fallback);
      return (v == null || v === '') ? (fallback == null ? '' : fallback) : v;
    }
    return fallback == null ? '' : fallback;
  }

  function waLink(number, message) {
    var n = String(number || '').replace(/[^0-9]/g, '');
    var text = encodeURIComponent(message || '');
    return 'https://wa.me/' + n + (text ? '?text=' + text : '');
  }

  function money(n) {
    var num = Number(n);
    if (isNaN(num)) num = 0;
    var s = (num % 1 === 0) ? String(num) : num.toFixed(2);
    return 'Rs ' + s;
  }

  function discountPct(price, oldPrice) {
    var p = Number(price), o = Number(oldPrice);
    if (!o || !p || o <= p) return 0;
    var pct = Math.round(((o - p) / o) * 100);
    return pct > 0 ? pct : 0;
  }

  function normalizeStock(v) {
    if (v == null) return 'in_stock';
    var s = String(v).trim().toLowerCase();
    if (s === 'low_stock' || s === 'out_of_stock' || s === 'in_stock') return s;
    return 'in_stock';
  }

  function productCode(id, code) {
    if (code && typeof code === 'string' && code.trim()) return code.trim();
    var n = Number(id) || 0;
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return 'VB-' + s;
  }

  function codeToId(code) {
    if (!code) return 0;
    var m = String(code).toUpperCase().match(/^VB-(\d+)$/);
    if (!m) return 0;
    return parseInt(m[1], 10);
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    } catch (e) { return ''; }
  }

  function debounce(fn, ms) {
    var tmr = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(tmr);
      tmr = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  var toastTimer = null;
  function toast(msg) {
    var node = el('toast');
    if (!node) return;
    node.textContent = String(msg || '');
    node.hidden = false;
    void node.offsetWidth;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove('is-visible');
      setTimeout(function () { node.hidden = true; }, 300);
    }, 3000);
  }

  function realError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    var parts = [];
    if (err.message) parts.push(err.message);
    if (err.details) parts.push('Details: ' + err.details);
    if (err.hint) parts.push('Hint: ' + err.hint);
    if (!parts.length) parts.push(String(err));
    return parts.join(' · ');
  }

  function logError(where, err) {
    console.error('[viona] ' + where, err);
  }

  /* Read a rating from a review row — supports r.rating or r.stars. */
  function readRatingValue(r) {
    if (!r) return 0;
    var raw = r.rating;
    if (raw === null || raw === undefined || raw === '') raw = r.stars;
    if (raw === null || raw === undefined || raw === '') return 0;
    var n = Number(raw);
    if (!isFinite(n)) return 0;
    var rounded = Math.round(n);
    if (rounded < 1 || rounded > 5) return 0;
    return rounded;
  }

  /* ==========================================================================
     3. SIZE HELPERS (Day 12 TASK 2)
     ========================================================================== */

  /* Parse a sizes value into an array of trimmed strings.
     Handles arrays, CSV, slashes and whitespace: "2.4, 2.6" / "2.4/2.6" / ["2.4","2.6"]. */
  function parseSizeList(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) {
      return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
    }
    var str = String(raw).trim();
    if (!str) return [];
    return str.split(/[,\/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* Normalised numeric key so "2.4" === "2.40" === "2.40" (case-folded for word sizes). */
  function sizeKey(s) {
    var n = parseFloat(s);
    if (isFinite(n)) return 'n:' + n.toFixed(3);
    return 's:' + String(s).trim().toLowerCase();
  }

  /* Master list from site_content.all_sizes (falls back to a sensible default). */
  function getMasterSizes() {
    var raw = t('all_sizes', '2.2, 2.4, 2.6, 2.8');
    var list = parseSizeList(raw);
    if (!list.length) list = ['2.2', '2.4', '2.6', '2.8'];
    return list;
  }

  /* The sizes a specific product has (numeric-key comparison later). */
  function getProductSizeValues(p) {
    if (!p) return [];
    return parseSizeList(p.sizes);
  }

  /* Build the full ordered list of chips for a product:
       { label, available }
     - Available sizes come from the product's `sizes` field.
     - Master sizes that aren't in the product are UNAVAILABLE.
     - Extra product sizes not in the master are appended (always available). */
  function buildSizeChips(p) {
    var productRaw = getProductSizeValues(p);
    if (!productRaw.length) return null;   // no sizes → hide section

    var availableSet = {};
    productRaw.forEach(function (s) { availableSet[sizeKey(s)] = String(s); });

    var master = getMasterSizes();
    var seen = {};
    var out = [];

    master.forEach(function (s) {
      var k = sizeKey(s);
      if (seen[k]) return;
      seen[k] = true;
      out.push({ label: String(s), available: !!availableSet[k] });
    });

    productRaw.forEach(function (s) {
      var k = sizeKey(s);
      if (seen[k]) return;
      seen[k] = true;
      out.push({ label: String(s), available: true });
    });

    return out;
  }

  /* ==========================================================================
     4. STATE
     ========================================================================== */

  var state = {
    products: [],
    filtered: [],
    categories: [],
    activeCategory: 'All',
    searchTerm: '',

    productCols: null,
    R: null,

    loaded: false,
    loadError: false,

    settings: {},

    allReviews: [],
    reviewsByProduct: {},

    currentProduct: null,
    currentSize: null,
    currentImageIndex: 0,
    galleryImages: [],

    reviewSort: 'newest',
    currentUser: null,
    currentProfile: null,
    editingReview: false,

    pickerRating: 0,
    reviewFile: null,
    reviewPreviewUrl: '',

    lightbox: { images: [], index: 0 },

    suggestIndex: -1,
    suggestItems: [],

    offerText: '',
    offerLink: '',
    offerActive: false
  };

  /* ==========================================================================
     5. INJECTED STYLES
     ========================================================================== */

  function injectStyles() {
    if (el('vionaRuntimeStyles')) return;

    var css = [
      /* star rows */
      '.vrt-stars{display:inline-flex;position:relative;line-height:1;',
      'font-size:15px;letter-spacing:2px;vertical-align:middle;}',
      '.vrt-stars-bg{color:#E4DFD3;}',
      '.vrt-stars-fg{position:absolute;top:0;left:0;overflow:hidden;',
      'white-space:nowrap;color:#C9A24B;pointer-events:none;}',

      '.vrt-card-rating{display:flex;align-items:center;gap:6px;margin:6px 0 0;',
      'font-size:12.5px;color:#4A5568;}',
      '.vrt-card-rating .vrt-avg{font-weight:700;color:#0B1F3A;}',
      '.vrt-card-rating .vrt-total{color:#6B7280;}',
      '.vrt-card-rating .vrt-noreviews{color:#9AA1AE;font-style:italic;}',

      '.vrt-summary{display:grid;grid-template-columns:150px 1fr;gap:22px;',
      'background:#FAF7F0;border:1px solid #ECE6DA;border-radius:14px;',
      'padding:18px 20px;margin:6px 0 22px;align-items:center;}',
      '.vrt-summary-left{text-align:center;}',
      '.vrt-big-avg{font-size:42px;line-height:1;font-weight:800;color:#0B1F3A;}',
      '.vrt-outof{display:block;font-size:12px;color:#6B7280;margin:4px 0 8px;}',
      '.vrt-summary-left .vrt-stars{font-size:18px;}',
      '.vrt-count{display:block;font-size:12.5px;color:#6B7280;margin-top:8px;}',
      '.vrt-summary-right{display:flex;flex-direction:column;gap:7px;}',

      '.vrt-bar-row{display:grid;grid-template-columns:38px 1fr 32px;',
      'gap:10px;align-items:center;font-size:12.5px;color:#4A5568;}',
      '.vrt-bar-label{font-weight:600;color:#0B1F3A;white-space:nowrap;}',
      '.vrt-bar-track{position:relative;height:9px;border-radius:999px;',
      'background:#E9E3D6;overflow:hidden;}',
      '.vrt-bar-fill{position:absolute;left:0;top:0;bottom:0;width:0%;',
      'background:#C9A24B;border-radius:999px;',
      'transition:width .55s cubic-bezier(.2,.7,.2,1);}',
      '.vrt-bar-count{text-align:right;color:#6B7280;font-variant-numeric:tabular-nums;}',

      /* reviews list */
      '.vrt-rv{padding:16px 0;border-bottom:1px solid #ECE6DA;}',
      '.vrt-rv:last-child{border-bottom:none;}',
      '.vrt-rv-top{display:flex;align-items:center;gap:12px;margin-bottom:8px;}',
      '.vrt-av{width:40px;height:40px;border-radius:50%;flex:none;',
      'background:#0B1F3A;color:#C9A24B;display:flex;align-items:center;',
      'justify-content:center;font-weight:700;font-size:16px;overflow:hidden;}',
      '.vrt-av img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.vrt-rv-ident{flex:1;min-width:0;}',
      '.vrt-rv-name{font-weight:700;font-size:14px;margin:0;color:#0B1F3A;}',
      '.vrt-rv-date{font-size:12px;color:#6B7280;margin:2px 0 0;}',
      '.vrt-rv-tag{display:inline-block;background:#FBF3E1;color:#8A6A1F;',
      'font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;',
      'padding:3px 8px;border-radius:999px;margin-left:6px;}',
      '.vrt-rv-stars{margin:0 0 8px;}',
      '.vrt-rv-text{font-size:14px;line-height:1.55;color:#2C3A4B;margin:0;',
      'white-space:pre-wrap;word-break:break-word;}',
      '.vrt-rv-photo{margin-top:10px;}',
      '.vrt-rv-photo button{padding:0;border:none;background:none;cursor:pointer;}',
      '.vrt-rv-photo img{width:96px;height:96px;border-radius:10px;',
      'object-fit:cover;border:1px solid #ECE6DA;}',
      '.vrt-rv-actions{display:flex;gap:8px;margin-top:10px;}',
      '.vrt-rv-act{background:#fff;border:1px solid #E4DED2;border-radius:8px;',
      'padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer;',
      'color:#0B1F3A;font-family:inherit;}',
      '.vrt-rv-act:hover{border-color:#C9A24B;}',
      '.vrt-rv-act.danger{color:#B42318;border-color:#F2C6C2;}',
      '.vrt-rv-act.danger:hover{background:#FDF2F1;}',

      /* review form */
      '.vrt-form{background:#fff;border:1px solid #ECE6DA;border-radius:14px;',
      'padding:18px 20px;margin-top:16px;}',
      '.vrt-form-title{font-size:16px;font-weight:700;margin:0 0 4px;color:#0B1F3A;}',
      '.vrt-form-sub{font-size:13px;color:#6B7280;margin:0 0 14px;}',
      '.vrt-field{margin-bottom:14px;}',
      '.vrt-field label{display:block;font-size:12px;font-weight:700;',
      'letter-spacing:.04em;text-transform:uppercase;color:#6B7280;margin-bottom:6px;}',
      '.vrt-textarea,.vrt-input{width:100%;border:1px solid #E4DED2;border-radius:10px;',
      'padding:10px 12px;font-size:14px;font-family:inherit;background:#fff;',
      'color:#0B1F3A;outline:none;box-sizing:border-box;}',
      '.vrt-textarea{min-height:96px;resize:vertical;}',
      '.vrt-input:focus,.vrt-textarea:focus{border-color:#C9A24B;}',
      '.vrt-hint{font-size:12px;color:#6B7280;margin:6px 0 0;}',
      '.vrt-error{font-size:13px;color:#B42318;margin:8px 0 0;}',
      '.vrt-cta{background:#FAF7F0;border:1px solid #ECE6DA;border-radius:14px;',
      'padding:18px 20px;margin-top:16px;text-align:center;}',
      '.vrt-cta-title{font-size:16px;font-weight:700;margin:0 0 4px;color:#0B1F3A;}',
      '.vrt-cta-text{font-size:13px;color:#6B7280;margin:0 0 14px;}',

      '.vrt-picker{display:inline-flex;gap:2px;font-size:30px;line-height:1;}',
      '.vrt-pick{background:none;border:none;padding:0 2px;cursor:pointer;',
      'color:#E4DFD3;font-size:30px;line-height:1;font-family:inherit;}',
      '.vrt-pick.is-on{color:#C9A24B;}',
      '.vrt-pick:hover{color:#C9A24B;}',

      '.vrt-photos{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}',
      '.vrt-photo{position:relative;width:88px;height:88px;border-radius:10px;',
      'overflow:hidden;background:#F1EDE4;border:1px solid #E4DED2;}',
      '.vrt-photo img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.vrt-photo-x{position:absolute;top:4px;right:4px;width:22px;height:22px;',
      'border-radius:50%;border:none;background:rgba(11,31,58,.78);color:#fff;',
      'font-size:14px;line-height:1;cursor:pointer;display:flex;',
      'align-items:center;justify-content:center;}',
      '.vrt-photo-add{width:88px;height:88px;border-radius:10px;',
      'border:1px dashed #E4DED2;background:#fff;color:#6B7280;',
      'font-size:26px;cursor:pointer;}',
      '.vrt-photo-add:hover{border-color:#C9A24B;color:#C9A24B;}',

      '.vrt-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;',
      'border:1px solid transparent;border-radius:10px;padding:10px 16px;',
      'font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;',
      'transition:.15s;}',
      '.vrt-btn:disabled{opacity:.55;cursor:not-allowed;}',
      '.vrt-btn-gold{background:#C9A24B;color:#0B1F3A;}',
      '.vrt-btn-gold:hover:not(:disabled){filter:brightness(1.06);}',
      '.vrt-btn-ghost{background:#fff;border-color:#E4DED2;color:#0B1F3A;}',
      '.vrt-btn-ghost:hover:not(:disabled){border-color:#C9A24B;}',

      /* stock visuals */
      '.card-media.is-out{background:#F1EDE4;}',
      '.card-media.is-out .card-img{opacity:.4;filter:grayscale(.4);}',
      '.card-media.is-out .card-placeholder{opacity:.5;}',
      '.card-ribbon{position:absolute;top:50%;left:50%;',
      'transform:translate(-50%,-50%) rotate(-12deg);',
      'z-index:3;pointer-events:none;',
      'padding:7px 18px;border-radius:4px;',
      'font-family:var(--font-body,inherit);font-size:11px;font-weight:800;',
      'letter-spacing:.14em;text-transform:uppercase;',
      'color:#fff;background:#C0392B;border:2px solid #fff;',
      'box-shadow:0 6px 16px rgba(0,0,0,.28);}',
      '.card-lowstock{display:inline-block;margin:6px 0 0;',
      'font-size:11px;font-weight:700;letter-spacing:.04em;',
      'color:#8A5A00;background:#FFF4E0;',
      'border:1px solid #F0D9A6;border-radius:999px;padding:3px 10px;}',

      '.modal-lowstock{margin:0 0 10px;padding:8px 12px;border-radius:8px;',
      'font-size:13px;font-weight:600;text-align:center;',
      'color:#8A5A00;background:#FFF4E0;border:1px solid #F0D9A6;}',
      '.modal-outstock{display:block;width:100%;margin:0 0 10px;',
      'padding:13px 20px;border:0;border-radius:999px;',
      'background:#B7B7B7;color:#fff;',
      'font-family:inherit;font-size:13px;font-weight:600;',
      'letter-spacing:.09em;text-transform:uppercase;',
      'text-align:center;cursor:not-allowed;box-shadow:none;}',
      '.modal-restock-link{display:block;margin:10px 0 0;text-align:center;',
      'font-size:13px;font-weight:600;color:#0B1F3A;',
      'text-decoration:underline;text-underline-offset:3px;}',
      '.modal-restock-link:hover{color:#C9A24B;}',
      '.size-chip.is-disabled,.size-chip[disabled]{opacity:.45;',
      'cursor:not-allowed;pointer-events:none;}',

      /* DAY 12 — dimmed "size not available" chips.
         Clickable so they can open the popup; looks dim, no hover lift. */
      '.size-chip.is-unavailable{opacity:.45;background:#EFEAE0;',
      'color:#8A8F98;border-color:#E4DED2;cursor:not-allowed;}',
      '.size-chip.is-unavailable:hover{border-color:#E4DED2;',
      'background:#EFEAE0;color:#8A8F98;}',
      '.size-chip.is-unavailable.is-active{background:#EFEAE0;',
      'color:#8A8F98;border-color:#E4DED2;}',

      /* SIZE POPUP — navy + gold, centered */
      '#sizePopup.popup-overlay{position:fixed;inset:0;z-index:1100;',
      'display:grid;place-items:center;padding:20px;}',
      '#sizePopup .popup-backdrop{position:absolute;inset:0;',
      'background:rgba(5,10,20,.78);backdrop-filter:blur(3px);',
      '-webkit-backdrop-filter:blur(3px);animation:fadeIn .2s ease;}',
      '#sizePopup .size-popup-card{position:relative;z-index:2;',
      'width:100%;max-width:400px;border-radius:18px;overflow:hidden;',
      'background:linear-gradient(180deg,#0B1F3A 0%,#081428 100%);',
      'border-top:3px solid #C9A24B;color:#fff;',
      'box-shadow:0 24px 60px rgba(0,0,0,.5);',
      'animation:popIn .25s ease;}',
      '#sizePopup .popup-inner{padding:32px 26px 26px;text-align:center;}',
      '#sizePopup .popup-title{color:#E3C87F;',
      'font-family:"Playfair Display",Georgia,serif;',
      'font-size:22px;font-weight:600;margin:0 0 10px;line-height:1.3;}',
      '#sizePopup .popup-subtitle{color:rgba(255,255,255,.86);',
      'white-space:pre-line;font-size:14px;line-height:1.6;margin:0 0 22px;}',
      '#sizePopup .popup-btn{display:inline-block;padding:11px 28px;',
      'border-radius:999px;border:0;',
      'background:linear-gradient(180deg,#D4AF63 0%,#C9A24B 100%);',
      'color:#0B1F3A;font-family:inherit;font-size:13px;font-weight:600;',
      'letter-spacing:.08em;text-transform:uppercase;cursor:pointer;',
      'box-shadow:0 8px 22px rgba(201,162,75,.4);',
      'transition:filter .15s ease,transform .15s ease;}',
      '#sizePopup .popup-btn:hover{filter:brightness(1.06);}',
      '#sizePopup .popup-btn:active{transform:translateY(1px);}',

      '@media (max-width:600px){',
      '.vrt-summary{grid-template-columns:1fr;gap:16px;text-align:center;}',
      '.vrt-summary-right{text-align:left;}',
      '#sizePopup .popup-inner{padding:28px 20px 22px;}',
      '#sizePopup .popup-title{font-size:20px;}',
      '}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'vionaRuntimeStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ==========================================================================
     6. LOAD SITE SETTINGS
     ========================================================================== */

  async function loadSettings() {
    var defaults = {
      business: {
        business_name: CFG.BUSINESS_NAME || 'Viona Bangles',
        whatsapp: CFG.WHATSAPP_NUMBER || '',
        email: CFG.EMAIL || '',
        phone: '',
        city: CFG.CITY || '',
        hours: CFG.HOURS || ''
      },
      hero: {
        label: 'Handcrafted in Gaya, Bihar',
        heading: 'Timeless Bangles, Made for You',
        text: 'Premium glass and traditional bangles, handpicked for every occasion.'
      },
      about: {
        heading: 'About Viona Bangles',
        text: 'Viona Bangles is a small family workshop in Gaya, Bihar. Every bangle is finished by hand and checked before it is packed for you.'
      },
      policies: {
        delivery: 'We ship to all pin codes in India. Delivery usually takes 3 to 7 working days.',
        payment: 'We accept UPI, bank transfer and Cash on Delivery on most pin codes.',
        returns: 'Damaged or wrong items can be returned within 7 days of delivery.'
      },
      trust: { points: ['Free shipping on prepaid orders','Cash on Delivery available','Easy 7 day return'] },
      social: { instagram: '', facebook: '', youtube: '' }
    };

    var merged = {
      business: Object.assign({}, defaults.business),
      hero:     Object.assign({}, defaults.hero),
      about:    Object.assign({}, defaults.about),
      policies: Object.assign({}, defaults.policies),
      trust:    Object.assign({}, defaults.trust),
      social:   Object.assign({}, defaults.social)
    };

    if (!SUPABASE_READY || !sb) return merged;

    try {
      var res = await sb.from('site_settings').select('*');
      if (res && res.error) throw res.error;
      var rows = (res && res.data) || [];

      if (rows.length && Object.prototype.hasOwnProperty.call(rows[0], 'key')) {
        rows.forEach(function (row) {
          if (!row || row.key == null) return;
          var key = String(row.key);
          var val = row.value;

          if (merged[key] && typeof merged[key] === 'object' &&
              !Array.isArray(merged[key]) && val && typeof val === 'object') {
            merged[key] = Object.assign({}, merged[key], val);
          } else {
            merged[key] = val;
          }

          if (key === 'whatsapp_number' && val) merged.business.whatsapp = String(val);
          if (key === 'phone' && val) merged.business.phone = String(val);
          if (key === 'contact_email' && val) merged.business.email = String(val);
          if (key === 'address' && val) merged.business.city = String(val);
          if (key === 'instagram_url' && val) merged.social.instagram = String(val);
          if (key === 'facebook_url' && val) merged.social.facebook = String(val);
        });

        var offerRow = rows.find(function (r) { return r && r.key === 'offer_text'; });
        if (offerRow) merged.offer_text = String(offerRow.value || '');

        var linkRow = rows.find(function (r) { return r && r.key === 'offer_link'; });
        if (linkRow) merged.offer_link = String(linkRow.value || '');

        var activeRow = rows.find(function (r) { return r && r.key === 'offer_active'; });
        if (!activeRow) {
          activeRow = rows.find(function (r) { return r && r.key === 'offer_enabled'; });
        }
        if (activeRow) {
          var activeVal = (activeRow.value === true ||
                           String(activeRow.value).toLowerCase() === 'true');
          merged.offer_active = activeVal;
          merged.offer_enabled = activeVal;
        }
      } else {
        var first = rows[0] || {};
        Object.keys(first).forEach(function (k) {
          if (merged[k] && typeof merged[k] === 'object' && !Array.isArray(merged[k]) &&
              first[k] && typeof first[k] === 'object') {
            merged[k] = Object.assign({}, merged[k], first[k]);
          } else {
            merged[k] = first[k];
          }
        });
      }
    } catch (e) {
      logError('loadSettings', e);
    }

    return merged;
  }

  function applySettings() {
    var s = state.settings || {};
    var b = s.business || {};
    var h = s.hero || {};
    var a = s.about || {};
    var t2 = s.trust || {};
    var soc = s.social || {};

    var waNum = b.whatsapp || CFG.WHATSAPP_NUMBER || '';
    var waMsg = 'Hello Viona Bangles, I would like to know more about your bangles.';

    /* Only fill hero/about fields if the site_content has not provided a
       value — otherwise we would overwrite the editable data from brand.js. */
    function setIfEmpty(id, value) {
      var node = el(id);
      if (!node) return;
      if (node.getAttribute('data-content')) return; // brand.js handles it
      if (!node.textContent || !node.textContent.trim()) {
        if (value) node.textContent = value;
      }
    }

    setIfEmpty('heroLabel', h.label);
    setIfEmpty('heroHeading', h.heading);
    setIfEmpty('heroText', h.text);

    setIfEmpty('aboutHeading', a.heading);
    setIfEmpty('aboutText', a.text);

    var aboutPoints = el('aboutPoints');
    if (aboutPoints && !aboutPoints.getAttribute('data-content')) {
      var pts = Array.isArray(t2.points) ? t2.points : [];
      var pptHtml = '';
      pts.forEach(function (p) { if (p) pptHtml += '<li>' + esc(p) + '</li>'; });
      aboutPoints.innerHTML = pptHtml;
    }

    var trustSection = el('trustSection');
    var trustList = el('trustList');
    if (trustSection && trustList) {
      var trustPts = Array.isArray(t2.points) ? t2.points : [];
      var trustHtml = '';
      trustPts.forEach(function (p) {
        if (!p) return;
        trustHtml += '<li class="trust-item"><span class="trust-mark" aria-hidden="true">✦</span>' + esc(p) + '</li>';
      });
      if (trustHtml) {
        trustList.innerHTML = trustHtml;
        trustSection.hidden = false;
      } else {
        trustSection.hidden = true;
      }
    }

    var cCity  = el('contactCity');
    if (cCity && !cCity.getAttribute('data-content')) cCity.textContent = b.city || CFG.CITY || '';
    var cHours = el('contactHours');
    if (cHours && !cHours.getAttribute('data-content')) cHours.textContent = b.hours || CFG.HOURS || '';

    var cEmail = el('contactEmail');
    if (cEmail) {
      var email = b.email || CFG.EMAIL || '';
      cEmail.textContent = email;
      cEmail.href = email ? ('mailto:' + email) : '#';
    }

    var cPhone = el('contactPhone');
    if (cPhone && !cPhone.getAttribute('data-content')) {
      cPhone.textContent = '+' + String(waNum).replace(/^\+/, '');
      cPhone.href = waLink(waNum, waMsg);
    }

    var fCity = el('footerCity');
    if (fCity && !fCity.getAttribute('data-content')) fCity.textContent = b.city || CFG.CITY || '';
    var fHours = el('footerHours');
    if (fHours && !fHours.getAttribute('data-content')) fHours.textContent = b.hours || CFG.HOURS || '';

    var fEmail = el('footerEmail');
    if (fEmail) {
      var fe = b.email || CFG.EMAIL || '';
      fEmail.textContent = fe;
      fEmail.href = fe ? ('mailto:' + fe) : '#';
    }

    var fWa = el('footerWhatsApp'); if (fWa) fWa.href = waLink(waNum, waMsg);
    var hWa = el('headerWhatsApp'); if (hWa) hWa.href = waLink(waNum, waMsg);
    var heroWa = el('heroWhatsApp'); if (heroWa) heroWa.href = waLink(waNum, waMsg);
    var cWa = el('contactWhatsApp'); if (cWa) cWa.href = waLink(waNum, waMsg);
    var mWa = el('mobileMenuWhatsApp'); if (mWa) mWa.href = waLink(waNum, waMsg);

    var socialWrap = el('contactSocial');
    if (socialWrap) {
      var socialHtml = '';
      if (soc.instagram) socialHtml += '<a class="social-link" href="' + escAttr(soc.instagram) + '" target="_blank" rel="noopener">Instagram</a>';
      if (soc.facebook)  socialHtml += '<a class="social-link" href="' + escAttr(soc.facebook)  + '" target="_blank" rel="noopener">Facebook</a>';
      if (soc.youtube)   socialHtml += '<a class="social-link" href="' + escAttr(soc.youtube)   + '" target="_blank" rel="noopener">YouTube</a>';
      socialWrap.innerHTML = socialHtml;
    }

    var y = el('footerYear');
    if (y && !y.parentNode.getAttribute('data-content')) y.textContent = String(new Date().getFullYear());
  }

  /* ==========================================================================
     7. PRODUCTS — column detection + load
     ========================================================================== */

  async function detectProductColumns() {
    if (state.R) return state.R;

    var res = await sb.from('products').select('*').limit(1);
    if (res && res.error) {
      logError('products select * limit 1', res.error);
      throw res.error;
    }

    var row = (res && res.data && res.data[0]) || null;
    state.productCols = row ? Object.keys(row) : null;

    if (!state.productCols) {
      state.R = {
        known: false,
        id: 'id', name: 'name', price: 'price', old_price: 'old_price',
        category: 'category', sizes: 'sizes', description: 'description',
        main_image: 'main_image', additional_images: 'additional_images',
        code: 'code', featured: 'featured', is_active: 'is_active',
        stock_status: 'stock_status', created_at: 'created_at'
      };
      return state.R;
    }

    var cols = state.productCols;
    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        if (cols.indexOf(arguments[i]) !== -1) return arguments[i];
      }
      return null;
    }

    state.R = {
      known: true,
      id: 'id',
      name: pick('name', 'title'),
      price: pick('price'),
      old_price: pick('old_price', 'compare_price', 'original_price'),
      category: pick('category'),
      sizes: pick('sizes', 'size'),
      description: pick('description', 'details'),
      main_image: pick('main_image', 'image_url', 'image'),
      additional_images: pick('additional_images', 'gallery', 'images'),
      code: pick('code', 'product_code', 'sku'),
      featured: pick('featured', 'is_featured'),
      is_active: pick('is_active', 'active', 'visible'),
      stock_status: pick('stock_status', 'stock'),
      created_at: pick('created_at')
    };

    return state.R;
  }

  async function loadProducts() {
    state.products = [];
    state.filtered = [];
    state.loaded = false;
    state.loadError = false;

    if (!SUPABASE_READY || !sb) {
      logError('loadProducts', 'Supabase is not ready.');
      state.loadError = true;
      state.loaded = true;
      return;
    }

    try {
      await detectProductColumns();
      var R = state.R;

      var q = sb.from('products').select('*');
      if (R.known && R.created_at) {
        q = q.order(R.created_at, { ascending: false });
      } else if (R.known) {
        q = q.order('id', { ascending: false });
      }

      var res = await q;
      if (res && res.error) {
        logError('products select', res.error);
        throw res.error;
      }

      var rows = (res && res.data) || [];
      var visibleRows = rows.filter(function (row) {
        if (!row) return false;
        var v = row.is_active;
        if (v === false || v === 0) return false;
        if (typeof v === 'string' && v.trim().toLowerCase() === 'false') return false;
        return true;
      });

      state.products = visibleRows.map(normalizeProduct).filter(Boolean);
      state.loaded = true;
    } catch (e) {
      logError('loadProducts', e);
      state.products = [];
      state.loadError = true;
      state.loaded = true;
    }
  }

  function normalizeProduct(p) {
    if (!p) return null;
    var R = state.R || {};
    var row = p;

    var id = (R.id && row[R.id] != null) ? Number(row[R.id]) : Number(row.id || 0);
    var name = (R.name && row[R.name] != null) ? String(row[R.name]) : String(row.name || 'Untitled');
    var category = (R.category && row[R.category] != null) ? String(row[R.category]) : String(row.category || 'other');
    var price = (R.price && row[R.price] != null) ? Number(row[R.price]) : Number(row.price || 0);

    var oldPrice = null;
    var oldRaw = (R.old_price && row[R.old_price] != null) ? row[R.old_price] : row.old_price;
    if (oldRaw != null && oldRaw !== '') oldPrice = Number(oldRaw);
    if (isNaN(oldPrice) || oldPrice <= 0) oldPrice = null;
    if (oldPrice != null && !(oldPrice > price)) oldPrice = null;

    /* Sizes — JSON first, then array, then CSV. Default only when null. */
    var sizesRaw = (R.sizes && row[R.sizes] != null) ? row[R.sizes] : row.sizes;
    var sizes;
    if (sizesRaw === null || sizesRaw === undefined) {
      sizes = [];
    } else if (Array.isArray(sizesRaw)) {
      sizes = sizesRaw.map(String);
    } else if (typeof sizesRaw === 'string') {
      var trimmedSizes = sizesRaw.trim();
      if (!trimmedSizes) {
        sizes = [];
      } else {
        var parsedSizes = null;
        try {
          var jsonSizes = JSON.parse(trimmedSizes);
          if (Array.isArray(jsonSizes)) parsedSizes = jsonSizes;
        } catch (e) { /* fall through */ }
        if (parsedSizes) {
          sizes = parsedSizes.map(String);
        } else {
          sizes = trimmedSizes.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        }
      }
    } else {
      sizes = [];
    }

    var desc = (R.description && row[R.description] != null) ? String(row[R.description]) : String(row.description || '');
    var mainImage = (R.main_image && row[R.main_image] != null) ? String(row[R.main_image]) : String(row[R.main_image] || '');

    var more = [];
    var moreRaw = (R.additional_images && row[R.additional_images] != null)
      ? row[R.additional_images] : row.additional_images;
    if (Array.isArray(moreRaw)) {
      more = moreRaw.filter(Boolean).map(String);
    } else if (typeof moreRaw === 'string' && moreRaw.trim()) {
      try {
        var parsed = JSON.parse(moreRaw);
        if (Array.isArray(parsed)) more = parsed.filter(Boolean).map(String);
      } catch (e) { /* ignore */ }
    }

    var code = (R.code && row[R.code] != null) ? String(row[R.code]) : (row.code ? String(row.code) : '');
    var stockRaw = (R.stock_status && row[R.stock_status] != null) ? row[R.stock_status] : row.stock_status;

    return {
      id: id,
      name: name,
      category: category,
      price: price,
      old_price: oldPrice,
      sizes: sizes,
      description: desc,
      main_image: mainImage,
      additional_images: more,
      code: code,
      is_active: true,
      featured: !!(R.featured ? row[R.featured] : row.featured),
      stock_status: normalizeStock(stockRaw),
      created_at: row.created_at || null
    };
  }

  function productImages(p) {
    if (!p) return [];
    var imgs = [];
    if (p.main_image) imgs.push(p.main_image);
    if (Array.isArray(p.additional_images)) {
      p.additional_images.forEach(function (u) {
        if (u && imgs.indexOf(u) === -1) imgs.push(u);
      });
    }
    return imgs;
  }

  /* ==========================================================================
     8. CATEGORY STRIP
     ========================================================================== */

  function buildCategories() {
    var set = {};
    state.products.forEach(function (p) {
      if (p.category) set[p.category] = true;
    });
    var cats = Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
    state.categories = ['All'].concat(cats);
    renderCategoryStrip();
  }

  function renderCategoryStrip() {
    var wrap = el('categoryStripInner');
    var root = el('categoryStrip');
    if (!wrap || !root) return;

    if (!state.categories.length || state.categories.length === 1) {
      root.hidden = true;
      return;
    }

    var html = '';
    state.categories.forEach(function (c) {
      var active = (c === state.activeCategory) ? ' is-active' : '';
      var label = (c === 'All') ? 'All' : (c.charAt(0).toUpperCase() + c.slice(1));
      html += '<button type="button" class="cat-chip' + active + '" data-cat="' +
              escAttr(c) + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' +
              esc(label) + '</button>';
    });
    wrap.innerHTML = html;
    root.hidden = false;
  }

  /* ==========================================================================
     9. REVIEWS — fetch once, group by product_id
     ========================================================================== */

  function reviewStatsFor(productId) {
    var key = String(productId);
    var list = state.reviewsByProduct[key] || [];

    var stats = { 5:0, 4:0, 3:0, 2:0, 1:0 };
    var sum = 0, total = 0;

    list.forEach(function (r) {
      var rt = readRatingValue(r);
      if (rt < 1 || rt > 5) return;
      stats[rt]++;
      sum += rt;
      total++;
    });

    var avg = total ? (sum / total) : 0;
    avg = Math.round(avg * 10) / 10;

    return { stats: stats, total: total, average: avg, list: list };
  }

  async function loadAllReviews() {
    state.allReviews = [];
    state.reviewsByProduct = {};

    if (!SUPABASE_READY || !sb) return;

    try {
      var res = await sb
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false });

      if (res && res.error) {
        logError('reviews select', res.error);
        throw res.error;
      }

      var rows = (res && res.data) || [];
      state.allReviews = rows;

      rows.forEach(function (r) {
        if (!r) return;
        var key = String(r.product_id);
        if (!state.reviewsByProduct[key]) state.reviewsByProduct[key] = [];
        state.reviewsByProduct[key].push(r);
      });
    } catch (e) {
      logError('loadAllReviews', e);
      state.allReviews = [];
      state.reviewsByProduct = {};
    }
  }

  function currentUserReviewFor(productId) {
    if (!state.currentUser) return null;
    var key = String(productId);
    var list = state.reviewsByProduct[key] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].user_id === state.currentUser.id) return list[i];
    }
    return null;
  }

  function starsRowHtml(average, size) {
    var av = Number(average) || 0;
    if (av < 0) av = 0;
    if (av > 5) av = 5;
    var pct = (av / 5) * 100;
    var fs = size || 15;
    return '' +
      '<span class="vrt-stars" style="font-size:' + fs + 'px" aria-label="' +
        av.toFixed(1) + ' out of 5">' +
        '<span class="vrt-stars-bg" aria-hidden="true">★★★★★</span>' +
        '<span class="vrt-stars-fg" style="width:' + pct.toFixed(2) + '%" aria-hidden="true">★★★★★</span>' +
      '</span>';
  }

  function starsSolidHtml(rating) {
    var r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var on = '';
    for (var i = 1; i <= 5; i++) {
      on += '<span style="color:' + (i <= r ? '#C9A24B' : '#E4DFD3') + '">★</span>';
    }
    return '<span class="vrt-stars" aria-label="' + r + ' out of 5">' + on + '</span>';
  }

  /* ==========================================================================
     10. PRODUCT GRID + EMPTY STATES
     ========================================================================== */

  function applyFilters() {
    var term = (state.searchTerm || '').trim().toLowerCase();
    var cat = state.activeCategory || 'All';

    state.filtered = state.products.filter(function (p) {
      if (cat !== 'All' && p.category !== cat) return false;
      if (!term) return true;
      var hay = (
        p.name + ' ' + p.category + ' ' +
        (p.description || '') + ' ' + productCode(p.id, p.code)
      ).toLowerCase();
      return hay.indexOf(term) !== -1;
    });

    renderGrid();
  }

  function setEmptyState(title, text, showReset) {
    var titleEl = el('emptyTitle');
    var textEl = el('emptyText');
    var resetBtn = el('emptyReset');
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (resetBtn) resetBtn.hidden = !showReset;
  }

  function renderGrid() {
    var grid = el('productGrid');
    var emptyBox = el('emptyBox');
    var showing = el('showingCount');
    var skel = el('productSkeletons');

    if (skel) skel.hidden = true;
    if (!grid) return;

    var list = state.filtered;
    var hasProducts = state.products.length > 0;

    if (showing) {
      if (!hasProducts) {
        showing.hidden = true;
        showing.textContent = 'Showing 0 bangles';
      } else {
        showing.hidden = false;
        var count = list.length;
        showing.textContent = 'Showing ' + count + ' ' + (count === 1 ? 'bangle' : 'bangles');
      }
    }

    if (!list.length) {
      grid.innerHTML = '';
      if (emptyBox) {
        emptyBox.hidden = false;
        if (state.loadError) {
          setEmptyState('Could not load products.', 'Please refresh the page.', false);
        } else if (!hasProducts) {
          var emptyMsg = t('empty_products_message',
            'No products available right now. Please check back soon.');
          setEmptyState('Nothing to show yet', emptyMsg, false);
        } else {
          setEmptyState('No products found.', 'Try another category or search.', true);
        }
      }
      return;
    }

    if (emptyBox) emptyBox.hidden = true;

    var html = '';
    list.forEach(function (p) {
      var imgs = productImages(p);
      var off = discountPct(p.price, p.old_price);
      var stats = reviewStatsFor(p.id);
      var stock = normalizeStock(p.stock_status);
      var isOut = stock === 'out_of_stock';

      var mediaHtml = '';
      if (imgs.length) {
        mediaHtml =
          '<img class="card-img" src="' + escAttr(imgs[0]) + '" alt="' + escAttr(p.name) + '" loading="lazy" ' +
          'onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.card-placeholder\').hidden=false;" />' +
          '<div class="card-placeholder" hidden><span>Viona</span></div>';
      } else {
        mediaHtml = '<div class="card-placeholder"><span>Viona</span></div>';
      }

      var ribbonHtml = isOut
        ? '<span class="card-ribbon" aria-hidden="true">Out of stock</span>'
        : '';

      var badgeHtml = off > 0 ? '<span class="card-badge">' + off + '% OFF</span>' : '';
      var featHtml  = p.featured ? '<span class="card-featured">Featured</span>' : '';

      var priceHtml = '<span class="price-now">' + esc(money(p.price)) + '</span>';
      if (off > 0) {
        priceHtml += '<span class="price-old">' + esc(money(p.old_price)) + '</span>';
      }

      var lowStockHtml = stock === 'low_stock'
        ? '<p class="card-lowstock">Only few left</p>'
        : '';

      var ratingHtml = '';
      if (stats.total > 0) {
        ratingHtml =
          '<p class="vrt-card-rating">' +
            starsRowHtml(stats.average, 13) +
            '<span class="vrt-avg">' + stats.average.toFixed(1) + '</span>' +
            '<span class="vrt-total">(' + stats.total + ')</span>' +
          '</p>';
      } else {
        ratingHtml = '<p class="vrt-card-rating"><span class="vrt-noreviews">No reviews yet</span></p>';
      }

      html +=
        '<article class="product-card" data-id="' + escAttr(String(p.id)) + '">' +
          '<div class="card-media' + (isOut ? ' is-out' : '') + '">' +
            badgeHtml + featHtml + mediaHtml + ribbonHtml +
          '</div>' +
          '<div class="card-body">' +
            '<p class="card-cat">' + esc(p.category) + '</p>' +
            '<h3 class="card-name">' + esc(p.name) + '</h3>' +
            ratingHtml +
            '<div class="card-price">' + priceHtml + '</div>' +
            lowStockHtml +
            '<button type="button" class="card-open" data-open="' + escAttr(String(p.id)) + '">View Details</button>' +
          '</div>' +
        '</article>';
    });

    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll('[data-open]'), function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = Number(btn.getAttribute('data-open'));
        openProductById(id);
      });
    });

    Array.prototype.forEach.call(grid.querySelectorAll('.product-card'), function (card) {
      card.addEventListener('click', function () {
        var id = Number(card.getAttribute('data-id'));
        openProductById(id);
      });
    });
  }

  /* ==========================================================================
     11. SEARCH + LIVE SUGGESTIONS
     ========================================================================== */

  function setupSearch() {
    var form  = el('searchForm');
    var input = el('searchInput');
    var clear = el('searchClear');
    var sugg  = el('searchSuggest');
    if (!input || !form) return;

    var debouncedSuggest = debounce(function () {
      renderSuggestions(input.value);
    }, 200);

    input.addEventListener('input', function () {
      if (clear) clear.hidden = !input.value;
      debouncedSuggest();
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) renderSuggestions(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (!sugg || sugg.hidden) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSearch(input.value);
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (state.suggestIndex >= 0 && state.suggestItems[state.suggestIndex]) {
          var item = state.suggestItems[state.suggestIndex];
          closeSuggestions();
          openProductById(item.id);
        } else {
          submitSearch(input.value);
        }
      } else if (e.key === 'Escape') {
        closeSuggestions();
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitSearch(input.value);
    });

    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        clear.hidden = true;
        closeSuggestions();
        input.focus();
      });
    }

    document.addEventListener('click', function (e) {
      if (!sugg || sugg.hidden) return;
      var sw = el('searchWrap');
      if (sw && !sw.contains(e.target)) closeSuggestions();
    });
  }

  function submitSearch(term) {
    state.searchTerm = String(term || '').trim();
    state.activeCategory = 'All';
    renderCategoryStrip();
    applyFilters();
    closeSuggestions();
    scrollToCollections();
  }

  function scrollToCollections() {
    var target = el('collections');
    if (!target) return;
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { target.scrollIntoView(); }
  }

  function renderSuggestions(q) {
    var wrap = el('searchSuggest');
    var input = el('searchInput');
    if (!wrap) return;

    var term = String(q || '').trim().toLowerCase();
    if (!term) { closeSuggestions(); return; }

    var matches = state.products.filter(function (p) {
      var hay = (
        p.name + ' ' + p.category + ' ' +
        (p.description || '') + ' ' + productCode(p.id, p.code)
      ).toLowerCase();
      return hay.indexOf(term) !== -1;
    }).slice(0, 6);

    if (!matches.length) {
      wrap.innerHTML = '<p class="suggest-empty">No products matched “' + esc(q) + '”.</p>';
      wrap.hidden = false;
      state.suggestItems = [];
      state.suggestIndex = -1;
      if (input) input.setAttribute('aria-expanded', 'true');
      return;
    }

    var html = '';
    matches.forEach(function (p, i) {
      var imgs = productImages(p);
      var thumb = imgs.length
        ? '<img class="suggest-thumb" src="' + escAttr(imgs[0]) + '" alt="" loading="lazy" />'
        : '<span class="suggest-thumb-ph" aria-hidden="true">V</span>';

      html +=
        '<button type="button" class="suggest-item" role="option" data-idx="' + i + '" data-id="' + escAttr(String(p.id)) + '">' +
          thumb +
          '<span class="suggest-text">' +
            '<span class="suggest-name">' + esc(p.name) + '</span>' +
            '<span class="suggest-meta">' + esc(productCode(p.id, p.code)) + ' · ' + esc(p.category) + '</span>' +
          '</span>' +
          '<span class="suggest-price">' + esc(money(p.price)) + '</span>' +
        '</button>';
    });

    wrap.innerHTML = html;
    wrap.hidden = false;
    state.suggestItems = matches;
    state.suggestIndex = -1;
    if (input) input.setAttribute('aria-expanded', 'true');

    Array.prototype.forEach.call(wrap.querySelectorAll('.suggest-item'), function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-id'));
        closeSuggestions();
        openProductById(id);
      });
      btn.addEventListener('mouseenter', function () {
        state.suggestIndex = Number(btn.getAttribute('data-idx'));
        highlightSuggestion();
      });
    });
  }

  function moveSuggest(dir) {
    if (!state.suggestItems.length) return;
    var n = state.suggestItems.length;
    state.suggestIndex = (state.suggestIndex + dir + n) % n;
    highlightSuggestion();
  }

  function highlightSuggestion() {
    var wrap = el('searchSuggest');
    if (!wrap) return;
    var items = wrap.querySelectorAll('.suggest-item');
    Array.prototype.forEach.call(items, function (n, i) {
      if (i === state.suggestIndex) n.classList.add('is-active');
      else n.classList.remove('is-active');
    });
  }

  function closeSuggestions() {
    var wrap = el('searchSuggest');
    var input = el('searchInput');
    if (wrap) { wrap.hidden = true; wrap.innerHTML = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
    state.suggestIndex = -1;
    state.suggestItems = [];
  }

  /* ==========================================================================
     12. PRODUCT MODAL
     ========================================================================== */

  var lastFocusedBeforeModal = null;

  function openProductById(id) {
    var product = state.products.find(function (p) { return Number(p.id) === Number(id); });
    if (!product) return;
    openProduct(product);
  }

  function openProduct(product) {
    if (!product) return;

    state.currentProduct = product;
    state.currentSize = null;
    state.currentImageIndex = 0;
    state.galleryImages = productImages(product);
    state.editingReview = false;
    state.reviewSort = 'newest';
    state.pickerRating = 0;
    clearReviewFile();

    try {
      var newHash = '#product=' + productCode(product.id, product.code);
      if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
      }
    } catch (e) { /* ignore */ }

    var codeEl = el('modalCode');   if (codeEl) codeEl.textContent = productCode(product.id, product.code);
    var titleEl = el('modalTitle'); if (titleEl) titleEl.textContent = product.name;
    var descEl = el('modalDesc');   if (descEl) descEl.textContent = product.description || '';

    renderModalPrice(product);
    renderGallery(product);
    renderSizes(product);
    updateModalWhatsApp();
    renderDetailRows(product);
    switchTab('details');

    renderModalRatingBadge();
    renderReviewSummary();
    renderReviewList();
    renderUserChip();
    renderReviewFormOrCTA();
    updateTabReviewCount();

    var modal = el('productModal');
    if (modal) {
      lastFocusedBeforeModal = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('no-scroll');
      setTimeout(function () {
        var c = el('modalClose');
        if (c) try { c.focus(); } catch (e) {}
      }, 50);
    }
  }

  function closeProductModal() {
    var modal = el('productModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
    state.currentProduct = null;
    closeSizePopup();

    try {
      if (window.location.hash && window.location.hash.indexOf('#product=') === 0) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }

    if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
      try { lastFocusedBeforeModal.focus(); } catch (e) {}
    }
  }

  function renderModalPrice(p) {
    var wrap = el('modalPrice');
    if (!wrap) return;
    var off = discountPct(p.price, p.old_price);
    var html = '<span class="price-now">' + esc(money(p.price)) + '</span>';
    if (off > 0) {
      html += '<span class="price-old">' + esc(money(p.old_price)) + '</span>';
      html += '<span class="price-off">' + off + '% OFF</span>';
    }
    wrap.innerHTML = html;
  }

  function renderGallery(p) {
    var mainImg = el('galleryMainImg');
    var ph      = el('galleryPlaceholder');
    var badge   = el('galleryBadge');
    var thumbs  = el('galleryThumbs');
    if (!mainImg) return;

    var imgs = state.galleryImages;

    if (imgs.length) {
      mainImg.src = imgs[0];
      mainImg.alt = p.name;
      mainImg.hidden = false;
      if (ph) ph.hidden = true;
    } else {
      mainImg.removeAttribute('src');
      mainImg.hidden = true;
      if (ph) ph.hidden = false;
    }

    var off = discountPct(p.price, p.old_price);
    if (badge) {
      if (off > 0) {
        badge.textContent = off + '% OFF';
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    if (thumbs) {
      if (imgs.length > 1) {
        var html = '';
        imgs.forEach(function (u, i) {
          html += '<button type="button" class="gallery-thumb' + (i === 0 ? ' is-active' : '') +
                  '" data-idx="' + i + '" aria-label="Image ' + (i + 1) + '">' +
                  '<img src="' + escAttr(u) + '" alt="" loading="lazy" />' +
                  '</button>';
        });
        thumbs.innerHTML = html;
        thumbs.hidden = false;

        Array.prototype.forEach.call(thumbs.querySelectorAll('.gallery-thumb'), function (btn) {
          btn.addEventListener('click', function () {
            var idx = Number(btn.getAttribute('data-idx'));
            setGalleryImage(idx);
          });
        });
      } else {
        thumbs.innerHTML = '';
        thumbs.hidden = true;
      }
    }
  }

  function setGalleryImage(idx) {
    var imgs = state.galleryImages;
    if (!imgs.length) return;
    if (idx < 0) idx = 0;
    if (idx >= imgs.length) idx = imgs.length - 1;
    state.currentImageIndex = idx;

    var mainImg = el('galleryMainImg');
    if (mainImg) { mainImg.src = imgs[idx]; mainImg.hidden = false; }
    var ph = el('galleryPlaceholder');
    if (ph) ph.hidden = true;

    var thumbs = el('galleryThumbs');
    if (thumbs) {
      Array.prototype.forEach.call(thumbs.querySelectorAll('.gallery-thumb'), function (btn, i) {
        if (i === idx) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
      });
    }
  }

  /* --------------------------------------------------------------------------
     renderSizes — DAY 12 TASK 2
     Builds chips from master list (site_content.all_sizes) + product sizes.
     Available sizes are selectable and flow into the WhatsApp message.
     Unavailable sizes are dimmed; clicking one opens the premium popup.
     Product with NO sizes → section hidden.
     Product out_of_stock → all chips disabled, no popup on click.
     -------------------------------------------------------------------------- */
  function renderSizes(p) {
    var wrap = el('modalSizes');
    var section = el('modalSizesWrap');
    if (!wrap || !section) return;

    var chips = buildSizeChips(p);
    if (!chips || !chips.length) {
      section.hidden = true;
      section.classList.remove('is-disabled');
      wrap.innerHTML = '';
      state.currentSize = null;
      return;
    }

    section.hidden = false;
    section.classList.remove('is-disabled');

    var outOfStock = normalizeStock(p.stock_status) === 'out_of_stock';
    if (outOfStock) section.classList.add('is-disabled');

    var html = '';
    chips.forEach(function (item) {
      var clickable = item.available && !outOfStock;
      var sizeAvailable = !!item.available;
      var dimmed = !sizeAvailable || outOfStock;

      var cls = 'size-chip';
      if (dimmed) cls += ' is-unavailable';
      if (outOfStock) cls += ' is-disabled';

      html += '<button type="button" class="' + cls + '"' +
              ' role="radio" aria-checked="false"' +
              ' data-size="' + escAttr(item.label) + '"' +
              ' data-clickable="' + (clickable ? '1' : '0') + '"' +
              ' data-size-available="' + (sizeAvailable ? '1' : '0') + '"' +
              (outOfStock ? ' disabled' : '') + '>' +
              esc(item.label) + '</button>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.size-chip'), function (btn) {
      btn.addEventListener('click', function () {
        var clickable = btn.getAttribute('data-clickable') === '1';
        var sizeAvail = btn.getAttribute('data-size-available') === '1';
        var sizeLabel = btn.getAttribute('data-size');

        if (clickable) {
          Array.prototype.forEach.call(wrap.querySelectorAll('.size-chip'), function (b) {
            b.classList.remove('is-active');
            b.setAttribute('aria-checked', 'false');
          });
          btn.classList.add('is-active');
          btn.setAttribute('aria-checked', 'true');
          state.currentSize = sizeLabel;
          updateModalWhatsApp();
        } else if (!sizeAvail && !outOfStock) {
          openSizeUnavailablePopup(sizeLabel);
        }
        // out_of_stock: do nothing (button is disabled)
      });
    });

    if (!outOfStock) {
      var firstAvail = wrap.querySelector('.size-chip[data-clickable="1"]');
      if (firstAvail) {
        firstAvail.classList.add('is-active');
        firstAvail.setAttribute('aria-checked', 'true');
        state.currentSize = firstAvail.getAttribute('data-size');
      } else {
        state.currentSize = null;
      }
    } else {
      state.currentSize = null;
    }
  }

  /* --------------------------------------------------------------------------
     SIZE UNAVAILABLE POPUP — navy + gold, centered.
     Closes with button, outside click or Esc.
     -------------------------------------------------------------------------- */
  function openSizeUnavailablePopup(sizeLabel) {
    var root = el('popupRoot');
    if (!root) return;

    var title   = t('size_unavailable_title', 'Currently unavailable');
    var message = t('size_unavailable_message',
      'This size is not available right now. Please choose another size or message us on WhatsApp.');
    var btnLbl  = t('size_unavailable_button', 'OK');

    var fullMessage = 'Size ' + sizeLabel + ' — ' + message;

    root.innerHTML =
      '<div class="popup-overlay" id="sizePopup" role="dialog" aria-modal="true" ' +
        'aria-labelledby="sizePopupTitle">' +
        '<div class="popup-backdrop" data-popup-close></div>' +
        '<div class="size-popup-card" role="document">' +
          '<div class="popup-inner">' +
            '<h3 class="popup-title" id="sizePopupTitle">' + esc(title) + '</h3>' +
            '<p class="popup-subtitle">' + esc(fullMessage) + '</p>' +
            '<button type="button" class="popup-btn" data-popup-close>' + esc(btnLbl) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.hidden = false;
    document.body.classList.add('no-scroll');

    Array.prototype.forEach.call(root.querySelectorAll('[data-popup-close]'), function (b) {
      b.addEventListener('click', closeSizePopup);
    });
    document.addEventListener('keydown', sizePopupKeyHandler);

    setTimeout(function () {
      var okBtn = root.querySelector('.popup-btn');
      if (okBtn) try { okBtn.focus(); } catch (e) {}
    }, 40);
  }

  function sizePopupKeyHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSizePopup();
    }
  }

  function closeSizePopup() {
    var root = el('popupRoot');
    if (!root) return;
    root.innerHTML = '';
    root.hidden = true;
    // Only remove body scroll lock if the product modal isn't also open.
    if (!state.currentProduct) {
      document.body.classList.remove('no-scroll');
    }
    document.removeEventListener('keydown', sizePopupKeyHandler);
  }

  function updateModalWhatsApp() {
    var link = el('modalWhatsApp');
    var low  = el('modalLowStock');
    var out  = el('modalOutStock');
    var ask  = el('modalAskRestock');
    var p    = state.currentProduct;
    if (!link || !p) return;

    // Keep the Order button label in sync with site_content (fallback OK).
    var orderSpan = link.querySelector('[data-content="order_button_text"]');
    if (orderSpan) {
      orderSpan.textContent = t('order_button_text', 'Order on WhatsApp');
    }

    var num = (state.settings.business && state.settings.business.whatsapp) || CFG.WHATSAPP_NUMBER || '';
    var code = productCode(p.id, p.code);
    var sizePart = state.currentSize ? ('\nSize: ' + state.currentSize) : '';
    var orderMsg = 'Hello Viona Bangles,\n' +
                   'I would like to order:\n' +
                   '• ' + p.name + ' (' + code + ')\n' +
                   '• Price: ' + money(p.price) + sizePart + '\n\n' +
                   'Please share delivery details.';
    var askMsg = 'Hello Viona Bangles,\n' +
                 'I would like to know when "' + p.name + '" (' + code + ') ' +
                 'will be back in stock.\n\nThank you.';

    var stock = normalizeStock(p.stock_status);

    if (stock === 'out_of_stock') {
      link.hidden = true;
      if (low) low.hidden = true;
      if (out) out.hidden = false;
      if (ask) {
        ask.hidden = false;
        ask.href = waLink(num, askMsg);
      }
    } else {
      link.hidden = false;
      link.href = waLink(num, orderMsg);
      link.classList.remove('is-disabled');
      link.removeAttribute('aria-disabled');
      link.style.background = '';
      link.style.boxShadow = '';
      link.style.cursor = '';
      link.style.pointerEvents = '';

      if (out) out.hidden = true;
      if (ask) ask.hidden = true;
      if (low) low.hidden = (stock !== 'low_stock');
    }
  }

  function renderDetailRows(p) {
    var wrap = el('detailRows');
    if (!wrap) return;

    var pol = state.settings.policies || {};
    var rows = [
      { k: 'Product Code', v: productCode(p.id, p.code) },
      { k: 'Category',     v: p.category },
      { k: 'Available Sizes', v: (p.sizes && p.sizes.length ? p.sizes.join(', ') : '—') }
    ];
    if (pol.delivery) rows.push({ k: 'Delivery', v: pol.delivery });
    if (pol.payment)  rows.push({ k: 'Payment',  v: pol.payment });
    if (pol.returns)  rows.push({ k: 'Returns',  v: pol.returns });

    var html = '';
    rows.forEach(function (r) {
      html += '<div class="detail-row">' +
                '<span class="detail-key">' + esc(r.k) + '</span>' +
                '<span class="detail-val">' + esc(r.v) + '</span>' +
              '</div>';
    });
    wrap.innerHTML = html;
  }

  function switchTab(name) {
    var details = el('tabDetails');
    var reviews = el('tabReviews');
    var btnD = el('tabBtnDetails');
    var btnR = el('tabBtnReviews');
    if (!details || !reviews || !btnD || !btnR) return;

    if (name === 'reviews') {
      details.hidden = true; reviews.hidden = false;
      btnD.classList.remove('is-active'); btnD.setAttribute('aria-selected','false');
      btnR.classList.add('is-active');    btnR.setAttribute('aria-selected','true');
    } else {
      details.hidden = false; reviews.hidden = true;
      btnD.classList.add('is-active');    btnD.setAttribute('aria-selected','true');
      btnR.classList.remove('is-active'); btnR.setAttribute('aria-selected','false');
    }
  }

  function setupModalExtras() {
    var link = el('modalWhatsApp');
    if (!link) return;
    if (el('modalLowStock')) return;

    var wrap = link.parentElement;
    if (!wrap) return;

    var low = document.createElement('p');
    low.className = 'modal-lowstock';
    low.id = 'modalLowStock';
    low.hidden = true;
    low.textContent = 'Only few left — order soon';

    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'modal-outstock';
    out.id = 'modalOutStock';
    out.disabled = true;
    out.hidden = true;
    out.textContent = 'Currently out of stock';

    var ask = document.createElement('a');
    ask.className = 'modal-restock-link';
    ask.id = 'modalAskRestock';
    ask.hidden = true;
    ask.target = '_blank';
    ask.rel = 'noopener';
    ask.textContent = 'Ask when it will be back';

    wrap.insertBefore(low, link);
    wrap.appendChild(out);
    wrap.appendChild(ask);
  }

  function setupModal() {
    var modal = el('productModal');
    if (!modal) return;

    setupModalExtras();

    var closeBtn = el('modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeProductModal);

    Array.prototype.forEach.call(modal.querySelectorAll('[data-close-modal]'), function (b) {
      b.addEventListener('click', closeProductModal);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var lb = el('lightbox');
      if (lb && !lb.hidden) { closeLightbox(); return; }
      // If the size popup is open, let its own handler deal with Esc.
      if (el('sizePopup')) return;
      if (document.querySelector('.va-backdrop:not([hidden])')) return;
      if (!modal.hidden) closeProductModal();
    });

    var btnD = el('tabBtnDetails');
    var btnR = el('tabBtnReviews');
    if (btnD) btnD.addEventListener('click', function () { switchTab('details'); });
    if (btnR) btnR.addEventListener('click', function () { switchTab('reviews'); });

    var ratingBtn = el('modalRating');
    if (ratingBtn) {
      ratingBtn.addEventListener('click', function () {
        switchTab('reviews');
        var t2 = el('tabReviews');
        if (t2) try { t2.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      });
    }
  }

  /* ==========================================================================
     13. RATING UI — tab badge + summary box
     ========================================================================== */

  function updateTabReviewCount() {
    var span = el('tabReviewCount');
    if (!span || !state.currentProduct) return;
    var stats = reviewStatsFor(state.currentProduct.id);
    span.textContent = stats.total ? '(' + stats.total + ')' : '';
  }

  function renderModalRatingBadge() {
    var btn = el('modalRating');
    var stars = el('modalStars');
    var text = el('modalRatingText');
    if (!btn || !stars || !text || !state.currentProduct) return;

    var stats = reviewStatsFor(state.currentProduct.id);
    if (!stats.total) { btn.hidden = true; return; }

    stars.innerHTML = starsRowHtml(stats.average, 13);
    text.textContent = stats.average.toFixed(1) + ' · ' + stats.total + ' ' +
                       (stats.total === 1 ? 'review' : 'reviews');
    btn.hidden = false;
  }

  function renderReviewSummary() {
    var wrap = el('reviewsSummary');
    if (!wrap || !state.currentProduct) return;

    var stats = reviewStatsFor(state.currentProduct.id);

    var bigAvg = el('reviewsAverage');
    if (bigAvg) bigAvg.textContent = stats.total ? stats.average.toFixed(1) : '0.0';

    var avgStars = el('reviewsAverageStars');
    if (avgStars) avgStars.innerHTML = starsRowHtml(stats.average, 18);

    var totalEl = el('reviewsTotal');
    if (totalEl) {
      totalEl.textContent = stats.total
        ? (stats.total + ' ' + (stats.total === 1 ? 'review' : 'reviews'))
        : 'No reviews yet';
    }

    var barsWrap = el('reviewsBars');
    if (!barsWrap) return;

    if (stats.total === 0) {
      barsWrap.innerHTML = '';
      return;
    }

    var html = '';
    for (var star = 5; star >= 1; star--) {
      var count = stats.stats[star] || 0;
      var pct = Math.round((count / stats.total) * 100);
      html +=
        '<div class="vrt-bar-row" data-star="' + star + '">' +
          '<span class="vrt-bar-label">' + star + ' ★</span>' +
          '<span class="vrt-bar-track">' +
            '<span class="vrt-bar-fill" data-w="' + pct + '" style="width:0%"></span>' +
          '</span>' +
          '<span class="vrt-bar-count">' + count + '</span>' +
        '</div>';
    }
    barsWrap.innerHTML = html;

    requestAnimationFrame(function () {
      Array.prototype.forEach.call(barsWrap.querySelectorAll('.vrt-bar-fill'), function (fill) {
        var w = Number(fill.getAttribute('data-w')) || 0;
        fill.style.width = w + '%';
      });
    });
  }

  /* ==========================================================================
     14. REVIEWS LIST
     ========================================================================== */

  function renderReviewList() {
    var wrap = el('reviewsList');
    var empty = el('reviewsEmpty');
    var toolbar = el('reviewsToolbar');
    if (!wrap || !state.currentProduct) return;

    var stats = reviewStatsFor(state.currentProduct.id);
    var list = stats.list.slice();

    if (state.reviewSort === 'highest') {
      list.sort(function (a, b) {
        return (readRatingValue(b) - readRatingValue(a)) ||
               (new Date(b.created_at) - new Date(a.created_at));
      });
    } else if (state.reviewSort === 'lowest') {
      list.sort(function (a, b) {
        return (readRatingValue(a) - readRatingValue(b)) ||
               (new Date(b.created_at) - new Date(a.created_at));
      });
    } else {
      list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    }

    var myId = null;
    var myReview = currentUserReviewFor(state.currentProduct.id);
    if (myReview) myId = myReview.id;

    if (!list.length) {
      wrap.innerHTML = '';
      if (empty) empty.hidden = false;
      if (toolbar) toolbar.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (toolbar) toolbar.hidden = list.length < 2;

    var html = '';
    list.forEach(function (r) {
      var isOwn = (myId != null && r.id === myId);
      html += renderReviewCard(r, isOwn);
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-edit]'), function (b) {
      b.addEventListener('click', function () {
        state.editingReview = true;
        renderReviewFormOrCTA();
        var f = el('reviewFormWrap');
        if (f) try { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-delete]'), function (b) {
      b.addEventListener('click', function () { deleteMyReview(); });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-photo]'), function (b) {
      b.addEventListener('click', function () {
        var rid = Number(b.getAttribute('data-review-id'));
        openReviewLightbox(rid);
      });
    });
  }

  function renderReviewCard(r, isOwn) {
    var name = r.customer_name || 'Viona Customer';
    var initial = name.trim().charAt(0).toUpperCase() || 'V';

    var avatar = '<span class="vrt-av">' + esc(initial) + '</span>';
    var tagHtml = isOwn ? '<span class="vrt-rv-tag">Your review</span>' : '';

    var photosHtml = '';
    if (r.image_url) {
      photosHtml =
        '<div class="vrt-rv-photo">' +
          '<button type="button" data-review-photo data-review-id="' + escAttr(String(r.id)) + '" aria-label="Open photo">' +
            '<img src="' + escAttr(r.image_url) + '" alt="" loading="lazy" />' +
          '</button>' +
        '</div>';
    }

    var actionsHtml = '';
    if (isOwn) {
      actionsHtml =
        '<div class="vrt-rv-actions">' +
          '<button type="button" class="vrt-rv-act" data-review-edit>Edit</button>' +
          '<button type="button" class="vrt-rv-act danger" data-review-delete>Delete</button>' +
        '</div>';
    }

    return '' +
      '<article class="vrt-rv" data-review-card="' + escAttr(String(r.id)) + '">' +
        '<div class="vrt-rv-top">' +
          avatar +
          '<div class="vrt-rv-ident">' +
            '<p class="vrt-rv-name">' + esc(name) + (isOwn ? ' (You)' : '') + tagHtml + '</p>' +
            '<p class="vrt-rv-date">' + esc(formatDate(r.created_at)) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="vrt-rv-stars">' + starsSolidHtml(readRatingValue(r)) + '</div>' +
        '<p class="vrt-rv-text">' + esc(r.comment || '') + '</p>' +
        photosHtml +
        actionsHtml +
      '</article>';
  }

  /* ==========================================================================
     15. REVIEWS FORM
     ========================================================================== */

  function clearReviewFile() {
    if (state.reviewPreviewUrl) {
      try { URL.revokeObjectURL(state.reviewPreviewUrl); } catch (e) {}
    }
    state.reviewFile = null;
    state.reviewPreviewUrl = '';
  }

  function renderUserChip() {
    var chip = el('userChip');
    var avatar = el('userChipAvatar');
    var letter = el('userChipLetter');
    var nameEl = el('userChipName');
    var signOut = el('userChipSignOut');
    if (!chip || !avatar || !letter || !nameEl || !signOut) return;

    var u = state.currentUser;
    if (!u) { chip.hidden = true; return; }
    chip.hidden = false;

    var meta = u.user_metadata || {};
    var p = state.currentProfile || {};
    var display = String(p.name || meta.full_name || meta.name || u.email || 'Signed in').trim();
    var pic = p.avatar_url || meta.avatar_url || meta.picture || '';

    nameEl.textContent = display;

    if (pic) {
      avatar.src = pic;
      avatar.hidden = false;
      letter.hidden = true;
    } else {
      avatar.removeAttribute('src');
      avatar.hidden = true;
      letter.textContent = display.charAt(0).toUpperCase() || 'U';
      letter.hidden = false;
    }

    signOut.onclick = function () {
      if (window.VionaAuth) window.VionaAuth.logout();
    };
  }

  function renderReviewFormOrCTA() {
    var wrap = el('reviewFormWrap');
    if (!wrap || !state.currentProduct) return;

    if (!state.currentUser) {
      wrap.innerHTML =
        '<div class="vrt-cta">' +
          '<p class="vrt-cta-title">Share your experience</p>' +
          '<p class="vrt-cta-text">Login or create an account to write a review. It only takes a minute.</p>' +
          '<button type="button" class="vrt-btn vrt-btn-gold" id="ctaLoginBtn">Login to write a review</button>' +
        '</div>';

      var ctaBtn = el('ctaLoginBtn');
      if (ctaBtn) {
        ctaBtn.addEventListener('click', function () {
          if (window.VionaAuth) window.VionaAuth.openLogin();
        });
      }
      return;
    }

    var existing = currentUserReviewFor(state.currentProduct.id);
    if (existing && !state.editingReview) {
      wrap.innerHTML = '';
      return;
    }

    var isEdit = !!existing;
    var r = existing || {};
    var initialRating = readRatingValue(r);
    state.pickerRating = initialRating;

    wrap.innerHTML =
      '<div class="vrt-form">' +
        '<p class="vrt-form-title">' + (isEdit ? 'Edit your review' : 'Write a review') + '</p>' +
        '<p class="vrt-form-sub">Your feedback helps other shoppers.</p>' +

        '<div class="vrt-field">' +
          '<label>Your rating</label>' +
          '<div class="vrt-picker" id="starPicker" role="radiogroup" aria-label="Rating">' +
            starPickerHtml(initialRating) +
          '</div>' +
          '<p class="vrt-hint" id="starHint">' +
            (initialRating ? (initialRating + ' of 5') : 'Tap a star to rate') +
          '</p>' +
        '</div>' +

        '<div class="vrt-field">' +
          '<label for="reviewCommentInput">Your review *</label>' +
          '<textarea id="reviewCommentInput" class="vrt-textarea" maxlength="1000" ' +
            'placeholder="What did you like about these bangles?">' + esc(r.comment || '') + '</textarea>' +
          '<p class="vrt-hint">10 to 1000 characters.</p>' +
        '</div>' +

        '<div class="vrt-field">' +
          '<label>Add a photo (optional)</label>' +
          '<div class="vrt-photos" id="photoPicker"></div>' +
          '<input id="reviewPhotoInput" type="file" accept="image/*" hidden />' +
        '</div>' +

        '<p class="vrt-error" id="reviewFormError" hidden></p>' +

        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button type="button" class="vrt-btn vrt-btn-gold" id="reviewSubmit">' +
            (isEdit ? 'Save changes' : 'Submit review') +
          '</button>' +
          (isEdit ? '<button type="button" class="vrt-btn vrt-btn-ghost" id="reviewCancelEdit">Cancel</button>' : '') +
        '</div>' +
      '</div>';

    if (r.image_url) {
      state.reviewFile = null;
      state.reviewPreviewUrl = '';
    } else {
      clearReviewFile();
    }

    setupStarPicker();
    setupPhotoPicker(r.image_url || '');
    setupReviewSubmit();
  }

  function starPickerHtml(rating) {
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += '<button type="button" class="vrt-pick' + (i <= rating ? ' is-on' : '') +
              '" data-star="' + i + '" role="radio" aria-checked="' + (i === rating ? 'true' : 'false') +
              '" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '">★</button>';
    }
    return html;
  }

  function setupStarPicker() {
    var wrap = el('starPicker');
    var hint = el('starHint');
    if (!wrap) return;

    function paint(n) {
      Array.prototype.forEach.call(wrap.querySelectorAll('.vrt-pick'), function (b, i) {
        if (i < n) b.classList.add('is-on');
        else b.classList.remove('is-on');
        b.setAttribute('aria-checked', (i === n - 1) ? 'true' : 'false');
      });
      if (hint) hint.textContent = n ? (n + ' of 5') : 'Tap a star to rate';
    }

    Array.prototype.forEach.call(wrap.querySelectorAll('.vrt-pick'), function (b) {
      b.addEventListener('mouseenter', function () {
        paint(Number(b.getAttribute('data-star')));
      });
      b.addEventListener('click', function () {
        state.pickerRating = Number(b.getAttribute('data-star'));
        paint(state.pickerRating);
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          state.pickerRating = Math.min(5, (state.pickerRating || 0) + 1);
          paint(state.pickerRating);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          state.pickerRating = Math.max(1, (state.pickerRating || 1) - 1);
          paint(state.pickerRating);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          state.pickerRating = Number(b.getAttribute('data-star'));
          paint(state.pickerRating);
        }
      });
    });

    wrap.addEventListener('mouseleave', function () {
      paint(state.pickerRating || 0);
    });
  }

  function setupPhotoPicker(existingUrl) {
    var picker = el('photoPicker');
    var input = el('reviewPhotoInput');
    if (!picker || !input) return;

    function currentPreview() {
      if (state.reviewFile && state.reviewFile.preview) return state.reviewFile.preview;
      return existingUrl || '';
    }

    function refresh() {
      var preview = currentPreview();
      var html = '';
      if (preview) {
        html +=
          '<div class="vrt-photo">' +
            '<img src="' + escAttr(preview) + '" alt="" />' +
            '<button type="button" class="vrt-photo-x" data-remove="1" aria-label="Remove photo">×</button>' +
          '</div>';
      } else {
        html += '<button type="button" class="vrt-photo-add" id="photoAddBtn" aria-label="Add photo">+</button>';
      }
      picker.innerHTML = html;

      var addBtn = el('photoAddBtn');
      if (addBtn) addBtn.addEventListener('click', function () { input.click(); });

      var rm = picker.querySelector('[data-remove]');
      if (rm) {
        rm.addEventListener('click', function () {
          clearReviewFile();
          picker.dataset.removedExisting = '1';
          refresh();
        });
      }
    }

    input.addEventListener('change', async function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Please choose an image file.'); return; }
      if (file.size > REVIEW_MAX_BYTES) { toast('That image is larger than 2 MB.'); return; }

      clearReviewFile();

      try {
        var blob = await compressImage(file, REVIEW_MAX_WIDTH, 0.82);
        var preview = URL.createObjectURL(blob);
        state.reviewFile = { blob: blob, preview: preview };
        state.reviewPreviewUrl = preview;
        picker.dataset.removedExisting = '';
      } catch (e) {
        try {
          state.reviewFile = { blob: file, preview: URL.createObjectURL(file) };
          state.reviewPreviewUrl = state.reviewFile.preview;
          picker.dataset.removedExisting = '';
        } catch (e2) { /* ignore */ }
      }
      refresh();
    });

    if (!existingUrl) picker.dataset.removedExisting = '';
    refresh();
  }

  function setupReviewSubmit() {
    var btn = el('reviewSubmit');
    var cancel = el('reviewCancelEdit');
    var errEl = el('reviewFormError');

    if (cancel) {
      cancel.addEventListener('click', function () {
        state.editingReview = false;
        renderReviewFormOrCTA();
      });
    }

    if (!btn) return;

    btn.addEventListener('click', async function () {
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

      var rating = Number(state.pickerRating) || 0;
      var commentEl = el('reviewCommentInput');
      var comment = commentEl ? commentEl.value.trim() : '';

      if (!rating) return showFormError('Please choose a star rating.');
      if (comment.length < 10) return showFormError('Please write at least 10 characters.');
      if (comment.length > 1000) return showFormError('Review is too long (max 1000 characters).');

      var user = state.currentUser;
      if (!user) return showFormError('You are not signed in.');

      var existing = currentUserReviewFor(state.currentProduct.id);

      btn.disabled = true;
      btn.textContent = 'Saving…';

      try {
        var finalImageUrl = null;
        if (state.reviewFile && state.reviewFile.blob) {
          try {
            finalImageUrl = await uploadReviewImage(user.id, state.reviewFile.blob);
          } catch (upErr) {
            logError('review photo upload', upErr);
            toast('Photo upload failed: ' + realError(upErr));
            finalImageUrl = (existing && existing.image_url) || null;
          }
        } else if (existing && existing.image_url) {
          var picker = el('photoPicker');
          if (picker && picker.dataset.removedExisting === '1') {
            finalImageUrl = null;
          } else {
            finalImageUrl = existing.image_url;
          }
        }

        var name = '';
        var prof = state.currentProfile || (window.VionaAuth && window.VionaAuth.getProfile
          ? window.VionaAuth.getProfile() : null);
        if (prof && prof.name) name = String(prof.name);
        if (!name && user.user_metadata) {
          name = String(user.user_metadata.full_name ||
                        user.user_metadata.name ||
                        user.email || 'Viona Customer');
        }
        if (!name) name = user.email || 'Viona Customer';

        var payload = {
          product_id: state.currentProduct.id,
          user_id: user.id,
          customer_name: name,
          rating: rating,
          comment: comment,
          image_url: finalImageUrl
        };
        try { payload.stars = rating; } catch (e) { /* ignore */ }

        if (existing && existing.id) {
          var upd = await sb.from('reviews').update(payload).eq('id', existing.id);
          if (upd && upd.error) throw upd.error;
          toast('Review updated.');
        } else {
          var ins = await sb.from('reviews').insert(payload);
          if (ins && ins.error) throw ins.error;
          toast('Thank you! Your review is live.');
        }

        state.editingReview = false;
        clearReviewFile();

        await loadAllReviews();
        renderGrid();
        renderModalRatingBadge();
        renderReviewSummary();
        renderReviewList();
        renderReviewFormOrCTA();
        updateTabReviewCount();
      } catch (e) {
        logError('save review', e);
        showFormError(realError(e) || 'Could not save your review.');
      } finally {
        btn.disabled = false;
        btn.textContent = existing ? 'Save changes' : 'Submit review';
      }
    });

    function showFormError(msg) {
      if (!errEl) { toast(msg); return; }
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  async function uploadReviewImage(userId, blob) {
    var path = userId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
    var up = await sb.storage.from(REVIEW_BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false
    });
    if (up && up.error) throw up.error;
    var pub = sb.storage.from(REVIEW_BUCKET).getPublicUrl(path);
    if (pub && pub.data && pub.data.publicUrl) return pub.data.publicUrl;
    throw new Error('No public URL returned.');
  }

  async function deleteMyReview() {
    var existing = state.currentProduct ? currentUserReviewFor(state.currentProduct.id) : null;
    if (!existing || !existing.id) return;

    var ok = window.confirm('Delete your review? This cannot be undone.');
    if (!ok) return;

    try {
      var res = await sb.from('reviews').delete().eq('id', existing.id);
      if (res && res.error) {
        logError('reviews delete', res.error);
        throw res.error;
      }
      toast('Review deleted.');
      await loadAllReviews();
      renderGrid();
      renderModalRatingBadge();
      renderReviewSummary();
      renderReviewList();
      renderReviewFormOrCTA();
      updateTabReviewCount();
    } catch (e) {
      logError('deleteMyReview', e);
      toast('Could not delete review: ' + realError(e));
    }
  }

  /* ==========================================================================
     16. LIGHTBOX
     ========================================================================== */

  function openReviewLightbox(reviewId) {
    if (!state.currentProduct) return;
    var stats = reviewStatsFor(state.currentProduct.id);
    var r = stats.list.find(function (x) { return Number(x.id) === Number(reviewId); });
    if (!r || !r.image_url) return;

    state.lightbox.images = [r.image_url];
    state.lightbox.index = 0;
    showLightbox();
  }

  function showLightbox() {
    var lb = el('lightbox');
    var img = el('lbImg');
    var counter = el('lbCounter');
    var prev = el('lbPrev');
    var next = el('lbNext');
    if (!lb || !img) return;

    var imgs = state.lightbox.images;
    if (!imgs.length) return;
    img.src = imgs[state.lightbox.index];
    if (counter) counter.textContent = (state.lightbox.index + 1) + ' / ' + imgs.length;
    if (prev) prev.style.display = imgs.length > 1 ? '' : 'none';
    if (next) next.style.display = imgs.length > 1 ? '' : 'none';
    lb.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeLightbox() {
    var lb = el('lightbox');
    if (!lb) return;
    lb.hidden = true;
    if (!state.currentProduct) document.body.classList.remove('no-scroll');
  }

  function setupLightbox() {
    var lb = el('lightbox');
    if (!lb) return;
    var img = el('lbImg');
    var prev = el('lbPrev');
    var next = el('lbNext');

    Array.prototype.forEach.call(lb.querySelectorAll('[data-lb-close]'), function (b) {
      b.addEventListener('click', closeLightbox);
    });
    var close = el('lbClose');
    if (close) close.addEventListener('click', closeLightbox);

    if (prev) prev.addEventListener('click', function () {
      var n = state.lightbox.images.length;
      if (!n) return;
      state.lightbox.index = (state.lightbox.index - 1 + n) % n;
      if (img) img.src = state.lightbox.images[state.lightbox.index];
      var counter = el('lbCounter');
      if (counter) counter.textContent = (state.lightbox.index + 1) + ' / ' + n;
    });
    if (next) next.addEventListener('click', function () {
      var n = state.lightbox.images.length;
      if (!n) return;
      state.lightbox.index = (state.lightbox.index + 1) % n;
      if (img) img.src = state.lightbox.images[state.lightbox.index];
      var counter = el('lbCounter');
      if (counter) counter.textContent = (state.lightbox.index + 1) + ' / ' + n;
    });

    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'ArrowLeft' && prev) prev.click();
      else if (e.key === 'ArrowRight' && next) next.click();
      else if (e.key === 'Escape') closeLightbox();
    });
  }

  /* ==========================================================================
     17. IMAGE COMPRESSION
     ========================================================================== */

  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      try {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Could not read file')); };
        reader.onload = function () {
          var img = new Image();
          img.onerror = function () { reject(new Error('Could not load image')); };
          img.onload = function () {
            try {
              var w = img.naturalWidth || img.width;
              var h = img.naturalHeight || img.height;
              var scale = Math.min(1, maxSide / Math.max(w, h));
              var tw = Math.max(1, Math.round(w * scale));
              var th = Math.max(1, Math.round(h * scale));

              var canvas = document.createElement('canvas');
              canvas.width = tw;
              canvas.height = th;
              var ctx = canvas.getContext('2d');
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, tw, th);
              ctx.drawImage(img, 0, 0, tw, th);

              canvas.toBlob(function (blob) {
                if (!blob) return reject(new Error('Could not compress image'));
                resolve(blob);
              }, 'image/jpeg', quality);
            } catch (err) { reject(err); }
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      } catch (err) { reject(err); }
    });
  }

  /* ==========================================================================
     18. CATEGORY STRIP, MOBILE MENU, MISC
     ========================================================================== */

  function setupCategoryStrip() {
    var wrap = el('categoryStripInner');
    if (!wrap) return;

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.cat-chip') : null;
      if (!btn) return;
      var cat = btn.getAttribute('data-cat') || 'All';
      state.activeCategory = cat;
      state.searchTerm = '';
      var input = el('searchInput');
      if (input) input.value = '';
      var clear = el('searchClear');
      if (clear) clear.hidden = true;

      renderCategoryStrip();
      applyFilters();
      scrollToCollections();
    });
  }

  function setupMobileMenu() {
    var toggle = el('menuToggle');
    var menu = el('mobileMenu');
    var closeBtn = el('menuClose');
    var overlay = el('menuOverlay');
    if (!toggle || !menu || !overlay) return;

    var closeTimer = null;

    function isOpen() {
      return !menu.hidden && menu.classList.contains('is-open');
    }

    function openMenu() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      menu.hidden = false;
      overlay.hidden = false;
      void menu.offsetWidth;
      requestAnimationFrame(function () {
        menu.classList.add('is-open');
      });
      toggle.setAttribute('aria-expanded', 'true');
      menu.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
    }

    function closeMenu() {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('no-scroll');
      closeTimer = setTimeout(function () {
        menu.hidden = true;
        overlay.hidden = true;
        closeTimer = null;
      }, 300);
    }

    toggle.addEventListener('click', function () {
      if (isOpen()) closeMenu();
      else openMenu();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);

    Array.prototype.forEach.call(menu.querySelectorAll('[data-menu-link]'), function (a) {
      a.addEventListener('click', function () { closeMenu(); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1024 && !menu.hidden) closeMenu();
    });
  }

  function setupEmptyReset() {
    var b = el('emptyReset');
    if (!b) return;
    b.addEventListener('click', function () {
      state.activeCategory = 'All';
      state.searchTerm = '';
      var input = el('searchInput');
      if (input) input.value = '';
      var clear = el('searchClear');
      if (clear) clear.hidden = true;
      renderCategoryStrip();
      applyFilters();
    });
  }

  function setupReviewSort() {
    var sel = el('reviewSort');
    if (!sel) return;
    sel.addEventListener('change', function () {
      state.reviewSort = sel.value || 'newest';
      renderReviewList();
    });
  }

  /* ==========================================================================
     19. FAQ
     ========================================================================== */

  async function loadFaqs() {
    if (!SUPABASE_READY || !sb) return [];
    try {
      var res = await sb
        .from('faqs')
        .select('*')
        .order('sort_order', { ascending: true });

      if (res && res.error) {
        logError('loadFaqs', res.error);
        return [];
      }
      return (res && res.data) || [];
    } catch (e) {
      logError('loadFaqs', e);
      return [];
    }
  }

  function renderFaqs(faqs) {
    var wrap = el('faqList');
    if (!wrap) return;
    var list = Array.isArray(faqs) ? faqs : [];
    if (!list.length) { wrap.innerHTML = ''; return; }

    var html = '';
    list.forEach(function (f, i) {
      var q = String(f.question || '');
      var a = String(f.answer || '');
      html +=
        '<div class="faq-item" data-idx="' + i + '">' +
          '<button type="button" class="faq-q" aria-expanded="false">' + esc(q) + '</button>' +
          '<div class="faq-a"><div class="faq-a-inner">' + esc(a).replace(/\n/g, '<br />') + '</div></div>' +
        '</div>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.faq-item'), function (item) {
      var btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = item.classList.contains('is-open');
        Array.prototype.forEach.call(wrap.querySelectorAll('.faq-item'), function (other) {
          other.classList.remove('is-open');
          var b = other.querySelector('.faq-q');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!open) {
          item.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  /* ==========================================================================
     20. OFFERS
     ========================================================================== */

  function pickOfferFields(settings) {
    var text = '';
    var link = '';
    var active = false;

    if (typeof settings.offer_text === 'string') text = settings.offer_text;
    if (typeof settings.offer_link === 'string') link = settings.offer_link;

    if (settings.offer_active === true ||
        String(settings.offer_active).toLowerCase() === 'true') {
      active = true;
    }
    if (!active && (settings.offer_enabled === true ||
        String(settings.offer_enabled).toLowerCase() === 'true')) {
      active = true;
    }

    if (!text && settings.offer && typeof settings.offer === 'object') {
      if (settings.offer.text) text = String(settings.offer.text);
      if (settings.offer.link && !link) link = String(settings.offer.link);
      if (settings.offer.active === true ||
          String(settings.offer.active).toLowerCase() === 'true') {
        active = true;
      }
    }

    return {
      text: String(text || '').trim(),
      link: String(link || '').trim(),
      active: active
    };
  }

  function renderOfferBanner() {
    var offer = pickOfferFields(state.settings);

    if (!offer.text || !offer.active) {
      var stripRoot = el('offerStripRoot');
      if (stripRoot) { stripRoot.innerHTML = ''; stripRoot.hidden = true; }
      var banner = el('bannerSection');
      if (banner) banner.hidden = true;
      return;
    }

    var stripRoot2 = el('offerStripRoot');
    if (stripRoot2) {
      var linkHtml = offer.link
        ? '<a class="offer-strip-link" href="' + escAttr(offer.link) + '">Shop now</a>'
        : '';
      stripRoot2.innerHTML =
        '<div class="offer-strip">' +
          '<span class="offer-strip-text">' + esc(offer.text) + '</span>' +
          linkHtml +
          '<button type="button" class="offer-strip-close" aria-label="Close">×</button>' +
        '</div>';
      stripRoot2.hidden = false;

      var closeBtn = stripRoot2.querySelector('.offer-strip-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          stripRoot2.innerHTML = '';
          stripRoot2.hidden = true;
        });
      }
    }

    var bannerSec = el('bannerSection');
    var bannerTrack = el('bannerTrack');
    var bannerDots = el('bannerDots');
    if (bannerSec && bannerTrack) {
      var btn = offer.link
        ? '<a class="banner-btn" href="' + escAttr(offer.link) + '">Shop now</a>'
        : '';
      bannerTrack.innerHTML =
        '<div class="banner-slide align-center">' +
          '<div class="banner-slide-inner">' +
            '<p class="banner-subtitle">' + esc(offer.text) + '</p>' +
            btn +
          '</div>' +
        '</div>';
      bannerSec.hidden = false;
      if (bannerDots) bannerDots.innerHTML = '';
    }
  }

  /* ==========================================================================
     21. DEEP LINK
     ========================================================================== */

  function findProductByCodeOrId(code) {
    var byCode = state.products.find(function (p) {
      return String(p.code || '').toUpperCase() === String(code).toUpperCase();
    });
    if (byCode) return byCode;

    var id = codeToId(code);
    if (!id) return null;
    return state.products.find(function (p) { return Number(p.id) === id; }) || null;
  }

  function handleDeepLink() {
    if (!window.location.hash) return;
    var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
    if (!m) return;
    var code = m[1];

    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var found = findProductByCodeOrId(code);
      if (found) {
        clearInterval(iv);
        openProductById(found.id);
      } else if (state.loaded || tries > 30) {
        clearInterval(iv);
      }
    }, 120);
  }

  /* ==========================================================================
     22. RE-RENDER DYNAMIC STRINGS when site_content changes
     ========================================================================== */

  function refreshDynamicStrings() {
    // 1) Empty-products message — only if the empty state is visible now.
    var emptyBox = el('emptyBox');
    if (emptyBox && !emptyBox.hidden && !state.products.length && !state.loadError) {
      var msg = t('empty_products_message',
        'No products available right now. Please check back soon.');
      setEmptyState('Nothing to show yet', msg, false);
    }

    // 2) Order button label inside the modal.
    var orderSpan = document.querySelector('#modalWhatsApp [data-content="order_button_text"]');
    if (orderSpan) {
      orderSpan.textContent = t('order_button_text', 'Order on WhatsApp');
    }

    // 3) Size popup title/message/button if the popup is currently open.
    var popupTitleEl = el('sizePopupTitle');
    if (popupTitleEl) {
      popupTitleEl.textContent = t('size_unavailable_title', 'Currently unavailable');
    }
    var popupMsgEl = document.querySelector('#sizePopup .popup-subtitle');
    if (popupMsgEl) {
      var current = popupMsgEl.textContent || '';
      var dash = current.indexOf(' — ');
      var prefix = dash !== -1 ? current.slice(0, dash + 3) : '';
      var baseMsg = t('size_unavailable_message',
        'This size is not available right now. Please choose another size or message us on WhatsApp.');
      popupMsgEl.textContent = prefix + baseMsg;
    }
    var popupBtnEl = document.querySelector('#sizePopup .popup-btn');
    if (popupBtnEl) {
      popupBtnEl.textContent = t('size_unavailable_button', 'OK');
    }

    // 4) Re-render size chips for the currently-open product so the new
    //    all_sizes list (or changed text) is reflected immediately.
    if (state.currentProduct) {
      renderSizes(state.currentProduct);
    }
  }

  // Listen early — brand.js may fire siteContentLoaded before init() finishes.
  document.addEventListener('siteContentLoaded', function () {
    try { refreshDynamicStrings(); } catch (e) { /* ignore */ }
  });

  /* ==========================================================================
     23. INIT
     ========================================================================== */

  async function init() {
    injectStyles();

    if (window.VionaAuth && typeof window.VionaAuth.init === 'function') {
      try {
        var maybe = window.VionaAuth.init();
        if (maybe && typeof maybe.then === 'function') await maybe;
      } catch (e) {
        logError('VionaAuth.init', e);
      }
    }

    if (window.VionaAuth && window.VionaAuth.client) {
      sb = window.VionaAuth.client;
      SUPABASE_READY = true;
      try { state.currentUser = window.VionaAuth.getUser(); } catch (e) {}
      try { state.currentProfile = window.VionaAuth.getProfile(); } catch (e) {}
    } else if (window.supabase && typeof window.supabase.createClient === 'function' &&
               cfgLooksOk()) {
      try {
        sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        SUPABASE_READY = true;
      } catch (e) {
        logError('createClient (fallback)', e);
        sb = null;
        SUPABASE_READY = false;
      }
    }

    if (!SUPABASE_READY) {
      console.warn('[viona] Supabase is not ready — products will not load (no demo data).');
    }

    state.settings = await loadSettings();
    applySettings();

    await loadProducts();
    buildCategories();
    applyFilters();

    await loadAllReviews();

    var faqs = await loadFaqs();
    renderFaqs(faqs);

    renderOfferBanner();
    renderGrid();

    setupSearch();
    setupModal();
    setupCategoryStrip();
    setupMobileMenu();
    setupEmptyReset();
    setupReviewSort();
    setupLightbox();

    if (window.VionaAuth && typeof window.VionaAuth.onChange === 'function') {
      window.VionaAuth.onChange(function (user, profile) {
        state.currentUser = user || null;
        state.currentProfile = profile || null;

        if (state.currentProduct) {
          renderUserChip();
          renderReviewList();
          renderReviewFormOrCTA();
          renderReviewSummary();
          renderModalRatingBadge();
          updateTabReviewCount();
        }
      });
    }

    handleDeepLink();

    window.addEventListener('hashchange', function () {
      if (!window.location.hash || window.location.hash.indexOf('#product=') !== 0) {
        if (state.currentProduct) closeProductModal();
        return;
      }
      var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
      if (!m) return;
      var found = findProductByCodeOrId(m[1]);
      if (found) openProductById(found.id);
    });

    // If site_content was already loaded before we finished init (rare),
    // refresh dynamic strings now so nothing is stale.
    refreshDynamicStrings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init().catch(function (e) { logError('init', e); });
    });
  } else {
    init().catch(function (e) { logError('init', e); });
  }

})();
