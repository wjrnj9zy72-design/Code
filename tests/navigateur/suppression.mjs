/**
 * Ce qui est supprimé l'est dans la base d'abord : un sondage supprimé ne
 * s'ouvre plus par son lien. Si la base refuse — un sondage que l'on
 * n'organise pas —, rien n'est retiré de l'appareil, et on dit pourquoi ; le
 * menu d'un sondage que l'on n'organise pas ne propose pas de le supprimer.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const prefs = (me) => ({ me, groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] });
const remote = { url: 'http://127.0.0.1:8123', key: 'test-anon-key' };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function device(me) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'fr-FR' })).newPage();
  page.on('pageerror', (e) => errors.push(`${me}: ${e.message}`));
  await page.addInitScript(([p, r]) => {
    if (localStorage.getItem('marque-points:prefs:v1')) return;
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify(p));
    localStorage.setItem('marque-points:remote:v1', JSON.stringify(r));
  }, [prefs(me), remote]);
  return page;
}
const held = (page, id) => page.evaluate((i) => JSON.parse(localStorage.getItem('marque-points:polls:v1') || '[]').some((p) => p.id === i), id);

const gui = await device('Gui');
await gui.goto(`${B}#/polls/new`);
await gui.waitForSelector('#poll-question');
await gui.fill('#poll-question', 'Quel resto ?');
await gui.fill('#poll-choices', 'Pizza\nSushi');
await gui.click('#new-poll button[type=submit]');
await gui.waitForFunction(() => /^#\/poll\//.test(location.hash));
const id = (await gui.evaluate(() => location.hash)).split('/')[2];
await gui.waitForTimeout(1500);

const alice = await device('Alice');
await alice.goto(`${B}#/poll/${id}`);
await alice.waitForFunction(() => /Quel resto/.test(document.querySelector('#view h1')?.textContent || ''), null, { timeout: 15000 });
check('Alice ouvre le sondage par son lien', await held(alice, id));

/* --- 1. qui n'organise pas ne supprime pas ------------------------------- */

await alice.goto(`${B}#/polls`);
await alice.waitForSelector(`[data-goto="#/poll/${id}"]`);
await alice.locator(`[data-goto="#/poll/${id}"]`).first().click({ button: 'right' });
await alice.waitForSelector('dialog[open] [data-menu-cancel]');
check('le menu ne lui propose pas de le supprimer', (await alice.locator('dialog[open] [data-menu-delete]').count()) === 0);
check('et dit pourquoi', /Seul l’organisateur/.test(await alice.locator('dialog[open]').textContent()));
await alice.click('dialog[open] [data-menu-cancel]');

/* --- 2. l'organisateur supprime : c'est fini, lien compris ---------------- */

await gui.goto(`${B}#/poll/${id}`);
await gui.waitForSelector('#poll-delete', { state: 'attached' });
await gui.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
await gui.click('#poll-delete');
await gui.click('.dialog--ask [data-answer="yes"]');
await gui.waitForFunction((i) => !location.hash.includes(i), id);
check('supprimé chez l’organisateur', !(await held(gui, id)));

const paul = await device('Paul');
await paul.goto(`${B}#/poll/${id}`);
await paul.waitForTimeout(3000);
check('le lien ne l’ouvre plus', !(await held(paul, id)) && !/Quel resto/.test(await paul.locator('#view').textContent()));
await alice.goto(`${B}#/poll/${id}`);
await alice.waitForTimeout(3000);
check('et Alice, qui l’avait, ne l’a plus', !(await held(alice, id)));

/* --- 3. la base ne répond pas : rien n'est retiré ------------------------- */

await gui.goto(`${B}#/polls/new`);
await gui.waitForSelector('#poll-question');
await gui.fill('#poll-question', 'Quel film ?');
await gui.fill('#poll-choices', 'A\nB');
await gui.click('#new-poll button[type=submit]');
await gui.waitForFunction(() => /^#\/poll\//.test(location.hash));
const film = (await gui.evaluate(() => location.hash)).split('/')[2];
await gui.waitForTimeout(1500);
await gui.route('**/rpc/marque_points_delete', (route) => route.abort());
await gui.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
await gui.click('#poll-delete');
await gui.click('.dialog--ask [data-answer="yes"]');
await gui.waitForTimeout(1500);
check('sans réponse de la base, il reste sur l’appareil', await held(gui, film));
check('et l’app le dit', /Pas supprimé/.test(await gui.locator('#view').textContent()));

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
