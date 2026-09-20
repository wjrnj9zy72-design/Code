/**
 * A game as a few lines of text — to paste into the conversation where the
 * people who were not there are waiting for the result.
 *
 * `t` is the app's translate function, passed in so this stays testable
 * without a browser or a language loaded.
 */

import { standings, gameStatus, roundScore } from './scoring.js';

export function recapText(game, t, { title, withRounds = false } = {}) {
  const status = gameStatus(game);
  const rows = status.standings;
  const lines = [];

  lines.push(`${title} — ${t('home.rounds', { count: game.rounds.length })}`);

  if (status.finished && status.winners.length) {
    lines.push(
      t(status.winners.length > 1 ? 'home.winners' : 'home.winner', {
        name: status.winners.map((row) => row.name).join(', '),
      }),
    );
  }

  lines.push('');
  rows.forEach((row) => {
    lines.push(`${row.rank}. ${row.name} — ${row.total}`);
  });

  if (withRounds && game.rounds.length) {
    lines.push('');
    lines.push(t('game.perRound'));
    game.rounds.forEach((round, index) => {
      const scores = game.players.map((player) => `${player.name} ${roundScore(round, player.id)}`);
      lines.push(`${index + 1}. ${scores.join(' · ')}`);
    });
  }

  return lines.join('\n');
}
