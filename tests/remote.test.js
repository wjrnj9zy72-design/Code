import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemote, pickNewer, shareLink, pollLink, pollIdFrom, wasDeleted } from '../src/remote.js';
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
  assert.deepEqual(calls[0].body, { p_id: 'g_1', p_key: null });
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

test('an invitation travels as a link, so nothing has to be typed', async () => {
  const { joinLink, joinFrom, setIdFrom, gameIdFrom } = await import('../src/remote.js');
  const place = { origin: 'https://gui.github.io', pathname: '/Code/', search: '' };

  const link = joinLink(place, 'Mifa', '123456');
  assert.equal(link, 'https://gui.github.io/Code/#/join/123456/Mifa');
  assert.deepEqual(joinFrom(link), { code: '123456', name: 'Mifa' });
  assert.deepEqual(joinFrom(`Tiens : ${link} à ce soir`), { code: '123456', name: 'Mifa' });

  const spaced = joinLink(place, 'Copains du mardi', '000042');
  assert.equal(spaced, 'https://gui.github.io/Code/#/join/000042/Copains%20du%20mardi',
    'a name with spaces still makes one unbroken link');
  assert.deepEqual(joinFrom(spaced), { code: '000042', name: 'Copains du mardi' },
    'and comes back as it was written');
  assert.deepEqual(joinFrom(joinLink(place, 'Été 2026 / sud', '999999')),
    { code: '999999', name: 'Été 2026 / sud' }, 'accents and slashes included');

  assert.equal(joinFrom('https://gui.github.io/Code/#/join/12345/Mifa'), null, 'five digits is not a code');
  assert.equal(joinFrom('https://gui.github.io/Code/#/join/123456'), null, 'a code without its group');
  assert.equal(joinFrom('https://gui.github.io/Code/#/join/123456/'), null, 'nor an empty group name');
  assert.equal(joinFrom('https://gui.github.io/Code/#/set/lot_abcdefgh'), null, 'a lot is not an invitation');
  assert.equal(joinFrom(null), null);
  assert.equal(setIdFrom(link), null, 'and an invitation is never taken for something else');
  assert.equal(gameIdFrom(link), null);
});

test('an invitation link read out of a sentence loses the sentence with it', async () => {
  const { joinFrom } = await import('../src/remote.js');
  const link = 'https://gui.github.io/Code/#/join/123456/Mifa';
  const famille = { code: '123456', name: 'Mifa' };

  assert.deepEqual(joinFrom(`Voici le lien : ${link}.`), famille, 'a full stop');
  assert.deepEqual(joinFrom(`Le lien (${link}) à ce soir`), famille, 'a bracket that closes nothing');
  assert.deepEqual(joinFrom(`«${link}»`), famille, 'the quotes a phone puts round it');
  assert.deepEqual(joinFrom(`${link}!!`), famille);
  assert.deepEqual(joinFrom(`${link}\u2026`), famille, 'and an ellipsis');

  // A group really called that keeps its brackets: they close what they open.
  assert.deepEqual(joinFrom('https://gui.github.io/Code/#/join/123456/Mifa%20(maison)'),
    { code: '123456', name: 'Mifa (maison)' });
});

test('an invitation is six digits, in a hash, or it is not one', async () => {
  const { joinFrom } = await import('../src/remote.js');
  assert.equal(joinFrom('https://gui.github.io/Code/#/join/1234567/Mifa'), null,
    'seven digits is not a code, and must not be read as six');
  assert.equal(joinFrom('https://gui.github.io/Code/join/123456/Mifa'), null,
    'a path that merely looks like one is not an invitation');
  assert.equal(joinFrom('https://gui.github.io/Code/#/join/123456/%20'), null,
    'a name made of blanks names nothing');
  assert.deepEqual(joinFrom('https://gui.github.io/Code/#/join/123456/%20Mifa%20'),
    { code: '123456', name: 'Mifa' }, 'and one written with blanks round it is trimmed');
});

test('a link mangled on its way through a message still carries the digits', async () => {
  const { joinFrom } = await import('../src/remote.js');
  // A stray percent sign is what a message app leaves behind when it decides
  // to shorten a link: the name is then read as it stands rather than lost.
  assert.deepEqual(joinFrom('https://gui.github.io/Code/#/join/123456/Mifa%'),
    { code: '123456', name: 'Mifa%' });
});

