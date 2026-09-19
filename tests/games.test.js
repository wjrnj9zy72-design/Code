import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, getPreset, presetConfig } from '../src/games.js';
import { t, setLanguage, LANGUAGES, detectLanguage } from '../src/i18n.js';

test('every preset is coherent', () => {
  const ids = new Set();
  for (const preset of PRESETS) {
    assert.ok(preset.id, 'preset needs an id');
    assert.equal(ids.has(preset.id), false, `duplicate preset id: ${preset.id}`);
    ids.add(preset.id);

    const [min, max] = preset.players;
    assert.ok(min >= 1 && max >= min, `${preset.id}: player range`);
    assert.ok(['low', 'high'].includes(preset.direction), `${preset.id}: direction`);
    assert.ok(['threshold', 'rounds', 'manual'].includes(preset.endMode), `${preset.id}: endMode`);
    assert.ok(['player', 'team'].includes(preset.entrantLabel), `${preset.id}: entrantLabel`);

    if (preset.endMode === 'threshold') {
      assert.ok(Number.isFinite(preset.target), `${preset.id}: a threshold game needs a target`);
    }
    if (preset.endMode === 'rounds') {
      assert.ok(Number.isFinite(preset.rounds), `${preset.id}: a rounds game needs a round count`);
    }
    if (preset.meta) {
      assert.ok(preset.meta.options.length, `${preset.id}: meta field needs options`);
    }
  }
});

test('Papayoo is described by the rules of the game', () => {
  const papayoo = getPreset('papayoo');
  // Payoos 1..20 = 210 penalty points, plus the Papayoo (a 7) worth 40.
  const payoos = Array.from({ length: 20 }, (_, index) => index + 1).reduce((a, b) => a + b, 0);
  assert.equal(payoos, 210);
  assert.equal(payoos + 40, papayoo.roundSum);
  assert.equal(papayoo.direction, 'low');
  assert.deepEqual(papayoo.meta.options.map((option) => option.label), ['♥', '♦', '♠', '♣']);
});

test('getPreset returns null for an unknown id', () => {
  assert.equal(getPreset('nope'), null);
});

test('presetConfig only exposes the editable rule knobs', () => {
  assert.deepEqual(Object.keys(presetConfig(getPreset('papayoo'))).sort(), [
    'allowNegative',
    'direction',
    'endMode',
    'entrantLabel',
    'roundSum',
    'rounds',
    'target',
  ]);
});

test('every preset has notes in every language', () => {
  for (const lang of LANGUAGES) {
    setLanguage(lang);
    for (const preset of PRESETS) {
      const notes = t(preset.notesKey);
      assert.notEqual(notes, preset.notesKey, `${lang}: missing ${preset.notesKey}`);
    }
  }
  setLanguage('fr');
});

test('translations interpolate, and fall back to the key when unknown', () => {
  setLanguage('fr');
  assert.match(t('home.rounds', { count: 2 }), /2/);
  setLanguage('en');
  assert.equal(t('home.rounds', { count: 2 }), '2 round(s)');
  assert.equal(t('does.not.exist'), 'does.not.exist');
  assert.equal(t('home.leader'), 'Leading: {name}', 'a missing placeholder is left alone');
  setLanguage('fr');
});

test('an unsupported language falls back to French', () => {
  assert.equal(setLanguage('de'), 'fr');
  assert.ok(LANGUAGES.includes(detectLanguage()), 'detection always lands on a supported language');
});

test('both dictionaries define exactly the same keys', async () => {
  const { STRINGS } = await import('../src/i18n.js');
  const fr = Object.keys(STRINGS.fr).sort();
  const en = Object.keys(STRINGS.en).sort();
  assert.deepEqual(en.filter((key) => !STRINGS.fr[key]), [], 'keys only present in English');
  assert.deepEqual(fr.filter((key) => !STRINGS.en[key]), [], 'keys only present in French');
});
