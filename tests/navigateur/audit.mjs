/**
 * Le tour de l'app, écran par écran, avec les règles que tout écran suit —
 * pour que les incohérences se trouvent ici plutôt qu'à l'usage.
 *
 * 1. Chaque écran, en français et en anglais, sur un petit et un grand
 *    téléphone : aucune erreur, aucun texte cassé (clé de traduction brute,
 *    « undefined », « NaN »), rien qui déborde sur le côté, aucun bouton sans
 *    nom ni trop petit pour un doigt, et un « Retour » sur tout ce qui n'est
 *    pas un onglet.
 * 2. Chaque fenêtre qu'un bouton ouvre : une façon visible d'en sortir, et
 *    en sortir sans valider (Échap) ne change rien à ce qui est gardé.
 * 3. « Retour » ramène là d'où l'on vient, depuis chaque page de document.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createList, addItems } from '../../src/lists.js';
import { createPoll, addOptions, setVote, createEvent } from '../../src/polls.js';
import { createSpend, addSpend } from '../../src/spends.js';
import { createGame } from '../../src/model.js';
import { createBoard, addCard, editCardText, addStrokes } from '../../src/ideas.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';

const pad = (n) => String(n).padStart(2, '0');
const dayIn = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* --- de quoi remplir chaque écran ----------------------------------------- */

function documents(where) {
  const list = { ...addItems(createList({ name: 'Courses', names: ['Gui', 'Alice'] }), 'Pain\nLait\nRéserver le camion'), ...where };
  let poll = { ...addOptions(createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'] }), 'Vendredi 12\nSamedi 13'), ...where };
  poll = setVote(poll, poll.people[0].id, poll.options[0].id, true);
  const event = { ...createEvent({ name: 'Raclette', names: ['Gui', 'Alice'], date: dayIn(5), at: '19:00' }), ...where };
  let spend = { ...createSpend({ name: 'Vacances', names: ['Gui', 'Alice'] }), ...where };
  spend = addSpend(spend, { text: 'Gîte', amount: 12000, by: spend.people[0].id, forWhom: spend.people.map((p) => p.id) });
  const game = { ...createGame({ presetId: 'papayoo', names: ['Gui', 'Alice', 'Bob'] }), ...where };
  let board = { ...createBoard({ name: 'Déco' }), ...where };
  let made = addCard(board, 'note');
  board = editCardText(made.board, made.cardId, 'Une lampe');
  made = addCard(board, 'sketch');
  board = addStrokes(made.board, made.cardId, [{ ink: 'ink', pen: 4, points: [100, 100, 600, 400] }]);
  return { list, poll, event, spend, game, board };
}

function seedOf(docs, { remote }) {
  return {
    'marque-points:prefs:v1': {
      me: 'Gui',
      ...(remote ? { groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }] } : {}),
    },
    'marque-points:lists:v1': [docs.list],
    'marque-points:polls:v1': [docs.poll, docs.event],
    'marque-points:games:v1': [docs.game],
    'marque-points:spends:v1': [docs.spend],
    'marque-points:boards:v1': [docs.board],
    ...(remote ? { 'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' } } : {}),
  };
}

const TABS = ['#/', '#/agenda', '#/groups', '#/settings', '#/lists', '#/polls', '#/games', '#/spends', '#/ideas'];
const routesOf = (docs) => [
  ...TABS,
  `#/list/${docs.list.id}`, `#/poll/${docs.poll.id}`, `#/poll/${docs.event.id}`, `#/spend/${docs.spend.id}`,
  `#/game/${docs.game.id}`, `#/idea/${docs.board.id}`, '#/group/grp_famille', '#/person/Alice', '#/stats',
  '#/lists/new', '#/polls/new', '#/agenda/new', '#/spends/new', '#/new', '#/ideas/new',
];

