import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPoll, addOptions, renameOption, removeOption, setVote, voteOf, nextValue,
  addPollPerson as addPerson, renamePollPerson as renamePerson, removePollPerson as removePerson,
  setClosed, tally, mergePolls, isValidPoll, VALUES,
} from '../src/polls.js';

const sample = () =>
  addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice', 'Bob'] }), 'Vendredi\nSamedi\nDimanche');

const idsOf = (poll) => ({
  people: poll.people.map((person) => person.id),
  options: poll.options.map((option) => option.id),
});

test('a poll is a question, choices, and people', () => {
  const poll = createPoll({ question: '  Quel soir ?  ', names: ['Gui', ' ', 'Alice'] });
  assert.equal(poll.question, 'Quel soir ?');
  assert.equal(poll.kind, 'poll');
  assert.deepEqual(poll.people.map((p) => p.name), ['Gui', 'Alice']);
  assert.deepEqual(poll.options, []);
  assert.deepEqual(poll.votes, {});
  assert.equal(poll.closedAt, null);
  assert.equal(poll.shared, false);
});

test('choices are pasted in like any list, quantities and dates intact', () => {
  const poll = addOptions(createPoll(), '- Vendredi 12\n2) Samedi 13\n\n  \n• Dimanche 14\n18 h 30');
  assert.deepEqual(poll.options.map((o) => o.text),
    ['Vendredi 12', 'Samedi 13', 'Dimanche 14', '18 h 30']);
});

test('an answer is one of three, per person and per choice', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);

  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[0], options[1], 'maybe');
  poll = setVote(poll, people[1], options[0], 'no');

  assert.equal(voteOf(poll, people[0], options[0]), 'yes');
  assert.equal(voteOf(poll, people[0], options[1]), 'maybe');
  assert.equal(voteOf(poll, people[1], options[0]), 'no');
  assert.equal(voteOf(poll, people[2], options[0]), null, 'no answer is not a no');

  poll = setVote(poll, people[0], options[0], null);
  assert.equal(voteOf(poll, people[0], options[0]), null, 'and an answer can be taken back');
});

test('an answer nobody can give is refused rather than stored', () => {
  const poll = sample();
  const { people, options } = idsOf(poll);

  assert.equal(setVote(poll, 'w_inconnu', options[0], 'yes'), poll, 'a stranger');
  assert.equal(setVote(poll, people[0], 'o_inconnue', 'yes'), poll, 'a choice that is not offered');
  assert.equal(setVote(poll, people[0], options[0], 'peut-être'), poll, 'a value that is not one of three');
  assert.deepEqual(VALUES, ['yes', 'maybe', 'no']);
});

test('answering the same thing twice changes nothing', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  assert.equal(setVote(poll, people[0], options[0], 'yes'), poll);
});

test('a tap ticks an evening, a second tap unticks it', () => {
  assert.equal(nextValue(null), 'yes');
  assert.equal(nextValue('yes'), null);
  // Answers given before "maybe" and "no" were dropped are still there; a tap
  // on one makes it what the grid can now say.
  assert.equal(nextValue('maybe'), 'yes');
  assert.equal(nextValue('no'), 'yes');
});

test('a closed poll takes no more answers', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setClosed(poll, true);

  assert.ok(poll.closedAt);
  assert.equal(setVote(poll, people[1], options[0], 'yes'), poll, 'closed means closed');
  assert.equal(voteOf(poll, people[0], options[0]), 'yes', 'and what was answered stays');

  const open = setClosed(poll, false);
  assert.equal(open.closedAt, null);
  assert.notEqual(setVote(open, people[1], options[0], 'yes'), open, 'reopening lets people answer again');
});

test('the count puts the evening that suits most people first', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  // Vendredi : un oui. Samedi : deux oui. Dimanche : un oui.
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[0], options[1], 'yes');
  poll = setVote(poll, people[1], options[1], 'yes');
  poll = setVote(poll, people[1], options[2], 'yes');

  const result = tally(poll);
  assert.deepEqual(result.ranked.map((row) => row.option.text), ['Samedi', 'Vendredi', 'Dimanche'],
    'most available first; level, in the order they were written');
  assert.deepEqual(result.rows.map((row) => row.option.text), ['Vendredi', 'Samedi', 'Dimanche'],
    'while the grid keeps the order the choices were written in');
  assert.equal(result.ranked[0].yes, 2);
  assert.equal(result.ranked[0].missing, 1);
  assert.deepEqual(result.leaders, [options[1]]);
  assert.equal(result.answered, 2, 'the third person has ticked nothing yet');
});

