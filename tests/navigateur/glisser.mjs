/**
 * Glisser pour supprimer, partout comme dans les idées : les lignes d'une
 * liste, les dépenses d'un compte, et les documents dans leur onglet.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const PAGE = 'http://localhost:8099/dist/marque-points.html';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ me: 'Gui' })));
await page.goto(PAGE);
await page.waitForSelector('.app-bar');

/** Glisser vers la gauche, à la souris (les mêmes événements qu'au doigt). */
async function swipe(target, fraction = 0.6) {
  const box = await target.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 10, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + box.width - 10 - (box.width * fraction * i) / 10, y);
  await page.mouse.up();
  await page.waitForTimeout(250);
}
const isOpen = (row) => row.evaluate((n) => n.classList.contains('swipe--open'));

/* ---- 1. une ligne de liste ----------------------------------------------- */

await page.evaluate(() => { location.hash = '#/lists/new'; });
await page.waitForSelector('#new-list');
await page.fill('#list-name', 'Courses');
await page.fill('#list-lines', 'Pain\nLait\nŒufs');
await page.click('#new-list button[type=submit]');
await page.waitForSelector('.lines');
check('trois lignes', (await page.locator('.lines .line').count()) === 3);

const row = page.locator('.lines .swipe', { hasText: 'Lait' });
await swipe(row.locator('.swipe__body'));
check('une ligne glissée découvre « Supprimer »', await isOpen(row));
check('sans ouvrir la ligne', (await page.locator('dialog[open]').count()) === 0);
await row.locator('.swipe__delete').click();
await page.waitForFunction(() => document.querySelectorAll('.lines .line').length === 2);
check('et la ligne part', !/Lait/.test(await page.locator('.lines').textContent()));

// Cocher une ligne marche toujours : un toucher n'est pas un glissement.
await page.locator('.lines [data-tick]').first().check();
await page.waitForFunction(() => document.querySelector('.lines .line--done'));
check('cocher une ligne marche toujours', (await page.locator('.lines .line--done').count()) === 1);

/* ---- 2. une dépense ------------------------------------------------------ */

await page.evaluate(() => { location.hash = '#/spends/new'; });
await page.waitForSelector('#new-spend');
await page.fill('#spend-name', 'Vacances');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('[data-person-index="1"]', 'Alice');
await page.click('#new-spend button[type=submit]');
await page.waitForSelector('#add-spend, #spend-add-open');
for (const [what, amount] of [['Gîte', '300'], ['Courses', '40']]) {
  if (await page.locator('#spend-add-open').count()) await page.click('#spend-add-open');
  await page.fill('#spend-text', what);
  await page.fill('#spend-amount', amount);
  await page.click('#add-spend button[type=submit]');
  await page.waitForFunction((text) => [...document.querySelectorAll('.line__text')].some((n) => n.textContent.includes(text)), what);
}
const expense = page.locator('.lines .swipe', { hasText: 'Courses' });
await swipe(expense.locator('.swipe__body'));
await expense.locator('.swipe__delete').click();
await page.waitForFunction(() => document.querySelectorAll('.lines .line').length === 1);
check('une dépense se glisse et se supprime', !/Courses/.test(await page.locator('.lines').textContent()));
check('et le total suit', /300,00/.test(await page.locator('.spread').first().textContent()));

/* ---- 3. les documents dans leur onglet ----------------------------------- */

async function deleteFromTab(hash, name) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector('.game-list .swipe');
  const card = page.locator('.game-list .swipe', { hasText: name }).first();
  await swipe(card.locator('.swipe__body'));
  check(`${hash} : la carte glissée découvre « Supprimer »`, await isOpen(card));
  check(`${hash} : sans ouvrir le document`, (await page.evaluate(() => location.hash)) === hash);
  await card.locator('.swipe__delete').click();
  await page.waitForSelector('.dialog--ask');
  await page.click('.dialog--ask [data-answer="yes"]');
  await page.waitForFunction((text) => !document.querySelector('#view .game-list')?.textContent.includes(text), name);
  check(`${hash} : on demande, puis il part`, /supprimé/.test(await page.locator('.banner').first().textContent()),
    (await page.locator('.banner').first().textContent()).trim());
}

await deleteFromTab('#/spends', 'Vacances');
await deleteFromTab('#/lists', 'Courses');

await page.evaluate(() => { location.hash = '#/polls/new'; });
await page.waitForSelector('#new-poll');
await page.fill('#poll-question', 'Quel film ?');
await page.fill('#poll-choices', 'Dune\nAlien');
await page.click('#new-poll button[type=submit]');
await page.waitForFunction(() => location.hash.startsWith('#/poll/'));
await deleteFromTab('#/polls', 'Quel film');

// Un sondage organisé par quelqu'un d'autre ne se glisse pas.
await page.evaluate(() => {
  const polls = JSON.parse(localStorage.getItem('marque-points:polls:v1') || '[]');
  polls.push({
    id: 'p_de_quelqu_un', kind: 'poll', question: 'Pas à moi', options: [{ id: 'c1', text: 'Oui' }],
    people: [], votes: {}, createdAt: Date.now(), updatedAt: Date.now(), owned: true, shared: true, removed: {},
  });
  localStorage.setItem('marque-points:polls:v1', JSON.stringify(polls));
});
await page.reload();
await page.evaluate(() => { location.hash = '#/polls'; });
await page.waitForSelector('.game-card');
check('un sondage organisé ailleurs ne se glisse pas',
  (await page.locator('.game-card', { hasText: 'Pas à moi' }).count()) === 1
  && (await page.locator('.swipe', { hasText: 'Pas à moi' }).count()) === 0);

/* ---- 4. un petit glissement, ou un défilement, n'ouvre rien -------------- */

await page.evaluate(() => { location.hash = '#/lists/new'; });
await page.waitForSelector('#new-list');
await page.fill('#list-name', 'Valise');
await page.click('#new-list button[type=submit]');
await page.waitForSelector('#new-line, .lines, #add-line');
await page.evaluate(() => { location.hash = '#/lists'; });
await page.waitForSelector('.game-list .swipe');
const valise = page.locator('.game-list .swipe', { hasText: 'Valise' });
await swipe(valise.locator('.swipe__body'), 0.1);
check('un petit glissement ne découvre rien', !(await isOpen(valise)));
await valise.locator('.swipe__body').click();
await page.waitForFunction(() => location.hash.startsWith('#/list/'));
check('et toucher la carte l’ouvre toujours', true);

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
