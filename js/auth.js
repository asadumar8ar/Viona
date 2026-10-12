/* ============================================================================
   Viona Bangles — js/auth.js
   ----------------------------------------------------------------------------
   Shared login + account system. Used by BOTH the public website (index.html)
   and the admin panel (admin.html). Plain vanilla JS, no build step.

   Public API on window.VionaAuth:
     init()           -> Promise, sets everything up
     getUser()        -> current Supabase user object (or null)
     getProfile()     -> current customers row object (or null)
     refreshProfile() -> re-fetch the customers row, return it
     openLogin()      -> opens the login / create-account modal
     openProfile()    -> opens the profile editor (needs a logged-in user)
     logout()         -> signs out and cleans up
     onChange(cb)     -> fires cb(user, profile) on every auth change
     isAdmin()        -> Promise<boolean>, checks the admins table

   Bonus for other scripts:
     client           -> the shared Supabase client (supabase-js v2)
     ready()          -> Promise that resolves once init() is done

   Notes:
   - Reads SUPABASE_URL / SUPABASE_ANON_KEY from window.VIONA_CONFIG.
     There is NO SITE_URL key — redirect URLs are always built from
     window.location.origin.
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
    isAdminFlag: false,
    listeners: [],
    lastFocused: null,
    dropdownOpen: false,
    pendingAvatarBlob: null,      // compressed blob waiting to be uploaded on Save
    pendingAvatarPreview: '',     // object URL for preview
    pendingAvatarRemove: false,   // user clicked "Remove photo"
    promptedThisSession: false
  };

  var PROMPT_KEY = 'viona_profile_prompted';

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

  // Where Supabase should send the browser back after Google sign-in.
  function loginRedirectUrl() {
    if (isAdminPage()) {
      return window.location.origin + '/admin.html';
    }
    return window.location.origin + window.location.pathname;
  }

  function friendlyAuthError(err) {
    if (!err) return 'Kuch galat ho gaya. Please try again.';
    var msg = String(err.message || err.error_description || err || '');
    var lower = msg.toLowerCase();

    if (lower.indexOf('email not confirmed') !== -1) {
      return 'Email abhi confirm nahi hua. Neeche "Resend email" tap karo.';
    }
    if (lower.indexOf('invalid login credentials') !== -1) {
      return 'Email ya password galat hai.';
    }
    if (lower.indexOf('user already registered') !== -1 ||
        lower.indexOf('already been registered') !== -1 ||
        lower.indexOf('already exists') !== -1) {
      return 'Ye email pehle se registered hai. Login karo.';
    }
    if (lower.indexOf('password should be at least') !== -1 ||
        lower.indexOf('weak password') !== -1) {
      return 'Password chhota hai. Kam se kam 6 characters daalo.';
    }
    if (lower.indexOf('invalid email') !== -1) {
      return 'Valid email address daalo.';
    }
    if (lower.indexOf('rate limit') !== -1 || lower.indexOf('too many') !== -1) {
      return 'Bahut attempts ho gaye. Ek minute ruk ke try karo.';
    }
    if (lower.indexOf('network') !== -1 || lower.indexOf('failed to fetch') !== -1) {
      return 'Network problem. Internet check karo.';
    }
    return msg || 'Kuch galat ho gaya. Please try again.';
  }

  function friendlyStorageError(err) {
    if (!err) return 'Upload failed.';
    var msg = String(err.message || err.error_description || err || '');
    var lower = msg.toLowerCase();
    if (lower.indexOf('bucket') !== -1 && lower.indexOf('not found') !== -1) {
      return 'Storage bucket "avatars" nahi mila. Supabase me bucket banao (public).';
    }
    if (lower.indexOf('row-level security') !== -1 ||
        lower.indexOf('permission') !== -1 ||
        lower.indexOf('not allowed') !== -1) {
      return 'Upload permission nahi hai. Supabase storage policies check karo.';
    }
    if (lower.indexOf('exceeded') !== -1 || lower.indexOf('too large') !== -1) {
      return 'Photo bahut badi hai. 2 MB se chhoti chuno.';
    }
    return msg || 'Upload failed.';
  }

  /* ==========================================================================
     4. STYLE INJECTION
     ========================================================================== */
  var AUTH_CSS = '' +
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

    '.va-modal{position:relative;width:100%;max-width:440px;max-height:90vh;' +
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
    '.va-btn-ghost{background:#FFFFFF;border-color:rgba(11,31,58,.18);color:#0B1F3A}' +
    '.va-btn-ghost:hover{border-color:#C9A24B;color:#C9A24B}' +
    '.va-btn-danger-text{color:#B3261E;border-color:rgba(179,38,30,.35)}' +
    '.va-btn-danger-text:hover{background:rgba(179,38,30,.06);border-color:#B3261E;color:#B3261E}' +
    '.va-btn-small{min-height:38px;font-size:13px;padding:9px 14px;width:auto}' +

    '.va-row{display:flex;gap:10px;margin-top:6px}' +
    '.va-row .va-btn{flex:1 1 0;min-width:0}' +

    '.va-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:#9A958C;' +
      'font-size:11px;letter-spacing:.16em;text-transform:uppercase}' +
    '.va-or::before,.va-or::after{content:"";flex:1;height:1px;' +
      'background:rgba(11,31,58,.1)}' +

    /* form fields */
    '.va-form{margin:0}' +
    '.va-field{display:block;margin-bottom:12px}' +
    '.va-field>span:first-child{display:block;font-size:12px;font-weight:500;color:#0B1F3A;' +
      'margin-bottom:6px;letter-spacing:.02em}' +
    '.va-field input,.va-field select{width:100%;padding:11px 13px;' +
      'border:1.4px solid rgba(11,31,58,.16);border-radius:10px;' +
      'background:#FFFFFF;color:#0B1F3A;font-family:inherit;font-size:14.5px;' +
      'line-height:1.4;transition:border-color .18s ease,box-shadow .18s ease;' +
      '-webkit-appearance:none;appearance:none}' +
    '.va-field input:focus,.va-field select:focus{outline:0;border-color:#C9A24B;' +
      'box-shadow:0 0 0 3px rgba(201,162,75,.22)}' +
    '.va-field input[readonly]{background:#F5F3EC;color:#6B7280}' +

    '.va-input-wrap{position:relative;display:block}' +
    '.va-input-wrap input{padding-right:44px}' +
    '.va-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);' +
      'width:34px;height:34px;border:0;background:transparent;border-radius:8px;' +
      'cursor:pointer;display:grid;place-items:center;color:#5A6472;padding:0}' +
    '.va-eye:hover{background:rgba(11,31,58,.05);color:#0B1F3A}' +
    '.va-eye svg{width:18px;height:18px}' +

    '.va-error{margin:6px 0 10px;padding:9px 12px;background:#FDECEA;' +
      'border:1px solid #F4C7C2;border-radius:8px;font-size:12.5px;color:#B3261E;' +
      'line-height:1.5}' +
    '.va-error[hidden]{display:none!important}' +

    '.va-info{margin:6px 0 10px;padding:10px 12px;background:#FFF6E5;' +
      'border:1px solid #F2D9A4;border-radius:8px;font-size:12.5px;color:#7A4B00;' +
      'line-height:1.55}' +
    '.va-info[hidden]{display:none!important}' +
    '.va-link{color:#0B1F3A;text-decoration:underline;font-weight:600;' +
      'cursor:pointer;background:none;border:0;padding:0;font:inherit}' +
    '.va-link:hover{color:#C9A24B}' +

    /* avatar block in profile modal */
    '.va-avatar-block{display:flex;flex-direction:column;align-items:center;' +
      'gap:10px;margin:0 0 18px}' +
    '.va-avatar-preview{width:96px;height:96px;border-radius:50%;overflow:hidden;' +
      'background:#F5F3EC;border:2px solid #C9A24B;display:grid;place-items:center;' +
      'position:relative}' +
    '.va-avatar-preview img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.va-avatar-preview span{font-family:"Playfair Display",Georgia,serif;' +
      'font-size:36px;font-weight:700;color:#C9A24B;line-height:1}' +
    '.va-avatar-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}' +
    '.va-avatar-hint{margin:0;font-size:11.5px;color:#8A8F98;text-align:center}' +

    /* account button + dropdown (public site header) */
    '.va-account-wrap{position:relative;display:inline-block}' +
    '.va-account-btn{display:inline-flex;align-items:center;gap:8px;' +
      'padding:6px 12px 6px 6px;border:1px solid rgba(201,162,75,.55);' +
      'border-radius:999px;background:transparent;color:#E3C87F;' +
      'font-family:inherit;font-size:12.5px;font-weight:500;' +
      'letter-spacing:.04em;cursor:pointer;white-space:nowrap;' +
      'transition:background .2s ease,border-color .2s ease,color .2s ease}' +
    '.va-account-btn:hover{background:rgba(201,162,75,.14);border-color:#C9A24B}' +
    '.va-account-btn.is-signed-in{background:rgba(201,162,75,.12)}' +
    '.va-account-avatar,.va-account-letter{width:26px;height:26px;border-radius:50%;' +
      'flex:0 0 auto;overflow:hidden;display:grid;place-items:center}' +
    '.va-account-avatar img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.va-account-letter{background:#0B1F3A;color:#E3C87F;font-weight:600;' +
      'font-size:12px;border:1px solid rgba(201,162,75,.55)}' +
    '.va-account-label{max-width:110px;overflow:hidden;text-overflow:ellipsis}' +

    '.va-account-dropdown{position:absolute;top:calc(100% + 8px);right:0;z-index:500;' +
      'min-width:220px;background:#FFFFFF;border:1px solid rgba(11,31,58,.08);' +
      'border-radius:14px;box-shadow:0 16px 40px rgba(11,31,58,.18);padding:6px;' +
      'animation:vaPopIn .18s ease}' +
    '.va-account-dropdown[hidden]{display:none!important}' +
    '.va-account-head{display:flex;align-items:center;gap:10px;padding:10px 10px 12px;' +
      'border-bottom:1px solid rgba(11,31,58,.07);margin-bottom:6px}' +
    '.va-account-head .va-account-avatar,.va-account-head .va-account-letter' +
      '{width:34px;height:34px;font-size:14px}' +
    '.va-account-head-text{min-width:0}' +
    '.va-account-name{margin:0 0 2px;font-size:13.5px;font-weight:600;color:#0B1F3A;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
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
     5. MODAL MARKUP
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

  function eyeIconSvg(open) {
    if (open) {
      // eye-off
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6 0-10-5-10-8 0-1.24.5-2.5 1.35-3.62"/><path d="M6.06 6.06C7.94 4.79 10 4 12 4c6 0 10 5 10 8 0 1.1-.4 2.24-1.11 3.32"/><path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
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
            '<h2 class="va-modal-title" id="vaLoginTitle">Welcome</h2>' +
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
              '<span class="va-input-wrap">' +
                '<input type="password" id="vaLoginPassword" autocomplete="current-password" required />' +
                '<button type="button" class="va-eye" data-eye="vaLoginPassword" aria-label="Show password">' +
                  eyeIconSvg(true) +
                '</button>' +
              '</span>' +
            '</label>' +
            '<p class="va-error" id="vaLoginError" role="alert" hidden></p>' +
            '<p class="va-info" id="vaLoginResendWrap" hidden>' +
              'Email confirm nahi hua. <button type="button" class="va-link" id="vaLoginResendBtn">Resend email</button>' +
            '</p>' +
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
              '<span class="va-input-wrap">' +
                '<input type="password" id="vaSignupPassword" autocomplete="new-password" minlength="6" required />' +
                '<button type="button" class="va-eye" data-eye="vaSignupPassword" aria-label="Show password">' +
                  eyeIconSvg(true) +
                '</button>' +
              '</span>' +
            '</label>' +
            '<label class="va-field">' +
              '<span>City (optional)</span>' +
              '<input type="text" id="vaSignupCity" autocomplete="address-level2" maxlength="60" />' +
            '</label>' +
            '<p class="va-error" id="vaSignupError" role="alert" hidden></p>' +
            '<p class="va-info" id="vaSignupInfo" hidden></p>' +
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

          '<div class="va-avatar-block">' +
            '<div class="va-avatar-preview" id="vaAvatarPreview">' +
              '<img id="vaAvatarImg" alt="" hidden />' +
              '<span id="vaAvatarLetter">V</span>' +
            '</div>' +
            '<div class="va-avatar-actions">' +
              '<label class="va-btn va-btn-ghost va-btn-small">' +
                '<input type="file" id="vaAvatarInput" accept="image/jpeg,image/png,image/webp" hidden />' +
                '<span>Change photo</span>' +
              '</label>' +
              '<button type="button" class="va-btn va-btn-ghost va-btn-small va-btn-danger-text" id="vaAvatarRemove">Remove photo</button>' +
            '</div>' +
            '<p class="va-avatar-hint">JPG, PNG or WEBP. Max 2 MB.</p>' +
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
            '<div class="va-row">' +
              '<button type="submit" class="va-btn va-btn-gold" id="vaProfileSubmit">Save</button>' +
              '<button type="button" class="va-btn va-btn-ghost" id="vaProfileLogout">Logout</button>' +
            '</div>' +
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

  function avatarUrlForCurrentUser() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    return String(p.avatar_url || meta.avatar_url || meta.picture || '').trim();
  }

  function displayNameForCurrentUser() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    var n = String(p.name || meta.full_name || meta.name || '').trim();
    if (!n && state.user && state.user.email) n = String(state.user.email).split('@')[0];
    return n || 'Account';
  }

  function updateAccountUI() {
    var btn = $('vaAccountBtn');
    var dd = $('vaAccountDropdown');
    if (!btn) return;

    if (state.user) {
      var name = displayNameForCurrentUser();
      var firstName = String(name).trim().split(/\s+/)[0] || 'Account';
      var url = avatarUrlForCurrentUser();
      var initial = (firstName.charAt(0) || 'V').toUpperCase();

      var avatarHtml = url
        ? '<span class="va-account-avatar"><img src="' + esc(url) + '" alt="" ' +
          'onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=&quot;va-account-letter&quot;>' + esc(initial) + '</span>\';" /></span>'
        : '<span class="va-account-letter">' + esc(initial) + '</span>';

      btn.innerHTML =
        avatarHtml +
        '<span class="va-account-label">' + esc(firstName) + '</span>';
      btn.classList.add('is-signed-in');

      if (dd) {
        var headAvatar = url
          ? '<span class="va-account-avatar"><img src="' + esc(url) + '" alt="" /></span>'
          : '<span class="va-account-letter">' + esc(initial) + '</span>';

        dd.innerHTML =
          '<div class="va-account-head">' +
            headAvatar +
            '<div class="va-account-head-text">' +
              '<p class="va-account-name">' + esc(name) + '</p>' +
              '<p class="va-account-email">' + esc(state.user.email || '') + '</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="va-account-item" data-va-action="profile">My Profile</button>' +
          '<button type="button" class="va-account-item va-account-item-danger" data-va-action="logout">Logout</button>';
      }
    } else {
      btn.innerHTML = '<span class="va-account-label">Login</span>';
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
     7. UI HELPERS
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

  function showInfo(id, msg) {
    var el = $(id);
    if (!el) return;
    if (msg) {
      el.innerHTML = String(msg);
      el.hidden = false;
    } else {
      el.innerHTML = '';
      el.hidden = true;
    }
  }

  var toastTimer = null;
  function showToast(msg, kind) {
    var el = $('vaToast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.className = 'va-toast' + (kind === 'error' ? ' is-error' : '');
    el.hidden = false;
    void el.offsetWidth;
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
  function lockScroll() { document.body.classList.add('va-no-scroll'); }

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

    var m = $('vaLoginModal');
    if (!m) return;

    state.lastFocused = document.activeElement;

    switchTab('login');
    clearError('vaLoginError');
    clearError('vaSignupError');
    showInfo('vaLoginResendWrap', '');
    showInfo('vaSignupInfo', '');

    var lp = $('vaLoginPassword'); if (lp) { lp.value = ''; lp.type = 'password'; }
    var sp = $('vaSignupPassword'); if (sp) { sp.value = ''; sp.type = 'password'; }
    resetEye('vaLoginPassword');
    resetEye('vaSignupPassword');

    // On the admin page show a slightly different subtitle.
    var sub = $('vaLoginSub');
    if (sub) {
      sub.textContent = isAdminPage()
        ? 'Sign in with your admin account.'
        : 'Login or create an account to continue.';
    }

    m.hidden = false;
    lockScroll();

    setTimeout(function () {
      var focusEl = $('vaLoginEmail');
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

    var initialName = String(p.name || meta.full_name || meta.name || '').trim();
    var initialPhone = String(p.phone || meta.phone || '').replace(/\D/g, '').slice(0, 10);
    var initialCity = String(p.city || meta.city || '').trim();

    if (nameEl) nameEl.value = initialName;
    if (phoneEl) phoneEl.value = initialPhone;
    if (cityEl) cityEl.value = initialCity;
    if (emailEl) emailEl.value = state.user.email || '';

    // Reset pending avatar edit state.
    clearPendingAvatar();

    renderProfileAvatar();

    var missing = !initialName || initialPhone.length !== 10;
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
    clearPendingAvatar();
    unlockScrollIfClear();
    restoreFocus();
  }

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
     9. TABS + PASSWORD EYE
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

  function resetEye(inputId) {
    var btn = document.querySelector('[data-eye="' + inputId + '"]');
    var input = $(inputId);
    if (input) input.type = 'password';
    if (btn) {
      btn.setAttribute('aria-label', 'Show password');
      btn.innerHTML = eyeIconSvg(true);
    }
  }

  function wirePasswordEyes() {
    $$('[data-eye]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-eye');
        var input = $(id);
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        btn.innerHTML = eyeIconSvg(!show);
      });
    });
  }

  /* ==========================================================================
     10. WIRE MODALS
     ========================================================================== */
  function wireModals() {
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

    $$('[data-va-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        switchTab(tab.getAttribute('data-va-tab'));
      });
    });

    var g = $('vaGoogleBtn');
    if (g) g.addEventListener('click', onGoogleClick);

    var lf = $('vaLoginForm');
    if (lf) lf.addEventListener('submit', onLoginSubmit);

    var sf = $('vaSignupForm');
    if (sf) sf.addEventListener('submit', onSignupSubmit);

    var pf = $('vaProfileForm');
    if (pf) pf.addEventListener('submit', onProfileSubmit);

    var pl = $('vaProfileLogout');
    if (pl) pl.addEventListener('click', function () { closeProfile(); logout(); });

    // Resend email (login tab)
    var resendBtn = $('vaLoginResendBtn');
    if (resendBtn) {
      resendBtn.addEventListener('click', function () {
        var email = String(($('vaLoginEmail') || {}).value || '').trim();
        if (email) onResendEmail(email);
      });
    }

    // Phone inputs: digits only, max 10
    ['vaSignupPhone', 'vaProfilePhone'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var v = String(el.value || '').replace(/\D/g, '').slice(0, 10);
        if (v !== el.value) el.value = v;
      });
    });

    // Dropdown actions (My Profile / Logout)
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var item = t.closest('[data-va-action]');
      if (!item) return;
      var action = item.getAttribute('data-va-action');
      if (action === 'profile') { closeDropdown(); openProfile(); }
      else if (action === 'logout') { closeDropdown(); logout(); }
    });

    // Avatar buttons in profile modal
    var avatarInput = $('vaAvatarInput');
    if (avatarInput) {
      avatarInput.addEventListener('change', onAvatarFilePicked);
    }
    var avatarRemove = $('vaAvatarRemove');
    if (avatarRemove) {
      avatarRemove.addEventListener('click', onAvatarRemoveClick);
    }

    wirePasswordEyes();
  }

  /* ==========================================================================
     11. AUTH ACTIONS
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
      // Browser navigates away.
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
    showInfo('vaLoginResendWrap', '');

    var email = String(($('vaLoginEmail') || {}).value || '').trim();
    var password = String(($('vaLoginPassword') || {}).value || '');
    var btn = $('vaLoginSubmit');

    if (!email || !password) {
      showError('vaLoginError', 'Email aur password dono daalo.');
      return;
    }

    setBusy(btn, true, 'Logging in…');
    try {
      var res = await state.sb.auth.signInWithPassword({ email: email, password: password });
      if (res && res.error) throw res.error;

      closeLogin();
      showToast('Welcome back!');
    } catch (err) {
      var msg = String(err && (err.message || err.error_description) || '').toLowerCase();
      if (msg.indexOf('email not confirmed') !== -1) {
        showError('vaLoginError', 'Email abhi confirm nahi hua. Neeche "Resend email" tap karo.');
        showInfo('vaLoginResendWrap',
          'Email confirm nahi hua. <button type="button" class="va-link" id="vaLoginResendBtn2">Resend email</button>');
        var r2 = $('vaLoginResendBtn2');
        if (r2) r2.addEventListener('click', function () { onResendEmail(email); });
      } else {
        showError('vaLoginError', friendlyAuthError(err));
      }
    } finally {
      setBusy(btn, false);
    }
  }

  async function onSignupSubmit(e) {
    e.preventDefault();
    clearError('vaSignupError');
    showInfo('vaSignupInfo', '');

    var name = String(($('vaSignupName') || {}).value || '').trim();
    var phone = String(($('vaSignupPhone') || {}).value || '').replace(/\D/g, '');
    var email = String(($('vaSignupEmail') || {}).value || '').trim();
    var password = String(($('vaSignupPassword') || {}).value || '');
    var city = String(($('vaSignupCity') || {}).value || '').trim();
    var btn = $('vaSignupSubmit');

    if (!name) { showError('vaSignupError', 'Full name daalo.'); return; }
    if (!/^\d{10}$/.test(phone)) {
      showError('vaSignupError', 'Valid 10 digit mobile number daalo.');
      return;
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showError('vaSignupError', 'Valid email address daalo.');
      return;
    }
    if (password.length < 6) {
      showError('vaSignupError', 'Password kam se kam 6 characters ka hona chahiye.');
      return;
    }

    setBusy(btn, true, 'Creating account…');
    try {
      var redirectTo = loginRedirectUrl();
      var res = await state.sb.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: name,
            phone: phone,
            city: city
          },
          emailRedirectTo: redirectTo
        }
      });
      if (res && res.error) throw res.error;

      var hasSession = !!(res.data && res.data.session);

      if (hasSession) {
        closeLogin();
        showToast('Account ban gaya, welcome!');
        // handleAuthChange will run automatically via onAuthStateChange.
      } else {
        // Email confirmation is ON. Show info + resend.
        showInfo('vaSignupInfo',
          'Confirmation mail bheji gayi, inbox check karo. ' +
          'Nahi mili? <button type="button" class="va-link" id="vaSignupResendBtn">Resend email</button>');
        var rb = $('vaSignupResendBtn');
        if (rb) rb.addEventListener('click', function () { onResendEmail(email); });
      }
    } catch (err) {
      showError('vaSignupError', friendlyAuthError(err));
    } finally {
      setBusy(btn, false);
    }
  }

  async function onResendEmail(email) {
    if (!email) return;
    try {
      var res = await state.sb.auth.resend({
        type: 'signup',
        email: email,
        options: { emailRedirectTo: loginRedirectUrl() }
      });
      if (res && res.error) throw res.error;
      showToast('Confirmation mail dobara bhej di. Inbox check karo.');
    } catch (err) {
      showToast(friendlyAuthError(err), 'error');
    }
  }

  async function logout() {
    try {
      if (state.sb) await state.sb.auth.signOut();
    } catch (e) { /* ignore */ }

    state.user = null;
    state.profile = null;
    state.isAdminFlag = false;

    try { sessionStorage.removeItem(PROMPT_KEY); } catch (e) {}

    updateAccountUI();
    emitChange();
    showToast('Logged out.');

    // On the admin page, reload so admin.js shows the login screen again.
    if (isAdminPage()) {
      setTimeout(function () { window.location.reload(); }, 350);
    }
  }

  /* ==========================================================================
     12. PROFILE — FETCH / ENSURE / SAVE
     ========================================================================== */
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

  // Never overwrites existing non-empty fields. Creates the row if missing.
  async function ensureProfile(user) {
    if (!user || !state.sb) return null;
    var meta = user.user_metadata || {};

    var fromMeta = {
      name: String(meta.full_name || meta.name || '').trim(),
      phone: String(meta.phone || '').replace(/\D/g, '').slice(0, 10),
      email: String(user.email || ''),
      city: String(meta.city || '').trim(),
      avatar_url: String(meta.avatar_url || meta.picture || '').trim()
    };

    var existing = await fetchProfile(user);

    if (!existing) {
      // Create a fresh row from metadata.
      var insertPayload = {
        id: user.id,
        name: fromMeta.name,
        phone: fromMeta.phone,
        email: fromMeta.email,
        city: fromMeta.city,
        avatar_url: fromMeta.avatar_url || null
      };
      try {
        var ins = await state.sb
          .from('customers')
          .insert(insertPayload)
          .select()
          .single();
        if (ins && !ins.error && ins.data) return ins.data;
      } catch (e) { /* ignore */ }

      // Try fetching once more (in case a DB trigger already created it).
      var again = await fetchProfile(user);
      if (again) return again;

      // Fall back to an in-memory object.
      return insertPayload;
    }

    // Row exists — only patch EMPTY fields from metadata. Never overwrite.
    var patch = {};
    var changed = false;
    if (!existing.name && fromMeta.name) { patch.name = fromMeta.name; changed = true; }
    if (!existing.phone && fromMeta.phone) { patch.phone = fromMeta.phone; changed = true; }
    if (!existing.email && fromMeta.email) { patch.email = fromMeta.email; changed = true; }
    if (!existing.city && fromMeta.city) { patch.city = fromMeta.city; changed = true; }
    if (!existing.avatar_url && fromMeta.avatar_url) { patch.avatar_url = fromMeta.avatar_url; changed = true; }

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

  async function refreshProfile() {
    if (!state.user) { state.profile = null; return null; }
    var p = await fetchProfile(state.user);
    state.profile = p;
    updateAccountUI();
    emitChange();
    return p;
  }

  function profileNeedsInfo() {
    if (!state.user) return false;
    var p = state.profile || {};
    var meta = state.user.user_metadata || {};
    var name = String(p.name || meta.full_name || meta.name || '').trim();
    var phone = String(p.phone || meta.phone || '').replace(/\D/g, '');
    return !name || phone.length !== 10;
  }

  function markPrompted() {
    state.promptedThisSession = true;
    try { sessionStorage.setItem(PROMPT_KEY, '1'); } catch (e) {}
  }

  function wasPrompted() {
    if (state.promptedThisSession) return true;
    try {
      return sessionStorage.getItem(PROMPT_KEY) === '1';
    } catch (e) { return false; }
  }

  /* -------- Avatar editing (preview + save flow) -------- */
  function clearPendingAvatar() {
    if (state.pendingAvatarPreview) {
      try { URL.revokeObjectURL(state.pendingAvatarPreview); } catch (e) {}
    }
    state.pendingAvatarBlob = null;
    state.pendingAvatarPreview = '';
    state.pendingAvatarRemove = false;
  }

  function renderProfileAvatar() {
    var preview = $('vaAvatarPreview');
    var img = $('vaAvatarImg');
    var letter = $('vaAvatarLetter');
    if (!preview || !img || !letter) return;

    var url = '';
    if (state.pendingAvatarBlob && state.pendingAvatarPreview) {
      url = state.pendingAvatarPreview;
    } else if (state.pendingAvatarRemove) {
      url = '';
    } else {
      var p = state.profile || {};
      var meta = (state.user && state.user.user_metadata) || {};
      url = String(p.avatar_url || meta.avatar_url || meta.picture || '').trim();
    }

    if (url) {
      img.onerror = function () {
        img.onerror = null;
        img.hidden = true;
        letter.hidden = false;
        letter.textContent = avatarInitial();
      };
      img.src = url;
      img.hidden = false;
      letter.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      letter.textContent = avatarInitial();
      letter.hidden = false;
    }
  }

  function avatarInitial() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    var n = String(p.name || meta.full_name || meta.name || '').trim();
    if (!n && state.user && state.user.email) n = String(state.user.email).charAt(0);
    return (n.charAt(0) || 'V').toUpperCase();
  }

  async function onAvatarFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    // Validate type
    var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      showError('vaProfileError', 'Sirf JPG, PNG ya WEBP photo chuno.');
      return;
    }
    // Validate size (max 2 MB)
    if (file.size > 2 * 1024 * 1024) {
      showError('vaProfileError', 'Photo 2 MB se chhoti honi chahiye.');
      return;
    }

    clearError('vaProfileError');

    try {
      var blob = await compressImage(file, 512, 0.85);
      clearPendingAvatar();
      state.pendingAvatarBlob = blob;
      state.pendingAvatarPreview = URL.createObjectURL(blob);
      state.pendingAvatarRemove = false;
      renderProfileAvatar();
    } catch (err) {
      showError('vaProfileError', 'Photo process nahi ho payi. Dobara try karo.');
    }
  }

  function onAvatarRemoveClick() {
    clearPendingAvatar();
    state.pendingAvatarRemove = true;
    renderProfileAvatar();
  }

  async function uploadAvatarBlob(userId, blob) {
    // Always store as jpg for a small, consistent file.
    var path = userId + '/avatar.jpg';
    var up = await state.sb.storage
      .from('avatars')
      .upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });
    if (up && up.error) throw up.error;

    var pub = state.sb.storage.from('avatars').getPublicUrl(path);
    var url = (pub && pub.data && pub.data.publicUrl) || '';
    if (!url) throw new Error('No public URL returned.');
    // Cache-bust so the new photo shows immediately.
    return url + '?v=' + Date.now();
  }

  async function deleteAvatarFile(userId) {
    try {
      await state.sb.storage.from('avatars').remove([userId + '/avatar.jpg']);
    } catch (e) { /* best effort */ }
  }

  async function onProfileSubmit(e) {
    e.preventDefault();
    clearError('vaProfileError');

    var name = String(($('vaProfileName') || {}).value || '').trim();
    var phone = String(($('vaProfilePhone') || {}).value || '').replace(/\D/g, '');
    var city = String(($('vaProfileCity') || {}).value || '').trim();
    var btn = $('vaProfileSubmit');

    if (!name) { showError('vaProfileError', 'Full name daalo.'); return; }
    if (!/^\d{10}$/.test(phone)) {
      showError('vaProfileError', 'Valid 10 digit mobile number daalo.');
      return;
    }
    if (!state.user) { closeProfile(); return; }

    setBusy(btn, true, 'Saving…');
    try {
      var userId = state.user.id;

      // 1. If the user picked a new photo, upload it now.
      var newAvatarUrl = null;
      if (state.pendingAvatarBlob) {
        try {
          newAvatarUrl = await uploadAvatarBlob(userId, state.pendingAvatarBlob);
        } catch (upErr) {
          throw new Error(friendlyStorageError(upErr));
        }
      } else if (state.pendingAvatarRemove) {
        // Delete the file in storage (best effort) and clear the URL.
        await deleteAvatarFile(userId);
        newAvatarUrl = ''; // explicitly empty
      }

      // 2. Build the customers update payload.
      var payload = {
        id: userId,
        name: name,
        phone: phone,
        city: city,
        email: state.user.email || '',
        updated_at: new Date().toISOString()
      };

      if (state.pendingAvatarBlob && newAvatarUrl) payload.avatar_url = newAvatarUrl;
      else if (state.pendingAvatarRemove) payload.avatar_url = null;

      var res = await state.sb
        .from('customers')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (res && res.error) throw res.error;

      state.profile = res.data || payload;

      // 3. Sync user metadata so signin on other devices gets the same info.
      try {
        var metaUpdate = {
          full_name: name,
          phone: phone
        };
        if (payload.avatar_url !== undefined) {
          metaUpdate.avatar_url = payload.avatar_url || null;
        }
        await state.sb.auth.updateUser({ data: metaUpdate });
      } catch (e) { /* best effort */ }

      clearPendingAvatar();
      closeProfile();
      showToast('Profile saved.');
      updateAccountUI();
      emitChange();
    } catch (err) {
      showError('vaProfileError',
        (err && err.message) ? err.message : 'Save nahi ho paya. Dobara try karo.');
    } finally {
      setBusy(btn, false);
    }
  }

  /* -------- Image compression -------- */
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
              // White background in case the source had transparency.
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
     13. ADMIN CHECK
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

  /* ==========================================================================
     14. AUTH STATE HANDLING
     ========================================================================== */
  function emitChange() {
    var list = state.listeners.slice();
    list.forEach(function (cb) {
      try { cb(state.user, state.profile); }
      catch (e) { console.warn('[VionaAuth] listener error:', e); }
    });
  }

  function cleanAuthUrl() {
    try {
      var url = window.location;
      var h = url.hash || '';
      var s = url.search || '';
      var changed = false;

      if (h.indexOf('access_token') !== -1 ||
          h.indexOf('refresh_token') !== -1 ||
          h.indexOf('error_description') !== -1) {
        h = '';
        changed = true;
      }

      if (s.indexOf('code=') !== -1) {
        var parts = s.substring(1).split('&').filter(function (p) {
          return p.indexOf('code=') !== 0 &&
                 p.indexOf('state=') !== 0 &&
                 p.indexOf('error=') !== 0;
        });
        s = parts.length ? '?' + parts.join('&') : '';
        changed = true;
      }

      if (changed) {
        history.replaceState(null, '', url.pathname + s + h);
      }
    } catch (e) { /* ignore */ }
  }

  async function handleAuthChange(session) {
    var user = (session && session.user) ? session.user : null;

    // Same user as before? Refresh profile quietly and move on.
    if (user && state.user && user.id === state.user.id) {
      try {
        var p = await fetchProfile(user);
        if (p) state.profile = p;
      } catch (e) { /* ignore */ }
      updateAccountUI();
      return;
    }

    state.user = user;

    if (!user) {
      state.profile = null;
      state.isAdminFlag = false;
      updateAccountUI();
      emitChange();
      return;
    }

    // New signed-in user — fetch or create the customers row, then check admin.
    try { state.profile = await ensureProfile(user); }
    catch (e) { state.profile = null; }

    try { state.isAdminFlag = await checkIsAdmin(user.email); }
    catch (e) { state.isAdminFlag = false; }

    updateAccountUI();
    emitChange();

    // Clean up auth params in the URL now that we have a session.
    cleanAuthUrl();

    // If name or phone is missing, prompt ONCE per session on the public site.
    if (!isAdminPage() && !wasPrompted() && profileNeedsInfo()) {
      markPrompted();
      setTimeout(function () { openProfile(true); }, 500);
    }
  }

  /* ==========================================================================
     15. BOOT
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
            // Ignore — UI just stays logged-out.
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
     16. PUBLIC API
     ========================================================================== */
  window.VionaAuth = {
    // Setup
    init: init,
    ready: function () { return init(); },

    // Read state
    getUser: function () { return state.user; },
    getProfile: function () { return state.profile; },
    refreshProfile: function () { return refreshProfile(); },
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

    // Shared Supabase client for other scripts (script.js, admin.js)
    get client() { return state.sb; }
  };

})();
