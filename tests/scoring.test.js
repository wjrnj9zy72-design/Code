import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame, addRound, updateRound, removeRound, setFinished, isValidGame } from '../src/model.js';
import {
  totals,
  standings,
  gameStatus,
  roundScore,
  roundSum,
  validateRound,
  completingScore,
} from '../src/scoring.js';

/** Helper: a Papayoo game with the given player names. */
function papayoo(names = ['Alice', 'Bob', 'Chloé', 'Dan']) {
  return createGame({ presetId: 'papayoo', names });
}

/** Helper: record a round from a list of scores aligned with game.players. */
function deal(game, values, extra = {}) {
  const scores = {};
  game.players.forEach((player, index) => {
    scores[player.id] = values[index];
  });
  return addRound(game, { scores, ...extra });
}

test('a new Papayoo game carries the preset rules', () => {
  const game = papayoo();
  assert.equal(game.config.direction, 'low');
  assert.equal(game.config.roundSum, 250, 'a Papayoo deal hands out 210 + 40 points');
  assert.equal(game.config.target, 250);
  assert.equal(game.config.allowNegative, false);
  assert.equal(game.rounds.length, 0);
  assert.equal(game.players.length, 4);
  assert.ok(isValidGame(game));
});

test('blank player names fall back to a placeholder', () => {
  const game = createGame({ presetId: 'papayoo', names: ['Alice', '  ', ''] });
  assert.deepEqual(game.players.map((p) => p.name), ['Alice', '#2', '#3']);
});

test('totals add up round by round', () => {
  let game = papayoo();
  game = deal(game, [40, 60, 150, 0]);
  game = deal(game, [0, 90, 20, 140]);
  const byId = totals(game);
  assert.deepEqual(game.players.map((p) => byId[p.id]), [40, 150, 170, 140]);
});

test('missing scores count as zero', () => {
  let game = papayoo(['Alice', 'Bob']);
  game = addRound(game, { scores: { [game.players[0].id]: 250 } });
  const byId = totals(game);
  assert.equal(byId[game.players[1].id], 0);
  assert.equal(roundScore(game.rounds[0], game.players[1].id), 0);
  assert.equal(roundSum(game.rounds[0]), 250);
});

test('lowest total leads a penalty game, and ties share a rank', () => {
  let game = papayoo(['Alice', 'Bob', 'Chloé', 'Dan']);
  game = deal(game, [10, 10, 80, 150]);
  const rows = standings(game);
  assert.deepEqual(rows.map((row) => row.name), ['Alice', 'Bob', 'Chloé', 'Dan']);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3, 4]);
  assert.deepEqual(rows.map((row) => row.gap), [0, 0, 70, 140]);
});

test('highest total leads a race game', () => {
  let game = createGame({ presetId: 'uno', names: ['Alice', 'Bob'] });
  game = deal(game, [20, 130]);
  assert.deepEqual(standings(game).map((row) => row.name), ['Bob', 'Alice']);
});

test('a threshold game ends when someone reaches the limit — and the lowest total wins', () => {
  let game = papayoo(['Alice', 'Bob', 'Chloé']);
  game = deal(game, [10, 90, 150]);
  let status = gameStatus(game);
  assert.equal(status.finished, false);
  assert.equal(status.remaining, 100, '250 - 150 still to go');
  assert.deepEqual(status.winners, []);

  game = deal(game, [20, 80, 150]);
  status = gameStatus(game);
  assert.equal(status.finished, true);
  assert.equal(status.reason, 'threshold');
  assert.equal(status.remaining, 0);
  assert.deepEqual(status.winners.map((row) => row.name), ['Alice']);
});

test('a race game is won by the player who reaches the target', () => {
  let game = createGame({ presetId: 'uno', names: ['Alice', 'Bob'] });
  game = deal(game, [500, 40]);
  const status = gameStatus(game);
  assert.equal(status.finished, true);
  assert.deepEqual(status.winners.map((row) => row.name), ['Alice']);
});

test('a fixed-round game ends when the rounds run out', () => {
  let game = createGame({ presetId: 'tarot', names: ['Alice', 'Bob', 'Chloé'], overrides: { rounds: 2 } });
  game = deal(game, [40, -20, -20]);
  assert.equal(gameStatus(game).remaining, 1);
  game = deal(game, [-30, 60, -30]);
  const status = gameStatus(game);
  assert.equal(status.finished, true);
  assert.equal(status.reason, 'rounds');
  assert.deepEqual(status.winners.map((row) => row.name), ['Bob']);
});

test('a manual game never ends on its own, but can be closed by hand', () => {
  let game = createGame({ presetId: 'yams', names: ['Alice', 'Bob'] });
  game = deal(game, [240, 180]);
  assert.equal(gameStatus(game).finished, false);
  game = setFinished(game, true);
  const status = gameStatus(game);
  assert.equal(status.finished, true);
  assert.equal(status.reason, 'manual');
  assert.deepEqual(status.winners.map((row) => row.name), ['Alice']);
  assert.equal(gameStatus(setFinished(game, false)).finished, false);
});

