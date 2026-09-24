/* ============================================================
   VIONA BANGLES — Main Script
   Phase 1: UI + Test Data
   Phase 3 me Supabase connect karenge
   ============================================================ */

// ---------- TEST DATA (temporary — Supabase se replace hoga) ----------
const TEST_PRODUCTS = [
  { id: 1, name: 'Test Bangle', price: 499, main_image: null },
  { id: 2, name: 'Golden Kada Set', price: 749, main_image: null },
  { id: 3, name: 'Pearl Churi Pair', price: 599, main_image: null },
  { id: 4, name: 'Antique Choker Bangle', price: 899, main_image: null },
  { id: 5, name: 'Ruby Stone Bangle', price: 1099, main_image: null },
  { id: 6, name: 'Classic Meenakari', price: 649, main_image: null },
  { id: 7, name: 'Rose Gold Thin Churi', price: 399, main_image: null },
  { id: 8, name: 'Bridal Bangle Set', price: 1499, main_image: null },
];

// ---------- NAVBAR: scroll effect ----------
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
});

// ---------- NAVBAR: mobile toggle ----------
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  navToggle.classList.toggle('active');
});

// Mobile link click par menu band
navLinks.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.classList.remove('active');
  });
});

// ---------- PRODUCT CARD HTML banane wala function ----------
function createProductCard(product) {
  const card = document.createElement('a');
  card.className = 'product-card';
  card.href = `product.html?id=${product.id}`;

  // Image ya placeholder
  const imageHTML = product.main_image
    ? `<img src="${product.main_image}" alt="${product.name}" loading="lazy" />`
    : `<div class="placeholder">🌸</div>`;

  card.innerHTML = `
    <div class="product-card-img">${imageHTML}</div>
    <div class="product-card-body">
      <h3 class="product-card-name">${product.name}</h3>
      <p class="product-card-price">₹${product.price}</p>
    </div>
  `;

  return card;
}

// ---------- FEATURED GRID render (pehle 3 products) ----------
const featuredGrid = document.getElementById('featuredGrid');
if (featuredGrid) {
  const featured = TEST_PRODUCTS.slice(0, 3);
  featured.forEach((p) => featuredGrid.appendChild(createProductCard(p)));
}

// ---------- MAIN PRODUCT GRID render (saare products) ----------
const productGrid = document.getElementById('productGrid');
if (productGrid) {
  TEST_PRODUCTS.forEach((p) => productGrid.appendChild(createProductCard(p)));
}

console.log('✅ Viona: Test products rendered. Supabase connection pending (Phase 3).');

       
