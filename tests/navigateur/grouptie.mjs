/**
 * Rattacher un document à un groupe : la chose qu'on ne savait pas faire.
 * Avec deux groupes, rien n'était rattaché tout seul, et rien ne le disait.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

const seed = {
  'marque-points:prefs:v1': {
    me: 'Gui',
    groups: [
      { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true },
      { id: 'grp_copains', name: 'Copains', key: 'la-cle-copains', admits: true },
    ],
  },
  'marque-points:polls:v1': [],
  'marque-points:lists:v1': [],
  'marque-points:games:v1': [],
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
};

const page = await (await browser.newContext({ viewport: { width: 430, height: 1000 }, locale: 'fr-FR' })).newPage();
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((d) => {
  for (const [k, v] of Object.entries(d)) if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v));
}, seed);
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.waitForSelector('.app-bar');

const newPoll = async (question) => {
  await page.click('.tab[data-tab="polls"]');
  await page.waitForSelector('[data-goto="#/polls/new"]');
  await page.click('[data-goto="#/polls/new"]');
  await page.waitForSelector('#new-poll');
  await page.fill('#poll-question', question);
  await page.fill('#poll-choices', 'vendredi\nsamedi');
  await page.fill('[data-person-index="0"]', 'Gui');
};

/* --- 1. sans groupe choisi : le formulaire le dit ------------------------- */
await newPoll('Quel soir pour la raclette ?');
const formText = (await page.locator('#new-poll').textContent()).replace(/\s+/g, ' ');
check('le formulaire dit où ça ira', /N’ira dans aucun groupe/.test(formText), formText.slice(-140));
check('et propose chaque groupe', (await page.locator('[data-new-group]').count()) === 4);
check('et ce que ça coûte', /les pastilles de groupe le masqueront/.test(formText));

await page.click('#new-poll button[type=submit]');
await page.waitForSelector('.votes', { timeout: 15000 });
const pageText = (await page.locator('#view').textContent()).replace(/\s+/g, ' ');
check('le sondage dit qu’il n’est dans aucun groupe', /Dans aucun groupe/.test(pageText), pageText.slice(0, 120));
check('et offre de l’y mettre', (await page.locator('[data-put-in-group]').count()) === 1);

/* --- 2. le bouton rattache ----------------------------------------------- */
await page.click('[data-put-in-group]');
await page.waitForSelector('dialog[open] [data-group]', { timeout: 15000 });
check('il demande lequel, puisqu’il y en a deux',
  (await page.locator('dialog[open] [data-group]').count()) === 2);
await page.locator('dialog[open] [data-group="grp_copains"]').click();
await page.waitForFunction(() => /Dans le groupe/.test(document.querySelector('#view').textContent), null, { timeout: 15000 });

const after = (await page.locator('#view').textContent()).replace(/\s+/g, ' ');
check('une fois mis, il dit lequel', /Dans le groupe Copains/.test(after), after.slice(0, 120));
check('et le bouton a disparu', (await page.locator('[data-put-in-group]').count()) === 0);
check('en stockage aussi', await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('marque-points:polls:v1'))[0];
  return p.groupId === 'grp_copains' && p.shared === true;
}));

/* --- 3. un groupe choisi : le suivant y va tout seul ---------------------- */
await page.click('.tab[data-tab="polls"]');
await page.waitForSelector('[data-group-filter="grp_famille"]');
await page.click('[data-group-filter="grp_famille"]');
await page.waitForTimeout(300);

await newPoll('Quel jour pour le ciné ?');
check('le formulaire suit la pastille',
  (await page.locator('[data-new-group="grp_famille"].chip--on').count()) === 1,
  (await page.locator('[data-new-group].chip--on').allTextContents()).join(' / '));
await page.click('#new-poll button[type=submit]');
await page.waitForSelector('.votes', { timeout: 15000 });
check('et le sondage naît dans ce groupe',
  /Dans le groupe Mifa/.test((await page.locator('#view').textContent()).replace(/\s+/g, ' ')));
check('sans bouton à presser', (await page.locator('[data-put-in-group]').count()) === 0);
check('et il n’est donc plus masqué par la pastille', await page.evaluate(() => {
  const polls = JSON.parse(localStorage.getItem('marque-points:polls:v1'));
  return polls.some((p) => p.groupId === 'grp_famille');
}));

/* --- 4. listes et parties aussi ------------------------------------------- */
await page.click('.tab[data-tab="lists"]');
await page.waitForSelector('[data-goto="#/lists/new"]');
await page.click('[data-goto="#/lists/new"]');
await page.waitForSelector('#new-list');
check('une liste suit la pastille elle aussi',
  (await page.locator('[data-new-group="grp_famille"].chip--on').count()) === 1,
  (await page.locator('[data-new-group].chip--on').allTextContents()).join(' / '));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
