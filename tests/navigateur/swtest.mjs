/**
 * « J'ajoute sur l'écran d'accueil et je n'ai pas la nouvelle mouture. »
 * Ce qu'on peut éprouver ici : la première visite ne se recharge pas, une
 * version publiée pendant que l'app tourne est prise, et l'app se recharge
 * alors toute seule — une fois.
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const SW = new URL('../../sw.js', import.meta.url).pathname;
const HTML = new URL('../../index.html', import.meta.url).pathname;
const original = { sw: await readFile(SW, 'utf8'), html: await readFile(HTML, 'utf8') };

const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
const page = await ctx.newPage();
let reloads = 0;
page.on('load', () => { reloads += 1; });
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.goto('http://localhost:8099/#/settings');
await page.waitForSelector('.app-bar');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);
check('la première visite ne se recharge pas d’elle-même', reloads === 1, `${reloads} chargement(s)`);
const before = await page.locator('.section', { has: page.locator('#look-update') }).textContent();
check('et elle affiche sa version et son empreinte',
  /v\d+ · [0-9a-f]{8}/.test(before), before.replace(/\s+/g, ' ').slice(-70));

// On publie une nouvelle mouture pendant que l'app tourne.
await writeFile(SW, original.sw.replace(/const VERSION = '[^']+'/, "const VERSION = 'v9-essai'"));
await writeFile(HTML, original.html.replace(/name="app-version" content="[^"]+"/, 'name="app-version" content="v9-essai"'));

await page.click('#look-update');
await page.waitForFunction(() => window.location && true, null, { timeout: 5000 });
// la recharge est déclenchée par la prise en main du nouveau worker
await page.waitForFunction(
  () => /v9-essai/.test(document.querySelector('meta[name="app-version"]')?.content || ''),
  null, { timeout: 30000 },
).catch(() => {});
// The new version shows as soon as the page is parsed; the load that counts
// the reload comes a moment later, later still on a busy machine.
await page.waitForLoadState('load');
await page.waitForTimeout(300);
const nowVersion = await page.evaluate(
  () => document.querySelector('meta[name="app-version"]')?.content,
);
check('une version publiée pendant que l’app tourne est prise', nowVersion === 'v9-essai', String(nowVersion));
check('et l’app s’est rechargée une seule fois pour l’appliquer', reloads === 2, `${reloads} chargement(s)`);
const cacheName = await page.evaluate(async () => (await caches.keys()).join(','));
check('l’ancien cache est remplacé, pas empilé',
  cacheName.startsWith('marque-points-v9-essai-') && !cacheName.includes(','), cacheName);

await writeFile(SW, original.sw);
await writeFile(HTML, original.html);
/* --- l'app de l'écran d'accueil, sans groupe : ce qu'elle explique --------- */

const standalone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'fr-FR',
  // Ce que Safari passe à une app posée sur l'écran d'accueil.
  reducedMotion: 'no-preference',
});
const home = await standalone.newPage();
await home.addInitScript((config) => {
  // La base de test, comme dans les autres suites.
  localStorage.setItem('marque-points:remote:v1', config);
  // display-mode: standalone, tel que l'app le lit.
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query)
    ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
    : real(query));
}, JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' }));
await home.goto('http://localhost:8099/#/groups');
await home.waitForSelector('.app-bar');
await home.waitForTimeout(500);
const section = await home.locator('.section', { has: home.locator('#group-name') }).textContent();
check('l’app de l’écran d’accueil dit qu’elle est une installation à part',
  /installation à part|propre stockage/.test(section), section.replace(/\s+/g, ' ').slice(0, 120));
check('et elle propose la clé et la demande',
  (await home.locator('#group-key').count()) === 1 && (await home.locator('#group-join').count()) === 1);
check('le bouton ⟳ reste caché tant qu’il n’y a pas de groupe',
  await home.locator('#sync').isHidden());

// une fois la clé collée, le groupe et le bouton sont là
await home.click('.details summary');
await home.fill('#group-key', 'la-cle-famille');
await home.click('#group-paste');
await home.waitForSelector('[data-catch-up]', { timeout: 15000 });
check('la clé collée fait apparaître le groupe', (await home.locator('[data-catch-up]').count()) === 1);
check('et le bouton ⟳ avec lui', await home.locator('#sync').isVisible());

/* --- réinstaller : la clé se relit, et personne d'autre n'est touché ------- */

// Safari garde la clé et la montre, pour qu'on puisse la recoller ailleurs.
const safari = await standalone.browser().newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
const tab = await safari.newPage();
await tab.addInitScript((c) => {
  localStorage.setItem('marque-points:remote:v1', c);
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
    me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }],
  }));
}, JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' }));
await tab.goto('http://localhost:8099/#/groups');
await tab.waitForSelector('[data-show-key]');
await tab.click('[data-show-key]');
await tab.waitForSelector('dialog[open] .button--danger, dialog[open] button');
await tab.locator('dialog[open] button', { hasText: 'Voir ma clé' }).first().click();
await tab.waitForSelector('#export-dialog[open]', { timeout: 15000 });
check('un appareil peut relire la clé qu’il détient',
  (await tab.inputValue('#export-text')) === 'la-cle-famille',
  await tab.inputValue('#export-text'));
check('avec l’avertissement qui va avec',
  /lieu sûr|Ne l’envoyez/.test(await tab.locator('#export-hint').textContent()),
  await tab.locator('#export-hint').textContent());
await tab.click('#export-close');

// L'app de l'écran d'accueil, réinstallée : stockage vide, on recolle la clé.
const reinstalled = await standalone.browser().newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
const fresh = await reinstalled.newPage();
await fresh.addInitScript((c) => {
  localStorage.setItem('marque-points:remote:v1', c);
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query)
    ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
    : real(query));
}, JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' }));
await fresh.goto('http://localhost:8099/#/groups');
await fresh.waitForSelector('.app-bar');
await fresh.click('.details summary');
await fresh.fill('#group-key', 'la-cle-famille');
await fresh.click('#group-paste');
await fresh.waitForSelector('[data-catch-up]', { timeout: 15000 });
check('la réinstallation revient dans le groupe sans invitation ni acceptation',
  (await fresh.locator('[data-catch-up]').count()) === 1);

// et personne d'autre n'a été touché : la clé des autres ouvre toujours
const others = await fetch('http://127.0.0.1:8123/rest/v1/rpc/marque_points_group_of', {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
  body: JSON.stringify({ p_key: 'la-cle-copains' }),
}).then((r) => r.json());
check('et les clés des autres appareils n’ont pas bougé', others && others.name === 'Copains du mardi',
  JSON.stringify(others));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
