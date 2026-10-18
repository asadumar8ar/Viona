/* ============================================================================
   Viona Bangles — js/config.js
   ----------------------------------------------------------------------------
   This is the ONLY file you need to edit to connect the site to Supabase.

   ⚠️  NOTES
   - SUPABASE_ANON_KEY is the PUBLIC (anon) key. It is safe to ship in the
     browser. NEVER put the service_role key in this file.
   - Both values come from:  Supabase Dashboard → Project Settings → API
   - js/auth.js reads SUPABASE_URL + SUPABASE_ANON_KEY and creates the shared
     Supabase client. js/script.js reads BUSINESS_NAME, WHATSAPP_NUMBER,
     EMAIL, CITY and HOURS to fill the header, hero, contact section and
     footer automatically.
   ============================================================================ */

window.VIONA_CONFIG = {

  /* ------------------------------------------------------------------------
     1. BUSINESS DETAILS (used by js/script.js to fill the site)
     ------------------------------------------------------------------------
     WHATSAPP_NUMBER must be digits only, with the country code.
     Example: India -> 91 + 10-digit number.
     ------------------------------------------------------------------------ */
  BUSINESS_NAME:   "Viona Bangles",
  WHATSAPP_NUMBER: "916200920746",
  EMAIL:           "vionabangles@gmail.com",
  CITY:            "Gaya, Bihar",
  HOURS:           "10:00 AM - 7:00 PM",

  /* ------------------------------------------------------------------------
     2. SUPABASE CONNECTION (required for products, reviews, auth)
     ------------------------------------------------------------------------
     Copy these from the Supabase Dashboard → Project Settings → API.
     ------------------------------------------------------------------------ */
  SUPABASE_URL: "https://sqjbmdicbkykfqnqezss.supabase.co",

  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxamJtZGljYmt5a2ZxbnFlenNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjUxMDMsImV4cCI6MjEwNTA0MTEwM30.pTP4Vcz1l9G_T8nuWKq_LGB9umx1lpaHwwOiGF2Gbfk"

};
