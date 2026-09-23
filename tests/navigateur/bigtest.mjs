import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
// Un vrai lecteur de QR, installé hors projet par lancer.sh.
const jsqr = readFileSync(new URL('../../node_modules/jsqr/dist/jsQR.js', import.meta.url), 'utf8');
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|ERR_|404/.test(m.text())) errors.push(m.text()); });
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.click('#lang-toggle');

async function newGame(preset, names, label) {
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForSelector('#new-game');
  await page.selectOption('#preset', preset);
  if (label) await page.fill('#game-name', label);
  for (const [i, n] of names.entries()) {
    if (await page.locator(`[data-name-index="${i}"]`).count()) await page.fill(`[data-name-index="${i}"]`, n);
  }
  await page.click('#new-game button[type=submit]');
  await page.waitForSelector('#round-form');
}
async function addRound(values) {
  const ids = await page.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
  for (const [i, v] of values.entries()) if (ids[i]) await page.fill(`[data-score="${ids[i]}"]`, String(v));
  await page.click('#round-form button[type=submit]');
  if (await page.locator('.dialog--ask').count()) await page.click('[data-answer="yes"]');
  await page.waitForTimeout(120);
}

// --- donneur
await newGame('papayoo', ['Gui', 'Alice', 'Bob'], 'Soirée test');
const dealer1 = await page.locator('#round-form .muted').first().textContent();
await addRound([40, 60, 150]);
const dealer2 = await page.locator('#round-form .muted').first().textContent();
check('le donneur est indiqué', /donner/.test(dealer1), dealer1);
check('et il tourne à la manche suivante', dealer1 !== dealer2, `${dealer1} → ${dealer2}`);

// --- récapitulatif
await addRound([100, 80, 70]);
await page.click('#recap');
await page.waitForSelector('#export-dialog[open]');
const recap = await page.inputValue('#export-text');
check('le récapitulatif nomme les joueurs et les totaux', /Gui/.test(recap) && /140/.test(recap), recap.split('\n').slice(0, 4).join(' / '));
await page.click('#export-close');

// --- exports docx et pdf
for (const [id, ext] of [['#export-docx', 'docx'], ['#export-pdf', 'pdf']]) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.click(id),
  ]);
  check(`le bouton ${ext} télécharge un fichier`, Boolean(download), download?.suggestedFilename());
  if (download) {
    const path = `${(await import('node:os')).tmpdir()}/telecharge.${ext}`;
    await download.saveAs(path);
    const size = readFileSync(path).length;
    check(`le fichier ${ext} n'est pas vide`, size > 1000, `${size} octets`);
  }
}

// --- rejouer
// Rejouer ouvre une nouvelle partie : l'ancienne page a déjà un #round-form.
const beforeReplay = await page.evaluate(() => location.hash);
await page.click('#replay');
await page.waitForFunction((was) => location.hash !== was, beforeReplay, { timeout: 10000 });
await page.waitForSelector('#round-form');
check('rejouer garde les joueurs', (await page.locator('.standing__name').allTextContents()).join(',') === 'Gui,Alice,Bob');
check('rejouer repart de zéro', (await page.locator('table.scores').count()) === 0);

// --- statistiques
await page.evaluate(() => { location.hash = '#/games'; });
await page.waitForSelector('[data-goto="#/stats"]');
await page.click('[data-goto="#/stats"]');
await page.waitForSelector('table.scores');
const stats = await page.locator('table.scores tbody tr').allTextContents();
check('les statistiques listent les joueurs', stats.length >= 3, stats.join(' | '));

// --- recherche
await page.evaluate(() => { location.hash = '#/games'; });
for (const n of ['a', 'b', 'c', 'd']) await newGame('uno', ['X' + n, 'Y' + n], 'Partie ' + n).then(() => addRound([10, 20]));
await page.evaluate(() => { location.hash = '#/games'; });
await page.waitForSelector('#search');
await page.fill('#search', 'Xa');
await page.waitForTimeout(200);
check('la recherche filtre par joueur', (await page.locator('.game-card').count()) === 1, String(await page.locator('.game-card').count()));
await page.fill('#search', '');

// --- QR réellement scannable (le partage de l'app vit dans l'aperçu)
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForSelector('#share-app');
await page.click('#share-app');
// Le bouton ouvre d'abord le choix : app seule, avec toutes les parties, ou une sélection.
await page.waitForSelector('#share-make, #export-dialog[open]');
if (await page.locator('#share-make').count()) await page.click('#share-make');
await page.waitForSelector('#export-dialog[open]');
const link = await page.inputValue('#export-text');
check('un QR est affiché', (await page.locator('#export-qr svg').count()) === 1);
await page.addScriptTag({ content: jsqr });
const decoded = await page.evaluate(async () => {
  const svg = document.querySelector('#export-qr svg').outerHTML;
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, canvas.width, canvas.height);
  const r = window.jsQR(d.data, d.width, d.height);
  return r ? r.data : null;
});
check('le QR affiché se scanne et donne le bon lien', decoded === link, `${decoded} vs ${link}`);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
