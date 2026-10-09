import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attach, attachTargets, isActivity, topEventOf, eventDays, programmeOf, outsideEvent, eventParts, upcomingEvents,
  partsCount,
} from '../src/dashboard.js';
import {
  activityFor, ideaActivities, choiceActivities, whenPoll, markForActivity, activitiesOnClose, activityFromChoice, activityVotes,
} from '../src/flows.js';
import {
  createEvent, createPoll, addOptions, setVote, setClosed, dayOfChoice, setPollDate, setOptionDay, optionsByDay, tally, mergePolls,
} from '../src/polls.js';
import { createList } from '../src/lists.js';
import { createBoard, addCard, editCardText } from '../src/ideas.js';

const g = { groupId: 'mifa', shared: true };
const weekend = () => ({ ...createEvent({ name: 'Annecy', names: ['Gui', 'Alice', 'Paul'], date: '2026-10-09', until: '2026-10-11' }), ...g });

test('une activité : un événement dans un événement, un seul niveau', () => {
  const annecy = weekend();
  const raclette = { ...createEvent({ name: 'Raclette', date: '2026-10-20' }), ...g };
  let rando = { ...createEvent({ name: 'Rando', date: '2026-10-10', at: '10:00' }), ...g };
  const courses = attach({ ...createList({ name: 'Courses' }), ...g }, annecy.id);
  const all = () => [annecy, raclette, rando, courses];

  assert.deepEqual(attachTargets(rando, all()).map((d) => d.id).sort(), [annecy.id, raclette.id].sort(),
    'un événement ne va que sous un autre événement');
  rando = attach(rando, annecy.id);
  assert.equal(isActivity(rando, all()), true);
  assert.equal(isActivity(annecy, all()), false);
  assert.deepEqual(attachTargets(raclette, all()).map((d) => d.id), [annecy.id], 'pas sous une activité');
  assert.deepEqual(attachTargets(annecy, all()), [], 'un événement qui a des activités reste en haut');
  const liste = attach({ ...createList({ name: 'Matériel' }), ...g }, rando.id);
  assert.equal(topEventOf(liste, [...all(), liste]).id, annecy.id, 'au-dessus de l’activité, l’événement');

  assert.deepEqual(upcomingEvents([annecy, rando, raclette], '2026-10-01').map((p) => p.id), [annecy.id, raclette.id],
    'une activité ne s’ajoute pas aux événements à venir');
  const parts = eventParts(annecy, { polls: [annecy, rando, raclette], lists: [courses, liste] });
  assert.deepEqual(parts.activities.map((d) => d.id), [rando.id]);
  assert.deepEqual(parts.polls, [], 'une activité n’est pas un sondage de l’événement');
  assert.equal(partsCount(parts), 3);
});