// Every key of the translations: one showing as such is a text never written.
const KEYS = [...new Set([...readFileSync(new URL('../../src/i18n.js', import.meta.url), 'utf8')
  .matchAll(/^\s+'([a-z][a-zA-Z]*\.[a-zA-Z0-9.]+)':/gm)].map((m) => m[1]))];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function open(seed, { width = 390, lang = 'fr' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, locale: lang === 'fr' ? 'fr-FR' : 'en-GB' });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e.message)));
  await page.addInitScript(([data, language]) => {
    if (sessionStorage.getItem('audit-seeded')) return;
    sessionStorage.setItem('audit-seeded', '1');
    localStorage.clear();
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
    const prefs = JSON.parse(localStorage.getItem('marque-points:prefs:v1'));
    localStorage.setItem('marque-points:prefs:v1', JSON.stringify({ ...prefs, lang: language }));
  }, [seed, lang]);
  return page;
}

let loads = 0;
async function go(page, hash) {
  // A query of its own each time: a new page load, not a hash change, so what
  // was put back in storage is what the app reads.
  loads += 1;
  await page.goto(`${B}?n=${loads}${hash}`);
  await page.waitForSelector('.app-bar');
  await page.waitForTimeout(250);
}

/* --- 1. chaque écran ------------------------------------------------------ */

const shared = documents({ groupId: 'grp_famille', shared: true });
const findings = new Map();
const note = (rule, where) => {
  if (!findings.has(rule)) findings.set(rule, new Set());
  findings.get(rule).add(where);
};

