import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8124', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const page = await browser.newPage({ viewport: { width: 430, height: 950 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((c) => {
  try {
    localStorage.setItem('marque-points:remote:v1', c);
    if (!localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }], me: 'Gui' }));
  } catch {}
}, CONFIG);
await page.goto('http://localhost:8099/dist/marque-points.html'); 
await page.waitForSelector('.app-bar');

// une partie, puis on tente un lot sur une base pas encore mise à jour
await page.evaluate(() => { location.hash = '#/new'; });
await page.waitForSelector('#new-game');
await page.selectOption('#preset', 'papayoo');
for (const [i, n] of ['Gui', 'Alice', 'Bob'].entries()) await page.fill(`[data-name-index="${i}"]`, n);
await page.click('#new-game button[type=submit]');
await page.waitForSelector('#round-form');
await page.evaluate(() => { location.hash = '#/games'; });
await page.waitForSelector('.game-card');

// une base pas à jour ne reconnaît aucun groupe
await page.evaluate(() => { location.hash = '#/groups'; });
await page.waitForSelector('#group-name');
await page.fill('#group-name', 'Mifa');
await page.fill('#group-code', '123456');
await page.click('#group-join');
await page.waitForTimeout(1500);
const state = await page.locator('#group-state').textContent();
check('une base pas à jour ne fait entrer dans aucun groupe',
  !/Vous êtes dans|You are in/.test(state), state);

await page.evaluate(() => { location.hash = '#/settings'; });
await page.waitForSelector('#share-app');
await page.click('#share-app');
await page.waitForSelector('#share-make');
await page.check('input[name="share-kind"][value="all"]');
await page.click('#share-make');
await page.waitForSelector('#share-error:not([hidden])', { timeout: 15000 });
const message = await page.locator('#share-error').textContent();
check('la base pas à jour est nommée comme telle', /2 bis|2b|SQL/.test(message), message);
check('et le bouton redevient actif', await page.locator('#share-make').isEnabled());
await page.click('#share-cancel');

// inviter sur une base pas à jour : c'est le premier geste de quelqu'un qui a
// mis l'app à jour sans avoir repassé le SQL.
await page.evaluate(() => { location.hash = '#/groups'; });
await page.waitForSelector('[data-invite]');
await page.click('[data-invite]');
await page.waitForSelector('#invite-open', { timeout: 15000 });
await page.click('#invite-open');
await page.waitForSelector('.banner', { timeout: 15000 });
const inviting = await page.locator('.banner').textContent();
check('inviter sur une base pas à jour renvoie à l’étape SQL', /2 bis|2b|SQL/.test(inviting), inviting);

// et frapper à une porte que la base ne connaît pas encore
await page.fill('#group-name', 'Mifa');
await page.fill('#group-code', '123456');
await page.click('#group-join');
await page.waitForTimeout(1500);
const knocking = await page.locator('#group-state').textContent();
check('frapper non plus ne laisse pas croire que c’est entré',
  !/Demande envoyée|Request sent/.test(knocking), knocking);

// et ouvrir un lot sur une base pas à jour
await page.goto('http://localhost:8099/dist/marque-points.html#/set/lot_quelconque_ici');
await page.waitForSelector('#lot-code', { timeout: 15000 });
await page.fill('#lot-code', '123456');
await page.click('#lot-open');
await page.waitForSelector('#lot-error:not([hidden])', { timeout: 15000 });
const opening = await page.locator('#lot-error').textContent();
check('ouvrir un lot sur une base pas à jour le dit aussi', /2 bis|2b|SQL/.test(opening), opening);

/* --- et ce que voit un simple membre, qui ne peut rien lancer en SQL ------- */

const member = await (await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' })).newPage();
await member.addInitScript((c) => {
  localStorage.setItem('marque-points:remote:v1', c);
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
    me: 'Alice',
    // une clé ordinaire : elle ne fait entrer personne, donc rien à lancer en SQL
    groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: false }],
  }));
}, CONFIG);
await member.goto('http://localhost:8099/dist/marque-points.html');
await member.waitForSelector('.app-bar');
// Un lot ne se propose que s'il y a quelque chose à mettre dedans.
await member.evaluate(() => { location.hash = '#/new'; });
await member.waitForSelector('#new-game');
await member.selectOption('#preset', 'papayoo');
for (const [i, n] of ['Alice', 'Bob', 'Claire'].entries()) await member.fill(`[data-name-index="${i}"]`, n);
await member.click('#new-game button[type=submit]');
await member.waitForSelector('#round-form');
await member.evaluate(() => { location.hash = '#/settings'; });
await member.waitForSelector('#share-app');
await member.click('#share-app');
await member.waitForSelector('#share-make');
await member.check('input[name="share-kind"][value="all"]');
await member.click('#share-make');
await member.waitForSelector('#share-error:not([hidden])', { timeout: 15000 });
const seen = await member.locator('#share-error').textContent();
check('un membre est renvoyé vers la mise à jour, pas vers l’éditeur SQL',
  /mise à jour/.test(seen) && !/étape 2 bis/.test(seen), seen);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors);
await browser.close();
