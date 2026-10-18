/* ============================================================================
   Viona Bangles — Admin Panel logic
   ----------------------------------------------------------------------------
   Plain vanilla JS. Loads after:
     - supabase-js v2 (from CDN)
     - js/config.js  (window.VIONA_CONFIG)
     - js/auth.js    (window.VionaAuth — shared auth + Supabase client)

   What this file does:
     - Google sign-in (via VionaAuth / supabase-js) with redirect to admin.html
     - Checks admin status with the SQL helper (is_admin) through VionaAuth.isAdmin()
     - Shows "Access denied" screen for non-admin users, with a logout button
     - Products tab: list, search/filter, add, edit, delete (with confirm)
     - Photo upload to the "product-images" bucket (main + extras, max 5 each)
     - Offers & Settings tab: reads/writes the site_settings key/value table
     - Friendly toast messages, busy overlay, and error handling everywhere

   Recent additions:
     - Original price (MRP) column  -> saved in `old_price`
     - Live "Offer: X% OFF" preview under the price fields
     - Validation: MRP must be > price when filled
     - Stock status column         -> saved in `stock_status`
       (in_stock / low_stock / out_of_stock)
     - Gold "X% OFF" badge + amber "Low stock" / red "Out of stock"
       badges on the product list cards
     - Stock filter in the products toolbar
   ============================================================================ */

