import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, getPreset } from '../src/games.js';
import {
  emptyHelperEntry,
  tapCard,
  undoCard,
  toggleSwitch,
  cardCount,
  helperTotal,
  isEmptyEntry,
} from '../src/helpers.js';

/** Tap a list of values in order. */
function tapAll(helper, values) {
  return values.reduce((entry, value) => tapCard(helper, entry, value), emptyHelperEntry());
}

test('an empty counter scores nothing', () => {
  const helper = getPreset('skyjo').helper;
  const entry = emptyHelperEntry();
  assert.equal(helperTotal(helper, entry), 0);
  assert.equal(isEmptyEntry(entry), true);
});

test('Skyjo adds up the cards left in front of a player', () => {
  const helper = getPreset('skyjo').helper;
  // A hand of eight cards, negatives included.
  const entry = tapAll(helper, [-2, -1, 0, 5, 12, 12, 3, 4]);
  assert.equal(helperTotal(helper, entry), 33);
  assert.equal(entry.cards.length, 8);
  assert.equal(cardCount(entry, 12), 2, 'the same value can be tapped twice');
});

test('Skyjo doubles the score of a player who closed without being lowest', () => {
  const helper = getPreset('skyjo').helper;
  const entry = toggleSwitch(tapAll(helper, [4, 5, 6]), 'doubled');
  assert.equal(helperTotal(helper, entry), 30);
});

test('doubling a negative Skyjo hand makes it worse, as the rules intend', () => {
  const helper = getPreset('skyjo').helper;
  const entry = tapAll(helper, [-2, -2, -1]);
  assert.equal(helperTotal(helper, entry), -5);
  assert.equal(helperTotal(helper, toggleSwitch(entry, 'doubled')), -10);
});

test('Papayoo picks each Payoo at most once', () => {
  const helper = getPreset('papayoo').helper;
  assert.equal(helper.mode, 'toggle');

  let entry = tapAll(helper, [20, 14, 3]);
  assert.equal(helperTotal(helper, entry), 37);

  entry = tapCard(helper, entry, 14);
  assert.equal(helperTotal(helper, entry), 23, 'tapping a picked card unpicks it');
  assert.equal(cardCount(entry, 14), 0);

  entry = tapCard(helper, entry, 20);
  entry = tapCard(helper, entry, 20);
  assert.equal(cardCount(entry, 20), 1, 'a Payoo can never be counted twice');
});

test('the Papayoo card itself is worth 40', () => {
  const helper = getPreset('papayoo').helper;
  const entry = toggleSwitch(tapAll(helper, [8]), 'papayoo');
  assert.equal(helperTotal(helper, entry), 48);
});

test('a whole Papayoo round counted card by card comes to 250', () => {
  const helper = getPreset('papayoo').helper;
  const payoos = Array.from({ length: 20 }, (_, index) => index + 1);
  const entry = toggleSwitch(tapAll(helper, payoos), 'papayoo');
  assert.equal(
    helperTotal(helper, entry),
    getPreset('papayoo').roundSum,
    'every Payoo plus the Papayoo is exactly one round',
  );
});

test('Hearts counts one point per heart, plus the queen', () => {
  const helper = getPreset('hearts').helper;
  const entry = tapAll(helper, [1, 1, 1, 1, 1]);
  assert.equal(helperTotal(helper, entry), 5);
  assert.equal(helperTotal(helper, toggleSwitch(entry, 'queen')), 18);
});

test('shooting the moon, counted card by card, comes to 26', () => {
  const helper = getPreset('hearts').helper;
  const entry = toggleSwitch(tapAll(helper, Array(13).fill(1)), 'queen');
  assert.equal(helperTotal(helper, entry), getPreset('hearts').roundSum);
});

test('6 qui prend counts bull heads', () => {
  const helper = getPreset('sixquiprend').helper;
  assert.deepEqual(helper.values, [1, 2, 3, 5, 7], 'the five bull-head values of the deck');
  assert.equal(helperTotal(helper, tapAll(helper, [7, 5, 3, 2, 1, 1])), 19);
});

test('undo removes the last tap, and only the last', () => {
  const helper = getPreset('skyjo').helper;
  const entry = undoCard(tapAll(helper, [12, 3, 8]));
  assert.deepEqual(entry.cards, [12, 3]);
  assert.equal(helperTotal(helper, entry), 15);
  assert.deepEqual(undoCard(emptyHelperEntry()).cards, [], 'undo on an empty counter is safe');
});

test('a counter with only a switch flipped is not empty', () => {
  const helper = getPreset('papayoo').helper;
  assert.equal(isEmptyEntry(toggleSwitch(emptyHelperEntry(), 'papayoo')), false);
});

test('tapping never mutates the entry it was given', () => {
  const helper = getPreset('skyjo').helper;
  const first = tapAll(helper, [5]);
  const second = tapCard(helper, first, 7);
  assert.deepEqual(first.cards, [5]);
  assert.deepEqual(second.cards, [5, 7]);
});

test('only the games whose score is a pile of cards carry a counter', () => {
  const withCounter = PRESETS.filter((preset) => preset.helper).map((preset) => preset.id).sort();
  assert.deepEqual(withCounter, ['hearts', 'papayoo', 'rummikub', 'sixquiprend', 'skyjo']);

  for (const id of ['papayoo', 'hearts', 'skyjo', 'sixquiprend', 'rummikub']) {
    const helper = getPreset(id).helper;
    assert.ok(helper, `${id} should have a counter`);
    assert.ok(['count', 'toggle'].includes(helper.mode), `${id}: mode`);
    assert.ok(helper.values.length, `${id}: values`);
    assert.ok(helper.hintKey, `${id}: needs a hint explaining what to tap`);
  }
  for (const preset of PRESETS.filter((item) => !withCounter.includes(item.id))) {
    assert.equal(preset.helper, undefined, `${preset.id} is scored some other way`);
  }
});

test('Rummikub counts the tiles left on a rack, joker included', () => {
  const helper = getPreset('rummikub').helper;
  const entry = [13, 13, 30, 7].reduce((acc, value) => tapCard(helper, acc, value), emptyHelperEntry());
  assert.equal(helperTotal(helper, entry), 63);
  assert.equal(helper.labels[30], 'Joker');
});

test('an app’s own browser is recognised, and a real one is left alone', async () => {
  const { inAppBrowser } = await import('../src/helpers.js');

  // What a phone actually sends, shortened to what matters.
  assert.equal(
    inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/466.0.0.34.107;]'),
    'Facebook',
  );
  assert.equal(inAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Instagram 300.0.0.29.110'), 'Instagram');
  // Messenger hides inside Facebook's own marker, and is named for itself.
  assert.equal(
    inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 [FBAN/MessengerForiOS;FBAV/450.0.0.44.109;]'),
    'Messenger',
  );
  assert.equal(
    inAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 [FB_IAB/MESSENGER;FBAV/450.0.0.44.109;]'),
    'Messenger',
  );
  assert.equal(inAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 MicroMessenger/8.0.44'), 'WeChat');

  // A real browser, and nothing to say about it.
  assert.equal(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'), null);
  assert.equal(inAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'), null);
  assert.equal(inAppBrowser(''), null);
  assert.equal(inAppBrowser(undefined), null);
});
