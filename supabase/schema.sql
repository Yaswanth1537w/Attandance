-- Technical Event Participation Approval and Attendance Monitoring Portal.
-- Run this schema first, then supabase/seed.sql, then scripts/seed-auth-users.mjs.

begin;

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('student', 'proctor', 'incharge');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_request_status as enum (
    'Draft', 'Submitted', 'Under Proctor Review', 'Returned for Correction',
    'Recommended for Approval', 'Recommended for Rejection',
    'Pending Final Decision', 'Approved', 'Rejected', 'Withdrawn'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  roll_number text unique,
  full_name text not null,
  role public.app_role not null default 'student',
  department text not null,
  year_section text,
  proctor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint profiles_proctor_role_check check (role = 'student' or proctor_id is null)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  roll_number text not null unique,
  student_name text not null,
  department text not null,
  year_section text not null,
  classes_conducted integer not null check (classes_conducted >= 0),
  classes_attended integer not null check (classes_attended >= 0 and classes_attended <= classes_conducted),
  data_as_of date not null,
  attendance_pct numeric(5,2) generated always as
    (case when classes_conducted = 0 then null else round(classes_attended::numeric * 100 / classes_conducted, 2) end) stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.event_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  event_title text not null,
  organizer_name text not null,
  category text not null check (category in ('Hackathon','Workshop','Conference','Technical Competition','Industrial Visit','Other')),
  venue text not null,
  start_date date not null,
  end_date date not null,
  url text,
  purpose text not null,
  supporting_doc_url text,
  status public.event_request_status not null default 'Draft',
  proctor_remarks text,
  incharge_remarks text,
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_dates_valid check (end_date >= start_date),
  constraint override_reason_required check (override_reason is null or length(trim(override_reason)) > 0),
  constraint final_rejection_reason check (status <> 'Rejected' or nullif(trim(incharge_remarks), '') is not null)
);

-- Immutable workflow audit trail. App code should insert a row for every review/decision.
create table if not exists public.event_request_history (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.event_requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  from_status public.event_request_status,
  to_status public.event_request_status not null,
  remarks text,
  override_reason text,
  created_at timestamptz not null default now()
);

create index if not exists profiles_proctor_id_idx on public.profiles(proctor_id);
create index if not exists event_requests_student_id_idx on public.event_requests(student_id);
create index if not exists event_requests_status_idx on public.event_requests(status);
create index if not exists event_requests_dates_idx on public.event_requests(start_date, end_date);

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer
set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function public.is_assigned_proctor(target_student uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.profiles student
    where student.id = target_student and student.proctor_id = (select auth.uid())
  )
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.is_assigned_proctor(uuid) from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_assigned_proctor(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.attendance_records enable row level security;
alter table public.system_settings enable row level security;
alter table public.event_requests enable row level security;
alter table public.event_request_history enable row level security;

drop policy if exists "profiles_read_self_assigned_or_incharge" on public.profiles;
create policy "profiles_read_self_assigned_or_incharge" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.current_app_role()) = 'incharge'
  or ((select public.current_app_role()) = 'proctor' and proctor_id = (select auth.uid())));
drop policy if exists "students_create_own_profile" on public.profiles;
create policy "students_create_own_profile" on public.profiles for insert to authenticated
with check (id = (select auth.uid()) and role = 'student' and proctor_id is null);
drop policy if exists "incharge_manage_profiles" on public.profiles;
create policy "incharge_manage_profiles" on public.profiles for all to authenticated
using ((select public.current_app_role()) = 'incharge')
with check ((select public.current_app_role()) = 'incharge');

drop policy if exists "attendance_read_self_assigned_or_incharge" on public.attendance_records;
create policy "attendance_read_self_assigned_or_incharge" on public.attendance_records for select to authenticated
using (
  (select public.current_app_role()) = 'incharge'
  or exists (select 1 from public.profiles p where p.roll_number = attendance_records.roll_number
    and (p.id = (select auth.uid()) or (p.role = 'student' and p.proctor_id = (select auth.uid()))))
);
drop policy if exists "incharge_manage_attendance" on public.attendance_records;
create policy "incharge_manage_attendance" on public.attendance_records for all to authenticated
using ((select public.current_app_role()) = 'incharge') with check ((select public.current_app_role()) = 'incharge');

drop policy if exists "settings_read_authenticated" on public.system_settings;
create policy "settings_read_authenticated" on public.system_settings for select to authenticated using (true);
drop policy if exists "incharge_manage_settings" on public.system_settings;
create policy "incharge_manage_settings" on public.system_settings for all to authenticated
using ((select public.current_app_role()) = 'incharge') with check ((select public.current_app_role()) = 'incharge');

