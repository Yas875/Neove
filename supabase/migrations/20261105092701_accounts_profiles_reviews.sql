-- Comptes : profil personnel, fiche créée par l'intervenant et avis des clients servis.
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 100),
  phone text check (phone is null or char_length(phone) between 6 and 30),
  home_location text check (home_location is null or home_location in ('nice', 'saint-augustin', 'carros', 'antibes')),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
create policy "lire son profil" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "créer son profil" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "modifier son profil" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.pros
  add column location text check (location is null or location in ('nice', 'saint-augustin', 'carros', 'antibes')),
  add column siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  add column description text check (description is null or char_length(description) <= 500);

-- L'intervenant écrit sa fiche uniquement par cette fonction : il ne peut jamais se vérifier lui-même.
-- Changer de nom, de métier ou de SIRET renvoie la fiche en vérification.
create function public.pro_save_profile(
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
    name = excluded.name, category = excluded.category, location = excluded.location,
    lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
    siret = excluded.siret, description = excluded.description
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.pro_save_profile(text, text, text, text, text, text) from public, anon;
grant execute on function public.pro_save_profile(text, text, text, text, text, text) to authenticated;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  -- L'avis survit à la purge de la demande, mais disparaît avec le compte de son auteur.
  request_id uuid unique references public.requests (id) on delete set null,
  pro_id uuid not null references public.pros (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  reply text check (reply is null or char_length(reply) <= 1000),
  replied_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_pro_id_idx on public.reviews (pro_id);
create index reviews_user_id_idx on public.reviews (user_id);
alter table public.reviews enable row level security;

-- Lecture publique sans l'auteur ni la demande ; écriture uniquement par les fonctions ci-dessous.
revoke all on public.reviews from anon, authenticated;
grant select (id, pro_id, rating, comment, reply, replied_at, created_at) on public.reviews to anon, authenticated;
create policy "avis publiés visibles" on public.reviews
  for select to anon, authenticated using (
    not hidden and exists (select 1 from public.pros p where p.id = pro_id and p.verified)
  );

create function public.submit_review(p_request_id uuid, p_rating integer, p_comment text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pro uuid;
  v_id uuid;
begin
  select pro_id into v_pro from public.requests
    where id = p_request_id and user_id = auth.uid() and status = 'terminee' and pro_id is not null;
  if v_pro is null then raise exception 'review_not_allowed' using errcode = '42501'; end if;
  insert into public.reviews (request_id, pro_id, user_id, rating, comment)
  values (p_request_id, v_pro, auth.uid(), p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;

create function public.my_reviewed_requests()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select request_id from public.reviews where user_id = auth.uid() and request_id is not null;
$$;
revoke all on function public.my_reviewed_requests() from public, anon;
grant execute on function public.my_reviewed_requests() to authenticated;

create function public.pro_reply_review(p_review_id uuid, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reply text := btrim(coalesce(p_reply, ''));
begin
  if char_length(v_reply) not between 1 and 1000 then raise exception 'invalid_reply' using errcode = '22023'; end if;
  update public.reviews r set reply = v_reply, replied_at = now()
    where r.id = p_review_id
      and r.pro_id = (select p.id from public.pros p where p.user_id = auth.uid() and p.verified);
  if not found then raise exception 'review_not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.pro_reply_review(uuid, text) from public, anon;
grant execute on function public.pro_reply_review(uuid, text) to authenticated;
