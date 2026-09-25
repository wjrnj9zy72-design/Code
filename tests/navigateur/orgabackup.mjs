/** Le droit d'organisateur voyage dans l'export, et revient par l'import. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const PAGE = 'http://localhost:8099/dist/marque-points.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];
async function device(label, prefs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, locale: 'fr-FR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, p]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (p && !localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    } catch {}
  }, [CONFIG, prefs]);
  await page.goto(PAGE);
  await page.waitForSelector('.app-bar');
  return page;
}
const db = async (fn, body) => JSON.parse(await (await fetch(`http://127.0.0.1:8123/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: 'test-anon-key', 'content-type': 'application/json' }, body: JSON.stringify(body),
})).text() || 'null');

// --- Gui crée un sondage : il l'organise
const gui = await device('Gui', { me: 'Gui', groups: [MIFA] });
await gui.click('[data-tab="home"]'); await gui.click('.segmented--kinds [data-goto="#/polls"]'); await gui.click('[data-goto="#/polls/new"]'); await gui.waitForSelector('#new-poll');
await gui.fill('#poll-question', 'Quel soir pour la raclette ?');
await gui.fill('#poll-choices', 'vendredi\nsamedi');
await gui.fill('[data-person-index="0"]', 'Gui');
await gui.fill('[data-person-index="1"]', 'Claire');
await gui.click('#new-poll button[type=submit]');
await gui.waitForSelector('#poll-close');
const pollId = await gui.evaluate(() => location.hash.split('/')[2]);
await gui.waitForTimeout(800);

// --- Réglages le rappelle, et l'export le porte
await gui.click('[data-tab="settings"]').catch(() => gui.goto(`${PAGE}#/settings`));
await gui.waitForSelector('#export');
const hint = (await gui.locator('#organiser-backup').textContent().catch(() => '')).replace(/\s+/g, ' ');
check('Réglages dit que le droit ne vit qu’ici, et comment le garder', /organisez 1 sondage/.test(hint) && /Exporter/.test(hint), hint);
const [download] = await Promise.all([gui.waitForEvent('download'), gui.click('#export')]);
const file = `${(await import('node:os')).tmpdir()}/orga-backup.json`;
await download.saveAs(file);
const exported = JSON.parse(await readFile(file, 'utf8'));
const secret = await gui.evaluate((id) => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).organiser[id], pollId);
check('l’export porte le secret d’organisateur du sondage', exported.organiser?.[pollId] === secret && secret?.length >= 16);
check('mais toujours pas les clés de groupe', !JSON.stringify(exported).includes('la-cle-famille'));

// --- nouveau téléphone : le groupe ramène le sondage, pas le droit
const neuf = await device('Gui-neuf', { me: 'Gui', groups: [MIFA] });
await neuf.click('#sync'); await neuf.waitForTimeout(1500);
await neuf.evaluate((id) => { location.hash = `#/poll/${id}`; }, pollId);
await neuf.waitForSelector('.votes', { timeout: 15000 });
check('sur le nouveau téléphone, sans sauvegarde, plus de clôture possible', (await neuf.locator('#poll-close').count()) === 0);

// --- import de la sauvegarde
await neuf.goto(`${PAGE}#/settings`); await neuf.waitForSelector('#import-file', { state: 'attached' });
await neuf.setInputFiles('#import-file', file);
await neuf.waitForTimeout(800);
const said = (await neuf.locator('#view').textContent()).replace(/\s+/g, ' ');
check('l’import dit que vous organisez de nouveau', /vous organisez de nouveau 1 sondage/.test(said), said.slice(0, 200));
await neuf.evaluate((id) => { location.hash = `#/poll/${id}`; }, pollId);
await neuf.waitForSelector('.votes', { timeout: 15000 });
check('le sondage se règle de nouveau', (await neuf.locator('#poll-close').count()) === 1);
await neuf.click('#poll-close'); await neuf.waitForTimeout(1200);
const stored = await db('marque_points_get', { p_id: pollId });
check('et la base accepte sa clôture : c’est bien le même organisateur', Boolean(stored?.closedAt), JSON.stringify(stored?.closedAt));

// --- un fichier trafiqué n'écrase pas un secret déjà là
const forged = { ...exported, organiser: { [pollId]: 'f'.repeat(32), autre: '<script>' } };
await neuf.goto(`${PAGE}#/settings`); await neuf.waitForSelector('#import-file', { state: 'attached' });
await neuf.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(forged)) });
await neuf.waitForTimeout(500);
const after = await neuf.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).organiser);
check('un secret déjà là n’est pas remplacé', after[pollId] === secret);
check('et un secret mal formé est ignoré', !('autre' in after));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
