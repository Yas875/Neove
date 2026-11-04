# Neove : pilote nautisme

Application web installable sur téléphone : photographier une panne à bord, connaître son urgence et un prix indicatif, choisir un intervenant proche, puis suivre l'intervention. Zone pilote : Nice, Saint-Augustin, Carros et Antibes.

## Lancer le pilote

Il faut Node.js 20 ou plus récent. Aucune dépendance n'est à installer.

```bash
npm start   # http://localhost:4173
npm test
```

## Ce qui est réel et ce qui reste simulé

| Étape | État actuel | Étape suivante |
| --- | --- | --- |
| Photo | Réelle, conservée sur le téléphone | Stockage sécurisé |
| Analyse | Règles basées sur les réponses, sans lecture de la photo | Modèle de vision |
| Prix | Fourchettes illustratives | Validation avec des intervenants |
| Intervenants | Fictifs | Pros vérifiés de la zone pilote |
| Suivi | Simulé | Statuts en temps réel |
| Comptes et données | Aucun | Migration `supabase/migrations/0001_init.sql`, non appliquée |

## Organisation

- `src/triage.js` : urgence, prix et matching
- `src/demo-data.js` : intervenants fictifs
- `src/app.js`, `src/styles.css` : interface
- `sw.js`, `manifest.webmanifest` : installation et mode hors ligne
- `supabase/migrations/` : schéma de base de données
