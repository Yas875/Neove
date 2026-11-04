-- Schéma du pilote Azurio.
create type public.request_status as enum ('envoyee', 'en_route', 'en_cours', 'terminee', 'annulee');

create table public.pros (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('electricite', 'mecanique', 'manutention')),
  lat double precision not null,
  lng double precision not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pro_id uuid references public.pros (id) on delete set null,
  category text not null check (category in ('electricite', 'mecanique', 'manutention')),
  symptom text not null,
  location text not null,
  afloat boolean not null,
  urgency_score smallint not null check (urgency_score between 0 and 100),
  price_min integer not null check (price_min >= 0),
  price_max integer not null,
  photo_path text,
  status public.request_status not null default 'envoyee',
  created_at timestamptz not null default now(),
  check (price_max >= price_min)
);
create index requests_user_id_idx on public.requests (user_id);
create index requests_pro_id_idx on public.requests (pro_id);

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  status public.request_status not null,
  created_at timestamptz not null default now()
);
create index request_events_request_id_idx on public.request_events (request_id);

alter table public.pros enable row level security;
alter table public.requests enable row level security;
alter table public.request_events enable row level security;

-- Les utilisateurs connectés ne voient que les pros vérifiés.
create policy "pros vérifiés visibles" on public.pros
  for select to authenticated using (verified);

-- Chacun ne voit et ne crée que ses propres demandes. Le statut reste géré côté serveur.
create policy "lire ses demandes" on public.requests
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "créer ses demandes" on public.requests
  for insert to authenticated with check (
    (select auth.uid()) = user_id and status = 'envoyee'
  );
create policy "lire le suivi de ses demandes" on public.request_events
  for select to authenticated using (exists (
    select 1 from public.requests r where r.id = request_id and r.user_id = (select auth.uid())
  ));
