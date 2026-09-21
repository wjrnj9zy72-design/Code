// Généré par tools/bundle.js — modifiez les sources, pas ce fichier.
//
// Collez ce fichier dans Supabase → Edge Functions, sous le nom « agenda »,
// avec la vérification du JWT **désactivée** : un agenda qui s'abonne ne peut
// envoyer aucun en-tête. Voir docs/DEPLOIEMENT.md, étape 8.
/**
 * The calendar file: what the app has settled, in the one format every
 * calendar on earth already reads.
 *
 * iCalendar (RFC 5545) is written by hand here, like the .docx and the .pdf,
 * for the same reason: it is a text format with a handful of rules, and a
 * dependency would weigh more than the rules do.
 *
 * Two kinds of thing end up in it — a poll that has settled on a day, and a
 * line that is due on one. Both are days rather than instants, so both are
 * all-day events unless an hour was given; a day carries no time zone, which
 * is exactly why a family calendar can be read from anywhere without anything
 * moving.
 *
 * Pure: documents in, one string out.
 */

/** The characters iCalendar reserves inside a value. */
function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Lines are folded at 75 octets — octets, not characters: an accented letter
 * weighs two, and a fold counted in characters splits one of them in half and
 * hands the calendar a broken file. The continuation starts with one space.
 */
function foldLine(line) {
  const bytes = new TextEncoder().encode(String(line));
  if (bytes.length <= 75) return String(line);

  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut inside a character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
    parts.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    // Every line after the first carries a leading space of its own.
    limit = 74;
  }
  return parts.join('\r\n ');
}

/** `AAAA-MM-JJ` as iCalendar writes a day: `AAAAMMJJ`. */
function stampDay(day) {
  return String(day || '').replace(/-/g, '');
}

/** The day after, which is where an all-day event ends: DTEND is exclusive. */
function dayAfter(day) {
  const [year, month, date] = String(day).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const pad = (value) => String(value).padStart(2, '0');
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/** An instant, in the UTC form iCalendar uses for DTSTAMP. */
function stampNow(at) {
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * One event.
 *
 * With an hour, the time is written without a zone — "floating" local time,
 * which every calendar reads as the reader's own clock. A dinner at eight is
 * at eight; carrying a time zone would only be right until someone travels.
 */
function vevent({ uid, day, at = null, summary, description = '', stamp = Date.now() }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${stampNow(stamp)}`,
  ];

  if (at) {
    const [hour, minute] = String(at).split(':');
    const end = String(Number(hour) + 1).padStart(2, '0');
    lines.push(`DTSTART:${stampDay(day)}T${hour}${minute}00`);
    lines.push(`DTEND:${stampDay(day)}T${end}${minute}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${stampDay(day)}`);
    lines.push(`DTEND;VALUE=DATE:${dayAfter(day)}`);
  }

  lines.push(`SUMMARY:${icsEscape(summary)}`);
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * A whole calendar. CRLF between lines, and a trailing one: readers are
 * forgiving about it, and the specification is not.
 */
function icsFor(events, { name = 'Together' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Together//Calendrier//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    ...events.flatMap((event) => vevent(event)),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * What a poll has settled, as an event — or nothing, while it has settled
 * nothing. A poll with no day is a question, not an appointment.
 */
function pollEvent(poll, { stamp } = {}) {
  if (!poll || !poll.date) return null;
  return {
    uid: `${poll.id}@together`,
    day: poll.date,
    at: poll.at || null,
    summary: poll.question || 'Sondage',
    description: poll.people?.length ? poll.people.map((person) => person.name).join(', ') : '',
    stamp: stamp ?? poll.updatedAt ?? Date.now(),
  };
}

/** Every line of a list that is due on a day, each on its day. */
function listEvents(list, { stamp } = {}) {
  if (!list || !Array.isArray(list.items)) return [];
  return list.items
    .filter((item) => item.due && !item.done)
    .map((item) => ({
      uid: `${item.id}@together`,
      day: item.due,
      at: null,
      summary: item.text,
      description: [list.name, list.people?.find((person) => person.id === item.who)?.name]
        .filter(Boolean)
        .join(' · '),
      stamp: stamp ?? item.updatedAt ?? Date.now(),
    }));
}

/**
 * Everything one group has put on a day: its settled polls, then the lines
 * still to do. Archived documents and models are left out — the calendar is
 * for what is still coming, not for what has been put away.
 */
function agendaFor({ lists = [], polls = [] } = {}, groupId = '') {
  const mine = (document_) => (groupId ? document_.groupId === groupId : true);
  const live = (document_) => !document_.archivedAt && !document_.template;

  const events = [
    ...polls.filter((poll) => mine(poll) && live(poll)).map((poll) => pollEvent(poll)).filter(Boolean),
    ...lists.filter((list) => mine(list) && live(list)).flatMap((list) => listEvents(list)),
  ];
  return events.sort((a, b) => a.day.localeCompare(b.day) || a.summary.localeCompare(b.summary));
}

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

  const token = new URL(request.url).searchParams.get('c') ?? '';
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
