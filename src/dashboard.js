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
import { voteOf, goers, lastDay } from './polls.js';
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
export function groupCounts({ lists = [], polls = [], games = [], spends = [], boards = [] } = {}, groupId = '', today = dayNow()) {
  const mine = (documents) => documents.filter((document_) => inGroup(document_, groupId));
  const held = { lists: mine(lists), polls: mine(polls), games: mine(games), spends: mine(spends) };
  const live = {
    lists: held.lists.filter(isLive),
    polls: held.polls.filter(isLive),
    games: held.games.filter(isLive),
    spends: held.spends.filter(isLive),
  };
  const ideas = mine(boards);
  const everything = [...held.lists, ...held.polls, ...held.games, ...held.spends, ...ideas];

  return {
    lists: live.lists.filter((list) => progress(list).left > 0).length,
    polls: live.polls.filter((poll) => !poll.closedAt).length,
    games: live.games.filter((game) => !gameStatus(game).finished).length,
    // Un compte compte tant que quelqu'un y doit quelque chose : un compte
    // soldé n'est pas en cours, il est fini.
    spends: live.spends.filter((spend) => balances(spend).some((row) => row.balance !== 0)).length,
    // A board has nothing to finish: it counts for as long as it is out.
    boards: ideas.filter(isLive).length,
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

/* ------------------------------------------------------------- the chain --- */

/**
 * Anything can be attached to anything else — a list to an event, a poll to
 * that list — and the chain goes up to an event, the one thing that sits above
 * all others and is never attached itself. A document says what it hangs from,
 * and nothing else is stored: the parent finds its children by that.
 *
 * `parent` is the id of what it hangs from, null once detached. Documents made
 * before the chain say `event` instead, which reads the same until they are
 * attached or detached again.
 */
export function parentId(document_) {
  if (!document_) return null;
  return Object.prototype.hasOwnProperty.call(document_, 'parent') ? document_.parent || null : document_.event || null;
}

/** An event: a poll that has settled on its day, or made with its day known. */
export function isEventDoc(document_) {
  return document_?.kind === 'poll' && Boolean(document_.date || document_.fixed);
}

/** The kind of a document, games included, which predate the field. */
export function kindOf(document_) {
  if (document_?.kind) return document_.kind;
  return document_?.presetId ? 'game' : null;
}

/** Everything held, of every kind, in one array. */
export function allDocuments({ lists = [], polls = [], games = [], spends = [], boards = [] } = {}) {
  return [...lists, ...polls, ...games, ...spends, ...boards];
}

/** What a document hangs from, up to the top: the farthest first. */
export function ancestorsOf(document_, all) {
  const byId = new Map(all.map((one) => [one.id, one]));
  const chain = [];
  const seen = new Set([document_.id]);
  let above = byId.get(parentId(document_));
  while (above && !seen.has(above.id)) {
    chain.unshift(above);
    seen.add(above.id);
    above = byId.get(parentId(above));
  }
  return chain;
}

/** The event a document is for, however far up the chain: the nearest one. */
export function eventOf(document_, all) {
  return [...ancestorsOf(document_, all)].reverse().find(isEventDoc) || null;
}

/** What hangs directly from a document. */
export function childrenOf(document_, all) {
  return all.filter((one) => one.id !== document_.id && parentId(one) === document_.id);
}

/** Everything below a document, however deep, each once. */
export function descendantsOf(document_, all) {
  const found = [];
  const seen = new Set([document_.id]);
  const queue = [document_];
  while (queue.length) {
    const current = queue.shift();
    for (const child of childrenOf(current, all)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/**
 * The whole chain a document belongs to, as a tree: from the top of its chain
 * — its event, most of the time — down to everything attached below, each
 * node `{ document, children }`. What is put away is left out, except the
 * document itself. Children come in the order their links set — what must be
 * done first, first (see stepOf) — then in the order of the tabs, by title.
 */
export function chainTree(document_, all) {
  const top = ancestorsOf(document_, all)[0] || document_;
  const order = ['poll', 'list', 'game', 'spend', 'board'];
  const rank = (one) => (isEventDoc(one) ? -1 : order.indexOf(kindOf(one)));
  const title = (one) => String(one.title || one.name || one.question || '');
  // Activities in the order they happen, as on the programme; those to
  // schedule after.
  const when = (one) => (isEventDoc(one) ? (one.date ? `${one.date} ${one.at || ''}` : '~') : '');
  const byWhen = (a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0);
  const seen = new Set();
  const grow = (node) => {
    seen.add(node.id);
    const children = childrenOf(node, all)
      .filter((one) => !seen.has(one.id) && (isLive(one) || one.id === document_.id))
      .sort((a, b) => stepOf(a, all) - stepOf(b, all) || rank(a) - rank(b) || byWhen(a, b) || title(a).localeCompare(title(b)));
    return { document: node, children: children.map((child) => (seen.has(child.id) ? null : grow(child))).filter(Boolean) };
  };
  return grow(top);
}

/** How many documents a tree holds, its top included. */
export function treeSize(tree) {
  return 1 + tree.children.reduce((sum, child) => sum + treeSize(child), 0);
}

/**
 * What a document may be attached to: anything live in the same group — or
 * kept to oneself like it — except itself and what already hangs below it,
 * which would close the chain on itself.
 *
 * An event goes only under another event, and becomes one of its activities:
 * the rando of the weekend, the karaoke of the raclette. One level only — an
 * activity holds no activity, and an event with activities of its own stays
 * on top.
 */
export function attachTargets(document_, all) {
  const below = new Set(descendantsOf(document_, all).map((one) => one.id));
  const group = document_.groupId || null;
  const fits = (one) => one.id !== document_.id && !below.has(one.id) && isLive(one) && (one.groupId || null) === group;
  if (isEventDoc(document_)) {
    if (childrenOf(document_, all).some(isEventDoc)) return [];
    return all.filter((one) => fits(one) && isEventDoc(one) && !isActivity(one, all));
  }
  return all.filter(fits);
}

/* ------------------------------------------------------------ activities --- */

/** An activity: an event attached to another event. */
export function isActivity(document_, all) {
  if (!isEventDoc(document_)) return false;
  const above = all.find((one) => one.id === parentId(document_));
  return Boolean(above && isEventDoc(above));
}

/** The event a document belongs to, above its activity if it is in one. */
export function topEventOf(document_, all) {
  const event = isEventDoc(document_) ? document_ : eventOf(document_, all);
  if (!event) return null;
  return isActivity(event, all) ? all.find((one) => one.id === parentId(event)) || event : event;
}

/** The days an event takes up, first to last — two weeks at most. */
export function eventDays(event) {
  if (!event?.date) return [];
  const days = [];
  const [year, month, day] = event.date.split('-').map(Number);
  const last = lastDay(event);
  for (let i = 0; i < 14; i += 1) {
    const date = new Date(year, month - 1, day + i);
    const text = dayNow(date.getTime());
    if (text > last) break;
    days.push(text);
  }
  return days;
}

/**
 * An event's activities, in the order they happen: by day and hour, those
 * with no day yet last — « à caler ».
 */
export function programmeOf(event, all) {
  // Compared as plain text, not by locale: a collation puts « ~ » before digits.
  const key = (one) => (one.date ? `${one.date} ${one.at || ''}` : `~${String(one.createdAt || 0).padStart(15, '0')}`);
  return childrenOf(event, all)
    .filter((one) => isEventDoc(one) && isLive(one))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Whether an activity's day falls outside its event's. */
export function outsideEvent(activity, event) {
  if (!activity?.date || !event?.date) return false;
  return activity.date < event.date || activity.date > lastDay(event);
}

/**
 * Attach a document to another, or detach it with null. Last write wins, as
 * for a title: the stamp makes this copy the newer one.
 */
export function attach(document_, targetId) {
  const { event: _legacy, ...rest } = document_;
  return { ...rest, parent: targetId || null, updatedAt: Math.max(Date.now(), (document_.updatedAt || 0) + 1) };
}

/**
 * Everything made for an event, however deep in its chain, by kind, newest
 * first in each. `list` and `spend` are the first of each — the list of what
 * to bring and the account of what was spent, when there is one.
 */
export function eventParts(poll, state = {}) {
  const all = allDocuments(state);
  const below = descendantsOf(poll, all);
  const recent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const of = (kind) => below.filter((one) => kindOf(one) === kind && !isEventDoc(one)).sort(recent);
  const parts = {
    lists: of('list'), spends: of('spend'), polls: of('poll'), boards: of('board'), games: of('game'),
    activities: programmeOf(poll, all),
  };
  return { ...parts, list: parts.lists[0] || null, spend: parts.spends[0] || null };
}

/** How many documents hang off an event, all kinds together. */
export function partsCount(parts) {
  return parts.lists.length + parts.spends.length + parts.polls.length + parts.boards.length + parts.games.length
    + (parts.activities || []).length;
}

/**
 * The events still to come — or under way: a weekend is not past on its
 * Saturday — soonest first.
 */
export function upcomingEvents(polls = [], today = dayNow()) {
  // An activity shows inside its event, not as one more event beside it.
  return polls
    .filter((poll) => isLive(poll) && poll.date && lastDay(poll) >= today && !isActivity(poll, polls))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.at || '').localeCompare(String(b.at || '')));
}

/**
 * Make a fresh list or account part of a poll's event: tied to the poll, in
 * the poll's group, and between the people who are coming. `make` is
 * createList or createSpend.
 */
export function forEvent(poll, make, name) {
  const made = make({ name, names: goers(poll) });
  return {
    ...made,
    parent: poll.id,
    shared: Boolean(poll.shared),
    groupId: poll.groupId || null,
    ...(poll.linkOnly ? { linkOnly: true } : {}),
  };
}

/* ------------------------------------------------------------- the links --- */

/**
 * The chain says what belongs to what; it is a tree, one parent each. Links
 * say the rest, across it: this list goes with that account, this poll must
 * be closed before the list can be drawn up, that game comes after the
 * raclette. Any two things of a group may be linked, in one of three ways:
 *
 * - `with`: they go together, nothing more;
 * - `after`: this one waits for the other — it comes after it;
 * - `before`: this one comes first — the other waits for it.
 *
 * One side holds the link, in `links` (`{ id, kind }`), and the other finds it
 * by that, as a parent finds its children: one document written, never two.
 * Last write wins, as for a title.
 */
export const LINK_KINDS = ['with', 'after', 'before'];

/** The links a document holds itself, cleaned up. */
export function linksOf(document_) {
  const seen = new Set();
  return (Array.isArray(document_?.links) ? document_.links : [])
    .filter((one) => one && typeof one.id === 'string' && LINK_KINDS.includes(one.kind))
    .filter((one) => (seen.has(one.id) ? false : seen.add(one.id)));
}

/**
 * Every link that touches a document, whichever side holds it, as it reads
 * from here: `with`, `waits` (for the other) or `unblocks` (the other).
 * `holder` is the id of the document that holds it — the one to write to
 * undo it. What is put away or gone is left out.
 */
export function relationsOf(document_, all) {
  const byId = new Map(all.map((one) => [one.id, one]));
  const found = new Map();
  const note = (other, kind, holder) => {
    if (!other || other.id === document_.id || found.has(other.id) || !isLive(other)) return;
    found.set(other.id, { document: other, kind, holder });
  };
  for (const link of linksOf(document_)) {
    note(byId.get(link.id), { with: 'with', after: 'waits', before: 'unblocks' }[link.kind], document_.id);
  }
  for (const other of all) {
    const link = linksOf(other).find((one) => one.id === document_.id);
    if (link) note(other, { with: 'with', after: 'unblocks', before: 'waits' }[link.kind], other.id);
  }
  const order = { waits: 0, unblocks: 1, with: 2 };
  return [...found.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}

/**
 * Whether what a document is for is done: a poll closed or settled on its
 * day, an event past, a list all ticked, an account settled, a game over.
 * A board has nothing to finish: null.
 */
export function isDone(document_, today = dayNow()) {
  const kind = kindOf(document_);
  if (kind === 'poll') return isEventDoc(document_) && document_.date ? lastDay(document_) < today : Boolean(document_.closedAt);
  if (kind === 'list') {
    const { total, left } = progress(document_);
    return total > 0 && left === 0;
  }
  if (kind === 'spend') return (document_.lines || []).length > 0 && balances(document_).every((row) => row.balance === 0);
  if (kind === 'game') return gameStatus(document_).finished;
  return null;
}

/** What a document still waits for: the things it comes after, not done yet. */
export function waitingOn(document_, all, today = dayNow()) {
  return relationsOf(document_, all)
    .filter((one) => one.kind === 'waits' && isDone(one.document, today) === false)
    .map((one) => one.document);
}

/** Whether `from` must come before `to`, however many steps between them. */
function comesBefore(fromId, toId, all) {
  const next = new Map();
  const edge = (a, b) => next.set(a, [...(next.get(a) || []), b]);
  for (const one of all) {
    for (const link of linksOf(one)) {
      if (link.kind === 'after') edge(link.id, one.id);
      if (link.kind === 'before') edge(one.id, link.id);
    }
  }
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    for (const id of next.get(queue.shift()) || []) {
      if (id === toId) return true;
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return false;
}

/**
 * What a document may be linked to, in a given way: anything live in its
 * group, except itself and what it is linked to already. An order never goes
 * round in a circle: nothing waits, however indirectly, for what waits for it.
 */
export function linkTargets(document_, all, kind = 'with') {
  const linked = new Set(relationsOf(document_, all).map((one) => one.document.id));
  const group = document_.groupId || null;
  return all.filter((one) => {
    if (one.id === document_.id || linked.has(one.id) || !isLive(one) || (one.groupId || null) !== group) return false;
    if (kind === 'after') return !comesBefore(document_.id, one.id, all);
    if (kind === 'before') return !comesBefore(one.id, document_.id, all);
    return true;
  });
}

/** Link a document to another, in one of the three ways. */
export function linkTo(document_, targetId, kind = 'with') {
  const links = [...linksOf(document_).filter((one) => one.id !== targetId), { id: targetId, kind }];
  return { ...document_, links, updatedAt: Math.max(Date.now(), (document_.updatedAt || 0) + 1) };
}

/** Undo a link this document holds. */
export function unlinkFrom(document_, targetId) {
  const links = linksOf(document_).filter((one) => one.id !== targetId);
  return { ...document_, links, updatedAt: Math.max(Date.now(), (document_.updatedAt || 0) + 1) };
}

/**
 * How far down its order a document stands: 0 when it waits for nothing,
 * else one more than the farthest of what it waits for. Siblings in a tree
 * are drawn in this order, so the chain reads from what comes first.
 */
export function stepOf(document_, all, seen = new Set()) {
  if (seen.has(document_.id)) return 0;
  const before = relationsOf(document_, all).filter((one) => one.kind === 'waits');
  if (!before.length) return 0;
  const path = new Set([...seen, document_.id]);
  return 1 + Math.max(...before.map((one) => stepOf(one.document, all, path)));
}
