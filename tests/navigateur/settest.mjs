import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const OWNER = 'la-cle-famille';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (k) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ groups: [{ id: 'grp_famille', name: 'Mifa', key: k }] }));
    } catch {}
  }, [CONFIG, key]);
  await page.goto('http://localhost:8099/dist/marque-points.html'); 
  await page.waitForSelector('.app-bar');
  return page;
}

async function makeGame(page, name, scores) {
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForSelector('#new-game');
  await page.selectOption('#preset', 'papayoo');
  await page.fill('#game-name', name);
  for (const [i, n] of ['Gui', 'Alice', 'Bob'].entries()) await page.fill(`[data-name-index="${i}"]`, n);
  await page.click('#new-game button[type=submit]');
  await page.waitForSelector('#round-form');
  const ids = await page.locator('[data-score]').evaluateAll((e) => e.map((x) => x.dataset.score));
  for (const [i, v] of scores.entries()) await page.fill(`[data-score="${ids[i]}"]`, v);
  await page.click('#round-form button[type=submit]');
  await page.waitForSelector('table.scores');
  await page.evaluate(() => { location.hash = '#/games'; });
  await page.waitForSelector('.game-card');
}

/* ------------------------------------------------ un appareil sans la clé --- */

const guest = await device('sans clé');
await makeGame(guest, 'Sa partie', ['40', '60', '150']);
await guest.evaluate(() => { location.hash = '#/settings'; });
await guest.waitForSelector('#share-app');
await guest.click('#share-app');
await guest.waitForSelector('#share-make');
check('sans groupe, les deux liens avec parties sont refusés',
  await guest.locator('input[name="share-kind"][value="all"]').isDisabled()
  && await guest.locator('input[name="share-kind"][value="some"]').isDisabled());
const guestNote = await guest.locator('dialog[open] .banner:not(.banner--warn)').first().textContent();
check('et la boîte dit qu’il faut un groupe',
  /groupe|group/.test(guestNote), guestNote.slice(0, 60));
await guest.click('#share-make');
await guest.waitForSelector('#export-dialog[open]');
check("mais l'app seule se partage toujours", !(await guest.inputValue('#export-text')).includes('#/'));
check('et aucun code ne lui est montré', !(await guest.locator('#export-code').isVisible()));
await guest.click('#export-close');

/* ------------------------------------------------------ l'appareil du chef --- */

const mine = await device('avec la clé', { key: OWNER });
await makeGame(mine, 'Mardi', ['40', '60', '150']);
await makeGame(mine, 'Mercredi', ['10', '20', '220']);
await makeGame(mine, 'Jeudi', ['0', '30', '220']);
check('trois parties', (await mine.locator('.game-card').count()) === 3);

await mine.evaluate(() => { location.hash = '#/settings'; });
await mine.waitForSelector('#share-app');
await mine.click('#share-app');
await mine.waitForSelector('#share-make');
check('dans un groupe, les trois choix sont ouverts',
  !(await mine.locator('input[name="share-kind"][value="all"]').isDisabled()));
await mine.check('input[name="share-kind"][value="all"]');
await mine.click('#share-make');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const allLink = await mine.inputValue('#export-text');
const code = (await mine.locator('#export-code-value').textContent()).trim();
check('le lien porte un lot', /#\/set\/lot_/.test(allLink), allLink);
check('un code à six chiffres est affiché', /^[0-9]{6}$/.test(code), code);
check('le code ne voyage pas dans le lien', !allLink.includes(code));
check('le QR ne contient que le lien', (await mine.locator('#export-qr svg').count()) === 1);
await mine.click('#export-close');

// Le lot est bien scellé côté base : la lecture ordinaire ne donne rien.
const setId = allLink.split('#/set/')[1];
const peek = await mine.evaluate(async (id) => {
  const answer = await fetch('http://127.0.0.1:8123/rest/v1/rpc/marque_points_get', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'test-anon-key' },
    body: JSON.stringify({ p_id: id }),
  });
  return answer.text();
}, setId);
check('la lecture ordinaire ne voit pas le lot', peek.trim() === 'null', peek.slice(0, 80));

/* ------------------------------------------- la personne qui reçoit le lien --- */

const other = await device('autre appareil');
await other.goto(`http://localhost:8099/dist/marque-points.html#/set/${setId}`);
await other.waitForSelector('#lot-code', { timeout: 15000 });
check('un code est demandé avant tout', true);

await other.fill('#lot-code', '000000');
await other.click('#lot-open');
await other.waitForSelector('#lot-error:not([hidden])', { timeout: 15000 });
const wrong = await other.locator('#lot-error').textContent();
check('un code faux le dit, et compte les essais', /9/.test(wrong), wrong);
check('et rien n’a été ajouté', (await other.evaluate(() =>
  JSON.parse(localStorage.getItem('marque-points:games:v1') || '[]').length)) === 0);

await other.fill('#lot-code', code);
await other.click('#lot-open');
await other.waitForSelector('.game-card', { timeout: 20000 });
check('et on revient à la liste', (await other.evaluate(() => location.hash)) === '#/');
// L'Accueil mêle toutes les sortes : les parties se comptent sous « Parties ».
const gamesOf = async (device) => {
  await device.evaluate(() => { location.hash = '#/games'; });
  await device.waitForSelector('[data-goto="#/new"]');
  return device.locator('.game-card').count();
};
check('le bon code ouvre les trois parties', (await gamesOf(other)) === 3, String(await gamesOf(other)));
await other.reload();
await other.waitForSelector('.app-bar');
check('elles restent après rechargement', (await gamesOf(other)) === 3);

