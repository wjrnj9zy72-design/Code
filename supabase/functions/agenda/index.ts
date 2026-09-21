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
 * What the event is called in a calendar.
 *
 * The question makes a poor calendar entry: "Quel soir pour la raclette ?" asks
 * something, and once the day is settled there is nothing left to ask — there
 * is a raclette, and it is on Friday. A name written by hand always wins; the
 * rest is only so that, most of the time, there is nothing to write.
 */
function eventName(poll) {
  if (!poll) return '';
  const own = String(poll.title || '').trim();
  return own || nameFromQuestion(poll.question || '');
}

/**
 * The turns of phrase a date gets asked in, and the thing left over once the
 * date is known.
 *
 * Deliberately timid: each one only fires when what follows is a thing — an
 * article and then a noun. "Quand est-ce qu'on mange ?" leaves a verb behind,
 * and "Mange" is a worse entry than the question itself, so it is left alone.
 * Whatever is not recognised comes back whole, and the field sits in plain
 * sight to be corrected.
 */
const THING = "(?:la|le|les|l['’]|une|un|des|du)\\s+\\S";
const ASKINGS = [
  // "Quel soir pour la raclette ?", "Quelle date pour l'anniversaire de Léa ?"
  /^quel(?:le)?s?\s+\S+\s+pour\s+(.+)$/i,
  // "Quand fait-on la raclette ?", "Quand est-ce qu'on fait la crémaillère ?"
  new RegExp(`^quand\\s+(?:est-ce\\s+qu['’]on|fait-on|faisons-nous|on)\\s+(?:\\S+\\s+)?(${THING}.*)$`, 'i'),
  // "On fait la raclette quand ?"
  new RegExp(`^on\\s+(?:\\S+\\s+){1,2}?(${THING}.*?)\\s+(?:quand|quel(?:le)?s?\\s+\\S+)$`, 'i'),
  // "When for the barbecue?", "What day for the picnic?"
  /^(?:when|what\s+\S+|which\s+\S+)\s+for\s+(.+)$/i,
];

/**
 * The articles one does not put at the head of a calendar entry. Longest
 * first: an alternation takes the first branch that fits, so "le" before
 * "les" would leave an "s" behind.
 */
const ARTICLE = /^(?:de\s+la|de\s+l['’]|des|du|de|les|la|le|l['’]|une|un|the|an|a)\s*/i;

function nameFromQuestion(question) {
  const asked = String(question || '')
    .trim()
    .replace(/\s*[?？]+\s*$/, '')
    .trim();
  if (!asked) return '';

  const matched = ASKINGS.map((pattern) => pattern.exec(asked)).find(Boolean);
  const kept = (matched ? matched[1] : asked).trim().replace(ARTICLE, '').trim();

  // Nothing recognisable under the turn of phrase: the whole question beats an
  // empty name.
  if (!kept) return asked;
  return kept.charAt(0).toUpperCase() + kept.slice(1);
}

/**
 * What a poll has settled, as an event — or nothing, while it has settled
 * nothing. A poll with no day is a question, not an appointment.
 */
function pollEvent(poll, { stamp } = {}) {
  if (!poll || !poll.date) return null;
  return {
    uid: `${poll.id}@together`,
    // Not written into the file — carried so that whatever shows the agenda can
    // send someone back to the thing the day came from.
    kind: 'poll',
    docId: poll.id,
    day: poll.date,
    at: poll.at || null,
    summary: eventName(poll) || 'Sondage',
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
      kind: 'list',
      docId: list.id,
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
