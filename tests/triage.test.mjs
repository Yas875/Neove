import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, LOCATIONS, distanceKm, matchPros, triage, urgencyLevel } from '../src/triage.js';
import { DEMO_PROS } from '../src/demo-data.js';

const at = (id) => LOCATIONS.find((l) => l.id === id);

test('une voie d’eau est critique et signale un danger', () => {
  const r = triage('mecanique', 'voie-eau');
  assert.equal(r.level.id, 'critique');
  assert.equal(r.danger, true);
  assert.equal(r.score, 100);
});
test('le score ne dépasse jamais 100 et reste valide pour chaque panne', () => {
  for (const c of CATEGORIES) for (const s of c.symptoms) for (const f of [true, false]) {
    const r = triage(c.id, s.id, f);
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(r.price.min < r.price.max);
  }
});
test('être à flot aggrave une panne moteur, pas la manutention', () => {
  assert.ok(triage('mecanique', 'bruit', true).score > triage('mecanique', 'bruit', false).score);
  assert.equal(triage('manutention', 'transport', true).score, triage('manutention', 'transport', false).score);
});
test('les seuils d’urgence', () => {
  assert.equal(urgencyLevel(85).id, 'critique');
  assert.equal(urgencyLevel(84).id, 'haute');
  assert.equal(urgencyLevel(50).id, 'haute');
  assert.equal(urgencyLevel(49).id, 'normale');
});
test('une panne inconnue est refusée', () => assert.throws(() => triage('mecanique', 'nope')));
test('la distance Nice-Antibes est plausible', () => {
  const d = distanceKm(at('nice'), at('antibes'));
  assert.ok(d > 15 && d < 22, String(d));
});
test('le matching exclut les non-vérifiés et trie par distance', () => {
  const m = matchPros(DEMO_PROS, 'electricite', at('antibes'));
  assert.deepEqual(m.map((p) => p.id), ['e1', 'e2']);
  assert.ok(m[0].distance <= m[1].distance);
});
test('chaque métier a au moins un pro vérifié', () => {
  for (const c of CATEGORIES) assert.ok(matchPros(DEMO_PROS, c.id, at('nice')).length > 0);
});
