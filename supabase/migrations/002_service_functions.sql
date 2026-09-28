-- Run AFTER 001. Does not delete existing members or profiles.
begin;
alter table public.members add column if not exists adult_confirmed_at timestamptz;
create table if not exists public.contact_shares (
  member_id uuid primary key references public.members(id),
  contact_value text not null check (char_length(btrim(contact_value)) between 1 and 120)
);
create table if not exists public.usage_limits (
  member_id uuid not null references public.members(id),
  action text not null,
  day date not null default (now() at time zone 'UTC')::date,
  count integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (member_id, action, day)
);
alter table public.contact_shares enable row level security;
alter table public.usage_limits enable row level security;
revoke all on public.contact_shares, public.usage_limits from anon, authenticated;
grant all on public.contact_shares, public.usage_limits to service_role;

-- Service role only: the Python API supplies the verified user ID.
create or replace function public.consume_usage(p_user uuid, p_action text, p_limit integer, p_seconds integer)
returns boolean language plpgsql set search_path = public as $$
declare v_count integer;
begin
  insert into usage_limits(member_id, action, count) values(p_user, p_action, 1)
  on conflict (member_id, action, day) do update
    set count = usage_limits.count + 1, last_at = now()
    where usage_limits.count < p_limit
      and usage_limits.last_at <= now() - make_interval(secs => p_seconds)
  returning count into v_count;
  return v_count is not null;
end $$;

