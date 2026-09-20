/**
 * Clocks and tombstones, for the documents several people edit at once.
 *
 * Lists and polls are merged the same way and for the same reason — two phones
 * touching the same thing within a second of each other — so the two rules
 * that make those merges work live here, once.
 */

/**
 * The next stamp for something that has just changed: now, or one more than it
 * carried, whichever is later. Never returning the same value twice is what
 * lets a merge tell "someone changed this" from "nobody touched it", even when
 * both happen inside the same millisecond.
 */
export function later(previous) {
  return Math.max(Date.now(), (previous || 0) + 1);
}

/** A changed document, stamped. */
export function touch(document_, patch) {
  return { ...document_, ...patch, updatedAt: later(document_.updatedAt) };
}

/**
 * How long a deletion is remembered. A line deleted here has to stay deleted
 * when the other phone — which still holds it — syncs again; a month is longer
 * than any phone stays away, and short enough that the traces never pile up.
 */
export const FORGET_AFTER = 30 * 24 * 60 * 60 * 1000;

export function prune(removed, now = Date.now()) {
  const kept = {};
  for (const [id, at] of Object.entries(removed || {})) {
    if (now - at < FORGET_AFTER) kept[id] = at;
  }
  return kept;
}
