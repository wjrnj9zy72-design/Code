import test from 'node:test';
import assert from 'node:assert/strict';

import { icsEscape, foldLine, vevent, icsFor, pollEvent, listEvents, agendaFor, eventName } from '../src/ics.js';
import { createList, addItems, setItemDue, toggleItem, archiveList, makeTemplate } from '../src/lists.js';
import { createPoll } from '../src/polls.js';

const STAMP = Date.UTC(2026, 8, 21, 11, 30, 0);

test('what iCalendar reserves is escaped, and only that', () => {
  assert.equal(icsEscape('Pain; lait, œufs'), 'Pain\\; lait\\, œufs');
  assert.equal(icsEscape('C:\\temp'), 'C:\\\\temp');
  assert.equal(icsEscape('deux\nlignes'), 'deux\\nlignes');
  assert.equal(icsEscape("Quel soir ?"), 'Quel soir ?', 'a question mark is not special');
  assert.equal(icsEscape(null), '');
});

test('a long line is folded at seventy-five octets, never inside a letter', () => {
  const short = 'SUMMARY:Court';
  assert.equal(foldLine(short), short, 'nothing to fold');

  // Accented letters weigh two octets: folding by characters would cut one in
  // half and hand the calendar a file it cannot read.
  const line = `SUMMARY:${'é'.repeat(60)}`;
  const folded = foldLine(line);
  assert.ok(folded.includes('\r\n '), 'it is folded');
  assert.equal(folded.replace(/\r\n /g, ''), line, 'and unfolds to exactly what went in');
  for (const part of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(part).length <= 75, `${part.length} octets`);
  }
  assert.ok(!folded.includes('\uFFFD'), 'no letter was cut in half');
});

test('a day becomes an all-day event that ends the next morning', () => {
  const lines = vevent({ uid: 'x', day: '2026-09-24', summary: 'Repas', stamp: STAMP });
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20260924'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20260925'), 'DTEND is the day after: it is exclusive');
  assert.ok(lines.includes('DTSTAMP:20260921T113000Z'));
  assert.ok(!lines.some((line) => line.startsWith('DESCRIPTION')), 'nothing to say, nothing written');
});

test('the last day of a month, and of a year, still end on the right morning', () => {
  assert.ok(vevent({ uid: 'x', day: '2026-01-31', summary: 'a' }).includes('DTEND;VALUE=DATE:20260201'));
  assert.ok(vevent({ uid: 'x', day: '2026-12-31', summary: 'a' }).includes('DTEND;VALUE=DATE:20270101'));
  assert.ok(vevent({ uid: 'x', day: '2028-02-28', summary: 'a' }).includes('DTEND;VALUE=DATE:20280229'),
    '2028 is a leap year');
});

test('an hour is written without a zone, so eight o’clock is eight o’clock', () => {
  const lines = vevent({ uid: 'x', day: '2026-09-24', at: '20:00', summary: 'Repas' });
  assert.ok(lines.includes('DTSTART:20260924T200000'));
  assert.ok(lines.includes('DTEND:20260924T210000'), 'an hour long by default');
  assert.ok(!lines.some((line) => line.includes('T200000Z')), 'no Z: it is the reader’s own clock');
});

test('a calendar is a calendar, CRLF and all', () => {
  const text = icsFor([{ uid: 'x', day: '2026-09-24', summary: 'Repas', stamp: STAMP }], { name: 'Mifa' });
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(text.includes('VERSION:2.0\r\n'));
  assert.ok(text.includes('X-WR-CALNAME:Mifa\r\n'));
  assert.equal(text.split('BEGIN:VEVENT').length - 1, 1);
  assert.ok(!/\n[^\r]/.test(text.replace(/\r\n/g, '')), 'no bare newline survives');
});

test('a poll that has settled nothing is not an appointment', () => {
  const poll = createPoll({ question: 'Quel soir ?', names: ['Gui', 'Alice'] });
  assert.equal(pollEvent(poll), null);

  const settled = { ...poll, date: '2026-09-24', at: '20:00' };
  const event = pollEvent(settled);
  assert.equal(event.day, '2026-09-24');
  assert.equal(event.at, '20:00');
  assert.equal(event.summary, 'Quel soir', 'the question mark has no business in a calendar');
  assert.equal(event.description, 'Gui, Alice', 'who it is with');
});

