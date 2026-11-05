import { CATEGORIES, LOCATIONS, matchPros, triage, urgencyLevel } from './triage.js';
import { DEMO_PROS } from './demo-data.js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { createBackend, toRequestRow } from './backend.js';
import { compressPhoto, savePendingPhoto, takePendingPhoto } from './pending-photo.js';

const STEPS = ['Demande enregistrée', 'Intervenant en route', 'Intervention en cours', 'Intervention terminée'];
const app = document.querySelector('#app');
const DRAFT_KEY = 'neove.brouillon';
const state = {
  screen: 'photo', photo: null, category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0,
  saving: false, saveError: null, loginEmail: null, loginError: null, sending: false, requests: null, listError: null,
  deleting: false, deleteError: null, accountDeleted: false, realPros: null, phone: '', myPro: null, proRequests: null, proError: null, proCurrent: null, proPhoto: null, proBusy: false,
  photoBlob: null, photoPath: null, photoError: null, suggestion: null, analysisError: null, loginBack: 'pros', loginTitle: '',
};

function safeStorage() {
  try { return window.localStorage; } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
const storage = safeStorage();
const backend = createBackend({ url: SUPABASE_URL, key: SUPABASE_KEY, fetch: (...a) => window.fetch(...a), storage });

function saveDraft() {
  const { category, symptom, location: place, aFlot, pro, photoPath, phone } = state;
  try { storage.setItem(DRAFT_KEY, JSON.stringify({ category, symptom, location: place, aFlot, pro, photoPath, phone })); } catch { /* facultatif */ }
}
function clearDraft() { try { storage.removeItem(DRAFT_KEY); } catch { /* rien à effacer */ } }
function restoreDraft() {
  try {
    const d = JSON.parse(storage.getItem(DRAFT_KEY));
    if (!d) return false;
    triage(d.category, d.symptom, d.aFlot);
    const pro = d.pro;
    if (!pro?.id || !pro.name || pro.category !== d.category || !LOCATIONS.some((l) => l.id === d.location)) throw new Error('Brouillon invalide');
    Object.assign(state, { category: d.category, symptom: d.symptom, location: d.location, aFlot: Boolean(d.aFlot), pro, photoPath: typeof d.photoPath === 'string' ? d.photoPath : null, phone: typeof d.phone === 'string' ? d.phone : '' });
    return true;
  } catch { clearDraft(); return false; }
}

async function submitRequest() {
  if (state.saving) return;
  state.saving = true; state.saveError = null; state.step = 0;
  go('envoi');
  try {
    const result = triage(state.category, state.symptom, state.aFlot);
    await backend.createRequest(toRequestRow(result, state.location, state.aFlot, state.photoPath, state.pro.real ? state.pro.id : null, state.pro.real ? state.phone : null));
    clearDraft();
    state.saving = false;
    go(state.pro.real ? 'envoyee' : 'suivi');
  } catch (error) {
    state.saving = false;
    if (!backend.signedIn) { state.loginError = error.message; go('connexion'); return; }
    state.saveError = error.message;
    go('envoi');
  }
}

function resetFlow() {
  if (state.photo) URL.revokeObjectURL(state.photo);
  Object.assign(state, {
    photo: null, photoBlob: null, photoPath: null, photoError: null, suggestion: null, analysisError: null,
    category: null, symptom: null, location: null, aFlot: true, pro: null, step: 0, saveError: null, phone: '',
  });
}

async function startAnalysis() {
  if (backend.signedIn) { runAnalysis(); return; }
  clearDraft();
  await savePendingPhoto(state.photoBlob);
  Object.assign(state, { loginEmail: null, loginError: null, loginBack: 'photo', loginTitle: 'Connectez-vous pour analyser la photo' });
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
      await savePendingPhoto(state.photoBlob);
      Object.assign(state, { loginEmail: null, loginError: error.message, loginBack: 'photo', loginTitle: 'Connectez-vous pour analyser la photo' });
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
const go = (screen) => { if (screen === 'connexion-retour') { state.loginEmail = null; screen = 'connexion'; } state.screen = screen; render(); window.scrollTo(0, 0); document.querySelector('h1')?.focus(); };
const header = (title, back) => h('header', { class: 'top' },
  back ? h('button', { class: 'back', type: 'button', onclick: () => go(back) }, 'Retour') : h('span', { class: 'brand' }, h('img', { src: 'icon-192.png', alt: '', width: '32', height: '32' }), 'Seravia'),
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
    header('Quel est le problème à bord ?'),
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
      !state.photo && h('ol', { class: 'howto' },
        h('li', {}, h('strong', {}, 'Montrez la panne'), h('span', {}, 'Une photo, ou quelques questions si vous préférez.')),
        h('li', {}, h('strong', {}, 'Voyez l’urgence'), h('span', {}, 'Avec un premier repère de prix, à confirmer après diagnostic.')),
        h('li', {}, h('strong', {}, 'Trouvez un intervenant'), h('span', {}, 'Du plus proche au plus éloigné de votre bateau.'))),
      !state.photo && h('p', { class: 'sos' }, 'En cas de danger, appelez le ', h('a', { href: 'tel:196' }, '196'), ' en mer ou le ', h('a', { href: 'tel:112' }, '112'), ' à quai.'),
      backend.signedIn && h('button', { class: 'link', type: 'button', onclick: openRequests }, 'Voir mes demandes'),
      state.myPro && h('button', { class: 'link', type: 'button', onclick: openProSpace }, 'Espace intervenant'),
      !backend.signedIn && h('button', { class: 'link', type: 'button', onclick: () => {
        clearDraft();
        Object.assign(state, { loginEmail: null, loginError: null, loginBack: 'photo', loginTitle: 'Connexion intervenant' });
        go('connexion');
      } }, 'Accès intervenant')),
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
  const category = CATEGORIES.find((c) => c.id === state.category);
  const ready = state.symptom && state.location;
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
  }
  const real = matchPros(state.realPros, state.category, location).map((p) => ({ ...p, real: true }));
  const pros = real.length ? real : matchPros(DEMO_PROS, state.category, location);
  return [
    header(`${r.category.trade} près de ${location.label}`, 'resultat'),
    h('main', {},
      !real.length && h('p', { class: 'demo' }, 'Intervenants fictifs : cette version sert de démonstration.'),
      h('ul', { class: 'pros' }, pros.map((p) => h('li', {},
        h('div', {}, h('strong', {}, p.name), h('span', {}, p.distance < 1 ? 'Moins de 1 km à vol d’oiseau' : `${p.distance.toFixed(1).replace('.', ',')} km à vol d’oiseau`)),
        h('button', { class: 'pick', type: 'button', onclick: () => {
          state.pro = p; saveDraft();
          if (p.real) go('contact');
          else if (backend.signedIn) submitRequest();
          else { Object.assign(state, { loginEmail: null, loginError: null, loginBack: 'pros', loginTitle: 'Connectez-vous pour enregistrer la demande' }); go('connexion'); }
        } }, 'Choisir'))))),
  ];
}

