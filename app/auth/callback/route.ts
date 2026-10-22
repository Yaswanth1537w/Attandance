import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const dashboardByRole: Record<string, string> = {
  student: "/student/dashboard",
  proctor: "/proctor/dashboard",
  incharge: "/incharge/dashboard",
};

function loginError(request: NextRequest, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("auth_error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) return loginError(request, "missing_code");

    const supabase = await createSupabaseServerClient();
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError || !data.user) return loginError(request, "oauth_exchange");

    const user = data.user;
    const email = user.email?.trim().toLowerCase();
    if (!email?.endsWith("@siddhartha.ac.in")) {
      await supabase.auth.signOut();
      return loginError(request, "institution_email_required");
    }

    // This database function assigns reserved staff roles from trusted email
    // patterns, balances new students across proctors, and is idempotent.
    const { error: provisionError } = await supabase.rpc("ensure_my_profile");

    // If the provisioning function is unavailable, only self-provision an
    // ordinary student account. Never let a browser grant itself a staff role.
    if (provisionError) {
      const isReservedStaff = [
        "incharge@siddhartha.ac.in",
        "proctor1@siddhartha.ac.in",
        "proctor2@siddhartha.ac.in",
      ].includes(email);
      if (isReservedStaff) return loginError(request, "profile_provisioning");

      const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
      const fullName = typeof metadataName === "string" && metadataName.trim()
        ? metadataName.trim()
        : email.split("@")[0];
      const { error: insertError } = await supabase.from("profiles").insert({
        id: user.id,
        full_name: fullName,
        role: "student",
        department: "AIML",
        proctor_id: null,
      });
      // A conflict means a trigger already created the profile; query it below.
      if (insertError && insertError.code !== "23505") {
        return loginError(request, "profile_provisioning");
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return loginError(request, "profile_unavailable");

    const destination = dashboardByRole[profile.role];
    if (!destination) return loginError(request, "unsupported_role");
    return NextResponse.redirect(new URL(destination, request.url));
  } catch {
    return loginError(request, "oauth_callback_failed");
  }
}
