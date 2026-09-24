// ============================================================
//  ⚠️ YAHAN APNA SUPABASE URL AUR KEY DAALO (line 5 aur 6)
// ============================================================
const SUPABASE_URL = 'sqjbmdicbkykfqnqezss';
const SUPABASE_ANON_KEY = 'sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z';

// ============================================================
//  TOAST (popup notification)
// ============================================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type === 'success' ? 'toast-success' : 'toast-error');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// ============================================================
//  MOBILE MENU (hamburger toggle)
// ============================================================
const menuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

menuBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
});

mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => mobileMenu.classList.add('hidden'));
});

// ============================================================
//  FETCH PRODUCTS FROM SUPABASE
// ============================================================
async function fetchProducts() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            }
        });
        if (!res.ok) throw new Error('Failed to fetch products');
        return await res.json();
    } catch (err) {
        console.error('Supabase fetch error:', err);
        return null;
    }
}

// ============================================================
//  FALLBACK PRODUCTS (jab tak Supabase ready na ho)
// ============================================================
const FALLBACK_PRODUCTS = [
    { id: 1, name: 'Test Bangle', price: 499, main_image: null },
    { id: 2, name: 'Golden Kada Set', price: 749, main_image: null },
    { id: 3, name: 'Pearl Churi Pair', price: 599, main_image: null },
    { id: 4, name: 'Antique Bridal Set', price: 1499, main_image: null },
    { id: 5, name: 'Ruby Stone Bangle', price: 1099, main_image: null },
    { id: 6, name: 'Classic Meenakari', price: 649, main_image: null },
    { id: 7, name: 'Rose Gold Churi', price: 399, main_image: null },
    { id: 8, name: 'Diamond Finish Kada', price: 1299, main_image: null },
];

// ============================================================
//  PRODUCT CARD HTML
// ============================================================
function createProductCard(p) {
    const imageHTML = p.main_image
        ? `<img src="${p.main_image}" alt="${p.name}" loading="lazy" />`
        : `<span>💫</span>`;

    return `
        <a href="product.html?id=${p.id}" class="product-card">
            <div class="product-image">${imageHTML}</div>
            <div class="p-4">
                <h4 class="font-display font-bold text-plum text-lg truncate">${p.name}</h4>
                <div class="flex items-center justify-between mt-2">
                    <span class="price-tag">₹${p.price}</span>
                    <span class="text-sm font-semibold text-gold">View →</span>
                </div>
            </div>
        </a>
    `;
}

// ============================================================
//  RENDER PRODUCTS
// ============================================================
function renderProducts(products) {
    const grid = document.getElementById('product-grid');
    if (!products || products.length === 0) {
        grid.innerHTML = `<div class="text-center py-12 col-span-full text-gray-400">No products found.</div>`;
        return;
    }
    grid.innerHTML = products.map(createProductCard).join('');
}

// ============================================================
//  LOAD PRODUCTS
// ============================================================
async function loadProducts() {
    let products = await fetchProducts();
    if (!products || products.length === 0) {
        products = FALLBACK_PRODUCTS;
        console.log('Using fallback products');
    }
    renderProducts(products);
}

// ============================================================
//  CONTACT FORM → Supabase leads table
// ============================================================
document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const message = document.getElementById('contact-message').value.trim();

    if (!name || !phone || !message) {
        showToast('Please fill all fields', 'error');
        return;
    }

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ name, phone, message }),
        });
        if (!res.ok) throw new Error('Failed to submit');
        showToast('Message sent! We\'ll get back to you soon.', 'success');
        document.getElementById('contact-form').reset();
    } catch (err) {
        console.error(err);
        showToast('Failed to send. Please try again.', 'error');
    }
});

// ============================================================
//  INIT — page load hote hi products fetch karo
// ============================================================
loadProducts();
