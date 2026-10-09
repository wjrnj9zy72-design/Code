/**
 * What linked things do for each other. A link says two things belong
 * together; these are the ways one feeds the other, each a tap:
 *
 * - a board's ideas become lines of the list it goes with;
 * - a board's ideas become the choices of a poll, to vote on them;
 * - what a closed poll chose becomes a line of the list it goes with;
 * - a line ticked becomes an expense of the account it goes with;
 * - whoever joins an event comes into its lists and accounts.
 *
 * What came from where is written on what it made — `from: { doc, part }` on
 * a line or an expense — so nothing is offered twice. Nothing happens by
 * itself: two phones doing it at once would do it twice.
 *
 * Pure, like the models.
 */

import { addItems } from './lists.js';
import { createPoll, createEvent, addOptions, tally, goers, choiceOfDay, voteOf, optionDay } from './polls.js';
import { addSpend } from './spends.js';
import { cardsInOrder } from './ideas.js';
import { addPerson } from './people.js';
import { sameName } from './stats.js';
import { touch } from './stamp.js';
import {
  relationsOf, kindOf, isEventDoc, isLive, isDone, parentId, descendantsOf, dayNow, topEventOf, programmeOf, eventDays,
} from './dashboard.js';

/** The things of one kind a document is linked to, whichever way. */
export function related(document_, all, kind) {
  return relationsOf(document_, all)
    .map((one) => one.document)
    .filter((one) => kindOf(one) === kind && !isEventDoc(one));
}

/** A text on one line, as a line of a list or a choice of a poll holds it. */
function oneLine(text) {
  return String(text || '').split('\n').map((part) => part.trim()).filter(Boolean).join(' — ');
}

/** Whether something in `rows` came from that part of that document. */
function cameFrom(rows, docId, partId) {
  return (rows || []).some((row) => row.from?.doc === docId && row.from?.part === partId);
}

/** Put a mark on the last row a model added: where it came from. */
function markLast(document_, field, from) {
  const rows = document_[field];
  const last = rows[rows.length - 1];
  return touch(document_, { [field]: [...rows.slice(0, -1), { ...last, from }] });
}

/* ------------------------------------------------------ ideas → a list --- */

/** A board's ideas, as a list may take them: those with words, and whether taken. */
export function ideasFor(list, board) {
  return cardsInOrder(board)
    .map((card) => ({ card, text: oneLine(card.text), added: cameFrom(list.items, board.id, card.id) }))
    .filter((one) => one.text);
}

/** Make an idea a line of the list. */
export function addIdea(list, board, card) {
  const text = oneLine(card.text);
  if (!text || cameFrom(list.items, board.id, card.id)) return list;
  const next = addItems(list, text);
  return next === list ? list : markLast(next, 'items', { doc: board.id, part: card.id });
}

/* ------------------------------------------------------ ideas → a poll --- */

/**
 * A poll whose choices are a board's ideas, to vote on them. It comes after
 * the board, in the same group and the same place in the chain.
 */
export function pollFromIdeas(board, { question = '', names = [] } = {}) {
  const texts = [...new Set(cardsInOrder(board).map((card) => oneLine(card.text)).filter(Boolean))];
  const poll = addOptions(
    createPoll({ question: question || board.name, names, shared: Boolean(board.shared), groupId: board.groupId || null }),
    texts.join('\n'),
  );
  return {
    ...poll,
    parent: parentId(board),
    links: [{ id: board.id, kind: 'after' }],
    ...(board.linkOnly ? { linkOnly: true } : {}),
  };
}

/* ------------------------------------------------- a poll's choice → a list --- */

/** What a closed poll chose: the choices ahead, ties and all. Nothing while open. */
export function winnersOf(poll) {
  if (!poll?.closedAt || isEventDoc(poll)) return [];
  const { leaders } = tally(poll);
  return poll.options.filter((option) => leaders.includes(option.id));
}

/** What a closed poll chose, as a list may take it, and whether taken. */
export function winnerOffers(poll, list) {
  return winnersOf(poll).map((option) => ({ option, added: cameFrom(list.items, poll.id, option.id) }));
}

/** Make what the poll chose a line of the list. */
export function addWinner(list, poll, option) {
  const text = oneLine(option.text);
  if (!text || cameFrom(list.items, poll.id, option.id)) return list;
  const next = addItems(list, text);
  return next === list ? list : markLast(next, 'items', { doc: poll.id, part: option.id });
}

/* -------------------------------------------------- a line → an account --- */

/** The lines of a list already written in an account. */
export function spentItems(spend, list) {
  return new Set((spend.lines || []).filter((line) => line.from?.doc === list.id).map((line) => line.from.part));
}

/**
 * Write a line of a list as an expense: its text, the amount given, paid by
 * whoever the line was for — found by name, brought into the account if it
 * does not have them — and shared by everyone.
 */
export function spendFromLine(spend, list, item, amount, byName = null) {
  if (spentItems(spend, list).has(item.id)) return spend;
  const name = String(byName || list.people.find((person) => person.id === item.who)?.name || '').trim();
  let next = spend;
  let payer = name ? next.people.find((person) => sameName(person.name) === sameName(name)) : null;
  if (name && !payer) {
    next = addPerson(next, name);
    payer = next.people[next.people.length - 1];
  }
  const added = addSpend(next, { text: oneLine(item.text), amount, by: payer?.id || null });
  if (added === next) return spend;
  return markLast(added, 'lines', { doc: list.id, part: item.id });
}

/* ------------------------------------------------------- what is freed --- */

/**
 * What has just been unblocked: things not done yet, that waited for others
 * which are now all done — the last of them lately (`days`). Each with what
 * freed it, newest first.
 */
