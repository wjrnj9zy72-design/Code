/**
 * Polls: a question, the choices it offers, and who is up for what.
 *
 * The shape everyone actually needs is the "which evening suits you?" one, so
 * a vote is not a single pick but a value per person and per choice — yes,
 * maybe, no. Picking one option out of several is that same grid with a single
 * yes in it, so there is no second kind of poll to build, and no setting to
 * choose before asking the question.
 *
 * Like games and lists: pure, merged cell by cell, and it travels as one
 * document through the same database.
 */

import { uid } from './model.js';
import { later, touch, prune } from './stamp.js';
import { addPerson, renamePerson, removePerson } from './people.js';

export const VALUES = ['yes', 'maybe', 'no'];

/** The key a single answer is stored under: one person, one choice. */
const answerKey = (personId, optionId) => `${personId}|${optionId}`;

export function createPoll({ question = '', names = [], shared = false, groupId = null } = {}) {
  const now = Date.now();
  return {
    id: uid('v'),
    kind: 'poll',
    question: String(question).trim(),
    createdAt: now,
    updatedAt: now,
    peopleAt: now,
    closedAt: null,
    archivedAt: null,
    // What the question settled on, once it has: a day, and an hour when one
    // was agreed. Kept on the poll rather than in a document of its own —
    // "quel soir ?" and "jeudi 20 h" are one thing, asked and answered.
    date: null,
    at: null,
    // What the event will be called in a calendar. Empty until someone writes
    // one: eventName() proposes one from the question until they do.
    title: null,
    shared: Boolean(shared),
    groupId: groupId || null,
    removed: {},
    people: names
      .map((raw) => String(raw || '').trim())
      .filter(Boolean)
      .map((name) => ({ id: uid('w'), name })),
    options: [],
    // { "personId|optionId": { v: 'yes' | 'maybe' | 'no', at } }
    votes: {},
  };
}

/**
 * Keep the day the question settled on — and the hour, when there is one.
 *
 * A day alone, like a line's, needs no time zone; an hour is written as the
 * reader's own clock. Either can be dropped by passing nothing.
 */
export function setPollDate(poll, date, at = null) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : null;
  const hour = day && /^\d{2}:\d{2}$/.test(String(at || '')) ? String(at) : null;
  if (day === (poll.date || null) && hour === (poll.at || null)) return poll;
  return touch(poll, { date: day, at: hour });
}

/**
 * Name the event this poll became.
 *
 * Emptying the field does not leave a blank line in anyone's calendar: with no
 * name of its own the event falls back on the one eventName() proposes from
 * the question.
 */
export function setEventName(poll, name) {
  const kept = String(name || '').trim() || null;
  return kept === (poll.title || null) ? poll : touch(poll, { title: kept });
}

/**
 * Put a settled question away, or bring it back. Closing freezes the answers;
 * archiving only clears the tab — the two are not the same gesture, and a poll
 * can be closed for weeks before anyone wants it out of the way.
 */
export function archivePoll(poll, yes = true) {
  const at = yes ? Date.now() : null;
  return at === (poll.archivedAt || null) ? poll : touch(poll, { archivedAt: at });
}

/** Add choices, one per line — a poll is usually pasted, not typed. */
export function addOptions(poll, text) {
  const now = Date.now();
  const fresh = String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•–—]+|\d+\s*[.)])\s+/, '').trim())
    .filter(Boolean)
    .map((line) => ({ id: uid('o'), text: line, createdAt: now, updatedAt: now }));
  return fresh.length ? touch(poll, { options: [...poll.options, ...fresh] }) : poll;
}

export function renameOption(poll, optionId, text) {
  const clean = String(text || '').trim();
  if (!clean) return poll;
  let changed = false;
  const options = poll.options.map((option) => {
    if (option.id !== optionId) return option;
    changed = true;
    return { ...option, text: clean, updatedAt: later(option.updatedAt) };
  });
  return changed ? touch(poll, { options }) : poll;
}

/** Drop a choice, and the answers that went with it. */
export function removeOption(poll, optionId) {
  const options = poll.options.filter((option) => option.id !== optionId);
  if (options.length === poll.options.length) return poll;

  const votes = {};
  for (const [key, vote] of Object.entries(poll.votes)) {
    if (!key.endsWith(`|${optionId}`)) votes[key] = vote;
  }
  return touch(poll, { options, votes, removed: { ...poll.removed, [optionId]: Date.now() } });
}

/**
 * Answer for someone, on one choice. `value` is one of yes / maybe / no, or
 * null to take the answer back — an answered "no" and no answer at all are
 * not the same thing to whoever reads the result.
 */
export function setVote(poll, personId, optionId, value) {
  if (poll.closedAt) return poll;
  if (!poll.people.some((person) => person.id === personId)) return poll;
  if (!poll.options.some((option) => option.id === optionId)) return poll;
  if (value !== null && !VALUES.includes(value)) return poll;

  const key = answerKey(personId, optionId);
  const held = poll.votes[key];
  if (!held && value === null) return poll;
  if (held?.v === value) return poll;

  const votes = { ...poll.votes };
  if (value === null) votes[key] = { v: null, at: later(held?.at) };
  else votes[key] = { v: value, at: later(held?.at) };
  return touch(poll, { votes });
}

/** What someone answered on one choice: 'yes' | 'maybe' | 'no' | null. */
export function voteOf(poll, personId, optionId) {
  return poll.votes[answerKey(personId, optionId)]?.v ?? null;
}

/** The next answer when the same cell is tapped again. */
export function nextValue(value) {
  // Available, or not said: a tap ticks, a second tap unticks. "Maybe" and
  // "no" asked people to grade their evenings when all anyone wanted to know
  // was which ones they can make. They are still read — polls answered before
  // keep their answers — but a tap on one of them simply makes it a yes.
  return value === 'yes' ? null : 'yes';
}

