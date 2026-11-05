-- Administration : validation des fiches et modération des avis et photos.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;
create policy "voir son accès administrateur" on public.admins
  for select to authenticated using ((select auth.uid()) = user_id);

alter table public.pros add column rejected boolean not null default false;

create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Une fiche corrigée après un refus repasse en attente.
create or replace function public.pro_save_profile(
  p_name text, p_category text, p_location text, p_phone text, p_siret text, p_description text
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

  insert into public.pros (user_id, name, category, location, lat, lng, phone, siret, description, verified)
  values (v_uid, v_name, p_category, p_location, v_lat, v_lng, v_phone, p_siret, v_description, false)
  on conflict (user_id) do update set
    verified = public.pros.verified
      and public.pros.name = excluded.name
      and public.pros.category = excluded.category
      and public.pros.siret is not distinct from excluded.siret,
    rejected = false,
    name = excluded.name, category = excluded.category, location = excluded.location,
    lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
    siret = excluded.siret, description = excluded.description
  returning * into v_row;
  return v_row;
end $$;

create function public.admin_list_pros()
returns table (
  id uuid, name text, category text, location text, phone text, siret text,
  description text, verified boolean, rejected boolean, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query
    select p.id, p.name, p.category, p.location, p.phone, p.siret, p.description, p.verified, p.rejected, p.created_at
    from public.pros p
    order by (not p.verified and not p.rejected) desc, p.created_at desc
    limit 200;
end $$;
revoke all on function public.admin_list_pros() from public, anon;
grant execute on function public.admin_list_pros() to authenticated;

create function public.admin_set_pro(p_pro_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action not in ('valider', 'refuser', 'retirer') then raise exception 'invalid_action' using errcode = '22023'; end if;
  update public.pros set
    verified = p_action = 'valider',
    rejected = p_action = 'refuser'
  where id = p_pro_id;
  if not found then raise exception 'pro_not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.admin_set_pro(uuid, text) from public, anon;
grant execute on function public.admin_set_pro(uuid, text) to authenticated;

create function public.admin_list_reviews()
returns table (
  id uuid, pro_name text, rating smallint, comment text, reply text, hidden boolean,
  created_at timestamptz, author_name text, show_author boolean, avatar_path text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query
    select r.id, p.name, r.rating, r.comment, r.reply, r.hidden, r.created_at,
      pf.full_name, r.show_author, case when r.show_author then pf.avatar_path end
    from public.reviews r
    join public.pros p on p.id = r.pro_id
    left join public.profiles pf on pf.user_id = r.user_id
    order by r.created_at desc
    limit 200;
end $$;
revoke all on function public.admin_list_reviews() from public, anon;
grant execute on function public.admin_list_reviews() to authenticated;

create function public.admin_set_review_hidden(p_review_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  update public.reviews set hidden = coalesce(p_hidden, true) where id = p_review_id;
  if not found then raise exception 'review_not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.admin_set_review_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_review_hidden(uuid, boolean) to authenticated;

-- Retire la photo de l'auteur d'un avis et renvoie son chemin pour effacer le fichier.
create function public.admin_clear_review_avatar(p_review_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_path text;
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  select user_id into v_user from public.reviews where id = p_review_id;
  if v_user is null then raise exception 'review_not_found' using errcode = 'P0002'; end if;
  select avatar_path into v_path from public.profiles where user_id = v_user;
  update public.profiles set avatar_path = null where user_id = v_user;
  return v_path;
end $$;
revoke all on function public.admin_clear_review_avatar(uuid) from public, anon;
grant execute on function public.admin_clear_review_avatar(uuid) to authenticated;

create policy "administrateur voit les photos de profil" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and public.is_admin());
create policy "administrateur supprime une photo de profil" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and public.is_admin());
