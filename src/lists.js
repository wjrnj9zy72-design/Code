/**
 * Lists: a title, the people it concerns, and lines to hand out.
 *
 * Deliberately thin. A line is free text — "2 baguettes", "réserver le
 * camion", "rendre la perceuse à Paul" — because a title plus a sentence says
 * more than any set of fields would: actions, objects, or both in the same
 * list, and no form to fill in before writing the first line.
 *
 * What a line carries beyond its text is what a shared list actually needs:
 * who it is for, and whether it is done. Everything else — categories, due
 * dates, recurrence, effort — is left out until the use asks for it.
 *
 * Pure, like the game model: every mutator returns a new list.
 */

import { uid } from './model.js';

/** A new list. `names` are the people it is shared between; it can be nobody. */
export function createList({ name = '', names = [], shared = false } = {}) {
  const now = Date.now();
  return {
    id: uid('l'),
    // Says what this document is, for a database that holds games and lists
    // side by side, and for an import that has to tell them apart.
    kind: 'list',
    name: String(name).trim(),
    createdAt: now,
    updatedAt: now,
    shared: Boolean(shared),
    people: names
      .map((raw) => String(raw || '').trim())
      .filter(Boolean)
      .map((personName) => ({ id: uid('w'), name: personName })),
    items: [],
  };
}

/**
 * Every change moves the clock forward, even when two of them land in the same
 * millisecond: a stamp that never repeats is what lets a merge tell a line
 * someone changed from the same line nobody touched.
 */
const later = (previous) => Math.max(Date.now(), (previous || 0) + 1);

const touch = (list, items) => ({ ...list, items, updatedAt: later(list.updatedAt) });

/**
 * Add a line. Several lines at once when a whole list is pasted in — which is
 * how a list arrives from a message more often than it is typed.
 */
export function addItems(list, text) {
  const now = Date.now();
  const fresh = String(text || '')
    .split('\n')
    // A bullet, or a number *used as* a bullet — "1." or "2)". A bare number
    // is a quantity, and "2 baguettes" must stay two baguettes.
    .map((line) => line.replace(/^\s*(?:[-*•–—]+|\d+\s*[.)])\s+/, '').trim())
    .filter(Boolean)
    .map((line) => ({
      id: uid('i'),
      text: line,
      who: null,
      done: false,
      createdAt: now,
      updatedAt: now,
    }));
  return fresh.length ? touch(list, [...list.items, ...fresh]) : list;
}

function patchItem(list, itemId, patch) {
  let changed = false;
  const items = list.items.map((item) => {
    if (item.id !== itemId) return item;
    changed = true;
    return { ...item, ...patch, updatedAt: later(item.updatedAt) };
  });
  return changed ? touch(list, items) : list;
}

export function renameItem(list, itemId, text) {
  const clean = String(text || '').trim();
  return clean ? patchItem(list, itemId, { text: clean }) : list;
}

/** Hand a line to someone, or to nobody when `who` is null. */
export function assignItem(list, itemId, who) {
  const known = who === null || list.people.some((person) => person.id === who);
  return known ? patchItem(list, itemId, { who }) : list;
}

export function toggleItem(list, itemId) {
  const item = list.items.find((entry) => entry.id === itemId);
  return item ? patchItem(list, itemId, { done: !item.done }) : list;
}

export function removeItem(list, itemId) {
  const items = list.items.filter((item) => item.id !== itemId);
  return items.length === list.items.length ? list : touch(list, items);
}

/** Take the ticks off, keep the lines: the suitcase, the weekly shopping. */
export function reuseList(list) {
  const now = Date.now();
  return {
    ...createList({ name: list.name, shared: list.shared }),
    people: list.people,
    items: list.items.map((item) => ({ ...item, id: uid('i'), done: false, updatedAt: now })),
  };
}

export function addPerson(list, name) {
  const clean = String(name || '').trim();
  if (!clean) return list;
  return {
    ...list,
    people: [...list.people, { id: uid('w'), name: clean }],
    updatedAt: later(list.updatedAt),
  };
}

