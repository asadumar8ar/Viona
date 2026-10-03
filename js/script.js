/* ============================================================================
   Viona Bangles — js/script.js
   ----------------------------------------------------------------------------
   Public website logic:
     - Loads products, offers, FAQs, settings from Supabase
     - Falls back to demo products if Supabase is not configured or fails
     - Header search + suggestions, category strip
     - Product modal with image gallery, size chips, WhatsApp button
     - Offers: strip, banner carousel, popup (each hidden if empty)
     - Reviews: summary, list, sort, form, lightbox
     - Deep link #product=VB-001

   SAFETY RULES FOLLOWED:
     - Every network call is inside try/catch
     - Every DOM element is checked before use
     - All database/user text is escaped before being put into innerHTML
     - If Supabase is missing, the site runs on demo data with no visible error
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIG + SUPABASE CLIENT
     ========================================================================== */

  var CFG = window.VIONA_CONFIG || {};

  // Detect placeholder values and treat them as "not configured"
  function isPlaceholder(v){
    return !v || typeof v !== 'string' ||
           v.indexOf('PASTE_') === 0 ||
           v.indexOf('PASTE_YOUR') !== -1 ||
           v.indexOf('.supabase.co') === -1;
  }

  var SUPABASE_READY = false;
  var sb = null;

  try {
    if (!isPlaceholder(CFG.SUPABASE_URL) && !isPlaceholder(CFG.SUPABASE_ANON_KEY)) {
      // The global `supabase` object comes from the CDN script tag in index.html
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        SUPABASE_READY = true;
      }
    }
  } catch (e) {
    // Swallow any error here — the site will just use demo data
    SUPABASE_READY = false;
    sb = null;
  }

  /* ==========================================================================
     2. SMALL UTILITY HELPERS
     ========================================================================== */

  // Safe element lookup (never throws if missing)
  function el(id){ return document.getElementById(id); }

  // Escape any text before inserting into innerHTML
  function esc(s){
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Escape for use inside an attribute value
  function escAttr(s){ return esc(s); }

  // Build a safe WhatsApp link
  function waLink(number, message){
    var n = String(number || '').replace(/[^0-9]/g, '');
    var text = encodeURIComponent(message || '');
    return 'https://wa.me/' + n + (text ? '?text=' + text : '');
  }

  // Format a price like "Rs 799"
  function money(n){
    var num = Number(n);
    if (isNaN(num)) num = 0;
    // Show without decimals if whole number
    var s = (num % 1 === 0) ? String(num) : num.toFixed(2);
    return 'Rs ' + s;
  }

  // Discount percentage (returns 0 if none)
  function discountPct(price, oldPrice){
    var p = Number(price), o = Number(oldPrice);
    if (!o || !p || o <= p) return 0;
    return Math.round(((o - p) / o) * 100);
  }

  // Product code from id -> "VB-001"
  function productCode(id){
    var n = Number(id) || 0;
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return 'VB-' + s;
  }

  // Code -> id ("VB-001" -> 1). Returns 0 if invalid.
  function codeToId(code){
    if (!code) return 0;
    var m = String(code).toUpperCase().match(/^VB-(\d+)$/);
    if (!m) return 0;
    return parseInt(m[1], 10);
  }

  // Format date as "12 Sep 2025"
  function formatDate(iso){
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    } catch (e) { return ''; }
  }

  // Build 5-star HTML from a rating 0-5
  function starsHtml(rating){
    var r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="' + (i <= r ? '' : 'star-off') + '">★</span>';
    }
    return out;
  }

  // Debounce
  function debounce(fn, ms){
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // Simple toast
  var toastTimer = null;
  function toast(msg){
    var t = el('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.hidden = false;
    // Force reflow so the transition can run
    void t.offsetWidth;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 2600);
  }

  // Safe sessionStorage wrapper
  function sessionGet(key){
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function sessionSet(key, val){
    try { window.sessionStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  /* ==========================================================================
     3. STATE
     ========================================================================== */

  var state = {
    products: [],              // all active products
    filtered: [],              // current grid
    categories: [],            // ["All", "Glass", ...]
    activeCategory: 'All',
    searchTerm: '',
    faqs: [],
    settings: {},              // { business, hero, about, policies, trust, social }
    offers: { strips: [], banners: [], popups: [] },
    currentProduct: null,      // product open in the modal
    currentSize: null,         // selected size chip
    currentImageIndex: 0,
    galleryImages: [],

    // Reviews
    reviews: [],               // approved reviews for current product
    reviewsByRating: { 5:0, 4:0, 3:0, 2:0, 1:0 },
    reviewSort: 'newest',
    currentUser: null,         // Supabase auth user
    myReview: null,            // current user's review for current product
    editingReview: false,

    // Lightbox
    lightbox: { images: [], index: 0 },

    // Search UI
    suggestIndex: -1,
    suggestItems: [],

    // Banner
    bannerIndex: 0,
    bannerTimer: null,
    strips: [],
    stripTimer: null
  };

  /* ==========================================================================
     4. DEMO PRODUCTS (used only when Supabase is not configured or fails)
     ========================================================================== */

  var DEMO_PRODUCTS = [
    { id: 1, name: 'Classic Glass Bangles', category: 'Glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Everyday glass bangles with a smooth finish and a comfortable fit.',
      main_image: '', additional_images: [], is_active: true, is_featured: true, sort_order: 1 },
    { id: 2, name: 'Designer Glass Bangles', category: 'Glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Designer glass bangles with fine detailing, made for festive days.',
      main_image: '', additional_images: [], is_active: true, is_featured: true, sort_order: 2 },
    { id: 3, name: 'Festive Glass Bangles', category: 'Glass', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Bright festive glass bangles that go beautifully with sarees and lehengas.',
      main_image: '', additional_images: [], is_active: true, is_featured: false, sort_order: 3 },
    { id: 4, name: 'Traditional Bangles', category: 'Traditional', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Traditional bangles crafted in Gaya, Bihar with a rich heritage finish.',
      main_image: '', additional_images: [], is_active: true, is_featured: false, sort_order: 4 },
    { id: 5, name: 'Wedding Glass Bangles', category: 'Bridal', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Bridal glass bangles designed for weddings and special family functions.',
      main_image: '', additional_images: [], is_active: true, is_featured: false, sort_order: 5 },
    { id: 6, name: 'Fashion Bangles', category: 'Fashion', price: 799, old_price: null,
      sizes: ['2.2','2.4','2.6','2.8'],
      description: 'Trendy fashion bangles for a modern, stylish everyday look.',
      main_image: '', additional_images: [], is_active: true, is_featured: false, sort_order: 6 }
  ];

  var DEMO_FAQS = [
    { question: 'Do you deliver across India?',
      answer: 'Yes. We ship to all pin codes in India. Delivery usually takes 3 to 7 working days and shipping is free on prepaid orders.',
      sort_order: 1, is_active: true },
    { question: 'How do I place an order?',
      answer: 'Open any bangle, choose your size and tap the WhatsApp button. Send us the product code (for example VB-001) and your address. We confirm the order on WhatsApp.',
      sort_order: 2, is_active: true },
    { question: 'Which sizes are available?',
      answer: 'Most bangles come in 2.2, 2.4, 2.6 and 2.8. If you are not sure about your size, message us on WhatsApp and we will help you measure.',
      sort_order: 3, is_active: true },
    { question: 'Is Cash on Delivery available?',
      answer: 'Yes, Cash on Delivery is available on most pin codes. Prepaid orders are packed and shipped faster.',
      sort_order: 4, is_active: true },
    { question: 'Can I return or exchange?',
      answer: 'Yes. If you receive a damaged or wrong item, contact us within 7 days of delivery with an unboxing video and we will replace or refund it.',
      sort_order: 5, is_active: true },
    { question: 'Are these real glass bangles?',
      answer: 'Yes. Our glass bangles are handcrafted in Gaya, Bihar by traditional artisans using the same methods used for generations.',
      sort_order: 6, is_active: true }
  ];

  /* ==========================================================================
     5. LOAD SITE SETTINGS
     ========================================================================== */

  async function loadSettings(){
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

    if (!SUPABASE_READY) return merged;

    try {
      var res = await sb.from('site_settings').select('key,value');
      if (res && res.error) throw res.error;
      var rows = (res && res.data) || [];
      rows.forEach(function (row) {
        if (!row || !row.key) return;
        var key = String(row.key);
        var val = row.value;
        if (!val || typeof val !== 'object') return;
        if (merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
          merged[key] = Object.assign({}, merged[key], val);
        } else {
          merged[key] = val;
        }
      });
    } catch (e) {
      // Quietly keep defaults
    }

    return merged;
  }

  function applySettings(){
    var s = state.settings || {};
    var b = s.business || {};
    var h = s.hero || {};
    var a = s.about || {};
    var t = s.trust || {};
    var soc = s.social || {};

    var waNum = b.whatsapp || CFG.WHATSAPP_NUMBER || '';
    var waMsg = 'Hello Viona Bangles, I would like to know more about your bangles.';

    // Hero
    var heroLabel = el('heroLabel');   if (heroLabel) heroLabel.textContent = h.label || '';
    var heroHead  = el('heroHeading'); if (heroHead)  heroHead.textContent  = h.heading || '';
    var heroText  = el('heroText');    if (heroText)  heroText.textContent  = h.text || '';

    // About
    var aboutHead = el('aboutHeading'); if (aboutHead) aboutHead.textContent = a.heading || '';
    var aboutText = el('aboutText');    if (aboutText) aboutText.textContent = a.text || '';

    // About points
    var aboutPoints = el('aboutPoints');
    if (aboutPoints) {
      var pts = Array.isArray(t.points) ? t.points : [];
      var pptHtml = '';
      pts.forEach(function (p) {
        if (!p) return;
        pptHtml += '<li>' + esc(p) + '</li>';
      });
      aboutPoints.innerHTML = pptHtml;
    }

    // Trust strip
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

    // Contact
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
      var display = b.phone || waNum;
      cPhone.textContent = display ? ('+' + String(waNum).replace(/^\+/, '')) : 'WhatsApp';
      cPhone.href = waLink(waNum, waMsg);
    }

    // Footer
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

    // Social
    var socialWrap = el('contactSocial');
    if (socialWrap) {
      var socialHtml = '';
      if (soc.instagram) socialHtml += '<a class="social-link" href="' + escAttr(soc.instagram) + '" target="_blank" rel="noopener">Instagram</a>';
      if (soc.facebook)  socialHtml += '<a class="social-link" href="' + escAttr(soc.facebook)  + '" target="_blank" rel="noopener">Facebook</a>';
      if (soc.youtube)   socialHtml += '<a class="social-link" href="' + escAttr(soc.youtube)   + '" target="_blank" rel="noopener">YouTube</a>';
      socialWrap.innerHTML = socialHtml;
    }

    // Footer year
    var y = el('footerYear');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* ==========================================================================
     6. LOAD PRODUCTS
     ========================================================================== */

  async function loadProducts(){
    if (!SUPABASE_READY) {
      state.products = DEMO_PRODUCTS.slice();
      return;
    }

    try {
      var res = await sb
        .from('products')
        .select('id,name,category,price,old_price,sizes,description,main_image,additional_images,is_active,is_featured,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });

      if (res && res.error) throw res.error;

      var rows = (res && res.data) || [];
      if (!rows.length) {
        // Empty database — fall back to demo products so the site is not blank
        state.products = DEMO_PRODUCTS.slice();
      } else {
        state.products = rows.map(normalizeProduct);
      }
    } catch (e) {
      state.products = DEMO_PRODUCTS.slice();
    }
  }

  function normalizeProduct(p){
    if (!p) return null;
    return {
      id: Number(p.id) || 0,
      name: String(p.name || 'Untitled'),
      category: String(p.category || 'Other'),
      price: Number(p.price) || 0,
      old_price: (p.old_price === null || p.old_price === undefined || p.old_price === '') ? null : Number(p.old_price),
      sizes: Array.isArray(p.sizes) && p.sizes.length ? p.sizes.map(function (s) { return String(s); }) : ['2.2','2.4','2.6','2.8'],
      description: String(p.description || ''),
      main_image: String(p.main_image || ''),
      additional_images: Array.isArray(p.additional_images) ? p.additional_images.filter(Boolean) : [],
      is_active: p.is_active !== false,
      is_featured: p.is_featured === true,
      sort_order: Number(p.sort_order) || 0
    };
  }

  // All images of a product (main first, then additional)
  function productImages(p){
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
     7. BUILD CATEGORY STRIP
     ========================================================================== */

  function buildCategories(){
    var set = {};
    state.products.forEach(function (p) {
      if (p.category) set[p.category] = true;
    });
    var cats = Object.keys(set).sort(function (a, b) {
      return a.localeCompare(b);
    });
    state.categories = ['All'].concat(cats);
    renderCategoryStrip();
  }

  function renderCategoryStrip(){
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
      html += '<button type="button" class="cat-chip' + active + '" data-cat="' +
              escAttr(c) + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' +
              esc(c) + '</button>';
    });
    wrap.innerHTML = html;
    root.hidden = false;
  }

  /* ==========================================================================
     8. RENDER PRODUCT GRID
     ========================================================================== */

  function applyFilters(){
    var term = (state.searchTerm || '').trim().toLowerCase();
    var cat = state.activeCategory || 'All';

    state.filtered = state.products.filter(function (p) {
      // Category
      if (cat !== 'All' && p.category !== cat) return false;
      // Search term
      if (!term) return true;
      var hay = (
        p.name + ' ' +
        p.category + ' ' +
        (p.description || '') + ' ' +
        productCode(p.id)
      ).toLowerCase();
      return hay.indexOf(term) !== -1;
    });

    renderGrid();
  }

  function renderGrid(){
    var grid = el('productGrid');
    var emptyBox = el('emptyBox');
    var showing = el('showingCount');
    var skel = el('productSkeletons');

    if (skel) skel.hidden = true;
    if (!grid) return;

    var list = state.filtered;

    // Update showing count
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
      var code = productCode(p.id);

      var mediaHtml = '';
      if (imgs.length) {
        mediaHtml = '<img class="card-img" src="' + escAttr(imgs[0]) + '" alt="' + escAttr(p.name) + '" loading="lazy" ' +
                    'onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.card-placeholder\').hidden=false;" />' +
                    '<div class="card-placeholder" hidden><span>Viona</span></div>';
      } else {
        mediaHtml = '<div class="card-placeholder"><span>Viona</span></div>';
      }

      var badgeHtml = off > 0 ? '<span class="card-badge">' + off + '% OFF</span>' : '';
      var featHtml  = p.is_featured ? '<span class="card-featured">Featured</span>' : '';

      var priceHtml = '<span class="price-now">' + esc(money(p.price)) + '</span>';
      if (off > 0) {
        priceHtml += '<span class="price-old">' + esc(money(p.old_price)) + '</span>';
      }

      html +=
        '<article class="product-card" data-id="' + escAttr(String(p.id)) + '">' +
          '<div class="card-media">' +
            badgeHtml + featHtml + mediaHtml +
          '</div>' +
          '<div class="card-body">' +
            '<p class="card-cat">' + esc(p.category) + '</p>' +
            '<h3 class="card-name">' + esc(p.name) + '</h3>' +
            '<div class="card-price">' + priceHtml + '</div>' +
            '<button type="button" class="card-open" data-open="' + escAttr(String(p.id)) + '">View Details</button>' +
          '</div>' +
        '</article>';
    });

    grid.innerHTML = html;

    // Attach click handlers to "View Details" and to the card itself
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
     9. SEARCH + LIVE SUGGESTIONS
     ========================================================================== */

  function setupSearch(){
    var form  = el('searchForm');
    var input = el('searchInput');
    var clear = el('searchClear');
    var sugg  = el('searchSuggest');
    if (!input || !form) return;

    // Input handler with debounce for suggestions
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

    // Keyboard nav
    input.addEventListener('keydown', function (e) {
      if (!sugg || sugg.hidden) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSearch(input.value);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSuggest(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSuggest(-1);
      } else if (e.key === 'Enter') {
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

    // Submit
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

    // Click outside closes suggestions
    document.addEventListener('click', function (e) {
      if (!sugg || sugg.hidden) return;
      var sw = el('searchWrap');
      if (sw && !sw.contains(e.target)) closeSuggestions();
    });
  }

  function submitSearch(term){
    state.searchTerm = String(term || '').trim();
    // When searching, switch back to "All" so results are not hidden by a category
    state.activeCategory = 'All';
    renderCategoryStrip();
    applyFilters();
    closeSuggestions();
    scrollToCollections();
  }

  function scrollToCollections(){
    var target = el('collections');
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      target.scrollIntoView();
    }
  }

  function renderSuggestions(q){
    var wrap = el('searchSuggest');
    var input = el('searchInput');
    if (!wrap) return;

    var term = String(q || '').trim().toLowerCase();
    if (!term) {
      closeSuggestions();
      return;
    }

    var matches = state.products.filter(function (p) {
      var hay = (
        p.name + ' ' +
        p.category + ' ' +
        (p.description || '') + ' ' +
        productCode(p.id)
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
            '<span class="suggest-meta">' + esc(productCode(p.id)) + ' · ' + esc(p.category) + '</span>' +
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

  function moveSuggest(dir){
    if (!state.suggestItems.length) return;
    var n = state.suggestItems.length;
    state.suggestIndex = (state.suggestIndex + dir + n) % n;
    highlightSuggestion();
  }

  function highlightSuggestion(){
    var wrap = el('searchSuggest');
    if (!wrap) return;
    var items = wrap.querySelectorAll('.suggest-item');
    Array.prototype.forEach.call(items, function (n, i) {
      if (i === state.suggestIndex) n.classList.add('is-active');
      else n.classList.remove('is-active');
    });
  }

  function closeSuggestions(){
    var wrap = el('searchSuggest');
    var input = el('searchInput');
    if (wrap) { wrap.hidden = true; wrap.innerHTML = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
    state.suggestIndex = -1;
    state.suggestItems = [];
  }

  /* ==========================================================================
     10. PRODUCT MODAL
     ========================================================================== */

  var lastFocusedBeforeModal = null;

  function openProductById(id){
    var product = state.products.find(function (p) { return Number(p.id) === Number(id); });
    if (!product) return;
    openProduct(product);
  }

  function openProduct(product){
    if (!product) return;

    state.currentProduct = product;
    state.currentSize = null;
    state.currentImageIndex = 0;
    state.galleryImages = productImages(product);
    state.reviews = [];
    state.myReview = null;
    state.editingReview = false;
    state.reviewSort = 'newest';

    // Update the URL hash so the popup can be shared
    try {
      var newHash = '#product=' + productCode(product.id);
      if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
      }
    } catch (e) { /* ignore */ }

    // Populate basic fields
    var codeEl = el('modalCode');   if (codeEl) codeEl.textContent = productCode(product.id);
    var titleEl = el('modalTitle'); if (titleEl) titleEl.textContent = product.name;
    var descEl = el('modalDesc');   if (descEl) descEl.textContent = product.description || '';

    // Rating badge (hidden until reviews load)
    var ratingBtn = el('modalRating'); if (ratingBtn) ratingBtn.hidden = true;

    // Price block
    renderModalPrice(product);

    // Gallery
    renderGallery(product);

    // Sizes
    renderSizes(product);

    // WhatsApp link
    updateModalWhatsApp();

    // Detail rows (policies + basic info)
    renderDetailRows(product);

    // Tabs: start on Details
    switchTab('details');

    // Reviews will load asynchronously
    loadReviewsForProduct(product.id).then(function () {
      renderReviewsForProduct(product.id);
    });

    // Show the modal
    var modal = el('productModal');
    if (modal) {
      lastFocusedBeforeModal = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('no-scroll');
      // Focus the close button for keyboard users
      setTimeout(function () {
        var c = el('modalClose');
        if (c) try { c.focus(); } catch (e) {}
      }, 50);
    }
  }

  function closeProductModal(){
    var modal = el('productModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
    state.currentProduct = null;

    // Clear the hash if it was pointing at a product
    try {
      if (window.location.hash && window.location.hash.indexOf('#product=') === 0) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }

    if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
      try { lastFocusedBeforeModal.focus(); } catch (e) {}
    }
  }

  function renderModalPrice(p){
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

  function renderGallery(p){
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

    // Off badge
    var off = discountPct(p.price, p.old_price);
    if (badge) {
      if (off > 0) {
        badge.textContent = off + '% OFF';
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    // Thumbs
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

  function setGalleryImage(idx){
    var imgs = state.galleryImages;
    if (!imgs.length) return;
    if (idx < 0) idx = 0;
    if (idx >= imgs.length) idx = imgs.length - 1;
    state.currentImageIndex = idx;

    var mainImg = el('galleryMainImg');
    if (mainImg) {
      mainImg.src = imgs[idx];
      mainImg.hidden = false;
    }
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

  function renderSizes(p){
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
    sizes.forEach(function (s, i) {
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

    // Auto-select first size
    var first = wrap.querySelector('.size-chip');
    if (first) {
      first.classList.add('is-active');
      first.setAttribute('aria-checked', 'true');
      state.currentSize = first.getAttribute('data-size');
    }
  }

  function updateModalWhatsApp(){
    var link = el('modalWhatsApp');
    var p = state.currentProduct;
    if (!link || !p) return;

    var num = (state.settings.business && state.settings.business.whatsapp) || CFG.WHATSAPP_NUMBER || '';
    var code = productCode(p.id);
    var sizePart = state.currentSize ? ('\nSize: ' + state.currentSize) : '';
    var msg = 'Hello Viona Bangles,\n' +
              'I would like to order:\n' +
              '• ' + p.name + ' (' + code + ')\n' +
              '• Price: ' + money(p.price) + sizePart + '\n\n' +
              'Please share delivery details.';
    link.href = waLink(num, msg);
  }

  function renderDetailRows(p){
    var wrap = el('detailRows');
    if (!wrap) return;

    var pol = state.settings.policies || {};
    var rows = [
      { k: 'Product Code', v: productCode(p.id) },
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

  function switchTab(name){
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

  function setupModal(){
    var modal = el('productModal');
    if (!modal) return;

    // Close buttons
    var closeBtn = el('modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeProductModal);

    Array.prototype.forEach.call(modal.querySelectorAll('[data-close-modal]'), function (b) {
      b.addEventListener('click', closeProductModal);
    });

    // Escape closes modal (but not if lightbox is open)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var lb = el('lightbox');
      if (lb && !lb.hidden) { closeLightbox(); return; }
      if (!modal.hidden) closeProductModal();
    });

    // Tabs
    var btnD = el('tabBtnDetails');
    var btnR = el('tabBtnReviews');
    if (btnD) btnD.addEventListener('click', function () { switchTab('details'); });
    if (btnR) btnR.addEventListener('click', function () { switchTab('reviews'); });

    // Rating button jumps to reviews
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
     11. DEEP LINK
     ========================================================================== */

  function handleDeepLink(){
    if (!window.location.hash) return;
    var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
    if (!m) return;
    var id = codeToId(m[1]);
    if (!id) return;

    // Wait for products to be ready (they load asynchronously)
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
     12. FAQ
     ========================================================================== */

  async function loadFaqs(){
    if (!SUPABASE_READY) {
      state.faqs = DEMO_FAQS.slice();
      return;
    }
    try {
      var res = await sb
        .from('faqs')
        .select('id,question,answer,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });

      if (res && res.error) throw res.error;
      var rows = (res && res.data) || [];
      state.faqs = rows.length ? rows : DEMO_FAQS.slice();
    } catch (e) {
      state.faqs = DEMO_FAQS.slice();
    }
  }

  function renderFaqs(){
    var wrap = el('faqList');
    if (!wrap) return;
    if (!state.faqs.length) {
      wrap.innerHTML = '';
      return;
    }

    var html = '';
    state.faqs.forEach(function (f, i) {
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
        // Close all
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
     13. OFFERS — STRIP / BANNER / POPUP
     ========================================================================== */

  async function loadOffers(){
    state.offers = { strips: [], banners: [], popups: [] };
    if (!SUPABASE_READY) return;

    try {
      var res = await sb
        .from('offers')
        .select('id,display_type,title,subtitle,button_text,button_link,bg_color,bg_color_2,bg_image,text_color,button_bg,button_text_color,text_align,is_active,starts_at,ends_at,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });

      if (res && res.error) throw res.error;
      var rows = (res && res.data) || [];
      var now = new Date();

      rows.forEach(function (o) {
        // Additional client-side date check (RLS already filters, but be safe)
        if (o.starts_at) {
          var s = new Date(o.starts_at);
          if (!isNaN(s.getTime()) && s > now) return;
        }
        if (o.ends_at) {
          var e = new Date(o.ends_at);
          if (!isNaN(e.getTime()) && e < now) return;
        }
        if (o.display_type === 'strip')  state.offers.strips.push(o);
        else if (o.display_type === 'banner') state.offers.banners.push(o);
        else if (o.display_type === 'popup')  state.offers.popups.push(o);
      });
    } catch (e) {
      // Silently ignore — no offers section will appear
    }
  }

  function offerBackground(o){
    if (o.bg_image) {
      return 'background-image:linear-gradient(rgba(10,16,34,.18),rgba(10,16,34,.28)),url(' +
             '&quot;' + escAttr(o.bg_image) + '&quot;);';
    }
    if (o.bg_color_2) {
      return 'background-image:linear-gradient(135deg,' + escAttr(o.bg_color || '#14224A') +
             ' 0%,' + escAttr(o.bg_color_2) + ' 100%);';
    }
    return 'background-color:' + escAttr(o.bg_color || '#14224A') + ';';
  }

  function offerStyleAttrs(o){
    var s = offerBackground(o);
    s += 'color:' + escAttr(o.text_color || '#FFFFFF') + ';';
    return s;
  }

  /* -------- STRIP -------------------------------------------------------- */

  function renderStrips(){
    var root = el('offerStripRoot');
    if (!root) return;
    var list = state.offers.strips;

    if (!list.length) {
      root.innerHTML = '';
      root.hidden = true;
      if (state.stripTimer) {
        clearInterval(state.stripTimer);
        state.stripTimer = null;
      }
      return;
    }

    root.hidden = false;
    state.strips = list;
    renderStripAt(0);

    if (list.length > 1) {
      if (state.stripTimer) clearInterval(state.stripTimer);
      state.stripTimer = setInterval(function () {
        var idx = (state.strips._idx || 0) + 1;
        if (idx >= state.strips.length) idx = 0;
        renderStripAt(idx);
      }, 4000);
    }
  }

  function renderStripAt(idx){
    var root = el('offerStripRoot');
    if (!root) return;
    var list = state.strips;
    if (!list || !list.length) return;

    var o = list[idx] || list[0];
    list._idx = idx;

    var textHtml = o.title ? '<span class="offer-strip-text">' + esc(o.title) + '</span>' : '';
    var linkHtml = (o.button_text && o.button_link)
      ? '<a class="offer-strip-link" href="' + escAttr(o.button_link) + '">' + esc(o.button_text) + '</a>'
      : '';

    root.innerHTML =
      '<div class="offer-strip" style="' + offerStyleAttrs(o) + '">' +
        textHtml + linkHtml +
        '<button type="button" class="offer-strip-close" aria-label="Close">×</button>' +
      '</div>';

    var closeBtn = root.querySelector('.offer-strip-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (state.stripTimer) { clearInterval(state.stripTimer); state.stripTimer = null; }
        root.innerHTML = '';
        root.hidden = true;
      });
    }
  }

  /* -------- BANNER ------------------------------------------------------- */

  function renderBanners(){
    var section = el('bannerSection');
    var track = el('bannerTrack');
    var dotsWrap = el('bannerDots');
    var prev = el('bannerPrev');
    var next = el('bannerNext');

    if (!section || !track || !dotsWrap) return;

    var list = state.offers.banners;
    if (!list.length) {
      section.hidden = true;
      track.innerHTML = '';
      dotsWrap.innerHTML = '';
      if (state.bannerTimer) { clearInterval(state.bannerTimer); state.bannerTimer = null; }
      return;
    }

    section.hidden = false;

    var html = '';
    list.forEach(function (o) {
      var align = (o.text_align === 'left' || o.text_align === 'right') ? o.text_align : 'center';
      var title = o.title ? '<h2 class="banner-title">' + esc(o.title) + '</h2>' : '';
      var sub   = o.subtitle ? '<p class="banner-subtitle">' + esc(o.subtitle) + '</p>' : '';
      var btn   = '';
      if (o.button_text) {
        var btnStyle = 'background:' + escAttr(o.button_bg || '#C9A24A') +
                       ';color:' + escAttr(o.button_text_color || '#14224A') + ';';
        if (o.button_link) {
          btn = '<a class="banner-btn" href="' + escAttr(o.button_link) + '" style="' + btnStyle + '">' +
                esc(o.button_text) + '</a>';
        } else {
          btn = '<span class="banner-btn" style="' + btnStyle + '">' + esc(o.button_text) + '</span>';
        }
      }
      html +=
        '<div class="banner-slide align-' + align + '" style="' + offerStyleAttrs(o) + '">' +
          '<div class="banner-slide-inner">' + title + sub + btn + '</div>' +
        '</div>';
    });
    track.innerHTML = html;

    // Dots
    var dotsHtml = '';
    list.forEach(function (o, i) {
      dotsHtml += '<button type="button" class="banner-dot' + (i === 0 ? ' is-active' : '') +
                  '" data-bidx="' + i + '" role="tab" aria-label="Slide ' + (i + 1) + '"></button>';
    });
    dotsWrap.innerHTML = dotsHtml;

    state.bannerIndex = 0;
    updateBannerPosition();

    Array.prototype.forEach.call(dotsWrap.querySelectorAll('.banner-dot'), function (d) {
      d.addEventListener('click', function () {
        state.bannerIndex = Number(d.getAttribute('data-bidx'));
        updateBannerPosition();
        restartBannerAutoplay();
      });
    });

    if (prev) prev.onclick = function () {
      state.bannerIndex = (state.bannerIndex - 1 + list.length) % list.length;
      updateBannerPosition();
      restartBannerAutoplay();
    };
    if (next) next.onclick = function () {
      state.bannerIndex = (state.bannerIndex + 1) % list.length;
      updateBannerPosition();
      restartBannerAutoplay();
    };

    // Swipe support
    var startX = 0;
    var moved = false;
    track.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) return;
      startX = e.touches[0].clientX;
      moved = false;
    }, { passive: true });
    track.addEventListener('touchmove', function () {
      moved = true;
    }, { passive: true });
    track.addEventListener('touchend', function (e) {
      if (!moved) return;
      var endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : startX;
      var dx = endX - startX;
      if (Math.abs(dx) < 40) return;
      if (dx < 0) state.bannerIndex = (state.bannerIndex + 1) % list.length;
      else        state.bannerIndex = (state.bannerIndex - 1 + list.length) % list.length;
      updateBannerPosition();
      restartBannerAutoplay();
    });

    // Autoplay
    restartBannerAutoplay();
  }

  function updateBannerPosition(){
    var track = el('bannerTrack');
    var dotsWrap = el('bannerDots');
    if (!track) return;
    var pct = state.bannerIndex * 100;
    track.style.transform = 'translateX(-' + pct + '%)';
    if (dotsWrap) {
      Array.prototype.forEach.call(dotsWrap.querySelectorAll('.banner-dot'), function (d, i) {
        if (i === state.bannerIndex) d.classList.add('is-active');
        else d.classList.remove('is-active');
      });
    }
  }

  function restartBannerAutoplay(){
    if (state.bannerTimer) clearInterval(state.bannerTimer);
    var list = state.offers.banners;
    if (list.length < 2) return;
    state.bannerTimer = setInterval(function () {
      state.bannerIndex = (state.bannerIndex + 1) % list.length;
      updateBannerPosition();
    }, 5000);
  }

  /* -------- POPUP -------------------------------------------------------- */

  function renderPopup(){
    var root = el('popupRoot');
    if (!root) return;
    root.innerHTML = '';

    var list = state.offers.popups;
    if (!list.length) return;

    // Find the first one we have not shown in this browser session
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      var key = 'viona_popup_' + list[i].id;
      if (!sessionGet(key)) { chosen = list[i]; break; }
    }
    if (!chosen) return;

    setTimeout(function () {
      showPopup(chosen);
    }, 2000);
  }

  function showPopup(o){
    var root = el('popupRoot');
    if (!root) return;

    // Mark as shown for this session
    sessionSet('viona_popup_' + o.id, '1');

    var align = (o.text_align === 'left' || o.text_align === 'right') ? o.text_align : 'center';
    var title = o.title ? '<h3 class="popup-title">' + esc(o.title) + '</h3>' : '';
    var sub   = o.subtitle ? '<p class="popup-subtitle">' + esc(o.subtitle) + '</p>' : '';
    var btn   = '';
    if (o.button_text) {
      var btnStyle = 'background:' + escAttr(o.button_bg || '#C9A24A') +
                     ';color:' + escAttr(o.button_text_color || '#14224A') + ';';
      if (o.button_link) {
        btn = '<a class="popup-btn" href="' + escAttr(o.button_link) + '" style="' + btnStyle + '">' +
              esc(o.button_text) + '</a>';
      } else {
        btn = '<span class="popup-btn" style="' + btnStyle + '">' + esc(o.button_text) + '</span>';
      }
    }

    root.innerHTML =
      '<div class="popup-overlay">' +
        '<div class="popup-backdrop" data-popup-close></div>' +
        '<div class="popup-card align-' + align + '" style="' + offerStyleAttrs(o) + '">' +
          '<button type="button" class="popup-close" aria-label="Close" data-popup-close>×</button>' +
          '<div class="popup-inner">' + title + sub + btn + '</div>' +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(root.querySelectorAll('[data-popup-close]'), function (b) {
      b.addEventListener('click', function () {
        root.innerHTML = '';
      });
    });
  }

  /* ==========================================================================
     14. REVIEWS
     ========================================================================== */

  async function getCurrentUser(){
    if (!SUPABASE_READY) return null;
    try {
      var res = await sb.auth.getUser();
      if (res && res.data && res.data.user) return res.data.user;
    } catch (e) { /* ignore */ }
    return null;
  }

  function listenAuthChanges(){
    if (!SUPABASE_READY) return;
    try {
      sb.auth.onAuthStateChange(function (_event, session) {
        state.currentUser = (session && session.user) ? session.user : null;
        // If a product modal is open, refresh its review UI
        if (state.currentProduct) {
          renderUserChip();
          loadReviewsForProduct(state.currentProduct.id).then(function () {
            renderReviewsForProduct(state.currentProduct.id);
          });
        }
      });
    } catch (e) { /* ignore */ }
  }

  async function loadReviewsForProduct(productId){
    state.reviews = [];
    state.myReview = null;

    if (!SUPABASE_READY) return;

    try {
      var res = await sb
        .from('reviews')
        .select('id,product_id,user_id,user_name,user_avatar,rating,title,comment,images,approved,created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });

      if (res && res.error) throw res.error;

      var rows = (res && res.data) || [];
      var uid = state.currentUser ? state.currentUser.id : null;

      // Split approved vs my own (unapproved)
      var approved = [];
      rows.forEach(function (r) {
        if (r.approved) {
          approved.push(r);
        }
        if (uid && r.user_id === uid) {
          state.myReview = r;
        }
      });
      state.reviews = approved;
    } catch (e) {
      state.reviews = [];
      state.myReview = null;
    }
  }

  function computeReviewStats(){
    var stats = { 5:0, 4:0, 3:0, 2:0, 1:0 };
    var sum = 0, n = 0;
    state.reviews.forEach(function (r) {
      var rt = Math.max(1, Math.min(5, Number(r.rating) || 0));
      if (!rt) return;
      stats[rt] = (stats[rt] || 0) + 1;
      sum += rt;
      n++;
    });
    var avg = n ? (sum / n) : 0;
    return { stats: stats, total: n, average: avg };
  }

  function renderReviewsForProduct(productId){
    updateTabReviewCount();
    renderReviewSummary();
    renderReviewList();
    renderUserChip();
    renderReviewFormOrCTA();
    updateModalRatingBadge();
    updateCardRatings();
  }

  function updateTabReviewCount(){
    var span = el('tabReviewCount');
    if (!span) return;
    var total = state.reviews.length;
    span.textContent = total ? '(' + total + ')' : '';
  }

  function updateModalRatingBadge(){
    var btn = el('modalRating');
    var stars = el('modalStars');
    var text = el('modalRatingText');
    if (!btn || !stars || !text) return;

    var stats = computeReviewStats();
    if (!stats.total) {
      btn.hidden = true;
      return;
    }
    stars.innerHTML = starsHtml(stats.average);
    text.textContent = stats.average.toFixed(1) + ' · ' + stats.total + ' ' +
                       (stats.total === 1 ? 'review' : 'reviews');
    btn.hidden = false;
  }

  function updateCardRatings(){
    // Card ratings are shown only for the current product's card while its
    // reviews are loaded — the grid refreshes with averages on next render.
    var grid = el('productGrid');
    if (!grid || !state.currentProduct) return;
    var stats = computeReviewStats();
    if (!stats.total) return;

    var card = grid.querySelector('.product-card[data-id="' + state.currentProduct.id + '"]');
    if (!card) return;
    var body = card.querySelector('.card-body');
    if (!body) return;
    if (body.querySelector('.card-stars')) return;

    var html = '<p class="card-stars"><span class="stars">' + starsHtml(stats.average) + '</span>' +
               '<span>' + stats.average.toFixed(1) + ' (' + stats.total + ')</span></p>';
    var nameEl = body.querySelector('.card-name');
    if (nameEl && nameEl.nextSibling) {
      nameEl.insertAdjacentHTML('afterend', html);
    }
  }

  function renderReviewSummary(){
    var wrap = el('reviewsSummary');
    if (!wrap) return;

    var stats = computeReviewStats();

    var avgEl = el('reviewsAverage');
    if (avgEl) avgEl.textContent = stats.total ? stats.average.toFixed(1) : '0.0';

    var avgStars = el('reviewsAverageStars');
    if (avgStars) avgStars.innerHTML = starsHtml(stats.average);

    var totalEl = el('reviewsTotal');
    if (totalEl) totalEl.textContent = stats.total + ' ' + (stats.total === 1 ? 'review' : 'reviews');

    var barsWrap = el('reviewsBars');
    if (!barsWrap) return;

    var html = '';
    for (var star = 5; star >= 1; star--) {
      var count = stats.stats[star] || 0;
      var pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
      html +=
        '<div class="rbar">' +
          '<span class="rbar-label">' + star + ' ★</span>' +
          '<span class="rbar-track"><span class="rbar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="rbar-count">' + count + '</span>' +
        '</div>';
    }
    barsWrap.innerHTML = html;
  }

  function renderReviewList(){
    var wrap = el('reviewsList');
    var empty = el('reviewsEmpty');
    var toolbar = el('reviewsToolbar');
    if (!wrap) return;

    var list = state.reviews.slice();

    // Sorting
    if (state.reviewSort === 'highest') {
      list.sort(function (a, b) { return (b.rating - a.rating) || (new Date(b.created_at) - new Date(a.created_at)); });
    } else if (state.reviewSort === 'lowest') {
      list.sort(function (a, b) { return (a.rating - b.rating) || (new Date(b.created_at) - new Date(a.created_at)); });
    } else {
      list.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    }

    // Show my own review at the top (with "Pending" tag if not approved)
    var myHtml = '';
    if (state.myReview) {
      myHtml = renderReviewCard(state.myReview, true);
    }

    if (!list.length && !state.myReview) {
      wrap.innerHTML = '';
      if (empty) empty.hidden = false;
      if (toolbar) toolbar.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (toolbar) toolbar.hidden = list.length < 2;

    var html = myHtml;
    list.forEach(function (r) {
      // Skip my own if it is already shown and approved
      if (state.myReview && r.id === state.myReview.id) return;
      html += renderReviewCard(r, false);
    });
    wrap.innerHTML = html;

    // Attach action handlers (Edit / Delete on own review)
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-edit]'), function (b) {
      b.addEventListener('click', function () {
        state.editingReview = true;
        renderReviewFormOrCTA();
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-delete]'), function (b) {
      b.addEventListener('click', function () {
        deleteMyReview();
      });
    });

    // Photo thumbnails -> lightbox
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-review-photo]'), function (b) {
      b.addEventListener('click', function () {
        var pid = Number(b.getAttribute('data-review-id'));
        var idx = Number(b.getAttribute('data-photo-idx'));
        openReviewLightbox(pid, idx);
      });
    });
  }

  function renderReviewCard(r, isOwn){
    var name = r.user_name || 'Viona Customer';
    var initial = name.trim().charAt(0).toUpperCase() || 'V';
    var avatar = r.user_avatar
      ? '<img class="review-avatar" src="' + escAttr(r.user_avatar) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false;" /><span class="review-letter" hidden>' + esc(initial) + '</span>'
      : '<span class="review-letter">' + esc(initial) + '</span>';

    var titleHtml = r.title ? '<p class="review-title">' + esc(r.title) + '</p>' : '';

    var tagHtml = '';
    if (isOwn && !r.approved) {
      tagHtml = '<span class="review-tag">Pending approval</span>';
    }

    var photosHtml = '';
    if (Array.isArray(r.images) && r.images.length) {
      photosHtml = '<div class="review-photos">';
      r.images.forEach(function (u, i) {
        if (!u) return;
        photosHtml +=
          '<button type="button" class="review-photo" data-review-photo data-review-id="' + escAttr(String(r.id)) +
          '" data-photo-idx="' + i + '" aria-label="Open photo ' + (i + 1) + '">' +
            '<img src="' + escAttr(u) + '" alt="" loading="lazy" />' +
          '</button>';
      });
      photosHtml += '</div>';
    }

    var actionsHtml = '';
    if (isOwn) {
      actionsHtml =
        '<div class="review-actions">' +
          '<button type="button" class="review-act" data-review-edit>Edit</button>' +
          '<button type="button" class="review-act danger" data-review-delete>Delete</button>' +
        '</div>';
    }

    return '' +
      '<article class="review-card' + (isOwn ? ' is-own' : '') + '" data-review-card="' + escAttr(String(r.id)) + '">' +
        '<div class="review-top">' +
          avatar +
          '<div class="review-ident">' +
            '<p class="review-name">' + esc(name) + (isOwn ? ' (You)' : '') + '</p>' +
            '<p class="review-date">' + esc(formatDate(r.created_at)) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="review-stars stars">' + starsHtml(r.rating) + '</div>' +
        tagHtml +
        titleHtml +
        '<p class="review-text">' + esc(r.comment || '') + '</p>' +
        photosHtml +
        actionsHtml +
      '</article>';
  }

  function renderUserChip(){
    var chip = el('userChip');
    var avatar = el('userChipAvatar');
    var letter = el('userChipLetter');
    var nameEl = el('userChipName');
    var signOut = el('userChipSignOut');
    if (!chip || !avatar || !letter || !nameEl || !signOut) return;

    var u = state.currentUser;
    if (!u) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;

    var meta = u.user_metadata || {};
    var display = meta.full_name || meta.name || u.email || 'Signed in';
    var pic = meta.avatar_url || meta.picture || '';

    nameEl.textContent = display;

    if (pic) {
      avatar.src = pic;
      avatar.hidden = false;
      letter.hidden = true;
    } else {
      avatar.removeAttribute('src');
      avatar.hidden = true;
      letter.textContent = String(display).trim().charAt(0).toUpperCase() || 'U';
      letter.hidden = false;
    }

    signOut.onclick = async function () {
      try {
        await sb.auth.signOut();
        toast('Signed out');
      } catch (e) {
        toast('Could not sign out');
      }
    };
  }

  function renderReviewFormOrCTA(){
    var wrap = el('reviewFormWrap');
    if (!wrap) return;

    // Not signed in -> CTA
    if (!state.currentUser) {
      wrap.innerHTML =
        '<div class="review-cta">' +
          '<p class="review-cta-title">Share your experience</p>' +
          '<p class="review-cta-text">Sign in with Google to write a review. It only takes a minute.</p>' +
          '<button type="button" class="btn btn-gold" id="ctaSignIn">Sign in with Google</button>' +
        '</div>';

      var btn = el('ctaSignIn');
      if (btn) btn.addEventListener('click', signInWithGoogle);
      return;
    }

    // Signed in and already has a review (and NOT editing) -> nothing extra
    if (state.myReview && !state.editingReview) {
      wrap.innerHTML = '';
      return;
    }

    // Signed in -> show form (new or edit)
    var r = state.myReview || {};
    var isEdit = !!state.myReview;

    wrap.innerHTML =
      '<div class="review-form">' +
        '<p class="review-form-title">' + (isEdit ? 'Edit your review' : 'Write a review') + '</p>' +
        '<p class="review-form-sub">Your review appears after approval.</p>' +
        '<div class="form-field">' +
          '<label>Your rating</label>' +
          '<div class="star-picker" id="starPicker" role="radiogroup" aria-label="Rating">' +
            starPickerHtml(Number(r.rating) || 0) +
          '</div>' +
          '<p class="form-hint" id="starHint">' + (r.rating ? (r.rating + ' of 5') : 'Tap a star to rate') + '</p>' +
        '</div>' +
        '<div class="form-field">' +
          '<label for="reviewTitleInput">Title (optional)</label>' +
          '<input id="reviewTitleInput" class="form-input" type="text" maxlength="80" placeholder="A short headline" value="' + escAttr(r.title || '') + '" />' +
        '</div>' +
        '<div class="form-field">' +
          '<label for="reviewCommentInput">Your review *</label>' +
          '<textarea id="reviewCommentInput" class="form-textarea" maxlength="1000" placeholder="What did you like about these bangles?">' + esc(r.comment || '') + '</textarea>' +
          '<p class="form-hint">10 to 1000 characters.</p>' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Add photos (optional, up to 3)</label>' +
          '<div class="photo-picker" id="photoPicker"></div>' +
          '<input id="reviewPhotoInput" type="file" accept="image/*" multiple hidden />' +
        '</div>' +
        '<p class="form-error" id="reviewFormError" hidden></p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-gold" id="reviewSubmit">' + (isEdit ? 'Save changes' : 'Submit review') + '</button>' +
          (isEdit ? '<button type="button" class="btn btn-ghost" id="reviewCancelEdit">Cancel</button>' : '') +
        '</div>' +
      '</div>';

    setupStarPicker();
    setupPhotoPicker();
    setupReviewSubmit();
  }

  function starPickerHtml(rating){
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += '<button type="button" class="star-pick' + (i <= rating ? ' is-on' : '') +
              '" data-star="' + i + '" role="radio" aria-checked="' + (i === rating ? 'true' : 'false') +
              '" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '">★</button>';
    }
    return html;
  }

  function setupStarPicker(){
    var wrap = el('starPicker');
    var hint = el('starHint');
    if (!wrap) return;

    var current = 0;
    Array.prototype.forEach.call(wrap.querySelectorAll('.star-pick'), function (b, i) {
      if (b.classList.contains('is-on')) current = Math.max(current, i + 1);
    });
    state._pickerRating = current;

    function paint(n){
      Array.prototype.forEach.call(wrap.querySelectorAll('.star-pick'), function (b, i) {
        if (i < n) b.classList.add('is-on');
        else b.classList.remove('is-on');
        b.setAttribute('aria-checked', (i === n - 1) ? 'true' : 'false');
      });
      if (hint) hint.textContent = n ? (n + ' of 5') : 'Tap a star to rate';
    }

    Array.prototype.forEach.call(wrap.querySelectorAll('.star-pick'), function (b) {
      b.addEventListener('mouseenter', function () {
        paint(Number(b.getAttribute('data-star')));
      });
      b.addEventListener('click', function () {
        state._pickerRating = Number(b.getAttribute('data-star'));
        paint(state._pickerRating);
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          state._pickerRating = Math.min(5, (state._pickerRating || 0) + 1);
          paint(state._pickerRating);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          state._pickerRating = Math.max(1, (state._pickerRating || 1) - 1);
          paint(state._pickerRating);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          state._pickerRating = Number(b.getAttribute('data-star'));
          paint(state._pickerRating);
        }
      });
    });

    wrap.addEventListener('mouseleave', function () {
      paint(state._pickerRating || 0);
    });
  }

  function setupPhotoPicker(){
    var picker = el('photoPicker');
    var input = el('reviewPhotoInput');
    if (!picker || !input) return;

    // Local list of picked blobs (not yet uploaded)
    var files = [];

    function refresh(){
      var html = '';
      files.forEach(function (f, i) {
        html +=
          '<div class="photo-thumb">' +
            '<img src="' + escAttr(f.preview) + '" alt="" />' +
            '<button type="button" class="photo-remove" data-remove="' + i + '" aria-label="Remove photo">×</button>' +
          '</div>';
      });
      if (files.length < 3) {
        html += '<button type="button" class="photo-add" id="photoAddBtn" aria-label="Add photo">+</button>';
      }
      picker.innerHTML = html;

      var addBtn = el('photoAddBtn');
      if (addBtn) addBtn.addEventListener('click', function () { input.click(); });

      Array.prototype.forEach.call(picker.querySelectorAll('[data-remove]'), function (b) {
        b.addEventListener('click', function () {
          var idx = Number(b.getAttribute('data-remove'));
          var f = files[idx];
          if (f && f.preview) { try { URL.revokeObjectURL(f.preview); } catch (e) {} }
          files.splice(idx, 1);
          refresh();
        });
      });
    }

    input.addEventListener('change', async function () {
      var list = Array.prototype.slice.call(input.files || []);
      for (var i = 0; i < list.length; i++) {
        if (files.length >= 3) break;
        var file = list[i];
        if (!file || !/^image\//.test(file.type)) continue;
        try {
          var compressed = await compressImage(file, 1200, 0.82);
          var preview = URL.createObjectURL(compressed);
          files.push({ blob: compressed, preview: preview });
        } catch (e) {
          // Fallback: keep the original
          try {
            files.push({ blob: file, preview: URL.createObjectURL(file) });
          } catch (e2) { /* ignore */ }
        }
      }
      input.value = '';
      refresh();
    });

    refresh();

    // Expose files list on a known place so submit can read it
    state._reviewFiles = files;
  }

  function setupReviewSubmit(){
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

      var rating = Number(state._pickerRating) || 0;
      var titleEl = el('reviewTitleInput');
      var commentEl = el('reviewCommentInput');
      var title = titleEl ? titleEl.value.trim().slice(0, 80) : '';
      var comment = commentEl ? commentEl.value.trim() : '';

      if (!rating) return showFormError('Please choose a star rating.');
      if (comment.length < 10) return showFormError('Please write at least 10 characters.');
      if (comment.length > 1000) return showFormError('Review is too long (max 1000 characters).');

      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.textContent = 'Saving…';

      try {
        var user = state.currentUser;
        if (!user) throw new Error('You are not signed in.');

        // Upload photos (if any)
        var uploadedUrls = [];
        var files = state._reviewFiles || [];
        for (var i = 0; i < files.length; i++) {
          try {
            var path = user.id + '/' + Date.now() + '-' + i + '.jpg';
            var upRes = await sb.storage.from('review-images').upload(path, files[i].blob, {
              contentType: 'image/jpeg',
              upsert: false
            });
            if (upRes && upRes.error) throw upRes.error;
            var pub = sb.storage.from('review-images').getPublicUrl(path);
            if (pub && pub.data && pub.data.publicUrl) uploadedUrls.push(pub.data.publicUrl);
          } catch (e) {
            // If one photo fails, continue with the rest
          }
        }

        var meta = user.user_metadata || {};
        var payload = {
          product_id: state.currentProduct.id,
          user_id: user.id,
          user_name: meta.full_name || meta.name || user.email || 'Viona Customer',
          user_avatar: meta.avatar_url || meta.picture || '',
          rating: rating,
          title: title,
          comment: comment,
          images: uploadedUrls,
          approved: false
        };

        // Update existing review, or insert a new one
        if (state.myReview && state.myReview.id) {
          var upd = await sb.from('reviews').update(payload).eq('id', state.myReview.id);
          if (upd && upd.error) throw upd.error;
          toast('Review updated. It will appear after approval.');
        } else {
          var ins = await sb.from('reviews').insert(payload);
          if (ins && ins.error) throw ins.error;
          toast('Thank you! Your review will appear after approval.');
        }

        state.editingReview = false;
        // Clean up local previews
        (state._reviewFiles || []).forEach(function (f) {
          if (f && f.preview) { try { URL.revokeObjectURL(f.preview); } catch (e) {} }
        });
        state._reviewFiles = [];

        // Reload
        await loadReviewsForProduct(state.currentProduct.id);
        renderReviewsForProduct(state.currentProduct.id);
      } catch (e) {
        showFormError((e && e.message) ? e.message : 'Could not save your review. Please try again.');
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.textContent = state.myReview ? 'Save changes' : 'Submit review';
      }
    });

    function showFormError(msg){
      if (!errEl) { toast(msg); return; }
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  async function deleteMyReview(){
    if (!state.myReview || !state.myReview.id) return;
    var ok = window.confirm('Delete your review? This cannot be undone.');
    if (!ok) return;
    try {
      var res = await sb.from('reviews').delete().eq('id', state.myReview.id);
      if (res && res.error) throw res.error;
      toast('Review deleted.');
      await loadReviewsForProduct(state.currentProduct.id);
      renderReviewsForProduct(state.currentProduct.id);
    } catch (e) {
      toast('Could not delete review.');
    }
  }

  async function signInWithGoogle(){
    if (!SUPABASE_READY) {
      toast('Sign in is not available right now.');
      return;
    }
    try {
      var redirect = window.location.origin + window.location.pathname;
      if (state.currentProduct) {
        redirect += '#product=' + productCode(state.currentProduct.id);
      }
      var res = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect }
      });
      if (res && res.error) throw res.error;
    } catch (e) {
      toast('Could not start Google sign in.');
    }
  }

  /* -------- Lightbox ---------------------------------------------------- */

  function openReviewLightbox(reviewId, startIndex){
    var r = state.reviews.find(function (x) { return Number(x.id) === Number(reviewId); });
    if (!r && state.myReview && Number(state.myReview.id) === Number(reviewId)) {
      r = state.myReview;
    }
    if (!r || !Array.isArray(r.images) || !r.images.length) return;

    state.lightbox.images = r.images.slice();
    state.lightbox.index = Math.max(0, Math.min(startIndex || 0, r.images.length - 1));
    showLightbox();
  }

  function showLightbox(){
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

  function closeLightbox(){
    var lb = el('lightbox');
    if (!lb) return;
    lb.hidden = true;
    if (!state.currentProduct) document.body.classList.remove('no-scroll');
  }

  function setupLightbox(){
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

    // Keyboard
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'ArrowLeft' && prev) prev.click();
      else if (e.key === 'ArrowRight' && next) next.click();
      else if (e.key === 'Escape') closeLightbox();
    });
  }

  /* -------- Image compression (browser side) ----------------------------- */

  function compressImage(file, maxSide, quality){
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
     15. CATEGORY STRIP + MENU + MISC EVENTS
     ========================================================================== */

  function setupCategoryStrip(){
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

  function setupMenu(){
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

  function setupEmptyReset(){
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

  function setupReviewSort(){
    var sel = el('reviewSort');
    if (!sel) return;
    sel.addEventListener('change', function () {
      state.reviewSort = sel.value || 'newest';
      renderReviewList();
    });
  }

  /* ==========================================================================
     16. INIT
     ========================================================================== */

  async function init(){
    // 1. Settings (needed by both grid and modal)
    state.settings = await loadSettings();
    applySettings();

    // 2. Products + categories
    await loadProducts();
    buildCategories();

    // 3. First paint of the grid
    applyFilters();

    // 4. FAQs
    await loadFaqs();
    renderFaqs();

    // 5. Offers
    await loadOffers();
    renderStrips();
    renderBanners();
    renderPopup();

    // 6. Wire up UI
    setupSearch();
    setupModal();
    setupCategoryStrip();
    setupMenu();
    setupEmptyReset();
    setupReviewSort();
    setupLightbox();

    // 7. Auth (Supabase only)
    if (SUPABASE_READY) {
      state.currentUser = await getCurrentUser();
      listenAuthChanges();
    }

    // 8. Deep link (#product=VB-001)
    handleDeepLink();

    // 9. Re-check hash on later hash changes (back button etc.)
    window.addEventListener('hashchange', function () {
      if (!window.location.hash || window.location.hash.indexOf('#product=') !== 0) {
        if (state.currentProduct) closeProductModal();
        return;
      }
      var m = window.location.hash.match(/#product=([A-Za-z0-9\-]+)/);
      if (!m) return;
      var id = codeToId(m[1]);
      if (id) openProductById(id);
    });
  }

  // Run once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init().catch(function () { /* never crash the page */ });
    });
  } else {
    init().catch(function () { /* never crash the page */ });
  }

})();
