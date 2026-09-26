/**
 * Les dépenses : qui a payé quoi, et qui doit combien à qui.
 *
 * Un compte — « Vacances », « Coloc », « Week-end à Lyon » — tient des
 * personnes et des lignes. Une ligne dit ce qui a été payé, combien, par qui,
 * et pour qui : le partage est égal entre les personnes concernées, parce que
 * c'est ainsi que ça se passe neuf fois sur dix, et que des parts à régler
 * avant de noter une baguette ferait abandonner l'app avant la fin des
 * vacances.
 *
 * L'argent est compté **en centimes, en entiers**. Un dixième d'euro n'existe
 * pas en binaire : 0,1 + 0,2 ne fait pas 0,3, et trois personnes qui se
 * partagent dix euros finiraient par ne pas tomber d'accord sur un centime —
 * entre deux téléphones, ce centime se verrait.
 *
 * Fusionné comme une liste : ligne par ligne, chacune avec son horloge, et des
 * pierres tombales pour les suppressions.
 */

import { uid } from './model.js';
import { later, touch, prune } from './stamp.js';
import { addPerson, renamePerson, removePerson } from './people.js';

/** Un compte neuf. `names` sont les personnes qu'il concerne. */
export function createSpend({ name = '', names = [], shared = false, groupId = null, currency = 'EUR' } = {}) {
  const now = Date.now();
  return {
    id: uid('d'),
    kind: 'spend',
    name: String(name).trim(),
    // One currency per account: a holiday abroad is counted in the money
    // spent there. Accounts from before it have none, and are in euros.
    currency: CURRENCIES.includes(currency) ? currency : 'EUR',
    createdAt: now,
    updatedAt: now,
    peopleAt: now,
    shared: Boolean(shared),
    groupId: groupId || null,
    archivedAt: null,
    removed: {},
    people: names
      .map((raw) => String(raw || '').trim())
      .filter(Boolean)
      .map((personName) => ({ id: uid('w'), name: personName })),
    lines: [],
  };
}

/** The currencies an account can be kept in. */
export const CURRENCIES = ['EUR', 'CHF', 'GBP', 'USD', 'CAD'];

/** The currency an account is kept in: euros, unless it says otherwise. */
export function spendCurrency(spend) {
  return CURRENCIES.includes(spend?.currency) ? spend.currency : 'EUR';
}

/**
 * Lire un montant tel qu'il se tape : « 12,50 », « 12.5 », « 12 », « 3 € ».
 * Rend des centimes, ou null quand ce n'est pas un montant.
 */
