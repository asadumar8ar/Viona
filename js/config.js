/* ============================================================================
   Viona Bangles — js/config.js
   ----------------------------------------------------------------------------
   This is the ONLY file you edit to connect the website to Supabase.
   Everything here is public and safe to expose (it is shipped to the browser).

   IMPORTANT:
   - SUPABASE_URL must start with "https://" and end with ".supabase.co"
   - Use the "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z" key ONLY.
     NEVER put the "service_role" key here. That key bypasses all security.

   If you leave the PASTE_... values in place, the website still works using
   its built-in demo products, and no errors are shown to visitors.
   ============================================================================ */

window.VIONA_CONFIG = {

  /* ---------------- Business details (fallback if Supabase is empty) ------ */
  BUSINESS_NAME: "Viona Bangles",
  WHATSAPP_NUMBER: "916200920746",   // country code + number, no + or spaces
  EMAIL: "vionabangles@gmail.com",
  CITY: "Gaya, Bihar",
  HOURS: "10:00 AM - 7:00 PM",

  /* ---------------- Supabase connection ----------------------------------- */
  // Replace with your real Project URL. It MUST start with https://
  SUPABASE_URL: "https://sqjbmdicbkykfqnqezss.supabase.co",

  // Replace with your real anon (public) key.
  SUPABASE_ANON_KEY: "sb_publishable_kQxMgjHaLLSl0n82pnFOXQ_FTXlSx2z"

};
