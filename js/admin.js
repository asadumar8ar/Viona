/* ==========================================================================
   Viona Bangles — Admin Panel logic
   Plain vanilla JS. Requires: supabase-js v2, js/config.js (window.VIONA_CONFIG)
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     0. CONFIG VALIDATION
     ------------------------------------------------------------------ */
  var CONFIG_MSG = "Supabase is not configured. Add your Project URL and anon key in js/config.js";

  function getConfig() {
    return (typeof window !== "undefined" && window.VIONA_CONFIG) ? window.VIONA_CONFIG : null;
  }

  function isConfigValid(cfg) {
    if (!cfg || typeof cfg !== "object") return false;
    var url = cfg.SUPABASE_URL;
    var key = cfg.SUPABASE_ANON_KEY;
    if (typeof url !== "string" || typeof key !== "string") return false;
    if (url.indexOf("https://") !== 0) return false;
    if (url.indexOf("supabase.co") === -1) return false;
    if (key.length <= 20) return false;
    if (url.indexOf("PASTE") !== -1 || key.indexOf("PASTE") !== -1) return false;
    return true;
  }

  /* ------------------------------------------------------------------
     1. STATE
     ------------------------------------------------------------------ */
  var state = {
    supabase: null,
    user: null,
    isAdmin: false,
    adminEmail: "",
    products: [],
    productsLoaded: false,
    productFilters: { search: "", category: "", status: "" },
    editingSizes: [],          // sizes for the currently-open product modal
    editingProductId: null,
    settingsLoaded: false,
    settingsMap: {},           // key -> input element id
    currentTab: "products"
  };

  /* ------------------------------------------------------------------
     2. DOM HELPERS
     ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return "₹0";
    return "₹" + num.toLocaleString("en-IN");
  }

  /* ------------------------------------------------------------------
     3. TOAST / BUSY / CONFIRM
     ------------------------------------------------------------------ */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast" + (kind === "error" ? " is-error" : " is-success");
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  var busyDepth = 0;
  function busy(on) {
    var el = $("busy");
    if (!el) return;
    if (on) busyDepth++; else busyDepth = Math.max(0, busyDepth - 1);
    el.hidden = busyDepth === 0 ? true : false;
  }

  var confirmResolver = null;
  function askConfirm(title, text, confirmLabel) {
    return new Promise(function (resolve) {
      var titleEl = $("confirmTitle");
      var textEl = $("confirmText");
      var yesEl = $("confirmYes");
      if (titleEl) titleEl.textContent = title || "Are you sure?";
      if (textEl) textEl.textContent = text || "This cannot be undone.";
      if (yesEl) yesEl.textContent = confirmLabel || "Delete";
      show($("confirmModal"));
      confirmResolver = resolve;
    });
  }
  function closeConfirm(result) {
    hide($("confirmModal"));
    if (confirmResolver) {
      var r = confirmResolver;
      confirmResolver = null;
      r(result);
    }
  }

  /* ------------------------------------------------------------------
     4. MODAL OPEN/CLOSE (data-close attributes)
     ------------------------------------------------------------------ */
  function openModal(id) {
    var el = $(id);
    if (el) el.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal(id) {
    var el = $(id);
    if (el) el.hidden = true;
    if (!document.querySelector(".modal:not([hidden])")) {
      document.body.style.overflow = "";
    }
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("[data-close]")) {
      closeModal(t.getAttribute("data-close"));
    }
  });
  // Backdrop click (element with class modal-backdrop)
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("modal-backdrop")) {
      var m = t.closest(".modal");
      if (m && m.id) closeModal(m.id);
    }
  });
  // ESC closes topmost modal
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var open = document.querySelector(".modal:not([hidden])");
      if (open && open.id) closeModal(open.id);
    }
  });

  /* ------------------------------------------------------------------
     5. SCREEN SWITCHING
     ------------------------------------------------------------------ */
  function showLogin() {
    hide($("deniedScreen"));
    hide($("app"));
    show($("loginScreen"));
  }
  function showDenied(email) {
    hide($("loginScreen"));
    hide($("app"));
    var el = $("deniedEmail");
    if (el) el.textContent = email ? ("Signed in as: " + email) : "";
    show($("deniedScreen"));
  }
  function showApp() {
    hide($("loginScreen"));
    hide($("deniedScreen"));
    show($("app"));
    var who = $("whoName");
    if (who) who.textContent = state.adminEmail || (state.user && state.user.email) || "—";
  }

  /* ------------------------------------------------------------------
     6. AUTH
     ------------------------------------------------------------------ */
  function getRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  async function signInWithGoogle() {
    if (!state.supabase) return;
    try {
      var res = await state.supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: getRedirectUrl() }
      });
      if (res && res.error) {
        toast(res.error.message || "Sign-in failed", "error");
      }
    } catch (err) {
      toast((err && err.message) || "Sign-in failed", "error");
    }
  }

  async function signOut() {
    try {
      if (state.supabase) await state.supabase.auth.signOut();
    } catch (e) { /* ignore */ }
    state.user = null;
    state.isAdmin = false;
    state.adminEmail = "";
    state.products = [];
    state.productsLoaded = false;
    showLogin();
  }

  async function isAdminEmail(email) {
    if (!email || !state.supabase) return false;
    var lower = String(email).toLowerCase();
    try {
      var res = await state.supabase
        .from("admins")
        .select("email")
        .eq("email", lower)
        .limit(1);
      if (res.error) {
        // If RLS blocks us, the response may be empty; if there is a real error
        // we treat as non-admin and log for debugging.
        console.warn("admin check error:", res.error.message);
        return false;
      }
      return Array.isArray(res.data) && res.data.length > 0;
    } catch (e) {
      console.warn("admin check exception", e);
      return false;
    }
  }

  async function handleSession(session) {
    if (!session || !session.user) {
      state.user = null;
      state.isAdmin = false;
      showLogin();
      return;
    }
    state.user = session.user;
    var email = (session.user.email || "").toLowerCase();

    // Fast path: verify against admins table
    var ok = await isAdminEmail(email);
    state.isAdmin = ok;
    state.adminEmail = ok ? email : "";

    if (!ok) {
      showDenied(email);
      return;
    }
    showApp();
    ensureProductsLoaded();
    loadSettingsIfNeeded();
  }

  /* ------------------------------------------------------------------
     7. TABS
     ------------------------------------------------------------------ */
  function setTab(name) {
    state.currentTab = name;
    $$(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
    });
    ["products", "offers", "reviews", "settings", "faq"].forEach(function (t) {
      var panel = $("panel-" + t);
      if (panel) panel.classList.toggle("is-active", t === name);
    });
    if (name === "products") ensureProductsLoaded();
    if (name === "settings") loadSettingsIfNeeded();
  }

  function wireTabs() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t) return;
      var btn = t.closest ? t.closest(".tab-btn") : null;
      if (!btn) return;
      var name = btn.getAttribute("data-tab");
      if (name) setTab(name);
    });
  }

  /* ------------------------------------------------------------------
     8. PRODUCTS — LOAD & RENDER
     ------------------------------------------------------------------ */
  async function ensureProductsLoaded(force) {
    if (state.productsLoaded && !force) return;
    await loadProducts();
  }

  async function loadProducts() {
    if (!state.supabase) return;
    var list = $("productsList");
    if (list) list.innerHTML = '<p class="loading-line">Loading products…</p>';
    try {
      var res = await state.supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      if (res.error) {
        if (list) list.innerHTML = '<p class="loading-line">Could not load products: ' + escapeHtml(res.error.message) + "</p>";
        return;
      }
      state.products = Array.isArray(res.data) ? res.data : [];
      state.productsLoaded = true;
      renderProducts();
    } catch (e) {
      if (list) list.innerHTML = '<p class="loading-line">Could not load products.</p>';
    }
  }

  function productMatchesFilters(p) {
    var f = state.productFilters;
    if (f.search) {
      var q = f.search.toLowerCase();
      var hay = ((p.name || "") + " " + (p.code || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (f.category && p.category !== f.category) return false;
    if (f.status && p.stock_status !== f.status) return false;
    return true;
  }

  function renderProducts() {
    var list = $("productsList");
    if (!list) return;

    var items = state.products.filter(productMatchesFilters);
    if (items.length === 0) {
      list.innerHTML = '<p class="loading-line">No products yet. Tap “+ New Product” to add one.</p>';
      return;
    }

    var html = items.map(function (p) {
      var img = p.main_image
        ? '<img class="list-item-thumb" src="' + escapeHtml(p.main_image) + '" alt="" onerror="this.style.visibility=\'hidden\'" />'
        : '<div class="list-item-thumb"></div>';

      var badges = "";
      if (p.is_active === false) badges += '<span class="badge badge-inactive">Hidden</span> ';
      else badges += '<span class="badge badge-active">Active</span> ';
      if (p.is_featured) badges += '<span class="badge badge-featured">Featured</span> ';
      if (p.stock_status === "out_of_stock") badges += '<span class="badge badge-warn">Out of stock</span> ';
      if (p.stock_status === "made_to_order") badges += '<span class="badge badge-featured">Made to order</span> ';

      var sizes = Array.isArray(p.sizes) && p.sizes.length
        ? "Sizes: " + p.sizes.join(", ")
        : "No sizes";

      return (
        '<article class="list-item" data-id="' + escapeHtml(p.id) + '">' +
          img +
          '<div class="list-item-body">' +
            '<h3 class="list-item-title">' + escapeHtml(p.name || "Untitled") + "</h3>" +
            '<p class="list-item-meta">' + escapeHtml(p.code || "—") + " · " + escapeHtml(p.category || "uncategorized") + "</p>" +
            '<p class="list-item-meta">' + escapeHtml(sizes) + "</p>" +
            '<p class="list-item-price">' + formatPrice(p.price) + "</p>" +
            '<p class="list-item-meta">' + badges + "</p>" +
          "</div>" +
          '<div class="list-item-actions">' +
            '<button type="button" class="btn btn-ghost" data-action="edit">Edit</button>' +
            '<button type="button" class="btn btn-danger" data-action="delete">Delete</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");

    list.innerHTML = html;
  }

  function wireProductList() {
    var list = $("productsList");
    if (!list) return;
    list.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-action]") : null;
      if (!btn) return;
      var card = btn.closest(".list-item");
      if (!card) return;
      var id = card.getAttribute("data-id");
      var action = btn.getAttribute("data-action");
      if (action === "edit") openProductModal(id);
      else if (action === "delete") deleteProduct(id);
    });
  }

  function wireProductFilters() {
    var search = $("productSearch");
    var cat = $("productFilterCategory");
    var status = $("productFilterStatus");
    if (search) search.addEventListener("input", function () {
      state.productFilters.search = search.value.trim();
      renderProducts();
    });
    if (cat) cat.addEventListener("change", function () {
      state.productFilters.category = cat.value;
      renderProducts();
    });
    if (status) status.addEventListener("change", function () {
      state.productFilters.status = status.value;
      renderProducts();
    });
  }

  /* ------------------------------------------------------------------
     9. PRODUCT MODAL — sizes chips
     ------------------------------------------------------------------ */
  function renderSizeChips() {
    var wrap = $("pSizesChips");
    if (!wrap) return;
    if (!state.editingSizes.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = state.editingSizes.map(function (s, idx) {
      return '<span class="chip">' + escapeHtml(s) +
        '<button type="button" aria-label="Remove" data-idx="' + idx + '">×</button></span>';
    }).join("");
  }

  function wireSizeChips() {
    var wrap = $("pSizesChips");
    var input = $("pNewSize");
    var btn = $("pAddSizeBtn");
    if (wrap) {
      wrap.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("button[data-idx]") : null;
        if (!b) return;
        var idx = parseInt(b.getAttribute("data-idx"), 10);
        state.editingSizes.splice(idx, 1);
        renderSizeChips();
      });
    }
    function add() {
      if (!input) return;
      var v = String(input.value || "").trim();
      if (!v) return;
      if (state.editingSizes.indexOf(v) === -1) state.editingSizes.push(v);
      input.value = "";
      renderSizeChips();
      input.focus();
    }
    if (btn) btn.addEventListener("click", add);
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); add(); }
    });
  }

  /* ------------------------------------------------------------------
     10. PRODUCT MODAL — open / save / delete
     ------------------------------------------------------------------ */
  function resetProductForm() {
    ["pName","pCode","pPrice","pDescription","pMainImage","pAdditionalImages","pWhatsapp","pNewSize"].forEach(function (id) {
      var el = $(id); if (el) el.value = "";
    });
    var cat = $("pCategory"); if (cat) cat.value = "";
    var st = $("pStockStatus"); if (st) st.value = "in_stock";
    var act = $("pIsActive"); if (act) act.checked = true;
    var feat = $("pIsFeatured"); if (feat) feat.checked = false;
    var err = $("productFormError"); if (err) { err.textContent = ""; err.hidden = true; }
    state.editingSizes = [];
    renderSizeChips();
  }

  function openProductModal(id) {
    resetProductForm();
    state.editingProductId = id || null;

    var titleEl = $("productModalTitle");
    var subEl = $("productModalSub");

    if (id) {
      var p = state.products.find(function (x) { return String(x.id) === String(id); });
      if (!p) return;
      if (titleEl) titleEl.textContent = "Edit product";
      if (subEl) subEl.textContent = p.code ? ("Editing " + p.code) : "Editing product";
      $("pEditId").value = p.id;
      $("pName").value = p.name || "";
      $("pCode").value = p.code || "";
      $("pCategory").value = p.category || "";
      $("pPrice").value = (p.price == null ? "" : p.price);
      $("pDescription").value = p.description || "";
      $("pMainImage").value = p.main_image || "";
      $("pAdditionalImages").value = Array.isArray(p.additional_images) ? p.additional_images.join("\n") : "";
      $("pWhatsapp").value = p.whatsapp || "";
      $("pIsActive").checked = p.is_active !== false;
      $("pIsFeatured").checked = !!p.is_featured;
      $("pStockStatus").value = p.stock_status || "in_stock";
      state.editingSizes = Array.isArray(p.sizes) ? p.sizes.slice() : [];
      renderSizeChips();
    } else {
      if (titleEl) titleEl.textContent = "New product";
      if (subEl) subEl.textContent = "Fill in the details below.";
      $("pEditId").value = "";
    }

    openModal("productModal");
    setTimeout(function () { var f = $("pName"); if (f) f.focus(); }, 50);
  }

  function collectProductForm() {
    var name = $("pName").value.trim();
    var category = $("pCategory").value;
    var price = $("pPrice").value;
    if (!name) throw new Error("Name is required.");
    if (!category) throw new Error("Category is required.");
    if (price === "" || isNaN(Number(price))) throw new Error("A valid price is required.");

    var additional = $("pAdditionalImages").value
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });

    return {
      name: name,
      code: ($("pCode").value.trim() || null),
      category: category,
      price: Number(price),
      sizes: state.editingSizes.slice(),
      description: $("pDescription").value.trim() || null,
      main_image: $("pMainImage").value.trim() || null,
      additional_images: additional,
      whatsapp: $("pWhatsapp").value.trim() || null,
      is_active: !!$("pIsActive").checked,
      is_featured: !!$("pIsFeatured").checked,
      stock_status: $("pStockStatus").value || "in_stock"
    };
  }

  function showProductError(msg) {
    var el = $("productFormError");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  async function saveProduct() {
    if (!state.supabase) return;
    var payload;
    try {
      payload = collectProductForm();
    } catch (err) {
      showProductError(err.message);
      return;
    }
    var errEl = $("productFormError"); if (errEl) { errEl.hidden = true; errEl.textContent = ""; }

    busy(true);
    try {
      var id = state.editingProductId;
      if (id) {
        var upd = await state.supabase.from("products").update(payload).eq("id", id);
        if (upd.error) throw upd.error;
        toast("Product updated", "success");
      } else {
        var ins = await state.supabase.from("products").insert(payload).select().single();
        if (ins.error) throw ins.error;
        // Auto-assign code VB-{id} when the code was left blank
        if (!payload.code && ins.data && ins.data.id) {
          var autoCode = "VB-" + String(ins.data.id).padStart(3, "0");
          await state.supabase.from("products").update({ code: autoCode }).eq("id", ins.data.id);
        }
        toast("Product added", "success");
      }
      closeModal("productModal");
      await loadProducts();
    } catch (err) {
      var msg = (err && err.message) ? err.message : "Could not save product.";
      if (msg.indexOf("duplicate") !== -1) msg = "That product code is already in use.";
      showProductError(msg);
    } finally {
      busy(false);
    }
  }

  async function deleteProduct(id) {
    var p = state.products.find(function (x) { return String(x.id) === String(id); });
    var label = p ? (p.name + (p.code ? " (" + p.code + ")" : "")) : "this product";
    var ok = await askConfirm("Delete product?", "Delete “" + label + "”? This cannot be undone.", "Delete");
    if (!ok) return;

    busy(true);
    try {
      var res = await state.supabase.from("products").delete().eq("id", id);
      if (res.error) throw res.error;
      toast("Product deleted", "success");
      await loadProducts();
    } catch (err) {
      toast((err && err.message) || "Could not delete product.", "error");
    } finally {
      busy(false);
    }
  }

  /* ------------------------------------------------------------------
     11. SITE SETTINGS
     ------------------------------------------------------------------ */
  // Map: settings table key -> input element id
  var SETTINGS_KEYS = [
    ["business_name", "setBusinessName"],
    ["whatsapp_number", "setWhatsapp"],
    ["contact_email", "setEmail"],
    ["phone", "setPhone"],
    ["city", "setCity"],
    ["open_hours", "setHours"],
    ["hero_label", "setHeroLabel"],
    ["hero_heading", "setHeroHeading"],
    ["hero_text", "setHeroText"],
    ["about_heading", "setAboutHeading"],
    ["about_text", "setAboutText"],
    ["delivery_text", "setDelivery"],
    ["payment_text", "setPayment"],
    ["return_text", "setReturns"],
    ["trust_1", "setTrust1"],
    ["trust_2", "setTrust2"],
    ["trust_3", "setTrust3"],
    ["instagram_url", "setInstagram"],
    ["facebook_url", "setFacebook"],
    ["youtube_url", "setYoutube"]
  ];

  async function loadSettingsIfNeeded(force) {
    if (state.settingsLoaded && !force) return;
    if (!state.supabase) return;
    busy(true);
    try {
      var res = await state.supabase.from("site_settings").select("key,value");
      if (res.error) {
        // table may not exist yet — fail silently
        state.settingsLoaded = true;
        return;
      }
      var map = {};
      (res.data || []).forEach(function (row) { map[row.key] = row.value; });
      SETTINGS_KEYS.forEach(function (pair) {
        var el = $(pair[1]);
        if (el && map[pair[0]] != null) el.value = map[pair[0]];
      });
      state.settingsLoaded = true;
    } catch (e) {
      state.settingsLoaded = true;
    } finally {
      busy(false);
    }
  }

  async function saveSettings() {
    if (!state.supabase) return;
    var rows = SETTINGS_KEYS.map(function (pair) {
      var el = $(pair[1]);
      return { key: pair[0], value: el ? String(el.value || "") : "" };
    });
    busy(true);
    try {
      var res = await state.supabase
        .from("site_settings")
        .upsert(rows, { onConflict: "key" });
      if (res.error) throw res.error;
      toast("Settings saved", "success");
    } catch (err) {
      toast((err && err.message) || "Could not save settings.", "error");
    } finally {
      busy(false);
    }
  }

  /* ------------------------------------------------------------------
     12. PLACEHOLDERS (offers / reviews / faq)
     ------------------------------------------------------------------ */
  function renderPlaceholderList(containerId, label) {
    var el = $(containerId);
    if (!el) return;
    el.innerHTML = '<p class="loading-line">' + escapeHtml(label) + " are managed in a later step.</p>";
  }

  /* ------------------------------------------------------------------
     13. WIRING
     ------------------------------------------------------------------ */
  function wireUI() {
    // Sign in / out
    var googleBtn = $("loginGoogleBtn");
    if (googleBtn) googleBtn.addEventListener("click", signInWithGoogle);
    var deniedOut = $("deniedSignOut");
    if (deniedOut) deniedOut.addEventListener("click", signOut);
    var signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);
    var mobileSignOut = $("mobileSignOut");
    if (mobileSignOut) mobileSignOut.addEventListener("click", signOut);

    // Tabs
    wireTabs();

    // Products
    var newBtn = $("newProductBtn");
    if (newBtn) newBtn.addEventListener("click", function () { openProductModal(null); });
    var saveBtn = $("saveProductBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveProduct);
    wireProductList();
    wireProductFilters();
    wireSizeChips();

    // Confirm dialog
    var yes = $("confirmYes");
    if (yes) yes.addEventListener("click", function () { closeConfirm(true); });
    var no = $("confirmNo");
    if (no) no.addEventListener("click", function () { closeConfirm(false); });

    // Settings
    var s1 = $("saveSettingsBtn");
    if (s1) s1.addEventListener("click", saveSettings);
    var s2 = $("saveSettingsBtn2");
    if (s2) s2.addEventListener("click", saveSettings);

    // Offers / Reviews / FAQ (placeholders)
    var newOffer = $("newOfferBtn");
    if (newOffer) newOffer.addEventListener("click", function () { toast("Offer editor comes in a later step."); });
    var newFaq = $("newFaqBtn");
    if (newFaq) newFaq.addEventListener("click", function () { toast("FAQ editor comes in a later step."); });

    // Reviews filter chips (visual only in this part)
    $$(".filter-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".filter-btn").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
      });
    });
  }

  /* ------------------------------------------------------------------
     14. BOOT
     ------------------------------------------------------------------ */
  async function boot() {
    var cfg = getConfig();

    // Wire UI no matter what (login button etc.)
    wireUI();

    // Render placeholders
    renderPlaceholderList("offersList", "Offers");
    renderPlaceholderList("reviewsList", "Reviews");
    renderPlaceholderList("faqList", "FAQs");

    // Validate config
    if (!isConfigValid(cfg)) {
      showLogin();
      var warn = $("configWarning");
      if (warn) {
        warn.textContent = CONFIG_MSG;
        warn.hidden = false;
      }
      var googleBtn = $("loginGoogleBtn");
      if (googleBtn) {
        googleBtn.disabled = true;
        googleBtn.style.opacity = "0.55";
        googleBtn.style.cursor = "not-allowed";
      }
      return;
    }

    // Create Supabase client
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showLogin();
      var warn2 = $("configWarning");
      if (warn2) {
        warn2.textContent = "Supabase library failed to load. Check your internet connection and reload.";
        warn2.hidden = false;
      }
      return;
    }

    try {
      state.supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      showLogin();
      var warn3 = $("configWarning");
      if (warn3) { warn3.textContent = "Could not initialise Supabase: " + (e.message || "unknown error"); warn3.hidden = false; }
      return;
    }

    // Auth state listener
    state.supabase.auth.onAuthStateChange(function (event, session) {
      // Defer so we don't deadlock on supabase-js internal awaits
      setTimeout(function () { handleSession(session); }, 0);
    });

    // Initial session check
    try {
      var sess = await state.supabase.auth.getSession();
      await handleSession(sess && sess.data ? sess.data.session : null);
    } catch (e) {
      showLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
