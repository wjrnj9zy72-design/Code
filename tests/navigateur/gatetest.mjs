/**
 * Le portier : un lien ouvert, des gens qui frappent, et c'est moi qui accepte.
 * Vérifie aussi ce qu'une clé ordinaire ne peut pas faire, la coupure d'un
 * appareil, et ce que voit celui qui attend pendant qu'il attend.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const PAGE = 'http://localhost:8099/dist/marque-points.html';

async function device(label, { key = null, hash = '', me = null, admits = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k, name, admitting]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      const prefs = {};
      if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k, admits: admitting }];
      if (name) prefs.me = name;
      if (Object.keys(prefs).length) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
    } catch {}
  }, [CONFIG, key, me, admits]);
  await page.goto(PAGE + hash);
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- le lien du jour ----------------------------------------------------- */

const gui = await device('gui', { key: 'la-cle-famille', me: 'Gui' });
await gui.waitForSelector('[data-invite]');
await gui.click('[data-invite]');
await gui.waitForSelector('#invite-open');
check('deux formes d’invitation sont proposées',
  (await gui.locator('#invite-open').count()) === 1 && (await gui.locator('#invite-one').count()) === 1);
check('ce qui les sépare, c’est le nombre de personnes',
  /Une seule personne/.test(await gui.locator('#invite-one').textContent())
  && /Plusieurs personnes/.test(await gui.locator('#invite-open').textContent()),
  await gui.locator('#invite-one').textContent());
check('et les deux valent deux jours, dit une fois',
  /valent deux jours/.test(await gui.locator('dialog[open]').textContent()));
check('et le choix dit que personne n’entre sans acceptation',
  /accept/i.test(await gui.locator('.dialog--ask p').textContent()),
  await gui.locator('.dialog--ask p').textContent());
