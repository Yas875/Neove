import { SUPABASE_KEY, SUPABASE_URL } from './config.js';
import { sendLead } from './pro-lead.js';

const form = document.querySelector('#pro-form');
const status = document.querySelector('#pro-status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Envoi en cours';
  status.className = 'form-status';
  status.textContent = '';
  try {
    await sendLead(Object.fromEntries(new FormData(form)), { url: SUPABASE_URL, key: SUPABASE_KEY, fetcher: (...a) => window.fetch(...a) });
    form.hidden = true;
    status.textContent = 'Merci, vos coordonnées sont enregistrées. Nous vous recontacterons.';
    status.classList.add('is-ok');
    status.focus();
  } catch {
    status.textContent = 'L’envoi a échoué. Vérifiez vos informations et votre connexion, puis réessayez.';
    status.classList.add('is-error');
    button.disabled = false;
    button.textContent = 'Envoyer mes coordonnées';
  }
});
