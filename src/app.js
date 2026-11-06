import { CATEGORIES, LOCATIONS, matchPros, triage, urgencyLevel } from './triage.js';
import { DEMO_PROS } from './demo-data.js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { createBackend, toRequestRow } from './backend.js';
import { compressPhoto, takePendingPhoto } from './pending-photo.js';

const STEPS = ['Demande enregistrée', 'Intervenant en route', 'Intervention en cours', 'Intervention terminée'];
const app = document.querySelector('#app');
const DRAFT_KEY = 'neove.brouillon';
const state = {
  screen: 'photo', photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0,
  saving: false, saveError: null, loginError: null, sending: false, requests: null, listError: null,
  deleting: false, deleteError: null, accountDeleted: false, realPros: null, phone: '', myPro: null, proRequests: null, proError: null, proCurrent: null, proPhoto: null, proBusy: false,
  photoBlob: null, photoPath: null, photoError: null, suggestion: null, analysisError: null, loginBack: 'photo', loginTitle: '', afterLogin: null,
  form: {}, formError: null, formInfo: null, busy: false, profile: null, signupKind: 'client', notice: null,
  isAdmin: false, adminPros: null, adminReviews: null, reviewed: [], reviewTarget: null, proReviews: null, proView: null, ratings: [],
};

