/* =========================================================
   VIONA BANGLES — MAIN SCRIPT
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  /* =======================================================
     1. MOBILE HAMBURGER MENU
     ======================================================= */
  var navToggle = document.getElementById("navToggle");
  var primaryNav = document.getElementById("primaryNav");
  var navLinks = primaryNav ? primaryNav.querySelectorAll("a") : [];

  // Close the mobile menu
  function closeMenu() {
    if (!primaryNav || !navToggle) return;
    primaryNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.textContent = "☰";
    navToggle.setAttribute("aria-label", "Open menu");
  }

  // Open the mobile menu
  function openMenu() {
    if (!primaryNav || !navToggle) return;
    primaryNav.classList.add("is-open");
    navToggle.setAttribute("aria-expanded", "true");
    navToggle.textContent = "✕";
    navToggle.setAttribute("aria-label", "Close menu");
  }

  if (navToggle && primaryNav) {
    // Toggle when hamburger is clicked
    navToggle.addEventListener("click", function () {
      if (primaryNav.classList.contains("is-open")) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Close when any nav link is clicked
    navLinks.forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });

    // Close when clicking outside the header
    document.addEventListener("click", function (event) {
      if (!primaryNav.classList.contains("is-open")) return;
      var header = document.querySelector(".site-header");
      if (header && !header.contains(event.target)) {
        closeMenu();
      }
    });

    // Close on Escape key
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    });

    // Close if the window is resized above 768px
    window.addEventListener("resize", function () {
      if (window.innerWidth > 768) {
        closeMenu();
      }
    });
  }

  /* =======================================================
     2. LOAD BUSINESS NAME & EMAIL FROM SITE_CONFIG
     ======================================================= */
  if (typeof SITE_CONFIG !== "undefined") {
    var businessName = SITE_CONFIG.businessName || "Viona Bangles";
    var email = SITE_CONFIG.email || "";

    // Put business name anywhere with data-site="businessName"
    document.querySelectorAll('[data-site="businessName"]').forEach(function (el) {
      el.textContent = businessName;
    });

    // Put email anywhere with data-site="email"
    document.querySelectorAll('[data-site="email"]').forEach(function (el) {
      if (email) {
        el.textContent = email;

        // If it is a link, make it open the mail app
        if (el.tagName === "A") {
          el.href = "mailto:" + email;
        }
      }
    });
  }

  /* =======================================================
     3. FOOTER YEAR
     ======================================================= */
  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});
