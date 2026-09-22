/**
 * The shared games database.
 *
 * A copy of the app that carries a configuration (src/config.js) keeps every
 * game in a small hosted database as well as in the browser, so a link to a
 * game opens that same game for someone else.
 *
 * It speaks plain HTTP to a handful of Postgres functions — no client library,
 * so the app keeps its "no dependencies" property. The table itself is never
 * exposed: the only things reachable are `read one game by id` and `write one
 * game by id`, which means a game can only be found by someone who has its
 * link.
 *
 * Sharing is held by groups. A group — the family, the Tuesday card players —
 * is a circle of people; whoever is in it can start sharing there and sees
 * everything shared in it. Contributing to something already shared needs
 * nothing at all.
 *
 * A device does not let itself in. It knocks — with the group's name, six
 * digits from an invitation, and the first name of whoever is asking — and
 * someone in the group accepts or refuses. Accepted, the ticket it was given
 * becomes its own key; refused, it never opened anything. Each device has its
 * own key, so one can be cut off without disturbing the others, and only the
 * keys marked as admitting can let anyone in.
 *
 * A lot — a link that hands over several things at once — goes through its own
 * functions, because it is protected differently: writing one takes a group's
 * key, and reading one takes the six-digit code drawn for that share, which
 * the database allows ten attempts at.
 *
 * Every call is defensive. The network fails, the configuration may be wrong,
 * the service may be down: none of that may stop someone keeping score, so a
 * failure leaves the local copy in place and is reported, never thrown at the
 * player.
 */

const PATH = '/rest/v1/rpc/';
const TIMEOUT_MS = 8000;

/** Make a client, or null when this copy of the app has no database. */
/**
 * The project's address, whichever of its forms was copied.
 *
 * The settings page shows both the project URL and the REST endpoint, which
 * is that URL plus `/rest/v1` — and pasting the second one would otherwise
 * build `/rest/v1/rest/v1/rpc/...` and fail on every call, with nothing to
 * suggest why. Both forms are accepted, with or without a trailing slash.
 */
export function normaliseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '')
    .replace(/\/+$/, '');
}