function safeStorage() {
  try { return window.localStorage; } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
const storage = safeStorage();
const backend = createBackend({ url: SUPABASE_URL, key: SUPABASE_KEY, fetch: (...a) => window.fetch(...a), storage });

function saveDraft() {
  const { category, symptom, location: place, port, aFlot, pro, photoPath, phone } = state;
  try { storage.setItem(DRAFT_KEY, JSON.stringify({ category, symptom, location: place, port, aFlot, pro, photoPath, phone })); } catch { /* facultatif */ }
}
function clearDraft() { try { storage.removeItem(DRAFT_KEY); } catch { /* rien à effacer */ } }
function restoreDraft() {
  try {
    const d = JSON.parse(storage.getItem(DRAFT_KEY));
    if (!d) return false;
    triage(d.category, d.symptom, d.aFlot);
    const pro = d.pro;
    if (!pro?.id || !pro.name || pro.category !== d.category || !LOCATIONS.some((l) => l.id === d.location)) throw new Error('Brouillon invalide');
    Object.assign(state, { category: d.category, symptom: d.symptom, location: d.location, port: typeof d.port === 'string' ? d.port : null, aFlot: Boolean(d.aFlot), pro, photoPath: typeof d.photoPath === 'string' ? d.photoPath : null, phone: typeof d.phone === 'string' ? d.phone : '' });
    return true;
  } catch { clearDraft(); return false; }
}

async function submitRequest() {
  if (state.saving) return;
  state.saving = true; state.saveError = null; state.step = 0;
  go('envoi');
  try {
    const result = triage(state.category, state.symptom, state.aFlot);
    await backend.createRequest(toRequestRow(result, state.location, state.aFlot, state.photoPath, state.pro.real ? state.pro.id : null, state.pro.real ? state.phone : null, state.port));
    clearDraft();
    state.saving = false;
    go(state.pro.real ? 'envoyee' : 'suivi');
  } catch (error) {
    state.saving = false;
    if (!backend.signedIn) { state.loginError = error.message; state.afterLogin = 'submit'; go('connexion'); return; }
    state.saveError = error.message;
    go('envoi');
  }
}

function resetFlow() {
  if (state.photo) URL.revokeObjectURL(state.photo);
  Object.assign(state, {
    photo: null, photoBlob: null, photoPath: null, photoError: null, suggestion: null, analysisError: null,
    category: null, symptom: null, location: null, port: null, aFlot: true, pro: null, step: 0, saveError: null, phone: '',
  });
}

async function startAnalysis() {
  if (backend.signedIn) { runAnalysis(); return; }
  clearDraft();
  Object.assign(state, { loginError: null, afterLogin: 'analyse', loginBack: 'photo', loginTitle: 'Connectez-vous pour analyser la photo' });
  go('connexion');
}

async function runAnalysis() {
  state.analysisError = null;
  go('analyse');
  try {
    state.photoPath ??= await backend.uploadPhoto(state.photoBlob);
    const analysis = await backend.analyzePhoto(state.photoPath);
    state.suggestion = analysis;
    if (analysis.recognized) { state.category = analysis.category; state.symptom = analysis.symptom; }
    go('panne');
  } catch (error) {
    if (!backend.signedIn) {
      Object.assign(state, { loginError: error.message, afterLogin: 'analyse', loginBack: 'photo', loginTitle: 'Connectez-vous pour analyser la photo' });
      go('connexion');
      return;
    }
    state.analysisError = error.message;
    go('analyse');
  }
}

function analysisScreen() {
  if (!state.analysisError) return [header('Analyse de la photo'), h('main', {}, h('p', { class: 'lead', role: 'status' }, 'Envoi et analyse en cours.'))];
  return [
    header('La photo n’a pas été analysée', 'photo'),
    h('main', {},
      h('p', { class: 'error', role: 'alert' }, state.analysisError),
      primary('Réessayer', runAnalysis),
      h('button', { class: 'link', type: 'button', onclick: () => { state.suggestion = null; go('panne'); } }, 'Continuer sans analyse')),
  ];
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
const go = (screen) => { Object.assign(state, { form: {}, formError: null, formInfo: null, busy: false, stageEntered: false }); state.screen = screen; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus(); };
const brand = () => h('span', { class: 'brand' }, h('img', { src: 'icon-192.png', alt: '', width: '32', height: '32' }), 'Seravia');
const accountNav = () => h('nav', { class: 'top-nav', 'aria-label': 'Compte' }, backend.signedIn
  ? h('button', { class: 'nav-link', type: 'button', onclick: () => go('compte') }, 'Mon compte')
  : [h('button', { class: 'nav-link', type: 'button', onclick: () => openLogin() }, 'Se connecter'),
    h('button', { class: 'nav-pill', type: 'button', onclick: () => openSignup('client') }, 'S’inscrire')]);
const header = (title, back, nav) => h('header', { class: 'top' },
  back ? h('button', { class: 'back', type: 'button', onclick: () => go(back) }, 'Retour') : h('div', { class: 'top-row' }, brand(), nav && accountNav()),
  h('h1', { tabindex: '-1' }, title));
const choice = (label, selected, onclick) => h('button', {
  class: `choice${selected ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(selected)), onclick,
}, label);
const primary = (label, onclick, disabled) => h('button', { class: 'primary', type: 'button', onclick, disabled }, label);

function photoScreen() {
  const input = h('input', {
    id: 'photo', class: 'visually-hidden', type: 'file', accept: 'image/*', capture: 'environment',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const blob = await compressPhoto(file);
        if (state.photo) URL.revokeObjectURL(state.photo);
        Object.assign(state, { photo: URL.createObjectURL(blob), photoBlob: blob, photoPath: null, photoError: null, suggestion: null });
      } catch { state.photoError = 'Cette image ne peut pas être lue. Essayez une autre photo.'; }
      render();
    },
  });
  return [
    header('Quel est le problème à bord ?', null, true),
    h('main', {},
      h('label', { for: 'photo', class: `shot${state.photo ? ' has-photo' : ''}` },
        state.photo ? h('img', { src: state.photo, alt: 'Photo de la panne' }) : h('span', { class: 'shot-text' }, h('strong', {}, 'Photographier la panne'), h('small', {}, 'Cadrez la pièce ou la zone concernée'))),
      input,
      state.accountDeleted && h('p', { class: 'lead', role: 'status' }, 'Votre compte a été supprimé.'),
      state.photoError && h('p', { class: 'error', role: 'alert' }, state.photoError),
      h('p', { class: 'note' }, state.photo
        ? 'Si vous l’analysez, la photo est transmise à notre prestataire d’IA et conservée 90 jours au maximum. Elle peut être vue par l’intervenant choisi.'
        : 'Vous pourrez faire analyser la photo ou décrire la panne vous-même.'),
      state.photo
        ? [primary('Analyser la photo', startAnalysis),
          h('button', { class: 'link', type: 'button', onclick: () => { state.suggestion = null; go('panne'); } }, 'Continuer sans analyse')]
        : primary('Continuer sans photo', () => go('panne')),
      !backend.signedIn && !state.photo && [h('h2', { class: 'stage-title' }, 'Créez votre compte'), roleStage(null, openSignup)],
      !state.photo && h('ol', { class: 'howto' },
        h('li', {}, h('strong', {}, 'Montrez la panne'), h('span', {}, 'Une photo, ou quelques questions si vous préférez.')),
        h('li', {}, h('strong', {}, 'Voyez l’urgence'), h('span', {}, 'Avec un premier repère de prix, à confirmer après diagnostic.')),
        h('li', {}, h('strong', {}, 'Trouvez un intervenant'), h('span', {}, 'Du plus proche au plus éloigné de votre bateau.'))),
      !state.photo && h('p', { class: 'sos' }, 'En cas de danger, appelez le ', h('a', { href: 'tel:196' }, '196'), ' en mer ou le ', h('a', { href: 'tel:112' }, '112'), ' à quai.'),
      ),
  ];
}

function suggestionBox() {
  const s = state.suggestion;
  if (!s) return null;
  return h('div', { class: 'suggestion' },
    h('strong', {}, s.recognized ? 'Suggestion de l’IA, à vérifier' : 'L’IA n’a pas reconnu la panne'),
    s.observation && h('p', {}, s.observation),
    h('p', {}, s.recognized ? 'Corrigez les choix ci-dessous s’ils ne correspondent pas.' : 'Décrivez la panne vous-même ci-dessous.'),
    s.danger_possible && h('p', { class: 'suggestion-danger', role: 'alert' }, 'Danger possible. Mettez-vous en sécurité. En mer, appelez le ',
      h('a', { href: 'tel:196' }, '196'), '. À quai, appelez le ', h('a', { href: 'tel:112' }, '112'), '.'));
}

function panneScreen() {
  state.location ??= state.profile?.home_location ?? null;
  const category = CATEGORIES.find((c) => c.id === state.category);
  const ready = state.symptom && state.location;
  const place = LOCATIONS.find((l) => l.id === state.location);
  return [
    header('Décrivez la panne', 'photo'),
    h('main', {},
      suggestionBox(),
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
        if (state.location !== l.id) state.port = null;
        state.location = l.id; render();
      }))),
      place?.ports && h('h2', {}, 'Quel port ?'),
      place?.ports && h('div', { class: 'choices' },
        place.ports.map((name) => choice(name, state.port === name, () => { state.port = name; render(); })),
        choice('Autre endroit', !state.port, () => { state.port = null; render(); })),
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
        h('dt', {}, 'Premier repère de prix'), h('dd', {}, `${r.price.min} à ${r.price.max} €`)),
      h('p', { class: 'note' }, state.suggestion?.recognized
        ? 'Ce repère vient de la photo et de vos réponses. Le prix réel dépend du modèle, de l’entretien et de l’état de la pièce : le professionnel le confirme après diagnostic, et il peut être bien plus élevé.'
        : 'Ce repère vient de vos réponses. Le prix réel dépend du modèle, de l’entretien et de l’état de la pièce : le professionnel le confirme après diagnostic, et il peut être bien plus élevé.'),
      primary('Trouver un intervenant', () => go('pros'))),
  ];
}

function prosScreen() {
  const r = triage(state.category, state.symptom, state.aFlot);
  const location = LOCATIONS.find((l) => l.id === state.location);
  if (state.realPros === null) {
    state.realPros = [];
    backend.listPros().then((rows) => { state.realPros = rows; if (state.screen === 'pros') render(); }).catch(() => {});
    backend.listRatings().then((rows) => { state.ratings = rows; if (state.screen === 'pros') render(); }).catch(() => {});
  }
  const real = matchPros(state.realPros, state.category, location).map((p) => ({ ...p, real: true }));
  const pros = real.length ? real : matchPros(DEMO_PROS, state.category, location);
  return [
    header(`${r.category.trade} près de ${location.label}`, 'resultat'),
    h('main', {},
      !real.length && h('p', { class: 'demo' }, 'Intervenants fictifs : cette version sert de démonstration.'),
      h('ul', { class: 'pros' }, pros.map((p) => h('li', {},
        h('div', {}, h('strong', {}, p.name), h('span', {}, p.distance < 1 ? 'Moins de 1 km à vol d’oiseau' : `${p.distance.toFixed(1).replace('.', ',')} km à vol d’oiseau`),
          p.real && trustBadges(p),
          p.real && h('button', { class: 'inline-link', type: 'button', onclick: () => openPublicPro(p) }, ratingLabel(state.ratings.filter((x) => x.pro_id === p.id)))),
        h('button', { class: 'pick', type: 'button', onclick: () => {
          state.pro = p; saveDraft();
          if (p.real) go('contact');
          else if (backend.signedIn) submitRequest();
          else { Object.assign(state, { loginError: null, afterLogin: 'submit', loginBack: 'pros', loginTitle: 'Connectez-vous pour enregistrer la demande' }); go('connexion'); }
        } }, 'Choisir'))))),
  ];
}

function contactScreen() {
  const input = h('input', { id: 'phone', type: 'tel', autocomplete: 'tel', required: true, minlength: '6', maxlength: '30', value: state.phone || state.profile?.phone || '' });
  return [
    header('Comment vous joindre ?', 'pros'),
    h('main', {}, h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        state.phone = input.value.trim();
        saveDraft();
        if (backend.signedIn) submitRequest();
        else { Object.assign(state, { loginError: null, afterLogin: 'submit', loginBack: 'contact', loginTitle: 'Connectez-vous pour envoyer la demande' }); go('connexion'); }
      },
    },
    h('label', { class: 'field', for: 'phone' }, 'Numéro de téléphone'), input,
    h('p', { class: 'note' }, `Il sera transmis à ${state.pro.name} pour traiter votre demande, et conservé avec elle 1 an au maximum.`),
    h('button', { class: 'primary', type: 'submit' }, 'Envoyer la demande'))),
  ];
}

function sentScreen() {
  return [
    header('Demande envoyée'),
    h('main', {},
      h('p', { class: 'lead' }, `${state.pro.name} peut maintenant la consulter dans son espace.`),
      h('p', { class: 'note' }, 'Il n’est pas encore prévenu automatiquement. Son état s’affiche dans Mes demandes.'),
      primary('Voir mes demandes', openRequests)),
  ];
}

const PRO_ACTIONS = {
  envoyee: [['accepter', 'Accepter'], ['refuser', 'Refuser']],
  en_route: [['commencer', 'Commencer l’intervention'], ['annuler', 'Annuler']],
  en_cours: [['terminer', 'Terminer l’intervention'], ['annuler', 'Annuler']],
};

async function openProSpace() {
  state.proRequests = null; state.proError = null;
  go('pro');
  try { state.proRequests = await backend.listProRequests(state.myPro.id); } catch (error) { state.proError = error.message; }
  if (state.screen === 'pro') render();
}

function describeRequest(r) {
  const category = CATEGORIES.find((c) => c.id === r.category);
  return {
    symptom: category?.symptoms.find((s) => s.id === r.symptom)?.label ?? r.symptom,
    place: LOCATIONS.find((l) => l.id === r.location)?.label ?? r.location,
  };
}

function proScreen() {
  return [
    header(state.myPro.verified ? 'Demandes reçues' : state.myPro.rejected ? 'Fiche non validée' : 'Fiche en attente de vérification', 'compte'),
    h('main', {},
      !state.myPro.verified && h('p', { class: 'lead' }, state.myPro.rejected ? 'Corrigez votre fiche pour la soumettre de nouveau.' : 'Vous recevrez des demandes une fois votre fiche vérifiée par Seravia.'),
      state.proError && h('p', { class: 'error', role: 'alert' }, state.proError),
      !state.proRequests && !state.proError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      state.proRequests?.length === 0 && state.myPro.verified && h('p', { class: 'lead' }, 'Aucune demande pour l’instant.'),
      state.proRequests?.length > 0 && h('ul', { class: 'pros' }, state.proRequests.map((r) => {
        const d = describeRequest(r);
        return h('li', {},
          h('div', {}, h('strong', {}, d.symptom), h('span', {}, `${d.place}, ${STATUS_LABELS[r.status] ?? r.status}`)),
          h('button', { class: 'pick', type: 'button', onclick: () => openProRequest(r) }, 'Ouvrir'));
      })),
      h('button', { class: 'link', type: 'button', onclick: openProSpace }, 'Actualiser')),
  ];
}

async function openProRequest(request) {
  if (state.proPhoto) URL.revokeObjectURL(state.proPhoto);
  Object.assign(state, { proCurrent: request, proPhoto: null, proError: null });
  go('pro-demande');
  if (!request.photo_path) return;
  try {
    const blob = await backend.fetchPhoto(request.photo_path);
    if (state.proCurrent?.id === request.id) { state.proPhoto = URL.createObjectURL(blob); render(); }
  } catch { if (state.proCurrent?.id === request.id) { state.proError = 'La photo ne peut pas être affichée.'; render(); } }
}

async function runProAction(action) {
  if (state.proBusy) return;
  state.proBusy = true; state.proError = null; render();
  try {
    const status = await backend.updateProRequest(state.proCurrent.id, action);
    state.proCurrent = { ...state.proCurrent, status };
  } catch (error) { state.proError = error.message; }
  state.proBusy = false; render();
}

function proRequestScreen() {
  const r = state.proCurrent;
  const d = describeRequest(r);
  return [
    header(d.symptom, 'pro'),
    h('main', {},
      state.proError && h('p', { class: 'error', role: 'alert' }, state.proError),
      state.proPhoto && h('img', { class: 'pro-photo', src: state.proPhoto, alt: 'Photo envoyée par le client' }),
      h('dl', { class: 'facts' },
        h('dt', {}, 'État'), h('dd', {}, STATUS_LABELS[r.status] ?? r.status),
        h('dt', {}, 'Lieu'), h('dd', {}, `${r.port ?? d.place}, ${r.afloat ? 'à flot' : 'à terre'}`),
        h('dt', {}, 'Urgence'), h('dd', {}, urgencyLevel(r.urgency_score).label),
        h('dt', {}, 'Repère de prix affiché au client'), h('dd', {}, `${r.price_min} à ${r.price_max} €`),
        r.contact_phone && r.status !== 'refusee' && [h('dt', {}, 'Téléphone du client'), h('dd', {}, h('a', { href: `tel:${r.contact_phone.replace(/[^+\d]/g, '')}` }, r.contact_phone))]),
      (PRO_ACTIONS[r.status] ?? []).map(([action, label]) => h('button', {
        class: action === 'refuser' || action === 'annuler' ? 'secondary' : 'primary', type: 'button', disabled: state.proBusy, onclick: () => runProAction(action),
      }, label))),
  ];
}

function deleteAccountScreen() {
  return [
    header('Supprimer votre compte ?', 'parametres'),
    h('main', {},
      state.deleteError && h('p', { class: 'error', role: 'alert' }, state.deleteError),
      h('p', { class: 'lead' }, 'Votre compte, votre profil, vos demandes, vos avis et vos photos seront supprimés définitivement. Cette action ne peut pas être annulée.'),
      state.myPro && h('p', { class: 'note' }, 'Votre fiche d’intervenant ne sera plus proposée aux clients.'),
      h('button', { class: 'primary danger-action', type: 'button', disabled: state.deleting, onclick: async () => {
        state.deleting = true; state.deleteError = null; render();
        try {
          await backend.deleteAccount();
          clearDraft(); await takePendingPhoto();
          state.myPro = null; state.profile = null; state.isAdmin = false; resetFlow(); state.deleting = false; state.accountDeleted = true;
          go('photo');
        } catch (error) { state.deleting = false; state.deleteError = error.message; render(); }
      } }, state.deleting ? 'Suppression en cours' : 'Supprimer définitivement'),
      h('button', { class: 'secondary', type: 'button', disabled: state.deleting, onclick: () => go('parametres') }, 'Garder mon compte')),
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

// Champs dont la saisie survit à un nouvel affichage. Un mot de passe n'est jamais gardé.
function field(label, id, attrs = {}, initial = '') {
  const secret = attrs.type === 'password';
  const value = secret ? '' : state.form[id] ?? initial ?? '';
  if (!secret) state.form[id] = value;
  const oninput = secret ? undefined : (e) => { state.form[id] = e.target.value; };
  const control = attrs.type === 'textarea'
    ? h('textarea', { id, maxlength: attrs.maxlength, oninput }, value)
    : h('input', { id, name: id, type: 'text', ...attrs, ...(secret ? {} : { value }), ...(oninput ? { oninput } : {}) });
  return [h('label', { class: 'field', for: id }, label), control];
}
function selectField(label, id, options, initial = '') {
  const value = state.form[id] ?? initial ?? '';
  state.form[id] = value;
  return [
    h('label', { class: 'field', for: id }, label),
    h('select', { id, required: true, onchange: (e) => { state.form[id] = e.target.value; } },
      h('option', { value: '', selected: !value, disabled: true }, 'Choisir'),
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))),
  ];
}
const messages = () => [
  state.formError && h('p', { class: 'error', role: 'alert' }, state.formError),
  state.formInfo && h('p', { class: 'status', role: 'status' }, state.formInfo),
];
async function runForm(action) {
  if (state.busy) return;
  state.busy = true; state.formError = null; state.formInfo = null; render();
  try { await action(); } catch (error) { state.formError = error.message; }
  state.busy = false; render();
}
const submit = (label, busyLabel) => h('button', { class: 'primary', type: 'submit', disabled: state.busy }, state.busy ? busyLabel : label);
// Les deux personnages du logo, redessinés pour rester nets et animer leur poignée de main.
const CLIENT_FIGURE = `<svg viewBox="60 90 218 330" aria-hidden="true"><g class="fig-body"><circle cx="131" cy="155" r="52"/><path d="M73 408V262c0-26 20-44 46-44s38 12 50 34v156z"/></g><g class="fig-arm fig-arm-left"><path class="fig-gap" d="M166 256l92 82"/><path class="fig-limb" d="M166 256l92 82"/></g></svg>`;
const PRO_FIGURE = `<svg viewBox="276 90 169 330" aria-hidden="true"><g class="fig-body"><path d="M325 152a52 50 0 0 1 104 0z"/><rect x="318" y="150" width="116" height="14" rx="7"/><path class="fig-cut" d="M379 104l-7 32"/><path d="M332 172h88a44 44 0 0 1-88 0z"/><path fill-rule="evenodd" d="M334 228h20l12 66h18l12-66h20c20 0 34 18 34 40v137H306V268c0-22 10-40 28-40zm-4 136v22h44v-22zm56 0v22h34v-22z"/></g><g class="fig-arm fig-arm-right"><path class="fig-gap" d="M420 322l-124 24"/><path class="fig-limb" d="M420 322l-124 24"/></g></svg>`;
function figure(markup) {
  const el = h('span', { class: 'figure' });
  el.innerHTML = markup; // Dessins fixes écrits ici, sans aucune donnée saisie.
  return el;
}
function roleStage(selected, onpick) {
  const role = (kind, label, markup) => h('button', {
    class: `role role-${kind}${selected === kind ? ' is-on' : ''}${selected && selected !== kind ? ' is-off' : ''}`,
    type: 'button', onclick: () => onpick(kind), ...(selected ? { 'aria-pressed': String(selected === kind) } : {}),
  }, figure(markup), h('span', { class: 'role-label' }, label));
  const stage = h('div', { class: `stage ${state.stageEntered ? 'stage-play' : 'stage-wait'}`, role: 'group', 'aria-label': 'Vous êtes' },
    role('client', 'Client', CLIENT_FIGURE), role('pro', 'Intervenant', PRO_FIGURE));
  if (!state.stageEntered) playWhenCentered(stage);
  return stage;
}
// L'animation démarre quand les personnages atteignent à peu près le milieu de l'écran.
function playWhenCentered(stage) {
  const play = () => {
    state.stageEntered = true;
    stage.classList.replace('stage-wait', 'stage-enter');
    stage.classList.add('stage-play');
  };
  if (!('IntersectionObserver' in window)) { play(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    play();
  }, { rootMargin: '-40% 0px -40% 0px' });
  observer.observe(stage);
}

const PASSWORD_ATTRS = { type: 'password', required: true, minlength: '8', maxlength: '72', autocomplete: 'new-password' };

function openLogin() {
  Object.assign(state, { loginError: null, afterLogin: null, loginBack: 'photo', loginTitle: '' });
  go('connexion');
}
function openSignup(kind) {
  state.signupKind = kind; state.loginBack = 'photo'; state.afterLogin = null;
  go('inscription');
}
async function afterAuth() {
  state.loginError = null; state.notice = null;
  await loadMyPro();
  const next = state.afterLogin;
  state.afterLogin = null;
  if (state.signupKind === 'pro' && !state.myPro) { state.signupKind = 'client'; go('pro-fiche'); return; }
  if (next === 'submit' && state.pro) { submitRequest(); return; }
  if (next === 'analyse' && state.photoBlob) { runAnalysis(); return; }
  go('compte');
}

function loginScreen() {
  const email = () => (state.form.email ?? '').trim();
  return [
    header(state.loginTitle || 'Se connecter', state.loginBack),
    h('main', {},
      state.notice && h('p', { class: 'status', role: 'status' }, state.notice),
      state.loginError && h('p', { class: 'error', role: 'alert' }, state.loginError),
      messages(),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const password = e.target.elements.password.value;
        state.loginError = null;
        runForm(async () => { await backend.signIn(email(), password); await afterAuth(); });
      } },
      field('Adresse e-mail', 'email', { type: 'email', required: true, autocomplete: 'email' }),
      field('Mot de passe', 'password', { type: 'password', required: true, autocomplete: 'current-password' }),
      submit('Se connecter', 'Connexion en cours')),
      h('button', { class: 'link', type: 'button', onclick: () => { const typed = state.form.email; go('oubli'); state.form.email = typed; render(); } }, 'Mot de passe oublié'),
      h('button', { class: 'link', type: 'button', onclick: () => go('inscription') }, 'Pas encore de compte ? S’inscrire')),
  ];
}

function signupScreen() {
  const pro = state.signupKind === 'pro';
  return [
    header('Créer un compte', state.loginBack),
    h('main', {},
      messages(),
      h('h2', {}, 'Vous êtes'),
      roleStage(state.signupKind, (kind) => { state.signupKind = kind; render(); }),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const password = e.target.elements.password.value;
        runForm(async () => {
          const email = state.form.email.trim();
          const name = state.form.full_name.trim();
          const outcome = await backend.signUp(email, password, location.origin + location.pathname);
          if (outcome.confirm) {
            state.notice = 'Votre compte est créé. Confirmez votre adresse avec le lien reçu par e-mail, puis connectez-vous.';
            state.loginTitle = '';
            go('connexion');
            return;
          }
          await backend.saveProfile({ full_name: name }).catch(() => {});
          await afterAuth();
        });
      } },
      field(pro ? 'Votre prénom et nom' : 'Prénom et nom', 'full_name', { required: true, maxlength: '100', autocomplete: 'name' }),
      field('Adresse e-mail', 'email', { type: 'email', required: true, autocomplete: 'email' }),
      field('Mot de passe (8 caractères minimum)', 'password', PASSWORD_ATTRS),
      h('p', { class: 'note' }, pro
        ? 'Vous compléterez ensuite votre fiche. Elle reste invisible des clients tant que Seravia ne l’a pas vérifiée.'
        : 'Votre compte sert à enregistrer et suivre vos demandes. Vous pouvez le supprimer à tout moment.'),
      submit('Créer mon compte', 'Création en cours')),
      h('button', { class: 'link', type: 'button', onclick: () => go('connexion') }, 'Déjà un compte ? Se connecter')),
  ];
}

function forgotScreen() {
  return [
    header('Mot de passe oublié', 'connexion'),
    h('main', {},
      messages(),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        runForm(async () => {
          await backend.sendPasswordReset(state.form.email.trim(), location.origin + location.pathname);
          state.formInfo = 'Si un compte existe avec cette adresse, un lien vient d’être envoyé. Ouvrez-le sur cet appareil.';
        });
      } },
      field('Adresse e-mail', 'email', { type: 'email', required: true, autocomplete: 'email' }),
      submit('Recevoir le lien', 'Envoi en cours'))),
  ];
}

function newPasswordScreen() {
  return [
    header('Nouveau mot de passe'),
    h('main', {},
      messages(),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const password = e.target.elements.password.value;
        runForm(async () => { await backend.changePassword(password); go('compte'); state.formInfo = 'Votre mot de passe a été changé.'; });
      } },
      field('Mot de passe (8 caractères minimum)', 'password', PASSWORD_ATTRS),
      submit('Enregistrer', 'Enregistrement'))),
  ];
}

const menuItem = (label, onclick, detail) => h('li', {}, h('button', { type: 'button', onclick }, h('span', {}, label), detail && h('small', {}, detail)));

function accountScreen() {
  if (!backend.signedIn) { state.screen = 'connexion'; return loginScreen(); }
  return [
    header(state.profile?.full_name || 'Mon compte', 'photo'),
    h('main', {},
      h('div', { class: 'account-id' }, avatar(state.profile?.avatar_path), h('p', { class: 'note' }, backend.email)),
      messages(),
      h('ul', { class: 'menu' },
        menuItem('Mes demandes', openRequests),
        menuItem('Profil', () => go('profil')),
        menuItem('Paramètres', () => go('parametres'))),
      state.myPro
        ? [h('h2', { class: 'section-title' }, 'Espace intervenant'),
          h('ul', { class: 'menu' },
            menuItem('Demandes reçues', openProSpace),
            menuItem('Ma fiche', () => go('pro-fiche'), state.myPro.verified ? 'Vérifiée' : state.myPro.rejected ? 'Refusée' : 'En attente de vérification'),
            menuItem('Mes avis', openProReviews))]
        : h('button', { class: 'link', type: 'button', onclick: () => go('pro-fiche') }, 'Vous êtes intervenant ? Créer ma fiche'),
      state.isAdmin && [h('h2', { class: 'section-title' }, 'Administration'),
        h('ul', { class: 'menu' },
          menuItem('Intervenants à vérifier', openAdminPros),
          menuItem('Avis et photos', openAdminReviews))],
      h('button', { class: 'secondary', type: 'button', onclick: async () => {
        await backend.signOut();
        Object.assign(state, { myPro: null, profile: null, reviewed: [], isAdmin: false });
        resetFlow(); go('photo');
      } }, 'Se déconnecter')),
  ];
}

function profileScreen() {
  const p = state.profile ?? {};
  return [
    header('Profil', 'compte'),
    h('main', {},
      messages(),
      h('div', { class: 'avatar-edit' },
        avatar(p.avatar_path, 'avatar-big'),
        h('div', {},
          h('input', { id: 'avatar-file', class: 'visually-hidden', type: 'file', accept: 'image/*', disabled: state.busy, onchange: (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            runForm(async () => {
              let blob;
              try { blob = await compressPhoto(file, 400); } catch { throw new Error('Cette image ne peut pas être lue. Essayez une autre photo.'); }
              state.profile = await backend.uploadAvatar(blob, p.avatar_path);
              state.formInfo = 'Photo enregistrée.';
            });
          } }),
          h('label', { class: 'pick-photo', for: 'avatar-file' }, p.avatar_path ? 'Changer la photo' : 'Ajouter une photo'),
          p.avatar_path && h('button', { class: 'inline-link', type: 'button', disabled: state.busy, onclick: () => runForm(async () => {
            state.profile = await backend.removeAvatar(p.avatar_path);
            state.formInfo = 'Photo retirée.';
          }) }, 'Retirer la photo'))),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        runForm(async () => {
          state.profile = await backend.saveProfile({
            full_name: state.form.full_name.trim() || null,
            phone: state.form.phone.trim() || null,
            home_location: state.form.home_location || null,
          });
          state.formInfo = 'Profil enregistré.';
        });
      } },
      field('Prénom et nom', 'full_name', { maxlength: '100', autocomplete: 'name' }, p.full_name),
      field('Téléphone', 'phone', { type: 'tel', minlength: '6', maxlength: '30', autocomplete: 'tel' }, p.phone),
      selectFieldOptional('Port habituel', 'home_location', LOCATIONS.map((l) => [l.id, l.label]), p.home_location),
      h('p', { class: 'note' }, 'Ces informations préremplissent vos demandes. Votre téléphone n’est transmis qu’à l’intervenant que vous choisissez.'),
      submit('Enregistrer', 'Enregistrement'))),
  ];
}
function selectFieldOptional(label, id, options, initial) {
  const value = state.form[id] ?? initial ?? '';
  state.form[id] = value;
  return [
    h('label', { class: 'field', for: id }, label),
    h('select', { id, onchange: (e) => { state.form[id] = e.target.value; } },
      h('option', { value: '', selected: !value }, 'Non renseigné'),
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))),
  ];
}

function settingsScreen() {
  return [
    header('Paramètres', 'compte'),
    h('main', {},
      messages(),
      h('dl', { class: 'facts' }, h('dt', {}, 'Adresse e-mail'), h('dd', {}, backend.email)),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const form = e.target;
        const password = form.elements.password.value;
        runForm(async () => { await backend.changePassword(password); state.formInfo = 'Votre mot de passe a été changé.'; });
      } },
      field('Nouveau mot de passe (8 caractères minimum)', 'password', PASSWORD_ATTRS),
      h('button', { class: 'secondary', type: 'submit', disabled: state.busy }, state.busy ? 'Enregistrement' : 'Changer le mot de passe')),
      h('p', { class: 'note' }, 'Vous pouvez supprimer votre compte et vos données à tout moment.'),
      h('button', { class: 'link link-danger', type: 'button', onclick: () => { state.deleteError = null; go('supprimer'); } }, 'Supprimer mon compte')),
  ];
}

function proProfileScreen() {
  const p = state.myPro ?? {};
  return [
    header(state.myPro ? 'Ma fiche' : 'Créer ma fiche', 'compte'),
    h('main', {},
      h('p', { class: 'status' }, p.verified
        ? 'Fiche vérifiée et visible des clients. Changer le nom, le métier ou le SIRET la renverra en vérification.'
        : p.rejected
          ? 'Votre fiche n’a pas été validée. Corrigez-la et enregistrez-la pour la soumettre de nouveau.'
          : 'Votre fiche reste invisible des clients tant que Seravia ne l’a pas vérifiée.'),
      messages(),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        const f = state.form;
        const siret = f.siret.replace(/\s/g, '');
        if (!/^\d{14}$/.test(siret)) { state.formError = 'Le SIRET doit contenir 14 chiffres.'; render(); return; }
        runForm(async () => {
          state.myPro = await backend.saveProProfile({
            name: f.name, category: f.category, location: f.location, phone: f.phone, siret, description: f.description, responseMinutes: f.response_minutes ? Number(f.response_minutes) : null,
          });
          state.formInfo = state.myPro.verified ? 'Fiche enregistrée.' : 'Fiche enregistrée. Elle attend la vérification de Seravia.';
        });
      } },
      field('Nom de l’entreprise', 'name', { required: true, minlength: '2', maxlength: '100', autocomplete: 'organization' }, p.name),
      selectField('Métier', 'category', CATEGORIES.map((c) => [c.id, c.trade]), p.category),
      selectField('Ville ou port', 'location', LOCATIONS.map((l) => [l.id, l.label]), p.location),
      field('Téléphone professionnel', 'phone', { type: 'tel', required: true, minlength: '6', maxlength: '30', autocomplete: 'tel' }, p.phone),
      field('SIRET', 'siret', { required: true, inputmode: 'numeric', maxlength: '20' }, p.siret),
      selectFieldOptional('Délai de réponse auquel vous vous engagez', 'response_minutes', Object.entries(RESPONSE_LABELS).map(([v, text]) => [v, `Sous ${text}`]), p.response_minutes == null ? '' : String(p.response_minutes)),
      field('Présentation (facultatif)', 'description', { type: 'textarea', maxlength: '500' }, p.description),
      h('p', { class: 'note' }, 'Le nom, le métier, le téléphone, le délai et la présentation sont affichés aux clients une fois la fiche vérifiée. N’annoncez qu’un délai que vous pouvez tenir.'),
      submit('Enregistrer ma fiche', 'Enregistrement'))),
  ];
}

async function openAdminPros() {
  state.adminPros = null;
  go('admin-pros');
  try { state.adminPros = await backend.adminListPros(); } catch (error) { state.formError = error.message; }
  render();
}
const proStatus = (p) => (p.verified ? 'Vérifiée' : p.rejected ? 'Refusée' : 'En attente');
function adminProsScreen() {
  const list = state.adminPros;
  const act = (p, action, info) => h('button', {
    class: action === 'valider' ? 'pick pick-main' : 'pick', type: 'button', disabled: state.busy,
    onclick: () => runForm(async () => {
      await backend.adminSetPro(p.id, action);
      state.adminPros = await backend.adminListPros();
      state.formInfo = `${p.name} : ${info}.`;
    }),
  }, { valider: 'Valider', refuser: 'Refuser', retirer: 'Retirer la validation' }[action]);
  return [
    header('Intervenants', 'compte'),
    h('main', {},
      messages(),
      !list && !state.formError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      list?.length === 0 && h('p', { class: 'lead' }, 'Aucune fiche pour l’instant.'),
      list?.length > 0 && h('ul', { class: 'admin-list' }, list.map((p) => h('li', {},
        h('div', { class: 'admin-head' }, h('strong', {}, p.name), h('small', { class: p.verified || p.rejected ? '' : 'badge' }, proStatus(p))),
        h('p', {}, [CATEGORIES.find((c) => c.id === p.category)?.trade, LOCATIONS.find((l) => l.id === p.location)?.label].filter(Boolean).join(', ')),
        p.phone && h('p', {}, h('a', { href: `tel:${p.phone.replace(/[^+\d]/g, '')}` }, p.phone)),
        p.siret
          ? h('p', {}, `SIRET ${p.siret} : `, h('a', { href: `https://annuaire-entreprises.data.gouv.fr/etablissement/${encodeURIComponent(p.siret)}`, target: '_blank', rel: 'noopener noreferrer' }, 'vérifier l’entreprise'))
          : h('p', { class: 'note' }, 'Aucun SIRET renseigné.'),
        p.description && h('p', { class: 'note' }, p.description),
        h('p', { class: 'note' }, `Délai annoncé : ${RESPONSE_LABELS[p.response_minutes] ?? 'aucun'}. Assurance : ${p.insurance_verified ? 'contrôlée' : 'non contrôlée'}.`),
        h('div', { class: 'admin-actions' },
          h('button', { class: 'pick', type: 'button', disabled: state.busy, onclick: () => runForm(async () => {
            await backend.adminSetProInsurance(p.id, !p.insurance_verified);
            state.adminPros = await backend.adminListPros();
            state.formInfo = `${p.name} : assurance ${p.insurance_verified ? 'non contrôlée' : 'contrôlée'}.`;
          }) }, p.insurance_verified ? 'Retirer « assurance contrôlée »' : 'Assurance contrôlée'),
          !p.verified && act(p, 'valider', 'fiche validée'),
          !p.verified && !p.rejected && act(p, 'refuser', 'fiche refusée'),
          p.verified && act(p, 'retirer', 'validation retirée')))))),
  ];
}

