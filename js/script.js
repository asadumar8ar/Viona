document.addEventListener("DOMContentLoaded", () => {
  const products = [
    {
      id: 1,
      name: "VIONA Classic Glass Bangles",
      category: "Classic",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    },
    {
      id: 2,
      name: "VIONA Designer Glass Bangles",
      category: "Designer",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    },
    {
      id: 3,
      name: "VIONA Festive Glass Bangles",
      category: "Festive",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    },
    {
      id: 4,
      name: "VIONA Traditional Bangles",
      category: "Traditional",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    },
    {
      id: 5,
      name: "VIONA Wedding Glass Bangles",
      category: "Wedding",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    },
    {
      id: 6,
      name: "VIONA Fashion Bangles",
      category: "Fashion",
      price: 799,
      sizes: ["2.2", "2.4", "2.6", "2.8"],
      description: "Glass bangles. Sizes 2.2 to 2.8."
    }
  ];

  const productGrid = document.getElementById("productGrid");
  const searchInput = document.getElementById("searchInput");
  const categoryFilters = document.getElementById("categoryFilters");
  const sizeChips = document.getElementById("sizeChips");
  const resultCount = document.getElementById("resultCount");
  const noResults = document.getElementById("noResults");

  let currentCategory = "All";
  let currentSize = "All";
  let searchQuery = "";

  const whatsappNumber = "916200920746";
  const whatsappBase = `https://wa.me/${whatsappNumber}?text=`;

  function productWhatsAppLink(name, size) {
    const text = `Hello Viona, I want to order ${name} in size ${size}`;
    return whatsappBase + encodeURIComponent(text);
  }

  function renderProducts() {
    if (!productGrid) return;

    const query = searchQuery.trim().toLowerCase();

    const filtered = products.filter((product) => {
      const matchSearch =
        !query || product.name.toLowerCase().includes(query);
      const matchCategory =
        currentCategory === "All" || product.category === currentCategory;
      const matchSize =
        currentSize === "All" || product.sizes.includes(currentSize);

      return matchSearch && matchCategory && matchSize;
    });

    productGrid.innerHTML = filtered
      .map((product) => {
        const sizeBadges = product.sizes
          .map((size) => `<span class="size-badge">${size}</span>`)
          .join("");

        return `
          <article class="product-card" data-category="${product.category}">
            <div class="product-thumb" aria-hidden="true"><span></span></div>
            <div class="product-body">
              <p class="product-cat">${product.category}</p>
              <h3 class="product-name">${product.name}</h3>
              <p class="product-desc">${product.description}</p>
              <div class="product-sizes" aria-label="Available sizes">
                ${sizeBadges}
              </div>
              <div class="product-bottom">
                <p class="product-price">₹${product.price}</p>
                <a class="btn btn-whatsapp"
                   href="${productWhatsAppLink(product.name, product.sizes[0])}"
                   target="_blank"
                   rel="noopener">Order on WhatsApp</a>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    const total = products.length;
    const shown = filtered.length;

    if (resultCount) {
      resultCount.textContent = `Showing ${shown} of ${total} products`;
    }

    if (noResults) {
      noResults.hidden = shown !== 0;
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      searchQuery = event.target.value;
      renderProducts();
    });
  }

  if (categoryFilters) {
    categoryFilters.addEventListener("click", (event) => {
      const button = event.target.closest(".filter-btn");
      if (!button) return;

      currentCategory = button.dataset.category || "All";

      categoryFilters.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.classList.toggle("active", btn === button);
      });

      renderProducts();
    });
  }

  if (sizeChips) {
    sizeChips.addEventListener("click", (event) => {
      const button = event.target.closest(".size-chip");
      if (!button) return;

      currentSize = button.dataset.size || "All";

      sizeChips.querySelectorAll(".size-chip").forEach((btn) => {
        btn.classList.toggle("active", btn === button);
      });

      renderProducts();
    });
  }

  document.querySelectorAll(".faq-q").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest(".faq-item");
      if (!item) return;

      const isOpen = item.classList.toggle("open");
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  });

  const navToggle = document.getElementById("navToggle");
  const header = document.querySelector(".site-header");

  if (navToggle && header) {
    navToggle.addEventListener("click", () => {
      const open = header.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.querySelectorAll("#primaryNav a").forEach((link) => {
      link.addEventListener("click", () => {
        header.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  renderProducts();
});
