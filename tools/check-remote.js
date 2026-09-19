/**
 * Check that a shared-games database is set up correctly.
 *
 *   node tools/check-remote.js <url> <clé publique>
 *
 * It writes a test game, reads it back, compares it, deletes it, and checks
 * that it is gone — then says, in plain words, what works and what does not.
 * Nothing else in the app is touched, and the test game is removed on the way
 * out (or named, if it could not be).
 */

import { createRemote } from '../src/remote.js';

const [url, key] = process.argv.slice(2);

if (!url || !key) {
  console.error('Usage : node tools/check-remote.js <url> <clé publique>');
  console.error('Les deux valeurs sont dans les réglages API de votre projet.');
  process.exit(2);
}

const remote = createRemote({ url, key });
if (!remote) {
  console.error('✗ URL ou clé vide.');
  process.exit(2);
}

const game = {
  id: `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  presetId: 'papayoo',
  name: 'Partie de test',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  finishedAt: null,
  players: [{ id: 'p1', name: 'Test' }],
  config: { direction: 'low', endMode: 'manual', roundSum: 250, allowNegative: false },
  rounds: [{ id: 'r1', scores: { p1: 250 }, meta: null, note: '' }],
};

let failed = false;
const step = async (label, run) => {
  try {
    await run();
    console.log(`✓ ${label}`);
  } catch (error) {
    failed = true;
    console.log(`✗ ${label}`);
    console.log(`   ${error.message}`);
    if (error.status === 401 || error.status === 403) {
      console.log('   → la clé est refusée : vérifiez que vous avez copié la clé publique (anon).');
    } else if (error.status === 404) {
      console.log('   → la fonction est introuvable : le script SQL n’a pas été exécuté, ou pas en entier.');
    } else if (error.status === undefined) {
      console.log('   → aucune réponse : vérifiez l’URL du projet, et votre connexion.');
    }
  }
};

console.log(`Vérification de ${url}\n`);

await step('écrire une partie', () => remote.put(game));

await step('la relire à l’identique', async () => {
  const found = await remote.get(game.id);
  if (!found) throw new Error('rien n’a été relu — la fonction de lecture ne renvoie pas la partie');
  if (found.id !== game.id) throw new Error(`identifiant relu : ${found.id}`);
  if (found.rounds?.[0]?.scores?.p1 !== 250) throw new Error('les scores ne sont pas revenus intacts');
});

await step('ne rien trouver pour un identifiant inconnu', async () => {
  const nothing = await remote.get(`absent_${game.id}`);
  if (nothing) throw new Error('une partie inexistante a renvoyé quelque chose');
});

await step('la supprimer', () => remote.remove(game.id));

await step('vérifier qu’elle a bien disparu', async () => {
  const found = await remote.get(game.id);
  if (found) throw new Error('la partie est toujours là après suppression');
});

console.log('');
if (failed) {
  console.log('La base n’est pas prête. Corrigez les points ci-dessus, puis relancez.');
  console.log(`Si une partie de test est restée, son identifiant est ${game.id}.`);
  process.exit(1);
}
console.log('Tout fonctionne : collez l’URL et la clé dans src/config.js, et publiez.');
