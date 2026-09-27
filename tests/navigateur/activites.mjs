/**
 * Les activités : un événement dans un événement. Le programme de
 * l'événement, une activité à caler puis calée (à la main ou par un sondage
 * des jours de l'événement), des idées et d'un sondage clos, des activités ;
 * un événement qui devient l'activité d'un autre.
 */
import { chromium } from 'playwright';
import { createEvent, createPoll, addOptions, setVote, setClosed } from '../../src/polls.js';
import { createBoard, addCard, editCardText } from '../../src/ideas.js';
import { attach } from '../../src/dashboard.js';

const results = [];
const check = (n, ok, d = '') => results.push({ n, ok, d });
const B = 'http://localhost:8099/dist/marque-points.html';
const g = { groupId: 'grp_famille', shared: true };
const pad = (n) => String(n).padStart(2, '0');
const dayIn = (days) => { const d = new Date(Date.now() + days * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const [d1, d2, d3] = [dayIn(10), dayIn(11), dayIn(12)];

const annecy = { ...createEvent({ name: 'Annecy', names: ['Gui', 'Alice'], date: d1, until: d3 }), ...g };
const resto = { ...createEvent({ name: 'Resto', names: ['Gui'], date: d1, at: '20:00' }), ...g };
let idees = attach({ ...createBoard({ name: 'Que faire ?' }), ...g }, annecy.id);
const made = addCard(idees, 'note');
idees = editCardText(made.board, made.cardId, 'Paddle');
let quoi = attach({ ...addOptions(createPoll({ question: 'Quelle activité ?', names: ['Gui'] }), 'Karaoké\nBowling'), ...g }, annecy.id);
quoi = setClosed(setVote(quoi, quoi.people[0].id, quoi.options[0].id, 'yes'), true);
quoi = { ...quoi, forActivity: true };

const seed = {
  'marque-points:prefs:v1': { me: 'Gui', groups: [{ id: 'grp_famille', name: 'Mifa', key: 'la-cle-famille', admits: true }],
    organiser: { [annecy.id]: 'a'.repeat(32), [resto.id]: 'b'.repeat(32), [quoi.id]: 'c'.repeat(32) } },
  'marque-points:remote:v1': { url: 'http://127.0.0.1:8123', key: 'test-anon-key' },
  'marque-points:polls:v1': [{ ...annecy, owned: true }, { ...resto, owned: true }, { ...quoi, owned: true }],
  'marque-points:boards:v1': [idees],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'fr-FR' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.addInitScript((data) => {
  if (localStorage.getItem('marque-points:prefs:v1')) return;
  for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
}, seed);
const text = async (selector) => ((await page.locator(selector).first().textContent()) || '').replace(/\s+/g, ' ').trim();
const polls = () => page.evaluate(() => JSON.parse(localStorage.getItem('marque-points:polls:v1')));
const byTitle = async (title) => (await polls()).find((p) => p.title === title || p.question === title);
const more = () => page.evaluate(() => document.querySelectorAll('#view details').forEach((d) => { d.open = true; }));

/* --- 0. « + → Activité » ------------------------------------------------- */

await page.goto(`${B}#/`);
await page.waitForSelector('#create');
await page.click('#create');
await page.waitForSelector('dialog[open] [data-create-activity]');
await page.click('dialog[open] [data-create-activity]');
await page.waitForSelector('dialog[open] [data-activity-for]');
check('« + → Activité » demande pour quel événement', (await page.locator('dialog[open] [data-activity-for]').count()) === 2);
await page.click(`dialog[open] [data-activity-for="${annecy.id}"]`);
await page.waitForSelector('dialog[open] #activity-name');
check('puis ouvre l’activité de cet événement', /pendant « Annecy »/.test(await text('dialog[open] h2')));
await page.click('dialog[open] [data-activity-cancel]');
await page.goto(`${B}#/poll/${annecy.id}`);
await page.waitForSelector('.programme');
await page.click('#create');
await page.waitForSelector('dialog[open] [data-create-activity]');
await page.click('dialog[open] [data-create-activity]');
await page.waitForSelector('dialog[open] #activity-name');
check('sur l’événement, « + → Activité » va droit à lui', /pendant « Annecy »/.test(await text('dialog[open] h2')));
await page.click('dialog[open] [data-activity-cancel]');

/* --- 1. le programme de l'événement -------------------------------------- */

await page.goto(`${B}#/poll/${annecy.id}`);
await page.waitForSelector('.programme');
check('l’événement a un programme, vide pour l’instant', /Programme.*Pas encore d’activité/.test(await text('.programme')), await text('.programme'));
await page.click('[data-flow-activity]');
await page.waitForSelector('dialog[open] #activity-name');
check('les jours proposés sont ceux de l’événement, et « à caler »', (await page.locator('dialog[open] [data-activity-day]').count()) === 4);
check('sans jour, pas d’heure', await page.locator('dialog[open] #activity-at').isDisabled());
await page.fill('dialog[open] #activity-name', 'Rando');
await page.click(`dialog[open] [data-activity-day="${d2}"]`);
check('le nom tapé reste quand on choisit le jour', (await page.inputValue('dialog[open] #activity-name')) === 'Rando');
await page.fill('dialog[open] #activity-at', '10:00');
await page.click('dialog[open] #activity-ok');
await page.waitForFunction(() => /Rando/.test(document.querySelector('.programme')?.textContent || ''));
const rando = await byTitle('Rando');
check('l’activité est un événement sous l’événement', rando && rando.parent === annecy.id && rando.date === d2 && rando.at === '10:00', JSON.stringify(rando));
check('avec ceux qui viennent', rando.people.map((p) => p.name).join() === 'Gui,Alice');

await page.click('[data-flow-activity]');
await page.waitForSelector('dialog[open] #activity-name');
await page.fill('dialog[open] #activity-name', 'Lac');
await page.click('dialog[open] #activity-ok');
await page.waitForFunction(() => /Lac/.test(document.querySelector('.programme')?.textContent || ''));
check('sans jour, elle est « à caler », en fin de programme', /Rando.*à caler Lac/.test(await text('.programme')), await text('.programme'));

/* --- 2. caler par un sondage des jours ----------------------------------- */

const lac = await byTitle('Lac');
await page.click(`.programme [data-goto="#/poll/${lac.id}"]`);
await page.waitForSelector('.activity-head');
check('l’activité dit de quel événement elle est', /Une activité de « Annecy »/.test(await text('.activity-head')));
await page.click('[data-flow-when]');
await page.waitForFunction(() => /^#\/poll\//.test(location.hash) && document.querySelector('.votes'));
const quand = (await polls()).find((p) => p.whenFor === lac.id);
check('un sondage avec les trois jours de l’événement', quand && quand.options.length === 3, JSON.stringify(quand?.options));
const gui = quand.people.find((p) => p.name === 'Gui');
await page.click(`[data-vote="${gui.id}|${quand.options[1].id}"]`);
await page.waitForSelector('[data-retain]');
await page.click('[data-retain]');
await page.waitForFunction((id) => JSON.parse(localStorage.getItem('marque-points:polls:v1')).find((p) => p.id === id)?.date, lac.id);
const cale = (await polls()).find((p) => p.id === lac.id);
const clos = (await polls()).find((p) => p.id === quand.id);
check('tranché, le jour va à l’activité', cale.date === d2, cale.date);
check('et le sondage se ferme sans devenir un événement', clos.closedAt && !clos.date);

/* --- 3. des idées, des activités ----------------------------------------- */

await page.goto(`${B}#/idea/${idees.id}`);
await page.waitForSelector('[data-flow-idea-activities]');
await page.click('[data-flow-idea-activities]');
await page.waitForSelector('dialog[open] [data-idea-activity]');
await page.click('dialog[open] [data-idea-activity]');
await page.waitForSelector('dialog[open] .chip--on');
check('une idée devient une activité, et le dialogue le dit', /✓ Paddle/.test(await text('dialog[open]')));
const paddle = await byTitle('Paddle');
check('au programme de l’événement, à caler', paddle && paddle.parent === annecy.id && !paddle.date && paddle.from?.doc === idees.id);
await page.click('dialog[open] [data-idea-activities-close]');

/* --- 4. d'un sondage clos, une activité ---------------------------------- */

await page.goto(`${B}#/poll/${quoi.id}`);
await page.waitForSelector('[data-flow-choice-activity]');
check('le sondage clos propose d’organiser son choix', /L’organiser pendant « Annecy ».*Karaoké/.test(await text('.flows')));
await page.click('[data-flow-choice-activity]');
await page.waitForSelector('dialog[open] #activity-name');
check('le nom est déjà écrit', (await page.inputValue('dialog[open] #activity-name')) === 'Karaoké');
await page.click(`dialog[open] [data-activity-day="${d1}"]`);
await page.click('dialog[open] #activity-ok');
await page.waitForFunction(() => !document.querySelector('[data-flow-choice-activity]'));
check('créée, elle n’est plus proposée', (await byTitle('Karaoké'))?.from?.doc === quoi.id);

/* --- 5. un événement devient une activité -------------------------------- */

await page.goto(`${B}#/poll/${resto.id}`);
await page.waitForSelector('#view h1');
await more();
await page.click('#view [data-attach-doc]');
await page.waitForSelector('dialog[open] [data-attach-to]');
check('un événement se rattache à un autre, comme activité', /il en devient une activité/.test(await text('dialog[open]')));
await page.locator('dialog[open] [data-attach-to]', { hasText: 'Annecy' }).click();
await page.waitForSelector('.activity-head');
check('le voilà activité d’Annecy', /Une activité de « Annecy »/.test(await text('.activity-head')));

/* --- 6. l'Accueil ------------------------------------------------------- */

await page.goto(`${B}#/`);
await page.waitForSelector('#view h2');
const home = await text('#view');
check('l’Accueil montre l’événement et son programme', /Annecy.*Programme :.*Resto/.test(home), home.slice(0, 400));
check('sans ajouter ses activités comme des événements', (await page.locator(`#view [data-goto="#/poll/${resto.id}"].game-card`).count()) === 0);

/* --- 7. l'étiquette 🎯 : un sondage qui choisit une activité ------------- */

await page.goto(`${B}#/poll/${annecy.id}`);
await page.waitForSelector('.programme');
await page.click('#create');
await page.waitForSelector('dialog[open] [data-create="#/polls/new"]');
await page.click('dialog[open] [data-create="#/polls/new"]');
await page.waitForSelector('#poll-for-activity');
await page.fill('#poll-question', 'Ciné ou piscine ?');
await page.fill('#poll-choices', 'Ciné\nPiscine');
await page.check('#poll-for-activity');
await page.click('#new-poll button[type=submit]');
await page.waitForFunction(() => /^#\/poll\//.test(location.hash) && document.querySelector('.votes'));
const cine = await byTitle('Ciné ou piscine ?');
check('le sondage porte l’étiquette', cine?.forActivity === true && cine.parent === annecy.id, JSON.stringify({ f: cine?.forActivity, p: cine?.parent }));
await page.goto(`${B}#/poll/${annecy.id}`);
await page.waitForSelector('.programme');
check('au programme, « en vote »', /en vote Ciné ou piscine/.test(await text('.programme')), await text('.programme'));
check('et 🎯 dans l’arbre', /🎯 Ciné ou piscine/.test(await text('.chain-map')));
await page.goto(`${B}#/poll/${cine.id}`);
await page.waitForSelector('.votes');
const moi = cine.people.find((p) => p.name === 'Gui') || cine.people[0];
await page.click(`[data-vote="${moi.id}|${cine.options[0].id}"]`);
await page.waitForSelector('#poll-close');
await page.click('#poll-close');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('marque-points:polls:v1')).some((p) => p.title === 'Ciné'));
const cineActivite = await byTitle('Ciné');
check('clos : le gagnant est au programme, d’office', cineActivite.parent === annecy.id && cineActivite.from?.doc === cine.id && !cineActivite.date);
check('le sondage ne propose plus rien', (await page.locator('[data-flow-choice-activity]').count()) === 0);
await page.goto(`${B}#/poll/${annecy.id}`);
await page.waitForSelector('.programme');
check('le programme a l’activité, plus le vote', /à caler Ciné/.test(await text('.programme')) && !/en vote/.test(await text('.programme')), await text('.programme'));

check('aucune erreur', errors.length === 0, errors.join(' | '));
await browser.close();
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.log('ÉCHEC:', r.n, r.d);
console.log(`${results.length} vérifications | ${results.length - bad.length} ok | ${bad.length} échecs`);
