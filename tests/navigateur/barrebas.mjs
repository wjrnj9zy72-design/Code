/**
 * La barre d'onglets en bas de l'écran — Accueil, Agenda, « + », Groupes,
 * Réglages —, la rangée des sortes en haut de l'Accueil, « Pour vous », et la
 * page d'un groupe : tout ce qui est en cours dans ce groupe, sur une seule page.
 */
import { chromium } from 'playwright';
import { createPoll, addOptions } from '../../src/polls.js';
import { createList, addItems, assignItem } from '../../src/lists.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });

// Une liste et un sondage de Mifa, une liste des Copains : la page de Mifa
// montre les deux premiers, pas la troisième. Le sondage cherche un soir : il
// est « à décider » dans l'Agenda ; celui du cadeau reste sur l'Accueil.
const mifaList = { ...addItems(createList({ name: 'Courses Mifa', names: ['Gui'] }), 'Pain'), groupId: 'grp_famille', shared: true };
const mifaPoll = { ...addOptions(createPoll({ question: 'Quel soir pour la raclette ?', names: ['Gui'] }), 'vendredi'), groupId: 'grp_famille', shared: true };
const giftPoll = { ...addOptions(createPoll({ question: 'Quel cadeau pour Léa ?', names: ['Gui'] }), 'Livre\nVélo'), groupId: 'grp_famille', shared: true };
const valiseBase = addItems(createList({ name: 'Valise', names: ['Gui'] }), 'Maillot');
const valise = { ...assignItem(valiseBase, valiseBase.items[0].id, valiseBase.people[0].id), groupId: 'grp_famille', shared: true };
const copainsList = { ...addItems(createList({ name: 'Bières Copains', names: ['Gui'] }), 'Blonde'), groupId: 'grp_copains', shared: true };

const seed = {
  'marque-points:prefs:v1': {
    me: 'Gui',
    groups: [
      { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true },
      { id: 'grp_copains', name: 'Copains', key: 'la-cle-copains', admits: true },
    ],
  },
  'marque-points:polls:v1': [mifaPoll, giftPoll],
  'marque-points:lists:v1': [mifaList, copainsList, valise],
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
  tabs.join(' / ') === 'Accueil / Agenda / Groupes / Réglages', tabs.join(' / '));
