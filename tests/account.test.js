import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemote, sessionOf } from '../src/remote.js';

function recorder(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const answer = answers.shift();
    return { ok: true, status: answer === undefined ? 204 : 200, text: async () => (answer === undefined ? '' : JSON.stringify(answer)) };
  };
  return { calls, fetchImpl };
}

test('un compte : un code par e-mail, puis une session', async () => {
  const { calls, fetchImpl } = recorder([undefined, {
    access_token: 'jeton', refresh_token: 'renouveau', expires_in: 3600, user: { id: 'u1', email: 'gui@exemple.fr' },
  }]);
  const remote = createRemote({ url: 'https://projet.supabase.co/rest/v1/', key: 'publique' }, fetchImpl);
  await remote.sendCode(' gui@exemple.fr ');
  assert.equal(calls[0].url, 'https://projet.supabase.co/auth/v1/otp');
  assert.deepEqual(calls[0].body, { email: 'gui@exemple.fr', create_user: true });
  const session = await remote.verifyCode('gui@exemple.fr', ' 123456 ');
  assert.equal(calls[1].url, 'https://projet.supabase.co/auth/v1/verify');
  assert.deepEqual(calls[1].body, { type: 'email', email: 'gui@exemple.fr', token: '123456' });
  assert.equal(session.access, 'jeton');
  assert.equal(session.email, 'gui@exemple.fr');
  assert.ok(session.expires > Date.now());
});

test('les fonctions des comptes partent avec le jeton du compte, le reste avec la clé publique', async () => {
  const { calls, fetchImpl } = recorder([{ status: 'ok' }, null]);
  const remote = createRemote({ url: 'https://projet.supabase.co', key: 'publique' }, fetchImpl);
  await remote.accountLink('jeton-du-compte', 'cle-du-groupe', 'Gui');
  assert.equal(calls[0].url, 'https://projet.supabase.co/rest/v1/rpc/marque_points_account_link');
  assert.equal(calls[0].headers.authorization, 'Bearer jeton-du-compte');
  assert.equal(calls[0].headers.apikey, 'publique');
  await remote.get('x');
  assert.equal(calls[1].headers.authorization, 'Bearer publique');
});

test('une réponse sans jeton ne fait pas de session', () => {
  assert.equal(sessionOf(null), null);
  assert.equal(sessionOf({ access_token: 'a' }), null);
  assert.equal(sessionOf({ access_token: 'a', refresh_token: 'b', expires_in: 10 }, 0).expires, 60000, 'jamais moins d’une minute');
});
