/**
 * Les défauts que la relecture indépendante a trouvés côté app, chacun rejoué.
 * Rien de tout cela n'était couvert : c'est la suite qui manquait.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const PAGE = 'http://localhost:8099/dist/marque-points.html';
const call = (fn, body) => fetch(`http://127.0.0.1:8123/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
  body: JSON.stringify(body),
}).then((r) => r.json());

async function device(label, { key = 'la-cle-famille', me = 'Gui', admits = true, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k, name, admitting]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      const prefs = { me: name };
      if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k, admits: admitting }];
      localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
    } catch {}
  }, [CONFIG, key, me, admits]);
  await page.goto(PAGE + hash);
  await page.waitForSelector('.app-bar');
  return page;
}
const prefsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')));

/* --- 1. frapper à un groupe où l'on est déjà ne doit pas perdre sa clé ---- */

const gui = await device('gui');
const invitation = await call('marque_points_invite', { p_key: 'la-cle-famille', p_minutes: 1440, p_uses: 20 });
await gui.fill('#group-name', 'Mifa');
await gui.fill('#group-code', invitation.code);
await gui.click('#group-join');
await gui.waitForSelector('.banner', { timeout: 15000 });
const after = await prefsOf(gui);
check('frapper à son propre groupe ne dépose pas de demande', !(after.pendings || []).length,
  JSON.stringify(after.pendings));
check('la clé qui fait entrer est intacte',
  after.groups[0].key === 'la-cle-famille' && after.groups[0].admits === true,
  JSON.stringify(after.groups[0]));
check('et l’app dit qu’on y est déjà', /déjà dans/.test(await gui.locator('.banner').textContent()),
  await gui.locator('.banner').textContent());
check('le portier voit toujours sa porte', (await gui.locator('[data-invite]').count()) === 1);

/* --- 2. un réseau qui tombe ne doit pas retirer la porte ------------------ */

const flaky = await device('réseau');
await flaky.waitForSelector('.group');
await flaky.waitForTimeout(800);
check('au départ, le portier a ses blocs', (await flaky.locator('.details summary').count()) >= 1);
await flaky.route('**/marque_points_requests', (r) => r.abort());
await flaky.click('.tab[data-tab="games"]');
await flaky.click('.tab[data-tab="overview"]');
await flaky.waitForTimeout(1200);
check('une panne réseau ne l’enregistre pas comme « ne fait pas entrer »',
  (await prefsOf(flaky)).groups[0].admits === true,
  JSON.stringify((await prefsOf(flaky)).groups[0]));
await flaky.unroute('**/marque_points_requests');
await flaky.click('.tab[data-tab="games"]');
await flaky.click('.tab[data-tab="overview"]');
await flaky.waitForTimeout(1500);
check('et la porte revient d’elle-même quand le réseau revient',
  (await flaky.locator('.details summary').count()) >= 1);

/* --- 3. un message lu ne suit pas sur l'écran suivant --------------------- */

const banners = await device('bannière');
await banners.fill('#me-name', 'Guillaume');
await banners.click('#me-save');
await banners.waitForSelector('.banner');
check('le message s’affiche', /Guillaume/.test(await banners.locator('.banner').textContent()));
await banners.click('.tab[data-tab="games"]');
await banners.waitForTimeout(300);
check('et ne déborde pas sur l’écran des parties',
  (await banners.locator('.banner').count()) === 0);

/* --- 4. une demande qui arrive pendant que l'app est ouverte se voit ------ */

const watching = await device('veille');
await watching.waitForSelector('.group');
await watching.waitForTimeout(800);
check('personne n’attend au départ', /Personne n’attend/.test(await watching.locator('.group').textContent()));
await call('marque_points_ask', {
  p_name: 'Mifa', p_code: invitation.code, p_who: 'Tardive', p_label: 'navigateur',
});
await watching.waitForSelector('[data-admit]', { timeout: 30000 });
check('une demande qui arrive ensuite apparaît sans recharger',
  /Tardive/.test(await watching.locator('.knock').first().textContent()),
  await watching.locator('.knock').first().textContent());