export function renamePerson(list, personId, name) {
  const clean = String(name || '').trim();
  if (!clean) return list;
  return {
    ...list,
    people: list.people.map((person) => (person.id === personId ? { ...person, name: clean } : person)),
    updatedAt: later(list.updatedAt),
  };
}

/** Drop someone. What was theirs goes back to nobody rather than disappearing. */
export function removePerson(list, personId) {
  return {
    ...list,
    people: list.people.filter((person) => person.id !== personId),
    items: list.items.map((item) => (item.who === personId ? { ...item, who: null } : item)),
    updatedAt: later(list.updatedAt),
  };
}

/**
 * Share out what nobody has taken, as evenly as the count allows, starting
 * with whoever is carrying the least. What is already assigned is left alone:
 * the button is there to break a deadlock, not to undo people's choices.
 */
export function shareOut(list) {
  if (!list.people.length) return list;
  const load = new Map(list.people.map((person) => [person.id, 0]));
  for (const item of list.items) {
    if (item.who && !item.done && load.has(item.who)) load.set(item.who, load.get(item.who) + 1);
  }

  const now = Date.now();
  const items = list.items.map((item) => {
    if (item.who || item.done) return item;
    let lightest = list.people[0].id;
    for (const person of list.people) {
      if (load.get(person.id) < load.get(lightest)) lightest = person.id;
    }
    load.set(lightest, load.get(lightest) + 1);
    return { ...item, who: lightest, updatedAt: now };
  });
  return touch(list, items);
}

/** How far along: { done, total, left } — and per person where asked. */
export function progress(list, personId = undefined) {
  const items = personId === undefined ? list.items : list.items.filter((item) => item.who === personId);
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, left: items.length - done };
}

/**
 * Merge two copies of the same list — this browser's and the database's.
 *
 * Line by line, keeping whichever version of a line changed last: two people
 * ticking different lines at the same moment both get their way, which is the
 * whole point of a shared shopping list. A line added on one side and never
 * seen on the other is kept, for the same reason a round is.
 *
 * A line someone changed always beats the same line nobody touched, whatever
 * the clock's resolution, because a change never leaves a stamp where it found
 * it. What stays undecidable is the same line changed on *both* sides at the
 * same moment: nothing in the two copies says which came first, so the newer
 * list's version is taken. Clocks on two phones do not agree closely enough
 * for more machinery than this to be worth it.
 */
export function mergeLists(a, b) {
  if (!isValidList(a)) return b;
  if (!isValidList(b)) return a;
  if (a.id !== b.id) return a;

  const [newer, older] = (a.updatedAt || 0) >= (b.updatedAt || 0) ? [a, b] : [b, a];
  const byId = new Map();
  for (const item of [...older.items, ...newer.items]) {
    const held = byId.get(item.id);
    if (!held || (item.updatedAt || 0) >= (held.updatedAt || 0)) byId.set(item.id, item);
  }

  // The newer copy's order first, then the lines only the older one knew.
  const ordered = [
    ...newer.items.map((item) => byId.get(item.id)),
    ...older.items.filter((item) => !newer.items.some((other) => other.id === item.id)),
  ];

  const sameLength = ordered.length === newer.items.length;
  const sameItems = sameLength && ordered.every((item, index) => item === newer.items[index]);
  if (sameItems) return newer;

  return {
    ...newer,
    // Someone added elsewhere may be the owner of a line coming in.
    people: newer.people.length >= older.people.length ? newer.people : older.people,
    items: ordered,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

/** Defensive read of anything coming back from storage, a link, or a file. */
export function isValidList(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.kind === 'list' &&
      typeof value.id === 'string' &&
      Array.isArray(value.people) &&
      Array.isArray(value.items) &&
      value.items.every((item) => item && typeof item.id === 'string' && typeof item.text === 'string'),
  );
}

/** The names already used, most recent first, to offer when starting a list. */
export function recentPeople(lists, limit = 12) {
  const seen = [];
  for (const list of [...lists].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    for (const person of list.people) {
      if (!seen.includes(person.name)) seen.push(person.name);
      if (seen.length >= limit) return seen;
    }
  }
  return seen;
}
