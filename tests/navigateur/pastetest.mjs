import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

// Navigateur A : celui qui a les parties
const a = await (await browser.newContext()).newPage();
a.on('pageerror', (e) => errors.push('A: ' + e.message));
await a.goto('http://localhost:8099/');
await a.evaluate(() => { location.hash = '#/new'; });
await a.waitForSelector('#new-game');
await a.selectOption('#preset', 'papayoo');
await a.fill('#game-name', 'Soirée à récupérer');
for (const [i, n] of ['Gui', 'Alice', 'Bob'].entries()) await a.fill(`[data-name-index="${i}"]`, n);
await a.click('#new-game button[type=submit]');
await a.waitForSelector('#round-form');
const ids = await a.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
for (const [i, v] of ['40', '60', '150'].entries()) await a.fill(`[data-score="${ids[i]}"]`, v);
await a.click('#round-form button[type=submit]');
await a.waitForSelector('table.scores');
await a.evaluate(() => { location.hash = '#/'; });
await a.waitForSelector('#export');
await a.click('#export');
let exported = null;
if (await a.locator('#export-dialog[open]').count()) {
  exported = await a.inputValue('#export-text');
} else {
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#export')]);
  exported = null;
}
if (!exported) exported = await a.evaluate(() => localStorage.getItem('marque-points:games:v1'));
check("l'export contient la partie", /Soirée à récupérer/.test(exported));

// Navigateur B : l'app installée, stockage vierge
const b = await (await browser.newContext()).newPage();
b.on('pageerror', (e) => errors.push('B: ' + e.message));
await b.goto('http://localhost:8099/');
await b.waitForSelector('.app-bar');
check('B part de zéro', (await b.locator('.game-card').count()) === 0);

await b.evaluate(() => { location.hash = '#/'; });
await b.waitForSelector('#import-paste');
await b.click('#import-paste');
await b.waitForSelector('#paste-text');
await b.fill('#paste-text', exported);
await b.click('#paste-import');
await b.waitForTimeout(300);
await b.evaluate(() => { location.hash = '#/games'; });
await b.waitForSelector('.game-card');
check('la partie est récupérée', (await b.locator('.game-card').count()) === 1, String(await b.locator('.game-card').count()));
check('avec ses joueurs', /Gui/.test(await b.locator('.game-card').first().textContent()));
await b.click('.game-card');
await b.waitForSelector('table.scores');
check('et ses manches', (await b.locator('table.scores tbody tr').count()) === 1);
check('et ses scores', /150/.test(await b.locator('table.scores tbody tr').textContent()));

// importer deux fois ne duplique pas
await b.evaluate(() => { location.hash = '#/games'; });
await b.evaluate(() => { location.hash = '#/'; });
await b.waitForSelector('#import-paste');
await b.click('#import-paste');
await b.fill('#paste-text', exported);
await b.click('#paste-import');
await b.waitForTimeout(300);
// L'Aperçu porte aussi une carte par personne : compter dans l'onglet Parties.
const gamesOfB = async () => {
  await b.evaluate(() => { location.hash = '#/games'; });
  await b.waitForSelector('[data-goto="#/new"]');
  return b.locator('.game-card').count();
};
check('importer deux fois ne duplique rien', (await gamesOfB()) === 1, String(await gamesOfB()));

// un texte invalide est refusé proprement
await b.evaluate(() => { location.hash = '#/'; });
await b.waitForSelector('#import-paste');
await b.click('#import-paste');
await b.fill('#paste-text', 'ceci n’est pas du JSON');
await b.click('#paste-import');
await b.waitForTimeout(200);
check('un texte invalide est refusé sans rien casser', await b.locator('#paste-error').isVisible() && (await b.locator('#paste-text').count()) === 1);
await b.click('#paste-cancel');
check('les parties sont intactes après un refus', (await gamesOfB()) === 1);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((x) => console.log('   ÉCHEC:', x.n, '→', x.d));
console.log('erreurs :', errors);
await browser.close();
