/**
 * L'agenda d'un groupe, en .ics, à l'adresse à laquelle les agendas s'abonnent.
 *
 * Ce fichier est la source ; ce qui se déploie est `index.ts`, construit par
 * `node tools/bundle.js` — un seul fichier, sans import, pour qu'il se colle
 * tel quel dans l'éditeur de Supabase. Ne modifiez pas `index.ts` à la main.
 *
 * La fonction ne connaît qu'un jeton et ne lit que ce que la base veut bien
 * lui rendre : les listes et les sondages du groupe correspondant. Elle ne voit
 * ni clé, ni partie, ni rien d'un autre groupe.
 */

import { agendaFor, icsFor } from '../../../src/ics.js';

const BASE = Deno.env.get('SUPABASE_URL');
const KEY = Deno.env.get('SUPABASE_ANON_KEY');

/** Une réponse en texte brut : ce que lit un humain qui ouvre l'adresse à la main. */
function plain(message, status) {
  return new Response(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return plain('Seul GET est servi ici.', 405);
  }

  // Deux formes, parce que tous les agendas ne lisent pas les mêmes adresses :
  //
  //   …/functions/v1/agenda/<jeton>.ics   ce que la plupart attendent
  //   …/functions/v1/agenda?c=<jeton>     la première forme servie
  //
  // Certaines applications refusent une adresse qui ne finit pas par .ics, ou
  // qui porte un « ? ». Les deux restent servies pour toujours : un abonnement
  // déjà pris ne doit pas cesser de fonctionner parce qu'une autre forme est
  // apparue.
  const url = new URL(request.url);
  const inPath = /\/agenda\/([0-9a-fA-F]{32})(?:\.ics)?$/.exec(url.pathname);
  // Mis en minuscules : de l'hexadécimal recopié en majuscules désigne le même
  // jeton, et la base le range en minuscules.
  const token = (inPath ? inPath[1] : url.searchParams.get('c') ?? '').toLowerCase();

  // Vérifié ici plutôt que par la base : une adresse mal recopiée ne doit pas
  // compter comme un essai raté, sans quoi un agenda qui réessaie toutes les
  // heures finirait par bloquer les vrais.
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return plain('Adresse incomplète : il manque le jeton.', 400);
  }

  let answer;
  try {
    answer = await fetch(`${BASE}/rest/v1/rpc/marque_points_agenda`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ p_token: token }),
    });
  } catch {
    return plain('La base n’a pas répondu.', 502);
  }

  if (!answer.ok) return plain('La base n’a pas répondu.', 502);
  const result = await answer.json().catch(() => null);

  if (result?.status === 'busy') return plain('Trop d’essais. Réessayez tout à l’heure.', 429);
  if (result?.status !== 'ok') return plain('Cette adresse ne mène à aucun agenda.', 404);

  const docs = Array.isArray(result.docs) ? result.docs : [];
  const text = icsFor(
    agendaFor({
      lists: docs.filter((document_) => document_?.kind === 'list'),
      polls: docs.filter((document_) => document_?.kind === 'poll'),
    }),
    { name: result.name || 'Together' },
  );

  return new Response(request.method === 'HEAD' ? null : text, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="together.ics"',
      // Les agendas relisent l'adresse d'eux-mêmes, souvent plus souvent
      // qu'il ne faudrait : un quart d'heure de repos leur va très bien.
      'cache-control': 'public, max-age=900',
    },
  });
});
