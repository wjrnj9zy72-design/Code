/**
 * Les résultats et le prénom : ce qui revient tout seul, et ce qui demande un
 * geste. Une partie garde ses joueurs ; les statistiques, elles, regroupent par
 * prénom — donc « Alex » revenu en « Alexandre » se répare d'une touche.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' })).newPage();
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto('http://localhost:8099/dist/marque-points.html');
await page.waitForSelector('.app-bar');

const play = async (names) => {
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForSelector('#new-game');
  await page.selectOption('#preset', 'papayoo');
  for (const [i, n] of names.entries()) await page.fill(`[data-name-index="${i}"]`, n);
  await page.click('#new-game button[type=submit]');
  await page.waitForSelector('#round-form');
  const ids = await page.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
  for (const [i, v] of ['40', '60', '150'].entries()) await page.fill(`[data-score="${ids[i]}"]`, v);
  await page.click('#round-form button[type=submit]');
  await page.waitForSelector('table.scores');
};

// Deux soirées, le même prénom écrit différemment, et une troisième sous un autre.
await play(['alice', 'Bob', 'Claire']);
await play(['  Alice', 'Bob', 'Claire']);
await play(['Alex', 'Bob', 'Claire']);

await page.evaluate(() => { location.hash = '#/stats'; });
await page.waitForSelector('table');
const namesShown = await page.locator('tbody td:first-child').allTextContents();
const cleaned = namesShown.map((n) => n.replace(/[✎\s]+/g, ' ').trim());
check('« alice » et « Alice » ne font qu’une personne',
  cleaned.filter((n) => /^Alice$/i.test(n)).length === 1, cleaned.join(' | '));
check('et c’est la dernière orthographe qui s’affiche', cleaned.includes('Alice'), cleaned.join(' | '));
check('« Alex » reste une personne à part', cleaned.includes('Alex'), cleaned.join(' | '));

const linesFor = async (name) => {
  const row = page.locator('tbody tr', { hasText: name }).first();
  return (await row.locator('td').allTextContents()).map((t) => t.trim());
};
const aliceRow = await linesFor('Alice');
check('avec ses deux parties comptées', aliceRow[1] === '2', aliceRow.join(' / '));

/* --- Alex revenu sous « Alexandre » : on réunit d'une touche --------------- */

await play(['Alexandre', 'Bob', 'Claire']);
await page.evaluate(() => { location.hash = '#/stats'; });
await page.waitForSelector('table');
const before = (await page.locator('tbody td:first-child').allTextContents()).map((n) => n.replace(/[✎\s]+/g, ' ').trim());
check('au départ, deux lignes pour une personne',
  before.includes('Alex') && before.includes('Alexandre'), before.join(' | '));

await page.locator('[data-rename-everywhere="Alex"]').click();
await page.waitForSelector('#asked-text');
check('le dialogue explique pourquoi', /prénom relie une personne/.test(
  await page.locator('dialog[open] p').textContent()),
  (await page.locator('dialog[open] p').textContent()).trim());
await page.fill('#asked-text', 'Alexandre');
await page.click('#asked-ok');
await page.waitForSelector('.banner', { timeout: 15000 });
check('renommer partout le dit', /documents? renommé/.test(await page.locator('.banner').textContent()),
  await page.locator('.banner').textContent());

const after = (await page.locator('tbody td:first-child').allTextContents()).map((n) => n.replace(/[✎\s]+/g, ' ').trim());
check('et les deux lignes n’en font plus qu’une',
  !after.includes('Alex') && after.includes('Alexandre'), after.join(' | '));
const alexandre = await linesFor('Alexandre');
check('avec ses deux parties réunies', alexandre[1] === '2', alexandre.join(' / '));

// La partie elle-même a suivi : le nom a changé dans son tableau.
await page.evaluate(() => { location.hash = '#/games'; });
await page.waitForSelector('.game-card');
await page.locator('.game-card').first().click();
await page.waitForSelector('table.scores');
check('et la partie elle-même porte le nouveau prénom',
  (await page.locator('table.scores').textContent()).includes('Alexandre'));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
