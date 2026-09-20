/** UI layer: hash router, views, event wiring. */

import { PRESETS, PRESET_GROUPS, getPreset, presetConfig } from './games.js';
import { createGame, addRound, updateRound, removeRound, renamePlayer, setFinished, setShared, replayGame, dealerFor, recentNames, mergeGames, isValidGame, uid } from './model.js';
import { gameStatus, roundScore, totals, validateRound, completingScore } from './scoring.js';
import { emptyHelperEntry, tapCard, undoCard, toggleSwitch, cardCount, helperTotal, isEmptyEntry } from './helpers.js';
import { CONTRACTS, POIGNEES, CHELEMS, THRESHOLDS, TOTAL_POINTS, scoreDeal, isCompleteDeal } from './tarot.js';
import { presetsPlayed, statsFor } from './stats.js';
import { recapText } from './recap.js';
import { buildDocx } from './export-docx.js';
import { buildPdf } from './export-pdf.js';
import { qrSvg, qrMatrix } from './qr.js';
import {
  createList, addItems, renameItem, assignItem, toggleItem, removeItem, reuseList,
  addListPerson, renameListPerson, removeListPerson, shareOut, progress, mergeLists, isValidList,
} from './lists.js';
import {
  createPoll, addOptions, renameOption, removeOption, setVote, voteOf, nextValue, setClosed, tally,
  mergePolls, isValidPoll, addPollPerson, renamePollPerson, removePollPerson,
} from './polls.js';
import { recentPeople } from './people.js';
import { loadGames, saveGames, loadLists, saveLists, loadPolls, savePolls, loadPrefs, savePrefs } from './storage.js';
import { connectStore } from './cloud.js';
import { createRemote, pickNewer, shareLink, gameIdFrom, listLink, listIdFrom, pollLink, pollIdFrom, setLink, setIdFrom } from './remote.js';
import { canSeal, newCode, readCode, seal, unseal } from './lock.js';
import { remoteConfig } from './config.js';
import { t, setLanguage, getLanguage, detectLanguage } from './i18n.js';

const view = document.getElementById('view');

const state = {
  games: loadGames(),
  lists: loadLists(),
  polls: loadPolls(),
  prefs: loadPrefs(),
  flash: null, // { message, kind: 'info' | 'error' }
  editingRoundId: null,
  // New-game form draft, kept across re-renders of that view.
  search: '',
  newPresetId: null,
  newConfig: null,
  newName: '',
  // Set once the host's document store answers; null means this browser only.
  store: null,
  // The shared database, when this copy of the app is configured for one.
  remote: createRemote(remoteConfig()),
  // Polling while a shared game is on screen.
  poll: null,
  // The set of games being fetched, so a redraw does not start a second fetch.
  openingSet: null,
  // The same, for a shared list opened from its link.
  openingList: null,
  // And for a poll.
  openingPoll: null,
  // Whose lines are on screen in a list: null for everyone, 'none' for the
  // ones nobody has taken.
  listFilter: null,
};

// The new-list form's draft, kept across re-renders like the new-game one:
// adding a person must not throw away the lines already typed.
let newListName = '';
let newListPeople = ['', ''];
let newListLines = '';

// And the new-poll form's.
let newPollQuestion = '';
let newPollChoices = '';
let newPollPeople = ['', ''];

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

/** The title of a game or of a list, whichever this is. */
function documentTitle(document_) {
  if (isValidList(document_)) return listTitle(document_);
  if (isValidPoll(document_)) return pollTitle(document_);
  return gameTitle(document_);
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

/** The app's own address, with no game attached to it. */
function appLink() {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}`;
}

function flash(message, kind = 'info') {
  state.flash = { message, kind };
}

/* ------------------------------------------------------------- persisting --- */

/* ------------------------------------------------------------------ polls --- */

/**
 * A poll is a question, the choices it offers, and a grid: one answer per
 * person and per choice. The "which evening suits you" case is the one worth
 * building, and picking one thing out of several is the same grid with a
 * single yes in it.
 */

function pollTitle(poll) {
  return poll.question || t('polls.untitled');
}

const VOTE_MARK = { yes: '✓', maybe: '~', no: '✗' };

function pollCardHtml(poll) {
  const { answered, leaders, rows } = tally(poll);
  const leading = rows.find((row) => leaders.includes(row.option.id));
  return `
    <button type="button" class="game-card" data-goto="#/poll/${escapeHtml(poll.id)}">
      <span class="game-card__title">
        ${escapeHtml(pollTitle(poll))}
        <span class="pill ${poll.closedAt ? 'pill--done' : ''}">
          ${escapeHtml(poll.closedAt ? t('polls.closed') : t('polls.answered', { count: answered, total: poll.people.length }))}
        </span>
      </span>
      ${
        leading
          ? `<span class="game-card__meta">${escapeHtml(t('polls.leading', { option: leading.option.text, count: leading.yes }))}</span>`
          : `<span class="game-card__meta">${escapeHtml(t('polls.noAnswerYet'))}</span>`
      }
      <span class="game-card__meta">${escapeHtml(formatDate(poll.updatedAt))}</span>
    </button>`;
}

function pollsView() {
  const sorted = [...state.polls].sort((a, b) => b.updatedAt - a.updatedAt);
  const open = sorted.filter((poll) => !poll.closedAt);
  const closed = sorted.filter((poll) => poll.closedAt);

  return `
    ${flashHtml()}
    <button type="button" class="button button--primary button--block" data-goto="#/polls/new">
      + ${escapeHtml(t('polls.new'))}
    </button>

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('polls.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(pollCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('polls.none'))}</p>`
      }
    </section>

    ${
      closed.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('polls.done'))}</h2></div>
             <div class="game-list">${closed.map(pollCardHtml).join('')}</div>
           </section>`
        : ''
    }`;
}

function newPollView() {
  const suggestions = [...new Set([...recentPeople(state.polls), ...recentPeople(state.lists), ...recentNames(state.games)])].slice(0, 12);
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('polls.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/polls">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-poll" class="card stack">
      <label>
        ${escapeHtml(t('polls.question'))}
        <input type="text" id="poll-question" placeholder="${escapeHtml(t('polls.questionPlaceholder'))}"
               value="${escapeHtml(newPollQuestion)}" required />
      </label>

      <label>
        ${escapeHtml(t('polls.choices'))}
        <textarea id="poll-choices" rows="5" placeholder="${escapeHtml(t('polls.choicesPlaceholder'))}">${escapeHtml(newPollChoices)}</textarea>
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('polls.peopleHint'))}</span>
        ${newPollPeople
          .map(
            (name, index) => `
              <input type="text" data-person-index="${index}" value="${escapeHtml(name)}"
                     placeholder="${escapeHtml(t('lists.person', { n: index + 1 }))}"
                     aria-label="${escapeHtml(t('lists.person', { n: index + 1 }))}" />`,
          )
          .join('')}
        <div class="row">
          <button type="button" class="button button--small" id="add-person">+ ${escapeHtml(t('lists.addPerson'))}</button>
          ${
            newPollPeople.length > 1
              ? `<button type="button" class="button button--small button--ghost" id="drop-person">− ${escapeHtml(t('lists.dropPerson'))}</button>`
              : ''
          }
        </div>
        ${
          suggestions.length
            ? `<div class="row">${suggestions
                .map((name) => `<button type="button" class="chip" data-suggest="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
                .join('')}</div>`
            : ''
        }
      </div>

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('polls.create'))}</button>
    </form>`;
}

