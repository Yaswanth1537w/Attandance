// Browser-safe Supabase configuration for the attendance-portal project.
const PROJECT_REF = "rcpjtkudhmfkqvmovvot";
const FALLBACK_URL = `https://${PROJECT_REF}.supabase.co`;
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcGp0a3VkaG1ma3F2bW92dm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTg0NTcsImV4cCI6MjEwODA3NDQ1N30.efiI0ZCrHgKL6TkOgY7zgsKvr-Qfw9wrNCc_L-5LGGg";

function isExpectedProjectUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === `${PROJECT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

function isAnonJwtForThisProject(value: string): boolean {
  try {
    const payload = value.split(".")[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(normalized)) as { ref?: string; role?: string };
    return claims.ref === PROJECT_REF && claims.role === "anon";
  } catch {
    return false;
  }
}

const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
export const SUPABASE_URL = configuredUrl && isExpectedProjectUrl(configuredUrl)
  ? configuredUrl
  : FALLBACK_URL;

const configuredAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
export const SUPABASE_PUBLISHABLE_KEY = configuredAnonKey && isAnonJwtForThisProject(configuredAnonKey)
  ? configuredAnonKey
  : FALLBACK_ANON_KEY;