test('tied winners are all reported', () => {
  let game = papayoo(['Alice', 'Bob']);
  game = deal(game, [250, 250]);
  assert.deepEqual(gameStatus(game).winners.map((row) => row.name), ['Alice', 'Bob']);
});

test('rounds can be edited and removed', () => {
  let game = papayoo(['Alice', 'Bob']);
  game = deal(game, [40, 210], { meta: 'hearts', note: 'première' });
  const roundId = game.rounds[0].id;

  game = updateRound(game, roundId, { scores: { [game.players[0].id]: 50, [game.players[1].id]: 200 } });
  assert.deepEqual(Object.values(totals(game)).sort((a, b) => a - b), [50, 200]);
  assert.equal(game.rounds[0].meta, 'hearts', 'untouched fields survive an edit');
  assert.equal(game.rounds[0].note, 'première');

  game = removeRound(game, roundId);
  assert.equal(game.rounds.length, 0);
  assert.deepEqual(Object.values(totals(game)), [0, 0]);
});

test('editing a round does not mutate the previous game object', () => {
  const game = deal(papayoo(['Alice', 'Bob']), [100, 150]);
  const next = removeRound(game, game.rounds[0].id);
  assert.equal(game.rounds.length, 1);
  assert.equal(next.rounds.length, 0);
});

test('validateRound accepts a correct Papayoo deal', () => {
  const game = papayoo(['Alice', 'Bob']);
  const scores = { [game.players[0].id]: 40, [game.players[1].id]: 210 };
  const result = validateRound(game, scores);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test('a wrong round total is a warning, not an error', () => {
  const game = papayoo(['Alice', 'Bob']);
  const result = validateRound(game, { [game.players[0].id]: 40, [game.players[1].id]: 100 });
  assert.equal(result.ok, true, 'house rules vary, so the entry is still allowed');
  assert.deepEqual(result.warnings, [{ code: 'sum', sum: 140, expected: 250 }]);
});

test('negative scores are rejected unless the game allows them', () => {
  const papayooGame = papayoo(['Alice', 'Bob']);
  const bad = validateRound(papayooGame, {
    [papayooGame.players[0].id]: -10,
    [papayooGame.players[1].id]: 260,
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, [{ code: 'negative', player: 'Alice' }]);

  const tarotGame = createGame({ presetId: 'tarot', names: ['Alice', 'Bob'] });
  const good = validateRound(tarotGame, {
    [tarotGame.players[0].id]: -10,
    [tarotGame.players[1].id]: 10,
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.warnings, [], 'tarot rounds are zero-sum');
});

test('non-numbers and fractions are errors', () => {
  const game = papayoo(['Alice', 'Bob']);
  const result = validateRound(game, { [game.players[0].id]: NaN, [game.players[1].id]: 1.5 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((issue) => issue.code), ['notANumber', 'notAnInteger']);
});

test('blank entries are flagged, and skip the round-total check', () => {
  const game = papayoo(['Alice', 'Bob']);
  const result = validateRound(game, { [game.players[0].id]: 40, [game.players[1].id]: null });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [{ code: 'missing', players: ['Bob'] }]);
});

test('completingScore fills the last missing score of a fixed-sum round', () => {
  const game = papayoo(['Alice', 'Bob', 'Chloé']);
  const [alice, bob, chloe] = game.players;

  assert.deepEqual(completingScore(game, { [alice.id]: 40, [bob.id]: 60, [chloe.id]: null }), {
    playerId: chloe.id,
    value: 150,
  });

  assert.equal(completingScore(game, { [alice.id]: 40, [bob.id]: null, [chloe.id]: null }), null,
    'two blanks cannot be inferred');
  assert.equal(completingScore(game, { [alice.id]: 40, [bob.id]: 60, [chloe.id]: 150 }), null,
    'nothing to complete');
  assert.equal(completingScore(game, { [alice.id]: 300, [bob.id]: 0, [chloe.id]: null }), null,
    'would need a negative score');

  const skyjo = createGame({ presetId: 'skyjo', names: ['Alice', 'Bob'] });
  assert.equal(completingScore(skyjo, { [skyjo.players[0].id]: 12, [skyjo.players[1].id]: null }), null,
    'skyjo rounds have no fixed total');
});

test('isValidGame rejects junk coming back from storage or an import', () => {
  assert.equal(isValidGame(null), false);
  assert.equal(isValidGame({ id: 'g1' }), false);
  assert.equal(isValidGame({ id: 'g1', players: [{ id: 'p', name: 1 }], rounds: [], config: {} }), false);
  assert.equal(isValidGame({ id: 'g1', players: [], rounds: [], config: {} }), true);
});

test('a game id is unguessable, because a share link is made of it', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { id } = createGame({ presetId: 'papayoo', names: ['A', 'B', 'C'] });
    assert.ok(id.startsWith('g_'), id);
    assert.ok(id.length >= 24, `too short to be a secret: ${id}`);
    assert.equal(ids.has(id), false, `collision: ${id}`);
    ids.add(id);
  }
});
