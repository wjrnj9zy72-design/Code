import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreDeal, isCompleteDeal, THRESHOLDS, TOTAL_POINTS, contractMultiplier } from '../src/tarot.js';

const FOUR = [{ id: 'a', name: 'Preneur' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const FIVE = [...FOUR, { id: 'e' }];
const THREE = FOUR.slice(0, 3);

const deal = (patch) => ({
  takerId: 'a',
  partnerId: null,
  contract: 'petite',
  oudlers: 1,
  points: 51,
  petitAuBout: 'none',
  poignee: 'none',
  chelem: 'none',
  ...patch,
});

test('the contract thresholds are the ones of the game', () => {
  assert.deepEqual(THRESHOLDS, { 0: 56, 1: 51, 2: 41, 3: 36 });
  assert.equal(TOTAL_POINTS, 91, 'the deck holds 91 points');
  assert.deepEqual(
    ['petite', 'garde', 'gardeSans', 'gardeContre'].map(contractMultiplier),
    [1, 2, 4, 6],
  );
});

test('a contract made exactly is worth the base 25', () => {
  const result = scoreDeal(FOUR, deal({ oudlers: 1, points: 51 }));
  assert.equal(result.gap, 0);
  assert.equal(result.won, true);
  assert.equal(result.amount, 25);
  assert.deepEqual(result.scores, { a: 75, b: -25, c: -25, d: -25 });
});

test('one point short is a contract lost, not a near miss', () => {
  const result = scoreDeal(FOUR, deal({ oudlers: 1, points: 50 }));
  assert.equal(result.won, false);
  assert.equal(result.gap, -1);
  assert.equal(result.amount, -26, '25 + 1, and the taker pays it');
  assert.deepEqual(result.scores, { a: -78, b: 26, c: 26, d: 26 });
});

test('the contract multiplies the whole of the base and the écart', () => {
  assert.equal(scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 47 })).amount, 62);
  assert.equal(scoreDeal(FOUR, deal({ contract: 'gardeSans', oudlers: 2, points: 47 })).amount, 124);
  assert.equal(scoreDeal(FOUR, deal({ contract: 'gardeContre', oudlers: 2, points: 47 })).amount, 186);
});

test('a heavy defeat under a garde contre', () => {
  const result = scoreDeal(FOUR, deal({ contract: 'gardeContre', oudlers: 0, points: 30 }));
  assert.equal(result.threshold, 56);
  assert.equal(result.gap, -26);
  assert.equal(result.amount, -(25 + 26) * 6);
  assert.deepEqual(result.scores, { a: -918, b: 306, c: 306, d: 306 });
});

test('the petit au bout is worth 10 inside the multiplication', () => {
  const taker = scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 47, petitAuBout: 'taker' }));
  assert.equal(taker.amount, (25 + 6 + 10) * 2, 'the taker keeps it');

  const defence = scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 47, petitAuBout: 'defence' }));
  assert.equal(defence.amount, (25 + 6 - 10) * 2, 'the defence takes it off the win');
});

test('the petit au bout softens a defeat when the taker keeps it', () => {
  const kept = scoreDeal(FOUR, deal({ oudlers: 1, points: 41, petitAuBout: 'taker' }));
  assert.equal(kept.amount, -(25 + 10 - 10), 'a loss of 35 becomes 25');

  const lost = scoreDeal(FOUR, deal({ oudlers: 1, points: 41, petitAuBout: 'defence' }));
  assert.equal(lost.amount, -(25 + 10 + 10), 'and deepens it when the defence has it');
});

test('a handful is added after the multiplication, to whoever won the deal', () => {
  const won = scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 47, poignee: 'simple' }));
  assert.equal(won.amount, 62 + 20, 'not multiplied by the contract');

  const lost = scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 30, poignee: 'simple' }));
  assert.equal(lost.amount, -(25 + 11) * 2 - 20, 'the defence collects it');

  assert.equal(scoreDeal(FOUR, deal({ poignee: 'double' })).amount, 25 + 30);
  assert.equal(scoreDeal(FOUR, deal({ poignee: 'triple' })).amount, 25 + 40);
});

