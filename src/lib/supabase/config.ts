// These are public browser credentials. Keep the Vercel environment variables
// configured to the same Supabase project; the fallbacks support local builds.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  "https://rcpjtkudhmfkqvmovvot.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "sb_publishable_APVrJlunSEvltevmq9GRhg_UcQ6I-K_";
