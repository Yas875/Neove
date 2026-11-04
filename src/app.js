import { CATEGORIES, LOCATIONS, matchPros, triage } from './triage.js';
import { DEMO_PROS } from './demo-data.js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { createBackend, toRequestRow } from './backend.js';

const STEPS = ['Demande enregistrée', 'Intervenant en route', 'Intervention en cours', 'Intervention terminée'];
const app = document.querySelector('#app');
const DRAFT_KEY = 'azurio.brouillon';
const state = {
  screen: 'photo', photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0,
  saving: false, saveError: null, loginEmail: null, loginError: null, sending: false, requests: null, listError: null,
};

function safeStorage() {
  try { return window.localStorage; } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
const storage = safeStorage();
const backend = createBackend({ url: SUPABASE_URL, key: SUPABASE_KEY, fetch: (...a) => window.fetch(...a), storage });

function saveDraft() {
  const { category, symptom, location: place, aFlot, pro } = state;
  try { storage.setItem(DRAFT_KEY, JSON.stringify({ category, symptom, location: place, aFlot, proId: pro.id })); } catch { /* facultatif */ }
}
function clearDraft() { try { storage.removeItem(DRAFT_KEY); } catch { /* rien à effacer */ } }
function restoreDraft() {
  try {
    const d = JSON.parse(storage.getItem(DRAFT_KEY));
    if (!d) return false;
    triage(d.category, d.symptom, d.aFlot);
    const pro = DEMO_PROS.find((p) => p.id === d.proId && p.verified && p.category === d.category);
    if (!pro || !LOCATIONS.some((l) => l.id === d.location)) throw new Error('Brouillon invalide');
    Object.assign(state, { category: d.category, symptom: d.symptom, location: d.location, aFlot: Boolean(d.aFlot), pro });
    return true;
  } catch { clearDraft(); return false; }
}

async function submitRequest() {
  if (state.saving) return;
  state.saving = true; state.saveError = null; state.step = 0;
  go('envoi');
  try {
    const result = triage(state.category, state.symptom, state.aFlot);
    await backend.createRequest(toRequestRow(result, state.location, state.aFlot));
    clearDraft();
    state.saving = false;
    go('suivi');
  } catch (error) {
    state.saving = false;
    if (!backend.signedIn) { state.loginError = error.message; go('connexion'); return; }
    state.saveError = error.message;
    go('envoi');
  }
}

function resetFlow() {
  Object.assign(state, { photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0, saveError: null });
}

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
const go = (screen) => { if (screen === 'connexion-retour') { state.loginEmail = null; screen = 'connexion'; } state.screen = screen; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus(); };
const header = (title, back) => h('header', { class: 'top' },
  back ? h('button', { class: 'back', type: 'button', onclick: () => go(back) }, 'Retour') : h('span', { class: 'brand' }, 'Azurio'),
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
      primary(state.photo ? 'Continuer avec cette photo' : 'Continuer sans photo', () => go('panne')),
      backend.signedIn && h('button', { class: 'link', type: 'button', onclick: openRequests }, 'Voir mes demandes')),
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
        h('button', { class: 'pick', type: 'button', onclick: () => {
          state.pro = p; saveDraft();
          if (backend.signedIn) submitRequest(); else { state.loginEmail = null; state.loginError = null; go('connexion'); }
        } }, 'Choisir'))))),
  ];
}

function trackScreen() {
  const done = state.step === STEPS.length - 1;
  return [
    header(done ? 'Intervention terminée' : 'Suivi de votre demande'),
    h('main', {},
      h('p', { class: 'demo' }, `Votre demande est enregistrée, mais aucun intervenant n’est prévenu pendant le pilote. Ce suivi avec ${state.pro.name} est une simulation.`),
      h('ol', { class: 'track' }, STEPS.map((s, i) => h('li', {
        class: i < state.step ? 'past' : i === state.step ? 'now' : '', 'aria-current': i === state.step ? 'step' : null,
      }, s))),
      done
        ? primary('Signaler une autre panne', () => { resetFlow(); go('photo'); })
        : primary('Simuler l’étape suivante', () => { state.step += 1; render(); })),
  ];
}

