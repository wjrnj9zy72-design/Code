/**
 * Ce qu'on dit à quelqu'un qui veut poser l'app sur son écran d'accueil :
 * l'ordre à suivre, sur la page d'invitation, et l'avertissement avant de
 * l'installer quand on est déjà dans un groupe.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null, standalone = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 950 }, locale: 'fr-FR', permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k, alone]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (k) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
        me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }],
      }));
    } catch {}
    if (alone) {
      // Ce que voit une app posée sur l'écran d'accueil.
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, addEventListener() {}, removeEventListener() {} } : real(q));
    }
  }, [CONFIG, key, standalone]);
  await page.goto('http://localhost:8099/dist/marque-points.html#/groups');
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- 1. l'invité, dans le navigateur ------------------------------------- */

const guest = await device('invité');
await guest.evaluate(() => { location.hash = '#/join/123456/Mifa'; });
await guest.waitForSelector('#join-form');

const details = guest.locator('details', { hasText: 'écran d’accueil' }).first();
check('la page d’invitation propose de poser l’app', (await details.count()) === 1);
await details.locator('summary').click();
const text = (await details.textContent()).replace(/\s+/g, ' ');

check('elle dit de la poser d’abord', /posez-la d’abord/i.test(text), text.slice(0, 90));
check('elle dit pourquoi : un stockage à part', /propre stockage/.test(text));
check('elle dit qu’un lien ne s’y ouvre pas', /lien s’ouvre toujours dans le navigateur/.test(text));
check('elle donne le nom du groupe et le code à recopier', /Mifa/.test(text) && /123456/.test(text), text.slice(-160));
check('et la solution de repli, si le code a servi', /Voir ma clé/.test(text));

await details.locator('#join-copy-code').click();
await guest.waitForSelector('#export-dialog[open]', { timeout: 15000 });
check('le bouton donne les deux à copier d’un coup',
  (await guest.inputValue('#export-text')) === 'Mifa · 123456', await guest.inputValue('#export-text'));
await guest.click('#export-close');

/* --- 2. la même page, mais déjà dans l'app posée -------------------------- */

const installed = await device('posée', { standalone: true });
await installed.evaluate(() => { location.hash = '#/join/123456/Mifa'; });
await installed.waitForSelector('#join-form');
check('une app déjà posée ne s’entend pas proposer de la poser',
  (await installed.locator('details', { hasText: 'écran d’accueil' }).count()) === 0);

/* --- 3. déjà dans un groupe, dans le navigateur --------------------------- */

const member = await device('membre', { key: 'la-cle-famille' });
await member.waitForSelector('[data-show-key]');
const overview = (await member.locator('#view').textContent()).replace(/\s+/g, ' ');
check('on est prévenu avant de poser l’app', /s’ouvrira vide/.test(overview));
check('avec la manœuvre : prendre sa clé', /Voir ma clé/.test(overview) && /pas de code, mais une clé/.test(overview));

const memberInstalled = await device('membre posé', { key: 'la-cle-famille', standalone: true });
await memberInstalled.waitForSelector('[data-show-key]');
check('une fois posée, on ne le lui répète pas',
  !/s’ouvrira vide/.test((await memberInstalled.locator('#view').textContent()).replace(/\s+/g, ' ')));

/* --- 4. posée et vide : l'autre moitié du message ------------------------- */

const empty = await device('posée et vide', { standalone: true });
await empty.waitForSelector('#group-name');
const emptyText = (await empty.locator('#view').textContent()).replace(/\s+/g, ' ');
check('une app posée et vide dit quoi faire', /installation à part de Safari/.test(emptyText), emptyText.slice(0, 120));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
