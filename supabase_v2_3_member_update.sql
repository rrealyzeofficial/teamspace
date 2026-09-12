-- ============================================================
-- TEAM SPACE V2.3 — MEMBER AVATAR + DAY/MONTH + PASS=>MEMBER
-- Chạy file này trên database V2.2 / V2.2.1 hiện tại.
-- Có thể chạy lại an toàn.
-- ============================================================

create extension if not exists pgcrypto;

-- 1) Vani color (re-assert)
update public.team_members
set color = '#FFCDCD'
where slug = 'vani';

update public.team_member_profiles
set profile_color = '#FFCDCD'
where member_slug = 'vani';

-- 2) Birthday: chỉ lưu THÁNG-NGÀY, không lưu năm.
alter table public.team_member_profiles
  add column if not exists birth_month_day text;

-- Chuyển dữ liệu cũ (nếu trước đây đã nhập birth_date).
update public.team_member_profiles
set birth_month_day = to_char(birth_date, 'MM-DD')
where birth_month_day is null
  and birth_date is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_member_profiles_birth_month_day_check'
  ) then
    alter table public.team_member_profiles
      add constraint team_member_profiles_birth_month_day_check
      check (
        birth_month_day is null
        or birth_month_day ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      );
  end if;
end $$;

-- 3) Avatar path trong Supabase Storage.
alter table public.team_member_profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-avatars',
  'member-avatars',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "team_read_member_avatars" on storage.objects;
create policy "team_read_member_avatars"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'member-avatars'
  and public.is_team_member()
);

drop policy if exists "team_upload_member_avatars" on storage.objects;
create policy "team_upload_member_avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'member-avatars'
  and public.is_team_member()
);

drop policy if exists "team_update_member_avatars" on storage.objects;
create policy "team_update_member_avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'member-avatars'
  and public.is_team_member()
)
with check (
  bucket_id = 'member-avatars'
  and public.is_team_member()
);

drop policy if exists "team_delete_member_avatars" on storage.objects;
create policy "team_delete_member_avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'member-avatars'
  and public.is_team_member()
);

-- 4) Candidate color cho Project Test.
alter table public.team_project_tests
  add column if not exists candidate_color text not null default '#D8D8FF';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_project_tests_candidate_color_check'
  ) then
    alter table public.team_project_tests
      add constraint team_project_tests_candidate_color_check
      check (candidate_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

-- 5) PASS => tự thêm vào Members + profile.
--    Mọi member workspace có thể PASS candidate.
create or replace function public.team_pass_candidate(p_test_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.team_project_tests%rowtype;
  v_base_slug text;
  v_slug text;
  v_i integer := 2;
  v_existing text;
begin
  if not public.is_team_member() then
    raise exception 'Not allowed';
  end if;

  select *
  into v_test
  from public.team_project_tests
  where id = p_test_id
  for update;

  if not found then
    raise exception 'Project Test not found';
  end if;

  -- Nếu đã PASS trước đó và đã có member cùng display name, chỉ trả member đó.
  select slug into v_existing
  from public.team_members
  where lower(display_name) = lower(v_test.candidate_name)
  limit 1;

  if v_existing is not null then
    update public.team_project_tests
    set status = 'passed'
    where id = p_test_id;
    return v_existing;
  end if;

  v_base_slug := lower(
    trim(both '-' from regexp_replace(v_test.candidate_name, '[^A-Za-z0-9]+', '-', 'g'))
  );

  if v_base_slug is null or v_base_slug = '' then
    v_base_slug := 'member-' || substr(gen_random_uuid()::text, 1, 8);
  end if;

  v_slug := v_base_slug;
  while exists(select 1 from public.team_members where slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_i::text;
    v_i := v_i + 1;
  end loop;

  insert into public.team_members (
    slug, display_name, color, auth_user_id, is_owner, is_active
  )
  values (
    v_slug,
    v_test.candidate_name,
    upper(v_test.candidate_color),
    null,
    false,
    true
  );

  -- team_create_member_profile trigger của V2.2 tự tạo profile.
  update public.team_member_profiles
  set profile_color = upper(v_test.candidate_color),
      stage_name = case when stage_name = '' then v_test.candidate_name else stage_name end
  where member_slug = v_slug;

  update public.team_project_tests
  set status = 'passed'
  where id = p_test_id;

  return v_slug;
end;
$$;

revoke all on function public.team_pass_candidate(uuid) from public;
grant execute on function public.team_pass_candidate(uuid) to authenticated;

-- 6) Xóa member: chỉ OWNER.
--    Auth user không bị xóa; sau khi roster row bị xóa, account đó mất quyền workspace.
create or replace function public.team_delete_member(p_target_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.team_members%rowtype;
begin
  if not public.is_team_owner() then
    raise exception 'Only workspace owner can delete members';
  end if;

  select *
  into v_target
  from public.team_members
  where slug = p_target_slug
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  if v_target.is_owner then
    raise exception 'Owner cannot be deleted';
  end if;

  -- Gỡ member khỏi project và unassign các task đang giao cho member đó.
  update public.team_projects p
  set member_slugs = array_remove(p.member_slugs, p_target_slug),
      tasks = coalesce((
        select jsonb_agg(
          case
            when elem->>'assigneeId' = p_target_slug
              then jsonb_set(elem, '{assigneeId}', '""'::jsonb, true)
            else elem
          end
        )
        from jsonb_array_elements(coalesce(p.tasks, '[]'::jsonb)) elem
      ), '[]'::jsonb)
  where p_target_slug = any(p.member_slugs)
     or exists (
       select 1
       from jsonb_array_elements(coalesce(p.tasks, '[]'::jsonb)) elem
       where elem->>'assigneeId' = p_target_slug
     );

  -- Gỡ khỏi reviewer Project Test.
  update public.team_project_tests
  set reviewer_slugs = array_remove(reviewer_slugs, p_target_slug)
  where p_target_slug = any(reviewer_slugs);

  -- Profile cascade theo FK.
  delete from public.team_members
  where slug = p_target_slug;

  return true;
end;
$$;

revoke all on function public.team_delete_member(text) from public;
grant execute on function public.team_delete_member(text) to authenticated;

-- 7) team_members Realtime để PASS / DELETE hiện ngay ở tất cả máy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end $$;

-- Kiểm tra
select
  tm.slug,
  tm.display_name,
  tm.color,
  tm.auth_user_id,
  p.birth_month_day,
  p.avatar_path
from public.team_members tm
left join public.team_member_profiles p on p.member_slug = tm.slug
order by tm.created_at;
