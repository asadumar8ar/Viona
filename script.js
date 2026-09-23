// Viona Bangles - Supabase Connection

const SUPABASE_URL = "https://sqjbmdicbkykfqnqezss.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("Viona Bangles connected to Supabase!");