test('le programme : par jour et par heure, ce qui est à caler à la fin', () => {
  const annecy = weekend();
  const a = activityFor(annecy, { name: 'Marché', date: '2026-10-10', at: '09:00' });
  const b = activityFor(annecy, { name: 'Lac' });
  const c = activityFor(annecy, { name: 'Resto', date: '2026-10-09', at: '20:00' });
  const d = activityFor(annecy, { name: 'Rando', date: '2026-10-10', at: '14:00' });
  assert.deepEqual(programmeOf(annecy, [annecy, a, b, c, d]).map((x) => x.title), ['Resto', 'Marché', 'Rando', 'Lac']);
  assert.deepEqual(a.people.map((p) => p.name), ['Gui', 'Alice', 'Paul'], 'ceux qui viennent, par défaut');
  assert.equal(a.groupId, 'mifa');
  assert.deepEqual(eventDays(annecy), ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.equal(outsideEvent(a, annecy), false);
  assert.equal(outsideEvent({ ...a, date: '2026-10-12' }, annecy), true);
  assert.equal(outsideEvent(b, annecy), false, 'à caler n’est pas hors de l’événement');
});

test('des idées et d’un sondage clos, des activités ; « quand ? » parmi les jours de l’événement', () => {
  const annecy = weekend();
  let board = attach({ ...createBoard({ name: 'Que faire ?' }), ...g }, annecy.id);
  const made = addCard(board, 'note');
  board = editCardText(made.board, made.cardId, 'Paddle');
  let offer = ideaActivities(board, [annecy, board]);
  assert.equal(offer.event.id, annecy.id);
  assert.deepEqual(offer.ideas.map((i) => [i.text, i.made]), [['Paddle', false]]);
  const paddle = activityFor(offer.event, { name: 'Paddle', from: { doc: board.id, part: made.cardId } });
  offer = ideaActivities(board, [annecy, board, paddle]);
  assert.equal(offer.ideas[0].made, true, 'pas deux fois');
  assert.equal(ideaActivities({ ...board, parent: null }, [annecy]).event, null, 'hors de tout événement, rien');

  let quoi = attach({ ...addOptions(createPoll({ question: 'Quelle activité ?', names: ['Gui'] }), 'Karaoké\nBowling'), ...g }, annecy.id);
  assert.deepEqual(choiceActivities(quoi, [annecy, quoi]).choices, [], 'ouvert, rien');
  quoi = setClosed(setVote(quoi, quoi.people[0].id, quoi.options[0].id, 'yes'), true);
  assert.deepEqual(choiceActivities(quoi, [annecy, quoi]).choices, [], 'sans l’étiquette 🎯, un sondage ne propose rien');
  quoi = markForActivity(quoi, true);
  assert.deepEqual(choiceActivities(quoi, [annecy, quoi]).choices.map((c) => c.option.text), ['Karaoké']);

  const lac = activityFor(annecy, { name: 'Lac' });
  const quand = whenPoll(lac, annecy, { question: 'Quand, le lac ?' });
  assert.equal(quand.whenFor, lac.id);
  assert.equal(quand.parent, lac.id);
  assert.equal(quand.options.length, 3);
  assert.deepEqual(quand.options.map((o) => dayOfChoice(o.text, new Date('2026-10-01'))?.date),
    ['2026-10-09', '2026-10-10', '2026-10-11'], 'chaque choix se relit comme son jour');
  assert.deepEqual(choiceActivities(setClosed(quand, true), [annecy, lac, quand]).choices, [], 'un « quand ? » ne crée pas d’activité');
  assert.equal(setPollDate(lac, '2026-10-10').date, '2026-10-10');
});

test('dans l’arbre, les activités se rangent comme au programme', async () => {
  const { chainTree } = await import('../src/dashboard.js');
  const annecy = weekend();
  const lac = activityFor(annecy, { name: 'Lac' });
  const resto = activityFor(annecy, { name: 'Resto', date: '2026-10-09', at: '20:00' });
  const rando = activityFor(annecy, { name: 'Rando', date: '2026-10-10', at: '10:00' });
  const karaoke = activityFor(annecy, { name: 'Karaoké', date: '2026-10-09' });
  const tree = chainTree(annecy, [annecy, lac, resto, rando, karaoke]);
  assert.deepEqual(tree.children.map((c) => c.document.title), ['Karaoké', 'Resto', 'Rando', 'Lac']);
});

test('l’étiquette 🎯 : clos avec un gagnant net, le sondage devient une activité', () => {
  const annecy = weekend();
  let quoi = markForActivity(attach({ ...addOptions(createPoll({ question: 'Quoi samedi ?', names: ['Gui', 'Alice', 'Paul'] }), 'Karaoké\nBowling'), ...g }, annecy.id));
  const [gui, alice, paul] = quoi.people;
  const [karaoke, bowling] = quoi.options;
  assert.deepEqual(activityVotes(annecy, [annecy, quoi]).map((p) => p.id), [quoi.id], 'en vote, au programme');
  quoi = setVote(setVote(quoi, gui.id, karaoke.id, 'yes'), alice.id, karaoke.id, 'yes');
  quoi = setVote(quoi, paul.id, bowling.id, 'yes');
  assert.deepEqual(activitiesOnClose(quoi, [annecy, quoi]), [], 'ouvert, rien');
  quoi = setClosed(quoi, true);
  assert.deepEqual(activityVotes(annecy, [annecy, quoi]), [], 'clos, il n’est plus en vote');
  const [made, ...more] = activitiesOnClose(quoi, [annecy, quoi]);
  assert.equal(more.length, 0);
  assert.equal(made.title, 'Karaoké');
  assert.equal(made.parent, annecy.id);
  assert.deepEqual(made.people.map((p) => p.name), ['Gui', 'Alice'], 'avec ceux qui l’ont voulu');
  assert.deepEqual(made.from, { doc: quoi.id, part: karaoke.id });
  assert.deepEqual(activitiesOnClose(quoi, [annecy, quoi, made]), [], 'jamais deux fois');

  let egal = markForActivity(attach({ ...addOptions(createPoll({ question: 'Et dimanche ?', names: ['Gui', 'Alice'] }), 'Lac\nMarché'), ...g }, annecy.id));
  egal = setClosed(setVote(setVote(egal, egal.people[0].id, egal.options[0].id, 'yes'), egal.people[1].id, egal.options[1].id, 'yes'), true);
  assert.deepEqual(activitiesOnClose(egal, [annecy, egal]), [], 'une égalité ne crée rien d’office');
  assert.equal(choiceActivities(egal, [annecy, egal]).choices.length, 2, 'les deux restent proposés');
  assert.deepEqual(activityFromChoice(annecy, egal, egal.options[1]).people.map((p) => p.name), ['Alice']);
});

test('des choix calés chacun sur un jour : un gagnant par jour, à son jour', () => {
  const annecy = weekend();
  let quoi = createPoll({ question: 'Quoi pendant le week-end ?', names: ['Gui', 'Alice', 'Paul'] });
  quoi = addOptions(quoi, 'Kayak\nRando', { day: '2026-10-10' });
  quoi = addOptions(quoi, 'Lac\nMarché', { day: '2026-10-11' });
  quoi = addOptions(quoi, 'Karaoké', { day: 'n’importe quand' });
  quoi = markForActivity(attach({ ...quoi, ...g }, annecy.id));
  const [kayak, rando, lac, marche, karaoke] = quoi.options;
  assert.equal(karaoke.day, undefined, 'un jour illisible n’est pas un jour');
  assert.deepEqual(optionsByDay(quoi).map((group) => [group.day, group.options.length]),
    [['2026-10-10', 2], ['2026-10-11', 2], [null, 1]], 'par jour, les choix sans jour à la fin');

  const [gui, alice, paul] = quoi.people;
  quoi = setVote(setVote(quoi, gui.id, kayak.id, 'yes'), alice.id, kayak.id, 'yes');
  quoi = setVote(quoi, paul.id, rando.id, 'yes');
  quoi = setVote(setVote(quoi, gui.id, lac.id, 'yes'), paul.id, marche.id, 'yes');
  assert.deepEqual(tally(quoi).leaders.sort(), [kayak.id, lac.id, marche.id].sort(),
    'le kayak mène le samedi, le lac et le marché sont à égalité le dimanche');

  quoi = setClosed(quoi, true);
  const made = activitiesOnClose(quoi, [annecy, quoi]);
  assert.equal(made.length, 1, 'l’égalité du dimanche ne crée rien d’office');
  assert.equal(made[0].title, 'Kayak');
  assert.equal(made[0].date, '2026-10-10', 'au jour de son choix');
  assert.deepEqual(made[0].people.map((p) => p.name), ['Gui', 'Alice']);
  assert.equal(activityFromChoice(annecy, quoi, lac).date, '2026-10-11');

  const moved = setOptionDay(quoi, rando.id, '2026-10-11');
  assert.equal(moved.options[1].day, '2026-10-11');
  assert.equal(setOptionDay(moved, rando.id, '2026-10-11'), moved, 'rien ne change, même objet');
  const loose = setOptionDay(moved, rando.id, null);
  assert.equal('day' in loose.options[1], false, 'décalé : plus de jour');
  assert.equal(mergePolls(quoi, loose).options[1].day, undefined, 'le jour suit la dernière écriture du choix');
});
