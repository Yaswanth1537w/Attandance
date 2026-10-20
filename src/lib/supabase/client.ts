import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/src/lib/supabase/config";

let browserClient: SupabaseClient | undefined;

/** Shared browser client using the same cookie-based session as the server client. */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }
  return browserClient;
}

// Keep the conventional Supabase utility name available for existing callers.
export const createClient = createSupabaseBrowserClient;
