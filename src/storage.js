/**
 * Persistence. localStorage can be absent, full, or throw (private windows,
 * blocked site data), so every access is guarded and the app keeps working
 * from memory when it fails.
 */

import { isValidGame } from './model.js';

const GAMES_KEY = 'marque-points:games:v1';
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

export function loadPrefs() {
  const value = read(PREFS_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

export function savePrefs(prefs) {
  return write(PREFS_KEY, prefs);
}
