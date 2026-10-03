/* ============================================================================
   Viona Bangles — js/admin.js
   Admin site logic. Talks to Supabase with the anon key; all real security
   comes from Row Level Security policies (see supabase/setup.sql).

   Sections:
     A. Config + Supabase client
     B. Utilities (escape, toast, modal, compress, etc.)
     C. Auth (login, is_admin, sign out)
     D. Products (list, edit, images, save, delete)
     E. Offers (list, edit, live preview, save, delete)
     F. Reviews (list, filter, approve, delete)
     G. Site Settings (load, save)
     H. FAQ (list, edit, save, delete, reorder)
     I. Boot
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     A. CONFIG + SUPABASE CLIENT
     ========================================================================== */

  var CFG = window.VIONA_CONFIG || {};

  function isPlaceholder(v){
    return !v || typeof v !== 'string' ||
           v.indexOf('PASTE_') === 0 ||
           v.indexOf('PASTE_YOUR') !== -1 ||
           v.indexOf('.supabase.co') === -1;
  }

  var CONFIGURED = !isPlaceholder(CFG.SUPABASE_URL) && !isPlaceholder(CFG.SUPABASE_ANON_KEY);
  var sb = null;

  if (CONFIGURED && window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) {
      sb = null;
    }
  }

  /* ==========================================================================
     B. UTILITIES
     ========================================================================== */

  function el(id){ return document.getElementById(id); }

  function esc(s){
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escAttr(s){ return esc(s); }

  function money(n){
    var num = Number(n);
    if (isNaN(num)) num = 0;
    return 'Rs ' + ((num % 1 === 0) ? String(num) : num.toFixed(2));
  }

  function code(id){
    var n = Number(id) || 0;
    var s = String(n);
    while (s.length < 3) s = '0' + s;
    return 'VB-' + s;
  }

  function starsHtml(rating){
    var r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="' + (i <= r ? '' : 'star-off') + '">★</span>';
    }
    return out;
  }

  function formatDate(iso){
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
    } catch (e) { return ''; }
  }

  var toastTimer = null;
  function toast(msg, isError){
    var t = el('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    if (isError) t.classList.add('is-error'); else t.classList.remove('is-error');
    t.hidden = false;
    void t.offsetWidth;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.hidden = true; }, 260);
    }, 2600);
  }

  function busy(on){
    var b = el('busy');
    if (!b) return;
    b.hidden = !on;
  }

  // Modal open/close
  function openModal(id){
    var m = el(id);
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id){
    var m = el(id);
    if (!m) return;
    m.hidden = true;
    document.body.style.overflow = '';
  }

  // Confirm dialog returns a Promise<boolean>
  var confirmResolve = null;
  function confirmDialog(opts){
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      var title = el('confirmTitle');
      var text = el('confirmText');
      var yes = el('confirmYes');
      if (title) title.textContent = (opts && opts.title) || 'Are you sure?';
      if (text)  text.textContent  = (opts && opts.text)  || 'This cannot be undone.';
      if (yes)   yes.textContent   = (opts && opts.confirmText) || 'Delete';
      openModal('confirmModal');
    });
  }
  function resolveConfirm(val){
    closeModal('confirmModal');
    if (confirmResolve) {
      var r = confirmResolve;
      confirmResolve = null;
      r(val);
    }
  }

  // Simple image compression (returns a Blob)
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
                if (!blob) return reject(new Error('Compress failed'));
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

  // Upload a blob to a bucket and return the public URL (or throw)
  async function uploadImage(bucket, blob, folderPrefix){
    if (!sb) throw new Error('Not connected');
    var folder = folderPrefix ? (String(folderPrefix).replace(/\/+$/, '') + '/') : '';
    var name = folder + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
    var res = await sb.storage.from(bucket).upload(name, blob, {
      contentType: 'image/jpeg',
      upsert: false
    });
    if (res && res.error) throw res.error;
    var pub = sb.storage.from(bucket).getPublicUrl(name);
    if (!pub || !pub.data || !pub.data.publicUrl) throw new Error('Upload URL missing');
    return pub.data.publicUrl;
  }

  function toLocalInput(iso){
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
             'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return ''; }
  }
  function fromLocalInput(val){
    if (!val) return null;
    try {
      var d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch (e) { return null; }
  }

  /* ==========================================================================
     C. AUTH
     ========================================================================== */

  var state = {
    user: null,
    isAdmin: false,
    products: [],
    offers: [],
    reviews: [],
    faqs: [],
    settings: {},
    reviewFilter: 'pending',

    // Product editor transient data
    pImages: [],       // [{ url, file }] file===null => existing URL
    pSizes: [],        // string[]

    // Offer editor transient data
    oBgFile: null      // Blob or null
  };

  function showLogin(){
    var a = el('app'); if (a) a.hidden = true;
    var d = el('deniedScreen'); if (d) d.hidden = true;
    var l = el('loginScreen'); if (l) l.hidden = false;
  }
  function showDenied(email){
    var a = el('app'); if (a) a.hidden = true;
    var l = el('loginScreen'); if (l) l.hidden = true;
    var d = el('deniedScreen'); if (d) d.hidden = false;
    var e = el('deniedEmail');
    if (e) e.textContent = email ? ('Signed in as ' + email) : '';
  }
  function showApp(){
    var l = el('loginScreen'); if (l) l.hidden = true;
    var d = el('deniedScreen'); if (d) d.hidden = true;
    var a = el('app'); if (a) a.hidden = false;
  }

  async function checkAdmin(){
    if (!sb) return false;
    try {
      var res = await sb.rpc('is_admin');
      if (res && res.error) throw res.error;
      return res && res.data === true;
    } catch (e) {
      return false;
    }
  }

  function applyUser(){
    var u = state.user;
    var nameEl = el('whoName');
    if (nameEl) {
      if (u) {
        var meta = u.user_metadata || {};
        nameEl.textContent = meta.full_name || meta.name || u.email || 'Admin';
      } else {
        nameEl.textContent = '—';
      }
    }
  }

  async function bootAuth(){
    if (!CONFIGURED || !sb) {
      // No Supabase: show a friendly login screen with an explanation
      showLogin();
      var note = el('loginNote');
      if (note) {
        note.hidden = false;
        note.textContent = 'Supabase is not configured. Add your Project URL and anon key in js/config.js.';
      }
      var btn = el('loginGoogleBtn');
      if (btn) btn.disabled = true;
      return;
    }

    try {
      var res = await sb.auth.getSession();
      var session = res && res.data ? res.data.session : null;
      state.user = session && session.user ? session.user : null;
    } catch (e) {
      state.user = null;
    }

    if (!state.user) { showLogin(); return; }

    state.isAdmin = await checkAdmin();
    if (!state.isAdmin) { showDenied(state.user.email || ''); return; }

    applyUser();
    showApp();
    await loadAll();
  }

  async function signInWithGoogle(){
    if (!sb) return;
    try {
      var redirect = window.location.origin + window.location.pathname;
      var res = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect }
      });
      if (res && res.error) throw res.error;
    } catch (e) {
      toast('Could not start Google sign in.', true);
    }
  }

  async function signOut(){
    if (!sb) return;
    try {
      await sb.auth.signOut();
      toast('Signed out');
      state.user = null;
      state.isAdmin = false;
      showLogin();
    } catch (e) {
      toast('Could not sign out.', true);
    }
  }

  /* ==========================================================================
     D. PRODUCTS
     ========================================================================== */

  async function loadProducts(){
    if (!sb) { state.products = []; return; }
    try {
      var res = await sb
        .from('products')
        .select('id,name,category,price,old_price,sizes,description,main_image,additional_images,is_active,is_featured,sort_order,created_at')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res && res.error) throw res.error;
      state.products = (res && res.data) || [];
    } catch (e) {
      state.products = [];
      toast('Could not load products.', true);
    }
  }

  function productImages(p){
    if (!p) return [];
    var out = [];
    if (p.main_image) out.push(p.main_image);
    if (Array.isArray(p.additional_images)) {
      p.additional_images.forEach(function (u) {
        if (u && out.indexOf(u) === -1) out.push(u);
      });
    }
    return out;
  }

  function renderProducts(){
    var wrap = el('productsList');
    if (!wrap) return;

    if (!state.products.length) {
      wrap.innerHTML = '<p class="loading-line">No products yet. Click “New Product”.</p>';
      return;
    }

    var html = '';
    state.products.forEach(function (p) {
      var imgs = productImages(p);
      var thumb = imgs.length
        ? '<img class="row-thumb" src="' + escAttr(imgs[0]) + '" alt="" loading="lazy" />'
        : '<div class="row-thumb-ph">V</div>';

      var tags = '';
      if (p.is_active) tags += '<span class="tag tag-green">Active</span> ';
      else tags += '<span class="tag tag-red">Hidden</span> ';
      if (p.is_featured) tags += '<span class="tag tag-gold">Featured</span> ';

      var off = (p.old_price && Number(p.old_price) > Number(p.price))
        ? Math.round(((Number(p.old_price) - Number(p.price)) / Number(p.old_price)) * 100)
        : 0;

      html +=
        '<div class="row-item" data-pid="' + escAttr(String(p.id)) + '">' +
          thumb +
          '<div class="row-body">' +
            '<p class="row-meta">' + esc(code(p.id)) + ' · ' + esc(p.category || 'Other') + '</p>' +
            '<h3 class="row-title">' + esc(p.name || '') + '</h3>' +
            '<p class="row-sub">' +
              money(p.price) +
              (p.old_price && off ? ' <span style="text-decoration:line-through;color:#9A958C;">' + money(p.old_price) + '</span> <span class="tag tag-gold">' + off + '% OFF</span>' : '') +
              ' · Sizes: ' + esc((Array.isArray(p.sizes) && p.sizes.length ? p.sizes.join(', ') : '—')) +
            '</p>' +
            '<p class="row-sub">' + tags + '</p>' +
            '<div class="row-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="toggle">' +
                (p.is_active ? 'Hide' : 'Show') +
              '</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    wrap.innerHTML = html;

    // Wire up actions
    Array.prototype.forEach.call(wrap.querySelectorAll('.row-item'), function (row) {
      var pid = Number(row.getAttribute('data-pid'));
      var p = state.products.find(function (x) { return Number(x.id) === pid; });
      if (!p) return;

      var edit = row.querySelector('[data-act="edit"]');
      var toggle = row.querySelector('[data-act="toggle"]');
      var del = row.querySelector('[data-act="delete"]');

      if (edit) edit.addEventListener('click', function () { openProductEditor(p); });
      if (toggle) toggle.addEventListener('click', function () { toggleProductActive(p); });
      if (del) del.addEventListener('click', function () { deleteProduct(p); });
    });
  }

  async function toggleProductActive(p){
    try {
      var res = await sb.from('products').update({ is_active: !p.is_active }).eq('id', p.id);
      if (res && res.error) throw res.error;
      p.is_active = !p.is_active;
      renderProducts();
      toast(p.is_active ? 'Product is now visible.' : 'Product hidden from the site.');
    } catch (e) {
      toast('Could not update product.', true);
    }
  }

  async function deleteProduct(p){
    var ok = await confirmDialog({
      title: 'Delete product?',
      text: 'This will remove “' + (p.name || 'this product') + '” and all its reviews. This cannot be undone.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    try {
      var res = await sb.from('products').delete().eq('id', p.id);
      if (res && res.error) throw res.error;
      toast('Product deleted.');
      await loadProducts();
      renderProducts();
      refreshCategoryList();
    } catch (e) {
      toast('Could not delete product.', true);
    }
  }

  function refreshCategoryList(){
    var dl = el('catList');
    if (!dl) return;
    var set = {};
    state.products.forEach(function (p) {
      if (p.category) set[p.category] = true;
    });
    var cats = Object.keys(set).sort();
    var html = '';
    cats.forEach(function (c) { html += '<option value="' + escAttr(c) + '"></option>'; });
    dl.innerHTML = html;
  }

  function openProductEditor(p){
    var isEdit = !!p;
    var pid = el('productModalTitle');
    if (pid) pid.textContent = isEdit ? 'Edit Product' : 'New Product';

    var idEl = el('pEditId');
    if (idEl) idEl.value = isEdit ? String(p.id) : '';

    el('pName').value      = isEdit ? (p.name || '') : '';
    el('pCategory').value  = isEdit ? (p.category || '') : 'Glass';
    el('pPrice').value     = isEdit ? String(p.price || 0) : '799';
    el('pOldPrice').value  = (isEdit && p.old_price) ? String(p.old_price) : '';
    el('pDescription').value = isEdit ? (p.description || '') : '';
    el('pIsActive').checked = isEdit ? p.is_active !== false : true;
    el('pIsFeatured').checked = isEdit ? p.is_featured === true : false;
    el('pSortOrder').value = isEdit ? String(p.sort_order || 0) : '0';

    // Sizes
    state.pSizes = (isEdit && Array.isArray(p.sizes) && p.sizes.length)
      ? p.sizes.map(String)
      : ['2.2','2.4','2.6','2.8'];
    renderSizesEditor();

    // Images
    state.pImages = (isEdit ? productImages(p) : []).map(function (u) {
      return { url: u, file: null };
    });
    renderImagesEditor();

    // Clear form error
    var err = el('productFormError');
    if (err) { err.hidden = true; err.textContent = ''; }

    refreshCategoryList();
    openModal('productModal');
  }

  function renderSizesEditor(){
    var wrap = el('pSizesChips');
    if (!wrap) return;
    if (!state.pSizes.length) {
      wrap.innerHTML = '<span style="color:#9A958C;font-size:12.5px;padding:4px;">No sizes yet.</span>';
      return;
    }
    var html = '';
    state.pSizes.forEach(function (s, i) {
      html +=
        '<span class="chip-item">' + esc(s) +
          '<button type="button" data-remove-size="' + i + '" aria-label="Remove size">×</button>' +
        '</span>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('[data-remove-size]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-remove-size'));
        state.pSizes.splice(i, 1);
        renderSizesEditor();
      });
    });
  }

  function renderImagesEditor(){
    var wrap = el('pImages');
    if (!wrap) return;

    if (!state.pImages.length) {
      wrap.innerHTML = '<p class="hint" style="grid-column:1/-1;">No images yet. The site will show its placeholder.</p>';
      return;
    }

    var html = '';
    state.pImages.forEach(function (item, i) {
      var src = item.file ? item.url /* already an object URL */ : item.url;
      html +=
        '<div class="img-cell" data-idx="' + i + '">' +
          (i === 0 ? '<span class="img-cell-main-badge">Main</span>' : '') +
          '<img src="' + escAttr(src) + '" alt="" />' +
          '<div class="img-actions">' +
            (i > 0 ? '<button type="button" data-set-main="' + i + '">Main</button>' : '') +
            '<button type="button" data-move="up" data-idx="' + i + '" aria-label="Move left">←</button>' +
            '<button type="button" data-move="down" data-idx="' + i + '" aria-label="Move right">→</button>' +
            '<button type="button" class="danger" data-remove="' + i + '">×</button>' +
          '</div>' +
        '</div>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('[data-set-main]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-set-main'));
        if (i <= 0 || i >= state.pImages.length) return;
        var item = state.pImages.splice(i, 1)[0];
        state.pImages.unshift(item);
        renderImagesEditor();
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-move]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-idx'));
        var dir = b.getAttribute('data-move');
        if (dir === 'up' && i > 0) {
          var t = state.pImages[i - 1];
          state.pImages[i - 1] = state.pImages[i];
          state.pImages[i] = t;
        } else if (dir === 'down' && i < state.pImages.length - 1) {
          var t2 = state.pImages[i + 1];
          state.pImages[i + 1] = state.pImages[i];
          state.pImages[i] = t2;
        }
        renderImagesEditor();
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-remove]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-remove'));
        var item = state.pImages[i];
        if (item && item.file) { try { URL.revokeObjectURL(item.url); } catch (e) {} }
        state.pImages.splice(i, 1);
        renderImagesEditor();
      });
    });
  }

  async function handleProductImagePick(files){
    var list = Array.prototype.slice.call(files || []);
    var maxSlots = 9 - state.pImages.length;
    if (maxSlots <= 0) { toast('Maximum 9 images reached.', true); return; }

    for (var i = 0; i < list.length && i < maxSlots; i++) {
      var file = list[i];
      if (!file || !/^image\//.test(file.type)) continue;
      try {
        var blob = await compressImage(file, 1400, 0.85);
        var objUrl = URL.createObjectURL(blob);
        state.pImages.push({ url: objUrl, file: blob });
      } catch (e) {
        // Fallback original
        try { state.pImages.push({ url: URL.createObjectURL(file), file: file }); } catch (e2) {}
      }
    }
    renderImagesEditor();
  }

  async function saveProduct(){
    var errEl = el('productFormError');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    var editId = el('pEditId').value;
    var name = (el('pName').value || '').trim();
    var category = (el('pCategory').value || '').trim() || 'Other';
    var price = Number(el('pPrice').value);
    var oldPriceRaw = el('pOldPrice').value;
    var oldPrice = oldPriceRaw === '' ? null : Number(oldPriceRaw);
    var description = (el('pDescription').value || '').trim();
    var isActive = el('pIsActive').checked;
    var isFeatured = el('pIsFeatured').checked;
    var sortOrder = Number(el('pSortOrder').value) || 0;

    if (!name) return showFormError('Please enter a name.');
    if (!price || price < 0) return showFormError('Please enter a valid price.');
    if (oldPrice !== null && oldPrice <= price) {
      // Not fatal but clearer to warn
      oldPrice = null;
    }

    var btn = el('saveProductBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = 'Saving…'; }
    busy(true);

    try {
      // Upload any new images
      var uploadedUrls = [];
      for (var i = 0; i < state.pImages.length; i++) {
        var item = state.pImages[i];
        if (item.file) {
          try {
            var url = await uploadImage('product-images', item.file, 'products');
            uploadedUrls.push(url);
          } catch (e) {
            // Skip failed image, but keep going
          }
        } else if (item.url) {
          uploadedUrls.push(item.url);
        }
      }

      var main = uploadedUrls[0] || '';
      var extras = uploadedUrls.slice(1);

      var payload = {
        name: name,
        category: category,
        price: price,
        old_price: oldPrice,
        sizes: state.pSizes.slice(),
        description: description,
        main_image: main,
        additional_images: extras,
        is_active: isActive,
        is_featured: isFeatured,
        sort_order: sortOrder
      };

      if (editId) {
        var res = await sb.from('products').update(payload).eq('id', Number(editId));
        if (res && res.error) throw res.error;
        toast('Product saved.');
      } else {
        var res2 = await sb.from('products').insert(payload);
        if (res2 && res2.error) throw res2.error;
        toast('Product added.');
      }

      // Cleanup preview URLs
      state.pImages.forEach(function (it) {
        if (it && it.file && it.url) { try { URL.revokeObjectURL(it.url); } catch (e) {} }
      });
      state.pImages = [];

      closeModal('productModal');
      await loadProducts();
      renderProducts();
      refreshCategoryList();
    } catch (e) {
      showFormError((e && e.message) ? e.message : 'Could not save product.');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = 'Save Product'; }
      busy(false);
    }

    function showFormError(msg){
      if (!errEl) { toast(msg, true); return; }
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  /* ==========================================================================
     E. OFFERS
     ========================================================================== */

  async function loadOffers(){
    if (!sb) { state.offers = []; return; }
    try {
      var res = await sb
        .from('offers')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res && res.error) throw res.error;
      state.offers = (res && res.data) || [];
    } catch (e) {
      state.offers = [];
      toast('Could not load messages.', true);
    }
  }

  function typeLabel(t){
    if (t === 'strip') return 'Strip';
    if (t === 'popup') return 'Popup';
    return 'Banner';
  }

  function renderOffers(){
    var wrap = el('offersList');
    if (!wrap) return;

    if (!state.offers.length) {
      wrap.innerHTML = '<p class="loading-line">No messages yet. Click “New Message”.</p>';
      return;
    }

    var html = '';
    state.offers.forEach(function (o) {
      var tags = '';
      tags += '<span class="tag tag-gold">' + esc(typeLabel(o.display_type)) + '</span> ';
      tags += o.is_active ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-red">Hidden</span>';

      var bg = o.bg_image
        ? '<div class="row-thumb" style="background-image:url(' + escAttr(o.bg_image) + ');background-size:cover;background-position:center;"></div>'
        : '<div class="row-thumb" style="background:' + escAttr(o.bg_color || '#14224A') + ';"></div>';

      var schedule = '';
      if (o.starts_at || o.ends_at) {
        schedule = '<p class="row-sub">' +
          (o.starts_at ? 'From ' + esc(formatDate(o.starts_at)) + ' ' : '') +
          (o.ends_at ? '· Until ' + esc(formatDate(o.ends_at)) : '') +
          '</p>';
      }

      html +=
        '<div class="row-item" data-oid="' + escAttr(String(o.id)) + '">' +
          bg +
          '<div class="row-body">' +
            '<p class="row-meta">' + esc(typeLabel(o.display_type)) + '</p>' +
            '<h3 class="row-title">' + esc(o.title || '(no title)') + '</h3>' +
            (o.subtitle ? '<p class="row-sub">' + esc(o.subtitle) + '</p>' : '') +
            '<p class="row-sub">' + tags + '</p>' +
            schedule +
            '<div class="row-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.row-item'), function (row) {
      var oid = Number(row.getAttribute('data-oid'));
      var o = state.offers.find(function (x) { return Number(x.id) === oid; });
      if (!o) return;
      var edit = row.querySelector('[data-act="edit"]');
      var del = row.querySelector('[data-act="delete"]');
      if (edit) edit.addEventListener('click', function () { openOfferEditor(o); });
      if (del) del.addEventListener('click', function () { deleteOffer(o); });
    });
  }

  async function deleteOffer(o){
    var ok = await confirmDialog({
      title: 'Delete message?',
      text: 'This will remove this ' + typeLabel(o.display_type).toLowerCase() + ' from the site.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    try {
      var res = await sb.from('offers').delete().eq('id', o.id);
      if (res && res.error) throw res.error;
      toast('Message deleted.');
      await loadOffers();
      renderOffers();
    } catch (e) {
      toast('Could not delete message.', true);
    }
  }

  function openOfferEditor(o){
    var isEdit = !!o;
    var title = el('offerModalTitle');
    if (title) title.textContent = isEdit ? 'Edit Message' : 'New Message';

    var idEl = el('oEditId'); if (idEl) idEl.value = isEdit ? String(o.id) : '';
    el('oDisplayType').value = isEdit ? (o.display_type || 'banner') : 'banner';
    el('oTextAlign').value   = isEdit ? (o.text_align || 'center') : 'center';
    el('oTitle').value       = isEdit ? (o.title || '') : '';
    el('oSubtitle').value    = isEdit ? (o.subtitle || '') : '';
    el('oButtonText').value  = isEdit ? (o.button_text || '') : '';
    el('oButtonLink').value  = isEdit ? (o.button_link || '') : '';
    el('oBgColor').value     = isEdit ? (o.bg_color || '#14224A') : '#14224A';
    el('oBgColor2').value    = isEdit ? (o.bg_color_2 || '#1D2E5C') : '#1D2E5C';
    el('oTextColor').value   = isEdit ? (o.text_color || '#FFFFFF') : '#FFFFFF';
    el('oButtonBg').value    = isEdit ? (o.button_bg || '#C9A24A') : '#C9A24A';
    el('oButtonTextColor').value = isEdit ? (o.button_text_color || '#14224A') : '#14224A';
    el('oSortOrder').value   = isEdit ? String(o.sort_order || 0) : '0';
    el('oStartsAt').value    = isEdit ? toLocalInput(o.starts_at) : '';
    el('oEndsAt').value      = isEdit ? toLocalInput(o.ends_at) : '';
    el('oIsActive').checked  = isEdit ? o.is_active !== false : true;

    // Background image
    state.oBgFile = null;
    state.oBgUrl = isEdit ? (o.bg_image || '') : '';
    renderOfferBgImage();

    var err = el('offerFormError');
    if (err) { err.hidden = true; err.textContent = ''; }

    renderOfferPreview();
    openModal('offerModal');
  }

  function renderOfferBgImage(){
    var wrap = el('oBgImageWrap');
    if (!wrap) return;
    if (state.oBgUrl) {
      wrap.innerHTML = '<img src="' + escAttr(state.oBgUrl) + '" alt="Background preview" />' +
                       '<p style="margin-top:8px;"><button type="button" class="btn btn-ghost btn-sm" id="oBgRemoveBtn">Remove image</button></p>';
      var rb = el('oBgRemoveBtn');
      if (rb) rb.addEventListener('click', function () {
        if (state.oBgFile && state.oBgUrl) { try { URL.revokeObjectURL(state.oBgUrl); } catch (e) {} }
        state.oBgFile = null;
        state.oBgUrl = '';
        renderOfferBgImage();
        renderOfferPreview();
      });
    } else {
      wrap.innerHTML = '<p>No background image — colours will be used.</p>';
    }
  }

  function offerPreviewStyle(){
    var type = el('oDisplayType').value;
    var bgImg = state.oBgUrl;
    var bg1 = el('oBgColor').value || '#14224A';
    var bg2 = el('oBgColor2').value || '';
    var text = el('oTextColor').value || '#FFFFFF';

    var s = '';
    if (bgImg) {
      s += 'background-image:linear-gradient(rgba(10,16,34,.18),rgba(10,16,34,.28)),url(' +
           '&quot;' + escAttr(bgImg) + '&quot;);';
    } else if (bg2) {
      s += 'background-image:linear-gradient(135deg,' + escAttr(bg1) + ' 0%,' + escAttr(bg2) + ' 100%);';
    } else {
      s += 'background-color:' + escAttr(bg1) + ';';
    }
    s += 'color:' + escAttr(text) + ';';
    return s;
  }

  function renderOfferPreview(){
    var wrap = el('oPreview');
    if (!wrap) return;

    var type = el('oDisplayType').value;
    var align = el('oTextAlign').value;
    var title = el('oTitle').value;
    var sub = el('oSubtitle').value;
    var btnText = el('oButtonText').value;
    var btnBg = el('oButtonBg').value;
    var btnTextColor = el('oButtonTextColor').value;
    var styleAttr = offerPreviewStyle();

    var btnHtml = btnText
      ? '<span class="preview-banner-btn" style="background:' + escAttr(btnBg) + ';color:' + escAttr(btnTextColor) + ';">' + esc(btnText) + '</span>'
      : '';

    if (type === 'strip') {
      wrap.innerHTML =
        '<div class="preview-strip" style="' + styleAttr + '">' +
          (title ? '<span>' + esc(title) + '</span>' : '<span style="opacity:.7;">(No text)</span>') +
          (btnText && btnText !== '' ? ' <span style="text-decoration:underline;">' + esc(btnText) + '</span>' : '') +
          '<span class="preview-strip-close">×</span>' +
        '</div>';
    } else if (type === 'popup') {
      wrap.innerHTML =
        '<div class="preview-popup">' +
          '<div class="preview-popup-card align-' + align + '" style="' + styleAttr + '">' +
            '<span class="preview-popup-close">×</span>' +
            (title ? '<h3 class="preview-popup-title">' + esc(title) + '</h3>' : '') +
            (sub ? '<p class="preview-popup-sub">' + esc(sub) + '</p>' : '') +
            (btnText
              ? '<span class="preview-popup-btn" style="background:' + escAttr(btnBg) + ';color:' + escAttr(btnTextColor) + ';">' + esc(btnText) + '</span>'
              : '') +
          '</div>' +
        '</div>';
    } else {
      wrap.innerHTML =
        '<div class="preview-banner align-' + align + '" style="' + styleAttr + '">' +
          '<div class="preview-banner-inner">' +
            (title ? '<h3 class="preview-banner-title">' + esc(title) + '</h3>' : '') +
            (sub ? '<p class="preview-banner-sub">' + esc(sub) + '</p>' : '') +
            btnHtml +
          '</div>' +
        '</div>';
    }
  }

  async function saveOffer(){
    var errEl = el('offerFormError');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    var editId = el('oEditId').value;
    var displayType = el('oDisplayType').value;
    var title = (el('oTitle').value || '').trim();

    if (!title) return showFormError('Please enter some text for the message.');

    var btn = el('saveOfferBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = 'Saving…'; }
    busy(true);

    try {
      var bgUrl = state.oBgUrl || '';
      if (state.oBgFile) {
        try {
          bgUrl = await uploadImage('offer-images', state.oBgFile, 'offers');
        } catch (e) {
          throw new Error('Could not upload background image.');
        }
      }

      var payload = {
        display_type: displayType,
        title: title,
        subtitle: (el('oSubtitle').value || '').trim() || null,
        button_text: (el('oButtonText').value || '').trim() || null,
        button_link: (el('oButtonLink').value || '').trim() || null,
        bg_color: el('oBgColor').value || '#14224A',
        bg_color_2: el('oBgColor2').value || null,
        bg_image: bgUrl || null,
        text_color: el('oTextColor').value || '#FFFFFF',
        button_bg: el('oButtonBg').value || '#C9A24A',
        button_text_color: el('oButtonTextColor').value || '#14224A',
        text_align: el('oTextAlign').value || 'center',
        is_active: el('oIsActive').checked,
        starts_at: fromLocalInput(el('oStartsAt').value),
        ends_at: fromLocalInput(el('oEndsAt').value),
        sort_order: Number(el('oSortOrder').value) || 0
      };

      if (editId) {
        var res = await sb.from('offers').update(payload).eq('id', Number(editId));
        if (res && res.error) throw res.error;
        toast('Message saved.');
      } else {
        var res2 = await sb.from('offers').insert(payload);
        if (res2 && res2.error) throw res2.error;
        toast('Message added.');
      }

      if (state.oBgFile && state.oBgUrl) { try { URL.revokeObjectURL(state.oBgUrl); } catch (e) {} }
      state.oBgFile = null;
      state.oBgUrl = '';

      closeModal('offerModal');
      await loadOffers();
      renderOffers();
    } catch (e) {
      showFormError((e && e.message) ? e.message : 'Could not save message.');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = 'Save Message'; }
      busy(false);
    }

    function showFormError(msg){
      if (!errEl) { toast(msg, true); return; }
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  /* ==========================================================================
     F. REVIEWS
     ========================================================================== */

  async function loadReviews(){
    if (!sb) { state.reviews = []; return; }
    try {
      var res = await sb
        .from('reviews')
        .select('id,product_id,user_id,user_name,user_avatar,rating,title,comment,images,approved,created_at')
        .order('created_at', { ascending: false });
      if (res && res.error) throw res.error;
      state.reviews = (res && res.data) || [];
    } catch (e) {
      state.reviews = [];
      toast('Could not load reviews.', true);
    }
  }

  function productNameById(pid){
    var p = state.products.find(function (x) { return Number(x.id) === Number(pid); });
    return p ? p.name : ('Product #' + pid);
  }

  function renderReviews(){
    var wrap = el('reviewsList');
    if (!wrap) return;

    var filter = state.reviewFilter;
    var list = state.reviews.filter(function (r) {
      if (filter === 'pending') return r.approved === false;
      if (filter === 'approved') return r.approved === true;
      return true;
    });

    if (!list.length) {
      wrap.innerHTML = '<p class="loading-line">No reviews in this view.</p>';
      return;
    }

    var html = '';
    list.forEach(function (r) {
      var name = r.user_name || 'Viona Customer';
      var initial = String(name).trim().charAt(0).toUpperCase() || 'V';
      var avatar = r.user_avatar
        ? '<img class="row-thumb" src="' + escAttr(r.user_avatar) + '" alt="" />'
        : '<div class="row-thumb-ph">' + esc(initial) + '</div>';

      var photos = '';
      if (Array.isArray(r.images) && r.images.length) {
        photos = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
        r.images.forEach(function (u) {
          photos += '<img src="' + escAttr(u) + '" alt="" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line);" />';
        });
        photos += '</div>';
      }

      var statusTag = r.approved
        ? '<span class="tag tag-green">Approved</span>'
        : '<span class="tag tag-gold">Pending</span>';

      var actions = '';
      if (!r.approved) {
        actions += '<button type="button" class="btn btn-gold btn-sm" data-act="approve">Approve</button>';
      } else {
        actions += '<button type="button" class="btn btn-ghost btn-sm" data-act="reject">Unapprove</button>';
      }
      actions += '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>';

      html +=
        '<div class="row-item" data-rid="' + escAttr(String(r.id)) + '">' +
          avatar +
          '<div class="row-body">' +
            '<p class="row-meta">' + esc(productNameById(r.product_id)) + '</p>' +
            '<h3 class="row-title">' + esc(name) + '</h3>' +
            '<p class="row-sub"><span class="stars">' + starsHtml(r.rating) + '</span> · ' + esc(formatDate(r.created_at)) + '</p>' +
            (r.title ? '<p class="row-sub"><strong>' + esc(r.title) + '</strong></p>' : '') +
            '<p class="row-sub" style="white-space:pre-wrap;">' + esc(r.comment || '') + '</p>' +
            photos +
            '<p style="margin:8px 0 0;">' + statusTag + '</p>' +
            '<div class="row-actions">' + actions + '</div>' +
          '</div>' +
        '</div>';
    });

    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.row-item'), function (row) {
      var rid = Number(row.getAttribute('data-rid'));
      var r = state.reviews.find(function (x) { return Number(x.id) === rid; });
      if (!r) return;
      var app = row.querySelector('[data-act="approve"]');
      var rej = row.querySelector('[data-act="reject"]');
      var del = row.querySelector('[data-act="delete"]');
      if (app) app.addEventListener('click', function () { setReviewApproved(r, true); });
      if (rej) rej.addEventListener('click', function () { setReviewApproved(r, false); });
      if (del) del.addEventListener('click', function () { deleteReview(r); });
    });
  }

  async function setReviewApproved(r, val){
    try {
      var res = await sb.from('reviews').update({ approved: val }).eq('id', r.id);
      if (res && res.error) throw res.error;
      r.approved = val;
      renderReviews();
      toast(val ? 'Review approved.' : 'Review set to pending.');
    } catch (e) {
      toast('Could not update review.', true);
    }
  }

  async function deleteReview(r){
    var ok = await confirmDialog({
      title: 'Delete review?',
      text: 'This review will be removed permanently.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    try {
      var res = await sb.from('reviews').delete().eq('id', r.id);
      if (res && res.error) throw res.error;
      toast('Review deleted.');
      await loadReviews();
      renderReviews();
    } catch (e) {
      toast('Could not delete review.', true);
    }
  }

  function setupReviewFilters(){
    var buttons = document.querySelectorAll('.filter-btn[data-filter]');
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(buttons, function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        state.reviewFilter = b.getAttribute('data-filter') || 'pending';
        renderReviews();
      });
    });
  }

  /* ==========================================================================
     G. SITE SETTINGS
     ========================================================================== */

  function readSettingsFromForm(){
    return {
      business: {
        business_name: (el('setBusinessName').value || '').trim(),
        whatsapp:      (el('setWhatsapp').value || '').trim(),
        email:         (el('setEmail').value || '').trim(),
        phone:         (el('setPhone').value || '').trim(),
        city:          (el('setCity').value || '').trim(),
        hours:         (el('setHours').value || '').trim()
      },
      hero: {
        label:   (el('setHeroLabel').value || '').trim(),
        heading: (el('setHeroHeading').value || '').trim(),
        text:    (el('setHeroText').value || '').trim()
      },
      about: {
        heading: (el('setAboutHeading').value || '').trim(),
        text:    (el('setAboutText').value || '').trim()
      },
      policies: {
        delivery: (el('setDelivery').value || '').trim(),
        payment:  (el('setPayment').value || '').trim(),
        returns:  (el('setReturns').value || '').trim()
      },
      trust: {
        points: [
          (el('setTrust1').value || '').trim(),
          (el('setTrust2').value || '').trim(),
          (el('setTrust3').value || '').trim()
        ].filter(function (x) { return !!x; })
      },
      social: {
        instagram: (el('setInstagram').value || '').trim(),
        facebook:  (el('setFacebook').value || '').trim(),
        youtube:   (el('setYoutube').value || '').trim()
      }
    };
  }

  function writeSettingsToForm(s){
    s = s || {};
    var b = s.business || {}, h = s.hero || {}, a = s.about || {},
        p = s.policies || {}, t = s.trust || {}, so = s.social || {};

    el('setBusinessName').value = b.business_name || '';
    el('setWhatsapp').value     = b.whatsapp || '';
    el('setEmail').value        = b.email || '';
    el('setPhone').value        = b.phone || '';
    el('setCity').value         = b.city || '';
    el('setHours').value        = b.hours || '';

    el('setHeroLabel').value    = h.label || '';
    el('setHeroHeading').value  = h.heading || '';
    el('setHeroText').value     = h.text || '';

    el('setAboutHeading').value = a.heading || '';
    el('setAboutText').value    = a.text || '';

    el('setDelivery').value     = p.delivery || '';
    el('setPayment').value      = p.payment || '';
    el('setReturns').value      = p.returns || '';

    var pts = Array.isArray(t.points) ? t.points : [];
    el('setTrust1').value = pts[0] || '';
    el('setTrust2').value = pts[1] || '';
    el('setTrust3').value = pts[2] || '';

    el('setInstagram').value = so.instagram || '';
    el('setFacebook').value  = so.facebook || '';
    el('setYoutube').value   = so.youtube || '';
  }

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
        delivery: '', payment: '', returns: ''
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

    if (!sb) { state.settings = merged; writeSettingsToForm(merged); return; }

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
      // keep defaults
    }

    state.settings = merged;
    writeSettingsToForm(merged);
  }

  async function saveSettings(){
    var btn = el('saveSettingsBtn');
    var btn2 = el('saveSettingsBtn2');
    var disable = function () {
      if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = 'Saving…'; }
      if (btn2) { btn2.disabled = true; btn2.classList.add('is-loading'); btn2.textContent = 'Saving…'; }
    };
    var enable = function () {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = 'Save Settings'; }
      if (btn2) { btn2.disabled = false; btn2.classList.remove('is-loading'); btn2.textContent = 'Save Settings'; }
    };

    disable();
    busy(true);
    try {
      var data = readSettingsFromForm();
      var keys = Object.keys(data);
      var rows = keys.map(function (k) { return { key: k, value: data[k] }; });
      var res = await sb.from('site_settings').upsert(rows, { onConflict: 'key' });
      if (res && res.error) throw res.error;
      state.settings = data;
      toast('Settings saved.');
    } catch (e) {
      toast('Could not save settings.', true);
    } finally {
      enable();
      busy(false);
    }
  }

  /* ==========================================================================
     H. FAQ
     ========================================================================== */

  async function loadFaqs(){
    if (!sb) { state.faqs = []; return; }
    try {
      var res = await sb
        .from('faqs')
        .select('id,question,answer,sort_order,is_active')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (res && res.error) throw res.error;
      state.faqs = (res && res.data) || [];
    } catch (e) {
      state.faqs = [];
      toast('Could not load FAQs.', true);
    }
  }

  function renderFaqs(){
    var wrap = el('faqList');
    if (!wrap) return;

    if (!state.faqs.length) {
      wrap.innerHTML = '<p class="loading-line">No questions yet. Click “New Question”.</p>';
      return;
    }

    var html = '';
    state.faqs.forEach(function (f, i) {
      var tag = f.is_active
        ? '<span class="tag tag-green">Visible</span>'
        : '<span class="tag tag-red">Hidden</span>';

      html +=
        '<div class="row-item" data-fid="' + escAttr(String(f.id)) + '">' +
          '<div class="row-thumb-ph">' + esc(String(i + 1)) + '</div>' +
          '<div class="row-body">' +
            '<h3 class="row-title">' + esc(f.question || '') + '</h3>' +
            '<p class="row-sub" style="white-space:pre-wrap;">' + esc(f.answer || '') + '</p>' +
            '<p class="row-sub">' + tag + ' · Sort: ' + esc(String(f.sort_order || 0)) + '</p>' +
            '<div class="row-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="up" aria-label="Move up">↑ Up</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="down" aria-label="Move down">↓ Down</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll('.row-item'), function (row) {
      var fid = Number(row.getAttribute('data-fid'));
      var f = state.faqs.find(function (x) { return Number(x.id) === fid; });
      if (!f) return;
      var edit = row.querySelector('[data-act="edit"]');
      var up = row.querySelector('[data-act="up"]');
      var down = row.querySelector('[data-act="down"]');
      var del = row.querySelector('[data-act="delete"]');
      if (edit) edit.addEventListener('click', function () { openFaqEditor(f); });
      if (up) up.addEventListener('click', function () { moveFaq(f, -1); });
      if (down) down.addEventListener('click', function () { moveFaq(f, 1); });
      if (del) del.addEventListener('click', function () { deleteFaq(f); });
    });
  }

  function openFaqEditor(f){
    var isEdit = !!f;
    var title = el('faqModalTitle');
    if (title) title.textContent = isEdit ? 'Edit Question' : 'New Question';

    var idEl = el('fEditId'); if (idEl) idEl.value = isEdit ? String(f.id) : '';
    el('fQuestion').value = isEdit ? (f.question || '') : '';
    el('fAnswer').value   = isEdit ? (f.answer || '') : '';
    el('fSortOrder').value = isEdit ? String(f.sort_order || 0) : String(state.faqs.length + 1);
    el('fIsActive').checked = isEdit ? f.is_active !== false : true;

    var err = el('faqFormError');
    if (err) { err.hidden = true; err.textContent = ''; }

    openModal('faqModal');
  }

  async function saveFaq(){
    var errEl = el('faqFormError');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    var editId = el('fEditId').value;
    var question = (el('fQuestion').value || '').trim();
    var answer = (el('fAnswer').value || '').trim();
    var sortOrder = Number(el('fSortOrder').value) || 0;
    var isActive = el('fIsActive').checked;

    if (!question) return showFormError('Please enter a question.');
    if (!answer) return showFormError('Please enter an answer.');

    var btn = el('saveFaqBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); btn.textContent = 'Saving…'; }
    busy(true);

    try {
      var payload = {
        question: question,
        answer: answer,
        sort_order: sortOrder,
        is_active: isActive
      };
      if (editId) {
        var res = await sb.from('faqs').update(payload).eq('id', Number(editId));
        if (res && res.error) throw res.error;
        toast('Question saved.');
      } else {
        var res2 = await sb.from('faqs').insert(payload);
        if (res2 && res2.error) throw res2.error;
        toast('Question added.');
      }
      closeModal('faqModal');
      await loadFaqs();
      renderFaqs();
    } catch (e) {
      showFormError((e && e.message) ? e.message : 'Could not save question.');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.textContent = 'Save Question'; }
      busy(false);
    }

    function showFormError(msg){
      if (!errEl) { toast(msg, true); return; }
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  async function deleteFaq(f){
    var ok = await confirmDialog({
      title: 'Delete question?',
      text: 'This question will be removed from the site.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    try {
      var res = await sb.from('faqs').delete().eq('id', f.id);
      if (res && res.error) throw res.error;
      toast('Question deleted.');
      await loadFaqs();
      renderFaqs();
    } catch (e) {
      toast('Could not delete question.', true);
    }
  }

  async function moveFaq(f, dir){
    var idx = state.faqs.findIndex(function (x) { return Number(x.id) === Number(f.id); });
    if (idx === -1) return;
    var swap = idx + dir;
    if (swap < 0 || swap >= state.faqs.length) return;

    // Swap sort_order values, then save both
    var a = state.faqs[idx];
    var b = state.faqs[swap];
    var ao = Number(a.sort_order) || 0;
    var bo = Number(b.sort_order) || 0;

    // If both same, force difference
    if (ao === bo) {
      bo = ao + 1;
      b.sort_order = bo;
    }

    try {
      busy(true);
      var r1 = await sb.from('faqs').update({ sort_order: bo }).eq('id', a.id);
      if (r1 && r1.error) throw r1.error;
      var r2 = await sb.from('faqs').update({ sort_order: ao }).eq('id', b.id);
      if (r2 && r2.error) throw r2.error;
      await loadFaqs();
      renderFaqs();
    } catch (e) {
      toast('Could not reorder.', true);
    } finally {
      busy(false);
    }
  }

  /* ==========================================================================
     I. TABS + BOOT
     ========================================================================== */

  function switchTab(name){
    // Buttons
    var all = document.querySelectorAll('.tab-btn');
    Array.prototype.forEach.call(all, function (b) {
      if (b.getAttribute('data-tab') === name) b.classList.add('is-active');
      else b.classList.remove('is-active');
    });
    // Panels
    var panels = document.querySelectorAll('.tab-panel');
    Array.prototype.forEach.call(panels, function (p) {
      if (p.id === 'panel-' + name) p.classList.add('is-active');
      else p.classList.remove('is-active');
    });
    // Scroll main to top
    var main = document.querySelector('.main');
    if (main && main.scrollTo) {
      try { main.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
  }

  function setupTabs(){
    var all = document.querySelectorAll('.tab-btn');
    Array.prototype.forEach.call(all, function (b) {
      b.addEventListener('click', function () {
        var name = b.getAttribute('data-tab');
        if (name) switchTab(name);
      });
    });
  }

  function setupModals(){
    // Any element with data-close closes the matching modal
    var closers = document.querySelectorAll('[data-close]');
    Array.prototype.forEach.call(closers, function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-close');
        if (id) closeModal(id);
      });
    });

    // Confirm dialog buttons
    var yes = el('confirmYes');
    var no = el('confirmNo');
    if (yes) yes.addEventListener('click', function () { resolveConfirm(true); });
    if (no) no.addEventListener('click', function () { resolveConfirm(false); });

    // Escape closes topmost visible modal
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var ids = ['confirmModal','faqModal','offerModal','productModal'];
      for (var i = 0; i < ids.length; i++) {
        var m = el(ids[i]);
        if (m && !m.hidden) {
          if (ids[i] === 'confirmModal') resolveConfirm(false);
          else closeModal(ids[i]);
          return;
        }
      }
    });
  }

  function setupProductEditor(){
    var addSizeBtn = el('pAddSizeBtn');
    var newSizeInput = el('pNewSize');
    if (addSizeBtn && newSizeInput) {
      addSizeBtn.addEventListener('click', function () {
        var v = (newSizeInput.value || '').trim();
        if (!v) return;
        if (state.pSizes.indexOf(v) === -1) state.pSizes.push(v);
        newSizeInput.value = '';
        renderSizesEditor();
      });
      newSizeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addSizeBtn.click(); }
      });
    }

    var imageInput = el('pImageInput');
    var addImageBtn = el('pAddImageBtn');
    if (imageInput && addImageBtn) {
      addImageBtn.addEventListener('click', function () { imageInput.click(); });
      imageInput.addEventListener('change', function () {
        handleProductImagePick(imageInput.files);
        imageInput.value = '';
      });
    }

    var saveBtn = el('saveProductBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveProduct);

    var newBtn = el('newProductBtn');
    if (newBtn) newBtn.addEventListener('click', function () { openProductEditor(null); });
  }

  function setupOfferEditor(){
    var bgInput = el('oBgInput');
    var bgBtn = el('oBgBtn');
    if (bgInput && bgBtn) {
      bgBtn.addEventListener('click', function () { bgInput.click(); });
      bgInput.addEventListener('change', async function () {
        var file = bgInput.files && bgInput.files[0];
        bgInput.value = '';
        if (!file) return;
        try {
          var blob = await compressImage(file, 1400, 0.85);
          if (state.oBgUrl && state.oBgFile) { try { URL.revokeObjectURL(state.oBgUrl); } catch (e) {} }
          state.oBgFile = blob;
          state.oBgUrl = URL.createObjectURL(blob);
          renderOfferBgImage();
          renderOfferPreview();
        } catch (e) {
          toast('Could not read image.', true);
        }
      });
    }

    var inputs = ['oDisplayType','oTextAlign','oTitle','oSubtitle','oButtonText','oButtonLink',
                  'oBgColor','oBgColor2','oTextColor','oButtonBg','oButtonTextColor'];
    inputs.forEach(function (id) {
      var n = el(id);
      if (!n) return;
      var evt = (n.tagName === 'SELECT' || n.type === 'color') ? 'change' : 'input';
      n.addEventListener(evt, renderOfferPreview);
    });

    var saveBtn = el('saveOfferBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveOffer);

    var newBtn = el('newOfferBtn');
    if (newBtn) newBtn.addEventListener('click', function () { openOfferEditor(null); });
  }

  function setupFaqEditor(){
    var saveBtn = el('saveFaqBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveFaq);

    var newBtn = el('newFaqBtn');
    if (newBtn) newBtn.addEventListener('click', function () { openFaqEditor(null); });
  }

  function setupSettings(){
    var b1 = el('saveSettingsBtn');
    var b2 = el('saveSettingsBtn2');
    if (b1) b1.addEventListener('click', saveSettings);
    if (b2) b2.addEventListener('click', saveSettings);
  }

  function setupAuthButtons(){
    var loginBtn = el('loginGoogleBtn');
    if (loginBtn) loginBtn.addEventListener('click', signInWithGoogle);

    var s1 = el('signOutBtn');       if (s1) s1.addEventListener('click', signOut);
    var s2 = el('mobileSignOut');    if (s2) s2.addEventListener('click', signOut);
    var s3 = el('deniedSignOut');    if (s3) s3.addEventListener('click', signOut);
  }

  async function loadAll(){
    // Products
    await loadProducts();
    refreshCategoryList();
    renderProducts();
    // Offers
    await loadOffers();
    renderOffers();
    // Reviews
    await loadReviews();
    renderReviews();
    // Settings
    await loadSettings();
    // FAQ
    await loadFaqs();
    renderFaqs();
  }

  async function init(){
    // Wire up all UI even before auth is decided
    setupTabs();
    setupModals();
    setupProductEditor();
    setupOfferEditor();
    setupFaqEditor();
    setupSettings();
    setupReviewFilters();
    setupAuthButtons();

    // Auth flow
    await bootAuth();

    // Keep session synced if the user signs in/out in another tab
    if (sb) {
      sb.auth.onAuthStateChange(function (_event, session) {
        // Simple refresh: reload state
        var user = session && session.user ? session.user : null;
        // Only react when the state truly changed
        var prev = state.user ? state.user.id : null;
        var next = user ? user.id : null;
        if (prev !== next) {
          state.user = user;
          if (user) {
            checkAdmin().then(function (ok) {
              state.isAdmin = ok;
              if (ok) { applyUser(); showApp(); loadAll(); }
              else { showDenied(user.email || ''); }
            });
          } else {
            state.isAdmin = false;
            showLogin();
          }
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init().catch(function () { /* never crash */ });
    });
  } else {
    init().catch(function () { /* never crash */ });
  }

})();
