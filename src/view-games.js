/**
 * Games on screen: the new-game form, the scores, the card counter, the Tarot
 * calculator, and the exports.
 *
 * Split out of app.js, which it calls back into: only from inside functions,
 * so the two may import each other.
 */

import {
  escapeHtml, flash, flashHtml, formatDate, gameTitle, navigate, parseIntOrNull, parseScore,
  presetLabel, pullGame, render, route, state, view,
} from './app.js';
import { actionsHtml, dropDeleted, getPoll, pullPoll, shareBarHtml } from './view-polls.js';
import { forget, getGame, getList, persist, pullList, replaceGame } from './view-lists.js';
import {
  groups, heldOrganiserSecrets, inGroupHtml, keyFor, landing, myName, openSet, organiserSecret,
  resetGroupChoice, restoreOrganiserSecrets, startSharing, willBeInHtml,
} from './view-groups.js';
import { PRESETS, PRESET_GROUPS, getPreset, presetConfig } from './games.js';
import {
  createGame, addRound, updateRound, removeRound, renamePlayer, setFinished, replayGame, dealerFor,
  recentNames, isValidGame, archiveGame,
} from './model.js';
import { gameStatus, roundScore, totals, validateRound, completingScore } from './scoring.js';
import { emptyHelperEntry, tapCard, undoCard, toggleSwitch, cardCount, helperTotal, isEmptyEntry } from './helpers.js';
import { CONTRACTS, POIGNEES, CHELEMS, THRESHOLDS, TOTAL_POINTS, scoreDeal, isCompleteDeal } from './tarot.js';
import { recapText } from './recap.js';
import { buildDocx } from './export-docx.js';
import { buildPdf } from './export-pdf.js';
import { qrSvg, qrMatrix } from './qr.js';
import { isValidList } from './lists.js';
import { isValidPoll } from './polls.js';
import { settle, isValidSpend } from './spends.js';
import { isValidBoard } from './ideas.js';
import { withMeFirst, withoutMe } from './people.js';
import { saveGames, saveLists, savePolls, saveSpends, saveBoards } from './storage.js';
import { shareLink, gameIdFrom, listIdFrom, pollIdFrom, setIdFrom, joinFrom, wasDeleted } from './remote.js';
import { t } from './i18n.js';

/* -------------------------------------------------------- new game view --- */

