-- Apply supabase/schema.sql first, then run this script in the Supabase SQL Editor.
-- Auth accounts are created by scripts/seed-auth-users.mjs with the Auth Admin API;
-- never insert password hashes directly into Supabase's internal auth tables.
begin;

create or replace function public.provision_profile_for_auth_user(
  target_user_id uuid,
  target_email text,
  target_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  email_local text;
  inferred_role public.app_role;
  inferred_roll text;
  inferred_name text;
  target_proctor uuid;
  proctor_one uuid;
  proctor_two uuid;
  first_count bigint;
  second_count bigint;
  student_number integer;
begin
  if normalized_email !~ '^[^@]+@siddhartha\.ac\.in$' then
    return;
  end if;

  email_local := split_part(normalized_email, '@', 1);
  if email_local = 'incharge' then
    inferred_role := 'incharge';
  elsif email_local in ('proctor1', 'proctor2') then
    inferred_role := 'proctor';
  else
    inferred_role := 'student';
  end if;

  inferred_name := coalesce(
    nullif(trim(target_metadata ->> 'full_name'), ''),
    nullif(trim(target_metadata ->> 'name'), ''),
    initcap(replace(email_local, '.', ' '))
  );
  if email_local ~ '^student[0-9]+$' then
    student_number := substring(email_local from '[0-9]+')::integer;
    inferred_roll := '26CS' || lpad(student_number::text, 3, '0');
  else
    inferred_roll := nullif(trim(target_metadata ->> 'roll_number'), '');
  end if;

  if inferred_role = 'student' then
    -- Serialize assignment to keep concurrent signups balanced.
    perform pg_catalog.pg_advisory_xact_lock(71923041);
    select p.id into proctor_one
    from public.profiles p join auth.users u on u.id = p.id
    where lower(u.email) = 'proctor1@siddhartha.ac.in' and p.role = 'proctor';
    select p.id into proctor_two
    from public.profiles p join auth.users u on u.id = p.id
    where lower(u.email) = 'proctor2@siddhartha.ac.in' and p.role = 'proctor';

    if proctor_one is not null and proctor_two is not null then
      select count(*) into first_count from public.profiles where role = 'student' and proctor_id = proctor_one;
      select count(*) into second_count from public.profiles where role = 'student' and proctor_id = proctor_two;
      target_proctor := case when first_count <= second_count then proctor_one else proctor_two end;
    else
      target_proctor := coalesce(proctor_one, proctor_two);
    end if;
  end if;

  insert into public.profiles(id, roll_number, full_name, role, department, year_section, proctor_id)
  values (
    target_user_id,
    inferred_roll,
    inferred_name,
    inferred_role,
    coalesce(nullif(trim(target_metadata ->> 'department'), ''), 'AIML'),
    nullif(trim(target_metadata ->> 'year_section'), ''),
    target_proctor
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.provision_profile_for_auth_user(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.provision_profile_for_auth_user(uuid, text, jsonb) to service_role;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.provision_profile_for_auth_user(new.id, new.email, new.raw_user_meta_data);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_provision_profile on auth.users;
create trigger on_auth_user_created_provision_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Safe self-service fallback for OAuth accounts created before the trigger was installed.
create or replace function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  current_email text := auth.jwt() ->> 'email';
  result public.profiles;
begin
  if current_id is null or current_email is null then
    raise exception 'A signed-in user with a verified email is required';
  end if;
  if lower(current_email) !~ '^[^@]+@siddhartha\.ac\.in$' then
    raise exception 'Only @siddhartha.ac.in accounts can access this portal';
  end if;

  perform public.provision_profile_for_auth_user(current_id, current_email, auth.jwt() -> 'user_metadata');
  select * into result from public.profiles where id = current_id;
  return result;
end;
$$;

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;

-- Backfill profiles for existing institutional users. Proctors are ordered first so
-- the student balancing trigger can distribute the roster between both proctors.
do $$
declare u record;
begin
  for u in
    select id, email, raw_user_meta_data from auth.users
    where lower(email) like '%@siddhartha.ac.in'
    order by case
      when lower(email) in ('proctor1@siddhartha.ac.in','proctor2@siddhartha.ac.in') then 0
      when lower(email) = 'incharge@siddhartha.ac.in' then 1
      else 2
    end, lower(email)
  loop
    perform public.provision_profile_for_auth_user(u.id, u.email, u.raw_user_meta_data);
  end loop;
end;
$$;

commit;
