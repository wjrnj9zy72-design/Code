/** UI layer: hash router, views, event wiring. */

import { PRESETS, PRESET_GROUPS, getPreset, presetConfig } from './games.js';
import { createGame, addRound, updateRound, removeRound, renamePlayer, setFinished, setShared, isValidGame } from './model.js';
import { gameStatus, roundScore, totals, validateRound, completingScore } from './scoring.js';
import { emptyHelperEntry, tapCard, undoCard, toggleSwitch, cardCount, helperTotal, isEmptyEntry } from './helpers.js';
import { CONTRACTS, POIGNEES, CHELEMS, THRESHOLDS, TOTAL_POINTS, scoreDeal, isCompleteDeal } from './tarot.js';
import { loadGames, saveGames, loadPrefs, savePrefs } from './storage.js';
import { connectStore } from './cloud.js';
import { createRemote, pickNewer, shareLink } from './remote.js';
import { remoteConfig } from './config.js';
import { t, setLanguage, getLanguage, detectLanguage } from './i18n.js';

const view = document.getElementById('view');

const state = {
  games: loadGames(),
  prefs: loadPrefs(),
  flash: null, // { message, kind: 'info' | 'error' }
  editingRoundId: null,
  // New-game form draft, kept across re-renders of that view.
  newPresetId: null,
  newConfig: null,
  newName: '',
  // Set once the host's document store answers; null means this browser only.
  store: null,
  // The shared database, when this copy of the app is configured for one.
  remote: createRemote(remoteConfig()),
  // Polling while a shared game is on screen.
  poll: null,
};

/* ------------------------------------------------------------- utilities --- */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
  );
}