test('a slam is worth its own bonus, announced or not', () => {
  assert.equal(scoreDeal(FOUR, deal({ chelem: 'announcedMade' })).amount, 25 + 400);
  assert.equal(scoreDeal(FOUR, deal({ chelem: 'unannouncedMade' })).amount, 25 + 200);
  assert.equal(scoreDeal(FOUR, deal({ chelem: 'announcedFailed', points: 60 })).amount, 25 + 9 - 200);
});

test('three players: the taker faces two', () => {
  const result = scoreDeal(THREE, deal({}));
  assert.deepEqual(result.scores, { a: 50, b: -25, c: -25 });
});

test('five players: the called partner takes a share of the outcome', () => {
  const result = scoreDeal(FIVE, deal({ partnerId: 'b' }));
  assert.deepEqual(result.scores, { a: 50, b: 25, c: -25, d: -25, e: -25 });
});

test('five players: a taker who called themselves faces the other four', () => {
  const alone = scoreDeal(FIVE, deal({ partnerId: 'a' }));
  assert.deepEqual(alone.scores, { a: 100, b: -25, c: -25, d: -25, e: -25 });
  assert.deepEqual(scoreDeal(FIVE, deal({ partnerId: null })).scores, alone.scores);
});

test('every deal is zero-sum, whatever was announced', () => {
  const cases = [];
  for (const contract of ['petite', 'garde', 'gardeSans', 'gardeContre']) {
    for (const oudlers of [0, 1, 2, 3]) {
      for (const points of [0, 30, 41, 51, 56, 70, 91]) {
        for (const petitAuBout of ['none', 'taker', 'defence']) {
          for (const poignee of ['none', 'simple', 'triple']) {
            cases.push({ contract, oudlers, points, petitAuBout, poignee });
          }
        }
      }
    }
  }
  for (const patch of cases) {
    for (const [players, partnerId] of [[THREE, null], [FOUR, null], [FIVE, 'b'], [FIVE, null]]) {
      const { scores } = scoreDeal(players, deal({ ...patch, partnerId }));
      const sum = Object.values(scores).reduce((total, value) => total + value, 0);
      assert.equal(sum, 0, `not zero-sum: ${JSON.stringify({ ...patch, players: players.length })}`);
    }
  }
  assert.equal(cases.length, 4 * 4 * 7 * 3 * 3);
});

test('the breakdown shows every step, so the table can check it', () => {
  const { breakdown } = scoreDeal(FOUR, deal({ contract: 'garde', oudlers: 2, points: 47, petitAuBout: 'taker', poignee: 'simple' }));
  assert.equal(breakdown.threshold, 41);
  assert.equal(breakdown.gap, 6);
  assert.equal(breakdown.inner, 25 + 6 + 10);
  assert.equal(breakdown.multiplier, 2);
  assert.equal(breakdown.poignee, 20);
  assert.equal(breakdown.amount, (25 + 6 + 10) * 2 + 20);
});

test('an incomplete deal is not scored', () => {
  assert.equal(isCompleteDeal(FOUR, deal({})), true);
  assert.equal(isCompleteDeal(FOUR, deal({ takerId: null })), false);
  assert.equal(isCompleteDeal(FOUR, deal({ takerId: 'zzz' })), false, 'a taker who is not playing');
  assert.equal(isCompleteDeal(FOUR, deal({ contract: 'nope' })), false);
  assert.equal(isCompleteDeal(FOUR, deal({ oudlers: 4 })), false);
  assert.equal(isCompleteDeal(FOUR, deal({ points: 92 })), false, 'more points than the deck holds');
  assert.equal(isCompleteDeal(FOUR, deal({ points: -1 })), false);
  assert.equal(isCompleteDeal(FOUR, deal({ points: null })), false);
});
