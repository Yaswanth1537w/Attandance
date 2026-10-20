"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

const dashboardByRole: Record<string, string> = {
  student: "/student/dashboard",
  proctor: "/proctor/dashboard",
  incharge: "/incharge/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        const authCode = "code" in authError ? authError.code : undefined;
        if (authCode === "invalid_credentials") {
          setError("Supabase Auth rejected these credentials. Confirm this email exists in the configured Supabase project's Authentication users and that its password is correct.");
        } else {
          setError(`Supabase Auth could not complete the sign-in request: ${authError.message}`);
        }
        return;
      }

      if (!authData.user) {
        setError("Supabase did not return a signed-in user. Please try again.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        setError("Your password was accepted, but we couldn't read your profile. Check the profiles table and its RLS SELECT policy, then try again.");
        return;
      }

      if (!profile) {
        setError("Your password was accepted, but no profiles row exists for this Auth user. Ask the administrator to link your profile.");
        return;
      }

      const dashboard = dashboardByRole[profile.role];
      if (!dashboard) {
        setError(`Your password was accepted, but the profile role "${profile.role}" is unsupported. Ask the administrator to set student, proctor, or incharge.`);
        return;
      }

      router.replace(dashboard);
      router.refresh();
    } catch {
      setError("We couldn't sign you in right now. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-sm">
            T
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Technical Events
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in to manage event approvals and attendance.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-800">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@university.edu"
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-slate-800">
                  Password
                </label>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-6 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-5 text-center text-xs leading-5 text-slate-500">
            Your dashboard is selected automatically based on your account role.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need access? Contact your department administrator.
        </p>
      </div>
    </main>
  );
}
