/**
 * La première ouverture — ce que l'app fait, un prénom, par où commencer — et
 * un compte tenu dans une autre monnaie que l'euro, dont le formulaire se
 * replie une fois la première dépense notée.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((c) => { try { if (!sessionStorage.getItem('vu')) { localStorage.setItem('marque-points:remote:v1', c); sessionStorage.setItem('vu', '1'); } } catch {} }, CONFIG);
await page.goto('http://localhost:8099/dist/marque-points.html#/');
await page.waitForSelector('.welcome');

/* --- 1. la bienvenue --------------------------------------------------- */

check('la première ouverture souhaite la bienvenue', (await page.locator('.welcome h2').textContent()).trim() === 'Bienvenue');
check('sans sections vides en dessous', (await page.locator('#view .section').count()) === 0);
const starts = (await page.locator('.welcome [data-goto]').allTextContents()).map((s) => s.trim());
check('quatre façons de commencer', starts.join(' / ') === 'Rejoindre ou créer un groupe / Trouver une date / Faire une liste / Partager des dépenses', starts.join(' / '));
await page.fill('#me-name', 'Gui');
await page.click('#me-save');
await page.waitForFunction(() => /Bonjour Gui/.test(document.querySelector('.welcome')?.textContent || ''));
check('le prénom se donne sur place', true);

/* --- 2. un compte en livres -------------------------------------------- */

await page.click('.welcome [data-goto="#/spends/new"]');
await page.waitForSelector('#spend-currency');
await page.fill('#spend-name', 'Londres');
await page.selectOption('#spend-currency', 'GBP');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('[data-person-index="1"]', 'Léa');
await page.click('#new-spend button[type=submit]');
await page.waitForSelector('#spend-text');
check('le montant se tape en livres', (await page.locator('.field-pill__suffix').textContent()).includes('£'));
await page.fill('#spend-text', 'Pub');
await page.fill('#spend-amount', '42,30');
await page.click('#add-spend button[type=submit]');
await page.waitForSelector('#spend-add-open');
check('après la première dépense, le formulaire se replie', (await page.locator('#add-spend').count()) === 0);
check('et la dépense se lit en livres', /42,30\s?£/.test(await page.locator('.line__amount').first().textContent()),
  await page.locator('.line__amount').first().textContent());
await page.click('#spend-add-open');
await page.waitForSelector('#spend-text');
check('« Noter une dépense » le rouvre', (await page.locator('#add-spend').count()) === 1);

await page.goto('http://localhost:8099/dist/marque-points.html#/');
await page.waitForSelector('.game-card');
check('l’accueil dit ce qu’on vous doit, en livres', /21,15\s?£/.test(await page.locator('#view').textContent()));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
