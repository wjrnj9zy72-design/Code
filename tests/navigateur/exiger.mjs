/**
 * Exiger un compte dans un groupe. La personne qui fait entrer voit combien
 * d'appareils ont un compte, et l'exige quand tout le monde a basculé — à
 * condition d'être connectée elle-même. Paul, sans compte, ne voit plus ce
 * que le groupe partage et est prié de se connecter ; connecté, tout revient.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const BASE = 'http://127.0.0.1:8123';
const remote = { url: BASE, key: 'test-anon-key' };
const rpc = (fn, body) => fetch(`${BASE}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { 'content-type': 'application/json', apikey: 'test-anon-key' }, body: JSON.stringify(body),
}).then((r) => r.json());
const codeFor = async (email) => (await (await fetch(`${BASE}/__code?email=${encodeURIComponent(email)}`)).json()).code;

// Paul entre dans le groupe, par le chemin ordinaire : invité, accepté.
const { code } = await rpc('marque_points_invite', { p_key: 'la-cle-famille', p_minutes: 60, p_uses: 1 });
const { ticket } = await rpc('marque_points_ask', { p_name: 'Mifa', p_code: code, p_who: 'Paul', p_label: 'téléphone' });
const [request] = await rpc('marque_points_requests', { p_key: 'la-cle-famille' });
await rpc('marque_points_answer', { p_key: 'la-cle-famille', p_id: request.id, p_accept: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([p, r]) => {
    if (localStorage.getItem('marque-points:remote:v1')) return;
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    localStorage.setItem('marque-points:remote:v1', JSON.stringify(r));
  }, [prefs, remote]);
  return page;
}
async function signIn(page, email) {
  await page.goto(`${B}#/settings`);
  await page.reload();
  await page.waitForSelector('#account-email');
  await page.fill('#account-email', email);
  await page.click('#account-email-form button[type=submit]');
  await page.waitForSelector('#account-code');
  await page.fill('#account-code', await codeFor(email));
  await page.click('#account-code-form button[type=submit]');
  await page.waitForFunction(() => /Connecté : /.test(document.querySelector('#account')?.textContent || ''));
  await page.waitForTimeout(1500);
}
const text = async (page, selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const lists = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:lists:v1') || '[]').map((l) => l.name));
async function openDevices(page) {
  await page.goto(`${B}#/groups`);
  await page.reload();
  await page.waitForSelector('.accounts-switch', { state: 'attached', timeout: 15000 });
  await page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
}

const gui = await device('Gui', { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] });
await gui.goto(`${B}#/lists/new`);
await gui.waitForSelector('#list-name');
await gui.fill('#list-name', 'Courses Mifa');
await gui.click('#new-list button[type=submit]');
await gui.waitForFunction(() => /^#\/list\//.test(location.hash));
await gui.waitForTimeout(1200);

/* --- 1. combien ont un compte ; l'exiger demande d'être connecté ---------- */

await openDevices(gui);
check('la personne qui fait entrer voit combien d’appareils ont un compte', /0 appareil sur 2 a un compte/.test(await text(gui, '.accounts-switch')), await text(gui, '.accounts-switch'));
check('et chaque appareil dit s’il en a un', /sans compte/.test(await text(gui, '#view')));
await gui.click('[data-accounts][data-on="yes"]');
await gui.click('.dialog--ask [data-answer="yes"]');
await gui.waitForFunction(() => /connectez-vous d’abord/.test(document.querySelector('#view')?.textContent || ''));
check('sans être connectée, elle ne peut pas l’exiger (elle s’enfermerait dehors)', true);

await signIn(gui, 'gui@exemple.fr');
await openDevices(gui);
check('connectée, son appareil compte', /1 appareil sur 2 a un compte/.test(await text(gui, '.accounts-switch')), await text(gui, '.accounts-switch'));
await gui.click('[data-accounts][data-on="yes"]');
await gui.click('.dialog--ask [data-answer="yes"]');
await gui.waitForFunction(() => /exige désormais un compte/.test(document.querySelector('#view')?.textContent || ''));
check('elle l’exige', true);

/* --- 2. Paul, sans compte : fermé, et prié de se connecter ---------------- */

const paul = await device('Paul', { me: 'Paul', groups: [{ id: 'grp_famille', name: 'Mifa', key: ticket, admits: false }] });
await paul.goto(`${B}#/`);
await paul.waitForSelector('.account-needed', { timeout: 15000 });
check('Paul est prié de se connecter', /Mifa demande un compte/.test(await text(paul, '.account-needed')), await text(paul, '.account-needed'));
await paul.waitForTimeout(2000);
check('et ne voit pas ce que le groupe partage', !(await lists(paul)).includes('Courses Mifa'), (await lists(paul)).join());

/* --- 3. Paul se connecte : tout revient ------------------------------------ */

await signIn(paul, 'paul@exemple.fr');
await paul.goto(`${B}#/`);
await paul.waitForFunction(() => !document.querySelector('.account-needed'), null, { timeout: 15000 });
await paul.waitForFunction(() => JSON.parse(localStorage.getItem('marque-points:lists:v1') || '[]').some((l) => l.name === 'Courses Mifa'), null, { timeout: 15000 });
check('connecté, Paul revoit ce que le groupe partage', true);

/* --- 4. ne plus l'exiger ---------------------------------------------------- */

await openDevices(gui);
check('les deux appareils ont un compte, maintenant', /2 appareils sur 2 ont un compte/.test(await text(gui, '.accounts-switch')), await text(gui, '.accounts-switch'));
await gui.click('[data-accounts][data-on="no"]');
await gui.click('.dialog--ask [data-answer="yes"]');
await gui.waitForFunction(() => /n’exige plus de compte/.test(document.querySelector('#view')?.textContent || ''));
check('et on peut ne plus l’exiger', true);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
