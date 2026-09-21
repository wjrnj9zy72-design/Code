/**
 * What the app already holds, read two other ways: by group, and by person.
 *
 * Nothing new is stored for either. A group's numbers are its own documents
 * counted; a person's file is every list, poll and game that names them.
 *
 * Names are matched the way the tables match them — case, accents and blanks
 * ignored — so one person who wrote "Alice" on one phone and "alice" on
 * another is one person here too, under the spelling written most recently.
 *
 * Pure, like the models: documents in, numbers out.
 */

import { progress } from './lists.js';
import { voteOf } from './polls.js';
import { standings, gameStatus } from './scoring.js';
import { sameName } from './stats.js';

/** Whether a document is in the chosen group. No group chosen means all of them. */
export function inGroup(document_, groupId) {
  return groupId ? document_?.groupId === groupId : true;
}

/**
 * Everyone these documents name, in alphabetical order.
 *
 * Each under the spelling written most recently, because that is the one they
 * chose last — the rule the statistics table already follows.
 */
export function peopleIn({ lists = [], polls = [], games = [] } = {}) {
  const seen = new Map();
  const note = (raw, when) => {
    const name = String(raw || '').trim();
    const key = sameName(name);
    if (!key) return;
    const held = seen.get(key);
    if (!held || (when || 0) >= held.at) seen.set(key, { name, at: when || 0 });
  };

  for (const list of lists) for (const person of list.people || []) note(person.name, list.updatedAt);
  for (const poll of polls) for (const person of poll.people || []) note(person.name, poll.updatedAt);
  for (const game of games) for (const player of game.players || []) note(player.name, game.updatedAt);

  return [...seen.values()].map((row) => row.name).sort((a, b) => a.localeCompare(b));
}

/**
 * What one group has going on — or the whole device, when no group is given.
 *
 * The three numbers are the ones the tabs show, counted the same way: a list
 * with lines left, an open poll, an unfinished game. `left` is the lines still
 * to tick, `at` when anything here last moved (0 when there is nothing).
 */
export function groupCounts({ lists = [], polls = [], games = [] } = {}, groupId = '') {
  const held = {
    lists: lists.filter((list) => inGroup(list, groupId)),
    polls: polls.filter((poll) => inGroup(poll, groupId)),
    games: games.filter((game) => inGroup(game, groupId)),
  };
  const everything = [...held.lists, ...held.polls, ...held.games];

  return {
    lists: held.lists.filter((list) => progress(list).left > 0).length,
    polls: held.polls.filter((poll) => !poll.closedAt).length,
    games: held.games.filter((game) => !gameStatus(game).finished).length,
    left: held.lists.reduce((sum, list) => sum + progress(list).left, 0),
    people: peopleIn(held).length,
    at: Math.max(0, ...everything.map((document_) => document_.updatedAt || 0)),
  };
}

/**
 * One person, across everything: the lines they were given, the polls they
 * were asked, the games they played — newest first in each.
 *
 * `known` says whether that name appears at all; `counts.left` and
 * `counts.votes` are what is still waiting on them, which is what the app puts
 * beside their name. A game with no rounds is left out of the games: nobody
 * played it, so it says nothing about anyone.
 */
export function personFile({ lists = [], polls = [], games = [] } = {}, who) {
  const key = sameName(who);
  const byDate = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const groupIds = new Set();

  let name = String(who || '').trim();
  let at = -1;
  const spelling = (raw, when) => {
    if ((when || 0) < at) return;
    at = when || 0;
    name = String(raw || '').trim() || name;
  };

  const lines = [];
  for (const list of [...lists].sort(byDate)) {
    const person = (list.people || []).find((one) => sameName(one.name) === key);
    if (!person) continue;
    spelling(person.name, list.updatedAt);
    if (list.groupId) groupIds.add(list.groupId);
    const own = progress(list, person.id);
    if (own.total) lines.push({ list, done: own.done, total: own.total, left: own.left });
  }

  const votes = [];
  for (const poll of [...polls].sort(byDate)) {
    const person = (poll.people || []).find((one) => sameName(one.name) === key);
    if (!person) continue;
    spelling(person.name, poll.updatedAt);
    if (poll.groupId) groupIds.add(poll.groupId);
    votes.push({
      poll,
      answered: (poll.options || []).some((option) => voteOf(poll, person.id, option.id)),
      closed: Boolean(poll.closedAt),
    });
  }

  const played = [];
  for (const game of [...games].sort(byDate)) {
    const rows = standings(game);
    const row = rows.find((one) => sameName(one.name) === key);
    if (!row) continue;
    spelling(row.name, game.updatedAt);
    if (game.groupId) groupIds.add(game.groupId);
    if (!game.rounds.length) continue;
    const status = gameStatus(game);
    played.push({
      game,
      rank: row.rank,
      of: rows.length,
      total: row.total,
      won: status.finished && status.winners.some((one) => sameName(one.name) === key),
    });
  }

  return {
    name,
    known: at >= 0,
    groupIds: [...groupIds],
    lines,
    votes,
    played,
    counts: {
      games: played.length,
      wins: played.filter((row) => row.won).length,
      left: lines.reduce((sum, row) => sum + row.left, 0),
      votes: votes.filter((row) => !row.closed && !row.answered).length,
    },
  };
}
