/* ==========================================================================
   Viona Bangles — Admin Panel logic
   Plain vanilla JS. Requires supabase-js v2 + js/config.js (window.VIONA_CONFIG)
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     0. CONFIG VALIDATION
     ------------------------------------------------------------------ */
  var CONFIG_FIX = " Fix it in js/config.js";
  var BUCKET = "product-images";
  var MAX_FILE_BYTES = 8 * 1024 * 1024;      // 8 MB
  var MAX_IMAGE_WIDTH = 1200;                // px, before compression
  var JPEG_QUALITY = 0.82;
  var MAX_MORE_PHOTOS = 5;
  var OFFER_TEXT_MAX = 140;

  function getConfigProblem() {
    var cfg = (typeof window !== "undefined") ? window.VIONA_CONFIG : null;

    if (!cfg || typeof cfg !== "object") {
      return "config.js did not load." + CONFIG_FIX;
    }

    var problems = [];
    var url = cfg.SUPABASE_URL;
    var key = cfg.SUPABASE_ANON_KEY;

    if (
      typeof url !== "string" ||
      url.indexOf("https://") !== 0 ||
      url.indexOf("supabase.co") === -1 ||
      url.indexOf("PASTE") !== -1
    ) {
      problems.push("Project URL is missing or invalid.");
    }

    if (
      typeof key !== "string" ||
      key.length <= 20 ||
      key.indexOf("PASTE") !== -1
    ) {
      problems.push("anon key is missing.");
    }

    if (problems.length) return problems.join(" ") + CONFIG_FIX;
    return null;
  }

  /* ------------------------------------------------------------------
     1. STATE
     ------------------------------------------------------------------ */
  var state = {
    sb: null,
    user: null,
    isAdmin: false,
    adminEmail: "",
    products: [],
    productsLoaded: false,
    filters: { search: "", category: "", status: "" },
    editingProduct: null,     // product object being edited (null = new)
    sizes: [],                // reserved
    mainImage: "",            // current main image URL in the modal
    additionalImages: [],     // current additional image URLs in the modal
    uploadingCount: 0,
    modalSession: null,       // { uploads: [], original: {...}, saved: bool }
    currentTab: "products",
    settingsLoaded: false
  };

  /* ------------------------------------------------------------------
     2. DOM HELPERS
     ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
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

  function make(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = String(text);
    return e;
  }

  function friendly(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    return err.message || err.error_description || err.details || "";
  }

  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return "Rs 0";
    try {
      return "Rs " + num.toLocaleString("en-IN");
    } catch (e) {
      return "Rs " + num;
    }
  }

  /* ------------------------------------------------------------------
     3. TOAST / BUSY / CONFIRM
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     4. MODALS
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     5. SCREENS
     ------------------------------------------------------------------ */
  function showScreen(name) {
    var login = $("loginScreen");
    var app = $("app");
    if (name === "app") {
      hideEl(login);
      showEl(app);
    } else {
      showEl(login);
      hideEl(app);
    }
  }

  function setLoginNote(msg) {
    var el = $("loginNote");
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      showEl(el);
    } else {
      el.textContent = "";
      hideEl(el);
    }
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

  /* ------------------------------------------------------------------
     6. AUTH
     ------------------------------------------------------------------ */
  function redirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  async function signInWithGoogle() {
    if (!state.sb) return;
    setLoginNote("");
    try {
      var res = await state.sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl() }
      });
      if (res && res.error) {
        toast(friendly(res.error) || "Sign-in failed.", "error");
      }
    } catch (err) {
      toast(friendly(err) || "Sign-in failed.", "error");
    }
  }

  async function signOut() {
    try {
      if (state.sb) await state.sb.auth.signOut();
    } catch (e) { /* ignore */ }

    state.user = null;
    state.isAdmin = false;
    state.adminEmail = "";
    state.products = [];
    state.productsLoaded = false;

    setLoginNote("");
    showScreen("login");
  }

  async function isAdminEmail(email) {
    if (!email || !state.sb) return false;
    var lower = String(email).toLowerCase();
    try {
      var res = await state.sb
        .from("admins")
        .select("email")
        .eq("email", lower)
        .limit(1);
      if (res.error) {
        console.warn("Admin check failed:", res.error.message);
        return false;
      }
      return Array.isArray(res.data) && res.data.length > 0;
    } catch (e) {
      console.warn("Admin check exception:", e);
      return false;
    }
  }

  async function handleSession(session) {
    if (!session || !session.user) {
      state.user = null;
      state.isAdmin = false;
      state.adminEmail = "";
      showScreen("login");
      return;
    }

    state.user = session.user;
    var email = String(session.user.email || "").toLowerCase();

    var ok = await isAdminEmail(email);

    if (!ok) {
      state.isAdmin = false;
      state.adminEmail = "";
      try { await state.sb.auth.signOut(); } catch (e) { /* ignore */ }
      state.user = null;
      showScreen("login");
      setLoginNote("This Google account is not an admin.");
      return;
    }

    if (state.isAdmin && state.adminEmail === email) {
      showScreen("app");
      if (!state.productsLoaded) await loadProducts();
      return;
    }

    state.isAdmin = true;
    state.adminEmail = email;

    var emailEl = $("adminEmail");
    if (emailEl) emailEl.textContent = email;

    setLoginNote("");
    showScreen("app");
    setTab("products");
    await loadProducts();
  }

  /* ------------------------------------------------------------------
     7. TABS
     ------------------------------------------------------------------ */
  function setTab(name) {
    state.currentTab = name;

    $$(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
    });

    var pp = $("panel-products");
    var ps = $("panel-settings");

    if (name === "settings") {
      if (pp) hideEl(pp);
      if (ps) showEl(ps);
      loadSettings();
    } else {
      if (pp) showEl(pp);
      if (ps) hideEl(ps);
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

  /* ------------------------------------------------------------------
     8. PRODUCTS — LOAD / RENDER
     ------------------------------------------------------------------ */
  async function loadProducts() {
    if (!state.sb) return;
    var list = $("productsList");
    if (list) {
      list.textContent = "";
      list.appendChild(make("p", "loading-line", "Loading products…"));
    }

    try {
      var res = await state.sb
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });

      if (res.error) throw res.error;

      state.products = Array.isArray(res.data) ? res.data : [];
      state.productsLoaded = true;
      updateStats();
      renderProducts();
    } catch (err) {
      if (list) {
        list.textContent = "";
        list.appendChild(make(
          "p",
          "loading-line",
          "Could not load products. " + (friendly(err) || "")
        ));
      }
    }
  }

  function updateStats() {
    var total = state.products.length;
    var active = 0;
    state.products.forEach(function (p) {
      if (p.is_active !== false) active++;
    });
    var hidden = total - active;

    var t = $("statTotal");
    var a = $("statActive");
    var h = $("statHidden");
    if (t) t.textContent = String(total);
    if (a) a.textContent = String(active);
    if (h) h.textContent = String(hidden);
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

    return true;
  }

  function buildProductCard(p) {
    var card = make("article", "list-item");
    card.setAttribute("data-id", String(p.id));

    /* ----- thumbnail ----- */
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

    /* ----- body ----- */
    var body = make("div", "list-item-body");

    body.appendChild(make("h3", "list-item-title", p.name || "Untitled"));
    body.appendChild(make(
      "p",
      "list-item-meta",
      (p.code || "—") + " · " + (p.category || "uncategorised")
    ));

    var sizeText = (Array.isArray(p.sizes) && p.sizes.length)
      ? "Sizes: " + p.sizes.join(", ")
      : "No sizes";
    body.appendChild(make("p", "list-item-meta", sizeText));

    body.appendChild(make("p", "list-item-price", formatPrice(p.price)));

    var badges = make("p", "list-item-badges");
    if (p.stock_status === "out_of_stock") {
      badges.appendChild(make("span", "badge badge-warn", "Out of stock"));
    } else if (p.stock_status === "made_to_order") {
      badges.appendChild(make("span", "badge badge-info", "Made to order"));
    } else {
      badges.appendChild(make("span", "badge badge-active", "In stock"));
    }
    if (p.is_featured) {
      badges.appendChild(make("span", "badge badge-featured", "Featured"));
    }
    body.appendChild(badges);

    card.appendChild(body);

    /* ----- actions ----- */
    var actions = make("div", "list-item-actions");
    var isActive = p.is_active !== false;

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

    items.forEach(function (p) {
      list.appendChild(buildProductCard(p));
    });
  }

  function wireProductList() {
    var list = $("productsList");
    if (!list) return;

    list.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (t.closest(".toggle")) return; // handled by change

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

    if (search) {
      search.addEventListener("input", function () {
        state.filters.search = search.value.trim();
        renderProducts();
      });
    }

    if (cat) {
      cat.addEventListener("change", function () {
        state.filters.category = cat.value;
        renderProducts();
      });
    }

    if (status) {
      status.addEventListener("change", function () {
        state.filters.status = status.value;
        renderProducts();
      });
    }
  }

  async function setProductActive(id, active, input) {
    try {
      var res = await state.sb
        .from("products")
        .update({ is_active: !!active })
        .eq("id", id);
      if (res.error) throw res.error;

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

      toast(active ? "Product is now visible on the website." : "Product hidden from the website.", "success");
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

      if (p) {
        var urls = [];
        if (p.main_image) urls.push(p.main_image);
        (p.additional_images || []).forEach(function (u) {
          if (u) urls.push(u);
        });
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

  /* ------------------------------------------------------------------
     9. IMAGE HELPERS
     ------------------------------------------------------------------ */
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
    } catch (e) {
      /* ignore — best effort */
    }
  }

  function validateImageFile(file) {
    if (!file) return "No file selected.";
    if (!file.type || file.type.indexOf("image/") !== 0) {
      return "Only image files (JPG, PNG, WEBP) are allowed.";
    }
    if (file.size > MAX_FILE_BYTES) {
      return "That image is larger than 8 MB. Please choose a smaller file.";
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

  /* ------------------------------------------------------------------
     10. PRODUCT MODAL — open / reset
     ------------------------------------------------------------------ */
  function setUploadStatus(msg) {
    var el = $("uploadStatus");
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      showEl(el);
    } else {
      el.textContent = "";
      hideEl(el);
    }
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

  function resetProductForm() {
    ["pName", "pCode", "pPrice", "pDescription", "pWhatsapp", "pExtraSizes"].forEach(function (id) {
      var el = $(id);
      if (el) el.value = "";
    });

    var cat = $("pCategory");
    if (cat) cat.value = "";

    var st = $("pStockStatus");
    if (st) st.value = "in_stock";

    var act = $("pIsActive");
    if (act) act.checked = true;

    var feat = $("pIsFeatured");
    if (feat) feat.checked = false;

    $$("#pSizeChecks input[type=checkbox]").forEach(function (cb) {
      cb.checked = false;
    });

    var link = $("pMainImageUrl");
    if (link) link.value = "";

    var mainInput = $("mainPhotoInput");
    if (mainInput) mainInput.value = "";

    var moreInput = $("morePhotosInput");
    if (moreInput) moreInput.value = "";

    setMainImage("");
    setAdditionalImages([]);
    hideProductError();
    setUploadStatus("");
    state.uploadingCount = 0;
    setSaveDisabled(false);
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
    var list = Array.isArray(sizes) ? sizes.map(String) : [];
    var known = ["2.2", "2.4", "2.6", "2.8", "2.10"];

    $$("#pSizeChecks input[type=checkbox]").forEach(function (cb) {
      cb.checked = list.indexOf(cb.value) !== -1;
    });

    var extras = list.filter(function (s) {
      return known.indexOf(s) === -1;
    });

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
        additional_images: Array.isArray(p.additional_images)
          ? p.additional_images.slice()
          : []
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
      var descEl = $("pDescription");
      if (descEl) descEl.value = p.description || "";
      var stEl = $("pStockStatus");
      if (stEl) stEl.value = p.stock_status || "in_stock";
      var waEl = $("pWhatsapp");
      if (waEl) waEl.value = p.whatsapp || "";
      var actEl = $("pIsActive");
      if (actEl) actEl.checked = p.is_active !== false;
      var featEl = $("pIsFeatured");
      if (featEl) featEl.checked = !!p.is_featured;

      setSizesToForm(p.sizes);
      setMainImage(p.main_image || "");
      setAdditionalImages(
        Array.isArray(p.additional_images) ? p.additional_images.slice() : []
      );
    } else {
      if (titleEl) titleEl.textContent = "New product";
      if (subEl) subEl.textContent = "Fill in the details below.";
      if (editId) editId.value = "";
    }

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

    if (!sess.saved && Array.isArray(sess.uploads) && sess.uploads.length) {
      sess.uploads.forEach(function (u) { deleteStorageFile(u); });
    }

    state.uploadingCount = 0;
    setSaveDisabled(false);
    setUploadStatus("");
  }

  /* ------------------------------------------------------------------
     11. PRODUCT MODAL — photo uploads
     ------------------------------------------------------------------ */
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
    if (rm) {
      rm.addEventListener("click", function () {
        setMainImage("");
      });
    }

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
          if (prev) {
            prev.onerror = null;
            prev.src = v;
            showEl(prev);
          }
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
    if (problem) {
      toast(problem, "error");
      return;
    }

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
      if (problem) {
        toast(problem, "error");
        continue;
      }

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

  /* ------------------------------------------------------------------
     12. PRODUCT MODAL — save
     ------------------------------------------------------------------ */
  async function cleanupUnusedImages(savedProduct) {
    var keep = {};

    if (savedProduct) {
      if (savedProduct.main_image) keep[savedProduct.main_image] = true;
      (savedProduct.additional_images || []).forEach(function (u) {
        if (u) keep[u] = true;
      });
    }

    if (state.mainImage) keep[state.mainImage] = true;
    state.additionalImages.forEach(function (u) {
      if (u) keep[u] = true;
    });

    var candidates = [];

    if (state.modalSession && Array.isArray(state.modalSession.uploads)) {
      candidates = candidates.concat(state.modalSession.uploads);
    }

    var orig = state.modalSession && state.modalSession.original;
    if (orig) {
      if (orig.main_image) candidates.push(orig.main_image);
      (orig.additional_images || []).forEach(function (u) {
        if (u) candidates.push(u);
      });
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

    var name = nameEl ? String(nameEl.value || "").trim() : "";
    var category = catEl ? catEl.value : "";
    var priceRaw = priceEl ? String(priceEl.value || "").trim() : "";

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

    var codeEl = $("pCode");
    var code = codeEl ? String(codeEl.value || "").trim() : "";

    var payload = {
      name: name,
      code: code || null,
      category: category,
      price: price,
      sizes: sizesFromForm(),
      description: (function () {
        var d = $("pDescription");
        return d ? (String(d.value || "").trim() || null) : null;
      })(),
      main_image: state.mainImage || null,
      additional_images: state.additionalImages.slice(),
      whatsapp: (function () {
        var w = $("pWhatsapp");
        return w ? (String(w.value || "").trim() || null) : null;
      })(),
      is_active: !!(function () { var a = $("pIsActive"); return a && a.checked; })(),
      is_featured: !!(function () { var f = $("pIsFeatured"); return f && f.checked; })(),
      stock_status: (function () {
        var s = $("pStockStatus");
        return (s && s.value) ? s.value : "in_stock";
      })()
    };

    busy(true);

    try {
      var id = state.editingProduct ? state.editingProduct.id : null;
      var saved = null;

      if (id != null) {
        var upd = await state.sb
          .from("products")
          .update(payload)
          .eq("id", id)
          .select()
          .single();

        if (upd.error) throw upd.error;
        saved = upd.data;
        toast("Product updated.", "success");
      } else {
        var ins = await state.sb
          .from("products")
          .insert(payload)
          .select()
          .single();

        if (ins.error) throw ins.error;
        saved = ins.data;

        if (!code && saved && saved.id != null) {
          var autoCode = "VB-" + String(saved.id).padStart(3, "0");
          var upd2 = await state.sb
            .from("products")
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
      if ((err && err.code === "23505") || /duplicate key|unique constraint|already exists/i.test(msg)) {
        msg = "That product code is already in use. Please choose another.";
      }
      showProductError(msg);
    } finally {
      busy(false);
    }
  }

  /* ------------------------------------------------------------------
     13. SETTINGS — load / save
     ------------------------------------------------------------------ */
  function updateOfferCounter() {
    var ta = $("setOfferText");
    var out = $("offerTextCount");
    if (ta && out) out.textContent = String(ta.value.length);
  }

  function updateBannerPreview() {
    var sw = $("setOfferActive");
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

    var sw = $("setOfferActive");
    if (sw) sw.checked = String(map.offer_active || "").toLowerCase() === "true";

    var ta = $("setOfferText");
    if (ta) ta.value = map.offer_text || "";

    var wa = $("setWhatsapp");
    if (wa) wa.value = map.whatsapp_number || "";

    var ph = $("setPhone");
    if (ph) ph.value = map.phone || "";

    var em = $("setEmail");
    if (em) em.value = map.contact_email || "";

    var ad = $("setAddress");
    if (ad) ad.value = map.address || "";

    var dn = $("setDeliveryNote");
    if (dn) dn.value = map.delivery_note || "";

    var ig = $("setInstagram");
    if (ig) ig.value = map.instagram_url || "";

    var fb = $("setFacebook");
    if (fb) fb.value = map.facebook_url || "";

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

      state.settingsLoaded = true;
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

    var now = new Date().toISOString();

    var offerActive = $("setOfferActive");
    var offerText = $("setOfferText");
    var phone = $("setPhone");
    var email = $("setEmail");
    var address = $("setAddress");
    var delivery = $("setDeliveryNote");
    var instagram = $("setInstagram");
    var facebook = $("setFacebook");

    var rows = [
      { key: "offer_active", value: (offerActive && offerActive.checked) ? "true" : "false", updated_at: now },
      { key: "offer_text", value: offerText ? String(offerText.value || "") : "", updated_at: now },
      { key: "whatsapp_number", value: wa, updated_at: now },
      { key: "delivery_note", value: delivery ? String(delivery.value || "") : "", updated_at: now },
      { key: "phone", value: phone ? String(phone.value || "") : "", updated_at: now },
      { key: "contact_email", value: email ? String(email.value || "") : "", updated_at: now },
      { key: "address", value: address ? String(address.value || "") : "", updated_at: now },
      { key: "instagram_url", value: instagram ? String(instagram.value || "") : "", updated_at: now },
      { key: "facebook_url", value: facebook ? String(facebook.value || "") : "", updated_at: now }
    ];

    busy(true);
    try {
      var res = await state.sb
        .from("site_settings")
        .upsert(rows, { onConflict: "key" });

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
    var sw = $("setOfferActive");
    if (sw) sw.addEventListener("change", updateBannerPreview);

    var ta = $("setOfferText");
    if (ta) {
      ta.addEventListener("input", function () {
        if (ta.value.length > OFFER_TEXT_MAX) {
          ta.value = ta.value.slice(0, OFFER_TEXT_MAX);
        }
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

    var s1 = $("saveSettingsBtn");
    if (s1) s1.addEventListener("click", saveSettings);

    var s2 = $("saveSettingsBtn2");
    if (s2) s2.addEventListener("click", saveSettings);

    var rl = $("reloadSettingsBtn");
    if (rl) rl.addEventListener("click", function () { loadSettings(); });
  }

  /* ------------------------------------------------------------------
     14. WIRING
     ------------------------------------------------------------------ */
  function wireUI() {
    /* --- auth --- */
    var googleBtn = $("loginGoogleBtn");
    if (googleBtn) googleBtn.addEventListener("click", signInWithGoogle);

    var signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    /* --- tabs --- */
    wireTabs();

    /* --- products --- */
    var newBtn = $("newProductBtn");
    if (newBtn) {
      newBtn.addEventListener("click", function () { openProductModal(null); });
    }

    var saveBtn = $("saveProductBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveProduct);

    wireProductList();
    wireProductFilters();
    wirePhotoUploads();

    /* --- confirm dialog --- */
    var yes = $("confirmYes");
    if (yes) yes.addEventListener("click", function () { closeConfirm(true); });

    var no = $("confirmNo");
    if (no) no.addEventListener("click", function () { closeConfirm(false); });

    /* --- settings --- */
    wireSettings();

    /* --- modals --- */
    wireModals();
  }

  /* ------------------------------------------------------------------
     15. BOOT
     ------------------------------------------------------------------ */
  async function boot() {
    wireUI();

    var problem = getConfigProblem();
    if (problem) {
      showScreen("login");
      showConfigWarning(problem);
      disableLoginButton();
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showScreen("login");
      showConfigWarning(
        "The Supabase library did not load. Check your internet connection and reload the page." + CONFIG_FIX
      );
      disableLoginButton();
      return;
    }

    var cfg = window.VIONA_CONFIG;

    try {
      state.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      showScreen("login");
      showConfigWarning(
        "Could not start Supabase: " + (friendly(e) || "unknown error") + "." + CONFIG_FIX
      );
      disableLoginButton();
      return;
    }

    state.sb.auth.onAuthStateChange(function (event, session) {
      /* Defer so supabase-js internals are not blocked */
      setTimeout(function () {
        handleSession(session).catch(function (e) {
          console.warn("Session handling failed:", e);
        });
      }, 0);
    });

    try {
      var sess = await state.sb.auth.getSession();
      var session = (sess && sess.data) ? sess.data.session : null;
      await handleSession(session);
    } catch (e) {
      showScreen("login");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