check('chacun a son icône', (await page.locator('.tab .tab__icon').count()) === 4);
check('le « + » est dans la barre', await page.locator('#tabs #create').isVisible());
const plus = await page.locator('#create').boundingBox();
check('le « + » est pile au milieu', Math.abs(plus.x + plus.width / 2 - 195) < 1, JSON.stringify(plus));
check('et à cheval sur le bord de la barre', plus.y < bar.y && plus.y + plus.height > bar.y, JSON.stringify(plus));
check('l’app s’ouvre sur l’Accueil, allumé',
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Accueil');

/* --- l'Accueil ------------------------------------------------------------ */

const kinds = (await page.locator('.segmented--kinds .segmented__option').allTextContents()).map((s) => s.trim());
check('une rangée de sortes en haut de l’Accueil',
  kinds.join(' / ') === 'Tout / Listes / Sondages / Parties / Comptes', kinds.join(' / '));
check('« Tout » y est choisi',
  (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Tout');
const forYou = await page.locator('#for-you').textContent();
check('« Pour vous » : les deux sondages où Gui n’a pas répondu',
  forYou.includes('Quel soir pour la raclette') && forYou.includes('Quel cadeau pour Léa'), forYou);
check('une liste dont les lignes ne sont à personne n’y est pas', !forYou.includes('Courses Mifa'), forYou);
check('une ligne confiée à Gui y est', /Valise/.test(forYou) && /1 chose\(s\) pour vous/.test(forYou), forYou);
check('rien n’y est montré deux fois',
  (await page.locator('#view .game-card', { hasText: 'Courses Mifa' }).count()) === 1);

await page.click('.segmented--kinds [data-goto="#/polls"]');
await page.waitForSelector('[data-goto="#/polls/new"]');
check('« Sondages » les montre tous', (await page.locator('#view').textContent()).includes('Quel cadeau pour Léa'));
check('l’Accueil reste allumé', (await page.locator('.tab[aria-current]').textContent()).trim() === 'Accueil');
check('la sorte choisie est marquée',
  (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Sondages');

await page.click('.segmented--kinds [data-goto="#/spends"]');
await page.waitForSelector('[data-goto="#/spends/new"]');
check('les comptes ont leur sorte', page.url().endsWith('#/spends'), page.url());

/* --- l'Agenda : ce qui cherche un jour ------------------------------------ */

await page.click('[data-tab="agenda"]');
await page.waitForSelector('[data-goto="#/agenda/new"]');
const agenda = await page.locator('#view').textContent();
check('« À décider » : le sondage qui cherche un soir',
  agenda.includes('À décider') && agenda.includes('Quel soir pour la raclette'), agenda.slice(0, 200));
check('pas celui du cadeau', !agenda.includes('Quel cadeau pour Léa'));
await page.locator('.game-card', { hasText: 'Quel soir pour la raclette' }).click();
await page.waitForSelector('.gauge, .votes, #poll-day');
check('le sondage de date garde l’Agenda allumé',
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Agenda');

/* --- Réglages ------------------------------------------------------------- */

await page.click('[data-tab="settings"]');
await page.waitForSelector('#export');
check('Réglages : le prénom et les données',
  (await page.locator('#me-name').inputValue()) === 'Gui' && await page.locator('#look-update, #import').first().isVisible());

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
check('l’Accueil s’allume',
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Accueil');

await page.click('#create');
await page.click('dialog[open] [data-create-close]');
check('Annuler ferme le menu', (await page.locator('dialog[open]').count()) === 0);

/* --- la page d'un groupe -------------------------------------------------- */

await page.click('[data-tab="groups"]');
await page.waitForSelector('.group-link');
check('chaque groupe de l’onglet Groupes s’ouvre', (await page.locator('.group-link').count()) === 2);
check('et l’on peut y entrer dans un autre', await page.locator('#group-join').isVisible());
await page.locator('.group-link', { hasText: 'Mifa' }).click();
await page.waitForSelector('h1');
check('la page porte le nom du groupe', (await page.locator('h1').textContent()).trim() === 'Mifa');
check('l’adresse est celle du groupe', page.url().endsWith('#/group/grp_famille'), page.url());
const text = await page.locator('#view').textContent();
check('on y voit la liste du groupe', text.includes('Courses Mifa'));
check('et son sondage', text.includes('Quel soir pour la raclette'));
check('pas ce qui est à un autre groupe', !text.includes('Bières Copains'));

// « Voir qui doit quoi » : replié, et scopé à ce groupe.
check('le lien vers les personnes est replié', !(await page.locator('.details .game-card').first().isVisible()));
await page.click('.details summary');
const whoText = await page.locator('.details').last().textContent();
check('Gui, seul nom de ce groupe, y est', whoText.includes('Gui'));

check('l’onglet Groupes reste allumé',
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Groupes');

await page.click('#create');
await page.waitForSelector('dialog[open] [data-create]');
check('le « + » ouvert ici propose ce groupe',
  (await page.locator('dialog[open] [data-create-into].chip--on').textContent()).trim() === 'Mifa');
await page.click('dialog[open] [data-create-close]');

// Regarder un groupe ne règle rien pour le reste de l'app : de l'Accueil, le
// « + » ne l'impose pas, et le choix fait dans le menu suit jusqu'au bout.
await page.click('[data-tab="home"]');
await page.waitForSelector('.segmented--kinds');
check('la page d’un groupe ne filtre pas l’Accueil', (await page.locator('.chip--on').count()) === 0
  || (await page.locator('.chip--on').first().textContent()).trim() === 'Tous');
await page.click('#create');
await page.waitForSelector('dialog[open] [data-create-into]');
check('de l’Accueil, le « + » ne choisit pas Mifa tout seul',
  (await page.locator('dialog[open] [data-create-into].chip--on').textContent()).trim() !== 'Mifa');
await page.locator('dialog[open] [data-create-into]', { hasText: 'Copains' }).click();
await page.click('dialog[open] [data-create="#/lists/new"]');
await page.waitForSelector('#new-list');
const onForm = (await page.locator('[data-new-group].chip--on').allTextContents()).map((x) => x.trim());
check('le formulaire reprend le groupe choisi dans le menu', onForm.length === 1 && onForm[0].startsWith('Copains'), onForm.join(' | '));
await page.goBack();
await page.goto(`http://localhost:8099/dist/marque-points.html#/group/grp_famille`);
await page.waitForSelector('.details summary');

// « Tout voir » ouvre l'onglet, réglé sur ce groupe.
await page.locator('.section', { hasText: 'Courses Mifa' }).locator('[data-tile-goto]').click();
await page.waitForSelector('.segmented--kinds [data-goto="#/lists"][aria-current="true"]');
const lists = await page.locator('#view').textContent();
check('« Tout voir » ouvre l’onglet sur ce groupe',
  lists.includes('Courses Mifa') && !lists.includes('Bières Copains'));
check('la pastille du groupe y est choisie',
  (await page.locator('.chip--on').textContent()).trim() === 'Mifa');

await page.goto('http://localhost:8099/dist/marque-points.html#/group/grp_inconnu');
await page.waitForTimeout(400);
check('un groupe inconnu ramène aux groupes', page.url().endsWith('#/groups'), page.url());

/* --- sur un petit écran --------------------------------------------------- */

const small = await open(320, 640);
const wide = await small.evaluate(() => document.documentElement.scrollWidth);
check('rien ne déborde sur 320 px', wide <= 320, String(wide));
const cut = await small.evaluate(() => [...document.querySelectorAll('.tab > span')]
  .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
check('aucun nom d’onglet n’est coupé', cut.length === 0, cut.join(', '));

const phone = await open(360, 740);
const row = await phone.locator('.segmented--kinds').evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
check('les cinq sortes tiennent sur 360 px', row);

/* --- un lien de sondage : pas de barre ------------------------------------ */

await small.goto(`http://localhost:8099/dist/marque-points.html#/poll/${mifaPoll.id}/solo`);
await small.waitForTimeout(500);
check('la vue d’un invité n’a ni barre ni « + »', !(await small.locator('#tabs').isVisible()));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