test('a lot takes a group key to write, and a code to read', async () => {
  const calls = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    calls.push({ fn: url.split('/').pop(), body: JSON.parse(options.body) });
    if (url.endsWith('marque_points_open_set')) {
      return ok({ status: 'ok', set: { kind: 'set', ids: ['g_1', 'g_2'] } });
    }
    if (url.endsWith('marque_points_group_of')) return ok({ id: 'grp_1', name: 'Mifa', admits: true });
    return ok(undefined, 204);
  });

  await remote.putSet('lot_1', { ids: ['g_1', 'g_2'] }, '123456', 'la-cle-famille');
  assert.equal(calls[0].fn, 'marque_points_put_set');
  assert.equal(calls[0].body.p_code, '123456');
  assert.equal(calls[0].body.p_key, 'la-cle-famille', 'no key, no lot');

  const answer = await remote.openSet('lot_1', '123456');
  assert.deepEqual(answer, { status: 'ok', contents: { kind: 'set', ids: ['g_1', 'g_2'] } });
  assert.ok(!('p_key' in calls[1].body), 'the receiver has no key to give');

  assert.deepEqual(await remote.groupOf('la-cle-famille'), { id: 'grp_1', name: 'Mifa', admits: true });
  assert.equal(await remote.forgetSet('lot_1', 'la-cle-famille'), false, 'no answer means not gone');
  assert.equal(calls[3].body.p_key, 'la-cle-famille', 'revoking takes the key, not the code');
});

test('a key says which group it opens, and whether it lets people in', async () => {
  const answering = (body) => createRemote(CONFIG, async () => ok(body));
  assert.deepEqual(await answering({ id: 'grp_1', name: 'Mifa', admits: true }).groupOf('k'),
    { id: 'grp_1', name: 'Mifa', admits: true });
  assert.deepEqual(await answering({ id: 'grp_1', name: 'Mifa' }).groupOf('k'),
    { id: 'grp_1', name: 'Mifa', admits: false },
    'a key that says nothing about it does not let people in');
  assert.equal(await answering(null).groupOf('k'), null, 'a key that opens nothing');
  assert.equal(await answering({ name: 'Sans identifiant' }).groupOf('k'), null, 'nor an answer missing its id');
});

test('a group hands back what is shared in it, and nothing else', async () => {
  const sent = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    sent.push(JSON.parse(options.body));
    return ok([{ id: 'g_1', updatedAt: 10 }, { id: 'l_2', updatedAt: 20 }, null, { nope: true }]);
  });

  assert.deepEqual(await remote.groupDocs('la-cle'), [{ id: 'g_1', updatedAt: 10 }, { id: 'l_2', updatedAt: 20 }],
    'games and lists together, and only rows that are rows');
  assert.equal(sent[0].p_key, 'la-cle');

  const empty = createRemote(CONFIG, async () => ok(null));
  assert.deepEqual(await empty.groupDocs('la-cle'), [], 'a group with nothing in it is not a crash');
});

test('starting to share takes a key, contributing does not', async () => {
  const sent = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    sent.push({ fn: url.split('/').pop(), body: JSON.parse(options.body) });
    return ok(undefined, 204);
  });

  await remote.put({ id: 'g_1', rounds: [] }, 'la-cle');
  assert.equal(sent[0].body.p_key, 'la-cle');
  await remote.put({ id: 'g_1', rounds: [1] });
  assert.equal(sent[1].body.p_key, null, 'a round added to a game someone else shared');

  await remote.remove('g_1', 'la-cle');
  assert.equal(sent[2].fn, 'marque_points_delete');
  assert.equal(sent[2].body.p_key, 'la-cle');
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
});

test('a refused key is a refusal, not a silent success', async () => {
  const remote = createRemote(CONFIG, async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ message: 'cle de groupe invalide' }),
  }));
  await assert.rejects(() => remote.put({ id: 'g_1' }, 'wrong'), /cle de groupe invalide/);
  await assert.rejects(() => remote.putSet('lot_1', { ids: ['g_1'] }, '123456', 'wrong'),
    /cle de groupe invalide/);
});

