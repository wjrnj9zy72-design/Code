/** Creating and mutating game objects. Pure: every mutator returns a new game. */

import { getPreset, presetConfig } from './games.js';

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a new game.
 * `names` is a list of player (or team) names, `overrides` patches the config.
 */
export function createGame({ presetId, names, overrides = {}, name = '' }) {
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
