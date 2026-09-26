import test from 'node:test';
import assert from 'node:assert/strict';

import {
  related, ideasFor, addIdea, pollFromIdeas, winnersOf, winnerOffers, addWinner, spentItems, spendFromLine,
  unblockedNow, missingGoers, addGoers,
} from '../src/flows.js';
import { linkTo, attach, parentId, relationsOf } from '../src/dashboard.js';
import { createList, addItems, assignItem, toggleItem, mergeLists } from '../src/lists.js';
import { createPoll, createEvent, addOptions, setVote, setClosed } from '../src/polls.js';
import { createSpend, balances } from '../src/spends.js';
import { createBoard, addCard, editCardText } from '../src/ideas.js';

const g = { groupId: 'mifa', shared: true };

function idees(names) {
  let board = { ...createBoard({ name: 'Menu' }), ...g };
  for (const text of names) {
    const made = addCard(board, 'note');
    board = editCardText(made.board, made.cardId, text);
  }
  return board;
}

test('des idées à la liste : une touche par idée, jamais deux fois', () => {
  const board = idees(['Raclette', '', 'Tarte\naux pommes']);
  let list = linkTo({ ...createList({ name: 'Courses' }), ...g }, board.id, 'with');
  assert.deepEqual(related(list, [list, board], 'board').map((d) => d.id), [board.id], 'le tableau lié se retrouve');
  const offers = ideasFor(list, board);
  assert.deepEqual(offers.map((o) => o.text).sort(), ['Raclette', 'Tarte — aux pommes'], 'les idées sans mots ne se proposent pas');
  list = addIdea(list, board, offers[0].card);
  assert.equal(list.items[0].text, offers[0].text);
  assert.equal(list.items.length, 1);
  assert.deepEqual(list.items[0].from, { doc: board.id, part: offers[0].card.id });
  assert.equal(ideasFor(list, board)[0].added, true);
  assert.equal(addIdea(list, board, offers[0].card), list, 'pas deux fois');
  // La marque survit à la fusion et au cochage.
  const coche = toggleItem(list, list.items[0].id);
  assert.deepEqual(mergeLists(list, coche).items[0].from, { doc: board.id, part: offers[0].card.id });
});

test('des idées au sondage, puis le choix du sondage à la liste', () => {
  const event = { ...createEvent({ name: 'Raclette', date: '2026-10-10' }), ...g };
  const board = attach(idees(['Rouge', 'Blanc', 'Rouge']), event.id);
  let poll = pollFromIdeas(board, { question: 'Quel vin ?', names: ['Gui', 'Alice'] });
  assert.deepEqual(poll.options.map((o) => o.text).sort(), ['Blanc', 'Rouge'], 'une idée en double, un seul choix');
  assert.equal(poll.question, 'Quel vin ?');
  assert.equal(parentId(poll), event.id, 'au même endroit de la chaîne que le tableau');
  assert.equal(poll.groupId, 'mifa');
  assert.equal(relationsOf(poll, [poll, board])[0].kind, 'waits', 'il vient après les idées');
  assert.equal(pollFromIdeas(board).question, 'Menu', 'sans question, le nom du tableau');

  const rouge = poll.options.find((o) => o.text === 'Rouge');
  const blanc = poll.options.find((o) => o.text === 'Blanc');
  const [gui, alice] = poll.people;
  poll = setVote(setVote(setVote(poll, gui.id, rouge.id, 'yes'), alice.id, rouge.id, 'yes'), alice.id, blanc.id, 'yes');
  assert.deepEqual(winnersOf(poll), [], 'ouvert, il n’a encore rien choisi');
  poll = setClosed(poll, true);
  assert.deepEqual(winnersOf(poll).map((o) => o.text), ['Rouge']);
  assert.deepEqual(winnersOf(event), [], 'un événement ne choisit rien à acheter');

  let list = { ...createList({ name: 'Courses' }), ...g };
  list = addWinner(list, poll, rouge);
  assert.equal(list.items[0].text, 'Rouge');
  assert.equal(winnerOffers(poll, list)[0].added, true);
  assert.equal(addWinner(list, poll, rouge), list, 'pas deux fois');
});