test('an event is called what it is, not what was asked about it', () => {
  // "Quel soir pour la raclette ?" in a calendar reads as a question still
  // waiting for an answer, on the very evening it was answered.
  const settled = (question, extra = {}) =>
    pollEvent({ ...createPoll({ question, names: ['Gui'] }), date: '2026-09-24', ...extra }).summary;

  assert.equal(settled('Quel soir pour la raclette ?'), 'Raclette');
  assert.equal(settled('Quelle date pour l’anniversaire de Léa ?'), 'Anniversaire de Léa');
  assert.equal(settled('Quand fait-on la crémaillère ?'), 'Crémaillère');
  assert.equal(settled('On fait la raclette quand ?'), 'Raclette');
  assert.equal(settled('What day for the picnic?'), 'Picnic');

  assert.equal(settled('Quel soir pour la raclette ?', { title: 'Raclette chez Gui' }), 'Raclette chez Gui',
    'a name written by hand always wins');
});

test('a question it cannot make a name of comes back whole', () => {
  // Better the question than a verb on its own: "Mange" tells nobody anything,
  // and the field is right there to be corrected.
  const name = (question) => eventName({ question });

  assert.equal(name('Quand est-ce qu’on mange ?'), 'Quand est-ce qu’on mange');
  assert.equal(name('On se voit quel soir ?'), 'On se voit quel soir');
  assert.equal(name('Quel soir ?'), 'Quel soir');
  assert.equal(name('Réunion de rentrée'), 'Réunion de rentrée', 'a title is not a question to undo');
  assert.equal(name(''), '');
  assert.equal(eventName(null), '');
});

test('the article at the head is dropped whole, or not at all', () => {
  // "les" must be tried before "le", or the entry keeps a stray s.
  assert.equal(eventName({ question: 'Quel week-end pour les vacances au ski ?' }), 'Vacances au ski');
  assert.equal(eventName({ question: 'Quel jour pour le ciné ?' }), 'Ciné');
  assert.equal(eventName({ question: 'Quelle date pour des vacances ?' }), 'Vacances');
});

test('only the lines that have a day, and are not done, go in the calendar', () => {
  let list = addItems(createList({ name: 'Courses', names: ['Alice'] }), 'Pain\nRéserver le camion\nRendre la perceuse');
  list = setItemDue(list, list.items[1].id, '2026-09-24');
  list = setItemDue(list, list.items[2].id, '2026-09-25');
  list = toggleItem(list, list.items[2].id);

  const events = listEvents(list);
  assert.equal(events.length, 1, 'no day, or already done: nothing to put in a calendar');
  assert.equal(events[0].summary, 'Réserver le camion');
  assert.equal(events[0].description, 'Courses');
});

test('a group’s calendar gathers its polls and its lines, in order of day', () => {
  let courses = addItems(createList({ name: 'Courses', names: ['Alice'], groupId: 'mifa' }), 'Pain');
  courses = setItemDue(courses, courses.items[0].id, '2026-09-26');
  const poll = { ...createPoll({ question: 'Quel soir ?', groupId: 'mifa' }), date: '2026-09-24' };
  const ailleurs = setItemDue(
    addItems(createList({ name: 'Apéro', groupId: 'copains' }), 'Chips'),
    undefined,
    null,
  );

  const events = agendaFor({ lists: [courses, ailleurs], polls: [poll] }, 'mifa');
  assert.deepEqual(events.map((event) => event.day), ['2026-09-24', '2026-09-26']);

  assert.deepEqual(agendaFor({ lists: [courses], polls: [poll] }, 'copains'), [],
    'another group’s calendar is another calendar');
});

test('what has been put away, and what is only a model, stay out of the calendar', () => {
  let list = addItems(createList({ name: 'Valise', groupId: 'mifa' }), 'Chargeur');
  list = setItemDue(list, list.items[0].id, '2026-09-24');

  assert.equal(agendaFor({ lists: [list] }, 'mifa').length, 1);
  assert.equal(agendaFor({ lists: [archiveList(list)] }, 'mifa').length, 0);
  assert.equal(agendaFor({ lists: [makeTemplate(list)] }, 'mifa').length, 0);
});

test('a calendar with nothing in it is still a calendar', () => {
  const text = icsFor(agendaFor({}, 'mifa'), { name: 'Mifa' });
  assert.ok(text.startsWith('BEGIN:VCALENDAR'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!text.includes('BEGIN:VEVENT'));
});
