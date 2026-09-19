/**
 * The shared games database.
 *
 * A copy of the app that carries a configuration (src/config.js) keeps every
 * game in a small hosted database as well as in the browser, so a link to a
 * game opens that same game for someone else.
 *
 * It speaks plain HTTP to two Postgres functions — no client library, so the
 * app keeps its "no dependencies" property. The table itself is never exposed:
 * the only things reachable are `read one game by id` and `write one game by
 * id`, which means a game can only be found by someone who has its link.
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

/** The link to give someone so they open this very game. */
export function shareLink(location, gameId) {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}#/game/${gameId}`;
}
