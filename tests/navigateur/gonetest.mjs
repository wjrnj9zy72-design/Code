/** Audit : ce qui est supprimé ne revient pas ; hors réseau n'est pas « supprimé » ; l'invitation ne double pas son lien. */
import { chromium } from 'playwright';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const COPAINS = { id: 'grp_copains', name: 'Copains du mardi', key: 'la-cle-copains', admits: true };
const PAGE = 'http://localhost:8099/dist/marque-points.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];
async function device(label, prefs, { shares = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1100 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, p, s]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (p && !localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    } catch {}
    if (s) {
      window.__shared = [];
      navigator.share = async (data) => { window.__shared.push(data); };
    }
  }, [CONFIG, prefs, shares]);
  await page.goto(PAGE);
  await page.waitForSelector('.app-bar');
  return page;
}
const db = async (fn, body) => (await fetch(`http://127.0.0.1:8123/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: 'test-anon-key', 'content-type': 'application/json' }, body: JSON.stringify(body),
})).text();

// --- Gui crée un sondage dans Mifa et l'envoie
const gui = await device('Gui', { me: 'Gui', groups: [MIFA] });
await gui.click('[data-tab="home"]'); await gui.click('.segmented--kinds [data-goto="#/polls"]'); await gui.click('[data-goto="#/polls/new"]'); await gui.waitForSelector('#new-poll');
await gui.fill('#poll-question', 'Secret de famille ?');
await gui.fill('#poll-choices', 'vendredi\nsamedi');
await gui.fill('[data-person-index="0"]', 'Gui');
await gui.fill('[data-person-index="1"]', 'Paul');
await gui.click('#new-poll button[type=submit]');
await gui.waitForSelector('.votes');
const pollId = await gui.evaluate(() => location.hash.split('/')[2]);
await gui.waitForTimeout(800);
check('le sondage est dans la base', (await db('marque_points_get', { p_id: pollId })).includes('Secret de famille'));

// --- Paul, qui n'est que dans « Copains », l'ouvre par le lien et vote
const paul = await device('Paul', { me: 'Paul', groups: [COPAINS] });
await paul.goto(`${PAGE}#/poll/${pollId}/solo`);
await paul.waitForSelector('.votes', { timeout: 15000 });
await paul.locator('[data-me]', { hasText: 'Paul' }).click(); await paul.waitForTimeout(300);
await paul.locator('.votes tbody tr').nth(0).locator('td.votes__mine .vote').click();
await paul.waitForTimeout(800);
check('Paul vote', (await db('marque_points_get', { p_id: pollId })).includes('"yes"'));

// --- Gui le supprime
await gui.click('#poll-delete');
await gui.locator('dialog[open] button', { hasText: 'Supprimer' }).first().click();
await gui.waitForTimeout(800);
check('supprimé de la base', (await db('marque_points_get', { p_id: pollId })) === 'null');

// --- Paul, qui l'avait encore à l'écran, coche une autre case
// (le guet le verrait disparaître : on le coupe pour jouer le téléphone resté en veille)
await paul.evaluate(() => { for (let i = 1; i < 99999; i += 1) clearInterval(i); });
await paul.locator('.votes tbody tr').nth(1).locator('td.votes__mine .vote').click();
await paul.waitForTimeout(1500);
check('le coché de Paul ne le recrée pas', (await db('marque_points_get', { p_id: pollId })) === 'null');
const docs = await db('marque_points_group_docs', { p_key: 'la-cle-copains' });
check('ni dans son groupe à lui', !docs.includes(pollId), docs);
const paulText = (await paul.locator('#view').textContent()).replace(/\s+/g, ' ');
check('et son écran dit qu’il n’existe plus', /n’existe plus/.test(paulText), paulText.slice(0, 120));
check('sa copie est retirée de l’appareil',
  await paul.evaluate((id) => !(localStorage.getItem('marque-points:polls:v1') || '').includes(id), pollId));

// --- Hors réseau : le visiteur n'entend pas « n'existe plus »
const gui2 = gui;
await gui2.click('[data-tab="home"]'); await gui2.click('.segmented--kinds [data-goto="#/polls"]'); await gui2.click('[data-goto="#/polls/new"]'); await gui2.waitForSelector('#new-poll');
await gui2.fill('#poll-question', 'Quel soir ?');
await gui2.fill('#poll-choices', 'lundi\nmardi');
await gui2.fill('[data-person-index="0"]', 'Gui');
await gui2.click('#new-poll button[type=submit]');
await gui2.waitForSelector('.votes');
const second = await gui2.evaluate(() => location.hash.split('/')[2]);
await gui2.waitForTimeout(800);
const zoeCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'fr-FR' });
await zoeCtx.addInitScript((c) => localStorage.setItem('marque-points:remote:v1', c), CONFIG);
const zoe = await zoeCtx.newPage();
zoe.on('pageerror', (e) => errors.push(`Zoé: ${e.message}`));
await zoe.route('http://127.0.0.1:8123/**', (route) => route.abort('internetdisconnected'));
await zoe.goto(`${PAGE}#/poll/${second}/solo`);
await zoe.waitForSelector('#poll-retry', { timeout: 15000 }).catch(() => {});
const zoeText = (await zoe.locator('#view').textContent()).replace(/\s+/g, ' ');
check('hors réseau, le visiteur lit « pas de réseau »', /pas de réseau/.test(zoeText) && !/n’existe plus/.test(zoeText), zoeText.slice(0, 120));
await zoe.unroute('http://127.0.0.1:8123/**');
await zoe.click('#poll-retry');
const back = await zoe.waitForSelector('.votes', { timeout: 15000 }).then(() => true).catch(() => false);
check('et « Réessayer » ouvre le sondage une fois le réseau revenu', back);

// --- L'invitation : le lien n'est donné qu'une fois
const inv = await device('Invite', { me: 'Gui', groups: [MIFA] }, { shares: true });
await inv.click('[data-tab="groups"]');
await inv.waitForSelector('[data-invite]');
await inv.click('[data-invite]');
await inv.waitForSelector('#invite-open', { timeout: 15000 });
await inv.click('#invite-open');
await inv.waitForTimeout(1500);
const shared = await inv.evaluate(() => window.__shared);
const data = shared?.[0] || {};
const linkCount = (JSON.stringify(data).match(/#\/join\//g) || []).length;
check('l’invitation part avec son lien une seule fois', linkCount === 1, JSON.stringify(data).slice(0, 200));
check('et le message entier', /Nom : Mifa/.test(data.text || '') && /Code : \d{6}/.test(data.text || ''));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL|Failed to fetch|ERR_INTERNET/.test(e)));
await browser.close();
