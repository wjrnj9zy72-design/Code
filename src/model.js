/** Creating and mutating game objects. Pure: every mutator returns a new game. */

import { getPreset, presetConfig } from './games.js';

/**
 * An identifier. A game's id is also what a share link carries, so it has to
 * be unguessable: whoever knows it can open the game. randomUUID is used where
 * the browser offers it (it needs a secure context), with a weaker but still
 * random fallback elsewhere.
 *
 * Exported because a set of games shared together is named the same way, and
 * for the same reason.
 */
export function uid(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random()}${random()}`;
}

/**
 * Build a new game.
 * `names` is a list of player (or team) names, `overrides` patches the config.
 */
export function createGame({ presetId, names, overrides = {}, name = '', shared = false, groupId = null }) {
  const preset = getPreset(presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);

  const players = names
    .map((raw, index) => (raw || '').trim() || `#${index + 1}`)
    .map((playerName) => ({ id: uid('p'), name: playerName }));

  const now = Date.now();
  return {
    id: uid('g'),
    presetId,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    // A game is only sent to the shared database once it is shared — either
    // deliberately, or because this device sends everything by choice. The
    // group it was shared in says whose key may change or remove it later.
    shared: Boolean(shared),
    groupId: groupId || null,
    archivedAt: null,
    players,
    config: { ...presetConfig(preset), ...overrides },
    rounds: [],
  };
}

/** Normalise a { playerId: value } map into finite numbers, dropping blanks to 0. */
function normaliseScores(game, scores) {
  const clean = {};
  for (const player of game.players) {
    const value = scores?.[player.id];
    clean[player.id] = Number.isFinite(value) ? value : 0;
  }
  return clean;
}

export function addRound(game, { scores, meta = null, note = '' }) {
  const round = {
    id: uid('r'),
    scores: normaliseScores(game, scores),
    meta,
    note,
  };
  return { ...game, rounds: [...game.rounds, round], updatedAt: Date.now() };
}

export function updateRound(game, roundId, { scores, meta, note }) {
  const rounds = game.rounds.map((round) => {
    if (round.id !== roundId) return round;
    return {
      ...round,
      scores: scores ? normaliseScores(game, scores) : round.scores,
      meta: meta === undefined ? round.meta : meta,
      note: note === undefined ? round.note : note,
    };
  });
  return { ...game, rounds, updatedAt: Date.now() };
}

export function removeRound(game, roundId) {
  return {
    ...game,
    rounds: game.rounds.filter((round) => round.id !== roundId),
    updatedAt: Date.now(),
  };
}


/** Fix a name that was typed wrong, without disturbing the scores. */
export function renamePlayer(game, playerId, name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return game;
  const players = game.players.map((player) =>
    player.id === playerId ? { ...player, name: cleaned } : player,
  );
  return { ...game, players, updatedAt: Date.now() };
}

/** Mark a game as one the shared database holds. */
export function setShared(game, shared = true) {
  if (Boolean(game.shared) === Boolean(shared)) return game;
  return { ...game, shared: Boolean(shared), updatedAt: Date.now() };
}

export function setFinished(game, finished) {
  return { ...game, finishedAt: finished ? Date.now() : null, updatedAt: Date.now() };
}

/**
 * Put an evening away, or bring it back. A finished game is still on the tab —
 * that is how a table checks last month's scores — until someone says it has
 * been looked at enough.
 */
export function archiveGame(game, yes = true) {
  const at = yes ? Date.now() : null;
  if (at === (game.archivedAt || null)) return game;
  return { ...game, archivedAt: at, updatedAt: Date.now() };
}


/**
 * Merge two copies of the same game — the one here and the one the database
 * holds. The newer copy sets the names, the settings and the title, but the
 * rounds are unioned by id rather than replaced: two people scoring the same
 * evening on two phones would otherwise silently lose whichever round was
 * written second. A round deleted on one device and kept on the other comes
 * back, which is visible and undoable — unlike a round that vanishes.
 */
export function mergeGames(a, b) {
  if (!isValidGame(a)) return b;
  if (!isValidGame(b)) return a;
  if (a.id !== b.id) return a;

  const [newer, older] = (a.updatedAt || 0) >= (b.updatedAt || 0) ? [a, b] : [b, a];
  const byId = new Map();
  for (const round of [...older.rounds, ...newer.rounds]) {
    if (round && typeof round.id === 'string') byId.set(round.id, round);
  }

  // Keep the newer copy's order, then anything only the older one knew about.
  const ordered = [
    ...newer.rounds.filter((round) => byId.has(round.id)).map((round) => byId.get(round.id)),
    ...older.rounds.filter((round) => !newer.rounds.some((other) => other.id === round.id)),
  ];

  if (ordered.length === newer.rounds.length) return newer;
  return { ...newer, rounds: ordered, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0) };
}

/** Start a fresh game with the same people and the same rules. */
export function replayGame(game) {
  return createGame({
    presetId: game.presetId,
    names: game.players.map((player) => player.name),
    overrides: { ...game.config },
    name: game.name,
    shared: Boolean(game.shared),
    groupId: game.groupId,
  });
}

/** Whoever deals this round — the deal goes round the table. */
export function dealerFor(game, roundNumber) {
  if (!game.players.length) return null;
  return game.players[roundNumber % game.players.length];
}

/** The people most recently played with, for the new-game form to offer. */
export function recentNames(games, limit = 12) {
  const seen = [];
  for (const game of [...games].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    for (const player of game.players) {
      if (!seen.includes(player.name)) seen.push(player.name);
      if (seen.length >= limit) return seen;
    }
  }
  return seen;
}

/** Defensive read of anything coming back from storage or an import file. */
export function isValidGame(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.id === 'string' &&
      Array.isArray(value.players) &&
      value.players.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string') &&
      Array.isArray(value.rounds) &&
      value.config &&
      typeof value.config === 'object',
  );
}