drop policy if exists "students_read_own_requests" on public.event_requests;
create policy "students_read_own_requests" on public.event_requests for select to authenticated
using (student_id = (select auth.uid()));
drop policy if exists "students_insert_own_requests" on public.event_requests;
create policy "students_insert_own_requests" on public.event_requests for insert to authenticated
with check (student_id = (select auth.uid()) and (select public.current_app_role()) = 'student' and status in ('Draft','Submitted'));
drop policy if exists "students_update_own_editable_requests" on public.event_requests;
create policy "students_update_own_editable_requests" on public.event_requests for update to authenticated
using (student_id = (select auth.uid()) and status in ('Draft','Returned for Correction'))
with check (student_id = (select auth.uid()) and status in ('Draft','Returned for Correction','Submitted'));
drop policy if exists "students_delete_own_drafts" on public.event_requests;
create policy "students_delete_own_drafts" on public.event_requests for delete to authenticated
using (student_id = (select auth.uid()) and status = 'Draft');
drop policy if exists "proctors_read_assigned_requests" on public.event_requests;
create policy "proctors_read_assigned_requests" on public.event_requests for select to authenticated
using ((select public.current_app_role()) = 'proctor' and (select public.is_assigned_proctor(student_id)));
drop policy if exists "proctors_update_assigned_reviews" on public.event_requests;
create policy "proctors_update_assigned_reviews" on public.event_requests for update to authenticated
using ((select public.current_app_role()) = 'proctor' and (select public.is_assigned_proctor(student_id))
  and status in ('Submitted','Under Proctor Review','Returned for Correction'))
with check ((select public.current_app_role()) = 'proctor' and (select public.is_assigned_proctor(student_id))
  and status in ('Under Proctor Review','Returned for Correction','Recommended for Approval','Recommended for Rejection'));
drop policy if exists "incharge_full_event_request_access" on public.event_requests;
create policy "incharge_full_event_request_access" on public.event_requests for all to authenticated
using ((select public.current_app_role()) = 'incharge') with check ((select public.current_app_role()) = 'incharge');

drop policy if exists "history_read_own_assigned_or_incharge" on public.event_request_history;
create policy "history_read_own_assigned_or_incharge" on public.event_request_history for select to authenticated
using (exists (select 1 from public.event_requests r where r.id = request_id and
  (r.student_id = (select auth.uid()) or (select public.current_app_role()) = 'incharge'
   or ((select public.current_app_role()) = 'proctor' and (select public.is_assigned_proctor(r.student_id))))));
drop policy if exists "history_insert_self_for_own_or_assigned_request" on public.event_request_history;
create policy "history_insert_self_for_own_or_assigned_request" on public.event_request_history for insert to authenticated
with check (actor_id = (select auth.uid()) and exists (select 1 from public.event_requests r where r.id = request_id and
  (r.student_id = (select auth.uid()) or (select public.current_app_role()) = 'incharge'
   or ((select public.current_app_role()) = 'proctor' and (select public.is_assigned_proctor(r.student_id))))));

-- Private bucket for optional supporting documents uploaded from student requests.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('event-documents', 'event-documents', false, 10485760,
  array['application/pdf','image/png','image/jpeg','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "students_upload_own_event_documents" on storage.objects;
create policy "students_upload_own_event_documents" on storage.objects for insert to authenticated
with check (bucket_id = 'event-documents' and (select public.current_app_role()) = 'student'
  and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "read_own_assigned_or_incharge_event_documents" on storage.objects;
create policy "read_own_assigned_or_incharge_event_documents" on storage.objects for select to authenticated
using (bucket_id = 'event-documents' and (
  (select public.current_app_role()) = 'incharge'
  or ((select public.current_app_role()) = 'student' and (storage.foldername(name))[1] = (select auth.uid())::text)
  or ((select public.current_app_role()) = 'proctor' and
      case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (select public.is_assigned_proctor(((storage.foldername(name))[1])::uuid)) else false end)
));
drop policy if exists "students_update_own_event_documents" on storage.objects;
create policy "students_update_own_event_documents" on storage.objects for update to authenticated
using (bucket_id = 'event-documents' and (select public.current_app_role()) = 'student'
  and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'event-documents' and (select public.current_app_role()) = 'student'
  and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "students_delete_own_event_documents" on storage.objects;
create policy "students_delete_own_event_documents" on storage.objects for delete to authenticated
using (bucket_id = 'event-documents' and (select public.current_app_role()) = 'student'
  and (storage.foldername(name))[1] = (select auth.uid())::text);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.attendance_records, public.system_settings,
  public.event_requests, public.event_request_history to authenticated;
grant usage, select on sequence public.event_request_history_id_seq to authenticated;

insert into public.system_settings(key, value) values
  ('min_attendance_threshold', '75'::jsonb),
  ('attendance_stale_after_days', '30'::jsonb)
on conflict (key) do nothing;

-- Auth users are created through scripts/seed-auth-users.mjs using the Supabase Auth Admin API.
-- Profile creation and balanced proctor assignment are installed by supabase/seed.sql.
commit;

-- Security notes:
-- * RLS policies enforce row ownership, proctor assignment, and in-charge access.
-- * Supabase RLS does not restrict individual columns. Keep profile role/proctor assignment changes
--   and workflow transitions behind trusted server code or SECURITY DEFINER RPCs in production.
-- * Configure Storage bucket policies separately for supporting documents.
