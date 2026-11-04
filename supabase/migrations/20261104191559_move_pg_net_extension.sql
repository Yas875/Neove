-- pg_net ne doit pas être rattachée au schéma public.
drop extension if exists pg_net;
create extension pg_net schema extensions;
