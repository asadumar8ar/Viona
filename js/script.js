/* ============================================================
   VIONA BANGLES — MAIN SCRIPT
   - Mobile nav toggle
   - WhatsApp links (hero + contact)
   - Product loading from Supabase (with demo fallback)
   - Product cards with size chips and WhatsApp order button
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // ---------- 1. MOBILE NAV TOGGLE ----------
  const navToggle = document.getElementById("nav-toggle");
  const mainNav = document.getElementById("main-nav");

  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => {
      const isOpen = mainNav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", isOpen);
    });

    // Close menu when a link is clicked
    mainNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mainNav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---------- 2. HEADER SCROLL SHADOW ----------
  const header = document.getElementById("site-header");
  if (header) {
    window.addEventListener("scroll", () => {
      header.classList.toggle("scrolled", window.scrollY > 10);
    });
  }

  // ---------- 3. FOOTER YEAR ----------
  const yearSpan = document.getElementById("footer-year");
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // ---------- 4. WHATSAPP LINKS (HERO + CONTACT) ----------
  const waNumber = CONFIG.WHATSAPP_NUMBER;
  const heroWa = document.getElementById("hero-whatsapp");
  const contactWa = document.getElementById("contact-whatsapp");

  if (heroWa) {
    heroWa.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(
      "Hello Viona, I would like to know more about your bangles."
    )}`;
    heroWa.target = "_blank";
    heroWa.rel = "noopener noreferrer";
  }

  if (contactWa) {
    contactWa.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(
      "Hello Viona, I have a question about your bangles."
    )}`;
    contactWa.target = "_blank";
    contactWa.rel = "noopener noreferrer";
  }

  // ---------- 5. PRODUCT LOADING ----------
  const productGrid = document.getElementById("product-grid");
  const loadingText = document.getElementById("loading-text");
  const messageArea = document.getElementById("message-area");

  if (!productGrid) return;

  // Helper: escape HTML to prevent XSS
  function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    const str = String(text);
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Helper: format price as "Rs 799"
  function formatPrice(price) {
    const num = Number(price);
    if (isNaN(num)) return "Rs --";
    return `Rs ${num}`;
  }

  // Helper: build WhatsApp order link for a product
  function buildWhatsAppLink(product, selectedSize) {
    const code = `VB-${String(product.id).padStart(3, "0")}`;
    const sizeText = selectedSize ? selectedSize : "to be confirmed";
    const message =
      `Hello Viona, I want to order:\n` +
      `Product: ${product.name}\n` +
      `Code: ${code}\n` +
      `Price: ${formatPrice(product.price)}\n` +
      `Size: ${sizeText}`;
    return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
  }

  // Helper: SVG placeholder image (navy to gold gradient + bangle ring)
  function getPlaceholderImage() {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f1b33"/>
            <stop offset="100%" stop-color="#c9a227"/>
          </linearGradient>
        </defs>
        <rect width="400" height="400" fill="url(#bg)"/>
        <circle cx="200" cy="200" r="90" fill="none" stroke="#fdfaf3" stroke-width="8" opacity="0.85"/>
        <circle cx="200" cy="200" r="70" fill="none" stroke="#fdfaf3" stroke-width="3" opacity="0.5"/>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  // ---------- 6. DEMO PRODUCTS ----------
  const DEMO_PRODUCTS = [
    { id: 1, name: "VIONA Classic Glass Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
    { id: 2, name: "VIONA Designer Glass Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
    { id: 3, name: "VIONA Festive Glass Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
    { id: 4, name: "VIONA Traditional Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
    { id: 5, name: "VIONA Wedding Glass Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
    { id: 6, name: "VIONA Fashion Bangles", price: 799, sizes: ["2.2", "2.4", "2.6", "2.8"], main_image: "" },
  ];

  // ---------- 7. RENDER PRODUCTS ----------
  function renderProducts(products) {
    productGrid.innerHTML = "";

    products.forEach((product) => {
      const card = document.createElement("div");
      card.className = "product-card";

      // Image
      const img = document.createElement("img");
      img.className = "product-image";
      img.alt = escapeHtml(product.name);
      img.loading = "lazy";

      const placeholder = getPlaceholderImage();
      img.src = product.main_image || placeholder;
      img.onerror = () => {
        img.src = placeholder;
      };

      // Info
      const info = document.createElement("div");
      info.className = "product-info";

      const code = document.createElement("p");
      code.className = "product-code";
      code.textContent = `VB-${String(product.id).padStart(3, "0")}`;

      const name = document.createElement("h3");
      name.className = "product-name";
      name.textContent = product.name;

      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = formatPrice(product.price);

      // Sizes
      const sizesContainer = document.createElement("div");
      sizesContainer.className = "size-chips";

      let sizes = [];
      if (Array.isArray(product.sizes)) {
        sizes = product.sizes;
      } else if (typeof product.sizes === "string") {
        sizes = product.sizes.split(",").map((s) => s.trim()).filter(Boolean);
      }

      let selectedSize = null;

      sizes.forEach((size) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "size-chip";
        chip.textContent = size;
        chip.addEventListener("click", () => {
          // Deselect all chips in this card
          sizesContainer.querySelectorAll(".size-chip").forEach((c) => {
            c.classList.remove("selected");
          });
          chip.classList.add("selected");
          selectedSize = size;
        });
        sizesContainer.appendChild(chip);
      });

      // WhatsApp button
      const waBtn = document.createElement("a");
      waBtn.className = "btn btn-gold";
      waBtn.textContent = "Order on WhatsApp";
      waBtn.href = buildWhatsAppLink(product, null);
      waBtn.target = "_blank";
      waBtn.rel = "noopener noreferrer";

      waBtn.addEventListener("click", (e) => {
        e.preventDefault();
        waBtn.href = buildWhatsAppLink(product, selectedSize);
        window.open(waBtn.href, "_blank", "noopener,noreferrer");
      });

      info.appendChild(code);
      info.appendChild(name);
      info.appendChild(price);
      info.appendChild(sizesContainer);
      info.appendChild(waBtn);

      card.appendChild(img);
      card.appendChild(info);
      productGrid.appendChild(card);
    });
  }

  // ---------- 8. LOAD PRODUCTS (SUPABASE OR DEMO) ----------
  async function loadProducts() {
    const url = CONFIG.SUPABASE_URL;
    const key = CONFIG.SUPABASE_ANON_KEY;

    // If placeholders are still present, show demo silently
    const isPlaceholder =
      !url ||
      url.includes("PASTE_YOUR") ||
      !key ||
      key.includes("PASTE_YOUR");

    if (isPlaceholder) {
      if (loadingText) loadingText.style.display = "none";
      renderProducts(DEMO_PRODUCTS);
      return;
    }

    // Try Supabase
    try {
      const endpoint = `${url}/rest/v1/products?select=*&order=id.asc`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Supabase error: ${response.status}`);
      }

      const data = await response.json();

      if (loadingText) loadingText.style.display = "none";

      if (!data || data.length === 0) {
        // Table empty — show demo silently
        renderProducts(DEMO_PRODUCTS);
        return;
      }

      renderProducts(data);
    } catch (error) {
      // Fetch failed — show demo silently (no error to visitor)
      console.warn("Supabase fetch failed, using demo products:", error);
      if (loadingText) loadingText.style.display = "none";
      renderProducts(DEMO_PRODUCTS);
    }
  }

  loadProducts();
});
