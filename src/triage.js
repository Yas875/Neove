// Règles de tri du pilote. Elles remplaceront l'analyse d'image une fois celle-ci branchée.
// Les fourchettes de prix sont illustratives et restent à valider avec de vrais intervenants.
export const CATEGORIES = [
  {
    id: 'electricite', label: 'Électricité', trade: 'Électricien nautique', price: [90, 350],
    symptoms: [
      { id: 'fumee', label: 'Fumée ou odeur de brûlé', score: 95, danger: true },
      { id: 'panne-totale', label: 'Plus aucun courant à bord', score: 65 },
      { id: 'batteries', label: 'Batteries qui ne tiennent pas la charge', score: 40 },
      { id: 'equipement', label: 'Un équipement ne fonctionne plus', score: 25 },
    ],
  },
  {
    id: 'mecanique', label: 'Moteur', trade: 'Mécanicien bateau', price: [120, 600],
    symptoms: [
      { id: 'voie-eau', label: "De l'eau entre dans le bateau", score: 100, danger: true },
      { id: 'carburant', label: 'Fuite ou odeur de carburant', score: 90, danger: true },
      { id: 'demarrage', label: 'Le moteur ne démarre plus', score: 60 },
      { id: 'surchauffe', label: 'Le moteur surchauffe', score: 55 },
      { id: 'bruit', label: 'Bruit ou vibration inhabituels', score: 30 },
    ],
  },
  {
    id: 'manutention', label: 'Manutention', trade: 'Manutentionnaire', price: [150, 800],
    symptoms: [
      { id: 'sortie-urgente', label: "Sortir le bateau de l'eau en urgence", score: 75 },
      { id: 'grutage', label: 'Prévoir un grutage ou un levage', score: 25 },
      { id: 'transport', label: 'Déplacer le bateau', score: 15 },
    ],
  },
];

export const LOCATIONS = [
  { id: 'nice', label: 'Nice', lat: 43.695, lng: 7.285, ports: ['Port de Nice (Lympia)'] },
  { id: 'saint-augustin', label: 'Saint-Augustin', lat: 43.669, lng: 7.205 },
  { id: 'carros', label: 'Carros', lat: 43.793, lng: 7.187 },
  { id: 'antibes', label: 'Antibes', lat: 43.585, lng: 7.128, ports: ['Port Vauban', 'Port Gallice', 'Port de la Salis', 'Port du Croûton'] },
];

export function urgencyLevel(score) {
  if (score >= 85) return { id: 'critique', label: 'Critique', delay: 'Agir maintenant' };
  if (score >= 50) return { id: 'haute', label: 'Urgent', delay: 'Intervention sous 24 h à viser' };
  return { id: 'normale', label: 'À planifier', delay: 'Intervention à programmer' };
}

// aFlot : le bateau est à l'eau. Cela aggrave un problème moteur ou électrique, sans dépasser 100.
export function triage(categoryId, symptomId, aFlot = true) {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  const symptom = category?.symptoms.find((s) => s.id === symptomId);
  if (!symptom) throw new Error(`Panne inconnue : ${categoryId}/${symptomId}`);
  const score = Math.min(100, symptom.score + (aFlot && categoryId !== 'manutention' ? 5 : 0));
  return {
    category, symptom, score, level: urgencyLevel(score),
    danger: Boolean(symptom.danger),
    price: { min: category.price[0], max: category.price[1] },
  };
}

export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Seuls les pros vérifiés du bon métier sont retenus, du plus proche au plus éloigné.
export function matchPros(pros, categoryId, location) {
  return pros
    .filter((p) => p.verified && p.category === categoryId)
    .map((p) => ({ ...p, distance: distanceKm(location, p) }))
    .sort((a, b) => a.distance - b.distance);
}
