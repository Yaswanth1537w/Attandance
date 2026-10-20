-- Technical Event Participation Approval and Attendance Monitoring Portal
-- Run once in the Supabase SQL Editor. Demo sign-in password for seeded accounts:
-- DemoPass2026!  (change/remove these accounts before production use)

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

-- Seed 2 proctors, 1 in-charge, and 30 students as usable Supabase Auth demo accounts.
-- All demo accounts use DemoPass2026! and the email domain example.test.
do $$
declare i integer; uid uuid;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token)
  values
    ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','proctor1@example.test',extensions.crypt('DemoPass2026!',extensions.gen_salt('bf')),now(),'{}','{}',now(),now(),''),
    ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','proctor2@example.test',extensions.crypt('DemoPass2026!',extensions.gen_salt('bf')),now(),'{}','{}',now(),now(),''),
    ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','incharge@example.test',extensions.crypt('DemoPass2026!',extensions.gen_salt('bf')),now(),'{}','{}',now(),now(),'')
  on conflict (id) do nothing;
  for i in 1..30 loop
    uid := md5('technical-event-student-' || lpad(i::text,2,'0'))::uuid;
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token)
    values (uid,'authenticated','authenticated','student'||lpad(i::text,2,'0')||'@example.test',
      extensions.crypt('DemoPass2026!',extensions.gen_salt('bf')),now(),'{}','{}',now(),now(),'')
    on conflict (id) do nothing;
  end loop;
end $$;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub',u.id::text,'email',u.email,'email_verified',true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test'
  and not exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='email');

insert into public.profiles(id, roll_number, full_name, role, department) values
 ('10000000-0000-4000-8000-000000000001',null,'Aarav Proctor','proctor','Computer Science'),
 ('10000000-0000-4000-8000-000000000002',null,'Diya Proctor','proctor','Electronics'),
 ('10000000-0000-4000-8000-000000000003',null,'Technical Event In-Charge','incharge','Administration')
on conflict (id) do nothing;

insert into public.profiles(id, roll_number, full_name, role, department, year_section, proctor_id)
select md5('technical-event-student-' || lpad(i::text,2,'0'))::uuid,
  format('26CS%03s',i),
  (array['Aarav','Diya','Ishaan','Ananya','Vivaan','Meera','Arjun','Saanvi','Reyansh','Aadhya'])[((i-1)%10)+1] || ' ' ||
  (array['Sharma','Patel','Reddy','Nair','Gupta','Rao'])[((i-1)%6)+1],
  'student', case when i <= 15 then 'Computer Science' else 'Electronics' end,
  case when i % 2 = 0 then 'II / A' else 'III / B' end,
  case when i <= 15 then '10000000-0000-4000-8000-000000000001'::uuid else '10000000-0000-4000-8000-000000000002'::uuid end
from generate_series(1,30) i
on conflict (id) do nothing;

-- Includes above-threshold, below-threshold, exactly-threshold, missing (zero classes), and stale data.
insert into public.attendance_records(roll_number,student_name,department,year_section,classes_conducted,classes_attended,data_as_of)
select p.roll_number,p.full_name,p.department,p.year_section,
  case when n=4 then 0 else 100 end,
  case when n=1 then 92 when n=2 then 62 when n=3 then 75 when n=4 then 0 else 70 + (n % 26) end,
  case when n=5 then current_date - 60 else current_date - 3 end
from (select p.*, row_number() over(order by p.roll_number)::int n from public.profiles p where p.role='student') p
on conflict (roll_number) do nothing;

insert into public.event_requests(id,reference_number,student_id,event_title,organizer_name,category,venue,start_date,end_date,url,purpose,status,proctor_remarks,incharge_remarks,override_reason)
select md5('event-request-'||n)::uuid, 'TE-2026-'||lpad(n::text,3,'0'), md5('technical-event-student-'||lpad(n::text,2,'0'))::uuid,
  (array['Buildathon 2026','Cloud Native Workshop','AI Research Conference','Robotics Challenge','Cybersecurity Summit','Open Source Sprint','IoT Innovation Meet','Data Science Symposium','Startup Tech Expo','Web Development Bootcamp'])[n],
  (array['Pixel Labs','Campus Tech Forum','National Computing Society'])[ ((n-1)%3)+1 ],
  (array['Hackathon','Workshop','Conference','Technical Competition','Other','Hackathon','Industrial Visit','Conference','Technical Competition','Workshop'])[n],
  (array['Bengaluru','Hyderabad','Chennai','Pune'])[ ((n-1)%4)+1 ],
  current_date + n*3, current_date + n*3 + case when n%3=0 then 1 else 0 end,
  'https://example.test/events/'||n, 'Participate to develop practical technical skills and represent the department.',
  (array['Draft','Submitted','Under Proctor Review','Returned for Correction','Recommended for Approval','Recommended for Rejection','Pending Final Decision','Approved','Rejected','Withdrawn'])[n]::public.event_request_status,
  case when n in (5,6,7,8,9) then 'Reviewed by assigned proctor.' else null end,
  case when n=8 then 'Approved for participation.' when n=9 then 'Attendance does not meet the required threshold.' else null end,
  null
from generate_series(1,10) n
on conflict (id) do nothing;

-- Baseline history entries for the ten seeded requests.
insert into public.event_request_history(request_id,actor_id,from_status,to_status,remarks)
select r.id, case when r.status in ('Recommended for Approval','Recommended for Rejection','Pending Final Decision','Approved','Rejected')
  then '10000000-0000-4000-8000-000000000001'::uuid else r.student_id end,
  null,r.status,coalesce(r.proctor_remarks,r.incharge_remarks,'Seeded example state')
from public.event_requests r
where r.reference_number like 'TE-2026-%'
  and not exists (select 1 from public.event_request_history h where h.request_id=r.id);

commit;

-- Security notes:
-- * RLS policies enforce row ownership, proctor assignment, and in-charge access.
-- * Supabase RLS does not restrict individual columns. Keep profile role/proctor assignment changes
--   and workflow transitions behind trusted server code or SECURITY DEFINER RPCs in production.
-- * Configure Storage bucket policies separately for supporting documents.
