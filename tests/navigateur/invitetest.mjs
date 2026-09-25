import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null, me = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k, me]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      const prefs = {};
      if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }];
      if (me) prefs.me = me;
      if (Object.keys(prefs).length) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
    } catch {}
  }, [CONFIG, key, me]);
  await page.goto('http://localhost:8099/dist/marque-points.html#/groups');
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- inviter depuis un appareil du groupe -------------------------------- */

const mine = await device('moi', { key: 'la-cle-famille' });
await mine.waitForSelector('[data-invite]');
await mine.click('[data-invite]');
await mine.waitForSelector('#invite-one', { timeout: 15000 });
await mine.click('#invite-one');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const code = (await mine.locator('#export-code-value').textContent()).trim();
const shown = await mine.locator('#export-text').inputValue();
check('l’invitation est un code à six chiffres', /^[0-9]{6}$/.test(code), code);
check('ce qui se partage porte le lien, le groupe et le code',
  shown.includes(`#/join/${code}/Mifa`) && /^Nom : Mifa$/m.test(shown) && shown.includes(`Code : ${code}`),
  shown.slice(0, 120));
check('l’invitation vaut deux jours', /Valable 2 jours/.test(shown), (shown.match(/Valable.*/) || [''])[0]);
await mine.click('#export-close');

/* --- entrer avec le nom et le code --------------------------------------- */

const other = await device('autre');
check('un appareil neuf n’est dans aucun groupe', (await other.locator('[data-catch-up]').count()) === 0);
check('et on lui demande un nom et un code',
  (await other.locator('#group-name').count()) === 1 && (await other.locator('#group-code').count()) === 1);

await other.fill('#group-name', 'Mifa');
await other.fill('#group-code', '000000');
await other.click('#group-join');
await other.waitForTimeout(1200);
check('sans prénom, on ne frappe pas',
  /prénom/.test(await other.locator('#group-state').textContent()),
  await other.locator('#group-state').textContent());

await other.fill('#me-name', 'Alice');
await other.click('#me-save');
await other.waitForTimeout(400);
await other.fill('#group-name', 'Mifa');
await other.fill('#group-code', '000000');
await other.click('#group-join');
await other.waitForTimeout(1200);
check('un code faux est refusé', /ne vont pas ensemble|expiré/.test(await other.locator('#group-state').textContent()),
  await other.locator('#group-state').textContent());

await other.fill('#group-code', `${code.slice(0, 3)} ${code.slice(3)}`);
await other.press('#group-code', 'Enter');
// Le message du prénom enregistré peut encore être là : on attend celui-ci.
await other.waitForFunction(
  () => /Demande envoyée/.test(document.querySelector('.banner')?.textContent || ''),
  null, { timeout: 15000 },
);
check('le bon code fait frapper, code dit à voix haute compris',
  /Mifa/.test(await other.locator('.banner').textContent()),
  await other.locator('.banner').textContent());
check('mais rien n’est ouvert avant acceptation',
  (await other.locator('[data-catch-up]').count()) === 0
    && (await other.locator('[data-check]').count()) === 1);

await mine.reload();
await mine.waitForSelector('[data-admit]', { timeout: 15000 });
await mine.click('[data-admit]');
await mine.waitForSelector('.banner', { timeout: 15000 });
await other.click('[data-check]');
await other.waitForSelector('[data-catch-up]', { timeout: 15000 });
check('accepté, le groupe apparaît', (await other.locator('[data-catch-up]').count()) === 1);

const held = await other.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups);
check('l’appareil a reçu une clé à lui', typeof held[0].key === 'string' && held[0].key.length > 10);
check('différente de celle qui a invité', held[0].key !== 'la-cle-famille', held[0].key.slice(0, 12));

/* --- une invitation pour une seule personne ne sert qu'une fois ---------- */

const third = await device('troisième', { me: 'Bob' });
await third.fill('#group-name', 'Mifa');
await third.fill('#group-code', code);
await third.click('#group-join');
await third.waitForTimeout(1200);
check('la même invitation ne resservira pas',
  (await third.locator('[data-check]').count()) === 0,
  await third.locator('#group-state').textContent());

/* --- et le nouvel appareil peut partager --------------------------------- */

await other.click('[data-tab="home"]'); await other.click('.segmented--kinds [data-goto="#/lists"]');
await other.click('[data-goto="#/lists/new"]');
await other.waitForSelector('#new-list');
await other.fill('#list-name', 'Courses');
await other.fill('[data-person-index="0"]', 'Gui');
await other.fill('#list-lines', 'Pain');
await other.click('#new-list button[type=submit]');
await other.waitForSelector('.lines');
await other.click('#list-share');
await other.waitForSelector('#export-dialog[open]', { timeout: 15000 });
check('le nouvel appareil partage dans le groupe',
  /#\/list\/l_/.test(await other.inputValue('#export-text')));
await other.click('#export-close');

// et l'appareil d'origine le voit
await mine.click('[data-catch-up]');
// Un message précédent peut encore être à l'écran : on attend celui-ci.
await mine.waitForFunction(
  () => /élément/.test(document.querySelector('.banner')?.textContent || ''),
  null, { timeout: 15000 },
);
check('ce qu’il partage arrive chez l’autre appareil du groupe',
  /1 élément/.test(await mine.locator('.banner').textContent()),
  await mine.locator('.banner').textContent());

/* --- la clé reste possible pour le tout premier appareil ------------------ */

const first = await device('premier');
await first.click('.details summary');
await first.fill('#group-key', 'la-cle-famille');
await first.click('#group-paste');
await first.waitForSelector('.banner', { timeout: 15000 });
check('une clé collée fait toujours entrer', (await first.locator('[data-catch-up]').count()) === 1);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