/** The people being asked — named for the poll, so no two modules clash. */
export const addPollPerson = addPerson;
export const renamePollPerson = renamePerson;

/** Remove someone, and everything they answered. */
export function removePollPerson(poll, personId) {
  return removePerson(poll, personId, (current) => {
    const votes = {};
    for (const [key, vote] of Object.entries(current.votes)) {
      if (!key.startsWith(`${personId}|`)) votes[key] = vote;
    }
    return { votes };
  });
}

export function setClosed(poll, closed) {
  const closedAt = closed ? Date.now() : null;
  return poll.closedAt === closedAt ? poll : touch(poll, { closedAt });
}

/**
 * The count, choice by choice.
 *
 * `rows` keeps the poll's own order — the order the choices were written in.
 * That matters more than it sounds: the grid is drawn from it, and a grid that
 * re-sorts itself as people vote moves the row out from under the finger that
 * just tapped it. Answering three questions in a row then means chasing them
 * around the screen.
 *
 * `ranked` is the same rows, best first, for whoever wants to know what is
 * winning — by how many people can make it, and nothing else. A "maybe" or a
 * "no" left over from before is not a yes, and is not counted as one: the
 * grid shows neither any more, and the count must never disagree with what
 * is on screen.
 */
export function tally(poll) {
  const rows = poll.options.map((option) => {
    const counts = { yes: 0, maybe: 0, no: 0, missing: 0 };
    for (const person of poll.people) {
      const value = voteOf(poll, person.id, option.id);
      if (value) counts[value] += 1;
      else counts.missing += 1;
    }
    return { option, ...counts, score: counts.yes };
  });

  // Level on the count, the order the choices were written in decides: a
  // stable sort keeps it, so the gauge does not shuffle equal evenings.
  const ranked = [...rows].sort((a, b) => b.yes - a.yes);
  const best = ranked[0];
  return {
    rows,
    ranked,
    // Nobody leads a poll nobody is available for.
    leaders: best && best.yes > 0 ? rows.filter((row) => row.yes === best.yes).map((row) => row.option.id) : [],
    answered: poll.people.filter((person) =>
      poll.options.some((option) => voteOf(poll, person.id, option.id)),
    ).length,
  };
}

/**
 * Who is coming, once the question has settled: the people available on the
 * one choice that leads. With no clear winner — a tie, or nobody available —
 * the grid does not say who comes, so everyone the poll names does, and the
 * list of people stays one tap away from being trimmed.
 */
export function goers(poll) {
  const { leaders } = tally(poll);
  if (leaders.length !== 1) return poll.people.map((person) => person.name);
  return poll.people
    .filter((person) => voteOf(poll, person.id, leaders[0]) === 'yes')
    .map((person) => person.name);
}

/**
 * Merge two copies of the same poll: choices by id with their tombstones,
 * answers cell by cell keeping whichever was given last, and the people from
 * whichever copy touched them last.
 */
export function mergePolls(a, b) {
  if (!isValidPoll(a)) return b;
  if (!isValidPoll(b)) return a;
  if (a.id !== b.id) return a;

  const [newer, older] = (a.updatedAt || 0) >= (b.updatedAt || 0) ? [a, b] : [b, a];
  const removed = prune({ ...older.removed, ...newer.removed });

  const byId = new Map();
  for (const option of [...older.options, ...newer.options]) {
    if (removed[option.id]) continue;
    const held = byId.get(option.id);
    if (!held || (option.updatedAt || 0) >= (held.updatedAt || 0)) byId.set(option.id, option);
  }
  const options = [
    ...newer.options.filter((option) => byId.has(option.id)).map((option) => byId.get(option.id)),
    ...older.options.filter(
      (option) => byId.has(option.id) && !newer.options.some((other) => other.id === option.id),
    ),
  ];

  const votes = { ...older.votes };
  for (const [key, vote] of Object.entries(newer.votes)) {
    const held = votes[key];
    if (!held || (vote.at || 0) >= (held.at || 0)) votes[key] = vote;
  }
  // An answer to a choice nobody offers any more is not an answer.
  const live = new Set(options.map((option) => option.id));
  for (const key of Object.keys(votes)) {
    if (!live.has(key.split('|')[1])) delete votes[key];
  }

  const people = (newer.peopleAt || 0) >= (older.peopleAt || 0) ? newer.people : older.people;

  // Nothing to learn: hand back the very same object, so a caller can tell an
  // answer arrived from a poll that simply came back unchanged — five seconds
  // at a time, all evening.
  const sameOptions =
    options.length === newer.options.length &&
    options.every((option, index) => option === newer.options[index]);
  const sameVotes =
    Object.keys(votes).length === Object.keys(newer.votes).length &&
    Object.entries(votes).every(([key, vote]) => newer.votes[key] === vote);
  const sameRemoved = Object.keys(removed).length === Object.keys(newer.removed || {}).length;
  if (sameOptions && sameVotes && sameRemoved && people === newer.people) return newer;

  return {
    ...newer,
    people,
    peopleAt: Math.max(newer.peopleAt || 0, older.peopleAt || 0),
    closedAt: newer.closedAt,
    removed,
    options,
    votes,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

export function isValidPoll(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.kind === 'poll' &&
      typeof value.id === 'string' &&
      Array.isArray(value.people) &&
      Array.isArray(value.options) &&
      value.options.every((option) => option && typeof option.id === 'string' && typeof option.text === 'string') &&
      value.votes &&
      typeof value.votes === 'object',
  );
}
