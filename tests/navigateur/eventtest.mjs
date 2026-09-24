/**
 * Le sondage qui a retenu une date devient un événement : la liste de ce qu'on
 * apporte et le compte des dépenses s'y rattachent, entre les personnes dispo,
 * et chacun ramène à l'autre.
 */
import { chromium } from 'playwright';
import { createPoll, addOptions, setVote, setPollDate } from '../../src/polls.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });

let poll = addOptions(createPoll({ question: 'Quel week-end ?', names: ['Gui', 'Alice', 'Bob'] }), 'Le 12\nLe 19');
const [gui, alice, bob] = poll.people;
poll = setVote(poll, gui.id, poll.options[0].id, 'yes');
poll = setVote(poll, alice.id, poll.options[0].id, 'yes');
poll = setVote(poll, bob.id, poll.options[1].id, 'yes');
const undated = addOptions(createPoll({ question: 'Pas encore tranché', names: ['Gui'] }), 'un\ndeux');
poll = setPollDate({ ...poll, title: 'Annecy' }, '2026-10-12');

const seed = {
  'marque-points:prefs:v1': { me: 'Gui' },
  'marque-points:lists:v1': [],
  'marque-points:polls:v1': [poll, undated],
  'marque-points:games:v1': [],
  'marque-points:spends:v1': [],
};

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

const text = async (selector) => (await page.locator(selector).first().textContent() || '').replace(/\s+/g, ' ').trim();

/* ---- 1. sans date, pas d'événement ---------------------------------------- */

await page.goto(`http://localhost:8099/dist/marque-points.html#/poll/${undated.id}`);
await page.waitForSelector('#poll-day');
check('un sondage sans date ne propose rien', (await page.locator('#event-list, #event-spend').count()) === 0);

/* ---- 2. la date retenue : on prépare ------------------------------------- */

await page.goto(`http://localhost:8099/dist/marque-points.html#/poll/${poll.id}`);
await page.waitForSelector('#event-list');
check('l’événement propose une liste et un compte', (await page.locator('#event-list, #event-spend').count()) === 2);
check('et dit qui y sera', /dispo pour le 12 oct/.test(await page.locator('body').textContent()));

await page.click('#event-list');
await page.waitForSelector('#add-item, .list, h1');
check('la liste porte le nom de l’événement', (await text('h1')) === 'Annecy', await text('h1'));
const listPeople = await page.locator('body').textContent();
check('avec les personnes dispo', /Gui/.test(listPeople) && /Alice/.test(listPeople) && !/Bob/.test(listPeople));
check('et ramène à l’événement', /Annecy — .*12 oct/.test(await text(`[data-goto="#/poll/${poll.id}"]`)), await text(`[data-goto="#/poll/${poll.id}"]`));

await page.click(`[data-goto="#/poll/${poll.id}"]`);
await page.waitForSelector('#event-spend');
check('revenu au sondage, la liste y est', (await page.locator('.section .game-card[data-goto^="#/list/"]').count()) === 1);
check('et il ne reste que le compte à ouvrir', (await page.locator('#event-list').count()) === 0);

await page.click('#event-spend');
await page.waitForSelector('#add-spend');
check('le compte aussi ramène à l’événement', (await page.locator(`[data-goto="#/poll/${poll.id}"]`).count()) === 1);

await page.click(`[data-goto="#/poll/${poll.id}"]`);
await page.waitForSelector('#poll-day');
check('l’événement montre la liste et le compte',
  (await page.locator('.section .game-card[data-goto^="#/list/"]').count()) === 1 &&
    (await page.locator('.section .game-card[data-goto^="#/spend/"]').count()) === 1);
check('et plus rien à préparer', (await page.locator('#event-list, #event-spend').count()) === 0);

/* ---- 3. ça tient au rechargement ---------------------------------------- */

await page.reload();
await page.waitForSelector('#poll-day');
check('après rechargement, toujours rattachés', (await page.locator('.section .game-card').count()) >= 2);

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
