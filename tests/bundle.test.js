import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { bundle } from '../tools/bundle.js';

const root = resolve(import.meta.dirname, '..');
const BUILDS = [
  ['page', 'marque-points.html'],
  ['artifact', 'marque-points.artifact.html'],
];

for (const [target, name] of BUILDS) {
  test(`the committed ${target} build is up to date`, async () => {
    const [built, committed] = await Promise.all([
      bundle(target),
      readFile(join(root, 'dist', name), 'utf8'),
    ]);
    assert.equal(
      built,
      committed,
      `dist/${name} is stale — run \`npm run bundle\` and commit the result.`,
    );
  });

  test(`the ${target} build needs nothing from the network or the disk`, async () => {
    const output = await bundle(target);
    assert.equal(/<link[^>]+href="(?!data:)/.test(output), false, 'no external stylesheet');
    assert.equal(/<script[^>]+src=/.test(output), false, 'no external script');
    assert.equal(output.includes('type="module"'), false, 'modules do not load over file://');
    assert.match(output, /<style>/, 'the stylesheet is inlined');
    assert.match(output, /PRESETS/, 'the game presets are inlined');
  });
}

test('the page build is a whole document, the artifact build is a fragment', async () => {
  const page = await bundle('page');
  assert.match(page, /^<!DOCTYPE html>/, 'the standalone file carries its own skeleton');
  assert.match(page, /<body>/);

  const artifact = await bundle('artifact');
  assert.equal(/<!DOCTYPE|<html|<head>|<body>/i.test(artifact), false, 'the host supplies those');
  assert.match(artifact, /^<title>[^<]+<\/title>/, 'the title still comes first');
  assert.match(artifact, /class="app-bar"/, 'the page content is there');
});

test('the artifact build exports by copy, since a sandbox ignores a download', async () => {
  const artifact = await bundle('artifact');
  assert.match(artifact, /window\.MARQUE_POINTS_EXPORT_MODE = 'copy';/);

  const page = await bundle('page');
  assert.equal(page.includes("MARQUE_POINTS_EXPORT_MODE = 'copy';"), false, 'a real file downloads');
});

test('bundling refuses to silently produce a broken page', async () => {
  // The bundler asserts that each piece of markup it reads is really there,
  // so a rename in index.html fails the build instead of shipping a blank page.
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(html, /<script type="module" src="src\/app\.js"><\/script>/);
  assert.match(html, /<title>[^<]+<\/title>/);
});
