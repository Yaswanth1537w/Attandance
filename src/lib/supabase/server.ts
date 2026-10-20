import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/src/lib/supabase/config";

/** Create this per request in Server Components, Server Actions, or Route Handlers. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Refresh session cookies in a
          // Server Action or Route Handler (or a proxy) when token refresh is needed.
        }
      },
    },
  });
}

export const createClient = createSupabaseServerClient;
