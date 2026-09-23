/**
 * Les dates sur les lignes, l'archivage, les modèles, et « renommer partout »
 * étendu aux listes et aux sondages.
 */
import { chromium } from 'playwright';
import { createList, addItems, assignItem } from '../../src/lists.js';
import { createPoll, addOptions } from '../../src/polls.js';
import { createGame, addRound } from '../../src/model.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const MARKS = { lists: '#/lists/new', polls: '#/polls/new', games: '#/new' };

/* ---- ce que l'appareil tient ------------------------------------------- */

const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function courses() {
  let list = addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'], groupId: 'g-mifa' }), 'Pain\nLait\nŒufs');
  const alice = list.people.find((p) => p.name === 'Alice');
  list = assignItem(list, list.items[0].id, alice.id);
  return assignItem(list, list.items[1].id, alice.id);
}

function quelSoir() {
  return addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'], groupId: 'g-mifa' }), 'mardi\njeudi');
}

function papayoo() {
  const game = createGame({ presetId: 'papayoo', names: ['Gui', 'Alice'], groupId: 'g-mifa' });
  return addRound(game, { scores: { [game.players[0].id]: 200, [game.players[1].id]: 50 } });
}

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'g-mifa', name: 'Mifa', key: 'k', admits: true }] },
  'marque-points:lists:v1': [courses()],
  'marque-points:polls:v1': [quelSoir()],
  'marque-points:games:v1': [papayoo()],
};

/* ---- le navigateur ------------------------------------------------------ */

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.addInitScript((data) => {
  for (const [key, value] of Object.entries(data)) {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }
}, seed);
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.waitForSelector('.app-bar');

const openTab = async (tab) => {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForSelector(`[data-goto="${MARKS[tab]}"]`);
};

/* ---- 1. un jour se met sur une ligne ------------------------------------ */

await openTab('lists');
await page.click('.game-card');
await page.waitForSelector('.lines');

await page.click('[data-edit]');
await page.waitForSelector('dialog[open] #line-due');
check('la ligne se modifie et porte une date', (await page.locator('#line-due').count()) === 1);
await page.fill('#line-due', day(-2));
await page.click('#line-save');
await page.waitForSelector('.line__due');

check('la ligne affiche son jour', (await page.locator('.line__due').count()) === 1);
check('et le dit en retard quand il est passé',
  (await page.locator('.line__due--late').count()) === 1
  && /en retard/.test(await page.locator('.line__due').textContent()),
  (await page.locator('.line__due').textContent()).trim());

// une deuxième ligne, pour demain : à venir, pas en retard
const ids = await page.locator('[data-edit]').evaluateAll((nodes) => nodes.map((n) => n.dataset.edit));
await page.click(`[data-edit="${ids[1]}"]`);
await page.waitForSelector('dialog[open] #line-due');
await page.fill('#line-due', day(1));
await page.click('#line-save');
await page.waitForFunction(() => document.querySelectorAll('.line__due').length === 2);
check('un jour à venir ne compte pas comme un retard',
  (await page.locator('.line__due--late').count()) === 1);

// et la date s'enlève en vidant le champ
await page.click(`[data-edit="${ids[1]}"]`);
await page.waitForSelector('dialog[open] #line-due');
await page.fill('#line-due', '');
await page.click('#line-save');
await page.waitForFunction(() => document.querySelectorAll('.line__due').length === 1);
check('vider le champ enlève la date', (await page.locator('.line__due').count()) === 1);

/* ---- 2. le retard remonte partout -------------------------------------- */

await openTab('lists');
check('la carte de la liste compte le retard',
  /1 en retard/.test(await page.locator('.game-card').first().textContent()),
  (await page.locator('.game-card').first().textContent()).replace(/\s+/g, ' ').trim());

await page.click('[data-tab="overview"]');
await page.waitForSelector('.tiles');
check('le bloc du groupe aussi',
  /1 en retard/.test(await page.locator('.card', { has: page.locator('.tiles') }).first().textContent()));

const aliceRow = page.locator('.section', { hasText: 'Qui fait quoi' }).locator('.game-card', { hasText: 'Alice' }).first();
check('et la ligne d’Alice met le retard en premier',
  /^1 en retard · 2 ligne\(s\) à faire/.test((await aliceRow.locator('.game-card__meta').textContent()).trim()),
  (await aliceRow.locator('.game-card__meta').textContent()).trim());

await aliceRow.click();
await page.waitForSelector('.who');
const tiles = await page.locator('.tile__value').allTextContents();
check('sa page compte le retard à part', tiles.join(',') === '1,0,2,1', tiles.join(','));
check('et sa liste dit depuis quand',
  /en retard depuis/.test(await page.locator('.entry').first().textContent()),
  (await page.locator('.entry').first().textContent()).replace(/\s+/g, ' ').trim());

