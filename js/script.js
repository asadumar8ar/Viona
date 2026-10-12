/* ============================================================================
   Viona Bangles — js/script.js  (Part 2 of 2)
   ----------------------------------------------------------------------------
   Public homepage logic. Plain vanilla JS, no build step.

   Uses:
     - window.VIONA_CONFIG  (js/config.js)
     - window.VionaAuth     (js/auth.js)  -> auth + login modal + profile
     - supabase-js v2       (CDN global "supabase")

   What it does:
     - Loads products + site_settings from Supabase (defensive: learns columns
       by doing select * limit 1). Falls back to demo products if not configured.
     - Header search + suggestions, category strip, product grid.
     - Product modal with gallery, size chips, WhatsApp order button.
     - Offers banner from site_settings (hidden when empty).
     - Reviews: fetches ALL reviews once, groups by product_id (String compare)
       and computes count/total/average per product.
       * Product cards show only their own product's rating.
       * Modal shows a proper summary box with fractional stars + 5 bars.
     - Review form is wired to VionaAuth:
       * Logged out  -> "Login to write a review" button.
       * Logged in   -> stars + comment + optional photo.
       * One review per user per product (edit instead of insert).
     - Injects its own CSS so css/style.css does not need to change.
     - Shows the REAL Supabase error message on any failure.

   Deep link: #product=VB-001
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
  var REVIEW_MAX_BYTES = 2 * 1024 * 1024;   // 2 MB
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
    return Math.round(((o - p) / o) * 100);
  }

  function productCode(id, code) {
    // Prefer a real code from the row. Otherwise build VB-001 from the id.
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
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.hidden = false;
    void t.offsetWidth;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.hidden = true; }, 300);
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

  /* ==========================================================================
     3. STATE
     ========================================================================== */

  var state = {
    products: [],
    filtered: [],
    categories: [],
    activeCategory: 'All',
    searchTerm: '',

    productCols: null,      // array of column names (null when table is empty)
    R: null,                // resolved column map

    settings: {},           // merged settings object (business, hero, about, ...)

    // Reviews — all fetched once, grouped by String(product_id)
    allReviews: [],
    reviewsByProduct: {},   // { '1': [ {…}, {…} ] }

    currentProduct: null,
    currentSize: null,
    currentImageIndex: 0,
    galleryImages: [],

    reviewSort: 'newest',
    currentUser: null,
    currentProfile: null,
    editingReview: false,

    // Review form (transient)
    pickerRating: 0,
    reviewFile: null,
    reviewPreviewUrl: '',

    // Lightbox
    lightbox: { images: [], index: 0 },

    // Search UI
    suggestIndex: -1,
    suggestItems: [],

    // Offers
    offerText: '',
    offerLink: '',
    offerActive: false
  };

  /* ==========================================================================
     4. DEMO PRODUCTS (offline fallback)
     ========================================================================== */

  var DEMO_PRODUCTS = [
    { id: 1, name: 'Classic Glass Bangles', category: 'glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Everyday glass bangles with a smooth finish and a comfortable fit.',
      main_image: '', additional_images: [], is_active: true, featured: true },
    { id: 2, name: 'Designer Glass Bangles', category: 'glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Designer glass bangles with fine detailing, made for festive days.',
      main_image: '', additional_images: [], is_active: true, featured: true },
    { id: 3, name: 'Festive Glass Bangles', category: 'glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Bright festive glass bangles that go beautifully with sarees and lehengas.',
      main_image: '', additional_images: [], is_active: true, featured: false },
    { id: 4, name: 'Traditional Kada', category: 'kada', price: 899, old_price: null,
      sizes: ['2.4','2.6','2.8'],
      description: 'Traditional kada crafted in Gaya, Bihar with a rich heritage finish.',
      main_image: '', additional_images: [], is_active: true, featured: false },
    { id: 5, name: 'Bridal Kundan Bangles', category: 'bridal', price: 1299, old_price: 1599,
      sizes: ['2.4','2.6'],
      description: 'Bridal kundan bangles designed for weddings and special family functions.',
      main_image: '', additional_images: [], is_active: true, featured: false },
    { id: 6, name: 'Fashion Metal Bangles', category: 'metal', price: 599, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Trendy metal bangles for a modern, stylish everyday look.',
      main_image: '', additional_images: [], is_active: true, featured: false }
  ];

  var DEMO_FAQS = [
    { question: 'Do you deliver across India?',
      answer: 'Yes. We ship to all pin codes in India. Delivery usually takes 3 to 7 working days and shipping is free on prepaid orders.' },
    { question: 'How do I place an order?',
      answer: 'Open any bangle, choose your size and tap the WhatsApp button. Send us the product code (for example VB-001) and your address. We confirm the order on WhatsApp.' },
    { question: 'Which sizes are available?',
      answer: 'Most bangles come in 2.2, 2.4, 2.6 and 2.8. If you are not sure about your size, message us on WhatsApp and we will help you measure.' },
    { question: 'Is Cash on Delivery available?',
      answer: 'Yes, Cash on Delivery is available on most pin codes. Prepaid orders are packed and shipped faster.' },
    { question: 'Can I return or exchange?',
      answer: 'Yes. If you receive a damaged or wrong item, contact us within 7 days of delivery with an unboxing video and we will replace or refund it.' },
    { question: 'Are these real glass bangles?',
      answer: 'Yes. Our glass bangles are handcrafted in Gaya, Bihar by traditional artisans using the same methods used for generations.' }
  ];

  /* ==========================================================================
     5. INJECTED STYLES (so css/style.css needs no change)
     ========================================================================== */

  function injectStyles() {
    if (el('vionaRuntimeStyles')) return;

    var css = [
      /* ---------- fractional star row ---------- */
      '.vrt-stars{display:inline-flex;position:relative;line-height:1;',
      'font-size:15px;letter-spacing:2px;vertical-align:middle;}',
      '.vrt-stars-bg{color:#E4DFD3;}',
      '.vrt-stars-fg{position:absolute;top:0;left:0;overflow:hidden;',
      'white-space:nowrap;color:#C9A24B;pointer-events:none;}',

      /* ---------- small rating pill on cards ---------- */
      '.vrt-card-rating{display:flex;align-items:center;gap:6px;margin:6px 0 0;',
      'font-size:12.5px;color:#4A5568;}',
      '.vrt-card-rating .vrt-avg{font-weight:700;color:#0B1F3A;}',
      '.vrt-card-rating .vrt-total{color:#6B7280;}',
      '.vrt-card-rating .vrt-noreviews{color:#9AA1AE;font-style:italic;}',

      /* ---------- summary box ---------- */
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
      '.vrt-bar-label{font-weight:600;color:#0B1F3A;}',
      '.vrt-bar-track{position:relative;height:9px;border-radius:999px;',
      'background:#E9E3D6;overflow:hidden;}',
      '.vrt-bar-fill{position:absolute;left:0;top:0;bottom:0;width:0%;',
      'background:#C9A24B;border-radius:999px;',
      'transition:width .55s cubic-bezier(.2,.7,.2,1);}',
      '.vrt-bar-count{text-align:right;color:#6B7280;}',

      /* ---------- reviews list ---------- */
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

      /* ---------- review form ---------- */
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

      /* ---------- star picker ---------- */
      '.vrt-picker{display:inline-flex;gap:2px;font-size:30px;line-height:1;}',
      '.vrt-pick{background:none;border:none;padding:0 2px;cursor:pointer;',
      'color:#E4DFD3;font-size:30px;line-height:1;font-family:inherit;}',
      '.vrt-pick.is-on{color:#C9A24B;}',
      '.vrt-pick:hover{color:#C9A24B;}',

      /* ---------- photo picker ---------- */
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

      /* ---------- buttons ---------- */
      '.vrt-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;',
      'border:1px solid transparent;border-radius:10px;padding:10px 16px;',
      'font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;',
      'transition:.15s;}',
      '.vrt-btn:disabled{opacity:.55;cursor:not-allowed;}',
      '.vrt-btn-gold{background:#C9A24B;color:#0B1F3A;}',
      '.vrt-btn-gold:hover:not(:disabled){filter:brightness(1.06);}',
      '.vrt-btn-ghost{background:#fff;border-color:#E4DED2;color:#0B1F3A;}',
      '.vrt-btn-ghost:hover:not(:disabled){border-color:#C9A24B;}',

      /* ---------- mobile ---------- */
      '@media (max-width:600px){',
      '.vrt-summary{grid-template-columns:1fr;gap:16px;text-align:center;}',
      '.vrt-summary-right{text-align:left;}',
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
        // key/value style
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

          // Flat keys used by the offer banner.
          if (key === 'whatsapp_number' && val) merged.business.whatsapp = String(val);
          if (key === 'phone' && val) merged.business.phone = String(val);
          if (key === 'contact_email' && val) merged.business.email = String(val);
          if (key === 'address' && val) merged.business.city = String(val);
          if (key === 'instagram_url' && val) merged.social.instagram = String(val);
          if (key === 'facebook_url' && val) merged.social.facebook = String(val);
        });

        // Offer banner fields kept on the top level too.
        var offerRow = rows.find(function (r) { return r && r.key === 'offer_text'; });
        if (offerRow) merged.offer_text = String(offerRow.value || '');
        var activeRow = rows.find(function (r) { return r && r.key === 'offer_active'; });
        if (activeRow) {
          merged.offer_active = (activeRow.value === true ||
                                 String(activeRow.value).toLowerCase() === 'true');
        }
      } else {
        // column style — merge the first row directly
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
    var t = s.trust || {};
    var soc = s.social || {};

    var waNum = b.whatsapp || CFG.WHATSAPP_NUMBER || '';
    var waMsg = 'Hello Viona Bangles, I would like to know more about your bangles.';

    var heroLabel = el('heroLabel');   if (heroLabel) heroLabel.textContent = h.label || '';
    var heroHead  = el('heroHeading'); if (heroHead)  heroHead.textContent  = h.heading || '';
    var heroText  = el('heroText');    if (heroText)  heroText.textContent  = h.text || '';

    var aboutHead = el('aboutHeading'); if (aboutHead) aboutHead.textContent = a.heading || '';
    var aboutText = el('aboutText');    if (aboutText) aboutText.textContent = a.text || '';

    var aboutPoints = el('aboutPoints');
    if (aboutPoints) {
      var pts = Array.isArray(t.points) ? t.points : [];
      var pptHtml = '';
      pts.forEach(function (p) { if (p) pptHtml += '<li>' + esc(p) + '</li>'; });
      aboutPoints.innerHTML = pptHtml;
    }

    var trustSection = el('trustSection');
    var trustList = el('trustList');
    if (trustSection && trustList) {
      var trustPts = Array.isArray(t.points) ? t.points : [];
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

    var cCity  = el('contactCity');  if (cCity)  cCity.textContent  = b.city || CFG.CITY || '';
    var cHours = el('contactHours'); if (cHours) cHours.textContent = b.hours || CFG.HOURS || '';

    var cEmail = el('contactEmail');
    if (cEmail) {
      var email = b.email || CFG.EMAIL || '';
      cEmail.textContent = email;
      cEmail.href = email ? ('mailto:' + email) : '#';
    }

    var cPhone = el('contactPhone');
    if (cPhone) {
      cPhone.textContent = '+' + String(waNum).replace(/^\+/, '');
      cPhone.href = waLink(waNum, waMsg);
    }

    var fCity  = el('footerCity');  if (fCity)  fCity.textContent  = b.city || CFG.CITY || '';
    var fHours = el('footerHours'); if (fHours) fHours.textContent = b.hours || CFG.HOURS || '';

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

    var socialWrap = el('contactSocial');
    if (socialWrap) {
      var socialHtml = '';
      if (soc.instagram) socialHtml += '<a class="social-link" href="' + escAttr(soc.instagram) + '" target="_blank" rel="noopener">Instagram</a>';
      if (soc.facebook)  socialHtml += '<a class="social-link" href="' + escAttr(soc.facebook)  + '" target="_blank" rel="noopener">Facebook</a>';
      if (soc.youtube)   socialHtml += '<a class="social-link" href="' + escAttr(soc.youtube)   + '" target="_blank" rel="noopener">YouTube</a>';
      socialWrap.innerHTML = socialHtml;
    }

    var y = el('footerYear');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* ==========================================================================
     7. PRODUCTS — column detection + load
     ========================================================================== */

  function pickCol(cols) {
    for (var i = 0; i < arguments.length; i++) {
      if (cols.indexOf(arguments[i]) !== -1) return arguments[i];
    }
    return null;
  }

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
        id: 'id',
        name: 'name',
        price: 'price',
        old_price: null,
        category: 'category',
        sizes: 'sizes',
        description: 'description',
        main_image: 'main_image',
        additional_images: null,
        code: null,
        featured: null,
        is_active: null,
        created_at: null
      };
      return state.R;
    }

    var cols = state.productCols;
    state.R = {
      known: true,
      id: 'id',
      name: pickCol.call(null, cols),
      price: pickCol.call(null, cols),
      old_price: null,          // not expected in the known schema
      category: pickCol.call(null, cols),
      sizes: pickCol.call(null, cols),
      description: pickCol.call(null, cols),
      main_image: pickCol.call(null, cols),
      additional_images: null,
      code: null,
      featured: null,
      is_active: null,
      created_at: null
    };

    // Rebuild with proper pick() calls (the above was a shortcut).
    state.R = {
      known: true,
      id: 'id',
      name: (function () { return pick('name'); })(),
      price: (function () { return pick('price'); })(),
      old_price: null,
      category: (function () { return pick('category'); })(),
      sizes: (function () { return pick('sizes'); })(),
      description: (function () { return pick('description'); })(),
      main_image: (function () { return pick('main_image'); })(),
      additional_images: null,
      code: (function () { return pick('code', 'product_code', 'sku'); })(),
      featured: (function () { return pick('featured', 'is_featured'); })(),
      is_active: (function () { return pick('is_active', 'active', 'visible'); })(),
      created_at: (function () { return pick('created_at'); })()
    };

    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        if (cols.indexOf(arguments[i]) !== -1) return arguments[i];
      }
      return null;
    }

    console.log('[viona] product columns:', state.productCols);
    return state.R;
  }

  async function loadProducts() {
    if (!SUPABASE_READY || !sb) {
      state.products = DEMO_PRODUCTS.map(normalizeDemo).filter(Boolean);
      return;
    }

    try {
      await detectProductColumns();
      var R = state.R;

      var q = sb.from('products').select('*');

      // Only filter by is_active when we actually know that column exists.
      if (R.known && R.is_active) {
        q = q.eq(R.is_active, true);
      }

      // Order by id descending when we do not know the created_at column.
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
      if (!rows.length) {
        state.products = DEMO_PRODUCTS.map(normalizeDemo).filter(Boolean);
      } else {
        state.products = rows.map(normalizeProduct).filter(Boolean);
      }
    } catch (e) {
      logError('loadProducts', e);
      state.products = DEMO_PRODUCTS.map(normalizeDemo).filter(Boolean);
    }
  }

  function normalizeDemo(p) {
    return normalizeProduct(p);
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
    if (row.old_price != null && row.old_price !== '') oldPrice = Number(row.old_price);

    var sizesRaw = (R.sizes && row[R.sizes] != null) ? row[R.sizes] : row.sizes;
    var sizes;
    if (Array.isArray(sizesRaw)) {
      sizes = sizesRaw.map(String);
    } else if (typeof sizesRaw === 'string' && sizesRaw.trim()) {
      sizes = sizesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      sizes = ['2.2','2.4','2.6','2.8'];
    }

    var desc = (R.description && row[R.description] != null) ? String(row[R.description]) : String(row.description || '');
    var mainImage = (R.main_image && row[R.main_image] != null) ? String(row[R.main_image]) : String(row.main_image || '');

    var more = [];
    var moreRaw = row.additional_images;
    if (Array.isArray(moreRaw)) {
      more = moreRaw.filter(Boolean).map(String);
    } else if (typeof moreRaw === 'string' && moreRaw.trim()) {
      try {
        var parsed = JSON.parse(moreRaw);
        if (Array.isArray(parsed)) more = parsed.filter(Boolean).map(String);
      } catch (e) { /* ignore */ }
    }

    var code = (R.code && row[R.code] != null) ? String(row[R.code]) : (row.code ? String(row.code) : '');

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
      featured: false,
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
      var rt = Math.round(Number(r.rating) || 0);
      if (rt < 1 || rt > 5) return;
      stats[rt]++;
      sum += rt;
      total++;
    });

    var avg = total ? (sum / total) : 0;
    // round to 1 decimal
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
        .select('id,product_id,user_id,customer_name,rating,comment,image_url,created_at')
        .order('created_at', { ascending: false });

      if (res && res.error) {
        logError('reviews select', res.error);
        throw res.error;
      }

      var rows = (res && res.data) || [];
      state.allReviews = rows;

      // Group by String(product_id) so 1 and "1" end up together.
      rows.forEach(function (r) {
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

  /* ---------- HTML for a star row with fractional fill ---------- */

  function starsRowHtml(average, size) {
    var pct = Math.max(0, Math.min(100, (Number(average) || 0) / 5 * 100));
    var fs = size || 15;
    return '' +
      '<span class="vrt-stars" style="font-size:' + fs + 'px" aria-label="' +
        (Number(average) || 0).toFixed(1) + ' out of 5">' +
        '<span class="vrt-stars-bg" aria-hidden="true">★★★★★</span>' +
        '<span class="vrt-stars-fg" style="width:' + pct.toFixed(2) + '%" aria-hidden="true">★★★★★</span>' +
      '</span>';
  }

  function starsSolidHtml(rating) {
    // For the reviews list we show whole stars (a review's own rating).
    var r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var on = '';
    for (var i = 1; i <= 5; i++) {
      on += '<span style="color:' + (i <= r ? '#C9A24B' : '#E4DFD3') + '">★</span>';
    }
    return '<span class="vrt-stars" aria-label="' + r + ' out of 5">' + on + '</span>';
  }

  /* ==========================================================================
     10. PRODUCT GRID
     ========================================================================== */

  function applyFilters() {
    var term = (state.searchTerm || '').trim().toLowerCase();
    var cat = state.activeCategory || 'All';

    state.filtered = state.products.filter(function (p) {
      if (cat !== 'All' && p.category !== cat) return false;
      if (!term) return true;
      var hay = (
        p.name + ' ' +
        p.category + ' ' +
        (p.description || '') + ' ' +
        productCode(p.id, p.code)
      ).toLowerCase();
      return hay.indexOf(term) !== -1;
    });

    renderGrid();
  }

  function renderGrid() {
    var grid = el('productGrid');
    var emptyBox = el('emptyBox');
    var showing = el('showingCount');
    var skel = el('productSkeletons');

    if (skel) skel.hidden = true;
    if (!grid) return;

    var list = state.filtered;

    if (showing) {
      var count = list.length;
      showing.textContent = 'Showing ' + count + ' ' + (count === 1 ? 'bangle' : 'bangles');
    }

    if (!list.length) {
      grid.innerHTML = '';
      if (emptyBox) emptyBox.hidden = false;
      return;
    }

    if (emptyBox) emptyBox.hidden = true;

    var html = '';
    list.forEach(function (p) {
      var imgs = productImages(p);
      var off = discountPct(p.price, p.old_price);
      var code = productCode(p.id, p.code);
      var stats = reviewStatsFor(p.id);

      var mediaHtml = '';
      if (imgs.length) {
        mediaHtml = '<img class="card-img" src="' + escAttr(imgs[0]) + '" alt="' + escAttr(p.name) + '" loading="lazy" ' +
                    'onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.card-placeholder\').hidden=false;" />' +
                    '<div class="card-placeholder" hidden><span>Viona</span></div>';
      } else {
        mediaHtml = '<div class="card-placeholder"><span>Viona</span></div>';
      }

      var badgeHtml = off > 0 ? '<span class="card-badge">' + off + '% OFF</span>' : '';
      var featHtml  = p.featured ? '<span class="card-featured">Featured</span>' : '';

      var priceHtml = '<span class="price-now">' + esc(money(p.price)) + '</span>';
      if (off > 0) {
        priceHtml += '<span class="price-old">' + esc(money(p.old_price)) + '</span>';
      }

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
          '<div class="card-media">' +
            badgeHtml + featHtml + mediaHtml +
          '</div>' +
          '<div class="card-body">' +
            '<p class="card-cat">' + esc(p.category) + '</p>' +
            '<h3 class="card-name">' + esc(p.name) + '</h3>' +
            ratingHtml +
            '<div class="card-price">' + priceHtml + '</div>' +
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

    // Rating badge in the tabs row + summary + list + form
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

  function renderSizes(p) {
    var wrap = el('modalSizes');
    var section = el('modalSizesWrap');
    if (!wrap || !section) return;

    var sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : [];
    if (!sizes.length) {
      section.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    section.hidden = false;

    var html = '';
    sizes.forEach(function (s) {
      html += '<button type="button" class="size-chip" role="radio" aria-checked="false" data-size="' +
              escAttr(s) + '">' + esc(s) + '</button>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.size-chip'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(wrap.querySelectorAll('.size-chip'), function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-checked', 'true');
        state.currentSize = btn.getAttribute('data-size');
        updateModalWhatsApp();
      });
    });

    var first = wrap.querySelector('.size-chip');
    if (first) {
      first.classList.add('is-active');
      first.setAttribute('aria-checked', 'true');
      state.currentSize = first.getAttribute('data-size');
    }
  }

  function updateModalWhatsApp() {
    var link = el('modalWhatsApp');
    var p = state.currentProduct;
    if (!link || !p) return;

    var num = (state.settings.business && state.settings.business.whatsapp) || CFG.WHATSAPP_NUMBER || '';
    var code = productCode(p.id, p.code);
    var sizePart = state.currentSize ? ('\nSize: ' + state.currentSize) : '';
    var msg = 'Hello Viona Bangles,\n' +
              'I would like to order:\n' +
              '• ' + p.name + ' (' + code + ')\n' +
              '• Price: ' + money(p.price) + sizePart + '\n\n' +
              'Please share delivery details.';
    link.href = waLink(num, msg);
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

  function setupModal() {
    var modal = el('productModal');
    if (!modal) return;

    var closeBtn = el('modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeProductModal);

    Array.prototype.forEach.call(modal.querySelectorAll('[data-close-modal]'), function (b) {
      b.addEventListener('click', closeProductModal);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var lb = el('lightbox');
      if (lb && !lb.hidden) { closeLightbox(); return; }
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
        var t = el('tabReviews');
        if (t) try { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
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

    // Big average + "out of 5" + fractional stars + total.
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

    var html = '';
    for (var star = 5; star >= 1; star--) {
      var count = stats.stats[star] || 0;
      var pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
      html +=
        '<div class="vrt-bar-row">' +
          '<span class="vrt-bar-label">' + star + ' ★</span>' +
          '<span class="vrt-bar-track">' +
            '<span class="vrt-bar-fill" data-w="' + pct + '" style="width:0%"></span>' +
          '</span>' +
          '<span class="vrt-bar-count">' + count + '</span>' +
        '</div>';
    }
    barsWrap.innerHTML = html;

    // Animate the fills on the next frame so the transition runs.
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
        return (b.rating - a.rating) || (new Date(b.created_at) - new Date(a.created_at));
      });
    } else if (state.reviewSort === 'lowest') {
      list.sort(function (a, b) {
        return (a.rating - b.rating) || (new Date(b.created_at) - new Date(a.created_at));
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
        '<div class="vrt-rv-stars">' + starsSolidHtml(r.rating) + '</div>' +
        '<p class="vrt-rv-text">' + esc(r.comment || '') + '</p>' +
        photosHtml +
        actionsHtml +
      '</article>';
  }

  /* ==========================================================================
     15. REVIEWS FORM (login / write / edit)
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

    // ---- Not signed in -> CTA ----
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

    // ---- Already reviewed, not editing -> nothing extra ----
    if (existing && !state.editingReview) {
      wrap.innerHTML = '';
      return;
    }

    var isEdit = !!existing;
    var r = existing || {};
    var initialRating = Number(r.rating) || 0;
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
        // Final image url: new upload > keep existing > null.
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
        // Refresh everything that depends on reviews:
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
     18. CATEGORY STRIP + MENU + MISC
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

  function setupMenu() {
    var btn = el('hamburgerBtn');
    var nav = el('headerNav');
    if (!btn || !nav) return;

    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    Array.prototype.forEach.call(nav.querySelectorAll('[data-nav-close]'), function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      });
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
    if (!SUPABASE_READY || !sb) {
      return DEMO_FAQS.slice();
    }
    try {
      var res = await sb
        .from('faqs')
        .select('*')
        .order('sort_order', { ascending: true });

      if (res && res.error) throw res.error;
      var rows = (res && res.data) || [];
      return rows.length ? rows : DEMO_FAQS.slice();
    } catch (e) {
      return DEMO_FAQS.slice();
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
     20. OFFERS (from site_settings)
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

    // Also accept nested { offer: { text, link, active } }
    if (!text && settings.offer && typeof settings.offer === 'object') {
      if (settings.offer.text) text = String(settings.offer.text);
      if (settings.offer.link) link = String(settings.offer.link);
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

    // No text, or explicitly turned off -> hide everything.
    if (!offer.text || !offer.active) {
      var stripRoot = el('offerStripRoot');
      if (stripRoot) { stripRoot.innerHTML = ''; stripRoot.hidden = true; }
      var banner = el('bannerSection');
      if (banner) banner.hidden = true;
      return;
    }

    // ---- Strip version ----
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

    // ---- Banner version ----
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

  function handleDeepLink() {
    if (!window.location.hash) return;
    var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
    if (!m) return;
    var code = m[1];

    // Try to match by real code first, then by VB-### -> id.
    var byCode = state.products.find(function (p) {
      return String(p.code || '').toUpperCase() === String(code).toUpperCase();
    });
    if (byCode) { openProductById(byCode.id); return; }

    var id = codeToId(code);
    if (!id) return;

    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var found = state.products.find(function (p) { return Number(p.id) === id; });
      if (found) {
        clearInterval(iv);
        openProductById(id);
      } else if (tries > 30) {
        clearInterval(iv);
      }
    }, 120);
  }

  /* ==========================================================================
     22. INIT
     ========================================================================== */

  async function init() {
    injectStyles();

    // 1. Auth (VionaAuth owns the Supabase client).
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
      console.warn('[viona] Supabase not ready — using demo products.');
    }

    // 2. Settings
    state.settings = await loadSettings();
    applySettings();

    // 3. Products + categories
    await loadProducts();
    buildCategories();
    applyFilters();

    // 4. All reviews (once)
    await loadAllReviews();

    // 5. FAQ
    var faqs = await loadFaqs();
    renderFaqs(faqs);

    // 6. Offers banner
    renderOfferBanner();

    // 7. Re-render grid now that reviews are loaded.
    renderGrid();

    // 8. Wire up UI
    setupSearch();
    setupModal();
    setupCategoryStrip();
    setupMenu();
    setupEmptyReset();
    setupReviewSort();
    setupLightbox();

    // 9. Auth changes -> refresh review UI live.
    if (window.VionaAuth && typeof window.VionaAuth.onChange === 'function') {
      window.VionaAuth.onChange(function (user, profile) {
        state.currentUser = user || null;
        state.currentProfile = profile || null;

        if (state.currentProduct) {
          renderUserChip();
          renderReviewList();
          renderReviewFormOrCTA();
        }
      });
    }

    // 10. Deep link
    handleDeepLink();

    // 11. React to hash changes (back button etc.)
    window.addEventListener('hashchange', function () {
      if (!window.location.hash || window.location.hash.indexOf('#product=') !== 0) {
        if (state.currentProduct) closeProductModal();
        return;
      }
      var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
      if (!m) return;
      var code = m[1];

      var byCode = state.products.find(function (p) {
        return String(p.code || '').toUpperCase() === String(code).toUpperCase();
      });
      if (byCode) { openProductById(byCode.id); return; }

      var id = codeToId(code);
      if (id) openProductById(id);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init().catch(function (e) { logError('init', e); });
    });
  } else {
    init().catch(function (e) { logError('init', e); });
  }

})();
