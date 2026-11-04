# Azurio

Pilote de conciergerie d'intervenants, limité au nautisme sur Nice, Saint-Augustin, Carros et Antibes.

- Application sans dépendance ni étape de build : modules ES, `npm start`, `npm test`.
- Interface en français. Tout contenu simulé doit être présenté comme tel à l'utilisateur.
- Modifier `FILES` et `VERSION` dans `sw.js` quand les fichiers mis en cache changent.
- Ne jamais mettre de clé secrète dans le code client. Toute table Supabase a une politique RLS.
- `src/config.js` ne contient que des valeurs publiques. Le client Supabase est écrit à la main dans `src/backend.js`.
