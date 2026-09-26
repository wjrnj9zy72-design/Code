/**
 * La chaîne : tout élément se rattache à un autre, jusqu'à l'événement qui
 * reste au-dessus ; il se détache, pour se rattacher ailleurs. Depuis
 * l'événement, on rassemble ce qui existe déjà. Et, au-delà de la chaîne,
 * des liens : ce qui va avec, ce qui attend quoi.
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
await page.waitForSelector('#view .chain-map');
check('en haut de sa page, le plan de toute la chaîne, l’événement en tête',
  /Raclette.*Courses.*Quel vin/.test(await text('#view .chain-map')), await text('#view .chain-map'));
check('la page où l’on est y est marquée', /Quel vin/.test(await text('#view .chain-map [aria-current="page"]')));
check('et chaque étage est rangé sous le sien', (await page.locator('#view .chain-map ul ul ul [aria-current="page"]').count()) === 1);
await page.click('#view .chain-map [data-goto^="#/list/"]');
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
await page.waitForFunction(() => !/Raclette/.test(document.querySelector('#view .chain-map')?.textContent || ''));
check('détachée : sa chaîne part d’elle, sans l’événement', /Courses.*Quel vin/.test(await text('#view .chain-map')));
check('ni dans ce qui est gardé', (await stored('lists', courses.id)).parent === null);
check('son sondage lui reste rattaché', (await stored('polls', vin.id)).parent === courses.id);
await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
check('et l’événement ne les montre plus', !/Courses|Quel vin/.test(await text('#event-parts')));

/* --- 5. les liens : au-delà de la chaîne -------------------------------- */

await page.goto(`${B}#/list/${courses.id}`);
await page.waitForSelector('.lines');
await more();
await page.click('#view [data-relate-doc]');
await page.waitForSelector('dialog[open] [data-relate-kind]');
await page.click('dialog[open] [data-relate-kind="after"]');
await page.waitForSelector('dialog[open] [data-relate-kind="after"][aria-pressed="true"]');
const liables = await page.locator('dialog[open] [data-relate-to]').allTextContents();
check('on peut lier la liste à ce qui est hors de sa chaîne, même l’événement',
  liables.some((s) => /Raclette/.test(s)) && !liables.some((s) => /copains/.test(s)), liables.join(' | '));
await page.locator('dialog[open] [data-relate-to]', { hasText: 'Raclette' }).click();
await page.waitForFunction(() => /Liens/.test(document.querySelector('#view .chain-map')?.textContent || ''));
check('le lien est gardé sur la liste', JSON.stringify((await stored('lists', courses.id)).links) === JSON.stringify([{ id: raclette.id, kind: 'after' }]));
check('le plan dit ce qu’elle attend', /Attend.*Raclette/.test(await text('#view .chain-map__links')), await text('#view .chain-map__links'));
check('et, dans l’arbre, la liste porte ⏳', (await page.locator('#view .chain-map__tree [aria-current="page"] .chain-map__wait').count()) === 1);
check('et que ce n’est pas encore fait', /pas encore fait/.test(await text('#view .chain-map__links')));
await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
check('l’événement voit ce qu’il débloque', /Débloque.*Courses/.test(await text('#view .chain-map__links')), await text('#view .chain-map'));
await more();
check('un événement se lie aussi', (await page.locator('#view [data-relate-doc]').count()) === 1);
await page.click('#view [data-relate-doc]');
await page.waitForSelector('dialog[open] [data-unrelate]');
await page.click('dialog[open] [data-unrelate]');
await page.waitForFunction(() => !document.querySelector('dialog[open] [data-unrelate]'));
check('défait depuis l’autre côté, le lien part de la liste', (await stored('lists', courses.id)).links.length === 0);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
