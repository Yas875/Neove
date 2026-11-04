# Neove : pilote nautisme

Application web installable sur téléphone : photographier une panne à bord, connaître son urgence et un prix indicatif, choisir un intervenant proche, puis suivre l'intervention. Zone pilote : Nice, Saint-Augustin, Carros et Antibes.

## Lancer le pilote

Il faut Node.js 20 ou plus récent. Aucune dépendance n'est à installer.

```bash
npm start   # http://localhost:4173
npm test
```

## Réglage de la connexion

Dans Supabase, ouvrez **Authentication → URL Configuration** et ajoutez `http://localhost:4173/` aux **Redirect URLs**, ainsi que l'adresse publique de l'app une fois en ligne.

## Publication

L'app est prévue pour GitHub Pages, sans étape de build : **Settings → Pages**, source **Deploy from a branch**, branche `main`, dossier `/ (root)`. Adresse attendue : `https://yas875.github.io/Neove/`, à ajouter aussi aux **Redirect URLs** de Supabase.

Ce site et le dépôt sont publics. Modifier `VERSION` dans `sw.js` à chaque changement d'un fichier en cache, sinon les téléphones garderont l'ancienne version.

## Ce qui est réel et ce qui reste simulé

| Étape | État actuel | Étape suivante |
| --- | --- | --- |
| Photo | Réelle, conservée sur le téléphone | Stockage sécurisé |
| Analyse | Règles basées sur les réponses, sans lecture de la photo | Modèle de vision |
| Prix | Fourchettes illustratives | Validation avec des intervenants |
| Intervenants | Fictifs | Pros vérifiés de la zone pilote |
| Suivi | Simulé, aucun intervenant n'est prévenu | Statuts en temps réel |
| Comptes et demandes | Réels : connexion par e-mail, demandes enregistrées dans Supabase | Prévenir les intervenants |

## Organisation

- `src/triage.js` : urgence, prix et matching
- `src/demo-data.js` : intervenants fictifs
- `src/backend.js`, `src/config.js` : connexion et demandes via Supabase
- `src/app.js`, `src/styles.css` : interface
- `sw.js`, `manifest.webmanifest` : installation et mode hors ligne
- `supabase/config.toml`, `supabase/migrations/` : configuration et schéma de base de données