test('an old "maybe" or "no" counts for nothing, as the grid shows nothing for it', () => {
  // A poll answered before the change: its maybes and noes are still stored.
  // The grid no longer draws them, so the count must not weigh them either —
  // or the gauge would crown an evening with fewer ticks than another.
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[0], options[1], 'yes');
  poll = setVote(poll, people[1], options[1], 'maybe');
  poll = setVote(poll, people[2], options[1], 'maybe');

  const result = tally(poll);
  assert.equal(result.rows[1].yes, 1);
  assert.equal(result.rows[1].score, 1, 'two maybes add nothing');
  assert.deepEqual(result.leaders, [options[0], options[1]], 'one tick each: both lead');
});

test('a poll nobody has answered has no leader', () => {
  const result = tally(sample());
  assert.deepEqual(result.leaders, []);
  assert.equal(result.answered, 0);
  assert.equal(result.rows[0].missing, 3, 'and everyone is still expected');
});

test('two choices that tie both lead', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[0], options[1], 'yes');

  assert.deepEqual(tally(poll).leaders.sort(), [options[0], options[1]].sort());
});

test('a choice taken away takes its answers with it', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[0], options[1], 'yes');

  poll = removeOption(poll, options[0]);
  assert.equal(poll.options.length, 2);
  assert.equal(Object.keys(poll.votes).length, 1, 'the answers to the dropped choice are gone');
  assert.equal(voteOf(poll, people[0], options[1]), 'yes', 'the others are untouched');
  assert.ok(poll.removed[options[0]], 'and it leaves a trace, so it does not come back');
});

test('someone removed takes their answers with them', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = setVote(poll, people[1], options[0], 'no');

  poll = removePerson(poll, people[0]);
  assert.equal(poll.people.length, 2);
  assert.equal(voteOf(poll, people[1], options[0]), 'no');
  assert.equal(Object.keys(poll.votes).length, 1);
});

test('a choice is renamed without losing what people answered', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = renameOption(poll, options[0], '  Vendredi 12, 20 h ');

  assert.equal(poll.options[0].text, 'Vendredi 12, 20 h');
  assert.equal(voteOf(poll, people[0], options[0]), 'yes');
  assert.equal(renameOption(poll, options[0], '  ').options[0].text, 'Vendredi 12, 20 h');
});

test('renaming a person keeps their answers', () => {
  let poll = sample();
  const { people, options } = idsOf(poll);
  poll = setVote(poll, people[0], options[0], 'yes');
  poll = renamePerson(poll, people[0], 'Guillaume');

  assert.equal(poll.people[0].name, 'Guillaume');
  assert.equal(voteOf(poll, people[0], options[0]), 'yes');
});

test('two people answering at the same moment both count', () => {
  const start = sample();
  const { people, options } = idsOf(start);

  const here = setVote(start, people[0], options[0], 'yes');
  const there = setVote(start, people[1], options[1], 'no');

  const merged = mergePolls(here, there);
  assert.equal(voteOf(merged, people[0], options[0]), 'yes');
  assert.equal(voteOf(merged, people[1], options[1]), 'no');
});

test('the same person answering twice keeps their last answer', () => {
  const start = sample();
  const { people, options } = idsOf(start);

  const here = setVote(start, people[0], options[0], 'yes');
  const there = setVote(setVote(start, people[0], options[0], 'yes'), people[0], options[0], 'no');

  assert.equal(voteOf(mergePolls(here, there), people[0], options[0]), 'no');
  assert.equal(voteOf(mergePolls(there, here), people[0], options[0]), 'no', 'whichever way round');
});

test('a choice dropped here does not come back from the other phone', () => {
  const start = sample();
  const { people, options } = idsOf(start);

  const here = removeOption(start, options[0]);
  const there = setVote(start, people[0], options[0], 'yes');

  const merged = mergePolls(here, there);
  assert.equal(merged.options.length, 2, 'the choice stays dropped');
  assert.equal(voteOf(merged, people[0], options[0]), null, 'and so do the answers to it');
  assert.equal(mergePolls(there, here).options.length, 2, 'whichever way round');
});

test('a choice added elsewhere arrives, with its answers', () => {
  const start = sample();
  const here = setVote(start, idsOf(start).people[0], idsOf(start).options[0], 'yes');
  const there = addOptions(start, 'Lundi');
  const added = there.options[3].id;
  const voted = setVote(there, idsOf(there).people[1], added, 'yes');

  const merged = mergePolls(here, voted);
  assert.equal(merged.options.length, 4);
  assert.equal(voteOf(merged, idsOf(merged).people[1], added), 'yes');
  assert.equal(voteOf(merged, idsOf(merged).people[0], idsOf(merged).options[0]), 'yes');
});

test('whoever touched the people last is right about them', () => {
  const start = sample();
  const alice = start.people[1].id;

  const here = removePerson(start, alice);
  const there = setVote(start, start.people[0].id, start.options[0].id, 'yes');

  assert.equal(mergePolls(here, there).people.length, 2, 'Alice stays removed');
  assert.equal(mergePolls(there, here).people.length, 2, 'whichever way round');
  assert.equal(voteOf(mergePolls(there, here), start.people[0].id, start.options[0].id), 'yes',
    'and the answer given meanwhile survives');
});