export function unblockedNow(all, { today = dayNow(), now = Date.now(), days = 7 } = {}) {
  const since = now - days * 864e5;
  const found = [];
  for (const document_ of all) {
    if (!isLive(document_) || isDone(document_, today) === true) continue;
    const waited = relationsOf(document_, all).filter((one) => one.kind === 'waits').map((one) => one.document);
    const done = waited.filter((one) => isDone(one, today) !== null);
    if (!done.length || done.some((one) => !isDone(one, today))) continue;
    const at = Math.max(...done.map((one) => one.closedAt || one.updatedAt || 0));
    if (at >= since) found.push({ document: document_, by: done, at });
  }
  return found.sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------ an event's people → all --- */

/** The lists and accounts under an event that miss some of who is coming. */
export function missingGoers(event, all) {
  const coming = goers(event).map((name) => String(name || '').trim()).filter(Boolean);
  return descendantsOf(event, all)
    .filter((one) => isLive(one) && ['list', 'spend'].includes(kindOf(one)))
    .map((one) => ({
      document: one,
      names: coming.filter((name) => !(one.people || []).some((person) => sameName(person.name) === sameName(name))),
    }))
    .filter((one) => one.names.length);
}

/** Bring people into a list or an account. Nobody is taken out. */
export function addGoers(document_, names) {
  return names.reduce((next, name) => (
    next.people.some((person) => sameName(person.name) === sameName(name)) ? next : addPerson(next, name)
  ), document_);
}

/* ----------------------------------------------------------- activities --- */

/**
 * A new activity of an event: an event of its own, under it, in its group,
 * between the people coming to it unless told otherwise. No day means « à
 * caler ».
 */
export function activityFor(event, { name = '', date = null, at = null, names = null, from = null } = {}) {
  const made = createEvent({ name, names: names || goers(event), date, at });
  return {
    ...made,
    parent: event.id,
    shared: Boolean(event.shared),
    groupId: event.groupId || null,
    ...(event.linkOnly ? { linkOnly: true } : {}),
    ...(from ? { from } : {}),
  };
}

/** Whether an event already has an activity made from that part of that document. */
function madeFrom(event, all, docId, partId) {
  return programmeOf(event, all).some((one) => one.from?.doc === docId && one.from?.part === partId);
}

/**
 * A board's ideas, as activities of the event it is part of: those with
 * words, and whether one was made already. Nothing when it is part of none.
 */
export function ideaActivities(board, all) {
  const event = topEventOf(board, all);
  if (!event) return { event: null, ideas: [] };
  return {
    event,
    ideas: cardsInOrder(board)
      .map((card) => ({ card, text: oneLine(card.text), made: madeFrom(event, all, board.id, card.id) }))
      .filter((one) => one.text),
  };
}

/**
 * What a closed poll chose, as activities of the event it is part of — « Quelle
 * activité ? » settled on karaoke: organise it. Only a poll marked as choosing
 * an activity (`forActivity`); never one that asks when.
 */
export function choiceActivities(poll, all) {
  const event = topEventOf(poll, all);
  if (!event || !poll.forActivity || poll.whenFor || isEventDoc(poll)) return { event: null, choices: [] };
  return {
    event,
    choices: winnersOf(poll).map((option) => ({ option, made: madeFrom(event, all, poll.id, option.id) })),
  };
}

/**
 * A poll asking when an activity takes place, whose choices are the days of
 * its event and nothing else. Settled, it gives the activity its day, not
 * itself (`whenFor`).
 */
export function whenPoll(activity, event, { question = '', language = 'fr' } = {}) {
  const days = eventDays(event);
  const poll = addOptions(
    createPoll({
      question: question || activity.title || activity.question || '',
      names: (activity.people || []).map((person) => person.name),
      shared: Boolean(activity.shared),
      groupId: activity.groupId || null,
    }),
    days.map((day) => choiceOfDay(day, language)).join('\n'),
  );
  return { ...poll, parent: activity.id, whenFor: activity.id, ...(activity.linkOnly ? { linkOnly: true } : {}) };
}

/** Mark a poll as choosing an activity, or not. */
export function markForActivity(poll, yes = true) {
  return touch(poll, { forActivity: Boolean(yes) });
}

/**
 * The activity a choice becomes: named after it, between those who wanted it
 * — or everyone coming, when nobody said so.
 */
export function activityFromChoice(event, poll, option) {
  const keen = (poll.people || []).filter((person) => voteOf(poll, person.id, option.id) === 'yes').map((person) => person.name);
  return activityFor(event, {
    name: oneLine(option.text), date: optionDay(option), names: keen.length ? keen : null, from: { doc: poll.id, part: option.id },
  });
}

/**
 * What closing a poll marked for an activity makes at once: its one clear
 * winner — one per day, when its choices are pinned to days —, unless the
 * event already has an activity from it. A tie makes nothing for that day —
 * the choices stay offered, for someone to pick.
 */
export function activitiesOnClose(poll, all) {
  const { event, choices } = choiceActivities(poll, all);
  if (!event) return [];
  const byDay = new Map();
  for (const choice of choices) {
    const day = optionDay(choice.option) || '';
    byDay.set(day, [...(byDay.get(day) || []), choice]);
  }
  return [...byDay.values()]
    .filter((group) => group.length === 1 && !group[0].made)
    .map(([choice]) => activityFromChoice(event, poll, choice.option));
}

/** The polls of an event still choosing an activity: open, marked. */
export function activityVotes(event, all) {
  return descendantsOf(event, all).filter(
    (one) => kindOf(one) === 'poll' && one.forActivity && !one.closedAt && !isEventDoc(one) && isLive(one),
  );
}
