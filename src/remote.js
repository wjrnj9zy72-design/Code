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
 * A lot of games — a link that hands over several at once — goes through its
 * own functions, because it is protected differently: writing one takes the
 * sharing key that only the person hosting the database has, and reading one
 * takes the six-digit code drawn for that share, which the database allows ten
 * attempts at.
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
    /** Is this the sharing key the database was set up with? */
    async isOwner(key) {
      return (await call('marque_points_is_owner', { p_key: key })) === true;
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

    /** Store a game under its own id. Whoever holds the link may also write. */
    async put(game) {
      await call('marque_points_put', { p_id: game.id, p_data: game });
    },

    async remove(id) {
      await call('marque_points_delete', { p_id: id });
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
