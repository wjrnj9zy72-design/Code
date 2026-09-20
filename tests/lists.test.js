import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createList, addItems, renameItem, assignItem, toggleItem, removeItem, reuseList,
  addListPerson as addPerson, renameListPerson as renamePerson, removeListPerson as removePerson,
  shareOut, progress, mergeLists, isValidList,
} from '../src/lists.js';
import { recentPeople } from '../src/people.js';

const sample = () => addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'] }), 'Pain\nLait\nŒufs');

test('a list is a title, people, and lines', () => {
  const list = createList({ name: '  Courses  ', names: ['Gui', ' ', 'Alice'] });
  assert.equal(list.name, 'Courses');
  assert.equal(list.kind, 'list', 'so a database holding games and lists can tell them apart');
  assert.deepEqual(list.people.map((p) => p.name), ['Gui', 'Alice'], 'a blank name is not a person');
  assert.deepEqual(list.items, []);
  assert.ok(list.id.startsWith('l_'));
  assert.equal(list.shared, false, 'nothing leaves the device unasked');
});

test('a whole list can be pasted in at once, however it was written', () => {
  const list = addItems(createList(), '- Pain\n* Lait\n1. Œufs\n\n  \n• Beurre\n2) Bouteilles');
  assert.deepEqual(list.items.map((i) => i.text), ['Pain', 'Lait', 'Œufs', 'Beurre', 'Bouteilles'],
    'bullets and numbering are stripped, blank lines dropped');
  assert.ok(list.items.every((i) => i.who === null && i.done === false));
  assert.equal(addItems(list, '   ').items.length, 5, 'nothing to add is not a change');
});

test('a quantity at the head of a line is not mistaken for a bullet', () => {
  const list = addItems(createList(), '2 baguettes\n12 œufs\n1 kg de farine\n3-4 tomates');
  assert.deepEqual(list.items.map((i) => i.text),
    ['2 baguettes', '12 œufs', '1 kg de farine', '3-4 tomates'],
    'what a shopping list is actually made of');
});

test('a line is handed out, ticked, renamed, or dropped', () => {
  let list = sample();
  const [pain] = list.items;
  const alice = list.people[1].id;

  list = assignItem(list, pain.id, alice);
  assert.equal(list.items[0].who, alice);
  list = assignItem(list, pain.id, 'someone-who-is-not-here');
  assert.equal(list.items[0].who, alice, 'a stranger cannot be given a line');
  list = assignItem(list, pain.id, null);
  assert.equal(list.items[0].who, null, 'and it can go back to nobody');

  list = toggleItem(list, pain.id);
  assert.equal(list.items[0].done, true);
  list = toggleItem(list, pain.id);
  assert.equal(list.items[0].done, false);

  list = renameItem(list, pain.id, '  2 baguettes ');
  assert.equal(list.items[0].text, '2 baguettes');
  assert.equal(renameItem(list, pain.id, '   ').items[0].text, '2 baguettes', 'a blank rename is refused');

  list = removeItem(list, pain.id);
  assert.equal(list.items.length, 2);
  assert.equal(removeItem(list, 'nope'), list, 'removing nothing changes nothing');
});

test('every change moves the list and the line it touched, and only that one', async () => {
  const list = sample();
  const before = list.items[1].updatedAt;
  await new Promise((done) => setTimeout(done, 2));

  const after = toggleItem(list, list.items[0].id);
  assert.ok(after.updatedAt > list.updatedAt, 'the list is newer');
  assert.ok(after.items[0].updatedAt > before, 'so is the line');
  assert.equal(after.items[1].updatedAt, before, 'the others are untouched');
  assert.notEqual(after, list, 'and nothing was mutated in place');
});

test('people come and go without taking the lines with them', () => {
  let list = sample();
  const gui = list.people[0].id;
  list = assignItem(list, list.items[0].id, gui);

  list = addPerson(list, '  Bob ');
  assert.deepEqual(list.people.map((p) => p.name), ['Gui', 'Alice', 'Bob']);
  assert.equal(addPerson(list, '  ').people.length, 3, 'a blank name is not a person');

  list = renamePerson(list, gui, 'Guillaume');
  assert.equal(list.people[0].name, 'Guillaume');
  assert.equal(list.items[0].who, gui, 'renaming does not re-hand the line');

  list = removePerson(list, gui);
  assert.equal(list.people.length, 2);
  assert.equal(list.items[0].who, null, 'what was theirs goes back to nobody');
  assert.equal(list.items.length, 3, 'and stays in the list');
});

