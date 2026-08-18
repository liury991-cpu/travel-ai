-- ============================================================================
-- travel-ai · 初始化迁移
-- 两张表：profiles（登录用户资料）、itineraries（用户保存的所有旅行计划）
-- 全程开启 RLS（行级安全），保证「每个人只能看/改自己的行程」
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) profiles：镜像 auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is '用户资料，注册时由触发器自动创建';

alter table public.profiles enable row level security;

drop policy if exists "profiles 本人可读" on public.profiles;
create policy "profiles 本人可读"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles 本人可改" on public.profiles;
create policy "profiles 本人可改"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 新用户注册 → 自动建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2) itineraries：用户保存的「所有旅行计划」
--    data 字段存完整的 Plan JSON（含每天 POI、坐标、类别、预算等）
-- ---------------------------------------------------------------------------
create table if not exists public.itineraries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  city         text not null,
  title        text not null,
  days         int  not null default 1,
  prefs        text[] not null default '{}',
  budget_tier  text not null default 'comfort',
  data         jsonb not null,
  total_budget numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.itineraries is '用户生成的行程，支持按城市/时间检索与回看';
comment on column public.itineraries.data is '完整 Plan 对象（days / pois / totalBudget 等）';

alter table public.itineraries enable row level security;

drop policy if exists "行程 仅本人可见" on public.itineraries;
create policy "行程 仅本人可见"
  on public.itineraries for select
  using (auth.uid() = user_id);

drop policy if exists "行程 仅本人可写" on public.itineraries;
create policy "行程 仅本人可写"
  on public.itineraries for insert
  with check (auth.uid() = user_id);

drop policy if exists "行程 仅本人可改" on public.itineraries;
create policy "行程 仅本人可改"
  on public.itineraries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "行程 仅本人可删" on public.itineraries;
create policy "行程 仅本人可删"
  on public.itineraries for delete
  using (auth.uid() = user_id);

create index if not exists itineraries_user_idx
  on public.itineraries (user_id, created_at desc);

-- 更新时间戳触发器
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists itineraries_touch_updated on public.itineraries;
create trigger itineraries_touch_updated
  before update on public.itineraries
  for each row execute function public.touch_updated_at();
