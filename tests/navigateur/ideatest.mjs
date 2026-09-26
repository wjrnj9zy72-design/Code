/**
 * Les idées : un tableau, des notes, des croquis dessinés au doigt — et deux
 * appareils qui dessinent sur le même croquis sans s'écraser.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const PAGE = 'http://localhost:8099/dist/marque-points.html';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null, me = null, dark = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'fr-FR', hasTouch: true,
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k, name]) => {
    localStorage.setItem('marque-points:remote:v1', c);
    const prefs = {};
    if (name) prefs.me = name;
    if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }];
    if (Object.keys(prefs).length) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
  }, [CONFIG, key, me]);
  await page.goto(PAGE);
  await page.waitForSelector('.app-bar');
  return page;
}

/** Un trait tiré à la souris, d'un point à l'autre de la zone (en fractions). */
async function draw(page, from, to, steps = 12) {
  const box = await page.locator('#sketch-pad').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  }
  await page.mouse.up();
}

const strokes = (page) => page.locator('#sketch-pad path').count();

const page = await device('moi', { key: 'la-cle-famille', me: 'Gui' });

/* ---- 1. un tableau ------------------------------------------------------- */

await page.click('[data-tab="home"]');
await page.click('.segmented--kinds [data-goto="#/ideas"]');
await page.waitForSelector('[data-goto="#/ideas/new"]');
check('l’onglet Idées dit quoi en faire', /Un voyage, un cadeau/.test(await page.locator('#view').textContent()));

await page.click('[data-goto="#/ideas/new"]');
await page.waitForSelector('#new-board');
await page.fill('#board-name', 'Corse');
check('le formulaire dit où va le tableau, « Garder pour moi » compris',
  (await page.locator('#new-board [data-new-group]').allTextContents()).map((s) => s.trim()).join(' / ') === 'Mifa / Lien seulement / Garder pour moi',
  (await page.locator('#new-board [data-new-group]').allTextContents()).map((s) => s.trim()).join(' / '));
check('et le seul groupe est choisi d’office',
  /Mifa/.test(await page.locator('#new-board .chip--on').textContent()));
await page.click('#new-board button[type=submit]');
await page.waitForSelector('#board-add-note', { timeout: 15000 });
check('aucune question après le bouton', (await page.locator('dialog[open]').count()) === 0);
check('un tableau se crée', (await page.locator('h1').textContent()).trim() === 'Corse');

/* ---- 2. une note --------------------------------------------------------- */

await page.click('#board-add-note');
await page.waitForSelector('dialog[open] #note-text');
await page.fill('#note-text', 'Bateau à Bonifacio\nPlage de Palombaggia');
await page.click('dialog[open] [data-card-save]');
await page.waitForSelector('.idea-card');
check('la note apparaît en carte', /Bonifacio/.test(await page.locator('.idea-card').first().textContent()));

await page.click('#board-add-note');
await page.waitForSelector('dialog[open] #note-text');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
check('une note vide n’est pas gardée', (await page.locator('.idea-card').count()) === 1);

await page.locator('.idea-card').first().click();
await page.waitForSelector('dialog[open] #note-text');
await page.fill('#note-text', 'Bateau à Bonifacio — réserver');
await page.keyboard.press('Escape');
await page.waitForSelector('.dialog--ask[open]');
check('Échap sur une note changée demande avant de tout perdre', /sans enregistrer/.test(await page.textContent('.dialog--ask[open]')));
await page.click('.dialog--ask[open] [data-answer="no"]');
check('et « Annuler » là revient à la note, intacte', (await page.inputValue('#note-text')) === 'Bateau à Bonifacio — réserver');
await page.click('dialog[open] [data-card-cancel]');
await page.click('.dialog--ask[open] [data-answer="yes"]');
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
check('« Quitter sans enregistrer » laisse la note comme elle était',
  !/réserver/.test(await page.locator('.idea-card').first().textContent()));
await page.locator('.idea-card').first().click();
await page.waitForSelector('dialog[open] #note-text');
await page.click('dialog[open] [data-card-cancel]');
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
check('rien changé : « Annuler » ferme sans rien demander', (await page.locator('.dialog--ask').count()) === 0);
await page.locator('.idea-card').first().click();
await page.waitForSelector('dialog[open] #note-text');
await page.fill('#note-text', 'Bateau à Bonifacio — réserver');
await page.click('dialog[open] [data-card-save]');
await page.waitForFunction(() => /réserver/.test(document.querySelector('.idea-card')?.textContent || ''));
check('« Enregistrer » garde ce qui a été tapé', true);

/* ---- 3. un croquis ------------------------------------------------------- */

