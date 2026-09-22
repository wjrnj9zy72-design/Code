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
import { balances } from './spends.js';
import { standings, gameStatus } from './scoring.js';
import { sameName } from './stats.js';

/**
 * Whether a document is in the chosen group. No group chosen means all of them.
 *
 * A link-only document carries a group — the one whose key created it, and so
 * the one that may delete it — without belonging to it: the group never sees
 * it. Counting it under that group here would say the opposite of what the
 * database does.
 */
export function inGroup(document_, groupId) {
  if (!groupId) return true;
  return document_?.groupId === groupId && !document_?.linkOnly;
}

/**
 * Today, as a line writes it: `AAAA-MM-JJ`, in the reader's own time zone.
 *
 * Built by hand rather than with toISOString(), which answers in UTC — and in
 * Paris that turns the first hours of a day into the day before.
 */
export function dayNow(at = Date.now()) {
  const date = new Date(at);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A line nobody has ticked whose day has passed. Today is not late: a line due
 * today is a line for today.
 */
export function isLate(item, today = dayNow()) {
  return Boolean(item && item.due && !item.done && item.due < today);
}

/**
 * What still counts. Archiving says "stop showing me this", so an archived
 * document is nowhere in the numbers — and a model is not a list in progress,
 * it is what the next one is cut from.
 *
 * History is another matter: the statistics and someone's past evenings still
 * hold their archived games. Archiving clears the tab, it does not rewrite
 * what happened.
 */
export function isLive(document_) {
  return Boolean(document_) && !document_.archivedAt && !document_.template;
}

/**
 * Everyone these documents name, in alphabetical order.
 *
 * Each under the spelling written most recently, because that is the one they
 * chose last — the rule the statistics table already follows.
 */
export function peopleIn({ lists = [], polls = [], games = [], spends = [] } = {}) {
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
  for (const spend of spends) for (const person of spend.people || []) note(person.name, spend.updatedAt);

  return [...seen.values()].map((row) => row.name).sort((a, b) => a.localeCompare(b));
}

/**
 * What one group has going on — or the whole device, when no group is given.
 *
 * The three numbers are the ones the tabs show, counted the same way: a list
 * with lines left, an open poll, an unfinished game. `left` is the lines still
 * to tick, `at` when anything here last moved (0 when there is nothing).
 */
export function groupCounts({ lists = [], polls = [], games = [], spends = [] } = {}, groupId = '', today = dayNow()) {
  const mine = (documents) => documents.filter((document_) => inGroup(document_, groupId));
  const held = { lists: mine(lists), polls: mine(polls), games: mine(games), spends: mine(spends) };
  const live = {
    lists: held.lists.filter(isLive),
    polls: held.polls.filter(isLive),
    games: held.games.filter(isLive),
    spends: held.spends.filter(isLive),
  };
  const everything = [...held.lists, ...held.polls, ...held.games, ...held.spends];

  return {
    lists: live.lists.filter((list) => progress(list).left > 0).length,
    polls: live.polls.filter((poll) => !poll.closedAt).length,
    games: live.games.filter((game) => !gameStatus(game).finished).length,
    // Un compte compte tant que quelqu'un y doit quelque chose : un compte
    // soldé n'est pas en cours, il est fini.
    spends: live.spends.filter((spend) => balances(spend).some((row) => row.balance !== 0)).length,
    left: live.lists.reduce((sum, list) => sum + progress(list).left, 0),
    late: live.lists.reduce((sum, list) => sum + list.items.filter((item) => isLate(item, today)).length, 0),
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
export function personFile({ lists = [], polls = [], games = [], spends = [] } = {}, who, today = dayNow()) {
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

  // Archived and model lists are skipped: what waits on someone has to be
  // something they can still do. Their games are another matter — see below.
  const lines = [];
  for (const list of [...lists].sort(byDate)) {
    const person = (list.people || []).find((one) => sameName(one.name) === key);
    if (!person) continue;
    spelling(person.name, list.updatedAt);
    if (list.groupId) groupIds.add(list.groupId);
    if (!isLive(list)) continue;
    const own = progress(list, person.id);
    if (!own.total) continue;
    const late = list.items.filter((item) => item.who === person.id && isLate(item, today)).length;
    const next = list.items
      .filter((item) => item.who === person.id && item.due && !item.done)
      .map((item) => item.due)
      .sort()[0] || null;
    lines.push({ list, done: own.done, total: own.total, left: own.left, late, next });
  }

  const votes = [];
  for (const poll of [...polls].sort(byDate)) {
    const person = (poll.people || []).find((one) => sameName(one.name) === key);
    if (!person) continue;
    spelling(person.name, poll.updatedAt);
    if (poll.groupId) groupIds.add(poll.groupId);
    if (!isLive(poll)) continue;
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

  // Les comptes où cette personne figure, et ce qu'elle y doit ou qu'on lui y
  // doit. Positif : on lui doit.
  const accounts = [];
  for (const spend of [...spends].sort(byDate)) {
    const person = (spend.people || []).find((one) => sameName(one.name) === key);
    if (!person) continue;
    spelling(person.name, spend.updatedAt);
    if (spend.groupId) groupIds.add(spend.groupId);
    if (!isLive(spend)) continue;
    const row = balances(spend).find((one) => one.id === person.id);
    accounts.push({ spend, paid: row?.paid || 0, balance: row?.balance || 0 });
  }

  return {
    name,
    known: at >= 0,
    groupIds: [...groupIds],
    lines,
    votes,
    played,
    accounts,
    counts: {
      games: played.length,
      wins: played.filter((row) => row.won).length,
      left: lines.reduce((sum, row) => sum + row.left, 0),
      late: lines.reduce((sum, row) => sum + row.late, 0),
      votes: votes.filter((row) => !row.closed && !row.answered).length,
      owes: accounts.reduce((sum, row) => sum + (row.balance < 0 ? -row.balance : 0), 0),
      owed: accounts.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
    },
  };
}