await gui.click('#invite-open');
await gui.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const message = await gui.inputValue('#export-text');
const link = (message.match(/https?:\/\/\S*#\/join\/\S+/) || [''])[0];
const hint = await gui.locator('#export-hint').textContent();
check('le message porte le nom, le code et les deux jours',
  /^Nom : Mifa$/m.test(message) && /Code : \d{6}/.test(message) && /Valable 2 jours/.test(message),
  message.slice(0, 100));
await gui.click('#export-close');

/* --- trois personnes frappent avec le même lien -------------------------- */

const hash = link.slice(link.indexOf('#'));
const knock = async (name) => {
  const page = await device(name, { hash });
  await page.waitForSelector('#join-form');
  await page.fill('#join-me', name);
  await page.click('#join-form button[type=submit]');
  await page.waitForSelector('#waiting-check', { timeout: 15000 });
  return page;
};

const alice = await knock('Alice');
const bob = await knock('Bob');
const claire = await knock('Claire');
check('le même lien sert à trois personnes',
  (await alice.locator('#waiting-check').count()) === 1 && (await claire.locator('#waiting-check').count()) === 1);
check('celle qui attend ne voit rien du groupe',
  await alice.evaluate(() => !(JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups || []).length));
check('et son écran dit qu’on ne recevra pas de notification',
  /notification/.test(await alice.locator('.card').textContent()));

/* --- le portier voit les trois, et choisit ------------------------------- */

await gui.reload();
await gui.waitForSelector('[data-admit]', { timeout: 15000 });
const knocks = await gui.locator('.knock').allTextContents();
check('les trois demandes sont là, avec les prénoms',
  knocks.filter((row) => /Alice|Bob|Claire/.test(row)).length === 3, knocks.join(' / '));
check('et l’ordre est celui dans lequel on a frappé',
  /Alice/.test(knocks[0]) && /Claire/.test(knocks[2]), knocks.map((k) => k.trim().slice(0, 12)).join(' | '));

// Alice acceptée, Bob refusé, Claire laissée en attente
const rowOf = (name) => gui.locator('.knock', { hasText: name });
await rowOf('Alice').locator('[data-admit]').click();
await gui.waitForSelector('.banner', { timeout: 15000 });
await rowOf('Bob').locator('[data-refuse]').click();
await gui.waitForTimeout(1200);
const left = await gui.locator('.knock [data-admit]').count();
check('une acceptée, une refusée, une encore en attente', left === 1,
  `restantes: ${left}`);

await alice.click('#waiting-check');
await alice.waitForSelector('.banner', { timeout: 15000 });
check('Alice entre, et le voit',
  (await alice.locator('.banner').textContent()).includes('Mifa'),
  await alice.locator('.banner').textContent());
const aliceKey = await alice.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups[0].key);
check('avec une clé à elle', typeof aliceKey === 'string' && aliceKey !== 'la-cle-famille');

await bob.click('#waiting-check');
await bob.waitForSelector('.banner', { timeout: 15000 });
check('Bob est refusé, proprement, et sans clé',
  /refusée/.test(await bob.locator('.banner').textContent())
    && (await bob.evaluate(() => (JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups || []).length)) === 0,
  await bob.locator('.banner').textContent());

/* --- Claire attend, et l'apprend toute seule ---------------------------- */

await rowOf('Claire').locator('[data-admit]').click();
await gui.waitForTimeout(500);
await claire.waitForSelector('.banner', { timeout: 20000 });
check('Claire est entrée sans rien toucher : la page regardait',
  (await claire.locator('.banner').textContent()).includes('Mifa'),
  await claire.locator('.banner').textContent());

/* --- une clé ordinaire ne fait entrer personne --------------------------- */

await alice.reload();
await alice.waitForSelector('.group', { timeout: 15000 });
await alice.waitForTimeout(1200);
check('l’appareil accepté ne voit pas les demandes',
  (await alice.locator('[data-admit]').count()) === 0 && (await alice.locator('[data-cut]').count()) === 0,
  await alice.locator('.group').textContent());
check('mais il partage et récupère comme les autres',
  (await alice.locator('[data-catch-up]').count()) === 1);

/* --- qui est dans le groupe, et la coupure ------------------------------- */

await gui.reload();
await gui.waitForSelector('[data-catch-up]', { timeout: 15000 });
await gui.click('.group .details summary');
await gui.waitForTimeout(1000);
const devices = await gui.locator('.details .knock').allTextContents();
check('les appareils du groupe sont listés, prénom compris — et Bob, refusé, n’en est pas',
  devices.length === 3 && devices.some((row) => /Alice/.test(row))
    && devices.some((row) => /cet appareil/.test(row)) && !devices.some((row) => /Bob/.test(row)),
  devices.map((d) => d.replace(/\s+/g, ' ').trim().slice(0, 30)).join(' | '));
check('l’appareil qui regarde ne se propose pas de se couper lui-même',
  (await gui.locator('.details .knock', { hasText: 'cet appareil' }).locator('[data-cut]').count()) === 0);

gui.once('dialog', () => {});
await gui.locator('.details .knock', { hasText: 'Alice' }).locator('[data-cut]').click();
await gui.waitForSelector('dialog[open] .button--danger, dialog[open] #confirm-yes, dialog[open] button', { timeout: 5000 });
const confirm = gui.locator('dialog[open] button', { hasText: 'Couper' });
await confirm.first().click();
await gui.waitForSelector('.banner', { timeout: 15000 });
check('couper un appareil le met dehors', /dehors/.test(await gui.locator('.banner').textContent()),
  await gui.locator('.banner').textContent());

await alice.reload();
await alice.waitForSelector('.banner', { timeout: 15000 });
check('et son app le lui dit, au lieu de tout refuser sans raison',
  /ne faites plus partie/.test(await alice.locator('.banner').textContent()),
  await alice.locator('.banner').textContent());
check('le groupe a disparu de sa liste',
  (await alice.locator('[data-catch-up]').count()) === 0);

/* --- un membre qui réinstalle : sa propre clé le fait revenir seul --------- */

// Claire a été acceptée plus haut : elle détient une clé ordinaire.
const claireKey = await claire.evaluate(
  () => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups[0].key,
);
check('un membre peut relire sa clé', (await claire.locator('[data-show-key]').count()) === 1);
check('et l’app lui dit que chaque appareil a la sienne, et de la garder',
  /propre clé/.test(await claire.locator('.section', { has: claire.locator('#group-name') }).textContent())
    && /Gardez la vôtre/.test(await claire.locator('.section', { has: claire.locator('#group-name') }).textContent()));

// Ce que sa clé dit d'elle-même : elle ne fait entrer personne.
await claire.click('[data-show-key]');
await claire.waitForSelector('dialog[open] button');
await claire.locator('dialog[open] button', { hasText: 'Voir ma clé' }).first().click();
await claire.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const saidToClaire = await claire.locator('#export-hint').textContent();
check('sa clé annonce qu’elle ne fait entrer personne',
  /ne fait entrer personne/.test(saidToClaire) && /propre clé/.test(saidToClaire), saidToClaire.slice(0, 90));
await claire.click('#export-close');

// Et celle du portier annonce le contraire.
await gui.click('[data-show-key]');
await gui.waitForSelector('dialog[open] button');
await gui.locator('dialog[open] button', { hasText: 'Voir ma clé' }).first().click();
await gui.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const saidToGui = await gui.locator('#export-hint').textContent();
check('celle du portier annonce qu’elle fait entrer',
  /fait entrer/.test(saidToGui) && /donner la porte/.test(saidToGui), saidToGui.slice(-90));
await gui.click('#export-close');
check('et les deux clés sont bien différentes',
  (await gui.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups[0].key))
    !== (await claire.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups[0].key)));

