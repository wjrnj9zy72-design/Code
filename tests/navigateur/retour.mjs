/**
 * « Retour » ramène là d'où l'on vient : à la page du groupe pour une liste
 * ouverte depuis elle, à celle d'une personne pour un sondage ouvert depuis
 * elle — et l'onglet allumé reste celui d'où l'on est parti. Un lien ouvert
 * tout seul revient à sa place habituelle. Et un compte se crée comme le reste :
 * le groupe se choisit sur le formulaire.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const B = 'http://localhost:8099/dist/marque-points.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(([c]) => {
  try {
    if (localStorage.getItem('marque-points:prefs:v1')) return;
    localStorage.setItem('marque-points:remote:v1', c);
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
      me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }],
    }));
  } catch {}
}, [CONFIG]);
const hash = () => page.evaluate(() => location.hash);
const lit = () => page.getAttribute('[aria-current="page"]', 'data-tab');
const back = async () => { await page.click('#view [data-back]'); await page.waitForTimeout(300); };

await page.goto(`${B}#/lists/new`);
await page.waitForSelector('#new-list');
await page.fill('#list-name', 'Courses');
await page.fill('#list-lines', 'Pain');
await page.click('#new-list button[type=submit]');
await page.waitForSelector('.lines');
const listHash = await hash();

await page.goto(`${B}#/polls/new`);
await page.waitForSelector('#poll-question');
await page.fill('#poll-question', 'Quel soir ?');
await page.fill('#poll-choices', 'Vendredi 12\nSamedi 13');
await page.click('form button[type=submit]');
await page.waitForSelector('#view [data-back]');
const pollHash = await hash();
check('retour d’une liste tout juste créée : pas le formulaire', true);

/* --- depuis la page du groupe ------------------------------------------- */
await page.goto(`${B}#/groups`);
await page.waitForSelector('.group-link');
await page.click('.group-link');
await page.waitForSelector('[data-create-menu]');
check('la page du groupe nomme ses sections par type',
  (await page.locator('.section h2', { hasText: 'Listes' }).count()) === 1
  && (await page.locator('.section h2', { hasText: 'Sondages' }).count()) === 1
  && (await page.locator('.section h2', { hasText: 'En cours' }).count()) === 0);
await page.locator('.section', { hasText: 'Listes' }).locator('.game-card').first().click();
await page.waitForSelector('.lines');
check('la liste s’ouvre', (await hash()) === listHash);
check('l’onglet Groupes reste allumé', (await lit()) === 'groups', await lit());
await back();
check('Retour revient à la page du groupe', (await hash()) === '#/group/grp_famille', await hash());
await back();
check('puis à la liste des groupes', (await hash()) === '#/groups', await hash());

/* --- depuis l'Accueil, un sondage qui cherche un jour ------------------- */
await page.click('[data-tab="home"]');
await page.waitForTimeout(300);
await page.click('.segmented--kinds [data-goto="#/polls"]');
await page.waitForSelector('[data-goto="#/polls/new"]');
await page.locator('.game-card', { hasText: 'Quel soir' }).first().click();
await page.waitForSelector('#view [data-back]');
check('le sondage ouvert depuis l’Accueil laisse l’Accueil allumé', (await lit()) === 'home', await lit());
await back();
check('et Retour revient aux sondages de l’Accueil', (await hash()) === '#/polls', await hash());

/* --- un lien ouvert tout seul -------------------------------------------- */
const alone = await ctx.newPage();
await alone.goto(`${B}${pollHash}`);
await alone.waitForSelector('#view [data-back]');
check('ouvert par un lien, il va où il est rangé', (await alone.getAttribute('[aria-current="page"]', 'data-tab')) === 'agenda');
await alone.click('#view [data-back]');
await alone.waitForTimeout(300);
check('et Retour mène à cette place-là', (await alone.evaluate(() => location.hash)) === '#/agenda');
await alone.close();

/* --- le compte, comme le reste ------------------------------------------- */
await page.goto(`${B}#/spends/new`);
await page.waitForSelector('#new-spend');
check('le formulaire du compte propose le groupe', (await page.locator('#new-spend [data-new-group]').count()) === 3);
check('et me met en premier', (await page.inputValue('[data-person-index="0"]')) === 'Gui');
await page.click('#new-spend [data-new-group=""]');
await page.fill('#spend-name', 'Perso');
await page.click('#new-spend button[type=submit]');
await page.waitForSelector('#spend-people');
const spend = await page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:spends:v1') || '[]').find((s) => s.name === 'Perso'));
check('gardé pour moi : dans aucun groupe', spend && !spend.groupId && !spend.shared, JSON.stringify(spend && { g: spend.groupId, s: spend.shared }));

/* --- les compteurs du groupe comptent tout ------------------------------- */
await page.goto(`${B}#/groups`);
await page.waitForSelector('.tiles');
check('une case Idées sur la carte du groupe', (await page.locator('.tile', { hasText: 'Idées' }).count()) === 1);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${bad.length} échecs`);
