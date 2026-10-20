"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type EventRequest = {
  id: string;
  reference_number: string;
  event_title: string;
  category: string;
  start_date: string;
  end_date: string;
  status: string;
  organizer_name: string;
  venue: string;
  purpose: string;
  proctor_remarks: string | null;
  incharge_remarks: string | null;
};

type Attendance = {
  attendance_pct: number | null;
  data_as_of: string;
  classes_conducted: number;
};

const statusStyles: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700",
  Submitted: "bg-blue-100 text-blue-800",
  "Under Proctor Review": "bg-amber-100 text-amber-800",
  "Returned for Correction": "bg-orange-100 text-orange-800",
  "Recommended for Approval": "bg-violet-100 text-violet-800",
  "Recommended for Rejection": "bg-rose-100 text-rose-800",
  "Pending Final Decision": "bg-indigo-100 text-indigo-800",
  Approved: "bg-green-100 text-green-800",
  Rejected: "bg-red-100 text-red-800",
  Withdrawn: "bg-slate-100 text-slate-600",
};

const summaryCards = [
  { title: "Submitted", statuses: ["Submitted"], color: "text-blue-700" },
  { title: "Under Review", statuses: ["Under Proctor Review", "Recommended for Approval", "Recommended for Rejection", "Pending Final Decision"], color: "text-amber-700" },
  { title: "Approved", statuses: ["Approved"], color: "text-green-700" },
  { title: "Rejected", statuses: ["Rejected"], color: "text-red-700" },
  { title: "Returned", statuses: ["Returned for Correction"], color: "text-orange-700" },
];

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isEditable(status: string) {
  return status === "Draft" || status === "Returned for Correction";
}

export default function StudentDashboardPage() {
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [staleAfterDays, setStaleAfterDays] = useState(30);
  const [selected, setSelected] = useState<EventRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setError("Please sign in to view your dashboard.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, roll_number")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role !== "student") {
      setError("This dashboard is available to student accounts only.");
      setLoading(false);
      return;
    }

    const [requestsResult, attendanceResult, thresholdResult, freshnessResult] = await Promise.all([
      supabase.from("event_requests").select("*").eq("student_id", authData.user.id).order("created_at", { ascending: false }),
      profile.roll_number
        ? supabase.from("attendance_records").select("attendance_pct,data_as_of,classes_conducted").eq("roll_number", profile.roll_number).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("system_settings").select("value").eq("key", "min_attendance_threshold").maybeSingle(),
      supabase.from("system_settings").select("value").eq("key", "attendance_stale_after_days").maybeSingle(),
    ]);

    if (requestsResult.error) setError("Couldn't load your event requests. Please refresh and try again.");
    else setRequests((requestsResult.data ?? []) as EventRequest[]);
    if (attendanceResult.data) setAttendance(attendanceResult.data as Attendance);

    const thresholdValue = Number(thresholdResult.data?.value);
    setThreshold(Number.isFinite(thresholdValue) ? thresholdValue : 75);
    const staleValue = Number(freshnessResult.data?.value);
    setStaleAfterDays(Number.isFinite(staleValue) && staleValue > 0 ? staleValue : 30);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const attendanceIsFresh = attendance
    ? (Date.now() - new Date(`${attendance.data_as_of}T00:00:00`).getTime()) / 86_400_000 <= staleAfterDays
    : false;
  const eligibility = !attendance || attendance.classes_conducted === 0 || attendance.attendance_pct === null
    ? "Unavailable"
    : !attendanceIsFresh
      ? "Needs verification"
      : attendance.attendance_pct >= (threshold ?? 75) ? "Eligible" : "Below threshold";
  const eligibilityColor = eligibility === "Eligible" ? "text-green-700 bg-green-50" :
    eligibility === "Below threshold" ? "text-red-700 bg-red-50" : "text-amber-800 bg-amber-50";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Student portal</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">My dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">Your attendance eligibility and technical event requests.</p>
          </div>
          <Link href="/student/request/new" className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
            New event request
          </Link>
        </header>

        {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-500">Current attendance</p>
                <p className="mt-2 text-4xl font-bold tracking-tight">{attendance?.attendance_pct == null ? "—" : `${attendance.attendance_pct.toFixed(2)}%`}</p>
                <p className="mt-2 text-sm text-slate-500">Minimum required: {threshold === null ? "—" : `${threshold}%`}</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${eligibilityColor}`}>{eligibility}</span>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <span className="font-medium text-slate-800">Data as of: </span>
              {attendance?.data_as_of ? formatDate(attendance.data_as_of) : "No attendance record available"}
              {attendance && !attendanceIsFresh && <span className="ml-2 text-amber-700">· Data may be outdated</span>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Attendance guidance</p>
            <h2 className="mt-2 text-lg font-semibold">Eligibility uses your latest attendance record</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Missing or outdated records need verification. A low attendance result may require an explicit in-charge override for an exceptional case.
            </p>
          </div>
        </section>

        <section className="mb-8 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((card) => (
            <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">{card.title}</p>
              <p className={`mt-2 text-3xl font-bold ${card.color}`}>{requests.filter((request) => card.statuses.includes(request.status)).length}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold">My event requests</h2>
            <p className="mt-1 text-sm text-slate-500">Track request status and review submitted event details.</p>
          </div>
          {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading your requests…</p> : requests.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-slate-800">No event requests yet</p>
              <p className="mt-1 text-sm text-slate-500">Create a request when you plan to attend a technical event.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[850px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3">Reference #</th><th className="px-5 py-3">Event title</th><th className="px-5 py-3">Category</th><th className="px-5 py-3">Dates</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">{request.reference_number}</td>
                      <td className="max-w-xs px-5 py-4 font-medium text-slate-900">{request.event_title}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">{request.category}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(request.start_date)}{request.end_date !== request.start_date ? ` – ${formatDate(request.end_date)}` : ""}</td>
                      <td className="whitespace-nowrap px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[request.status] ?? "bg-slate-100 text-slate-700"}`}>{request.status}</span></td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <div className="flex items-center gap-3">
                          <button onClick={() => setSelected(request)} className="font-semibold text-indigo-700 hover:text-indigo-900">View Details</button>
                          {isEditable(request.status) && <Link href={`/student/request/new?id=${encodeURIComponent(request.id)}`} className="font-semibold text-slate-600 hover:text-slate-900">Edit</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="request-title" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{selected.reference_number}</p><h2 id="request-title" className="mt-1 text-xl font-bold">{selected.event_title}</h2></div>
              <button onClick={() => setSelected(null)} aria-label="Close details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Category" value={selected.category} /><Detail label="Organizer" value={selected.organizer_name} />
              <Detail label="Venue" value={selected.venue} /><Detail label="Dates" value={`${formatDate(selected.start_date)} – ${formatDate(selected.end_date)}`} />
              <Detail label="Status" value={selected.status} />
              <div className="sm:col-span-2"><Detail label="Purpose" value={selected.purpose} /></div>
              {selected.proctor_remarks && <div className="sm:col-span-2"><Detail label="Proctor remarks" value={selected.proctor_remarks} /></div>}
              {selected.incharge_remarks && <div className="sm:col-span-2"><Detail label="In-charge remarks" value={selected.incharge_remarks} /></div>}
            </dl>
            <div className="mt-6 flex justify-end"><button onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Close</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{value}</dd></div>;
}