/* --- 5. le bouton Demander ne meurt pas faute de prénom ------------------- */

const noName = await device('sans prénom', { key: null, me: null });
await noName.fill('#group-name', 'Mifa');
await noName.fill('#group-code', invitation.code);
await noName.click('#group-join');
await noName.waitForTimeout(600);
check('sans prénom, on est renvoyé au champ « Moi »',
  /prénom/.test(await noName.locator('#group-state').textContent()),
  await noName.locator('#group-state').textContent());
check('et le bouton reste utilisable', await noName.locator('#group-join').isEnabled());
await noName.fill('#me-name', 'Zoé');
await noName.click('#me-save');
await noName.waitForTimeout(400);
await noName.fill('#group-name', 'Mifa');
await noName.fill('#group-code', invitation.code);
await noName.click('#group-join');
await noName.waitForSelector('[data-check]', { timeout: 15000 });
check('le prénom donné, la demande part', (await noName.locator('[data-check]').count()) === 1);

/* --- 6. une équipe ne s'appelle pas Gui ---------------------------------- */

const teams = await device('équipes', { key: null });
await teams.click('.tab[data-tab="games"]');
await teams.click('[data-goto="#/new"]');
await teams.waitForSelector('#new-game');
check('une partie entre joueurs propose mon prénom',
  (await teams.inputValue('[data-name-index="0"]')) === 'Gui');
const presets = await teams.locator('#preset option').evaluateAll((os) => os.map((o) => o.value));
const teamPreset = presets.find((p) => /belote|coinche|tarot/.test(p)) || presets[1];
await teams.selectOption('#preset', teamPreset);
await teams.waitForTimeout(400);
const label = await teams.locator('[data-name-index="0"]').getAttribute('placeholder');
const value = await teams.inputValue('[data-name-index="0"]');
check(`une partie par équipes ne met pas mon prénom dans « ${label} »`,
  !/équipe/i.test(label || '') || value !== 'Gui', `${label} = ${value}`);

/* --- 7. un prénom effacé reste effacé ------------------------------------ */

const cleared = await device('effacé', { key: null });
await cleared.click('.tab[data-tab="games"]');
await cleared.click('[data-goto="#/new"]');
await cleared.waitForSelector('#new-game');
await cleared.fill('[data-name-index="0"]', '');
await cleared.click('#add-name');
await cleared.waitForTimeout(300);
check('un champ vidé le reste', (await cleared.inputValue('[data-name-index="0"]')) === '',
  await cleared.inputValue('[data-name-index="0"]'));

/* --- 8. un second onglet n'emporte pas les clés -------------------------- */

const twoTabs = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
await twoTabs.addInitScript((c) => {
  localStorage.setItem('marque-points:remote:v1', c);
  localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
    me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }],
  }));
}, CONFIG);
const tabA = await twoTabs.newPage();
await tabA.goto(PAGE);
await tabA.waitForSelector('.app-bar');
const tabB = await twoTabs.newPage();
await tabB.goto(PAGE);
await tabB.waitForSelector('.app-bar');
// l'onglet A frappe ailleurs, l'onglet B change le thème
const other = await call('marque_points_invite', { p_key: 'la-cle-copains', p_minutes: 1440, p_uses: 5 });
await tabA.fill('#group-name', 'Copains du mardi');
await tabA.fill('#group-code', other.code);
await tabA.click('#group-join');
await tabA.waitForSelector('[data-check]', { timeout: 15000 });
await tabB.click('#theme-toggle').catch(() => tabB.click('[data-theme-toggle]')).catch(() => {});
await tabB.waitForTimeout(600);
const kept = await tabA.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')));
check('un autre onglet qui écrit un réglage n’emporte ni les clés ni la demande',
  (kept.groups || []).length === 1 && (kept.pendings || []).length === 1,
  JSON.stringify({ groups: (kept.groups || []).length, pendings: (kept.pendings || []).length }));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL|aborted|Failed to fetch/i.test(e)));
await browser.close();