for (const lang of ['fr', 'en']) {
  for (const width of [320, 390]) {
    const page = await open(seedOf(shared, { remote: true }), { width, lang });
    for (const hash of routesOf(shared)) {
      await go(page, hash);
      const where = `${hash} (${lang}, ${width}px)`;
      const facts = await page.evaluate((keys) => {
        const text = document.body.innerText;
        const shown = (node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        };
        const buttons = [...document.querySelectorAll('#view button, #view a, .app-bar button, #tabs a, #tabs button')].filter(shown);
        return {
          raw: keys.filter((key) => new RegExp(`(^|[\\s«“(])${key.replace(/\./g, '\\.')}($|[\\s»”).,])`).test(text)),
          broken: (text.match(/\b(undefined|NaN|null|\[object \w+\])\b/g) || []),
          braces: (text.match(/\{[a-z]+(\|[^}]*)?\}/g) || []),
          overflow: document.scrollingElement.scrollWidth - window.innerWidth,
          unnamed: buttons.filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label') || b.title)).map((b) => b.outerHTML.slice(0, 80)),
          tiny: buttons.filter((b) => {
            const box = b.getBoundingClientRect();
            return Math.min(box.height, box.width) < 28 && !b.closest('.swatch, .line__tick');
          }).map((b) => `${(b.innerText || b.getAttribute('aria-label') || b.id || '').trim().slice(0, 30)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`),
          back: Boolean(document.querySelector('#view [data-back]')),
          h1: (document.querySelector('#view h1')?.textContent || '').trim(),
          form: (() => {
            const form = document.querySelector('#view form');
            if (!form) return null;
            const chips = form.querySelector('[data-new-group]');
            const submit = form.querySelector('button[type=submit]');
            const person = form.querySelector('[data-person-index="0"], [data-name-index="0"]');
            return {
              chips: Boolean(chips),
              chipsBeforeSubmit: Boolean(chips && submit && (chips.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING)),
              firstPerson: person ? person.value : null,
            };
          })(),
          more: [...document.querySelectorAll('#view .actions__more button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')),
          share: Boolean(document.querySelector('#view .share-bar .button--primary, #view [id$="-share"], #view #share')),
          inGroup: /Dans le groupe|In the group|in Mifa|dans Mifa/i.test(document.querySelector('#view')?.innerText || ''),
          newButton: (document.querySelector('#view [data-goto$="/new"], #view [data-goto="#/new"]')?.textContent || '').trim(),
          cards: document.querySelectorAll('#view .game-list > .game-card, #view .game-list > .swipe').length,
          swipes: document.querySelectorAll('#view .game-list > .swipe').length,
          french: (text.match(/\b(Retour|Partager|Supprimer|Annuler|Enregistrer|Renommer|Nouveau|Nouvelle|personnes|Fermer|Ranger|groupe)\b/g) || []),
        };
      }, KEYS);
      const isDoc = /^#\/(list|poll|spend|game|idea)\//.test(hash);
      const isForm = /\/new$|^#\/new$/.test(hash);
      const isKindTab = ['#/lists', '#/polls', '#/games', '#/spends', '#/ideas'].includes(hash);
      if (lang === 'en' && facts.french.length) note('mot français dans l’app en anglais', `${where} : ${[...new Set(facts.french)].join(', ')}`);
      if (!TABS.includes(hash) && !facts.h1) note('pas de titre', where);
      if (isForm && width === 390) {
        if (!facts.form) note('formulaire introuvable', where);
        else {
          if (!facts.form.chips) note('formulaire sans choix du groupe', where);
          else if (!facts.form.chipsBeforeSubmit) note('choix du groupe pas juste avant le bouton', where);
          if (facts.form.firstPerson !== null && facts.form.firstPerson !== 'Gui') note('mon prénom pas proposé en premier', `${where} : « ${facts.form.firstPerson} »`);
        }
      }
      if (isDoc && width === 390) {
        if (!facts.more.length) note('pas de « Plus d’actions »', where);
        else {
          if (!/^(Renommer|Modifier|Rename|Edit)/.test(facts.more[0])) note('« Plus d’actions » ne commence pas par Renommer', `${where} : ${facts.more.join(' | ')}`);
          if (!/^(Supprimer|Delete)/.test(facts.more.at(-1))) note('« Plus d’actions » ne finit pas par Supprimer', `${where} : ${facts.more.join(' | ')}`);
        }
        if (!facts.share) note('pas de bouton pour partager', where);
        if (!facts.inGroup) note('ne dit pas dans quel groupe il est', where);
      }
      if (isKindTab && width === 390) {
        if (!/^\+/.test(facts.newButton)) note('onglet sans « + Nouveau… » en tête', where);
        if (facts.cards && facts.swipes !== facts.cards) note('des cartes qui ne se suppriment pas d’un glissement', `${where} : ${facts.swipes}/${facts.cards}`);
      }
      if (page.errors.length) note('erreur JavaScript', `${where} : ${page.errors.splice(0).join(' | ')}`);
      if (facts.raw.length) note('clé de traduction affichée telle quelle', `${where} : ${facts.raw.join(', ')}`);
      if (facts.broken.length) note('texte cassé (undefined, NaN…)', `${where} : ${facts.broken.join(', ')}`);
      if (facts.braces.length) note('gabarit de texte non rempli', `${where} : ${facts.braces.join(', ')}`);
      if (facts.overflow > 1) note('la page déborde sur le côté', `${where} : ${facts.overflow}px`);
      if (facts.unnamed.length) note('bouton sans nom', `${where} : ${facts.unnamed.join(' ; ')}`);
      if (facts.tiny.length) note('bouton trop petit pour un doigt (< 28px)', `${where} : ${facts.tiny.join(' ; ')}`);
      if (!TABS.includes(hash) && !facts.back) note('pas de « Retour »', where);
    }
    await page.context().close();
  }
}

/* --- 2. chaque fenêtre ---------------------------------------------------- */

