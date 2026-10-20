"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type Profile = {
  id: string;
  roll_number: string | null;
  full_name: string;
  role: string;
  department: string;
  year_section: string | null;
  proctor_id: string | null;
};

type AttendanceRecord = {
  roll_number: string;
  attendance_pct: number | null;
  classes_conducted: number;
  classes_attended: number;
  data_as_of: string;
};

type EventRequest = {
  id: string;
  reference_number: string;
  student_id: string;
  event_title: string;
  organizer_name: string;
  category: string;
  venue: string;
  start_date: string;
  end_date: string;
  url: string | null;
  purpose: string;
  supporting_doc_url: string | null;
  status: string;
  proctor_remarks: string | null;
  incharge_remarks: string | null;
  override_reason: string | null;
  created_at: string;
};

type Eligibility = {
  label: "Eligible" | "Ineligible" | "Needs verification" | "Unavailable";
  percentage: number | null;
  dataAsOf: string | null;
};

type DashboardRequest = EventRequest & {
  student: Profile;
  proctor: Profile | null;
  attendance: AttendanceRecord | null;
  eligibility: Eligibility;
};

type FinalStatus = "Approved" | "Rejected" | "Returned for Correction";

const finalActions: { label: string; status: FinalStatus; style: string }[] = [
  { label: "Approve", status: "Approved", style: "bg-green-700 hover:bg-green-800 focus:ring-green-200" },
  { label: "Reject", status: "Rejected", style: "bg-red-700 hover:bg-red-800 focus:ring-red-200" },
  { label: "Return for Correction", status: "Returned for Correction", style: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-200" },
];

const statusColors: Record<string, string> = {
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

const finalDecisionStatuses = ["Recommended for Approval", "Recommended for Rejection", "Pending Final Decision"];

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function eligibilityFor(record: AttendanceRecord | null, threshold: number, staleAfterDays: number): Eligibility {
  if (!record || record.classes_conducted === 0 || record.attendance_pct === null) {
    return { label: "Unavailable", percentage: null, dataAsOf: record?.data_as_of ?? null };
  }
  if (record.attendance_pct < threshold) {
    return { label: "Ineligible", percentage: record.attendance_pct, dataAsOf: record.data_as_of };
  }
  const ageDays = (Date.now() - new Date(`${record.data_as_of}T00:00:00`).getTime()) / 86_400_000;
  if (ageDays > staleAfterDays) {
    return { label: "Needs verification", percentage: record.attendance_pct, dataAsOf: record.data_as_of };
  }
  return { label: "Eligible", percentage: record.attendance_pct, dataAsOf: record.data_as_of };
}

export default function InchargeDashboardPage() {
  const [requests, setRequests] = useState<DashboardRequest[]>([]);
  const [allStudents, setAllStudents] = useState<Profile[]>([]);
  const [allProctors, setAllProctors] = useState<Profile[]>([]);
  const [attendanceByRoll, setAttendanceByRoll] = useState<Map<string, AttendanceRecord>>(new Map());
  const [threshold, setThreshold] = useState(75);
  const [staleAfterDays, setStaleAfterDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState("");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [proctorFilter, setProctorFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    setLoading(true);
    setError("");
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setError("Please sign in with the Technical-Event In-Charge account to view this dashboard.");
      setLoading(false);
      return;
    }
    const { data: ownProfile, error: ownProfileError } = await supabase
      .from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (ownProfileError || ownProfile?.role !== "incharge") {
      setError("This dashboard is available to the Technical-Event In-Charge only.");
      setLoading(false);
      return;
    }

    const [profilesResult, attendanceResult, requestsResult, thresholdResult, staleResult] = await Promise.all([
      supabase.from("profiles").select("id,roll_number,full_name,role,department,year_section,proctor_id"),
      supabase.from("attendance_records").select("roll_number,attendance_pct,classes_conducted,classes_attended,data_as_of"),
      supabase.from("event_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("system_settings").select("value").eq("key", "min_attendance_threshold").maybeSingle(),
      supabase.from("system_settings").select("value").eq("key", "attendance_stale_after_days").maybeSingle(),
    ]);
    if (profilesResult.error || attendanceResult.error || requestsResult.error) {
      setError("Couldn't load dashboard data. Please refresh and try again.");
      setLoading(false);
      return;
    }

    const profiles = (profilesResult.data ?? []) as Profile[];
    const studentsById = new Map(profiles.filter((profile) => profile.role === "student").map((profile) => [profile.id, profile]));
    const proctorsById = new Map(profiles.filter((profile) => profile.role === "proctor").map((profile) => [profile.id, profile]));
    setAllStudents([...studentsById.values()]);
    setAllProctors([...proctorsById.values()]);
    const attendanceByRoll = new Map<string, AttendanceRecord>(
      ((attendanceResult.data ?? []) as AttendanceRecord[]).map((record) => [record.roll_number, record]),
    );
    setAttendanceByRoll(attendanceByRoll);
    const thresholdValue = Number(thresholdResult.data?.value);
    const staleValue = Number(staleResult.data?.value);
    const thresholdNext = Number.isFinite(thresholdValue) ? thresholdValue : 75;
    const staleNext = Number.isFinite(staleValue) && staleValue > 0 ? staleValue : 30;
    setThreshold(thresholdNext);
    setStaleAfterDays(staleNext);

    const normalized: DashboardRequest[] = ((requestsResult.data ?? []) as EventRequest[]).flatMap((request) => {
      const student = studentsById.get(request.student_id);
      if (!student) return [];
      const attendance = student.roll_number ? attendanceByRoll.get(student.roll_number) ?? null : null;
      return [{
        ...request,
        student,
        proctor: student.proctor_id ? proctorsById.get(student.proctor_id) ?? null : null,
        attendance,
        eligibility: eligibilityFor(attendance, thresholdNext, staleNext),
      }];
    });
    setRequests(normalized);
    setLoading(false);
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const departments = useMemo(() => [...new Set(requests.map((request) => request.student.department))].sort(), [requests]);
  const categories = useMemo(() => [...new Set(requests.map((request) => request.category))].sort(), [requests]);
  const statuses = useMemo(() => [...new Set(requests.map((request) => request.status))].sort(), [requests]);
  const proctors = useMemo(() => [...new Map(requests.filter((request) => request.proctor).map((request) => [request.proctor!.id, request.proctor!])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name)), [requests]);

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      if (departmentFilter && request.student.department !== departmentFilter) return false;
      if (categoryFilter && request.category !== categoryFilter) return false;
      if (statusFilter && request.status !== statusFilter) return false;
      if (proctorFilter && request.proctor?.id !== proctorFilter) return false;
      if (query && ![request.reference_number, request.event_title, request.student.full_name, request.student.roll_number]
        .some((value) => value?.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [requests, departmentFilter, categoryFilter, statusFilter, proctorFilter, search]);

  const eligibilityCounts = useMemo(() => {
    const counts = { eligible: 0, ineligible: 0, verification: 0, unavailable: 0 };
    for (const student of allStudents) {
      const record = student.roll_number ? attendanceByRoll.get(student.roll_number) ?? null : null;
      const eligibility = eligibilityFor(record, threshold, staleAfterDays).label;
      if (eligibility === "Eligible") counts.eligible += 1;
      else if (eligibility === "Ineligible") counts.ineligible += 1;
      else if (eligibility === "Needs verification") counts.verification += 1;
      else counts.unavailable += 1;
    }
    return counts;
  }, [allStudents, attendanceByRoll, threshold, staleAfterDays]);

  const pendingProctorReviews = requests.filter((request) => ["Submitted", "Under Proctor Review"].includes(request.status)).length;
  const pendingFinalDecisions = requests.filter((request) => finalDecisionStatuses.includes(request.status)).length;

  async function finalizeRequest(request: DashboardRequest, status: FinalStatus) {
    const finalRemarks = (remarks[request.id] ?? "").trim();
    const reason = (overrideReasons[request.id] ?? "").trim();
    if (!finalRemarks) {
      setError("Final remarks are required before saving a decision.");
      return;
    }
    if (status === "Approved" && request.eligibility.label === "Ineligible" && !reason) {
      setError("An explicit override reason is required to approve a student below the attendance threshold.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    setError("");
    setNotice("");
    setSavingId(request.id);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setError("Your sign-in session has expired. Please sign in again.");
      setSavingId("");
      return;
    }

    const { data: updatedRequest, error: updateError } = await supabase.from("event_requests").update({
      status,
      incharge_remarks: finalRemarks,
      override_reason: status === "Approved" && request.eligibility.label === "Ineligible" ? reason : null,
      updated_at: new Date().toISOString(),
    }).eq("id", request.id).eq("status", request.status).select("id").maybeSingle();
    if (updateError || !updatedRequest) {
      setError(updateError ? `Couldn't save the final decision: ${updateError.message}` : "This request changed while you were reviewing it. Refresh the page before deciding.");
      setSavingId("");
      return;
    }

    const { error: historyError } = await supabase.from("event_request_history").insert({
      request_id: request.id,
      actor_id: authData.user.id,
      from_status: request.status,
      to_status: status,
      remarks: finalRemarks,
      override_reason: status === "Approved" && request.eligibility.label === "Ineligible" ? reason : null,
    });
    setRequests((current) => current.map((item) => item.id === request.id
      ? { ...item, status, incharge_remarks: finalRemarks, override_reason: status === "Approved" && request.eligibility.label === "Ineligible" ? reason : null }
      : item));
    setRemarks((current) => ({ ...current, [request.id]: "" }));
    setOverrideReasons((current) => ({ ...current, [request.id]: "" }));
    setNotice(historyError
      ? `Decision saved for ${request.reference_number}, but its history entry could not be recorded.`
      : `Final decision saved for ${request.reference_number}.`);
    setSavingId("");
  }

  function exportAttendance() {
    const rows = allStudents.map((student) => {
      const attendance = student.roll_number ? attendanceByRoll.get(student.roll_number) : null;
      const eligibility = eligibilityFor(attendance ?? null, threshold, staleAfterDays);
      return [student.roll_number, student.full_name, student.department, student.year_section,
        eligibility.percentage == null ? "" : eligibility.percentage.toFixed(2), eligibility.label,
        threshold, eligibility.dataAsOf ?? "", student.proctor_id ? allProctors.find((proctor) => proctor.id === student.proctor_id)?.full_name ?? "" : ""];
    });
    downloadCsv("attendance-eligibility.csv", ["Roll Number", "Student Name", "Department", "Year / Section", "Attendance %", "Eligibility", "Threshold %", "Data As Of", "Proctor"], rows);
  }

  function exportApprovals() {
    const rows = requests.map((request) => [request.reference_number, request.student.roll_number, request.student.full_name,
      request.student.department, request.proctor?.full_name ?? "", request.event_title, request.category,
      request.start_date, request.end_date, request.attendance?.attendance_pct ?? "", request.eligibility.label,
      request.status, request.proctor_remarks ?? "", request.incharge_remarks ?? "", request.override_reason ?? ""]);
    downloadCsv("event-approval-records.csv", ["Reference Number", "Roll Number", "Student Name", "Department", "Proctor",
      "Event Title", "Category", "Start Date", "End Date", "Attendance %", "Eligibility", "Status",
      "Proctor Remarks", "Final Remarks", "Override Reason"], rows);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Technical Event Portal</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">In-Charge dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">Monitor attendance eligibility and make final decisions on event requests.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportAttendance} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Export attendance CSV</button>
            <button onClick={exportApprovals} disabled={loading} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Export approvals CSV</button>
          </div>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Total requests" value={requests.length} />
          <Metric label="Pending proctor reviews" value={pendingProctorReviews} color="text-amber-700" />
          <Metric label="Pending final decisions" value={pendingFinalDecisions} color="text-indigo-700" />
          <Metric label="Approved requests" value={requests.filter((request) => request.status === "Approved").length} color="text-green-700" />
          <Metric label="Rejected requests" value={requests.filter((request) => request.status === "Rejected").length} color="text-red-700" />
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Attendance eligibility</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
              <span className="text-green-700" title="Eligible">E {eligibilityCounts.eligible}</span>
              <span className="text-red-700" title="Ineligible">I {eligibilityCounts.ineligible}</span>
              <span className="text-amber-700" title="Needs verification">V {eligibilityCounts.verification}</span>
              <span className="text-slate-700" title="Unavailable">U {eligibilityCounts.unavailable}</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Students · threshold {threshold}%</p>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-xl font-semibold">Event requests</h2><p className="mt-1 text-sm text-slate-500">Final actions are enabled after a proctor recommendation.</p></div>
              <span className="text-sm text-slate-500">Showing {visibleRequests.length} of {requests.length}</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student, event, reference…" aria-label="Search requests" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
              <FilterSelect label="Department" value={departmentFilter} onChange={setDepartmentFilter} options={departments} />
              <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} options={categories} />
              <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statuses} />
              <select aria-label="Proctor" value={proctorFilter} onChange={(event) => setProctorFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100">
                <option value="">All proctors</option>{proctors.map((proctor) => <option key={proctor.id} value={proctor.id}>{proctor.full_name}</option>)}
              </select>
            </div>
          </div>

          {loading ? <p className="p-10 text-center text-sm text-slate-500">Loading requests…</p> : visibleRequests.length === 0 ? (
            <div className="p-10 text-center"><p className="font-semibold text-slate-800">No matching requests</p><p className="mt-1 text-sm text-slate-500">Try changing the filters or search phrase.</p></div>
          ) : <div className="divide-y divide-slate-200">
            {visibleRequests.map((request) => {
              const canDecide = finalDecisionStatuses.includes(request.status);
              const isIneligible = request.eligibility.label === "Ineligible";
              const busy = savingId === request.id;
              return (
                <article key={request.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{request.reference_number}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusColors[request.status] ?? "bg-slate-100 text-slate-700"}`}>{request.status}</span>
                        {isIneligible && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">Ineligible</span>}
                      </div>
                      <h3 className="mt-2 text-lg font-bold">{request.event_title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{request.category} · {request.venue} · {formatDate(request.start_date)}{request.end_date !== request.start_date ? ` – ${formatDate(request.end_date)}` : ""}</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Info label="Student" value={`${request.student.full_name} (${request.student.roll_number ?? "No roll number"})`} />
                        <Info label="Department / section" value={`${request.student.department} · ${request.student.year_section ?? "—"}`} />
                        <Info label="Attendance" value={request.eligibility.percentage == null ? "Unavailable" : `${request.eligibility.percentage.toFixed(2)}%`} />
                        <Info label="Data as of" value={formatDate(request.eligibility.dataAsOf)} />
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className={`rounded-lg px-3.5 py-3 text-sm font-semibold ${request.eligibility.label === "Eligible" ? "bg-green-50 text-green-800" : request.eligibility.label === "Ineligible" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
                          Eligibility: {request.eligibility.label}{request.eligibility.label === "Eligible" || request.eligibility.label === "Ineligible" ? ` · minimum ${threshold}%` : ""}
                          {request.eligibility.label === "Needs verification" && " · attendance data is outdated"}
                        </div>
                        <Info label="Assigned proctor" value={request.proctor?.full_name ?? "Not assigned"} />
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Info label="Proctor recommendation" value={request.proctor_remarks ? `${request.status.startsWith("Recommended") ? request.status : "Review remarks"}: ${request.proctor_remarks}` : "No recommendation recorded"} />
                        <Info label="Purpose" value={request.purpose} />
                      </div>
                      {request.url && <a href={request.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-indigo-700 hover:underline">Open event website ↗</a>}
                    </div>

                    {canDecide && <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 xl:max-w-md">
                      <label htmlFor={`final-remarks-${request.id}`} className="block text-sm font-semibold text-slate-800">Final remarks <span className="text-red-600">*</span></label>
                      <textarea id={`final-remarks-${request.id}`} required minLength={3} maxLength={2000} value={remarks[request.id] ?? ""}
                        onChange={(event) => setRemarks((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Record the reason for this final decision."
                        className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
                      {isIneligible && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-xs font-semibold leading-5 text-red-800">Attendance is below the {threshold}% threshold. Approval requires a documented exception.</p>
                        <label htmlFor={`override-${request.id}`} className="mt-2 block text-sm font-semibold text-slate-800">Override reason <span className="text-red-600">*</span></label>
                        <textarea id={`override-${request.id}`} required minLength={5} maxLength={1000} value={overrideReasons[request.id] ?? ""}
                          onChange={(event) => setOverrideReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Explain why this below-threshold request is being approved as an exception."
                          className="mt-2 min-h-20 w-full rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100" />
                      </div>}
                      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                        {finalActions.map((action) => <button key={action.status} type="button" disabled={busy || !(remarks[request.id] ?? "").trim() || (action.status === "Approved" && isIneligible && !(overrideReasons[request.id] ?? "").trim())}
                          onClick={() => void finalizeRequest(request, action.status)} className={`rounded-lg px-3 py-2.5 text-sm font-semibold text-white focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-45 ${action.style}`}>
                          {busy ? "Saving decision…" : action.label}
                        </button>)}
                      </div>
                    </div>}
                  </div>
                </article>
              );
            })}
          </div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, color = "text-slate-900" }: { label: string; value: number; color?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-800">{value}</p></div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100">
    <option value="">All {label.toLowerCase()}s</option>{options.map((option) => <option key={option}>{option}</option>)}
  </select>;
}
