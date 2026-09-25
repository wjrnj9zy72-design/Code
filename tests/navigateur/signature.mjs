/** « Proposé par … » : un surnom par liste ou sondage, retenu pour les suivants, modifiable à tout moment. */
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
const signedText = async (page) => ((await page.locator('#view .signed').first().textContent().catch(() => '')) || '').trim();
const setSignature = async (page, button, name, remember = true) => {
  await page.click(button);
  await page.waitForSelector('dialog[open] #sign-name');
  await page.fill('#sign-name', name);
  const box = page.locator('#sign-remember');
  if ((await box.isChecked()) !== remember) await box.click();
  await page.click('#sign-save');
  await page.waitForTimeout(500);
};

const me = await device('Gui', { me: 'Gui', groups: [MIFA] });

// 1. un sondage, sans signature d'abord
await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/polls"]'); await me.click('[data-goto="#/polls/new"]'); await me.waitForSelector('#new-poll');
await me.fill('#poll-question', 'Quel soir pour la fête ?'); await me.fill('#poll-choices', 'vendredi\nsamedi');
await me.fill('[data-person-index="0"]', 'Gui');
await me.click('#new-poll button[type=submit]'); await me.waitForSelector('#poll-sign');
check('sans surnom retenu, rien ne s’affiche', (await signedText(me)) === '');

// 2. on l'ajoute en cours de route
await setSignature(me, '#poll-sign', 'Guigui');
check('la signature s’ajoute en cours de route', (await signedText(me)) === 'Proposé par Guigui', await signedText(me));
const pollLinkText = await (async () => {
  await me.click('#poll-share'); await me.waitForSelector('#export-dialog[open]', { timeout: 15000 });
  const l = await me.inputValue('#export-text'); await me.click('#export-close'); return l;
})();

// 3. la suivante la reprend toute seule
await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/lists"]'); await me.click('[data-goto="#/lists/new"]'); await me.waitForSelector('#new-list');
await me.fill('#list-name', 'Courses de la fête');
await me.click('#new-list button[type=submit]'); await me.waitForSelector('#list-sign');
check('une nouvelle liste est signée d’office', (await signedText(me)) === 'Proposé par Guigui', await signedText(me));

// 4. une autre signature pour celle-ci seulement
await setSignature(me, '#list-sign', 'Le voisin du 3e', false);
check('celle-ci peut porter un autre surnom', (await signedText(me)) === 'Proposé par Le voisin du 3e', await signedText(me));
check('sans changer celui retenu', await me.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).signature === 'Guigui'));

// 5. et s'enlever
await setSignature(me, '#list-sign', '', false);
check('vider le champ enlève la signature', (await signedText(me)) === '');

// 6. le visiteur la voit
const guest = await device('Paul', null);
await guest.goto(`http://localhost:8099/dist/marque-points.html${pollLinkText.slice(pollLinkText.indexOf('#'))}`);
await guest.waitForSelector('.votes', { timeout: 15000 });
check('le visiteur voit qui propose le sondage', (await signedText(guest)) === 'Proposé par Guigui', await signedText(guest));
check('sans pouvoir la changer', (await guest.locator('#poll-sign').count()) === 0);

// 7. un membre du groupe non plus — et la base garde celle de l'organisateur
const claire = await device('Claire', { me: 'Claire', groups: [{ ...MIFA, admits: false }] });
await claire.click('#sync'); await claire.waitForTimeout(1500);
const pollId = pollLinkText.match(/#\/poll\/([^/]+)/)[1];
await claire.evaluate((id) => { location.hash = `#/poll/${id}`; }, pollId);
await claire.waitForSelector('.votes', { timeout: 15000 });
check('un membre la voit, sans bouton pour la changer',
  (await signedText(claire)) === 'Proposé par Guigui' && (await claire.locator('#poll-sign').count()) === 0);
await claire.evaluate(async (id) => {
  const cfg = JSON.parse(localStorage.getItem('marque-points:remote:v1'));
  const poll = { ...JSON.parse(localStorage.getItem('marque-points:polls:v1')).find((p) => p.id === id), signedBy: 'Claire' };
  await fetch(`${cfg.url}/rest/v1/rpc/marque_points_put`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key, authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ p_id: id, p_data: poll, p_key: 'la-cle-famille' }) });
}, pollId);
const stored = await me.evaluate(async (id) => {
  const cfg = JSON.parse(localStorage.getItem('marque-points:remote:v1'));
  const r = await fetch(`${cfg.url}/rest/v1/rpc/marque_points_get`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key, authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ p_id: id }) });
  return (await r.json()).signedBy;
}, pollId);
check('la base garde la signature de l’organisateur', stored === 'Guigui', String(stored));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
