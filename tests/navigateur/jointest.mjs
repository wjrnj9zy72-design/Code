/**
 * Le chemin le plus simple : un lien d'invitation, un prénom, et voilà.
 * Vérifie aussi ce que le prénom apporte ensuite (étiquette de la clé,
 * personne proposée d'office) et ce qui se passe quand le lien est abîmé.
 */
import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const PAGE = 'http://localhost:8099/dist/marque-points.html';

async function device(label, { key = null, hash = '#/groups', me = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript(([c, k, name]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      const prefs = {};
      if (k) prefs.groups = [{ id: 'grp_famille', name: 'Mifa', key: k }];
      if (name) prefs.me = name;
      if (k || name) localStorage.setItem('marque-points:prefs:v1', JSON.stringify(prefs));
    } catch {}
  }, [CONFIG, key, me]);
  await page.goto(PAGE + hash);
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- le lien d'invitation ------------------------------------------------ */

const mine = await device('moi', { key: 'la-cle-famille', me: 'Gui' });
await mine.waitForSelector('[data-invite]');
await mine.click('[data-invite]');
await mine.waitForSelector('#invite-open', { timeout: 15000 });
check('inviter demande d’abord quelle invitation',
  (await mine.locator('#invite-one').count()) === 1);
await mine.click('#invite-open');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const message = await mine.inputValue('#export-text');
const link = (message.match(/https?:\/\/\S*#\/join\/\S+/) || [''])[0];
const code = (await mine.locator('#export-code-value').textContent()).trim();
check('l’invitation porte un lien', /#\/join\/\d{6}\/Mifa$/.test(link), link);
check('et les six chiffres restent affichés à côté', /^\d{6}$/.test(code), code);
check('avec un QR à montrer', (await mine.locator('#export-qr svg').count()) === 1);
await mine.click('#export-close');

/* --- celui qui reçoit n'écrit que son prénom ----------------------------- */

const hash = link.slice(link.indexOf('#'));
const her = await device('elle', { hash });
await her.waitForSelector('#join-form');
check('le lien ouvre une page d’entrée nommée',
  (await her.locator('h1').textContent()).includes('Mifa'),
  await her.locator('h1').textContent());
check('un seul champ visible : le prénom', (await her.locator('#join-me').count()) === 1);
check('le nom du groupe est déjà là', (await her.inputValue('#join-group')) === 'Mifa');
check('les six chiffres aussi', (await her.inputValue('#join-code')) === code);

await her.fill('#join-me', '  Alice  ');
await her.click('#join-form button[type=submit]');
await her.waitForSelector('#waiting-check', { timeout: 15000 });
check('elle frappe, et on lui dit d’attendre',
  (await her.locator('h1').textContent()).includes('Mifa'),
  await her.locator('h1').textContent());
check('et son appareil n’a encore aucune clé',
  await her.evaluate(() => !(JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups || []).length));

const prefs = await her.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')));
check('son prénom est retenu, sans les espaces', prefs.me === 'Alice', JSON.stringify(prefs.me));
check('sa demande est retenue avec le groupe', prefs.pendings?.[0]?.groupName === 'Mifa',
  JSON.stringify(prefs.pendings));

/* --- quelqu'un du groupe accepte ---------------------------------------- */

await mine.reload();
await mine.waitForSelector('[data-admit]', { timeout: 15000 });
check('la demande apparaît chez celui qui fait entrer',
  (await mine.locator('.knock').first().textContent()).includes('Alice'),
  await mine.locator('.knock').first().textContent());
await mine.click('[data-admit]');
await mine.waitForSelector('.banner', { timeout: 15000 });
check('il l’accepte d’une touche', /dans le groupe/.test(await mine.locator('.banner').textContent()),
  await mine.locator('.banner').textContent());

await her.click('#waiting-check');
await her.waitForSelector('.banner', { timeout: 15000 });
check('elle l’apprend et entre',
  (await her.locator('.banner').textContent()).includes('Mifa'),
  await her.locator('.banner').textContent());
check('et se retrouve dans l’onglet Groupes', (await her.locator('[data-catch-up]').count()) === 1);
const after = await her.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')));
check('avec une clé à elle', typeof after.groups[0].key === 'string' && after.groups[0].key !== 'la-cle-famille');
check('et plus de demande en attente', !(after.pendings || []).length);
await her.click('[data-tab="settings"]');
await her.waitForSelector('#me-name');
check('le champ Moi, dans Réglages, montre son prénom', (await her.inputValue('#me-name')) === 'Alice');

/* --- ce prénom, le groupe le voit --------------------------------------- */

const labels = await fetch('http://127.0.0.1:8123/rest/v1/rpc/marque_points_group_keys', {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
  body: JSON.stringify({ p_key: 'la-cle-famille' }),
}).then((r) => (r.ok ? r.json() : [])).catch(() => []);
check('la clé de son appareil est étiquetée à son prénom',
  labels.some((row) => String(row.label || '').includes('Alice')), JSON.stringify(labels));

/* --- et il sert partout ensuite ----------------------------------------- */

await her.click('[data-tab="home"]'); await her.click('.segmented--kinds [data-goto="#/lists"]');
await her.click('[data-goto="#/lists/new"]');
await her.waitForSelector('#new-list');
check('la première personne d’une nouvelle liste, c’est elle',
  (await her.inputValue('[data-person-index="0"]')) === 'Alice');

await her.click('[data-tab="home"]'); await her.click('.segmented--kinds [data-goto="#/polls"]');
await her.click('[data-goto="#/polls/new"]');
await her.waitForSelector('#new-poll');
check('un nouveau sondage aussi',
  (await her.inputValue('[data-person-index="0"]')) === 'Alice');

await her.click('[data-tab="home"]'); await her.click('.segmented--kinds [data-goto="#/games"]');
await her.click('[data-goto="#/new"]');
await her.waitForSelector('#new-game');
check('et une nouvelle partie', (await her.inputValue('[data-name-index="0"]')) === 'Alice');

/* --- un lien déjà utilisé, un lien pour un groupe déjà rejoint ----------- */

const late = await device('tard', { hash });
await late.waitForSelector('#join-form');
await late.fill('#join-me', 'Bob');
await late.click('#join-form button[type=submit]');
await late.waitForSelector('#waiting-check', { timeout: 15000 });
check('le même lien sert encore : il vaut pour plusieurs personnes',
  (await late.locator('h1').textContent()).includes('Mifa'));
check('et son prénom est retenu',
  (await late.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).me)) === 'Bob');

await mine.reload();
await mine.waitForSelector('[data-refuse]', { timeout: 15000 });
await mine.click('[data-refuse]');
await mine.waitForSelector('.banner', { timeout: 15000 });
await late.click('#waiting-check');
await late.waitForSelector('.banner', { timeout: 15000 });
check('un refus est dit à qui a frappé, sans clé au bout',
  /refusée/.test(await late.locator('.banner').textContent())
    && (await late.evaluate(() => (JSON.parse(localStorage.getItem('marque-points:prefs:v1')).groups || []).length)) === 0,
  await late.locator('.banner').textContent());

const again = await device('déjà dedans', { key: 'la-cle-famille', me: 'Gui', hash });
await again.waitForSelector('#join-form');
check('un appareil déjà dans le groupe le dit',
  /déjà dans/.test(await again.locator('#join-form p').first().textContent()),
  await again.locator('#join-form p').first().textContent());
await again.click('#join-form button[type=submit]');
await again.waitForSelector('.banner', { timeout: 15000 });
check('et récupère au lieu de dépenser l’invitation',
  /jour|récupéré/.test(await again.locator('.banner').textContent()),
  await again.locator('.banner').textContent());

/* --- le prénom se change à la main -------------------------------------- */

await again.click('[data-tab="settings"]');
await again.waitForSelector('#me-name');
await again.fill('#me-name', 'Guillaume');
await again.click('#me-save');
await again.waitForSelector('.banner');
check('le prénom se change depuis Réglages',
  (await again.evaluate(() => JSON.parse(localStorage.getItem('marque-points:prefs:v1')).me)) === 'Guillaume');

/* --- un lien collé plutôt que touché ------------------------------------ */

const pasted = await device('collé');
await pasted.click('[data-tab="settings"]');
await pasted.click('#open-link');
await pasted.waitForSelector('dialog[open] #link-text');
await pasted.fill('#link-text', `Coucou ${link} à tout de suite`);
await pasted.click('#link-open');
await pasted.waitForSelector('#join-form', { timeout: 15000 });
check('un lien collé mène à la même page',
  (await pasted.inputValue('#join-code')) === code && (await pasted.inputValue('#join-group')) === 'Mifa');

/* --- un lien sans son groupe -------------------------------------------- */

const half = await device('lien abîmé', { hash: `#/join/${code}` });
await half.waitForSelector('#join-form');
check('un lien tronqué demande le nom du groupe plutôt que d’échouer',
  (await half.inputValue('#join-code')) === code && (await half.inputValue('#join-group')) === '',
  await half.inputValue('#join-code'));
await half.fill('#join-me', 'Claire');
await half.click('#join-form button[type=submit]');
await half.waitForTimeout(600);
check('et dit lequel manque', /nom du groupe/.test(await half.locator('#join-state').textContent()),
  await half.locator('#join-state').textContent());

/* --- un prénom effacé reste effacé -------------------------------------- */

const clears = await device('effacé', { me: 'Gui' });
await clears.click('[data-tab="home"]'); await clears.click('.segmented--kinds [data-goto="#/lists"]');
await clears.click('[data-goto="#/lists/new"]');
await clears.waitForSelector('#new-list');
check('le prénom est proposé', (await clears.inputValue('[data-person-index="0"]')) === 'Gui');
await clears.fill('[data-person-index="0"]', '');
await clears.click('#add-person');
await clears.waitForTimeout(200);
check('effacé, il ne revient pas quand on ajoute une personne',
  (await clears.inputValue('[data-person-index="0"]')) === '',
  await clears.inputValue('[data-person-index="0"]'));
await clears.click('#drop-person');
await clears.waitForTimeout(200);
check('ni quand on en enlève une', (await clears.inputValue('[data-person-index="0"]')) === '');

await clears.click('[data-tab="home"]'); await clears.click('.segmented--kinds [data-goto="#/games"]');
await clears.click('[data-goto="#/new"]');
await clears.waitForSelector('#new-game');
await clears.fill('[data-name-index="0"]', '');
await clears.click('#add-name');
await clears.waitForTimeout(200);
check('idem pour une partie', (await clears.inputValue('[data-name-index="0"]')) === '',
  await clears.inputValue('[data-name-index="0"]'));

/* --- ce que dit le code à côté du lien ---------------------------------- */

await mine.click('[data-invite]');
await mine.waitForSelector('#invite-open', { timeout: 15000 });
await mine.click('#invite-open');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const codeHint = await mine.locator('#export-code-hint').textContent();
check('le code n’est plus présenté comme un secret à envoyer à part',
  /déjà dans le message et dans le lien/i.test(codeHint) && !/à part/.test(codeHint), codeHint);
await mine.click('#export-close');

/* --- un lien dont le code est abîmé garde le nom du groupe -------------- */

const half2 = await device('code abîmé', { hash: '#/join/1234567/Mifa' });
await half2.waitForSelector('#join-form');
check('un code à sept chiffres ne fait pas perdre le nom du groupe',
  (await half2.inputValue('#join-group')) === 'Mifa' && (await half2.inputValue('#join-code')) === '',
  await half2.inputValue('#join-group'));
check('et la page le dit dans son titre',
  (await half2.locator('h1').textContent()).includes('Mifa'));

/* --- un groupe retenu sans nom ne doit rien casser --------------------- */

const odd = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
const oddPage = await odd.newPage();
const oddErrors = [];
oddPage.on('pageerror', (e) => oddErrors.push(e.message));
await oddPage.addInitScript((c) => {
  try {
    localStorage.setItem('marque-points:remote:v1', c);
    localStorage.setItem('marque-points:prefs:v1',
      JSON.stringify({ groups: [{ id: 'grp_famille', key: 'la-cle-famille' }] }));
  } catch {}
}, CONFIG);
await oddPage.goto(PAGE + '#/join/123456/Mifa');
await oddPage.waitForSelector('.app-bar');
check('un groupe retenu sans nom n’efface pas la page',
  (await oddPage.locator('#join-form').count()) === 1 && oddErrors.length === 0,
  oddErrors.join(' | '));

/* --- un lien collé au bout d'une phrase -------------------------------- */

const dotted = await device('point final');
await dotted.click('[data-tab="settings"]');
await dotted.click('#open-link');
await dotted.waitForSelector('dialog[open] #link-text');
await dotted.fill('#link-text', `Voici le lien : ${link}.`);
await dotted.click('#link-open');
await dotted.waitForSelector('#join-form', { timeout: 15000 });
check('un lien suivi d’un point mène au bon groupe',
  (await dotted.inputValue('#join-group')) === 'Mifa',
  await dotted.inputValue('#join-group'));

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
