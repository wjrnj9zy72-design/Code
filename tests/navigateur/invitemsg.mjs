/**
 * L'invitation : un message court qui porte tout, et un collage qui remplit
 * les deux cases d'un coup.
 */
import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const CONFIG = JSON.stringify({ url: 'http://127.0.0.1:8123', key: 'test-anon-key' });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function device(label, { key = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 950 }, locale: 'fr-FR',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.addInitScript(([c, k]) => {
    try {
      localStorage.setItem('marque-points:remote:v1', c);
      if (k) localStorage.setItem('marque-points:prefs:v1', JSON.stringify({
        me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: k, admits: true }],
      }));
    } catch {}
  }, [CONFIG, key]);
  await page.goto('http://localhost:8099/dist/marque-points.html');
  await page.waitForSelector('.app-bar');
  return page;
}

/* --- 1. l'invitation, telle qu'elle part --------------------------------- */
const mine = await device('moi', { key: 'la-cle-famille' });
await mine.waitForSelector('[data-invite]');
await mine.click('[data-invite]');
await mine.waitForSelector('#invite-one', { timeout: 15000 });
const shapes = (await mine.locator('dialog[open]').textContent()).replace(/\s+/g, ' ');
check('le choix est court', /Pour qui \?/.test(shapes) && /Plusieurs personnes/.test(shapes) && /Une seule personne/.test(shapes), shapes.slice(0, 110));
check('et dit les deux jours une fois pour toutes', /valent deux jours/.test(shapes));

await mine.click('#invite-open');
await mine.waitForSelector('#export-dialog[open]', { timeout: 15000 });
const message = await mine.locator('#export-text').inputValue();
console.log('--- le message envoyé :\n' + message + '\n---');

const code = (message.match(/Code : (\d{6})/) || [])[1];
check('le message porte le nom du groupe, en clair', /^Nom : Mifa$/m.test(message));
check('et le code, en clair', Boolean(code), code || 'aucun');
check('et le lien', /#\/join\/\d{6}\/Mifa/.test(message));
check('il dit d’installer depuis Safari', /iPhone \(Safari\) → Partager → « Sur l’écran d’accueil »/.test(message));
check('et l’équivalent Android', /Android \(Chrome\) → ⋮ → « Installer l’application »/.test(message));
check('il dit quoi faire une fois dans l’app', /Entrer dans un groupe → colle le nom et le code/.test(message));
check('et combien de temps ça vaut', /Valable 2 jours\./.test(message), (message.match(/Valable.*/) || [''])[0]);
check('il tient en peu de lignes', message.split('\n').length <= 14, String(message.split('\n').length));
await mine.click('#export-close');

/* --- 2. le collage, de l'autre côté -------------------------------------- */
const other = await device('autre');
await other.waitForSelector('#group-code');
await other.evaluate((text) => navigator.clipboard.writeText(text), message);
await other.click('#group-code');
await other.keyboard.press('Control+V');
await other.waitForTimeout(400);
check('coller le message entier remplit le code',
  (await other.inputValue('#group-code')) === code, await other.inputValue('#group-code'));
check('et le nom du groupe avec',
  (await other.inputValue('#group-name')) === 'Mifa', await other.inputValue('#group-name'));

// coller dans la case du nom fait la même chose
await other.fill('#group-name', '');
await other.fill('#group-code', '');
await other.click('#group-name');
await other.keyboard.press('Control+V');
await other.waitForTimeout(400);
check('coller dans l’autre case marche pareil',
  (await other.inputValue('#group-name')) === 'Mifa' && (await other.inputValue('#group-code')) === code,
  `${await other.inputValue('#group-name')} / ${await other.inputValue('#group-code')}`);

// et un code tapé reste un code
await other.fill('#group-code', '');
await other.type('#group-code', '12 34-56');
await other.waitForTimeout(300);
check('la case du code ne garde que des chiffres',
  (await other.inputValue('#group-code')) === '123456', await other.inputValue('#group-code'));

/* --- 3. et la demande passe ---------------------------------------------- */
await other.fill('#me-name', 'Alice');
await other.click('#me-save');
await other.waitForTimeout(400);
await other.click('#group-join');
await other.waitForTimeout(1500);
const state = (await other.locator('#view').textContent()).replace(/\s+/g, ' ');
check('la demande part', /en attente|attend|demande/i.test(state), state.slice(0, 140));

check('aucune erreur de page', errors.length === 0, errors.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n} → ${r.d}`);
console.log(results.length, 'vérifications |', results.length - bad.length, 'ok |', bad.length, 'échecs');
process.exit(bad.length ? 1 : 0);
