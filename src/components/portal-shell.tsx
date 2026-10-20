"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarDays, ClipboardCheck, LayoutDashboard, Settings2, ShieldCheck } from "lucide-react";
import DashboardHeader from "@/src/components/dashboard-header";
import LogoutButton from "@/src/components/logout-button";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type PortalRole = "student" | "proctor" | "incharge";
const roleLabels: Record<PortalRole, string> = {
  student: "Student workspace",
  proctor: "Proctor workspace",
  incharge: "In-Charge workspace",
};

const navItems: Record<PortalRole, { label: string; href: string; icon: typeof LayoutDashboard }[]> = {
  student: [
    { label: "Overview", href: "/student/dashboard", icon: LayoutDashboard },
    { label: "New event request", href: "/student/request/new", icon: CalendarDays },
  ],
  proctor: [{ label: "Review queue", href: "/proctor/dashboard", icon: ClipboardCheck }],
  incharge: [
    { label: "Decision center", href: "/incharge/dashboard", icon: LayoutDashboard },
    { label: "Attendance import", href: "/incharge/attendance-import", icon: Settings2 },
  ],
};

export function PortalShell({ role, children }: { role: PortalRole; children: React.ReactNode }) {
  const pathname = usePathname();
  const [userName, setUserName] = useState("");

  useEffect(() => {
    let active = true;
    async function loadProfileName() {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (active && profile?.full_name) setUserName(profile.full_name);
    }
    void loadProfileName();
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <aside className="border-b border-slate-200 bg-white/90 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:border-b-0 md:border-r">
        <Link href={navItems[role][0].href} className="flex items-center gap-3 px-5 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20"><ShieldCheck size={20} /></span>
          <span><span className="block text-sm font-bold tracking-tight text-slate-900">Siddhartha</span><span className="block text-xs text-slate-500">Technical Events</span></span>
        </Link>
        <div className="hidden px-5 pb-4 md:block"><p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">{roleLabels[role]}</p></div>
        <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:px-3 md:py-3">
          {navItems[role].map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />{label}
            </Link>;
          })}
        </nav>
        <div className="hidden border-t border-slate-100 p-4 md:block">
          <LogoutButton />
          <p className="mt-3 px-3 text-[11px] text-slate-400">Secure campus access</p>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-10"><DashboardHeader userRole={roleLabels[role]} userName={userName} /></div>
        {children}
      </div>
    </div>
  );
}
