-- Durées provisoires, à faire valider : photos 90 jours, demandes 1 an, compteur d'analyses 30 jours.
-- Les fichiers sont supprimés par la fonction purge-data via l'API Storage, jamais directement en SQL.
create function public.expired_photo_paths(p_limit integer default 500)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'request-photos' and o.created_at < now() - interval '90 days'
    and not exists (
      select 1 from public.requests r
      where r.photo_path = o.name and r.status in ('en_route', 'en_cours')
    )
  order by o.created_at limit p_limit;
$$;

create function public.purge_expired_rows()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_requests integer;
begin
  delete from public.requests
    where created_at < now() - interval '1 year' and status not in ('en_route', 'en_cours');
  get diagnostics v_requests = row_count;
  delete from public.photo_analyses where created_at < now() - interval '30 days';
  return v_requests;
end $$;

revoke all on function public.expired_photo_paths(integer) from public, anon, authenticated;
revoke all on function public.purge_expired_rows() from public, anon, authenticated;
grant execute on function public.expired_photo_paths(integer) to service_role;
grant execute on function public.purge_expired_rows() to service_role;

create function public.purge_key_matches(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret = p_key from vault.decrypted_secrets where name = 'neove_purge_key'), false);
$$;
revoke all on function public.purge_key_matches(text) from public, anon, authenticated;
grant execute on function public.purge_key_matches(text) to service_role;

-- La clé est générée dans le coffre de la base : elle n'apparaît ni dans le code ni dans les journaux du dépôt.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'neove_purge_key', 'Clé de la suppression planifiée');

create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

select cron.schedule('neove-purge-data', '17 3 * * *', $job$
  select net.http_post(
    url := 'https://oupzgfdhssrwkpxqzdoe.supabase.co/functions/v1/purge-data',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-key',
      (select decrypted_secret from vault.decrypted_secrets where name = 'neove_purge_key')),
    body := '{}'::jsonb
  );
$job$);
