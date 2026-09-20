import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDocx, zip, escapeXml } from '../src/export-docx.js';
import { buildPdf, toLatin1 } from '../src/export-pdf.js';

const REPORT = {
  title: 'Papayoo — Soirée du 19',
  subtitle: '19 septembre 2026 · 3 manches',
  winner: 'Vainqueur : Chloé',
  standingsTitle: 'Classement',
  standingsHeader: ['Rang', 'Joueur', 'Total'],
  standings: [['1', 'Chloé', '87'], ['2', 'Gui & Co', '203']],
  roundsTitle: 'Détail des manches',
  roundsHeader: ['Manche', 'Chloé', 'Gui & Co'],
  rounds: [['1', '40', '60'], ['2', '47', '53']],
};

const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('a docx is a zip a reader will open', () => {
  const bytes = buildDocx(REPORT);
  assert.equal(bytes[0], 0x50, 'PK');
  assert.equal(bytes[1], 0x4b);
  const body = text(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    assert.ok(body.includes(part), `missing part: ${part}`);
  }
  assert.ok(body.includes('<w:tblGrid>'), 'a table without its grid is rejected outright');
  assert.ok(body.includes('%%EOF') === false);
});

test('the docx carries the results, and escapes what XML cannot hold', () => {
  const body = text(buildDocx(REPORT));
  assert.ok(body.includes('Classement'));
  assert.ok(body.includes('Gui &amp; Co'), 'the ampersand is escaped');
  assert.equal(body.includes('Gui & Co'), false, 'and never raw');
  assert.equal(escapeXml('<a "b" & \'c\'>'), '&lt;a &quot;b&quot; &amp; &apos;c&apos;&gt;');
});

test('the zip records each entry twice, as the format demands', () => {
  const bytes = zip([{ name: 'a.txt', text: 'x' }, { name: 'b/c.txt', text: 'yy' }]);
  const body = text(bytes);
  assert.equal((body.match(/PK\x03\x04/g) || []).length, 2, 'two local headers');
  assert.equal((body.match(/PK\x01\x02/g) || []).length, 2, 'two central entries');
  assert.equal((body.match(/PK\x05\x06/g) || []).length, 1, 'one end record');
});

test('a pdf declares itself, and ends properly', () => {
  const body = text(buildPdf(REPORT));
  assert.ok(body.startsWith('%PDF-1.4'));
  assert.ok(body.trimEnd().endsWith('%%EOF'));
  assert.ok(body.includes('/Type /Catalog'));
  assert.ok(body.includes('startxref'));
});

test('the pdf is written byte per character, so accents survive', () => {
  const bytes = buildPdf(REPORT);
  const body = text(bytes);
  assert.ok(body.includes('Chlo\xe9'), 'é is one Latin-1 byte, not two UTF-8 ones');
  assert.equal(body.includes('Chlo\xc3\xa9'), false, 'never UTF-8');
  assert.equal(toLatin1('— ’ … × ♥'), "- ' ... x C", 'what Latin-1 lacks is folded, not mangled');
  assert.equal(toLatin1('日本'), '??', 'and anything else is at least readable as missing');
});

test('a parenthesis in a name cannot break the pdf', () => {
  const body = text(buildPdf({ ...REPORT, standings: [['1', 'Gui (le chanceux)', '5']] }));
  assert.ok(body.includes('Gui \\(le chanceux\\)'), 'escaped inside the string literal');
});

test('a long game runs onto further pages', () => {
  const many = Array.from({ length: 60 }, (_, index) => [String(index + 1), '40', '60']);
  const body = text(buildPdf({ ...REPORT, rounds: many }));
  const pages = (body.match(/\/Type \/Page[^s]/g) || []).length;
  assert.ok(pages >= 2, `60 rounds should not be squeezed onto one page, got ${pages}`);
  assert.ok(body.includes('/Count ' + pages), 'and the page count matches');
});

test('the cross-reference table points at real objects', () => {
  const body = text(buildPdf(REPORT));
  const start = Number(body.match(/startxref\n(\d+)/)[1]);
  assert.ok(body.slice(start, start + 4) === 'xref', 'startxref points at the table');
  const first = body.match(/\nxref\n0 (\d+)\n/);
  assert.ok(Number(first[1]) > 3, 'the table covers every object');
});