test('an invitation is six digits, and knocking hands back no key at all', async () => {
  const calls = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    calls.push({ fn: url.split('/').pop(), body: JSON.parse(options.body) });
    if (url.endsWith('marque_points_invite')) {
      return ok({ code: '482913', name: 'Mifa', minutes: 1440, uses: 50 });
    }
    return ok({ status: 'waiting', ticket: 'le-jeton-de-cet-appareil', id: 'grp_1', name: 'Mifa' });
  });

  const invitation = await remote.invite('la-cle-famille', 1440, 50);
  assert.deepEqual(invitation, { code: '482913', name: 'Mifa', minutes: 1440, uses: 50 });
  assert.equal(calls[0].body.p_key, 'la-cle-famille', 'inviting takes being in the group');
  assert.equal(calls[0].body.p_minutes, 1440, 'a link for the day');
  assert.equal(calls[0].body.p_uses, 50, 'and for several people');

  const knocked = await remote.ask('Mifa', '482913', 'Alice', 'écran d’accueil');
  assert.deepEqual(knocked,
    { status: 'waiting', ticket: 'le-jeton-de-cet-appareil', id: 'grp_1', name: 'Mifa' });
  assert.equal(calls[1].body.p_name, 'Mifa');
  assert.equal(calls[1].body.p_code, '482913');
  assert.equal(calls[1].body.p_who, 'Alice', 'so the group knows who is knocking');
  assert.equal(calls[1].body.p_label, 'écran d’accueil', 'so a key can be told from another later');
  assert.ok(!('p_key' in calls[1].body), 'knocking holds no key — that is the whole point');
});

test('every way knocking can fail says which one it was', async () => {
  const answering = (body) => createRemote(CONFIG, async () => ok(body));

  assert.deepEqual(await answering({ status: 'unknown' }).ask('Mifa', '000000'), { status: 'unknown' });
  assert.deepEqual(await answering({ status: 'busy' }).ask('Mifa', '000000'), { status: 'busy' },
    'too many attempts, or too many people already waiting');
  assert.deepEqual(await answering({ status: 'waiting', id: 'g', name: 'F' }).ask('Mifa', '000000'),
    { status: 'unknown' }, 'a "waiting" with no ticket in it is nothing to wait on');
  assert.deepEqual(await answering(null).ask('Mifa', '000000'), { status: 'unknown' });
  assert.equal(await answering(null).invite('k'), null);
  assert.equal(await answering({ name: 'Mifa' }).invite('k'), null, 'an answer with no code is none');
});

test('a ticket is answered with waiting, yes, no, or gone', async () => {
  const answering = (body) => createRemote(CONFIG, async () => ok(body));

  assert.deepEqual(await answering({ status: 'waiting', name: 'Mifa' }).claim('jeton'),
    { status: 'waiting', name: 'Mifa' });
  assert.deepEqual(await answering({ status: 'ok', id: 'grp_1', name: 'Mifa' }).claim('jeton'),
    { status: 'ok', id: 'grp_1', name: 'Mifa' });
  assert.deepEqual(await answering({ status: 'refused' }).claim('jeton'), { status: 'refused' });
  assert.deepEqual(await answering({ status: 'ok' }).claim('jeton'), { status: 'unknown' },
    'an "ok" that names no group is not an answer');
  assert.deepEqual(await answering(null).claim('jeton'), { status: 'unknown' });
});

test('the gatekeeper reads the knocks, answers them, and cuts a device off', async () => {
  const calls = [];
  const remote = createRemote(CONFIG, async (url, options) => {
    const fn = url.split('/').pop();
    calls.push({ fn, body: JSON.parse(options.body) });
    if (fn === 'marque_points_requests') {
      return ok([{ id: 'req_1', name: 'Alice', label: 'navigateur', at: 1 }, null, { name: 'sans id' }]);
    }
    if (fn === 'marque_points_group_keys') {
      return ok([{ id: 'key_1', label: 'première clé', admits: true, mine: true, at: 1 }]);
    }
    if (fn === 'marque_points_answer') return ok({ status: 'ok' });
    return ok({ status: 'last' });
  });

  assert.deepEqual(await remote.requests('la-cle-famille'),
    [{ id: 'req_1', name: 'Alice', label: 'navigateur', at: 1 }],
    'rows that are rows, and nothing else');

  assert.deepEqual(await remote.groupKeys('la-cle-famille'),
    [{ id: 'key_1', label: 'première clé', admits: true, mine: true, at: 1 }]);

  assert.equal(await remote.answer('la-cle-famille', 'req_1', true), 'ok');
  assert.equal(calls[2].body.p_accept, true, 'accepting says so plainly');

  assert.equal(await remote.cutKey('la-cle-famille', 'key_1'), 'last',
    'the last key that lets people in is refused, and the caller is told which refusal it is');
});

