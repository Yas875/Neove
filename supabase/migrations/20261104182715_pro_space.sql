-- Espace intervenant. Un compte est relié à une fiche par un administrateur.
alter type public.request_status add value if not exists 'refusee';

alter table public.pros
  add column user_id uuid unique references auth.users (id) on delete set null,
  add column phone text;

alter table public.requests
  add column contact_phone text check (contact_phone is null or char_length(contact_phone) between 6 and 30);

-- Seules les fiches vérifiées sont publiques ; un intervenant voit toujours la sienne.
drop policy "pros vérifiés visibles" on public.pros;
create policy "pros vérifiés visibles" on public.pros
  for select to anon, authenticated using (verified);
create policy "voir sa fiche" on public.pros
  for select to authenticated using ((select auth.uid()) = user_id);

-- Une demande ne peut être adressée qu'à un intervenant vérifié.
drop policy "créer ses demandes" on public.requests;
create policy "créer ses demandes" on public.requests
  for insert to authenticated with check (
    (select auth.uid()) = user_id and status = 'envoyee'
    and (pro_id is null or exists (select 1 from public.pros p where p.id = pro_id and p.verified))
  );

-- Un intervenant vérifié ne voit que les demandes qui lui sont adressées.
create policy "voir les demandes reçues" on public.requests
  for select to authenticated using (exists (
    select 1 from public.pros p where p.id = pro_id and p.user_id = (select auth.uid()) and p.verified
  ));
create policy "voir le suivi des demandes reçues" on public.request_events
  for select to authenticated using (exists (
    select 1 from public.requests r join public.pros p on p.id = r.pro_id
    where r.id = request_id and p.user_id = (select auth.uid()) and p.verified
  ));
create policy "voir les photos des demandes reçues" on storage.objects
  for select to authenticated using (
    bucket_id = 'request-photos' and exists (
      select 1 from public.requests r join public.pros p on p.id = r.pro_id
      where r.photo_path = name and p.user_id = (select auth.uid()) and p.verified
    )
  );

-- Les statuts ne changent que par cette fonction, qui impose les étapes autorisées.
create function public.pro_update_request(p_request_id uuid, p_action text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pro uuid;
  v_status text;
  v_next text;
begin
  select id into v_pro from public.pros where user_id = auth.uid() and verified;
  if v_pro is null then raise exception 'not_a_verified_pro' using errcode = '42501'; end if;

  select status::text into v_status from public.requests
    where id = p_request_id and pro_id = v_pro for update;
  if v_status is null then raise exception 'request_not_found' using errcode = 'P0002'; end if;

  v_next := case
    when v_status = 'envoyee' and p_action = 'accepter' then 'en_route'
    when v_status = 'envoyee' and p_action = 'refuser' then 'refusee'
    when v_status = 'en_route' and p_action = 'commencer' then 'en_cours'
    when v_status = 'en_cours' and p_action = 'terminer' then 'terminee'
    when v_status in ('en_route', 'en_cours') and p_action = 'annuler' then 'annulee'
  end;
  if v_next is null then raise exception 'invalid_transition' using errcode = '22023'; end if;

  update public.requests set status = v_next::public.request_status where id = p_request_id;
  insert into public.request_events (request_id, status) values (p_request_id, v_next::public.request_status);
  return v_next;
end $$;
revoke all on function public.pro_update_request(uuid, text) from public, anon;
grant execute on function public.pro_update_request(uuid, text) to authenticated;