async function openAdminReviews() {
  state.adminReviews = null;
  go('admin-avis');
  try { state.adminReviews = await backend.adminListReviews(); } catch (error) { state.formError = error.message; }
  render();
}
function adminReviewsScreen() {
  const list = state.adminReviews;
  const refresh = async (info) => { state.adminReviews = await backend.adminListReviews(); state.formInfo = info; };
  return [
    header('Avis et photos', 'compte'),
    h('main', {},
      messages(),
      !list && !state.formError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      list?.length === 0 && h('p', { class: 'lead' }, 'Aucun avis pour l’instant.'),
      list?.length > 0 && h('ul', { class: 'admin-list' }, list.map((r) => h('li', {},
        h('div', { class: 'review-head' }, avatar(r.avatar_path),
          h('div', {},
            h('strong', { class: 'review-author' }, r.author_name ?? 'Auteur sans nom'),
            h('span', { class: 'note-inline' }, `Sur ${r.pro_name}${r.show_author ? ', avis signé' : ', avis anonyme'}`))),
        h('p', {}, h('span', { class: 'rate', 'aria-label': `${r.rating} sur 5` }, '★'.repeat(r.rating)), r.hidden && h('small', { class: 'badge badge-gap' }, 'Masqué')),
        r.comment && h('p', {}, r.comment),
        r.reply && h('p', { class: 'reply' }, `Réponse : ${r.reply}`),
        h('div', { class: 'admin-actions' },
          h('button', { class: 'pick', type: 'button', disabled: state.busy, onclick: () => runForm(async () => {
            await backend.adminSetReviewHidden(r.id, !r.hidden);
            await refresh(r.hidden ? 'Avis de nouveau visible.' : 'Avis masqué.');
          }) }, r.hidden ? 'Réafficher' : 'Masquer l’avis'),
          r.avatar_path && h('button', { class: 'pick', type: 'button', disabled: state.busy, onclick: () => runForm(async () => {
            await backend.adminClearReviewAvatar(r.id);
            await refresh('Photo supprimée.');
          }) }, 'Retirer la photo')))))),
  ];
}

const reviewDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });
const decimal = (n) => n.toFixed(1).replace('.', ',');
function ratingLabel(list) {
  if (!list.length) return 'Voir la fiche, aucun avis';
  const avg = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
  return `★ ${decimal(avg)} sur 5 (${list.length} avis)`;
}
const avatarUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
function avatar(path, size = '') {
  const fallback = () => h('span', { class: `avatar avatar-default ${size}`, 'aria-hidden': 'true' });
  if (!path) return fallback();
  const img = h('img', { class: `avatar ${size}`, src: avatarUrl(path), alt: '', loading: 'lazy', onerror: () => img.replaceWith(fallback()) });
  return img;
}
const RESPONSE_LABELS = { 15: '15 minutes', 30: '30 minutes', 60: '1 heure', 120: '2 heures' };
// Chaque mention dit exactement ce qui a été contrôlé, et par qui.
function trustBadges(p) {
  return h('ul', { class: 'trust' },
    p.verified && h('li', {}, 'Entreprise vérifiée par Seravia'),
    p.insurance_verified && h('li', {}, 'Assurance contrôlée par Seravia'),
    RESPONSE_LABELS[p.response_minutes] && h('li', {}, `Répond sous ${RESPONSE_LABELS[p.response_minutes]}, selon l’intervenant`));
}
function reviewItem(r, extra) {
  return h('li', {},
    h('div', { class: 'review-head' },
      avatar(r.author_avatar),
      h('div', {},
        h('strong', { class: 'review-author' }, r.author_name ?? 'Client vérifié'),
        h('span', { class: 'rate', 'aria-label': `${r.rating} sur 5` }, '★'.repeat(r.rating)))),
    h('time', { datetime: r.created_at }, reviewDate.format(new Date(r.created_at))),
    r.comment && h('p', {}, r.comment),
    r.reply && h('p', { class: 'reply' }, `Réponse de l’intervenant : ${r.reply}`),
    extra);
}
const reviewsNote = () => h('p', { class: 'note' }, 'Seuls les clients dont l’intervention est marquée terminée peuvent laisser un avis. Les plus récents apparaissent en premier.');

