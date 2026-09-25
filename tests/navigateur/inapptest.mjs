/**
 * Le lien d'invitation voyage par message, donc il s'ouvre le plus souvent dans
 * le navigateur de Messenger — celui qui garde ses fichiers pour lui. L'app doit
 * le dire avant qu'on y entre, et proposer de quoi passer dans Safari.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const PAGE = 'http://localhost:8099/dist/marque-points.html';
const MESSENGER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) [FBAN/MessengerForiOS;FBAV/450.0.0.44.109;]';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function device(label, { userAgent, hash = '', key = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', userAgent });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k]) => {
    localStorage.setItem('marque-points-remote-probe', '1');
    localStorage.setItem('marque-points:remote:v1', c);
    if (k) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
      me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }],
    }));
  }, [CONFIG, key]);
  await page.goto(PAGE + hash);
  await page.waitForSelector('.app-bar');
  return page;
}

// Une invitation, comme elle serait envoyée.
const owner = await device('propriétaire', { userAgent: SAFARI, key: 'la-cle-famille', hash: '#/groups' });
await owner.click('[data-invite]');
await owner.waitForSelector('#invite-open');
await owner.click('#invite-open');
await owner.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await owner.inputValue('#export-text');
await owner.click('#export-close');
const hash = link.slice(link.indexOf('#'));

/* --- dans Messenger : l'avertissement, avant d'entrer --------------------- */

const inApp = await device('messenger', { userAgent: MESSENGER, hash });
await inApp.waitForSelector('#join-form');
const warned = await inApp.locator('.banner--warn').first().textContent();
check('l’app reconnaît le navigateur de Messenger', /Messenger/.test(warned), warned.slice(0, 70));
check('et dit que ce qui est fait là n’y restera pas',
  /restera|Safari/.test(warned), warned.slice(0, 120));
check('elle propose de copier le lien', (await inApp.locator('#copy-here').count()) === 1);
await inApp.click('#copy-here');
await inApp.waitForSelector('#export-dialog[open]');
check('et le lien copié est bien celui de cette page',
  (await inApp.inputValue('#export-text')).includes('#/join/'),
  await inApp.inputValue('#export-text'));
check('avec quoi en faire', /Collez-le dans Safari/.test(await inApp.locator('#export-hint').textContent()));
await inApp.click('#export-close');
check('mais rien n’est bloqué : on peut quand même demander',
  (await inApp.locator('#join-form button[type=submit]').isEnabled()));

/* --- dans Safari : pas d'avertissement ------------------------------------ */

const safari = await device('safari', { userAgent: SAFARI, hash });
await safari.waitForSelector('#join-form');
check('dans un vrai navigateur, aucun avertissement',
  (await safari.locator('.banner--warn').count()) === 0);

/* --- et dans l'onglet Groupes d'un appareil sans groupe ------------------- */

const inAppHome = await device('messenger aperçu', { userAgent: MESSENGER });
await inAppHome.click('[data-tab="groups"]');
await inAppHome.waitForSelector('#group-name');
check('l’onglet Groupes d’un appareil sans groupe le dit aussi',
  (await inAppHome.locator('.banner--warn').count()) === 1,
  await inAppHome.locator('.section', { has: inAppHome.locator('#group-name') }).textContent()
    .then((t) => t.replace(/\s+/g, ' ').slice(0, 80)));

const withGroup = await device('messenger déjà dedans', { userAgent: MESSENGER, key: 'la-cle-famille' });
await withGroup.click('[data-tab="groups"]');
await withGroup.waitForSelector('[data-catch-up]');
check('mais pas quand l’appareil est déjà dans un groupe : c’est trop tard pour ce conseil',
  (await withGroup.locator('.banner--warn').count()) === 0);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