function pollView(poll) {
  const me = state.prefs.voter?.[poll.id] || null;
  const { rows, leaders, answered } = tally(poll);
  const closed = Boolean(poll.closedAt);

  const cellHtml = (option, person) => {
    const value = voteOf(poll, person.id, option.id);
    return `
      <td class="${person.id === me ? 'votes__mine' : ''}">
        <button type="button" class="vote ${value ? `vote--${value}` : 'vote--none'}"
                data-vote="${escapeHtml(person.id)}|${escapeHtml(option.id)}" ${closed ? 'disabled' : ''}
                aria-label="${escapeHtml(`${person.name} — ${option.text}`)}">
          ${escapeHtml(value ? VOTE_MARK[value] : '·')}
        </button>
      </td>`;
  };

  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(pollTitle(poll))}</h1>
        <p class="muted small">
          ${escapeHtml(t('polls.answered', { count: answered, total: poll.people.length }))}
          ${closed ? ` · ${escapeHtml(t('polls.closed'))}` : ''}
          ${poll.shared ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/polls">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${
      poll.people.length
        ? `<div class="row">
             <span class="muted small">${escapeHtml(t('polls.iAm'))}</span>
             ${poll.people
               .map(
                 (person) => `<button type="button" class="chip ${person.id === me ? 'chip--on' : ''}" data-me="${escapeHtml(person.id)}">${escapeHtml(person.name)}</button>`,
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      poll.options.length && poll.people.length
        ? `<div class="table-wrap">
             <table class="votes">
               <thead>
                 <tr>
                   <th>${escapeHtml(t('polls.choice'))}</th>
                   ${poll.people.map((person) => `<th class="${person.id === me ? 'votes__mine' : ''}">${escapeHtml(person.name)}</th>`).join('')}
                   <th>${escapeHtml(t('polls.count'))}</th>
                 </tr>
               </thead>
               <tbody>
                 ${rows
                   .map(
                     (row) => `
                       <tr class="${leaders.includes(row.option.id) ? 'votes__leader' : ''}">
                         <th scope="row">
                           <button type="button" class="line__text" data-option="${escapeHtml(row.option.id)}">
                             ${escapeHtml(row.option.text)}
                           </button>
                         </th>
                         ${poll.people.map((person) => cellHtml(row.option, person)).join('')}
                         <td class="votes__score">${row.yes}${row.maybe ? `<span class="muted small"> +${row.maybe}~</span>` : ''}</td>
                       </tr>`,
                   )
                   .join('')}
               </tbody>
             </table>
           </div>
           <p class="muted small">${escapeHtml(t('polls.tapHint'))}</p>`
        : `<p class="muted small">${escapeHtml(poll.people.length ? t('polls.addChoices') : t('polls.addPeople'))}</p>`
    }

    ${
      closed
        ? ''
        : `<form id="add-choice" class="card stack stack--tight">
             <label class="visually-hidden" for="new-choice">${escapeHtml(t('polls.addChoice'))}</label>
             <div class="row row--tight">
               <input type="text" id="new-choice" placeholder="${escapeHtml(t('polls.addChoice'))}" autocomplete="off" />
               <button type="submit" class="button button--primary">+</button>
             </div>
           </form>`
    }

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small" id="poll-people">${escapeHtml(t('lists.people'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="poll-share">${escapeHtml(t('polls.share'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="poll-text">${escapeHtml(t('action.recap'))}</button>
        <button type="button" class="button button--small" id="poll-close">
          ${escapeHtml(closed ? t('polls.reopen') : t('polls.close'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="poll-rename">${escapeHtml(t('polls.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="poll-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </section>`;
}

/* ------------------------------------------------------ polls: behaviour --- */

function persistPoll(changed) {
  const ok = savePolls(state.polls);
  if (!ok && !state.store && !state.remote) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed).catch(() => flash(t('share.pushFailed'), 'error'));
  }
  return ok;
}

function getPoll(id) {
  return state.polls.find((poll) => poll.id === id) || null;
}

function replacePoll(next, { redraw = true } = {}) {
  state.polls = state.polls.map((poll) => (poll.id === next.id ? next : poll));
  persistPoll(next);
  if (redraw) render();
}

function bindNewPoll() {
  const form = view.querySelector('#new-poll');
  if (!form) return;

  const snapshot = () => {
    newPollQuestion = view.querySelector('#poll-question').value;
    newPollChoices = view.querySelector('#poll-choices').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      newPollPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    newPollPeople = [...newPollPeople, ''];
    render();
    view.querySelector(`[data-person-index="${newPollPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    newPollPeople = newPollPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (newPollPeople.includes(suggest)) return;
      const empty = newPollPeople.findIndex((name) => !name.trim());
      if (empty >= 0) newPollPeople[empty] = suggest;
      else newPollPeople = [...newPollPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();

    let poll = createPoll({
      question: newPollQuestion,
      names: newPollPeople,
      shared: Boolean(state.prefs.autoShare && state.remote),
    });
    poll = addOptions(poll, newPollChoices);

    state.polls = [...state.polls, poll];
    persistPoll(poll);
    newPollQuestion = '';
    newPollChoices = '';
    newPollPeople = ['', ''];
    navigate(`#/poll/${poll.id}`);
  });
}

function bindPoll(poll) {
  view.querySelectorAll('[data-vote]').forEach((button) => {
    button.addEventListener('click', () => {
      const [personId, optionId] = button.dataset.vote.split('|');
      const next = setVote(poll, personId, optionId, nextValue(voteOf(poll, personId, optionId)));
      if (next === poll) return;
      // Remember who this device answers as, so its column stands out.
      if (!state.prefs.voter?.[poll.id]) {
        state.prefs = { ...state.prefs, voter: { ...state.prefs.voter, [poll.id]: personId } };
        savePrefs(state.prefs);
      }
      replacePoll(next);
    });
  });

  view.querySelectorAll('[data-me]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const chosen = state.prefs.voter?.[poll.id] === chip.dataset.me ? null : chip.dataset.me;
      state.prefs = { ...state.prefs, voter: { ...state.prefs.voter, [poll.id]: chosen } };
      savePrefs(state.prefs);
      render();
    });
  });

  view.querySelector('#add-choice')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = view.querySelector('#new-choice');
    const next = addOptions(poll, field.value);
    if (next === poll) return;
    replacePoll(next);
    view.querySelector('#new-choice')?.focus();
  });

  view.querySelectorAll('[data-option]').forEach((button) => {
    button.addEventListener('click', () => openChoiceDialog(poll, button.dataset.option));
  });

  view.querySelector('#poll-people')?.addEventListener('click', () => openPollPeopleDialog(poll));

  view.querySelector('#poll-text')?.addEventListener('click', () => {
    showCopyDialog({ title: pollTitle(poll), hint: t('lists.textHint'), text: pollText(poll) });
  });

  view.querySelector('#poll-close')?.addEventListener('click', () => {
    replacePoll(setClosed(poll, !poll.closedAt));
  });

  view.querySelector('#poll-rename')?.addEventListener('click', () => openPollNameDialog(poll));

  view.querySelector('#poll-delete')?.addEventListener('click', async () => {
    if (!(await ask(t('polls.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.polls = state.polls.filter((item) => item.id !== poll.id);
    savePolls(state.polls);
    if (state.store) void state.store.remove(poll.id);
    if (state.remote) state.remote.remove(poll.id).catch(() => {});
    navigate('#/polls');
  });

  view.querySelector('#poll-share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let current = poll;

    if (!current.shared) {
      button.disabled = true;
      button.textContent = t('share.sending');
      current = { ...current, shared: true, updatedAt: Date.now() };
      try {
        await state.remote.put(current);
      } catch {
        button.disabled = false;
        button.textContent = t('polls.share');
        flash(t('share.sendFailed'), 'error');
        render();
        return;
      }
      replacePoll(current);
    }

    showCopyDialog({
      title: t('polls.shareTitle'),
      hint: t('polls.shareHint'),
      text: pollLink(location, current.id),
      qr: true,
    });
  });
}

/** Correct a choice, or drop it. */
function openChoiceDialog(poll, optionId) {
  const option = poll.options.find((entry) => entry.id === optionId);
  if (!option) return;

  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('polls.choiceTitle'))}</h2>
      <label class="visually-hidden" for="choice-text">${escapeHtml(t('polls.choiceTitle'))}</label>
      <input type="text" id="choice-text" value="${escapeHtml(option.text)}" />
      <div class="row">
        <button type="button" class="button button--primary" id="choice-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="choice-cancel">${escapeHtml(t('action.cancel'))}</button>
        <button type="button" class="button button--danger" id="choice-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#choice-text');
  const save = () => {
    dialog.close();
    replacePoll(renameOption(poll, optionId, field.value));
  };
  dialog.querySelector('#choice-save').addEventListener('click', save);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save();
  });
  dialog.querySelector('#choice-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#choice-delete').addEventListener('click', async () => {
    if (!(await ask(t('polls.confirmRemoveChoice'), { confirmLabel: t('action.delete'), danger: true }))) return;
    dialog.close();
    replacePoll(removeOption(poll, optionId));
  });

  dialog.showModal();
  field.focus();
  field.select();
}

