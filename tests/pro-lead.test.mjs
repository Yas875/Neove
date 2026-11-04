import test from 'node:test';
import assert from 'node:assert/strict';
import { sendLead } from '../src/pro-lead.js';

const values = { company: ' Atelier ', contact_name: 'Jean', trade: 'mecanique', city: 'Nice', phone: '0600000000', email: 'a@b.fr', message: ' ', website: '' };
const options = (status = 201) => { const calls = []; return { calls, opts: { url: 'https://x', key: 'pub', fetcher: async (u, i) => { calls.push({ u, ...i }); return { ok: status < 400, status }; } } }; };

test('le formulaire envoie seulement les champs prévus, nettoyés', async () => {
  const { calls, opts } = options();
  await sendLead(values, opts);
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['city', 'company', 'contact_name', 'email', 'message', 'phone', 'trade']);
  assert.equal(body.company, 'Atelier');
  assert.equal(body.message, null);
  assert.equal(calls[0].headers.Prefer, 'return=minimal');
  assert.equal(calls[0].headers.Authorization, undefined);
});
test('un robot qui remplit le champ caché n’envoie rien', async () => {
  const { calls, opts } = options();
  assert.equal((await sendLead({ ...values, website: 'spam' }, opts)).sent, true);
  assert.equal(calls.length, 0);
});
test('un refus du serveur est remonté', async () => {
  const { opts } = options(400);
  await assert.rejects(sendLead(values, opts));
});
