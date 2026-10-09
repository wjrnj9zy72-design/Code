/** Qui répond par un lien peut ajouter un choix ; l'organisateur le reçoit et garde la main dessus. */
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
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (p && !localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    } catch {}
  }, [CONFIG, prefs]);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}
const choices = (page) => page.locator('.votes tbody th').evaluateAll((cells) => cells.map((th) => {
  const copy = th.cloneNode(true);
  copy.querySelectorAll('.choice-drop').forEach((button) => button.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}));

// Gui crée le sondage et le partage.
const gui = await device('Gui', { me: 'Gui', groups: [MIFA] });
await gui.click('[data-tab="home"]'); await gui.click('.segmented--kinds [data-goto="#/polls"]'); await gui.click('[data-goto="#/polls/new"]'); await gui.waitForSelector('#new-poll');
await gui.fill('#poll-question', 'Quel soir pour la fête des voisins ?');
await gui.fill('#poll-choices', 'vendredi\nsamedi');
await gui.fill('[data-person-index="0"]', 'Gui');
await gui.fill('[data-person-index="1"]', 'Paul');
await gui.click('#new-poll button[type=submit]');
await gui.waitForSelector('.votes');
await gui.click('#poll-share');
await gui.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await gui.inputValue('#export-text');
await gui.click('#export-close');

// Mme Durand ouvre le lien, s'ajoute, et propose un autre soir.
const her = await device('Mme Durand', null);
await her.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await her.waitForSelector('.votes', { timeout: 15000 });
check('le visiteur a de quoi ajouter un choix', (await her.locator('#add-choice').count()) === 1);
check('mais pas de quoi renommer ou retirer ceux qui y sont', (await her.locator('[data-option]').count()) === 0);
await her.fill('#solo-me', 'Mme Durand');
await her.click('#solo-me-form button[type=submit]');
await her.waitForTimeout(600);
// Un sondage sur des soirs : le formulaire propose d'abord un jour, au calendrier.
check('un sondage sur des jours propose d’abord un jour', (await her.locator('#new-choice-day').count()) === 1
  && (await her.getAttribute('[data-choice-kind="day"]', 'aria-pressed')) === 'true');
await her.fill('#new-choice-day', '2026-10-11');
await her.waitForTimeout(800);
const withDay = await choices(her);
check('le jour choisi s’ajoute, marqué 📅', withDay.some((c) => c.startsWith('📅') && /dimanche 11 octobre/i.test(c)), withDay.join(' | '));
await her.click('[data-choice-kind="other"]');
check('« Autre chose » ouvre une case de texte', (await her.locator('#new-choice').count()) === 1 && (await her.locator('#new-choice-day').count()) === 0);
await her.fill('#new-choice', 'au parc');
await her.click('#add-choice button[type=submit]');
await her.waitForTimeout(800);
check('son choix s’ajoute chez elle', (await choices(her)).includes('au parc'), (await choices(her)).join(' | '));
check('les deux sortes se distinguent dans la grille', (await choices(her)).filter((c) => c.startsWith('📅')).length === 1, (await choices(her)).join(' | '));
await her.locator('.votes tbody tr').nth(3).locator('td.votes__mine .vote').click();
await her.waitForTimeout(800);
check('et elle peut le cocher', (await her.locator('td.votes__mine .vote--yes').count()) === 1);

// Chez Gui : le choix et la coche arrivent ; c'est lui qui peut le corriger.
const arrived = await gui.waitForFunction(() => [...document.querySelectorAll('.votes tbody th')].some((th) => th.textContent.trim() === 'au parc'), null, { timeout: 15000 }).then(() => true).catch(() => false);
check('le choix arrive chez l’organisateur', arrived, (await choices(gui)).join(' | '));
await gui.waitForTimeout(800);
check('avec sa coche', (await gui.locator('.vote--yes').count()) === 1);
check('l’organisateur peut le corriger', (await gui.locator('[data-option]', { hasText: 'au parc' }).count()) === 1);

// Elle retire un choix à elle ; ceux des autres n'ont pas de quoi être retirés.
check('elle peut retirer ses choix, et seulement les siens', (await her.locator('[data-drop-option]').count()) === 2,
  String(await her.locator('[data-drop-option]').count()));
await her.fill('#new-choice', 'pétanque');
await her.click('#add-choice button[type=submit]');
await her.waitForTimeout(800);
await her.locator('.votes tbody tr', { hasText: 'pétanque' }).locator('[data-drop-option]').click();
await her.click('.dialog--ask[open] [data-answer="yes"]');
await her.waitForTimeout(1200);
check('son choix retiré disparaît chez elle', !(await choices(her)).includes('pétanque'), (await choices(her)).join(' | '));
await gui.click('#sync').catch(() => {}); await gui.waitForTimeout(1500);
check('et chez l’organisateur', !(await choices(gui)).includes('pétanque') && (await choices(gui)).includes('au parc'), (await choices(gui)).join(' | '));

// Gui ajoute un choix à son tour, sur une copie qui avait déjà le sien : rien ne se perd.
await gui.click('[data-choice-kind="other"]');
await gui.fill('#new-choice', 'chez Paul');
await gui.click('#add-choice button[type=submit]');
await gui.waitForTimeout(1200);
await her.reload(); await her.waitForSelector('.votes', { timeout: 15000 }); await her.waitForTimeout(1500);
const now = await choices(her);
check('les choix des deux restent', ['vendredi', 'samedi', 'au parc', 'chez Paul'].every((c) => now.includes(c)), now.join(' | '));

// Gui retire le choix de la visiteuse : il ne revient pas par sa copie.
await gui.locator('[data-option]', { hasText: 'au parc' }).click();
await gui.click('#choice-delete');
await gui.click('.dialog--ask[open] [data-answer="yes"]');
await gui.waitForTimeout(1200);
await her.locator('.votes tbody tr').first().locator('td.votes__mine .vote').click(); // sa copie, encore avec « au parc », repart
await her.waitForTimeout(1500);
await gui.click('#sync').catch(() => {}); await gui.waitForTimeout(1500);
check('un choix retiré par l’organisateur ne revient pas', !(await choices(gui)).includes('au parc'), (await choices(gui)).join(' | '));

// La date retenue : plus rien à proposer.
await gui.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
await gui.fill('#poll-day', '2026-10-10');
await gui.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
await gui.click('#poll-date-save'); await gui.waitForTimeout(800);
await her.reload(); await her.waitForSelector('#view', { timeout: 15000 }); await her.waitForTimeout(1500);
check('une fois la date retenue, le visiteur n’ajoute plus de choix', (await her.locator('#add-choice').count()) === 0);

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
