// La clé d'administration reste côté serveur.
import { handle } from './lib.js';

Deno.serve((req: Request) => handle(req, Deno.env.toObject(), fetch));
