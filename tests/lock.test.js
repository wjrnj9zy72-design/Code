import test from 'node:test';
import assert from 'node:assert/strict';

import { canSeal, newCode, isCode, readCode, seal, unseal } from '../src/lock.js';

test('a code is six digits, and every digit is drawn', () => {
  const seen = new Set();
  for (let index = 0; index < 400; index += 1) {
    const code = newCode();
    assert.match(code, /^[0-9]{6}$/, code);
    seen.add(code);
  }
  assert.ok(seen.size > 390, `codes repeat far too often: ${seen.size} distinct out of 400`);
});

test('a code keeps its leading zeros', () => {
  // A number would drop them, and "012345" typed in would then never match.
  const codes = Array.from({ length: 2000 }, () => newCode());
  assert.ok(codes.every((code) => code.length === 6));
  assert.ok(codes.some((code) => code.startsWith('0')), 'no code ever started with a zero');
});

test('the draw is spread evenly over the million', () => {
  // A thousand draws, cut into ten buckets: a badly biased draw (taking a
  // remainder without rejecting, say) piles up in the first ones.
  const buckets = new Array(10).fill(0);
  for (let index = 0; index < 2000; index += 1) buckets[Number(newCode()[0])] += 1;
  for (const [digit, count] of buckets.entries()) {
    assert.ok(count > 120 && count < 280, `first digit ${digit} came up ${count} times in 2000`);
  }
});

test('what a code looks like, and what it is read from', () => {
  assert.ok(isCode('012345'));
  assert.ok(isCode('  012345 '));
  assert.ok(!isCode('12345'), 'five digits');
  assert.ok(!isCode('1234567'));
  assert.ok(!isCode('12345a'));
  assert.ok(!isCode(''));
  assert.ok(!isCode(null));

  assert.equal(readCode('012 345'), '012345', 'spaces as read out loud');
  assert.equal(readCode('012-345'), '012345');
  assert.equal(readCode('le code est 012345'), '012345');
  assert.equal(readCode('1234'), null);
  assert.equal(readCode('1234567'), null, 'too many digits is not a guess to make');
  assert.equal(readCode(null), null);
});

test('sealing needs Web Crypto, and says so where there is none', () => {
  assert.equal(canSeal(), true, 'this runtime has it');
});

test('what was sealed comes back with the right code, and only with it', async () => {
  const ids = ['g_c1f81ad1-730f-4f2b-ba39-b0d94a205b98', 'g_2d5e5be2-478d-4357-bf62-9078eb8ecc08'];
  const code = newCode();
  const sealed = await seal(ids, code);

  assert.equal(sealed.v, 1);
  assert.ok(sealed.salt && sealed.iv && sealed.data);
  assert.deepEqual(await unseal(sealed, code), ids);

  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal(await unseal(sealed, wrong), null, 'a wrong code opens nothing');
});

test('a sealed lot gives nothing away about what it holds', async () => {
  const ids = ['g_c1f81ad1-730f-4f2b-ba39-b0d94a205b98'];
  const sealed = await seal(ids, '123456');
  const written = JSON.stringify(sealed);

  assert.ok(!written.includes('g_c1f81ad1'), 'the id is not in there in any readable form');
  assert.ok(!written.includes('123456'), 'nor is the code');
});

test('two seals of the same thing look nothing alike', async () => {
  const first = await seal(['g_1'], '123456');
  const second = await seal(['g_1'], '123456');
  assert.notEqual(first.data, second.data, 'a fresh salt and nonce every time');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
});

test('a tampered-with seal refuses to open, rather than opening wrongly', async () => {
  const sealed = await seal(['g_1', 'g_2'], '123456');
  const bytes = Buffer.from(sealed.data, 'base64');
  bytes[2] ^= 0x40;
  const changed = { ...sealed, data: bytes.toString('base64') };

  assert.equal(await unseal(changed, '123456'), null);
});

test('nonsense in place of a seal is simply nothing', async () => {
  assert.equal(await unseal(null, '123456'), null);
  assert.equal(await unseal({}, '123456'), null);
  assert.equal(await unseal({ v: 2, salt: 'x', iv: 'y', data: 'z' }, '123456'), null, 'a version from later');
  assert.equal(await unseal({ v: 1, salt: '!!', iv: '!!', data: '!!' }, '123456'), null, 'not even base64');
});
