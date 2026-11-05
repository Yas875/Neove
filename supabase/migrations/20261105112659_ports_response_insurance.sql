-- Port de la demande, délai de réponse annoncé par l'intervenant et assurance contrôlée par Seravia.
alter table public.requests add column port text check (port is null or char_length(port) <= 60);

alter table public.pros
  add column response_minutes smallint check (response_minutes is null or response_minutes in (15, 30, 60, 120)),
  add column insurance_verified boolean not null default false;

drop function public.pro_save_profile(text, text, text, text, text, text);
create function public.pro_save_profile(
  p_name text, p_category text, p_location text, p_phone text, p_siret text, p_description text, p_response_minutes smallint default null
) returns public.pros language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_row public.pros;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if char_length(v_phone) not between 6 and 30 then raise exception 'invalid_phone' using errcode = '22023'; end if;
  case p_location
    when 'nice' then v_lat := 43.695; v_lng := 7.285;
    when 'saint-augustin' then v_lat := 43.669; v_lng := 7.205;
    when 'carros' then v_lat := 43.793; v_lng := 7.187;
    when 'antibes' then v_lat := 43.585; v_lng := 7.128;
    else raise exception 'invalid_location' using errcode = '22023';
  end case;

  insert into public.pros (user_id, name, category, location, lat, lng, phone, siret, description, response_minutes, verified)
  values (v_uid, v_name, p_category, p_location, v_lat, v_lng, v_phone, p_siret, v_description, p_response_minutes, false)
  on conflict (user_id) do update set
    verified = public.pros.verified
      and public.pros.name = excluded.name
      and public.pros.category = excluded.category
      and public.pros.siret is not distinct from excluded.siret,
    -- Une assurance contrôlée pour une entreprise ne vaut pas pour une autre.
    insurance_verified = public.pros.insurance_verified
      and public.pros.name = excluded.name
      and public.pros.siret is not distinct from excluded.siret,
    rejected = false,
    name = excluded.name, category = excluded.category, location = excluded.location,
    lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
    siret = excluded.siret, description = excluded.description, response_minutes = excluded.response_minutes
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.pro_save_profile(text, text, text, text, text, text, smallint) from public, anon;
grant execute on function public.pro_save_profile(text, text, text, text, text, text, smallint) to authenticated;

drop function public.admin_list_pros();
create function public.admin_list_pros()
returns table (
  id uuid, name text, category text, location text, phone text, siret text,
  description text, verified boolean, rejected boolean, created_at timestamptz,
  response_minutes smallint, insurance_verified boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query
    select p.id, p.name, p.category, p.location, p.phone, p.siret, p.description, p.verified, p.rejected, p.created_at,
      p.response_minutes, p.insurance_verified
    from public.pros p
    order by (not p.verified and not p.rejected) desc, p.created_at desc
    limit 200;
end $$;
revoke all on function public.admin_list_pros() from public, anon;
grant execute on function public.admin_list_pros() to authenticated;

create function public.admin_set_pro_insurance(p_pro_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  update public.pros set insurance_verified = coalesce(p_verified, false) where id = p_pro_id;
  if not found then raise exception 'pro_not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.admin_set_pro_insurance(uuid, boolean) from public, anon;
grant execute on function public.admin_set_pro_insurance(uuid, boolean) to authenticated;
