// Viona Bangles - Supabase Connection

const SUPABASE_URL = "https://sqjbmdicbkykfqnqezss.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("Viona Bangles connected to Supabase!");
// Viona Bangles - Supabase

const SUPABASE_URL = "https://sqjbmdicbkykfqnqezss.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

// Load products
async function loadProducts() {
    const { data, error } = await supabase
        .from("products")
        .select("*");

    if (error) {
        console.error("Products load error:", error);
        return;
    }

    console.log("Products:", data);

    const container = document.getElementById("products");

    if (!container) {
        console.error("Products container not found.");
        return;
    }

    container.innerHTML = "";

    data.forEach(product => {
        const card = document.createElement("div");

        card.className = "product-card";

        card.innerHTML = `
            <img 
                src="${product["main image"] || ""}" 
                alt="${product.name || "Viona Bangles"}"
            >

            <h3>${product.name || "Unnamed Product"}</h3>

            <p>${product.category || ""}</p>

            <p>Size: ${product.size || "N/A"}</p>

            <p>${product.description || ""}</p>

            <button onclick="viewProduct('${product.id}')">
                View Product
            </button>
        `;

        container.appendChild(card);
    });
}

function viewProduct(id) {
    console.log("Selected product:", id);
    // Product detail page Task 3 mein banayenge.
}

loadProducts();
