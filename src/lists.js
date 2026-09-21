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
import { later, touch, prune } from './stamp.js';
import { addPerson, renamePerson, removePerson } from './people.js';

/** A new list. `names` are the people it is shared between; it can be nobody. */
export function createList({ name = '', names = [], shared = false, groupId = null } = {}) {
  const now = Date.now();
  return {
    id: uid('l'),
    // Says what this document is, for a database that holds games and lists
    // side by side, and for an import that has to tell them apart.
    kind: 'list',
    name: String(name).trim(),
    createdAt: now,
    updatedAt: now,
    // People change rarely and separately from the lines, so they carry their
    // own clock: a merge can then tell "someone was just removed" from "this
    // copy simply has not heard of them yet".
    peopleAt: now,
    shared: Boolean(shared),
    groupId: groupId || null,
    // Put away once it has served, or kept as the model the next one is cut
    // from. Both are document-wide, so a merge takes them from the newer copy,
    // exactly as it does the name.
    archivedAt: null,
    template: false,
    // The lines deleted here, and when — without this a deletion is undone by
    // the next copy that still holds the line.
    removed: {},
    people: names
      .map((raw) => String(raw || '').trim())
      .filter(Boolean)
      .map((personName) => ({ id: uid('w'), name: personName })),
    items: [],
  };
}


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
      // A day, never an instant: "réserver le camion" is due on Tuesday, not
      // at 14:32 — and a bare day needs no time zone to mean the same thing
      // on two phones.
      due: null,
      createdAt: now,
      updatedAt: now,
    }));
  return fresh.length ? touch(list, { items: [...list.items, ...fresh] }) : list;
}

function patchItem(list, itemId, patch) {
  let changed = false;
  const items = list.items.map((item) => {
    if (item.id !== itemId) return item;
    changed = true;
    return { ...item, ...patch, updatedAt: later(item.updatedAt) };
  });
  return changed ? touch(list, { items }) : list;
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

/**
 * Put a day on a line, or take it off with null. Kept as `AAAA-MM-JJ`: a day
 * written that way sorts as text, travels through JSON unharmed, and says the
 * same thing in every time zone.
 */
export function setItemDue(list, itemId, due) {
  const clean = /^\d{4}-\d{2}-\d{2}$/.test(String(due || '')) ? String(due) : null;
  return patchItem(list, itemId, { due: clean });
}

export function toggleItem(list, itemId) {
  const item = list.items.find((entry) => entry.id === itemId);
  return item ? patchItem(list, itemId, { done: !item.done }) : list;
}

/**
 * Drop a line, and remember having dropped it. Without that trace the other
 * phone, which still holds the line, hands it straight back at the next sync —
 * and "clear what is done" undoes itself while you watch.
 */
export function removeItem(list, itemId) {
  const items = list.items.filter((item) => item.id !== itemId);
  if (items.length === list.items.length) return list;
  return touch(list, { items, removed: { ...list.removed, [itemId]: Date.now() } });
}


/**
 * Put a finished list away, or bring it back.
 *
 * Nothing is deleted: a year of shopping lists is a year of evidence about
 * what the house actually eats. They only stop crowding the tab.
 */
export function archiveList(list, yes = true) {
  const at = yes ? Date.now() : null;
  return at === (list.archivedAt || null) ? list : touch(list, { archivedAt: at });
}

/**
 * Keep this list as a model: the weekly shopping, the suitcase. A model is not
 * a list in progress — it is what the next one is cut from — so it is counted
 * nowhere and waits in its own place.
 */
export function makeTemplate(list, yes = true) {
  return Boolean(list.template) === Boolean(yes) ? list : touch(list, { template: Boolean(yes) });
}

/** Take the ticks off, keep the lines: the suitcase, the weekly shopping. */
export function reuseList(list, name = list.name) {
  const now = Date.now();
  return {
    ...createList({ name, shared: list.shared, groupId: list.groupId }),
    people: list.people,
    peopleAt: list.peopleAt || now,
    // Neither archived nor a model: what comes out of one is an ordinary list.
    // The days go, though — they were the days of the last time, and a list
    // that arrives already late is worse than one with no days at all.
    items: list.items.map((item) => ({ ...item, id: uid('i'), done: false, due: null, updatedAt: now })),
  };
}

/**
 * The people this list concerns. Named for the list so that a bundle holding
 * every document type in one scope has no two functions fighting over a name.
 */
export const addListPerson = addPerson;
export const renameListPerson = renamePerson;

/** Remove someone: what was theirs goes back to nobody, rather than vanishing. */
export function removeListPerson(list, personId) {
  return removePerson(list, personId, (current) => ({
    items: current.items.map((item) => (item.who === personId ? { ...item, who: null } : item)),
  }));
}

/**
 * Share out what nobody has taken, as evenly as the count allows, starting
 * with whoever is carrying the least. What is already assigned is left alone:
 * the button is there to break a deadlock, not to undo people's choices.
 */
export function shareOut(list) {
  if (!list.people.length) return list;
  if (!list.items.some((item) => !item.who && !item.done)) return list;
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
  return touch(list, { items });
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

  // A line deleted anywhere stays deleted, whichever copy still holds it.
  const removed = prune({ ...older.removed, ...newer.removed });

  const byId = new Map();
  for (const item of [...older.items, ...newer.items]) {
    if (removed[item.id]) continue;
    const held = byId.get(item.id);
    if (!held || (item.updatedAt || 0) >= (held.updatedAt || 0)) byId.set(item.id, item);
  }

  // The newer copy's order first, then the lines only the older one knew.
  const ordered = [
    ...newer.items.filter((item) => byId.has(item.id)).map((item) => byId.get(item.id)),
    ...older.items.filter(
      (item) => byId.has(item.id) && !newer.items.some((other) => other.id === item.id),
    ),
  ];

  // Whoever touched the people last is right about them — including about
  // someone they removed, which a union of the two sides could never see.
  const people = (newer.peopleAt || 0) >= (older.peopleAt || 0) ? newer.people : older.people;
  const peopleAt = Math.max(newer.peopleAt || 0, older.peopleAt || 0);

  const sameItems =
    ordered.length === newer.items.length &&
    ordered.every((item, index) => item === newer.items[index]);
  const samePeople = people === newer.people && Object.keys(removed).length === Object.keys(newer.removed || {}).length;
  if (sameItems && samePeople) return newer;

  return {
    ...newer,
    people,
    peopleAt,
    removed,
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