function contactScreen() {
  const input = h('input', { id: 'phone', type: 'tel', autocomplete: 'tel', required: true, minlength: '6', maxlength: '30', value: state.phone });
  return [
    header('Comment vous joindre ?', 'pros'),
    h('main', {}, h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        state.phone = input.value.trim();
        saveDraft();
        if (backend.signedIn) submitRequest();
        else { Object.assign(state, { loginEmail: null, loginError: null, loginBack: 'contact', loginTitle: 'Connectez-vous pour envoyer la demande' }); go('connexion'); }
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
    header(state.myPro.verified ? state.myPro.name : 'Fiche en attente de vérification', 'photo'),
    h('main', {},
      !state.myPro.verified && h('p', { class: 'lead' }, 'Vous recevrez des demandes une fois votre fiche vérifiée.'),
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
      state.proPhoto && h('img', { class: 'pro-photo', src: state.proPhoto, alt: 'Photo envoyée par le plaisancier' }),
      h('dl', { class: 'facts' },
        h('dt', {}, 'État'), h('dd', {}, STATUS_LABELS[r.status] ?? r.status),
        h('dt', {}, 'Lieu'), h('dd', {}, `${d.place}, ${r.afloat ? 'à flot' : 'à terre'}`),
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
    header('Supprimer votre compte ?', 'demandes'),
    h('main', {},
      state.deleteError && h('p', { class: 'error', role: 'alert' }, state.deleteError),
      h('p', { class: 'lead' }, 'Votre compte, vos demandes et vos photos seront supprimés définitivement. Cette action ne peut pas être annulée.'),
      state.myPro && h('p', { class: 'note' }, 'Votre fiche d’intervenant ne sera plus proposée aux plaisanciers.'),
      h('button', { class: 'primary danger-action', type: 'button', disabled: state.deleting, onclick: async () => {
        state.deleting = true; state.deleteError = null; render();
        try {
          await backend.deleteAccount();
          clearDraft(); await takePendingPhoto();
          state.myPro = null; resetFlow(); state.deleting = false; state.accountDeleted = true;
          go('photo');
        } catch (error) { state.deleting = false; state.deleteError = error.message; render(); }
      } }, state.deleting ? 'Suppression en cours' : 'Supprimer définitivement'),
      h('button', { class: 'secondary', type: 'button', disabled: state.deleting, onclick: () => go('demandes') }, 'Garder mon compte')),
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
    header(state.loginTitle || 'Connectez-vous', state.loginBack),
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
const STATUS_LABELS = { envoyee: 'Enregistrée', en_route: 'Intervenant en route', en_cours: 'En cours', terminee: 'Terminée', annulee: 'Annulée', refusee: 'Refusée' };

async function openRequests() {
  Object.assign(state, { proError: null });
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
      h('button', { class: 'link', type: 'button', onclick: async () => { await backend.signOut(); state.myPro = null; resetFlow(); go('photo'); } }, 'Se déconnecter'),
      h('button', { class: 'link link-danger', type: 'button', onclick: () => { state.deleteError = null; go('supprimer'); } }, 'Supprimer mon compte')),
  ];
}

const screens = {
  photo: photoScreen, panne: panneScreen, resultat: resultScreen, pros: prosScreen, suivi: trackScreen,
  connexion: loginScreen, envoi: sendingScreen, demandes: requestsScreen, analyse: analysisScreen,
  supprimer: deleteAccountScreen, contact: contactScreen, envoyee: sentScreen, pro: proScreen, 'pro-demande': proRequestScreen,
};
function render() { app.replaceChildren(...screens[state.screen]().flat().filter(Boolean)); }

async function loadMyPro() {
  if (!backend.signedIn) return;
  try { state.myPro = await backend.getMyPro(); } catch { state.myPro = null; }
}

async function start() {
  if (location.hash.length > 1) {
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    let outcome;
    try { outcome = await backend.consumeRedirect(hash); } catch (error) { outcome = { error: error.message }; }
    if (outcome.signedIn) await loadMyPro();
    if (outcome.signedIn && restoreDraft()) { submitRequest(); return; }
    if (outcome.signedIn) {
      const blob = await takePendingPhoto();
      if (blob) {
        Object.assign(state, { photoBlob: blob, photo: URL.createObjectURL(blob) });
        runAnalysis();
        return;
      }
      if (state.myPro) { openProSpace(); return; }
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
