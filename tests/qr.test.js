import test from 'node:test';
import assert from 'node:assert/strict';

import { qrMatrix, qrSvg, MAX_BYTES } from '../src/qr.js';

/** A stable fingerprint of a matrix, to catch any drift in the encoder. */
function fingerprint(modules) {
  const bits = modules.map((row) => row.map((value) => (value ? '1' : '0')).join('')).join('');
  let hash = 0;
  for (const char of bits) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

test('the size grows with the text, by versions', () => {
  assert.equal(qrMatrix('A').length, 21, 'version 1');
  assert.equal(qrMatrix('z'.repeat(20)).length, 25, 'version 2');
  assert.equal(qrMatrix('z'.repeat(60)).length, 33, 'version 4');
  assert.equal(qrMatrix('z'.repeat(105)).length, 41, 'version 6');
});

test('every link this app hands out fits', () => {
  const app = 'https://wjrnj9zy72-design.github.io/Code/';
  const game = `${app}#/game/g_c1f81ad1-730f-4f2b-ba39-b0d94a205b98`;
  assert.ok(qrMatrix(app), `${app.length} characters`);
  assert.ok(qrMatrix(game), `${game.length} characters`);
  assert.ok(MAX_BYTES >= game.length, `a share link is ${game.length} bytes, capacity ${MAX_BYTES}`);
});

test('what does not fit is refused rather than mangled', () => {
  assert.equal(qrMatrix('x'.repeat(MAX_BYTES + 1)), null);
  assert.equal(qrSvg('x'.repeat(MAX_BYTES + 1)), null);
  assert.ok(qrMatrix('x'.repeat(MAX_BYTES)), 'and the limit itself is usable');
});

test('the three finder patterns are where a reader looks for them', () => {
  const modules = qrMatrix('https://exemple.fr/');
  const size = modules.length;
  const ring = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        assert.equal(modules[top + r][left + c] ? 1 : 0, ring[r][c], `finder at ${top},${left} (${r},${c})`);
      }
    }
  }
});

test('the timing patterns alternate, and the dark module is dark', () => {
  const modules = qrMatrix('https://exemple.fr/');
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(modules[6][i], i % 2 === 0, `horizontal timing at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0, `vertical timing at ${i}`);
  }
  assert.equal(modules[size - 8][8], true, 'the module that is always dark');
});

test('the same text always gives the same code', () => {
  // Checked module for module against an independent encoder, for all eight
  // masks, and read back by an independent decoder. This pins that result.
  assert.equal(fingerprint(qrMatrix("https://marque-points.example/")), 2796409134);
  assert.deepEqual(qrMatrix('abc'), qrMatrix('abc'), 'and is not random');
});

test('a forced mask is honoured, and changes the result', () => {
  const zero = qrMatrix('https://exemple.fr/', { mask: 0 });
  const three = qrMatrix('https://exemple.fr/', { mask: 3 });
  assert.notDeepEqual(zero, three);
  assert.deepEqual(zero, qrMatrix('https://exemple.fr/', { mask: 0 }));
});

test('the svg is square, quiet-zoned and self-contained', () => {
  const svg = qrSvg('https://exemple.fr/', { size: 240 });
  const modules = qrMatrix('https://exemple.fr/').length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${modules + 8} ${modules + 8}"`), 'four modules of quiet zone');
  assert.match(svg, /width="240" height="240"/);
  assert.equal(/<image|href=|url\(/.test(svg), false, 'nothing fetched from anywhere');
});
