/**
 * Ce que les éléments liés font l'un pour l'autre : des idées à la liste, des
 * idées au sondage, du sondage clos à la liste, de la liste cochée au compte ;
 * ceux qui viennent à l'événement entrent dans ses listes ; l'Accueil dit ce
 * qui est débloqué. Et l'appui long, partout où un élément s'ouvre.
 */
import { chromium } from 'playwright';
import { createEvent, createPoll, addOptions, setVote, setClosed } from '../../src/polls.js';
import { createList, addItems } from '../../src/lists.js';
import { createSpend } from '../../src/spends.js';
import { createBoard, addCard, editCardText } from '../../src/ideas.js';
import { linkTo, attach } from '../../src/dashboard.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const g = { groupId: 'grp_famille', shared: true };
const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);

let menu = { ...createBoard({ name: 'Menu' }), ...g };
for (const text of ['Tartiflette', 'Fondue']) {
  const made = addCard(menu, 'note');
  menu = editCardText(made.board, made.cardId, text);
}
const raclette = { ...createEvent({ name: 'Raclette', names: ['Gui', 'Alice', 'Paul'], date: day }), ...g };
let vin = { ...addOptions(createPoll({ question: 'Quel vin ?', names: ['Gui', 'Alice'] }), 'Rouge\nBlanc'), ...g };
vin = setVote(setVote(vin, vin.people[0].id, vin.options[0].id, 'yes'), vin.people[1].id, vin.options[0].id, 'yes');
vin = setClosed(vin, true);
const courses = linkTo(linkTo(attach({ ...addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'] }), 'Pain'), ...g }, raclette.id), menu.id, 'with'), vin.id, 'after');
const compte = linkTo({ ...createSpend({ name: 'Compte', names: ['Gui'] }), ...g }, courses.id, 'with');

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] },
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
  'marque-points:polls:v1': [raclette, vin], 'marque-points:lists:v1': [courses],
  'marque-points:boards:v1': [menu], 'marque-points:spends:v1': [compte],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR', hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((data) => {
  if (localStorage.getItem('marque-points:prefs:v1')) return;
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);
const text = async (selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const stored = (key, id) => page.evaluate(([k, i]) => JSON.parse(localStorage.getItem(`marque-points:${k}:v1`)).find((d) => d.id === i), [key, id]);
const all = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`marque-points:${k}:v1`)), key);

/* --- 1. l'Accueil dit ce qui est débloqué -------------------------------- */

await page.goto(`${B}#/`);
await page.waitForSelector('#view h2');
check('l’Accueil annonce la liste débloquée par le sondage clos', /Débloqué.*Courses.*Fait : Quel vin/.test(await text('#view')), await text('#view'));

/* --- 2. sur la liste : les idées, le choix du sondage -------------------- */

await page.goto(`${B}#/list/${courses.id}`);
await page.waitForSelector('.flows');
check('la liste propose les idées du tableau lié', /Idées de « Menu ».*Tartiflette.*Fondue|Idées de « Menu ».*Fondue.*Tartiflette/.test(await text('.flows')), await text('.flows'));
check('et ce que le sondage a choisi', /Choisi dans « Quel vin[^»]*».*Rouge/.test(await text('.flows')), await text('.flows'));
check('pas ce qu’il n’a pas choisi', !/Blanc/.test(await text('.flows')));
await page.click('.flows [data-flow-idea]:has-text("Fondue")');
await page.waitForFunction(() => [...document.querySelectorAll('.lines li')].some((li) => /Fondue/.test(li.textContent)));
check('une touche : l’idée devient une ligne', (await stored('lists', courses.id)).items.some((i) => i.text === 'Fondue' && i.from?.doc === menu.id));
check('et n’est plus proposée', !/Fondue/.test(await text('.flows')));
await page.click('.flows [data-flow-winner]');
await page.waitForFunction(() => [...document.querySelectorAll('.lines li')].some((li) => /Rouge/.test(li.textContent)));
check('le choix du sondage devient une ligne', (await stored('lists', courses.id)).items.some((i) => i.text === 'Rouge' && i.from?.doc === vin.id));

/* --- 3. cocher, puis écrire dans le compte ------------------------------- */