await page.click('#board-add-sketch');
await page.waitForSelector('dialog[open] #sketch-pad');
await draw(page, [0.1, 0.1], [0.9, 0.2]);
await page.click('dialog[open] [data-ink="red"]');
await draw(page, [0.1, 0.8], [0.9, 0.5]);
check('deux traits dessinés', (await strokes(page)) === 2);
check('le second est rouge', (await page.locator('#sketch-pad path.ink-red').count()) === 1);

const points = await page.locator('#sketch-pad path').first().getAttribute('d');
check('un trait droit est allégé à ses deux bouts', (points.match(/L/g) || []).length <= 2, points);

await page.click('dialog[open] [data-tool="undo"]');
check('Défaire retire le dernier trait', (await strokes(page)) === 1);

await draw(page, [0.5, 0.9], [0.5, 0.95], 3);
await page.click('dialog[open] [data-tool="eraser"]');
const kept = await page.locator('#sketch-pad path').first().getAttribute('d');
await draw(page, [0.45, 0.92], [0.55, 0.92], 4);
check('la gomme fine coupe le trait là où elle passe', (await strokes(page)) === 3, String(await strokes(page)));
check('et ne touche pas au reste', (await page.locator('#sketch-pad path').first().getAttribute('d')) === kept);
await page.click('dialog[open] [data-rubber="45"]');
check('la gomme a trois tailles', (await page.locator('dialog[open] [data-rubber]').count()) === 3);
await draw(page, [0.4, 0.9], [0.6, 0.95], 6);
check('la large efface les morceaux restants', (await strokes(page)) === 1, String(await strokes(page)));
await page.click('dialog[open] [data-tool="undo"]');
check('Défaire rend ce que la gomme a pris', (await strokes(page)) === 3, String(await strokes(page)));
await page.click('dialog[open] [data-tool="eraser"]');
await draw(page, [0.4, 0.9], [0.6, 0.95], 6);

await page.fill('#sketch-caption', 'Le trajet');
await page.click('dialog[open] button[type=submit]');
await page.waitForSelector('.idea-card--sketch');
check('le croquis apparaît en carte, avec sa légende',
  (await page.locator('.idea-card--sketch path').count()) === 1
  && /Le trajet/.test(await page.locator('.idea-card--sketch').textContent()));
check('le plus récent vient en premier', await page.locator('.idea-card').first().evaluate((n) => n.classList.contains('idea-card--sketch')));

/* ---- 4. partagé : l'autre appareil le voit, et dessine aussi ------------- */

const other = await device('autre', { key: 'la-cle-famille', me: 'Alice', dark: true });
await other.click('[data-tab="home"]');
await other.click('.segmented--kinds [data-goto="#/ideas"]');
await other.waitForSelector('.game-card', { timeout: 20000 });
check('un autre appareil du groupe reçoit le tableau', /Corse/.test(await other.locator('.game-card').first().textContent()));
await other.click('.game-card');
await other.waitForSelector('.idea-card--sketch', { timeout: 15000 });

await other.locator('.idea-card--sketch').click();
await other.waitForSelector('dialog[open] #sketch-pad');
check('le croquis s’ouvre avec son trait', (await strokes(other)) === 1);
await draw(other, [0.2, 0.4], [0.8, 0.4]);

// Pendant ce temps, ici, un trait de plus sur le même croquis.
await page.locator('.idea-card--sketch').click();
await page.waitForSelector('dialog[open] #sketch-pad');
await draw(page, [0.3, 0.6], [0.7, 0.7]);
await page.click('dialog[open] button[type=submit]');
await other.click('dialog[open] button[type=submit]');

await other.waitForFunction(() => document.querySelectorAll('.idea-card--sketch path').length === 3, null, { timeout: 20000 })
  .catch(() => {});
check('les deux dessins tiennent ensemble là-bas', (await other.locator('.idea-card--sketch path').count()) === 3,
  String(await other.locator('.idea-card--sketch path').count()));
const here = await page.waitForFunction(() => document.querySelectorAll('.idea-card--sketch path').length === 3, null, { timeout: 20000 })
  .then(() => true).catch(() => false);
check('et ici', here, String(await page.locator('.idea-card--sketch path').count()));