test('a gate a key does not open is an empty hand, not a crash', async () => {
  const refusing = createRemote(CONFIG, async () => ({
    ok: false,
    status: 400,
    async json() {
      return { code: 'P0001', message: 'cette cle ne fait pas entrer' };
    },
    async text() {
      return 'cette cle ne fait pas entrer';
    },
  }));

  await assert.rejects(() => refusing.requests('une-cle-ordinaire'), /ne fait pas entrer/);
  await assert.rejects(() => refusing.groupKeys('une-cle-ordinaire'), /ne fait pas entrer/);

  const silent = createRemote(CONFIG, async () => ok(null));
  assert.deepEqual(await silent.requests('k'), [], 'nobody knocking is an empty list');
  assert.deepEqual(await silent.groupKeys('k'), []);
  assert.equal(await silent.answer('k', 'req', true), 'unknown');
  assert.equal(await silent.cutKey('k', 'key'), 'unknown');
});

test('a return link carries one person’s token, in the fragment and nowhere else', async () => {
  const { backLink, backTokenFrom, joinFrom, setIdFrom } = await import('../src/remote.js');
  const place = { origin: 'https://gui.github.io', pathname: '/Code/', search: '' };
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  const link = backLink(place, token);
  assert.equal(link, `https://gui.github.io/Code/#/back/${token}`);
  assert.ok(link.indexOf('#') < link.indexOf(token),
    'the token sits after the #, so no server and no link preview ever sees it');
  assert.ok(link.length <= 106, 'short enough for the QR encoder this app carries');

  assert.equal(backTokenFrom(link), token);
  assert.equal(backTokenFrom(`Garde ça : ${link} à bientôt`), token);
  assert.equal(backTokenFrom(`${link}.`), token, 'a full stop at the end of a sentence');
  assert.equal(backTokenFrom(`https://x/#/back/${'a'.repeat(31)}`), null, 'too short to be a token');
  assert.equal(backTokenFrom(`https://x/#/back/${'a'.repeat(33)}`), null, 'nor too long');
  assert.equal(backTokenFrom(`https://x/#/back/${'z'.repeat(32)}`), null, 'nor anything but hex');
  assert.equal(backTokenFrom(null), null);

  assert.equal(joinFrom(link), null, 'a return link is not an invitation');
  assert.equal(setIdFrom(link), null, 'nor a lot');
});

test('the return link answers with a key, or says why not', async () => {
  const answering = (body) => createRemote(CONFIG, async () => ok(body));

  assert.deepEqual(
    await answering({ status: 'ok', token: 'a'.repeat(32), name: 'Alice' }).myLink('sa-cle'),
    { status: 'ok', token: 'a'.repeat(32), name: 'Alice' },
  );
  assert.deepEqual(await answering({ status: 'none' }).myLink('la-cle-du-portier'), { status: 'none' },
    'a key that belongs to no person has no return link');
  assert.deepEqual(await answering({ status: 'ok' }).myLink('k'), { status: 'none' },
    'an "ok" with no token in it is no link');

  assert.deepEqual(
    await answering({ status: 'ok', key: 'une-cle', who: 'Alice', id: 'grp_1', name: 'Mifa' }).returnWith('t', 'ici'),
    { status: 'ok', key: 'une-cle', who: 'Alice', id: 'grp_1', name: 'Mifa' },
  );
  assert.deepEqual(await answering({ status: 'unknown' }).returnWith('t'), { status: 'unknown' });
  assert.deepEqual(await answering({ status: 'busy' }).returnWith('t'), { status: 'busy' });
  assert.deepEqual(await answering({ status: 'ok', who: 'Alice' }).returnWith('t'), { status: 'unknown' },
    'an "ok" with no key is not a way back');
  assert.equal(await answering({ status: 'ok' }).forgetLink('k', 'per_1'), 'ok');
  assert.equal(await answering({ status: 'unknown' }).forgetLink('k', 'per_1'), 'unknown');
});

