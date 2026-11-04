-- Le nom du fichier doit venir de storage.objects, et non de la colonne name des fiches.
drop policy "voir les photos des demandes reçues" on storage.objects;
create policy "voir les photos des demandes reçues" on storage.objects
  for select to authenticated using (
    bucket_id = 'request-photos' and exists (
      select 1 from public.requests r join public.pros p on p.id = r.pro_id
      where r.photo_path = storage.objects.name and p.user_id = (select auth.uid()) and p.verified
    )
  );
