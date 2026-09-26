/**
 * Persistence. localStorage can be absent, full, or throw (private windows,
 * blocked site data), so every access is guarded and the app keeps working
 * from memory when it fails.
 */

import { isValidGame } from './model.js';
import { isValidList } from './lists.js';
import { isValidPoll } from './polls.js';
import { isValidSpend } from './spends.js';
import { isValidBoard } from './ideas.js';

// The keys keep the old name on purpose: renaming them would lose every game
// and every list already on people's phones, to no one's benefit.
const GAMES_KEY = 'marque-points:games:v1';
const LISTS_KEY = 'marque-points:lists:v1';
const POLLS_KEY = 'marque-points:polls:v1';
const SPENDS_KEY = 'marque-points:spends:v1';
const BOARDS_KEY = 'marque-points:boards:v1';
const PREFS_KEY = 'marque-points:prefs:v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadGames() {
  const value = read(GAMES_KEY, []);
  return Array.isArray(value) ? value.filter(isValidGame) : [];
}

export function saveGames(games) {
  return write(GAMES_KEY, games);
}

export function loadLists() {
  const value = read(LISTS_KEY, []);
  return Array.isArray(value) ? value.filter(isValidList) : [];
}

export function saveLists(lists) {
  return write(LISTS_KEY, lists);
}

export function loadPolls() {
  const value = read(POLLS_KEY, []);
  return Array.isArray(value) ? value.filter(isValidPoll) : [];
}

export function savePolls(polls) {
  return write(POLLS_KEY, polls);
}

export function loadSpends() {
  const value = read(SPENDS_KEY, []);
  return Array.isArray(value) ? value.filter(isValidSpend) : [];
}

export function saveSpends(spends) {
  return write(SPENDS_KEY, spends);
}

export function loadBoards() {
  const value = read(BOARDS_KEY, []);
  return Array.isArray(value) ? value.filter(isValidBoard) : [];
}

export function saveBoards(boards) {
  return write(BOARDS_KEY, boards);
}

export function loadPrefs() {
  const value = read(PREFS_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

/**
 * Preferences are written key by key over what is already stored, not as a
 * wholesale replacement.
 *
 * Each tab holds its own copy in memory, so a tab that has been open a while
 * and then writes one setting would otherwise throw away everything the others
 * have written since — the groups with their keys, and a ticket handed over
 * once and stored nowhere else. Merging makes the last writer win over the
 * setting it touched, and nothing else.
 */
export function savePrefs(prefs) {
  const stored = loadPrefs();
  return write(PREFS_KEY, { ...stored, ...prefs });
}