const pain = (await stored('lists', courses.id)).items.find((i) => i.text === 'Pain');
await page.click(`[data-tick="${pain.id}"]`);
await page.waitForSelector('.flows [data-flow-spend]');
check('cochée, la ligne est proposée au compte lié', /Cochées, pas encore dans « Compte ».*Pain/.test(await text('.flows')));
await page.click('.flows [data-flow-spend]');
await page.waitForSelector('dialog[open] #flow-amount');
await page.fill('dialog[open] #flow-amount', '3,20');
await page.click('dialog[open] [data-flow-payer="Alice"]');
check('le montant reste quand on choisit qui a payé', (await page.inputValue('dialog[open] #flow-amount')) === '3,20');
await page.click('dialog[open] #flow-spend-ok');
await page.waitForFunction(() => !document.querySelector('.flows [data-flow-spend]'));
const spend = await stored('spends', compte.id);
check('la dépense est écrite, payée par Alice, entrée dans le compte',
  spend.lines.length === 1 && spend.lines[0].amount === 320 && spend.people.find((p) => p.id === spend.lines[0].by)?.name === 'Alice', JSON.stringify(spend.lines));

/* --- 4. faire voter les idées -------------------------------------------- */

await page.goto(`${B}#/idea/${menu.id}`);
await page.waitForSelector('[data-flow-vote]');
await page.click('[data-flow-vote]');
await page.waitForSelector('#asked-text');
await page.fill('#asked-text', 'Quel plat ?');
await page.click('#asked-ok');
await page.waitForFunction(() => /^#\/poll\//.test(location.hash));
const plat = (await all('polls')).find((p) => p.question === 'Quel plat ?');
check('un sondage dont les choix sont les idées', plat && plat.options.map((o) => o.text).sort().join() === 'Fondue,Tartiflette', JSON.stringify(plat?.options));
check('il vient après le tableau', JSON.stringify(plat?.links) === JSON.stringify([{ id: menu.id, kind: 'after' }]));
check('et j’en suis l’organisateur', Boolean((await page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')))).organiser?.[plat.id]));

/* --- 5. le sondage clos propose son choix à la liste --------------------- */

await page.goto(`${B}#/poll/${vin.id}`);
await page.waitForSelector('#view h1');
check('le sondage clos ne repropose pas ce qui est déjà dans la liste', (await page.locator('[data-flow-winner-to]').count()) === 0);

/* --- 6. l'événement : ceux qui viennent ---------------------------------- */

await page.goto(`${B}#/poll/${raclette.id}`);
await page.waitForSelector('#event-parts');
check('l’événement dit qui manque dans sa liste', /Paul : pas encore dans « Courses »/.test(await text('#event-parts')), await text('#event-parts'));
await page.click('[data-flow-people]');
await page.waitForFunction(() => !document.querySelector('[data-flow-people]'));
check('une touche : Paul entre dans la liste', (await stored('lists', courses.id)).people.some((p) => p.name === 'Paul'));

/* --- 7. l'appui long ----------------------------------------------------- */

await page.goto(`${B}#/lists`);
await page.waitForSelector(`[data-goto="#/list/${courses.id}"]`);
const card = page.locator(`[data-goto="#/list/${courses.id}"]`).first();
const box = await card.boundingBox();
await page.mouse.move(box.x + 30, box.y + 15);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForSelector('dialog[open] [data-menu-open]');
check('un appui long ouvre le menu de l’élément', /Courses/.test(await text('dialog[open] h2')));
check('sans ouvrir la page', (await page.evaluate(() => location.hash)) === '#/lists');
check('le menu propose rattacher, lier, ranger, supprimer',
  (await page.locator('dialog[open] [data-menu-attach], dialog[open] [data-menu-relate], dialog[open] [data-menu-archive], dialog[open] [data-menu-delete]').count()) === 4);
await page.click('dialog[open] [data-menu-archive]');
await page.waitForFunction((id) => JSON.parse(localStorage.getItem('marque-points:lists:v1')).find((d) => d.id === id).archivedAt, courses.id);
check('ranger depuis le menu', true);
await page.goto(`${B}#/`);
await page.waitForSelector('#view h2');
const ev = page.locator(`#view [data-goto="#/poll/${raclette.id}"]`).first();
await ev.click({ button: 'right' });
await page.waitForSelector('dialog[open] [data-menu-open]');
check('un clic droit fait de même, et un événement ne se rattache pas', (await page.locator('dialog[open] [data-menu-attach]').count()) === 0);
await page.click('dialog[open] [data-menu-open]');
await page.waitForSelector('#event-parts');
check('« Ouvrir » ouvre sa page', true);
await page.goto(`${B}#/lists`);
await page.waitForSelector('#view h1, #view h2');
check('un appui court ouvre toujours la page', true);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
