// Appelée chaque jour par une tâche planifiée, avec une clé dédiée.
import { handle } from './lib.js';

Deno.serve((req: Request) => handle(req, Deno.env.toObject(), fetch));