const ink = await other.locator('.idea-card--sketch path.ink-ink').first().evaluate((n) => getComputedStyle(n).stroke);
check('en mode sombre, l’encre est claire', /rgb\((2[0-9]{2}), (2[0-9]{2})/.test(ink), ink);

/* ---- 5. supprimer une carte ---------------------------------------------- */

await page.locator('.idea-card:not(.idea-card--sketch)').click();
await page.waitForSelector('dialog[open] [data-card-delete]');
await page.click('dialog[open] [data-card-delete]');
await page.waitForSelector('.dialog--ask');
await page.click('.dialog--ask [data-answer="yes"]');
await page.waitForFunction(() => document.querySelectorAll('.idea-card').length === 1);
check('une carte se supprime', (await page.locator('.idea-card').count()) === 1);
const gone = await other.waitForFunction(() => document.querySelectorAll('.idea-card').length === 1, null, { timeout: 20000 })
  .then(() => true).catch(() => false);
check('et disparaît chez l’autre', gone);

/* ---- 6. glisser pour supprimer ------------------------------------------ */

/** Glisser une carte vers la gauche, à la souris (les mêmes événements qu'au doigt). */
async function swipe(target, fraction = 0.6) {
  const box = await target.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 10, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + box.width - 10 - (box.width * fraction * i) / 10, y);
  await page.mouse.up();
}

await page.click('#board-add-note');
await page.waitForSelector('dialog[open] #note-text');
await page.fill('#note-text', 'À jeter');
await page.click('dialog[open] [data-card-save]');
await page.waitForFunction(() => document.querySelectorAll('.idea-card').length === 2);
check('le tableau dit comment supprimer', /Glissez une carte vers la gauche/.test(await page.locator('#view').textContent()));

const first = page.locator('.swipe').first();
await swipe(first.locator('.swipe__body'), 0.1);
await page.waitForTimeout(250);
check('un petit glissement ne découvre rien', !(await first.evaluate((n) => n.classList.contains('swipe--open'))));
check('et n’ouvre pas la carte', (await page.locator('dialog[open]').count()) === 0);

await swipe(first.locator('.swipe__body'));
await page.waitForTimeout(250);
check('glisser découvre « Supprimer »', await first.evaluate((n) => n.classList.contains('swipe--open')));
check('le bouton est bien visible', await first.locator('.swipe__delete').evaluate((n) => {
  const r = n.getBoundingClientRect();
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === n;
}));
check('sans que la carte s’ouvre', (await page.locator('dialog[open]').count()) === 0);

await first.locator('.swipe__body').click();
await page.waitForTimeout(250);
check('toucher la carte la referme, sans l’ouvrir',
  !(await first.evaluate((n) => n.classList.contains('swipe--open'))) && (await page.locator('dialog[open]').count()) === 0);

await swipe(first.locator('.swipe__body'));
await page.waitForTimeout(250);
await first.locator('.swipe__delete').click();
await page.waitForFunction(() => document.querySelectorAll('.idea-card').length === 1);
check('toucher « Supprimer » retire la carte', !/À jeter/.test(await page.locator('.idea-grid').textContent()));

// Un tableau, dans la liste des tableaux, se glisse aussi — mais on demande.
await page.click('[data-goto="#/ideas"]');
await page.waitForSelector('.swipe');
await swipe(page.locator('.swipe').first().locator('.swipe__body'));
await page.waitForTimeout(250);
await page.locator('.swipe').first().locator('.swipe__delete').click();
await page.waitForSelector('.dialog--ask');
await page.click('.dialog--ask [data-answer="no"]');
await page.waitForTimeout(250);
check('un tableau entier : on demande, et « Annuler » le garde', (await page.locator('.swipe').count()) === 1);

/* ---- 6 bis. garder pour moi ---------------------------------------------- */

await page.click('[data-goto="#/ideas/new"]');
await page.waitForSelector('#new-board');
await page.fill('#board-name', 'Secret');
await page.locator('#new-board [data-new-group]', { hasText: 'Garder pour moi' }).click();
await page.waitForSelector('#new-board [data-new-group=""].chip--on');
check('le nom tapé reste quand on change de groupe', (await page.inputValue('#board-name')) === 'Secret');
await page.click('#new-board button[type=submit]');
await page.waitForSelector('#board-add-note');
const secret = await page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:boards:v1')).find((b) => b.name === 'Secret'));
check('« Garder pour moi » : dans aucun groupe, rien envoyé', secret && !secret.shared && !secret.groupId);

await other.reload();
await other.click('[data-tab="home"]');
await other.click('.segmented--kinds [data-goto="#/ideas"]');
await other.waitForSelector('.game-card');
await other.waitForTimeout(1500);
check('et l’autre appareil ne le voit pas', !/Secret/.test(await other.locator('#view').textContent()));

/* ---- 7. l'écran tient sur un téléphone ----------------------------------- */

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('pas de défilement horizontal', overflow <= 0, String(overflow));

/* ---- fin ----------------------------------------------------------------- */

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