(function () {
  "use strict";

  /* --------------------------------------------------------------------
     Constants
     -------------------------------------------------------------------- */
  var BUCKET = "product-images";
  var MAX_FILE_BYTES = 5 * 1024 * 1024;      // 5 MB per file (matches admin.html hint)
  var MAX_IMAGE_WIDTH = 1200;                // px — images are resized before upload
  var JPEG_QUALITY = 0.82;
  var MAX_MORE_PHOTOS = 5;
  var OFFER_TEXT_MAX = 140;

  // Column names used by the SQL script we ran.
  var COL_OLD_PRICE = "old_price";       // original / MRP price
  var COL_STOCK     = "stock_status";    // in_stock | low_stock | out_of_stock

  var STOCK_VALUES = ["in_stock", "low_stock", "out_of_stock"];
  var STOCK_LABELS = {
    in_stock:     "In stock",
    low_stock:    "Low stock (few left)",
    out_of_stock: "Out of stock"
  };

  /* --------------------------------------------------------------------
     State
     -------------------------------------------------------------------- */
  var state = {
    sb: null,
    user: null,
    lastUserId: null,
    adminEmail: "",
    products: [],
    productsLoaded: false,
    loadingProducts: false,
    // stock = "", in_stock, low_stock, out_of_stock
    filters: { search: "", category: "", status: "", stock: "" },
    editingProduct: null,
    mainImage: "",
    additionalImages: [],
    uploadingCount: 0,
    modalSession: null,
    currentTab: "products",
    lastScreen: ""
  };

  /* --------------------------------------------------------------------
     Tiny DOM helpers
     -------------------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function make(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function showEl(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.hidden = false;
  }

  function hideEl(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.hidden = true;
  }

  function friendly(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    return err.message || err.error_description || err.details || "";
  }

  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return "Rs 0";
    try { return "Rs " + num.toLocaleString("en-IN"); }
    catch (e) { return "Rs " + num; }
  }

  // Turn any raw value into one of the three stock constants.
  function normalizeStock(v) {
    if (v == null) return "in_stock";
    var s = String(v).trim().toLowerCase();
    if (STOCK_VALUES.indexOf(s) !== -1) return s;
    return "in_stock";
  }

  // Percentage OFF when MRP > price (rounded). Returns 0 when it isn't valid.
  function offerPct(price, oldPrice) {
    var p = Number(price);
    var o = Number(oldPrice);
    if (!isFinite(p) || !isFinite(o)) return 0;
    if (p <= 0 || o <= p) return 0;
    return Math.round(((o - p) / o) * 100);
  }

  /* --------------------------------------------------------------------
     Toast / Busy / Confirm
     -------------------------------------------------------------------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = $("toast");
    if (!el) return;
    el.textContent = String(msg || "");
    el.className = "toast " + (kind === "error" ? "is-error" : "is-success");
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3400);
  }

  var busyDepth = 0;
  function busy(on) {
    var el = $("busy");
    if (!el) return;
    if (on) busyDepth++;
    else busyDepth = Math.max(0, busyDepth - 1);
    if (busyDepth > 0) showEl(el);
    else hideEl(el);
  }

  var confirmResolve = null;
  function askConfirm(title, text, okLabel) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      var t = $("confirmTitle");
      var m = $("confirmText");
      var y = $("confirmYes");
      if (t) t.textContent = title || "Are you sure?";
      if (m) m.textContent = text || "This cannot be undone.";
      if (y) y.textContent = okLabel || "Delete";
      showEl($("confirmModal"));
    });
  }
  function closeConfirm(result) {
    hideEl($("confirmModal"));
    if (confirmResolve) {
      var r = confirmResolve;
      confirmResolve = null;
      r(!!result);
    }
  }

  /* --------------------------------------------------------------------
     Modal open/close + backdrop + Escape key
     -------------------------------------------------------------------- */
  function openModal(id) {
    var el = $(id);
    if (el) showEl(el);
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    var el = $(id);
    if (el) hideEl(el);
    if (!document.querySelector(".modal:not(.hidden)")) {
      document.body.style.overflow = "";
    }
    if (id === "productModal") onProductModalClosed();
  }

  function wireModals() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var closer = t.closest("[data-close]");
      if (closer) {
        var cid = closer.getAttribute("data-close");
        if (cid === "confirmModal") closeConfirm(false);
        else if (cid) closeModal(cid);
        return;
      }

      if (t.classList && t.classList.contains("modal-backdrop")) {
        var m = t.closest(".modal");
        if (m && m.id) {
          if (m.id === "confirmModal") closeConfirm(false);
          else closeModal(m.id);
        }
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var open = document.querySelector(".modal:not(.hidden)");
      if (!open || !open.id) return;
      if (open.id === "confirmModal") closeConfirm(false);
      else closeModal(open.id);
    });
  }

  /* --------------------------------------------------------------------
     Screens (login / not-admin / app)
     -------------------------------------------------------------------- */
  function showScreen(name) {
    if (state.lastScreen === name) return;
    state.lastScreen = name;

    var login = $("loginScreen");
    var notAdmin = $("notAdminScreen");
    var app = $("app");

    [login, notAdmin, app].forEach(function (el) {
      if (!el) return;
      el.classList.add("hidden");
      el.hidden = true;
    });

    var target = name === "app" ? app
               : name === "notAdmin" ? notAdmin
               : login;
    if (target) {
      target.classList.remove("hidden");
      target.hidden = false;
    }
  }

  function setLoginNote(msg) {
    var el = $("loginNote");
    if (!el) return;
    if (msg) { el.textContent = msg; showEl(el); }
    else { el.textContent = ""; hideEl(el); }
  }

  function showConfigWarning(msg) {
    var el = $("configWarning");
    if (!el) return;
    el.textContent = msg;
    showEl(el);
  }

  function disableLoginButton() {
    var btn = $("loginGoogleBtn");
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = "0.55";
    btn.style.cursor = "not-allowed";
  }

  function setLoginBtnBusy(on) {
    var btn = $("loginGoogleBtn");
    if (!btn) return;
    var span = btn.querySelector("span");
    if (on) {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.cursor = "not-allowed";
      if (span) {
        if (!span.dataset.vaOriginal) span.dataset.vaOriginal = span.textContent;
        span.textContent = "Redirecting…";
      }
    } else {
      btn.disabled = false;
      btn.style.opacity = "";
      btn.style.cursor = "";
      if (span && span.dataset.vaOriginal) {
        span.textContent = span.dataset.vaOriginal;
        delete span.dataset.vaOriginal;
      }
    }
  }

  /* --------------------------------------------------------------------
     Auth (Google sign-in + admin check + logout)
     -------------------------------------------------------------------- */
  function adminRedirectUrl() {
    var base = (window.VIONA_CONFIG && window.VIONA_CONFIG.SITE_URL) ||
               (window.location.origin + "/");
    base = String(base).replace(/\/+$/, "");
    return base + "/admin.html";
  }

  async function onLoginGoogleClick() {
    if (!state.sb) return;
    setLoginNote("");
    setLoginBtnBusy(true);
    try {
      var res = await state.sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: adminRedirectUrl() }
      });
      if (res && res.error) throw res.error;
      // Browser is navigating away — keep the button busy.
    } catch (err) {
      setLoginBtnBusy(false);
      toast(friendly(err) || "Sign-in failed. Please try again.", "error");
    }
  }

  async function onLogoutClick() {
    try {
      if (window.VionaAuth && typeof window.VionaAuth.logout === "function") {
        await window.VionaAuth.logout();
      } else if (state.sb) {
        await state.sb.auth.signOut();
      }
    } catch (e) { /* ignore */ }
  }

  async function handleAuthState(user) {
    state.user = user || null;

    var newUserId = user ? user.id : null;
    if (newUserId !== state.lastUserId) {
      state.lastUserId = newUserId;
      state.productsLoaded = false;
      state.products = [];
    }

    if (!user) {
      state.adminEmail = "";
      setLoginNote("");
      setLoginBtnBusy(false);
      showScreen("login");
      return;
    }

    // Ask the shared auth module to check the is_admin() SQL function.
    var ok = false;
    try { ok = await window.VionaAuth.isAdmin(); } catch (e) { ok = false; }

    if (!ok) {
      state.adminEmail = String(user.email || "");
      var em = $("notAdminEmail");
      if (em) em.textContent = state.adminEmail || "—";
      showScreen("notAdmin");
      return;
    }

    state.adminEmail = String(user.email || "").toLowerCase();
    var emailEl = $("adminEmail");
    if (emailEl) emailEl.textContent = state.adminEmail;

    showScreen("app");

    // Lazily load data for whichever tab is showing.
    if (state.currentTab === "settings") {
      loadSettings();
    } else {
      if (!state.productsLoaded) await loadProducts();
    }
  }

  /* --------------------------------------------------------------------
     Tabs
     -------------------------------------------------------------------- */
  function setTab(name) {
    state.currentTab = name;

    $$(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
    });

    var pp = $("panel-products");
    var ps = $("panel-settings");
    if (pp) hideEl(pp);
    if (ps) hideEl(ps);

    if (name === "settings") {
      if (ps) showEl(ps);
      loadSettings();
    } else {
      if (pp) showEl(pp);
      if (!state.productsLoaded) loadProducts();
    }
  }

  function wireTabs() {
    $$(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-tab");
        if (name) setTab(name);
      });
    });
  }

  /* --------------------------------------------------------------------
     Products: load / stats / filter / render
     -------------------------------------------------------------------- */
  async function loadProducts() {
    if (!state.sb || state.loadingProducts) return;
    state.loadingProducts = true;

    var list = $("productsList");
    if (list) {
      list.textContent = "";
      list.appendChild(make("p", "loading-line", "Loading products…"));
    }

    try {
      // Order by id desc as a safe default (created_at may not always exist).
      var res = await state.sb.from("products").select("*").order("id", { ascending: false });
      if (res.error) throw res.error;

      state.products = Array.isArray(res.data) ? res.data : [];
      state.productsLoaded = true;
      updateStats();
      renderProducts();
    } catch (err) {
      if (list) {
        list.textContent = "";
        list.appendChild(make(
          "p", "loading-line",
          "Could not load products. " + (friendly(err) || "")
        ));
      }
    } finally {
      state.loadingProducts = false;
    }
  }

  function updateStats() {
    var total = state.products.length;
    var active = 0;
    state.products.forEach(function (p) {
      if (p.is_active !== false) active++;
    });
    var hidden = total - active;

    var t = $("statTotal"); if (t) t.textContent = String(total);
    var a = $("statActive"); if (a) a.textContent = String(active);
    var h = $("statHidden"); if (h) h.textContent = String(hidden);
  }

  function matchesFilters(p) {
    var f = state.filters;

    if (f.search) {
      var q = f.search.toLowerCase();
      var hay = String(p.name || "") + " " + String(p.code || "");
      if (hay.toLowerCase().indexOf(q) === -1) return false;
    }
    if (f.category && p.category !== f.category) return false;
    if (f.status === "active" && p.is_active === false) return false;
    if (f.status === "hidden" && p.is_active !== false) return false;

    // Stock filter
    if (f.stock) {
      var s = normalizeStock(p[COL_STOCK]);
      if (s !== f.stock) return false;
    }
    return true;
  }

  function buildProductCard(p) {
    var card = make("article", "list-item");
    card.setAttribute("data-id", String(p.id));

    if (p.main_image) {
      var img = document.createElement("img");
      img.className = "list-item-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        var ph = make("div", "list-item-thumb-empty", "No photo");
        if (img.parentNode) img.parentNode.replaceChild(ph, img);
      });
      img.src = p.main_image;
      card.appendChild(img);
    } else {
      card.appendChild(make("div", "list-item-thumb-empty", "No photo"));
    }

    var body = make("div", "list-item-body");

    body.appendChild(make("h3", "list-item-title", p.name || "Untitled"));
    body.appendChild(make("p", "list-item-meta",
      (p.code || "—") + " · " + (p.category || "uncategorised")));

    var sizes = readSizes(p.sizes);
    var sizeText = sizes.length ? ("Sizes: " + sizes.join(", ")) : "No sizes";
    body.appendChild(make("p", "list-item-meta", sizeText));

    body.appendChild(make("p", "list-item-price", formatPrice(p.price)));

    // ---- Badges row: active/hidden + offer + stock ----
    var badges = make("p", "list-item-badges");

    var isActive = p.is_active !== false;
    badges.appendChild(make("span",
      isActive ? "badge badge-active" : "badge badge-inactive",
      isActive ? "Active" : "Hidden"));

    // Gold "X% OFF" badge when MRP > price
    var pct = offerPct(p.price, p[COL_OLD_PRICE]);
    if (pct > 0) {
      var off = make("span", "badge",
        pct + "% OFF");
      off.style.background = "#FBF3E1";
      off.style.color = "#8A6A1F";
      off.style.border = "1px solid #EAD9A8";
      badges.appendChild(off);
    }

    // Stock badge (skipped for in_stock — nothing to show)
    var stock = normalizeStock(p[COL_STOCK]);
    if (stock === "low_stock") {
      var low = make("span", "badge", "Low stock");
      low.style.background = "#FFF4E0";
      low.style.color = "#8A5A00";
      low.style.border = "1px solid #F0D9A6";
      badges.appendChild(low);
    } else if (stock === "out_of_stock") {
      var out = make("span", "badge", "Out of stock");
      out.style.background = "#FDECEA";
      out.style.color = "#B3261E";
      out.style.border = "1px solid #F4C7C2";
      badges.appendChild(out);
    }

    body.appendChild(badges);

    card.appendChild(body);

    var actions = make("div", "list-item-actions");

    var toggleLabel = make("label", "toggle");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isActive;
    cb.setAttribute("data-action", "toggle");
    cb.setAttribute("aria-label", "Show on website");

    var track = make("span", "toggle-track");
    track.appendChild(make("span", "toggle-thumb"));

    var labelText = make("span", "toggle-label", isActive ? "Active" : "Hidden");

    toggleLabel.appendChild(cb);
    toggleLabel.appendChild(track);
    toggleLabel.appendChild(labelText);
    actions.appendChild(toggleLabel);

    var editBtn = make("button", "btn btn-ghost", "Edit");
    editBtn.type = "button";
    editBtn.setAttribute("data-action", "edit");
    actions.appendChild(editBtn);

    var delBtn = make("button", "btn btn-danger", "Delete");
    delBtn.type = "button";
    delBtn.setAttribute("data-action", "delete");
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
  }

  function renderProducts() {
    var list = $("productsList");
    if (!list) return;

    list.textContent = "";
    var items = state.products.filter(matchesFilters);

    if (!items.length) {
      var msg = state.products.length
        ? "No products match your filters."
        : "No products yet. Tap “+ New Product” to add one.";
      list.appendChild(make("p", "loading-line", msg));
      return;
    }

    items.forEach(function (p) { list.appendChild(buildProductCard(p)); });
  }

  function wireProductList() {
    var list = $("productsList");
    if (!list) return;

    list.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(".toggle")) return;

      var btn = t.closest("[data-action]");
      if (!btn) return;

      var card = t.closest(".list-item");
      if (!card) return;

      var id = card.getAttribute("data-id");
      var action = btn.getAttribute("data-action");

      if (action === "edit") openProductModal(id);
      else if (action === "delete") deleteProduct(id);
    });

    list.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || t.getAttribute("data-action") !== "toggle") return;

      var card = t.closest(".list-item");
      if (!card) return;

      var id = card.getAttribute("data-id");
      setProductActive(id, t.checked, t);
    });
  }

  function wireProductFilters() {
    var search = $("productSearch");
    var cat = $("productFilterCategory");
    var status = $("productFilterStatus");
    var stock = $("productFilterStock");

    if (search) search.addEventListener("input", function () {
      state.filters.search = search.value.trim();
      renderProducts();
    });
    if (cat) cat.addEventListener("change", function () {
      state.filters.category = cat.value;
      renderProducts();
    });
    if (status) status.addEventListener("change", function () {
      state.filters.status = status.value;
      renderProducts();
    });
    if (stock) stock.addEventListener("change", function () {
      state.filters.stock = stock.value;
      renderProducts();
    });
  }

  async function setProductActive(id, active, input) {
    try {
      var res = await state.sb.from("products")
        .update({ is_active: !!active })
        .eq("id", id);

      if (res.error) {
        var msg = friendly(res.error);
        // If the products table doesn't have an is_active column, tell the user once.
        if (/is_active/i.test(msg) || /column .* does not exist/i.test(msg)) {
          if (input) { input.checked = !active; input.disabled = true; }
          toast("This project's products table has no 'is_active' column.", "error");
          return;
        }
        throw res.error;
      }

      var p = state.products.find(function (x) {
        return String(x.id) === String(id);
      });
      if (p) p.is_active = !!active;

      updateStats();

      if (state.filters.status) {
        renderProducts();
      } else if (input) {
        var card = input.closest(".list-item");
        var lbl = card ? card.querySelector(".toggle-label") : null;
        if (lbl) lbl.textContent = active ? "Active" : "Hidden";
      }

      toast(active ? "Product is now visible on the website."
                   : "Product hidden from the website.", "success");
    } catch (err) {
      if (input) input.checked = !active;
      toast(friendly(err) || "Could not update the product.", "error");
    }
  }

  async function deleteProduct(id) {
    var p = state.products.find(function (x) {
      return String(x.id) === String(id);
    });
    var label = p
      ? (p.name || "Untitled") + (p.code ? " (" + p.code + ")" : "")
      : "this product";

    var ok = await askConfirm(
      "Delete product permanently?",
      "Delete “" + label + "”? This cannot be undone.",
      "Delete"
    );
    if (!ok) return;

    busy(true);
    try {
      var res = await state.sb.from("products").delete().eq("id", id);
      if (res.error) throw res.error;

      // Best-effort: remove its images from storage too.
      if (p) {
        var urls = [];
        if (p.main_image) urls.push(p.main_image);
        readImages(p.additional_images).forEach(function (u) { urls.push(u); });
        urls.forEach(function (u) { deleteStorageFile(u); });
      }

      toast("Product deleted.", "success");
      await loadProducts();
    } catch (err) {
      toast(friendly(err) || "Could not delete the product.", "error");
    } finally {
      busy(false);
    }
  }

  /* --------------------------------------------------------------------
     Data format helpers
     --------------------------------------------------------------------
     Existing projects may store sizes and additional_images as:
       - a Postgres array  (supabase-js returns it as a JS array)
       - a JSONB array     (also returned as a JS array)
       - a text column     (returned as a string; might hold JSON or a CSV)
     We READ all of those safely, and when WRITING we try to keep the
     same style as the data already stored in the table.
     -------------------------------------------------------------------- */

  function readSizes(v) {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") {
      var t = v.trim();
      if (!t) return [];
      if (t.charAt(0) === "[") {
        try {
          var p = JSON.parse(t);
          if (Array.isArray(p)) return p.map(String);
        } catch (e) { /* fall through */ }
      }
      return t.split(",").map(function (x) { return String(x).trim(); }).filter(Boolean);
    }
    return [];
  }

  function readImages(v) {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") {
      var t = v.trim();
      if (!t) return [];
      if (t.charAt(0) === "[") {
        try {
          var p = JSON.parse(t);
          if (Array.isArray(p)) return p.map(String);
        } catch (e) { /* fall through */ }
      }
      return t.split(/[,\n]/).map(function (x) { return String(x).trim(); }).filter(Boolean);
    }
    return [];
  }

  // Look at any existing product to see how the table stores a field.
  function detectSampleValue(fieldName) {
    for (var i = 0; i < state.products.length; i++) {
      var v = state.products[i] && state.products[i][fieldName];
      if (v != null) return v;
    }
    return null;
  }

  // Decide how to write `additional_images`: array, JSON string or CSV string.
  function encodeImagesForWrite(arr) {
    var sample = detectSampleValue("additional_images");
    if (Array.isArray(sample)) return arr;
    if (typeof sample === "string") {
      var t = sample.trim();
      if (!t) return arr; // empty string tells us nothing → default to array
      if (t.charAt(0) === "[") return JSON.stringify(arr);   // JSON string
      // Otherwise treat as CSV string.
      return arr.join(",");
    }
    return arr; // default
  }

  function encodeSizesForWrite(arr) {
    var sample = detectSampleValue("sizes");
    if (Array.isArray(sample)) return arr;
    if (typeof sample === "string") {
      var t = sample.trim();
      if (!t) return arr;
      if (t.charAt(0) === "[") return JSON.stringify(arr);
      return arr.join(",");
    }
    return arr;
  }

  /* --------------------------------------------------------------------
     Image helpers: public URL <-> storage path, delete, validate, compress
     -------------------------------------------------------------------- */
  function bucketBase() {
    var url = (window.VIONA_CONFIG && window.VIONA_CONFIG.SUPABASE_URL) || "";
    url = String(url).replace(/\/+$/, "");
    return url + "/storage/v1/object/public/" + BUCKET + "/";
  }

  function pathFromPublicUrl(u) {
    if (!u) return null;
    var s = String(u);
    var base = bucketBase();
    if (s.indexOf(base) !== 0) return null;
    var p = s.slice(base.length);
    p = p.split("?")[0].split("#")[0];
    if (!p) return null;
    try { p = decodeURIComponent(p); } catch (e) { /* keep raw */ }
    return p;
  }

  async function deleteStorageFile(url) {
    try {
      var path = pathFromPublicUrl(url);
      if (!path || !state.sb) return;
      await state.sb.storage.from(BUCKET).remove([path]);
    } catch (e) { /* best effort, ignore */ }
  }

  function validateImageFile(file) {
    if (!file) return "No file selected.";
    if (!file.type || file.type.indexOf("image/") !== 0) {
      return "Only image files (JPG, PNG, WEBP) are allowed.";
    }
    if (file.size > MAX_FILE_BYTES) {
      return "That image is larger than 5 MB. Please choose a smaller file.";
    }
    return null;
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;

          if (!w || !h) {
            reject(new Error("Could not read that image."));
            return;
          }

          if (w > MAX_IMAGE_WIDTH) {
            h = Math.round(h * (MAX_IMAGE_WIDTH / w));
            w = MAX_IMAGE_WIDTH;
          }

          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;

          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          canvas.toBlob(function (blob) {
            if (!blob) {
              reject(new Error("Could not process that image."));
              return;
            }
            resolve(blob);
          }, "image/jpeg", JPEG_QUALITY);
        } catch (e) {
          reject(new Error("Could not process that image."));
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("That file is not a valid image."));
      };

      img.src = objectUrl;
    });
  }

  function codeHint() {
    var el = $("pCode");
    var v = el ? String(el.value || "").trim() : "";
    v = v.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    return v || "product";
  }

  async function uploadImage(blob) {
    var ts = Date.now();
    var rand = Math.random().toString(36).slice(2, 8);
    var path = "products/" + codeHint() + "-" + ts + "-" + rand + ".jpg";

    var res = await state.sb.storage.from(BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false
    });

    if (res.error) throw res.error;

    var pub = state.sb.storage.from(BUCKET).getPublicUrl(path);
    var url = (pub && pub.data && pub.data.publicUrl) || "";
    if (!url) throw new Error("Upload succeeded but no public URL was returned.");
    return url;
  }

  /* --------------------------------------------------------------------
     Product modal: main photo + extras, form reset, open/close
     -------------------------------------------------------------------- */
  function setUploadStatus(msg) {
    var el = $("uploadStatus");
    if (!el) return;
    if (msg) { el.textContent = msg; showEl(el); }
    else { el.textContent = ""; hideEl(el); }
  }

  function setSaveDisabled(on) {
    var btn = $("saveProductBtn");
    if (btn) btn.disabled = !!on;
  }

  function beginUpload() {
    state.uploadingCount++;
    setSaveDisabled(true);
  }

  function endUpload() {
    state.uploadingCount = Math.max(0, state.uploadingCount - 1);
    if (state.uploadingCount === 0) setSaveDisabled(false);
  }

  function showProductError(msg) {
    var el = $("productFormError");
    if (!el) return;
    el.textContent = msg;
    showEl(el);
  }

  function hideProductError() {
    var el = $("productFormError");
    if (!el) return;
    el.textContent = "";
    hideEl(el);
  }

  function setMainImage(url) {
    state.mainImage = url || "";

    var input = $("pMainImageUrl");
    if (input && input.value !== state.mainImage) input.value = state.mainImage;

    var prev = $("mainPhotoPreview");
    var empty = $("mainPhotoEmpty");
    var rm = $("mainPhotoRemove");
    var lbl = $("mainPhotoBtnLabel");

    if (state.mainImage) {
      if (prev) {
        prev.onerror = function () {
          prev.onerror = null;
          hideEl(prev);
          if (empty) showEl(empty);
        };
        prev.src = state.mainImage;
        showEl(prev);
      }
      if (empty) hideEl(empty);
      if (rm) showEl(rm);
      if (lbl) lbl.textContent = "Change main photo";
    } else {
      if (prev) {
        prev.onerror = null;
        prev.removeAttribute("src");
        hideEl(prev);
      }
      if (empty) showEl(empty);
      if (rm) hideEl(rm);
      if (lbl) lbl.textContent = "Choose main photo";
    }
  }

  function renderMorePhotos() {
    var grid = $("morePhotosGrid");
    if (!grid) return;
    grid.textContent = "";

    state.additionalImages.forEach(function (url, idx) {
      var wrap = make("div", "photo-thumb");

      var img = document.createElement("img");
      img.alt = "";
      img.src = url;
      wrap.appendChild(img);

      var btn = make("button", "photo-thumb-remove", "×");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove photo");
      btn.addEventListener("click", function () {
        state.additionalImages.splice(idx, 1);
        renderMorePhotos();
      });
      wrap.appendChild(btn);

      grid.appendChild(wrap);
    });
  }

  function setAdditionalImages(arr) {
    state.additionalImages = Array.isArray(arr) ? arr.slice(0, MAX_MORE_PHOTOS) : [];
    renderMorePhotos();
  }

  /* ---- Live offer preview under price + MRP ------------------------- */

  function updateOfferPreview() {
    var el = $("pOfferPreview");
    if (!el) return;

    var priceEl = $("pPrice");
    var mrpEl   = $("pMrp");
    var price = priceEl ? Number(priceEl.value) : 0;
    var mrp   = mrpEl ? Number(mrpEl.value) : 0;

    var pct = offerPct(price, mrp);
    if (pct > 0) {
      el.textContent = "Offer: " + pct + "% OFF";
      showEl(el);
    } else {
      el.textContent = "";
      hideEl(el);
    }
  }

  function wireOfferPreview() {
    var pEl = $("pPrice");
    var mEl = $("pMrp");
    if (pEl) pEl.addEventListener("input", updateOfferPreview);
    if (mEl) mEl.addEventListener("input", updateOfferPreview);
  }

  function resetProductForm() {
    ["pName", "pCode", "pPrice", "pMrp", "pDescription", "pWhatsapp",
     "pExtraSizes", "pMeeshoLink"].forEach(function (id) {
      var el = $(id);
      if (el) el.value = "";
    });

    var cat = $("pCategory"); if (cat) cat.value = "";
    var act = $("pIsActive"); if (act) act.checked = true;
    var stk = $("pStockStatus"); if (stk) stk.value = "in_stock";

    $$("#pSizeChecks input[type=checkbox]").forEach(function (cb) {
      cb.checked = false;
    });

    var link = $("pMainImageUrl"); if (link) link.value = "";
    var mainInput = $("mainPhotoInput"); if (mainInput) mainInput.value = "";
    var moreInput = $("morePhotosInput"); if (moreInput) moreInput.value = "";

    setMainImage("");
    setAdditionalImages([]);
    hideProductError();
    setUploadStatus("");
    state.uploadingCount = 0;
    setSaveDisabled(false);
    updateOfferPreview();
  }

  function sizesFromForm() {
    var out = [];
    $$("#pSizeChecks input[type=checkbox]").forEach(function (cb) {
      if (cb.checked) out.push(cb.value);
    });

    var extraEl = $("pExtraSizes");
    var extra = extraEl ? String(extraEl.value || "").split(",") : [];
    extra.forEach(function (s) {
      s = String(s).trim();
      if (s && out.indexOf(s) === -1) out.push(s);
    });

    return out;
  }

  function setSizesToForm(sizes) {
    var list = readSizes(sizes);
    var known = ["2.2", "2.4", "2.6", "2.8", "2.10"];

    $$("#pSizeChecks input[type=checkbox]").forEach(function (cb) {
      cb.checked = list.indexOf(cb.value) !== -1;
    });

    var extras = list.filter(function (s) { return known.indexOf(s) === -1; });
    var extraEl = $("pExtraSizes");
    if (extraEl) extraEl.value = extras.join(", ");
  }

  function openProductModal(id) {
    var p = null;

    if (id != null && id !== "") {
      p = state.products.find(function (x) {
        return String(x.id) === String(id);
      }) || null;
      if (!p) return;
    }

    state.editingProduct = p;
    state.modalSession = {
      uploads: [],
      original: p ? {
        main_image: p.main_image || "",
        additional_images: readImages(p.additional_images)
      } : null,
      saved: false
    };

    resetProductForm();

    var titleEl = $("productModalTitle");
    var subEl = $("productModalSub");
    var editId = $("pEditId");

    if (p) {
      if (titleEl) titleEl.textContent = "Edit product";
      if (subEl) subEl.textContent = "Editing " + (p.code || p.name || "product");
      if (editId) editId.value = String(p.id);

      var nameEl = $("pName"); if (nameEl) nameEl.value = p.name || "";
      var codeEl = $("pCode"); if (codeEl) codeEl.value = p.code || "";
      var catEl = $("pCategory"); if (catEl) catEl.value = p.category || "";
      var priceEl = $("pPrice");
      if (priceEl) priceEl.value = (p.price == null ? "" : String(p.price));

      // MRP -> old_price
      var mrpEl = $("pMrp");
      if (mrpEl) {
        var mrpVal = p[COL_OLD_PRICE];
        mrpEl.value = (mrpVal == null || mrpVal === "") ? "" : String(mrpVal);
      }

      // Stock status
      var stockEl = $("pStockStatus");
      if (stockEl) stockEl.value = normalizeStock(p[COL_STOCK]);

      var descEl = $("pDescription");
      if (descEl) descEl.value = p.description || "";
      var waEl = $("pWhatsapp"); if (waEl) waEl.value = p.whatsapp || "";
      var mlEl = $("pMeeshoLink"); if (mlEl) mlEl.value = p.meesho_link || "";
      var actEl = $("pIsActive");
      if (actEl) actEl.checked = p.is_active !== false;

      setSizesToForm(p.sizes);
      setMainImage(p.main_image || "");
      setAdditionalImages(readImages(p.additional_images));
    } else {
      if (titleEl) titleEl.textContent = "New product";
      if (subEl) subEl.textContent = "Fill in the details below.";
      if (editId) editId.value = "";
    }

    updateOfferPreview();
    openModal("productModal");
    setTimeout(function () {
      var n = $("pName");
      if (n) n.focus();
    }, 60);
  }

  function onProductModalClosed() {
    var sess = state.modalSession;
    state.modalSession = null;
    if (!sess) return;

    // If the user uploaded photos but closed without saving, delete them.
    if (!sess.saved && Array.isArray(sess.uploads) && sess.uploads.length) {
      sess.uploads.forEach(function (u) { deleteStorageFile(u); });
    }

    state.uploadingCount = 0;
    setSaveDisabled(false);
    setUploadStatus("");
  }

  /* --------------------------------------------------------------------
     Photo upload wiring (main + extras)
     -------------------------------------------------------------------- */
  function wirePhotoUploads() {
    var mainInput = $("mainPhotoInput");
    if (mainInput) {
      mainInput.addEventListener("change", async function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        await uploadMainPhoto(file);
      });
    }

    var moreInput = $("morePhotosInput");
    if (moreInput) {
      moreInput.addEventListener("change", async function (e) {
        var files = Array.prototype.slice.call(e.target.files || []);
        e.target.value = "";
        if (!files.length) return;
        await uploadMorePhotos(files);
      });
    }

    var rm = $("mainPhotoRemove");
    if (rm) rm.addEventListener("click", function () { setMainImage(""); });

    var link = $("pMainImageUrl");
    if (link) {
      link.addEventListener("input", function () {
        var v = String(link.value || "").trim();
        state.mainImage = v;

        var prev = $("mainPhotoPreview");
        var empty = $("mainPhotoEmpty");
        var rmBtn = $("mainPhotoRemove");
        var lbl = $("mainPhotoBtnLabel");

        if (v) {
          if (prev) { prev.onerror = null; prev.src = v; showEl(prev); }
          if (empty) hideEl(empty);
          if (rmBtn) showEl(rmBtn);
          if (lbl) lbl.textContent = "Change main photo";
        } else {
          if (prev) {
            prev.onerror = null;
            prev.removeAttribute("src");
            hideEl(prev);
          }
          if (empty) showEl(empty);
          if (rmBtn) hideEl(rmBtn);
          if (lbl) lbl.textContent = "Choose main photo";
        }
      });
    }
  }

  async function uploadMainPhoto(file) {
    var problem = validateImageFile(file);
    if (problem) { toast(problem, "error"); return; }

    beginUpload();
    setUploadStatus("Uploading main photo…");

    try {
      var blob = await compressImage(file);
      var url = await uploadImage(blob);
      if (state.modalSession) state.modalSession.uploads.push(url);
      setMainImage(url);
      setUploadStatus("");
      toast("Main photo uploaded.", "success");
    } catch (err) {
      setUploadStatus("");
      toast(friendly(err) || "Could not upload the photo.", "error");
    } finally {
      endUpload();
    }
  }

  async function uploadMorePhotos(files) {
    var room = MAX_MORE_PHOTOS - state.additionalImages.length;
    if (room <= 0) {
      toast("You can add up to " + MAX_MORE_PHOTOS + " extra photos.", "error");
      return;
    }
    if (files.length > room) {
      toast("Only " + room + " more photo" + (room === 1 ? "" : "s") + " can be added.", "error");
      files = files.slice(0, room);
    }

    var total = files.length;

    for (var i = 0; i < total; i++) {
      var file = files[i];
      var problem = validateImageFile(file);
      if (problem) { toast(problem, "error"); continue; }

      beginUpload();
      setUploadStatus("Uploading photo " + (i + 1) + " of " + total + "…");

      try {
        var blob = await compressImage(file);
        var url = await uploadImage(blob);
        if (state.modalSession) state.modalSession.uploads.push(url);
        if (state.additionalImages.length < MAX_MORE_PHOTOS) {
          state.additionalImages.push(url);
          renderMorePhotos();
        }
      } catch (err) {
        toast(friendly(err) || "Could not upload a photo.", "error");
      } finally {
        endUpload();
      }
    }

    setUploadStatus("");
    toast("Photo" + (total === 1 ? "" : "s") + " uploaded.", "success");
  }

  /* --------------------------------------------------------------------
     Save product: build payload, insert/update, auto-assign code,
     clean up unused images.
     -------------------------------------------------------------------- */

  // Extract the missing column name from a PostgREST error, if any.
  function extractMissingColumn(err) {
    var msg = friendly(err);
    var m = msg.match(/column ["']?([a-zA-Z_][a-zA-Z0-9_]*)["']? (?:of relation|does not exist)/i);
    if (m) return m[1];
    m = msg.match(/Could not find the '([a-zA-Z_][a-zA-Z0-9_]*)' column/i);
    if (m) return m[1];
    return null;
  }

  // Insert/update, stripping any column the DB says it doesn't know about.
  async function safeWrite(mode, payload, id) {
    var p = {};
    Object.keys(payload).forEach(function (k) { p[k] = payload[k]; });

    for (var attempt = 0; attempt < 20; attempt++) {
      var res;
      if (mode === "insert") {
        res = await state.sb.from("products").insert(p).select().single();
      } else {
        res = await state.sb.from("products").update(p).eq("id", id).select().single();
      }
      if (!res.error) return res;

      var badCol = extractMissingColumn(res.error);
      if (!badCol || p[badCol] === undefined) return res;   // Not a column error → bail

      console.warn("[admin] products table has no column \"" + badCol + "\" — skipping it.");
      delete p[badCol];
    }
    return { error: { message: "Could not save: too many unknown columns." } };
  }

  async function cleanupUnusedImages(savedProduct) {
    var keep = {};

    if (savedProduct) {
      if (savedProduct.main_image) keep[savedProduct.main_image] = true;
      readImages(savedProduct.additional_images).forEach(function (u) {
        if (u) keep[u] = true;
      });
    }
    if (state.mainImage) keep[state.mainImage] = true;
    state.additionalImages.forEach(function (u) { if (u) keep[u] = true; });

    var candidates = [];
    if (state.modalSession && Array.isArray(state.modalSession.uploads)) {
      candidates = candidates.concat(state.modalSession.uploads);
    }
    var orig = state.modalSession && state.modalSession.original;
    if (orig) {
      if (orig.main_image) candidates.push(orig.main_image);
      (orig.additional_images || []).forEach(function (u) { if (u) candidates.push(u); });
    }

    var seen = {};
    for (var i = 0; i < candidates.length; i++) {
      var u = candidates[i];
      if (!u || seen[u] || keep[u]) continue;
      seen[u] = true;
      await deleteStorageFile(u);
    }
  }

  async function saveProduct() {
    if (!state.sb) return;

    if (state.uploadingCount > 0) {
      toast("Please wait for the photos to finish uploading.", "error");
      return;
    }

    hideProductError();

    var nameEl = $("pName");
    var catEl = $("pCategory");
    var priceEl = $("pPrice");
    var mrpEl = $("pMrp");
    var stockEl = $("pStockStatus");

    var name = nameEl ? String(nameEl.value || "").trim() : "";
    var category = catEl ? catEl.value : "";
    var priceRaw = priceEl ? String(priceEl.value || "").trim() : "";
    var mrpRaw = mrpEl ? String(mrpEl.value || "").trim() : "";
    var stockVal = stockEl ? normalizeStock(stockEl.value) : "in_stock";

    if (!name) { showProductError("Please enter a product name."); return; }
    if (!category) { showProductError("Please choose a category."); return; }
    if (priceRaw === "" || isNaN(Number(priceRaw))) {
      showProductError("Please enter a valid price.");
      return;
    }
    var price = Number(priceRaw);
    if (!(price > 0)) {
      showProductError("Price must be a positive number.");
      return;
    }

    // MRP is optional. When filled it must be > price.
    var oldPrice = null;
    if (mrpRaw !== "") {
      if (isNaN(Number(mrpRaw))) {
        showProductError("Original price (MRP) must be a valid number.");
        return;
      }
      var mrpNum = Number(mrpRaw);
      if (mrpNum <= price) {
        showProductError("Original price must be higher than the selling price.");
        return;
      }
      oldPrice = mrpNum;
    }

    if (STOCK_VALUES.indexOf(stockVal) === -1) stockVal = "in_stock";

    var codeEl = $("pCode");
    var code = codeEl ? String(codeEl.value || "").trim() : "";

    var descEl = $("pDescription");
    var waEl = $("pWhatsapp");
    var mlEl = $("pMeeshoLink");
    var actEl = $("pIsActive");

    var sizesArr = sizesFromForm();
    var extrasArr = state.additionalImages.slice();

    var payload = {
      name: name,
      code: code || null,
      category: category,
      price: price,
      sizes: encodeSizesForWrite(sizesArr),
      description: descEl ? (String(descEl.value || "").trim() || null) : null,
      main_image: state.mainImage || null,
      additional_images: encodeImagesForWrite(extrasArr),
      meesho_link: mlEl ? (String(mlEl.value || "").trim() || null) : null,
      whatsapp: waEl ? (String(waEl.value || "").trim() || null) : null,
      is_active: !!(actEl && actEl.checked)
    };

    // New columns — sent by name so safeWrite() will drop them if missing.
    payload[COL_OLD_PRICE] = oldPrice;   // null or number
    payload[COL_STOCK]     = stockVal;   // one of the three constants

    busy(true);

    try {
      var id = state.editingProduct ? state.editingProduct.id : null;
      var saved = null;

      if (id != null) {
        var upd = await safeWrite("update", payload, id);
        if (upd.error) throw upd.error;
        saved = upd.data;
        toast("Product updated.", "success");
      } else {
        var ins = await safeWrite("insert", payload, null);
        if (ins.error) throw ins.error;
        saved = ins.data;

        // Auto-assign code if user left it blank and the products table has a `code` column.
        if (!code && saved && saved.id != null && "code" in saved) {
          var autoCode = "VB-" + String(saved.id).padStart(3, "0");
          var upd2 = await state.sb.from("products")
            .update({ code: autoCode })
            .eq("id", saved.id);
          if (!upd2.error) saved.code = autoCode;
        }

        toast("Product added.", "success");
      }

      if (state.modalSession) state.modalSession.saved = true;
      await cleanupUnusedImages(saved);

      closeModal("productModal");
      await loadProducts();
    } catch (err) {
      var msg = friendly(err) || "Could not save the product.";
      if ((err && err.code === "23505") ||
          /duplicate key|unique constraint|already exists/i.test(msg)) {
        msg = "That product code is already in use. Please choose another.";
      }
      showProductError(msg);
    } finally {
      busy(false);
    }
  }

  /* --------------------------------------------------------------------
     Settings (site_settings key/value)
     -------------------------------------------------------------------- */
  function updateOfferCounter() {
    var ta = $("setOfferText");
    var out = $("offerTextCount");
    if (ta && out) out.textContent = String(ta.value.length);
  }

  function updateBannerPreview() {
    var sw = $("setOfferEnabled");
    var ta = $("setOfferText");
    var wrap = $("bannerPreview");
    var txt = $("bannerPreviewText");
    if (!wrap) return;

    var active = sw ? sw.checked : false;
    var text = ta ? String(ta.value || "").trim() : "";

    if (active && text) {
      if (txt) txt.textContent = text;
      showEl(wrap);
    } else {
      hideEl(wrap);
    }
  }

  function applySettingsToForm(map) {
    map = map || {};

    var sw = $("setOfferEnabled");
    if (sw) sw.checked = String(map.offer_enabled || "").toLowerCase() === "true";

    var ta = $("setOfferText");
    if (ta) ta.value = map.offer_text || "";

    var wa = $("setWhatsapp"); if (wa) wa.value = map.whatsapp_number || "";
    var ph = $("setPhone");    if (ph) ph.value = map.phone || "";
    var em = $("setEmail");    if (em) em.value = map.contact_email || "";
    var ad = $("setAddress");  if (ad) ad.value = map.address || "";
    var dn = $("setDeliveryNote"); if (dn) dn.value = map.delivery_note || "";
    var ig = $("setInstagram"); if (ig) ig.value = map.instagram_url || "";
    var fb = $("setFacebook"); if (fb) fb.value = map.facebook_url || "";

    updateOfferCounter();
    updateBannerPreview();
  }

  async function loadSettings() {
    if (!state.sb) return;
    busy(true);
    try {
      var res = await state.sb.from("site_settings").select("key,value");
      if (res.error) throw res.error;
      var map = {};
      (res.data || []).forEach(function (row) {
        if (row && row.key != null) map[row.key] = row.value;
      });
      applySettingsToForm(map);
    } catch (err) {
      toast(friendly(err) || "Could not load settings.", "error");
    } finally {
      busy(false);
    }
  }

  async function saveSettings() {
    if (!state.sb) return;

    var waEl = $("setWhatsapp");
    var wa = waEl ? String(waEl.value || "").replace(/\D/g, "") : "";
    if (wa && (wa.length < 10 || wa.length > 15)) {
      toast("WhatsApp number must be 10 to 15 digits, including country code.", "error");
      return;
    }

    var offerEnabled = $("setOfferEnabled");
    var offerText = $("setOfferText");
    var phone = $("setPhone");
    var email = $("setEmail");
    var address = $("setAddress");
    var delivery = $("setDeliveryNote");
    var instagram = $("setInstagram");
    var facebook = $("setFacebook");

    // Keys must match what the public website reads.
    var rows = [
      { key: "offer_enabled",   value: (offerEnabled && offerEnabled.checked) ? "true" : "false" },
      { key: "offer_text",      value: offerText ? String(offerText.value || "") : "" },
      { key: "whatsapp_number", value: wa },
      { key: "delivery_note",   value: delivery ? String(delivery.value || "") : "" },
      { key: "phone",           value: phone ? String(phone.value || "") : "" },
      { key: "contact_email",   value: email ? String(email.value || "") : "" },
      { key: "address",         value: address ? String(address.value || "") : "" },
      { key: "instagram_url",   value: instagram ? String(instagram.value || "") : "" },
      { key: "facebook_url",    value: facebook ? String(facebook.value || "") : "" }
    ];

    busy(true);
    try {
      var res = await state.sb.from("site_settings").upsert(rows, { onConflict: "key" });
      if (res.error) throw res.error;

      toast("Settings saved.", "success");
      updateBannerPreview();
    } catch (err) {
      toast(friendly(err) || "Could not save settings.", "error");
    } finally {
      busy(false);
    }
  }

  function wireSettings() {
    var sw = $("setOfferEnabled");
    if (sw) sw.addEventListener("change", updateBannerPreview);

    var ta = $("setOfferText");
    if (ta) {
      ta.addEventListener("input", function () {
        if (ta.value.length > OFFER_TEXT_MAX) ta.value = ta.value.slice(0, OFFER_TEXT_MAX);
        updateOfferCounter();
        updateBannerPreview();
      });
    }

    var wa = $("setWhatsapp");
    if (wa) {
      wa.addEventListener("input", function () {
        var v = String(wa.value || "").replace(/\D/g, "").slice(0, 15);
        if (v !== wa.value) wa.value = v;
      });
    }

    var s1 = $("saveSettingsBtn");  if (s1) s1.addEventListener("click", saveSettings);
    var s2 = $("saveSettingsBtn2"); if (s2) s2.addEventListener("click", saveSettings);
    var rl = $("reloadSettingsBtn"); if (rl) rl.addEventListener("click", function () { loadSettings(); });
  }

  /* --------------------------------------------------------------------
     Wire everything together
     -------------------------------------------------------------------- */
  function wireUI() {
    var googleBtn = $("loginGoogleBtn");
    if (googleBtn) googleBtn.addEventListener("click", onLoginGoogleClick);

    var signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", onLogoutClick);

    var notAdminLogout = $("notAdminLogoutBtn");
    if (notAdminLogout) notAdminLogout.addEventListener("click", onLogoutClick);

    wireTabs();

    var newBtn = $("newProductBtn");
    if (newBtn) newBtn.addEventListener("click", function () { openProductModal(null); });

    var saveBtn = $("saveProductBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveProduct);

    wireProductList();
    wireProductFilters();
    wirePhotoUploads();
    wireOfferPreview();

    var yes = $("confirmYes");
    if (yes) yes.addEventListener("click", function () { closeConfirm(true); });
    var no = $("confirmNo");
    if (no) no.addEventListener("click", function () { closeConfirm(false); });

    wireSettings();
    wireModals();
  }

  /* --------------------------------------------------------------------
     Boot
     -------------------------------------------------------------------- */
  async function boot() {
    wireUI();

    // Start on the login screen.
    state.lastScreen = "login";
    showScreen("login");

    if (!window.VionaAuth || typeof window.VionaAuth.ready !== "function") {
      showConfigWarning(
        "auth.js did not load. Please reload the page or check that js/auth.js is uploaded."
      );
      disableLoginButton();
      return;
    }

    var ready = false;
    try { ready = await window.VionaAuth.ready(); } catch (e) { ready = false; }

    if (!ready) {
      showConfigWarning(
        "Supabase config missing. Check js/config.js — SUPABASE_URL and SUPABASE_ANON_KEY must be set."
      );
      disableLoginButton();
      return;
    }

    state.sb = window.VionaAuth.client;
    if (!state.sb) {
      showConfigWarning("Supabase client did not start. Please reload the page.");
      disableLoginButton();
      return;
    }

    // Clean up any OAuth #access_token in the URL after returning from Google.
    try {
      var h = window.location.hash || "";
      if (h.indexOf("access_token") !== -1 || h.indexOf("error_description") !== -1) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch (e) { /* ignore */ }

    // React to auth changes from the shared module.
    window.VionaAuth.onChange(function (user /*, profile */) {
      handleAuthState(user).catch(function (e) {
        console.warn("[admin] auth handling failed:", e);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      boot().catch(function (e) { console.warn("[admin] boot failed:", e); });
    });
  } else {
    boot().catch(function (e) { console.warn("[admin] boot failed:", e); });
  }
})();
