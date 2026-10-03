/* ==========================================================================
   VIONA BANGLES — APP SCRIPT
   File: js/script.js

   This one file drives the whole public website:
     • loads products / offers / settings / FAQs from Supabase
     • falls back to demo products if Supabase is not configured
     • category strip + live search suggestions + product modal
     • offers: strip / banner carousel / popup (hidden when empty)
     • reviews with rating summary, sorting, sign-in, upload, edit, delete
     • deep link #product=VB-001
   Every network call is wrapped in try/catch. Every database string is
   escaped before it touches innerHTML. Every element is checked before use.
   ========================================================================== */

(function () {
  'use strict';

  /* ======================================================================
     1. CONFIG + SUPABASE
     ====================================================================== */

  var CONFIG = window.VIONA_CONFIG || {};

  // Returns true only when both the URL and key look like real values.
  function isConfigured() {
    var url = String(CONFIG.SUPABASE_URL || '').trim();
    var key = String(CONFIG.SUPABASE_ANON_KEY || '').trim();
    if (!url || url.indexOf('PASTE_YOUR') !== -1) return false;
    if (url.indexOf('https://') !== 0) return false;
    if (!key || key.indexOf('PASTE_YOUR') !== -1) return false;
    return true;
  }

  var SB = null;
  var CONFIGURED = false;

  // Try to create the Supabase client. If anything goes wrong we simply
  // keep SB = null and the site runs in demo mode.
  try {
    if (isConfigured() && window.supabase && typeof window.supabase.createClient === 'function') {
      SB = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      CONFIGURED = true;
    }
  } catch (err) {
    SB = null;
    CONFIGURED = false;
  }

  /* ======================================================================
     2. TINY HELPERS
     ====================================================================== */

  function $(id) { return document.getElementById(id); }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  // Escape anything that goes into innerHTML.
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Only allow safe URL schemes for src / href.
  function safeUrl(u) {
    if (typeof u !== 'string') return '';
    var t = u.trim();
    if (!t) return '';
    if (/^(https?:|data:image\/|blob:|\/)/i.test(t)) return t;
    return '';
  }

  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return 'Rs 0';
    try {
      return 'Rs ' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    } catch (e) {
      return 'Rs ' + Math.round(num);
    }
  }

  // Turn product id 1 into "VB-001".
  function productCode(p) {
    if (!p || p.id === null || p.id === undefined) return '';
    var n = Number(p.id);
    if (!isFinite(n)) return String(p.id);
    return 'VB-' + String(n).padStart(3, '0');
  }

  // Percentage off when old_price is greater than price.
  function discountPct(p) {
    var price = Number(p && p.price) || 0;
    var old = Number(p && p.old_price) || 0;
    if (old <= 0 || old <= price) return 0;
    return Math.round(((old - price) / old) * 100);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function safeSession(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  // Resize + JPEG-compress an image File in the browser.
  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not load image')); };
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            var scale = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (!blob) reject(new Error('Compress failed'));
            else resolve(blob);
          }, 'image/jpeg', quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ======================================================================
     3. TOASTS
     ====================================================================== */

  function toast(msg, kind) {
    var root = $('toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = String(msg);
    root.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    }, 3200);
  }

  /* ======================================================================
     4. APP STATE
     ====================================================================== */

  var state = {
    products: [],
    offers: { strip: [], banner: [], popup: [] },
    faqs: [],
    settings: {},
    reviewStats: {},     // productId -> { avg, count }
    reviewsCache: {},    // productId -> [reviews]
    category: 'All',
    searchQuery: '',
    currentProduct: null,
    currentSize: '',
    signedIn: false,
    currentUser: null,
    // banner carousel
    bannerIndex: 0,
    bannerTimer: null,
    // strip rotation
    stripIndex: 0,
    stripTimer: null,
    // search suggestions
    suggestIndex: -1,
    // review form
    reviewRating: 0,
    reviewPhotos: [],
    editingReviewId: null,
    // lightbox
    lightboxImages: [],
    lightboxIndex: 0
  };

  var STAR_PATH = 'M12 2.4l3 6.3 6.8.9-5 4.7 1.3 6.8L12 17.9 5.9 21.1l1.3-6.8-5-4.7 6.8-.9L12 2.4Z';

  // Render 5 stars for a rating (0-5, may be decimal).
  function starsHtml(rating, big) {
    var r = Number(rating) || 0;
    var out = '<span class="stars' + (big ? ' stars--lg' : '') + '" aria-label="' + r.toFixed(1) + ' out of 5">';
    for (var i = 1; i <= 5; i++) {
      var filled = r >= i - 0.5;
      out += '<svg viewBox="0 0 24 24" fill="currentColor" class="' + (filled ? '' : 'star--empty') + '"><path d="' + STAR_PATH + '"/></svg>';
    }
    return out + '</span>';
  }

  /* ======================================================================
     5. DEMO PRODUCTS (used when Supabase is missing or fails)
     ====================================================================== */

  function demoProducts() {
    var rows = [
      ['Classic Glass Bangles',   'Glass',        true ],
      ['Designer Glass Bangles',  'Glass',        true ],
      ['Festive Glass Bangles',   'Glass',        false],
      ['Traditional Bangles',     'Traditional',  true ],
      ['Wedding Glass Bangles',   'Bridal',       false],
      ['Fashion Bangles',         'Fashion',      false]
    ];
    return rows.map(function (r, i) {
      return {
        id: i + 1,
        name: r[0],
        category: r[1],
        price: 799,
        old_price: null,
        sizes: ['2.2', '2.4', '2.6', '2.8'],
        description: 'A handcrafted set from our studio in Gaya, Bihar. Every piece is finished by hand and checked for shine before it is packed.',
        main_image: '',
        additional_images: [],
        is_active: true,
        is_featured: r[2],
        sort_order: i + 1,
        created_at: new Date().toISOString()
      };
    });
  }

  // Default FAQs when the database has none.
  var FALLBACK_FAQS = [
    { question: 'How do I place an order?',
      answer: 'Open any bangle, choose your size and tap the WhatsApp order button. We confirm the design, price and address with you on WhatsApp.' },
    { question: 'Which sizes do you have?',
      answer: 'Most designs come in 2.2, 2.4, 2.6 and 2.8. The available sizes are shown as chips on every product.' },
    { question: 'Do you deliver all over India?',
      answer: 'Yes. We ship across India and usually dispatch within 1 working day.' },
    { question: 'Can I return or exchange bangles?',
      answer: 'If something arrives damaged, send us a photo within 48 hours and we will replace or refund it.' },
    { question: 'How do I pay?',
      answer: 'You can pay by UPI or bank transfer. Cash on delivery is available in selected PIN codes.' }
  ];

  /* ======================================================================
     6. DATA LOADING (all wrapped in try/catch, all return sensible defaults)
     ====================================================================== */

  async function loadSettings() {
    if (!CONFIGURED || !SB) return {};
    try {
      var res = await SB.from('site_settings').select('key, value');
      if (res.error) throw res.error;
      var out = {};
      (res.data || []).forEach(function (row) {
        var v = row.value;
        if (v === null || v === undefined) out[row.key] = '';
        else if (typeof v === 'string') out[row.key] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') out[row.key] = String(v);
        else out[row.key] = String(v);
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  async function loadProducts() {
    if (!CONFIGURED || !SB) return demoProducts();
    try {
      var res = await SB
        .from('products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) return demoProducts();
      return rows.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          category: p.category || 'Other',
          price: Number(p.price) || 0,
          old_price: p.old_price === null || p.old_price === undefined ? null : Number(p.old_price),
          sizes: Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['2.2', '2.4', '2.6', '2.8'],
          description: p.description || '',
          main_image: p.main_image || '',
          additional_images: Array.isArray(p.additional_images) ? p.additional_images : [],
          is_active: p.is_active !== false,
          is_featured: !!p.is_featured,
          sort_order: Number(p.sort_order) || 0,
          created_at: p.created_at
        };
      });
    } catch (e) {
      return demoProducts();
    }
  }

  async function loadOffers() {
    if (!CONFIGURED || !SB) return { strip: [], banner: [], popup: [] };
    try {
      var res = await SB
        .from('offers')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res.error) throw res.error;
      var now = Date.now();
      var live = (res.data || []).filter(function (o) {
        if (!o || o.is_active === false) return false;
        if (o.starts_at && new Date(o.starts_at).getTime() > now) return false;
        if (o.ends_at && new Date(o.ends_at).getTime() < now) return false;
        return true;
      });
      return {
        strip:  live.filter(function (o) { return o.display_type === 'strip'; }),
        banner: live.filter(function (o) { return o.display_type === 'banner'; }),
        popup:  live.filter(function (o) { return o.display_type === 'popup'; })
      };
    } catch (e) {
      return { strip: [], banner: [], popup: [] };
    }
  }

  async function loadFaqs() {
    if (!CONFIGURED || !SB) return [];
    try {
      var res = await SB
        .from('faqs')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res.error) throw res.error;
      return res.data || [];
    } catch (e) {
      return [];
    }
  }

  // Approved review stats per product (used for stars on cards + modal header).
  async function loadReviewStats() {
    if (!CONFIGURED || !SB) return {};
    try {
      var res = await SB.from('reviews').select('product_id, rating').eq('approved', true);
      if (res.error) throw res.error;
      var agg = {};
      (res.data || []).forEach(function (r) {
        var k = String(r.product_id);
        if (!agg[k]) agg[k] = { sum: 0, count: 0 };
        agg[k].sum += Number(r.rating) || 0;
        agg[k].count += 1;
      });
      var out = {};
      Object.keys(agg).forEach(function (k) {
        out[k] = { avg: agg[k].sum / agg[k].count, count: agg[k].count };
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  async function loadReviewsForProduct(productId) {
    if (!CONFIGURED || !SB) return [];
    try {
      var res = await SB
        .from('reviews')
        .select('id, product_id, user_id, user_name, user_avatar, rating, title, comment, images, approved, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      return res.data || [];
    } catch (e) {
      return [];
    }
  }

  /* ======================================================================
     7. SETTINGS TEXT: hero, about, trust, contact, footer
     ====================================================================== */

  function setting(key, fallback) {
    var v = state.settings[key];
    if (v === null || v === undefined) return fallback;
    var s = String(v).trim();
    return s === '' ? fallback : s;
  }

  function applySettingsToPage() {
    // ---- Hero ----
    var heroLabel = $('hero-label');
    if (heroLabel) heroLabel.textContent = setting('hero_label', 'Handcrafted in Gaya, Bihar');
    var heroHeading = $('hero-heading');
    if (heroHeading) heroHeading.textContent = setting('hero_heading', 'Timeless Bangles, Made for You');
    var heroText = $('hero-text');
    if (heroText) heroText.textContent = setting('hero_text',
      'Premium glass, traditional and bridal bangles — handcrafted with care and delivered across India.');

    // ---- About ----
    var aboutText = $('about-text');
    if (aboutText) aboutText.textContent = setting('about_text',
      'Viona Bangles is a small family studio in Gaya, Bihar. Every bangle is finished by hand, checked for shine and packed with love before it travels to you.');

    // ---- Trust points ----
    var trustGrid = $('trust-grid');
    if (trustGrid) {
      var items = [
        { t: setting('trust_1_title', 'Handcrafted'),    d: setting('trust_1_text', 'Finished by hand in our Gaya studio.'), icon: 'sparkle' },
        { t: setting('trust_2_title', 'Safe Packing'),   d: setting('trust_2_text', 'Bubble-wrapped and boxed for a safe journey.'), icon: 'box' },
        { t: setting('trust_3_title', 'Easy Ordering'),  d: setting('trust_3_text', 'Order on WhatsApp in under a minute.'), icon: 'chat' }
      ].filter(function (x) { return x.t || x.d; });

      trustGrid.innerHTML = items.map(function (x) {
        return '<div class="trust-item">' +
          '<span class="trust-item__ico" aria-hidden="true">' + trustIcon(x.icon) + '</span>' +
          '<div>' +
            '<h3 class="trust-item__title">' + esc(x.t) + '</h3>' +
            '<p class="trust-item__text">' + esc(x.d) + '</p>' +
          '</div>' +
        '</div>';
      }).join('');
      // Hide the whole section if nothing to show
      var trustSection = $('trust');
      if (trustSection) trustSection.hidden = items.length === 0;
    }

    // ---- Contact ----
    var cityEl = $('contact-city');
    if (cityEl) cityEl.textContent = setting('city', CONFIG.CITY || 'Gaya, Bihar');
    var hoursEl = $('contact-hours');
    if (hoursEl) hoursEl.textContent = setting('hours', CONFIG.HOURS || '10:00 AM - 7:00 PM');
    var emailEl = $('contact-email');
    if (emailEl) {
      var em = setting('email', CONFIG.EMAIL || 'vionabangles@gmail.com');
      emailEl.textContent = em;
      emailEl.setAttribute('href', 'mailto:' + em);
    }
    var phoneEl = $('contact-phone');
    if (phoneEl) {
      var ph = setting('phone', '');
      if (ph) {
        phoneEl.textContent = ph;
        phoneEl.setAttribute('href', 'tel:' + ph.replace(/[^0-9+]/g, ''));
      } else {
        var row = phoneEl.closest('li');
        if (row) row.style.display = 'none';
      }
    }

    // ---- WhatsApp links ----
    var waNumber = setting('whatsapp', CONFIG.WHATSAPP_NUMBER || '');
    var waHref = waNumber ? 'https://wa.me/' + waNumber.replace(/[^0-9]/g, '') : '#';
    ['header-whatsapp', 'mobile-whatsapp', 'hero-whatsapp', 'contact-whatsapp', 'footer-whatsapp'].forEach(function (id) {
      var a = $(id);
      if (a) {
        a.setAttribute('href', waHref);
        if (waHref !== '#') {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
      }
    });

    // ---- Contact email button ----
    var emailBtn = $('contact-email-btn');
    if (emailBtn) {
      emailBtn.setAttribute('href', 'mailto:' + setting('email', CONFIG.EMAIL || 'vionabangles@gmail.com'));
    }

    // ---- Footer ----
    var fCity = $('footer-city');
    if (fCity) fCity.textContent = setting('city', CONFIG.CITY || 'Gaya, Bihar');
    var fEmail = $('footer-email');
    if (fEmail) {
      var fe = setting('email', CONFIG.EMAIL || 'vionabangles@gmail.com');
      fEmail.textContent = fe;
      fEmail.setAttribute('href', 'mailto:' + fe);
    }
    var fYear = $('footer-year');
    if (fYear) fYear.textContent = String(new Date().getFullYear());

    // ---- Details tab ----
    var dv = $('detail-delivery');
    if (dv) dv.textContent = setting('delivery_text', 'We dispatch within 1 working day. Delivery across India usually takes 3 to 6 days.');
    var pv = $('detail-payment');
    if (pv) pv.textContent = setting('payment_text', 'Easy payment on WhatsApp — UPI, bank transfer or cash on delivery where available.');
    var rv = $('detail-returns');
    if (rv) rv.textContent = setting('return_text', 'Damaged in transit? Share a photo within 48 hours and we will replace or refund.');
  }

  function trustIcon(kind) {
    if (kind === 'box') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 12v9"/><path d="m3.3 7 8.7-5 8.7 5"/></svg>';
    }
    if (kind === 'chat') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>';
    }
    // sparkle
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6L12 3Z"/></svg>';
  }

  /* ======================================================================
     8. CATEGORY STRIP + PRODUCT GRID + SEARCH
     ====================================================================== */

  function buildCategories() {
    var seen = {};
    var list = ['All'];
    state.products.forEach(function (p) {
      var c = String(p.category || 'Other').trim();
      if (!c) return;
      var k = c.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      list.push(c);
    });
    return list;
  }

  function renderCategoryStrip() {
    var wrap = $('category-strip-inner');
    if (!wrap) return;
    var cats = buildCategories();
    wrap.innerHTML = cats.map(function (c) {
      var active = c.toLowerCase() === state.category.toLowerCase() ? ' is-active' : '';
      return '<button type="button" class="cat-chip' + active + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    $$('.cat-chip', wrap).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.category = btn.getAttribute('data-cat');
        renderCategoryStrip();
        renderGrid();
        var target = $('collections');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Products that pass the current category + search filters.
  function filteredProducts() {
    var cat = state.category.toLowerCase();
    var q = state.searchQuery.toLowerCase().trim();
    return state.products.filter(function (p) {
      if (cat !== 'all') {
        if (String(p.category || '').toLowerCase() !== cat) return false;
      }
      if (!q) return true;
      var code = productCode(p).toLowerCase();
      return (
        String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.category || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.description || '').toLowerCase().indexOf(q) !== -1 ||
        code.indexOf(q) !== -1
      );
    });
  }

  function cardHtml(p) {
    var img = safeUrl(p.main_image);
    var media = img
      ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" />'
      : '<div class="card__ph" aria-hidden="true">V</div>';

    var pct = discountPct(p);
    var badge = pct > 0 ? '<span class="card__badge">' + pct + '% OFF</span>' : '';

    var stats = state.reviewStats[String(p.id)];
    var ratingHtml = '';
    if (stats && stats.count > 0) {
      ratingHtml = '<div class="card__rating">' + starsHtml(stats.avg) +
        '<span>(' + stats.count + ')</span></div>';
    }

    var priceHtml = '<span class="price">' + esc(formatPrice(p.price)) + '</span>';
    if (p.old_price && Number(p.old_price) > Number(p.price)) {
      priceHtml += '<span class="price--old">' + esc(formatPrice(p.old_price)) + '</span>';
    }

    return '<article class="card" data-code="' + esc(productCode(p)) + '" tabindex="0" role="button" aria-label="View ' + esc(p.name) + '">' +
      '<div class="card__media">' + badge + media + '</div>' +
      '<div class="card__body">' +
        '<span class="card__cat">' + esc(p.category || 'Other') + '</span>' +
        '<h3 class="card__name">' + esc(p.name) + '</h3>' +
        ratingHtml +
        '<div class="card__price">' + priceHtml + '</div>' +
      '</div>' +
    '</article>';
  }

  function renderGrid() {
    var grid = $('product-grid');
    var skel = $('grid-skeleton');
    var noRes = $('no-results');
    var count = $('showing-count');
    if (!grid) return;

    if (skel) skel.hidden = true;

    var list = filteredProducts();
    grid.innerHTML = list.map(cardHtml).join('');

    if (count) {
      count.textContent = 'Showing ' + list.length + ' ' + (list.length === 1 ? 'bangle' : 'bangles');
    }

    if (noRes) noRes.hidden = list.length !== 0;

    // wire up card clicks
    $$('.card', grid).forEach(function (card) {
      card.addEventListener('click', function () {
        openProductByCode(card.getAttribute('data-code'));
      });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openProductByCode(card.getAttribute('data-code'));
        }
      });
    });
  }

  /* ---------------- Live search suggestions ---------------- */

  function showSuggestions(term) {
    var box = $('search-suggest');
    var input = $('search-input');
    if (!box || !input) return;

    var q = String(term || '').toLowerCase().trim();
    if (!q) {
      box.hidden = true;
      box.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    var matches = state.products.filter(function (p) {
      var code = productCode(p).toLowerCase();
      return (
        String(p.name || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.category || '').toLowerCase().indexOf(q) !== -1 ||
        String(p.description || '').toLowerCase().indexOf(q) !== -1 ||
        code.indexOf(q) !== -1
      );
    }).slice(0, 6);

    if (!matches.length) {
      box.innerHTML = '<div class="suggest-empty">No matches. Press Enter to see everything.</div>';
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      state.suggestIndex = -1;
      return;
    }

    box.innerHTML = matches.map(function (p, i) {
      var img = safeUrl(p.main_image);
      var thumb = img
        ? '<img class="suggest-item__thumb" src="' + esc(img) + '" alt="" loading="lazy" />'
        : '<span class="suggest-item__thumb" aria-hidden="true"></span>';
      return '<div class="suggest-item" role="option" tabindex="-1" data-code="' + esc(productCode(p)) + '" data-index="' + i + '">' +
        thumb +
        '<div class="suggest-item__body">' +
          '<span class="suggest-item__name">' + esc(p.name) + '</span>' +
          '<span class="suggest-item__meta">' + esc(productCode(p)) + ' · ' + esc(p.category || 'Other') + '</span>' +
        '</div>' +
        '<span class="suggest-item__price">' + esc(formatPrice(p.price)) + '</span>' +
      '</div>';
    }).join('');
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    state.suggestIndex = -1;

    $$('.suggest-item', box).forEach(function (el) {
      el.addEventListener('mouseenter', function () { highlightSuggest(Number(el.getAttribute('data-index'))); });
      el.addEventListener('click', function () {
        var code = el.getAttribute('data-code');
        hideSuggestions();
        openProductByCode(code);
      });
    });
  }

  function hideSuggestions() {
    var box = $('search-suggest');
    var input = $('search-input');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
    state.suggestIndex = -1;
  }

  function highlightSuggest(i) {
    var box = $('search-suggest');
    if (!box) return;
    var items = $$('.suggest-item', box);
    items.forEach(function (el) { el.classList.remove('is-active'); });
    if (i >= 0 && i < items.length) {
      items[i].classList.add('is-active');
      items[i].scrollIntoView({ block: 'nearest' });
      state.suggestIndex = i;
    } else {
      state.suggestIndex = -1;
    }
  }

  function wireSearch() {
    var form = $('search-form');
    var input = $('search-input');
    var clear = $('search-clear');
    if (!input) return;

    var debounced = debounce(function () { showSuggestions(input.value); }, 200);

    input.addEventListener('input', function () {
      if (clear) clear.hidden = input.value.length === 0;
      debounced();
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) showSuggestions(input.value);
    });

    input.addEventListener('keydown', function (ev) {
      var box = $('search-suggest');
      var items = box ? $$('.suggest-item', box) : [];

      if (ev.key === 'Escape') {
        hideSuggestions();
        return;
      }
      if (ev.key === 'ArrowDown' && items.length) {
        ev.preventDefault();
        var next = state.suggestIndex + 1;
        if (next >= items.length) next = 0;
        highlightSuggest(next);
        return;
      }
      if (ev.key === 'ArrowUp' && items.length) {
        ev.preventDefault();
        var prev = state.suggestIndex - 1;
        if (prev < 0) prev = items.length - 1;
        highlightSuggest(prev);
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (state.suggestIndex >= 0 && items[state.suggestIndex]) {
          var code = items[state.suggestIndex].getAttribute('data-code');
          hideSuggestions();
          openProductByCode(code);
          return;
        }
        // Otherwise treat Enter as a grid filter.
        state.searchQuery = input.value.trim();
        state.category = 'All';
        renderCategoryStrip();
        renderGrid();
        hideSuggestions();
        var target = $('collections');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        state.searchQuery = input.value.trim();
        renderCategoryStrip();
        renderGrid();
        hideSuggestions();
        var target = $('collections');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        input.value = '';
        clear.hidden = true;
        state.searchQuery = '';
        renderGrid();
        hideSuggestions();
        input.focus();
      });
    }

    // Close suggestions when clicking outside the search area.
    document.addEventListener('click', function (ev) {
      var box = $('search-suggest');
      if (!box || box.hidden) return;
      var wrap = document.querySelector('.header-search');
      if (wrap && !wrap.contains(ev.target)) hideSuggestions();
    });

    var reset = $('no-results-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        state.category = 'All';
        state.searchQuery = '';
        if (input) { input.value = ''; if (clear) clear.hidden = true; }
        renderCategoryStrip();
        renderGrid();
      });
    }
  }

  /* ======================================================================
     9. PRODUCT MODAL
     ====================================================================== */

  function openProductByCode(code) {
    if (!code) return;
    var key = String(code).toUpperCase();
    var product = null;
    for (var i = 0; i < state.products.length; i++) {
      if (productCode(state.products[i]).toUpperCase() === key) { product = state.products[i]; break; }
    }
    if (!product) return;
    openProduct(product);
  }

  function openProduct(product) {
    if (!product) return;
    state.currentProduct = product;
    state.currentSize = '';
    state.reviewRating = 0;
    state.reviewPhotos = [];
    state.editingReviewId = null;

    // Deep link
    var hash = '#product=' + productCode(product);
    if (window.location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (e) { window.location.hash = hash; }
    }

    // Code + name + description + rating
    var codeEl = $('modal-code');
    if (codeEl) codeEl.textContent = productCode(product);

    var titleEl = $('modal-title');
    if (titleEl) titleEl.textContent = product.name || 'Bangle';

    var descEl = $('modal-desc');
    if (descEl) descEl.textContent = product.description || '';

    // Price + discount
    var priceEl = $('modal-price');
    if (priceEl) {
      var pct = discountPct(product);
      var html = '<span class="price">' + esc(formatPrice(product.price)) + '</span>';
      if (product.old_price && Number(product.old_price) > Number(product.price)) {
        html += '<span class="price--old">' + esc(formatPrice(product.old_price)) + '</span>';
      }
      if (pct > 0) html += '<span class="price-off">' + pct + '% OFF</span>';
      priceEl.innerHTML = html;
    }

    // Rating in modal header (only when approved reviews exist)
    var ratingEl = $('modal-rating');
    if (ratingEl) {
      var stats = state.reviewStats[String(product.id)];
      if (stats && stats.count > 0) {
        ratingEl.hidden = false;
        ratingEl.innerHTML = starsHtml(stats.avg) +
          '<span>' + stats.avg.toFixed(1) + ' · ' + stats.count + ' review' + (stats.count === 1 ? '' : 's') + '</span>';
      } else {
        ratingEl.hidden = true;
        ratingEl.innerHTML = '';
      }
    }

    // Gallery
    var images = [];
    if (safeUrl(product.main_image)) images.push(safeUrl(product.main_image));
    (Array.isArray(product.additional_images) ? product.additional_images : []).forEach(function (u) {
      var s = safeUrl(u);
      if (s) images.push(s);
    });
    renderModalGallery(images, product.name);

    // Sizes
    renderModalSizes(Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['2.2', '2.4', '2.6', '2.8']);

    // Order button
    updateOrderButton();

    // Default tab: reviews
    switchTab('reviews');

    // Show modal
    var modal = $('product-modal');
    if (modal) {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      // focus the close button for accessibility
      var closeBtn = modal.querySelector('.modal__close');
      if (closeBtn) setTimeout(function () { try { closeBtn.focus(); } catch (e) {} }, 30);
    }

    // Load reviews
    loadAndRenderReviews(product);
  }

  function closeModal() {
    var modal = $('product-modal');
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    state.currentProduct = null;
    // remove hash without jumping
    try {
      if (window.location.hash.indexOf('#product=') === 0) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (e) {}
  }

  function renderModalGallery(images, name) {
    var mainImg = $('modal-main-img');
    var thumbs = $('modal-thumbs');
    if (!mainImg) return;

    if (!images.length) {
      mainImg.removeAttribute('src');
      mainImg.alt = name || 'Bangle';
      mainImg.style.display = 'none';
      if (thumbs) thumbs.innerHTML = '';
      var wrap = mainImg.parentNode;
      if (wrap && !wrap.querySelector('.card__ph')) {
        var ph = document.createElement('div');
        ph.className = 'card__ph';
        ph.textContent = 'V';
        wrap.appendChild(ph);
      }
      return;
    }

    // remove any placeholder
    var wrapEl = mainImg.parentNode;
    if (wrapEl) {
      var old = wrapEl.querySelector('.card__ph');
      if (old) old.parentNode.removeChild(old);
    }
    mainImg.style.display = 'block';
    mainImg.src = images[0];
    mainImg.alt = name || 'Bangle';

    if (thumbs) {
      thumbs.innerHTML = images.map(function (src, i) {
        return '<button type="button" class="modal__thumb' + (i === 0 ? ' is-active' : '') + '" data-index="' + i + '">' +
          '<img src="' + esc(src) + '" alt="" loading="lazy" />' +
        '</button>';
      }).join('');
      $$('.modal__thumb', thumbs).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-index')) || 0;
          mainImg.src = images[idx];
          $$('.modal__thumb', thumbs).forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        });
      });
    }
  }

  function renderModalSizes(sizes) {
    var wrap = $('modal-sizes');
    if (!wrap) return;
    wrap.innerHTML = sizes.map(function (s) {
      return '<button type="button" class="size-chip" data-size="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');
    state.currentSize = sizes.length ? String(sizes[0]) : '';
    $$('.size-chip', wrap).forEach(function (btn) {
      if (btn.getAttribute('data-size') === state.currentSize) btn.classList.add('is-active');
      btn.addEventListener('click', function () {
        $$('.size-chip', wrap).forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        state.currentSize = btn.getAttribute('data-size');
        updateOrderButton();
      });
    });
    updateOrderButton();
  }

  function updateOrderButton() {
    var a = $('modal-order');
    if (!a || !state.currentProduct) return;
    var waNumber = setting('whatsapp', CONFIG.WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    if (!waNumber) {
      a.setAttribute('href', '#');
      a.textContent = 'WhatsApp unavailable';
      return;
    }
    var p = state.currentProduct;
    var msg = 'Hi Viona Bangles! I am interested in "' + p.name + '" (' + productCode(p) + ')';
    if (state.currentSize) msg += ', size ' + state.currentSize;
    msg += '. Price shown: ' + formatPrice(p.price) + '.';
    a.setAttribute('href', 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.textContent = 'Order on WhatsApp';
  }

  function switchTab(name) {
    var tabs = $$('.modal__tabs .tab');
    tabs.forEach(function (t) {
      var active = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var detailsPanel = $('tab-details');
    var reviewsPanel = $('tab-reviews');
    if (detailsPanel) detailsPanel.hidden = name !== 'details';
    if (reviewsPanel) reviewsPanel.hidden = name !== 'reviews';
  }

  function wireModal() {
    var modal = $('product-modal');
    if (!modal) return;

    // Close buttons / backdrop
    $$('[data-close-modal]', modal).forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    // Esc closes
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (modal.classList.contains('is-open')) closeModal();
        var lb = $('lightbox');
        if (lb && lb.classList.contains('is-open')) closeLightbox();
      }
    });

    // Tabs
    $$('.modal__tabs .tab', modal).forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    // Sort change
    var sort = $('reviews-sort');
    if (sort) {
      sort.addEventListener('change', function () {
        if (state.currentProduct) renderReviewsList(state.currentProduct);
      });
    }
  }

  /* ======================================================================
     10. REVIEWS
     ====================================================================== */

  async function loadAndRenderReviews(product) {
    var loading = $('reviews-loading');
    var list = $('reviews-list');
    if (!product) return;

    if (loading) loading.hidden = false;
    if (list) list.innerHTML = '';

    var reviews = await loadReviewsForProduct(product.id);
    state.reviewsCache[String(product.id)] = reviews;

    if (loading) loading.hidden = true;
    renderReviews(product);
  }

  function renderReviews(product) {
    if (!product) return;
    var reviews = state.reviewsCache[String(product.id)] || [];
    var approved = reviews.filter(function (r) { return r.approved; });
    var myReview = null;
    if (state.signedIn && state.currentUser) {
      for (var i = 0; i < reviews.length; i++) {
        if (reviews[i].user_id === state.currentUser.id) { myReview = reviews[i]; break; }
      }
    }

    // Signed-in chip
    renderUserChip();

    // Summary (approved only)
    var summaryEl = $('reviews-summary');
    var toolbarEl = $('reviews-toolbar');
    if (summaryEl) {
      if (approved.length === 0) {
        summaryEl.hidden = true;
        summaryEl.innerHTML = '';
      } else {
        summaryEl.hidden = false;
        summaryEl.innerHTML = summaryHtml(approved);
      }
    }
    if (toolbarEl) toolbarEl.hidden = approved.length === 0;

    // Write area
    var writeEl = $('reviews-write');
    if (writeEl) renderWriteArea(writeEl, product, myReview);

    // List: approved + own pending (if any)
    renderReviewsList(product, approved, myReview);
  }

  function summaryHtml(reviews) {
    var sum = 0;
    var counts = [0, 0, 0, 0, 0];
    reviews.forEach(function (r) {
      var n = Number(r.rating) || 0;
      sum += n;
      if (n >= 1 && n <= 5) counts[5 - n] += 1;
    });
    var avg = reviews.length ? sum / reviews.length : 0;

    var bars = '';
    for (var s = 5; s >= 1; s--) {
      var idx = 5 - s;
      var c = counts[idx];
      var pct = reviews.length ? Math.round((c / reviews.length) * 100) : 0;
      bars += '<div class="rev-bar">' +
        '<span>' + s + ' star</span>' +
        '<span class="rev-bar__track"><span class="rev-bar__fill" style="width:' + pct + '%"></span></span>' +
        '<span class="rev-bar__pct">' + pct + '%</span>' +
      '</div>';
    }

    return '<div class="rev-summary__score">' +
        '<span class="rev-summary__num">' + avg.toFixed(1) + '</span>' +
        '<span class="rev-summary__out">out of 5</span>' +
        starsHtml(avg) +
        '<span class="rev-summary__count">' + reviews.length + ' review' + (reviews.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="rev-bars">' + bars + '</div>';
  }

  function renderReviewsList(product, approvedArg, myReviewArg) {
    var list = $('reviews-list');
    if (!list) return;

    var reviews = state.reviewsCache[String(product.id)] || [];
    var approved = approvedArg || reviews.filter(function (r) { return r.approved; });
    var myReview = myReviewArg;
    if (myReview === undefined) {
      myReview = null;
      if (state.signedIn && state.currentUser) {
        for (var i = 0; i < reviews.length; i++) {
          if (reviews[i].user_id === state.currentUser.id) { myReview = reviews[i]; break; }
        }
      }
    }

    var sortMode = ($('reviews-sort') && $('reviews-sort').value) || 'newest';

    var items = approved.slice();
    if (myReview && !myReview.approved) items = items.concat([myReview]);

    items.sort(function (a, b) {
      if (sortMode === 'highest') return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (sortMode === 'lowest')  return (Number(a.rating) || 0) - (Number(b.rating) || 0);
      // newest
      var da = a.created_at ? new Date(a.created_at).getTime() : 0;
      var db = b.created_at ? new Date(b.created_at).getTime() : 0;
      return db - da;
    });

    if (!items.length) {
      list.innerHTML = '<div class="rev-empty">No reviews yet. Be the first to review this bangle.</div>';
      return;
    }

    list.innerHTML = items.map(reviewCardHtml).join('');

    // Wire up edit / delete / photo clicks
    $$('[data-edit-review]', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.editingReviewId = Number(btn.getAttribute('data-edit-review'));
        var writeEl = $('reviews-write');
        if (writeEl) renderWriteArea(writeEl, product, myReview);
      });
    });
    $$('[data-delete-review]', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-delete-review'));
        deleteReview(id, product);
      });
    });
    $$('.rev-card__photo', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var src = btn.getAttribute('data-src');
        var card = btn.closest('.rev-card');
        var sources = [];
        if (card) {
          $$('.rev-card__photo', card).forEach(function (b) {
            sources.push(b.getAttribute('data-src'));
          });
        }
        openLightbox(sources, src);
      });
    });
  }

  function reviewCardHtml(r) {
    var isMine = state.signedIn && state.currentUser && r.user_id === state.currentUser.id;
    var name = String(r.user_name || 'Viona customer').trim() || 'Viona customer';
    var initial = name.charAt(0).toUpperCase();
    var avatar = safeUrl(r.user_avatar);
    var avatarHtml = avatar
      ? '<img class="rev-card__avatar" src="' + esc(avatar) + '" alt="" referrerpolicy="no-referrer" loading="lazy" />'
      : '<span class="rev-card__avatar" aria-hidden="true">' + esc(initial) + '</span>';

    var date = '';
    try {
      if (r.created_at) {
        var d = new Date(r.created_at);
        date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch (e) {}

    var photos = '';
    if (Array.isArray(r.images) && r.images.length) {
      photos = '<div class="rev-card__photos">' + r.images.map(function (u) {
        var s = safeUrl(u);
        if (!s) return '';
        return '<button type="button" class="rev-card__photo" data-src="' + esc(s) + '" aria-label="Open photo">' +
          '<img src="' + esc(s) + '" alt="Review photo" loading="lazy" />' +
        '</button>';
      }).join('') + '</div>';
    }

    var titleHtml = r.title ? '<h4 class="rev-card__title">' + esc(r.title) + '</h4>' : '';
    var badge = !r.approved ? '<span class="rev-badge">Pending approval</span>' : '';

    var actions = '';
    if (isMine) {
      actions = '<div class="rev-card__actions">' +
        '<button class="rev-card__action" type="button" data-edit-review="' + esc(String(r.id)) + '">Edit</button>' +
        '<button class="rev-card__action rev-card__action--danger" type="button" data-delete-review="' + esc(String(r.id)) + '">Delete</button>' +
      '</div>';
    }

    var commentHtml = esc(r.comment || '').replace(/\n/g, '<br>');

    return '<article class="rev-card" data-review-id="' + esc(String(r.id)) + '">' +
      '<div class="rev-card__head">' + avatarHtml +
        '<div class="rev-card__who">' +
          '<span class="rev-card__name">' + esc(name) + badge + '</span>' +
          '<span class="rev-card__date">' + esc(date) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="rev-card__stars">' + starsHtml(r.rating) + '</div>' +
      titleHtml +
      '<p class="rev-card__text">' + commentHtml + '</p>' +
      photos +
      actions +
    '</article>';
  }

  function renderUserChip() {
    var chip = $('user-chip');
    var avatar = $('user-chip-avatar');
    var nameEl = $('user-chip-name');
    if (!chip) return;

    if (!state.signedIn || !state.currentUser) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;

    var meta = state.currentUser.user_metadata || {};
    var display = meta.full_name || meta.name || (state.currentUser.email || '').split('@')[0] || 'Signed in';
    var avatarUrl = safeUrl(meta.avatar_url);

    if (nameEl) nameEl.textContent = display;
    if (avatar) {
      if (avatarUrl) {
        avatar.src = avatarUrl;
        avatar.style.display = '';
      } else {
        avatar.removeAttribute('src');
        avatar.style.display = 'none';
      }
    }
  }

  function renderWriteArea(el, product, myReview) {
    if (!CONFIGURED) {
      el.innerHTML = '<div class="rev-signin"><p class="rev-signin__text">Reviews become available once the shop is connected to its database.</p></div>';
      return;
    }

    if (!state.signedIn) {
      el.innerHTML =
        '<div class="rev-signin">' +
          '<p class="rev-signin__text">Sign in with Google to share your review.</p>' +
          '<button class="btn btn--gold" type="button" id="rev-signin-btn">Sign in with Google</button>' +
        '</div>';
      var btn = $('rev-signin-btn');
      if (btn) btn.addEventListener('click', signInWithGoogle);
      return;
    }

    var editing = myReview && state.editingReviewId === myReview.id;
    // If user already has a review and is not editing, hide the form entirely.
    if (myReview && !editing) {
      el.innerHTML = '';
      return;
    }

    // New review or editing — show the form.
    state.reviewRating = myReview ? Number(myReview.rating) || 0 : 0;
    state.reviewPhotos = [];
    if (myReview && Array.isArray(myReview.images)) {
      myReview.images.forEach(function (u) {
        var s = safeUrl(u);
        if (s) state.reviewPhotos.push({ existing: true, url: s });
      });
    }

    el.innerHTML = reviewFormHtml(myReview);
    wireReviewForm(product, myReview);
  }

  function reviewFormHtml(myReview) {
    var isEdit = !!myReview;
    var titleVal = isEdit ? (myReview.title || '') : '';
    var commentVal = isEdit ? (myReview.comment || '') : '';

    return '<div class="rev-form">' +
      '<h4 class="rev-form__title">' + (isEdit ? 'Edit your review' : 'Write a review') + '</h4>' +

      '<div class="rev-field">' +
        '<label class="rev-field__label">Your rating</label>' +
        starPickerHtml(state.reviewRating) +
      '</div>' +

      '<div class="rev-field">' +
        '<label class="rev-field__label" for="rev-title">Title (optional)</label>' +
        '<input class="rev-input" type="text" id="rev-title" maxlength="80" placeholder="Sum it up in a few words" value="' + esc(titleVal) + '" />' +
      '</div>' +

      '<div class="rev-field">' +
        '<label class="rev-field__label" for="rev-comment">Your review</label>' +
        '<textarea class="rev-textarea" id="rev-comment" minlength="10" maxlength="1000" placeholder="Tell us about the fit, finish and shine...">' + esc(commentVal) + '</textarea>' +
        '<span class="rev-field__hint"><span id="rev-char">' + commentVal.length + '</span> / 1000 · min 10</span>' +
      '</div>' +

      '<div class="rev-field">' +
        '<label class="rev-field__label">Photos (optional, up to 3)</label>' +
        '<div class="rev-photos" id="rev-photos"></div>' +
        '<input type="file" accept="image/*" id="rev-photo-input" hidden />' +
      '</div>' +

      '<div class="rev-form__actions">' +
        '<button class="btn btn--gold" type="button" id="rev-submit">' + (isEdit ? 'Save changes' : 'Submit review') + '</button>' +
        (isEdit ? '<button class="btn btn--outline" type="button" id="rev-cancel">Cancel</button>' : '') +
      '</div>' +

      '<p class="rev-form__msg" id="rev-msg" hidden></p>' +
    '</div>';
  }

  function starPickerHtml(value) {
    var out = '<div class="star-picker" id="rev-star-picker" role="radiogroup" aria-label="Your rating">';
    for (var i = 1; i <= 5; i++) {
      var on = i <= value ? ' is-on' : '';
      var tabindex = (value === 0 && i === 1) || value === i ? '0' : '-1';
      out += '<button type="button" class="star-picker__btn' + on + '" ' +
        'data-star="' + i + '" role="radio" aria-checked="' + (i === value ? 'true' : 'false') + '" ' +
        'aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '" tabindex="' + tabindex + '">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + STAR_PATH + '"/></svg>' +
      '</button>';
    }
    return out + '</div>';
  }

  function wireReviewForm(product, myReview) {
    // ---- Star picker ----
    var picker = $('rev-star-picker');
    if (picker) {
      var buttons = $$('.star-picker__btn', picker);
      function setRating(n) {
        state.reviewRating = n;
        buttons.forEach(function (b) {
          var s = Number(b.getAttribute('data-star'));
          b.classList.toggle('is-on', s <= n);
          b.setAttribute('aria-checked', s === n ? 'true' : 'false');
          b.setAttribute('tabindex', s === n ? '0' : '-1');
        });
      }
      buttons.forEach(function (b, idx) {
        var s = Number(b.getAttribute('data-star'));
        b.addEventListener('mouseenter', function () {
          buttons.forEach(function (x) {
            x.classList.toggle('is-on', Number(x.getAttribute('data-star')) <= s);
          });
        });
        b.addEventListener('mouseleave', function () { setRating(state.reviewRating); });
        b.addEventListener('click', function () { setRating(s); b.focus(); });
        b.addEventListener('keydown', function (ev) {
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            var nxt = buttons[(idx + 1) % buttons.length];
            nxt.focus();
            setRating(Number(nxt.getAttribute('data-star')));
          } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            var prv = buttons[(idx - 1 + buttons.length) % buttons.length];
            prv.focus();
            setRating(Number(prv.getAttribute('data-star')));
          } else if (ev.key === ' ' || ev.key === 'Enter') {
            ev.preventDefault();
            setRating(s);
          }
        });
      });
    }

    // ---- Character count ----
    var comment = $('rev-comment');
    var charEl = $('rev-char');
    if (comment && charEl) {
      comment.addEventListener('input', function () {
        charEl.textContent = String(comment.value.length);
      });
    }

    // ---- Photo upload ----
    renderReviewPhotos();
    var photoWrap = $('rev-photos');
    if (photoWrap) {
      photoWrap.addEventListener('click', function (ev) {
        var target = ev.target.closest ? ev.target.closest('button') : null;
        if (!target) return;
        if (target.classList.contains('rev-photo-add')) {
          var input = $('rev-photo-input');
          if (input) input.click();
          return;
        }
        if (target.classList.contains('rev-photo__remove')) {
          var idx = Number(target.getAttribute('data-index'));
          if (!isNaN(idx)) {
            state.reviewPhotos.splice(idx, 1);
            renderReviewPhotos();
          }
        }
      });
    }
    var fileInput = $('rev-photo-input');
    if (fileInput) {
      fileInput.addEventListener('change', async function () {
        var files = Array.prototype.slice.call(fileInput.files || []);
        for (var i = 0; i < files.length; i++) {
          if (state.reviewPhotos.length >= 3) {
            toast('You can add up to 3 photos.', 'error');
            break;
          }
          try {
            var blob = await compressImage(files[i], 1200, 0.85);
            var url = URL.createObjectURL(blob);
            state.reviewPhotos.push({ blob: blob, dataUrl: url });
            renderReviewPhotos();
          } catch (e) {
            toast('Could not process that image.', 'error');
          }
        }
        fileInput.value = '';
      });
    }

    // ---- Cancel ----
    var cancel = $('rev-cancel');
    if (cancel) {
      cancel.addEventListener('click', function () {
        state.editingReviewId = null;
        state.reviewPhotos = [];
        state.reviewRating = 0;
        var writeEl = $('reviews-write');
        if (writeEl) renderWriteArea(writeEl, product, myReview);
      });
    }

    // ---- Submit ----
    var submit = $('rev-submit');
    if (submit) {
      submit.addEventListener('click', function () { submitReview(product, myReview); });
    }
  }

  function renderReviewPhotos() {
    var wrap = $('rev-photos');
    if (!wrap) return;
    var html = state.reviewPhotos.map(function (ph, i) {
      var src = ph.existing ? ph.url : ph.dataUrl;
      var s = safeUrl(src);
      if (!s) return '';
      return '<div class="rev-photo">' +
        '<img src="' + esc(s) + '" alt="" />' +
        '<button type="button" class="rev-photo__remove" data-index="' + i + '" aria-label="Remove photo">×</button>' +
      '</div>';
    }).join('');
    if (state.reviewPhotos.length < 3) {
      html += '<button type="button" class="rev-photo-add" aria-label="Add photo">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        '<span>Add</span>' +
      '</button>';
    }
    wrap.innerHTML = html;
  }

  function showReviewMsg(msg, kind) {
    var el = $('rev-msg');
    if (!el) return;
    el.hidden = false;
    el.textContent = String(msg);
    el.className = 'rev-form__msg' + (kind === 'error' ? ' rev-form__msg--error' : kind === 'ok' ? ' rev-form__msg--ok' : '');
  }

  async function submitReview(product, myReview) {
    if (!CONFIGURED || !SB || !state.currentUser) return;

    var rating = state.reviewRating;
    if (!rating) { showReviewMsg('Please pick a rating.', 'error'); return; }

    var commentEl = $('rev-comment');
    var comment = commentEl ? String(commentEl.value || '').trim() : '';
    if (comment.length < 10) { showReviewMsg('Please write at least 10 characters.', 'error'); return; }
    if (comment.length > 1000) { showReviewMsg('Please keep your review under 1000 characters.', 'error'); return; }

    var titleEl = $('rev-title');
    var title = titleEl ? String(titleEl.value || '').trim() : '';
    if (title.length > 80) { showReviewMsg('Title is too long.', 'error'); return; }

    var submitBtn = $('rev-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    showReviewMsg('Uploading your review…', 'ok');

    try {
      // ---- Upload any new photos ----
      var images = [];
      for (var i = 0; i < state.reviewPhotos.length; i++) {
        var ph = state.reviewPhotos[i];
        if (ph.existing && ph.url) { images.push(ph.url); continue; }
        if (!ph.blob) continue;
        var path = state.currentUser.id + '/' + Date.now() + '-' + i + '.jpg';
        var upRes = await SB.storage.from('review-images').upload(path, ph.blob, {
          contentType: 'image/jpeg',
          upsert: false
        });
        if (upRes.error) throw upRes.error;
        var pub = SB.storage.from('review-images').getPublicUrl(path);
        var url = pub && pub.data && pub.data.publicUrl;
        if (url) images.push(url);
      }

      var meta = state.currentUser.user_metadata || {};
      var userName = meta.full_name || meta.name || (state.currentUser.email || '').split('@')[0] || 'Viona customer';
      var userAvatar = meta.avatar_url || '';

      var payload = {
        product_id: product.id,
        user_id: state.currentUser.id,
        user_name: userName,
        user_avatar: userAvatar,
        rating: rating,
        title: title || null,
        comment: comment,
        images: images,
        approved: false
      };

      if (myReview && myReview.id) {
        var upd = await SB.from('reviews').update(payload).eq('id', myReview.id);
        if (upd.error) throw upd.error;
      } else {
        var ins = await SB.from('reviews').insert(payload);
        if (ins.error) throw ins.error;
      }

      state.editingReviewId = null;
      state.reviewPhotos = [];
      state.reviewRating = 0;
      toast('Thank you! Your review will appear after approval.', 'ok');

      await loadAndRenderReviews(product);
      // Refresh card stats (approved reviews only, so user won't see their own yet).
      state.reviewStats = await loadReviewStats();
      renderGrid();
    } catch (err) {
      showReviewMsg('Could not save your review. Please try again.', 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = myReview && myReview.id ? 'Save changes' : 'Submit review'; }
    }
  }

  async function deleteReview(id, product) {
    if (!CONFIGURED || !SB || !state.currentUser) return;
    var ok = window.confirm('Delete your review? This cannot be undone.');
    if (!ok) return;
    try {
      var res = await SB.from('reviews').delete().eq('id', id);
      if (res.error) throw res.error;
      toast('Your review was deleted.', 'ok');
      state.editingReviewId = null;
      await loadAndRenderReviews(product);
      state.reviewStats = await loadReviewStats();
      renderGrid();
    } catch (e) {
      toast('Could not delete the review. Please try again.', 'error');
    }
  }

  /* ======================================================================
     11. LIGHTBOX
     ====================================================================== */

  function openLightbox(images, currentSrc) {
    var lb = $('lightbox');
    var img = $('lightbox-img');
    if (!lb || !img) return;
    state.lightboxImages = Array.isArray(images) ? images.slice() : [];
    state.lightboxIndex = 0;
    if (currentSrc) {
      var idx = state.lightboxImages.indexOf(currentSrc);
      if (idx >= 0) state.lightboxIndex = idx;
    }
    if (!state.lightboxImages.length && currentSrc) state.lightboxImages = [currentSrc];
    var src = state.lightboxImages[state.lightboxIndex] || '';
    img.src = src;
    lb.classList.add('is-open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }

  function closeLightbox() {
    var lb = $('lightbox');
    var img = $('lightbox-img');
    if (!lb) return;
    lb.classList.remove('is-open');
    lb.setAttribute('aria-hidden', 'true');
    if (img) img.removeAttribute('src');
    document.body.classList.remove('no-scroll');
  }

  function stepLightbox(delta) {
    if (!state.lightboxImages.length) return;
    state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxImages.length) % state.lightboxImages.length;
    var img = $('lightbox-img');
    if (img) img.src = state.lightboxImages[state.lightboxIndex];
  }

  function wireLightbox() {
    var lb = $('lightbox');
    if (!lb) return;
    var close = $('lightbox-close');
    if (close) close.addEventListener('click', closeLightbox);
    var prev = $('lightbox-prev');
    if (prev) prev.addEventListener('click', function () { stepLightbox(-1); });
    var next = $('lightbox-next');
    if (next) next.addEventListener('click', function () { stepLightbox(1); });
    lb.addEventListener('click', function (ev) {
      if (ev.target === lb) closeLightbox();
    });
  }

  /* ======================================================================
     12. OFFERS: STRIP, BANNER, POPUP
     ====================================================================== */

  function offerBgStyle(o) {
    // Build an inline style string from the offer colours / image.
    var parts = [];
    var img = safeUrl(o.bg_image);
    if (img) parts.push('background-image:url(' + JSON.stringify(img) + ')');
    var c1 = typeof o.bg_color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.bg_color) ? o.bg_color : '';
    var c2 = typeof o.bg_color_2 === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.bg_color_2) ? o.bg_color_2 : '';
    if (c1 && c2) parts.push('background-color:' + c1);
    else if (c1) parts.push('background-color:' + c1);
    if (c1 && c2) parts.push('background-image:linear-gradient(120deg,' + c1 + ',' + c2 + ')' + (img ? ',url(' + JSON.stringify(img) + ')' : ''));
    return parts.join(';');
  }

  // ---------- STRIP ----------
  function renderStrip() {
    var root = $('strip-root');
    if (!root) return;
    var items = state.offers.strip || [];

    function currentlyClosed(id) {
      return safeSession(function () {
        return sessionStorage.getItem('viona_strip_closed_' + id) === '1';
      }, false);
    }

    var visible = items.filter(function (o) { return !currentlyClosed(o.id); });
    if (!visible.length) {
      root.innerHTML = '';
      if (state.stripTimer) { clearInterval(state.stripTimer); state.stripTimer = null; }
      return;
    }

    function paint(idx) {
      if (idx >= visible.length) idx = 0;
      state.stripIndex = idx;
      var o = visible[idx];
      var textColor = /^#[0-9a-f]{3,8}$/i.test(o.text_color || '') ? o.text_color : '#FFFFFF';
      var bg = offerBgStyle(o);
      var inner = '<span class="strip__text">' + esc(o.title || '') + '</span>';
      if (o.subtitle) inner += ' <span class="strip__text">' + esc(o.subtitle) + '</span>';
      if (o.button_text && o.button_link) {
        inner += ' <a class="strip__link" href="' + esc(safeUrl(o.button_link) || '#') + '">' + esc(o.button_text) + '</a>';
      }
      root.innerHTML = '<div class="strip" style="' + bg + ';color:' + textColor + '" role="status">' +
        inner +
        '<button class="strip__close" type="button" aria-label="Close">×</button>' +
      '</div>';
      var close = root.querySelector('.strip__close');
      if (close) {
        close.addEventListener('click', function () {
          safeSession(function () { sessionStorage.setItem('viona_strip_closed_' + o.id, '1'); });
          renderStrip();
        });
      }
    }

    paint(0);

    if (state.stripTimer) clearInterval(state.stripTimer);
    if (visible.length > 1) {
      state.stripTimer = setInterval(function () {
        paint((state.stripIndex + 1) % visible.length);
      }, 4000);
    }
  }

  // ---------- BANNER CAROUSEL ----------
  function renderBanner() {
    var root = $('banner-root');
    if (!root) return;
    var items = state.offers.banner || [];
    if (!items.length) {
      root.innerHTML = '';
      if (state.bannerTimer) { clearInterval(state.bannerTimer); state.bannerTimer = null; }
      return;
    }

    var slides = items.map(function (o) {
      var align = (o.text_align === 'left' || o.text_align === 'right') ? o.text_align : 'center';
      var bg = offerBgStyle(o);
      var textColor = /^#[0-9a-f]{3,8}$/i.test(o.text_color || '') ? o.text_color : '#FFFFFF';
      var btnBg = /^#[0-9a-f]{3,8}$/i.test(o.button_bg || '') ? o.button_bg : '#C9A24A';
      var btnColor = /^#[0-9a-f]{3,8}$/i.test(o.button_text_color || '') ? o.button_text_color : '#14224A';
      var btn = '';
      if (o.button_text && o.button_link) {
        btn = '<a class="banner__btn" href="' + esc(safeUrl(o.button_link) || '#') + '" style="background:' + btnBg + ';color:' + btnColor + '">' + esc(o.button_text) + '</a>';
      }
      return '<div class="banner__slide banner__slide--' + align + '" style="' + bg + ';color:' + textColor + '">' +
        '<div class="banner__content">' +
          (o.title ? '<h3 class="banner__title">' + esc(o.title) + '</h3>' : '') +
          (o.subtitle ? '<p class="banner__subtitle">' + esc(o.subtitle) + '</p>' : '') +
          btn +
        '</div>' +
      '</div>';
    }).join('');

    var dots = items.map(function (_, i) {
      return '<button class="banner__dot' + (i === 0 ? ' is-active' : '') + '" type="button" aria-label="Go to slide ' + (i + 1) + '" data-idx="' + i + '"></button>';
    }).join('');

    var arrows = items.length > 1
      ? '<button class="banner__arrow banner__arrow--prev" type="button" aria-label="Previous slide">&#8249;</button>' +
        '<button class="banner__arrow banner__arrow--next" type="button" aria-label="Next slide">&#8250;</button>'
      : '';

    root.innerHTML = '<div class="banner">' +
      '<div class="banner__viewport" id="banner-viewport">' +
        '<div class="banner__track" id="banner-track">' + slides + '</div>' +
        arrows +
        (items.length > 1 ? '<div class="banner__dots" id="banner-dots">' + dots + '</div>' : '') +
      '</div>' +
    '</div>';

    var track = $('banner-track');
    var viewport = $('banner-viewport');
    if (!track) return;

    state.bannerIndex = 0;
    function go(i) {
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      state.bannerIndex = i;
      track.style.transform = 'translateX(-' + (i * 100) + '%)';
      var dotsWrap = $('banner-dots');
      if (dotsWrap) {
        $$('.banner__dot', dotsWrap).forEach(function (d, di) {
          d.classList.toggle('is-active', di === i);
        });
      }
    }

    var prevBtn = root.querySelector('.banner__arrow--prev');
    if (prevBtn) prevBtn.addEventListener('click', function () { go(state.bannerIndex - 1); resetAuto(); });
    var nextBtn = root.querySelector('.banner__arrow--next');
    if (nextBtn) nextBtn.addEventListener('click', function () { go(state.bannerIndex + 1); resetAuto(); });

    var dotsWrap = $('banner-dots');
    if (dotsWrap) {
      $$('.banner__dot', dotsWrap).forEach(function (d) {
        d.addEventListener('click', function () {
          go(Number(d.getAttribute('data-idx')) || 0);
          resetAuto();
        });
      });
    }

    function resetAuto() {
      if (state.bannerTimer) clearInterval(state.bannerTimer);
      if (items.length > 1) {
        state.bannerTimer = setInterval(function () { go(state.bannerIndex + 1); }, 5000);
      }
    }
    resetAuto();

    // Pause on hover
    if (viewport) {
      viewport.addEventListener('mouseenter', function () {
        if (state.bannerTimer) { clearInterval(state.bannerTimer); state.bannerTimer = null; }
      });
      viewport.addEventListener('mouseleave', resetAuto);

      // Swipe
      var startX = 0, startY = 0, moved = false;
      viewport.addEventListener('touchstart', function (ev) {
        if (!ev.touches || !ev.touches.length) return;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        moved = false;
      }, { passive: true });
      viewport.addEventListener('touchmove', function (ev) {
        if (!ev.touches || !ev.touches.length) return;
        var dx = ev.touches[0].clientX - startX;
        var dy = ev.touches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) moved = true;
      }, { passive: true });
      viewport.addEventListener('touchend', function (ev) {
        if (!moved || !ev.changedTouches || !ev.changedTouches.length) return;
        var dx = ev.changedTouches[0].clientX - startX;
        if (dx < -40) go(state.bannerIndex + 1);
        else if (dx > 40) go(state.bannerIndex - 1);
        resetAuto();
      });
    }
  }

  // ---------- POPUP ----------
  function renderPopup() {
    var root = $('popup-root');
    if (!root) return;
    var items = state.offers.popup || [];
    if (!items.length) { root.innerHTML = ''; return; }

    // Only the first active popup per session.
    var o = items[0];
    var seen = safeSession(function () {
      return sessionStorage.getItem('viona_popup_seen_' + o.id) === '1';
    }, false);
    if (seen) return;

    setTimeout(function () {
      // Bail if the modal is currently open.
      var modal = $('product-modal');
      if (modal && modal.classList.contains('is-open')) return;

      var bg = offerBgStyle(o);
      var textColor = /^#[0-9a-f]{3,8}$/i.test(o.text_color || '') ? o.text_color : '#FFFFFF';
      var btnBg = /^#[0-9a-f]{3,8}$/i.test(o.button_bg || '') ? o.button_bg : '#C9A24A';
      var btnColor = /^#[0-9a-f]{3,8}$/i.test(o.button_text_color || '') ? o.button_text_color : '#14224A';
      var btn = '';
      if (o.button_text && o.button_link) {
        btn = '<a class="popup__btn" href="' + esc(safeUrl(o.button_link) || '#') + '" style="background:' + btnBg + ';color:' + btnColor + '">' + esc(o.button_text) + '</a>';
      }
      root.innerHTML = '<div class="popup" id="popup-overlay">' +
        '<div class="popup__box" style="' + bg + ';color:' + textColor + '">' +
          '<button class="popup__close" type="button" aria-label="Close">×</button>' +
          '<div class="popup__body">' +
            (o.title ? '<h3 class="popup__title">' + esc(o.title) + '</h3>' : '') +
            (o.subtitle ? '<p class="popup__subtitle">' + esc(o.subtitle) + '</p>' : '') +
            btn +
          '</div>' +
        '</div>' +
      '</div>';

      safeSession(function () { sessionStorage.setItem('viona_popup_seen_' + o.id, '1'); });

      var overlay = $('popup-overlay');
      var close = root.querySelector('.popup__close');
      function closeIt() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      if (close) close.addEventListener('click', closeIt);
      if (overlay) {
        overlay.addEventListener('click', function (ev) {
          if (ev.target === overlay) closeIt();
        });
      }
    }, 2000);
  }

  /* ======================================================================
     13. FAQ
     ====================================================================== */

  function renderFaqs() {
    var list = $('faq-list');
    if (!list) return;
    var items = (state.faqs && state.faqs.length) ? state.faqs : FALLBACK_FAQS;
    if (!items.length) { list.innerHTML = ''; return; }

    list.innerHTML = items.map(function (f, i) {
      return '<div class="faq-item">' +
        '<button class="faq-item__q" type="button" aria-expanded="false" aria-controls="faq-a-' + i + '">' +
          '<span>' + esc(f.question || '') + '</span>' +
          '<span class="faq-item__icon" aria-hidden="true">+</span>' +
        '</button>' +
        '<div class="faq-item__a" id="faq-a-' + i + '">' +
          '<div class="faq-item__a-inner">' + esc(f.answer || '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('.faq-item__q', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.parentNode;
        var open = item.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /* ======================================================================
     14. MOBILE MENU + HEADER BEHAVIOUR
     ====================================================================== */

  function wireHeader() {
    var burger = $('hamburger');
    var menu = $('mobile-menu');
    if (burger && menu) {
      burger.addEventListener('click', function () {
        var open = menu.hidden;
        menu.hidden = !open;
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
      // Close menu when a link is clicked
      $$('.mobile-menu__link', menu).forEach(function (a) {
        a.addEventListener('click', function () {
          menu.hidden = true;
          burger.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  /* ======================================================================
     15. AUTH
     ====================================================================== */

  async function signInWithGoogle() {
    if (!CONFIGURED || !SB) {
      toast('Sign in is not available right now.', 'error');
      return;
    }
    try {
      // Preserve the current hash so we return to the same product.
      var redirectTo = window.location.origin + window.location.pathname + window.location.search + window.location.hash;
      var res = await SB.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo }
      });
      if (res.error) throw res.error;
    } catch (e) {
      toast('Could not start sign in. Please try again.', 'error');
    }
  }

  async function signOut() {
    if (!CONFIGURED || !SB) return;
    try {
      await SB.auth.signOut();
      toast('Signed out.', 'ok');
    } catch (e) {
      toast('Could not sign out.', 'error');
    }
  }

  function wireAuth() {
    // Sign out button inside the modal
    var outBtn = $('user-chip-out');
    if (outBtn) outBtn.addEventListener('click', signOut);

    if (!CONFIGURED || !SB) return;

    // Listen for sign in / sign out events
    SB.auth.onAuthStateChange(function (_event, session) {
      var user = session && session.user ? session.user : null;
      state.signedIn = !!user;
      state.currentUser = user;
      renderUserChip();
      if (state.currentProduct) {
        var modal = $('product-modal');
        if (modal && modal.classList.contains('is-open')) {
          loadAndRenderReviews(state.currentProduct);
        }
      }
    });

    // Check current session on load
    (async function () {
      try {
        var res = await SB.auth.getSession();
        var user = res && res.data && res.data.session && res.data.session.user;
        state.signedIn = !!user;
        state.currentUser = user || null;
        renderUserChip();
        if (state.currentProduct) {
          var modal = $('product-modal');
          if (modal && modal.classList.contains('is-open')) {
            loadAndRenderReviews(state.currentProduct);
          }
        }
      } catch (e) { /* ignore */ }
    })();
  }

  /* ======================================================================
     16. DEEP LINK (#product=VB-001)
     ====================================================================== */

  function handleHash() {
    var hash = String(window.location.hash || '');
    var m = hash.match(/^#product=([A-Za-z0-9\-_]+)/);
    if (!m) return;
    var code = m[1];
    // Wait a tick so products are already loaded.
    setTimeout(function () { openProductByCode(code); }, 30);
  }

  /* ======================================================================
     17. INIT
     ====================================================================== */

  async function init() {
    // Wire up static interactions first so the page feels alive even while
    // the network is slow.
    wireHeader();
    wireSearch();
    wireModal();
    wireLightbox();
    wireAuth();

    // Load data in parallel
    var results = await Promise.all([
      loadSettings(),
      loadProducts(),
      loadOffers(),
      loadFaqs()
    ]);
    state.settings = results[0] || {};
    state.products = results[1] || [];
    state.offers = results[2] || { strip: [], banner: [], popup: [] };
    state.faqs = results[3] || [];

    // Review stats (approved only) — nice to have, never blocks.
    try {
      state.reviewStats = await loadReviewStats();
    } catch (e) {
      state.reviewStats = {};
    }

    // Paint the page
    applySettingsToPage();
    renderCategoryStrip();
    renderGrid();
    renderFaqs();
    renderStrip();
    renderBanner();
    renderPopup();

    // Deep link (after products are painted)
    handleHash();
    window.addEventListener('hashchange', handleHash);

    // Show a friendly heads-up if Supabase is not connected yet.
    if (!CONFIGURED) {
      // A very small, subtle notice. Never an error.
      setTimeout(function () {
        toast('Showing demo bangles. Connect Supabase to load real products.', 'ok');
      }, 900);
    }
  }

  // Kick everything off once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
