/**
 * La barre d'onglets en bas de l'écran, le « + » au milieu, et la page d'un
 * groupe : tout ce qui est en cours dans ce groupe, sur une seule page.
 */
import { chromium } from 'playwright';
import { createPoll, addOptions } from '../../src/polls.js';
import { createList, addItems } from '../../src/lists.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });

// Une liste et un sondage de Mifa, une liste des Copains : la page de Mifa
// montre les deux premiers, pas la troisième.
const mifaList = { ...addItems(createList({ name: 'Courses Mifa', names: ['Gui'] }), 'Pain'), groupId: 'grp_famille', shared: true };
const mifaPoll = { ...addOptions(createPoll({ question: 'Quel soir pour la raclette ?', names: ['Gui'] }), 'vendredi'), groupId: 'grp_famille', shared: true };
const copainsList = { ...addItems(createList({ name: 'Bières Copains', names: ['Gui'] }), 'Blonde'), groupId: 'grp_copains', shared: true };

const seed = {
  'marque-points:prefs:v1': {
    me: 'Gui',
    groups: [
      { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true },
      { id: 'grp_copains', name: 'Copains', key: 'la-cle-copains', admits: true },
    ],
  },
  'marque-points:polls:v1': [mifaPoll],
  'marque-points:lists:v1': [mifaList, copainsList],
  'marque-points:games:v1': [],
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function open(width, height) {
  const page = await (await browser.newContext({ viewport: { width, height }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data)) if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- la barre, en bas ----------------------------------------------------- */

const page = await open(390, 800);
const bar = await page.locator('#tabs').boundingBox();
check('la barre est collée en bas de l’écran', Math.abs(bar.y + bar.height - 800) < 2, JSON.stringify(bar));
check('sur une seule ligne', bar.height < 90, JSON.stringify(bar));
const tabs = (await page.locator('.tab').allTextContents()).map((s) => s.trim());
check('quatre onglets, deux de chaque côté du « + »',
  tabs.join(' / ') === 'Listes / Sondages / Parties / Agenda', tabs.join(' / '));
check('chacun a son icône', (await page.locator('.tab .tab__icon').count()) === 4);
check('le « + » est dans la barre', await page.locator('#tabs #create').isVisible());
const plus = await page.locator('#create').boundingBox();
check('le « + » est pile au milieu', Math.abs(plus.x + plus.width / 2 - 195) < 1, JSON.stringify(plus));
check('et à cheval sur le bord de la barre', plus.y < bar.y && plus.y + plus.height > bar.y, JSON.stringify(plus));
check('l’app s’ouvre sur l’aperçu, que le nom en haut signale',
  (await page.locator('.app-bar__brand[aria-current]').count()) === 1);

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(200);
const after = await page.locator('#tabs').boundingBox();
check('elle reste là quand on descend', Math.abs(after.y + after.height - 800) < 2, JSON.stringify(after));

// Le bas de la page n'est pas caché sous la barre.
const last = await page.evaluate(() => {
  const view = document.getElementById('view');
  const children = [...view.children].filter((node) => node.offsetHeight);
  return children.at(-1).getBoundingClientRect().bottom;
});
check('le bas de la page passe au-dessus de la barre', last <= after.y + 1, `${last} / ${after.y}`);

/* --- le « + » ------------------------------------------------------------- */

await page.click('#create');
await page.waitForSelector('dialog[open] [data-create]');
check('le « + » propose cinq créations', (await page.locator('dialog[open] [data-create]').count()) === 5);
check('sans groupe choisi, il n’en annonce aucun', (await page.locator('dialog[open] p.muted').count()) === 0);
await page.click('dialog[open] [data-create="#/polls/new"]');
await page.waitForSelector('#new-poll');
check('et mène au formulaire choisi', await page.locator('#new-poll').isVisible());
check('l’onglet Sondages s’allume',
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Sondages');

await page.click('#create');
await page.click('dialog[open] [data-create-close]');
check('Annuler ferme le menu', (await page.locator('dialog[open]').count()) === 0);

/* --- la page d'un groupe -------------------------------------------------- */

await page.click('.app-bar__brand');
await page.waitForSelector('.group-link');
check('chaque groupe de l’aperçu s’ouvre', (await page.locator('.group-link').count()) === 2);
await page.locator('.group-link', { hasText: 'Mifa' }).click();
await page.waitForSelector('h1');
check('la page porte le nom du groupe', (await page.locator('h1').textContent()).trim() === 'Mifa');
check('l’adresse est celle du groupe', page.url().endsWith('#/group/grp_famille'), page.url());
const text = await page.locator('#view').textContent();
check('on y voit la liste du groupe', text.includes('Courses Mifa'));
check('et son sondage', text.includes('Quel soir pour la raclette'));
check('pas ce qui est à un autre groupe', !text.includes('Bières Copains'));
check('le nom en haut reste allumé, aucun onglet',
  (await page.locator('.tab[aria-current]').count()) === 0
  && (await page.locator('.app-bar__brand[aria-current]').count()) === 1);

await page.click('#create');
await page.waitForSelector('dialog[open] [data-create]');
check('le « + » dit où ira la création',
  (await page.locator('dialog[open]').textContent()).includes('Mifa'));
await page.click('dialog[open] [data-create-close]');

// « Tout voir » ouvre l'onglet, réglé sur ce groupe.
await page.locator('.section', { hasText: 'Courses Mifa' }).locator('[data-tile-goto]').click();
await page.waitForSelector('.tab[data-tab="lists"][aria-current]');
const lists = await page.locator('#view').textContent();
check('« Tout voir » ouvre l’onglet sur ce groupe',
  lists.includes('Courses Mifa') && !lists.includes('Bières Copains'));
check('la pastille du groupe y est choisie',
  (await page.locator('.chip--on').textContent()).trim() === 'Mifa');

await page.goto('http://localhost:8099/dist/marque-points.html#/group/grp_inconnu');
await page.waitForTimeout(400);
check('un groupe inconnu ramène à l’aperçu', page.url().endsWith('#/'), page.url());

/* --- sur un petit écran --------------------------------------------------- */

const small = await open(320, 640);
const wide = await small.evaluate(() => document.documentElement.scrollWidth);
check('rien ne déborde sur 320 px', wide <= 320, String(wide));
const cut = await small.evaluate(() => [...document.querySelectorAll('.tab > span')]
  .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
check('aucun nom d’onglet n’est coupé', cut.length === 0, cut.join(', '));

/* --- un lien de sondage : pas de barre ------------------------------------ */

await small.goto(`http://localhost:8099/dist/marque-points.html#/poll/${mifaPoll.id}/solo`);
await small.waitForTimeout(500);
check('la vue d’un invité n’a ni barre ni « + »', !(await small.locator('#tabs').isVisible()));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