export function readAmount(raw) {
  const clean = String(raw ?? '')
    .replace(/[\s €$£]|chf/gi, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Des centimes, écrits comme le lecteur écrit l'argent. */
export function showAmount(cents, language = 'fr', currency = 'EUR') {
  const value = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency === 'EUR' ? '€' : currency}`;
  }
}

/**
 * Ajouter une dépense. `forWhom` vide veut dire « pour tout le monde » : c'est
 * le cas courant, et l'écrire à chaque fois serait une corvée.
 */
export function addSpend(spend, { text = '', amount = 0, by = null, forWhom = [], day = null } = {}) {
  const cents = Number.isInteger(amount) ? amount : readAmount(amount);
  if (!cents) return spend;

  const known = new Set(spend.people.map((person) => person.id));
  const line = {
    id: uid('s'),
    text: String(text || '').trim(),
    amount: cents,
    by: known.has(by) ? by : null,
    // Rangé dans l'ordre des personnes du compte : deux téléphones qui cochent
    // les mêmes personnes dans un ordre différent écrivent la même ligne.
    forWhom: spend.people.filter((person) => forWhom.includes(person.id)).map((person) => person.id),
    day: /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return touch(spend, { lines: [...spend.lines, line] });
}

/**
 * Noter un remboursement : `from` a rendu `amount` à `to`.
 *
 * C'est une ligne comme les autres — payée par `from`, pour `to` seul —, ce qui
 * suffit à remettre les soldes d'aplomb : `from` a mis de l'argent, `to` en a
 * reçu. Marquée `repay` pour qu'elle ne compte pas dans ce que le compte a
 * coûté, ni dans ce que chacun a avancé.
 */
export function addRepayment(spend, { from = null, to = null, amount = 0, day = null } = {}) {
  const cents = Number.isInteger(amount) ? amount : readAmount(amount);
  const known = new Set(spend.people.map((person) => person.id));
  if (!cents || !known.has(from) || !known.has(to) || from === to) return spend;
  const added = addSpend(spend, { amount: cents, by: from, forWhom: [to], day });
  const line = added.lines.at(-1);
  return { ...added, lines: [...added.lines.slice(0, -1), { ...line, repay: true }] };
}

/** Une ligne qui rend de l'argent plutôt qu'elle n'en dépense. */
export function isRepayment(line) {
  return Boolean(line?.repay);
}

function patchLine(spend, lineId, patch) {
  let changed = false;
  const lines = spend.lines.map((line) => {
    if (line.id !== lineId) return line;
    changed = true;
    return { ...line, ...patch, updatedAt: later(line.updatedAt) };
  });
  return changed ? touch(spend, { lines }) : spend;
}

export function editSpend(spend, lineId, { text, amount, by, forWhom, day } = {}) {
  const patch = {};
  if (text !== undefined) patch.text = String(text || '').trim();
  if (amount !== undefined) {
    const cents = Number.isInteger(amount) ? amount : readAmount(amount);
    if (cents) patch.amount = cents;
  }
  if (by !== undefined) {
    patch.by = spend.people.some((person) => person.id === by) ? by : null;
  }
  if (forWhom !== undefined) {
    patch.forWhom = spend.people.filter((person) => forWhom.includes(person.id)).map((person) => person.id);
  }
  if (day !== undefined) {
    patch.day = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : null;
  }
  return Object.keys(patch).length ? patchLine(spend, lineId, patch) : spend;
}

/** Retirer une ligne, et se souvenir de l'avoir retirée. */
export function removeSpend(spend, lineId) {
  const lines = spend.lines.filter((line) => line.id !== lineId);
  if (lines.length === spend.lines.length) return spend;
  return touch(spend, { lines, removed: { ...spend.removed, [lineId]: Date.now() } });
}

/** Ranger un compte soldé, ou le ressortir. */
export function archiveSpend(spend, yes = true) {
  const at = yes ? Date.now() : null;
  return at === (spend.archivedAt || null) ? spend : touch(spend, { archivedAt: at });
}

export const addSpendPerson = addPerson;
export const renameSpendPerson = renamePerson;

/**
 * Est-ce que ce compte tient encore debout sans cette personne ?
 *
 * Non si elle a avancé de l'argent : la somme des soldes ne ferait plus zéro,
 * et le remboursement calculé serait faux sans que rien ne le dise. Non non
 * plus si une ligne ne concerne qu'elle : « pour personne » se lit « pour tout
 * le monde », et le taxi qu'elle a pris seule deviendrait l'affaire de tous.
 *
 * Dans les deux cas, ses lignes se corrigent ou se retirent d'abord — un geste
 * de plus, mais un compte juste.
 */
export function canRemovePerson(spend, personId) {
  if (spend.lines.some((line) => line.by === personId)) return 'paid';
  if (spend.lines.some((line) => line.forWhom.length === 1 && line.forWhom[0] === personId)) return 'alone';
  return 'ok';
}

/**
 * Retirer quelqu'un du compte. Sans effet quand ses lignes l'en empêchent :
 * `canRemovePerson` dit pourquoi, et l'app le répète.
 */
export function removeSpendPerson(spend, personId) {
  if (canRemovePerson(spend, personId) !== 'ok') return spend;
  return removePerson(spend, personId, (current) => ({
    lines: current.lines.map((line) =>
      (line.forWhom.includes(personId)
        ? { ...line, forWhom: line.forWhom.filter((id) => id !== personId), updatedAt: later(line.updatedAt) }
        : line)),
  }));
}

/**
 * Répartir un montant en centimes entre n personnes, sans perdre de centime.
 *
 * Dix euros entre trois font 3,34 / 3,33 / 3,33 : le reste va aux premiers,
 * dans l'ordre des personnes du compte. Le calcul ne dépend que de la ligne,
 * donc deux téléphones tombent sur les mêmes parts.
 */
export function split(amount, count) {
  if (count <= 0) return [];
  const each = Math.floor(amount / count);
  const extra = amount - each * count;
  return Array.from({ length: count }, (_, index) => each + (index < extra ? 1 : 0));
}

/**
 * Ce que chacun a payé, ce qu'il devait, ce qu'il a rendu ou reçu, et la
 * différence.
 *
 * Positif : on lui doit. Négatif : il doit. La somme des soldes fait zéro, au
 * centime — c'est ce qui rend le remboursement calculable. Un remboursement
 * ne change ni `paid` ni `owed` (ce n'est pas une dépense) : il passe par
 * `sent` et `received`, et le solde en tient compte.
 */
export function balances(spend) {
  const paid = new Map(spend.people.map((person) => [person.id, 0]));
  const owed = new Map(spend.people.map((person) => [person.id, 0]));
  const sent = new Map(spend.people.map((person) => [person.id, 0]));
  const received = new Map(spend.people.map((person) => [person.id, 0]));

  for (const line of spend.lines) {
    if (isRepayment(line)) {
      const to = line.forWhom[0];
      // Sans l'une des deux personnes, il n'y a rien à rendre à personne.
      if (!sent.has(line.by) || !received.has(to) || line.by === to) continue;
      sent.set(line.by, sent.get(line.by) + line.amount);
      received.set(to, received.get(to) + line.amount);
      continue;
    }
    if (line.by && paid.has(line.by)) paid.set(line.by, paid.get(line.by) + line.amount);
    const concerned = line.forWhom.length
      ? line.forWhom.filter((id) => owed.has(id))
      : spend.people.map((person) => person.id);
    if (!concerned.length) continue;
    const parts = split(line.amount, concerned.length);
    concerned.forEach((id, index) => owed.set(id, owed.get(id) + parts[index]));
  }

  return spend.people.map((person) => ({
    id: person.id,
    name: person.name,
    paid: paid.get(person.id) || 0,
    owed: owed.get(person.id) || 0,
    sent: sent.get(person.id) || 0,
    received: received.get(person.id) || 0,
    balance: (paid.get(person.id) || 0) - (owed.get(person.id) || 0)
      + (sent.get(person.id) || 0) - (received.get(person.id) || 0),
  }));
}

/** Ce que le compte a coûté en tout — les remboursements n'y ajoutent rien. */
export function spendTotal(spend) {
  return spend.lines.reduce((sum, line) => sum + (isRepayment(line) ? 0 : line.amount), 0);
}

/**
 * Qui rembourse qui, en aussi peu de virements que possible.
 *
 * Le plus gros débiteur paie le plus gros créancier, et on recommence : ça ne
 * donne pas toujours le minimum théorique — le problème est NP-difficile — mais
 * ça donne au plus n−1 virements, ce qui est déjà bien moins que « chacun
 * rembourse chacun », et surtout ça se lit.
 */
export function settle(spend) {
  const owing = balances(spend)
    .filter((row) => row.balance !== 0)
    .map((row) => ({ ...row }));

  const debtors = owing.filter((row) => row.balance < 0).sort((a, b) => a.balance - b.balance);
  const creditors = owing.filter((row) => row.balance > 0).sort((a, b) => b.balance - a.balance);

  const moves = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(-debtors[d].balance, creditors[c].balance);
    if (amount > 0) {
      moves.push({ from: debtors[d].name, fromId: debtors[d].id, to: creditors[c].name, toId: creditors[c].id, amount });
      debtors[d].balance += amount;
      creditors[c].balance -= amount;
    }
    if (debtors[d].balance === 0) d += 1;
    if (creditors[c].balance === 0) c += 1;
  }
  return moves;
}

/** Fusionner deux copies du même compte : ligne à ligne, comme une liste. */
export function mergeSpends(a, b) {
  if (!isValidSpend(a)) return b;
  if (!isValidSpend(b)) return a;
  if (a.id !== b.id) return a;

  const [newer, older] = (a.updatedAt || 0) >= (b.updatedAt || 0) ? [a, b] : [b, a];
  const removed = prune({ ...older.removed, ...newer.removed });

  const byId = new Map();
  for (const line of [...older.lines, ...newer.lines]) {
    if (removed[line.id]) continue;
    const held = byId.get(line.id);
    if (!held || (line.updatedAt || 0) >= (held.updatedAt || 0)) byId.set(line.id, line);
  }

  const lines = [
    ...newer.lines.filter((line) => byId.has(line.id)).map((line) => byId.get(line.id)),
    ...older.lines.filter(
      (line) => byId.has(line.id) && !newer.lines.some((other) => other.id === line.id),
    ),
  ];

  const people = (newer.peopleAt || 0) >= (older.peopleAt || 0) ? newer.people : older.people;

  const sameLines =
    lines.length === newer.lines.length && lines.every((line, index) => line === newer.lines[index]);
  const sameRemoved = Object.keys(removed).length === Object.keys(newer.removed || {}).length;
  if (sameLines && sameRemoved && people === newer.people) return newer;

  return {
    ...newer,
    people,
    peopleAt: Math.max(newer.peopleAt || 0, older.peopleAt || 0),
    removed,
    lines,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

/** Lecture défensive de ce qui revient du stockage, d'un lien ou d'un fichier. */
export function isValidSpend(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.kind === 'spend' &&
      typeof value.id === 'string' &&
      Array.isArray(value.people) &&
      Array.isArray(value.lines) &&
      value.lines.every(
        (line) =>
          line &&
          typeof line.id === 'string' &&
          // Des centimes entiers, et rien d'autre. Un montant fractionnaire
          // entré par un import ou par la base ferait des parts fractionnaires,
          // des soldes qui ne font plus zéro et un remboursement d'un
          // demi-centime — tout ce que compter en entiers sert à éviter.
          Number.isInteger(line.amount) &&
          line.amount > 0 &&
          Array.isArray(line.forWhom),
      ),
  );
}
