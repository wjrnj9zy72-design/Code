import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript((c) => { try { localStorage.setItem('marque-points:remote:v1', c); if (!localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille' }] })); } catch {} }, CONFIG);
  await page.goto('http://localhost:8099/dist/marque-points.html'); 
  await page.waitForSelector('.app-bar');
  return page;
}

// Safari : la partie est créée ici, puis partagée
const safari = await device('safari');
await safari.evaluate(() => { location.hash = '#/new'; });
await safari.waitForSelector('#new-game');
await safari.selectOption('#preset', 'papayoo');
await safari.fill('#game-name', 'Soirée de mardi');
for (const [i, n] of ['Gui', 'Alice', 'Bob'].entries()) await safari.fill(`[data-name-index="${i}"]`, n);
await safari.click('#new-game button[type=submit]');
await safari.waitForSelector('#round-form');
const ids = await safari.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
for (const [i, v] of ['40', '60', '150'].entries()) await safari.fill(`[data-score="${ids[i]}"]`, v);
await safari.click('#round-form button[type=submit]');
await safari.waitForSelector('table.scores');
await safari.click('#share');
await safari.waitForSelector('#export-dialog[open]');
const link = await safari.inputValue('#export-text');
await safari.click('#export-close');
check('la partie est partagée depuis Safari', /#\/game\//.test(link), link.slice(-30));

// L'app installée : stockage vierge, aucune liste
const app = await device('app installée');
// Elle appartient au même groupe : la partie partagée y arrive d'elle-même. Ce
// que le lien doit prouver, c'est qu'il ouvre la bonne — pas qu'elle manquait.
await app.waitForTimeout(1200);

// On lui donne le lien
await app.evaluate(() => { location.hash = '#/'; });
await app.waitForSelector('#open-link');
await app.evaluate(() => { location.hash = '#/'; });
await app.waitForSelector('#open-link');
await app.click('#open-link');
await app.waitForSelector('#link-text');
await app.fill('#link-text', `Viens compter : ${link} à ce soir`);
await app.click('#link-open');
await app.waitForSelector('table.scores', { timeout: 10000 });
check('la partie s’ouvre dans l’app installée', /Soirée de mardi/.test(await app.locator('h1').textContent()));
check('avec ses scores', (await app.locator('table.scores tbody tr').textContent()).includes('150'));

// et elle reste dans la liste
await app.evaluate(() => { location.hash = '#/games'; });
await app.waitForSelector('.game-card');
check('et elle figure désormais dans sa liste', (await app.locator('.game-card').count()) === 1);
await app.reload();
await app.waitForSelector('.game-card');
check('même après un rechargement', (await app.locator('.game-card').count()) === 1);

// les deux côtés restent synchronisés
const aids = await app.locator('.game-card').first().click().then(() => app.waitForSelector('#round-form')).then(() =>
  app.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score)));
for (const [i, v] of ['10', '20', '220'].entries()) await app.fill(`[data-score="${aids[i]}"]`, v);
await app.click('#round-form button[type=submit]');
await app.waitForTimeout(400);
const picked = await safari.waitForFunction(() => document.querySelectorAll('table.scores tbody tr').length === 2, null, { timeout: 12000 }).then(() => true).catch(() => false);
check('une manche ajoutée dans l’app remonte jusqu’à Safari', picked);

// un lien invalide est refusé proprement
await app.evaluate(() => { location.hash = '#/games'; });
await app.evaluate(() => { location.hash = '#/'; });
await app.waitForSelector('#open-link');
await app.click('#open-link');
await app.fill('#link-text', 'bonjour');
await app.click('#link-open');
await app.waitForTimeout(200);
check('un texte sans identifiant est refusé', await app.locator('#link-error').isVisible());
await app.fill('#link-text', 'https://exemple.fr/#/game/g_nexiste_pas_du_tout');
await app.click('#link-open');
await app.waitForTimeout(600);
check('un identifiant inconnu est refusé', await app.locator('#link-error').isVisible());
await app.click('#link-cancel');

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
