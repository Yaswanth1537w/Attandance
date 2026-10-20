import LogoutButton from "@/src/components/logout-button";

export default function DashboardHeader({
  userRole,
  userName,
}: {
  userRole: string;
  userName: string;
}) {
  return (
    <header className="flex w-full items-center justify-between border-b border-slate-200 bg-white/85 px-5 py-3 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          {userName ? userName.trim().charAt(0).toUpperCase() : "U"}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{userName || "User"}</h2>
          <p className="text-xs capitalize text-slate-500">{userRole}</p>
        </div>
      </div>
      <div className="ml-3 flex shrink-0 items-center">
        <LogoutButton />
      </div>
    </header>
  );
}