export function createRemote(config, fetchImpl = globalThis.fetch) {
  if (!config?.url || !config?.key || typeof fetchImpl !== 'function') return null;
  const base = normaliseUrl(config.url);

  async function call(fn, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${base}${PATH}${fn}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          apikey: config.key,
          authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`${fn} failed: ${response.status} ${detail.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }
      // A function returning void answers 204 with an empty body.
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * The group a key opens — its id and its name — or null when the key
     * opens nothing. Showing the name is what turns "key accepted" into
     * "you are in Mifa".
     */
    async groupOf(key) {
      const group = await call('marque_points_group_of', { p_key: key });
      if (!group || typeof group !== 'object' || !group.id) return null;
      return { ...group, admits: Boolean(group.admits) };
    },

    /**
     * Invite: the database draws six digits, good for as long and for as many
     * people as asked. Being in the group is what allows it.
     * Returns { code, name, minutes, uses }.
     */
    async invite(key, minutes = 30, uses = 1) {
      const answer = await call('marque_points_invite', {
        p_key: key,
        p_minutes: minutes,
        p_uses: uses,
      });
      return answer && typeof answer.code === 'string' ? answer : null;
    },

    /**
     * Knock: the group's name, the six digits, and the first name of whoever is
     * asking. Nothing is opened by this — what comes back is a ticket this
     * device keeps, and which becomes its key the day someone in the group
     * accepts. Until then it sees nothing at all.
     *
     * Returns { status: 'waiting', ticket, id, name } | { status: 'unknown' }
     *       | { status: 'busy' }
     */
    async ask(name, code, who = '', label = '') {
      const answer = await call('marque_points_ask', {
        p_name: name,
        p_code: code,
        p_who: who,
        p_label: label,
      });
      const status = answer?.status;
      if (status === 'waiting' && typeof answer.ticket === 'string') {
        return { status, ticket: answer.ticket, id: answer.id, name: answer.name };
      }
      return { status: status === 'busy' ? 'busy' : 'unknown' };
    },

    /**
     * "Well? Am I in?" — asked with the ticket. Accepted, that ticket is this
     * device's key from then on, so there is nothing to receive.
     *
     * Returns { status: 'ok', id, name } | { status: 'waiting', name }
     *       | { status: 'refused' } | { status: 'unknown' }
     */
    async claim(ticket) {
      const answer = await call('marque_points_claim', { p_ticket: ticket });
      const status = answer?.status;
      if (status === 'ok' && answer.id) return { status, id: answer.id, name: answer.name || '' };
      if (status === 'waiting') return { status, name: answer.name || '' };
      if (status === 'refused') return { status };
      return { status: 'unknown' };
    },

    /**
     * Who is knocking: the requests still waiting, for a key that admits. An
     * ordinary key is refused by the database, which is how a device knows it
     * is not the one who lets people in.
     */
    async requests(key) {
      const rows = await call('marque_points_requests', { p_key: key });
      return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : [];
    },

    /** Accept, or refuse. Returns 'ok' | 'refused' | 'unknown'. */
    async answer(key, id, accept) {
      const answer = await call('marque_points_answer', {
        p_key: key,
        p_id: id,
        p_accept: Boolean(accept),
      });
      const status = answer?.status;
      return status === 'ok' || status === 'refused' ? status : 'unknown';
    },

    /** The devices in the group, one line each — for a key that admits. */
    async groupKeys(key) {
      const rows = await call('marque_points_group_keys', { p_key: key });
      return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : [];
    },

    /**
     * This device's return link, drawn by itself: a token that brings its person
     * back into the group from any browser, without anyone accepting again.
     *
     * It is minted here, shown once, and never known to whoever admits people —
     * it belongs to the person, not to the gatekeeper. Drawing a new one kills
     * the previous. Returns { status: 'ok', token, name } | { status: 'none' }
     * for a key that belongs to no person (yours, or one from before).
     */
    async myLink(key) {
      const answer = await call('marque_points_my_link', { p_key: key });
      const status = answer?.status;
      if (status === 'ok' && typeof answer.token === 'string') {
        return { status, token: answer.token, name: answer.name || '' };
      }
      return { status: 'none' };
    },

    /**
     * Come back with that link: a key of this device's own, tied to the same
     * person, with nothing to ask of anyone.
     *
     * Returns { status: 'ok', key, who, id, name } | { status: 'unknown' }
     *       | { status: 'busy' }
     */
    async returnWith(token, label = '') {
      const answer = await call('marque_points_return', { p_token: token, p_label: label });
      const status = answer?.status;
      if (status === 'ok' && answer.key && answer.id) {
        return { status, key: answer.key, who: answer.who || '', id: answer.id, name: answer.name || '' };
      }
      return { status: status === 'busy' ? 'busy' : 'unknown' };
    },

    /**
     * The group's calendar address, made the first time it is asked for.
     *
     * One per group, and any key of the group may have it: the calendar is
     * everyone's. Returns { status: 'ok', token, name } | { status: 'unknown' }.
     */
    async calendar(key) {
      const answer = await call('marque_points_calendar', { p_key: key });
      if (answer?.status === 'ok' && typeof answer.token === 'string') {
        return { status: 'ok', token: answer.token, name: answer.name || '' };
      }
      return { status: 'unknown' };
    },

    /** Cut the calendar address: every subscribed calendar stops. 'ok' | 'unknown'. */
    async forgetCalendar(key) {
      const answer = await call('marque_points_forget_calendar', { p_key: key });
      return answer?.status === 'ok' ? 'ok' : 'unknown';
    },

    /**
     * Where that token is served. The function lives beside the database, at
     * the project's own address — the same one the app already talks to, minus
     * the REST path it was given with.
     *
     * Written as a path ending in `.ics`: several calendars refuse an address
     * that does not look like a calendar file, or that carries a query string.
     * The older `?c=` form is still served, so an existing subscription keeps
     * working — this is what is *offered*, not the only thing accepted.
     */
    calendarUrl(token) {
      return `${base}/functions/v1/agenda/${encodeURIComponent(token)}.ics`;
    },

    /** Cut a person's return link. Returns 'ok' | 'unknown'. */
    async forgetLink(key, person) {
      const answer = await call('marque_points_forget_link', { p_key: key, p_person: person });
      return answer?.status === 'ok' ? 'ok' : 'unknown';
    },

    /**
     * Let a device let people in, or stop it. Returns 'ok' | 'last' | 'unknown'
     * — 'last' when it would leave the group with nobody to accept anyone.
     */
    async setAdmits(key, id, allow) {
      const answer = await call('marque_points_set_admits', {
        p_key: key,
        p_id: id,
        p_allow: Boolean(allow),
      });
      const status = answer?.status;
      return status === 'ok' || status === 'last' ? status : 'unknown';
    },

    /**
     * Cut one device off. Returns 'ok' | 'last' | 'unknown' — 'last' being the
     * one key that lets people in, which the database refuses to remove.
     */
    async cutKey(key, id) {
      const answer = await call('marque_points_cut_key', { p_key: key, p_id: id });
      const status = answer?.status;
      return status === 'ok' || status === 'last' ? status : 'unknown';
    },

    /**
     * Everything shared in that group: ids and when each last changed, so a
     * device that has just joined — or come back from a fortnight away — can
     * fetch what it is missing and nothing else.
     */
    async groupDocs(key) {
      const rows = await call('marque_points_group_docs', { p_key: key });
      return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : [];
    },

    /**
     * Store a lot of games under one id, so a link can carry many games
     * without carrying their identifiers.
     *
     * Two secrets are needed, and they are not interchangeable: the sharing
     * key, without which the database refuses to write a lot at all, and the
     * six-digit code the receiver will have to type. `contents` is either
     * `{ sealed }` or, where this browser cannot seal, `{ ids }`.
     */
    async putSet(id, contents, code, key) {
      await call('marque_points_put_set', {
        p_id: id,
        p_data: { kind: 'set', ...contents, createdAt: Date.now() },
        p_code: code,
        p_key: key,
      });
    },

    /**
     * Ask for a lot with a code. The database counts the wrong answers and
     * stops at ten, which is what makes six digits enough; the answer says
     * which case it is rather than throwing, because every one of them has
     * something to tell the person waiting.
     *
     * Returns { status: 'ok', contents } | { status: 'wrong', left }
     *       | { status: 'locked' } | { status: 'unknown' }
     */
    async openSet(id, code) {
      const answer = await call('marque_points_open_set', { p_id: id, p_code: code });
      const status = answer?.status;
      if (status === 'ok') return { status, contents: answer.set || null };
      if (status === 'wrong') return { status, left: Number(answer.left) || 0 };
      if (status === 'locked') return { status };
      return { status: 'unknown' };
    },

    /** Revoke a lot: the sharing key, so only whoever shared it can. */
    async forgetSet(id, key) {
      const answer = await call('marque_points_forget_set', { p_id: id, p_key: key });
      return answer?.status === 'ok';
    },

    /** The stored game, or null when nobody has ever shared that id. */
    async get(id) {
      const data = await call('marque_points_get', { p_id: id });
      return data && typeof data === 'object' ? data : null;
    },

    /**
     * Store a document under its own id.
     *
     * Starting to share takes a group's key — that is what keeps sharing in
     * the hands of the people who hold one. Contributing to something already
     * shared takes none, which is what lets a link be sent to someone outside
     * the group without giving them the run of it.
     */
    async put(document_, key = null) {
      await call('marque_points_put', { p_id: document_.id, p_data: document_, p_key: key });
    },

    /** Unshare: the key of the group it belongs to, and nobody else's. */
    async remove(id, key = null) {
      await call('marque_points_delete', { p_id: id, p_key: key });
    },
  };
}

/**
 * Which of two copies of a game to keep: the one changed most recently.
 * Returns 'local', 'remote', or 'same'.
 */
export function pickNewer(local, remote) {
  if (!remote) return 'local';
  if (!local) return 'remote';
  const a = local.updatedAt || 0;
  const b = remote.updatedAt || 0;
  if (a === b) return 'same';
  return a > b ? 'local' : 'remote';
}

/**
 * The game id inside whatever was pasted — a full link, a link with other
 * things around it, or the id on its own. Null when there is none.
 */
export function gameIdFrom(pasted) {
  const text = String(pasted || '').trim();
  const inLink = text.match(/#\/game\/([A-Za-z0-9_.~:@+-]+)/);
  if (inLink) return inLink[1];
  // A bare id, as copied from the database's table editor.
  return /^[A-Za-z0-9_.~:@+-]{8,128}$/.test(text) ? text : null;
}

/**
 * The link that brings a person back into a group: their own token, and nothing
 * else. It goes in the fragment, after the `#`, which browsers never send to a
 * server — so neither the host nor a link preview ever sees it.
 */
export function backLink(location, token) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/back/${token}`;
}

/** The return token inside whatever was pasted, or null. */
export function backTokenFrom(pasted) {
  const found = String(pasted || '').trim().match(/#\/back\/([0-9a-f]{32})(?![0-9a-f])/);
  return found ? found[1] : null;
}

/** The link to give someone so they open this very game. */
export function shareLink(location, gameId) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/game/${gameId}`;
}

/** The link to give someone so they open this very list. */
export function listLink(location, listId) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/list/${listId}`;
}

/** The list id inside whatever was pasted, or null. */
export function listIdFrom(pasted) {
  const found = String(pasted || '').trim().match(/#\/list\/([A-Za-z0-9_.~:@+-]+)/);
  return found ? found[1] : null;
}

/** The link to give someone so they answer this very poll. */
/**
 * The address to send for a poll. It opens the poll alone — no tabs, nothing
 * else of the app — because whoever receives it came to answer, not to look
 * around. Addresses sent before, without `/solo`, still open it in full.
 */
export function pollLink(location, pollId) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/poll/${pollId}/solo`;
}

