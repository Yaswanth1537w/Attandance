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
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return loginError(request, "missing_code");

  const supabase = await createSupabaseServerClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.user) return loginError(request, "oauth_exchange");

  const email = data.user.email?.trim().toLowerCase();
  if (!email?.endsWith("@siddhartha.ac.in")) {
    await supabase.auth.signOut();
    return loginError(request, "institution_email_required");
  }

  const { error: provisionError } = await supabase.rpc("ensure_my_profile");
  if (provisionError) return loginError(request, "profile_provisioning");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile) return loginError(request, "profile_unavailable");

  const destination = dashboardByRole[profile.role];
  if (!destination) return loginError(request, "unsupported_role");
  return NextResponse.redirect(new URL(destination, request.url));
}
