/** Le lien partagé ouvre le sondage seul : rien d'autre de l'app n'est atteignable. */
import { chromium } from 'playwright';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];
async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, p]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (!localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    } catch {}
  }, [CONFIG, prefs]);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}

// Moi : un sondage « lien seulement », une date retenue, et je le partage.
const me = await device('moi', { me: 'Gui', groups: [MIFA] });
await me.click('.tab[data-tab="polls"]'); await me.click('[data-goto="#/polls/new"]'); await me.waitForSelector('#new-poll');
await me.click('[data-new-group="@lien"]'); await me.waitForTimeout(200);
await me.fill('#poll-question', 'Quel soir pour la fête des voisins ?');
await me.fill('#poll-choices', 'vendredi\nsamedi');
await me.fill('[data-person-index="0"]', 'Gui');
await me.fill('[data-person-index="1"]', 'Paul');
await me.click('#new-poll button[type=submit]');
await me.waitForSelector('#poll-day');
await me.fill('#poll-day', '2026-10-09'); await me.fill('#poll-hour', '19:00');
await me.click('#poll-date-save'); await me.waitForTimeout(600);
await me.click('#poll-share');
await me.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await me.inputValue('#export-text');
await me.click('#export-close');
check('le lien envoyé ouvre le sondage seul', /#\/poll\/v_[^/]+\/solo$/.test(link), link);

// Mme Durand, voisine, dans aucun groupe, pas dans la liste des personnes.
const her = await device('Mme Durand', null);
await her.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await her.waitForSelector('.votes', { timeout: 15000 });

const visible = async (sel) => her.locator(sel).first().isVisible().catch(() => false);
check('pas d’onglets', !(await visible('#tabs')));
check('pas de bouton ⟳', !(await visible('#sync')));
check('le nom en haut ne mène nulle part', (await her.locator('.app-bar__brand').getAttribute('href')) === null);
check('pas de bouton Retour', (await her.locator('#view [data-goto]').count()) === 0,
  String(await her.locator('#view [data-goto]').count()));
check('pas de section Données (partager, clore, supprimer…)',
  (await her.locator('#poll-delete, #poll-close, #poll-share, #poll-people, #poll-rename, #poll-archive').count()) === 0);
check('pas d’ajout de choix, ni de renommage', (await her.locator('#add-choice, [data-option]').count()) === 0);
check('pas de réglage de la date', (await her.locator('#poll-day, #poll-date-save').count()) === 0);
check('mais la date retenue se lit', /Date retenue : ven\. 9 oct\. · 19:00/.test((await her.locator('#view').textContent()).replace(/\s+/g, ' ')));
check('et s’emporte dans son agenda', (await her.locator('#poll-ics').count()) === 1);
const reachable = await her.evaluate(() => [...document.querySelectorAll('a[href], [data-goto]')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => el.getAttribute('href') || el.dataset.goto));
check('aucun lien atteignable ne sort du sondage', reachable.length === 0, reachable.join(' | '));
check('les onglets sont retirés de la page, pas seulement cachés',
  await her.evaluate(() => document.getElementById('tabs').hidden === true));

// Elle n'est pas dans la liste : elle s'ajoute, et coche.
await her.fill('#solo-me', 'Mme Durand');
await her.click('#solo-me-form button[type=submit]');
await her.waitForTimeout(900);
const heads = (await her.locator('.votes thead th').allTextContents()).map((s) => s.trim());
check('elle s’ajoute d’elle-même', heads.includes('Mme Durand'), heads.join(' | '));
check('et c’est sa colonne qui est mise en avant', ((await her.locator('thead th.votes__mine').textContent()) || '').trim() === 'Mme Durand');
await her.locator('.votes tbody tr').nth(1).locator('td.votes__mine .vote').click();
await her.waitForTimeout(800);
check('elle coche samedi', (await her.locator('td.votes__mine .vote--yes').count()) === 1);
check('en restant dans le sondage seul', /\/solo$/.test(await her.evaluate(() => location.hash)));

const arrived = await me.waitForFunction(() => [...document.querySelectorAll('.votes thead th')].some((th) => th.textContent.trim() === 'Mme Durand'), null, { timeout: 15000 }).then(() => true).catch(() => false);
check('son prénom et sa coche m’arrivent', arrived);

// Un lien vers un sondage qui n'existe pas : une phrase, pas l'app.
await her.evaluate(() => { location.hash = '#/poll/v_introuvable_000/solo'; });
await her.waitForFunction(() => /n’existe plus/.test(document.querySelector('#view').textContent), null, { timeout: 15000 }).catch(() => {});
check('un lien mort ne jette pas dans l’app', /n’existe plus/.test(await her.locator('#view').textContent())
  && !(await visible('#tabs')));

// Et l'app complète revient pour qui l'ouvre normalement.
await me.evaluate(() => { location.hash = '#/polls'; });
await me.waitForTimeout(400);
check('chez moi, l’app reste entière', await me.locator('#tabs').isVisible());

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
