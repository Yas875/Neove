// Fonction serveur : la clé du modèle reste ici, jamais dans l'app.
import { handle } from './lib.js';

Deno.serve((req: Request) => handle(req, Deno.env.toObject(), fetch));
