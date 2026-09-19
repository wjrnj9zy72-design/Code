/**
 * Storing games outside the browser.
 *
 * The browser's own storage is fine until it is cleared, or until you pick up
 * the other phone — so where the page is served by a host that offers a
 * document store, the games live there instead and the browser keeps a copy.
 *
 * The page must work without it: the store is offered by the host, arrives
 * late, and may never arrive at all (a file opened from the disk, a viewer
 * that declines). So nothing here is on the critical path — the app renders
 * from its local copy first and this lights up afterwards.
 */

import { isValidGame } from './model.js';

/** Where a game is stored. Path grammar: an odd number of segments. */
const COLLECTION = 'games';

/**
 * Merge what this browser holds with what the store holds.
 * The newer `updatedAt` wins, and anything the store has not got yet — or
 * holds an older copy of — comes back in `toPush`.
 */
export function reconcile(local, remote) {
  const byId = new Map();
  for (const game of remote) if (isValidGame(game)) byId.set(game.id, game);

  const toPush = [];
  for (const game of local) {
    if (!isValidGame(game)) continue;
    const stored = byId.get(game.id);
    if (!stored || (game.updatedAt || 0) > (stored.updatedAt || 0)) {
      byId.set(game.id, game);
      toPush.push(game);
    }
  }

  const games = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { games, toPush };
}

/**
 * Connect to the host's store, if there is one.
 *
 * Resolves a small writer — { save, remove, stop } — or null when the page
 * runs anywhere else. `onGames` is called with the merged list on the first
 * snapshot and on every later change, including ones made on another device.
 */
export async function connectStore({ getLocalGames, onGames, onLost }) {
  const host = globalThis.claude;
  if (!host || typeof host.use !== 'function') return null;

  let db = null;
  try {
    db = await host.use('db');
  } catch {
    return null;
  }
  if (!db) return null;

  const collection = db.collection(COLLECTION);
  let firstSnapshot = true;

  const save = async (game) => {
    if (!isValidGame(game)) return;
    try {
      await collection.doc(game.id).set(game);
    } catch (error) {
      // A refused or failed write leaves the local copy in place; the next
      // reconcile pushes it again.
      if (error?.code === 'revoked') onLost?.();
    }
  };

  const remove = async (id) => {
    try {
      await collection.doc(id).delete();
    } catch (error) {
      if (error?.code === 'revoked') onLost?.();
    }
  };

  // One subscription for the whole collection, registered once.
  const stop = collection.onSnapshot(
    (snapshot) => {
      const remote = snapshot.docs.map((document) => document.data()).filter(isValidGame);
      const { games, toPush } = reconcile(getLocalGames(), remote);
      onGames(games);

      if (firstSnapshot) {
        firstSnapshot = false;
        // Hand the store whatever this browser had and it did not, one write
        // at a time, and only on this first pass.
        void toPush.reduce((chain, game) => chain.then(() => save(game)), Promise.resolve());
      }
    },
    () => onLost?.(),
  );

  return { save, remove, stop };
}
