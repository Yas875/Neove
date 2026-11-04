-- Photos privées, rangées dans un dossier par utilisateur, et limite d'analyses par utilisateur.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 5242880, array['image/jpeg']);

create policy "envoyer ses photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'request-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "lire ses photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'request-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Une demande ne peut référencer qu'une photo du dossier de son auteur.
alter table public.requests add constraint requests_photo_path_owner check (
  photo_path is null or split_part(photo_path, '/', 1) = user_id::text
);

create table public.photo_analyses (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index photo_analyses_user_created_idx on public.photo_analyses (user_id, created_at desc);
alter table public.photo_analyses enable row level security;
create policy "lire ses analyses" on public.photo_analyses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "compter ses analyses" on public.photo_analyses
  for insert to authenticated with check ((select auth.uid()) = user_id);
