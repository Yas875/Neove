// Appelée par la base à chaque demande adressée à un intervenant, avec une clé dédiée.
import { handle } from './lib.js';

Deno.serve((req: Request) => handle(req, Deno.env.toObject(), fetch));