async function openProReviews() {
  state.proReviews = null;
  go('pro-avis');
  try { state.proReviews = await backend.listProReviews(state.myPro.id); } catch (error) { state.formError = error.message; }
  render();
}
function proReviewsScreen() {
  const list = state.proReviews;
  return [
    header('Mes avis', 'compte'),
    h('main', {},
      messages(),
      !list && !state.formError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      !state.myPro.verified && h('p', { class: 'note' }, 'Vos avis apparaîtront une fois votre fiche vérifiée.'),
      list?.length === 0 && state.myPro.verified && h('p', { class: 'lead' }, 'Aucun avis pour l’instant.'),
      list?.length > 0 && h('p', { class: 'rating-big' }, ratingLabel(list)),
      list?.length > 0 && h('ul', { class: 'reviews' }, list.map((r) => reviewItem(r, !r.reply && h('form', { onsubmit: (e) => {
        e.preventDefault();
        const reply = e.target.elements.reply.value.trim();
        if (!reply) return;
        runForm(async () => {
          await backend.replyToReview(r.id, reply);
          state.proReviews = await backend.listProReviews(state.myPro.id);
          state.formInfo = 'Réponse publiée.';
        });
      } },
      h('label', { class: 'field', for: `reply-${r.id}` }, 'Répondre'),
      h('textarea', { id: `reply-${r.id}`, name: 'reply', maxlength: '1000' }),
      h('button', { class: 'secondary', type: 'submit', disabled: state.busy }, 'Publier la réponse'))))),
      reviewsNote()),
  ];
}

