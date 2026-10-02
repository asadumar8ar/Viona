/* ============================================================
   Viona Bangles — script.js
   Demo products + category filter + search
   Supabase not ready — silently using demo products.
   ============================================================ */

/* ---------- Demo products (6 items) ---------- */
const demoProducts = [
  {
    id: 1,
    code: "VB-001",
    name: "Classic Glass Bangles",
    category: "Glass",
    description: "Everyday glass bangles with a smooth finish and rich colour.",
    price: 249,
    sizes: ["2.4", "2.6", "2.8"],
  },
  {
    id: 2,
    code: "VB-002",
    name: "Designer Glass Bangles",
    category: "Glass",
    description: "Hand-painted designer glass bangles for a standout look.",
    price: 399,
    sizes: ["2.4", "2.6", "2.8"],
  },
  {
    id: 3,
    code: "VB-003",
    name: "Festive Glass Bangles",
    category: "Glass",
    description: "Bright festive glass bangles — perfect for celebrations.",
    price: 349,
    sizes: ["2.4", "2.6", "2.8"],
  },
  {
    id: 4,
    code: "VB-004",
    name: "Traditional Bangles",
    category: "Traditional",
    description: "Classic traditional bangles with timeless motifs.",
    price: 499,
    sizes: ["2.4", "2.6", "2.8"],
  },
  {
    id: 5,
    code: "VB-005",
    name: "Wedding Glass Bangles",
    category: "Bridal",
    description: "Bridal glass bangles with a premium, elegant finish.",
    price: 699,
    sizes: ["2.4", "2.6", "2.8"],
  },
  {
    id: 6,
    code: "VB-006",
    name: "Fashion Bangles",
    category: "Fashion",
    description: "Trendy fashion bangles to complete your everyday outfit.",
    price: 299,
    sizes: ["2.4", "2.6", "2.8"],
  },
];

/* ---------- State ---------- */
let allProducts = [...demoProducts];
let activeCategory = "All";
let searchTerm = "";
const selectedSizes = {}; // productId -> selected size
let debounceTimer = null;

/* ---------- DOM references ---------- */
const grid = document.getElementById("product-grid");
const categoryBar = document.getElementById("category-bar");
const searchInput = document.getElementById("search-input");
const clearBtn = document.getElementById("clear-search");
const resultCount = document.getElementById("result-count");
const noResults = document.getElementById("no-results");
const showAllBtn = document.getElementById("show-all-btn");
const yearEl = document.getElementById("year");

/* ---------- Helpers ---------- */
function escapeHTML(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getCategory(product) {
  const cat = (product.category || "").trim();
  return cat || "Other";
}

/* ---------- Filter logic (category + search) ---------- */
function getFilteredProducts() {
  const term = normalizeText(searchTerm);

  return allProducts.filter((product) => {
    const category = getCategory(product);

    // Category match
    const matchesCategory =
      activeCategory === "All" || category === activeCategory;
    if (!matchesCategory) return false;

    // If no search term, show all in category
    if (!term) return true;

    // Search in name, category, description, code
    const haystack = [
      product.name,
      category,
      product.description,
      product.code,
    ]
      .map(normalizeText)
      .join(" ");

    return haystack.includes(term);
  });
}

/* ---------- Build category buttons ---------- */
function renderCategories() {
  const categories = ["All", ...new Set(allProducts.map(getCategory))];

  categoryBar.innerHTML = categories
    .map((cat) => {
      const active = cat === activeCategory ? " active" : "";
      return `<button type="button" class="category-btn${active}" data-category="${escapeHTML(
        cat
      )}">${escapeHTML(cat)}</button>`;
    })
    .join("");
}

/* ---------- Render product cards ---------- */
function renderProducts(list) {
  const count = list.length;
  resultCount.textContent = `Showing ${count} bangle${count === 1 ? "" : "s"}`;

  if (count === 0) {
    grid.hidden = true;
    noResults.hidden = false;
    grid.innerHTML = "";
    return;
  }

  grid.hidden = false;
  noResults.hidden = true;

  grid.innerHTML = list
    .map((product) => {
      const id = product.id;
      const selected = selectedSizes[id] || "";

      const sizesHtml = (product.sizes || [])
        .map((size) => {
          const active = size === selected ? " active" : "";
          return `<button type="button" class="size-chip${active}" data-id="${id}" data-size="${escapeHTML(
            size
          )}">${escapeHTML(size)}</button>`;
        })
        .join("");

      const waText = encodeURIComponent(
        `Hi Viona Bangles, I want to order:\n${product.name} (${product.code})\nSize: ${
          selected || "not selected"
        }\nPrice: ₹${product.price}`
      );
      const waHref = `https://wa.me/919999999999?text=${waText}`;

      return `
        <article class="product-card">
          <div class="card-img">${escapeHTML(product.name.charAt(0))}</div>
          <div class="card-body">
            <div class="card-category">${escapeHTML(getCategory(product))}</div>
            <h3 class="card-title">${escapeHTML(product.name)}</h3>
            <p class="card-desc">${escapeHTML(product.description)}</p>
            <div class="card-code">Code: ${escapeHTML(product.code)}</div>
            <div class="card-price">₹${escapeHTML(String(product.price))}</div>
            <div class="size-chips">${sizesHtml}</div>
            <a class="btn-whatsapp" href="${waHref}" target="_blank" rel="noopener">Order on WhatsApp</a>
          </div>
        </article>
      `;
    })
    .join("");
}

/* ---------- Main render ---------- */
function render() {
  renderCategories();
  const filtered = getFilteredProducts();
  renderProducts(filtered);
}

/* ---------- Category bar click (delegation) ---------- */
categoryBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;

  activeCategory = btn.dataset.category;
  render();
});

/* ---------- Size chip click (delegation) ---------- */
grid.addEventListener("click", (e) => {
  const chip = e.target.closest(".size-chip");
  if (!chip) return;

  const id = Number(chip.dataset.id);
  const size = chip.dataset.size;
  selectedSizes[id] = size;

  // Re-render current filtered list to update active chip and WhatsApp link
  const filtered = getFilteredProducts();
  renderProducts(filtered);
});

/* ---------- Search input with 200ms debounce ---------- */
searchInput.addEventListener("input", () => {
  const value = searchInput.value;
  clearBtn.hidden = value.trim() === "";

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    searchTerm = value;
    render();
  }, 200);
});

/* ---------- Clear (x) button ---------- */
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchTerm = "";
  clearBtn.hidden = true;
  render();
  searchInput.focus();
});

/* ---------- "Show all bangles" button ---------- */
showAllBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchTerm = "";
  clearBtn.hidden = true;
  activeCategory = "All";
  render();
});

/* ---------- Footer year ---------- */
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

/* ---------- Init ---------- */
render();
