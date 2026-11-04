// Suppression planifiée. Seul un appel portant la clé dédiée est accepté.
const encoder = new TextEncoder();
function sameKey(a, b) {
  const x = encoder.encode(a ?? ''); const y = encoder.encode(b ?? '');
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function handle(req, env, fetcher) {
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  if (!env.PURGE_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return reply(503, { error: 'not_configured' });
  if (!sameKey(req.headers.get('x-purge-key'), env.PURGE_KEY)) return reply(401, { error: 'unauthorized' });

  const base = env.SUPABASE_URL;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body = {}) => {
    const res = await fetcher(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  try {
    const paths = await rpc('expired_photo_paths', { p_limit: 500 });
    if (paths.length) {
      // La référence n'est retirée qu'après la suppression effective du fichier.
      const del = await fetcher(`${base}/storage/v1/object/request-photos`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }) });
      if (!del.ok) throw new Error(`storage: ${del.status}`);
      const list = paths.map((p) => `"${String(p).replace(/"/g, '\\"')}"`).join(',');
      const clear = await fetcher(`${base}/rest/v1/requests?photo_path=in.(${encodeURIComponent(list)})`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ photo_path: null }),
      });
      if (!clear.ok) throw new Error(`requests: ${clear.status}`);
    }
    const requests = await rpc('purge_expired_rows');
    return reply(200, { photos: paths.length, requests });
  } catch (error) {
    console.error('Suppression interrompue', error.message);
    return reply(502, { error: 'upstream' });
  }
}