// Le code se tape aussi avec des espaces, comme il se dit à voix haute.
await mine.evaluate(() => { location.hash = '#/settings'; });
await mine.waitForSelector('#share-app');
await mine.click('#share-app');
await mine.waitForSelector('#share-make');
await mine.check('input[name="share-kind"][value="some"]');
const titles = await mine.locator('#share-pick .choice').evaluateAll((e) => e.map((x) => x.textContent.trim()));
await mine.locator('#share-pick input[data-share-id]').nth(titles.findIndex((x) => x.startsWith('Jeudi'))).check();
await mine.click('#share-make');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const someLink = await mine.inputValue('#export-text');
const someCode = (await mine.locator('#export-code-value').textContent()).trim();
check('une sélection a son propre lot et son propre code',
  someLink !== allLink && someCode !== code, `${someCode} / ${code}`);
await mine.click('#export-close');

const third = await device('app installée');
await third.evaluate(() => { location.hash = '#/settings'; });
await third.waitForSelector('#open-link');
await third.click('#open-link');
await third.fill('#link-text', `Tiens : ${someLink}`);
await third.click('#link-open');
await third.waitForSelector('#lot-code', { timeout: 15000 });
await third.fill('#lot-code', `${someCode.slice(0, 3)} ${someCode.slice(3)}`);
await third.click('#lot-open');
await third.waitForSelector('.game-card', { timeout: 20000 });
check('un lot collé s’ouvre, code lu à voix haute compris',
  (await gamesOf(third)) === 1
  && (await third.locator('.game-card').textContent()).includes('Jeudi'));

/* --------------------------------------------------------- dix essais, stop --- */

const burner = await device('cambrioleur');
await burner.goto(`http://localhost:8099/dist/marque-points.html#/set/${someLink.split('#/set/')[1]}`);
await burner.waitForSelector('#lot-code', { timeout: 15000 });
for (let i = 0; i < 10; i += 1) {
  await burner.fill('#lot-code', String(100000 + i));
  await burner.click('#lot-open');
  await burner.waitForSelector('#lot-error:not([hidden])', { timeout: 15000 });
}
await burner.fill('#lot-code', '999999');
await burner.click('#lot-open');
// Le dialogue se referme : il n'y a plus de code à essayer.
await burner.waitForSelector('#lot-code', { state: 'detached', timeout: 15000 });
const locked = await burner.locator('#view .banner').textContent();
check('après dix essais le lien se bloque', /dix|ten/.test(locked), locked);
check('et il ne reste rien chez lui', (await burner.locator('.game-card').count()) === 0);

// … et même le bon code ne passe plus
await burner.goto(`http://localhost:8099/dist/marque-points.html#/set/${someLink.split('#/set/')[1]}`);
await burner.waitForSelector('#lot-code', { timeout: 15000 });
await burner.fill('#lot-code', someCode);
await burner.click('#lot-open');
await burner.waitForSelector('#lot-code', { state: 'detached', timeout: 15000 });
check('le bon code non plus, une fois bloqué',
  (await burner.locator('.game-card').count()) === 0
  && /dix|ten/.test(await burner.locator('#view .banner').textContent()));

/* -------------------------------------------------------------- révocation --- */

await mine.evaluate(() => { location.hash = '#/settings'; });
await mine.waitForSelector('#my-shares');
check('mes partages sont mémorisés', (await mine.locator('#my-shares').textContent()).includes('2'),
  await mine.locator('#my-shares').textContent());
await mine.evaluate(() => { location.hash = '#/settings'; });
await mine.waitForSelector('#my-shares');
await mine.click('#my-shares');
await mine.waitForSelector('.lot');
check('avec leur code sous les yeux',
  (await mine.locator('.lot__code').first().textContent()).trim().length === 6);
check('chaque partage est là, celui de toutes les parties compris',
  (await mine.locator(`[data-lot-revoke="${setId}"]`).count()) === 1);
await mine.locator(`[data-lot-revoke="${setId}"]`).click();
await mine.waitForSelector('dialog.dialog--ask[open] [data-answer="yes"]');
await mine.click('dialog.dialog--ask[open] [data-answer="yes"]');
await mine.waitForTimeout(1200);
check('un partage se révoque', (await mine.locator('.lot').count()) === 1,
  `${await mine.locator('.lot').count()} lots | erreur: ${await mine.locator('#lots-error').textContent()}`);
await mine.click('#lots-close');

const late = await device('arrivé trop tard');
await late.goto(`http://localhost:8099/dist/marque-points.html#/set/${setId}`);
await late.waitForSelector('#lot-code', { timeout: 15000 });
await late.fill('#lot-code', code);
await late.click('#lot-open');
await late.waitForSelector('#lot-code', { state: 'detached', timeout: 15000 });
check('le lien révoqué ne donne plus rien, code juste ou non',
  (await late.locator('.game-card').count()) === 0 && (await late.locator('#view .banner').count()) === 1,
  `cartes ${await late.locator('.game-card').count()} / dialogues ${await late.locator('dialog').count()} / bannière ${JSON.stringify(await late.locator('#view .banner').allTextContents())}`);

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