export function newGameView() {
  const presetId = state.newPresetId || PRESETS[0].id;
  const preset = getPreset(presetId);
  const config = state.newConfig || presetConfig(preset);
  const isTeam = config.entrantLabel === 'team';
  const [min, max] = preset.players;

  // A team is not a person: my name is offered to players only, and only while
  // nothing has been typed — the preset is not known before this point. Switching
  // from a game of people to a game of teams takes the offer back, since the
  // first field stops being a person and becomes "Équipe 1".
  if (!state.newGameTouched) {
    state.newGameNames = isTeam
      ? withoutMe(state.newGameNames, myName())
      : withMeFirst(state.newGameNames, myName());
  }
  while (state.newGameNames.length < min) state.newGameNames.push('');
  const names = state.newGameNames.slice(0, Math.max(min, Math.min(state.newGameNames.length, max)));

  const known = [...new Set([isTeam ? '' : myName(), ...recentNames(state.games)].filter(Boolean))];
  const nameRows = names
    .map(
      (value, index) => `
        <div class="score-row">
          <input type="text" data-name-index="${index}" ${known.length ? 'list="known-names"' : ''} value="${escapeHtml(value)}"
                 placeholder="${escapeHtml(t(isTeam ? 'new.teamName' : 'new.playerName', { n: index + 1 }))}"
                 aria-label="${escapeHtml(t(isTeam ? 'new.teamName' : 'new.playerName', { n: index + 1 }))}" />
          <button type="button" class="button button--small button--ghost" data-remove-name="${index}"
                  ${names.length <= min ? 'disabled' : ''}>✕</button>
        </div>`,
    )
    .join('');

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('new.title'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/games" data-back>${escapeHtml(t('action.back'))}</button>
    </div>

    <form id="new-game" class="card stack">
      <label>
        ${escapeHtml(t('new.game'))}
        <select id="preset">
          ${PRESET_GROUPS.map((group) => {
            const games = PRESETS.filter((item) => item.group === group);
            if (!games.length) return '';
            return `<optgroup label="${escapeHtml(t(`group.${group}`))}">${games
              .map(
                (item) =>
                  `<option value="${item.id}" ${item.id === presetId ? 'selected' : ''}>${escapeHtml(presetLabel(item))}</option>`,
              )
              .join('')}</optgroup>`;
          }).join('')}
        </select>
      </label>
      <p class="notes">${escapeHtml(t(preset.notesKey))}</p>

      <label>
        ${escapeHtml(t('new.customName'))}
        <input type="text" id="game-name" value="${escapeHtml(state.newName || '')}" placeholder="${escapeHtml(presetLabel(preset))}" />
      </label>

      <div class="stack">
        <h3>${escapeHtml(t(isTeam ? 'new.teams' : 'new.players'))}</h3>
        <div class="score-rows">${nameRows}</div>
        ${
          known.length
            ? `<datalist id="known-names">${known.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('')}</datalist>`
            : ''
        }
        <button type="button" class="button button--small" id="add-name" ${names.length >= max ? 'disabled' : ''}>
          + ${escapeHtml(t(isTeam ? 'action.addTeam' : 'action.addPlayer'))}
        </button>
      </div>

      <div class="stack">
        <h3>${escapeHtml(t('new.rules'))}</h3>
        <div class="field-grid">
          <label>
            ${escapeHtml(t('new.direction'))}
            <select id="direction">
              <option value="low" ${config.direction === 'low' ? 'selected' : ''}>${escapeHtml(t('new.directionLow'))}</option>
              <option value="high" ${config.direction === 'high' ? 'selected' : ''}>${escapeHtml(t('new.directionHigh'))}</option>
            </select>
          </label>
          <label>
            ${escapeHtml(t('new.endMode'))}
            <select id="end-mode">
              <option value="threshold" ${config.endMode === 'threshold' ? 'selected' : ''}>${escapeHtml(t('new.endThreshold'))}</option>
              <option value="rounds" ${config.endMode === 'rounds' ? 'selected' : ''}>${escapeHtml(t('new.endRounds'))}</option>
              <option value="manual" ${config.endMode === 'manual' ? 'selected' : ''}>${escapeHtml(t('new.endManual'))}</option>
            </select>
          </label>
          ${
            config.endMode === 'threshold'
              ? `<label>${escapeHtml(t('new.target'))}
                   <input type="number" id="target" step="1" value="${config.target ?? ''}" />
                 </label>`
              : ''
          }
          ${
            config.endMode === 'rounds'
              ? `<label>${escapeHtml(t('new.roundsCount'))}
                   <input type="number" id="rounds" step="1" min="1" value="${config.rounds ?? ''}" />
                 </label>`
              : ''
          }
          <label>
            ${escapeHtml(t('new.roundSum'))}
            <input type="number" id="round-sum" step="1" value="${config.roundSum ?? ''}" />
            <span class="hint">${escapeHtml(t('new.roundSumHint'))}</span>
          </label>
        </div>
        <label class="checkbox">
          <input type="checkbox" id="allow-negative" ${config.allowNegative ? 'checked' : ''} />
          ${escapeHtml(t('new.allowNegative'))}
        </label>
      </div>

      ${willBeInHtml()}
      <button type="submit" class="button button--primary button--block">${escapeHtml(t('new.start'))}</button>
    </form>`;
}

/* ------------------------------------------------------------- game view --- */

function roundFormHtml(game) {
  const preset = getPreset(game.presetId);
  if (preset?.calculator === 'tarot') {
    if (!state.deal) state.deal = emptyDeal(game);
    return tarotFormHtml(game);
  }
  const editing = state.editingRoundId ? game.rounds.find((r) => r.id === state.editingRoundId) : null;
  const index = editing ? game.rounds.indexOf(editing) + 1 : game.rounds.length + 1;

  const rows = game.players
    .map((player) => {
      const value = editing && Number.isFinite(editing.scores[player.id]) ? editing.scores[player.id] : '';
      const counter = preset?.helper
        ? `<button type="button" class="button button--small counter-button"
                   data-helper="${escapeHtml(player.id)}" title="${escapeHtml(t('helper.open'))}"
                   aria-label="${escapeHtml(t('helper.title', { name: player.name }))}">🂠</button>`
        : '';
      return `
        <div class="score-row ${preset?.helper ? 'score-row--counter' : ''}">
          <label class="score-row__name" for="score-${escapeHtml(player.id)}">${escapeHtml(player.name)}</label>
          ${counter}
          <input type="number" step="1" inputmode="numeric" id="score-${escapeHtml(player.id)}"
                 data-score="${escapeHtml(player.id)}" value="${value}" />
        </div>`;
    })
    .join('');

  const metaField = preset?.meta
    ? `<label>
         ${escapeHtml(t(preset.meta.labelKey))}
         <select id="round-meta">
           <option value="">${escapeHtml(t('meta.none'))}</option>
           ${preset.meta.options
             .map(
               (option) =>
                 `<option value="${escapeHtml(option.value)}" ${editing?.meta === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
             )
             .join('')}
         </select>
       </label>`
    : '';

  const dealer = getPreset(game.presetId)?.group === 'cards' ? dealerFor(game, index - 1) : null;

  return `
    <form id="round-form" class="card stack">
      <h2>${escapeHtml(editing ? t('game.editRound', { n: index }) : t('game.newRound', { n: index }))}</h2>
      ${dealer ? `<p class="muted small">${escapeHtml(t('game.dealer', { name: dealer.name }))}</p>` : ''}
      <div class="score-rows">${rows}</div>
      <p class="banner banner--warn" id="round-issues" hidden></p>
      <div class="sum-line">
        <span id="sum-line"></span>
        <button type="button" class="button button--small" id="complete" hidden>${escapeHtml(t('action.complete'))}</button>
      </div>
      ${metaField}
      <label>
        ${escapeHtml(t('game.note'))}
        <input type="text" id="round-note" value="${escapeHtml(editing?.note || '')}" />
      </label>
      <div class="row">
        <button type="submit" class="button button--primary">
          ${escapeHtml(editing ? t('action.saveRound') : t('action.addRound'))}
        </button>
        ${
          editing
            ? `<button type="button" class="button" id="cancel-edit">${escapeHtml(t('action.cancel'))}</button>
               <button type="button" class="button button--danger" id="delete-round">${escapeHtml(t('action.deleteRound'))}</button>`
            : ''
        }
      </div>
    </form>`;
}

function scoreTableHtml(game) {
  const preset = getPreset(game.presetId);
  const totalsById = totals(game);
  const metaLabel = preset?.meta ? t(preset.meta.labelKey) : null;
  const metaText = (round) =>
    preset?.meta ? preset.meta.options.find((o) => o.value === round.meta)?.label || '' : '';

  return `
    <div class="table-wrap">
      <table class="scores">
        <thead>
          <tr>
            <th>${escapeHtml(t('game.round'))}</th>
            ${game.players.map((player) => `<th>${escapeHtml(player.name)}</th>`).join('')}
            ${metaLabel ? `<th>${escapeHtml(metaLabel)}</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${game.rounds
            .map(
              (round, index) => `
              <tr class="round-edit" data-edit-round="${escapeHtml(round.id)}" tabindex="0"
                  title="${escapeHtml(t('action.edit'))}">
                <td>${index + 1}${round.note ? ` <span class="muted small">· ${escapeHtml(round.note)}</span>` : ''}</td>
                ${game.players
                  .map((player) => `<td>${roundScore(round, player.id)}</td>`)
                  .join('')}
                ${metaLabel ? `<td class="meta-cell">${escapeHtml(metaText(round))}</td>` : ''}
              </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td>${escapeHtml(t('game.total'))}</td>
            ${game.players.map((player) => `<td>${totalsById[player.id]}</td>`).join('')}
            ${metaLabel ? '<td></td>' : ''}
          </tr>
        </tfoot>
      </table>
    </div>`;
}

export function gameView(game) {
  const status = gameStatus(game);
  const preset = getPreset(game.presetId);

  const winnerBanner = status.finished && status.winners.length
    ? `<p class="banner banner--win">
         <strong>${escapeHtml(t(status.winners.length > 1 ? 'home.winners' : 'home.winner', {
           name: status.winners.map((row) => row.name).join(', '),
         }))}</strong>
       </p>`
    : '';

  let remainingText = '';
  if (!status.finished && Number.isFinite(status.remaining)) {
    remainingText = game.config.endMode === 'threshold'
      ? t('game.remainingThreshold', { count: status.remaining })
      : t('game.remainingRounds', { count: status.remaining });
  }

  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(gameTitle(game))}</h1>
        <p class="muted small">${escapeHtml(preset ? presetLabel(preset) : '')} · ${escapeHtml(t('home.rounds', { count: game.rounds.length }))}</p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/games" data-back>${escapeHtml(t('action.back'))}</button>
    </div>

    ${inGroupHtml(game)}

    ${state.remote ? shareBarHtml(`<button type="button" class="button button--primary" id="share">${escapeHtml(t('action.share'))}</button>`) : ''}

    ${winnerBanner}

    <section class="section card">
      <div class="section__head">
        <h2>${escapeHtml(t('game.standings'))}</h2>
        ${remainingText ? `<span class="muted small">${escapeHtml(remainingText)}</span>` : ''}
      </div>
      <div class="standings">
        ${status.standings
          .map(
            (row) => `
            <div class="standing ${row.rank === 1 ? 'standing--leader' : ''}">
              <span class="standing__rank">${row.rank}</span>
              <span class="standing__name">${escapeHtml(row.name)}</span>
              <span>
                <span class="standing__total">${row.total}</span>
                ${row.gap ? `<span class="standing__gap"> ${escapeHtml(t('game.gap', { gap: row.gap }))}</span>` : ''}
              </span>
            </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('game.perRound'))}</h2></div>
      ${game.rounds.length ? scoreTableHtml(game) : `<p class="muted small">${escapeHtml(t('game.noRounds'))}</p>`}
    </section>

    ${roundFormHtml(game)}

    ${actionsHtml(`
        ${
          game.rounds.length
            ? `<button type="button" class="button button--small" id="undo">${escapeHtml(t('action.undo'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="recap">${escapeHtml(t('action.recap'))}</button>
        ${
          EXPORT_MODE === 'download'
            ? `<button type="button" class="button button--small" id="export-docx">${escapeHtml(t('action.exportDocx'))}</button>
               <button type="button" class="button button--small" id="export-pdf">${escapeHtml(t('action.exportPdf'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="replay">${escapeHtml(t('action.replay'))}</button>
        <button type="button" class="button button--small" id="toggle-finish">
          ${escapeHtml(game.finishedAt ? t('action.reopen') : t('action.finish'))}
        </button>`, `
        <button type="button" class="button button--small button--ghost" id="rename">${escapeHtml(t('action.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="game-archive">
          ${escapeHtml(game.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--danger" id="delete-game">${escapeHtml(t('action.delete'))}</button>`)}

    ${preset ? `<p class="notes">${escapeHtml(t(preset.notesKey))}</p>` : ''}`;
}

/* ----------------------------------------------------------- interactions --- */

function readScores(game) {
  const scores = {};
  for (const player of game.players) {
    const input = view.querySelector(`[data-score="${player.id}"]`);
    scores[player.id] = parseScore(input?.value);
  }
  return scores;
}

function refreshSumLine(game) {
  const line = view.querySelector('#sum-line');
  const completeButton = view.querySelector('#complete');
  if (!line) return;

  const scores = readScores(game);
  const entered = Object.values(scores).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  const expected = game.config.roundSum;

  if (Number.isFinite(expected)) {
    line.textContent = t('game.sumExpected', { sum: entered, expected });
    const complete = game.players.every((player) => Number.isFinite(scores[player.id]));
    line.parentElement.classList.toggle('sum-line--ok', complete && entered === expected);
    line.parentElement.classList.toggle('sum-line--off', complete && entered !== expected);
  } else {
    line.textContent = t('game.sum', { sum: entered });
  }

  if (completeButton) {
    const suggestion = completingScore(game, scores);
    completeButton.hidden = !suggestion;
    completeButton.dataset.playerId = suggestion?.playerId || '';
    completeButton.dataset.value = suggestion ? String(suggestion.value) : '';
  }
}

function describeIssue(issue) {
  if (issue.code === 'missing') return t('warn.missing', { players: issue.players.join(', ') });
  if (issue.code === 'sum') return t('warn.sum', { sum: issue.sum, expected: issue.expected });
  return t(`error.${issue.code}`, { player: issue.player });
}

/**
 * A dialog made for one use. It takes itself off the page when it closes —
 * including when Escape closes it, which is the case that otherwise leaves
 * orphans behind: duplicate ids, and radio buttons quietly sharing a group
 * with the dialog opened before them.
 */
export function makeDialog(className = 'dialog') {
  const dialog = document.createElement('dialog');
  dialog.className = className;
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  return dialog;
}

/**
 * Ask a yes/no question.
 *
 * Not the browser's own confirm dialog: a sandboxed page — the app embedded
 * in another site — is refused browser modals, and the call then returns
 * false without ever asking, so every action behind one silently does
 * nothing. A `<dialog>` is ordinary DOM and works everywhere.
 */
export function ask(message, { confirmLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <p class="ask-message"></p>
        <div class="row">
          <button type="button" class="button ${danger ? 'button--danger' : 'button--primary'}"
                  data-answer="yes"></button>
          <button type="button" class="button" data-answer="no"></button>
        </div>
      </div>`;
    dialog.querySelector('.ask-message').textContent = message;
    dialog.querySelector('[data-answer="yes"]').textContent = confirmLabel || t('action.save');
    dialog.querySelector('[data-answer="no"]').textContent = t('action.cancel');

    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      resolve(answer);
      dialog.close();
    };

    dialog.querySelector('[data-answer="yes"]').addEventListener('click', () => finish(true));
    dialog.querySelector('[data-answer="no"]').addEventListener('click', () => finish(false));
    // Escape, or a close from anywhere else, means no.
    dialog.addEventListener('close', () => finish(false));

    dialog.showModal();
    dialog.querySelector('[data-answer="no"]').focus();
  });
}

async function submitRound(game) {
  const scores = readScores(game);
  const result = validateRound(game, scores);

  const issues = view.querySelector('#round-issues');
  if (!result.ok) {
    // Report in place: re-rendering here would throw away the typed scores.
    if (issues) {
      issues.textContent = result.errors.map(describeIssue).join(' ');
      issues.hidden = false;
    }
    return;
  }
  if (issues) issues.hidden = true;
  if (result.warnings.length) {
    const message = `${result.warnings.map(describeIssue).join('\n')}\n\n${t('game.confirmWarnings')}`;
    const accepted = await ask(message, { confirmLabel: t('action.save') });
    if (!accepted) return;
  }

  const meta = view.querySelector('#round-meta')?.value || null;
  const note = view.querySelector('#round-note')?.value.trim() || '';

  const next = state.editingRoundId
    ? updateRound(game, state.editingRoundId, { scores, meta, note })
    : addRound(game, { scores, meta, note });

  state.editingRoundId = null;
  replaceGame(next);
  render();
}

/**
 * Some hosts (a sandboxed page, for instance) silently ignore a download a
 * page starts by itself. Where that is the case the build sets
 * MARQUE_POINTS_EXPORT_MODE = 'copy' and the data is shown to be copied
 * instead, so the button never looks like it did nothing.
 */
const EXPORT_MODE = globalThis.MARQUE_POINTS_EXPORT_MODE === 'copy' ? 'copy' : 'download';

export function exportGames() {
  const json = JSON.stringify(
    {
      version: 1,
      games: state.games,
      lists: state.lists,
      polls: state.polls,
      spends: state.spends,
      boards: state.boards,
      // The organiser's secrets, for the polls in this file: they live on this
      // device alone, and a phone replaced, or Safari clearing the app after
      // a few weeks unopened, would leave those polls with no one to set
      // their date or close them. Group keys stay out, as always.
      organiser: heldOrganiserSecrets(),
    },
    null,
    2,
  );
  if (EXPORT_MODE === 'copy') {
    showExportDialog(json);
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `marque-points-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function showExportDialog(json) {
  showCopyDialog({ title: t('export.title'), hint: t('export.hint'), text: json });
}

/**
 * A QR code sized to whole pixels per module: a fractional size blurs the
 * edges and readers give up — something a reference encoder does too.
 */
function qrFor(text) {
  const modules = qrMatrix(text);
  if (!modules) return null;
  const side = modules.length + 8;
  const scale = Math.max(4, Math.floor(260 / side));
  return qrSvg(text, { size: side * scale });
}

export function showCopyDialog({
  title,
  hint,
  text: content,
  qr = false,
  // The QR carries the link, while the box shows the whole message: a QR of a
  // twelve-line message is unreadable, and a link is what a camera is for.
  qrText = null,
  code = null,
  send = false,
  // A lot's code is a second secret, to be sent by another route; an
  // invitation's is already inside the link, and saying otherwise would be
  // advice nobody can follow.
  codeLabel = 'shareSet.codeLabel',
  codeHint = 'shareSet.codeApart',
}) {
  let dialog = document.getElementById('export-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'export-dialog';
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="stack">
        <h2 id="export-title"></h2>
        <p class="muted small" id="export-hint"></p>
        <div class="code-box" id="export-code" hidden>
          <span class="code-box__label" id="export-code-label"></span>
          <strong class="code-box__value" id="export-code-value"></strong>
          <span class="muted small" id="export-code-hint"></span>
        </div>
        <div id="export-qr" class="qr" hidden></div>
        <textarea id="export-text" readonly rows="12"></textarea>
        <div class="row">
          <button type="button" class="button button--primary" id="export-copy"></button>
          <button type="button" class="button" id="export-send" hidden></button>
          <button type="button" class="button" id="export-close"></button>
        </div>
      </div>`;
    document.body.append(dialog);

    dialog.querySelector('#export-close').addEventListener('click', () => dialog.close());
    // Sending hands over the link. For a lot that is the whole point — its
    // code travels by another route — and for an invitation the code is in
    // the link already, on purpose.
    dialog.querySelector('#export-send').addEventListener('click', async () => {
      const url = dialog.querySelector('#export-text').value;
      try {
        await navigator.share({ title: t('app.title'), text: t('shareSet.text'), url });
      } catch {
        // Cancelled, or refused: the text and its code are still on screen.
      }
    });
    dialog.querySelector('#export-copy').addEventListener('click', async (event) => {
      // Hold on to the button: currentTarget is null once the handler awaits.
      const button = event.currentTarget;
      const text = dialog.querySelector('#export-text');
      text.select();

      // Where the clipboard is blocked the promise can also simply never
      // settle, so the button answers on its own after a moment rather than
      // looking dead. The text is selected either way.
      const copied = await Promise.race([
        Promise.resolve(navigator.clipboard?.writeText(text.value)).then(() => true, () => false),
        new Promise((done) => setTimeout(() => done(false), 600)),
      ]);
      button.textContent = copied ? t('export.copied') : t('export.copyByHand');
    });
  }

  dialog.querySelector('#export-title').textContent = title;
  dialog.querySelector('#export-hint').textContent = hint;
  const text = dialog.querySelector('#export-text');
  text.value = content;
  text.setAttribute('aria-label', title);

  const image = dialog.querySelector('#export-qr');
  const svg = qr ? qrFor(qrText || content) : null;
  image.innerHTML = svg || '';
  image.hidden = !svg;
  if (svg) image.setAttribute('aria-label', t('share.qrLabel'));
  const box = dialog.querySelector('#export-code');
  box.hidden = !code;
  if (code) {
    dialog.querySelector('#export-code-label').textContent = t(codeLabel);
    dialog.querySelector('#export-code-value').textContent = code;
    dialog.querySelector('#export-code-hint').textContent = t(codeHint);
  }

  const sendButton = dialog.querySelector('#export-send');
  sendButton.hidden = !(send && navigator.share);
  sendButton.textContent = t('shareSet.send');

  dialog.querySelector('#export-copy').textContent = t('action.copy');
  dialog.querySelector('#export-close').textContent = t('action.close');
  dialog.showModal();
  // After opening, not before: opening the dialog puts the caret at the end of
  // the box, and a message longer than it then starts on its last line — which
  // reads as if the beginning were missing.
  text.scrollTop = 0;
}

/**
 * Take in an export, from wherever it came. Games already here are left
 * alone — importing twice must not double everything.
 */
export function importGames(source) {
  let parsed = null;
  try {
    parsed = JSON.parse(source);
  } catch {
    flash(t('home.importFailed'), 'error');
    return false;
  }

  const all = Array.isArray(parsed)
    ? parsed
    : [
        ...(parsed?.games || []), ...(parsed?.lists || []), ...(parsed?.polls || []), ...(parsed?.spends || []),
        ...(parsed?.boards || []),
      ];
  const games = all.filter(isValidGame);
  const lists = all.filter(isValidList);
  const polls = all.filter(isValidPoll);
  const spends = all.filter(isValidSpend);
  const boards = all.filter(isValidBoard);
  if (!games.length && !lists.length && !polls.length && !spends.length && !boards.length) {
    flash(t('home.importFailed'), 'error');
    return false;
  }

  // First, so that what is sent below goes with its organiser — and for the
  // polls already here too: after a reinstall, the group brings the polls
  // back, but only a backup brings back the right to set them.
  const organising = restoreOrganiserSecrets(Array.isArray(parsed) ? null : parsed?.organiser);

  const knownGames = new Set(state.games.map((game) => game.id));
  const freshGames = games.filter((game) => !knownGames.has(game.id));
  state.games = [...state.games, ...freshGames];
  saveGames(state.games);

  const knownLists = new Set(state.lists.map((list) => list.id));
  const freshLists = lists.filter((list) => !knownLists.has(list.id));
  state.lists = [...state.lists, ...freshLists];
  saveLists(state.lists);

  const knownPolls = new Set(state.polls.map((poll) => poll.id));
  const freshPolls = polls.filter((poll) => !knownPolls.has(poll.id));
  state.polls = [...state.polls, ...freshPolls];
  savePolls(state.polls);

  const knownSpends = new Set(state.spends.map((spend) => spend.id));
  const freshSpends = spends.filter((spend) => !knownSpends.has(spend.id));
  state.spends = [...state.spends, ...freshSpends];
  saveSpends(state.spends);

  const knownBoards = new Set(state.boards.map((board) => board.id));
  const freshBoards = boards.filter((board) => !knownBoards.has(board.id));
  state.boards = [...state.boards, ...freshBoards];
  saveBoards(state.boards);

  for (const document_ of [...freshGames, ...freshLists, ...freshPolls, ...freshSpends, ...freshBoards]) {
    if (state.store) void state.store.save(document_);
    if (state.remote && document_.shared) {
      // A backup older than a deletion must not bring the thing back for everyone.
      state.remote.put(document_, keyFor(document_), organiserSecret(document_.id))
        .catch((error) => wasDeleted(error) && dropDeleted(document_.id));
    }
  }
  const count = freshGames.length + freshLists.length + freshPolls.length + freshSpends.length + freshBoards.length;
  flash(organising
    ? t('home.importOrganiser', { count, polls: organising })
    : t('home.importDone', { count }));
  return true;
}

/**
 * Paste an export in. A phone cannot easily hand a file to a web page, and an
 * app installed on the home screen keeps its own storage — so this is how
 * games move from one to the other.
 */
export function openPasteDialog() {
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('paste.title'))}</h2>
      <p class="muted small">${escapeHtml(t('paste.hint'))}</p>
      <textarea id="paste-text" rows="8" aria-label="${escapeHtml(t('paste.title'))}"></textarea>
      <p class="banner banner--warn" id="paste-error" hidden></p>
      <div class="row">
        <button type="button" class="button button--primary" id="paste-import">${escapeHtml(t('action.import'))}</button>
        <button type="button" class="button" id="paste-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </div>`;

  const close = () => dialog.close();
  dialog.querySelector('#paste-cancel').addEventListener('click', close);
  dialog.querySelector('#paste-import').addEventListener('click', () => {
    const value = dialog.querySelector('#paste-text').value.trim();
    if (!value) return;
    if (!importGames(value)) {
      const error = dialog.querySelector('#paste-error');
      error.textContent = t('home.importFailed');
      error.hidden = false;
      return;
    }
    close();
    render();
  });

  dialog.showModal();
  dialog.querySelector('#paste-text').focus();
}

/**
 * Open a shared game from its link.
 *
 * The database can only be asked for a game by its exact id — that is what
 * keeps anyone from listing someone else's games, and it means a game already
 * in the database still has to be *named* to be found. On a phone there is no
 * other way in: tapping a link opens the browser, never the installed app,
 * which has no address bar of its own.
 */
export function openLinkDialog() {
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('openLink.title'))}</h2>
      <p class="muted small">${escapeHtml(t('openLink.hint'))}</p>
      <textarea id="link-text" rows="3" aria-label="${escapeHtml(t('openLink.title'))}"></textarea>
      <p class="banner banner--warn" id="link-error" hidden></p>
      <div class="row">
        <button type="button" class="button button--primary" id="link-open">${escapeHtml(t('openLink.open'))}</button>
        <button type="button" class="button" id="link-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </div>`;

  const close = () => dialog.close();
  const fail = (message) => {
    const error = dialog.querySelector('#link-error');
    error.textContent = message;
    error.hidden = false;
    dialog.querySelector('#link-open').disabled = false;
    dialog.querySelector('#link-open').textContent = t('openLink.open');
  };

  dialog.querySelector('#link-cancel').addEventListener('click', close);
  dialog.querySelector('#link-open').addEventListener('click', async (event) => {
    const pasted = dialog.querySelector('#link-text').value;

    // A link to a whole set of games is pasted here too: on a phone the
    // installed app has no address bar, so this is the only way in.
    // An invitation pasted rather than tapped: the same screen, prefilled.
    const invitation = joinFrom(pasted);
    if (invitation) {
      close();
      navigate(`#/join/${invitation.code}/${encodeURIComponent(invitation.name)}`);
      return;
    }

    const setId = setIdFrom(pasted);
    if (setId) {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = t('share.sending');
      await openSet(setId);
      close();
      navigate('#/');
      return;
    }

    const listId = listIdFrom(pasted);
    if (listId) {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = t('share.sending');
      if (!getList(listId) && !(await pullList(listId))) return fail(t('openLink.notFound'));
      close();
      navigate(`#/list/${listId}`);
      return;
    }

    const pollId = pollIdFrom(pasted);
    if (pollId) {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = t('share.sending');
      if (!getPoll(pollId) && !(await pullPoll(pollId))) return fail(t('openLink.notFound'));
      close();
      navigate(`#/poll/${pollId}`);
      return;
    }

    const id = gameIdFrom(pasted);
    if (!id) return fail(t('openLink.noId'));

    event.currentTarget.disabled = true;
    event.currentTarget.textContent = t('share.sending');

    if (getGame(id)) {
      close();
      navigate(`#/game/${id}`);
      return;
    }
    // A bare identifier says nothing about what it stands for.
    if (await pullGame(id)) {
      close();
      navigate(`#/game/${id}`);
      return;
    }
    if (await pullList(id)) {
      close();
      navigate(`#/list/${id}`);
      return;
    }
    if (await pullPoll(id)) {
      close();
      navigate(`#/poll/${id}`);
      return;
    }
    return fail(t('openLink.notFound'));
  });

  dialog.showModal();
  dialog.querySelector('#link-text').focus();
}

/**
 * Hand a link over the easy way when the device offers one — one tap to a
 * message — and fall back to the text with its QR code everywhere else.
 */
/**
 * Hand over a whole message rather than a bare link.
 *
 * An invitation is not a link with a sentence around it: it is a name, a code,
 * a link and how to install the app, and all four have to survive the trip.
 * The message already carries the link, so it goes alone: handed `url` as
 * well, iOS and Android add the link a second time under the text. Where
 * navigator.share is absent, the message is on screen in one block, ready to
 * copy.
 */
export async function shareMessage({ title, hint, message, url, code = null }) {
  if (navigator.share) {
    try {
      await navigator.share({ title: t('app.title'), text: message.includes(url) ? message : `${message}\n${url}` });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  // The six digits stay in their own box, big, above the message: they are
  // what gets read out over the phone when the link will not go through.
  showCopyDialog({
    title,
    hint,
    text: message,
    qr: true,
    qrText: url,
    code,
    codeLabel: 'groups.codeLabel',
    codeHint: 'groups.codeInLink',
  });
}

export async function shareUrl({ url, title, hint, text, code = null, codeLabel, codeHint }) {
  if (navigator.share) {
    try {
      await navigator.share({ title: t('app.title'), text, url });
      return;
    } catch (error) {
      // Cancelling is not a failure, and nothing should be shown for it.
      if (error?.name === 'AbortError') return;
      // Anything else: fall through to the text everyone can copy.
    }
  }
  showCopyDialog({ title, hint, text: url, qr: true, code, codeLabel, codeHint });
}

/* ------------------------------------------------------- games: behaviour --- */

export function bindNewGame() {
  const form = view.querySelector('#new-game');
  if (!form) return;

  const snapshotNames = () => {
    view.querySelectorAll('[data-name-index]').forEach((input) => {
      state.newGameNames[Number(input.dataset.nameIndex)] = input.value;
    });
  };

  // Typing in a name is what counts as touching the form — not switching preset,
  // which merely keeps what is there.
  view.querySelectorAll('[data-name-index]').forEach((input) => {
    input.addEventListener('input', () => {
      state.newGameTouched = true;
    });
  });

  const readConfigFromForm = () => ({
    direction: view.querySelector('#direction').value,
    endMode: view.querySelector('#end-mode').value,
    // A field that the current end mode hides keeps its previous value, so
    // switching modes back and forth does not lose what was typed.
    target: view.querySelector('#target')
      ? parseIntOrNull(view.querySelector('#target').value)
      : state.newConfig?.target ?? null,
    rounds: view.querySelector('#rounds')
      ? parseIntOrNull(view.querySelector('#rounds').value)
      : state.newConfig?.rounds ?? null,
    roundSum: parseIntOrNull(view.querySelector('#round-sum')?.value),
    allowNegative: view.querySelector('#allow-negative').checked,
    entrantLabel: getPreset(view.querySelector('#preset').value)?.entrantLabel || 'player',
  });

  view.querySelector('#preset').addEventListener('change', (event) => {
    snapshotNames();
    const preset = getPreset(event.target.value);
    state.newPresetId = preset.id;
    state.newConfig = presetConfig(preset);
    state.newGameNames = state.newGameNames.slice(0, preset.players[1]);
    render();
  });

  // Only the end mode changes which fields exist, so it is the only rule field
  // worth re-rendering for — re-rendering on every keystroke elsewhere would
  // steal the focus mid-typing. The others are read straight from the DOM when
  // the form is submitted.
  view.querySelector('#end-mode')?.addEventListener('change', () => {
    snapshotNames();
    state.newName = view.querySelector('#game-name').value;
    state.newConfig = readConfigFromForm();
    render();
    view.querySelector('#end-mode')?.focus();
  });

  view.querySelector('#add-name')?.addEventListener('click', () => {
    snapshotNames();
    state.newName = view.querySelector('#game-name').value;
    state.newConfig = readConfigFromForm();
    state.newGameNames.push('');
    render();
  });

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshotNames();
      state.newName = view.querySelector('#game-name').value;
      state.newConfig = readConfigFromForm();
      state.newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  view.querySelectorAll('[data-remove-name]').forEach((button) => {
    button.addEventListener('click', () => {
      snapshotNames();
      state.newName = view.querySelector('#game-name').value;
      state.newConfig = readConfigFromForm();
      state.newGameNames.splice(Number(button.dataset.removeName), 1);
      render();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    snapshotNames();
    const presetId = state.newPresetId || PRESETS[0].id;
    const preset = getPreset(presetId);
    const config = readConfigFromForm();
    const [min, max] = preset.players;
    const names = state.newGameNames
      .slice(0, max)
      .map((name, index) => (name || '').trim() || t(config.entrantLabel === 'team' ? 'new.teamName' : 'new.playerName', { n: index + 1 }));

    if (names.length < min || names.length > max) {
      flash(t('new.errorPlayers', { min, max, label: t(config.entrantLabel === 'team' ? 'new.teams' : 'new.players').toLowerCase() }), 'error');
      render();
      return;
    }
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      flash(t('new.errorNames'), 'error');
      render();
      return;
    }

    const game = landing(createGame({
      presetId,
      names,
      overrides: config,
      name: view.querySelector('#game-name').value,
    }));
    state.games = [...state.games, game];
    persist(game);
    resetGroupChoice();

    state.newGameNames = ['', '', ''];
    state.newGameTouched = false;
    state.newPresetId = null;
    state.newConfig = null;
    state.newName = '';
    navigate(`#/game/${game.id}`);
  });
}

/** What the open card counter holds, while it is open. */
let counterEntry = emptyHelperEntry();

function emptyDeal(game) {
  return {
    takerId: game.players[0]?.id || null,
    partnerId: null,
    contract: 'garde',
    oudlers: 1,
    points: null,
    petitAuBout: 'none',
    poignee: 'none',
    chelem: 'none',
  };
}

/** The Tarot entry screen: a deal is described, not a row of scores typed. */
function tarotFormHtml(game) {
  const editing = state.editingRoundId
    ? game.rounds.find((round) => round.id === state.editingRoundId)
    : null;
  const index = editing ? game.rounds.indexOf(editing) + 1 : game.rounds.length + 1;
  const threshold = THRESHOLDS[state.deal.oudlers];
  const complete = isCompleteDeal(game.players, state.deal);
  const result = complete ? scoreDeal(game.players, state.deal) : null;

  const options = (items, selected, label) =>
    items.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join('');

  const playerOptions = (selected, extra = '') =>
    extra + game.players
      .map((player) => `<option value="${escapeHtml(player.id)}" ${player.id === selected ? 'selected' : ''}>${escapeHtml(player.name)}</option>`)
      .join('');

  return `
    <form id="round-form" class="card stack">
      <h2>${escapeHtml(editing ? t('game.editRound', { n: index }) : t('game.newRound', { n: index }))}</h2>

      <div class="field-grid">
        <label>${escapeHtml(t('tarot.taker'))}
          <select id="deal-taker">${playerOptions(state.deal.takerId)}</select>
        </label>
        ${
          game.players.length === 5
            ? `<label>${escapeHtml(t('tarot.partner'))}
                 <select id="deal-partner">
                   <option value="">${escapeHtml(t('tarot.alone'))}</option>
                   ${playerOptions(state.deal.partnerId)}
                 </select>
               </label>`
            : ''
        }
        <label>${escapeHtml(t('tarot.contract'))}
          <select id="deal-contract">${options(CONTRACTS, state.deal.contract, (c) => `${t(`tarot.${c.id}`)} ×${c.multiplier}`)}</select>
        </label>
        <label>${escapeHtml(t('tarot.oudlers'))}
          <select id="deal-oudlers">
            ${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === state.deal.oudlers ? 'selected' : ''}>${n} — ${THRESHOLDS[n]} ${escapeHtml(t('tarot.pointsNeeded'))}</option>`).join('')}
          </select>
        </label>
        <label>${escapeHtml(t('tarot.points', { max: TOTAL_POINTS }))}
          <input type="number" id="deal-points" inputmode="numeric" step="1" min="0" max="${TOTAL_POINTS}"
                 value="${Number.isFinite(state.deal.points) ? state.deal.points : ''}" />
        </label>
        <label>${escapeHtml(t('tarot.petitAuBout'))}
          <select id="deal-petit">
            ${['none', 'taker', 'defence'].map((id) => `<option value="${id}" ${id === state.deal.petitAuBout ? 'selected' : ''}>${escapeHtml(t(`tarot.petit.${id}`))}</option>`).join('')}
          </select>
        </label>
        <label>${escapeHtml(t('tarot.poignee'))}
          <select id="deal-poignee">${options(POIGNEES, state.deal.poignee, (p) => `${t(`tarot.poignee.${p.id}`)}${p.value ? ` (+${p.value})` : ''}`)}</select>
        </label>
        <label>${escapeHtml(t('tarot.chelem'))}
          <select id="deal-chelem">${options(CHELEMS, state.deal.chelem, (c) => t(`tarot.chelem.${c.id}`))}</select>
        </label>
      </div>

      ${
        result
          ? `<div class="deal-result ${result.won ? 'deal-result--won' : 'deal-result--lost'}">
               <strong>${escapeHtml(t(result.won ? 'tarot.made' : 'tarot.failed', {
                 gap: Math.abs(result.gap),
               }))}</strong>
               <span class="small">${escapeHtml(t('tarot.sum', {
                 base: 25,
                 gap: Math.abs(result.gap),
                 petit: result.breakdown.petit ? (result.breakdown.petit > 0 ? ` + 10` : ` − 10`) : '',
                 multiplier: result.multiplier,
                 extra: [
                   result.breakdown.poignee ? `${result.breakdown.poignee > 0 ? '+' : '−'} ${Math.abs(result.breakdown.poignee)}` : '',
                   result.breakdown.chelem ? `${result.breakdown.chelem > 0 ? '+' : '−'} ${Math.abs(result.breakdown.chelem)}` : '',
                 ].filter(Boolean).map((piece) => ` ${piece}`).join(''),
                 amount: result.amount,
               }))}</span>
               <div class="deal-scores">
                 ${game.players.map((player) => `<span><b>${escapeHtml(player.name)}</b> ${result.scores[player.id] > 0 ? '+' : ''}${result.scores[player.id]}</span>`).join('')}
               </div>
             </div>`
          : `<p class="muted small">${escapeHtml(t('tarot.needPoints'))}</p>`
      }

      <label>${escapeHtml(t('game.note'))}
        <input type="text" id="round-note" value="${escapeHtml(editing?.note || '')}" />
      </label>

      <div class="row">
        <button type="submit" class="button button--primary" ${complete ? '' : 'disabled'}>
          ${escapeHtml(editing ? t('action.saveRound') : t('action.addRound'))}
        </button>
        ${
          editing
            ? `<button type="button" class="button" id="cancel-edit">${escapeHtml(t('action.cancel'))}</button>
               <button type="button" class="button button--danger" id="delete-round">${escapeHtml(t('action.deleteRound'))}</button>`
            : ''
        }
      </div>
    </form>`;
}

function renderCounter(helper, player) {
  const dialog = document.getElementById('counter-dialog');
  const total = helperTotal(helper, counterEntry);

  dialog.querySelector('#counter-title').textContent = t('helper.title', { name: player.name });
  dialog.querySelector('#counter-total').textContent = t('helper.total', { total });
  dialog.querySelector('#counter-count').textContent = t('helper.cards', {
    count: counterEntry.cards.length,
  });

  dialog.querySelector('#counter-values').innerHTML = helper.values
    .map((value) => {
      const count = cardCount(counterEntry, value);
      const label = helper.labels?.[value] ?? value;
      return `
        <button type="button" class="card-button ${count ? 'card-button--picked' : ''}"
                data-card="${value}">
          <span>${escapeHtml(String(label))}</span>
          ${count > 1 ? `<small>×${count}</small>` : ''}
        </button>`;
    })
    .join('');

  dialog.querySelector('#counter-toggles').innerHTML = (helper.toggles || [])
    .map(
      (item) => `
        <label class="checkbox">
          <input type="checkbox" data-switch="${escapeHtml(item.key)}"
                 ${counterEntry.toggles[item.key] ? 'checked' : ''} />
          ${escapeHtml(t(item.labelKey))}
        </label>`,
    )
    .join('');

  dialog.querySelector('#counter-undo').disabled = counterEntry.cards.length === 0;
  dialog.querySelector('#counter-apply').disabled = isEmptyEntry(counterEntry);
}

function openCounter(game, playerId) {
  const helper = getPreset(game.presetId)?.helper;
  const player = game.players.find((item) => item.id === playerId);
  if (!helper || !player) return;

  let dialog = document.getElementById('counter-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'counter-dialog';
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="stack">
        <h2 id="counter-title"></h2>
        <p class="muted small" id="counter-hint"></p>
        <div class="counter-readout">
          <strong id="counter-total"></strong>
          <span class="muted small" id="counter-count"></span>
        </div>
        <div class="card-grid" id="counter-values"></div>
        <div class="stack" id="counter-toggles"></div>
        <div class="row">
          <button type="button" class="button button--primary" id="counter-apply"></button>
          <button type="button" class="button button--small" id="counter-undo"></button>
          <button type="button" class="button button--small" id="counter-clear"></button>
          <button type="button" class="button button--small button--ghost" id="counter-close"></button>
        </div>
      </div>`;
    document.body.append(dialog);
  }

  // The listeners close over this round's game and player, so they are rebound
  // every time the counter opens.
  const fresh = dialog.cloneNode(true);
  dialog.replaceWith(fresh);
  dialog = fresh;

  counterEntry = emptyHelperEntry();

  dialog.querySelector('#counter-hint').textContent = helper.hintKey ? t(helper.hintKey) : '';
  dialog.querySelector('#counter-apply').textContent = t('helper.apply');
  dialog.querySelector('#counter-undo').textContent = t('helper.undo');
  dialog.querySelector('#counter-clear').textContent = t('helper.clear');
  dialog.querySelector('#counter-close').textContent = t('action.close');

  dialog.querySelector('#counter-values').addEventListener('click', (event) => {
    const button = event.target.closest('[data-card]');
    if (!button) return;
    counterEntry = tapCard(helper, counterEntry, Number(button.dataset.card));
    renderCounter(helper, player);
  });

  dialog.querySelector('#counter-toggles').addEventListener('change', (event) => {
    const box = event.target.closest('[data-switch]');
    if (!box) return;
    counterEntry = toggleSwitch(counterEntry, box.dataset.switch);
    renderCounter(helper, player);
  });

  dialog.querySelector('#counter-undo').addEventListener('click', () => {
    counterEntry = undoCard(counterEntry);
    renderCounter(helper, player);
  });

  dialog.querySelector('#counter-clear').addEventListener('click', () => {
    counterEntry = emptyHelperEntry();
    renderCounter(helper, player);
  });

  dialog.querySelector('#counter-close').addEventListener('click', () => dialog.close());

  dialog.querySelector('#counter-apply').addEventListener('click', () => {
    const input = view.querySelector(`[data-score="${player.id}"]`);
    if (input) input.value = String(helperTotal(helper, counterEntry));
    dialog.close();
    refreshSumLine(game);
  });

  renderCounter(helper, player);
  dialog.showModal();
}

/** Read the Tarot form back into the deal, and redraw its result. */
function bindTarot(game) {
  const fields = {
    '#deal-taker': (v) => { state.deal.takerId = v; },
    '#deal-partner': (v) => { state.deal.partnerId = v || null; },
    '#deal-contract': (v) => { state.deal.contract = v; },
    '#deal-oudlers': (v) => { state.deal.oudlers = Number(v); },
    '#deal-points': (v) => { state.deal.points = v === '' ? null : Number(v); },
    '#deal-petit': (v) => { state.deal.petitAuBout = v; },
    '#deal-poignee': (v) => { state.deal.poignee = v; },
    '#deal-chelem': (v) => { state.deal.chelem = v; },
  };

  for (const [selector, apply] of Object.entries(fields)) {
    const field = view.querySelector(selector);
    field?.addEventListener('input', (event) => {
      apply(event.target.value);
      // Only the result panel changes, so the form is redrawn in place and
      // the field being typed into keeps the focus.
      const active = document.activeElement?.id;
      const caret = document.activeElement?.selectionStart ?? null;
      render();
      const again = active ? view.querySelector(`#${active}`) : null;
      if (again) {
        again.focus();
        if (caret !== null && again.setSelectionRange) {
          try { again.setSelectionRange(caret, caret); } catch { /* not a text field */ }
        }
      }
    });
  }
}

function submitDeal(game) {
  if (!isCompleteDeal(game.players, state.deal)) return;
  const { scores } = scoreDeal(game.players, state.deal);
  const note = view.querySelector('#round-note')?.value.trim() || '';
  const meta = JSON.stringify(state.deal);

  const next = state.editingRoundId
    ? updateRound(game, state.editingRoundId, { scores, meta, note })
    : addRound(game, { scores, meta, note });

  state.editingRoundId = null;
  state.deal = emptyDeal(game);
  replaceGame(next);
  render();
}

/** Hand the viewer a file. Where the page is not allowed to, nothing happens. */
export function download(filename, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** A safe-ish file name from any title: letters, digits, and what joins them. */
export function fileName(title) {
  const base = String(title || '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return base || 'together';
}

/** A safe-ish file name built from the game's own title. */
function fileNameFor(game, extension) {
  const base = `${gameTitle(game)} ${formatDate(game.updatedAt)}`
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base || 'marque-points'}.${extension}`;
}

/** Everything a results file needs, already translated. */
function reportFor(game) {
  const status = gameStatus(game);
  const preset = getPreset(game.presetId);
  return {
    title: gameTitle(game),
    subtitle: [
      preset ? presetLabel(preset) : '',
      formatDate(game.updatedAt),
      t('home.rounds', { count: game.rounds.length }),
    ].filter(Boolean).join(' · '),
    winner: status.finished && status.winners.length
      ? t(status.winners.length > 1 ? 'home.winners' : 'home.winner', {
          name: status.winners.map((row) => row.name).join(', '),
        })
      : '',
    standingsTitle: t('game.standings'),
    standingsHeader: [t('game.rank'), t('new.players'), t('game.total')],
    standings: status.standings.map((row) => [String(row.rank), row.name, String(row.total)]),
    roundsTitle: t('game.perRound'),
    roundsHeader: [t('game.round'), ...game.players.map((player) => player.name)],
    rounds: game.rounds.map((round, index) => [
      String(index + 1),
      ...game.players.map((player) => String(roundScore(round, player.id))),
    ]),
  };
}

/** Fix a mistyped name, mid-game, without touching a single score. */
function openRenameDialog(game) {
  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('rename.title'))}</h2>
      <p class="muted small">${escapeHtml(t('rename.hint'))}</p>
      <div class="stack">
        ${game.players
          .map(
            (player, index) => `
            <label>${escapeHtml(t(game.config.entrantLabel === 'team' ? 'new.teamName' : 'new.playerName', { n: index + 1 }))}
              <input type="text" data-rename="${escapeHtml(player.id)}" value="${escapeHtml(player.name)}" />
            </label>`,
          )
          .join('')}
      </div>
      <div class="row">
        <button type="button" class="button button--primary" id="rename-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="rename-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </form>`;

  const close = () => dialog.close();
  dialog.querySelector('#rename-cancel').addEventListener('click', close);
  dialog.querySelector('#rename-save').addEventListener('click', () => {
    let next = game;
    dialog.querySelectorAll('[data-rename]').forEach((input) => {
      next = renamePlayer(next, input.dataset.rename, input.value);
    });
    close();
    if (next !== game) {
      replaceGame(next);
      render();
    }
  });

  dialog.showModal();
}

export function bindGame(game) {
  const form = view.querySelector('#round-form');
  const preset = getPreset(game.presetId);

  if (preset?.calculator === 'tarot') {
    bindTarot(game);
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitDeal(game);
    });
  }

  if (preset?.calculator !== 'tarot') {
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitRound(game);
    });

    form?.addEventListener('input', () => refreshSumLine(game));
    refreshSumLine(game);
  }

  // Enter walks down the score inputs instead of submitting halfway through.
  const inputs = [...view.querySelectorAll('[data-score]')];
  inputs.forEach((input, index) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || index === inputs.length - 1) return;
      event.preventDefault();
      inputs[index + 1].focus();
    });
  });

  view.querySelectorAll('[data-helper]').forEach((button) => {
    button.addEventListener('click', () => openCounter(game, button.dataset.helper));
  });

  view.querySelector('#complete')?.addEventListener('click', (event) => {
    const { playerId, value } = event.currentTarget.dataset;
    const input = view.querySelector(`[data-score="${playerId}"]`);
    if (input) input.value = value;
    refreshSumLine(game);
  });

  view.querySelector('#cancel-edit')?.addEventListener('click', () => {
    state.editingRoundId = null;
    if (preset?.calculator === 'tarot') state.deal = emptyDeal(game);
    render();
  });

  view.querySelector('#delete-round')?.addEventListener('click', async () => {
    const roundId = state.editingRoundId;
    if (!(await ask(t('game.confirmDeleteRound'), { confirmLabel: t('action.delete'), danger: true }))) return;
    replaceGame(removeRound(game, roundId));
    state.editingRoundId = null;
    render();
  });

  const openRound = (roundId) => {
    state.editingRoundId = roundId;
    if (preset?.calculator === 'tarot') {
      const round = game.rounds.find((item) => item.id === roundId);
      try {
        const stored = JSON.parse(round?.meta || 'null');
        state.deal = stored && typeof stored === 'object' ? stored : emptyDeal(game);
      } catch {
        state.deal = emptyDeal(game);
      }
    }
    render();
    view.querySelector('#round-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  view.querySelectorAll('[data-edit-round]').forEach((row) => {
    row.addEventListener('click', () => openRound(row.dataset.editRound));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRound(row.dataset.editRound);
      }
    });
  });

  view.querySelector('#undo')?.addEventListener('click', async () => {
    const last = game.rounds[game.rounds.length - 1];
    if (!last) return;
    if (!(await ask(t('game.confirmDeleteRound'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.editingRoundId = null;
    replaceGame(removeRound(game, last.id));
    render();
  });

  view.querySelector('#share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let current = game;

    if (!current.shared) {
      // Send it before handing out a link to it, or the link opens nothing.
      button.disabled = true;
      button.textContent = t('share.sending');
      current = await startSharing(current);
      if (!current) return;
      replaceGame(current);
      // Redraw so every handler below works on the now-shared game: without
      // this, the round form still holds the copy captured before sharing,
      // and the next round would be saved as unshared and never sent.
      render();
    }

    showCopyDialog({
      title: t('share.title'),
      hint: t('share.hint'),
      text: shareLink(location, current.id),
      qr: true,
    });
  });

  view.querySelector('#recap')?.addEventListener('click', () => {
    showCopyDialog({
      title: t('results.recapTitle'),
      hint: t('results.recapHint'),
      text: recapText(game, t, { title: gameTitle(game), withRounds: true }),
    });
  });

  view.querySelector('#export-docx')?.addEventListener('click', () => {
    download(fileNameFor(game, 'docx'), buildDocx(reportFor(game)),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  view.querySelector('#export-pdf')?.addEventListener('click', () => {
    download(fileNameFor(game, 'pdf'), buildPdf(reportFor(game)), 'application/pdf');
  });

  view.querySelector('#game-archive')?.addEventListener('click', () => {
    const next = archiveGame(game, !game.archivedAt);
    flash(t(next.archivedAt ? 'archive.done' : 'archive.undone'));
    replaceGame(next);
    if (next.archivedAt) navigate('#/games');
    else render();
  });

  view.querySelector('#replay')?.addEventListener('click', () => {
    const next = replayGame(game);
    state.games = [...state.games, next];
    persist(next);
    navigate(`#/game/${next.id}`);
  });

  view.querySelector('#rename')?.addEventListener('click', () => openRenameDialog(game));

  view.querySelector('#toggle-finish')?.addEventListener('click', () => {
    replaceGame(setFinished(game, !game.finishedAt));
    render();
  });

  view.querySelector('#delete-game')?.addEventListener('click', async () => {
    if (!(await ask(t('game.confirmDeleteGame'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.games = state.games.filter((item) => item.id !== game.id);
    forget(game.id, game);
    navigate('#/games');
  });
}
