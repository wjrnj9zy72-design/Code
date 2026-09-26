/**
 * L'onglet Agenda : ce qui vient, jour par jour ; le passé, replié. Les comptes
 * sont passés sur l'Accueil, sous « Comptes ». Un événement se crée sans
 * sondage quand le jour est connu. Et la pastille « Autres » montre ce qui
 * n'est dans aucun groupe.
 */
import { chromium } from 'playwright';
import { createPoll, addOptions, setPollDate } from '../../src/polls.js';
import { createSpend } from '../../src/spends.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });

const pad = (n) => String(n).padStart(2, '0');
const dayIn = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const inGroup = { groupId: 'grp_famille', shared: true };
const soon = setPollDate({ ...addOptions(createPoll({ question: 'Raclette ?', names: ['Gui', 'Alice'] }), 'samedi'), ...inGroup, title: 'Raclette' }, dayIn(10));
const gone = setPollDate({ ...createPoll({ question: 'Pique-nique', names: ['Gui'] }), ...inGroup }, dayIn(-20));
const mine = addOptions(createPoll({ question: 'Quel film ?', names: ['Gui'] }), 'un\ndeux');
const coloc = { ...createSpend({ name: 'Coloc', names: ['Gui', 'Bob'] }), ...inGroup };

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] },
  'marque-points:lists:v1': [],
  'marque-points:polls:v1': [soon, gone, mine],
  'marque-points:games:v1': [],
  'marque-points:spends:v1': [coloc],
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
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
const text = async (selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();

/* ---- 1. l'onglet ---------------------------------------------------------- */

check('quatre onglets, dont l’Agenda', (await page.locator('.tab').count()) === 4
  && (await text('[data-tab="agenda"]')) === 'Agenda');

await page.click('[data-tab="agenda"]');
await page.waitForSelector('[data-goto="#/agenda/new"]');
const coming = page.locator('.section', { hasText: 'À venir' });
check('à venir : la raclette', /Raclette/.test(await coming.textContent()));
check('mais pas le pique-nique passé', !/Pique-nique/.test(await coming.textContent()));
check('le passé est replié à part', /Passés \(1\)/.test(await text('details')), await text('details'));
check('les comptes n’y sont plus', !/Coloc/.test(await page.textContent('#view')));

await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/spends"]');
await page.waitForSelector('[data-goto="#/spends/new"]');
check('le compte de la coloc est dans les comptes en cours, sur l’Accueil',
  /Coloc/.test(await page.locator('.section', { hasText: 'En cours' }).first().textContent()));
check('on ouvre toujours un compte seul', (await page.locator('[data-goto="#/spends/new"]').count()) === 1);
await page.click('[data-tab="agenda"]');
await page.waitForSelector('[data-goto="#/agenda/new"]');

/* ---- 2. un événement sans sondage ---------------------------------------- */

await page.click('[data-goto="#/agenda/new"]');
await page.waitForSelector('#new-event');
await page.fill('#event-name', 'Anniversaire de Léa');
await page.fill('#event-day', dayIn(5));
await page.fill('#event-hour', '19:30');
await page.fill('[data-person-index="1"]', 'Alice');
await page.click('#new-event [type="submit"]');
await page.waitForSelector('#event-list');
check('l’événement s’ouvre sur sa page', (await text('h1')) === 'Anniversaire de Léa', await text('h1'));
check('sans rien à voter', (await page.locator('.votes, #add-choice, #poll-close, [data-me]').count()) === 0);
check('avec qui vient', /Gui · Alice/.test(await text('#view')));
check('l’onglet Agenda est allumé', (await page.locator('[data-tab="agenda"][aria-current="page"]').count()) === 1);

await page.click('#event-spend');
await page.waitForSelector('#add-spend');
await page.click('[data-tab="agenda"]');
await page.waitForSelector('[data-goto="#/agenda/new"]');
const cards = await page.locator('.section', { hasText: 'À venir' }).locator('.game-card').allTextContents();
check('dans l’agenda, par date : l’anniversaire avant la raclette',
  cards.length === 2 && /Anniversaire/.test(cards[0]) && /Raclette/.test(cards[1]), cards.join(' | ').replace(/\s+/g, ' '));
check('avec son compte dessus', /0,00/.test(cards[0]));

await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/polls"]');
await page.waitForSelector('[data-goto="#/polls/new"]');
check('l’événement n’est pas un sondage', !/Anniversaire/.test(await text('#view')));

/* ---- 3. « Autres » -------------------------------------------------------- */

check('une pastille Autres à côté de Mifa', (await page.locator('[data-group-filter="outside"]').count()) === 1);
await page.click('[data-group-filter="outside"]');
await page.waitForTimeout(200);
const others = await text('#view');
check('Autres : le sondage hors groupe', /Quel film/.test(others));
check('et pas ceux de Mifa', !/Raclette/.test(others));
await page.click('[data-group-filter="grp_famille"]');
await page.waitForTimeout(200);
check('Mifa : l’inverse', /Raclette/.test(await text('#view')) && !/Quel film/.test(await text('#view')));

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