create or replace function public.finish_join(p_user uuid, p_hash text, p_name text)
returns jsonb language plpgsql set search_path = public as $$
declare v_inv invitations%rowtype;
begin
  select * into v_inv from invitations where code_hash = p_hash for update;
  if not found then raise exception 'INVITE_INVALID'; end if;
  if v_inv.used_by = p_user then return jsonb_build_object('ok', true); end if;
  if v_inv.used_by is not null or v_inv.expires_at <= now()
    or not exists(select 1 from members where id = v_inv.inviter_id and status = 'active')
    then raise exception 'INVITE_INVALID'; end if;
  insert into members(id, display_name, invited_by, status, adult_confirmed_at)
    values(p_user, p_name, v_inv.inviter_id, 'active', now());
  update invitations set used_by = p_user, used_at = now() where id = v_inv.id;
  update profiles set owner_id = p_user, status = 'pending', updated_at = now()
    where invitation_id = v_inv.id and owner_id is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.service_action(p_user uuid, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_inv invitations%rowtype;
  v_match matches%rowtype;
  v_id uuid;
  v_other uuid;
  v_result jsonb;
begin
  if not exists(select 1 from members where id = p_user and status = 'active')
    then raise exception 'MEMBER_REQUIRED'; end if;

  if p_action = 'invite' then
    if not consume_usage(p_user, 'invite', 10, 5) then raise exception 'RATE_LIMIT'; end if;
    insert into invitations(code_hash, inviter_id, expires_at)
      values(p_data->>'code_hash', p_user, now() + interval '30 days') returning * into v_inv;
    return jsonb_build_object('id', v_inv.id, 'expires_at', v_inv.expires_at);

  elsif p_action = 'profile' then
    if p_data->>'id' is not null then
      select * into v_profile from profiles where id = (p_data->>'id')::uuid for update;
      if not found or v_profile.author_id <> p_user then raise exception 'FORBIDDEN'; end if;
      v_id := v_profile.id;
      update profiles set nickname=p_data->>'nickname', age_band=p_data->>'age_band',
        region=p_data->>'region', hobbies=array(select jsonb_array_elements_text(p_data->'hobbies')),
        introduction=p_data->>'introduction', approved_at=null, updated_at=clock_timestamp(),
        status=case when owner_id is null then 'draft' else 'pending' end where id=v_id;
    else
      select * into v_inv from invitations where id=(p_data->>'invitation_id')::uuid for update;
      if not found or v_inv.inviter_id <> p_user or v_inv.used_by is not null or v_inv.expires_at <= now()
        then raise exception 'INVITE_INVALID'; end if;
      insert into profiles(author_id, invitation_id, nickname, age_band, region, hobbies, introduction)
        values(p_user, v_inv.id, p_data->>'nickname', p_data->>'age_band', p_data->>'region',
          array(select jsonb_array_elements_text(p_data->'hobbies')), p_data->>'introduction') returning id into v_id;
    end if;
    return jsonb_build_object('id', v_id);

  elsif p_action = 'approval' then
    select * into v_profile from profiles where id=(p_data->>'id')::uuid for update;
    if not found or v_profile.owner_id is distinct from p_user then raise exception 'FORBIDDEN'; end if;
    if p_data->>'version' is distinct from v_profile.updated_at::text
       and (p_data->>'version')::timestamptz is distinct from v_profile.updated_at
       then raise exception 'STALE_PROFILE'; end if;
    update profiles set status=case when (p_data->>'publish')::boolean then 'published' else 'hidden' end,
      approved_at=case when (p_data->>'publish')::boolean then now() else null end,
      updated_at=clock_timestamp() where id=v_profile.id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'contact' then
    insert into contact_shares(member_id,contact_value) values(p_user,p_data->>'contact_value')
      on conflict(member_id) do update set contact_value=excluded.contact_value;
    return jsonb_build_object('ok', true);

  elsif p_action = 'match' then
    v_other := (p_data->>'recipient_id')::uuid;
    if v_other = p_user then raise exception 'SELF_MATCH'; end if;
    -- Stable locking order prevents reciprocal requests deadlocking.
    perform id from profiles where owner_id in (p_user,v_other) order by id for share;
    if (select count(*) from profiles where owner_id in (p_user,v_other) and status='published') <> 2
      or not exists(select 1 from members where id=v_other and status='active')
      then raise exception 'PUBLISHED_REQUIRED'; end if;
    if not exists(select 1 from contact_shares where member_id=p_user) then raise exception 'CONTACT_REQUIRED'; end if;
    if not consume_usage(p_user,'match',20,3) then raise exception 'RATE_LIMIT'; end if;
    insert into matches(requester_id,recipient_id) values(p_user,v_other) returning id into v_id;
    return jsonb_build_object('id',v_id);

  elsif p_action = 'respond' then
    select * into v_match from matches where id=(p_data->>'id')::uuid for update;
    if not found or p_user not in (v_match.requester_id,v_match.recipient_id) then raise exception 'FORBIDDEN'; end if;
    if v_match.status <> 'pending' then raise exception 'STATE_CONFLICT'; end if;
    if p_data->>'status' = 'cancelled' then
      if p_user <> v_match.requester_id then raise exception 'FORBIDDEN'; end if;
    elsif p_data->>'status' in ('accepted','declined') then
      if p_user <> v_match.recipient_id then raise exception 'FORBIDDEN'; end if;
      if p_data->>'status' = 'accepted' then
        perform id from profiles where owner_id in (v_match.requester_id,v_match.recipient_id) order by id for share;
        if (select count(*) from profiles where owner_id in (v_match.requester_id,v_match.recipient_id) and status='published') <> 2
          or not exists(select 1 from members where id=v_match.requester_id and status='active')
          then raise exception 'PUBLISHED_REQUIRED'; end if;
        if not exists(select 1 from contact_shares where member_id=p_user) then raise exception 'CONTACT_REQUIRED'; end if;
      end if;
    else raise exception 'INVALID_INPUT'; end if;
    update matches set status=p_data->>'status',updated_at=now() where id=v_match.id;
    return jsonb_build_object('ok',true);

  elsif p_action = 'ai' then
    if not consume_usage(p_user,'ai',10,15) then raise exception 'RATE_LIMIT'; end if;
    return jsonb_build_object('ok',true);

  elsif p_action = 'state' then
    -- Graph IDs stay on the server; Python emits distances only.
    return jsonb_build_object(
      'me',(select jsonb_build_object('id',id,'display_name',display_name) from members where id=p_user),
      'graph',coalesce((select jsonb_agg(jsonb_build_object('id',id,'invited_by',invited_by)) from members),'[]'),
      'profiles',coalesce((select jsonb_agg(to_jsonb(p)) from profiles p join members m on m.id=p.owner_id
        where p.status='published' and m.status='active' and p.owner_id<>p_user),'[]'),
      'own_profile',(select to_jsonb(p) from profiles p where p.owner_id=p_user),
      'authored',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from profiles p where p.author_id=p_user),'[]'),
      'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'expires_at',i.expires_at,
        'used',i.used_by is not null,'has_profile',exists(select 1 from profiles p where p.invitation_id=i.id))
        order by i.created_at desc) from invitations i where i.inviter_id=p_user),'[]'),
      'contact',(select contact_value from contact_shares where member_id=p_user),
      'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,
        'outgoing',m.requester_id=p_user,'other_id',case when m.requester_id=p_user then m.recipient_id else m.requester_id end,
        'name',coalesce(p.nickname,'프로필 비공개'),'created_at',m.created_at,
        'contact',case when m.status='accepted' and u.status='active' then c.contact_value else null end)
        order by m.created_at desc) from matches m
        join members u on u.id=case when m.requester_id=p_user then m.recipient_id else m.requester_id end
        left join profiles p on p.owner_id=u.id and p.status='published'
        left join contact_shares c on c.member_id=u.id
        where p_user in (m.requester_id,m.recipient_id)),'[]'));
  else raise exception 'INVALID_INPUT'; end if;
end $$;

revoke all on function public.consume_usage(uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function public.finish_join(uuid,text,text) from public,anon,authenticated;
revoke all on function public.service_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.consume_usage(uuid,text,integer,integer) to service_role;
grant execute on function public.finish_join(uuid,text,text) to service_role;
grant execute on function public.service_action(uuid,text,jsonb) to service_role;
commit;
