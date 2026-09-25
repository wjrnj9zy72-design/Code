import { chromium } from 'playwright';
const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  await page.addInitScript((c) => { try { localStorage.setItem('marque-points:remote:v1', c); if (!localStorage.getItem('marque-points:prefs:v1')) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille' }] })); } catch {} }, CONFIG);
  await page.goto('http://localhost:8099/dist/marque-points.html'); 
  await page.waitForSelector('.app-bar');
  return page;
}

const page = await device('moi');
check('quatre onglets : Accueil, Agenda, Groupes, Réglages',
  (await page.locator('.tab').allTextContents()).map((x) => x.trim()).join(' / ')
    === 'Accueil / Agenda / Groupes / Réglages',
  (await page.locator('.tab').allTextContents()).join(' / '));

await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/polls"]');
await page.waitForSelector('[data-goto="#/polls/new"]');
check("l'onglet Sondages s'ouvre",
  (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Sondages');

await page.click('[data-goto="#/polls/new"]');
await page.waitForSelector('#new-poll');
await page.fill('#poll-question', 'Quel soir pour la raclette ?');
await page.fill('#poll-choices', 'Vendredi 12\n- Samedi 13\n2) Dimanche 14');
await page.fill('[data-person-index="0"]', 'Gui');
await page.fill('[data-person-index="1"]', 'Alice');
await page.click('#add-person');
await page.waitForTimeout(200);
check('ajouter une personne garde la question et les choix',
  (await page.inputValue('#poll-question')).includes('raclette')
  && (await page.inputValue('#poll-choices')).includes('Dimanche'));
await page.fill('[data-person-index="2"]', 'Bob');
await page.click('#new-poll button[type=submit]');
await page.waitForSelector('.votes');

const rows = await page.locator('.votes tbody tr').count();
check('la grille a une ligne par choix', rows === 3, String(rows));
check('et une colonne par personne', (await page.locator('.votes thead th').count()) === 5,
  String(await page.locator('.votes thead th').count()));
check('les puces des choix sont nettoyées',
  (await page.locator('.votes tbody th').allTextContents()).map((s) => s.trim()).includes('Samedi 13'));

// répondre en touchant les cases
const cell = (row, person) => page.locator('.votes tbody tr').nth(row).locator('.vote').nth(person);
await cell(0, 0).click();            // Gui : oui sur la 1re ligne
await page.waitForTimeout(250);
check('une case touchée se coche', (await cell(0, 0).textContent()).trim() === '✓',
  await cell(0, 0).textContent());
await cell(0, 0).click();
await page.waitForTimeout(250);
check('touchée à nouveau, elle se décoche — ni « peut-être » ni « non »',
  (await cell(0, 0).textContent()).trim() === '', JSON.stringify(await cell(0, 0).textContent()));

check('et l’app retient qui je suis',
  (await page.locator('.chip--on').textContent()).trim() === 'Gui',
  await page.locator('.chip--on').textContent());

// Le prénom choisi, les colonnes des autres ne se touchent plus.
check('les cases d’Alice ne se touchent plus', await cell(0, 1).isDisabled());
await cell(0, 1).click({ force: true }); await page.waitForTimeout(250);
check('même forcées, elles ne cochent rien', (await cell(0, 1).textContent()).trim() === '');
check('et la page dit pour qui on répond',
  /Vous répondez pour Gui/.test((await page.locator('#view').textContent()).replace(/\s+/g, ' ')));

// un vrai dépouillement : Samedi arrange le plus de monde, mais la grille
// garde l'ordre des choix — une ligne qui bouge sous le doigt fait voter à côté.
const listed = async () => (await page.locator('.votes tbody th').allTextContents()).map((s) => s.trim());
const before = await listed();
check('la grille est dans l’ordre des choix saisis',
  before.join(' / ') === 'Vendredi 12 / Samedi 13 / Dimanche 14', before.join(' / '));

// Répondre pour quelqu'un : on choisit d'abord son prénom, comme on le ferait.
const beAs = async (person) => {
  const chip = page.locator('[data-me]').nth(person);
  if (!(await chip.getAttribute('class')).includes('chip--on')) { await chip.click(); await page.waitForTimeout(200); }
};
const answer = async (row, person, taps) => {
  await beAs(person);
  for (let i = 0; i < taps; i += 1) { await cell(row, person).click(); await page.waitForTimeout(180); }
};
await answer(0, 0, 1);   // Vendredi / Gui : oui
check('un vote ne réarrange pas les lignes', (await listed()).join(' / ') === before.join(' / '),
  (await listed()).join(' / '));
await answer(1, 0, 1);   // Samedi / Gui : oui
await answer(1, 1, 1);   // Samedi / Alice : oui
await answer(2, 1, 1);   // Dimanche / Alice : dispo
await page.waitForTimeout(400);
const order = await listed();
check('même une fois dépouillé, l’ordre des choix n’a pas changé',
  order.join(' / ') === before.join(' / '), order.join(' / '));

// décocher non plus : c'était le ✗ qui faisait descendre la ligne touchée
await answer(1, 2, 2);   // Samedi / Bob : coché, puis décoché
await page.waitForTimeout(300);
check('décocher ne fait pas descendre la ligne', (await listed()).join(' / ') === before.join(' / '),
  (await listed()).join(' / '));

// la jauge : les dates qui arrangent le plus, la plus longue en tête
const gauge = (await page.locator('.gauge__row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
check('une jauge montre les dates, la plus demandée en tête', /^Samedi 13 2\/3/.test(gauge[0] || ''), gauge.join(' | '));
check('avec toutes les dates', gauge.length === 3, String(gauge.length));
const widths = await page.locator('.gauge__fill').evaluateAll((bars) => bars.map((b) => b.style.width));
check('et des barres à la mesure de tous les invités', widths[0] === '67%' && widths[1] === '33%', widths.join(' / '));

check('le choix qui arrange le plus de monde est mis en avant',
  (await page.locator('.votes__leader').count()) === 1,
  String(await page.locator('.votes__leader').count()));
check('et c’est bien celui-là',
  /Samedi 13/.test(await page.locator('.votes__leader').first().textContent()),
  (await page.locator('.votes__leader').first().textContent()).trim());

// partager, répondre depuis un autre appareil
await page.click('#poll-share');
await page.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const link = await page.inputValue('#export-text');
check('le lien pointe vers le sondage', /#\/poll\/v_/.test(link), link);
await page.click('#export-close');

const other = await device('autre');
await other.goto(`http://localhost:8099/dist/marque-points.html${link.slice(link.indexOf('#'))}`);
await other.waitForSelector('.votes', { timeout: 15000 });
check('le sondage s’ouvre ailleurs avec les réponses déjà données',
  (await other.locator('.vote--yes').count()) === 4,
  String(await other.locator('.vote--yes').count()));

// Bob répond de son côté
await other.locator('.votes tbody tr').nth(0).locator('.vote').nth(2).click();
await other.waitForTimeout(400);
const arrived = await page.waitForFunction(
  () => document.querySelectorAll('.vote--yes').length === 5, null, { timeout: 15000 },
).then(() => true).catch(() => false);
check('sa réponse arrive ici toute seule', arrived);

// clore
await page.click('#poll-close');
await page.waitForTimeout(400);
check('clore le sondage verrouille les cases',
  await page.locator('.vote').first().isDisabled());
const closedElsewhere = await other.waitForFunction(
  () => document.querySelectorAll('.vote[disabled]').length > 0, null, { timeout: 15000 },
).then(() => true).catch(() => false);
check('et se voit aussi de l’autre côté', closedElsewhere);

// les deux autres onglets n'ont pas bougé
await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/lists"]');
await page.waitForSelector('[data-goto="#/lists/new"]');
await page.click('[data-tab="home"]'); await page.click('.segmented--kinds [data-goto="#/games"]');
await page.waitForSelector('[data-goto="#/new"]');
check('les onglets Parties et Listes fonctionnent toujours',
  (await page.locator('.segmented--kinds [aria-current="true"]').textContent()).trim() === 'Parties');

const bad = results.filter((r) => !r.ok);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
bad.forEach((b) => console.log('   ÉCHEC:', b.n, '→', b.d));
console.log('erreurs :', errors.filter((e) => !/404|TUNNEL/.test(e)));
await browser.close();
