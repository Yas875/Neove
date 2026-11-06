-- Prévient l'intervenant par e-mail quand une demande lui est adressée.
alter table public.requests add column pro_notified_at timestamptz;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'neove_notify_key', 'Clé de l''envoi des alertes aux intervenants');

create function public.notify_key_matches(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret = p_key from vault.decrypted_secrets where name = 'neove_notify_key'), false);
$$;
revoke all on function public.notify_key_matches(text) from public, anon, authenticated;
grant execute on function public.notify_key_matches(text) to service_role;

-- Réserve l'alerte une seule fois. Au-delà de 5 alertes par heure pour un même client, rien n'est envoyé.
create function public.claim_pro_notification(p_request_id uuid)
returns table (email text, category text, location text, port text, urgency_score integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  select r.user_id into v_user from public.requests r where r.id = p_request_id;
  if v_user is null then return; end if;
  if (select count(*) from public.requests r
      where r.user_id = v_user and r.pro_notified_at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  update public.requests r set pro_notified_at = now()
    where r.id = p_request_id and r.pro_id is not null and r.pro_notified_at is null
      and exists (select 1 from public.pros p where p.id = r.pro_id and p.verified and p.user_id is not null);
  if not found then return; end if;
  return query
    select u.email::text, r.category, r.location, r.port, r.urgency_score::integer
    from public.requests r
    join public.pros p on p.id = r.pro_id
    join auth.users u on u.id = p.user_id
    where r.id = p_request_id;
end $$;
revoke all on function public.claim_pro_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_pro_notification(uuid) to service_role;

create function public.release_pro_notification(p_request_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.requests set pro_notified_at = null where id = p_request_id;
$$;
revoke all on function public.release_pro_notification(uuid) from public, anon, authenticated;
grant execute on function public.release_pro_notification(uuid) to service_role;

-- Une alerte qui échoue ne doit jamais empêcher l'envoi de la demande.
create function public.queue_pro_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.pro_notified_at := null;
  if new.pro_id is not null then
    begin
      perform net.http_post(
        url := 'https://oupzgfdhssrwkpxqzdoe.supabase.co/functions/v1/notify-pro',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key',
          (select decrypted_secret from vault.decrypted_secrets where name = 'neove_notify_key')),
        body := jsonb_build_object('request_id', new.id)
      );
    exception when others then
      raise warning 'Alerte intervenant non programmée';
    end;
  end if;
  return new;
end $$;
revoke all on function public.queue_pro_notification() from public, anon, authenticated;

create trigger requests_notify_pro
  before insert on public.requests
  for each row execute function public.queue_pro_notification();
