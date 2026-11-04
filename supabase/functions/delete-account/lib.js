// Supprime les photos puis le compte de la personne connectée. Ses demandes suivent par cascade.
const ALLOWED_ORIGINS = ['https://yas875.github.io', 'http://localhost:4173'];

function corsHeaders(req) {
  const origin = req.headers.get('origin');
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export async function handle(req, env, fetcher) {
  const cors = corsHeaders(req);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  const authorization = req.headers.get('authorization');
  if (!authorization) return reply(401, { error: 'unauthorized' });
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(503, { error: 'not_configured' });

  const base = env.SUPABASE_URL;
  // L'identité vient du jeton vérifié par le serveur, jamais d'une valeur envoyée par l'app.
  const userRes = await fetcher(`${base}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization } });
  if (!userRes.ok) return reply(401, { error: 'unauthorized' });
  const { id } = await userRes.json();
  if (!/^[0-9a-f-]{36}$/.test(id ?? '')) return reply(401, { error: 'unauthorized' });

  const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const fail = (step, status) => { console.error('Suppression du compte interrompue', step, status); return reply(502, { error: 'upstream' }); };

  // Une fiche sans compte ne doit plus être proposée aux plaisanciers.
  const pro = await fetcher(`${base}/rest/v1/pros?user_id=eq.${id}`, { method: 'PATCH', headers: { ...admin, Prefer: 'return=minimal' }, body: JSON.stringify({ verified: false }) });
  if (!pro.ok) return fail('pros', pro.status);

  for (let i = 0; i < 100; i += 1) {
    const list = await fetcher(`${base}/storage/v1/object/list/request-photos`, { method: 'POST', headers: admin, body: JSON.stringify({ prefix: `${id}/`, limit: 100, offset: 0 }) });
    if (!list.ok) return fail('list', list.status);
    const files = await list.json();
    if (!files.length) break;
    const del = await fetcher(`${base}/storage/v1/object/request-photos`, { method: 'DELETE', headers: admin, body: JSON.stringify({ prefixes: files.map((f) => `${id}/${f.name}`) }) });
    if (!del.ok) return fail('delete', del.status);
  }

  const remove = await fetcher(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
  if (!remove.ok) return fail('user', remove.status);
  return reply(200, { deleted: true });
}
