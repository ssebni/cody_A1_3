-- Apply after 003. Adds short labels and safe deletion for unused invitations.
begin;

alter table public.invitations
  add column if not exists memo text not null default ''
  check (char_length(btrim(memo)) <= 10);

create or replace function public.invitation_action(
  p_user uuid,
  p_action text,
  p_data jsonb default '{}'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_inv invitations%rowtype;
  v_memo text := btrim(coalesce(p_data->>'memo', ''));
begin
  if not exists(select 1 from members where id=p_user and status='active') then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if char_length(v_memo) > 10 then
    raise exception 'INVALID_INPUT';
  end if;

  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'memo', i.memo,
          'expires_at', i.expires_at,
          'used', i.used_by is not null,
          'invitee_name', (select display_name from members where id=i.used_by),
          'has_profile', exists(
            select 1 from profiles p
            where p.invitation_id=i.id or p.owner_id=i.used_by
          ),
          'can_create_profile', not exists(
            select 1 from profiles p
            where p.invitation_id=i.id or p.owner_id=i.used_by
          ) and (
            (i.used_by is null and i.expires_at > now())
            or exists(
              select 1 from members m
              where m.id=i.used_by and m.invited_by=p_user and m.status='active'
            )
          )
        ) order by i.created_at desc
      )
      from invitations i
      where i.inviter_id=p_user
    ), '[]'::jsonb);

  elsif p_action = 'create' then
    if not consume_usage(p_user, 'invite', 10, 5) then
      raise exception 'RATE_LIMIT';
    end if;
    insert into invitations(code_hash, inviter_id, expires_at, memo)
      values(p_data->>'code_hash', p_user, now() + interval '30 days', v_memo)
      returning * into v_inv;
    return jsonb_build_object('id', v_inv.id, 'memo', v_inv.memo, 'expires_at', v_inv.expires_at);

  elsif p_action = 'memo' then
    select * into v_inv
      from invitations
      where id=(p_data->>'id')::uuid
      for update;
    if not found or v_inv.inviter_id <> p_user then
      raise exception 'FORBIDDEN';
    end if;
    update invitations set memo=v_memo where id=v_inv.id;
    return jsonb_build_object('ok', true);

  elsif p_action = 'delete' then
    select * into v_inv
      from invitations
      where id=(p_data->>'id')::uuid
      for update;
    if not found or v_inv.inviter_id <> p_user then
      raise exception 'FORBIDDEN';
    end if;
    if v_inv.used_by is not null
       or exists(select 1 from profiles where invitation_id=v_inv.id) then
      raise exception 'STATE_CONFLICT';
    end if;
    delete from invitations where id=v_inv.id;
    return jsonb_build_object('ok', true);

  else
    raise exception 'INVALID_INPUT';
  end if;
end $$;

revoke all on function public.invitation_action(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.invitation_action(uuid,text,jsonb)
  to service_role;

commit;