function loginScreen() {
  if (state.loginEmail) {
    return [
      header('Consultez vos e-mails', 'connexion-retour'),
      h('main', {},
        h('p', { class: 'lead' }, `Un lien de connexion a été envoyé à ${state.loginEmail}. Ouvrez-le sur cet appareil et dans ce navigateur pour retrouver votre demande.`),
        h('p', { class: 'note' }, 'Rien reçu ? Vérifiez vos courriers indésirables.')),
    ];
  }
  const input = h('input', { id: 'email', type: 'email', name: 'email', autocomplete: 'email', required: true, value: '' });
  return [
    header('Connectez-vous pour enregistrer la demande', 'pros'),
    h('main', {},
      state.loginError && h('p', { class: 'error', role: 'alert' }, state.loginError),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (state.sending) return;
          const email = input.value.trim();
          state.sending = true; state.loginError = null; render();
          try {
            await backend.sendLoginLink(email, location.origin + location.pathname);
            state.loginEmail = email;
          } catch (error) { state.loginError = error.message; }
          state.sending = false; render();
        },
      },
      h('label', { class: 'field', for: 'email' }, 'Adresse e-mail'), input,
      h('button', { class: 'primary', type: 'submit', disabled: state.sending }, state.sending ? 'Envoi en cours' : 'Recevoir le lien de connexion')),
      h('p', { class: 'note' }, 'Vous recevrez un lien par e-mail : aucun mot de passe à créer.')),
  ];
}

function sendingScreen() {
  if (!state.saveError) return [header('Enregistrement de la demande'), h('main', {}, h('p', { class: 'lead', role: 'status' }, 'Un instant.'))];
  return [
    header('La demande n’est pas enregistrée', 'pros'),
    h('main', {},
      h('p', { class: 'error', role: 'alert' }, state.saveError),
      primary('Réessayer', submitRequest)),
  ];
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const STATUS_LABELS = { envoyee: 'Enregistrée', en_route: 'Intervenant en route', en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée' };

async function openRequests() {
  state.requests = null; state.listError = null;
  go('demandes');
  try { state.requests = await backend.listRequests(); } catch (error) { state.listError = error.message; }
  if (!backend.signedIn) { state.loginError = state.listError; state.loginEmail = null; go('connexion'); return; }
  render();
}

function requestsScreen() {
  const describe = (r) => {
    const category = CATEGORIES.find((c) => c.id === r.category);
    return {
      symptom: category?.symptoms.find((s) => s.id === r.symptom)?.label ?? r.symptom,
      place: LOCATIONS.find((l) => l.id === r.location)?.label ?? r.location,
    };
  };
  return [
    header('Mes demandes', 'photo'),
    h('main', {},
      state.listError && h('p', { class: 'error', role: 'alert' }, state.listError),
      !state.requests && !state.listError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      state.requests?.length === 0 && h('p', { class: 'lead' }, 'Aucune demande pour l’instant. Photographiez une panne pour commencer.'),
      state.requests?.length > 0 && h('ul', { class: 'pros' }, state.requests.map((r) => {
        const d = describe(r);
        return h('li', {}, h('div', {},
          h('strong', {}, d.symptom),
          h('span', {}, `${d.place}, ${dateFormat.format(new Date(r.created_at))}`),
          h('span', {}, `${STATUS_LABELS[r.status] ?? r.status}, ${r.price_min} à ${r.price_max} €`)));
      })),
      h('p', { class: 'note' }, `Connecté avec ${backend.email}`),
      h('button', { class: 'link', type: 'button', onclick: async () => { await backend.signOut(); resetFlow(); go('photo'); } }, 'Se déconnecter')),
  ];
}

const screens = {
  photo: photoScreen, panne: panneScreen, resultat: resultScreen, pros: prosScreen, suivi: trackScreen,
  connexion: loginScreen, envoi: sendingScreen, demandes: requestsScreen,
};
function render() { app.replaceChildren(...screens[state.screen]().flat().filter(Boolean)); }

async function start() {
  if (location.hash.length > 1) {
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    let outcome;
    try { outcome = await backend.consumeRedirect(hash); } catch (error) { outcome = { error: error.message }; }
    if (outcome.signedIn && restoreDraft()) { submitRequest(); return; }
    if (outcome.error) {
      state.loginError = outcome.error;
      if (restoreDraft()) { go('connexion'); return; }
      state.screen = 'connexion';
    }
  }
  render();
}
start();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
