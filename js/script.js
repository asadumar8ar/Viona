/* =========================================================
   Viona Bangles — js/script.js
   Demo products render instantly. Supabase (optional) replaces
   them silently if configured and reachable.
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     CONFIG SHORTCUT
     --------------------------------------------------------- */
  var CFG = window.VIONA_CONFIG || {};

  var DEFAULT_SIZES = ['2.2', '2.4', '2.6', '2.8'];

  /* ---------------------------------------------------------
     STATE
     --------------------------------------------------------- */
  var allProducts = [];
  var reviewsByProduct = {};      // { "1": [review, ...] }
  var activeCategory = 'All';
  var searchTerm = '';
  var debounceTimer = null;

  var currentProduct = null;
  var currentImageIndex = 0;
  var currentSize = '';
  var modalOpen = false;
  var lastFocusedEl = null;

  var touchStartX = 0;
  var touchStartY = 0;

  /* ---------------------------------------------------------
     TINY DOM HELPERS
     --------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    var node = $(id);
    if (node) node.textContent = (value === undefined || value === null) ? '' : String(value);
  }

  // Escape everything that goes into innerHTML (XSS safety)
  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPrice(price) {
    var n = Number(price);
    if (isNaN(n)) n = 0;
    return '\u20B9' + n.toLocaleString('en-IN');
  }

  function starsHtml(avg) {
    var rounded = Math.round(Number(avg) || 0);
    var html = '';
    for (var i = 1; i <= 5; i++) {
      if (i <= rounded) {
        html += '<span class="star filled">\u2605</span>';
      } else {
        html += '<span class="star">\u2606</span>';
      }
    }
    return html;
  }

  function formatDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------------------------------------------------------
     SVG PLACEHOLDER GENERATOR (data-URI, no external images)
     --------------------------------------------------------- */
  var PALETTES = [
    ['#14224A', '#C9A24A'],
    ['#1B2C5C', '#E0BE6B'],
    ['#0D1730', '#B8913C']
  ];

  function makePlaceholderSvg(code, variant) {
    var v = Math.abs(Number(variant) || 0);
    var pal = PALETTES[v % PALETTES.length];
    var dark = pal[0];
    var light = pal[1];
    var angle = (v * 35) % 180;
    var offsetY = (v % 2 === 0) ? 0 : 16;

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">' +
        '<defs>' +
          '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="' + dark + '"/>' +
            '<stop offset="100%" stop-color="' + light + '"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect width="600" height="600" fill="url(#bg)"/>' +
        '<g transform="translate(300 ' + (296 + offsetY) + ') rotate(' + angle + ')">' +
          '<circle r="150" fill="none" stroke="#FBF6EA" stroke-width="26" opacity="0.92"/>' +
          '<circle r="150" fill="none" stroke="' + light + '" stroke-width="6"/>' +
          '<circle r="112" fill="none" stroke="#FBF6EA" stroke-width="10" opacity="0.45"/>' +
        '</g>' +
        '<text x="300" y="552" text-anchor="middle" font-family="Georgia, serif" ' +
              'font-size="34" letter-spacing="2" fill="#FBF6EA">' + code + '</text>' +
      '</svg>';

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------------------------------------------------------
     DEMO PRODUCTS (always available, never fetched)
     --------------------------------------------------------- */
  function buildDemoProducts() {
    var seed = [
      { id: 1, name: 'VIONA Classic Glass Bangles',  category: 'Glass',       desc: 'Glass bangles in sizes 2.2 to 2.8.' },
      { id: 2, name: 'VIONA Designer Glass Bangles', category: 'Glass',       desc: 'Designer glass bangles in sizes 2.2 to 2.8.' },
      { id: 3, name: 'VIONA Festive Glass Bangles',  category: 'Glass',       desc: 'Festive glass bangles in sizes 2.2 to 2.8.' },
      { id: 4, name: 'VIONA Traditional Bangles',    category: 'Traditional', desc: 'Traditional bangles in sizes 2.2 to 2.8.' },
      { id: 5, name: 'VIONA Wedding Glass Bangles',  category: 'Bridal',      desc: 'Bridal glass bangles in sizes 2.2 to 2.8.' },
      { id: 6, name: 'VIONA Fashion Bangles',        category: 'Fashion',     desc: 'Fashion bangles in sizes 2.2 to 2.8.' }
    ];

    return seed.map(function (item) {
      var code = 'VB-' + String(item.id).padStart(3, '0');
      return {
        id: item.id,
        code: code,
        name: item.name,
        price: 799,
        category: item.category,
        sizes: DEFAULT_SIZES.slice(),
        description: item.desc,
        main_image: makePlaceholderSvg(code, 0),
        additional_images: [
          makePlaceholderSvg(code, 1),
          makePlaceholderSvg(code, 2)
        ]
      };
    });
  }

  /* ---------------------------------------------------------
     DATA NORMALISING (Supabase rows -> product objects)
     --------------------------------------------------------- */
  function parseList(value, fallback) {
    if (Array.isArray(value)) {
      return value.map(function (v) { return String(v).trim(); }).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return value.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return (fallback || []).slice();
  }

  function normalizeProduct(row) {
    var id = row.id;
    return {
      id: id,
      code: 'VB-' + String(id).padStart(3, '0'),
      name: row.name ? String(row.name) : 'Bangle',
      price: Number(row.price) || 0,
      category: row.category ? String(row.category) : 'Other',
      sizes: parseList(row.sizes, DEFAULT_SIZES),
      description: row.description ? String(row.description) : '',
      main_image: row.main_image ? String(row.main_image) : '',
      additional_images: parseList(row.additional_images, [])
    };
  }

  function buildReviewMap(reviews) {
    reviewsByProduct = {};
    (reviews || []).forEach(function (r) {
      if (!r) return;
      var key = String(r.product_id);
      if (!reviewsByProduct[key]) reviewsByProduct[key] = [];
      reviewsByProduct[key].push(r);
    });
  }

  function getRatingInfo(productId) {
    var list = reviewsByProduct[String(productId)] || [];
    if (!list.length) return { count: 0, avg: 0 };
    var sum = 0;
    list.forEach(function (r) {
      var v = Number(r.rating);
      if (!isNaN(v)) sum += v;
    });
    return { count: list.length, avg: sum / list.length };
  }

  /* ---------------------------------------------------------
     IMAGE HELPERS
     --------------------------------------------------------- */
  function getImages(p) {
    var list = [];
    if (p.main_image) list.push(p.main_image);
    (p.additional_images || []).forEach(function (src) {
      if (src) list.push(src);
    });
    if (!list.length) list.push(makePlaceholderSvg(p.code, 0));
    return list;
  }

  function firstImage(p) {
    if (p.main_image) return p.main_image;
    if (p.additional_images && p.additional_images.length) return p.additional_images[0];
    return makePlaceholderSvg(p.code, 0);
  }

  function normalizeSizes(sizes) {
    var list = parseList(sizes, DEFAULT_SIZES);
    return list.length ? list : DEFAULT_SIZES.slice();
  }

  function sizesRange(sizes) {
    var list = normalizeSizes(sizes);
    if (list.length === 1) return list[0];
    return list[0] + ' - ' + list[list.length - 1];
  }

  /* ---------------------------------------------------------
     WHATSAPP LINKS
     --------------------------------------------------------- */
  function waBase() {
    return 'https://wa.me/' + encodeURIComponent(String(CFG.WHATSAPP_NUMBER || ''));
  }

  function orderWhatsappUrl(p, size) {
    var msg = 'Hello Viona, I want to order:\n' +
              'Product: ' + p.name + '\n' +
              'Code: ' + p.code + '\n' +
              'Price: ' + formatPrice(p.price) + '\n' +
              'Size: ' + (size || 'to be confirmed');
    return waBase() + '?text=' + encodeURIComponent(msg);
  }

  function reviewWhatsappUrl(p) {
    var msg = 'Hello Viona, I want to review:\n' +
              'Product: ' + p.name + ' (' + p.code + ')\n' +
              'Rating (1-5):\n' +
              'My review:';
    return waBase() + '?text=' + encodeURIComponent(msg);
  }

  /* ---------------------------------------------------------
     FILTERING + RENDERING
     --------------------------------------------------------- */
  function getFilteredProducts() {
    var term = searchTerm.trim().toLowerCase();
    return allProducts.filter(function (p) {
      if (activeCategory !== 'All' && p.category !== activeCategory) return false;
      if (!term) return true;
      var haystack = [p.name, p.category, p.description, p.code].join(' ').toLowerCase();
      return haystack.indexOf(term) !== -1;
    });
  }

  function renderCategoryBar() {
    var bar = $('category-bar');
    if (!bar) return;

    var cats = [];
    allProducts.forEach(function (p) {
      if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    cats.sort();

    // If the active category disappeared, fall back to All
    if (activeCategory !== 'All' && cats.indexOf(activeCategory) === -1) {
      activeCategory = 'All';
    }

    var list = ['All'].concat(cats);
    bar.innerHTML = '';

    list.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn' + (cat === activeCategory ? ' active' : '');
      btn.setAttribute('data-category', cat);
      btn.setAttribute('aria-pressed', cat === activeCategory ? 'true' : 'false');
      btn.textContent = cat;
      bar.appendChild(btn);
    });
  }

  function buildCard(p) {
    var card = document.createElement('article');
    card.className = 'product-card';
    card.setAttribute('data-id', String(p.id));
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'View details of ' + p.name);

    // --- image ---
    var media = document.createElement('div');
    media.className = 'card-media';

    var img = document.createElement('img');
    img.className = 'card-img';
    img.loading = 'lazy';
    img.alt = p.name;
    img.src = firstImage(p);
    img.addEventListener('error', function onErr() {
      img.removeEventListener('error', onErr);
      img.src = makePlaceholderSvg(p.code, 0);
    });
    media.appendChild(img);

    // --- body ---
    var rating = getRatingInfo(p.id);
    var ratingHtml = rating.count > 0
      ? '<div class="card-rating">' +
          '<span class="stars">' + starsHtml(rating.avg) + '</span>' +
          '<span class="rating-count">(' + rating.count + ')</span>' +
        '</div>'
      : '';

    var body = document.createElement('div');
    body.className = 'card-body';
    body.innerHTML =
      '<p class="card-code">' + escapeHtml(p.code) + '</p>' +
      '<h3 class="card-name">' + escapeHtml(p.name) + '</h3>' +
      '<p class="card-price">' + escapeHtml(formatPrice(p.price)) + '</p>' +
      '<p class="card-sizes">Sizes: ' + escapeHtml(sizesRange(p.sizes)) + '</p>' +
      ratingHtml +
      '<button class="btn btn-gold card-btn" type="button">View Details</button>';

    card.appendChild(media);
    card.appendChild(body);
    return card;
  }

  function renderProducts() {
    var grid = $('product-grid');
    if (!grid) return;

    var list = getFilteredProducts();
    var countEl = $('result-count');
    var emptyBox = $('no-results');

    if (countEl) {
      countEl.textContent = 'Showing ' + list.length + ' ' +
        (list.length === 1 ? 'bangle' : 'bangles');
    }

    grid.innerHTML = '';

    if (!list.length) {
      if (emptyBox) emptyBox.hidden = false;
      return;
    }

    if (emptyBox) emptyBox.hidden = true;

    var frag = document.createDocumentFragment();
    list.forEach(function (p) { frag.appendChild(buildCard(p)); });
    grid.appendChild(frag);
  }

  /* ---------------------------------------------------------
     MODAL — OPEN / CLOSE
     --------------------------------------------------------- */
  function productCodeFromHash() {
    var hash = window.location.hash || '';
    if (hash.indexOf('#product=') !== 0) return '';
    var code = hash.slice('#product='.length);
    try { code = decodeURIComponent(code); } catch (e) { /* ignore */ }
    return code;
  }

  function openProductById(id) {
    var found = null;
    for (var i = 0; i < allProducts.length; i++) {
      if (String(allProducts[i].id) === String(id)) { found = allProducts[i]; break; }
    }
    if (!found) return;
    openProductByCode(found.code, true);
  }

  function openProductByCode(code, push) {
    var found = null;
    for (var i = 0; i < allProducts.length; i++) {
      if (allProducts[i].code === code) { found = allProducts[i]; break; }
    }
    if (!found) return;

    if (push) {
      try {
        window.history.pushState({ product: code }, '', '#product=' + encodeURIComponent(code));
      } catch (e) { /* ignore */ }
    }

    showModal(found);
  }

  function showModal(product) {
    var overlay = $('modal-overlay');
    var body = $('modal-body');
    if (!overlay || !body) return;

    // Remember where focus came from (only on first open)
    if (!modalOpen) lastFocusedEl = document.activeElement;

    currentProduct = product;
    currentImageIndex = 0;
    currentSize = '';

    body.innerHTML = buildModalHtml(product);

    overlay.hidden = false;
    modalOpen = true;
    document.body.classList.add('modal-open');

    bindModalEvents();

    // Move focus into the dialog
    var closeBtn = $('modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function hideModal() {
    var overlay = $('modal-overlay');
    if (overlay) overlay.hidden = true;

    modalOpen = false;
    currentProduct = null;
    currentSize = '';
    document.body.classList.remove('modal-open');

    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      try { lastFocusedEl.focus(); } catch (e) { /* ignore */ }
    }
    lastFocusedEl = null;
  }

  // userAction = true when the visitor closed it (X / Esc / overlay)
  function closeModal(userAction) {
    if (!modalOpen) return;
    hideModal();

    if (!userAction) return;

    if (window.history.state && window.history.state.product) {
      // We pushed this entry -> go back so Back/Forward stays in sync
      window.history.back();
    } else {
      // Opened directly from a link -> just clear the hash
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) { /* ignore */ }
    }
  }

  /* ---------------------------------------------------------
     MODAL — HTML BUILDER
     --------------------------------------------------------- */
  function detailRow(label, value) {
    return '<div class="detail-row">' +
             '<span class="detail-row-label">' + escapeHtml(label) + '</span>' +
             '<span class="detail-row-value">' + escapeHtml(value) + '</span>' +
           '</div>';
  }

  function reviewsHtml(p, rating, reviews) {
    var html = '';

    if (!reviews.length) {
      html += '<div class="reviews-empty">' +
                '<p>No reviews yet. Be the first to share your experience.</p>' +
              '</div>';
    } else {
      html += '<div class="reviews-summary">' +
                '<span class="reviews-avg">' + rating.avg.toFixed(1) + '</span>' +
                '<span class="stars">' + starsHtml(rating.avg) + '</span>' +
                '<span class="rating-count">(' + reviews.length + ' review' +
                  (reviews.length === 1 ? '' : 's') + ')</span>' +
              '</div>';
      html += '<ul class="review-list">';
      reviews.forEach(function (r) {
        html += '<li class="review-item">' +
                  '<div class="review-head">' +
                    '<span class="review-name">' + escapeHtml(r.name || 'Customer') + '</span>' +
                    '<span class="review-date">' + escapeHtml(formatDate(r.created_at)) + '</span>' +
                  '</div>' +
                  '<span class="stars">' + starsHtml(Number(r.rating) || 0) + '</span>' +
                  '<p class="review-comment">' + escapeHtml(r.comment || '') + '</p>' +
                '</li>';
      });
      html += '</ul>';
    }

    html += '<a class="btn btn-outline btn-block" id="review-wa" href="' +
              escapeHtml(reviewWhatsappUrl(p)) + '" target="_blank" rel="noopener">' +
              'Write a Review on WhatsApp</a>';

    return html;
  }

  function getRelated(p, limit) {
    var same = [];
    var others = [];
    allProducts.forEach(function (x) {
      if (String(x.id) === String(p.id)) return;
      if (x.category === p.category) same.push(x);
      else others.push(x);
    });
    return same.concat(others).slice(0, limit);
  }

  function buildModalHtml(p) {
    var images = getImages(p);
    var sizes = normalizeSizes(p.sizes);
    var rating = getRatingInfo(p.id);
    var reviews = reviewsByProduct[String(p.id)] || [];
    var html = '';

    html += '<div class="detail">';

    /* ---------- LEFT : GALLERY ---------- */
    html += '<div class="gallery">';
    html += '<div class="gallery-main">';
    html += '<img id="gallery-main-img" src="' + escapeHtml(images[0]) +
            '" alt="' + escapeHtml(p.name) + '">';

    if (images.length > 1) {
      html += '<button class="gal-arrow gal-prev" type="button" aria-label="Previous image">\u2039</button>';
      html += '<button class="gal-arrow gal-next" type="button" aria-label="Next image">\u203A</button>';
      html += '<span class="gal-counter" id="gal-counter">1 / ' + images.length + '</span>';
    }

    html += '</div>'; // .gallery-main

    if (images.length > 1) {
      html += '<div class="thumbs" id="thumbs">';
      images.forEach(function (src, i) {
        html += '<button class="thumb' + (i === 0 ? ' active' : '') + '" type="button" ' +
                  'data-index="' + i + '" aria-label="Show image ' + (i + 1) + '">' +
                  '<img src="' + escapeHtml(src) + '" alt="">' +
                '</button>';
      });
      html += '</div>';
    }

    html += '</div>'; // .gallery

    /* ---------- RIGHT : INFO ---------- */
    html += '<div class="detail-info">';

    html += '<p class="detail-category">' + escapeHtml(p.category) + '</p>';
    html += '<h2 class="detail-name" id="modal-title">' + escapeHtml(p.name) + '</h2>';
    html += '<p class="detail-code">Code: ' + escapeHtml(p.code) + '</p>';

    if (rating.count > 0) {
      html += '<div class="detail-rating">' +
                '<span class="stars">' + starsHtml(rating.avg) + '</span>' +
                '<span class="rating-count">(' + rating.count + ' review' +
                  (rating.count === 1 ? '' : 's') + ')</span>' +
              '</div>';
    }

    html += '<p class="detail-price">' + escapeHtml(formatPrice(p.price)) + '</p>';

    // Size selector
    html += '<div class="size-block">' +
              '<p class="block-label">Select Size</p>' +
              '<div class="size-chips" id="size-chips">';
    sizes.forEach(function (s) {
      html += '<button class="size-chip" type="button" data-size="' +
              escapeHtml(s) + '" aria-pressed="false">' + escapeHtml(s) + '</button>';
    });
    html += '</div></div>';

    // Order button
    html += '<a class="btn btn-gold btn-block" id="order-wa" href="' +
            escapeHtml(orderWhatsappUrl(p, '')) + '" target="_blank" rel="noopener">' +
            'Order on WhatsApp</a>';

    // Details table
    html += '<div class="details-table">' +
              detailRow('Category', p.category) +
              detailRow('Available sizes', sizes.join(', ')) +
              detailRow('Delivery', 'All India, 5 to 7 working days') +
              detailRow('Returns', 'Exchange for damaged or wrong products') +
              detailRow('Payment', 'UPI and bank transfer') +
            '</div>';

    // Tabs
    html += '<div class="tabs" role="tablist">' +
              '<button class="tab active" type="button" data-tab="details" ' +
                'role="tab" aria-selected="true">Details</button>' +
              '<button class="tab" type="button" data-tab="reviews" ' +
                'role="tab" aria-selected="false">Reviews (' + reviews.length + ')</button>' +
            '</div>';

    html += '<div class="tab-panel" id="panel-details">' +
              '<p class="detail-desc">' + escapeHtml(p.description) + '</p>' +
            '</div>';

    html += '<div class="tab-panel" id="panel-reviews" hidden>' +
              reviewsHtml(p, rating, reviews) +
            '</div>';

    html += '</div>'; // .detail-info
    html += '</div>'; // .detail

    /* ---------- RELATED ---------- */
    var related = getRelated(p, 4);
    if (related.length) {
      html += '<div class="related">' +
                '<h3 class="related-title">You may also like</h3>' +
                '<div class="related-grid">';
      related.forEach(function (r) {
        html += '<button class="related-card" type="button" data-code="' + escapeHtml(r.code) + '">' +
                  '<span class="related-img">' +
                    '<img src="' + escapeHtml(firstImage(r)) + '" alt="' + escapeHtml(r.name) + '" loading="lazy">' +
                  '</span>' +
                  '<span class="related-name">' + escapeHtml(r.name) + '</span>' +
                  '<span class="related-price">' + escapeHtml(formatPrice(r.price)) + '</span>' +
                '</button>';
      });
      html += '</div></div>';
    }

    return html;
  }

  /* ---------------------------------------------------------
     MODAL — GALLERY CONTROLS
     --------------------------------------------------------- */
  function setImage(index) {
    if (!currentProduct) return;
    var images = getImages(currentProduct);
    if (!images.length) return;

    if (index < 0) index = images.length - 1;
    if (index >= images.length) index = 0;
    currentImageIndex = index;

    var mainImg = $('gallery-main-img');
    if (mainImg) mainImg.src = images[index];

    var counter = $('gal-counter');
    if (counter) counter.textContent = (index + 1) + ' / ' + images.length;

    var body = $('modal-body');
    if (body) {
      var thumbs = body.querySelectorAll('.thumb');
      for (var i = 0; i < thumbs.length; i++) {
        var t = thumbs[i];
        var idx = parseInt(t.getAttribute('data-index'), 10);
        if (idx === index) t.classList.add('active');
        else t.classList.remove('active');
      }
    }
  }

  function stepImage(delta) {
    var images = currentProduct ? getImages(currentProduct) : [];
    if (images.length < 2) return;
    setImage(currentImageIndex + delta);
  }

  function selectSize(size) {
    currentSize = size;

    var body = $('modal-body');
    if (body) {
      var chips = body.querySelectorAll('.size-chip');
      for (var i = 0; i < chips.length; i++) {
        var c = chips[i];
        var isActive = c.getAttribute('data-size') === size;
        if (isActive) {
          c.classList.add('active');
          c.setAttribute('aria-pressed', 'true');
        } else {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        }
      }
    }

    updateOrderLink();
  }

  function updateOrderLink() {
    var link = $('order-wa');
    if (!link || !currentProduct) return;
    link.href = orderWhatsappUrl(currentProduct, currentSize);
  }

  /* ---------------------------------------------------------
     MODAL — EVENT BINDING (after each render)
     --------------------------------------------------------- */
  function bindModalEvents() {
    var body = $('modal-body');
    if (!body || !currentProduct) return;

    // Arrows
    var prev = body.querySelector('.gal-prev');
    var next = body.querySelector('.gal-next');
    if (prev) prev.addEventListener('click', function () { stepImage(-1); });
    if (next) next.addEventListener('click', function () { stepImage(1); });

    // Thumbnails
    var thumbs = body.querySelectorAll('.thumb');
    for (var i = 0; i < thumbs.length; i++) {
      (function (thumb) {
        thumb.addEventListener('click', function () {
          var idx = parseInt(thumb.getAttribute('data-index'), 10);
          setImage(isNaN(idx) ? 0 : idx);
        });
      })(thumbs[i]);
    }

    // Size chips
    var chips = body.querySelectorAll('.size-chip');
    for (var j = 0; j < chips.length; j++) {
      (function (chip) {
        chip.addEventListener('click', function () {
          selectSize(chip.getAttribute('data-size'));
        });
      })(chips[j]);
    }

    // Tabs
    var tabs = body.querySelectorAll('.tab');
    for (var k = 0; k < tabs.length; k++) {
      (function (tab) {
        tab.addEventListener('click', function () {
          for (var m = 0; m < tabs.length; m++) {
            tabs[m].classList.remove('active');
            tabs[m].setAttribute('aria-selected', 'false');
          }
          tab.classList.add('active');
          tab.setAttribute('aria-selected', 'true');

          var name = tab.getAttribute('data-tab');
          var pd = $('panel-details');
          var pr = $('panel-reviews');
          if (pd) pd.hidden = (name !== 'details');
          if (pr) pr.hidden = (name !== 'reviews');
        });
      })(tabs[k]);
    }

    // Related products
    var relatedCards = body.querySelectorAll('.related-card');
    for (var n = 0; n < relatedCards.length; n++) {
      (function (card) {
        card.addEventListener('click', function () {
          openProductByCode(card.getAttribute('data-code'), true);
        });
      })(relatedCards[n]);
    }

    // Main image fallback
    var mainImg = $('gallery-main-img');
    if (mainImg) {
      mainImg.addEventListener('error', function onErr() {
        mainImg.removeEventListener('error', onErr);
        mainImg.src = makePlaceholderSvg(currentProduct.code, currentImageIndex);
      });
    }

    // Swipe on mobile
    var mainWrap = body.querySelector('.gallery-main');
    if (mainWrap) {
      mainWrap.addEventListener('touchstart', function (e) {
        if (!e.touches || !e.touches.length) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      mainWrap.addEventListener('touchend', function (e) {
        if (!e.changedTouches || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          stepImage(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
    }

    // Fresh order link (no size selected yet)
    updateOrderLink();
  }

  /* ---------------------------------------------------------
     CONFIG -> PAGE (whatsapp, phone, email, city, hours, year)
     --------------------------------------------------------- */
  function applyConfig() {
    var waNumber = String(CFG.WHATSAPP_NUMBER || '');
    var email = String(CFG.EMAIL || '');
    var city = String(CFG.CITY || '');
    var hours = String(CFG.HOURS || '');

    // Hero WhatsApp button
    var heroWa = $('hero-whatsapp');
    if (heroWa) {
      heroWa.href = waBase() + '?text=' +
        encodeURIComponent('Hello Viona, I want to order bangles');
    }

    // Contact block
    var cWa = $('contact-whatsapp');
    if (cWa) cWa.href = waBase();
    setText('contact-whatsapp-text', waNumber ? '+' + waNumber : 'WhatsApp');

    var cPhone = $('contact-phone');
    if (cPhone) cPhone.href = 'tel:+' + waNumber;
    setText('contact-phone-text', waNumber ? '+' + waNumber : '');

    var cEmail = $('contact-email');
    if (cEmail) cEmail.href = 'mailto:' + email;
    setText('contact-email-text', email);

    setText('contact-city', city);
    setText('contact-hours', hours);

    // About block
    setText('about-city', city);
    setText('about-hours', hours);

    // Footer
    setText('footer-city', city);
    setText('footer-city-text', city);

    var fWa = $('footer-whatsapp');
    if (fWa) fWa.href = waBase();

    var fEmail = $('footer-email');
    if (fEmail) fEmail.href = 'mailto:' + email;
    setText('footer-email-text', email);

    setText('footer-year', new Date().getFullYear());

    // Brand fallback text (shown if logo.png is missing)
    if (CFG.BUSINESS_NAME) {
      setText('brand-text', String(CFG.BUSINESS_NAME).split(' ')[0]);
    }
  }

  /* ---------------------------------------------------------
     EVENTS
     --------------------------------------------------------- */
  function bindEvents() {
    // --- mobile menu ---
    var burger = $('hamburger');
    var nav = $('main-nav');

    if (burger && nav) {
      burger.addEventListener('click', function () {
        var isOpen = nav.classList.toggle('open');
        burger.classList.toggle('active', isOpen);
        burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      nav.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'A') {
          nav.classList.remove('open');
          burger.classList.remove('active');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // --- search (200 ms debounce) ---
    var input = $('search-input');
    var clearBtn = $('search-clear');

    if (input) {
      input.addEventListener('input', function () {
        if (clearBtn) clearBtn.hidden = input.value.length === 0;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          searchTerm = input.value;
          renderProducts();
        }, 200);
      });
    }

    if (clearBtn && input) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        searchTerm = '';
        clearBtn.hidden = true;
        renderProducts();
        input.focus();
      });
    }

    // --- category buttons (delegation) ---
    var bar = $('category-bar');
    if (bar) {
      bar.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.cat-btn') : null;
        if (!btn) return;
        activeCategory = btn.getAttribute('data-category') || 'All';
        renderCategoryBar();
        renderProducts();
      });
    }

    // --- "show all bangles" ---
    var showAll = $('show-all-btn');
    if (showAll) {
      showAll.addEventListener('click', function () {
        activeCategory = 'All';
        searchTerm = '';
        if (input) input.value = '';
        if (clearBtn) clearBtn.hidden = true;
        renderCategoryBar();
        renderProducts();
      });
    }

    // --- product grid (delegation) ---
    var grid = $('product-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var card = e.target && e.target.closest ? e.target.closest('.product-card') : null;
        if (!card) return;
        openProductById(card.getAttribute('data-id'));
      });

      grid.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var card = e.target && e.target.closest ? e.target.closest('.product-card') : null;
        if (!card) return;
        e.preventDefault();
        openProductById(card.getAttribute('data-id'));
      });
    }

    // --- modal close: X button ---
    var closeBtn = $('modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { closeModal(true); });
    }

    // --- modal close: click on dark overlay ---
    var overlay = $('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal(true);
      });
    }

    // --- FAQ accordion ---
    var faqList = $('faq-list');
    if (faqList) {
      faqList.addEventListener('click', function (e) {
        var q = e.target && e.target.closest ? e.target.closest('.faq-question') : null;
        if (!q) return;

        var item = q.parentElement;
        var wasOpen = item.classList.contains('open');

        var opened = faqList.querySelectorAll('.faq-item.open');
        for (var i = 0; i < opened.length; i++) {
          opened[i].classList.remove('open');
          var oq = opened[i].querySelector('.faq-question');
          if (oq) oq.setAttribute('aria-expanded', 'false');
        }

        if (!wasOpen) {
          item.classList.add('open');
          q.setAttribute('aria-expanded', 'true');
        }
      });
    }

    // --- keyboard: Esc closes, arrows move gallery ---
    document.addEventListener('keydown', function (e) {
      if (!modalOpen) return;
      if (e.key === 'Escape') {
        closeModal(true);
      } else if (e.key === 'ArrowRight') {
        stepImage(1);
      } else if (e.key === 'ArrowLeft') {
        stepImage(-1);
      }
    });

    // --- browser Back / Forward ---
    window.addEventListener('popstate', function () {
      var code = productCodeFromHash();
      if (code) {
        openProductByCode(code, false);
      } else {
        hideModal();
      }
    });
  }

  /* ---------------------------------------------------------
     OPTIONAL SUPABASE LOAD (plain fetch REST, no library)
     --------------------------------------------------------- */
  function supabaseReady() {
    var url = String(CFG.SUPABASE_URL || '');
    var key = String(CFG.SUPABASE_ANON_KEY || '');
    return url.indexOf('http') === 0 &&
           url.indexOf('PASTE_') !== 0 &&
           key.indexOf('PASTE_') !== 0 &&
           key.length > 20;
  }

  function loadFromSupabase() {
    var url = String(CFG.SUPABASE_URL).replace(/\/+$/, '');
    var key = String(CFG.SUPABASE_ANON_KEY);

    var headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    };

    var productsUrl = url + '/rest/v1/products?select=*&order=id.asc';
    var reviewsUrl = url + '/rest/v1/reviews?select=*&approved=eq.true&order=created_at.desc';

    var productsPromise = fetch(productsUrl, { headers: headers });
    var reviewsPromise = fetch(reviewsUrl, { headers: headers })
      .catch(function () { return null; });

    Promise.all([productsPromise, reviewsPromise])
      .then(function (results) {
        var pRes = results[0];
        var rRes = results[1];

        if (!pRes || !pRes.ok) throw new Error('products request failed');

        return pRes.json().then(function (rows) {
          return { rows: rows, reviewsRes: rRes };
        });
      })
      .then(function (data) {
        var rows = data.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
          console.warn('Viona: Supabase returned 0 products, keeping demo data.');
          return;
        }

        allProducts = rows.map(normalizeProduct);

        var rRes = data.reviewsRes;
        if (rRes && rRes.ok) {
          return rRes.json()
            .then(function (reviews) { return reviews; })
            .catch(function () { return []; });
        }
        return [];
      })
      .then(function (reviews) {
        if (!Array.isArray(reviews)) reviews = [];
        buildReviewMap(reviews);

        renderCategoryBar();
        renderProducts();

        console.log('Viona: loaded ' + allProducts.length + ' products from Supabase.');
      })
      .catch(function (err) {
        console.warn('Viona: Supabase load failed, keeping demo products.', err);
      });
  }

  /* ---------------------------------------------------------
     HASH ON FIRST LOAD
     --------------------------------------------------------- */
  function handleInitialHash() {
    var code = productCodeFromHash();
    if (code) openProductByCode(code, false);
  }

  /* ---------------------------------------------------------
     INIT
     --------------------------------------------------------- */
  function init() {
    // 1. Business data into the page
    try {
      applyConfig();
    } catch (e) {
      console.warn('Viona: applyConfig failed', e);
    }

    // 2. Demo products render immediately — page is never empty
    try {
      allProducts = buildDemoProducts();
      buildReviewMap([]);
      renderCategoryBar();
      renderProducts();
    } catch (e) {
      console.warn('Viona: initial render failed', e);
    }

    console.log('Viona site loaded, products:', allProducts.length);

    // 3. Interactions
    try {
      bindEvents();
    } catch (e) {
      console.warn('Viona: bindEvents failed', e);
    }

    // 4. Deep link (#product=VB-001)
    try {
      handleInitialHash();
    } catch (e) {
      console.warn('Viona: hash handling failed', e);
    }

    // 5. Optional real data (silent if not configured / unreachable)
    if (supabaseReady()) {
      loadFromSupabase();
    } else {
      console.log('Viona: Supabase not configured — using demo products.');
    }
  }

  // Scripts use defer, so the DOM is ready — but stay safe anyway.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
