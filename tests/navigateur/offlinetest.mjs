import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// Le service worker n'est servi qu'en https ou sur localhost : on est sur localhost.
await page.goto('http://localhost:8099/');
await page.waitForSelector('.app-bar');
const registered = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return Boolean(r);
});
check('le cache applicatif s’enregistre', registered);

await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1200);

// --- ce qui permet de savoir, et de forcer, la mouture qu'on a
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForSelector('#look-update');
const shown = await page.locator('.section', { has: page.locator('#look-update') }).textContent();
check('la version de l’app est affichée', /v\d+/.test(shown), shown.replace(/\s+/g, ' ').slice(-80));
const inWorker = await page.evaluate(async () => {
  const r = await fetch('/sw.js', { cache: 'no-store' }).then((x) => x.text());
  return /const VERSION = '([^']+)'/.exec(r)?.[1];
});
check('et c’est celle que le cache porte', shown.includes(inWorker), inWorker);
check('le service worker est enregistré sans passer par le cache du navigateur',
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).updateViaCache === 'none'));
await page.click('#look-update');
await page.waitForSelector('.banner', { timeout: 15000 });
check('chercher une mise à jour répond quelque chose de sensé',
  /dernière version|nouvelle version|Impossible|latest published|new version|Cannot check/.test(await page.locator('.banner').textContent()),
  await page.locator('.banner').textContent());

// une partie, pour vérifier qu'elle survit hors ligne
await page.evaluate(() => { location.hash = '#/new'; });
await page.waitForSelector('#new-game');
await page.selectOption('#preset', 'skyjo');
await page.fill('#game-name', 'Partie hors ligne');
for (const [i, n] of ['Gui', 'Alice', 'Bob'].entries()) await page.fill(`[data-name-index="${i}"]`, n);
await page.click('#new-game button[type=submit]');
await page.waitForSelector('#round-form');
const ids = await page.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
for (const [i, v] of ['5', '9', '14'].entries()) await page.fill(`[data-score="${ids[i]}"]`, v);
await page.click('#round-form button[type=submit]');
await page.waitForSelector('table.scores');

// --- réseau coupé
await ctx.setOffline(true);
await page.goto('http://localhost:8099/').catch(() => null);
const opened = await page.locator('.app-bar').count().catch(() => 0);
check('l’app s’ouvre sans réseau', opened === 1);
// L'Aperçu porte aussi une carte par personne : compter dans l'onglet Parties.
await page.evaluate(() => { location.hash = '#/games'; });
await page.waitForSelector('[data-goto="#/new"]');
check('les parties sont toujours là', (await page.locator('.game-card').count()) === 1);
await page.click('.game-card');
await page.waitForSelector('table.scores').catch(() => null);
check('une partie s’ouvre hors ligne', (await page.locator('table.scores tbody tr').count()) === 1);

// et on peut continuer à jouer
const oids = await page.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
for (const [i, v] of ['2', '3', '4'].entries()) await page.fill(`[data-score="${oids[i]}"]`, v);
await page.click('#round-form button[type=submit]');
await page.waitForTimeout(300);
check('on peut marquer des points hors ligne', (await page.locator('table.scores tbody tr').count()) === 2);

// --- réseau rétabli
await ctx.setOffline(false);
await page.reload();
await page.waitForSelector('table.scores');
check('tout est intact au retour du réseau', (await page.locator('table.scores tbody tr').count()) === 2);

const manifest = await page.evaluate(async () => {
  const r = await fetch('manifest.webmanifest');
  return r.ok ? (await r.json()).name : null;
});
check('le manifeste est servi', manifest === 'Together', String(manifest));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
