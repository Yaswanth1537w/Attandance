import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rcpjtkudhmfkqvmovvot.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcGp0a3VkaG1ma3F2bW92dm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTg0NTcsImV4cCI6MjEwODA3NDQ1N30.efiI0ZCrHgKL6TkOgY7zgsKvr-Qfw9wrNCc_L-5LGGg"
  );
}