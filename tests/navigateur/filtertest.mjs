/**
 * Un filtre de groupe qui vide un onglet doit le dire. Ce qui n'a été partagé
 * dans aucun groupe n'appartient à aucun groupe : n'importe quel filtre le
 * cache, et l'onglet disait « aucun sondage » alors qu'il y en avait.
 */
import { chromium } from 'playwright';
import { createPoll, addOptions } from '../../src/polls.js';
import { createList, addItems, setItemDue } from '../../src/lists.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });

const today = new Date();
const day = (o) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// un sondage gardé pour soi : aucun groupe, une date retenue
const alone = { ...addOptions(createPoll({ question: 'Quel soir pour la raclette ?', names: ['Gui'] }), 'vendredi'), date: day(3) };
// une liste datée, elle aussi sans groupe
let courses = addItems(createList({ name: 'Courses', names: ['Gui'] }), 'Réserver le camion');
courses = setItemDue(courses, courses.items[0].id, day(5));

const seed = {
  'marque-points:prefs:v1': {
    me: 'Gui',
    // Deux groupes : les pastilles s'affichent, et l'un d'eux est déjà choisi.
    groups: [
      { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true },
      { id: 'grp_copains', name: 'Copains', key: 'la-cle-copains', admits: true },
    ],
    groupFilter: 'grp_famille',
  },
  'marque-points:polls:v1': [alone],
  'marque-points:lists:v1': [courses],
  'marque-points:games:v1': [],
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 430, height: 1000 }, locale: 'fr-FR' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((data) => {
  for (const [k, v] of Object.entries(data)) if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v));
}, seed);
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.waitForSelector('.app-bar');

/* --- l'onglet Sondages ---------------------------------------------------- */
await page.click('.tab[data-tab="polls"]');
await page.waitForSelector('[data-goto="#/polls/new"]');
check('le filtre vide bien l’onglet', (await page.locator('.game-card').count()) === 0);
const pollsText = (await page.locator('#view').textContent()).replace(/\s+/g, ' ');
check('mais l’onglet ne prétend plus qu’il n’y a rien', /1 autre\(s\) sont masqué\(s\)/.test(pollsText),
  (pollsText.match(/[^.]*masqué[^.]*\./) || ['rien'])[0]);
check('et dit que c’est le partage qui manque', /partagé dans aucun groupe/.test(pollsText));

// et le bouton remet tout
await page.locator('[data-group-filter=""]').last().click();
await page.waitForTimeout(400);
check('« Tous » ramène le sondage', (await page.locator('.game-card').count()) === 1,
  String(await page.locator('.game-card').count()));

/* --- « Ce qui vient » ------------------------------------------------------ */
await page.evaluate(() => {
  const prefs = JSON.parse(localStorage.getItem('marque-points:prefs:v1'));
  prefs.groupFilter = 'grp_famille';
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
});
await page.reload();
await page.waitForSelector('.app-bar');
await page.click('[data-tab="overview"]');
await page.waitForSelector('[data-calendar]');
const coming = page.locator('.section').filter({ hasText: 'Ce qui vient' }).first();
const comingText = (await coming.textContent()).replace(/\s+/g, ' ');
check('« Ce qui vient » dit aussi ce qu’il cache', /autre\(s\) sont masqué\(s\)/.test(comingText), comingText.slice(0, 140));

await coming.locator('[data-group-filter=""]').first().click();
await page.waitForTimeout(400);
const back = (await page.locator('.section').filter({ hasText: 'Ce qui vient' }).first().textContent()).replace(/\s+/g, ' ');
check('et le bouton ramène les deux', /Raclette/.test(back) && /Réserver le camion/.test(back), back.slice(0, 160));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
