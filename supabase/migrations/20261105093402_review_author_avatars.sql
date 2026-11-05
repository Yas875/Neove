-- Photo de profil, et affichage de l'auteur d'un avis seulement s'il l'a choisi.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg']);

create policy "envoyer sa photo de profil" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "voir ses fichiers de photo de profil" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "supprimer sa photo de profil" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.profiles
  add column avatar_path text,
  add constraint profiles_avatar_own_folder check (avatar_path is null or avatar_path ~ ('^' || user_id::text || '/[0-9a-f-]+\.jpg$'));

alter table public.reviews add column show_author boolean not null default false;

drop function public.submit_review(uuid, integer, text);
create function public.submit_review(p_request_id uuid, p_rating integer, p_comment text, p_show_author boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pro uuid;
  v_id uuid;
begin
  select pro_id into v_pro from public.requests
    where id = p_request_id and user_id = auth.uid() and status = 'terminee' and pro_id is not null;
  if v_pro is null then raise exception 'review_not_allowed' using errcode = '42501'; end if;
  insert into public.reviews (request_id, pro_id, user_id, rating, comment, show_author)
  values (p_request_id, v_pro, auth.uid(), p_rating, nullif(btrim(coalesce(p_comment, '')), ''), coalesce(p_show_author, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_review(uuid, integer, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, integer, text, boolean) to authenticated;

-- Avis publics d'un intervenant. Le prénom, l'initiale et la photo ne sortent que si l'auteur l'a accepté.
create function public.pro_reviews(p_pro_id uuid)
returns table (
  id uuid, rating smallint, comment text, reply text, replied_at timestamptz, created_at timestamptz,
  author_name text, author_avatar text
) language sql stable security definer set search_path = '' as $$
  select r.id, r.rating, r.comment, r.reply, r.replied_at, r.created_at,
    case when r.show_author and btrim(coalesce(pf.full_name, '')) <> '' then
      split_part(btrim(pf.full_name), ' ', 1)
      || case when btrim(pf.full_name) like '% %'
           then ' ' || upper(left(btrim(substring(btrim(pf.full_name) from position(' ' in btrim(pf.full_name)))), 1)) || '.'
           else '' end
    end,
    case when r.show_author then pf.avatar_path end
  from public.reviews r
  join public.pros p on p.id = r.pro_id
  left join public.profiles pf on pf.user_id = r.user_id
  where r.pro_id = p_pro_id and not r.hidden and p.verified
  order by r.created_at desc
  limit 50;
$$;
revoke all on function public.pro_reviews(uuid) from public;
grant execute on function public.pro_reviews(uuid) to anon, authenticated;
