/**
 * « Safari a poussé quelque chose, l'app de l'écran d'accueil ne le voit pas. »
 * Le bouton de récupération, et la récupération toute seule au retour au premier
 * plan — sur les trois onglets, pas seulement sur la partie ouverte.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const PAGE = 'http://localhost:8099/dist/marque-points.html';

async function device(label, { key = 'la-cle-famille', me = 'Gui', admits = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k, name, admitting]) => {
    localStorage.setItem('marque-points:remote:v1', c);
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
      me: name, groups: k ? [{ id: 'grp_famille', name: 'Mifa', key: k, admits: admitting }] : [],
    }));
  }, [CONFIG, key, me, admits]);
  await page.goto(PAGE);
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- le bouton n'apparaît que quand il sert -------------------------------- */

const alone = await device('sans groupe', { key: null });
await alone.waitForTimeout(400);
check('sans groupe, pas de bouton de récupération', await alone.locator('#sync').isHidden());

const safari = await device('safari');
const home = await device('écran d’accueil');
check('avec un groupe, le bouton est là', await home.locator('#sync').isVisible());
check('et il est étiqueté', (await home.locator('#sync').getAttribute('aria-label')).length > 10,
  await home.locator('#sync').getAttribute('aria-label'));

/* --- Safari partage une liste, l'autre ne la voit pas encore -------------- */

await safari.click('.tab[data-tab="lists"]');
await safari.click('[data-goto="#/lists/new"]');
await safari.waitForSelector('#new-list');
await safari.fill('#list-name', 'Courses de Safari');
await safari.fill('#list-lines', 'Pain\nLait');
await safari.click('#new-list button[type=submit]');
await safari.waitForSelector('.lines');
await safari.click('#list-share');
await safari.waitForSelector('#export-dialog[open]', { timeout: 15000 });
await safari.click('#export-close');

await home.click('.tab[data-tab="lists"]');
await home.waitForTimeout(500);
// Plus de « pas encore » garanti : l'app, restée ouverte, va chercher d'elle-même
// toutes les vingt secondes. Le bouton reste là pour ne pas attendre.

/* --- une touche sur le bouton, et elle est là ----------------------------- */

await home.click('#sync');
await home.waitForFunction(
  () => /élément|jour/.test(document.querySelector('.banner')?.textContent || ''),
  null, { timeout: 15000 },
);
check('le bouton la récupère depuis n’importe quel onglet',
  (await home.locator('.game-list').textContent()).includes('Courses de Safari'),
  await home.locator('.banner').textContent());
check('et il dit ce qu’il a trouvé — la liste, ou qu’elle était déjà arrivée d’elle-même',
  /1 élément|Rien de nouveau/.test(await home.locator('.banner').textContent()),
  await home.locator('.banner').textContent());

await home.click('#sync');
await home.waitForFunction(
  () => /Rien de nouveau/.test(document.querySelector('.banner')?.textContent || ''),
  null, { timeout: 15000 },
);
check('une deuxième fois, il dit qu’il n’y a rien de neuf',
  /Rien de nouveau/.test(await home.locator('.banner').textContent()));

/* --- et tout seul, au retour au premier plan ------------------------------ */

await safari.click('.tab[data-tab="polls"]');
await safari.click('[data-goto="#/polls/new"]');
await safari.waitForSelector('#new-poll');
await safari.fill('#poll-question', 'Quel soir chez Safari ?');
await safari.fill('#poll-choices', 'Vendredi\nSamedi');
await safari.click('#new-poll button[type=submit]');
await safari.waitForSelector('.tally, .poll-grid, table');
await safari.click('#poll-share');
await safari.waitForSelector('#export-dialog[open]', { timeout: 15000 });
await safari.click('#export-close');

// le délai minimum entre deux récupérations automatiques
await home.evaluate(() => { window.__t = Date.now(); });
await home.click('.tab[data-tab="polls"]');
await home.waitForTimeout(400);
check('le sondage n’est pas encore là',
  !(await home.locator('body').textContent()).includes('chez Safari'));

// on simule le retour au premier plan : l'app était en arrière-plan
await home.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await home.waitForTimeout(21000);
await home.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await home.waitForFunction(
  () => document.body.textContent.includes('chez Safari'),
  null, { timeout: 20000 },
);
check('revenir dans l’app récupère ce qui a été poussé, sans rien toucher',
  (await home.locator('body').textContent()).includes('chez Safari'));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
