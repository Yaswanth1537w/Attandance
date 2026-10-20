"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type StudentProfile = {
  id: string;
  roll_number: string | null;
  full_name: string;
  department: string;
  year_section: string | null;
};

type AttendanceRecord = {
  attendance_pct: number | null;
  classes_conducted: number;
  data_as_of: string;
};

type ReviewRequest = {
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
  created_at: string;
  student: StudentProfile;
  attendance: AttendanceRecord | null;
  documentUrl: string | null;
};

type ActionStatus = "Recommended for Approval" | "Recommended for Rejection" | "Returned for Correction";

const actionOptions: { label: string; status: ActionStatus; style: string }[] = [
  { label: "Recommend Approval", status: "Recommended for Approval", style: "bg-green-700 hover:bg-green-800 focus:ring-green-200" },
  { label: "Recommend Rejection", status: "Recommended for Rejection", style: "bg-red-700 hover:bg-red-800 focus:ring-red-200" },
  { label: "Return for Correction", status: "Returned for Correction", style: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-200" },
];

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function daysSince(date: string) {
  return (Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000;
}

export default function ProctorDashboardPage() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [assignedStudentCount, setAssignedStudentCount] = useState(0);
  const [threshold, setThreshold] = useState(75);
  const [staleAfterDays, setStaleAfterDays] = useState(30);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setError("Please sign in with your proctor account to review requests.");
      setLoading(false);
      return;
    }

    const { data: proctorProfile, error: proctorError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (proctorError || proctorProfile?.role !== "proctor") {
      setError("This dashboard is available to proctor accounts only.");
      setLoading(false);
      return;
    }

    const { data: assignedProfiles, error: studentsError } = await supabase
      .from("profiles")
      .select("id,roll_number,full_name,department,year_section")
      .eq("role", "student")
      .eq("proctor_id", authData.user.id)
      .order("roll_number");
    if (studentsError) {
      setError("Couldn't load your assigned students. Please refresh and try again.");
      setLoading(false);
      return;
    }

    const students = (assignedProfiles ?? []) as StudentProfile[];
    setAssignedStudentCount(students.length);
    if (students.length === 0) {
      setRequests([]);
      setLoading(false);
      return;
    }

    const studentById = new Map(students.map((student) => [student.id, student]));
    const rollNumbers = students.map((student) => student.roll_number).filter((roll): roll is string => Boolean(roll));
    const [requestResult, attendanceResult, thresholdResult, freshnessResult] = await Promise.all([
      supabase.from("event_requests").select("*")
        .in("student_id", students.map((student) => student.id))
        .in("status", ["Submitted", "Under Proctor Review"])
        .order("created_at", { ascending: true }),
      rollNumbers.length
        ? supabase.from("attendance_records").select("roll_number,attendance_pct,classes_conducted,data_as_of").in("roll_number", rollNumbers)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("system_settings").select("value").eq("key", "min_attendance_threshold").maybeSingle(),
      supabase.from("system_settings").select("value").eq("key", "attendance_stale_after_days").maybeSingle(),
    ]);

    if (requestResult.error) {
      setError("Couldn't load assigned event requests. Please refresh and try again.");
      setLoading(false);
      return;
    }

    const attendanceByRoll = new Map<string, AttendanceRecord>(
      (attendanceResult.data ?? []).map((record: { roll_number: string } & AttendanceRecord) => [record.roll_number, record]),
    );
    const baseRequests = (requestResult.data ?? []).flatMap((request) => {
      const student = studentById.get(request.student_id);
      if (!student) return [];
      return [{
        ...request,
        student,
        attendance: student.roll_number ? attendanceByRoll.get(student.roll_number) ?? null : null,
        documentUrl: null as string | null,
      }] as ReviewRequest[];
    });

    const requestsWithDocuments = await Promise.all(baseRequests.map(async (request) => {
      if (!request.supporting_doc_url) return request;
      const { data } = await supabase.storage.from("event-documents").createSignedUrl(request.supporting_doc_url, 60 * 60);
      return { ...request, documentUrl: data?.signedUrl ?? null };
    }));

    const thresholdValue = Number(thresholdResult.data?.value);
    const freshnessValue = Number(freshnessResult.data?.value);
    setThreshold(Number.isFinite(thresholdValue) ? thresholdValue : 75);
    setStaleAfterDays(Number.isFinite(freshnessValue) && freshnessValue > 0 ? freshnessValue : 30);
    setRequests(requestsWithDocuments);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function submitRecommendation(request: ReviewRequest, nextStatus: ActionStatus) {
    const remarksText = (remarks[request.id] ?? "").trim();
    if (!remarksText) {
      setError("Remarks are required before submitting a recommendation.");
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

    const { error: updateError } = await supabase.from("event_requests")
      .update({ status: nextStatus, proctor_remarks: remarksText, updated_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("student_id", request.student_id)
      .in("status", ["Submitted", "Under Proctor Review"]);

    if (updateError) {
      setError(`Couldn't save the recommendation: ${updateError.message}`);
      setSavingId("");
      return;
    }

    const { error: historyError } = await supabase.from("event_request_history").insert({
      request_id: request.id,
      actor_id: authData.user.id,
      from_status: request.status,
      to_status: nextStatus,
      remarks: remarksText,
    });

    setRequests((current) => current.filter((item) => item.id !== request.id));
    setRemarks((current) => ({ ...current, [request.id]: "" }));
    setNotice(historyError
      ? `Recommendation saved for ${request.reference_number}, but the history entry could not be recorded.`
      : `Recommendation saved for ${request.reference_number}. The final decision remains with the Technical-Event In-Charge.`);
    setSavingId("");
  }

  const attendanceSummary = (request: ReviewRequest) => {
    const record = request.attendance;
    if (!record || record.classes_conducted === 0 || record.attendance_pct === null) {
      return { value: "Unavailable", detail: "No usable attendance record", color: "text-amber-800 bg-amber-50" };
    }
    if (daysSince(record.data_as_of) > staleAfterDays) {
      return { value: `${record.attendance_pct.toFixed(2)}% · Needs verification`, detail: `Data as of ${formatDate(record.data_as_of)} (outdated)`, color: "text-amber-800 bg-amber-50" };
    }
    if (record.attendance_pct < threshold) {
      return { value: `${record.attendance_pct.toFixed(2)}% · Below threshold`, detail: `Minimum ${threshold}% · Data as of ${formatDate(record.data_as_of)}`, color: "text-red-800 bg-red-50" };
    }
    return { value: `${record.attendance_pct.toFixed(2)}% · Eligible`, detail: `Minimum ${threshold}% · Data as of ${formatDate(record.data_as_of)}`, color: "text-green-800 bg-green-50" };
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Proctor portal</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Assigned event reviews</h1>
          <p className="mt-2 text-sm text-slate-600">Review requests from your assigned students and record a recommendation with remarks.</p>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Assigned students</p>
            <p className="mt-2 text-3xl font-bold">{loading ? "—" : assignedStudentCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Requests requiring review</p>
            <p className="mt-2 text-3xl font-bold text-indigo-700">{loading ? "—" : requests.length}</p>
          </div>
        </div>

        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold">Review queue</h2>
            <p className="mt-1 text-sm text-slate-500">Attendance below {threshold}% or stale data should be considered during review.</p>
          </div>

          {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading assigned requests…</div>
            : requests.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <p className="font-semibold text-slate-800">No requests need review</p>
              <p className="mt-1 text-sm text-slate-500">Submitted requests from your assigned students will appear here.</p>
            </div>
              : requests.map((request) => {
                const attendance = attendanceSummary(request);
                const busy = savingId === request.id;
                return (
                  <article key={request.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{request.reference_number}</span>
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">{request.status}</span>
                        </div>
                        <h3 className="mt-2 text-xl font-bold">{request.event_title}</h3>
                        <p className="mt-1 text-sm text-slate-600">{request.category} · Organized by {request.organizer_name}</p>
                      </div>
                      <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <p className="font-semibold text-slate-800">{request.student.full_name}</p>
                        <p className="mt-0.5 text-slate-600">{request.student.roll_number ?? "No roll number"} · {request.student.department}</p>
                        <p className="mt-0.5 text-slate-500">Year / Section: {request.student.year_section ?? "—"}</p>
                      </div>
                    </div>

                    <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Info label="Event dates" value={`${formatDate(request.start_date)} – ${formatDate(request.end_date)}`} />
                          <Info label="Venue" value={request.venue} />
                        </div>
                        <Info label="Purpose" value={request.purpose} />
                        <div className="flex flex-wrap gap-3 text-sm">
                          {request.url && <a href={request.url} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">Event website ↗</a>}
                          {request.supporting_doc_url && request.documentUrl
                            ? <a href={request.documentUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline">Open supporting document ↗</a>
                            : request.supporting_doc_url ? <span className="text-amber-700">Supporting document unavailable</span> : <span className="text-slate-500">No supporting document uploaded</span>}
                        </div>
                        <div className={`rounded-xl px-4 py-3 ${attendance.color}`}>
                          <p className="text-sm font-semibold">Attendance: {attendance.value}</p>
                          <p className="mt-1 text-xs">{attendance.detail}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <label htmlFor={`remarks-${request.id}`} className="block text-sm font-semibold text-slate-800">Recommendation remarks <span className="text-red-600">*</span></label>
                        <textarea id={`remarks-${request.id}`} required minLength={3} maxLength={2000}
                          value={remarks[request.id] ?? ""} onChange={(event) => setRemarks((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Explain your recommendation or what the student needs to correct."
                          className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" />
                        <div className="mt-3 flex flex-col gap-2">
                          {actionOptions.map((action) => (
                            <button key={action.status} type="button" disabled={busy || !(remarks[request.id] ?? "").trim()}
                              onClick={() => void submitRecommendation(request, action.status)}
                              className={`rounded-lg px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-45 ${action.style}`}>
                              {busy ? "Saving recommendation…" : action.label}
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-500">Your action records a recommendation or correction request. Only the Technical-Event In-Charge can make the final decision.</p>
                      </div>
                    </div>
                  </article>
                );
              })}
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value}</p></div>;
}
