"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

const categories = ["Hackathon", "Workshop", "Conference", "Technical Competition", "Industrial Visit", "Other"] as const;
const editableStatuses = ["Draft", "Returned for Correction"];

type FormFields = {
  event_title: string;
  organizer_name: string;
  category: string;
  venue: string;
  start_date: string;
  end_date: string;
  url: string;
  purpose: string;
};

const emptyFields: FormFields = {
  event_title: "", organizer_name: "", category: "Hackathon", venue: "",
  start_date: "", end_date: "", url: "", purpose: "",
};

function makeReferenceNumber() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `TE-${new Date().getFullYear()}-${suffix}`;
}

export default function NewEventRequestPage() {
  const supabase = createSupabaseBrowserClient();
  const [fields, setFields] = useState<FormFields>(emptyFields);
  const [userId, setUserId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingFromStatus, setEditingFromStatus] = useState("");
  const [existingDocumentPath, setExistingDocumentPath] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const documentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (!cancelled) {
          setError("Please sign in with a student account to submit an event request.");
          setPageLoading(false);
        }
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (profileError || profile?.role !== "student") {
        if (!cancelled) {
          setError("Only student accounts can submit event requests.");
          setPageLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setUserId(authData.user.id);

      const requestId = new URLSearchParams(window.location.search).get("id");
      if (requestId) {
        const { data: request, error: requestError } = await supabase
          .from("event_requests")
          .select("id,student_id,status,event_title,organizer_name,category,venue,start_date,end_date,url,purpose,supporting_doc_url")
          .eq("id", requestId)
          .eq("student_id", authData.user.id)
          .maybeSingle();
        if (requestError || !request) {
          if (!cancelled) setError("This request could not be found or you do not have access to it.");
        } else if (!editableStatuses.includes(request.status)) {
          if (!cancelled) setError("Only Draft or Returned for Correction requests can be edited.");
        } else if (!cancelled) {
          setEditingId(request.id);
          setEditingFromStatus(request.status);
          setExistingDocumentPath(request.supporting_doc_url ?? "");
          setFields({
            event_title: request.event_title,
            organizer_name: request.organizer_name,
            category: request.category,
            venue: request.venue,
            start_date: request.start_date,
            end_date: request.end_date,
            url: request.url ?? "",
            purpose: request.purpose,
          });
        }
      }
      if (!cancelled) setPageLoading(false);
    }

    void initialize();
    return () => { cancelled = true; };
  }, [supabase]);

  function updateField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function handleDocumentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError("");
    if (!file) {
      setDocument(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("The supporting document must be 10 MB or smaller.");
      event.target.value = "";
      setDocument(null);
      return;
    }
    setDocument(file);
  }

  async function uploadDocument(): Promise<string | null> {
    if (!document) return existingDocumentPath || null;
    const safeName = document.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("event-documents").upload(path, document, {
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(`Supporting document upload failed: ${uploadError.message}. Check the event-documents Storage bucket and its policies.`);
    return path;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!userId) {
      setError("Your sign-in session has expired. Please sign in again.");
      return;
    }
    if (fields.end_date < fields.start_date) {
      setError("End date cannot be earlier than the start date.");
      return;
    }
    if (fields.url && !/^https?:\/\//i.test(fields.url)) {
      setError("Enter a complete event URL starting with http:// or https://.");
      return;
    }

    setIsSubmitting(true);
    try {
      const supportingDocPath = await uploadDocument();
      const values = {
        ...fields,
        url: fields.url.trim() || null,
        supporting_doc_url: supportingDocPath,
        status: "Submitted" as const,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error: updateError } = await supabase.from("event_requests")
          .update(values)
          .eq("id", editingId)
          .eq("student_id", userId);
        if (updateError) throw new Error(`Couldn't update the request: ${updateError.message}`);
        const { error: historyError } = await supabase.from("event_request_history").insert({
          request_id: editingId,
          actor_id: userId,
          from_status: editingFromStatus,
          to_status: "Submitted",
          remarks: "Student resubmitted the request after editing.",
        });
        setNotice(historyError
          ? `Your corrected request was resubmitted, but the history entry couldn't be saved: ${historyError.message}`
          : "Your corrected request has been resubmitted.");
      } else {
        let insertError: string | null = null;
        let historyWarning: string | null = null;
        let created = false;
        for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
          const { data: createdRequest, error: createError } = await supabase.from("event_requests").insert({
            ...values,
            reference_number: makeReferenceNumber(),
            student_id: userId,
          }).select("id").single();
          if (!createError && createdRequest) {
            created = true;
            const { error: historyError } = await supabase.from("event_request_history").insert({
              request_id: createdRequest.id,
              actor_id: userId,
              to_status: "Submitted",
              remarks: "Request submitted by student.",
            });
            if (historyError) historyWarning = historyError.message;
          }
          else if (createError?.code === "23505") insertError = "A reference number collision occurred. Please submit again.";
          else if (createError) insertError = createError.message;
        }
        if (!created) throw new Error(`Couldn't submit the request: ${insertError ?? "Please try again."}`);
        setNotice(historyWarning
          ? `Your event request was submitted, but its history entry couldn't be saved: ${historyWarning}`
          : "Your event request has been submitted.");
        setFields(emptyFields);
        setDocument(null);
        const fileInput = documentRef.current;
        if (fileInput) fileInput.value = "";
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong while submitting your request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/student/dashboard" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">← Back to dashboard</Link>
        <header className="mb-7 mt-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Student portal</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{editingId ? "Edit event request" : "New event request"}</h1>
          <p className="mt-2 text-sm text-slate-600">Provide the event details for your proctor and the Technical-Event In-Charge.</p>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {notice && <div role="status" className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice} <Link href="/student/dashboard" className="ml-1 font-semibold underline">Return to dashboard</Link></div>}

        {pageLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading request form…</div> : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Event title" required className="sm:col-span-2">
                <input required maxLength={200} value={fields.event_title} onChange={(event) => updateField("event_title", event.target.value)} className={inputClass} placeholder="e.g. National Student Hackathon" />
              </FormField>
              <FormField label="Organizer" required>
                <input required maxLength={200} value={fields.organizer_name} onChange={(event) => updateField("organizer_name", event.target.value)} className={inputClass} placeholder="Organization or institution" />
              </FormField>
              <FormField label="Category" required>
                <select required value={fields.category} onChange={(event) => updateField("category", event.target.value)} className={inputClass}>
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </FormField>
              <FormField label="Venue and city" required className="sm:col-span-2">
                <input required maxLength={300} value={fields.venue} onChange={(event) => updateField("venue", event.target.value)} className={inputClass} placeholder="Venue, city" />
              </FormField>
              <FormField label="Start date" required>
                <input required type="date" value={fields.start_date} onChange={(event) => updateField("start_date", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="End date" required>
                <input required type="date" min={fields.start_date || undefined} value={fields.end_date} onChange={(event) => updateField("end_date", event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Event URL" className="sm:col-span-2">
                <input type="url" value={fields.url} onChange={(event) => updateField("url", event.target.value)} className={inputClass} placeholder="https://example.com/event" />
              </FormField>
              <FormField label="Purpose and expected benefit" required className="sm:col-span-2">
                <textarea required minLength={10} maxLength={5000} rows={5} value={fields.purpose} onChange={(event) => updateField("purpose", event.target.value)} className={`${inputClass} resize-y`} placeholder="Describe why you want to attend and what you expect to learn." />
              </FormField>
              <FormField label="Supporting document (optional)" className="sm:col-span-2">
                <input ref={documentRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={handleDocumentChange} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100" />
                <span className="mt-1 block text-xs text-slate-500">PDF, image, or Word document up to 10 MB. {existingDocumentPath && !document ? "An existing document will be retained." : ""}</span>
              </FormField>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:justify-end">
              <Link href="/student/dashboard" className="rounded-lg border border-slate-300 px-5 py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
              <button type="submit" disabled={isSubmitting || pageLoading} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? "Submitting…" : editingId ? "Resubmit request" : "Submit request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";

function FormField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={className}><span className="mb-2 block text-sm font-medium text-slate-800">{label}{required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}</span>{children}</label>;
}
