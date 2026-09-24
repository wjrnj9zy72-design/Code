/**
 * Le tableau de bord : le résumé par groupe sur l'Aperçu, les pastilles qui
 * filtrent les trois onglets, et la page d'une personne.
 */
import { chromium } from 'playwright';
import { createList, addItems, assignItem, toggleItem } from '../../src/lists.js';
import { createPoll, addOptions, setVote } from '../../src/polls.js';
import { createGame, addRound, setFinished } from '../../src/model.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
/** Un onglet n'est ouvert que lorsque sa propre page est à l'écran. */
const MARKS = { lists: '#/lists/new', polls: '#/polls/new', games: '#/new' };

/* ---- ce que l'appareil tient déjà -------------------------------------- */

const MIFA = 'g-mifa';
const COPAINS = 'g-copains';

function coursesList() {
  let list = addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'], groupId: MIFA }), 'Pain\nLait\nŒufs');
  const alice = list.people.find((p) => p.name === 'Alice');
  list = assignItem(list, list.items[0].id, alice.id);
  list = assignItem(list, list.items[1].id, alice.id);
  return toggleItem(list, list.items[0].id);
}

function vacancesList() {
  return addItems(createList({ name: 'Vacances', names: ['Gui'], groupId: MIFA }), 'Réserver');
}

function aperoList() {
  return addItems(createList({ name: 'Apéro mardi', names: ['Karim'], groupId: COPAINS }), 'Chips\nGlaçons');
}

function quelSoirPoll() {
  let poll = addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'], groupId: MIFA }), 'mardi\njeudi');
  const gui = poll.people.find((p) => p.name === 'Gui');
  return setVote(poll, gui.id, poll.options[0].id, 'yes');
}

function papayooGame() {
  let game = createGame({ presetId: 'papayoo', names: ['Gui', 'Alice'], groupId: COPAINS });
  game = addRound(game, { scores: { [game.players[0].id]: 200, [game.players[1].id]: 50 } });
  return setFinished(game, true);
}

function skyjoGame() {
  let game = createGame({ presetId: 'skyjo', names: ['Gui', 'Karim'], groupId: COPAINS });
  return addRound(game, { scores: { [game.players[0].id]: 12, [game.players[1].id]: 30 } });
}

const seed = {
  'marque-points:prefs:v1': {
    me: 'Gui',
    groups: [
      { id: MIFA, name: 'Mifa', key: 'k-mifa', admits: true },
      { id: COPAINS, name: 'Copains du mardi', key: 'k-copains', admits: false },
    ],
  },
  'marque-points:lists:v1': [coursesList(), vacancesList(), aperoList()],
  'marque-points:polls:v1': [quelSoirPoll()],
  'marque-points:games:v1': [papayooGame(), skyjoGame()],
};

/* ---- le navigateur ------------------------------------------------------ */

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

// Semé une seule fois : ce script tourne aussi à chaque rechargement, et les
// réglages changés en cours de route doivent survivre.
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

/* ---- 1. l'Aperçu, groupe par groupe ------------------------------------ */

const boards = page.locator('.card', { has: page.locator('.tiles') });
check('un bloc par groupe sur l’Aperçu', (await boards.count()) === 2, `${await boards.count()}`);

const mifaBoard = page.locator('.card', { hasText: 'Mifa' }).filter({ has: page.locator('.tiles') }).first();
const mifaNumbers = await mifaBoard.locator('.tile__value').allTextContents();
check('Mifa : 2 listes, 1 sondage, 0 partie, 0 compte', mifaNumbers.join(',') === '2,1,0,0', mifaNumbers.join(','));

const copainsBoard = page.locator('.card', { hasText: 'Copains du mardi' }).filter({ has: page.locator('.tiles') }).first();
const copainsNumbers = await copainsBoard.locator('.tile__value').allTextContents();
check('Copains : 1 liste, 0 sondage, 1 partie en cours', copainsNumbers.join(',') === '1,0,1,0', copainsNumbers.join(','));

check('le groupe dont on tient la porte est signalé',
  (await mifaBoard.locator('.pill').textContent()).includes('porte'),
  await mifaBoard.locator('.pill').textContent());
