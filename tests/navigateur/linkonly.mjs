/** « Lien seulement » : les voisins le voient, la famille non. */
import { chromium } from 'playwright';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];

async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 430, height: 1200 }, locale: 'fr-FR' })).newPage();
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
const text = async (page, sel = '#view') => (await page.locator(sel).first().textContent()).replace(/\s+/g, ' ');

// --- moi : un sondage de famille, et un « lien seulement » pour les voisins
const me = await device('moi', { me: 'Gui', groups: [MIFA] });
const newPoll = async (question, chip) => {
  await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/polls"]'); await me.click('[data-goto="#/polls/new"]'); await me.waitForSelector('#new-poll');
  if (chip) { await me.click(`[data-new-group="${chip}"]`); await me.waitForTimeout(250); }
  await me.fill('#poll-question', question);
  await me.fill('#poll-choices', 'vendredi\nsamedi');
  await me.fill('[data-person-index="0"]', 'Gui');
  await me.click('#new-poll button[type=submit]');
  await me.waitForSelector('#poll-day', { state: 'attached' });
  await me.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
  await me.fill('#poll-day', '2026-10-09');
  await me.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
  await me.click('#poll-date-save');
  await me.waitForTimeout(700);
};

await newPoll('Quel soir pour la raclette ?');
await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/polls"]'); await me.click('[data-goto="#/polls/new"]'); await me.waitForSelector('#new-poll');
check('le formulaire propose « Lien seulement »', (await me.locator('[data-new-group="@lien"]').count()) === 1);
await me.click('[data-new-group="@lien"]'); await me.waitForTimeout(250);
check('et dit ce que ça veut dire', /Aucun groupe ne le voit/.test(await text(me, '#new-poll')));
await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/polls"]');
await newPoll('Quel soir pour la fête des voisins ?', '@lien');
check('le sondage se dit « lien seulement »', /Lien seulement — seuls ceux qui ont reçu le lien/.test(await text(me)));
check('et ne propose pas de le mettre dans un groupe', (await me.locator('[data-put-in-group]').count()) === 0);

await me.click('#poll-share');
await me.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await me.inputValue('#export-text');
await me.click('#export-close');

// --- Claire, dans Mifa, qui synchronise
const sister = await device('Claire', { me: 'Claire', groups: [{ ...MIFA, admits: false }] });
await sister.click('#sync'); await sister.waitForTimeout(1500);
await sister.click('[data-tab="home"]'); await sister.click('.segmented--kinds [data-goto="#/polls"]'); await sister.waitForTimeout(400);
const hers = (await sister.locator('.game-card__title').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
check('Claire voit le sondage de famille', hers.some((h) => /raclette/.test(h)), hers.join(' | '));
check('mais pas celui des voisins', !hers.some((h) => /voisins/.test(h)), hers.join(' | '));
await sister.click('[data-tab="home"]');
await sister.waitForSelector('.segmented--kinds [data-goto="#/"][aria-current="true"]');
const coming = await text(sister, '.section:has-text("Ce qui vient")');
check('ni dans « Ce qui vient »', /Raclette/.test(coming) && !/voisins/i.test(coming), coming.slice(0, 120));

// --- Paul, voisin, dans aucun groupe, qui reçoit le lien
const paul = await device('Paul', { me: 'Paul' });
await paul.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await paul.waitForSelector('.votes', { timeout: 15000 });
check('Paul l’ouvre par le lien', /voisins/.test(await text(paul, 'h1')));
await paul.locator('.votes tbody tr').first().locator('.vote').first().click();
await paul.waitForTimeout(800);
const back = await me.waitForFunction(() => document.querySelectorAll('.vote--yes').length >= 1, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('et son vote m’arrive', back);

// --- ma pastille Mifa ne le compte pas
await me.click('[data-tab="home"]'); await me.click('.segmented--kinds [data-goto="#/polls"]');
await me.waitForSelector('[data-goto="#/polls/new"]');
const mine = (await me.locator('.game-card__title').allTextContents()).length;
check('sous « Tous », je vois mes deux sondages', mine === 2, String(mine));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
