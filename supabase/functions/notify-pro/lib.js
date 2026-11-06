// Prévient l'intervenant qu'il a une demande. L'e-mail ne contient ni le téléphone du client ni son nom.
const APP_URL = 'https://yas875.github.io/Neove/';
const TRADES = { electricite: 'Électricité', mecanique: 'Moteur', manutention: 'Manutention' };
const PLACES = { nice: 'Nice', 'saint-augustin': 'Saint-Augustin', carros: 'Carros', antibes: 'Antibes' };

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urgency = (score) => (score >= 85 ? 'Critique' : score >= 50 ? 'Urgent' : 'À planifier');

export function buildEmail({ category, location, port, urgency_score: score }) {
  const trade = TRADES[category] ?? 'Intervention';
  const place = port || PLACES[location] || 'Lieu à consulter';
  const level = urgency(score);
  return {
    subject: `Nouvelle demande Seravia : ${trade}, ${place}`,
    text: `Bonjour,\n\nVous avez reçu une nouvelle demande sur Seravia.\n\nType : ${trade}\nLieu : ${place}\nNiveau : ${level}\n\nOuvrez Seravia, puis Mon compte et Demandes reçues : ${APP_URL}\n`,
    html: `<p>Bonjour,</p><p>Vous avez reçu une nouvelle demande sur Seravia.</p><p><strong>Type :</strong> ${escapeHtml(trade)}<br><strong>Lieu :</strong> ${escapeHtml(place)}<br><strong>Niveau :</strong> ${escapeHtml(level)}</p><p><a href="${APP_URL}">Ouvrir Seravia</a>, puis Mon compte et Demandes reçues.</p>`,
  };
}

export async function handle(req, env, fetcher) {
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return reply(503, { error: 'not_configured' });
  const key = req.headers.get('x-notify-key');
  if (!key) return reply(401, { error: 'unauthorized' });

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };

  try {
    if ((await rpc('notify_key_matches', { p_key: key })) !== true) return reply(401, { error: 'unauthorized' });
    const { request_id: id } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/.test(id ?? '')) return reply(400, { error: 'invalid_request' });
    if (!env.RESEND_API_KEY) return reply(503, { error: 'email_not_configured' });

    const [row] = await rpc('claim_pro_notification', { p_request_id: id });
    if (!row) return reply(200, { sent: false });

    const res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Seravia <no-reply@seravia.fr>', to: [row.email], ...buildEmail(row) }),
    });
    if (!res.ok) {
      await rpc('release_pro_notification', { p_request_id: id }).catch(() => {});
      console.error('Alerte intervenant non envoyée', res.status);
      return reply(502, { error: 'email_failed' });
    }
    return reply(200, { sent: true });
  } catch (error) {
    console.error('Alerte intervenant interrompue', error.message);
    return reply(502, { error: 'upstream' });
  }
}