/** The poll id inside whatever was pasted, or null. */
export function pollIdFrom(pasted) {
  const found = String(pasted || '').trim().match(/#\/poll\/([A-Za-z0-9_.~:@+-]+)/);
  return found ? found[1] : null;
}

/**
 * The link that brings someone into a group: the six digits, and the group's
 * name after them so that nothing has to be typed at all.
 *
 * The two travel together here, which the lot links deliberately avoid — and
 * for the opposite reason: an invitation only grants the right to knock, and it
 * expires, so what protects the group is that someone in it has to accept —
 * not that the code is hard to find. The name and code can still be said out
 * loud instead.
 */
export function joinLink(location, name, code) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/join/${code}/${encodeURIComponent(name)}`;
}

/** The invitation inside whatever was pasted: { code, name }, or null. */
export function joinFrom(pasted) {
  const found = String(pasted || '').trim().match(/#\/join\/(\d{6})(?!\d)\/([^\s/?#]+)/);
  if (!found) return null;
  let name = '';
  try {
    name = decodeURIComponent(found[2]);
  } catch {
    // A link mangled on its way through a message: the digits are still good.
    name = found[2];
  }
  return unpunctuate(name) ? { code: found[1], name: unpunctuate(name) } : null;
}

/**
 * The sentence a link was pasted in from ends somewhere, and its full stop
 * sticks to the group's name: "…/#/join/123456/Mifa." would then be a
 * group nobody has. Brackets are only dropped when they close nothing, since
 * a group may well be called "Mifa (maison)".
 */
function unpunctuate(name) {
  let clean = String(name || '').trim();
  let last = '';
  const count = (text, character) => text.split(character).length - 1;
  while (clean && clean !== last) {
    last = clean;
    clean = clean.replace(/[.,;:!?\u2026\u00ab\u00bb"'\u2018\u2019\u201c\u201d]+$/, '').trim();
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      if (clean.endsWith(close) && count(clean, close) > count(clean, open)) {
        clean = clean.slice(0, -1).trim();
      }
    }
  }
  return clean;
}


/** The link that hands over a set of games at once. */
export function setLink(location, setId) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/set/${setId}`;
}

/** The set id inside whatever was pasted, or null. */
export function setIdFrom(pasted) {
  const found = String(pasted || '').trim().match(/#\/set\/([A-Za-z0-9_.~:@+-]+)/);
  return found ? found[1] : null;
}
