import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSpend, readAmount, showAmount, addSpend, editSpend, removeSpend, archiveSpend,
  addSpendPerson, removeSpendPerson, canRemovePerson, split, balances, spendTotal, settle, mergeSpends, isValidSpend,
} from '../src/spends.js';

/** Un week-end à trois : Gui paie le gîte, Alice les courses. */
function weekend() {
  const spend = createSpend({ name: 'Week-end', names: ['Gui', 'Alice', 'Bob'] });
  const [gui, alice] = spend.people;
  const withGite = addSpend(spend, { text: 'Gîte', amount: 30000, by: gui.id });
  return addSpend(withGite, { text: 'Courses', amount: 6000, by: alice.id });
}

const idOf = (spend, name) => spend.people.find((person) => person.name === name).id;

test('un compte est un nom, des personnes, et des lignes', () => {
  const spend = createSpend({ name: '  Vacances ', names: ['Gui', ' ', 'Alice'] });
  assert.equal(spend.name, 'Vacances');
  assert.equal(spend.kind, 'spend');
  assert.deepEqual(spend.people.map((p) => p.name), ['Gui', 'Alice']);
  assert.deepEqual(spend.lines, []);
  assert.equal(spend.shared, false);
  assert.ok(spend.id.startsWith('d_'));
});

test('un montant se tape comme il se dit', () => {
  assert.equal(readAmount('12,50'), 1250);
  assert.equal(readAmount('12.5'), 1250);
  assert.equal(readAmount('12'), 1200);
  assert.equal(readAmount(' 3 € '), 300);
  assert.equal(readAmount('0,99'), 99);
  assert.equal(readAmount(''), null);
  assert.equal(readAmount('0'), null, 'une dépense de rien n’est pas une dépense');
  assert.equal(readAmount('-5'), null);
  assert.equal(readAmount('deux euros'), null);
  assert.equal(readAmount('12,345'), null, 'il n’y a pas de dixième de centime');
});

test('les centimes restent des entiers, et ne dérivent pas', () => {
  // 0,1 + 0,2 ne fait pas 0,3 en binaire : c'est exactement ce qu'on évite.
  const spend = createSpend({ name: 'Bar', names: ['Gui', 'Alice'] });
  let held = addSpend(spend, { text: 'a', amount: '0,10', by: idOf(spend, 'Gui') });
  held = addSpend(held, { text: 'b', amount: '0,20', by: idOf(spend, 'Gui') });
  assert.equal(spendTotal(held), 30);
  assert.equal(showAmount(spendTotal(held), 'fr').replace(/ | /g, ' '), '0,30 €');
});

test('un partage ne perd pas de centime, et le perd toujours au même endroit', () => {
  assert.deepEqual(split(1000, 3), [334, 333, 333]);
  assert.deepEqual(split(1000, 4), [250, 250, 250, 250]);
  assert.deepEqual(split(1, 3), [1, 0, 0]);
  assert.deepEqual(split(100, 0), []);
  for (const [amount, count] of [[1000, 3], [9999, 7], [1, 2], [123456, 11]]) {
    assert.equal(split(amount, count).reduce((sum, part) => sum + part, 0), amount, `${amount}/${count}`);
  }
});

test('les soldes disent qui a payé pour les autres, et la somme fait zéro', () => {
  const rows = balances(weekend());
  const by = Object.fromEntries(rows.map((row) => [row.name, row]));

  assert.equal(by.Gui.paid, 30000);
  assert.equal(by.Alice.paid, 6000);
  assert.equal(by.Bob.paid, 0);
  assert.equal(by.Gui.owed, 12000, 'un tiers de 360 €');
  assert.equal(by.Gui.balance, 18000, 'on lui doit 180 €');
  assert.equal(by.Bob.balance, -12000);
  assert.equal(rows.reduce((sum, row) => sum + row.balance, 0), 0);
});

test('une dépense peut ne concerner qu’une partie du monde', () => {
  const spend = createSpend({ name: 'Soirée', names: ['Gui', 'Alice', 'Bob'] });
  const held = addSpend(spend, {
    text: 'Taxi', amount: 3000, by: idOf(spend, 'Gui'),
    forWhom: [idOf(spend, 'Gui'), idOf(spend, 'Alice')],
  });
  const by = Object.fromEntries(balances(held).map((row) => [row.name, row]));
  assert.equal(by.Bob.owed, 0, 'il n’était pas dans le taxi');
  assert.equal(by.Alice.balance, -1500);
  assert.equal(by.Gui.balance, 1500);
});

test('« pour tout le monde » suit les personnes du compte, même ajoutées après', () => {
  const spend = createSpend({ name: 'Coloc', names: ['Gui', 'Alice'] });
  const held = addSpend(spend, { text: 'Courses', amount: 1000, by: idOf(spend, 'Gui') });
  assert.deepEqual(held.lines[0].forWhom, [], 'rien d’écrit veut dire tout le monde');

  const withBob = addSpendPerson(held, 'Bob');
  const by = Object.fromEntries(balances(withBob).map((row) => [row.name, row]));
  assert.equal(by.Bob.owed, 333, 'et tout le monde, c’est tout le monde à cet instant');
  assert.equal(by.Gui.owed, 334, 'le centime qui reste va au premier, toujours le même');
  assert.equal(balances(withBob).reduce((sum, row) => sum + row.balance, 0), 0);
});

test('qui rembourse qui, en peu de virements et au centime', () => {
  const moves = settle(weekend());
  assert.equal(moves.length, 2, 'au plus une personne de moins qu’il n’y en a');
  assert.equal(moves.reduce((sum, move) => sum + move.amount, 0), 18000);
  assert.ok(moves.every((move) => move.to === 'Gui'), 'c’est lui qui a avancé');
  const fromBob = moves.find((move) => move.from === 'Bob');
  assert.equal(fromBob.amount, 12000);
  assert.equal(moves.find((move) => move.from === 'Alice').amount, 6000);
});

