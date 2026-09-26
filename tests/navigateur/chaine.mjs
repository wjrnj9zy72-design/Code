/**
 * La chaîne : tout élément se rattache à un autre, jusqu'à l'événement qui
 * reste au-dessus ; il se détache, pour se rattacher ailleurs. Depuis
 * l'événement, on rassemble ce qui existe déjà.
 */
import { chromium } from 'playwright';
import { createEvent, createPoll, addOptions } from '../../src/polls.js';
import { createList, addItems } from '../../src/lists.js';
import { createBoard } from '../../src/ideas.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const g = { groupId: 'grp_famille', shared: true };
const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const raclette = { ...createEvent({ name: 'Raclette', names: ['Gui', 'Alice'], date: day }), ...g };
const courses = { ...addItems(createList({ name: 'Courses', names: ['Gui'] }), 'Fromage'), ...g };
const vin = { ...addOptions(createPoll({ question: 'Quel vin ?', names: ['Gui'] }), 'Rouge\nBlanc'), ...g };
const ailleurs = { ...createBoard({ name: 'Chez les copains' }), groupId: 'grp_copains', shared: true };

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [
    { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true },
    { id: 'grp_copains', name: 'Copains', key: 'la-cle-copains', admits: true },
  ] },
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
  'marque-points:polls:v1': [raclette, vin], 'marque-points:lists:v1': [courses], 'marque-points:boards:v1': [ailleurs],
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
const stored = (key, id) => page.evaluate(([k, i]) => JSON.parse(localStorage.getItem(`marque-points:${k}:v1`)).find((d) => d.id === i), [key, id]);
const more = () => page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));

/* --- 1. depuis l'événement, rassembler ce qui existe --------------------- */

await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
await more();
check('un événement ne se rattache à rien', (await page.locator('#view [data-attach-doc]').count()) === 0);
await page.click('#event-parts [data-gather-doc]');
await page.waitForSelector('dialog[open] [data-gather]');
const offered = await page.locator('dialog[open] [data-gather]').allTextContents();
check('il propose la liste et le sondage du groupe', offered.some((s) => /Courses/.test(s)) && offered.some((s) => /Quel vin/.test(s)), offered.join(' | '));
check('mais rien d’un autre groupe', !offered.some((s) => /copains/.test(s)));
await page.locator('dialog[open] [data-gather]', { hasText: 'Courses' }).click();
await page.waitForFunction(() => /Courses/.test(document.querySelector('#event-parts')?.textContent || ''));
check('la liste est rattachée à l’événement', (await stored('lists', courses.id)).parent === raclette.id);

/* --- 2. un sondage sous la liste : la chaîne ----------------------------- */

await page.goto(`${B}#/poll/${vin.id}`);
await page.waitForSelector('#view h1');
await more();
await page.click('#view [data-attach-doc]');
await page.waitForSelector('dialog[open] [data-attach-to]');
check('on peut le rattacher à l’événement ou à la liste',
  (await page.locator('dialog[open] [data-attach-to]').count()) === 2, String(await page.locator('dialog[open] [data-attach-to]').count()));
await page.locator('dialog[open] [data-attach-to]', { hasText: 'Courses' }).click();
await page.waitForSelector('#view .chain');
check('sa page montre toute la chaîne, l’événement en tête', /Raclette.*›.*Courses/.test(await text('#view .chain')), await text('#view .chain'));
await page.click('#view .chain [data-goto^="#/list/"]');
await page.waitForSelector('.lines');
check('la liste montre ce qui lui est rattaché', /Rattaché ici/.test(await text('#view')) && /Quel vin/.test(await text('#view')));
await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
check('l’événement voit tout, même loin dans la chaîne', /Quel vin/.test(await text('#event-parts')));
check('et dit par où passe ce qui est loin', /Pour Courses/.test(await text('#event-parts')));

/* --- 3. la liste ne va pas sous son propre sondage ----------------------- */

await page.goto(`${B}#/list/${courses.id}`);
await page.waitForSelector('.lines');
await more();
await page.click('#view [data-attach-doc]');
await page.waitForSelector('dialog[open] [data-detach]');
const targets = await page.locator('dialog[open] [data-attach-to]').allTextContents();
check('pas sous ce qui est déjà en dessous d’elle', !targets.some((s) => /Quel vin/.test(s)), targets.join(' | '));
check('elle dit à quoi elle est rattachée', /Rattaché à : Raclette/.test(await text('dialog[open]')));

/* --- 4. détacher --------------------------------------------------------- */

await page.click('dialog[open] [data-detach]');
await page.waitForFunction(() => !document.querySelector('#view .chain'));
check('détachée : plus de chaîne sur sa page', true);
check('ni dans ce qui est gardé', (await stored('lists', courses.id)).parent === null);
check('son sondage lui reste rattaché', (await stored('polls', vin.id)).parent === courses.id);
await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
check('et l’événement ne les montre plus', !/Courses|Quel vin/.test(await text('#event-parts')));

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
