import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript((c) => { try { localStorage.setItem('marque-points:remote:v1', c); if (!localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille' }] })); } catch {} }, CONFIG);
  await page.goto('http://localhost:8099/dist/marque-points.html'); 
  await page.waitForSelector('.app-bar');
  return page;
}

const page = await device('moi');
check("l'app s'appelle Together", (await page.locator('.app-bar strong').textContent()) === 'Together');
check('quatre onglets : Accueil, Agenda, Groupes, Réglages',
  (await page.locator('.tab').allTextContents()).map((x) => x.trim()).join(' / ')
    === 'Accueil / Agenda / Groupes / Réglages',
  (await page.locator('.tab').allTextContents()).join(' / '));
check("l'app ouvre sur l'Accueil",
  (await page.locator('.tab[aria-current]').textContent()).trim() === 'Accueil');

await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/lists"]');
await page.waitForSelector('[data-goto="#/lists/new"]');
check("l'onglet Listes s'ouvre", (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Listes');

await page.click('[data-goto="#/lists/new"]');
await page.waitForSelector('#new-list');
await page.fill('#list-name', 'Courses de samedi');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('[data-person-index="1"]', 'Alice');
await page.fill('#list-lines', 'Pain\n- Lait\n2 baguettes\nRéserver le camion');
await page.click('#new-list button[type=submit]');
await page.waitForSelector('.lines');
check('la liste est créée avec ses lignes', (await page.locator('.line').count()) === 4,
  String(await page.locator('.line').count()));
check('les puces sont nettoyées',
  (await page.locator('.line__text').nth(1).textContent()).trim() === 'Lait');

// ajouter une ligne, garder le focus
await page.fill('#new-line', 'Fromage');
await page.press('#new-line', 'Enter');
await page.waitForTimeout(200);
check('une ligne s’ajoute', (await page.locator('.line').count()) === 5);
check('et le champ reste prêt pour la suivante',
  await page.evaluate(() => document.activeElement?.id) === 'new-line');

// cocher
await page.locator('[data-tick]').first().check();
await page.waitForTimeout(200);
check('cocher marque la ligne faite', (await page.locator('.line--done').count()) === 1);
check('et l’en-tête compte', (await page.locator('h1 + p, .spread p').first().textContent()).includes('1 sur 5'),
  await page.locator('.spread p').first().textContent());

// attribuer
await page.locator('[data-assign]').nth(1).click();
await page.waitForSelector('dialog[open] [data-who]');
await page.locator('dialog[open] [data-who]').first().click();
await page.waitForTimeout(300);
check('une ligne s’attribue', (await page.locator('.line__who').nth(1).textContent()).trim() === 'Gui',
  await page.locator('.line__who').nth(1).textContent());

// répartir le reste
await page.click('#share-out');
await page.waitForTimeout(300);
const owners = await page.locator('.line__who').evaluateAll((e) => e.map((x) => x.textContent.trim()));
check('« Répartir » donne le reste à quelqu’un',
  owners.filter((o) => o === 'Personne').length === 1, owners.join(' / '));
check('et la ligne déjà faite reste sans personne', owners[0] === 'Personne', owners[0]);

// filtrer par personne
await page.locator('[data-filter]').nth(1).click();
await page.waitForTimeout(200);
const shown = await page.locator('.line').count();
check('le filtre par personne réduit la liste', shown > 0 && shown < 5, String(shown));
await page.locator('[data-filter]').first().click();
await page.waitForTimeout(200);

// modifier et supprimer une ligne
await page.locator('[data-edit]').last().click();
await page.waitForSelector('#line-text');
await page.fill('#line-text', 'Réserver le camion (10 h)');
await page.click('#line-save');
await page.waitForTimeout(300);
check('une ligne se corrige',
  (await page.locator('.line__text').last().textContent()).includes('10 h'));
await page.locator('[data-edit]').last().click();
await page.waitForSelector('#line-delete');
await page.click('#line-delete');
await page.waitForTimeout(300);
check('et se supprime', (await page.locator('.line').count()) === 4);

// partager la liste, puis l'ouvrir ailleurs
await page.click('#list-share');
await page.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await page.inputValue('#export-text');
check('le lien pointe vers la liste', /#\/list\/l_/.test(link), link);
await page.click('#export-close');

const other = await device('autre');
await other.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await other.waitForSelector('.lines', { timeout: 15000 });
check('la liste s’ouvre chez quelqu’un d’autre',
  (await other.locator('h1').textContent()).includes('Courses de samedi'));
check('avec ses lignes et ses attributions',
  (await other.locator('.line').count()) === 4
  && (await other.locator('.line__who').nth(1).textContent()).trim() === 'Gui');

// les deux côtés se synchronisent
await other.locator('[data-tick]').nth(1).check();
await other.waitForTimeout(400);
const seen = await page.waitForFunction(
  () => document.querySelectorAll('.line--done').length === 2, null, { timeout: 15000 },
).then(() => true).catch(() => false);
check('ce que coche l’autre arrive ici', seen);

// reprendre la liste
// La liste reprise est une autre liste : attendre que l'adresse change, sinon
// c'est encore l'ancienne page qui est mesurée.
const beforeReuse = await page.evaluate(() => location.hash);
await page.click('#list-reuse');
await page.waitForFunction((was) => location.hash !== was, beforeReuse, { timeout: 10000 });
await page.waitForSelector('.lines', { timeout: 10000 });
check('« Reprendre » repart d’une liste décochée',
  (await page.locator('.line--done').count()) === 0 && (await page.locator('.line').count()) === 4);
await page.click('[data-goto="#/lists"]');
await page.waitForSelector('.game-card');
check('et les deux listes sont là', (await page.locator('.game-card').count()) === 2,
  String(await page.locator('.game-card').count()));

// les parties n'ont pas bougé
await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/games"]');
await page.waitForSelector('[data-goto="#/new"]');
check('l’onglet Parties fonctionne toujours',
  (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Parties');

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
