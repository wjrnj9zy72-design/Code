/**
 * L'appui long, au doigt : sur une carte, sur chaque élément du plan de la
 * chaîne — celui de la page où l'on est compris —, sur une ligne de l'Accueil.
 * Un vrai toucher (événements tactiles), pas une souris.
 */
import { chromium } from 'playwright';
import { createEvent, createPoll, addOptions } from '../../src/polls.js';
import { createList, addItems } from '../../src/lists.js';
import { attach } from '../../src/dashboard.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const g = { groupId: 'grp_famille', shared: true };
const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const raclette = { ...createEvent({ name: 'Raclette', names: ['Gui'], date: day }), ...g };
const courses = attach({ ...addItems(createList({ name: 'Courses', names: ['Gui'] }), 'Pain'), ...g }, raclette.id);
const vin = attach({ ...addOptions(createPoll({ question: 'Quel vin ?', names: ['Gui'] }), 'Rouge'), ...g }, courses.id);

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] },
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
  'marque-points:polls:v1': [raclette, vin], 'marque-points:lists:v1': [courses],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((data) => {
  if (localStorage.getItem('marque-points:prefs:v1')) return;
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);

/** Hold a finger on an element for `ms`, then lift it. */
async function hold(locator, ms = 700, end = 'touchEnd') {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const point = { x: box.x + Math.min(30, box.width / 2), y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
  await page.waitForTimeout(150);
}
const menuFor = async () => ((await page.locator('dialog[open] h2').first().textContent().catch(() => '')) || '').trim();
const closeMenu = async () => {
  if (await page.locator('dialog[open] [data-menu-cancel]').count()) await page.click('dialog[open] [data-menu-cancel]');
};

await page.goto(`${B}#/poll/${vin.id}`);
await page.waitForSelector('#view .chain-map');
const hash = () => page.evaluate(() => location.hash);

for (const [name, selector] of [
  ['l’événement, en haut du plan', `#view .chain-map [data-goto="#/poll/${raclette.id}"]`],
  ['la liste, au milieu du plan', `#view .chain-map [data-goto="#/list/${courses.id}"]`],
  ['la page où l’on est, marquée « ici »', '#view .chain-map [aria-current="page"]'],
]) {
  await hold(page.locator(selector).first());
  const title = await menuFor();
  check(`appui long sur ${name} : son menu`, Boolean(title), `hash=${await hash()}`);
  check(`… sans changer de page (${name})`, (await hash()) === `#/poll/${vin.id}`, await hash());
  await closeMenu();
}

await page.goto(`${B}#/lists`);
await page.waitForSelector(`[data-goto="#/list/${courses.id}"]`);
await hold(page.locator(`[data-goto="#/list/${courses.id}"]`).first());
check('appui long sur une carte d’onglet : son menu', /Courses/.test(await menuFor()));
await closeMenu();

await page.goto(`${B}#/lists`);
await page.waitForSelector(`[data-goto="#/list/${courses.id}"]`);
await page.locator(`[data-goto="#/list/${courses.id}"]`).first().tap();
await page.waitForFunction((id) => location.hash === `#/list/${id}`, courses.id);
check('un toucher bref ouvre toujours la page', true);

/* --- supprimer depuis l'arbre, au doigt, du premier coup ------------------- */

await page.goto(`${B}#/poll/${vin.id}`);
await page.waitForSelector('#view .chain-map');
// Comme sur iPhone : l'appui long finit en toucher annulé, et l'on touche
// « Supprimer » aussitôt.
await hold(page.locator(`#view .chain-map [data-goto="#/list/${courses.id}"]`).first(), 700, 'touchCancel');
await page.waitForSelector('dialog[open] [data-menu-delete]');
{
  // Un toucher brut, tout de suite : sans attendre que le bouton « accepte ».
  const box = await page.locator('dialog[open] [data-menu-delete]').boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
await page.waitForSelector('.dialog--ask [data-answer="yes"]', { timeout: 1500 }).catch(() => {});
const asked = await page.locator('.dialog--ask [data-answer="yes"]').count();
check('Supprimer demande confirmation du premier coup', asked === 1, `dialogs=${await page.locator('dialog[open]').count()}`);
if (asked) await page.locator('.dialog--ask [data-answer="yes"]').tap();
await page.waitForTimeout(600);
const left = await page.evaluate((id) => JSON.parse(localStorage.getItem('marque-points:lists:v1') || '[]').some((d) => d.id === id), courses.id);
check('confirmé : supprimé du premier coup', !left);
check('et l’arbre ne le montre plus', (await page.locator(`#view .chain-map [data-goto="#/list/${courses.id}"]`).count()) === 0);

/* --- supprimer la page où l'on est, déjà dans la base --------------------- */

const autre = { ...addItems(createList({ name: 'Bricolage', names: ['Gui'] }), 'Vis'), ...g, parent: raclette.id };
await page.evaluate((doc) => {
  const lists = JSON.parse(localStorage.getItem('marque-points:lists:v1') || '[]');
  localStorage.setItem('marque-points:lists:v1', JSON.stringify([...lists, doc]));
}, autre);
await page.goto(`${B}#/list/${autre.id}`);
await page.reload();
await page.waitForSelector('#new-line');
await page.fill('#new-line', 'Clous');
await page.press('#new-line', 'Enter');
await page.waitForTimeout(1500);
await hold(page.locator('#view .chain-map [aria-current="page"]').first());
await page.waitForSelector('dialog[open] [data-menu-delete]');
await page.waitForTimeout(400);
await page.locator('dialog[open] [data-menu-delete]').tap();
await page.waitForSelector('.dialog--ask [data-answer="yes"]');
await page.locator('.dialog--ask [data-answer="yes"]').tap();
await page.waitForTimeout(7000);
const revenu = await page.evaluate((id) => JSON.parse(localStorage.getItem('marque-points:lists:v1') || '[]').some((d) => d.id === id), autre.id);
check('supprimer la page où l’on est : elle ne revient pas de la base', !revenu, await page.evaluate(() => location.hash));
check('et l’on quitte sa page', !(await page.evaluate(() => location.hash)).includes(autre.id), await page.evaluate(() => location.hash));

check('au doigt, pas de « ⋯ »', await page.evaluate(() => [...document.querySelectorAll('.press-more')].every((n) => getComputedStyle(n).display === 'none')));

/* --- à la souris : ce qui est invisible au doigt se voit ------------------ */

const bureau = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
const souris = await bureau.newPage();
souris.on('pageerror', (e) => errors.push(String(e.message)));
await souris.addInitScript((data) => {
  if (localStorage.getItem('marque-points:prefs:v1')) return;
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);
await souris.goto(`${B}#/poll/${raclette.id}`);
await souris.waitForSelector('#event-parts');
const icone = await souris.locator('#theme-toggle svg').boundingBox();
check('l’icône du thème se voit (dessinée, pas une police)', icone && icone.width >= 16 && icone.height >= 16, JSON.stringify(icone));
const plus = souris.locator('#event-parts .game-card .press-more').first();
check('chaque carte a son « ⋯ »', await plus.isVisible());
await plus.click();
await souris.waitForSelector('dialog[open] [data-menu-delete]');
check('« ⋯ » ouvre le menu, sans ouvrir la page', (await souris.evaluate(() => location.hash)) === `#/poll/${raclette.id}`);
await souris.click('dialog[open] [data-menu-cancel]');
check('les éléments de l’arbre aussi', await souris.locator('#view .chain-map .press-more').first().isVisible());
await bureau.close();

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
