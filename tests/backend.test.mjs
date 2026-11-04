import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend, toRequestRow } from '../src/backend.js';
import { triage } from '../src/triage.js';

function setup(responses, startNow = 1_000_000) {
  const data = new Map(); const calls = []; let now = startNow;
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const fetcher = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses.shift();
    if (r === 'offline') throw new TypeError('offline');
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body ?? null) };
  };
  const backend = createBackend({ url: 'https://x', key: 'pub', fetch: fetcher, storage, now: () => now });
  return { backend, calls, advance: (ms) => { now += ms; }, data };
}
const login = '#access_token=A1&refresh_token=R1&expires_in=3600';

test('la clé publique n’est jamais envoyée comme jeton', async () => {
  const { backend, calls } = setup([{ status: 200, body: {} }]);
  await backend.sendLoginLink('a@b.fr', 'https://app/');
  assert.equal(calls[0].headers.apikey, 'pub');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.match(calls[0].url, /redirect_to=https%3A%2F%2Fapp%2F/);
});
test('le retour du lien crée une session après contrôle serveur', async () => {
  const { backend, calls } = setup([{ status: 200, body: { email: 'a@b.fr' } }]);
  assert.deepEqual(await backend.consumeRedirect(login), { signedIn: true });
  assert.equal(calls[0].headers.Authorization, 'Bearer A1');
  assert.equal(backend.email, 'a@b.fr');
});
test('un jeton refusé ne crée pas de session', async () => {
  const { backend } = setup([{ status: 401 }]);
  await assert.rejects(backend.consumeRedirect(login));
  assert.equal(backend.signedIn, false);
});
test('un lien expiré donne un message clair', async () => {
  const { backend } = setup([]);
  const r = await backend.consumeRedirect('#error=access_denied&error_code=otp_expired');
  assert.match(r.error, /expiré/);
});
test('le jeton expiré est renouvelé avant la demande', async () => {
  const { backend, calls, advance } = setup([
    { status: 200, body: { email: 'a@b.fr' } },
    { status: 200, body: { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 } },
    { status: 201, body: [{ id: '1' }] },
  ]);
  await backend.consumeRedirect(login);
  advance(3600 * 1000);
  assert.deepEqual(await backend.createRequest({ a: 1 }), { id: '1' });
  assert.match(calls[1].url, /grant_type=refresh_token/);
  assert.equal(calls[2].headers.Authorization, 'Bearer A2');
});
test('un renouvellement refusé déconnecte, une panne réseau non', async () => {
  const a = setup([{ status: 200, body: { email: 'a' } }, { status: 400 }]);
  await a.backend.consumeRedirect(login); a.advance(3600 * 1000);
  await assert.rejects(a.backend.listRequests());
  assert.equal(a.backend.signedIn, false);
  const b = setup([{ status: 200, body: { email: 'a' } }, 'offline']);
  await b.backend.consumeRedirect(login); b.advance(3600 * 1000);
  await assert.rejects(b.backend.listRequests(), /réseau/);
  assert.equal(b.backend.signedIn, true);
});
test('sans session, aucune demande ne part', async () => {
  const { backend, calls } = setup([]);
  await assert.rejects(backend.createRequest({}), /Connectez-vous/);
  assert.equal(calls.length, 0);
});
test('la ligne envoyée n’impose ni utilisateur ni statut', () => {
  const row = toRequestRow(triage('mecanique', 'bruit', true), 'nice', true);
  assert.deepEqual(row, { category: 'mecanique', symptom: 'bruit', location: 'nice', afloat: true, urgency_score: 35, price_min: 120, price_max: 600 });
});
