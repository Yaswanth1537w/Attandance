"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UsersRound } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) {
        setError(authError.code === "invalid_credentials"
          ? "We couldn't match that email and password. Check your details or contact your administrator."
          : `Sign-in failed: ${authError.message}`);
        return;
      }
      if (!data.user) {
        setError("Sign-in succeeded without a user session. Please try again.");
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", data.user.id).maybeSingle();
      if (profileError || !profile) {
        setError("Your account was authenticated, but its portal profile is missing or unavailable. Contact your administrator.");
        return;
      }
      const destination = dashboardByRole[profile.role];
      if (!destination) {
        setError("Your account has an unsupported portal role. Contact your administrator.");
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError("We couldn't connect to the sign-in service. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError("");
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) setError(`Google sign-in failed: ${oauthError.message}`);
    } catch {
      setError("We couldn't start Google sign-in. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.92fr)]">
      <section className="relative hidden overflow-hidden bg-slate-900 px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-44 -left-20 h-96 w-96 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500"><CalendarDays size={22} /></div>
          <div><p className="font-semibold tracking-wide">Siddhartha</p><p className="text-xs text-slate-300">Technical Events Portal</p></div>
        </div>
        <div className="relative max-w-xl py-16">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-indigo-300">A better campus experience</p>
          <h1 className="text-5xl font-semibold leading-[1.12] tracking-tight xl:text-6xl">Make every event count.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">One clear place to request event participation, review approvals, and keep attendance in view.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Feature icon={<ShieldCheck size={18} />} text="A transparent approval journey" />
            <Feature icon={<UsersRound size={18} />} text="Connected student and faculty teams" />
            <Feature icon={<CheckCircle2 size={18} />} text="Attendance-aware decisions" />
          </div>
        </div>
        <p className="relative text-xs text-slate-400">Secure access for Siddhartha Institute community</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden">
            <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"><CalendarDays size={23} /></div>
            <p className="text-sm font-semibold text-indigo-700">Siddhartha · Technical Events</p>
          </div>
          <div className="mb-8">
            <p className="text-sm font-semibold text-indigo-700">Welcome back</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Sign in to your portal</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Use your institute account to continue.</p>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/85 p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.24)] backdrop-blur-md sm:p-8">
            <button type="button" onClick={() => void signInWithGoogle()} disabled={isLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:opacity-60">
              <GoogleMark /> Continue with Google
            </button>
            <div className="my-6 flex items-center gap-3 text-xs font-medium text-slate-400"><span className="h-px flex-1 bg-slate-200" />OR WITH EMAIL<span className="h-px flex-1 bg-slate-200" /></div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Institute email</span>
                <span className="relative block"><Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@siddhartha.ac.in"
                    className="portal-input w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400" />
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                <span className="relative block"><LockKeyhole size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password"
                    className="portal-input w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </span>
              </label>
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700">{error}</p>}
              <button type="submit" disabled={isLoading} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/15 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60">
                {isLoading ? "Connecting…" : <>Sign in <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>}
              </button>
            </form>
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-slate-500">Need access? Contact your department administrator.</p>
        </div>
      </section>
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-3 text-sm text-slate-200"><span className="text-indigo-300">{icon}</span>{text}</div>;
}

function GoogleMark() {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"/><path fill="#FF3D00" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.5H5.8v5.1A20 20 0 0 0 24 44Z"/><path fill="#4CAF50" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.1H5.8a20 20 0 0 0 0 17.4l6.8-5.1Z"/><path fill="#1976D2" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8A19.5 19.5 0 0 0 24 4 20 20 0 0 0 5.8 15.3l6.8 5.1c1.6-4.9 6.1-8.5 11.4-8.5Z"/></svg>;
}
