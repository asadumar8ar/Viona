/* ============================================================
   VIONA BANGLES — GLOBAL STYLES
   Navy + Gold + Ivory theme | Serif headings | Premium, not glittery
   ============================================================ */

/* ---------- 1. RESET & VARIABLES ---------- */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --navy: #0f1b33;
  --navy-light: #1a2a4a;
  --gold: #c9a227;
  --gold-light: #e0c04a;
  --ivory: #fdfaf3;
  --ivory-dark: #f5efe2;
  --text-dark: #1a1a1a;
  --text-muted: #4a4a4a;
  --white: #ffffff;
  --shadow-soft: 0 6px 24px rgba(15, 27, 51, 0.08);
  --shadow-hover: 0 12px 32px rgba(15, 27, 51, 0.14);
  --radius: 12px;
  --radius-sm: 8px;
  --font-serif: 'Georgia', 'Times New Roman', serif;
  --font-sans: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --max-width: 1200px;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-sans);
  color: var(--text-dark);
  background-color: var(--ivory);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

img {
  max-width: 100%;
  display: block;
}

a {
  text-decoration: none;
  color: inherit;
}

ul {
  list-style: none;
}

/* ---------- 2. UTILITY ---------- */
.container {
  width: 100%;
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 24px;
}

.section-label {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 8px;
}

.section-title {
  font-family: var(--font-serif);
  font-size: 2rem;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 12px;
  line-height: 1.25;
}

.section-subtitle {
  font-size: 1.05rem;
  color: var(--text-muted);
  max-width: 620px;
  margin-bottom: 32px;
}

/* Buttons */
.btn {
  display: inline-block;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  font-weight: 600;
  padding: 12px 28px;
  border-radius: 50px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.25s ease;
  text-align: center;
}

.btn-gold {
  background-color: var(--gold);
  color: var(--navy);
  border-color: var(--gold);
}

.btn-gold:hover {
  background-color: var(--gold-light);
  border-color: var(--gold-light);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(201, 162, 39, 0.3);
}

.btn-outline {
  background-color: transparent;
  color: var(--ivory);
  border-color: var(--ivory);
}

.btn-outline:hover {
  background-color: var(--ivory);
  color: var(--navy);
  transform: translateY(-2px);
}

/* ---------- 3. HEADER ---------- */
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background-color: var(--navy);
  border-bottom: 1px solid rgba(201, 162, 39, 0.25);
  transition: box-shadow 0.3s ease;
}

.site-header.scrolled {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
}

.logo {
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--ivory);
  letter-spacing: 0.02em;
}

.logo span {
  color: var(--gold);
}

.main-nav {
  display: flex;
  gap: 32px;
}

.main-nav a {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--ivory);
  letter-spacing: 0.04em;
  position: relative;
  transition: color 0.2s ease;
}

.main-nav a::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 0;
  width: 0;
  height: 2px;
  background-color: var(--gold);
  transition: width 0.25s ease;
}

.main-nav a:hover {
  color: var(--gold);
}

.main-nav a:hover::after {
  width: 100%;
}

/* Mobile nav toggle */
.nav-toggle {
  display: none;
  flex-direction: column;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
}

.nav-toggle span {
  display: block;
  width: 26px;
  height: 2px;
  background-color: var(--ivory);
  transition: all 0.3s ease;
}

/* ---------- 4. HERO ---------- */
.hero {
  background: linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);
  color: var(--ivory);
  padding: 100px 0 90px;
  position: relative;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  top: -60px;
  right: -60px;
  width: 320px;
  height: 320px;
  border: 1px solid rgba(201, 162, 39, 0.15);
  border-radius: 50%;
  pointer-events: none;
}

.hero-inner {
  max-width: 680px;
}

.hero-label {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 16px;
}

.hero-title {
  font-family: var(--font-serif);
  font-size: 2.8rem;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 20px;
  color: var(--ivory);
}