test('un compte équilibré ne demande aucun virement', () => {
  const spend = createSpend({ name: 'Quitte', names: ['Gui', 'Alice'] });
  let held = addSpend(spend, { text: 'a', amount: 1000, by: idOf(spend, 'Gui') });
  held = addSpend(held, { text: 'b', amount: 1000, by: idOf(spend, 'Alice') });
  assert.deepEqual(settle(held), []);
  assert.equal(spendTotal(held), 2000);
});

test('une ligne se corrige, et se retire pour de bon', () => {
  let spend = weekend();
  const line = spend.lines[0];
  spend = editSpend(spend, line.id, { amount: '250', text: 'Gîte (remise)' });
  assert.equal(spend.lines[0].amount, 25000);
  assert.equal(spend.lines[0].text, 'Gîte (remise)');
  assert.ok(spend.lines[0].updatedAt >= line.updatedAt);

  const short = removeSpend(spend, line.id);
  assert.equal(short.lines.length, 1);
  assert.ok(short.removed[line.id], 'sans quoi l’autre téléphone la rendrait');
  assert.equal(removeSpend(short, 'pas-une-ligne'), short);
});

test('on ne retire pas quelqu’un qui a avancé de l’argent', () => {
  const spend = weekend();
  assert.equal(canRemovePerson(spend, idOf(spend, 'Alice')), 'paid');
  assert.equal(removeSpendPerson(spend, idOf(spend, 'Alice')), spend,
    'sinon la somme des soldes cesserait de faire zéro, sans que rien ne le dise');

  // Ses lignes retirées, elle s'en va — et le compte tient toujours debout.
  const without = removeSpend(spend, spend.lines[1].id);
  assert.equal(canRemovePerson(without, idOf(spend, 'Alice')), 'ok');
  const short = removeSpendPerson(without, idOf(spend, 'Alice'));
  assert.equal(short.people.length, 2);
  assert.equal(spendTotal(short), 30000);
  assert.equal(balances(short).reduce((sum, row) => sum + row.balance, 0), 0);
});

test('ni quelqu’un qu’une ligne concerne tout seul', () => {
  const spend = createSpend({ name: 'Soirée', names: ['Gui', 'Alice'] });
  const held = addSpend(spend, {
    text: 'Taxi d’Alice', amount: 2000, by: idOf(spend, 'Gui'), forWhom: [idOf(spend, 'Alice')],
  });
  assert.equal(canRemovePerson(held, idOf(spend, 'Alice')), 'alone',
    '« pour personne » se lirait « pour tout le monde »');
  assert.equal(removeSpendPerson(held, idOf(spend, 'Alice')), held);
});

test('mais quelqu’un qui partageait une ligne s’en va, et la ligne se repartage', () => {
  const spend = createSpend({ name: 'Soirée', names: ['Gui', 'Alice', 'Bob'] });
  const held = addSpend(spend, {
    text: 'Taxi', amount: 3000, by: idOf(spend, 'Gui'),
    forWhom: [idOf(spend, 'Gui'), idOf(spend, 'Alice'), idOf(spend, 'Bob')],
  });
  const short = removeSpendPerson(held, idOf(spend, 'Bob'));
  assert.equal(short.people.length, 2);
  assert.deepEqual(short.lines[0].forWhom, [idOf(spend, 'Gui'), idOf(spend, 'Alice')]);
  const by = Object.fromEntries(balances(short).map((row) => [row.name, row]));
  assert.equal(by.Alice.balance, -1500, 'elle paie la moitié, et non plus le tiers');
  assert.equal(balances(short).reduce((sum, row) => sum + row.balance, 0), 0);
});

test('deux téléphones qui notent chacun une dépense les gardent toutes les deux', () => {
  const spend = weekend();
  const here = addSpend(spend, { text: 'Essence', amount: 5000, by: idOf(spend, 'Bob') });
  const there = addSpend({ ...spend, updatedAt: spend.updatedAt + 5 }, { text: 'Pain', amount: 300, by: idOf(spend, 'Alice') });

  const merged = mergeSpends(here, there);
  assert.equal(merged.lines.length, 4);
  assert.ok(merged.lines.some((line) => line.text === 'Essence'));
  assert.ok(merged.lines.some((line) => line.text === 'Pain'));
  assert.equal(spendTotal(merged), 41300);
});

test('une ligne retirée ici reste retirée quand l’autre copie arrive', () => {
  const spend = weekend();
  const gone = removeSpend(spend, spend.lines[0].id);
  const merged = mergeSpends(gone, spend);
  assert.equal(merged.lines.length, 1, 'la pierre tombale tient');
});

test('un compte se range et se ressort', () => {
  const spend = archiveSpend(weekend());
  assert.ok(spend.archivedAt);
  assert.equal(archiveSpend(spend, false).archivedAt, null);
  assert.equal(spendTotal(spend), 36000);
});

test('ce qui n’est pas un compte est refusé', () => {
  assert.equal(isValidSpend(weekend()), true);
  assert.equal(isValidSpend(null), false);
  assert.equal(isValidSpend({ kind: 'list', id: 'l_1', people: [], lines: [] }), false);
  assert.equal(isValidSpend({ kind: 'spend', id: 'd_1', people: [], lines: [{ id: 'x' }] }), false);
  assert.equal(isValidSpend({ kind: 'spend', id: 'd_1', people: [], lines: [] }), true);
});
