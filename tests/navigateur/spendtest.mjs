/**
 * Les dépenses : noter, partager, savoir qui rembourse qui — et ce que le
 * compte refuse de faire parce qu'il ne tomberait plus juste.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const PAGE = 'http://localhost:8099/dist/marque-points.html';
const MARKS = { lists: '#/lists/new', polls: '#/polls/new', games: '#/new', agenda: '#/spends/new' };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null, me = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k, name]) => {
    localStorage.setItem('marque-points:remote:v1', c);
    const prefs = {};
    if (name) prefs.me = name;
    if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }];
    if (Object.keys(prefs).length) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
  }, [CONFIG, key, me]);
  await page.goto(PAGE);
  await page.waitForSelector('.app-bar');
  page.openTab = async (tab) => {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForSelector(`[data-goto="${MARKS[tab]}"]`);
  };
  return page;
}

const page = await device('moi', { key: 'la-cle-famille', me: 'Gui' });

/* ---- 1. un onglet de plus ------------------------------------------------ */

check('quatre onglets, les comptes dans l’Agenda, et ils tiennent sur l’écran',
  (await page.locator('.tab').count()) === 4
  && (await page.locator('[data-tab="agenda"]').textContent()).trim() === 'Agenda');

/* ---- 2. créer un compte -------------------------------------------------- */

await page.openTab('agenda');
check('sans compte, l’onglet dit quoi en faire',
  /Vacances, coloc/.test(await page.locator('#view').textContent()));

await page.click('[data-goto="#/spends/new"]');
await page.waitForSelector('#new-spend');
await page.fill('#spend-name', 'Vacances');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('[data-person-index="1"]', 'Alice');
await page.click('#add-person');
await page.waitForSelector('[data-person-index="2"]');
await page.fill('[data-person-index="2"]', 'Bob');
await page.click('#new-spend button[type=submit]');
await page.waitForSelector('#add-spend', { timeout: 15000 });
check('un compte se crée avec ses personnes',
  (await page.evaluate(() => location.hash)).startsWith('#/spend/')
  && (await page.locator('#spend-by option').count()) === 3);

/* ---- 3. noter des dépenses ----------------------------------------------- */

const spend = async (what, amount, by) => {
  await page.click('[data-spend-tab="expenses"]');
  await page.waitForSelector('#add-spend');
  await page.fill('#spend-text', what);
  await page.fill('#spend-amount', amount);
  await page.selectOption('#spend-by', { label: by });
  await page.click('#add-spend button[type=submit]');
  await page.waitForFunction((text) => [...document.querySelectorAll('.line__text')].some((n) => n.textContent.includes(text)), what);
};
const showBalances = async () => {
  await page.click('[data-spend-tab="balances"]');
  await page.waitForSelector('.entry, .settled-banner');
};

await spend('Gîte', '300', 'Gui');
await spend('Courses', '64,50', 'Alice');

check('les deux dépenses sont là', (await page.locator('.line').count()) === 2);
check('et le total est juste', /364,50/.test(await page.locator('.spread').first().textContent()),
  (await page.locator('.spread').first().textContent()).replace(/\s+/g, ' ').trim());

await showBalances();
const balance = async (name) => (await page.locator('.entry', { hasText: name }).first().locator('.entry__value').textContent()).trim();
check('Gui a avancé, on lui doit', /on lui doit 178,50/.test(await balance('Gui')), await balance('Gui'));
check('Bob n’a rien payé, il doit son tiers', /doit 121,50/.test(await balance('Bob')), await balance('Bob'));

const moves = await page.locator('.section', { hasText: 'Qui rembourse qui' }).locator('.entry').allTextContents();
check('deux virements suffisent, et vers Gui',
  moves.length === 2 && moves.every((line) => /→ Gui/.test(line)), moves.join(' | ').replace(/\s+/g, ' '));

/* ---- 4. une dépense qui ne concerne qu’une partie ------------------------- */

await spend('Taxi', '30', 'Gui');
await page.locator('.line__text', { hasText: 'Taxi' }).click();
await page.waitForSelector('dialog[open] #line-for');
await page.locator('dialog[open] [data-for]').nth(0).click();
await page.locator('dialog[open] [data-for]').nth(2).click();
await page.click('#line-save');
await page.waitForFunction(() => document.querySelector('.line__text')?.textContent.includes('Taxi') || true);
await page.waitForTimeout(300);
check('une dépense peut ne concerner que deux personnes',
  /pour Gui, Bob/.test(await page.locator('.line', { hasText: 'Taxi' }).textContent()),
  (await page.locator('.line', { hasText: 'Taxi' }).textContent()).replace(/\s+/g, ' ').trim());

