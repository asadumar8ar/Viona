/* ============================================================================
   Viona Bangles — js/auth.js
   ----------------------------------------------------------------------------
   Handles login, signup (name + phone), forgot password, reset password,
   profile (with photo), logout and the header user chip.

   Script load order (from index.html):
     1. Supabase CDN
     2. js/config.js      → defines window.VIONA_CONFIG
     3. js/auth.js        → THIS FILE (creates window.vionaSupabase ONCE)
     4. js/script.js      → uses window.vionaSupabase and window.VionaAuth

   Public API (window.VionaAuth):
     init()            -> Promise<boolean>
     ready()           -> Promise<boolean>  (same as init)
     getUser()         -> current Supabase user or null
     getProfile()      -> current customers row or null
     refreshProfile()  -> Promise<row|null>
     openLogin()
     openProfile()
     logout()
     onChange(cb)      -> unsubscribe function
     isAdmin()         -> Promise<boolean>
     client            -> window.vionaSupabase

   IDs used in index.html:
     loginBtn, userMenu, userMenuBtn, userDropdown, userAvatar, userName,
     profileBtn, logoutBtn,
     loginModal, loginCloseBtn, loginForm, loginEmail, loginPassword,
     loginSubmitBtn, signupForm, signupName, signupPhone, signupEmail,
     signupPassword, signupSubmitBtn, googleLoginBtn, showSignupBtn,
     showLoginBtn, authMessage,
     forgotLink, forgotForm, forgotEmail, forgotSendBtn, forgotBackLink,
     resetModal, resetCloseBtn, newPassword, confirmPassword,
     updatePasswordBtn,
     profileModal, profileCloseBtn, profileForm, profileName, profilePhone,
     profileCity, profileEmail, profileSubmit, profileLogout,
     profileError, avatarInput, avatarRemove, avatarImg, avatarLetter,
     toast
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. READ CONFIG (exactly as required)
     ========================================================================== */
  var CFG = window.VIONA_CONFIG || {};
  var SUPABASE_URL      = CFG.SUPABASE_URL;
  var SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;

  function configProblem() {
    if (!SUPABASE_URL || typeof SUPABASE_URL !== 'string' ||
        SUPABASE_URL.indexOf('https://') !== 0) {
      return 'Supabase URL missing or invalid in js/config.js';
    }
    if (!SUPABASE_ANON_KEY || typeof SUPABASE_ANON_KEY !== 'string' ||
        SUPABASE_ANON_KEY.length < 20) {
      return 'Supabase anon key missing or invalid in js/config.js';
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return 'Supabase library (CDN) did not load. Check your network and reload.';
    }
    return null;
  }

  var CONFIG_ERROR = configProblem();

  /* ==========================================================================
     2. CREATE SUPABASE CLIENT — ONCE
     --------------------------------------------------------------------------
     window.vionaSupabase is the single shared client.
     js/script.js also uses window.vionaSupabase (and VionaAuth.client).
     ========================================================================== */
  if (!CONFIG_ERROR) {
    try {
      window.vionaSupabase = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );
    } catch (e) {
      CONFIG_ERROR = 'Could not start Supabase: ' + (e && e.message ? e.message : e);
      console.error('[auth]', CONFIG_ERROR, e);
    }
  }

  /* ==========================================================================
     3. TINY HELPERS
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

  function isAdminPage() {
    return /admin\.html$/i.test(window.location.pathname || '');
  }

  function redirectUrl() {
    if (isAdminPage()) return window.location.origin + '/admin.html';
    return window.location.origin + window.location.pathname;
  }

  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    var msg = String(err.message || err.error_description || err || '');
    var low = msg.toLowerCase();

    if (low.indexOf('email not confirmed') !== -1)
      return 'Email is not confirmed yet. Please check your inbox.';
    if (low.indexOf('invalid login credentials') !== -1)
      return 'Wrong email or password.';
    if (low.indexOf('user already registered') !== -1 ||
        low.indexOf('already been registered') !== -1 ||
        low.indexOf('already exists') !== -1)
      return 'This email is already registered. Please log in.';
    if (low.indexOf('password should be at least') !== -1 ||
        low.indexOf('weak password') !== -1)
      return 'Password is too short. Use at least 6 characters.';
    if (low.indexOf('invalid email') !== -1)
      return 'Please enter a valid email address.';
    if (low.indexOf('rate limit') !== -1 || low.indexOf('too many') !== -1)
      return 'Too many attempts. Please wait a minute.';
    if (low.indexOf('network') !== -1 || low.indexOf('failed to fetch') !== -1)
      return 'Network problem. Please check your internet.';
    if (low.indexOf('same password') !== -1 ||
        low.indexOf('new password should be different') !== -1)
      return 'New password must be different from your old one.';
    if (low.indexOf('auth session missing') !== -1 ||
        low.indexOf('session_not_found') !== -1)
      return 'Your reset link has expired. Please request a new one.';

    return msg || 'Something went wrong. Please try again.';
  }

  function friendlyStorageError(err) {
    if (!err) return 'Upload failed.';
    var msg = String(err.message || err.error_description || err || '');
    var low = msg.toLowerCase();
    if (low.indexOf('bucket') !== -1 && low.indexOf('not found') !== -1)
      return 'Storage bucket "avatars" not found. Create it in Supabase (public).';
    if (low.indexOf('row-level security') !== -1 ||
        low.indexOf('permission') !== -1 ||
        low.indexOf('not allowed') !== -1)
      return 'Upload permission denied. Check Supabase storage policies.';
    if (low.indexOf('exceeded') !== -1 || low.indexOf('too large') !== -1)
      return 'Photo is too large. Use an image under 2 MB.';
    return msg || 'Upload failed.';
  }

  /* ==========================================================================
     4. STATE
     ========================================================================== */
  var state = {
    user: null,
    profile: null,
    listeners: [],
    ready: false,
    dropdownOpen: false,
    pendingAvatarBlob: null,
    pendingAvatarPreview: '',
    pendingAvatarRemove: false
  };

  /* ==========================================================================
     5. SHARED MESSAGE BOX (#authMessage)
     ========================================================================== */
  function setMessage(msg, isOk) {
    var elx = $('authMessage');
    if (!elx) return;
    if (!msg) {
      elx.textContent = '';
      elx.hidden = true;
      elx.classList.remove('is-ok');
      return;
    }
    elx.innerHTML = String(msg);
    elx.classList.toggle('is-ok', !!isOk);
    elx.hidden = false;
  }

  function clearMessage() { setMessage('', false); }

  /* Optional toast (uses the shared #toast element if present) */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) { try { console.log('[auth]', msg); } catch (e) {} return; }
    t.textContent = String(msg || '');
    t.hidden = false;
    void t.offsetWidth;
    t.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-visible');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 3000);
  }

  /* ==========================================================================
     6. BUSY STATE ON BUTTONS
     ========================================================================== */
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = label || 'Please wait…';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  }

  /* ==========================================================================
     7. LOGIN MODAL — open / close / switch views
     ========================================================================== */
  function openLogin() {
    var m = $('loginModal');
    if (!m) return;
    clearMessage();
    switchView('login');
    m.hidden = false;
    document.body.classList.add('no-scroll');
    setTimeout(function () {
      var e = $('loginEmail');
      if (e && e.focus) try { e.focus(); } catch (_) {}
    }, 60);
  }

  function closeLogin() {
    var m = $('loginModal');
    if (m) m.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  /* name: 'login' | 'signup' | 'forgot' */
  function switchView(name) {
    var loginForm  = $('loginForm');
    var signupForm = $('signupForm');
    var forgotForm = $('forgotForm');

    if (loginForm)  loginForm.hidden  = name !== 'login';
    if (signupForm) signupForm.hidden = name !== 'signup';
    if (forgotForm) forgotForm.hidden = name !== 'forgot';

    /* Prefill forgot-email with login-email */
    if (name === 'forgot') {
      var le = $('loginEmail');
      var fe = $('forgotEmail');
      if (fe && le && le.value) fe.value = le.value;
      setTimeout(function () {
        if (fe && fe.focus) try { fe.focus(); } catch (_) {}
      }, 40);
    }
  }

  /* ==========================================================================
     8. RESET MODAL — open / close
     ========================================================================== */
  function openReset() {
    var m = $('resetModal');
    if (!m) return;

    var lm = $('loginModal');
    if (lm) lm.hidden = true;

    var np = $('newPassword');     if (np) np.value = '';
    var cp = $('confirmPassword'); if (cp) cp.value = '';
    setMessage('');

    m.hidden = false;
    document.body.classList.add('no-scroll');

    setTimeout(function () {
      var f = $('newPassword');
      if (f && f.focus) try { f.focus(); } catch (_) {}
    }, 60);
  }

  function closeReset() {
    var m = $('resetModal');
    if (m) m.hidden = true;
    document.body.classList.remove('no-scroll');
  }

  /* ==========================================================================
     9. PROFILE MODAL — open / close / render avatar
     ========================================================================== */
  function openProfile() {
    if (!state.user) { openLogin(); return; }
    var m = $('profileModal');
    if (!m) return;

    var p = state.profile || {};
    var meta = state.user.user_metadata || {};

    var nameEl  = $('profileName');
    var phoneEl = $('profilePhone');
    var cityEl  = $('profileCity');
    var emailEl = $('profileEmail');

    var name  = String(p.name  || meta.full_name || meta.name || '').trim();
    var phone = String(p.phone || meta.phone || '').replace(/\D/g, '').slice(0, 10);
    var city  = String(p.city  || meta.city  || '').trim();

    if (nameEl)  nameEl.value  = name;
    if (phoneEl) phoneEl.value = phone;
    if (cityEl)  cityEl.value  = city;
    if (emailEl) emailEl.value = state.user.email || '';

    clearPendingAvatar();
    renderProfileAvatar();

    var err = $('profileError');
    if (err) { err.textContent = ''; err.hidden = true; }

    m.hidden = false;
    document.body.classList.add('no-scroll');

    setTimeout(function () {
      var target = !name ? nameEl : (!phone ? phoneEl : nameEl);
      if (target && target.focus) try { target.focus(); } catch (_) {}
    }, 60);
  }

  function closeProfile() {
    var m = $('profileModal');
    if (m) m.hidden = true;
    clearPendingAvatar();
    document.body.classList.remove('no-scroll');
  }

  function avatarInitial() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    var n = String(p.name || meta.full_name || meta.name || '').trim();
    if (!n && state.user && state.user.email) n = String(state.user.email).charAt(0);
    return (n.charAt(0) || 'V').toUpperCase();
  }

  function currentAvatarUrl() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    return String(p.avatar_url || meta.avatar_url || meta.picture || '').trim();
  }

  function renderProfileAvatar() {
    var img    = $('avatarImg');
    var letter = $('avatarLetter');
    if (!img || !letter) return;

    var url = '';
    if (state.pendingAvatarBlob && state.pendingAvatarPreview) url = state.pendingAvatarPreview;
    else if (state.pendingAvatarRemove) url = '';
    else url = currentAvatarUrl();

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

  function clearPendingAvatar() {
    if (state.pendingAvatarPreview) {
      try { URL.revokeObjectURL(state.pendingAvatarPreview); } catch (e) {}
    }
    state.pendingAvatarBlob = null;
    state.pendingAvatarPreview = '';
    state.pendingAvatarRemove = false;
  }

  /* ==========================================================================
     10. HEADER UI — login button vs. user menu
     ========================================================================== */
  function displayName() {
    var p = state.profile || {};
    var meta = (state.user && state.user.user_metadata) || {};
    var n = String(p.name || meta.full_name || meta.name || '').trim();
    if (!n && state.user && state.user.email) n = String(state.user.email).split('@')[0];
    return n || 'Account';
  }

  function updateHeaderUI() {
    var loginBtn = $('loginBtn');
    var userMenu = $('userMenu');

    if (loginBtn && userMenu) {
      if (state.user) {
        loginBtn.hidden = true;
        userMenu.hidden = false;

        var name = displayName();
        var firstName = String(name).trim().split(/\s+/)[0] || 'Account';
        var url = currentAvatarUrl();
        var initial = (firstName.charAt(0) || 'V').toUpperCase();

        var nameEl   = $('userName');
        var avatarEl = $('userAvatar');

        if (nameEl) nameEl.textContent = firstName;

        if (avatarEl) {
          if (url) avatarEl.innerHTML = '<img src="' + esc(url) + '" alt="" />';
          else     avatarEl.textContent = initial;
        }
      } else {
        loginBtn.hidden = false;
        userMenu.hidden = true;

        var dd = $('userDropdown');
        if (dd) dd.hidden = true;
        state.dropdownOpen = false;
      }
    }
  }

  /* ==========================================================================
     11. PROFILE — fetch / ensure / save
     ========================================================================== */
  async function fetchProfile(user) {
    if (!user || !window.vionaSupabase) return null;
    try {
      var res = await window.vionaSupabase
        .from('customers')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (res && res.error && res.error.code !== 'PGRST116') {
        console.warn('[auth] profile fetch failed:', res.error.message);
      }
      return (res && res.data) || null;
    } catch (e) {
      return null;
    }
  }

  async function ensureProfile(user) {
    if (!user || !window.vionaSupabase) return null;
    var meta = user.user_metadata || {};

    var fromMeta = {
      name:       String(meta.full_name || meta.name || '').trim(),
      phone:      String(meta.phone || '').replace(/\D/g, '').slice(0, 10),
      email:      String(user.email || ''),
      city:       String(meta.city || '').trim(),
      avatar_url: String(meta.avatar_url || meta.picture || '').trim()
    };

    var existing = await fetchProfile(user);

    if (!existing) {
      var payload = {
        id: user.id,
        name: fromMeta.name,
        phone: fromMeta.phone,
        email: fromMeta.email,
        city: fromMeta.city,
        avatar_url: fromMeta.avatar_url || null
      };
      try {
        var ins = await window.vionaSupabase
          .from('customers').insert(payload).select().single();
        if (ins && !ins.error && ins.data) return ins.data;
      } catch (e) {}
      var again = await fetchProfile(user);
      return again || payload;
    }

    var patch = {};
    var changed = false;
    if (!existing.name && fromMeta.name)             { patch.name = fromMeta.name; changed = true; }
    if (!existing.phone && fromMeta.phone)           { patch.phone = fromMeta.phone; changed = true; }
    if (!existing.email && fromMeta.email)           { patch.email = fromMeta.email; changed = true; }
    if (!existing.city && fromMeta.city)             { patch.city = fromMeta.city; changed = true; }
    if (!existing.avatar_url && fromMeta.avatar_url) { patch.avatar_url = fromMeta.avatar_url; changed = true; }

    if (changed) {
      try {
        var upd = await window.vionaSupabase
          .from('customers').update(patch).eq('id', user.id).select().single();
        if (upd && !upd.error && upd.data) return upd.data;
      } catch (e) {}
    }
    return existing;
  }

  async function compressImage(file, maxSide, quality) {
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
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, tw, th);
              ctx.drawImage(img, 0, 0, tw, th);

              canvas.toBlob(function (blob) {
                if (!blob) return reject(new Error('Compression failed'));
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

  async function uploadAvatar(userId, blob) {
    var path = userId + '/avatar.jpg';
    var up = await window.vionaSupabase.storage
      .from('avatars')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
    if (up && up.error) throw up.error;

    var pub = window.vionaSupabase.storage.from('avatars').getPublicUrl(path);
    var url = (pub && pub.data && pub.data.publicUrl) || '';
    if (!url) throw new Error('No public URL returned.');
    return url + '?v=' + Date.now();
  }

  async function deleteAvatar(userId) {
    try { await window.vionaSupabase.storage.from('avatars').remove([userId + '/avatar.jpg']); }
    catch (e) {}
  }

  function setProfileError(msg) {
    var elx = $('profileError');
    if (!elx) return;
    if (!msg) { elx.textContent = ''; elx.hidden = true; return; }
    elx.textContent = String(msg);
    elx.hidden = false;
  }

  async function onProfileSubmit(e) {
    if (e) e.preventDefault();
    setProfileError('');

    var name  = String(($('profileName')  || {}).value || '').trim();
    var phone = String(($('profilePhone') || {}).value || '').replace(/\D/g, '');
    var city  = String(($('profileCity')  || {}).value || '').trim();
    var btn   = $('profileSubmit');

    if (!name) { setProfileError('Please enter your full name.'); return; }
    if (!/^\d{10}$/.test(phone)) {
      setProfileError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!state.user) { closeProfile(); return; }

    setBusy(btn, true, 'Saving…');
    try {
      var userId = state.user.id;
      var newUrl = null;

      if (state.pendingAvatarBlob) {
        try { newUrl = await uploadAvatar(userId, state.pendingAvatarBlob); }
        catch (upErr) { throw new Error(friendlyStorageError(upErr)); }
      } else if (state.pendingAvatarRemove) {
        await deleteAvatar(userId);
        newUrl = '';
      }

      var payload = {
        id: userId,
        name: name,
        phone: phone,
        city: city,
        email: state.user.email || '',
        updated_at: new Date().toISOString()
      };
      if (state.pendingAvatarBlob && newUrl) payload.avatar_url = newUrl;
      else if (state.pendingAvatarRemove)    payload.avatar_url = null;

      var res = await window.vionaSupabase
        .from('customers')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (res && res.error) throw res.error;

      state.profile = res.data || payload;

      try {
        var meta = { full_name: name, phone: phone };
        if (payload.avatar_url !== undefined) meta.avatar_url = payload.avatar_url || null;
        await window.vionaSupabase.auth.updateUser({ data: meta });
      } catch (e) {}

      clearPendingAvatar();
      closeProfile();
      toast('Profile saved.');
      updateHeaderUI();
      emitChange();
    } catch (err) {
      setProfileError((err && err.message) || 'Could not save. Please try again.');
    } finally {
      setBusy(btn, false);
    }
  }

  async function onAvatarFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    var allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.indexOf(file.type) === -1) {
      setProfileError('Please choose a JPG, PNG or WEBP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError('Photo must be under 2 MB.');
      return;
    }

    setProfileError('');
    try {
      var blob = await compressImage(file, 512, 0.85);
      clearPendingAvatar();
      state.pendingAvatarBlob = blob;
      state.pendingAvatarPreview = URL.createObjectURL(blob);
      state.pendingAvatarRemove = false;
      renderProfileAvatar();
    } catch (err) {
      setProfileError('Could not process the photo. Please try again.');
    }
  }

  function onAvatarRemoveClick() {
    clearPendingAvatar();
    state.pendingAvatarRemove = true;
    renderProfileAvatar();
  }

  /* ==========================================================================
     12. AUTH ACTIONS — login / signup / Google
     ========================================================================== */
  async function onLoginSubmit(e) {
    if (e) e.preventDefault();
    clearMessage();

    var email    = String(($('loginEmail')    || {}).value || '').trim();
    var password = String(($('loginPassword') || {}).value || '');
    var btn      = $('loginSubmitBtn');

    if (!email || !password) {
      setMessage('Please enter both email and password.');
      return;
    }

    setBusy(btn, true, 'Logging in…');
    try {
      var res = await window.vionaSupabase.auth.signInWithPassword({
        email: email, password: password
      });
      if (res && res.error) throw res.error;

      closeLogin();
      toast('Welcome back!');
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(btn, false);
    }
  }

  async function onSignupSubmit(e) {
    if (e) e.preventDefault();
    clearMessage();

    var name     = String(($('signupName')     || {}).value || '').trim();
    var phone    = String(($('signupPhone')    || {}).value || '').replace(/\D/g, '');
    var email    = String(($('signupEmail')    || {}).value || '').trim();
    var password = String(($('signupPassword') || {}).value || '');
    var btn      = $('signupSubmitBtn');

    if (!name) { setMessage('Please enter your full name.'); return; }
    if (phone && phone.length !== 10) {
      setMessage('Please enter a valid 10-digit mobile number.'); return;
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMessage('Please enter a valid email address.'); return;
    }
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.'); return;
    }

    setBusy(btn, true, 'Creating account…');
    try {
      var res = await window.vionaSupabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name, phone: phone },
          emailRedirectTo: redirectUrl()
        }
      });
      if (res && res.error) throw res.error;

      var hasSession = !!(res.data && res.data.session);
      if (hasSession) {
        closeLogin();
        toast('Account created. Welcome!');
      } else {
        setMessage('Confirmation email sent. Please check your inbox (also Spam).', true);
      }
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(btn, false);
    }
  }

  async function onGoogleClick() {
    var btn = $('googleLoginBtn');
    setBusy(btn, true, 'Redirecting…');
    try {
      var res = await window.vionaSupabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl() }
      });
      if (res && res.error) throw res.error;
    } catch (err) {
      setBusy(btn, false);
      setMessage(friendlyError(err));
    }
  }

  async function logout() {
    try { await window.vionaSupabase.auth.signOut(); } catch (e) {}

    state.user = null;
    state.profile = null;
    updateHeaderUI();
    emitChange();
    toast('Logged out.');

    if (isAdminPage()) {
      setTimeout(function () { window.location.reload(); }, 350);
    }
  }

  /* ==========================================================================
     13. FORGOT PASSWORD — send reset link
     ========================================================================== */
  async function onForgotSend() {
    clearMessage();

    var email = String(($('forgotEmail') || {}).value || '').trim();
    var btn   = $('forgotSendBtn');

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMessage('Please enter a valid email address.');
      return;
    }

    setBusy(btn, true, 'Sending…');
    try {
      var res = await window.vionaSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if (res && res.error) throw res.error;

      setMessage('Reset link sent. Please check your email (and Spam).', true);
    } catch (err) {
      setMessage(friendlyError(err));
      console.error('[auth] resetPasswordForEmail failed:', err);
    } finally {
      setBusy(btn, false);
    }
  }

  /* ==========================================================================
     14. RESET PASSWORD — update user password
     ========================================================================== */
  async function onUpdatePassword() {
    clearMessage();

    var a = String(($('newPassword')     || {}).value || '');
    var b = String(($('confirmPassword') || {}).value || '');
    var btn = $('updatePasswordBtn');

    if (a.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    if (a !== b) {
      setMessage('Both passwords must match.');
      return;
    }

    setBusy(btn, true, 'Updating…');
    try {
      var res = await window.vionaSupabase.auth.updateUser({ password: a });
      if (res && res.error) throw res.error;

      setMessage('Password updated. You can now log in with the new password.', true);
      toast('Password updated.');

      cleanAuthUrl();
      setTimeout(function () { closeReset(); }, 1200);
    } catch (err) {
      setMessage(friendlyError(err));
      console.error('[auth] updateUser failed:', err);
    } finally {
      setBusy(btn, false);
    }
  }

  /* ==========================================================================
     15. URL CLEANUP after recovery
     ========================================================================== */
  function cleanAuthUrl() {
    try {
      var url = window.location;
      var h = url.hash || '';
      var s = url.search || '';
      var changed = false;

      if (h.indexOf('access_token') !== -1 ||
          h.indexOf('refresh_token') !== -1 ||
          h.indexOf('error_description') !== -1 ||
          h.indexOf('type=recovery') !== -1 ||
          h.indexOf('type%3Drecovery') !== -1) {
        h = '';
        changed = true;
      }
      if (s.indexOf('code=') !== -1) {
        var parts = s.substring(1).split('&').filter(function (p) {
          return p.indexOf('code=') !== 0 &&
                 p.indexOf('state=') !== 0 &&
                 p.indexOf('error=') !== 0 &&
                 p.indexOf('type=') !== 0;
        });
        s = parts.length ? '?' + parts.join('&') : '';
        changed = true;
      }
      if (changed) history.replaceState(null, '', url.pathname + s + h);
    } catch (e) {}
  }

  /* ==========================================================================
     16. AUTH STATE
     ========================================================================== */
  function emitChange() {
    state.listeners.slice().forEach(function (cb) {
      try { cb(state.user, state.profile); }
      catch (e) { console.warn('[auth] listener error:', e); }
    });
  }

  async function handleAuthChange(session) {
    var user = (session && session.user) ? session.user : null;

    if (user && state.user && user.id === state.user.id) {
      /* same user — refresh profile quietly */
      try {
        var p = await fetchProfile(user);
        if (p) state.profile = p;
      } catch (e) {}
      updateHeaderUI();
      return;
    }

    state.user = user;

    if (!user) {
      state.profile = null;
      updateHeaderUI();
      emitChange();
      return;
    }

    try { state.profile = await ensureProfile(user); }
    catch (e) { state.profile = null; }

    updateHeaderUI();
    emitChange();
    cleanAuthUrl();
  }

  /* ==========================================================================
     17. DOM WIRING
     ========================================================================== */
  function wire() {
    /* Header */
    var loginBtn = $('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', openLogin);

    var userMenuBtn  = $('userMenuBtn');
    var userDropdown = $('userDropdown');
    if (userMenuBtn && userDropdown) {
      userMenuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.dropdownOpen = !state.dropdownOpen;
        userDropdown.hidden = !state.dropdownOpen;
        userMenuBtn.setAttribute('aria-expanded', state.dropdownOpen ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!state.dropdownOpen) return;
        var um = $('userMenu');
        if (um && um.contains(e.target)) return;
        state.dropdownOpen = false;
        userDropdown.hidden = true;
        userMenuBtn.setAttribute('aria-expanded', 'false');
      });
    }

    var profileBtn = $('profileBtn');
    if (profileBtn) profileBtn.addEventListener('click', function () {
      if (userDropdown) userDropdown.hidden = true;
      state.dropdownOpen = false;
      openProfile();
    });

    var logoutBtn = $('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (userDropdown) userDropdown.hidden = true;
      state.dropdownOpen = false;
      logout();
    });

    /* Login modal — close */
    var loginCloseBtn = $('loginCloseBtn');
    if (loginCloseBtn) loginCloseBtn.addEventListener('click', closeLogin);
    var loginModal = $('loginModal');
    if (loginModal) {
      var bd = loginModal.querySelector('.auth-backdrop');
      if (bd) bd.addEventListener('click', closeLogin);
    }

    /* Login <-> Signup */
    var showSignupBtn = $('showSignupBtn');
    if (showSignupBtn) showSignupBtn.addEventListener('click', function () {
      clearMessage();
      switchView('signup');
    });
    var showLoginBtn = $('showLoginBtn');
    if (showLoginBtn) showLoginBtn.addEventListener('click', function () {
      clearMessage();
      switchView('login');
    });

    /* Login / signup / Google */
    var loginForm = $('loginForm');
    if (loginForm) loginForm.addEventListener('submit', onLoginSubmit);
    var signupForm = $('signupForm');
    if (signupForm) signupForm.addEventListener('submit', onSignupSubmit);
    var googleBtn = $('googleLoginBtn');
    if (googleBtn) googleBtn.addEventListener('click', onGoogleClick);

    /* -------- FORGOT PASSWORD -------- */
    var forgotLink = $('forgotLink');
    if (forgotLink) forgotLink.addEventListener('click', function () {
      clearMessage();
      switchView('forgot');
    });

    var forgotBackLink = $('forgotBackLink');
    if (forgotBackLink) forgotBackLink.addEventListener('click', function () {
      clearMessage();
      switchView('login');
    });

    var forgotSendBtn = $('forgotSendBtn');
    if (forgotSendBtn) forgotSendBtn.addEventListener('click', onForgotSend);

    var forgotEmail = $('forgotEmail');
    if (forgotEmail) forgotEmail.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onForgotSend(); }
    });

    /* -------- RESET PASSWORD MODAL -------- */
    var resetCloseBtn = $('resetCloseBtn');
    if (resetCloseBtn) resetCloseBtn.addEventListener('click', closeReset);
    var resetModal = $('resetModal');
    if (resetModal) {
      var rbd = resetModal.querySelector('.auth-backdrop');
      if (rbd) rbd.addEventListener('click', closeReset);
    }

    var updatePasswordBtn = $('updatePasswordBtn');
    if (updatePasswordBtn) updatePasswordBtn.addEventListener('click', onUpdatePassword);

    ['newPassword', 'confirmPassword'].forEach(function (id) {
      var elx = $(id);
      if (elx) elx.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); onUpdatePassword(); }
      });
    });

    /* -------- PROFILE MODAL -------- */
    var profileCloseBtn = $('profileCloseBtn');
    if (profileCloseBtn) profileCloseBtn.addEventListener('click', closeProfile);
    var profileModal = $('profileModal');
    if (profileModal) {
      var pbd = profileModal.querySelector('.va-backdrop, .auth-backdrop');
      if (pbd) pbd.addEventListener('click', function (e) {
        if (e.target === pbd) closeProfile();
      });
    }

    var profileForm = $('profileForm');
    if (profileForm) profileForm.addEventListener('submit', onProfileSubmit);

    var profileLogout = $('profileLogout');
    if (profileLogout) profileLogout.addEventListener('click', function () {
      closeProfile();
      logout();
    });

    var avatarInput = $('avatarInput');
    if (avatarInput) avatarInput.addEventListener('change', onAvatarFilePicked);

    var avatarRemove = $('avatarRemove');
    if (avatarRemove) avatarRemove.addEventListener('click', onAvatarRemoveClick);

    /* Phone inputs — digits only */
    ['signupPhone', 'profilePhone'].forEach(function (id) {
      var elx = $(id);
      if (!elx) return;
      elx.addEventListener('input', function () {
        var v = String(elx.value || '').replace(/\D/g, '').slice(0, 10);
        if (v !== elx.value) elx.value = v;
      });
    });

    /* Escape key closes open modals (reset modal stays, user must finish) */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var lm = $('loginModal');
      if (lm && !lm.hidden) { closeLogin(); return; }
      var pm = $('profileModal');
      if (pm && !pm.hidden) { closeProfile(); return; }
    });
  }

  /* ==========================================================================
     18. BOOT
     ========================================================================== */
  var _initPromise = null;

  function doInit() {
    return new Promise(function (resolve) {
      function run() {
        if (CONFIG_ERROR) {
          console.error('[auth] ' + CONFIG_ERROR);
          resolve(false);
          return;
        }

        wire();

        /* Detect recovery hash (safety net) */
        var hadRecoveryHash = false;
        try {
          var h = window.location.hash || '';
          if (h.indexOf('type=recovery') !== -1 || h.indexOf('type%3Drecovery') !== -1) {
            hadRecoveryHash = true;
          }
        } catch (e) {}

        /* Subscribe to auth events */
        try {
          window.vionaSupabase.auth.onAuthStateChange(function (event, session) {
            setTimeout(function () {
              try {
                if (event === 'PASSWORD_RECOVERY') {
                  openReset();
                }
                handleAuthChange(session).catch(function (err) {
                  console.warn('[auth] handleAuthChange failed:', err);
                });
              } catch (e) {
                console.warn('[auth] auth event handler failed:', e);
              }
            }, 0);
          });
        } catch (e) {
          console.warn('[auth] could not subscribe:', e);
        }

        /* Initial session */
        (async function initial() {
          try {
            var res = await window.vionaSupabase.auth.getSession();
            var session = (res && res.data) ? res.data.session : null;
            await handleAuthChange(session);

            if (hadRecoveryHash) {
              var rm = $('resetModal');
              if (!rm || rm.hidden) {
                openReset();
                cleanAuthUrl();
              }
            }
          } catch (e) {}
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
     19. PUBLIC API
     ========================================================================== */
  window.VionaAuth = {
    init: init,
    ready: function () { return init(); },

    getUser:  function () { return state.user; },
    getProfile: function () { return state.profile; },

    refreshProfile: async function () {
      if (!state.user) { state.profile = null; return null; }
      var p = await fetchProfile(state.user);
      state.profile = p;
      updateHeaderUI();
      emitChange();
      return p;
    },

    isAdmin: async function () {
      if (!state.user || !window.vionaSupabase) return false;
      try {
        var res = await window.vionaSupabase.from('admins').select('email');
        if (res && res.error) return false;
        var target = String(state.user.email || '').toLowerCase();
        var rows = Array.isArray(res.data) ? res.data : [];
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i].email || '').toLowerCase() === target) return true;
        }
        return false;
      } catch (e) { return false; }
    },

    openLogin: openLogin,
    openProfile: openProfile,
    logout: logout,

    onChange: function (cb) {
      if (typeof cb !== 'function') return function () {};
      state.listeners.push(cb);
      if (state.ready) {
        setTimeout(function () {
          try { cb(state.user, state.profile); } catch (e) {}
        }, 0);
      }
      return function off() {
        var i = state.listeners.indexOf(cb);
        if (i !== -1) state.listeners.splice(i, 1);
      };
    },

    /* js/script.js reads VionaAuth.client — return the shared client */
    get client() { return window.vionaSupabase; }
  };

  /* Auto-init so script.js can just call VionaAuth.init() (idempotent) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); }, { once: true });
  } else {
    init();
  }

})();
