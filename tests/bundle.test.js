import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { bundle } from '../tools/bundle.js';

const root = resolve(import.meta.dirname, '..');
const DIST = join(root, 'dist', 'marque-points.html');

test('the committed single-file build is up to date', async () => {
  const [built, committed] = await Promise.all([bundle(), readFile(DIST, 'utf8')]);
  assert.equal(
    built,
    committed,
    'dist/marque-points.html is stale — run `npm run bundle` and commit the result.',
  );
});

test('the single-file build needs nothing from the network or the disk', async () => {
  const output = await bundle();
  assert.equal(/<link[^>]+href="(?!data:)/.test(output), false, 'no external stylesheet');
  assert.equal(/<script[^>]+src=/.test(output), false, 'no external script');
  assert.equal(output.includes('type="module"'), false, 'modules do not load over file://');
  assert.match(output, /<style>/, 'the stylesheet is inlined');
  assert.match(output, /PRESETS/, 'the game presets are inlined');
});

test('bundling refuses to silently produce a broken page', async () => {
  // The bundler asserts that each piece of markup it rewrites is really there,
  // so a rename in index.html fails the build instead of shipping a blank page.
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(html, /<script type="module" src="src\/app\.js"><\/script>/);
});