await showBalances();
check('et Alice n’en paie rien', /doit 57,00/.test(await balance('Alice')), await balance('Alice'));

/* ---- 5. ce que le compte refuse ------------------------------------------ */

await page.click('#spend-people');
await page.waitForSelector('dialog[open] [data-drop]');
await page.locator('dialog[open] .knock', { hasText: 'Alice' }).locator('[data-drop]').click();
await page.waitForSelector('.banner', { timeout: 15000 });
check('on ne retire pas quelqu’un qui a avancé de l’argent',
  /a avancé de l’argent/.test(await page.locator('.banner').first().textContent()),
  (await page.locator('.banner').first().textContent()).slice(0, 60));
check('et personne n’a été retiré', (await page.locator('.entry', { hasText: 'Alice' }).count()) > 0);

/* ---- 6. un montant qui n’en est pas un ----------------------------------- */

await page.click('[data-spend-tab="expenses"]');
await page.waitForSelector('#add-spend');
await page.fill('#spend-text', 'Rien');
await page.fill('#spend-amount', 'douze euros');
await page.click('#add-spend button[type=submit]');
await page.waitForSelector('.banner');
check('un montant illisible est refusé, en disant comment écrire',
  /12,50/.test(await page.locator('.banner').first().textContent()),
  (await page.locator('.banner').first().textContent()).trim());
check('et rien n’a été ajouté', (await page.locator('.line').count()) === 3);

/* ---- 7. le compte remonte partout ---------------------------------------- */

await page.click('.app-bar__brand');
await page.waitForSelector('.tiles');
const tiles = await page.locator('.card', { has: page.locator('.tiles') }).first().locator('.tile__value').allTextContents();
check('le bloc du groupe compte les comptes', tiles.join(',') === '0,0,0,1', tiles.join(','));

await page.evaluate(() => { location.hash = '#/person/Bob'; });
await page.waitForSelector('.who');
const bobBanner = page.locator('.banner').first();
check('et sa page dit ce qu’il doit',
  /doit 136,50/.test(await bobBanner.textContent()),
  (await bobBanner.textContent()).trim());

check('sa page montre le compte',
  /Vacances/.test(await page.locator('.section', { hasText: 'Ses comptes' }).textContent()));

/* ---- 8. partagé, et repris par un autre appareil ------------------------- */

await page.click('[data-tab="agenda"]');
await page.waitForSelector('[data-goto="#/spends/new"]');
await page.click('.game-card');
await page.waitForSelector('#spend-share');
await page.click('#spend-share');
await page.waitForSelector('.banner', { timeout: 15000 });
check('le compte se partage dans le groupe',
  /Mifa/.test(await page.locator('.banner').first().textContent()),
  (await page.locator('.banner').first().textContent()).trim());

const other = await device('autre', { key: 'la-cle-famille', me: 'Bob' });
await other.openTab('agenda');
await other.waitForSelector('.game-card', { timeout: 15000 });
check('un autre appareil du groupe le récupère',
  /Vacances/.test(await other.locator('.game-card').first().textContent()));
check('et y lit ce que lui doit',
  /vous devez 136,50/.test(await other.locator('.game-card').first().textContent()),
  (await other.locator('.game-card').first().textContent()).replace(/\s+/g, ' ').trim());

// et ce qu'il note arrive chez moi
await other.click('.game-card');
await other.waitForSelector('#add-spend');
await other.fill('#spend-text', 'Essence');
await other.fill('#spend-amount', '60');
await other.selectOption('#spend-by', { label: 'Bob' });
await other.click('#add-spend button[type=submit]');
await other.waitForFunction(() => [...document.querySelectorAll('.line__text')].some((n) => n.textContent.includes('Essence')));

await page.reload();
await page.waitForSelector('#add-spend', { timeout: 15000 });
const seen = await page.waitForFunction(
  () => [...document.querySelectorAll('.line__text')].some((n) => n.textContent.includes('Essence')),
  null, { timeout: 20000 },
).then(() => true).catch(() => false);
check('ce que l’autre note arrive ici, sans chasser le reste', seen);
check('et les quatre dépenses tiennent ensemble', (await page.locator('.line').count()) === 4);

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
