// Envoie les coordonnées d'un professionnel. Seule l'insertion est autorisée pour le public.
export const TRADES = ['electricite', 'mecanique', 'manutention', 'autre'];

export function leadFromForm(values) {
  const clean = (key) => String(values[key] ?? '').trim();
  return {
    company: clean('company'), contact_name: clean('contact_name'), trade: clean('trade'),
    city: clean('city'), phone: clean('phone'), email: clean('email'), message: clean('message') || null,
  };
}

export async function sendLead(values, { url, key, fetcher }) {
  // Champ invisible rempli seulement par certains robots : on fait comme si l'envoi avait réussi.
  if (String(values.website ?? '').trim()) return { sent: true, ignored: true };
  const res = await fetcher(`${url}/rest/v1/pro_leads`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(leadFromForm(values)),
  });
  if (!res.ok) throw new Error(`Envoi refusé : ${res.status}`);
  return { sent: true };
}
