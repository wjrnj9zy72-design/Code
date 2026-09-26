import test from 'node:test';
import assert from 'node:assert/strict';

import { inGroup, peopleIn, groupCounts, personFile, dayNow, isLate, isLive } from '../src/dashboard.js';
import {
  createList, addItems, assignItem, toggleItem, setItemDue, archiveList, makeTemplate,
} from '../src/lists.js';
import { createPoll, addOptions, setVote, setClosed, archivePoll } from '../src/polls.js';
import { createGame, addRound, setFinished, archiveGame } from '../src/model.js';

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

test('a link-only document is in no group view, not even the one that created it', () => {
  // The database never lists it for that group: counting it there would tell
  // the group about something it cannot see.
  assert.equal(inGroup({ groupId: 'g1', linkOnly: true }, 'g1'), false);
  assert.equal(inGroup({ groupId: 'g1', linkOnly: true }, ''), true, 'but "All" shows it, to whoever holds it');
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
  assert.deepEqual(file.counts, { games: 1, wins: 1, left: 1, late: 0, votes: 1, owes: 0, owed: 0 });
});

test('a name nobody here carries comes back empty rather than wrong', () => {
  const file = personFile({ lists: [courses()] }, 'Claire');
  assert.equal(file.known, false);
  assert.equal(file.name, 'Claire');
  assert.deepEqual(file.counts, { games: 0, wins: 0, left: 0, late: 0, votes: 0, owes: 0, owed: 0 });
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

test('a day is the reader\'s day, not Greenwich\'s', () => {
  // Ten past midnight in Paris is still the day before in UTC: a line due
  // "today" must not read as late because of where the prime meridian is.
  const midnight = new Date(2026, 0, 15, 0, 10).getTime();
  assert.equal(dayNow(midnight), '2026-01-15');
  assert.equal(dayNow(new Date(2026, 11, 31, 23, 50).getTime()), '2026-12-31');
});

test('a line is late only once its day has passed, and only while it is undone', () => {
  const item = { due: '2026-01-15', done: false };
  assert.equal(isLate(item, '2026-01-16'), true);
  assert.equal(isLate(item, '2026-01-15'), false, 'a line due today is a line for today');
  assert.equal(isLate(item, '2026-01-14'), false);
  assert.equal(isLate({ ...item, done: true }, '2026-01-16'), false, 'ticked is never late');
  assert.equal(isLate({ due: null, done: false }, '2026-01-16'), false, 'no day, no lateness');
});

test('a day goes on a line and comes off it', () => {
  let list = addItems(createList({ name: 'Courses' }), 'Pain');
  const id = list.items[0].id;
  list = setItemDue(list, id, '2026-03-04');
  assert.equal(list.items[0].due, '2026-03-04');

  list = setItemDue(list, id, '');
  assert.equal(list.items[0].due, null, 'an empty field takes the day off');

  list = setItemDue(list, id, '4 mars');
  assert.equal(list.items[0].due, null, 'anything that is not a day is no day');
});

test('what is put away, and what is a model, count nowhere', () => {
  const live = courses('mifa');
  const away = archiveList(courses('mifa'));
  const model = makeTemplate(courses('mifa'));

  assert.equal(isLive(live), true);
  assert.equal(isLive(away), false);
  assert.equal(isLive(model), false);

  const counts = groupCounts({ lists: [live, away, model] }, 'mifa');
  assert.equal(counts.lists, 1, 'one list in progress, not three');
  assert.equal(counts.left, 2, 'and only its lines are still to tick');
  assert.equal(counts.people, 2, 'the people are still people, wherever they are named');
});

test('an archived poll or game is no longer going on', () => {
  const polls = groupCounts({ polls: [archivePoll(quelSoir())] });
  assert.equal(polls.polls, 0);

  const fresh = createGame({ presetId: 'papayoo', names: ['Gui', 'Alice'] });
  assert.equal(groupCounts({ games: [fresh] }).games, 1);
  assert.equal(groupCounts({ games: [archiveGame(fresh)] }).games, 0);
});

test('a group counts what has gone past its day', () => {
  let list = addItems(createList({ name: 'Corvées', names: ['Alice'], groupId: 'mifa' }), 'Poubelles\nCave');
  const alice = list.people[0].id;
  list = assignItem(list, list.items[0].id, alice);
  list = setItemDue(list, list.items[0].id, '2026-01-01');
  list = setItemDue(list, list.items[1].id, '2026-12-31');

  const counts = groupCounts({ lists: [list] }, 'mifa', '2026-06-01');
  assert.equal(counts.late, 1, 'one day passed, one still ahead');

  const file = personFile({ lists: [list] }, 'Alice', '2026-06-01');
  assert.equal(file.counts.late, 1);
  assert.equal(file.lines[0].next, '2026-01-01', 'the soonest day still owed');
});

test('what waits on someone is only what they can still do', () => {
  const file = personFile({ lists: [archiveList(courses())], polls: [archivePoll(quelSoir())] }, 'Alice');
  assert.equal(file.known, true, 'she was there, and the archive remembers it');
  assert.deepEqual(file.lines, []);
  assert.deepEqual(file.votes, []);
  assert.equal(file.counts.votes, 0);
});

test('but an archived evening stays part of what someone played', () => {
  const file = personFile({ games: [archiveGame(papayoo())] }, 'Alice');
  assert.equal(file.counts.games, 1, 'archiving clears the tab, it does not rewrite history');
  assert.equal(file.played[0].won, true);
});

test('les comptes de dépenses comptent parmi ce que tient un groupe', async () => {
  const { createSpend, addSpend } = await import('../src/spends.js');
  const spend = createSpend({ name: 'Vacances', names: ['Gui', 'Alice'], groupId: 'mifa' });
  const owing = addSpend(spend, { text: 'Gîte', amount: 10000, by: spend.people[0].id });

  assert.equal(groupCounts({ spends: [owing] }, 'mifa').spends, 1);
  assert.equal(groupCounts({ spends: [spend] }, 'mifa').spends, 0, 'un compte sans dépense ne doit rien à personne');
  assert.equal(groupCounts({ spends: [archiveList(owing)] }, 'mifa').spends, 0, 'ni un compte rangé');
  assert.ok(peopleIn({ spends: [owing] }).includes('Alice'), 'et ses personnes sont des personnes');
});

test('les tableaux d’idées comptent aussi, tant qu’ils ne sont pas rangés', async () => {
  const { createBoard } = await import('../src/ideas.js');
  const board = { ...createBoard({ name: 'Déco' }), groupId: 'mifa', shared: true };

  assert.equal(groupCounts({ boards: [board] }, 'mifa').boards, 1);
  assert.equal(groupCounts({ boards: [board] }, 'copains').boards, 0, 'pas dans un autre groupe');
  assert.equal(groupCounts({ boards: [{ ...board, archivedAt: 1 }] }, 'mifa').boards, 0, 'ni rangé');
  assert.ok(groupCounts({ boards: [board] }, 'mifa').at > 0, 'et il date le groupe');
});

test('la page d’une personne dit ce qu’elle doit, et ce qu’on lui doit', async () => {
  const { createSpend, addSpend } = await import('../src/spends.js');
  const spend = createSpend({ name: 'Vacances', names: ['Gui', 'Alice'], groupId: 'mifa' });
  const owing = addSpend(spend, { text: 'Gîte', amount: 10000, by: spend.people[0].id });

  const alice = personFile({ spends: [owing] }, 'Alice');
  assert.equal(alice.counts.owes, 5000);
  assert.equal(alice.counts.owed, 0);
  assert.equal(alice.accounts.length, 1);

  const gui = personFile({ spends: [owing] }, 'Gui');
  assert.equal(gui.counts.owed, 5000);
  assert.equal(gui.counts.owes, 0);
  assert.equal(gui.accounts[0].paid, 10000);
});

test('a poll that settled is an event: its list and account are the ones made for it', async () => {
  const { eventParts, forEvent } = await import('../src/dashboard.js');
  const { createSpend, mergeSpends } = await import('../src/spends.js');
  const { mergeLists } = await import('../src/lists.js');
  let poll = addOptions(createPoll({ question: 'Quel week-end ?', names: ['Gui', 'Alice', 'Bob'], shared: true, groupId: 'g1' }), 'Le 12\nLe 19');
  const [gui, alice, bob] = poll.people;
  poll = setVote(poll, gui.id, poll.options[0].id, 'yes');
  poll = setVote(poll, alice.id, poll.options[0].id, 'yes');
  poll = setVote(poll, bob.id, poll.options[1].id, 'yes');

  const list = forEvent(poll, createList, 'Annecy');
  assert.equal(list.kind, 'list');
  assert.equal(list.parent, poll.id);
  assert.equal(list.groupId, 'g1');
  assert.equal(list.shared, true);
  assert.deepEqual(list.people.map((person) => person.name), ['Gui', 'Alice']);

  const spend = forEvent({ ...poll, linkOnly: true }, createSpend, 'Annecy');
  assert.equal(spend.kind, 'spend');
  assert.equal(spend.linkOnly, true);

  const other = createList({ name: 'Autre' });
  const parts = eventParts(poll, { lists: [other, list], spends: [spend] });
  assert.equal(parts.list, list);
  assert.equal(parts.spend, spend);
  assert.deepEqual(parts.lists, [list], 'la liste d’un autre événement n’en est pas');
  const none = eventParts(poll, { lists: [other] });
  assert.equal(none.list, null);
  assert.equal(none.spend, null);

  // The tie to the event survives a merge with an older copy of the same list.
  const touched = { ...list, name: 'Annecy !', updatedAt: list.updatedAt + 5 };
  assert.equal(mergeLists(list, touched).parent, poll.id);
  assert.equal(mergeSpends({ ...spend, updatedAt: 1 }, spend).parent, poll.id);
});

test('un événement rassemble tout ce qui est fait pour lui, de toutes les sortes', async () => {
  const { eventParts, partsCount, upcomingEvents } = await import('../src/dashboard.js');
  const { createEvent, createPoll } = await import('../src/polls.js');
  const { createBoard } = await import('../src/ideas.js');
  const raclette = createEvent({ name: 'Raclette', names: ['Gui'], date: '2026-10-10' });
  const vin = { ...createPoll({ question: 'Quel vin ?' }), event: raclette.id };
  const deco = { ...createBoard({ name: 'Déco' }), event: raclette.id };
  const ailleurs = createBoard({ name: 'Autre chose' });
  const parts = eventParts(raclette, { polls: [raclette, vin], boards: [deco, ailleurs] });
  assert.deepEqual(parts.polls, [vin], 'un sondage fait pour l’événement, pas l’événement lui-même');
  assert.deepEqual(parts.boards, [deco]);
  assert.equal(partsCount(parts), 2);

  const passe = createEvent({ name: 'Pique-nique', date: '2026-09-01' });
  const weekend = createEvent({ name: 'Week-end', date: '2026-09-25', until: '2026-09-27' });
  const bientot = createEvent({ name: 'Bientôt', date: '2026-09-30' });
  assert.deepEqual(upcomingEvents([bientot, passe, raclette, weekend, vin], '2026-09-26').map((p) => p.id),
    [weekend.id, bientot.id, raclette.id], 'en cours et à venir, du plus proche au plus lointain');
});

test('la chaîne : tout se rattache à tout, l’événement reste au-dessus', async () => {
  const { attach, parentId, ancestorsOf, eventOf, descendantsOf, attachTargets, eventParts, allDocuments } = await import('../src/dashboard.js');
  const { createEvent, createPoll } = await import('../src/polls.js');
  const { createBoard, mergeBoards } = await import('../src/ideas.js');
  const g = { groupId: 'mifa', shared: true };
  const raclette = { ...createEvent({ name: 'Raclette', date: '2026-10-10' }), ...g };
  const courses = { ...createList({ name: 'Courses' }), ...g, event: raclette.id }; // à l'ancienne
  let vin = { ...createPoll({ question: 'Quel vin ?' }), ...g };
  let deco = { ...createBoard({ name: 'Déco' }), ...g };
  const copains = { ...createBoard({ name: 'Ailleurs' }), groupId: 'copains', shared: true };

  assert.equal(parentId(courses), raclette.id, 'l’ancien champ se lit encore');
  vin = attach(vin, courses.id);
  deco = attach(deco, vin.id);
  const all = () => allDocuments({ lists: [courses], polls: [raclette, vin], boards: [deco, copains] });

  assert.deepEqual(ancestorsOf(deco, all()).map((d) => d.id), [raclette.id, courses.id, vin.id], 'du plus haut au plus proche');
  assert.equal(eventOf(deco, all()).id, raclette.id, 'l’événement se trouve au bout de la chaîne');
  assert.deepEqual(descendantsOf(raclette, all()).map((d) => d.id).sort(), [courses.id, vin.id, deco.id].sort());
  assert.equal(eventParts(raclette, { lists: [courses], polls: [raclette, vin], boards: [deco] }).boards[0].id, deco.id,
    'l’événement voit tout ce qui est en dessous, même loin');

  const targets = attachTargets(courses, all()).map((d) => d.id);
  assert.ok(targets.includes(raclette.id));
  assert.ok(!targets.includes(vin.id) && !targets.includes(deco.id), 'pas sous ce qui est déjà en dessous : la chaîne ne se referme pas');
  assert.ok(!targets.includes(courses.id), 'ni sous soi-même');
  assert.ok(!targets.includes(copains.id), 'ni dans un autre groupe');
  assert.deepEqual(attachTargets(raclette, all()), [], 'un événement ne se rattache à rien');

  const detached = attach(courses, null);
  assert.equal(parentId(detached), null, 'détaché, l’ancien champ ne revient pas');
  assert.ok(!('event' in detached));
  assert.ok(detached.updatedAt > courses.updatedAt, 'le plus récent l’emporte, comme pour un titre');

  // Deux appareils : celui qui rattache en dernier l’emporte à la fusion.
  const moved = attach(deco, raclette.id);
  assert.equal(parentId(mergeBoards(deco, moved)), raclette.id);
  assert.equal(parentId(mergeBoards(moved, deco)), raclette.id);
});

test('le plan de la chaîne : tout l’arbre, depuis l’événement, où que l’on soit', async () => {
  const { attach, chainTree, treeSize } = await import('../src/dashboard.js');
  const { createEvent, createPoll } = await import('../src/polls.js');
  const { createBoard } = await import('../src/ideas.js');
  const raclette = createEvent({ name: 'Raclette', date: '2026-10-10' });
  const courses = attach(createList({ name: 'Courses' }), raclette.id);
  const vin = attach(createPoll({ question: 'Quel vin ?' }), courses.id);
  const deco = attach(createBoard({ name: 'Déco' }), raclette.id);
  const range = { ...attach(createBoard({ name: 'Rangé' }), raclette.id), archivedAt: 1 };
  const seul = createList({ name: 'Seul' });
  const all = [raclette, courses, vin, deco, range, seul];

  const tree = chainTree(vin, all);
  assert.equal(tree.document.id, raclette.id, 'le plan part de l’événement, même vu du bout');
  assert.deepEqual(tree.children.map((c) => c.document.id), [courses.id, deco.id], 'dans l’ordre des onglets, sans ce qui est rangé');
  assert.deepEqual(tree.children[0].children.map((c) => c.document.id), [vin.id]);
  assert.equal(treeSize(tree), 4);
  assert.equal(treeSize(chainTree(seul, all)), 1, 'seul, il n’a pas de chaîne');
  assert.equal(chainTree(range, all).children.length, 3, 'rangé, il se voit encore depuis sa propre page');
});

test('les liens : au-delà de la chaîne, ce qui va avec, ce qui attend quoi', async () => {
  const { linkTo, unlinkFrom, relationsOf, linkTargets, waitingOn, isDone, attach } = await import('../src/dashboard.js');
  const { createEvent, createPoll, setClosed } = await import('../src/polls.js');
  const { createSpend } = await import('../src/spends.js');
  const { createBoard, mergeBoards } = await import('../src/ideas.js');
  const g = { groupId: 'mifa', shared: true };
  const raclette = { ...createEvent({ name: 'Raclette', date: '2026-10-10' }), ...g };
  let vin = { ...createPoll({ question: 'Quel vin ?' }), ...g };
  let courses = attach({ ...addItems(createList({ name: 'Courses' }), 'Fromage'), ...g }, raclette.id);
  let compte = { ...createSpend({ name: 'Compte', names: ['Gui'] }), ...g };
  const deco = { ...createBoard({ name: 'Déco' }), ...g };
  const copains = { ...createBoard({ name: 'Ailleurs' }), groupId: 'copains', shared: true };
  const all = () => [raclette, vin, courses, compte, deco, copains];

  // La liste attend le sondage : on saura quel vin acheter.
  courses = linkTo(courses, vin.id, 'after');
  // Le compte va avec la liste, dit depuis le compte.
  compte = linkTo(compte, courses.id, 'with');

  assert.deepEqual(relationsOf(courses, all()).map((r) => [r.document.id, r.kind]),
    [[vin.id, 'waits'], [compte.id, 'with']], 'un lien se voit des deux côtés, qui que ce soit qui le tienne');
  assert.deepEqual(relationsOf(vin, all()).map((r) => [r.document.id, r.kind]), [[courses.id, 'unblocks']]);
  assert.equal(relationsOf(compte, all())[0].holder, compte.id, 'on sait où écrire pour le défaire');

  assert.equal(isDone(vin), false);
  assert.deepEqual(waitingOn(courses, all()).map((d) => d.id), [vin.id], 'la liste attend le vin');
  vin = setClosed(vin, true);
  assert.equal(isDone(vin), true, 'un sondage clos est fait');
  assert.deepEqual(waitingOn(courses, all()), [], 'le sondage clos, plus rien n’attend');
  assert.equal(isDone(deco), null, 'un tableau d’idées n’a rien à finir');

  const avant = linkTargets(vin, all(), 'after').map((d) => d.id);
  assert.ok(!avant.includes(courses.id), 'déjà lié : pas deux fois');
  assert.ok(!avant.includes(vin.id) && !avant.includes(copains.id), 'ni soi-même, ni un autre groupe');
  assert.ok(avant.includes(raclette.id), 'même un événement se lie');
  // Le compte vient après la liste, qui vient après le vin : le vin ne peut venir après le compte.
  let compte2 = { ...createSpend({ name: 'Remboursements', names: ['Gui'] }), ...g };
  compte2 = linkTo(compte2, courses.id, 'after');
  const all2 = () => [...all(), compte2];
  assert.ok(!linkTargets(vin, all2(), 'after').some((d) => d.id === compte2.id), 'l’ordre ne tourne jamais en rond');
  assert.ok(linkTargets(vin, all2(), 'before').some((d) => d.id === compte2.id), 'mais il peut venir avant');
  assert.ok(linkTargets(vin, all2(), 'with').some((d) => d.id === compte2.id), 'ou aller avec');

  const defait = unlinkFrom(compte, courses.id);
  assert.deepEqual(defait.links, []);
  assert.ok(defait.updatedAt > compte.updatedAt, 'le plus récent l’emporte, comme pour un titre');
  assert.deepEqual(relationsOf(courses, [raclette, vin, courses, defait]).map((r) => r.document.id), [vin.id]);

  // Un lien vers ce qui a disparu ne se montre pas.
  assert.deepEqual(relationsOf(courses, [courses]), []);
  // Deux appareils : le dernier qui lie l’emporte à la fusion.
  const lie = linkTo(deco, raclette.id, 'with');
  assert.deepEqual(mergeBoards(deco, lie).links, [{ id: raclette.id, kind: 'with' }]);
});

test('dans l’arbre, les liens rangent : ce qui doit être fait avant vient d’abord', async () => {
  const { attach, linkTo, chainTree, stepOf } = await import('../src/dashboard.js');
  const { createEvent, createPoll } = await import('../src/polls.js');
  const { createSpend } = await import('../src/spends.js');
  const raclette = createEvent({ name: 'Raclette', date: '2026-10-10' });
  const vin = attach(createPoll({ question: 'Quel vin ?' }), raclette.id);
  // Sans lien, la liste passerait avant le sondage (ordre des onglets : sondage, liste…) ;
  // le compte attend la liste, qui attend le sondage.
  const courses = linkTo(attach(createList({ name: 'Courses' }), raclette.id), vin.id, 'after');
  const compte = linkTo(attach(createSpend({ name: 'Compte', names: ['Gui'] }), raclette.id), courses.id, 'after');
  const all = [compte, courses, raclette, vin];
  assert.deepEqual([vin, courses, compte].map((d) => stepOf(d, all)), [0, 1, 2]);
  assert.deepEqual(chainTree(vin, all).children.map((c) => c.document.id), [vin.id, courses.id, compte.id]);
  // « Vient avant », dit depuis l’autre côté, range pareil.
  const avant = linkTo(attach(createPoll({ question: 'Qui vient ?' }), raclette.id), vin.id, 'before');
  assert.equal(stepOf(vin, [...all, avant]), 1);
});