function reviewScreen() {
  const rating = Number(state.form.rating ?? 0);
  return [
    header('Votre avis', 'demandes'),
    h('main', {},
      messages(),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        if (!rating) { state.formError = 'Choisissez une note de 1 à 5.'; render(); return; }
        runForm(async () => {
          await backend.submitReview(state.reviewTarget.id, rating, state.form.comment ?? '', Boolean(state.form.showAuthor) && Boolean(state.profile?.full_name));
          await openRequests();
        });
      } },
      h('h2', {}, 'Votre note'),
      h('div', { class: 'stars', role: 'group', 'aria-label': 'Note sur 5' }, [1, 2, 3, 4, 5].map((n) => h('button', {
        class: `star${n <= rating ? ' is-on' : ''}`, type: 'button', 'aria-label': `${n} sur 5`, 'aria-pressed': String(n === rating),
        onclick: () => { state.form.rating = n; render(); },
      }, '★'))),
      field('Commentaire (facultatif)', 'comment', { type: 'textarea', maxlength: '1000' }),
      state.profile?.full_name
        ? h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: Boolean(state.form.showAuthor), onchange: (e) => { state.form.showAuthor = e.target.checked; } }),
          h('span', {}, `Afficher mon prénom, mon initiale et ma photo de profil sur cet avis`))
        : h('p', { class: 'note' }, 'Pour signer votre avis avec votre prénom et votre photo, complétez d’abord votre profil.'),
      h('p', { class: 'note' }, 'Votre avis est public. Sans cette case, il paraît sous « Client vérifié ». Il disparaît si vous supprimez votre compte.'),
      submit('Publier mon avis', 'Publication'))),
  ];
}

