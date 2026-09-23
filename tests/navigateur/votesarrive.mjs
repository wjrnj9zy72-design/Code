/** Les votes des autres arrivent chez l'organisateur, et aucun ne se perd en route. */
import { chromium } from 'playwright';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];
async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, p]) => {
    localStorage.setItem('marque-points:remote:v1', c);
    if (p && !localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
  }, [CONFIG, prefs]);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}
const namesWithYes = (page, where) => page.evaluate(async ([w]) => {
  let p;
  if (w === 'base') {
    const cfg = JSON.parse(localStorage.getItem('marque-points:remote:v1'));
    const id = JSON.parse(localStorage.getItem('marque-points:polls:v1'))[0].id;
    const r = await fetch(`${cfg.url}/rest/v1/rpc/marque_points_get`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key, authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ p_id: id }) });
    p = await r.json();
  } else {
    p = JSON.parse(localStorage.getItem('marque-points:polls:v1'))[0];
  }
  return Object.entries(p.votes || {}).filter(([, v]) => v?.v === 'yes').map(([k]) => p.people.find((x) => x.id === k.split('|')[0])?.name).sort().join(',');
}, [where]);

// L'organisateur, un sondage « lien seulement », partagé.
const me = await device('Gui', { me: 'Gui', groups: [MIFA] });
await me.click('.tab[data-tab="polls"]'); await me.click('[data-goto="#/polls/new"]'); await me.waitForSelector('#new-poll');
await me.click('[data-new-group="@lien"]'); await me.waitForTimeout(200);
await me.fill('#poll-question', 'Quel soir ?'); await me.fill('#poll-choices', 'vendredi\nsamedi');
await me.fill('[data-person-index="0"]', 'Gui');
await me.click('#new-poll button[type=submit]'); await me.waitForSelector('#poll-share');
await me.click('#poll-share'); await me.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await me.inputValue('#export-text'); await me.click('#export-close');
await me.click('.tab[data-tab="polls"]');

// Paul et Léa, par le lien.
for (const [name, row] of [['Paul', 1], ['Léa', 0]]) {
  const guest = await device(name, null);
  await guest.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
  await guest.waitForSelector('#solo-me');
  await guest.fill('#solo-me', name); await guest.click('#solo-me-form button[type=submit]'); await guest.waitForTimeout(600);
  await guest.locator('.votes tbody tr').nth(row).locator('td.votes__mine .vote').click();
  await guest.waitForTimeout(800);
}
check('les deux votes sont dans la base', (await namesWithYes(me, 'base')) === 'Léa,Paul', await namesWithYes(me, 'base'));

// L'organisateur ouvre le sondage et coche aussitôt, avant toute relève.
await me.locator('.game-card').first().click(); await me.waitForSelector('.votes');
await me.locator('[data-me]', { hasText: 'Gui' }).click(); await me.waitForTimeout(100);
await me.locator('.votes tbody tr').nth(0).locator('td.votes__mine .vote').click();
await me.waitForTimeout(1200);
check('son coché n’efface pas ceux de Paul et Léa, dans la base', (await namesWithYes(me, 'base')) === 'Gui,Léa,Paul', await namesWithYes(me, 'base'));
check('et il les a chez lui', (await namesWithYes(me, 'local')) === 'Gui,Léa,Paul', await namesWithYes(me, 'local'));
const heads = (await me.locator('.votes thead th').allTextContents()).map((s) => s.trim());
check('avec leurs colonnes', heads.includes('Paul') && heads.includes('Léa'), heads.join(' | '));

// Un « lien seulement » se rattrape aussi hors de sa page.
await me.click('.tab[data-tab="polls"]');
const late = await device('Karim', null);
await late.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await late.waitForSelector('#solo-me');
await late.fill('#solo-me', 'Karim'); await late.click('#solo-me-form button[type=submit]'); await late.waitForTimeout(600);
await late.locator('.votes tbody tr').nth(1).locator('td.votes__mine .vote').click();
await late.waitForTimeout(800);
await me.evaluate(() => { window.__t = Date.now(); });
const arrived = await me.waitForFunction(() => {
  const p = JSON.parse(localStorage.getItem('marque-points:polls:v1'))[0];
  return p.people.some((x) => x.name === 'Karim');
}, null, { timeout: 30000 }).then(() => true).catch(() => false);
check('le vote de Karim arrive, liste des sondages restée ouverte', arrived);

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