test('what comes back from storage is looked at before it is trusted', () => {
  assert.ok(isValidPoll(sample()));
  assert.ok(!isValidPoll(null));
  assert.ok(!isValidPoll({ kind: 'list', id: 'l_1', people: [], items: [] }), 'a list is not a poll');
  assert.ok(!isValidPoll({ kind: 'poll', id: 'v_1', people: [], options: [{ id: 'o' }], votes: {} }),
    'a choice with no text');
  assert.ok(!isValidPoll({ kind: 'poll', id: 'v_1', people: [], options: [] }), 'no answers at all');
});

test('a poll that came back unchanged is the very same poll', () => {
  const poll = setVote(sample(), idsOf(sample()).people[0], idsOf(sample()).options[0], 'yes');
  const asStored = JSON.parse(JSON.stringify(poll));

  assert.equal(mergePolls(poll, poll), poll, 'itself');
  assert.equal(mergePolls(poll, asStored), poll,
    'and a copy that went through the database and came back the same');
  assert.notEqual(mergePolls(poll, setVote(asStored, asStored.people[1].id, asStored.options[0].id, 'no')), poll,
    'but a real change is a change');
});

test('a poll starts with no choices, whatever it is handed', () => {
  const poll = createPoll({ question: 'Quel soir ?', names: ['Gui'] });
  assert.deepEqual(poll.options, [], 'choices are added with addOptions, and only there');
});

test('the grid keeps the order of the choices, however people answer', () => {
  // A grid that re-sorts itself moves the row out from under the finger that
  // just tapped it: answering three questions in a row becomes a chase.
  let poll = addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'] }), 'lundi\nmardi\nmercredi\njeudi');
  const order = (held) => tally(held).rows.map((row) => row.option.text).join(' > ');
  const start = order(poll);
  assert.equal(start, 'lundi > mardi > mercredi > jeudi');

  const [gui] = poll.people;
  const jeudi = poll.options[3];
  poll = setVote(poll, gui.id, jeudi.id, 'yes');
  assert.equal(order(poll), start, 'a yes on the last choice does not lift it to the top');

  poll = setVote(poll, gui.id, poll.options[0].id, 'no');
  assert.equal(order(poll), start, 'nor does a no on the first push it down');

  // The ranking still exists — kept apart from the grid.
  assert.equal(tally(poll).ranked[0].option.text, 'jeudi');
  assert.deepEqual(tally(poll).leaders, [jeudi.id]);
});

test('the ranking is a sort of its own, not the rows rearranged', () => {
  let poll = addOptions(createPoll({ question: 'Où ?', names: ['Gui'] }), 'a\nb');
  poll = setVote(poll, poll.people[0].id, poll.options[1].id, 'yes');
  const { rows, ranked } = tally(poll);
  assert.deepEqual(rows.map((row) => row.option.text), ['a', 'b']);
  assert.deepEqual(ranked.map((row) => row.option.text), ['b', 'a']);
  assert.notEqual(rows, ranked, 'two arrays, not one sorted in place');
});

test('who is coming: those free on the one choice that leads, or everyone', async () => {
  const { goers } = await import('../src/polls.js');
  let poll = sample();
  const [gui, alice, bob] = poll.people;
  assert.deepEqual(goers(poll), ['Gui', 'Alice', 'Bob']);
  poll = setVote(poll, gui.id, poll.options[1].id, 'yes');
  poll = setVote(poll, bob.id, poll.options[1].id, 'yes');
  poll = setVote(poll, alice.id, poll.options[0].id, 'yes');
  assert.deepEqual(goers(poll), ['Gui', 'Bob']);
  poll = setVote(poll, alice.id, poll.options[2].id, 'yes');
  poll = setVote(poll, gui.id, poll.options[2].id, 'yes');
  assert.deepEqual(goers(poll), ['Gui', 'Alice', 'Bob'], 'a tie says nothing about who comes');
});

test('an event with its day known: a settled poll with nothing to vote on', async () => {
  const { createEvent, isEvent, goers } = await import('../src/polls.js');
  const event = createEvent({ name: 'Anniversaire de Léa', names: ['Gui', '', 'Alice'], date: '2026-10-12', at: '19:30' });
  assert.equal(event.kind, 'poll');
  assert.ok(isEvent(event));
  assert.ok(!isEvent(sample()));
  assert.equal(event.date, '2026-10-12');
  assert.equal(event.at, '19:30');
  assert.equal(event.title, 'Anniversaire de Léa');
  assert.ok(event.closedAt, 'no vote to take');
  assert.deepEqual(event.options, []);
  assert.deepEqual(goers(event), ['Gui', 'Alice']);
  assert.ok(isValidPoll(event));
  assert.equal(createEvent({ name: 'x', date: 'demain' }).date, null);
});
