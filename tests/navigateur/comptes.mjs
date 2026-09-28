/**
 * Les comptes : Gui, dans le groupe, se connecte avec son adresse et un code.
 * Sur un appareil neuf — ou un navigateur qui a tout effacé —, la même
 * connexion lui rend le groupe (une clé neuve, qui fait entrer comme la
 * sienne) et ses droits d'organisateur. Rien du jeton ne part dans l'export.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const BASE = 'http://127.0.0.1:8123';
const remote = { url: BASE, key: 'test-anon-key' };
const EMAIL = 'gui@exemple.fr';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 400, height: 900 }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([p, r]) => {
    if (localStorage.getItem('marque-points:remote:v1')) return;
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    localStorage.setItem('marque-points:remote:v1', JSON.stringify(r));
  }, [prefs, remote]);
  return page;
}
const prefsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1') || '{}'));
const codeFor = async (email) => (await (await fetch(`${BASE}/__code?email=${encodeURIComponent(email)}`)).json()).code;

async function signIn(page) {
  await page.goto(`${B}#/settings`);
  await page.waitForSelector('#account-email');
  await page.fill('#account-email', EMAIL);
  await page.click('#account-email-form button[type=submit]');
  await page.waitForSelector('#account-code');
  const code = await codeFor(EMAIL);
  await page.fill('#account-code', code);
  await page.click('#account-code-form button[type=submit]');
  await page.waitForFunction(() => /Connecté : /.test(document.querySelector('#account')?.textContent || ''));
}

/* --- 1. Gui, dans le groupe, organise un sondage puis se connecte --------- */

const gui = await device('Gui', { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] });
await gui.goto(`${B}#/polls/new`);
await gui.waitForSelector('#poll-question');
await gui.fill('#poll-question', 'Quel week-end ?');
await gui.fill('#poll-choices', 'Samedi\nDimanche');
await gui.click('#new-poll button[type=submit]');
await gui.waitForFunction(() => /^#\/poll\//.test(location.hash));
const poll = (await gui.evaluate(() => location.hash)).split('/')[2];
await gui.waitForTimeout(1200);

await gui.goto(`${B}#/settings`);
await gui.waitForSelector('#account');
check('les réglages proposent un compte, facultatif', /Compte[\s\S]*Facultatif/.test(await gui.locator('#account').textContent()));
await gui.fill('#account-email', 'pas-une-adresse');
await gui.click('#account-email-form button[type=submit]');
check('une adresse fausse n’envoie rien', (await gui.locator('#account-code').count()) === 0);
await gui.fill('#account-email', EMAIL);
await gui.click('#account-email-form button[type=submit]');
await gui.waitForSelector('#account-code');
await gui.fill('#account-code', '000000');
await gui.click('#account-code-form button[type=submit]');
await gui.waitForFunction(() => /ne marche pas/.test(document.querySelector('#view')?.textContent || ''));
check('un mauvais code est refusé', (await gui.locator('#account-code').count()) === 1);
await gui.fill('#account-code', await (async () => {
  await gui.click('#account-other');
  await gui.fill('#account-email', EMAIL);
  await gui.click('#account-email-form button[type=submit]');
  await gui.waitForSelector('#account-code');
  return codeFor(EMAIL);
})());
await gui.click('#account-code-form button[type=submit]');
await gui.waitForFunction(() => /Connecté : gui@exemple.fr/.test(document.querySelector('#account')?.textContent || ''));
check('le bon code connecte', true);
await gui.waitForTimeout(1500);
const guiPrefs = await prefsOf(gui);
check('le jeton n’est pas dans les préférences', !JSON.stringify(guiPrefs).includes('tok-'));
const exported = await gui.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('account')));
check('il est gardé à part', exported.length === 1, exported.join());

/* --- 2. un appareil neuf : se connecter rend tout ------------------------ */

const neuf = await device('Neuf', {});
await signIn(neuf);
await neuf.waitForFunction(() => (JSON.parse(localStorage.getItem('marque-points:prefs:v1') || '{}').groups || []).length === 1, null, { timeout: 15000 });
const neufPrefs = await prefsOf(neuf);
const groupe = neufPrefs.groups[0];
check('le groupe revient, avec une clé neuve', groupe.id === 'grp_famille' && groupe.key && groupe.key !== 'la-cle-famille', JSON.stringify(groupe));
check('qui fait entrer, comme celle de Gui', groupe.admits === true);
check('le prénom revient', neufPrefs.me === 'Gui', neufPrefs.me);
check('le droit d’organisateur revient', Boolean(neufPrefs.organiser?.[poll]), JSON.stringify(neufPrefs.organiser));
await neuf.goto(`${B}#/poll/${poll}`);
await neuf.waitForFunction(() => /Quel week-end/.test(document.querySelector('#view h1')?.textContent || ''), null, { timeout: 15000 });
await neuf.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
check('et il y règle le sondage en organisateur', (await neuf.locator('#poll-close').count()) === 1 && (await neuf.locator('#poll-delete').count()) === 1);

/* --- 3. se déconnecter garde ce qui est là -------------------------------- */

await neuf.goto(`${B}#/settings`);
await neuf.waitForSelector('#account-out');
await neuf.click('#account-out');
await neuf.waitForSelector('#account-email');
check('déconnecté, le groupe reste sur l’appareil', ((await prefsOf(neuf)).groups || []).length === 1);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
