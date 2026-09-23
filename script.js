// Viona Bangles - Supabase
document.getElementById("products").innerHTML = "<p>JavaScript is working...</p>";
const SUPABASE_URL = "https://sqjbmdicbkykfqnqezss.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

async function loadProducts() {

    const container = document.getElementById("products");

    try {

        if (!container) {
            throw new Error("Products section not found in index.html");
        }

        const { data, error } = await supabase
            .from("products")
            .select("*");

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            container.innerHTML = "<p>No products found in Supabase.</p>";
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
                    style="width:250px;"
                >

                <h3>${product.name || "Unnamed Product"}</h3>

                <p>Category: ${product.category || "N/A"}</p>

                <p>Size: ${product.size || "N/A"}</p>

                <p>${product.description || ""}</p>

                <button>
                    View Product
                </button>
            `;

            container.appendChild(card);
        });

    } catch (error) {

        console.error(error);

        container.innerHTML = `
            <p style="color:red;">
                Error loading products: ${error.message}
            </p>
        `;
    }
}

loadProducts();
   
