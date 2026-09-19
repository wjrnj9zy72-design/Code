/**
 * Scoring engine. Pure functions over a game object — no DOM, no storage.
 *
 * A game looks like this:
 * {
 *   id, presetId, name, createdAt, updatedAt, finishedAt: null | number,
 *   players: [{ id, name }],
 *   config: { direction, endMode, target, rounds, roundSum, allowNegative, entrantLabel },
 *   rounds: [{ id, scores: { [playerId]: number }, meta: string|null, note: string }]
 * }
 */

/** Score a single player recorded for one round (missing entries count as 0). */
export function roundScore(round, playerId) {
  const value = round.scores?.[playerId];
  return Number.isFinite(value) ? value : 0;
}

/** Sum of every score recorded in a round. */
export function roundSum(round) {
  return Object.values(round.scores || {}).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
}

/** Totals keyed by player id, over the first `upTo` rounds (all of them by default). */
export function totals(game, upTo = Infinity) {
  const result = {};
  for (const player of game.players) result[player.id] = 0;
  game.rounds.slice(0, upTo).forEach((round) => {
    for (const player of game.players) {
      result[player.id] += roundScore(round, player.id);
    }
  });
  return result;
}

/**
 * Players ordered from best to worst, with ranks (ties share a rank).
 * Each entry: { id, name, total, rank, gap } where `gap` is the distance to the leader.
 */
export function standings(game) {
  const totalsById = totals(game);
  const sign = game.config.direction === 'low' ? 1 : -1;
  const rows = game.players
    .map((player) => ({
      id: player.id,
      name: player.name,
      total: totalsById[player.id],
    }))
    .sort((a, b) => sign * (a.total - b.total));

  const best = rows.length ? rows[0].total : 0;
  let rank = 0;
  let previous = null;
  rows.forEach((row, index) => {
    if (previous === null || row.total !== previous) rank = index + 1;
    previous = row.total;
    row.rank = rank;
    row.gap = Math.abs(row.total - best);
  });
  return rows;
}

/**
 * Where the game stands.
 * { finished, reason, winners: [row], leaders: [row], standings, remaining }
 * `reason` is 'manual' (ended by hand), 'threshold', 'rounds' or null.
 * `remaining` is how much is left before the game ends, when that is knowable.
 */
export function gameStatus(game) {
  const rows = standings(game);
  const { endMode, target, rounds } = game.config;
  const leaders = rows.filter((row) => rows.length && row.total === rows[0].total);

  let finished = false;
  let reason = null;
  let remaining = null;

  if (game.finishedAt) {
    finished = true;
    reason = 'manual';
  } else if (endMode === 'threshold' && Number.isFinite(target)) {
    // Either way it is the highest total that trips the target: in a penalty
    // game the player who gets there ends it and the lowest total still wins,
    // in a race the player who gets there wins.
    const highest = rows.length ? Math.max(...rows.map((r) => r.total)) : 0;
    finished = rows.length > 0 && highest >= target;
    if (finished) reason = 'threshold';
    remaining = Math.max(0, target - highest);
  } else if (endMode === 'rounds' && Number.isFinite(rounds)) {
    finished = game.rounds.length >= rounds;
    if (finished) reason = 'rounds';
    remaining = Math.max(0, rounds - game.rounds.length);
  }

  return {
    finished,
    reason,
    standings: rows,
    leaders,
    winners: finished ? leaders : [],
    remaining,
  };
}

/**
 * Check a round before it is recorded.
 * `scores` is { [playerId]: number | null } — null/undefined means "not filled in".
 * Returns { ok, errors: [{code, ...}], warnings: [{code, ...}] }.
 * Errors block saving; warnings are shown but can be accepted (house rules vary).
 */
export function validateRound(game, scores) {
  const errors = [];
  const warnings = [];
  const missing = [];

  for (const player of game.players) {
    const value = scores?.[player.id];
    if (value === null || value === undefined || value === '') {
      missing.push(player.name);
      continue;
    }
    if (!Number.isFinite(value)) {
      errors.push({ code: 'notANumber', player: player.name });
      continue;
    }
    if (!Number.isInteger(value)) {
      errors.push({ code: 'notAnInteger', player: player.name });
      continue;
    }
    if (value < 0 && !game.config.allowNegative) {
      errors.push({ code: 'negative', player: player.name });
    }
  }

  if (missing.length) warnings.push({ code: 'missing', players: missing });

  const expected = game.config.roundSum;
  if (Number.isFinite(expected) && !missing.length) {
    const sum = Object.values(scores).reduce(
      (acc, value) => acc + (Number.isFinite(value) ? value : 0),
      0,
    );
    if (sum !== expected) warnings.push({ code: 'sum', sum, expected });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * The value that completes a round to its expected sum, or null when the game
 * has no fixed round sum or more than one score is still missing.
 */
export function completingScore(game, scores) {
  const expected = game.config.roundSum;
  if (!Number.isFinite(expected)) return null;
  const missing = game.players.filter((player) => {
    const value = scores?.[player.id];
    return value === null || value === undefined || value === '';
  });
  if (missing.length !== 1) return null;
  const sum = Object.values(scores).reduce(
    (acc, value) => acc + (Number.isFinite(value) ? value : 0),
    0,
  );
  const rest = expected - sum;
  if (rest < 0 && !game.config.allowNegative) return null;
  return { playerId: missing[0].id, value: rest };
}
