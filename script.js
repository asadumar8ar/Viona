// Viona Bangles - Supabase Connection

const SUPABASE_URL = "https://sqjbmdicbkykfqnqezss.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("Viona Bangles connected to Supabase!");
