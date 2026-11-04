// Intervenants FICTIFS pour la démonstration. À remplacer par de vrais pros vérifiés.
const spots = {
  nice: { lat: 43.695, lng: 7.285 }, augustin: { lat: 43.669, lng: 7.205 },
  carros: { lat: 43.793, lng: 7.187 }, antibes: { lat: 43.585, lng: 7.128 },
};
const pro = (id, name, category, spot, verified = true) => ({ id, name, category, verified, ...spots[spot] });

export const DEMO_PROS = [
  pro('e1', 'Électricien démo A', 'electricite', 'antibes'),
  pro('e2', 'Électricien démo B', 'electricite', 'nice'),
  pro('e3', 'Électricien démo C (non vérifié)', 'electricite', 'nice', false),
  pro('m1', 'Mécanicien démo A', 'mecanique', 'nice'),
  pro('m2', 'Mécanicien démo B', 'mecanique', 'antibes'),
  pro('m3', 'Mécanicien démo C', 'mecanique', 'carros'),
  pro('l1', 'Manutention démo A', 'manutention', 'antibes'),
  pro('l2', 'Manutention démo B', 'manutention', 'augustin'),
];
