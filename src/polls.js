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
 * Keep the day the question settled on — and the hour, when there is one,
 * and the last day, when it runs over several (a weekend, a holiday).
 *
 * A day alone, like a line's, needs no time zone; an hour is written as the
 * reader's own clock. Any of them can be dropped by passing nothing; a last
 * day that is not after the first means a single day.
 */
export function setPollDate(poll, date, at = null, until = null) {
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const day = isDay(date) ? String(date) : null;
  const hour = day && /^\d{2}:\d{2}$/.test(String(at || '')) ? String(at) : null;
  const last = day && isDay(until) && String(until) > day ? String(until) : null;
  if (day === (poll.date || null) && hour === (poll.at || null) && last === (poll.until || null)) return poll;
  return touch(poll, { date: day, at: hour, until: last });
}

/** The last day an event takes up: its own, or the one it runs until. */
export function lastDay(poll) {
  return poll?.until || poll?.date || null;
}

/**
 * An event whose day is already known: nothing to vote on, so it is made as a
 * poll that has already settled — its day kept, its answers closed, and no
 * choices. Everything a settled poll already does (the group, the link, the
 * group's calendar, the organiser) then works for it unchanged; `fixed` is
 * only there so the screens can leave out the voting.
 */
export function createEvent({ name = '', names = [], date = null, at = null, until = null } = {}) {
  const made = createPoll({ question: name, names });
  const dated = setPollDate(made, date, at, until);
  return { ...dated, fixed: true, title: made.question || null, closedAt: dated.createdAt };
}

/** A poll made as an event, with no vote to hold. */
export function isEvent(poll) {
  return Boolean(poll?.fixed);
}

/**
 * Whether a question is looking for a day — "which evening for the raclette?"
 * — rather than for anything else — "which present for Léa?". Such a poll
 * belongs in the agenda while it is being decided, next to the days already
 * settled, so it is guessed from what people naturally write: a question
 * asking when, or choices that read as days (a weekday, a month, 12/10).
 */
const WHEN_ASKED = /\b(quand|quel(le)?s? (jour|soir|date|week-?end|midi|matin|après-midi|semaine)|when|which (day|evening|night|date|weekend)|what (day|date|evening))\b/i;
const READS_AS_DAY = new RegExp([
  '\\b(lun|mar|mer|jeu|ven|sam|dim)(\\.|di|redi|credi|udi|dredi|edi|anche)?\\b',
  '\\b(mon|tue|wed|thu|fri|sat|sun)(day|s|\\.)?\\b',
  '\\b(janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|jan|feb|apr|jun|jul|aug|sep)[a-zéû]*\\b',
  '\\b\\d{1,2}[/.]\\d{1,2}\\b',
  '\\b\\d{4}-\\d{2}-\\d{2}\\b',
  '\\b(demain|ce soir|tomorrow|tonight|week-?end)\\b',
].join('|'), 'i');

