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

test('a game id is recognised however it was pasted', async () => {
  const { gameIdFrom } = await import('../src/remote.js');
  const id = 'g_c1f81ad1-730f-4f2b-ba39-b0d94a205b98';

  assert.equal(gameIdFrom(`https://gui.github.io/Code/#/game/${id}`), id, 'a full link');
  assert.equal(gameIdFrom(`  https://gui.github.io/Code/#/game/${id}  `), id, 'with spaces around');
  assert.equal(gameIdFrom(`Viens compter : https://gui.github.io/Code/#/game/${id} à ce soir`), id,
    'a link inside a message');
  assert.equal(gameIdFrom(id), id, 'the id alone, as copied from the database');
  assert.equal(gameIdFrom('http://localhost:8080/index.html?x=1#/game/g_12345678'), 'g_12345678');

  assert.equal(gameIdFrom(''), null);
  assert.equal(gameIdFrom('bonjour'), null, 'too short to be an id');
  assert.equal(gameIdFrom('https://gui.github.io/Code/'), null, 'a link to the app, not to a game');
  assert.equal(gameIdFrom(null), null);
});

test('a set travels as one short link, whatever it holds', async () => {
  const { setLink, setIdFrom, gameIdFrom } = await import('../src/remote.js');
  const place = { origin: 'https://gui.github.io', pathname: '/Code/', search: '' };

  const link = setLink(place, 'lot_abcdefgh');
  assert.equal(link, 'https://gui.github.io/Code/#/set/lot_abcdefgh');
  assert.ok(link.length < 60, 'a set of fifty games would not make it any longer');

  assert.equal(setIdFrom(link), 'lot_abcdefgh');
  assert.equal(setIdFrom(`Tiens : ${link} à ce soir`), 'lot_abcdefgh');
  assert.equal(setIdFrom('https://gui.github.io/Code/#/game/g_1'), null, 'a game link is not a set');
  assert.equal(gameIdFrom(link), null, 'and the two are never confused');
});

test('a lot takes the sharing key to write, and a code to read', async () => {
  const calls = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    calls.push({ fn: url.split('/').pop(), body: JSON.parse(options.body) });
    if (url.endsWith('marque_points_open_set')) {
      return ok({ status: 'ok', set: { kind: 'set', ids: ['g_1', 'g_2'] } });
    }
    if (url.endsWith('marque_points_is_owner')) return ok(true);
    return ok(undefined, 204);
  });

  await remote.putSet('lot_1', { ids: ['g_1', 'g_2'] }, '123456', 'the-sharing-key');
  assert.equal(calls[0].fn, 'marque_points_put_set');
  assert.equal(calls[0].body.p_code, '123456');
  assert.equal(calls[0].body.p_key, 'the-sharing-key', 'no key, no lot');
  assert.equal(calls[0].body.p_data.kind, 'set');
  assert.deepEqual(calls[0].body.p_data.ids, ['g_1', 'g_2']);

  const answer = await remote.openSet('lot_1', '123456');
  assert.deepEqual(answer, { status: 'ok', contents: { kind: 'set', ids: ['g_1', 'g_2'] } });
  assert.equal(calls[1].body.p_code, '123456');
  assert.ok(!('p_key' in calls[1].body), 'the receiver has no key to give');

  assert.equal(await remote.isOwner('the-sharing-key'), true);
  assert.equal(await remote.forgetSet('lot_1', 'the-sharing-key'), false, 'no answer means not gone');
  assert.equal(calls[3].body.p_key, 'the-sharing-key', 'revoking takes the key, not the code');
});

test('a sealed lot travels as sealed bytes, never as its game ids', async () => {
  const sent = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    sent.push(options.body);
    return ok(undefined, 204);
  });

  await remote.putSet('lot_1', { sealed: { v: 1, salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' } }, '123456', 'k');
  assert.ok(!sent[0].includes('g_'), 'nothing that looks like a game id');
  assert.ok(sent[0].includes('sealed'));
});

test('every way a lot can refuse says which one it was', async () => {
  const answering = (body) => createRemote(CONFIG, async () => ok(body));

  assert.deepEqual(await answering({ status: 'wrong', left: 7 }).openSet('lot_1', '000000'),
    { status: 'wrong', left: 7 }, 'a wrong code, and how many tries are left');
  assert.deepEqual(await answering({ status: 'locked' }).openSet('lot_1', '000000'), { status: 'locked' },
    'too many tries: that lot is closed for good');
  assert.deepEqual(await answering({ status: 'unknown' }).openSet('lot_1', '000000'), { status: 'unknown' });
  assert.deepEqual(await answering(null).openSet('lot_1', '000000'), { status: 'unknown' },
    'and a database that answers nothing is not a crash');
  assert.deepEqual(await answering({ status: 'ok' }).openSet('lot_1', '000000'),
    { status: 'ok', contents: null }, 'an empty lot is still an answer');
  assert.equal(await answering({ status: 'ok' }).forgetSet('lot_1', 'k'), true);
  assert.equal(await answering({ status: 'unknown' }).forgetSet('lot_1', 'k'), false);
  assert.equal(await answering(false).isOwner('k'), false);
});

test('a refused key is a refusal, not a silent success', async () => {
  const remote = createRemote(CONFIG, async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ message: 'cle de partage invalide' }),
  }));
  await assert.rejects(() => remote.putSet('lot_1', { ids: ['g_1'] }, '123456', 'wrong'),
    /cle de partage invalide/);
});
