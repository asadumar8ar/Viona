/* ============================================================================
   Viona Bangles — js/customers.js
   ----------------------------------------------------------------------------
   Adds a "Customers" tab to the admin panel WITHOUT editing admin.js.

   How it works:
     - Waits for window.VionaAuth.ready()
     - Listens to VionaAuth.onChange()
     - Only when the signed-in user is an admin (VionaAuth.isAdmin() === true)
       it injects a Customers tab button into #tabs and a #panel-customers
       section into <main class="main">.
     - Clicking the Customers tab shows the panel and loads rows from the
       "customers" table. Clicking any other tab hides the panel and leaves
       admin.js alone to show its own panels.
     - Non-admins / logged-out users get the tab and panel removed.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. SMALL HELPERS
     ========================================================================== */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSb() {
    var auth = window.VionaAuth;
    if (auth && auth.client) return auth.client;
    return window.vionaSupabase || null;
  }

  function mainEl() {
    return document.querySelector('main.main') || document.querySelector('.main');
  }

  /* ==========================================================================
     2. STATE
     ========================================================================== */
  var customers = [];          // rows currently loaded
  var loading = false;         // prevents double-fetch
  var wiredPanel = false;      // listeners attached to the panel (per injection)
  var applyTimer = null;       // debounce for auth-state handling

  /* ==========================================================================
     3. STYLE INJECTION (only the bits admin.css does not already cover)
     ========================================================================== */
  var CUSTOMERS_CSS = '' +
    '#panel-customers[hidden]{display:none!important}' +
    '#panel-customers .panel-head{display:flex;align-items:flex-start;' +
      'justify-content:space-between;gap:12px;flex-wrap:wrap}' +
    '#panel-customers .vc-count{margin:10px 0 0;font-size:12.5px;' +
      'color:#5A6472;letter-spacing:.02em}' +
    '#panel-customers .list-block{display:flex;flex-direction:column;gap:10px}' +

    '#panel-customers .vc-item{display:flex;align-items:flex-start;gap:12px;' +
      'padding:14px 16px;background:#FFFFFF;' +
      'border:1px solid rgba(11,31,58,.08);border-radius:14px;' +
      'box-shadow:0 2px 10px rgba(11,31,58,.05)}' +
    '#panel-customers .vc-avatar{width:44px;height:44px;border-radius:50%;' +
      'flex:0 0 auto;overflow:hidden;display:grid;place-items:center;' +
      'background:#0B1F3A;color:#E3C87F;font-weight:600;font-size:17px;' +
      'line-height:1;border:1px solid rgba(201,162,75,.55)}' +
    '#panel-customers .vc-avatar img{width:100%;height:100%;' +
      'object-fit:cover;display:block}' +
    '#panel-customers .list-item-body{flex:1 1 auto;min-width:0}' +
    '#panel-customers .list-item-title{margin:0 0 4px;font-size:14.5px;' +
      'font-weight:600;color:#0B1F3A;word-break:break-word}' +
    '#panel-customers .vc-meta{margin:0 0 2px;font-size:12.5px;' +
      'color:#5A6472;line-height:1.6;word-break:break-word}' +
    '#panel-customers .vc-meta .vc-link{color:#0B1F3A;text-decoration:none;' +
      'border-bottom:1px solid rgba(201,162,75,.55)}' +
    '#panel-customers .vc-meta .vc-link:hover{color:#C9A24B}' +
    '#panel-customers .vc-joined{font-size:11.5px;color:#8A8F98}' +
    '#panel-customers .vc-actions{flex:0 0 auto;display:flex;' +
      'flex-direction:column;gap:6px;align-items:flex-end}' +
    '#panel-customers .vc-wa{display:inline-flex;align-items:center;' +
      'justify-content:center;gap:6px;min-height:34px;padding:8px 14px;' +
      'border-radius:999px;background:linear-gradient(180deg,#D4AF63 0%,#C9A24B 100%);' +
      'color:#0B1F3A;font-family:"Poppins",system-ui,sans-serif;font-size:12px;' +
      'font-weight:600;letter-spacing:.02em;text-decoration:none;white-space:nowrap;' +
      'box-shadow:0 4px 14px rgba(201,162,75,.32)}' +
    '#panel-customers .vc-wa:hover{background:linear-gradient(180deg,#DCB972 0%,#C9A24B 100%)}' +

    '@media (max-width:560px){' +
      '#panel-customers .vc-item{flex-wrap:wrap;padding:13px 14px}' +
      '#panel-customers .vc-actions{width:100%;align-items:stretch}' +
      '#panel-customers .vc-wa{width:100%}' +
    '}';

  function injectStyles() {
    if ($('vcCustomersStyles')) return;
    var s = document.createElement('style');
    s.id = 'vcCustomersStyles';
    s.appendChild(document.createTextNode(CUSTOMERS_CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ==========================================================================
     4. TAB + PANEL INJECTION / REMOVAL
     ========================================================================== */
  function ensureTabAndPanel() {
    var tabs = $('tabs');
    var main = mainEl();
    if (!tabs || !main) return false;

    // --- Tab button (inject only once) ---
    var tabBtn = tabs.querySelector('[data-tab="customers"]');
    if (!tabBtn) {
      tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'tab-btn';
      tabBtn.setAttribute('data-tab', 'customers');
      tabBtn.setAttribute('role', 'tab');
      tabBtn.setAttribute('aria-selected', 'false');
      tabBtn.textContent = 'Customers';
      tabs.appendChild(tabBtn);
    }

    // --- Panel section (inject only once) ---
    var panel = $('panel-customers');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'panel-customers';
      panel.className = 'tab-panel hidden';
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = true;
      panel.innerHTML = panelMarkup();
      main.appendChild(panel);
      wirePanel();
      wiredPanel = true;
    }

    return true;
  }

  function removeTabAndPanel() {
    var tabBtn = document.querySelector('#tabs [data-tab="customers"]');
    if (tabBtn && tabBtn.parentNode) tabBtn.parentNode.removeChild(tabBtn);

    var panel = $('panel-customers');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);

    customers = [];
    loading = false;
    wiredPanel = false;
  }

  /* ==========================================================================
     5. PANEL MARKUP
     ========================================================================== */
  function panelMarkup() {
    return '' +
      '<header class="panel-head">' +
        '<div class="panel-head-text">' +
          '<h2 class="panel-title">Customers</h2>' +
          '<p class="panel-sub">People who created an account on your website</p>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost" id="vcReloadBtn">Reload</button>' +
      '</header>' +

      '<div class="toolbar">' +
        '<input type="search" id="vcSearch" class="input" ' +
          'placeholder="Search by name, phone, email or city…" ' +
          'autocomplete="off" aria-label="Search customers" />' +
      '</div>' +

      '<p class="vc-count" id="vcCount">Total customers: 0</p>' +

      '<div class="list-block" id="vcList">' +
        '<p class="loading-line">Loading customers…</p>' +
      '</div>';
  }

  function wirePanel() {
    var search = $('vcSearch');
    if (search) {
      var timer = null;
      search.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { renderList(); }, 120);
      });
    }

    var reload = $('vcReloadBtn');
    if (reload) {
      reload.addEventListener('click', function () { loadCustomers(); });
    }
  }

  /* ==========================================================================
     6. TAB SWITCHING
     --------------------------------------------------------------------------
     admin.js has its own click handler for #tabs (it was registered first).
     Our handler runs after it, so we simply enforce the final state.
     ========================================================================== */
  function onTabsClick(e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('.tab-btn') : null;
    if (!btn) return;

    var tab = btn.getAttribute('data-tab');
    if (tab === 'customers') {
      activateCustomersTab();
    } else {
      deactivateCustomersTab();
    }
  }

  function activateCustomersTab() {
    var tabs = $('tabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll('.tab-btn'), function (b) {
        var isCustomers = b.getAttribute('data-tab') === 'customers';
        if (isCustomers) {
          b.classList.add('is-active');
          b.setAttribute('aria-selected', 'true');
        } else {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        }
      });
    }

    // Hide the panels admin.js owns.
    hidePanel($('panel-products'));
    hidePanel($('panel-settings'));

    // Show ours.
    var pc = $('panel-customers');
    if (!pc) return; // panel missing — nothing to show
    pc.classList.remove('hidden');
    pc.hidden = false;

    loadCustomers();
  }

  function deactivateCustomersTab() {
    var btn = document.querySelector('#tabs [data-tab="customers"]');
    if (btn) {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-selected', 'false');
    }
    hidePanel($('panel-customers'));
    // We do NOT touch products/settings — admin.js shows them.
  }

  function hidePanel(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.hidden = true;
  }

  /* ==========================================================================
     7. DATA LOADING
     ========================================================================== */
  function friendlyLoadError(err) {
    var msg = String(
      (err && (err.message || err.error_description || err.details)) || ''
    ).toLowerCase();
    var code = String((err && err.code) || '');

    if (msg.indexOf('permission') !== -1 ||
        msg.indexOf('row-level security') !== -1 ||
        msg.indexOf('policy') !== -1 ||
        msg.indexOf('not allowed') !== -1 ||
        msg.indexOf('jwt') !== -1 ||
        msg.indexOf('unauthorized') !== -1 ||
        code === '42501' ||
        code === 'PGRST301') {
      return 'Permission denied. Run the customers admin-read SQL in Supabase.';
    }
    if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('network') !== -1) {
      return 'Network problem. Please check your internet and try again.';
    }
    return 'Could not load customers. Please try again.';
  }

  function rowTime(row) {
    if (!row) return 0;
    var c = row.created_at ? Date.parse(row.created_at) : NaN;
    if (isFinite(c)) return c;
    var u = row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (isFinite(u)) return u;
    return 0;
  }

  // Newest first (created_at, else updated_at, else name A→Z).
  function compareRows(a, b) {
    var ta = rowTime(a);
    var tb = rowTime(b);
    if (ta !== tb) return tb - ta;
    var na = String((a && a.name) || '').toLowerCase();
    var nb = String((b && b.name) || '').toLowerCase();
    return na.localeCompare(nb);
  }

  async function loadCustomers() {
    var list = $('vcList');
    if (!list) return;

    var sb = getSb();
    if (!sb || typeof sb.from !== 'function') {
      list.innerHTML = '<p class="loading-line">' +
        esc('Auth is not ready yet. Please reload the page.') + '</p>';
      return;
    }

    if (loading) return;
    loading = true;
    list.innerHTML = '<p class="loading-line">Loading customers…</p>';

    try {
      var res = await sb.from('customers').select('*');
      if (res && res.error) throw res.error;

      customers = Array.isArray(res && res.data) ? res.data.slice() : [];
      customers.sort(compareRows);
      renderList();
    } catch (err) {
      console.error('[VionaCustomers] load failed:', err);
      customers = [];
      var countEl = $('vcCount');
      if (countEl) countEl.textContent = 'Total customers: 0';
      list.innerHTML = '<p class="loading-line">' +
        esc(friendlyLoadError(err)) + '</p>';
    } finally {
      loading = false;
    }
  }

  /* ==========================================================================
     8. RENDERING
     ========================================================================== */
  function renderList() {
    var list = $('vcList');
    if (!list) return;

    var countEl = $('vcCount');
    var searchEl = $('vcSearch');
    var q = String((searchEl && searchEl.value) || '').trim().toLowerCase();

    var filtered = !q ? customers : customers.filter(function (c) {
      return matchesQuery(c, q);
    });

    if (countEl) {
      countEl.textContent = 'Total customers: ' + customers.length +
        (q ? ' · showing ' + filtered.length : '');
    }

    if (!filtered.length) {
      list.innerHTML = customers.length
        ? '<p class="loading-line">No customers match your search.</p>'
        : '<p class="loading-line">No customers yet.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      html += itemHtml(filtered[i]);
    }
    list.innerHTML = html;

    // Attach image-fallback handlers (avatar -> first letter).
    Array.prototype.forEach.call(
      list.querySelectorAll('img[data-vc-avatar]'),
      function (img) {
        function fallback() {
          var wrap = img.parentNode;
          if (!wrap) return;
          var letter = String(wrap.getAttribute('data-vc-letter') || '?').charAt(0).toUpperCase();
          img.remove();
          wrap.textContent = letter;
        }
        img.addEventListener('error', fallback);
        if (img.complete && img.naturalWidth === 0) fallback();
      }
    );
  }

  function matchesQuery(c, q) {
    if (!c) return false;
    var hay = [
      String(c.name || ''),
      String(c.email || ''),
      String(c.city || ''),
      String(c.phone || ''),
      String(c.phone || '').replace(/\D/g, '')
    ].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // Normalise a phone value to a valid 10-digit Indian mobile, or null.
  function phoneParts(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return null;

    var local = d;
    if (d.length === 12 && d.indexOf('91') === 0) local = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === '0') local = d.slice(1);
    else if (d.length > 10) local = d.slice(-10);

    if (local.length !== 10) return null;

    return {
      local: local,
      tel: '+91' + local,
      wa: '91' + local,
      pretty: '+91 ' + local.slice(0, 5) + ' ' + local.slice(5)
    };
  }

  function formatJoined(c) {
    if (!c) return '';
    var raw = c.created_at; // only the real join date is shown
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch (e) {
      return d.toDateString();
    }
  }

  function itemHtml(c) {
    c = c || {};
    var name = String(c.name || '').trim();
    var email = String(c.email || '').trim();
    var city = String(c.city || '').trim();
    var avatar = String(c.avatar_url || '').trim();
    var phone = phoneParts(c.phone);

    var displayName = name || (email ? email.split('@')[0] : 'Customer');
    var letter = String(displayName || '?').charAt(0).toUpperCase();

    /* ---- meta line: phone · email · city ---- */
    var meta = [];
    if (phone) {
      meta.push('<a class="vc-link" href="tel:' + esc(phone.tel) + '">' +
        esc(phone.pretty) + '</a>');
    } else if (c.phone) {
      meta.push(esc(String(c.phone)));
    }
    if (email) {
      meta.push('<a class="vc-link" href="mailto:' + esc(email) + '">' +
        esc(email) + '</a>');
    }
    if (city) {
      meta.push('<span class="vc-city">' + esc(city) + '</span>');
    }

    /* ---- joined date ---- */
    var joined = formatJoined(c);
    var joinedHtml = joined
      ? '<p class="vc-meta vc-joined">Joined ' + esc(joined) + '</p>'
      : '';

    /* ---- avatar ---- */
    var avatarHtml = avatar
      ? '<span class="vc-avatar" data-vc-letter="' + esc(letter) + '">' +
          '<img data-vc-avatar src="' + esc(avatar) + '" alt="" loading="lazy" />' +
        '</span>'
      : '<span class="vc-avatar" data-vc-letter="' + esc(letter) + '">' +
          esc(letter) +
        '</span>';

    /* ---- WhatsApp button ---- */
    var waHtml = phone
      ? '<a class="vc-wa" href="https://wa.me/' + esc(phone.wa) + '" ' +
          'target="_blank" rel="noopener noreferrer">WhatsApp</a>'
      : '';

    var idAttr = c.id ? ' data-customer-id="' + esc(c.id) + '"' : '';

    return '<article class="list-item vc-item"' + idAttr + '>' +
      avatarHtml +
      '<div class="list-item-body">' +
        '<h3 class="list-item-title">' + esc(displayName) + '</h3>' +
        (meta.length ? '<p class="vc-meta">' + meta.join(' · ') + '</p>' : '') +
        joinedHtml +
      '</div>' +
      (waHtml ? '<div class="vc-actions">' + waHtml + '</div>' : '') +
    '</article>';
  }

  /* ==========================================================================
     9. AUTH GATING
     ========================================================================== */
  function applyAuthState() {
    var auth = window.VionaAuth;
    if (!auth) { removeTabAndPanel(); return; }

    var user = (typeof auth.getUser === 'function') ? auth.getUser() : null;
    if (!user) { removeTabAndPanel(); return; }

    if (typeof auth.isAdmin !== 'function') { removeTabAndPanel(); return; }

    Promise.resolve(auth.isAdmin()).then(function (ok) {
      if (ok) ensureTabAndPanel();
      else removeTabAndPanel();
    }).catch(function (err) {
      console.error('[VionaCustomers] isAdmin check failed:', err);
      removeTabAndPanel();
    });
  }

  // Debounce so several onChange events in a row do not spam isAdmin().
  function scheduleApply() {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(function () {
      applyTimer = null;
      applyAuthState();
    }, 60);
  }

  /* ==========================================================================
     10. BOOT
     ========================================================================== */
  function boot() {
    injectStyles();

    var auth = window.VionaAuth;
    if (!auth || typeof auth.ready !== 'function') {
      console.warn('[VionaCustomers] window.VionaAuth not found — customers tab disabled.');
      return;
    }

    Promise.resolve(auth.ready()).then(function (ok) {
      if (ok === false) {
        console.warn('[VionaCustomers] auth not ready — customers tab disabled.');
        return;
      }

      // One delegated listener for tab switches.
      var tabs = $('tabs');
      if (tabs) tabs.addEventListener('click', onTabsClick);

      // React to login / logout / profile changes.
      if (typeof auth.onChange === 'function') {
        auth.onChange(function () { scheduleApply(); });
      }

      // Also run once in case onChange does not fire immediately.
      scheduleApply();
    }).catch(function (err) {
      console.error('[VionaCustomers] auth ready failed:', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})();