test('sharing out only touches what nobody has taken', () => {
  let list = addItems(createList({ names: ['Gui', 'Alice'] }), 'a\nb\nc\nd\ne');
  const [gui, alice] = list.people.map((p) => p.id);
  list = assignItem(list, list.items[0].id, gui);
  list = assignItem(list, list.items[1].id, gui);

  const out = shareOut(list);
  assert.equal(out.items[0].who, gui, 'a line already taken is left alone');
  assert.equal(out.items[1].who, gui);
  assert.ok(out.items.every((item) => item.who), 'and nothing is left over');

  const counts = out.people.map((person) => out.items.filter((item) => item.who === person.id).length);
  assert.deepEqual(counts.sort(), [2, 3], 'the one carrying the least is served first');
  assert.equal(counts.reduce((a, b) => a + b), 5);

  assert.equal(shareOut(createList()).items.length, 0, 'nobody to share with is not a crash');
});

test('what is done is not shared out again', () => {
  let list = addItems(createList({ names: ['Gui'] }), 'a\nb');
  list = toggleItem(list, list.items[0].id);
  const out = shareOut(list);
  assert.equal(out.items[0].who, null, 'a line already done needs nobody');
  assert.equal(out.items[1].who, list.people[0].id);
});

test('progress counts the whole list, or one person', () => {
  let list = sample();
  const gui = list.people[0].id;
  list = assignItem(list, list.items[0].id, gui);
  list = assignItem(list, list.items[1].id, gui);
  list = toggleItem(list, list.items[0].id);

  assert.deepEqual(progress(list), { done: 1, total: 3, left: 2 });
  assert.deepEqual(progress(list, gui), { done: 1, total: 2, left: 1 });
  assert.deepEqual(progress(list, null), { done: 0, total: 1, left: 1 }, 'what nobody has taken');
});

test('a list is taken up again with its lines and nobody done', () => {
  let list = sample();
  list = toggleItem(list, list.items[0].id);
  const again = reuseList(list);

  assert.equal(again.name, 'Courses');
  assert.deepEqual(again.items.map((i) => i.text), ['Pain', 'Lait', 'Œufs']);
  assert.ok(again.items.every((item) => !item.done), 'a fresh start');
  assert.notEqual(again.id, list.id, 'and a list of its own');
  assert.deepEqual(again.people, list.people);
  assert.ok(again.items.every((item, index) => item.id !== list.items[index].id),
    'with new line ids, so the old list is never touched by the new one');
});

test('two people ticking different lines at once both get their way', () => {
  const start = addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'] }), 'Pain\nLait\nŒufs');
  // No pause between them: two phones in the same second is the normal case,
  // and a tick must not be lost to a clock that cannot tell them apart.
  const here = toggleItem(start, start.items[0].id);
  const there = toggleItem(addItems(start, 'Beurre'), start.items[1].id);

  const merged = mergeLists(here, there);
  assert.equal(merged.items.length, 4, 'the line added elsewhere is kept');
  assert.equal(merged.items.find((i) => i.text === 'Pain').done, true, 'ticked here');
  assert.equal(merged.items.find((i) => i.text === 'Lait').done, true, 'ticked there');
  assert.equal(merged.items.find((i) => i.text === 'Œufs').done, false);
});

test('the same line changed on both sides keeps the last change', async () => {
  const start = addItems(createList({ names: ['Gui'] }), 'Pain');
  const id = start.items[0].id;
  const here = renameItem(start, id, 'Pain de campagne');
  await new Promise((done) => setTimeout(done, 3));
  const there = renameItem(start, id, 'Baguette');

  assert.equal(mergeLists(here, there).items[0].text, 'Baguette');
  assert.equal(mergeLists(there, here).items[0].text, 'Baguette', 'whichever way round they are given');
});

test('merging leaves the copy alone when it has nothing to learn', () => {
  const list = sample();
  assert.equal(mergeLists(list, list), list);
  assert.equal(mergeLists(list, null), list, 'and rubbish is not merged in');
  assert.equal(mergeLists(null, list), list);
  assert.equal(mergeLists(list, { ...sample(), id: 'l_autre' }), list, 'nor another list');
});

test('what comes back from storage is looked at before it is trusted', () => {
  assert.ok(isValidList(sample()));
  assert.ok(!isValidList(null));
  assert.ok(!isValidList({ id: 'l_1', people: [], items: [] }), 'no kind: could be anything');
  assert.ok(!isValidList({ kind: 'list', id: 'l_1', people: [], items: [{ id: 'i' }] }), 'a line with no text');
  assert.ok(!isValidList({ kind: 'list', id: 'l_1', people: {}, items: [] }));
  assert.ok(!isValidList({ kind: 'set', ids: [] }), 'a shared lot is not a list');
});

