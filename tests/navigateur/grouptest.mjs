import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (k) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
        groups: [{ id: 'grp_famille', name: 'Mifa', key: k }],
      }));
    } catch {}
  }, [CONFIG, key]);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- l'aperçu et l'ordre des onglets ------------------------------------- */

const page = await device('moi');
const tabs = (await page.locator('.tab').allTextContents()).map((s) => s.trim());
check('quatre onglets, l’agenda en dernier',
  tabs.join(' / ') === 'Listes / Sondages / Parties / Agenda', tabs.join(' / '));
check("l'app ouvre sur l'aperçu",
  (await page.locator('.tab[aria-current]').count()) === 0
  && (await page.locator('.app-bar__brand[aria-current]').count()) === 1);
check("l'aperçu dit ce qu'est l'app", (await page.locator('.lead').textContent()).length > 40);
check('le « + » de la barre crée, l’aperçu n’a plus ses propres boutons',
  (await page.locator('#tabs #create').isVisible()) && (await page.locator('[data-goto$="/new"]').count()) === 0);
check('les groupes ont leur section',
  (await page.locator('#group-name').count()) === 1 && (await page.locator('#group-code').count()) === 1);
check('sans groupe, il le dit', (await page.locator('#group-state').count()) === 1
  && (await page.locator('.section', { has: page.locator('#group-name') }).textContent()).includes('aucun groupe'));
check('et le prénom de l’appareil a sa place', (await page.locator('#me-name').count()) === 1);

/* --- sans groupe, on ne partage rien ------------------------------------- */

await page.click('.tab[data-tab="lists"]');
await page.click('[data-goto="#/lists/new"]');
await page.waitForSelector('#new-list');
await page.fill('#list-name', 'Courses');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('#list-lines', 'Pain\nLait');
await page.click('#new-list button[type=submit]');
await page.waitForSelector('.lines');
await page.click('#list-share');
await page.waitForSelector('.banner--warn', { timeout: 10000 });
check('sans groupe, partager est refusé et expliqué',
  (await page.locator('.banner--warn').textContent()).includes('groupe'),
  await page.locator('.banner--warn').textContent());
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:lists:v1'))[0].shared);
check('et la liste reste locale', stored === false, String(stored));

/* --- entrer dans un groupe ----------------------------------------------- */

await page.click('.app-bar__brand');
await page.waitForSelector('.details summary');
await page.click('.details summary');
await page.fill('#group-key', 'pas-une-cle');
await page.click('#group-paste');
await page.waitForTimeout(1200);
check('une clé inconnue est refusée',
  (await page.locator('#group-state').textContent()).includes('aucun groupe'),
  await page.locator('#group-state').textContent());

await page.fill('#group-key', 'la-cle-famille');
await page.click('#group-paste');
await page.waitForSelector('.banner', { timeout: 10000 });
check('la bonne clé dit dans quel groupe on entre',
  (await page.locator('.banner').textContent()).includes('Mifa'),
  await page.locator('.banner').textContent());
check('et le groupe apparaît', (await page.locator('[data-catch-up]').count()) === 1);

/* --- partager, maintenant, marche ---------------------------------------- */

await page.click('.tab[data-tab="lists"]');
// L'Aperçu porte lui aussi des cartes (une par personne) : attendre l'onglet.
await page.waitForSelector('[data-goto="#/lists/new"]');
await page.click('.game-card');
await page.waitForSelector('#list-share');
await page.click('#list-share');
await page.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await page.inputValue('#export-text');
check('la liste se partage une fois dans le groupe', /#\/list\/l_/.test(link), link);
await page.click('#export-close');

/* --- un autre appareil du groupe rattrape tout ---------------------------- */

const other = await device('autre', { key: 'la-cle-famille' });
// Ouvrir l'app suffit : elle va chercher ce que le groupe partage.
await other.click('.tab[data-tab="lists"]');
await other.waitForSelector('[data-goto="#/lists/new"]');
await other.waitForSelector('.game-card', { timeout: 15000 });
check('ouvrir l’app ramène ce que le groupe partage, sans rien toucher',
  (await other.locator('.game-card').textContent()).includes('Courses'),
  await other.locator('.game-card').textContent());
await other.click('.app-bar__brand');
await other.click('[data-catch-up]');
await other.waitForSelector('.banner', { timeout: 15000 });
check('« Tout récupérer » le confirme sans rien ramener deux fois',
  /jour|élément/.test(await other.locator('.banner').textContent()),
  await other.locator('.banner').textContent());

// une deuxième fois : rien de neuf
await other.click('.app-bar__brand');
await other.click('[data-catch-up]');
await other.waitForSelector('.banner', { timeout: 15000 });
check('rattraper deux fois ne ramène rien de neuf',
  (await other.locator('.banner').textContent()).includes('à jour'),
  await other.locator('.banner').textContent());

/* --- contribuer sans clé -------------------------------------------------- */

const guest = await device('invité'); // aucun groupe
await guest.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await guest.waitForSelector('.lines', { timeout: 15000 });
check('qui reçoit le lien ouvre la liste sans clé', (await guest.locator('.line').count()) === 2);
await guest.locator('[data-tick]').first().check();
await guest.waitForTimeout(600);
const seen = await page.waitForFunction(
  () => document.querySelectorAll('.line--done').length === 1, null, { timeout: 15000 },
).then(() => true).catch(() => false);
check('et peut cocher : sa coche remonte', seen);

check("mais il ne peut toujours pas partager les siennes",
  (await guest.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1') || '{}').groups?.length)) === undefined);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