.hero-text {
  font-size: 1.1rem;
  color: rgba(253, 250, 243, 0.85);
  margin-bottom: 36px;
  max-width: 540px;
}

.hero-buttons {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

/* ---------- 5. COLLECTIONS ---------- */
.collections {
  padding: 80px 0 90px;
  background-color: var(--ivory);
}

.loading-text {
  font-size: 1rem;
  color: var(--text-muted);
  margin-bottom: 24px;
  font-style: italic;
}

.message-area {
  font-size: 0.95rem;
  color: var(--text-muted);
  margin-top: 24px;
  min-height: 1.4em;
}

/* Product grid */
.product-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 28px;
}

/* Product card */
.product-card {
  background-color: var(--ivory);
  border: 1px solid rgba(201, 162, 39, 0.35);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.product-card:hover {
  transform: translateY(-6px);
  box-shadow: var(--shadow-hover);
}

.product-image {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  background-color: var(--ivory-dark);
  display: block;
}

.product-info {
  padding: 18px 16px 20px;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-code {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 6px;
}

.product-name {
  font-family: var(--font-serif);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 8px;
  line-height: 1.3;
}

.product-price {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 12px;
}

/* Size chips */
.size-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.size-chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 50px;
  border: 1.5px solid var(--navy);
  background-color: transparent;
  color: var(--navy);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
}

.size-chip:hover {
  background-color: rgba(201, 162, 39, 0.15);
  border-color: var(--gold);
}

.size-chip.selected {
  background-color: var(--gold);
  border-color: var(--gold);
  color: var(--navy);
}

/* Card button */
.product-card .btn {
  margin-top: auto;
  width: 100%;
  font-size: 0.85rem;
  padding: 10px 16px;
}

/* ---------- 6. ABOUT ---------- */
.about {
  padding: 80px 0;
  background-color: var(--ivory-dark);
}

.about .section-subtitle {
  max-width: 720px;
  margin-bottom: 0;
}

/* ---------- 7. CONTACT ---------- */
.contact {
  padding: 80px 0 90px;
  background-color: var(--ivory);
}

.contact-actions {
  margin-top: 8px;
}

/* ---------- 8. FOOTER ---------- */
.site-footer {
  background-color: var(--navy);
  color: rgba(253, 250, 243, 0.7);
  padding: 32px 0;
}

.footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.footer-brand {
  font-family: var(--font-serif);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--gold);
}

.footer-note {
  font-size: 0.85rem;
}

/* ---------- 9. RESPONSIVE ---------- */
@media (max-width: 1024px) {
  .product-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .hero-title {
    font-size: 2.4rem;
  }
}

@media (max-width: 768px) {
  .header-inner {
    height: 64px;
  }

  .nav-toggle {
    display: flex;
  }

  .main-nav {
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    background-color: var(--navy);
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: 0;
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.35s ease, padding 0.35s ease;
    border-bottom: 1px solid rgba(201, 162, 39, 0.2);
  }

  .main-nav.open {
    max-height: 320px;
    padding: 16px 0 24px;
  }

  .main-nav a {
    padding: 12px 0;
    font-size: 1rem;
  }

  .hero {
    padding: 70px 0 60px;
  }

  .hero-title {
    font-size: 2rem;
  }

  .hero-text {
    font-size: 1rem;
  }

  .section-title {
    font-size: 1.6rem;
  }

  .collections,
  .about,
  .contact {
    padding: 60px 0;
  }

  .footer-inner {
    flex-direction: column;
    text-align: center;
  }
}

@media (max-width: 520px) {
  .product-grid {
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .product-info {
    padding: 12px 12px 16px;
  }

  .product-name {
    font-size: 0.95rem;
  }

  .product-price {
    font-size: 1rem;
  }

  .size-chip {
    font-size: 0.7rem;
    padding: 3px 8px;
  }

  .product-card .btn {
    font-size: 0.78rem;
    padding: 8px 12px;
  }

  .hero-buttons {
    flex-direction: column;
  }

  .hero-buttons .btn {
    width: 100%;
  }
}
