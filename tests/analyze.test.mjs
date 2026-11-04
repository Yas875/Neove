import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_LIMIT, TAXONOMY, handle, parseAnalysis } from '../supabase/functions/analyze-photo/lib.js';
import { CATEGORIES, triage } from '../src/triage.js';
import { userIdFromToken } from '../src/backend.js';

const USER = '11111111-1111-4111-8111-111111111111';
const PATH = `${USER}/22222222-2222-4222-8222-222222222222.jpg`;
const env = { SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'pub', ANTHROPIC_API_KEY: 'sk' };
const tool = (input) => [{ type: 'tool_use', name: 'classer_panne', input }];
const req = (body, headers = { authorization: 'Bearer t', origin: 'https://yas875.github.io' }, method = 'POST') =>
  new Request('https://f/analyze-photo', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });

function backend({ count = 0, ai, user = USER, userOk = true, photoOk = true } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: user }), { status: userOk ? 200 : 401 });
    if (url.includes('photo_analyses?')) return new Response(JSON.stringify(Array(count).fill({ id: 1 })));
    if (url.includes('/storage/')) return photoOk ? new Response(new Uint8Array([1, 2, 3])) : new Response('', { status: 404 });
    if (url.endsWith('/photo_analyses')) return new Response('', { status: 201 });
    return new Response(JSON.stringify({ content: ai ?? tool({ recognized: true, category: 'mecanique', symptom: 'bruit', danger_possible: false, observation: 'Moteur' }) }));
  };
  return { calls, fetcher };
}
const aiCalled = (calls) => calls.some((c) => c.url.includes('anthropic'));

test('les catégories du serveur et de l’app sont identiques', () => {
  assert.deepEqual(TAXONOMY, Object.fromEntries(CATEGORIES.map((c) => [c.id, c.symptoms.map((s) => s.id)])));
});
test('une analyse valide est renvoyée et utilisable par le tri', async () => {
  const { fetcher, calls } = backend();
  const res = await handle(req({ path: PATH }), env, fetcher);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(triage(body.category, body.symptom).symptom.id, 'bruit');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://yas875.github.io');
  const ai = JSON.parse(calls.find((c) => c.url.includes('anthropic')).body);
  assert.equal(ai.messages[0].content[0].source.data, 'AQID');
  assert.equal(ai.tool_choice.name, 'classer_panne');
});
test('une réponse hors liste n’est jamais reprise', () => {
  const r = parseAnalysis(tool({ recognized: true, category: 'mecanique', symptom: 'fumee', danger_possible: 'oui', observation: 'x' }));
  assert.deepEqual([r.recognized, r.category, r.symptom, r.danger_possible], [false, null, null, false]);
});
test('un danger reste signalé même sans classement', () => {
  assert.equal(parseAnalysis(tool({ recognized: false, danger_possible: true, observation: 'Fumée' })).danger_possible, true);
});
test('sans jeton, le modèle n’est pas appelé', async () => {
  const { fetcher, calls } = backend();
  assert.equal((await handle(req({ path: PATH }, {}), env, fetcher)).status, 401);
  assert.equal(calls.length, 0);
});
test('la photo d’un autre utilisateur est refusée', async () => {
  const { fetcher, calls } = backend({ user: '33333333-3333-4333-8333-333333333333' });
  assert.equal((await handle(req({ path: PATH }), env, fetcher)).status, 403);
  assert.equal(aiCalled(calls), false);
});
test('un chemin détourné est refusé', async () => {
  const { fetcher } = backend();
  assert.equal((await handle(req({ path: `${USER}/../autre.jpg` }), env, fetcher)).status, 403);
});
test('la limite quotidienne bloque avant l’appel au modèle', async () => {
  const { fetcher, calls } = backend({ count: DAILY_LIMIT });
  assert.equal((await handle(req({ path: PATH }), env, fetcher)).status, 429);
  assert.equal(aiCalled(calls), false);
});
test('sans clé configurée, la réponse reste propre', async () => {
  const { fetcher } = backend();
  assert.equal((await handle(req({ path: PATH }), { ...env, ANTHROPIC_API_KEY: '' }, fetcher)).status, 503);
});
test('une origine inconnue ne reçoit pas d’autorisation CORS', async () => {
  const res = await handle(req(null, { origin: 'https://exemple.test' }, 'OPTIONS'), env, async () => {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
test('l’identifiant utilisateur est lu dans le jeton', () => {
  assert.equal(userIdFromToken(`a.${btoa(JSON.stringify({ sub: USER }))}.c`), USER);
});
