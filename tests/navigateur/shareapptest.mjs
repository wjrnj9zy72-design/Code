import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const APP = 'http://localhost:8099/dist/marque-points.html?x=1#/game/ignoré';

// 1. Avec la feuille de partage du système
const ctx1 = await browser.newContext();
const p1 = await ctx1.newPage();
p1.on('pageerror', (e) => errors.push(String(e)));
await p1.addInitScript(() => {
  window.__shared = null;
  navigator.share = async (data) => { window.__shared = data; };
});
await p1.goto(APP);
await p1.evaluate(() => { location.hash = '#/'; });
await p1.waitForSelector('#share-app');
await p1.click('#share-app');
await p1.waitForTimeout(200);
const shared = await p1.evaluate(() => window.__shared);
check('la feuille de partage est utilisée', Boolean(shared), JSON.stringify(shared));
check("l'URL partagée est celle de l'app, sans la partie ouverte",
  shared?.url === 'http://localhost:8099/dist/marque-points.html?x=1', shared?.url);
check('aucune fenêtre de copie ne s’ouvre en plus', (await p1.locator('#export-dialog[open]').count()) === 0);

// 2. Quand l'utilisateur annule le partage
await p1.evaluate(() => {
  navigator.share = async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; };
});
await p1.click('#share-app');
await p1.waitForTimeout(200);
check('annuler ne montre rien', (await p1.locator('#export-dialog[open]').count()) === 0);

// 3. Quand la feuille de partage échoue pour une autre raison
await p1.evaluate(() => { navigator.share = async () => { throw new Error('boom'); }; });
await p1.click('#share-app');
await p1.waitForSelector('#export-dialog[open]');
check('un échec bascule sur la copie', (await p1.inputValue('#export-text')) === 'http://localhost:8099/dist/marque-points.html?x=1');
await p1.click('#export-close');

// 4. Sur un navigateur sans feuille de partage (ordinateur)
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(String(e)));
await p2.addInitScript(() => { try { delete Navigator.prototype.share; } catch {} });
await p2.goto('http://localhost:8099/dist/marque-points.html');
await p2.waitForSelector('#share-app');
await p2.click('#share-app');
await p2.waitForSelector('#export-dialog[open]');
check('sans feuille de partage, la copie s’ouvre directement',
  (await p2.inputValue('#export-text')) === 'http://localhost:8099/dist/marque-points.html',
  await p2.inputValue('#export-text'));
const hintEn = await p2.locator('#export-hint').textContent();
check('le texte explique ce que reçoit la personne (en anglais ici)',
  hintEn.includes('their own games'), hintEn);
await p2.click('#export-close');
await p2.click('#lang-toggle');
await p2.click('#share-app');
await p2.waitForSelector('#export-dialog[open]');
const hintFr = await p2.locator('#export-hint').textContent();
check('et en français aussi', hintFr.includes('ses propres parties'), hintFr);
await p2.click('#export-copy');
await p2.waitForTimeout(700);
check('le bouton Copier répond', (await p2.locator('#export-copy').textContent()) !== 'Copier');

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/TUNNEL|ERR_/.test(e)));
await browser.close();