/* ---- 3. renommer partout, listes et sondages compris -------------------- */

await page.click('[data-rename-everywhere]');
await page.waitForSelector('#asked-text');
await page.fill('#asked-text', 'Alix');
await page.click('#asked-ok');
// L'adresse change avant que la page soit redessinée : attendre le titre.
await page.waitForFunction(() => document.querySelector('h1')?.textContent.trim() === 'Alix');
check('la page suit la personne renommée',
  (await page.evaluate(() => location.hash)) === '#/person/Alix',
  await page.evaluate(() => location.hash));
check('et le message compte les trois documents',
  /3 document\(s\)/.test(await page.locator('.banner').first().textContent()),
  (await page.locator('.banner').first().textContent()).trim());

await openTab('lists');
await page.click('.game-card');
await page.waitForSelector('.lines');
check('la liste porte le nouveau prénom',
  /Alix/.test(await page.locator('.chip').nth(2).textContent()),
  (await page.locator('.chip').nth(2).textContent()).trim());

await openTab('polls');
await page.click('.game-card');
await page.waitForSelector('.votes, table');
check('le sondage aussi', /Alix/.test(await page.locator('#view').textContent()));

/* ---- 4. archiver, et ressortir ------------------------------------------ */

await openTab('lists');
await page.click('.game-card');
await page.waitForSelector('#list-archive');
await page.click('#list-archive');
await page.waitForFunction(() => location.hash === '#/lists');
// Attendre l'onglet redessiné, pas seulement l'adresse changée : compter avant,
// c'était compter l'ancienne page — et réussir par chance.
await page.waitForSelector('[data-goto="#/lists/new"]');
// Où la liste est rangée, plutôt que « visible » : une <details> fermée cache ses
// cartes sans que offsetParent le dise, dans les Chromium récents.
const placed = await page.locator('.game-card').evaluateAll((cards) => cards.map((c) => (c.closest('details') ? 'archivées' : 'en cours')));
check('archiver renvoie à l’onglet, sans la liste parmi celles en cours', !placed.includes('en cours'), placed.join(', '));
check('elle est rangée dans les archivées', /archiv/i.test(await page.locator('details summary').last().textContent()));
check('et la liste attend dans l’archive',
  /1 archivé/.test(await page.locator('details.details').first().textContent()),
  (await page.locator('details.details').first().textContent()).replace(/\s+/g, ' ').trim().slice(0, 60));

await page.click('[data-tab="overview"]');
await page.waitForSelector('.tiles');
const numbers = await page.locator('.card', { has: page.locator('.tiles') }).first().locator('.tile__value').allTextContents();
check('ce qui est archivé ne compte plus nulle part', numbers.join(',') === '0,1,1,0', numbers.join(','));

await openTab('lists');
await page.click('details.details summary');
await page.click('details.details .game-card');
await page.waitForSelector('#list-archive');
await page.click('#list-archive');
await page.waitForFunction(() => location.hash === '#/list/' || location.hash.startsWith('#/list/'));
await openTab('lists');
check('et elle ressort entière',
  (await page.locator('.game-card').count()) === 1
  && /3\/3|1 sur 3|Courses/.test(await page.locator('.game-card').first().textContent()));

/* ---- 5. les modèles ------------------------------------------------------ */

await page.click('.game-card');
await page.waitForSelector('#list-template');
await page.click('#list-template');
await page.waitForSelector('.banner');
check('une liste se garde comme modèle',
  /modèle/.test(await page.locator('.banner').first().textContent()));

await openTab('lists');
check('le modèle quitte « En cours »',
  (await page.locator('.section', { hasText: 'En cours' }).locator('.game-card').count()) === 0);
check('et attend dans « Modèles »',
  (await page.locator('.section', { hasText: 'Modèles' }).locator('.game-card').count()) === 1);

await page.click('[data-goto="#/lists/new"]');
await page.waitForSelector('[data-from-template]');
check('l’écran de création propose de partir du modèle',
  /Courses/.test(await page.locator('[data-from-template]').textContent()));

await page.click('[data-from-template]');
await page.waitForSelector('.lines');
check('ce qui en sort a ses lignes, sans coche ni date',
  (await page.locator('.line').count()) === 3
  && (await page.locator('.line--done').count()) === 0
  && (await page.locator('.line__due').count()) === 0,
  `${await page.locator('.line').count()} lignes / ${await page.locator('.line__due').count()} dates`);
check('et c’est une liste, pas un autre modèle',
  (await page.locator('#list-template').textContent()).trim() === 'En faire un modèle',
  (await page.locator('#list-template').textContent()).trim());

/* ---- fin ---------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
