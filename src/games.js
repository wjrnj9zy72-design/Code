/**
 * Game presets.
 *
 * Every game is described with the same handful of knobs so the scoring engine
 * stays generic. Adding a game means adding an entry here — no UI changes.
 *
 *   direction   'low'  lowest total wins (penalty games: Papayoo, Hearts…)
 *               'high' highest total wins (Belote, Uno…)
 *   endMode     'threshold' the game ends as soon as someone reaches `target`
 *               'rounds'    the game ends after a fixed number of rounds
 *               'manual'    it ends when the players say so
 *   roundSum    expected sum of a round's scores, or null when it is free.
 *               Checked as a warning only: most games have variants that break it.
 *   entrantLabel what we are scoring: 'player' or 'team'.
 *   meta        one optional per-round field (e.g. which suit was the Papayoo).
 *   helper      an optional card counter for the round form; see src/helpers.js.
 */

/** Skyjo's deck runs from -2 to 12. */
const SKYJO_VALUES = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The twenty Payoos, each worth its face value. */
const PAYOOS = Array.from({ length: 20 }, (_, index) => index + 1);

/** Suits used by Papayoo's per-round special card. */
const SUITS = [
  { value: 'hearts', label: '♥' },
  { value: 'diamonds', label: '♦' },
  { value: 'spades', label: '♠' },
  { value: 'clubs', label: '♣' },
];

export const PRESETS = [
  {
    id: 'papayoo',
    name: 'Papayoo',
    players: [3, 8],
    direction: 'low',
    endMode: 'threshold',
    target: 250,
    rounds: null,
    roundSum: 250,
    allowNegative: false,
    entrantLabel: 'player',
    meta: { key: 'papayooSuit', labelKey: 'meta.papayooSuit', options: SUITS },
    helper: {
      mode: 'toggle',
      values: PAYOOS,
      hintKey: 'helper.papayoo.hint',
      toggles: [{ key: 'papayoo', labelKey: 'helper.papayoo.card', add: 40 }],
    },
    notesKey: 'notes.papayoo',
  },
  {
    id: 'hearts',
    name: 'Hearts / Cœurs',
    players: [3, 6],
    direction: 'low',
    endMode: 'threshold',
    target: 100,
    rounds: null,
    roundSum: 26,
    allowNegative: false,
    entrantLabel: 'player',
    meta: null,
    helper: {
      mode: 'count',
      values: [1],
      labels: { 1: '♥' },
      hintKey: 'helper.hearts.hint',
      toggles: [{ key: 'queen', labelKey: 'helper.hearts.queen', add: 13 }],
    },
    notesKey: 'notes.hearts',
  },
  {
    id: 'belote',
    name: 'Belote / Coinche',
    players: [2, 2],
    direction: 'high',
    endMode: 'threshold',
    target: 1000,
    rounds: null,
    roundSum: 162,
    allowNegative: false,
    entrantLabel: 'team',
    meta: null,
    notesKey: 'notes.belote',
  },
  {
    id: 'tarot',
    name: 'Tarot',
    players: [3, 5],
    direction: 'high',
    endMode: 'rounds',
    target: null,
    rounds: 5,
    roundSum: 0,
    allowNegative: true,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.tarot',
  },
  {
    id: 'skyjo',
    name: 'Skyjo',
    players: [2, 8],
    direction: 'low',
    endMode: 'threshold',
    target: 100,
    rounds: null,
    roundSum: null,
    allowNegative: true,
    entrantLabel: 'player',
    meta: null,
    helper: {
      mode: 'count',
      values: SKYJO_VALUES,
      hintKey: 'helper.skyjo.hint',
      toggles: [{ key: 'doubled', labelKey: 'helper.skyjo.doubled', multiply: 2 }],
    },
    notesKey: 'notes.skyjo',
  },
  {
    id: 'sixquiprend',
    name: '6 qui prend !',
    players: [2, 10],
    direction: 'low',
    endMode: 'threshold',
    target: 66,
    rounds: null,
    roundSum: null,
    allowNegative: false,
    entrantLabel: 'player',
    meta: null,
    helper: {
      mode: 'count',
      values: [1, 2, 3, 5, 7],
      hintKey: 'helper.sixquiprend.hint',
      toggles: [],
    },
    notesKey: 'notes.sixquiprend',
  },
  {
    id: 'uno',
    name: 'Uno',
    players: [2, 10],
    direction: 'high',
    endMode: 'threshold',
    target: 500,
    rounds: null,
    roundSum: null,
    allowNegative: false,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.uno',
  },
  {
    id: 'rummy',
    name: 'Rami / Rummy',
    players: [2, 6],
    direction: 'high',
    endMode: 'threshold',
    target: 500,
    rounds: null,
    roundSum: null,
    allowNegative: true,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.rummy',
  },
  {
    id: 'yams',
    name: 'Yams / Yahtzee',
    players: [1, 8],
    direction: 'high',
    endMode: 'manual',
    target: null,
    rounds: null,
    roundSum: null,
    allowNegative: false,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.yams',
  },
  {
    id: 'millebornes',
    name: 'Mille Bornes',
    players: [2, 6],
    direction: 'high',
    endMode: 'threshold',
    target: 5000,
    rounds: null,
    roundSum: null,
    allowNegative: false,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.millebornes',
  },
  {
    id: 'custom',
    name: 'custom',
    players: [1, 12],
    direction: 'low',
    endMode: 'manual',
    target: null,
    rounds: null,
    roundSum: null,
    allowNegative: true,
    entrantLabel: 'player',
    meta: null,
    notesKey: 'notes.custom',
  },
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** The part of a preset a game copies into its own config (and may then edit). */
export function presetConfig(preset) {
  return {
    direction: preset.direction,
    endMode: preset.endMode,
    target: preset.target,
    rounds: preset.rounds,
    roundSum: preset.roundSum,
    allowNegative: preset.allowNegative,
    entrantLabel: preset.entrantLabel,
  };
}