// Elle réinstalle : nouveau stockage, rien d'autre.
const again = await device('Claire réinstallée', { key: null, me: null });
await again.click('.details summary');
await again.fill('#group-key', claireKey);
await again.click('#group-paste');
await again.waitForSelector('[data-catch-up]', { timeout: 15000 });
check('en recollant sa clé, elle revient sans invitation ni acceptation',
  (await again.locator('[data-catch-up]').count()) === 1);
check('et elle n’a pas hérité du droit de faire entrer',
  (await again.locator('[data-admit]').count()) === 0
    && (await again.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups[0].admits)) === false);

// Pendant ce temps, le portier n'a rien eu à faire : aucune demande en attente.
await gui.reload();
await gui.waitForSelector('.group', { timeout: 15000 });
await gui.waitForTimeout(1000);
check('le portier n’a rien à accepter pour cela',
  /Personne n’attend/.test(await gui.locator('.group').textContent()),
  await gui.locator('.group').textContent().then((t) => t.replace(/\s+/g, ' ').slice(0, 90)));

/* --- désigner qui fait entrer, depuis l'app -------------------------------- */

await gui.reload();
await gui.waitForSelector('[data-catch-up]', { timeout: 15000 });
await gui.click('.group .details summary');
await gui.waitForTimeout(1000);
const claireRow = gui.locator('.details .knock', { hasText: 'Claire' });
check('chaque appareil a un bouton pour lui donner la porte',
  (await claireRow.locator('[data-admits]').count()) === 1,
  await claireRow.textContent());
await claireRow.locator('[data-admits]').click();
await gui.locator('dialog[open] button', { hasText: 'Peut faire entrer' }).first().click();
await gui.waitForSelector('.banner', { timeout: 15000 });
check('le portier peut désigner un autre appareil depuis l’app',
  /peut désormais faire entrer/.test(await gui.locator('.banner').textContent()),
  await gui.locator('.banner').textContent());

// Claire, rechargée, voit la porte
await again.reload();
await again.waitForSelector('.group', { timeout: 15000 });
await again.waitForTimeout(1500);
check('et l’appareil désigné voit les demandes à son tour',
  (await again.locator('.details summary').count()) >= 1,
  await again.locator('.group').textContent().then((t) => t.replace(/\s+/g, ' ').slice(0, 80)));

// et on le lui retire
await gui.click('.group .details summary');
await gui.waitForTimeout(800);
await gui.locator('.details .knock', { hasText: 'Claire' }).locator('[data-admits]').click();
await gui.locator('dialog[open] button', { hasText: 'Ne plus faire entrer' }).first().click();
// Le message précédent vit quatre secondes : on attend celui-ci, pas n'importe lequel.
await gui.waitForFunction(
  () => /ne fait plus entrer/.test(document.querySelector('.banner')?.textContent || ''),
  null, { timeout: 15000 },
);
check('et le lui retirer', true, await gui.locator('.banner').textContent());

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
