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
  await backend.sendPasswordReset('a@b.fr', 'https://app/');
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
  assert.deepEqual(row, { category: 'mecanique', symptom: 'bruit', location: 'nice', afloat: true, urgency_score: 35, price_min: 120, price_max: 600, photo_path: null, pro_id: null, contact_phone: null });
});

const jwt = `a.${btoa(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111' }))}.c`;
const signedIn = async (responses) => {
  const ctx = setup([{ status: 200, body: { email: 'p@b.fr' } }, ...responses]);
  await ctx.backend.consumeRedirect(`#access_token=${jwt}&refresh_token=R&expires_in=3600`);
  return ctx;
};
test('la fiche intervenant est cherchée pour le compte connecté', async () => {
  const { backend, calls } = await signedIn([{ status: 200, body: [{ id: 'p1', name: 'Pro', verified: true }] }]);
  assert.equal((await backend.getMyPro()).id, 'p1');
  assert.match(calls.at(-1).url, /user_id=eq\.11111111-1111-4111-8111-111111111111/);
});
test('une action d’intervenant passe par la fonction contrôlée', async () => {
  const { backend, calls } = await signedIn([{ status: 200, body: 'en_route' }]);
  assert.equal(await backend.updateProRequest('r1', 'accepter'), 'en_route');
  assert.match(calls.at(-1).url, /\/rest\/v1\/rpc\/pro_update_request$/);
  assert.deepEqual(JSON.parse(calls.at(-1).body), { p_request_id: 'r1', p_action: 'accepter' });
});
test('les fiches publiques se lisent sans jeton', async () => {
  const { backend, calls } = setup([{ status: 200, body: [] }]);
  assert.deepEqual(await backend.listPros(), []);
  assert.equal(calls[0].headers.Authorization, undefined);
});
test('une demande vers un vrai pro transmet la fiche et le téléphone', () => {
  const row = toRequestRow(triage('mecanique', 'bruit', true), 'nice', true, null, 'p1', '0600000000');
  assert.equal(row.pro_id, 'p1');
  assert.equal(row.contact_phone, '0600000000');
});
const session = { access_token: 'A', refresh_token: 'R', expires_in: 3600 };
test('l’inscription ouvre une session, ou demande de confirmer l’e-mail', async () => {
  const a = setup([{ status: 200, body: session }]);
  assert.deepEqual(await a.backend.signUp('a@b.fr', 'motdepasse'), { signedIn: true });
  assert.equal(a.backend.email, 'a@b.fr');
  const b = setup([{ status: 200, body: { id: 'u' } }]);
  assert.deepEqual(await b.backend.signUp('a@b.fr', 'motdepasse'), { confirm: true });
  assert.equal(b.backend.signedIn, false);
});
test('un compte déjà existant et un mauvais mot de passe donnent un message clair', async () => {
  const a = setup([{ status: 422, body: { error_code: 'user_already_exists' } }]);
  await assert.rejects(a.backend.signUp('a@b.fr', 'motdepasse'), /existe déjà/);
  const b = setup([{ status: 400, body: { error_code: 'invalid_credentials' } }]);
  await assert.rejects(b.backend.signIn('a@b.fr', 'x'), /incorrect/);
  assert.equal(b.backend.signedIn, false);
});
test('le mot de passe ne sert qu’à la connexion et n’est pas stocké', async () => {
  const { backend, calls, data } = setup([{ status: 200, body: session }]);
  await backend.signIn('a@b.fr', 'secret-123');
  assert.match(calls[0].url, /grant_type=password/);
  assert.ok(![...data.values()].join().includes('secret-123'));
});
test('le lien de récupération est reconnu', async () => {
  const { backend } = setup([{ status: 200, body: { email: 'a@b.fr' } }]);
  assert.deepEqual(await backend.consumeRedirect('#access_token=A1&refresh_token=R1&expires_in=3600&type=recovery'), { signedIn: true, recovery: true });
});
test('un second avis donne un message clair', async () => {
  const { backend } = setup([{ status: 200, body: session }, { status: 409, body: { code: '23505' } }]);
  await backend.signIn('a@b.fr', 'x');
  await assert.rejects(backend.submitReview('r', 5, ''), /déjà laissé/);
});
