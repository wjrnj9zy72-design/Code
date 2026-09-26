/**
 * L'événement au centre : il ouvre l'Accueil, sa page rassemble tout ce qui
 * est fait pour lui (listes, sondages, parties, comptes, idées), « Ajouter »
 * y range une chose de plus — dans son groupe, avec ceux qui viennent — et
 * chaque formulaire peut dire pour quel événement il crée.
 */
import { chromium } from 'playwright';
import { createEvent } from '../../src/polls.js';
import { createList, addItems } from '../../src/lists.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';

const dayIn = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const inMifa = { groupId: 'grp_famille', shared: true };
const raclette = { ...createEvent({ name: 'Raclette', names: ['Gui', 'Alice', 'Bob'], date: dayIn(5), at: '19:00' }), ...inMifa };
const plus = { ...createEvent({ name: 'Anniversaire', names: ['Gui'], date: dayIn(20) }) };
const apporter = { ...addItems(createList({ name: 'Raclette', names: ['Gui', 'Alice', 'Bob'] }), 'Fromage\nPatates'), ...inMifa, event: raclette.id };

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] },
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
  'marque-points:polls:v1': [raclette, plus],
  'marque-points:lists:v1': [apporter],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((data) => {
  if (localStorage.getItem('marque-points:prefs:v1')) return;
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);
const text = async (selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const polls = () => page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:polls:v1')));

/* --- 1. l'Accueil s'ouvre sur les événements ----------------------------- */

await page.goto(`${B}#/`);
await page.waitForSelector('.app-bar');
const first = page.locator('#view .section').first();
check('la première section de l’Accueil : les événements', /Événements/.test(await first.locator('h2').textContent()));
check('le plus proche d’abord', /Raclette/.test(await first.locator('.game-card').first().textContent()));
check('sa carte dit où en est ce qui s’y rattache', /Ce qu’on apporte : 0 sur 2/.test(await first.locator('.game-card').first().textContent()),
  await first.locator('.game-card').first().textContent());
check('et l’Accueil dit pour quel événement est la liste en cours',
  /Pour Raclette/.test(await text('#view')), (await text('#view')).slice(0, 300));

/* --- 2. la page de l'événement, et « Ajouter » ---------------------------- */

await first.locator('.game-card').first().click();
await page.waitForSelector('#event-parts');
check('la page dit le jour sous le titre', /19:00/.test(await text('.event-when')));
check('ce qui est fait pour l’événement vient avant le réglage de la date', await page.evaluate(() => {
  const parts = document.querySelector('#event-parts');
  const date = document.querySelector('#poll-day');
  return Boolean(parts && date && (parts.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING));
}));
check('la liste de l’événement y est', /Raclette/.test(await text('#event-parts .game-list')));

await page.click('#event-add');
await page.waitForSelector('dialog[open] [data-create]');
check('« Ajouter » propose tout sauf un autre événement',
  (await page.locator('dialog[open] [data-create]').count()) === 5
  && (await page.locator('dialog[open] [data-create="#/agenda/new"]').count()) === 0);
check('et dit à quel événement', /Raclette/.test(await text('dialog[open] h2')));
await page.click('dialog[open] [data-create="#/polls/new"]');
await page.waitForSelector('#poll-question');
check('le formulaire est déjà réglé sur l’événement', /Raclette/.test(await text('#view [data-new-event].chip--on')));
check('et sur son groupe', /Mifa/.test(await text('#view [data-new-group].chip--on')));
check('avec ceux qui viennent', (await page.inputValue('[data-person-index="2"]')) === 'Bob');
await page.fill('#poll-question', 'Quel vin ?');
await page.fill('#poll-choices', 'Rouge\nBlanc');
await page.click('#view form button[type=submit]');
await page.waitForFunction(() => /Quel vin/.test(document.querySelector('h1')?.textContent || ''));
const vin = (await polls()).find((p) => p.question === 'Quel vin ?');
check('le sondage est fait pour l’événement', vin?.event === raclette.id && vin?.groupId === 'grp_famille');
check('sa page ramène à l’événement', /Raclette/.test(await text('#view [data-goto^="#/poll/"]')));
await page.click(`#view [data-goto="#/poll/${raclette.id}"]`);
await page.waitForSelector('#event-parts');
check('l’événement le montre sous « Sondages »', /Sondages/.test(await text('#event-parts')) && /Quel vin/.test(await text('#event-parts')));

/* --- 3. le « + » d'en bas, sur un événement ------------------------------- */

await page.click('#create');
await page.waitForSelector('dialog[open] [data-create]');
check('le « + » sur un événement ajoute à l’événement', /Raclette/.test(await text('dialog[open] h2')));
await page.click('dialog[open] [data-create-plain]');
await page.waitForSelector('dialog[open] [data-create="#/agenda/new"]');
check('« Autre chose » rouvre le menu ordinaire', true);
await page.keyboard.press('Escape');

/* --- 4. un formulaire ordinaire choisit son événement --------------------- */

await page.goto(`${B}#/ideas/new`);
await page.waitForSelector('#new-board');
check('le formulaire propose les événements à venir',
  (await page.locator('#view [data-new-event]').allTextContents()).map((s) => s.trim().split(' · ')[0]).join(' / ') === 'Aucun / Raclette / Anniversaire',
  (await page.locator('#view [data-new-event]').allTextContents()).join(' / '));
check('sans en choisir un d’office', /Aucun/.test(await text('#view [data-new-event].chip--on')));
await page.locator('#view [data-new-event]', { hasText: 'Anniversaire' }).click();
check('choisir un événement gardé pour soi règle le groupe aussi',
  /Garder pour moi/.test(await text('#view [data-new-group].chip--on')), await text('#view [data-new-group].chip--on'));
await page.fill('#board-name', 'Cadeau');
await page.click('#new-board button[type=submit]');
await page.waitForSelector('#board-add-note');
const board = await page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:boards:v1')).find((b) => b.name === 'Cadeau'));
check('le tableau est fait pour cet événement, et gardé pour moi', board?.event === plus.id && !board?.groupId, JSON.stringify({ e: board?.event, g: board?.groupId }));

await page.goto(`${B}#/lists/new`);
await page.waitForSelector('#new-list');
check('le choix ne se garde pas d’un formulaire à l’autre', /Aucun/.test(await text('#view [data-new-event].chip--on')));

await page.goto(`${B}#/agenda/new`);
await page.waitForSelector('#new-event');
check('un événement ne se fait pas pour un autre événement', (await page.locator('#view [data-new-event]').count()) === 0);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
