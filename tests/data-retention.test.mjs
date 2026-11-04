import test from 'node:test';
import assert from 'node:assert/strict';
import { handle as purge } from '../supabase/functions/purge-data/lib.js';
import { handle as removeAccount } from '../supabase/functions/delete-account/lib.js';

const USER = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'pub', SUPABASE_SERVICE_ROLE_KEY: 'srv', PURGE_KEY: 'secret' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const purgeReq = (key) => new Request('https://f/purge', { method: 'POST', headers: key ? { 'x-purge-key': key } : {} });

function purgeBackend({ paths = [], storageOk = true } = {}) {
  const calls = [];
  return { calls, fetcher: async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.includes('expired_photo_paths')) return json(paths);
    if (url.includes('/storage/')) return storageOk ? json([]) : json({}, 500);
    if (url.includes('/rest/v1/requests')) return json(null, 200);
    return json(2);
  } };
}
test('la suppression planifiée refuse une clé absente ou fausse', async () => {
  for (const key of [undefined, 'faux', 'secreT']) {
    const { calls, fetcher } = purgeBackend();
    assert.equal((await purge(purgeReq(key), env, fetcher)).status, 401);
    assert.equal(calls.length, 0);
  }
});
test('la clé vide ne déverrouille jamais la fonction', async () => {
  const { fetcher } = purgeBackend();
  assert.equal((await purge(purgeReq(), { ...env, PURGE_KEY: '' }, fetcher)).status, 503);
});
test('les photos sont supprimées avant de retirer leur référence', async () => {
  const { calls, fetcher } = purgeBackend({ paths: [`${USER}/a.jpg`] });
  const res = await purge(purgeReq('secret'), env, fetcher);
  assert.deepEqual(await res.json(), { photos: 1, requests: 2 });
  const order = calls.map((c) => (c.url.includes('/storage/') ? 'files' : c.url.includes('/rest/v1/requests') ? 'ref' : 'rpc'));
  assert.deepEqual(order, ['rpc', 'files', 'ref', 'rpc']);
  assert.ok(decodeURIComponent(calls[2].url).includes(`"${USER}/a.jpg"`));
});
test('un échec de stockage laisse les références en place', async () => {
  const { calls, fetcher } = purgeBackend({ paths: ['a'], storageOk: false });
  assert.equal((await purge(purgeReq('secret'), env, fetcher)).status, 502);
  assert.equal(calls.some((c) => c.url.includes('/rest/v1/requests')), false);
});

const accReq = (auth = 'Bearer t') => new Request('https://f/delete', { method: 'POST', headers: { authorization: auth, origin: 'https://yas875.github.io' }, body: JSON.stringify({ id: 'autre' }) });
function accountBackend({ userOk = true, removeOk = true, pages = [[{ name: 'a.jpg' }], []] } = {}) {
  const calls = []; const left = [...pages];
  return { calls, fetcher: async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.endsWith('/auth/v1/user')) return userOk ? json({ id: USER }) : json({}, 401);
    if (url.includes('/object/list/')) return json(left.shift() ?? []);
    if (url.includes('/admin/users/')) return removeOk ? json({}) : json({}, 500);
    return json([]);
  } };
}
test('un jeton refusé ne supprime rien', async () => {
  const { calls, fetcher } = accountBackend({ userOk: false });
  assert.equal((await removeAccount(accReq(), env, fetcher)).status, 401);
  assert.equal(calls.length, 1);
});
test('le compte supprimé est celui du jeton, pas celui envoyé par l’app', async () => {
  const { calls, fetcher } = accountBackend();
  assert.equal((await removeAccount(accReq(), env, fetcher)).status, 200);
  assert.ok(calls.at(-1).url.endsWith(`/auth/v1/admin/users/${USER}`));
  const del = calls.find((c) => c.method === 'DELETE' && c.url.includes('/object/request-photos'));
  assert.deepEqual(JSON.parse(del.body).prefixes, [`${USER}/a.jpg`]);
  const proPatch = calls.find((c) => c.url.includes('/rest/v1/pros'));
  assert.deepEqual(JSON.parse(proPatch.body), { verified: false });
});
test('sans jeton, aucune requête ne part', async () => {
  const { calls, fetcher } = accountBackend();
  const req = new Request('https://f/delete', { method: 'POST' });
  assert.equal((await removeAccount(req, env, fetcher)).status, 401);
  assert.equal(calls.length, 0);
});
test('une erreur finale est signalée', async () => {
  const { fetcher } = accountBackend({ removeOk: false });
  assert.equal((await removeAccount(accReq(), env, fetcher)).status, 502);
});