/** Who is being asked. */
function openPollPeopleDialog(poll) {
  const dialog = makeDialog();

  const draw = () => {
    const current = getPoll(poll.id) || poll;
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('lists.people'))}</h2>
        <p class="muted small">${escapeHtml(t('polls.peopleHint'))}</p>
        <div class="stack stack--tight">
          ${current.people
            .map(
              (person) => `
                <div class="row row--tight">
                  <input type="text" data-person="${escapeHtml(person.id)}" value="${escapeHtml(person.name)}"
                         aria-label="${escapeHtml(person.name)}" />
                  <button type="button" class="button button--small button--ghost" data-remove="${escapeHtml(person.id)}">
                    ${escapeHtml(t('action.delete'))}
                  </button>
                </div>`,
            )
            .join('')}
          ${current.people.length ? '' : `<p class="muted small">${escapeHtml(t('lists.nobodyYet'))}</p>`}
        </div>
        <div class="row row--tight">
          <input type="text" id="person-new" placeholder="${escapeHtml(t('lists.addPerson'))}"
                 aria-label="${escapeHtml(t('lists.addPerson'))}" />
          <button type="button" class="button button--primary" id="person-add">+</button>
        </div>
        <div class="row">
          <button type="button" class="button" id="people-close">${escapeHtml(t('action.close'))}</button>
        </div>
      </div>`;

    const field = dialog.querySelector('#person-new');
    const add = () => {
      replacePoll(addPollPerson(getPoll(poll.id) || poll, field.value), { redraw: false });
      draw();
      dialog.querySelector('#person-new').focus();
    };
    dialog.querySelector('#person-add').addEventListener('click', add);
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });

    dialog.querySelectorAll('[data-person]').forEach((input) => {
      input.addEventListener('change', () => {
        replacePoll(renamePollPerson(getPoll(poll.id) || poll, input.dataset.person, input.value), { redraw: false });
      });
    });

    dialog.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!(await ask(t('polls.confirmRemovePerson'), { confirmLabel: t('action.delete'), danger: true }))) return;
        replacePoll(removePollPerson(getPoll(poll.id) || poll, button.dataset.remove), { redraw: false });
        draw();
      });
    });

    dialog.querySelector('#people-close').addEventListener('click', () => dialog.close());
  };

  dialog.addEventListener('close', () => render());
  draw();
  dialog.showModal();
}

function openPollNameDialog(poll) {
  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('polls.rename'))}</h2>
      <label class="visually-hidden" for="poll-new-name">${escapeHtml(t('polls.question'))}</label>
      <input type="text" id="poll-new-name" value="${escapeHtml(poll.question)}" />
      <div class="row">
        <button type="button" class="button button--primary" id="poll-name-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="poll-name-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#poll-new-name');
  const save = () => {
    dialog.close();
    replacePoll({ ...poll, question: field.value.trim(), updatedAt: Date.now() });
  };
  dialog.querySelector('#poll-name-save').addEventListener('click', save);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save();
  });
  dialog.querySelector('#poll-name-cancel').addEventListener('click', () => dialog.close());

  dialog.showModal();
  field.focus();
  field.select();
}

/** The poll as text, to paste into a message. */
function pollText(poll) {
  const { rows } = tally(poll);
  const line = (row) =>
    `${row.option.text} — ${t('polls.countLine', { yes: row.yes, maybe: row.maybe, no: row.no })}`;
  return [pollTitle(poll), '', ...rows.map(line)].join('\n');
}

/** Fetch a poll from the shared database and take what it knows. */
async function pullPoll(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  return isValidPoll(stored) ? adoptPoll(stored) : false;
}

/** Answers arrive cell by cell, so nobody's answer is lost to someone else's. */
function adoptPoll(stored) {
  const local = getPoll(stored.id);
  const merged = local ? mergePolls(local, stored) : stored;
  if (local && merged === local) return false;

  const adopted = { ...merged, shared: true };
  state.polls = local
    ? state.polls.map((poll) => (poll.id === stored.id ? adopted : poll))
    : [...state.polls, adopted];
  savePolls(state.polls);
  return true;
}

/** While a shared poll is on screen, watch for the answers coming in. */
function watchPoll(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy()) return;
    if (await pullPoll(id)) render();
  }, 5000);
}

/* ------------------------------------------------------------------ lists --- */

/**
 * A list is a title, the people it concerns, and lines to hand out. The views
 * below are deliberately few: all the lines, or one person's — because what a
 * shared list is asked in practice is "what do I still have to do".
 */

function listTitle(list) {
  return list.name || t('lists.untitled');
}

function personName(list, who) {
  return list.people.find((person) => person.id === who)?.name || '';
}

function listCardHtml(list) {
  const { done, total } = progress(list);
  const people = list.people.map((person) => person.name).join(' · ');
  return `
    <button type="button" class="game-card" data-goto="#/list/${escapeHtml(list.id)}">
      <span class="game-card__title">
        ${escapeHtml(listTitle(list))}
        <span class="pill ${total && done === total ? 'pill--done' : ''}">
          ${escapeHtml(total ? t('lists.progress', { done, total }) : t('lists.empty'))}
        </span>
      </span>
      ${people ? `<span class="game-card__meta">${escapeHtml(people)}</span>` : ''}
      <span class="game-card__meta">${escapeHtml(formatDate(list.updatedAt))}</span>
    </button>`;
}

function listsView() {
  const sorted = [...state.lists].sort((a, b) => b.updatedAt - a.updatedAt);
  const open = sorted.filter((list) => progress(list).left > 0 || !list.items.length);
  const finished = sorted.filter((list) => list.items.length && progress(list).left === 0);

  return `
    ${flashHtml()}
    <button type="button" class="button button--primary button--block" data-goto="#/lists/new">
      + ${escapeHtml(t('lists.new'))}
    </button>

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('lists.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(listCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('lists.none'))}</p>`
      }
    </section>

    ${
      finished.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('lists.done'))}</h2></div>
             <div class="game-list">${finished.map(listCardHtml).join('')}</div>
           </section>`
        : ''
    }`;
}

function newListView() {
  const suggestions = [...new Set([...recentPeople(state.lists), ...recentNames(state.games)])].slice(0, 12);
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('lists.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/lists">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-list" class="card stack">
      <label>
        ${escapeHtml(t('lists.name'))}
        <input type="text" id="list-name" placeholder="${escapeHtml(t('lists.namePlaceholder'))}"
               value="${escapeHtml(newListName)}" required />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('lists.peopleHint'))}</span>
        ${newListPeople
          .map(
            (name, index) => `
              <input type="text" data-person-index="${index}" value="${escapeHtml(name)}"
                     placeholder="${escapeHtml(t('lists.person', { n: index + 1 }))}"
                     aria-label="${escapeHtml(t('lists.person', { n: index + 1 }))}" />`,
          )
          .join('')}
        <div class="row">
          <button type="button" class="button button--small" id="add-person">+ ${escapeHtml(t('lists.addPerson'))}</button>
          ${
            newListPeople.length > 1
              ? `<button type="button" class="button button--small button--ghost" id="drop-person">− ${escapeHtml(t('lists.dropPerson'))}</button>`
              : ''
          }
        </div>
        ${
          suggestions.length
            ? `<div class="row">${suggestions
                .map((name) => `<button type="button" class="chip" data-suggest="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
                .join('')}</div>`
            : ''
        }
      </div>

      <label>
        ${escapeHtml(t('lists.firstLines'))}
        <textarea id="list-lines" rows="5" placeholder="${escapeHtml(t('lists.firstLinesPlaceholder'))}">${escapeHtml(newListLines)}</textarea>
      </label>

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('lists.create'))}</button>
    </form>`;
}

function listItemHtml(list, item) {
  const who = personName(list, item.who);
  return `
    <li class="line ${item.done ? 'line--done' : ''}">
      <label class="line__tick">
        <input type="checkbox" data-tick="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''}
               aria-label="${escapeHtml(item.text)}" />
      </label>
      <button type="button" class="line__text" data-edit="${escapeHtml(item.id)}">
        <span>${escapeHtml(item.text)}</span>
      </button>
      <button type="button" class="line__who ${who ? '' : 'line__who--nobody'}" data-assign="${escapeHtml(item.id)}">
        ${escapeHtml(who || t('lists.nobody'))}
      </button>
    </li>`;
}

