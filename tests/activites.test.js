import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attach, attachTargets, isActivity, topEventOf, eventDays, programmeOf, outsideEvent, eventParts, upcomingEvents,
  partsCount,
} from '../src/dashboard.js';
import { activityFor, ideaActivities, choiceActivities, whenPoll } from '../src/flows.js';
import { createEvent, createPoll, addOptions, setVote, setClosed, dayOfChoice, setPollDate } from '../src/polls.js';
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