test('a poll is sent as a link that opens it alone', () => {
  // Whoever receives it came to answer: the link says so, and the app shows
  // them the poll and nothing else of itself.
  const link = pollLink({ origin: 'https://gui.github.io', pathname: '/Code/', search: '' }, 'v_42');
  assert.equal(link, 'https://gui.github.io/Code/#/poll/v_42/solo');
  assert.equal(pollIdFrom(link), 'v_42', 'and pasting it back still finds the poll');
  assert.equal(pollIdFrom('https://gui.github.io/Code/#/poll/v_42'), 'v_42', 'links sent before still work');
});

test('the organiser’s secret goes with a write, when there is one', async () => {
  const { fetchImpl, calls } = stubFetch(ok(undefined, 204));
  const remote = createRemote(CONFIG, fetchImpl);
  await remote.put({ id: 'v_1', kind: 'poll' }, 'cle', 'secret-de-l-organisateur');
  await remote.put({ id: 'v_2', kind: 'poll' }, 'cle');
  assert.equal(calls[0].body.p_owner, 'secret-de-l-organisateur');
  assert.equal('p_owner' in calls[1].body, false, 'no secret, no parameter: an older database must not trip on it');
});

test('a database not yet updated still takes the poll, without its organiser', async () => {
  // PostgREST answers 404 PGRST202 when no function takes the parameters sent.
  // Refusing the poll outright would leave it unshared until the SQL is run;
  // sending it without the secret shares it — with no organiser, as before.
  const { fetchImpl, calls } = stubFetch((url, options) =>
    'p_owner' in JSON.parse(options.body)
      ? { ok: false, status: 404, text: async () => '{"code":"PGRST202","message":"Could not find the function public.marque_points_put(p_data, p_id, p_key, p_owner)"}' }
      : ok(undefined, 204));
  const remote = createRemote(CONFIG, fetchImpl);
  await remote.put({ id: 'v_1', kind: 'poll' }, 'cle', 'secret-de-l-organisateur');
  assert.equal(calls.length, 2, 'asked once with the secret, once without');
  assert.equal('p_owner' in calls[1].body, false);
});

test('any other refusal is not mistaken for an old database', async () => {
  const { fetchImpl, calls } = stubFetch({ ok: false, status: 400, text: async () => '{"message":"reserve a l\'organisateur"}' });
  const remote = createRemote(CONFIG, fetchImpl);
  await assert.rejects(remote.remove('v_1', 'cle', 'mauvais-secret-0123456789'));
  assert.equal(calls.length, 1, 'a refusal is a refusal: no second try without the secret');
});

test('a write refused because the thing was deleted says so', async () => {
  // PostgREST relays the exception as a 400 with its message: the app reads it
  // to drop its copy, rather than failing again at every change.
  const { fetchImpl } = stubFetch({ ok: false, status: 400, text: async () => '{"code":"P0001","message":"document supprime"}' });
  const remote = createRemote(CONFIG, fetchImpl);
  const error = await remote.put({ id: 'v_1', kind: 'poll' }, 'cle').catch((caught) => caught);
  assert.equal(wasDeleted(error), true);
  // …and nothing else is taken for a deletion: the network, a wrong key.
  assert.equal(wasDeleted(new TypeError('Failed to fetch')), false);
  assert.equal(wasDeleted({ detail: '{"message":"cle de groupe invalide"}' }), false);
  assert.equal(wasDeleted(undefined), false);
});

test('the database says which schema it runs — 0 when it predates the question', async () => {
  const current = createRemote(CONFIG, stubFetch(ok(1)).fetchImpl);
  assert.equal(await current.schema(), 1);
  const older = createRemote(CONFIG, stubFetch({
    ok: false, status: 404, text: async () => '{"code":"PGRST202","message":"Could not find the function public.marque_points_schema"}',
  }).fetchImpl);
  assert.equal(await older.schema(), 0);
  // Out of reach is not "old": the app must not ask for an update it cannot know is due.
  const unreachable = createRemote(CONFIG, async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(unreachable.schema());
});
