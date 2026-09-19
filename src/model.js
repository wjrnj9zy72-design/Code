/** Creating and mutating game objects. Pure: every mutator returns a new game. */

import { getPreset, presetConfig } from './games.js';

/**
 * An identifier. A game's id is also what a share link carries, so it has to
 * be unguessable: whoever knows it can open the game. randomUUID is used where
 * the browser offers it (it needs a secure context), with a weaker but still
 * random fallback elsewhere.
 */
function uid(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random()}${random()}`;
}

/**
 * Build a new game.
 * `names` is a list of player (or team) names, `overrides` patches the config.
 */
export function createGame({ presetId, names, overrides = {}, name = '', shared = false }) {
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
    // deliberately, or because this device sends everything by choice.
    shared: Boolean(shared),
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
