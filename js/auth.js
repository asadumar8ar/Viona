/* ============================================================================
   Viona Bangles — js/auth.js
   ----------------------------------------------------------------------------
   Shared login + account system. Used by BOTH the public website (index.html)
   and the admin panel (admin.html). Plain vanilla JS, no build step.

   Public API on window.VionaAuth:
     init()        -> Promise, sets everything up
     getUser()     -> current Supabase user object (or null)
     getProfile()  -> current customers row object (or null)
     openLogin()   -> opens the login / create-account modal
     openProfile() -> opens the profile editor (needs a logged-in user)
     logout()      -> signs out and cleans up
     onChange(cb)  -> fires cb(user, profile) on every auth change
     isAdmin()     -> Promise<boolean>, checks the admins table

   Bonus for other scripts:
     client        -> the shared Supabase client (supabase-js v2)
     ready()       -> Promise that resolves once init() is done

   Notes:
   - Reads SUPABASE_URL / SUPABASE_ANON_KEY / SITE_URL from window.VIONA_CONFIG.
   - Never stores passwords or personal data by hand. The Supabase session
     itself lives in browser storage — that is normal and handled by supabase-js.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIG CHECK
     ========================================================================== */
  var CFG = window.VIONA_CONFIG || {};

  function configProblem() {
    var url = CFG.SUPABASE_URL;
    var key = CFG.SUPABASE_ANON_KEY;

    if (!url || typeof url !== 'string' ||
        url.indexOf('https://') !== 0 ||
        url.indexOf('.supabase.co') === -1 ||
        url.indexOf('PASTE') !== -1) {
      return 'Supabase config check karo — js/config.js me SUPABASE_URL galat ya missing hai.';
    }
    if (!key || typeof key !== 'string' || key.length < 20 || key.indexOf('PASTE') !== -1) {
      return 'Supabase config check karo — js/config.js me SUPABASE_ANON_KEY galat ya missing hai.';
    }
    return null;
  }

  var CONFIG_ERROR = configProblem();

  /* ==========================================================================
     2. STATE
     ========================================================================== */
  var state = {
    sb: null,
    ready: false,
    user: null,
    profile: null,
    isAdmin: false,
    loginMode: 'customer',      // 'customer' or 'admin'
    listeners: [],
    profilePromptShown: false,  // show the "complete your profile" modal once per page load
    lastFocused: null,          // for focus restore after closing a modal
    dropdownOpen: false
  };

  /* ==========================================================================
     3. SMALL HELPERS
     ========================================================================== */
  function $(id) { return document.getElementById(id); }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isAdminPage() {
    return /admin\.html$/i.test(window.location.pathname || '');
  }

  function siteBase() {
    var s = CFG.SITE_URL || (window.location.origin + '/');
    return String(s).replace(/\/+$/, '');
  }

  function currentPageUrl() {
    return window.location.origin + window.location.pathname + window.location.search;
  }

  // Where Supabase should send the browser back after Google sign-in.
  function loginRedirectUrl() {
    if (state.loginMode === 'admin' || isAdminPage()) {
      return siteBase() + '/admin.html';
    }
    return currentPageUrl();
  }

  function friendlyAuthError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    var msg = String(err.message || err.error_description || err || '');
    var lower = msg.toLowerCase();

    if (lower.indexOf('invalid login credentials') !== -1) {
      return 'Wrong email or password. Please try again.';
    }
    if (lower.indexOf('email not confirmed') !== -1) {
      return 'Please confirm your email first — check your inbox.';
    }
    if (lower.indexOf('user already registered') !== -1 ||
        lower.indexOf('already been registered') !== -1 ||
        lower.indexOf('already exists') !== -1) {
      return 'This email is already registered. Please login instead.';
    }
    if (lower.indexOf('password should be at least') !== -1 ||
        lower.indexOf('weak password') !== -1) {
      return 'Password is too short. Use at least 6 characters.';
    }
    if (lower.indexOf('invalid email') !== -1) {
      return 'Please enter a valid email address.';
    }
    if (lower.indexOf('rate limit') !== -1 || lower.indexOf('too many') !== -1) {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (lower.indexOf('network') !== -1 || lower.indexOf('failed to fetch') !== -1) {
      return 'Network problem. Please check your internet and try again.';
    }
    return msg || 'Something went wrong. Please try again.';
  }

  /* ==========================================================================
     4. STYLE INJECTION
     ========================================================================== */
  var AUTH_CSS = '' +
    /* config banner (only shown if config is broken) */
    '.va-config-banner{position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'padding:12px 16px;background:#B3261E;color:#fff;' +
      'font:500 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.2)}' +

    /* backdrop + modal */
    '.va-backdrop{position:fixed;inset:0;z-index:10000;display:flex;' +
      'align-items:flex-end;justify-content:center;background:rgba(10,16,34,.62);' +
      '-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);' +
      'animation:vaFadeIn .2s ease}' +
    '.va-backdrop[hidden]{display:none!important}' +
    '@media (min-width:600px){.va-backdrop{align-items:center;padding:24px}}' +

    '.va-modal{position:relative;width:100%;max-width:440px;max-height:92vh;' +
      'overflow-y:auto;-webkit-overflow-scrolling:touch;background:#FFFFFF;' +
      'border-radius:20px 20px 0 0;padding:26px 22px 28px;' +
      'box-shadow:0 -10px 50px rgba(0,0,0,.3);animation:vaSlideUp .26s ease;' +
      'font-family:"Poppins",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'color:#0B1F3A}' +
    '@media (min-width:600px){.va-modal{border-radius:18px;padding:30px 28px;' +
      'animation:vaPopIn .22s ease}}' +

    '@keyframes vaFadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes vaSlideUp{from{transform:translateY(24px);opacity:0}' +
      'to{transform:translateY(0);opacity:1}}' +
    '@keyframes vaPopIn{from{transform:scale(.96);opacity:0}' +
      'to{transform:scale(1);opacity:1}}' +

    '.va-modal-close{position:absolute;top:12px;right:12px;width:36px;height:36px;' +
      'border:0;border-radius:50%;background:rgba(11,31,58,.06);color:#0B1F3A;' +
      'font-size:22px;line-height:1;display:grid;place-items:center;cursor:pointer;' +
      'transition:background .18s ease}' +
    '.va-modal-close:hover{background:rgba(201,162,75,.22)}' +

    '.va-modal-head{text-align:center;margin-bottom:18px}' +
    '.va-brand{font-family:"Playfair Display",Georgia,serif;font-size:26px;' +
      'font-weight:700;color:#C9A24B;letter-spacing:1px;margin-bottom:4px}' +
    '.va-modal-title{font-family:"Playfair Display",Georgia,serif;font-size:22px;' +
      'font-weight:600;color:#0B1F3A;margin:0 0 6px;line-height:1.25}' +
    '.va-modal-sub{font-size:13px;color:#5A6472;margin:0;line-height:1.5}' +

    /* tabs */
    '.va-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;' +
      'background:#F5F3EC;border-radius:12px;margin-bottom:16px}' +
    '.va-tab{border:0;background:transparent;padding:9px 12px;border-radius:9px;' +
      'font-family:inherit;font-size:13.5px;font-weight:500;color:#5A6472;' +
      'cursor:pointer;transition:background .2s ease,color .2s ease}' +
    '.va-tab:hover{color:#0B1F3A}' +
    '.va-tab.is-active{background:#FFFFFF;color:#0B1F3A;' +
      'box-shadow:0 2px 6px rgba(11,31,58,.08)}' +

    /* buttons */
    '.va-btn{display:inline-flex;align-items:center;justify-content:center;' +
      'gap:10px;width:100%;min-height:46px;padding:12px 18px;border:1px solid transparent;' +
      'border-radius:12px;font-family:inherit;font-size:14px;font-weight:500;' +
      'letter-spacing:.02em;cursor:pointer;text-align:center;' +
      'transition:transform .12s ease,box-shadow .2s ease,background .2s ease,border-color .2s ease}' +
    '.va-btn:active{transform:translateY(1px)}' +
    '.va-btn:disabled{opacity:.65;cursor:not-allowed;pointer-events:none}' +
    '.va-btn-gold{background:linear-gradient(180deg,#D4AF63 0%,#C9A24B 100%);' +
      'color:#0B1F3A;box-shadow:0 6px 20px rgba(201,162,75,.35)}' +
    '.va-btn-gold:hover{background:linear-gradient(180deg,#DCB972 0%,#C9A24B 100%)}' +
    '.va-btn-google{background:#FFFFFF;border-color:rgba(11,31,58,.18);color:#0B1F3A}' +
    '.va-btn-google:hover{border-color:#C9A24B}' +
    '.va-btn-google svg{width:18px;height:18px;flex:0 0 auto}' +

    '.va-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:#9A958C;' +
      'font-size:11px;letter-spacing:.16em;text-transform:uppercase}' +
    '.va-or::before,.va-or::after{content:"";flex:1;height:1px;' +
      'background:rgba(11,31,58,.1)}' +

    /* form fields */
    '.va-form{margin:0}' +
    '.va-field{display:block;margin-bottom:12px}' +
    '.va-field>span{display:block;font-size:12px;font-weight:500;color:#0B1F3A;' +
      'margin-bottom:6px;letter-spacing:.02em}' +
    '.va-field input{width:100%;padding:11px 13px;' +
      'border:1.4px solid rgba(11,31,58,.16);border-radius:10px;' +
      'background:#FFFFFF;color:#0B1F3A;font-family:inherit;font-size:14.5px;' +
      'line-height:1.4;transition:border-color .18s ease,box-shadow .18s ease;' +
      '-webkit-appearance:none;appearance:none}' +
    '.va-field input:focus{outline:0;border-color:#C9A24B;' +
      'box-shadow:0 0 0 3px rgba(201,162,75,.22)}' +
    '.va-field input[readonly]{background:#F5F3EC;color:#6B7280}' +

    '.va-error{margin:6px 0 10px;padding:9px 12px;background:#FDECEA;' +
      'border:1px solid #F4C7C2;border-radius:8px;font-size:12.5px;color:#B3261E;' +
      'line-height:1.5}' +
    '.va-error[hidden]{display:none!important}' +

    /* account button + dropdown */
    '.va-account-wrap{position:relative;display:inline-block}' +
    '.va-account-btn{display:inline-flex;align-items:center;gap:8px;' +
      'padding:9px 15px;border:1px solid rgba(201,162,75,.55);border-radius:999px;' +
      'background:transparent;color:#E3C87F;font-family:inherit;font-size:12.5px;' +
      'font-weight:500;letter-spacing:.06em;cursor:pointer;white-space:nowrap;' +
      'transition:background .2s ease,border-color .2s ease,color .2s ease}' +
    '.va-account-btn:hover{background:rgba(201,162,75,.14);border-color:#C9A24B}' +
    '.va-account-btn .va-account-icon{width:17px;height:17px;flex:0 0 auto}' +
    '.va-account-btn.is-signed-in{background:rgba(201,162,75,.12)}' +

    '.va-account-dropdown{position:absolute;top:calc(100% + 8px);right:0;z-index:500;' +
      'min-width:220px;background:#FFFFFF;border:1px solid rgba(11,31,58,.08);' +
      'border-radius:14px;box-shadow:0 16px 40px rgba(11,31,58,.18);padding:6px;' +
      'animation:vaPopIn .18s ease}' +
    '.va-account-dropdown[hidden]{display:none!important}' +
    '.va-account-head{padding:10px 12px 12px;' +
      'border-bottom:1px solid rgba(11,31,58,.07);margin-bottom:6px}' +
    '.va-account-name{margin:0 0 2px;font-size:13.5px;font-weight:600;color:#0B1F3A}' +
    '.va-account-email{margin:0;font-size:11.5px;color:#5A6472;word-break:break-all}' +
    '.va-account-item{display:block;width:100%;padding:10px 12px;border:0;' +
      'background:transparent;border-radius:9px;text-align:left;font-family:inherit;' +
      'font-size:13.5px;color:#0B1F3A;cursor:pointer;' +
      'transition:background .16s ease,color .16s ease}' +
    '.va-account-item:hover{background:rgba(201,162,75,.12)}' +
    '.va-account-item-danger{color:#B3261E}' +
    '.va-account-item-danger:hover{background:rgba(179,38,30,.08)}' +

    /* toast */
    '.va-toast{position:fixed;left:50%;bottom:24px;' +
      'transform:translateX(-50%) translateY(12px);z-index:99998;' +
      'max-width:calc(100vw - 32px);padding:12px 22px;background:#0B1F3A;' +
      'color:#E3C87F;border:1px solid rgba(201,162,75,.45);border-radius:999px;' +
      'font-family:"Poppins",system-ui,sans-serif;font-size:13.5px;text-align:center;' +
      'box-shadow:0 14px 40px rgba(0,0,0,.28);opacity:0;' +
      'transition:opacity .24s ease,transform .24s ease;pointer-events:none}' +
    '.va-toast[hidden]{display:none!important}' +
    '.va-toast.is-visible{opacity:1;transform:translateX(-50%) translateY(0)}' +
    '.va-toast.is-error{background:#B3261E;color:#FFFFFF;' +
      'border-color:rgba(255,255,255,.35)}' +

    'body.va-no-scroll{overflow:hidden}';

  function injectStyles() {
    if ($('vaAuthStyles')) return;
    var s = document.createElement('style');
    s.id = 'vaAuthStyles';
    s.appendChild(document.createTextNode(AUTH_CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  function showConfigBanner(msg) {
    if ($('vaConfigBanner')) return;
    var el = document.createElement('div');
    el.id = 'vaConfigBanner';
    el.className = 'va-config-banner';
    el.setAttribute('role', 'alert');
    el.textContent = String(msg || '');
    (document.body || document.documentElement).appendChild(el);
  }

  /* ==========================================================================
     5. MODAL MARKUP + INJECTION
     ========================================================================== */
  function googleIconSvg() {
    return '' +
      '<svg viewBox="0 0 48 48" aria-hidden="true">' +
        '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>' +
        '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>' +
        '<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z"/>' +
        '<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C36.9 40.3 44 35 44 24c0-1.2-.1-2.4-.4-3.5z"/>' +
      '</svg>';
  }

  function buildModals() {
    if ($('vaLoginModal')) return;

    var wrap = document.createElement('div');
    wrap.innerHTML =
      /* ---------- LOGIN / SIGNUP MODAL ---------- */
      '<div class="va-backdrop" id="vaLoginModal" hidden>' +
        '<div class="va-modal" role="dialog" aria-modal="true" aria-labelledby="vaLoginTitle">' +
          '<button type="button" class="va-modal-close" data-va-close aria-label="Close">×</button>' +
          '<div class="va-modal-head">' +
            '<div class="va-brand">Viona</div>' +
            '<h2 class="va-modal-title" id="vaLoginTitle">Welcome back</h2>' +
            '<p class="va-modal-sub" id="vaLoginSub">Login or create an account to continue.</p>' +
          '</div>' +

          '<div class="va-tabs" role="tablist">' +
            '<button type="button" class="va-tab is-active" data-va-tab="login" role="tab" aria-selected="true">Login</button>' +
            '<button type="button" class="va-tab" data-va-tab="signup" role="tab" aria-selected="false">Create Account</button>' +
          '</div>' +

          '<button type="button" class="va-btn va-btn-google" id="vaGoogleBtn">' +
            googleIconSvg() +
            '<span data-va-btn-label>Continue with Google</span>' +
          '</button>' +

          '<div class="va-or"><span>or</span></div>' +

          /* Login form */
          '<form class="va-form" id="vaLoginForm" novalidate>' +
            '<label class="va-field">' +
              '<span>Email</span>' +
              '<input type="email" id="vaLoginEmail" autocomplete="email" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Password</span>' +
              '<input type="password" id="vaLoginPassword" autocomplete="current-password" required />' +
            '</label>' +
            '<p class="va-error" id="vaLoginError" role="alert" hidden></p>' +
            '<button type="submit" class="va-btn va-btn-gold" id="vaLoginSubmit">Login</button>' +
          '</form>' +

          /* Signup form */
          '<form class="va-form" id="vaSignupForm" novalidate hidden>' +
            '<label class="va-field">' +
              '<span>Full name *</span>' +
              '<input type="text" id="vaSignupName" autocomplete="name" maxlength="80" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Mobile number *</span>' +
              '<input type="tel" id="vaSignupPhone" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="10 digit" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Email *</span>' +
              '<input type="email" id="vaSignupEmail" autocomplete="email" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Password *</span>' +
              '<input type="password" id="vaSignupPassword" autocomplete="new-password" minlength="6" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>City (optional)</span>' +
              '<input type="text" id="vaSignupCity" autocomplete="address-level2" maxlength="60" />' +
            '</label>' +
            '<p class="va-error" id="vaSignupError" role="alert" hidden></p>' +
            '<button type="submit" class="va-btn va-btn-gold" id="vaSignupSubmit">Create Account</button>' +
          '</form>' +
        '</div>' +
      '</div>' +

      /* ---------- PROFILE MODAL ---------- */
      '<div class="va-backdrop" id="vaProfileModal" hidden>' +
        '<div class="va-modal" role="dialog" aria-modal="true" aria-labelledby="vaProfileTitle">' +
          '<button type="button" class="va-modal-close" data-va-close aria-label="Close">×</button>' +
          '<div class="va-modal-head">' +
            '<div class="va-brand">Viona</div>' +
            '<h2 class="va-modal-title" id="vaProfileTitle">My Profile</h2>' +
            '<p class="va-modal-sub" id="vaProfileSub">Update your details below.</p>' +
          '</div>' +
          '<form class="va-form" id="vaProfileForm" novalidate>' +
            '<label class="va-field">' +
              '<span>Full name *</span>' +
              '<input type="text" id="vaProfileName" maxlength="80" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Mobile number *</span>' +
              '<input type="tel" id="vaProfilePhone" inputmode="numeric" maxlength="10" placeholder="10 digit" required />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>City</span>' +
              '<input type="text" id="vaProfileCity" maxlength="60" />' +
            '</label>' +
            '<label class="va-field">' +
              '<span>Email (read only)</span>' +
              '<input type="email" id="vaProfileEmail" readonly />' +
            '</label>' +
            '<p class="va-error" id="vaProfileError" role="alert" hidden></p>' +
            '<button type="submit" class="va-btn va-btn-gold" id="vaProfileSubmit">Save</button>' +
          '</form>' +
        '</div>' +
      '</div>' +

      /* ---------- TOAST ---------- */
      '<div class="va-toast" id="vaToast" role="status" aria-live="polite" hidden></div>';

    var frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    document.body.appendChild(frag);
  }

  /* ==========================================================================
     6. ACCOUNT BUTTON + DROPDOWN
     ========================================================================== */
  function buildAccountUI() {
    var mount = $('accountMount');
    if (!mount) return; // silently do nothing if not on the page

    mount.classList.add('va-account-wrap');
    mount.innerHTML = '';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'vaAccountBtn';
    btn.className = 'va-account-btn';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<svg class="va-account-icon" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="8" r="4"></circle>' +
        '<path d="M4 21c0-4 4-6 8-6s8 2 8 6"></path>' +
      '</svg>' +
      '<span class="va-account-label">Login</span>';
    mount.appendChild(btn);

    var dd = document.createElement('div');
    dd.id = 'vaAccountDropdown';
    dd.className = 'va-account-dropdown';
    dd.hidden = true;
    mount.appendChild(dd);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.user) toggleDropdown();
      else openLogin();
    });

    document.addEventListener('click', function (e) {
      if (!state.dropdownOpen) return;
      if (mount.contains(e.target)) return;
      closeDropdown();
    });

    updateAccountUI();
  }

  function updateAccountUI() {
    var btn = $('vaAccountBtn');
    var dd = $('vaAccountDropdown');
    if (!btn) return;

    var label = btn.querySelector('.va-account-label');

    if (state.user) {
      var meta = state.user.user_metadata || {};
      var name =
        (state.profile && state.profile.name) ||
        meta.full_name || meta.name || 'Account';
      var shortName = String(name).trim().split(/\s+/)[0] || 'Account';

      if (label) label.textContent = shortName;
      btn.classList.add('is-signed-in');

      if (dd) {
        dd.innerHTML =
          '<div class="va-account-head">' +
            '<p class="va-account-name">' + esc(name) + '</p>' +
            '<p class="va-account-email">' + esc(state.user.email || '') + '</p>' +
          '</div>' +
          '<button type="button" class="va-account-item" data-va-action="profile">My Profile</button>' +
          '<button type="button" class="va-account-item va-account-item-danger" data-va-action="logout">Logout</button>';
      }
    } else {
      if (label) label.textContent = 'Login';
      btn.classList.remove('is-signed-in');
      if (dd) dd.innerHTML = '';
    }
  }

  function toggleDropdown() {
    var dd = $('vaAccountDropdown');
    var btn = $('vaAccountBtn');
    if (!dd || !btn) return;
    state.dropdownOpen = !state.dropdownOpen;
    dd.hidden = !state.dropdownOpen;
    btn.setAttribute('aria-expanded', state.dropdownOpen ? 'true' : 'false');
  }

  function closeDropdown() {
    var dd = $('vaAccountDropdown');
    var btn = $('vaAccountBtn');
    if (dd) dd.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    state.dropdownOpen = false;
  }

  /* ==========================================================================
     7. SMALL UI HELPERS (busy / error / toast)
     ========================================================================== */
  function setBusy(btn, busy, label) {
    if (!btn) return;
    var textEl = btn.querySelector('[data-va-btn-label]') || btn;

    if (busy) {
      if (!textEl.dataset.vaOriginal) textEl.dataset.vaOriginal = textEl.textContent;
      btn.disabled = true;
      btn.classList.add('is-loading');
      textEl.textContent = label || 'Please wait…';
    } else {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      if (textEl.dataset.vaOriginal) {
        textEl.textContent = textEl.dataset.vaOriginal;
        delete textEl.dataset.vaOriginal;
      }
    }
  }

  function showError(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = String(msg || '');
    el.hidden = false;
  }

  function clearError(id) {
    var el = $(id);
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  var toastTimer = null;
  function showToast(msg, kind) {
    var el = $('vaToast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.className = 'va-toast' + (kind === 'error' ? ' is-error' : '');
    el.hidden = false;
    void el.offsetWidth; // reflow so the transition runs
    el.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-visible');
      setTimeout(function () { el.hidden = true; }, 260);
    }, 3200);
  }

  /* ==========================================================================
     8. MODAL OPEN / CLOSE + FOCUS TRAP
     ========================================================================== */
  function lockScroll() {
    document.body.classList.add('va-no-scroll');
  }

  function unlockScrollIfClear() {
    if (!document.querySelector('.va-backdrop:not([hidden])')) {
      document.body.classList.remove('va-no-scroll');
    }
  }

  function restoreFocus() {
    if (state.lastFocused && state.lastFocused.focus) {
      try { state.lastFocused.focus(); } catch (e) { /* ignore */ }
    }
    state.lastFocused = null;
  }

  function openLogin(opts) {
    opts = opts || {};
    state.loginMode = (opts.mode === 'admin' || isAdminPage()) ? 'admin' : 'customer';

    var m = $('vaLoginModal');
    if (!m) return;

    state.lastFocused = document.activeElement;

    // Always start on the Login tab and clear previous state
    switchTab('login');
    clearError('vaLoginError');
    clearError('vaSignupError');

    var lp = $('vaLoginPassword'); if (lp) lp.value = '';
    var sp = $('vaSignupPassword'); if (sp) sp.value = '';

    var sub = $('vaLoginSub');
    if (sub) {
      sub.textContent = (state.loginMode === 'admin')
        ? 'Sign in with your admin account.'
        : 'Login or create an account to continue.';
    }

    m.hidden = false;
    lockScroll();

    setTimeout(function () {
      var focusEl = (state.loginMode === 'admin') ? $('vaGoogleBtn') : $('vaLoginEmail');
      if (focusEl && focusEl.focus) {
        try { focusEl.focus(); } catch (e) { /* ignore */ }
      }
    }, 60);
  }

  function closeLogin() {
    var m = $('vaLoginModal');
    if (m) m.hidden = true;
    unlockScrollIfClear();
    restoreFocus();
  }

  function openProfile(isCompletion) {
    if (!state.user) {
      openLogin();
      return;
    }

    var m = $('vaProfileModal');
    if (!m) return;

    state.lastFocused = document.activeElement;

    var p = state.profile || {};
    var meta = state.user.user_metadata || {};

    var nameEl = $('vaProfileName');
    var phoneEl = $('vaProfilePhone');
    var cityEl = $('vaProfileCity');
    var emailEl = $('vaProfileEmail');
    var titleEl = $('vaProfileTitle');
    var subEl = $('vaProfileSub');

    var initialName = p.name || meta.full_name || meta.name || '';
    var initialPhone = String(p.phone || meta.phone || '').replace(/\D/g, '').slice(0, 10);
    var initialCity = p.city || meta.city || '';

    if (nameEl) nameEl.value = initialName;
    if (phoneEl) phoneEl.value = initialPhone;
    if (cityEl) cityEl.value = initialCity;
    if (emailEl) emailEl.value = state.user.email || '';

    var missing = !initialName || !initialPhone;
    if (titleEl) titleEl.textContent = missing ? 'Complete your profile' : 'My Profile';
    if (subEl) {
      subEl.textContent = missing
        ? 'Please add your name and mobile number to continue.'
        : 'Update your details below.';
    }

    clearError('vaProfileError');

    m.hidden = false;
    lockScroll();

    setTimeout(function () {
      var focusEl = !initialName ? nameEl : (!initialPhone ? phoneEl : nameEl);
      if (focusEl && focusEl.focus) {
        try { focusEl.focus(); } catch (e) { /* ignore */ }
      }
    }, 60);
  }

  function closeProfile() {
    var m = $('vaProfileModal');
    if (m) m.hidden = true;
    unlockScrollIfClear();
    restoreFocus();
  }

  // Global focus-trap + Escape handler (attached once)
  function attachGlobalKeyHandler() {
    document.addEventListener('keydown', function (e) {
      var openModal = document.querySelector('.va-backdrop:not([hidden])');
      if (!openModal) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (openModal.id === 'vaLoginModal') closeLogin();
        else if (openModal.id === 'vaProfileModal') closeProfile();
        return;
      }

      if (e.key !== 'Tab') return;

      var focusables = $$(
        'a[href], button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        openModal
      ).filter(function (el) {
        return el.offsetParent !== null && el.getClientRects().length > 0;
      });

      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ==========================================================================
     9. TABS + FORM WIRING
     ========================================================================== */
  function switchTab(name) {
    var loginForm = $('vaLoginForm');
    var signupForm = $('vaSignupForm');
    var loginTab = document.querySelector('[data-va-tab="login"]');
    var signupTab = document.querySelector('[data-va-tab="signup"]');

    if (name === 'signup') {
      if (loginForm) loginForm.hidden = true;
      if (signupForm) signupForm.hidden = false;
      if (loginTab) { loginTab.classList.remove('is-active'); loginTab.setAttribute('aria-selected', 'false'); }
      if (signupTab) { signupTab.classList.add('is-active'); signupTab.setAttribute('aria-selected', 'true'); }
      setTimeout(function () {
        var n = $('vaSignupName');
        if (n) try { n.focus(); } catch (e) { /* ignore */ }
      }, 40);
    } else {
      if (loginForm) loginForm.hidden = false;
      if (signupForm) signupForm.hidden = true;
      if (loginTab) { loginTab.classList.add('is-active'); loginTab.setAttribute('aria-selected', 'true'); }
      if (signupTab) { signupTab.classList.remove('is-active'); signupTab.setAttribute('aria-selected', 'false'); }
    }
  }

  function wireModals() {
    // Close buttons + backdrop clicks
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var closeBtn = t.closest('[data-va-close]');
      if (closeBtn) {
        var modal = closeBtn.closest('.va-backdrop');
        if (!modal) return;
        if (modal.id === 'vaLoginModal') closeLogin();
        else if (modal.id === 'vaProfileModal') closeProfile();
        return;
      }

      if (t.classList && t.classList.contains('va-backdrop')) {
        if (t.id === 'vaLoginModal') closeLogin();
        else if (t.id === 'vaProfileModal') closeProfile();
      }
    });

    // Tabs
    $$('[data-va-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTab(tab.getAttribute('data-va-tab'));
      });
    });

    // Google button
    var g = $('vaGoogleBtn');
    if (g) g.addEventListener('click', onGoogleClick);

    // Forms
    var lf = $('vaLoginForm');
    if (lf) lf.addEventListener('submit', onLoginSubmit);

    var sf = $('vaSignupForm');
    if (sf) sf.addEventListener('submit', onSignupSubmit);

    var pf = $('vaProfileForm');
    if (pf) pf.addEventListener('submit', onProfileSubmit);

    // Phone inputs: digits only, max 10
    ['vaSignupPhone', 'vaProfilePhone'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var v = String(el.value || '').replace(/\D/g, '').slice(0, 10);
        if (v !== el.value) el.value = v;
      });
    });

    // Account dropdown actions (My Profile / Logout)
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var item = t.closest('[data-va-action]');
      if (!item) return;
      var action = item.getAttribute('data-va-action');
      if (action === 'profile') { closeDropdown(); openProfile(); }
      else if (action === 'logout') { closeDropdown(); logout(); }
    });
  }

  /* ==========================================================================
     10. AUTH ACTIONS
     ========================================================================== */
  async function onGoogleClick() {
    var btn = $('vaGoogleBtn');
    setBusy(btn, true, 'Redirecting…');
    try {
      var res = await state.sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: loginRedirectUrl() }
      });
      if (res && res.error) throw res.error;
      // Browser will navigate away. Keep button busy so the user cannot double click.
    } catch (err) {
      setBusy(btn, false);
      var msg = friendlyAuthError(err);
      if ($('vaLoginModal') && !$('vaLoginModal').hidden) showError('vaLoginError', msg);
      else showToast(msg, 'error');
    }
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    clearError('vaLoginError');

    var email = String(($('vaLoginEmail') || {}).value || '').trim();
    var password = String(($('vaLoginPassword') || {}).value || '');
    var btn = $('vaLoginSubmit');

    if (!email || !password) {
      showError('vaLoginError', 'Please enter your email and password.');
      return;
    }

    setBusy(btn, true, 'Logging in…');
    try {
      var res = await state.sb.auth.signInWithPassword({ email: email, password: password });
      if (res && res.error) throw res.error;

      // On the admin page we also verify the account is an admin here.
      if (state.loginMode === 'admin' || isAdminPage()) {
        var adminOk = await checkIsAdmin(email);
        if (!adminOk) {
          try { await state.sb.auth.signOut(); } catch (e) { /* ignore */ }
          showError('vaLoginError', 'This account is not an admin. Please use an admin email.');
          return;
        }
      }

      closeLogin();
      showToast('Welcome back!');
      // handleAuthChange will run automatically via onAuthStateChange.
    } catch (err) {
      showError('vaLoginError', friendlyAuthError(err));
    } finally {
      setBusy(btn, false);
    }
  }

  async function onSignupSubmit(e) {
    e.preventDefault();
    clearError('vaSignupError');

    var name = String(($('vaSignupName') || {}).value || '').trim();
    var phone = String(($('vaSignupPhone') || {}).value || '').replace(/\D/g, '');
    var email = String(($('vaSignupEmail') || {}).value || '').trim();
    var password = String(($('vaSignupPassword') || {}).value || '');
    var city = String(($('vaSignupCity') || {}).value || '').trim();
    var btn = $('vaSignupSubmit');

    if (!name) { showError('vaSignupError', 'Please enter your full name.'); return; }
    if (!/^\d{10}$/.test(phone)) {
      showError('vaSignupError', 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showError('vaSignupError', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      showError('vaSignupError', 'Password must be at least 6 characters.');
      return;
    }

    setBusy(btn, true, 'Creating account…');
    try {
      var res = await state.sb.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: name,
            phone: phone,
            city: city
          }
        }
      });
      if (res && res.error) throw res.error;

      if (res.data && res.data.session) {
        // Auto-confirmed: user is logged in right away.
        closeLogin();
        showToast('Welcome to Viona Bangles!');
        // handleAuthChange will create the customers row.
      } else {
        // Email confirmation required by the Supabase project.
        closeLogin();
        showToast('Account created. Please check your email to confirm.');
      }
    } catch (err) {
      showError('vaSignupError', friendlyAuthError(err));
    } finally {
      setBusy(btn, false);
    }
  }

  async function onProfileSubmit(e) {
    e.preventDefault();
    clearError('vaProfileError');

    var name = String(($('vaProfileName') || {}).value || '').trim();
    var phone = String(($('vaProfilePhone') || {}).value || '').replace(/\D/g, '');
    var city = String(($('vaProfileCity') || {}).value || '').trim();
    var btn = $('vaProfileSubmit');

    if (!name) { showError('vaProfileError', 'Please enter your full name.'); return; }
    if (!/^\d{10}$/.test(phone)) {
      showError('vaProfileError', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!state.user) { closeProfile(); return; }

    setBusy(btn, true, 'Saving…');
    try {
      var payload = {
        id: state.user.id,
        name: name,
        phone: phone,
        city: city,
        email: state.user.email || ''
      };
      var res = await state.sb
        .from('customers')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (res && res.error) throw res.error;

      state.profile = res.data || payload;
      closeProfile();
      showToast('Profile saved.');
      emitChange();
      updateAccountUI();
    } catch (err) {
      showError('vaProfileError', (err && err.message) || 'Could not save. Please try again.');
    } finally {
      setBusy(btn, false);
    }
  }

  async function logout() {
    try {
      if (state.sb) await state.sb.auth.signOut();
    } catch (e) { /* ignore */ }

    state.user = null;
    state.profile = null;
    state.isAdmin = false;
    state.profilePromptShown = false;

    updateAccountUI();
    emitChange();
    showToast('Logged out.');

    // On the admin page, admin.js will show the login screen automatically
    // via onChange / onAuthStateChange. No page redirect needed.
  }

  /* ==========================================================================
     11. SUPABASE DATA HELPERS
     ========================================================================== */
  async function checkIsAdmin(email) {
    if (!email || !state.sb) return false;
    var target = String(email).toLowerCase();
    try {
      var res = await state.sb.from('admins').select('email');
      if (res && res.error) return false;
      var rows = Array.isArray(res.data) ? res.data : [];
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].email || '').toLowerCase() === target) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function fetchProfile(user) {
    if (!user || !state.sb) return null;
    try {
      var res = await state.sb
        .from('customers')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (res && res.error && res.error.code !== 'PGRST116') {
        console.warn('[VionaAuth] profile fetch failed:', res.error.message);
      }
      return (res && res.data) || null;
    } catch (e) {
      return null;
    }
  }

  async function createProfileIfMissing(user, existing) {
    if (!user || !state.sb) return existing;
    var meta = user.user_metadata || {};

    var base = {
      id: user.id,
      name: (existing && existing.name) || meta.full_name || meta.name || '',
      phone: String((existing && existing.phone) || meta.phone || '').replace(/\D/g, '').slice(0, 10),
      email: (existing && existing.email) || user.email || '',
      city: (existing && existing.city) || meta.city || ''
    };

    if (existing) {
      // If some fields are empty but metadata has them, quietly backfill.
      var patch = {};
      var changed = false;
      if (!existing.name && base.name) { patch.name = base.name; changed = true; }
      if (!existing.phone && base.phone) { patch.phone = base.phone; changed = true; }
      if (!existing.email && base.email) { patch.email = base.email; changed = true; }
      if (!existing.city && base.city) { patch.city = base.city; changed = true; }

      if (changed) {
        try {
          var upd = await state.sb
            .from('customers')
            .update(patch)
            .eq('id', user.id)
            .select()
            .single();
          if (upd && !upd.error && upd.data) return upd.data;
        } catch (e) { /* ignore */ }
      }
      return existing;
    }

    // No row yet — create one.
    try {
      var ins = await state.sb
        .from('customers')
        .insert(base)
        .select()
        .single();

      if (ins && !ins.error && ins.data) return ins.data;

      // Race condition: maybe the row was created just now.
      var again = await fetchProfile(user);
      if (again) return again;
    } catch (e) { /* ignore */ }

    // Fall back to an in-memory object (no DB row yet).
    return base;
  }

  async function syncProfile(user) {
    if (!user) { state.profile = null; return null; }
    var existing = await fetchProfile(user);
    var row = await createProfileIfMissing(user, existing);
    state.profile = row;
    return row;
  }

  function profileNeedsInfo() {
    if (!state.user) return false;
    var p = state.profile || {};
    var name = String(p.name || '').trim();
    var phone = String(p.phone || '').replace(/\D/g, '');
    return !name || phone.length !== 10;
  }

  /* ==========================================================================
     12. AUTH STATE HANDLING
     ========================================================================== */
  function emitChange() {
    var list = state.listeners.slice();
    list.forEach(function (cb) {
      try { cb(state.user, state.profile); }
      catch (e) { console.warn('[VionaAuth] listener error:', e); }
    });
  }

  async function handleAuthChange(session) {
    var user = (session && session.user) ? session.user : null;

    // Same user as before? Refresh profile quietly and move on.
    if (user && state.user && user.id === state.user.id) {
      try { await syncProfile(user); } catch (e) { /* ignore */ }
      return;
    }

    state.user = user;

    if (!user) {
      state.profile = null;
      state.isAdmin = false;
      state.profilePromptShown = false;
      updateAccountUI();
      emitChange();
      return;
    }

    // New signed-in user — fetch profile + admin status.
    try { await syncProfile(user); } catch (e) { /* ignore */ }
    try { state.isAdmin = await checkIsAdmin(user.email); } catch (e) { state.isAdmin = false; }

    updateAccountUI();
    emitChange();

    // Ask for name + phone if missing (only on the public site, only once).
    if (!isAdminPage() && !state.profilePromptShown && profileNeedsInfo()) {
      state.profilePromptShown = true;
      setTimeout(function () { openProfile(true); }, 450);
    }
  }

  /* ==========================================================================
     13. BOOT
     ========================================================================== */
  var _initPromise = null;

  function doInit() {
    return new Promise(function (resolve) {
      function run() {
        injectStyles();

        if (CONFIG_ERROR) {
          showConfigBanner(CONFIG_ERROR);
          resolve(false);
          return;
        }

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
          showConfigBanner(
            'Supabase library load nahi hui. Internet check karo aur page reload karo.'
          );
          resolve(false);
          return;
        }

        try {
          state.sb = window.supabase.createClient(
            CFG.SUPABASE_URL,
            CFG.SUPABASE_ANON_KEY,
            {
              auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
              }
            }
          );
        } catch (e) {
          showConfigBanner(
            'Supabase start nahi ho paya. ' + (e && e.message ? e.message : '')
          );
          resolve(false);
          return;
        }

        buildModals();
        buildAccountUI();
        wireModals();
        attachGlobalKeyHandler();

        try {
          state.sb.auth.onAuthStateChange(function (_event, session) {
            // Defer so supabase-js internals are not blocked.
            setTimeout(function () {
              handleAuthChange(session).catch(function (e) {
                console.warn('[VionaAuth] auth change failed:', e);
              });
            }, 0);
          });
        } catch (e) {
          console.warn('[VionaAuth] could not subscribe to auth changes:', e);
        }

        (async function initialSession() {
          try {
            var res = await state.sb.auth.getSession();
            var session = (res && res.data) ? res.data.session : null;
            await handleAuthChange(session);
          } catch (e) {
            // Ignore — UI simply stays in the logged-out state.
          }
          resolve(true);
        })();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    });
  }

  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = doInit().then(function (ok) {
      state.ready = true;
      return ok;
    });
    return _initPromise;
  }

  /* ==========================================================================
     14. PUBLIC API
     ========================================================================== */
  window.VionaAuth = {
    // Setup
    init: init,
    ready: function () { return init(); },

    // Read state
    getUser: function () { return state.user; },
    getProfile: function () { return state.profile; },
    isAdmin: function () {
      if (!state.user) return Promise.resolve(false);
      return checkIsAdmin(state.user.email);
    },

    // UI
    openLogin: function (opts) { return openLogin(opts); },
    openProfile: function () { return openProfile(false); },
    logout: function () { return logout(); },

    // Listen to changes
    onChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      state.listeners.push(cb);

      // Fire once asynchronously so the caller sees the current state.
      if (state.ready) {
        setTimeout(function () {
          try { cb(state.user, state.profile); } catch (e) { /* ignore */ }
        }, 0);
      }

      return function off() {
        var i = state.listeners.indexOf(cb);
        if (i !== -1) state.listeners.splice(i, 1);
      };
    },

    // Bonus for other scripts (script.js, admin.js can reuse this client)
    get client() { return state.sb; }
  };

})();
