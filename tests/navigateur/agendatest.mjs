/**
 * Le sondage qui retient une date, le fichier .ics qu'il donne, et l'adresse
 * à laquelle les agendas s'abonnent.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createList, addItems, setItemDue } from '../../src/lists.js';
import { createPoll, addOptions } from '../../src/polls.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const MARKS = { lists: '#/lists/new', polls: '#/polls/new', games: '#/new' };

let courses = addItems(createList({ name: 'Courses', names: ['Gui'], groupId: 'grp_famille' }), 'Réserver le camion');
courses = setItemDue(courses, courses.items[0].id, '2026-10-02');

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] },
  'marque-points:lists:v1': [courses],
  'marque-points:polls:v1': [addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'], groupId: 'grp_famille' }), 'mardi\njeudi')],
  'marque-points:games:v1': [],
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR', acceptDownloads: true });
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
  // Lists, polls, games and accounts are kinds of the home page, not tabs.
  if (tab === 'agenda') await page.click('[data-tab="agenda"]');
  else {
    await page.click('[data-tab="home"]');
    await page.click(`.segmented--kinds [data-goto="#/${tab}"]`);
  }
  await page.waitForSelector(`[data-goto="${MARKS[tab]}"]`);
};

/* ---- 1. le sondage retient une date ------------------------------------- */

await openTab('polls');
await page.click('.game-card');
await page.waitForSelector('#poll-day');
check('le sondage propose de retenir une date', (await page.locator('#poll-day').count()) === 1);

await page.fill('#poll-day', '2026-09-24');
await page.fill('#poll-hour', '20:00');
await page.click('#poll-date-save');
await page.waitForSelector('.pill');

check('la date retenue s’affiche', /24 sept/.test(await page.locator('.card .pill').first().textContent()),
  (await page.locator('.card .pill').first().textContent()).trim());
check('l’heure aussi', /20:00/.test(await page.locator('.card .pill').first().textContent()));

await openTab('polls');
check('et la carte du sondage le dit',
  /retenu le 24 sept/.test(await page.locator('.game-card').first().textContent()),
  (await page.locator('.game-card').first().textContent()).replace(/\s+/g, ' ').trim());

/* ---- 2. le fichier .ics -------------------------------------------------- */

await page.click('.game-card');
await page.waitForSelector('#poll-ics');
const [downloaded] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#poll-ics'),
]);
const file = await downloaded.path();
const ics = await readFile(file, 'utf8');

check('le fichier s’appelle .ics', downloaded.suggestedFilename().endsWith('.ics'), downloaded.suggestedFilename());
check('c’est un calendrier', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'));
check('avec le jour retenu', ics.includes('DTSTART:20260924T200000'), (ics.match(/DTSTART.*/) || [''])[0]);
check('et le nom de l’événement pour titre, sans point d’interrogation',
  ics.includes('SUMMARY:Quel soir\r\n'), (ics.match(/SUMMARY.*/) || [''])[0]);
check('sans fuseau collé dessus', !ics.includes('T200000Z'));

/* ---- 3. la date s'enlève ------------------------------------------------- */

await page.fill('#poll-day', '');
await page.click('#poll-date-save');
await page.waitForFunction(() => !document.querySelector('#poll-ics'));
check('vider le jour enlève la date et le bouton', (await page.locator('#poll-ics').count()) === 0);

// et on la remet, pour la suite
await page.fill('#poll-day', '2026-09-24');
await page.click('#poll-date-save');
await page.waitForSelector('#poll-ics');

/* ---- 4. l'adresse de l'agenda -------------------------------------------- */

await page.click('[data-tab="groups"]');
await page.waitForSelector('[data-calendar]');
await page.click('[data-calendar]');
await page.waitForSelector('dialog[open] #export-text', { timeout: 15000 });
const url = await page.inputValue('#export-text');
check('l’adresse est servie par la fonction du projet',
  /^http:\/\/127\.0\.0\.1:8123\/functions\/v1\/agenda\/[0-9a-f]{32}\.ics$/.test(url), url);
check('le dialogue dit ce que l’adresse coûte',
  /pas à publier/.test(await page.locator('#export-hint').textContent()),
  (await page.locator('#export-hint').textContent()).slice(0, 60));
await page.click('#export-close');

// la redemander rend la même
await page.click('[data-calendar]');
await page.waitForSelector('dialog[open] #export-text', { timeout: 15000 });
check('la redemander rend la même adresse', (await page.inputValue('#export-text')) === url);
await page.click('#export-close');

/* ---- 5. couper l'adresse -------------------------------------------------- */

await page.click('[data-cut-calendar]');
await page.waitForSelector('dialog[open]');
check('couper demande confirmation, en disant ce que ça arrête',
  /cessent de recevoir/.test(await page.locator('dialog[open]').textContent()));
await page.locator('dialog[open] button', { hasText: 'Couper l’adresse' }).first().click();
await page.waitForSelector('.banner', { timeout: 15000 });
check('et le dit une fois fait', /coupée/.test(await page.locator('.banner').first().textContent()),
  (await page.locator('.banner').first().textContent()).trim());

await page.click('[data-calendar]');
await page.waitForSelector('dialog[open] #export-text', { timeout: 15000 });
check('la suivante n’a rien à voir avec l’ancienne', (await page.inputValue('#export-text')) !== url);

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
