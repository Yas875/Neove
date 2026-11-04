import { CATEGORIES, LOCATIONS, matchPros, triage } from './triage.js';
import { DEMO_PROS } from './demo-data.js';

const STEPS = ['Demande envoyée', 'Intervenant en route', 'Intervention en cours', 'Intervention terminée'];
const app = document.querySelector('#app');
const state = { screen: 'photo', photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0 };

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}
const go = (screen) => { state.screen = screen; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus(); };
const header = (title, back) => h('header', { class: 'top' },
  back ? h('button', { class: 'back', type: 'button', onclick: () => go(back) }, 'Retour') : h('span', { class: 'brand' }, 'Neove'),
  h('h1', { tabindex: '-1' }, title));
const choice = (label, selected, onclick) => h('button', {
  class: `choice${selected ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(selected)), onclick,
}, label);
const primary = (label, onclick, disabled) => h('button', { class: 'primary', type: 'button', onclick, disabled }, label);

function photoScreen() {
  const input = h('input', {
    id: 'photo', class: 'visually-hidden', type: 'file', accept: 'image/*', capture: 'environment',
    onchange: (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (state.photo) URL.revokeObjectURL(state.photo);
      state.photo = URL.createObjectURL(file);
      render();
    },
  });
  return [
    header('Quel est le problème à bord ?'),
    h('main', {},
      h('label', { for: 'photo', class: `shot${state.photo ? ' has-photo' : ''}` },
        state.photo ? h('img', { src: state.photo, alt: 'Photo de la panne' }) : h('span', {}, 'Photographier la panne')),
      input,
      h('p', { class: 'note' }, 'Pendant le pilote, la photo reste sur votre téléphone.'),
      primary(state.photo ? 'Continuer avec cette photo' : 'Continuer sans photo', () => go('panne'))),
  ];
}

function panneScreen() {
  const category = CATEGORIES.find((c) => c.id === state.category);
  const ready = state.symptom && state.location;
  return [
    header('Décrivez la panne', 'photo'),
    h('main', {},
      h('h2', {}, 'Type de problème'),
      h('div', { class: 'choices' }, CATEGORIES.map((c) => choice(c.label, c.id === state.category, () => {
        state.category = c.id; state.symptom = null; render();
      }))),
      category && h('h2', {}, 'Ce que vous constatez'),
      category && h('div', { class: 'choices stack' }, category.symptoms.map((s) => choice(s.label, s.id === state.symptom, () => {
        state.symptom = s.id; render();
      }))),
      h('h2', {}, 'Où est le bateau ?'),
      h('div', { class: 'choices' }, LOCATIONS.map((l) => choice(l.label, l.id === state.location, () => {
        state.location = l.id; render();
      }))),
      h('h2', {}, 'Est-il à flot ?'),
      h('div', { class: 'choices' },
        choice('À flot', state.aFlot, () => { state.aFlot = true; render(); }),
        choice('À terre', !state.aFlot, () => { state.aFlot = false; render(); })),
      primary('Voir le résultat', () => go('resultat'), !ready),
      !ready && h('p', { class: 'note' }, 'Choisissez un constat et un lieu pour continuer.')),
  ];
}

function resultScreen() {
  const r = triage(state.category, state.symptom, state.aFlot);
  return [
    h('div', { class: `flag flag-${r.level.id}` },
      h('button', { class: 'back', type: 'button', onclick: () => go('panne') }, 'Retour'),
      h('h1', { tabindex: '-1' }, r.level.label),
      h('p', {}, r.level.delay)),
    h('main', {},
      r.danger && h('div', { class: 'danger', role: 'alert' },
        h('strong', {}, 'Danger possible. '), 'Mettez-vous en sécurité. En mer, appelez le ',
        h('a', { href: 'tel:196' }, '196'), ' (secours en mer). À quai, appelez le ', h('a', { href: 'tel:112' }, '112'), '.'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Constat'), h('dd', {}, r.symptom.label),
        h('dt', {}, 'Métier conseillé'), h('dd', {}, r.category.trade),
        h('dt', {}, 'Prix estimé'), h('dd', {}, `${r.price.min} à ${r.price.max} €`)),
      h('p', { class: 'note' }, 'Estimation à partir de vos réponses : la photo n’est pas encore analysée et le prix reste indicatif.'),
      primary('Trouver un intervenant', () => go('pros'))),
  ];
}

function prosScreen() {
  const r = triage(state.category, state.symptom, state.aFlot);
  const location = LOCATIONS.find((l) => l.id === state.location);
  const pros = matchPros(DEMO_PROS, state.category, location);
  return [
    header(`${r.category.trade} près de ${location.label}`, 'resultat'),
    h('main', {},
      h('p', { class: 'demo' }, 'Intervenants fictifs : cette version sert de démonstration.'),
      h('ul', { class: 'pros' }, pros.map((p) => h('li', {},
        h('div', {}, h('strong', {}, p.name), h('span', {}, p.distance < 1 ? 'Moins de 1 km à vol d’oiseau' : `${p.distance.toFixed(1).replace('.', ',')} km à vol d’oiseau`)),
        h('button', { class: 'pick', type: 'button', onclick: () => { state.pro = p; state.step = 0; go('suivi'); } }, 'Choisir'))))),
  ];
}

function trackScreen() {
  const done = state.step === STEPS.length - 1;
  return [
    header(done ? 'Intervention terminée' : 'Suivi de votre demande'),
    h('main', {},
      h('p', { class: 'demo' }, `Simulation avec ${state.pro.name}. Aucune demande réelle n’a été envoyée.`),
      h('ol', { class: 'track' }, STEPS.map((s, i) => h('li', {
        class: i < state.step ? 'past' : i === state.step ? 'now' : '', 'aria-current': i === state.step ? 'step' : null,
      }, s))),
      done
        ? primary('Signaler une autre panne', () => {
          Object.assign(state, { photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0 });
          go('photo');
        })
        : primary('Simuler l’étape suivante', () => { state.step += 1; render(); })),
  ];
}

const screens = { photo: photoScreen, panne: panneScreen, resultat: resultScreen, pros: prosScreen, suivi: trackScreen };
function render() { app.replaceChildren(...screens[state.screen]().flat().filter(Boolean)); }
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