function listView(list) {
  const filter = state.listFilter;
  const known = filter === null || filter === 'none' || list.people.some((person) => person.id === filter);
  const shown = !known || filter === null
    ? list.items
    : list.items.filter((item) => (filter === 'none' ? !item.who : item.who === filter));
  const { done, total } = progress(list);

  const chip = (value, label, count) => `
    <button type="button" class="chip ${(!known ? null : filter) === value ? 'chip--on' : ''}" data-filter="${value === null ? '' : escapeHtml(value)}">
      ${escapeHtml(label)}${count === undefined ? '' : ` <span class="muted">${count}</span>`}
    </button>`;

  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(listTitle(list))}</h1>
        <p class="muted small">
          ${escapeHtml(total ? t('lists.progress', { done, total }) : t('lists.empty'))}
          ${list.shared ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/lists">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="add-line" class="card stack stack--tight">
      <label class="visually-hidden" for="new-line">${escapeHtml(t('lists.addLine'))}</label>
      <div class="row row--tight">
        <input type="text" id="new-line" placeholder="${escapeHtml(t('lists.addLine'))}" autocomplete="off" />
        <button type="submit" class="button button--primary">+</button>
      </div>
    </form>

    ${
      list.people.length
        ? `<div class="row">
             ${chip(null, t('lists.everyone'), progress(list).left)}
             ${list.people
               .map((person) => chip(person.id, person.name, progress(list, person.id).left))
               .join('')}
             ${chip('none', t('lists.nobody'), progress(list, null).left)}
           </div>`
        : ''
    }

    ${
      shown.length
        ? `<ul class="lines">${shown.map((item) => listItemHtml(list, item)).join('')}</ul>`
        : `<p class="muted small">${escapeHtml(list.items.length ? t('lists.nothingHere') : t('lists.addFirst'))}</p>`
    }

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        ${
          list.people.length
            ? `<button type="button" class="button button--small" id="share-out">${escapeHtml(t('lists.shareOut'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="list-people">${escapeHtml(t('lists.people'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="list-share">${escapeHtml(t('lists.share'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="list-text">${escapeHtml(t('action.recap'))}</button>
        ${
          done
            ? `<button type="button" class="button button--small" id="clear-done">${escapeHtml(t('lists.clearDone'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="list-reuse">${escapeHtml(t('lists.reuse'))}</button>
        <button type="button" class="button button--small button--ghost" id="list-rename">${escapeHtml(t('lists.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="list-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </section>`;
}

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
  if (name === 'stats') return { name: 'stats' };
  if (name === 'game' && param) return { name: 'game', id: param };
  if (name === 'set' && param) return { name: 'set', id: param };
  if (name === 'lists' && param === 'new') return { name: 'new-list' };
  if (name === 'lists') return { name: 'lists' };
  if (name === 'list' && param) return { name: 'list', id: param };
  if (name === 'polls' && param === 'new') return { name: 'new-poll' };
  if (name === 'polls') return { name: 'polls' };
  if (name === 'poll' && param) return { name: 'poll', id: param };
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
  const query = (state.search || '').trim().toLowerCase();
  const matches = (game) => {
    if (!query) return true;
    const preset = getPreset(game.presetId);
    const haystack = [gameTitle(game), preset ? presetLabel(preset) : '', ...game.players.map((p) => p.name)]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  };

  const sorted = [...state.games].sort((a, b) => b.updatedAt - a.updatedAt).filter(matches);
  const ongoing = sorted.filter((game) => !gameStatus(game).finished);
  const finished = sorted.filter((game) => gameStatus(game).finished);

  return `
    ${flashHtml()}
    <button type="button" class="button button--primary button--block" data-goto="#/new">
      + ${escapeHtml(t('action.newGame'))}
    </button>
    <div class="row">
      <button type="button" class="button button--small button--ghost" id="share-app">
        ${escapeHtml(t('action.shareApp'))}
      </button>
      ${
        state.games.length
          ? `<button type="button" class="button button--small button--ghost" data-goto="#/stats">${escapeHtml(t('action.stats'))}</button>`
          : ''
      }
    </div>

    ${
      state.games.length > 4
        ? `<label class="visually-hidden" for="search">${escapeHtml(t('home.search'))}</label>
           <input type="text" id="search" placeholder="${escapeHtml(t('home.search'))}" value="${escapeHtml(state.search || '')}" />`
        : ''
    }

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
        <button type="button" class="button button--small" id="import-paste">${escapeHtml(t('action.importPaste'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="open-link">${escapeHtml(t('action.openLink'))}</button>`
            : ''
        }
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
             <p class="muted small">${escapeHtml(t('data.autoShareHint'))}</p>
             <label for="share-key">${escapeHtml(t('data.shareKey'))}</label>
             <input type="password" id="share-key" autocomplete="off" spellcheck="false"
                    value="${escapeHtml(state.prefs.shareKey || '')}"
                    placeholder="${escapeHtml(t('data.shareKeyPlaceholder'))}" />
             <div class="row">
               <button type="button" class="button button--small" id="save-key">${escapeHtml(t('data.shareKeySave'))}</button>
               ${
                 lots().length
                   ? `<button type="button" class="button button--small" id="my-shares">${escapeHtml(t('lots.title', { count: lots().length }))}</button>`
                   : ''
               }
             </div>
             <p class="muted small" id="share-key-state">${escapeHtml(
               state.prefs.shareKey ? t('data.shareKeySet') : t('data.shareKeyHint'),
             )}</p>`
          : ''
      }
    </section>`;
}

function statsView() {
  const played = presetsPlayed(state.games);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('stats.title'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/">${escapeHtml(t('action.back'))}</button>
    </div>

    ${
      played.length
        ? played
            .map(({ presetId, played: count }) => {
              const preset = getPreset(presetId);
              const rows = statsFor(state.games, presetId);
              return `
                <section class="section card">
                  <div class="section__head">
                    <h2>${escapeHtml(preset ? presetLabel(preset) : presetId)}</h2>
                    <span class="muted small">${escapeHtml(t('stats.games', { count }))}</span>
                  </div>
                  <div class="table-wrap">
                    <table class="scores">
                      <thead>
                        <tr>
                          <th>${escapeHtml(t('new.players'))}</th>
                          <th>${escapeHtml(t('stats.played'))}</th>
                          <th>${escapeHtml(t('stats.won'))}</th>
                          <th>${escapeHtml(t('stats.average'))}</th>
                          <th>${escapeHtml(t('stats.best'))}</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${rows
                          .map(
                            (row) => `
                            <tr>
                              <td>${escapeHtml(row.name)}</td>
                              <td>${row.played}</td>
                              <td>${row.won}</td>
                              <td>${row.average}</td>
                              <td>${row.best}</td>
                            </tr>`,
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                </section>`;
            })
            .join('')
        : `<p class="muted small">${escapeHtml(t('stats.empty'))}</p>`
    }

    <p class="notes">${escapeHtml(t('stats.note'))}</p>`;
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

  const known = recentNames(state.games);
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

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('results.title'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small" id="recap">${escapeHtml(t('action.recap'))}</button>
        ${
          EXPORT_MODE === 'download'
            ? `<button type="button" class="button button--small" id="export-docx">${escapeHtml(t('action.exportDocx'))}</button>
               <button type="button" class="button button--small" id="export-pdf">${escapeHtml(t('action.exportPdf'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="replay">${escapeHtml(t('action.replay'))}</button>
      </div>
    </section>

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
 * A dialog made for one use. It takes itself off the page when it closes —
 * including when Escape closes it, which is the case that otherwise leaves
 * orphans behind: duplicate ids, and radio buttons quietly sharing a group
 * with the dialog opened before them.
 */
function makeDialog(className = 'dialog') {
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
function ask(message, { confirmLabel, danger = false } = {}) {
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

function exportGames() {
  const json = JSON.stringify(
    { version: 1, games: state.games, lists: state.lists, polls: state.polls }, null, 2,
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

function showCopyDialog({ title, hint, text: content, qr = false, code = null, send = false }) {
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
        <textarea id="export-text" readonly rows="8"></textarea>
        <div class="row">
          <button type="button" class="button button--primary" id="export-copy"></button>
          <button type="button" class="button" id="export-send" hidden></button>
          <button type="button" class="button" id="export-close"></button>
        </div>
      </div>`;
    document.body.append(dialog);

    dialog.querySelector('#export-close').addEventListener('click', () => dialog.close());
    // Sending hands over the link, never the code: the code travels by another
    // route, or the two together in one message would protect nothing.
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
  const svg = qr ? qrFor(content) : null;
  image.innerHTML = svg || '';
  image.hidden = !svg;
  if (svg) image.setAttribute('aria-label', t('share.qrLabel'));
  const box = dialog.querySelector('#export-code');
  box.hidden = !code;
  if (code) {
    dialog.querySelector('#export-code-label').textContent = t('shareSet.codeLabel');
    dialog.querySelector('#export-code-value').textContent = code;
    dialog.querySelector('#export-code-hint').textContent = t('shareSet.codeApart');
  }

  const sendButton = dialog.querySelector('#export-send');
  sendButton.hidden = !(send && navigator.share);
  sendButton.textContent = t('shareSet.send');

  dialog.querySelector('#export-copy').textContent = t('action.copy');
  dialog.querySelector('#export-close').textContent = t('action.close');
  dialog.showModal();
}

/**
 * Take in an export, from wherever it came. Games already here are left
 * alone — importing twice must not double everything.
 */
function importGames(source) {
  let parsed = null;
  try {
    parsed = JSON.parse(source);
  } catch {
    flash(t('home.importFailed'), 'error');
    return false;
  }

  const all = Array.isArray(parsed)
    ? parsed
    : [...(parsed?.games || []), ...(parsed?.lists || []), ...(parsed?.polls || [])];
  const games = all.filter(isValidGame);
  const lists = all.filter(isValidList);
  const polls = all.filter(isValidPoll);
  if (!games.length && !lists.length && !polls.length) {
    flash(t('home.importFailed'), 'error');
    return false;
  }

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

  for (const document_ of [...freshGames, ...freshLists, ...freshPolls]) {
    if (state.store) void state.store.save(document_);
    if (state.remote && document_.shared) state.remote.put(document_).catch(() => {});
  }
  flash(t('home.importDone', { count: freshGames.length + freshLists.length + freshPolls.length }));
  return true;
}

/**
 * Paste an export in. A phone cannot easily hand a file to a web page, and an
 * app installed on the home screen keeps its own storage — so this is how
 * games move from one to the other.
 */
function openPasteDialog() {
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
function openLinkDialog() {
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
async function shareUrl({ url, title, hint, text }) {
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
  showCopyDialog({ title, hint, text: url, qr: true });
}

/* ------------------------------------------------------------------- lots --- */

/**
 * The lots shared from this device, newest first. Their codes are kept so a
 * code can be read again later, and so a lot can be revoked — both of which
 * are the point of the sharing key: the shares stay in one pair of hands.
 */
function lots() {
  const value = state.prefs.lots;
  return Array.isArray(value) ? value.filter((lot) => lot && typeof lot.id === 'string') : [];
}

/**
 * Remembered shares are kept generously: the entry is the only record of a
 * lot's id and its code, so dropping one leaves a live share that can never be
 * read again nor revoked. Two hundred of them weigh some twenty kilobytes, and
 * nobody shares two hundred times.
 */
const LOTS_KEPT = 200;

function rememberLot(lot) {
  state.prefs = { ...state.prefs, lots: [lot, ...lots()].slice(0, LOTS_KEPT) };
  savePrefs(state.prefs);
}

function forgetLot(id) {
  state.prefs = { ...state.prefs, lots: lots().filter((lot) => lot.id !== id) };
  savePrefs(state.prefs);
}

/** Why the database refused, in words that say what to do about it. */
function remoteReason(error) {
  const text = String(error?.message || '');
  if (error?.status === 404 || /PGRST202/.test(text)) return t('shareApp.needsUpdate');
  if (/cle de partage/i.test(text)) return t('shareApp.badKey');
  return t('shareApp.failed');
}

/* --------------------------------------------------------- sharing the app --- */

/**
 * Share the app, on its own or carrying games.
 *
 * A link cannot carry the games themselves: ten of them would make an address
 * no one could paste and no QR code could hold. So the games are sent to the
 * shared database — which is what makes them openable elsewhere anyway — and
 * the link carries one short identifier standing for the lot.
 *
 * A lot is not something anyone may create: the database asks for the sharing
 * key first, and that key lives only on the devices its holder typed it into.
 * Opening one asks the receiver for a six-digit code, drawn afresh for every
 * share — so a link passed on to someone else is worth nothing on its own.
 */
function openShareAppDialog() {
  // Games and lists travel together: they are documents of the same kind to
  // the database, and "everything I have" is what the link is asked for.
  const games = [...state.games, ...state.lists, ...state.polls].sort((a, b) => b.updatedAt - a.updatedAt);
  const key = state.prefs.shareKey || '';
  // Without a shared database there is nothing to attach: the app alone, then.
  if (!state.remote || !games.length) {
    void shareUrl({
      url: appLink(),
      title: t('shareApp.title'),
      hint: t('shareApp.hint'),
      text: t('shareApp.text'),
    });
    return;
  }

  const off = key ? '' : ' disabled';
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('shareApp.title'))}</h2>
      <div class="stack stack--tight" role="radiogroup" aria-label="${escapeHtml(t('shareApp.title'))}">
        <label class="choice">
          <input type="radio" name="share-kind" value="app" checked />
          <span>${escapeHtml(t('shareApp.kindApp'))}<span class="muted small"> — ${escapeHtml(t('shareApp.kindAppHint'))}</span></span>
        </label>
        <label class="choice${key ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="all"${off} />
          <span>${escapeHtml(t('shareApp.kindAll', { count: games.length }))}</span>
        </label>
        <label class="choice${key ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="some"${off} />
          <span>${escapeHtml(t('shareApp.kindSome'))}</span>
        </label>
      </div>

      ${key ? '' : `<p class="banner">${escapeHtml(t('shareApp.needsKey'))}</p>`}

      <div class="stack stack--tight" id="share-pick" hidden>
        <p class="muted small">${escapeHtml(t('shareApp.pickHint'))}</p>
        ${games
          .map(
            (game) => `
              <label class="choice">
                <input type="checkbox" data-share-id="${escapeHtml(game.id)}" />
                <span>${escapeHtml(documentTitle(game))}<span class="muted small"> — ${escapeHtml(formatDate(game.updatedAt))}</span></span>
              </label>`,
          )
          .join('')}
      </div>

      <p class="muted small" id="share-note" hidden>${escapeHtml(t('shareApp.note'))}</p>
      <p class="banner banner--warn" id="share-error" hidden></p>
      <div class="row">
        <button type="button" class="button button--primary" id="share-make">${escapeHtml(t('shareApp.make'))}</button>
        <button type="button" class="button" id="share-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </div>`;

  const close = () => dialog.close();
  const button = dialog.querySelector('#share-make');
  const error = dialog.querySelector('#share-error');
  const kind = () => dialog.querySelector('input[name="share-kind"]:checked').value;

  const refresh = () => {
    dialog.querySelector('#share-pick').hidden = kind() !== 'some';
    dialog.querySelector('#share-note').hidden = kind() === 'app';
    error.hidden = true;
  };
  dialog.querySelectorAll('input[name="share-kind"]').forEach((input) => {
    input.addEventListener('change', refresh);
  });

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = t('shareApp.make');
  };

  dialog.querySelector('#share-cancel').addEventListener('click', close);
  button.addEventListener('click', async () => {
    const choice = kind();
    if (choice === 'app') {
      close();
      void shareUrl({
        url: appLink(),
        title: t('shareApp.title'),
        hint: t('shareApp.hint'),
        text: t('shareApp.text'),
      });
      return;
    }

    const chosen =
      choice === 'all'
        ? games
        : [...dialog.querySelectorAll('input[data-share-id]:checked')]
            .map((input) =>
              getGame(input.dataset.shareId) || getList(input.dataset.shareId) || getPoll(input.dataset.shareId))
            .filter(Boolean);
    if (!chosen.length) return fail(t('shareApp.pickNone'));

    button.disabled = true;
    button.textContent = t('share.sending');

    const setId = uid('lot');
    const code = newCode();
    const ids = chosen.map((game) => game.id);
    try {
      // The key first, and only then the games: a key the database no longer
      // recognises must not cost an evening its privacy on the way to being
      // told so.
      if (!(await state.remote.isOwner(key))) return fail(t('shareApp.badKey'));
      // Sealed where the browser can: then the stored lot holds no game
      // identifier at all, only their encrypted form.
      const contents = canSeal() ? { sealed: await seal(ids, code) } : { ids };
      await shareGames(chosen);
      await state.remote.putSet(setId, contents, code, key);
    } catch (error_) {
      return fail(remoteReason(error_));
    }

    rememberLot({ id: setId, code, count: chosen.length, createdAt: Date.now() });
    close();
    // The games are shared now, and the share is remembered: the list shows it.
    render();
    showLotLink(setId, code, chosen.length);
  });

  dialog.showModal();
}

/**
 * The link and its code, side by side but never in the same message: the link
 * is what gets sent, the code is what is said out loud. Copying the link alone
 * is what the button does, on purpose.
 */
function showLotLink(setId, code, count) {
  showCopyDialog({
    title: t('shareSet.title'),
    hint: t('shareSet.hint', { count }),
    text: setLink(location, setId),
    qr: true,
    code,
    send: true,
  });
}

/**
 * Put every one of these games in the shared database, marking as shared those
 * that were not — a link that hands over a game no one sent would open nothing.
 */
async function shareGames(games) {
  try {
    for (const document_ of games) {
      const next = document_.shared
        ? document_
        : { ...document_, shared: true, updatedAt: Date.now() };
      await state.remote.put(next);
      if (next === document_) continue;
      state.games = state.games.map((item) => (item.id === next.id ? next : item));
      state.lists = state.lists.map((item) => (item.id === next.id ? next : item));
      state.polls = state.polls.map((item) => (item.id === next.id ? next : item));
      if (state.store) void state.store.save(next);
    }
  } finally {
    // Whatever went through is written down, so a failure halfway is not lost.
    saveGames(state.games);
    saveLists(state.lists);
    savePolls(state.polls);
  }
}

/* --------------------------------------------------------- my own shares --- */

/**
 * The shares made from this device: their code, to read again, and a way to
 * revoke them. Revoking takes the sharing key, so a link handed out can be
 * taken back — by its author, and by nobody else.
 */
function openMySharesDialog() {
  const dialog = makeDialog();
  const close = () => dialog.close();

  const draw = () => {
    const mine = lots();
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('lots.title', { count: mine.length }))}</h2>
        <p class="muted small">${escapeHtml(t('lots.hint'))}</p>
        <p class="banner banner--warn" id="lots-error" hidden></p>
        ${
          mine.length
            ? `<div class="stack stack--tight">${mine
                .map(
                  (lot) => `
                    <div class="lot">
                      <div>
                        <span class="lot__code">${escapeHtml(lot.code || '······')}</span>
                        <span class="muted small">${escapeHtml(t('lots.line', {
                          count: lot.count || 0,
                          date: formatDate(lot.createdAt || Date.now()),
                        }))}</span>
                      </div>
                      <div class="row">
                        <button type="button" class="button button--small" data-lot-link="${escapeHtml(lot.id)}">${escapeHtml(t('lots.link'))}</button>
                        <button type="button" class="button button--small button--ghost" data-lot-revoke="${escapeHtml(lot.id)}">${escapeHtml(t('lots.revoke'))}</button>
                      </div>
                    </div>`,
                )
                .join('')}</div>`
            : `<p class="muted small">${escapeHtml(t('lots.empty'))}</p>`
        }
        <div class="row">
          <button type="button" class="button" id="lots-close">${escapeHtml(t('action.close'))}</button>
        </div>
      </div>`;

    dialog.querySelector('#lots-close').addEventListener('click', close);

    dialog.querySelectorAll('[data-lot-link]').forEach((node) => {
      node.addEventListener('click', () => {
        const lot = lots().find((item) => item.id === node.dataset.lotLink);
        if (lot) showLotLink(lot.id, lot.code, lot.count || 0);
      });
    });

    dialog.querySelectorAll('[data-lot-revoke]').forEach((node) => {
      node.addEventListener('click', async () => {
        const id = node.dataset.lotRevoke;
        if (!(await ask(t('lots.confirmRevoke'), { confirmLabel: t('lots.revoke'), danger: true }))) return;
        node.disabled = true;
        node.textContent = t('share.sending');
        let gone = false;
        try {
          gone = await state.remote.forgetSet(id, state.prefs.shareKey || '');
        } catch (error) {
          const line = dialog.querySelector('#lots-error');
          line.textContent = remoteReason(error);
          line.hidden = false;
          node.disabled = false;
          node.textContent = t('lots.revoke');
          return;
        }
        // Not there any more either way: stop remembering it.
        forgetLot(id);
        draw();
        if (!gone) {
          const line = dialog.querySelector('#lots-error');
          line.textContent = t('lots.alreadyGone');
          line.hidden = false;
        }
        render();
      });
    });
  };

  draw();
  dialog.showModal();
}

/* ------------------------------------------------- opening a shared lot --- */

/**
 * Ask for the six-digit code, and give back the game ids it unlocks.
 *
 * The database allows ten wrong answers, then closes that lot for good — which
 * is what makes six digits enough to be worth typing. Resolves null when the
 * person gives up, or when the answer leaves nothing to try again with.
 */
function askLotCode(id) {
  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('shareSet.codeTitle'))}</h2>
        <p class="muted small">${escapeHtml(t('shareSet.codeHint'))}</p>
        <input type="text" id="lot-code" class="code-input" inputmode="numeric" autocomplete="one-time-code"
               maxlength="7" aria-label="${escapeHtml(t('shareSet.codeTitle'))}" />
        <p class="banner banner--warn" id="lot-error" hidden></p>
        <div class="row">
          <button type="button" class="button button--primary" id="lot-open">${escapeHtml(t('openLink.open'))}</button>
          <button type="button" class="button" id="lot-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    const button = dialog.querySelector('#lot-open');
    const error = dialog.querySelector('#lot-error');
    const done = (value) => { resolve(value); dialog.close(); };
    // Escape closes a dialog without asking anyone: whoever is waiting on this
    // promise must be told, or the view stays on "fetching" for good.
    dialog.addEventListener('close', () => resolve(null));
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = t('openLink.open');
      dialog.querySelector('#lot-code').select();
    };

    dialog.querySelector('#lot-cancel').addEventListener('click', () => done(null));
    button.addEventListener('click', async () => {
      const code = readCode(dialog.querySelector('#lot-code').value);
      if (!code) return fail(t('shareSet.badCode'));

      button.disabled = true;
      button.textContent = t('share.sending');

      let answer = null;
      try {
        answer = await state.remote.openSet(id, code);
      } catch (error_) {
        return fail(remoteReason(error_));
      }

      if (answer.status === 'wrong') return fail(t('shareSet.wrongCode', { left: answer.left }));
      if (answer.status === 'locked') {
        flash(t('shareSet.locked'), 'error');
        return done(null);
      }
      if (answer.status !== 'ok') {
        flash(t('shareSet.notFound'), 'error');
        return done(null);
      }

      const ids = answer.contents?.sealed
        ? await unseal(answer.contents.sealed, code)
        : answer.contents?.ids;
      const clean = Array.isArray(ids) ? ids.filter((value) => typeof value === 'string') : [];
      // The code was right, so a lot that will not open is a lot this browser
      // cannot unseal — over http, where Web Crypto is not offered.
      if (!clean.length) return fail(t('shareSet.cannotUnseal'));
      done(clean);
    });

    dialog.showModal();
    dialog.querySelector('#lot-code').focus();
  });
}

/**
 * Take in a lot of games from its link: the code, then the list, then each
 * game.
 *
 * A game already here is merged rather than replaced, exactly as a single
 * shared game is, so opening the link twice costs nothing and opening it while
 * a game is in progress loses no round.
 */
async function openSet(id) {
  if (!state.remote) {
    flash(t('shareSet.noDatabase'), 'error');
    return;
  }

  const ids = await askLotCode(id);
  if (!ids) return;

  // Everything, even what is already here: the point of a lot shared again is
  // to bring what has happened since, and pulling merges rather than replaces.
  for (const id_ of ids) await pullAny(id_);

  const held = ids.filter((id_) => getGame(id_) || getList(id_) || getPoll(id_)).length;
  if (!held) {
    flash(t('shareSet.notFound'), 'error');
    return;
  }
  flash(
    held === ids.length
      ? t('shareSet.opened', { count: held })
      : t('shareSet.openedSome', { count: held, total: ids.length }),
  );
}

function bindHome() {
  const search = view.querySelector('#search');
  search?.addEventListener('input', (event) => {
    state.search = event.target.value;
    const at = event.target.selectionStart;
    render();
    const again = view.querySelector('#search');
    if (again) {
      again.focus();
      try { again.setSelectionRange(at, at); } catch { /* not a text field */ }
    }
  });

  view.querySelector('#share-app')?.addEventListener('click', openShareAppDialog);

  // Enter does what the button does: a field that answers nothing reads as broken.
  view.querySelector('#share-key')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    view.querySelector('#save-key')?.click();
  });

  view.querySelector('#save-key')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const field = view.querySelector('#share-key');
    const line = view.querySelector('#share-key-state');
    const key = field.value.trim();

    state.prefs = { ...state.prefs, shareKey: key };
    savePrefs(state.prefs);

    if (!key) {
      line.textContent = t('data.shareKeyCleared');
      return;
    }

    // Say whether the database recognises it, rather than leaving it to be
    // found out at the worst moment — when a link is being created.
    button.disabled = true;
    line.textContent = t('data.shareKeyChecking');
    let good = false;
    try {
      good = await state.remote.isOwner(key);
    } catch {
      good = null; // could not ask
    }
    button.disabled = false;
    line.textContent =
      good === true ? t('data.shareKeyGood') : good === false ? t('data.shareKeyBad') : t('data.shareKeyUnsure');
  });

  view.querySelector('#my-shares')?.addEventListener('click', openMySharesDialog);

  view.querySelector('#auto-share')?.addEventListener('change', (event) => {
    state.prefs = { ...state.prefs, autoShare: event.target.checked };
    savePrefs(state.prefs);
  });

  view.querySelector('#export')?.addEventListener('click', exportGames);

  view.querySelector('#import-paste')?.addEventListener('click', openPasteDialog);
  view.querySelector('#open-link')?.addEventListener('click', openLinkDialog);

  const fileInput = view.querySelector('#import-file');
  view.querySelector('#import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      importGames(await file.text());
    } catch {
      flash(t('home.importFailed'), 'error');
    }
    render();
  });
}

/* ------------------------------------------------------- lists: behaviour --- */

/** Keep the list where it lives, and send it on if it has been shared. */
function persistList(changed) {
  const ok = saveLists(state.lists);
  if (!ok && !state.store && !state.remote) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed).catch(() => flash(t('share.pushFailed'), 'error'));
  }
  return ok;
}

function getList(id) {
  return state.lists.find((list) => list.id === id) || null;
}

/** Put a changed list back in place, write it down, and redraw. */
function replaceList(next, { redraw = true } = {}) {
  state.lists = state.lists.map((list) => (list.id === next.id ? next : list));
  persistList(next);
  if (redraw) render();
}

function bindNewList() {
  const form = view.querySelector('#new-list');
  if (!form) return;

  const snapshot = () => {
    newListName = view.querySelector('#list-name').value;
    newListLines = view.querySelector('#list-lines').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      newListPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    newListPeople = [...newListPeople, ''];
    render();
    view.querySelector(`[data-person-index="${newListPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    newListPeople = newListPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (newListPeople.includes(suggest)) return;
      const empty = newListPeople.findIndex((name) => !name.trim());
      if (empty >= 0) newListPeople[empty] = suggest;
      else newListPeople = [...newListPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();

    let list = createList({
      name: newListName,
      names: newListPeople,
      // A device that sends everything by choice sends its lists too.
      shared: Boolean(state.prefs.autoShare && state.remote),
    });
    list = addItems(list, newListLines);

    state.lists = [...state.lists, list];
    persistList(list);
    newListName = '';
    newListPeople = ['', ''];
    newListLines = '';
    navigate(`#/list/${list.id}`);
  });
}

function bindList(list) {
  view.querySelector('#add-line')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = view.querySelector('#new-line');
    const next = addItems(list, field.value);
    if (next === list) return;
    replaceList(next);
    // Straight back to the field: a list is written in one go, not one
    // reopened dialog at a time.
    const again = view.querySelector('#new-line');
    again?.focus();
  });

  view.querySelectorAll('[data-tick]').forEach((box) => {
    box.addEventListener('change', () => replaceList(toggleItem(list, box.dataset.tick)));
  });

  view.querySelectorAll('[data-assign]').forEach((button) => {
    button.addEventListener('click', () => openAssignDialog(list, button.dataset.assign));
  });

  view.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => openLineDialog(list, button.dataset.edit));
  });

  view.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const { filter } = chip.dataset;
      state.listFilter = filter === '' ? null : filter;
      render();
    });
  });

  view.querySelector('#share-out')?.addEventListener('click', () => {
    const next = shareOut(list);
    if (next === list) {
      // Saying nothing here would read as a dead button.
      flash(t('lists.nothingToShareOut'));
      render();
      return;
    }
    replaceList(next);
  });

  view.querySelector('#list-people')?.addEventListener('click', () => openPeopleDialog(list));

  view.querySelector('#list-text')?.addEventListener('click', () => {
    showCopyDialog({
      title: listTitle(list),
      hint: t('lists.textHint'),
      text: listText(list),
    });
  });

  view.querySelector('#clear-done')?.addEventListener('click', async () => {
    if (!(await ask(t('lists.confirmClearDone'), { confirmLabel: t('lists.clearDone'), danger: true }))) return;
    const next = list.items.filter((item) => item.done).reduce((carry, item) => removeItem(carry, item.id), list);
    replaceList(next);
  });

  view.querySelector('#list-reuse')?.addEventListener('click', () => {
    const next = reuseList(list);
    state.lists = [...state.lists, next];
    persistList(next);
    navigate(`#/list/${next.id}`);
  });

  view.querySelector('#list-rename')?.addEventListener('click', () => openListNameDialog(list));

  view.querySelector('#list-delete')?.addEventListener('click', async () => {
    if (!(await ask(t('lists.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.lists = state.lists.filter((item) => item.id !== list.id);
    saveLists(state.lists);
    if (state.store) void state.store.remove(list.id);
    if (state.remote) state.remote.remove(list.id).catch(() => {});
    navigate('#/lists');
  });

  view.querySelector('#list-share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let current = list;

    if (!current.shared) {
      button.disabled = true;
      button.textContent = t('share.sending');
      current = { ...current, shared: true, updatedAt: Date.now() };
      try {
        await state.remote.put(current);
      } catch {
        button.disabled = false;
        button.textContent = t('lists.share');
        flash(t('share.sendFailed'), 'error');
        render();
        return;
      }
      replaceList(current);
    }

    showCopyDialog({
      title: t('lists.shareTitle'),
      hint: t('lists.shareHint'),
      text: listLink(location, current.id),
      qr: true,
    });
  });
}

/** Hand a line to someone, or take it back. */
function openAssignDialog(list, itemId) {
  const item = list.items.find((entry) => entry.id === itemId);
  if (!item) return;

  const dialog = makeDialog('dialog dialog--ask');
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('lists.assignTitle'))}</h2>
      <p class="muted small">${escapeHtml(item.text)}</p>
      <div class="stack stack--tight">
        ${list.people
          .map(
            (person) => `
              <button type="button" class="button button--block" data-who="${escapeHtml(person.id)}">
                ${escapeHtml(person.name)}${item.who === person.id ? ' ✓' : ''}
              </button>`,
          )
          .join('')}
        <button type="button" class="button button--block" data-who="">
          ${escapeHtml(t('lists.nobody'))}${item.who ? '' : ' ✓'}
        </button>
      </div>
      <div class="row">
        <button type="button" class="button" id="assign-cancel">${escapeHtml(t('action.cancel'))}</button>
        <button type="button" class="button button--ghost" id="assign-people">${escapeHtml(t('lists.people'))}</button>
      </div>
    </div>`;

  dialog.querySelector('#assign-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#assign-people').addEventListener('click', () => {
    dialog.close();
    openPeopleDialog(list);
  });
  dialog.querySelectorAll('[data-who]').forEach((button) => {
    button.addEventListener('click', () => {
      dialog.close();
      replaceList(assignItem(list, itemId, button.dataset.who || null));
    });
  });

  dialog.showModal();
}

/** Correct a line, or drop it. */
function openLineDialog(list, itemId) {
  const item = list.items.find((entry) => entry.id === itemId);
  if (!item) return;

  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('lists.lineTitle'))}</h2>
      <label class="visually-hidden" for="line-text">${escapeHtml(t('lists.lineTitle'))}</label>
      <input type="text" id="line-text" value="${escapeHtml(item.text)}" />
      <div class="row">
        <button type="button" class="button button--primary" id="line-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="line-cancel">${escapeHtml(t('action.cancel'))}</button>
        <button type="button" class="button button--danger" id="line-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#line-text');
  const save = () => {
    dialog.close();
    replaceList(renameItem(list, itemId, field.value));
  };

  dialog.querySelector('#line-save').addEventListener('click', save);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save();
  });
  dialog.querySelector('#line-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#line-delete').addEventListener('click', () => {
    dialog.close();
    replaceList(removeItem(list, itemId));
  });

  dialog.showModal();
  field.focus();
  field.select();
}

/** Who this list concerns: add, rename, remove. */
function openPeopleDialog(list) {
  const dialog = makeDialog();

  const draw = () => {
    const current = getList(list.id) || list;
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('lists.people'))}</h2>
        <p class="muted small">${escapeHtml(t('lists.peopleHint'))}</p>
        <div class="stack stack--tight">
          ${current.people
            .map(
              (person) => `
                <div class="row row--tight">
                  <input type="text" data-person="${escapeHtml(person.id)}" value="${escapeHtml(person.name)}"
                         aria-label="${escapeHtml(person.name)}" />
                  <button type="button" class="button button--small button--ghost" data-remove="${escapeHtml(person.id)}">
                    ${escapeHtml(t('action.delete'))}
                  </button>
                </div>`,
            )
            .join('')}
          ${current.people.length ? '' : `<p class="muted small">${escapeHtml(t('lists.nobodyYet'))}</p>`}
        </div>
        <div class="row row--tight">
          <input type="text" id="person-new" placeholder="${escapeHtml(t('lists.addPerson'))}"
                 aria-label="${escapeHtml(t('lists.addPerson'))}" />
          <button type="button" class="button button--primary" id="person-add">+</button>
        </div>
        <div class="row">
          <button type="button" class="button" id="people-close">${escapeHtml(t('action.close'))}</button>
        </div>
      </div>`;

    const field = dialog.querySelector('#person-new');
    const add = () => {
      const next = addListPerson(getList(list.id) || list, field.value);
      replaceList(next, { redraw: false });
      draw();
      dialog.querySelector('#person-new').focus();
    };
    dialog.querySelector('#person-add').addEventListener('click', add);
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });

    dialog.querySelectorAll('[data-person]').forEach((input) => {
      input.addEventListener('change', () => {
        replaceList(renameListPerson(getList(list.id) || list, input.dataset.person, input.value), { redraw: false });
      });
    });

    dialog.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!(await ask(t('lists.confirmRemovePerson'), { confirmLabel: t('action.delete'), danger: true }))) return;
        replaceList(removeListPerson(getList(list.id) || list, button.dataset.remove), { redraw: false });
        draw();
      });
    });

    dialog.querySelector('#people-close').addEventListener('click', () => dialog.close());
  };

  // The view behind is only redrawn once, when the dialog is done with.
  dialog.addEventListener('close', () => render());
  draw();
  dialog.showModal();
}

