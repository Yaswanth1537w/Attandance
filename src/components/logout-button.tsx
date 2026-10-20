"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  async function handleLogout() {
    if (loading) return;
    setLoading(true);
    setErrorMessage("");

    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) {
        setErrorMessage("Could not sign out. Please try again.");
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Error logging out:", error);
      setErrorMessage("Could not sign out. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loading}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogOut size={18} />
        {loading ? "Signing out…" : "Sign out"}
      </button>
      {errorMessage && <p role="alert" className="mt-2 px-3 text-xs text-rose-700">{errorMessage}</p>}
    </div>
  );
}
