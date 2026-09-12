-- ============================================================
-- TEAM SPACE V2.2 — MEMBER PROFILES MIGRATION
-- Chạy file này MỘT LƯỢT trên database V2/V2.1 hiện tại.
-- Có thể chạy lại an toàn.
-- ============================================================

-- 1) Đổi màu Vani ở roster chính
update public.team_members
set color = '#FFCDCD'
where slug = 'vani';

-- 2) Profile table tách riêng khỏi auth/owner data
create table if not exists public.team_member_profiles (
  member_slug text primary key references public.team_members(slug) on delete cascade,
  stage_name text not null default '',
  birth_date date,
  roles text[] not null default '{}',
  mbti text not null default '',
  zodiac text not null default '',
  profile_color text not null default '#B0D9FA',
  emoji text not null default '',
  pre_debut_songs text[] not null default '{}',
  stats jsonb not null default '[{"name":"VOCAL","value":0},{"name":"RAP","value":0},{"name":"ACT","value":0}]'::jsonb,
  languages jsonb not null default '[]'::jsonb,
  facts text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint team_member_profiles_color_check check (profile_color ~ '^#[0-9A-Fa-f]{6}$')
);

-- 3) Seed profile cho member hiện tại, giữ đúng màu roster
insert into public.team_member_profiles (member_slug, stage_name, profile_color)
select slug, display_name, color
from public.team_members
on conflict (member_slug) do nothing;

update public.team_member_profiles
set profile_color = '#FFCDCD'
where member_slug = 'vani';

-- 4) Tự tạo profile khi owner thêm member mới vào roster
create or replace function public.team_create_member_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_member_profiles(member_slug, stage_name, profile_color)
  values(new.slug, new.display_name, new.color)
  on conflict (member_slug) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_team_create_member_profile on public.team_members;
create trigger trg_team_create_member_profile
after insert on public.team_members
for each row execute function public.team_create_member_profile();

-- 5) updated_at
create or replace function public.team_profile_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_team_member_profiles_updated_at on public.team_member_profiles;
create trigger trg_team_member_profiles_updated_at
before update on public.team_member_profiles
for each row execute function public.team_profile_set_updated_at();

-- 6) RLS: mọi member đã được cấp quyền có thể xem + sửa profile
alter table public.team_member_profiles enable row level security;

drop policy if exists "members_read_profiles" on public.team_member_profiles;
create policy "members_read_profiles"
on public.team_member_profiles
for select
to authenticated
using (public.is_team_member());

drop policy if exists "members_insert_profiles" on public.team_member_profiles;
create policy "members_insert_profiles"
on public.team_member_profiles
for insert
to authenticated
with check (public.is_team_member());

drop policy if exists "members_update_profiles" on public.team_member_profiles;
create policy "members_update_profiles"
on public.team_member_profiles
for update
to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists "members_delete_profiles" on public.team_member_profiles;
create policy "members_delete_profiles"
on public.team_member_profiles
for delete
to authenticated
using (public.is_team_member());

revoke all on public.team_member_profiles from anon;
grant select, insert, update, delete on public.team_member_profiles to authenticated;

-- 7) Realtime — idempotent
DO $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='team_member_profiles'
  ) then
    alter publication supabase_realtime add table public.team_member_profiles;
  end if;
end $$;

-- Kiểm tra nhanh
select tm.slug, tm.display_name, tm.color,
       p.stage_name, p.profile_color, p.mbti, p.zodiac
from public.team_members tm
left join public.team_member_profiles p on p.member_slug = tm.slug
order by tm.display_name;
