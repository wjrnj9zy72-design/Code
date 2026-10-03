/**
 * Installer d'abord, sur téléphone. Sur iPhone, dans Safari, l'invitation
 * mène à l'installation (Safari et l'app posée ne partagent rien) ; entrer
 * ici reste possible. Sur Android, un vrai bouton « Installer » quand Chrome
 * le propose. Sur l'Accueil, un rappel pour qui est dans un groupe, dans le
 * navigateur d'un téléphone, sans compte. Et l'app demande au navigateur de
 * garder ses données dès qu'il y a quelque chose à garder.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const remote = { url: 'http://127.0.0.1:8123', key: 'test-anon-key' };
const famille = [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function device(label, { ua, prefs = { me: 'Gui' }, standalone = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', ...(ua ? { userAgent: ua } : {}), hasTouch: Boolean(ua) });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([p, r, alone]) => {
    window.__persist = 0;
    if (navigator.storage) {
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => { window.__persist += 1; return true; };
    }
    if (alone) Object.defineProperty(navigator, 'standalone', { get: () => true });
    if (localStorage.getItem('marque-points:prefs:v1')) return;
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    localStorage.setItem('marque-points:remote:v1', JSON.stringify(r));
  }, [prefs, remote, standalone]);
  await page.goto(`${B}#/`);
  await page.waitForSelector('#view');
  return page;
}
const text = async (page, selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();

/* --- 1. iPhone, dans Safari : installer d'abord --------------------------- */

const iphone = await device('iPhone', { ua: IPHONE });
await iphone.evaluate(() => { location.hash = '#/join/123456/Mifa'; });
await iphone.waitForSelector('.install-first');
check('sur iPhone, l’invitation mène d’abord à l’installation', /D’abord, installez l’app/.test(await text(iphone, '#view')));
check('avec les gestes de Safari', /Partager/.test(await text(iphone, '.install-first')) && /Sur l’écran d’accueil/.test(await text(iphone, '.install-first')));
check('le nom et le code à recopier', /Mifa · 123456/.test(await text(iphone, '.install-first')));
check('et pas encore de formulaire', (await iphone.locator('#join-form').count()) === 0);
await iphone.click('#join-copy-code');
await iphone.waitForSelector('#export-dialog[open]');
check('le bouton copie les deux d’un coup', (await iphone.inputValue('#export-text')) === 'Mifa · 123456');
await iphone.click('#export-close');
await iphone.click('[data-join-here]');
await iphone.waitForSelector('#join-form');
check('entrer quand même ici reste possible', true);

/* --- 2. iPhone, l'app posée : rien à installer ---------------------------- */

const pose = await device('iPhone posé', { ua: IPHONE, standalone: true });
await pose.evaluate(() => { location.hash = '#/join/123456/Mifa'; });
await pose.waitForSelector('#join-form');
check('dans l’app posée, on entre directement', (await pose.locator('.install-first').count()) === 0);

/* --- 3. Android : le bouton « Installer » quand Chrome le propose --------- */

const android = await device('Android', { ua: ANDROID });
await android.evaluate(() => { location.hash = '#/join/123456/Mifa'; });
await android.waitForSelector('#join-form');
check('sur Android, on peut entrer ici (Chrome et l’app partagent leurs données)', (await android.locator('.install-first').count()) === 0);
await android.evaluate(() => {
  const offer = new Event('beforeinstallprompt');
  offer.prompt = () => { window.__prompted = true; };
  offer.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(offer);
});
await android.waitForSelector('[data-install-now]');
check('et Chrome propose d’installer : un vrai bouton', /Installer l’app/.test(await text(android, '[data-install-now]')));
await android.click('[data-install-now]');
await android.waitForFunction(() => window.__prompted === true);
check('qui ouvre la proposition d’installation de Chrome', true);

/* --- 4. l'Accueil : le rappel ---------------------------------------------- */

const membre = await device('membre iPhone', { ua: IPHONE, prefs: { me: 'Gui', groups: famille } });
await membre.waitForSelector('.install-reminder');
check('dans un groupe, dans Safari, sans compte : un rappel', /connectez-vous/.test(await text(membre, '.install-reminder')));
await membre.click('[data-install-how]');
await membre.waitForSelector('dialog[open] .steps');
check('« Comment installer » donne les gestes, et dit de s’y connecter ensuite', /Partager/.test(await text(membre, 'dialog[open]')) && /même compte/.test(await text(membre, 'dialog[open]')));
await membre.click('dialog[open] [data-install-close]');
await membre.click('[data-install-later]');
await membre.waitForFunction(() => !document.querySelector('.install-reminder'));
check('« Plus tard » le fait taire', Boolean((await membre.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')))).installQuietAt));
check('et l’app a demandé au navigateur de garder ses données', (await membre.evaluate(() => window.__persist)) >= 1);

const ordi = await device('ordinateur', { prefs: { me: 'Gui', groups: famille } });
await ordi.waitForSelector('#view h2');
check('sur ordinateur, pas de rappel', (await ordi.locator('.install-reminder').count()) === 0);
const seul = await device('seul', { ua: IPHONE });
check('sans groupe, rien à garder : on ne demande rien au navigateur', (await seul.evaluate(() => window.__persist)) === 0);

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
