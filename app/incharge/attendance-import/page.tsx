"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type AttendanceRow = {
  rowNumber: number;
  roll_number: string;
  student_name: string;
  department: string;
  year_section: string;
  classes_conducted: number;
  classes_attended: number;
  data_as_of: string;
  attendance_pct: number | null;
  errors: string[];
  matched: boolean | null;
};

const requiredColumns = [
  "rollnumber",
  "studentname",
  "department",
  "yearsection",
  "classesconducted",
  "classesattended",
  "dataasof",
] as const;

function normalizeHeader(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const monthFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (monthFirst) {
    const [, month, day, year] = monthFirst;
    const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (parsedDate.getFullYear() === Number(year) && parsedDate.getMonth() === Number(month) - 1 && parsedDate.getDate() === Number(day)) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null :
    `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function toRecords(rows: unknown[][]): { records: Record<string, unknown>[]; missing: string[] } {
  if (rows.length === 0) return { records: [], missing: [...requiredColumns] };

  const headers = rows[0].map(normalizeHeader);
  const positions = new Map(headers.map((header, index) => [header, index]));
  const missing = requiredColumns.filter((column) => !positions.has(column));
  const records = rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of requiredColumns) {
      const index = positions.get(column);
      record[column] = index === undefined ? "" : row[index];
    }
    return record;
  });
  return { records, missing };
}

function makeDateString(value: unknown): string | null {
  if (typeof value === "number" && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  return parseDate(value);
}

export default function AttendanceImportPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [threshold, setThreshold] = useState("75");
  const [isLoadingThreshold, setIsLoadingThreshold] = useState(true);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const [thresholdMessage, setThresholdMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPageData() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (!cancelled) {
          setParseError("Sign in as the Technical-Event In-Charge to import attendance.");
          setIsLoadingThreshold(false);
        }
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError || profile?.role !== "incharge") {
        if (!cancelled) {
          setParseError("You do not have permission to manage attendance imports.");
          setIsLoadingThreshold(false);
        }
        return;
      }

      const { data: setting, error: settingError } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "min_attendance_threshold")
        .maybeSingle();

      if (cancelled) return;
      if (settingError) {
        setThresholdMessage("Couldn't load the saved threshold. Try refreshing the page.");
      } else if (setting?.value !== undefined && setting.value !== null) {
        const value = typeof setting.value === "number" ? setting.value : Number(setting.value);
        if (Number.isFinite(value)) setThreshold(String(value));
      }
      setIsLoadingThreshold(false);
    }

    void loadPageData();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]);
    setFileName(file?.name ?? "");
    setParseError("");
    setSaveMessage("");
    if (!file) return;

    setIsParsing(true);
    try {
      let grid: unknown[][];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const csvText = await file.text();
        const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: "greedy" });
        if (parsed.errors.length > 0) {
          throw new Error(parsed.errors[0].message || "The CSV file could not be parsed.");
        }
        grid = parsed.data;
      } else {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
        grid = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false }) as unknown[][];
      }

      const { records, missing } = toRecords(grid);
      if (missing.length > 0) {
        throw new Error(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
      }
      if (records.length === 0) throw new Error("The file has a header row but no attendance records.");

      const rollNumbers = records
        .map((record) => String(record.rollnumber ?? "").trim())
        .filter(Boolean);
      const { data: matchedProfiles, error: profilesError } = rollNumbers.length
        ? await supabase
            .from("profiles")
            .select("roll_number")
            .eq("role", "student")
            .in("roll_number", [...new Set(rollNumbers)])
        : { data: [], error: null };

      if (profilesError) throw new Error("Couldn't check roll numbers against student profiles. Please try again.");
      const knownRollNumbers = new Set((matchedProfiles ?? []).map((profile) => profile.roll_number));
      const seen = new Set<string>();

      const preview = records.map((record, index): AttendanceRow => {
        const rollNumber = String(record.rollnumber ?? "").trim();
        const studentName = String(record.studentname ?? "").trim();
        const department = String(record.department ?? "").trim();
        const yearSection = String(record.yearsection ?? "").trim();
        const conductedRaw = String(record.classesconducted ?? "").trim();
        const attendedRaw = String(record.classesattended ?? "").trim();
        const classesConducted = conductedRaw === "" ? 0 : Number(conductedRaw);
        const classesAttended = attendedRaw === "" ? 0 : Number(attendedRaw);
        const dataAsOf = makeDateString(record.dataasof);
        const errors: string[] = [];

        if (!rollNumber) errors.push("Roll number is required.");
        if (!studentName) errors.push("Student name is required.");
        if (!department) errors.push("Department is required.");
        if (!yearSection) errors.push("Year/Section is required.");
        if (conductedRaw !== "" && (!Number.isInteger(classesConducted) || classesConducted < 0)) {
          errors.push("Classes conducted must be a non-negative whole number.");
        }
        if (attendedRaw !== "" && (!Number.isInteger(classesAttended) || classesAttended < 0)) {
          errors.push("Classes attended must be a non-negative whole number.");
        }
        if (classesConducted > 0 && attendedRaw === "") errors.push("Classes attended is required when classes were conducted.");
        if (Number.isInteger(classesConducted) && Number.isInteger(classesAttended) && classesAttended > classesConducted) {
          errors.push("Classes attended cannot exceed classes conducted.");
        }
        if (!dataAsOf) errors.push("Data As Of must be a valid date.");
        if (rollNumber && seen.has(rollNumber.toLowerCase())) errors.push("Duplicate roll number in this file.");
        if (rollNumber) seen.add(rollNumber.toLowerCase());

        const validCounts = Number.isInteger(classesConducted) && classesConducted >= 0 &&
          Number.isInteger(classesAttended) && classesAttended >= 0 && classesAttended <= classesConducted;
        const matched = rollNumber ? knownRollNumbers.has(rollNumber) : false;

        return {
          rowNumber: index + 2,
          roll_number: rollNumber,
          student_name: studentName,
          department,
          year_section: yearSection,
          classes_conducted: Number.isInteger(classesConducted) ? classesConducted : 0,
          classes_attended: Number.isInteger(classesAttended) ? classesAttended : 0,
          data_as_of: dataAsOf ?? "",
          attendance_pct: validCounts && classesConducted > 0
            ? Math.round((classesAttended / classesConducted) * 10000) / 100
            : null,
          errors,
          matched,
        };
      });

      setRows(preview);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "The selected file could not be read.");
    } finally {
      setIsParsing(false);
    }
  }

  const validRows = rows.filter((row) => row.errors.length === 0);
  const saveableRows = validRows.filter((row) => row.matched === true);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  const unmatchedRows = rows.filter((row) => row.errors.length === 0 && row.matched === false);

  async function saveAttendance() {
    setIsSaving(true);
    setSaveMessage("");
    const payload = saveableRows.map(({ errors: _errors, matched: _matched, rowNumber: _rowNumber, attendance_pct: _pct, ...row }) => row);
    const { error } = await supabase.from("attendance_records").upsert(payload, { onConflict: "roll_number" });
    if (error) {
      setSaveMessage(`Couldn't save attendance records: ${error.message}`);
    } else {
      setSaveMessage(`${payload.length} attendance record${payload.length === 1 ? "" : "s"} saved successfully.`);
    }
    setIsSaving(false);
  }

  async function saveThreshold(event: ChangeEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(threshold);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setThresholdMessage("Enter a threshold from 0 to 100.");
      return;
    }

    setIsSavingThreshold(true);
    setThresholdMessage("");
    const { error } = await supabase.from("system_settings").upsert(
      { key: "min_attendance_threshold", value },
      { onConflict: "key" },
    );
    setThresholdMessage(error ? `Couldn't save the threshold: ${error.message}` : "Minimum attendance threshold updated.");
    setIsSavingThreshold(false);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Technical Event Portal</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Attendance import</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Upload the latest student attendance file. Review validation results before replacing or adding records.
          </p>
        </header>

        {parseError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{parseError}</div>}

        <section className="mb-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Upload attendance file</h2>
            <p className="mt-1 text-sm text-slate-500">Accepted formats: .xlsx and .csv</p>
            <label htmlFor="attendance-file" className="mt-5 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40">
              <span className="text-sm font-semibold text-slate-800">{isParsing ? "Reading and validating…" : fileName || "Choose an attendance file"}</span>
              <span className="mt-1 text-xs text-slate-500">Roll Number, Student Name, Department, Year/Section, Classes Conducted, Classes Attended, Data As Of</span>
              <input id="attendance-file" type="file" accept=".xlsx,.csv" onChange={handleFileChange} disabled={isParsing} className="sr-only" />
            </label>
          </div>

          <form onSubmit={saveThreshold} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Eligibility threshold</h2>
            <p className="mt-1 text-sm text-slate-500">Global minimum attendance required for normal approval.</p>
            <label htmlFor="threshold" className="mt-5 block text-sm font-medium text-slate-700">Minimum attendance</label>
            <div className="mt-2 flex items-center gap-2">
              <input id="threshold" type="number" min="0" max="100" step="0.01" required value={threshold}
                onChange={(event) => setThreshold(event.target.value)} disabled={isLoadingThreshold}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100" />
              <span className="text-sm font-medium text-slate-500">%</span>
            </div>
            <button type="submit" disabled={isSavingThreshold || isLoadingThreshold}
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isSavingThreshold ? "Saving…" : "Save threshold"}
            </button>
            {thresholdMessage && <p role="status" className="mt-3 text-sm text-slate-600">{thresholdMessage}</p>}
          </form>
        </section>

        {rows.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Import preview</h2>
                <p className="mt-1 text-sm text-slate-500">Only valid rows matched to an existing student profile will be saved.</p>
              </div>
              <button onClick={saveAttendance} disabled={saveableRows.length === 0 || isSaving}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? "Saving records…" : `Save ${saveableRows.length} matched record${saveableRows.length === 1 ? "" : "s"}`}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <SummaryCard label="Valid rows" value={validRows.length} tone="green" />
              <SummaryCard label="Invalid rows" value={invalidRows.length} tone="red" />
              <SummaryCard label="Unmatched students" value={unmatchedRows.length} tone="amber" />
            </div>

            {saveMessage && <p role="status" className="border-b border-slate-200 px-6 py-3 text-sm text-slate-700">{saveMessage}</p>}

            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-[1050px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Row</th><th className="px-4 py-3">Roll number</th><th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Department</th><th className="px-4 py-3">Year / Section</th>
                    <th className="px-4 py-3">Attended</th><th className="px-4 py-3">Conducted</th><th className="px-4 py-3">Attendance</th>
                    <th className="px-4 py-3">Data as of</th><th className="px-4 py-3">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.roll_number}`} className={row.errors.length ? "bg-red-50/60" : row.matched === false ? "bg-amber-50/60" : ""}>
                      <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
                      <td className="px-4 py-3 font-medium">{row.roll_number || "—"}</td>
                      <td className="px-4 py-3">{row.student_name || "—"}</td>
                      <td className="px-4 py-3">{row.department || "—"}</td>
                      <td className="px-4 py-3">{row.year_section || "—"}</td>
                      <td className="px-4 py-3">{row.classes_attended}</td>
                      <td className="px-4 py-3">{row.classes_conducted}</td>
                      <td className="px-4 py-3 font-medium">{row.attendance_pct === null ? "Unavailable" : `${row.attendance_pct.toFixed(2)}%`}</td>
                      <td className="px-4 py-3">{row.data_as_of || "—"}</td>
                      <td className="max-w-xs px-4 py-3">
                        {row.errors.length > 0 ? <span className="text-xs text-red-700">{row.errors.join(" ")}</span>
                          : row.matched === false ? <span className="text-xs text-amber-800">No matching student profile.</span>
                            : <span className="text-xs font-medium text-green-700">Ready to save</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "amber" }) {
  const colors = {
    green: "text-green-700",
    red: "text-red-700",
    amber: "text-amber-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[tone]}`}>{value}</p>
    </div>
  );
}
