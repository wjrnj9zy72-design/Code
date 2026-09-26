/** L'organisateur règle ; les membres du groupe et les visiteurs votent, et rien d'autre. */
import { chromium } from 'playwright';
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const MIFA = { id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const errors = [];
async function device(label, prefs) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 1100 }, locale: 'fr-FR' })).newPage();
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
const OWNER_ONLY = '#poll-day, #poll-date-save, #poll-close, #poll-delete, #poll-rename, #poll-archive, #poll-people, #poll-share, #poll-text, #add-choice, [data-option], [data-copy-to-group]';

// --- Gui crée le sondage dans Mifa : il en est l'organisateur
const gui = await device('Gui', { me: 'Gui', groups: [MIFA] });
await gui.click('[data-tab="home"]'); await gui.click('.segmented--kinds [data-goto="#/polls"]'); await gui.click('[data-goto="#/polls/new"]'); await gui.waitForSelector('#new-poll');
await gui.fill('#poll-question', 'Quel soir pour la raclette ?');
await gui.fill('#poll-choices', 'vendredi\nsamedi');
await gui.fill('[data-person-index="0"]', 'Gui');
await gui.fill('[data-person-index="1"]', 'Claire');
await gui.click('#new-poll button[type=submit]');
await gui.waitForSelector('.votes');
check('l’organisateur a tout : date, clôture, suppression…',
  (await gui.locator('#poll-day').count()) === 1 && (await gui.locator('#poll-close').count()) === 1 && (await gui.locator('#poll-delete').count()) === 1);
const pollId = await gui.evaluate(() => location.hash.split('/')[2]);

// --- Claire, membre de Mifa
const claire = await device('Claire', { me: 'Claire', groups: [{ ...MIFA, admits: false }] });
await claire.click('#sync'); await claire.waitForTimeout(1500);
await claire.evaluate((id) => { location.hash = `#/poll/${id}`; }, pollId);
await claire.waitForSelector('.votes', { timeout: 15000 });
const claireSees = await claire.locator(OWNER_ONLY).count();
check('Claire, membre du groupe, ne voit rien de ce qui règle le sondage', claireSees === 0, String(claireSees));
check('elle garde les onglets de l’app : elle est chez elle', await claire.locator('#tabs').isVisible());
await claire.locator('[data-me]', { hasText: 'Claire' }).click(); await claire.waitForTimeout(500);
await claire.locator('.votes tbody tr').nth(1).locator('td.votes__mine .vote').click();
await claire.waitForTimeout(800);
check('mais elle vote', (await claire.locator('td.votes__mine .vote--yes').count()) === 1);

// --- Gui voit le vote, fixe la date, clôt
const got = await gui.waitForFunction(() => document.querySelectorAll('.vote--yes').length === 1, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('son vote arrive chez l’organisateur', got);
await gui.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
await gui.fill('#poll-day', '2026-10-10'); await gui.fill('#poll-hour', '19:00');
await gui.evaluate(() => document.querySelector('#poll-date-by-hand')?.setAttribute('open', ''));
await gui.click('#poll-date-save'); await gui.waitForTimeout(600);
await gui.click('#poll-close'); await gui.waitForTimeout(600);

await claire.click('#sync'); await claire.waitForTimeout(1500);
const text = (await claire.locator('#view').textContent()).replace(/\s+/g, ' ');
check('Claire lit la date retenue', /Date retenue : sam\. 10 oct\. · 19:00/.test(text), text.slice(0, 200));
check('et peut l’ajouter à son agenda', (await claire.locator('#poll-ics').count()) === 1);
check('le sondage clos se voit chez elle', await claire.locator('.vote').first().isDisabled());

// --- Claire tente quand même d'écrire une autre date, par la base : refusé en silence
await claire.evaluate(async (id) => {
  const cfg = JSON.parse(localStorage.getItem('marque-points:remote:v1'));
  const polls = JSON.parse(localStorage.getItem('marque-points:polls:v1'));
  const poll = { ...polls.find((p) => p.id === id), date: '2030-01-01', closedAt: null, question: 'piraté' };
  await fetch(`${cfg.url}/rest/v1/rpc/marque_points_put`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ p_id: id, p_data: poll, p_key: 'la-cle-famille' }),
  });
}, pollId);
await gui.reload(); await gui.waitForSelector('.votes');
await gui.click('#sync').catch(() => {}); await gui.waitForTimeout(1500);
const guiText = (await gui.locator('h1').textContent()).trim();
check('la base garde ce que l’organisateur a réglé', guiText === 'Quel soir pour la raclette ?' && (await gui.inputValue('#poll-day')) === '2026-10-10',
  `${guiText} / ${await gui.inputValue('#poll-day')}`);

// --- un sondage d'avant, sans organisateur : tout le monde garde la main
await claire.evaluate(() => {
  const polls = JSON.parse(localStorage.getItem('marque-points:polls:v1'));
  polls.push({ kind: 'poll', id: 'v_ancien_sans_orga', question: 'Ancien', people: [], options: [], votes: {}, removed: {}, createdAt: 1, updatedAt: 1, peopleAt: 1 });
  localStorage.setItem('marque-points:polls:v1', JSON.stringify(polls));
});
await claire.reload(); await claire.waitForSelector('.app-bar');
await claire.evaluate(() => { location.hash = '#/poll/v_ancien_sans_orga'; });
await claire.waitForSelector('#poll-day', { state: 'attached', timeout: 15000 });
check('un sondage d’avant reste réglable par tous, comme avant', (await claire.locator('#poll-close').count()) === 1);

check('aucune erreur de page', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