async function openPublicPro(pro) {
  Object.assign(state, { proView: pro, proReviews: null });
  go('pro-public');
  try { state.proReviews = await backend.listProReviews(pro.id); } catch (error) { state.formError = error.message; }
  render();
}
function publicProScreen() {
  const p = state.proView;
  const list = state.proReviews;
  return [
    header(p.name, 'pros'),
    h('main', {},
      messages(),
      p.description && h('p', { class: 'lead' }, p.description),
      trustBadges(p),
      !list && !state.formError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      list?.length === 0 && h('p', { class: 'note' }, 'Aucun avis pour l’instant.'),
      list?.length > 0 && h('p', { class: 'rating-big' }, ratingLabel(list)),
      list?.length > 0 && h('ul', { class: 'reviews' }, list.map((r) => reviewItem(r))),
      reviewsNote()),
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
const STATUS_LABELS = { envoyee: 'Enregistrée', en_route: 'Intervenant en route', en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée', refusee: 'Refusée' };

async function openRequests() {
  Object.assign(state, { proError: null });
  state.requests = null; state.listError = null;
  go('demandes');
  try {
    [state.requests, state.reviewed] = await Promise.all([backend.listRequests(), backend.myReviewedRequests()]);
  } catch (error) { state.listError = error.message; }
  if (!backend.signedIn) { state.loginError = state.listError; go('connexion'); return; }
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
    header('Mes demandes', 'compte'),
    h('main', {},
      state.listError && h('p', { class: 'error', role: 'alert' }, state.listError),
      !state.requests && !state.listError && h('p', { class: 'lead', role: 'status' }, 'Chargement.'),
      state.requests?.length === 0 && h('p', { class: 'lead' }, 'Aucune demande pour l’instant. Photographiez une panne pour commencer.'),
      state.requests?.length > 0 && h('ul', { class: 'pros' }, state.requests.map((r) => {
        const d = describe(r);
        return h('li', {}, h('div', {},
          h('strong', {}, d.symptom),
          h('span', {}, `${r.port ?? d.place}, ${dateFormat.format(new Date(r.created_at))}`),
          h('span', {}, `${STATUS_LABELS[r.status] ?? r.status}, ${r.price_min} à ${r.price_max} €`),
          r.status === 'terminee' && r.pro_id && (state.reviewed.includes(r.id)
            ? h('span', {}, 'Avis envoyé')
            : h('button', { class: 'inline-link', type: 'button', onclick: () => { state.reviewTarget = r; go('avis'); } }, 'Laisser un avis'))));
      }))),
  ];
}

const screens = {
  photo: photoScreen, panne: panneScreen, resultat: resultScreen, pros: prosScreen, suivi: trackScreen,
  connexion: loginScreen, envoi: sendingScreen, demandes: requestsScreen, analyse: analysisScreen,
  supprimer: deleteAccountScreen, inscription: signupScreen, oubli: forgotScreen, 'nouveau-mdp': newPasswordScreen, compte: accountScreen, profil: profileScreen, parametres: settingsScreen, 'pro-fiche': proProfileScreen, 'pro-avis': proReviewsScreen, avis: reviewScreen, 'pro-public': publicProScreen, 'admin-pros': adminProsScreen, 'admin-avis': adminReviewsScreen, contact: contactScreen, envoyee: sentScreen, pro: proScreen, 'pro-demande': proRequestScreen,
};
function render() { app.replaceChildren(...screens[state.screen]().flat().filter(Boolean)); }

async function loadMyPro() {
  if (!backend.signedIn) return;
  const [pro, profile, admin] = await Promise.allSettled([backend.getMyPro(), backend.getProfile(), backend.isAdmin()]);
  state.myPro = pro.value ?? null;
  state.profile = profile.value ?? null;
  state.isAdmin = admin.value === true;
}

async function start() {
  if (location.hash.length > 1) {
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    let outcome;
    try { outcome = await backend.consumeRedirect(hash); } catch (error) { outcome = { error: error.message }; }
    if (outcome.signedIn) await loadMyPro();
    if (outcome.recovery) { go('nouveau-mdp'); return; }
    if (outcome.signedIn && restoreDraft()) { submitRequest(); return; }
    if (outcome.signedIn) {
      const blob = await takePendingPhoto();
      if (blob) {
        Object.assign(state, { photoBlob: blob, photo: URL.createObjectURL(blob) });
        runAnalysis();
        return;
      }
      go('compte'); return;
    }
    if (outcome.error) {
      state.loginError = outcome.error;
      if (restoreDraft()) { go('connexion'); return; }
      state.screen = 'connexion';
    }
  }
  else await loadMyPro();
  render();
}
start();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