/** Read a score input: '' means "not filled in" (null), otherwise a number. */
function parseScore(raw) {
  const value = String(raw ?? '').trim().replace(',', '.');
  if (value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? NaN : number;
}

function parseIntOrNull(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function presetLabel(preset) {
  return preset.labelKey ? t(preset.labelKey) : preset.name;
}

function gameTitle(game) {
  if (game.name) return game.name;
  const preset = getPreset(game.presetId);
  return preset ? presetLabel(preset) : t('new.customLabel');
}

function formatDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleDateString(getLanguage(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function flash(message, kind = 'info') {
  state.flash = { message, kind };
}

/* ------------------------------------------------------------- persisting --- */

/**
 * Keep the local copy, and hand the changed game to the store when there is
 * one. Writing per game rather than per list keeps one write to one document,
 * which is what the store asks for.
 */
function persist(changed) {
  const ok = saveGames(state.games);
  if (!ok && !state.store && !state.remote) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  // Only a game that has been shared travels: someone else's evening has no
  // business landing in a database they never chose.
  if (state.remote && changed?.shared) {
    // A failure here must never cost the player their round: the local copy is
    // already written, and the next change pushes again.
    state.remote.put(changed).catch(() => flash(t('share.pushFailed'), 'error'));
  }
  return ok;
}

function forget(id) {
  saveGames(state.games);
  if (state.store) void state.store.remove(id);
  if (state.remote) state.remote.remove(id).catch(() => {});
}

function getGame(id) {
  return state.games.find((game) => game.id === id) || null;
}

function replaceGame(next) {
  state.games = state.games.map((game) => (game.id === next.id ? next : game));
  persist(next);
}

/* ----------------------------------------------------------------- router --- */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  if (name === 'new') return { name: 'new' };
  if (name === 'game' && param) return { name: 'game', id: param };
  return { name: 'home' };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ------------------------------------------------------------------ views --- */

function flashHtml() {
  if (!state.flash) return '';
  const { message, kind } = state.flash;
  state.flash = null;
  return `<p class="banner ${kind === 'error' ? 'banner--warn' : ''}">${escapeHtml(message)}</p>`;
}

function gameCardHtml(game) {
  const status = gameStatus(game);
  const names = status.finished
    ? status.winners.map((row) => row.name)
    : status.leaders.map((row) => row.name);
  let line = '';
  if (game.rounds.length && names.length) {
    const key = status.finished
      ? names.length > 1 ? 'home.winners' : 'home.winner'
      : 'home.leader';
    line = t(key, { name: names.join(', ') });
  }
  return `
    <button type="button" class="game-card" data-goto="#/game/${escapeHtml(game.id)}">
      <span class="game-card__title">
        ${escapeHtml(gameTitle(game))}
        <span class="pill ${status.finished ? 'pill--done' : ''}">
          ${status.finished ? escapeHtml(t('game.finished')) : escapeHtml(t('home.rounds', { count: game.rounds.length }))}
        </span>
      </span>
      <span class="game-card__meta">${escapeHtml(game.players.map((p) => p.name).join(' · '))}</span>
      <span class="game-card__meta">${escapeHtml(formatDate(game.updatedAt))}${line ? ` — ${escapeHtml(line)}` : ''}</span>
    </button>`;
}

function homeView() {
  const sorted = [...state.games].sort((a, b) => b.updatedAt - a.updatedAt);
  const ongoing = sorted.filter((game) => !gameStatus(game).finished);
  const finished = sorted.filter((game) => gameStatus(game).finished);

  return `
    ${flashHtml()}
    <button type="button" class="button button--primary button--block" data-goto="#/new">
      + ${escapeHtml(t('action.newGame'))}
    </button>

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.ongoing'))}</h2></div>
      ${
        ongoing.length
          ? `<div class="game-list">${ongoing.map(gameCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('home.empty'))}</p>`
      }
    </section>

    ${
      finished.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('home.finished'))}</h2></div>
             <div class="game-list">${finished.map(gameCardHtml).join('')}</div>
           </section>`
        : ''
    }

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small" id="export">${escapeHtml(t('action.export'))}</button>
        <button type="button" class="button button--small" id="import">${escapeHtml(t('action.import'))}</button>
        <input type="file" id="import-file" accept="application/json,.json" class="visually-hidden" />
      </div>
      <p class="muted small">${escapeHtml(
        t(state.remote ? 'home.storedShared' : state.store ? 'home.storedCloud' : 'home.storedLocal'),
      )}</p>
      ${
        state.remote
          ? `<label class="checkbox">
               <input type="checkbox" id="auto-share" ${state.prefs.autoShare ? 'checked' : ''} />
               ${escapeHtml(t('data.autoShare'))}
             </label>
             <p class="muted small">${escapeHtml(t('data.autoShareHint'))}</p>`
          : ''
      }
    </section>`;
}

/* -------------------------------------------------------- new game view --- */

/** Names typed so far, so switching preset does not wipe them. */
let newGameNames = ['', '', ''];

function newGameView() {
  const presetId = state.newPresetId || PRESETS[0].id;
  const preset = getPreset(presetId);
  const config = state.newConfig || presetConfig(preset);
  const isTeam = config.entrantLabel === 'team';
  const [min, max] = preset.players;

  while (newGameNames.length < min) newGameNames.push('');
  const names = newGameNames.slice(0, Math.max(min, Math.min(newGameNames.length, max)));

  const nameRows = names
    .map(
      (value, index) => `
        <div class="score-row">
          <input type="text" data-name-index="${index}" value="${escapeHtml(value)}"
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
      <button type="button" class="button button--small button--ghost" data-goto="#/">${escapeHtml(t('action.back'))}</button>
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

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('new.start'))}</button>
    </form>`;
}

/* ------------------------------------------------------------- game view --- */

function roundFormHtml(game) {
  const preset = getPreset(game.presetId);
  if (preset?.calculator === 'tarot') {
    if (!deal) deal = emptyDeal(game);
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

  return `
    <form id="round-form" class="card stack">
      <h2>${escapeHtml(editing ? t('game.editRound', { n: index }) : t('game.newRound', { n: index }))}</h2>
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

function gameView(game) {
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
      <button type="button" class="button button--small button--ghost" data-goto="#/">${escapeHtml(t('action.back'))}</button>
    </div>

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

    <section class="row">
      ${
        game.rounds.length
          ? `<button type="button" class="button button--small" id="undo">${escapeHtml(t('action.undo'))}</button>`
          : ''
      }
      ${
        state.remote
          ? `<button type="button" class="button button--small" id="share">${escapeHtml(t('action.share'))}</button>`
          : ''
      }
      <button type="button" class="button button--small" id="rename">${escapeHtml(t('action.rename'))}</button>
      <button type="button" class="button button--small" id="toggle-finish">
        ${escapeHtml(game.finishedAt ? t('action.reopen') : t('action.finish'))}
      </button>
      <button type="button" class="button button--small button--danger" id="delete-game">${escapeHtml(t('action.delete'))}</button>
    </section>

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
 * Ask a yes/no question.
 *
 * Not the browser's own confirm dialog: a sandboxed page — the app embedded
 * in another site — is refused browser modals, and the call then returns
 * false without ever asking, so every action behind one silently does
 * nothing. A `<dialog>` is ordinary DOM and works everywhere.
 */
function ask(message, { confirmLabel, danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--ask';
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
      dialog.remove();
    };

    dialog.querySelector('[data-answer="yes"]').addEventListener('click', () => finish(true));
    dialog.querySelector('[data-answer="no"]').addEventListener('click', () => finish(false));
    // Escape, or a close from anywhere else, means no.
    dialog.addEventListener('close', () => finish(false));

    document.body.append(dialog);
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

function exportGames() {
  const json = JSON.stringify({ version: 1, games: state.games }, null, 2);
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

function showCopyDialog({ title, hint, text: content }) {
  let dialog = document.getElementById('export-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'export-dialog';
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="stack">
        <h2 id="export-title"></h2>
        <p class="muted small" id="export-hint"></p>
        <textarea id="export-text" readonly rows="8"></textarea>
        <div class="row">
          <button type="button" class="button button--primary" id="export-copy"></button>
          <button type="button" class="button" id="export-close"></button>
        </div>
      </div>`;
    document.body.append(dialog);

    dialog.querySelector('#export-close').addEventListener('click', () => dialog.close());
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
  dialog.querySelector('#export-copy').textContent = t('action.copy');
  dialog.querySelector('#export-close').textContent = t('action.close');
  dialog.showModal();
}

function bindHome() {
  view.querySelector('#auto-share')?.addEventListener('change', (event) => {
    state.prefs = { ...state.prefs, autoShare: event.target.checked };
    savePrefs(state.prefs);
  });

  view.querySelector('#export')?.addEventListener('click', exportGames);

  const fileInput = view.querySelector('#import-file');
  view.querySelector('#import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = (Array.isArray(parsed) ? parsed : parsed.games || []).filter(isValidGame);
      if (!incoming.length) throw new Error('nothing to import');
      const known = new Set(state.games.map((game) => game.id));
      const fresh = incoming.filter((game) => !known.has(game.id));
      state.games = [...state.games, ...fresh];
      saveGames(state.games);
      if (state.store) for (const game of fresh) void state.store.save(game);
      flash(t('home.importDone', { count: fresh.length }));
    } catch {
      flash(t('home.importFailed'), 'error');
    }
    render();
  });
}

function bindNewGame() {
  const form = view.querySelector('#new-game');
  if (!form) return;

  const snapshotNames = () => {
    view.querySelectorAll('[data-name-index]').forEach((input) => {
      newGameNames[Number(input.dataset.nameIndex)] = input.value;
    });
  };

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
    newGameNames = newGameNames.slice(0, preset.players[1]);
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
    newGameNames.push('');
    render();
  });

  view.querySelectorAll('[data-remove-name]').forEach((button) => {
    button.addEventListener('click', () => {
      snapshotNames();
      state.newName = view.querySelector('#game-name').value;
      state.newConfig = readConfigFromForm();
      newGameNames.splice(Number(button.dataset.removeName), 1);
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshotNames();
    const presetId = state.newPresetId || PRESETS[0].id;
    const preset = getPreset(presetId);
    const config = readConfigFromForm();
    const [min, max] = preset.players;
    const names = newGameNames
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

    const game = createGame({
      presetId,
      names,
      overrides: config,
      name: view.querySelector('#game-name').value,
      shared: Boolean(state.prefs.autoShare),
    });
    state.games = [...state.games, game];
    persist(game);

    newGameNames = ['', '', ''];
    state.newPresetId = null;
    state.newConfig = null;
    state.newName = '';
    navigate(`#/game/${game.id}`);
  });
}

/** What the open card counter holds, while it is open. */
let counterEntry = emptyHelperEntry();

/** The deal being entered on the Tarot screen. */
let deal = null;

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
  const threshold = THRESHOLDS[deal.oudlers];
  const complete = isCompleteDeal(game.players, deal);
  const result = complete ? scoreDeal(game.players, deal) : null;

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
          <select id="deal-taker">${playerOptions(deal.takerId)}</select>
        </label>
        ${
          game.players.length === 5
            ? `<label>${escapeHtml(t('tarot.partner'))}
                 <select id="deal-partner">
                   <option value="">${escapeHtml(t('tarot.alone'))}</option>
                   ${playerOptions(deal.partnerId)}
                 </select>
               </label>`
            : ''
        }
        <label>${escapeHtml(t('tarot.contract'))}
          <select id="deal-contract">${options(CONTRACTS, deal.contract, (c) => `${t(`tarot.${c.id}`)} ×${c.multiplier}`)}</select>
        </label>
        <label>${escapeHtml(t('tarot.oudlers'))}
          <select id="deal-oudlers">
            ${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === deal.oudlers ? 'selected' : ''}>${n} — ${THRESHOLDS[n]} ${escapeHtml(t('tarot.pointsNeeded'))}</option>`).join('')}
          </select>
        </label>
        <label>${escapeHtml(t('tarot.points', { max: TOTAL_POINTS }))}
          <input type="number" id="deal-points" inputmode="numeric" step="1" min="0" max="${TOTAL_POINTS}"
                 value="${Number.isFinite(deal.points) ? deal.points : ''}" />
        </label>
        <label>${escapeHtml(t('tarot.petitAuBout'))}
          <select id="deal-petit">
            ${['none', 'taker', 'defence'].map((id) => `<option value="${id}" ${id === deal.petitAuBout ? 'selected' : ''}>${escapeHtml(t(`tarot.petit.${id}`))}</option>`).join('')}
          </select>
        </label>
        <label>${escapeHtml(t('tarot.poignee'))}
          <select id="deal-poignee">${options(POIGNEES, deal.poignee, (p) => `${t(`tarot.poignee.${p.id}`)}${p.value ? ` (+${p.value})` : ''}`)}</select>
        </label>
        <label>${escapeHtml(t('tarot.chelem'))}
          <select id="deal-chelem">${options(CHELEMS, deal.chelem, (c) => t(`tarot.chelem.${c.id}`))}</select>
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
    '#deal-taker': (v) => { deal.takerId = v; },
    '#deal-partner': (v) => { deal.partnerId = v || null; },
    '#deal-contract': (v) => { deal.contract = v; },
    '#deal-oudlers': (v) => { deal.oudlers = Number(v); },
    '#deal-points': (v) => { deal.points = v === '' ? null : Number(v); },
    '#deal-petit': (v) => { deal.petitAuBout = v; },
    '#deal-poignee': (v) => { deal.poignee = v; },
    '#deal-chelem': (v) => { deal.chelem = v; },
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
  if (!isCompleteDeal(game.players, deal)) return;
  const { scores } = scoreDeal(game.players, deal);
  const note = view.querySelector('#round-note')?.value.trim() || '';
  const meta = JSON.stringify(deal);

  const next = state.editingRoundId
    ? updateRound(game, state.editingRoundId, { scores, meta, note })
    : addRound(game, { scores, meta, note });

  state.editingRoundId = null;
  deal = emptyDeal(game);
  replaceGame(next);
  render();
}

/** Fix a mistyped name, mid-game, without touching a single score. */
function openRenameDialog(game) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
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
  document.body.append(dialog);

  const close = () => { dialog.close(); dialog.remove(); };
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

function bindGame(game) {
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
    if (preset?.calculator === 'tarot') deal = emptyDeal(game);
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
        deal = stored && typeof stored === 'object' ? stored : emptyDeal(game);
      } catch {
        deal = emptyDeal(game);
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
      current = setShared(current, true);
      try {
        await state.remote.put(current);
      } catch {
        button.disabled = false;
        button.textContent = t('action.share');
        flash(t('share.sendFailed'), 'error');
        render();
        return;
      }
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
    });
  });

  view.querySelector('#rename')?.addEventListener('click', () => openRenameDialog(game));

  view.querySelector('#toggle-finish')?.addEventListener('click', () => {
    replaceGame(setFinished(game, !game.finishedAt));
    render();
  });

  view.querySelector('#delete-game')?.addEventListener('click', async () => {
    if (!(await ask(t('game.confirmDeleteGame'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.games = state.games.filter((item) => item.id !== game.id);
    forget(game.id);
    navigate('#/');
  });
}

/* ---------------------------------------------------------------- chrome --- */

function applyStaticText() {
  document.documentElement.lang = getLanguage();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const label = t(node.dataset.i18nTitle);
    node.title = label;
    node.setAttribute('aria-label', label);
  });
}

function applyTheme() {
  const theme = state.prefs.theme;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function currentThemeIsDark() {
  if (state.prefs.theme) return state.prefs.theme === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function bindChrome() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.prefs = { ...state.prefs, theme: currentThemeIsDark() ? 'light' : 'dark' };
    savePrefs(state.prefs);
    applyTheme();
  });

  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = getLanguage() === 'fr' ? 'en' : 'fr';
    setLanguage(next);
    state.prefs = { ...state.prefs, lang: next };
    savePrefs(state.prefs);
    applyStaticText();
    render();
  });
}

/* ----------------------------------------------------------------- render --- */

function render() {
  const current = route();
  if (current.name === 'new') {
    stopWatching();
    view.innerHTML = newGameView();
    bindNewGame();
  } else if (current.name === 'game') {
    const game = getGame(current.id);
    if (!game) {
      // Perhaps it is a game someone shared: ask the database before giving up.
      if (state.remote) {
        view.innerHTML = `<p class="muted small">${escapeHtml(t('share.loading'))}</p>`;
        pullGame(current.id).then((found) => {
          if (found) render();
          else if (route().id === current.id) navigate('#/');
        });
        return;
      }
      navigate('#/');
      return;
    }
    watchGame(game.id);
    if (state.editingRoundId && !game.rounds.some((round) => round.id === state.editingRoundId)) {
      state.editingRoundId = null;
    }
    view.innerHTML = gameView(game);
    bindGame(game);
  } else {
    stopWatching();
    view.innerHTML = homeView();
    bindHome();
  }

  view.querySelectorAll('[data-goto]').forEach((node) => {
    node.addEventListener('click', () => navigate(node.dataset.goto));
  });
}

/**
 * Pull one game from the shared database and take it if it is newer than what
 * this browser holds — which is how a link to a game opens that game for
 * someone who has never seen it.
 */
async function pullGame(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  if (!isValidGame(stored)) return false;

  const local = getGame(id);
  if (pickNewer(local, stored) !== 'remote') return false;

  const adopted = { ...stored, shared: true };
  state.games = local
    ? state.games.map((game) => (game.id === id ? adopted : game))
    : [...state.games, adopted];
  saveGames(state.games);
  return true;
}

/** While a game is on screen, watch for rounds someone else has entered. */
function watchGame(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy()) return; // never redraw under someone's fingers
    if (await pullGame(id)) render();
  }, 5000);
}

function stopWatching() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

/** A list's identity for comparison: which games, and how recently each changed. */
function signature(games) {
  return games
    .map((game) => `${game.id}:${game.updatedAt}`)
    .sort()
    .join('|');
}

/** Someone is typing, or a dialog is open: a bad moment to redraw the view. */
function isBusy() {
  if (document.querySelector('dialog[open]')) return true;
  const active = document.activeElement;
  return Boolean(
    active && active.closest?.('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName),
  );
}

/**
 * Ask the host for a document store. It answers late or not at all, so the
 * app is already running by the time this resolves.
 */
/**
 * Games created before sharing became deliberate were all being sent up, so
 * they are already in the database: keep them that way rather than silently
 * cutting them off.
 */
function adoptOlderGames() {
  if (!state.remote) return;
  const migrated = state.games.map((game) =>
    game.shared === undefined ? { ...game, shared: true } : game,
  );
  if (migrated.some((game, index) => game !== state.games[index])) {
    state.games = migrated;
    saveGames(state.games);
  }
}

function connectToStore() {
  connectStore({
    getLocalGames: () => state.games,
    onGames: (games) => {
      if (signature(games) === signature(state.games)) return;
      state.games = games;
      saveGames(games);
      // Redrawing under someone's fingers would throw away what they are
      // typing; the next render picks the change up anyway.
      if (!isBusy()) render();
    },
    onLost: () => {
      state.store = null;
      if (!isBusy()) render();
    },
  }).then((store) => {
    if (!store) return;
    state.store = store;
    if (!isBusy()) render();
  });
}

setLanguage(state.prefs.lang || detectLanguage());
applyStaticText();
applyTheme();
bindChrome();
window.addEventListener('hashchange', () => {
  state.editingRoundId = null;
  render();
});
adoptOlderGames();
render();
connectToStore();