test('the names already used are offered again, most recent first', () => {
  const old = { ...createList({ name: 'Vieille', names: ['Bob'] }), updatedAt: 1 };
  const fresh = { ...createList({ name: 'Récente', names: ['Gui', 'Alice'] }), updatedAt: 2 };
  assert.deepEqual(recentPeople([old, fresh]), ['Gui', 'Alice', 'Bob']);
  assert.equal(recentPeople([old, fresh], 1).length, 1);
});

test('a change beats no change on the same line, however fast the clock', () => {
  // Everything below happens inside one millisecond, on purpose: it is the
  // case two phones on the same evening actually produce.
  const start = addItems(createList({ names: ['Gui'] }), 'Pain');
  const id = start.items[0].id;
  const ticked = toggleItem(start, id);

  assert.ok(ticked.items[0].updatedAt > start.items[0].updatedAt, 'the line moved');
  assert.ok(ticked.updatedAt > start.updatedAt, 'and so did the list');
  assert.equal(mergeLists(ticked, start).items[0].done, true);
  assert.equal(mergeLists(start, ticked).items[0].done, true, 'whichever way round');
});

test('a line deleted here does not come back from the other phone', () => {
  const start = addItems(createList({ names: ['Gui'] }), 'Pain\nLait');
  const id = start.items[0].id;

  const here = removeItem(start, id);
  const there = toggleItem(start, start.items[1].id); // the other side never saw the deletion

  assert.equal(mergeLists(here, there).items.length, 1, 'deleted stays deleted');
  assert.equal(mergeLists(there, here).items.length, 1, 'whichever way round');
  assert.equal(mergeLists(here, there).items[0].text, 'Lait');
  assert.equal(mergeLists(here, there).items[0].done, true, 'and the tick made there is kept');
});

test('clearing what is done does not undo itself', () => {
  let list = addItems(createList({ names: ['Gui'] }), 'Pain\nLait\nŒufs');
  list = toggleItem(list, list.items[0].id);
  list = toggleItem(list, list.items[1].id);
  const elsewhere = list; // the other phone, before the clearing

  const cleared = list.items
    .filter((item) => item.done)
    .reduce((carry, item) => removeItem(carry, item.id), list);
  assert.equal(cleared.items.length, 1);

  const merged = mergeLists(cleared, elsewhere);
  assert.equal(merged.items.length, 1, 'the two cleared lines stay gone');
  assert.equal(merged.items[0].text, 'Œufs');
});

test('a line added elsewhere after a clearing still arrives', () => {
  const start = addItems(createList({ names: ['Gui'] }), 'Pain');
  const cleared = removeItem(start, start.items[0].id);
  const elsewhere = addItems(start, 'Beurre');

  const merged = mergeLists(cleared, elsewhere);
  assert.deepEqual(merged.items.map((i) => i.text), ['Beurre'],
    'a deletion is not a reason to refuse everything else');
});

test('whoever touched the people last is right about them', () => {
  const start = addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'] }), 'Pain');
  const alice = start.people[1].id;

  // Here: Alice is removed. There: only a line is ticked, people untouched.
  const here = removePerson(start, alice);
  const there = toggleItem(start, start.items[0].id);

  assert.equal(mergeLists(here, there).people.length, 1, 'Alice stays removed');
  assert.equal(mergeLists(there, here).people.length, 1, 'whichever way round');
  assert.equal(mergeLists(there, here).items[0].done, true, 'and the tick survives it');
});

test('someone added elsewhere is not lost to a change made here', () => {
  const start = addItems(createList({ name: 'Courses', names: ['Gui'] }), 'Pain');
  const here = toggleItem(start, start.items[0].id);
  const there = addPerson(start, 'Lea');

  assert.deepEqual(mergeLists(here, there).people.map((p) => p.name), ['Gui', 'Lea']);
  assert.deepEqual(mergeLists(there, here).people.map((p) => p.name), ['Gui', 'Lea'],
    'even when the lines are identical on both sides');
});

test('sharing out nothing is not a change at all', () => {
  const list = shareOut(addItems(createList({ names: ['Gui'] }), 'Pain'));
  assert.equal(shareOut(list), list, 'nothing left to hand out: the same list, untouched');

  const nobody = addItems(createList(), 'Pain');
  assert.equal(shareOut(nobody), nobody, 'and nobody to share with is not a change either');

  const allDone = toggleItem(addItems(createList({ names: ['Gui'] }), 'Pain'), undefined);
  assert.ok(allDone, 'an unknown line changes nothing');
});