// Gardé pour soi : ce qui est gardé tient tout entier dans le navigateur, et
// se remet à l'identique avant chaque bouton essayé.
const local = documents({});
const seed = seedOf(local, { remote: false });
const page = await open(seed);
await go(page, '#/');
const kept = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter((key) => /:(lists|polls|games|spends|boards):/.test(key)).map((key) => [key, localStorage.getItem(key)])));
const reset = async () => page.evaluate((data) => {
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);
const CANCEL = /^(Annuler|Fermer|Retour|Non|Plus tard|Pas maintenant|Cancel|Close|Back|No|Not now|Later)$/i;
let dialogsSeen = 0;

for (const hash of routesOf(local).filter((h) => !['#/groups'].includes(h))) {
  await reset();
  await go(page, hash);
  await page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
  const count = await page.locator('#view button:visible').count();
  for (let index = 0; index < count; index += 1) {
    await reset();
    await go(page, hash);
    await page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));
    const button = page.locator('#view button:visible').nth(index);
    if (!(await button.count())) continue;
    const skip = await button.evaluate((b) => b.hasAttribute('data-back') || b.hasAttribute('data-goto') || b.type === 'submit' || b.closest('form#new-list, form#new-poll, form#new-spend, form#new-event, form#new-board, form#new-game'));
    if (skip) continue;
    const label = ((await button.innerText()) || (await button.getAttribute('aria-label')) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const before = await kept();
    const hashBefore = await page.evaluate(() => location.hash);
    await button.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
    if (!(await page.locator('dialog[open]').count())) continue;
    dialogsSeen += 1;
    const where = `${hash} → « ${label} »`;
    const dialog = page.locator('dialog[open]').last();
    const ways = (await dialog.locator('button:visible').allInnerTexts()).map((s) => s.trim());
    if (!ways.some((text) => CANCEL.test(text))) note('fenêtre sans bouton pour en sortir', `${where} : [${ways.join(' | ')}]`);
    // Tout ce qui s'écrit, écrit ; puis on sort sans valider.
    for (const field of await dialog.locator('textarea:visible, input[type=text]:visible, input:not([type]):visible').all()) {
      await field.fill('zz audit').catch(() => {});
    }
    for (let round = 0; round < 3 && (await page.locator('dialog[open]').count()); round += 1) {
      const top = page.locator('dialog[open]').last();
      if (round > 0 && /sans enregistrer/i.test(await top.innerText())) await top.locator('[data-answer="yes"]').click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    if (await page.locator('dialog[open]').count()) note('Échap ne ferme pas la fenêtre', where);
    const after = await kept();
    const changed = Object.keys(before).filter((key) => before[key] !== after[key]);
    if (changed.length) note('sortir sans valider a quand même enregistré', `${where} : ${changed.map((k) => k.split(':')[1]).join(', ')}`);
    if ((await page.evaluate(() => location.hash)) !== hashBefore) note('sortir sans valider a changé de page', where);
  }
}
check('des fenêtres ont bien été essayées', dialogsSeen >= 15, String(dialogsSeen));
if (page.errors.length) note('erreur JavaScript (fenêtres)', page.errors.join(' | '));

/* --- 3. « Retour » depuis chaque document --------------------------------- */

for (const [from, target] of [
  ['#/lists', `#/list/${local.list.id}`], ['#/polls', `#/poll/${local.poll.id}`], ['#/spends', `#/spend/${local.spend.id}`],
  ['#/games', `#/game/${local.game.id}`], ['#/ideas', `#/idea/${local.board.id}`], ['#/agenda', `#/poll/${local.event.id}`],
  [`#/list/${local.list.id}`, '#/person/Alice'],
]) {
  await reset();
  await go(page, from);
  await page.evaluate((h) => { location.hash = h; }, target);
  await page.waitForTimeout(300);
  await page.click('#view [data-back]').catch(() => {});
  await page.waitForTimeout(300);
  const at = await page.evaluate(() => location.hash);
  if (at !== from) note('« Retour » ne ramène pas d’où l’on vient', `${from} → ${target} → ${at}`);
}

await browser.close();

for (const [rule, places] of findings) {
  check(rule, false, [...places].slice(0, 12).join('\n      ') + (places.size > 12 ? `\n      … et ${places.size - 12} autres` : ''));
}
check('le tour est fait', true);
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log(`ÉCHEC: ${r.n}\n      ${r.d}`);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