export function seeksDay(poll) {
  if (!poll || isEvent(poll)) return false;
  if (WHEN_ASKED.test(poll.question || '')) return true;
  const options = (poll.options || []).map((option) => option.text || '');
  if (!options.length) return false;
  return options.filter((text) => READS_AS_DAY.test(text)).length * 2 >= options.length;
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

/* ------------------------------------------------ the day a choice names --- */

const CHOICE_MONTHS = [
  ['janv', 'jan'], ['févr', 'fevr', 'fév', 'fev', 'feb'], ['mars', 'march'], ['avr', 'apr'], ['mai', 'may'],
  ['juin', 'june', 'jun'], ['juil', 'july', 'jul'], ['août', 'aout', 'aug'], ['sept', 'sep'], ['oct'], ['nov'], ['déc', 'dec'],
];
// Weekdays are whole words (« mar. », « mardi », "Tue"), so that « mars »
// stays a month.
const CHOICE_WEEKDAYS = [
  ['dim', 'dimanche', 'sun', 'sunday'], ['lun', 'lundi', 'mon', 'monday'], ['mar', 'mardi', 'tue', 'tues', 'tuesday'],
  ['mer', 'mercredi', 'wed', 'wednesday'], ['jeu', 'jeudi', 'thu', 'thur', 'thurs', 'thursday'],
  ['ven', 'vendredi', 'fri', 'friday'], ['sam', 'samedi', 'sat', 'saturday'],
];

const monthOfWord = (word) => CHOICE_MONTHS.findIndex((names) => names.some((name) => word.startsWith(name)));
const weekdayOfWord = (word) => CHOICE_WEEKDAYS.findIndex((names) => names.includes(word));
const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const realDay = (year, month, day) => {
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date : null;
};

/**
 * The day a choice names, if it names one: « Vendredi 12 », « sam. 13 oct. »,
 * « 13/10 », « 2026-10-13 », "Saturday, October 13", with an hour when one is
 * written (« 20h », « 20:30 »). Returns { date, at } or null.
 *
 * The year is rarely written: the day is the first one that fits on or after
 * `from` — the day the poll was asked, not the day it is read, so a poll
 * settled a month later still means the evening everyone voted for. A weekday
 * with a number and no month (« Vendredi 12 ») is the next month in which the
 * 12th is a Friday, within three months. A bare number means nothing: « 2 pizzas » is not a day.
 */
export function dayOfChoice(text, from = new Date()) {
  const source = String(text || '').toLowerCase();
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const fits = (date) => date && date >= start;

  let at = null;
  const hour = source.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
  if (hour && Number(hour[1]) < 24 && Number(hour[2] || 0) < 60) {
    at = `${hour[1].padStart(2, '0')}:${hour[2] || '00'}`;
  }
  const rest = hour ? source.replace(hour[0], ' ') : source;

  const iso = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = realDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return date ? { date: isoDay(date), at } : null;
  }

  // A year written in full is taken as it is; otherwise this year, or the next.
  const pick = (month, day, year) => {
    if (year) {
      const date = realDay(year, month, day);
      return date ? { date: isoDay(date), at } : null;
    }
    for (const candidate of [start.getFullYear(), start.getFullYear() + 1]) {
      const date = realDay(candidate, month, day);
      if (fits(date)) return { date: isoDay(date), at };
    }
    return null;
  };

  const slashed = rest.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?\b/);
  if (slashed) {
    let [day, month] = [Number(slashed[1]), Number(slashed[2])];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const year = slashed[3] ? Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3]) : null;
    return pick(month - 1, day, year);
  }

  const words = rest.split(/[^\p{L}\d]+/u).filter(Boolean);
  const year = Number(words.find((word) => /^\d{4}$/.test(word))) || null;
  const weekday = words.map(weekdayOfWord).find((index) => index >= 0) ?? -1;
  for (let i = 0; i < words.length; i += 1) {
    // « 1er novembre », "October 1st".
    const number = words[i].match(/^(\d{1,2})(?:er|st|nd|rd|th)?$/);
    if (!number) continue;
    const day = Number(number[1]);
    if (day < 1 || day > 31) continue;
    // « 13 octobre » in French, "October 13" in English. A word that is also
    // a weekday (« mar. 12 ») is a weekday, not March.
    const after = words[i + 1] ? monthOfWord(words[i + 1]) : -1;
    const beforeWord = words[i - 1] || '';
    const before = beforeWord && weekdayOfWord(beforeWord) < 0 ? monthOfWord(beforeWord) : -1;
    const month = after >= 0 ? after : before;
    if (month >= 0) return pick(month, day, year);
    if (weekday >= 0) {
      // Near enough to be meant: three months ahead at most.
      for (let ahead = 0; ahead < 4; ahead += 1) {
        const first = new Date(start.getFullYear(), start.getMonth() + ahead, 1);
        const date = realDay(first.getFullYear(), first.getMonth(), day);
        if (fits(date) && date.getDay() === weekday) return { date: isoDay(date), at };
      }
      return null;
    }
  }
  return null;
}

/**
 * The line a picked day becomes among the choices: « Samedi 13 octobre » —
 * with the year only when it is not this one — so that anyone reads it, and
 * dayOfChoice() reads it back.
 */
export function choiceOfDay(day, language = 'fr', now = new Date()) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return '';
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  if (year !== now.getFullYear()) options.year = 'numeric';
  const text = new Date(year, month - 1, date).toLocaleDateString(language, options);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
