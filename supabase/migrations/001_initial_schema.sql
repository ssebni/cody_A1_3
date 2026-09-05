-- 내친소: 새 Supabase 프로젝트에서 한 번 실행하는 초기 구조.
-- 계정 생성/초대 소진/권한 검증 API는 후속 구현입니다.
-- 브라우저 직접 접근은 차단하고 Python 서버를 통해서만 사용합니다.
begin;

create table public.members (
  id uuid primary key references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  invited_by uuid references public.members(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  check (invited_by is distinct from id)
);
create index members_invited_by_idx on public.members(invited_by);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  inviter_id uuid not null references public.members(id),
  expires_at timestamptz not null,
  used_by uuid unique references public.members(id),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((used_by is null) = (used_at is null)),
  check (used_by is distinct from inviter_id)
);
create index invitations_inviter_idx on public.invitations(inviter_id);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid unique references public.members(id),
  author_id uuid not null references public.members(id),
  invitation_id uuid unique references public.invitations(id),
  nickname text not null check (char_length(btrim(nickname)) between 1 and 40),
  age_band text not null default '' check (char_length(age_band) <= 30),
  region text not null default '' check (char_length(region) <= 80),
  hobbies text[] not null default '{}' check (cardinality(hobbies) <= 10),
  introduction text not null default '' check (char_length(introduction) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'pending', 'published', 'hidden')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id is not null or invitation_id is not null),
  check (status <> 'published' or (owner_id is not null and approved_at is not null))
);
create index profiles_author_idx on public.profiles(author_id);
create index profiles_status_idx on public.profiles(status);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.members(id),
  recipient_id uuid not null references public.members(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create index matches_requester_idx on public.matches(requester_id);
create index matches_recipient_idx on public.matches(recipient_id);
create unique index matches_active_pair_idx on public.matches
  (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
  where status in ('pending', 'accepted');

-- 허용 정책 없이 일반 사용자의 직접 접근을 차단합니다.
-- 서버 관리 권한은 RLS를 우회하므로 각 API에서 인증·권한 검증이 필수입니다.
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
revoke all on table public.members, public.invitations, public.profiles, public.matches from anon, authenticated;
grant select, insert, update, delete on table public.members, public.invitations, public.profiles, public.matches to service_role;

commit;

-- 실행 결과: 네 행 모두 rls_enabled = true인지 확인합니다.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('members', 'invitations', 'profiles', 'matches')
order by relname;
