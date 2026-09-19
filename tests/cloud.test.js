import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile, connectStore } from '../src/cloud.js';
import { createGame, addRound } from '../src/model.js';

function game(name, updatedAt) {
  return { ...createGame({ presetId: 'skyjo', names: ['A', 'B'], name }), updatedAt };
}

test('an empty store adopts everything this browser holds', () => {
  const local = [game('un', 10), game('deux', 20)];
  const { games, toPush } = reconcile(local, []);
  assert.equal(games.length, 2);
  assert.equal(toPush.length, 2, 'both have to go up');
});

test('a browser with nothing adopts everything the store holds', () => {
  const remote = [game('un', 10), game('deux', 20)];
  const { games, toPush } = reconcile([], remote);
  assert.deepEqual(games.map((item) => item.name), ['deux', 'un'], 'most recent first');
  assert.deepEqual(toPush, [], 'nothing to send back');
});

test('the newer copy of a game wins', () => {
  const stale = game('partie', 100);
  const fresh = { ...stale, updatedAt: 200, name: 'partie (continuée ailleurs)' };

  const remoteWins = reconcile([stale], [fresh]);
  assert.equal(remoteWins.games[0].name, 'partie (continuée ailleurs)');
  assert.deepEqual(remoteWins.toPush, [], 'the store is already right');

  const localWins = reconcile([fresh], [stale]);
  assert.equal(localWins.games[0].name, 'partie (continuée ailleurs)');
  assert.deepEqual(localWins.toPush.map((item) => item.id), [fresh.id], 'the store is behind');
});

test('a round added offline survives the merge', () => {
  const base = game('partie', 100);
  const played = { ...addRound(base, { scores: {} }), updatedAt: 300 };
  const { games, toPush } = reconcile([played], [base]);
  assert.equal(games[0].rounds.length, 1);
  assert.equal(toPush.length, 1);
});

test('a game the two sides share at the same moment is left alone', () => {
  const same = game('partie', 100);
  const { games, toPush } = reconcile([same], [{ ...same }]);
  assert.equal(games.length, 1);
  assert.deepEqual(toPush, [], 'no pointless write');
});

test('junk in the store is ignored rather than adopted', () => {
  const good = game('partie', 10);
  const { games } = reconcile([good], [{ id: 'nope' }, null, { rounds: [] }]);
  assert.deepEqual(games.map((item) => item.id), [good.id]);
});

test('games are merged by id, never duplicated', () => {
  const one = game('partie', 10);
  const { games } = reconcile([one, one], [one]);
  assert.equal(games.length, 1);
});

test('without a host offering a store, the app simply runs on its own', async () => {
  const saved = globalThis.claude;
  try {
    delete globalThis.claude;
    assert.equal(await connectStore({ getLocalGames: () => [], onGames() {} }), null);

    globalThis.claude = {}; // a host with no use()
    assert.equal(await connectStore({ getLocalGames: () => [], onGames() {} }), null);

    globalThis.claude = { use: async () => null }; // store not granted
    assert.equal(await connectStore({ getLocalGames: () => [], onGames() {} }), null);

    globalThis.claude = { use: async () => { throw new Error('nope'); } };
    assert.equal(await connectStore({ getLocalGames: () => [], onGames() {} }), null, 'a throwing host is not fatal');
  } finally {
    if (saved === undefined) delete globalThis.claude;
    else globalThis.claude = saved;
  }
});

test('connecting subscribes once and merges the first snapshot', async () => {
  const saved = globalThis.claude;
  const writes = [];
  const local = [game('local', 50)];
  const remote = [game('distant', 80)];
  let subscriptions = 0;

  const fakeDb = {
    collection() {
      return {
        doc: (id) => ({
          set: async (body) => writes.push(['set', id, body.name]),
          delete: async () => writes.push(['delete', id]),
        }),
        onSnapshot(next) {
          subscriptions += 1;
          next({ docs: remote.map((item) => ({ data: () => item })) });
          return () => {};
        },
      };
    },
  };

  try {
    globalThis.claude = { use: async (name) => (name === 'db' ? fakeDb : null) };
    let merged = [];
    const store = await connectStore({
      getLocalGames: () => local,
      onGames: (games) => { merged = games; },
    });

    assert.ok(store, 'a store was returned');
    assert.equal(subscriptions, 1, 'exactly one subscription');
    assert.deepEqual(merged.map((item) => item.name), ['distant', 'local']);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(writes, [['set', local[0].id, 'local']], 'only what the store was missing');

    await store.remove('abc');
    assert.deepEqual(writes.at(-1), ['delete', 'abc']);
  } finally {
    if (saved === undefined) delete globalThis.claude;
    else globalThis.claude = saved;
  }
});