check('l’autre se dit simplement membre',
  (await copainsBoard.textContent()).includes('membre'));

/* ---- 2. qui fait quoi --------------------------------------------------- */

const who = page.locator('.section', { hasText: 'Qui fait quoi' }).first();
const rows = await who.locator('.game-card__title').allTextContents();
check('tout le monde est listé une fois, moi d’abord',
  rows.map((r) => r.trim()).join(' | ') === 'Gui (vous) | Alice | Karim',
  rows.map((r) => r.trim()).join(' | '));

const aliceRow = who.locator('.game-card', { hasText: 'Alice' }).first();
const aliceLine = (await aliceRow.locator('.game-card__meta').textContent()).trim();
check('ce qui attend Alice est résumé sur sa ligne',
  /1 ligne\(s\) à faire/.test(aliceLine) && /1 vote\(s\) en attente/.test(aliceLine), aliceLine);

const guiLine = (await who.locator('.game-card', { hasText: 'Gui' }).first().locator('.game-card__meta').textContent()).trim();
check('et rien pour qui n’a rien en attente', guiLine === 'rien en attente', guiLine);

/* ---- 3. une case de chiffre ouvre l'onglet, déjà filtré ----------------- */

await mifaBoard.locator('.tile').first().click();
await page.waitForSelector('.chip');
check('on est bien dans Listes', (await page.evaluate(() => location.hash)) === '#/lists',
  await page.evaluate(() => location.hash));

const onChip = await page.locator('.chip--on').textContent();
check('la pastille du groupe choisi est allumée', onChip.trim() === 'Mifa', onChip.trim());

let cards = await page.locator('.game-card__title').allTextContents();
check('seules les listes de Mifa sont là',
  cards.some((c) => c.includes('Courses')) && cards.some((c) => c.includes('Vacances')) && !cards.some((c) => c.includes('Apéro')),
  cards.map((c) => c.trim()).join(' | '));

const countLine = (await page.locator('.chip').first().locator('xpath=../following-sibling::p[1]').textContent()).trim();
check('la ligne sous les pastilles compte ce qui est à l’écran',
  countLine === '2 liste(s) · 1 sondage(s) · 0 partie(s)', countLine);

/* ---- 4. le filtre suit d'un onglet à l'autre ---------------------------- */

await openTab('polls');
check('le filtre tient dans Sondages',
  (await page.locator('.chip--on').textContent()).trim() === 'Mifa');
check('et le sondage de Mifa y est',
  (await page.locator('.game-card__title').first().textContent()).includes('Quel soir'));

await openTab('games');
const gameCards = await page.locator('.game-card__title').allTextContents();
check('dans Parties, Mifa n’en a aucune', gameCards.length === 0, gameCards.join(' | '));

await page.locator('.chip', { hasText: 'Copains du mardi' }).first().click();
await page.waitForFunction(() => document.querySelectorAll('.game-card').length > 0);
const copainsGames = await page.locator('.game-card__title').allTextContents();
check('en basculant sur Copains, ses deux parties apparaissent', copainsGames.length === 2, copainsGames.join(' | '));

await page.locator('.chip', { hasText: 'Tous' }).first().click();
await page.waitForSelector('.chip--on');
check('« Tous » remet tout', (await page.locator('.chip--on').textContent()).trim() === 'Tous');

/* ---- 5. la page d'une personne ------------------------------------------ */

await page.evaluate(() => { location.hash = '#/'; });
await page.waitForSelector('.game-card');
await page.locator('.section', { hasText: 'Qui fait quoi' }).locator('.game-card', { hasText: 'Alice' }).first().click();
await page.waitForSelector('.who');

check('l’adresse est celle d’une personne',
  (await page.evaluate(() => location.hash)) === '#/person/Alice', await page.evaluate(() => location.hash));
check('son prénom est le titre', (await page.locator('h1').textContent()).trim() === 'Alice');
check('et son initiale l’accompagne', (await page.locator('.who__mark').textContent()).trim() === 'A');
check('ses groupes sont nommés',
  (await page.locator('.who').textContent()).includes('Copains du mardi'),
  (await page.locator('.who').textContent()).replace(/\s+/g, ' ').trim());