function openListNameDialog(list) {
  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('lists.rename'))}</h2>
      <label class="visually-hidden" for="list-new-name">${escapeHtml(t('lists.name'))}</label>
      <input type="text" id="list-new-name" value="${escapeHtml(list.name)}" />
      <div class="row">
        <button type="button" class="button button--primary" id="name-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="name-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#list-new-name');
  const save = () => {
    dialog.close();
    replaceList({ ...list, name: field.value.trim(), updatedAt: Date.now() });
  };
  dialog.querySelector('#name-save').addEventListener('click', save);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save();
  });
  dialog.querySelector('#name-cancel').addEventListener('click', () => dialog.close());

  dialog.showModal();
  field.focus();
  field.select();
}

/** The list as text, to paste into a message. */
function listText(list) {
  const line = (item) =>
    `${item.done ? '[x]' : '[ ]'} ${item.text}${item.who ? ` — ${personName(list, item.who)}` : ''}`;
  const { done, total } = progress(list);
  return [
    listTitle(list),
    t('lists.progress', { done, total }),
    '',
    ...list.items.map(line),
  ].join('\n');
}

/**
 * Fetch a list from the shared database and take what it knows — the same
 * merge a game gets, for the same reason: two people tick at the same time.
 */
async function pullList(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  return isValidList(stored) ? adoptList(stored) : false;
}

