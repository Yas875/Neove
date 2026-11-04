-- Contacts laissés par les professionnels. Envoi public, lecture réservée à l'administrateur.
create table public.pro_leads (
  id bigint generated always as identity primary key,
  company text not null check (char_length(company) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  trade text not null check (trade in ('electricite', 'mecanique', 'manutention', 'autre')),
  city text not null check (char_length(city) between 2 and 80),
  phone text not null check (char_length(phone) between 6 and 30),
  email text not null check (char_length(email) between 5 and 160 and email like '%_@_%'),
  message text check (message is null or char_length(message) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.pro_leads enable row level security;
revoke all on public.pro_leads from anon, authenticated;
grant insert (company, contact_name, trade, city, phone, email, message) on public.pro_leads to anon, authenticated;
create policy "laisser ses coordonnées" on public.pro_leads
  for insert to anon, authenticated with check (true);

-- Durée provisoire, à faire valider : contacts conservés 1 an.
create or replace function public.purge_expired_rows()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_requests integer;
begin
  delete from public.requests
    where created_at < now() - interval '1 year' and status not in ('en_route', 'en_cours');
  get diagnostics v_requests = row_count;
  delete from public.photo_analyses where created_at < now() - interval '30 days';
  delete from public.pro_leads where created_at < now() - interval '1 year';
  return v_requests;
end $$;
revoke all on function public.purge_expired_rows() from public, anon, authenticated;
grant execute on function public.purge_expired_rows() to service_role;