test('une ligne cochée devient une dépense, payée par qui l’avait', () => {
  let list = addItems({ ...createList({ name: 'Courses', names: ['Gui', 'Alice'] }), ...g }, 'Fromage\nPain');
  const alice = list.people.find((p) => p.name === 'Alice');
  list = assignItem(list, list.items[0].id, alice.id);
  let spend = { ...createSpend({ name: 'Compte', names: ['Gui'] }), ...g };

  spend = spendFromLine(spend, list, list.items[0], '24,50');
  assert.equal(spend.lines.length, 1);
  assert.equal(spend.lines[0].text, 'Fromage');
  assert.equal(spend.lines[0].amount, 2450);
  const payer = spend.people.find((p) => p.id === spend.lines[0].by);
  assert.equal(payer.name, 'Alice', 'Alice n’était pas dans le compte : elle y entre');
  assert.deepEqual([...spentItems(spend, list)], [list.items[0].id]);
  assert.equal(spendFromLine(spend, list, list.items[0], 10), spend, 'pas deux fois');
  assert.equal(spendFromLine(spend, list, list.items[1], 0), spend, 'sans montant, rien');
  const sans = spendFromLine(spend, list, list.items[1], 3, 'gui');
  assert.equal(sans.people.length, 2, 'le prénom se retrouve, casse ignorée');
  assert.equal(balances(sans).reduce((s, r) => s + r.balance, 0), 0);
});

test('ce qui vient d’être débloqué', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  let vin = { ...createPoll({ question: 'Quel vin ?' }), ...g };
  const board = { ...createBoard({ name: 'Déco' }), ...g };
  let list = linkTo({ ...addItems(createList({ name: 'Courses' }), 'Vin'), ...g }, vin.id, 'after');
  const deco = linkTo({ ...addItems(createList({ name: 'Déco' }), 'Ballons'), ...g }, board.id, 'after');
  const opts = { today: '2026-09-26', now };
  assert.deepEqual(unblockedNow([vin, list, board, deco], opts), [], 'le sondage est ouvert ; un tableau ne débloque rien');
  vin = { ...setClosed(vin, true), closedAt: now - 3600e3 };
  assert.deepEqual(unblockedNow([vin, list, board, deco], opts).map((u) => [u.document.id, u.by[0].id]), [[list.id, vin.id]]);
  assert.deepEqual(unblockedNow([{ ...vin, closedAt: now - 30 * 864e5, updatedAt: now - 30 * 864e5 }, list], opts), [], 'il y a longtemps : plus une nouvelle');
  list = toggleItem(list, list.items[0].id);
  assert.deepEqual(unblockedNow([vin, list], opts), [], 'fait, ce n’est plus à faire');
});

test('ceux qui viennent entrent dans les listes et les comptes de l’événement', () => {
  const event = { ...createEvent({ name: 'Raclette', names: ['Gui', 'Alice', 'Paul'], date: '2026-10-10' }), ...g };
  const list = attach({ ...createList({ name: 'Courses', names: ['gui'] }), ...g }, event.id);
  const spend = attach({ ...createSpend({ name: 'Compte', names: ['Gui', 'Alice', 'Paul', 'Zoé'] }), ...g }, event.id);
  const missing = missingGoers(event, [event, list, spend]);
  assert.deepEqual(missing.map((m) => [m.document.id, m.names]), [[list.id, ['Alice', 'Paul']]], 'le compte a tout le monde');
  const next = addGoers(list, missing[0].names);
  assert.deepEqual(next.people.map((p) => p.name), ['gui', 'Alice', 'Paul'], 'on ajoute, on ne retire personne');
  assert.deepEqual(missingGoers(event, [event, next, spend]), []);
});