/** The same, for a list: line by line, so nobody's tick is lost. */
function adoptList(stored) {
  const local = getList(stored.id);
  const merged = local ? mergeLists(local, stored) : stored;
  if (local && merged === local) return false;

  const adopted = { ...merged, shared: true };
  state.lists = local
    ? state.lists.map((list) => (list.id === stored.id ? adopted : list))
    : [...state.lists, adopted];
  saveLists(state.lists);
  return true;
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

/** Hand the viewer a file. Where the page is not allowed to, nothing happens. */
function download(filename, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  markTab(current);
  if (current.name === 'lists') {
    stopWatching();
    view.innerHTML = listsView();
  } else if (current.name === 'new-list') {
    stopWatching();
    view.innerHTML = newListView();
    bindNewList();
  } else if (current.name === 'list') {
    const list = getList(current.id);
    if (!list) {
      stopWatching();
      // Perhaps a list someone shared: ask the database before giving up.
      if (state.remote) {
        view.innerHTML = `<p class="muted small">${escapeHtml(t('lists.loading'))}</p>`;
        // A redraw while it is on its way must not ask for it twice.
        if (state.openingList !== current.id) {
          const asked = current.id;
          state.openingList = asked;
          pullList(asked).then((found) => {
            if (state.openingList !== asked) return;
            state.openingList = null;
            if (found) render();
            else if (route().id === asked) navigate('#/lists');
          });
        }
        return;
      }
      navigate('#/lists');
      return;
    }
    watchList(list.id);
    view.innerHTML = listView(list);
    bindList(list);
  } else if (current.name === 'polls') {
    stopWatching();
    view.innerHTML = pollsView();
  } else if (current.name === 'new-poll') {
    stopWatching();
    view.innerHTML = newPollView();
    bindNewPoll();
  } else if (current.name === 'poll') {
    const poll = getPoll(current.id);
    if (!poll) {
      stopWatching();
      if (state.remote) {
        view.innerHTML = `<p class="muted small">${escapeHtml(t('polls.loading'))}</p>`;
        if (state.openingPoll !== current.id) {
          const asked = current.id;
          state.openingPoll = asked;
          pullPoll(asked).then((found) => {
            if (state.openingPoll !== asked) return;
            state.openingPoll = null;
            if (found) render();
            else if (route().id === asked) navigate('#/polls');
          });
        }
        return;
      }
      navigate('#/polls');
      return;
    }
    watchPoll(poll.id);
    view.innerHTML = pollView(poll);
    bindPoll(poll);
  } else if (current.name === 'stats') {
    stopWatching();
    view.innerHTML = statsView();
  } else if (current.name === 'new') {
    stopWatching();
    view.innerHTML = newGameView();
    bindNewGame();
  } else if (current.name === 'set') {
    stopWatching();
    view.innerHTML = `<p class="muted small">${escapeHtml(t('shareSet.loading'))}</p>`;
    // A redraw while the games are on their way must not fetch them twice.
    if (state.openingSet !== current.id) {
      const asked = current.id;
      state.openingSet = asked;
      openSet(asked).then(() => {
        // Another lot may have been asked for meanwhile: that one is now the
        // one in flight, and neither its guard nor its view is ours to clear.
        if (state.openingSet !== asked) return;
        state.openingSet = null;
        // Somewhere else by now: leave them there, the games are in the list.
        if (route().name === 'set') navigate('#/');
      });
    }
    return;
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
  return isValidGame(stored) ? adoptGame(stored) : false;
}

/**
 * Take in a game the database handed over. Merge rather than replace: two
 * people scoring the same evening on two phones would otherwise lose whichever
 * round was written second.
 */
function adoptGame(stored) {
  const local = getGame(stored.id);
  const merged = local ? mergeGames(local, stored) : stored;
  if (local && merged === local) return false;

  const adopted = { ...merged, shared: true };
  state.games = local
    ? state.games.map((game) => (game.id === stored.id ? adopted : game))
    : [...state.games, adopted];
  saveGames(state.games);
  return true;
}

/** Which half of the app we are in, so the tab bar says so. */
function markTab(current) {
  const bar = document.getElementById('tabs');
  if (!bar) return;
  const here = ['lists', 'new-list', 'list'].includes(current.name)
    ? 'lists'
    : ['polls', 'new-poll', 'poll'].includes(current.name)
      ? 'polls'
      : 'games';
  bar.querySelectorAll('[data-tab]').forEach((tab) => {
    if (tab.dataset.tab === here) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

/**
 * Fetch by identifier without being told what it is: a lot holds games and
 * lists side by side, and a link pasted in says even less.
 */
async function pullAny(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  // One request, then whichever kind it turns out to be — a lot of twenty
  // would otherwise cost forty.
  if (isValidGame(stored)) return adoptGame(stored);
  if (isValidList(stored)) return adoptList(stored);
  if (isValidPoll(stored)) return adoptPoll(stored);
  return false;
}

/** While a shared list is on screen, watch for what the others are ticking. */
function watchList(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy()) return;
    if (await pullList(id)) render();
  }, 5000);
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
  state.listFilter = null;
  render();
});
/**
 * Register the cache that makes the app open without a network. It is absent
 * from a file opened off the disk and from a page served without https, and
 * the app must not care either way.
 */
function registerOfflineCache() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  // The served app carries a manifest; the single-file build has it stripped,
  // and has no sw.js beside it to register either.
  if (!document.querySelector('link[rel="manifest"]')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // No offline cache, then: everything else still works.
    });
  });
}

adoptOlderGames();
render();
connectToStore();
registerOfflineCache();
