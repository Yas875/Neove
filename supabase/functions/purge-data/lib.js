// Suppression planifiée. La clé dédiée reste dans le coffre de la base et y est comparée.
export async function handle(req, env, fetcher) {
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return reply(503, { error: 'not_configured' });
  const key = req.headers.get('x-purge-key');
  if (!key) return reply(401, { error: 'unauthorized' });

  const base = env.SUPABASE_URL;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body = {}) => {
    const res = await fetcher(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  try {
    if ((await rpc('purge_key_matches', { p_key: key })) !== true) return reply(401, { error: 'unauthorized' });
    const paths = await rpc('expired_photo_paths', { p_limit: 500 });
    if (paths.length) {
      // La référence n'est retirée qu'après la suppression effective du fichier.
      const del = await fetcher(`${base}/storage/v1/object/request-photos`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }) });
      if (!del.ok) throw new Error(`storage: ${del.status}`);
      const list = paths.map((p) => `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
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
