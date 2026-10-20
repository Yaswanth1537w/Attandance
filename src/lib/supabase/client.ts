import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add both to .env.local.",
    );
  }

  return { url, anonKey };
}

/** Returns the browser Supabase client, reusing one instance during this app session. */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = getSupabaseConfig();
    browserClient = createClient(url, anonKey);
  }

  return browserClient;
}
