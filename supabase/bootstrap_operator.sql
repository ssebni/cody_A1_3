-- Supabase SQL Editor에서 운영자 Auth 계정을 만든 뒤 실행합니다.
-- 아래 UUID를 Authentication > Users에서 복사한 실제 User UID로 바꾸세요.
-- 비밀번호나 서버 키는 이 파일에 넣지 않습니다. 001 스키마가 필요합니다.
do $$
declare
  -- 실행할 때 null을 실제 Authentication User UID로 바꾸세요.
  operator_id uuid := null;
begin
  if operator_id is null then
    raise exception 'operator_id에 실제 User UID를 입력하세요.';
  end if;
  if not exists (select 1 from auth.users where id = operator_id and email_confirmed_at is not null) then
    raise exception '이메일 확인 완료된 Auth 계정의 User UID를 입력하세요.';
  end if;
  if exists (select 1 from public.members where id = operator_id and status <> 'active') then
    raise exception '이미 등록된 비활성 회원입니다. 기존 회원 상태를 먼저 확인하세요.';
  end if;
  insert into public.members(id, display_name, status)
    values (operator_id, '첫 주선자', 'active')
    on conflict (id) do nothing;
  raise notice '운영자 계정의 활성 회원 연결을 확인했습니다.';
end $$;
