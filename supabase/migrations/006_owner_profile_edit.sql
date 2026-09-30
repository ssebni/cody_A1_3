-- Apply after 005. Lets a profile owner correct their own profile before approval.
begin;

create or replace function public.profile_action(p_user uuid, p_data jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_inv invitations%rowtype;
  v_id uuid;
begin
  if not exists(select 1 from members where id=p_user and status='active') then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_data->>'id' is not null then
    select * into v_profile from profiles where id=(p_data->>'id')::uuid for update;
    if not found or p_user not in (v_profile.author_id, v_profile.owner_id) then
      raise exception 'FORBIDDEN';
    end if;
    v_id := v_profile.id;
    update profiles set
      nickname=p_data->>'nickname', age_band=p_data->>'age_band',
      birth_year_month=(p_data->>'birth_year_month')::date,
      hometown=coalesce(p_data->>'hometown',''), region=p_data->>'region',
      hobbies=array(select jsonb_array_elements_text(p_data->'hobbies')),
      job=p_data->>'job', height_cm=(p_data->>'height_cm')::integer,
      religion=coalesce(p_data->>'religion',''), mbti=coalesce(p_data->>'mbti',''),
      introduction=p_data->>'introduction', approved_at=null,
      updated_at=clock_timestamp(), status=case when owner_id is null then 'draft' else 'pending' end
    where id=v_id;
  else
    select * into v_inv from invitations where id=(p_data->>'invitation_id')::uuid for update;
    if not found or v_inv.inviter_id <> p_user then raise exception 'INVITE_INVALID'; end if;
    if v_inv.used_by is null then
      if v_inv.expires_at <= now() then raise exception 'INVITE_INVALID'; end if;
    elsif not exists(select 1 from members where id=v_inv.used_by and invited_by=p_user and status='active') then
      raise exception 'INVITE_INVALID';
    end if;
    insert into profiles(
      author_id, invitation_id, owner_id, status, nickname, age_band,
      birth_year_month, hometown, region, hobbies, job, height_cm, religion, mbti, introduction
    ) values (
      p_user, v_inv.id, v_inv.used_by,
      case when v_inv.used_by is null then 'draft' else 'pending' end,
      p_data->>'nickname', p_data->>'age_band', (p_data->>'birth_year_month')::date,
      coalesce(p_data->>'hometown',''), p_data->>'region',
      array(select jsonb_array_elements_text(p_data->'hobbies')),
      p_data->>'job', (p_data->>'height_cm')::integer,
      coalesce(p_data->>'religion',''), coalesce(p_data->>'mbti',''), p_data->>'introduction'
    ) returning id into v_id;
  end if;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.profile_photo_action(
  p_user uuid,
  p_action text,
  p_data jsonb default '{}'
)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_photo profile_photos%rowtype;
  v_position integer;
begin
  if not exists(select 1 from members where id=p_user and status='active') then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pp.id,'profile_id',pp.profile_id,'object_path',pp.object_path,'position',pp.position
      ) order by pp.profile_id,pp.position)
      from profile_photos pp join profiles p on p.id=pp.profile_id
      where p.author_id=p_user or p.owner_id=p_user or p.status='published'
    ), '[]'::jsonb);

  elsif p_action in ('authorize','register') then
    select * into v_profile from profiles where id=(p_data->>'profile_id')::uuid for update;
    if not found or p_user not in (v_profile.author_id, v_profile.owner_id) then
      raise exception 'FORBIDDEN';
    end if;
    if (select count(*) from profile_photos where profile_id=v_profile.id) >= 3 then
      raise exception 'PHOTO_LIMIT';
    end if;
    if p_action = 'authorize' then return jsonb_build_object('ok',true); end if;
    if p_data->>'object_path' not like v_profile.id::text || '/%' then raise exception 'INVALID_INPUT'; end if;
    select min(slot) into v_position from generate_series(0,2) slot
      where not exists(select 1 from profile_photos where profile_id=v_profile.id and position=slot);
    insert into profile_photos(profile_id,object_path,position)
      values(v_profile.id,p_data->>'object_path',v_position) returning * into v_photo;
    update profiles set approved_at=null,updated_at=clock_timestamp(),
      status=case when owner_id is null then 'draft' else 'pending' end where id=v_profile.id;
    return jsonb_build_object('id',v_photo.id,'position',v_photo.position);

  elsif p_action = 'delete_info' then
    select pp.* into v_photo from profile_photos pp join profiles p on p.id=pp.profile_id
      where pp.id=(p_data->>'id')::uuid and p_user in (p.author_id, p.owner_id);
    if not found then raise exception 'FORBIDDEN'; end if;
    return jsonb_build_object('object_path',v_photo.object_path);

  elsif p_action = 'delete' then
    select pp.* into v_photo from profile_photos pp join profiles p on p.id=pp.profile_id
      where pp.id=(p_data->>'id')::uuid and p_user in (p.author_id, p.owner_id) for update of pp;
    if not found then raise exception 'FORBIDDEN'; end if;
    delete from profile_photos where id=v_photo.id;
    update profiles set approved_at=null,updated_at=clock_timestamp(),
      status=case when owner_id is null then 'draft' else 'pending' end where id=v_photo.profile_id;
    return jsonb_build_object('ok',true,'object_path',v_photo.object_path);
  else
    raise exception 'INVALID_INPUT';
  end if;
end $$;

revoke all on function public.profile_action(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.profile_photo_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.profile_action(uuid,jsonb) to service_role;
grant execute on function public.profile_photo_action(uuid,text,jsonb) to service_role;

commit;
