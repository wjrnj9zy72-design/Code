import test from 'node:test';
import assert from 'node:assert/strict';

import { inGroup, peopleIn, groupCounts, personFile } from '../src/dashboard.js';
import { createList, addItems, assignItem, toggleItem } from '../src/lists.js';
import { createPoll, addOptions, setVote, setClosed } from '../src/polls.js';
import { createGame, addRound, setFinished } from '../src/model.js';

/** A list of three lines, two of them Alice's, one of hers ticked. */
function courses(groupId = null) {
  let list = addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'], groupId }), 'Pain\nLait\nŒufs');
  const alice = list.people.find((person) => person.name === 'Alice');
  list = assignItem(list, list.items[0].id, alice.id);
  list = assignItem(list, list.items[1].id, alice.id);
  return toggleItem(list, list.items[0].id);
}

/** A poll Gui answered and Alice did not. */
function quelSoir(groupId = null) {
  let poll = addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'], groupId }), 'mardi\njeudi');
  const gui = poll.people.find((person) => person.name === 'Gui');
  return setVote(poll, gui.id, poll.options[0].id, 'yes');
}

/** A finished game Alice won, with Gui second. */
function papayoo(groupId = null) {
  let game = createGame({ presetId: 'papayoo', names: ['Gui', 'Alice'], groupId });
  game = addRound(game, { scores: { [game.players[0].id]: 200, [game.players[1].id]: 50 } });
  return setFinished(game, true);
}

test('a document with no group is in every view, and in none of the group ones', () => {
  assert.equal(inGroup({ groupId: null }, ''), true, 'no group chosen means all of them');
  assert.equal(inGroup({ groupId: null }, 'g1'), false);
  assert.equal(inGroup({ groupId: 'g1' }, 'g1'), true);
  assert.equal(inGroup({ groupId: 'g1' }, 'g2'), false);
  assert.equal(inGroup(undefined, 'g1'), false, 'nothing is in no group');
});

test('a group is counted on what it holds, not on what the device holds', () => {
  const data = {
    lists: [courses('mifa'), courses('copains')],
    polls: [quelSoir('mifa'), setClosed(quelSoir('mifa'), true)],
    games: [papayoo('copains')],
  };

  const mifa = groupCounts(data, 'mifa');
  assert.equal(mifa.lists, 1, 'one list with lines left');
  assert.equal(mifa.polls, 1, 'the closed poll is no longer going on');
  assert.equal(mifa.games, 0);
  assert.equal(mifa.left, 2, 'two lines still to tick');
  assert.equal(mifa.people, 2);

  const copains = groupCounts(data, 'copains');
  assert.equal(copains.games, 0, 'a finished game is not going on either');
  assert.equal(copains.lists, 1);

  const everything = groupCounts(data);
  assert.equal(everything.lists, 2, 'no group given counts the lot');
  assert.equal(everything.left, 4);
});

test('an empty group says so rather than breaking', () => {
  const counts = groupCounts({}, 'mifa');
  assert.deepEqual(
    { lists: counts.lists, polls: counts.polls, games: counts.games, left: counts.left, people: counts.people, at: counts.at },
    { lists: 0, polls: 0, games: 0, left: 0, people: 0, at: 0 },
  );
});

test('one person written two ways is one person, under the newer spelling', () => {
  const older = { ...createList({ name: 'A', names: ['alice'] }), updatedAt: 1000 };
  const newer = { ...createList({ name: 'B', names: ['Alice', 'Gui'] }), updatedAt: 2000 };
  assert.deepEqual(peopleIn({ lists: [older, newer] }), ['Alice', 'Gui']);

  const latest = { ...createList({ name: 'C', names: ['ALICE'] }), updatedAt: 3000 };
  assert.deepEqual(peopleIn({ lists: [older, newer, latest] }), ['ALICE', 'Gui'],
    'the spelling they chose last is the one shown');
});

test('everyone is counted once, from lists, polls and games alike', () => {
  const names = peopleIn({ lists: [courses()], polls: [quelSoir()], games: [papayoo()] });
  assert.deepEqual(names, ['Alice', 'Gui'], 'alphabetical, and nobody twice');
  assert.deepEqual(peopleIn({}), []);
});

test("a person's file gathers what waits on them", () => {
  const file = personFile({ lists: [courses()], polls: [quelSoir()], games: [papayoo()] }, 'alice');

  assert.equal(file.known, true);
  assert.equal(file.name, 'Alice', 'asked in lower case, answered as she writes it');
  assert.equal(file.lines.length, 1);
  assert.deepEqual(
    { done: file.lines[0].done, total: file.lines[0].total },
    { done: 1, total: 2 },
    'only the lines handed to her count',
  );
  assert.equal(file.votes.length, 1);
  assert.equal(file.votes[0].answered, false);
  assert.equal(file.played.length, 1);
  assert.equal(file.played[0].won, true);
  assert.equal(file.played[0].rank, 1);
  assert.equal(file.played[0].of, 2);
  assert.deepEqual(file.counts, { games: 1, wins: 1, left: 1, votes: 1 });
});

test('a name nobody here carries comes back empty rather than wrong', () => {
  const file = personFile({ lists: [courses()] }, 'Claire');
  assert.equal(file.known, false);
  assert.equal(file.name, 'Claire');
  assert.deepEqual(file.counts, { games: 0, wins: 0, left: 0, votes: 0 });
  assert.deepEqual(file.lines, []);
});

test('a closed poll is no longer waiting on anyone', () => {
  const open = personFile({ polls: [quelSoir()] }, 'Alice');
  assert.equal(open.counts.votes, 1);

  const closed = personFile({ polls: [setClosed(quelSoir(), true)] }, 'Alice');
  assert.equal(closed.counts.votes, 0, 'nothing to answer once it is closed');
  assert.equal(closed.votes[0].closed, true);
});

test('a game nobody has scored says nothing about the people in it', () => {
  const fresh = createGame({ presetId: 'papayoo', names: ['Gui', 'Alice'] });
  const file = personFile({ games: [fresh] }, 'Alice');
  assert.equal(file.known, true, 'she is in it all the same');
  assert.deepEqual(file.played, []);
  assert.equal(file.counts.games, 0);
});

test("a person's file names the groups they turn up in", () => {
  const file = personFile({ lists: [courses('mifa')], games: [papayoo('copains')] }, 'Alice');
  assert.deepEqual([...file.groupIds].sort(), ['copains', 'mifa']);
});

test('the newest of everything comes first', () => {
  const old = { ...courses(), updatedAt: 1000 };
  const recent = { ...courses(), updatedAt: 5000 };
  const file = personFile({ lists: [old, recent] }, 'Alice');
  assert.deepEqual(file.lines.map((row) => row.list.updatedAt), [5000, 1000]);
});
