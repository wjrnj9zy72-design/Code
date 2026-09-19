import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemote, pickNewer, shareLink } from '../src/remote.js';
import { createGame } from '../src/model.js';

const CONFIG = { url: 'https://example.supabase.co/', key: 'public-anon-key' };

/** A fetch that records what it was asked and answers what the test wants. */
function stubFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return typeof reply === 'function' ? reply(url, options) : reply;
  };
  return { fetchImpl, calls };
}

const ok = (body, status = 200) => ({
  ok: true,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

test('no client without a configuration', () => {
  assert.equal(createRemote(null), null);
  assert.equal(createRemote({ url: 'https://x', key: '' }), null);
  assert.equal(createRemote({ url: '', key: 'k' }), null);
  assert.equal(createRemote(CONFIG, null), null, 'nor in a runtime without fetch');
  assert.ok(createRemote(CONFIG), 'but the environment\'s own fetch is used by default');
});

test('reading a game calls the right function, with the key', async () => {
  const game = createGame({ presetId: 'papayoo', names: ['A', 'B', 'C'] });
  const { fetchImpl, calls } = stubFetch(ok(game));
  const remote = createRemote(CONFIG, fetchImpl);

  const found = await remote.get(game.id);
  assert.equal(found.id, game.id);
  assert.equal(calls.length, 1);

  const [call] = calls;
  assert.equal(call.url, 'https://example.supabase.co/rest/v1/rpc/marque_points_get',
    'the trailing slash of the configured url is not doubled');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(call.body, { p_id: game.id });
  assert.equal(call.options.headers.apikey, 'public-anon-key');
  assert.equal(call.options.headers.authorization, 'Bearer public-anon-key');
  assert.ok(call.options.signal, 'the call can be given up on');
});

test('a game nobody shared reads as absent, not as an error', async () => {
  const remote = createRemote(CONFIG, stubFetch(ok(null)).fetchImpl);
  assert.equal(await remote.get('unknown'), null);

  const empty = createRemote(CONFIG, stubFetch({ ok: true, status: 204, text: async () => '' }).fetchImpl);
  assert.equal(await empty.get('unknown'), null, 'a void answer is absence too');
});

test('writing sends the whole game under its id', async () => {
  const game = createGame({ presetId: 'skyjo', names: ['A', 'B'] });
  const { fetchImpl, calls } = stubFetch({ ok: true, status: 204, text: async () => '' });
  await createRemote(CONFIG, fetchImpl).put(game);

  assert.match(calls[0].url, /marque_points_put$/);
  assert.equal(calls[0].body.p_id, game.id);
  assert.equal(calls[0].body.p_data.presetId, 'skyjo');
});

test('deleting names the game', async () => {
  const { fetchImpl, calls } = stubFetch({ ok: true, status: 204, text: async () => '' });
  await createRemote(CONFIG, fetchImpl).remove('g_1');
  assert.match(calls[0].url, /marque_points_delete$/);
  assert.deepEqual(calls[0].body, { p_id: 'g_1' });
});

test('a refusal carries its status, so the caller can tell why', async () => {
  const remote = createRemote(CONFIG, stubFetch({
    ok: false,
    status: 401,
    text: async () => '{"message":"Invalid API key"}',
  }).fetchImpl);

  await assert.rejects(() => remote.get('g_1'), (error) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /Invalid API key/);
    return true;
  });
});

test('a network failure is not swallowed', async () => {
  const remote = createRemote(CONFIG, async () => { throw new Error('offline'); });
  await assert.rejects(() => remote.get('g_1'), /offline/);
});

test('pickNewer keeps whichever copy changed last', () => {
  const local = { updatedAt: 200 };
  const remote = { updatedAt: 100 };
  assert.equal(pickNewer(local, remote), 'local');
  assert.equal(pickNewer(remote, local), 'remote');
  assert.equal(pickNewer(local, { updatedAt: 200 }), 'same');
  assert.equal(pickNewer(local, null), 'local', 'nothing shared yet');
  assert.equal(pickNewer(null, remote), 'remote', 'a game only the link holder has');
});

test('a share link points at that game on this same page', () => {
  assert.equal(
    shareLink({ origin: 'https://gui.github.io', pathname: '/Code/', search: '' }, 'g_7'),
    'https://gui.github.io/Code/#/game/g_7',
  );
  assert.equal(
    shareLink({ origin: 'http://localhost:8080', pathname: '/index.html', search: '?x=1' }, 'g_7'),
    'http://localhost:8080/index.html?x=1#/game/g_7',
  );
});

test('the project address is accepted in every form the settings page shows', async () => {
  const { normaliseUrl } = await import('../src/remote.js');
  const expected = 'https://abcdefgh.supabase.co';

  for (const pasted of [
    'https://abcdefgh.supabase.co',
    'https://abcdefgh.supabase.co/',
    'https://abcdefgh.supabase.co/rest/v1',
    'https://abcdefgh.supabase.co/rest/v1/',
    '  https://abcdefgh.supabase.co/rest/v1/  ',
  ]) {
    assert.equal(normaliseUrl(pasted), expected, `not handled: ${JSON.stringify(pasted)}`);
  }
});

test('the REST endpoint form reaches the same function as the project url', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => 'null' };
  };
  for (const url of ['https://abcdefgh.supabase.co', 'https://abcdefgh.supabase.co/rest/v1/']) {
    await createRemote({ url, key: 'k' }, fetchImpl).get('g_1');
  }
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[0], 'https://abcdefgh.supabase.co/rest/v1/rpc/marque_points_get');
});