const band = (await page.locator('.banner').first().textContent()).trim();
check('ce qui attend est en tête', /1 ligne\(s\) à faire · 1 vote\(s\) en attente/.test(band), band);

const tiles = await page.locator('.tile__value').allTextContents();
check('ses quatre chiffres : 1 partie, 1 victoire, 1 à faire, 1 vote',
  tiles.join(',') === '1,1,1,1', tiles.join(','));

const listRow = page.locator('.section', { hasText: 'Ses listes' }).locator('.entry').first();
check('sa liste dit combien de ses lignes sont faites',
  (await listRow.locator('.entry__value').textContent()).trim() === '1 / 2 faites',
  (await listRow.locator('.entry__value').textContent()).trim());

const voteRow = page.locator('.section', { hasText: 'Ses votes' }).locator('.entry').first();
check('son vote manquant est signalé en rouge',
  (await voteRow.locator('.entry__value').textContent()).trim() === 'n’a pas répondu'
    && (await voteRow.locator('.entry__value').getAttribute('class')).includes('--bad'));

const gameRow = page.locator('.section', { hasText: 'Ses parties' }).locator('.entry').first();
const gameValue = (await gameRow.locator('.entry__value').textContent()).trim();
check('sa partie gagnée le dit', gameValue === 'gagnée · 50 pts', gameValue);

await gameRow.click();
await page.waitForSelector('table.scores, .standings');
check('une ligne de sa page ouvre ce qu’elle nomme',
  (await page.evaluate(() => location.hash)).startsWith('#/game/'),
  await page.evaluate(() => location.hash));

/* ---- 6. un nom que personne ne porte ------------------------------------ */

await page.evaluate(() => { location.hash = '#/person/Zo%C3%A9'; });
await page.waitForSelector('h1');
check('un nom inconnu répond sans casser la page',
  (await page.locator('.view').textContent()).includes('Personne de ce nom')
    && (await page.locator('h1').textContent()).trim() === 'Zoé',
  (await page.locator('h1').textContent()).trim());

check('le prénom accentué revient tel quel',
  (await page.evaluate(() => location.hash)) === '#/person/Zo%C3%A9');

/* ---- 7. minuscules, accents : la même personne -------------------------- */

await page.evaluate(() => { location.hash = '#/personne/alice'; });
await page.waitForSelector('.who');
check('l’orthographe importe peu, et « personne » marche aussi',
  (await page.locator('h1').textContent()).trim() === 'Alice',
  (await page.locator('h1').textContent()).trim());

/* ---- 8. un seul groupe : pas de pastilles ------------------------------- */

await page.evaluate(() => {
  const prefs = JSON.parse(localStorage.getItem('marque-points:prefs:v1'));
  prefs.groups = prefs.groups.slice(0, 1);
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
});
await page.reload();
await page.waitForSelector('.app-bar');
await openTab('lists');
// What the dropped group held is now outside every group: « Autres » is the
// only other thing to choose, so Tous · Mifa · Autres, and nothing more.
check('avec un seul groupe, seulement Tous, lui, et Autres pour le reste',
  (await page.locator('[data-group-filter]').count()) === 3
    && (await page.locator('[data-group-filter="outside"]').count()) === 1,
  String(await page.locator('[data-group-filter]').count()));
const alone = await page.locator('.game-card__title').allTextContents();
check('et tout est montré', alone.length === 3, alone.map((a) => a.trim()).join(' | '));

/* ---- 9. le filtre d'un groupe qu'on a quitté ---------------------------- */

await page.evaluate(() => {
  const prefs = JSON.parse(localStorage.getItem('marque-points:prefs:v1'));
  prefs.groupFilter = 'g-parti';
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
});
await page.reload();
await page.waitForSelector('.app-bar');
await openTab('lists');
check('un filtre sur un groupe quitté ne cache rien',
  (await page.locator('.game-card').count()) === 3, `${await page.locator('.game-card').count()}`);

/* ---- fin ---------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
