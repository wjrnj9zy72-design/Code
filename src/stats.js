/**
 * What the accumulated games say about the people who played them.
 *
 * Players are matched by name, since each game mints its own ids: across an
 * evening and across months, "Alice" is Alice. Totals only mean something
 * within one game — 250 is a rout at Papayoo and nothing at Mille Bornes — so
 * everything here is computed per preset.
 *
 * Matched by name means matched *forgivingly*: one person typing their own name
 * on two phones, or the same phone six months apart, writes "Alice", "alice" and
 * "  Alice" — and two lines in the table for one person would be wrong, not
 * pedantic. Case, accents and surrounding blanks are ignored; the spelling shown
 * is the one most recently played, because that is the one they chose last.
 * "Alex" and "Alexandre" stay two people: they are two names, and only whoever
 * played can say otherwise — by renaming the player.
 */

import { standings, gameStatus } from './scoring.js';

/** The key two spellings of one name share. */
export function sameName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** The presets actually played, most played first. */
export function presetsPlayed(games) {
  const counts = new Map();
  for (const game of games) {
    if (!game.rounds.length) continue;
    counts.set(game.presetId, (counts.get(game.presetId) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([presetId, played]) => ({ presetId, played }));
}

/**
 * One row per player for a given game: how many played, how many won, their
 * average and their best. Only games with rounds count, and only finished
 * games can be won — a game in progress has a leader, not a winner.
 */
export function statsFor(games, presetId) {
  const rows = new Map();
  const played = games.filter((game) => game.presetId === presetId && game.rounds.length);

  // Oldest first, so the last spelling written is the one the table shows.
  const inOrder = [...played].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  for (const game of inOrder) {
    const status = gameStatus(game);
    const winners = new Set(status.winners.map((row) => sameName(row.name)));

    for (const row of standings(game)) {
      const key = sameName(row.name);
      const stat = rows.get(key) || {
        name: row.name,
        played: 0,
        won: 0,
        totals: [],
      };
      stat.name = row.name;
      stat.played += 1;
      if (winners.has(key)) stat.won += 1;
      stat.totals.push(row.total);
      rows.set(key, stat);
    }
  }

  const direction = played[0]?.config.direction || 'low';
  const best = (totals) => (direction === 'low' ? Math.min(...totals) : Math.max(...totals));

  return [...rows.values()]
    .map((stat) => ({
      name: stat.name,
      played: stat.played,
      won: stat.won,
      average: Math.round(stat.totals.reduce((sum, value) => sum + value, 0) / stat.totals.length),
      best: best(stat.totals),
    }))
    .sort((a, b) => b.won - a.won || b.played - a.played || a.name.localeCompare(b.name));
}
