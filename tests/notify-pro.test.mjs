import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, buildEmail } from '../supabase/functions/notify-pro/lib.js';

const ID = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'srv', RESEND_API_KEY: 're' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const req = (key, body = { request_id: ID }) => new Request('https://f/n', { method: 'POST', headers: key ? { 'x-notify-key': key } : {}, body: JSON.stringify(body) });
const ROW = { email: 'pro@b.fr', category: 'mecanique', location: 'antibes', port: 'Port Vauban', urgency_score: 90 };

function backend({ row = ROW, sendOk = true } = {}) {
  const calls = [];
  return { calls, fetcher: async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.includes('notify_key_matches')) return json(JSON.parse(init.body).p_key === 'secret');
    if (url.includes('claim_pro_notification')) return json(row ? [row] : []);
    if (url.includes('release_pro_notification')) return new Response(null, { status: 204 });
    if (url.includes('api.resend.com')) return sendOk ? json({ id: 'e' }) : json({}, 500);
    return json({}, 404);
  } };
}
test('une clé absente ou fausse n’envoie rien', async () => {
  for (const key of [undefined, 'faux']) {
    const { calls, fetcher } = backend();
    assert.equal((await handle(req(key), env, fetcher)).status, 401);
    assert.ok(!calls.some((c) => c.url.includes('resend') || c.url.includes('claim')));
  }
});
test('la demande part à l’adresse de l’intervenant, sans données du client', async () => {
  const { calls, fetcher } = backend();
  assert.equal((await handle(req('secret'), env, fetcher)).status, 200);
  const sent = JSON.parse(calls.find((c) => c.url.includes('resend')).body);
  assert.deepEqual(sent.to, ['pro@b.fr']);
  assert.equal(sent.from, 'Seravia <no-reply@seravia.fr>');
  assert.match(sent.subject, /Moteur, Port Vauban/);
  assert.match(sent.text, /Critique/);
  assert.equal(JSON.parse(calls.find((c) => c.url.includes('claim')).body).p_request_id, ID);
});
test('sans réservation, aucun e-mail ne part', async () => {
  const { calls, fetcher } = backend({ row: null });
  const res = await handle(req('secret'), env, fetcher);
  assert.deepEqual(await res.json(), { sent: false });
  assert.ok(!calls.some((c) => c.url.includes('resend')));
});
test('un envoi raté libère la réservation', async () => {
  const { calls, fetcher } = backend({ sendOk: false });
  assert.equal((await handle(req('secret'), env, fetcher)).status, 502);
  assert.ok(calls.some((c) => c.url.includes('release_pro_notification')));
});
test('sans clé Resend, rien n’est réservé', async () => {
  const { calls, fetcher } = backend();
  assert.equal((await handle(req('secret'), { ...env, RESEND_API_KEY: undefined }, fetcher)).status, 503);
  assert.ok(!calls.some((c) => c.url.includes('claim')));
});
test('un identifiant invalide est refusé', async () => {
  const { fetcher } = backend();
  assert.equal((await handle(req('secret', { request_id: "x' or 1=1" }), env, fetcher)).status, 400);
});
test('le contenu inconnu est échappé', () => {
  assert.ok(!buildEmail({ category: 'x', location: 'x', port: '<b>Port</b>', urgency_score: 10 }).html.includes('<b>Port'));
});
