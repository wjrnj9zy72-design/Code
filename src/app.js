/** UI layer: hash router, views, event wiring. */

import { PRESETS, PRESET_GROUPS, getPreset, presetConfig } from './games.js';
import { createGame, addRound, updateRound, removeRound, renamePlayer, setFinished, setShared, replayGame, dealerFor, recentNames, mergeGames, isValidGame, uid, archiveGame } from './model.js';
import { gameStatus, roundScore, totals, validateRound, completingScore } from './scoring.js';
import { emptyHelperEntry, tapCard, undoCard, toggleSwitch, cardCount, helperTotal, isEmptyEntry , inAppBrowser } from './helpers.js';
import { CONTRACTS, POIGNEES, CHELEMS, THRESHOLDS, TOTAL_POINTS, scoreDeal, isCompleteDeal } from './tarot.js';
import { presetsPlayed, statsFor, sameName } from './stats.js';
import { recapText } from './recap.js';
import { buildDocx } from './export-docx.js';
import { buildPdf } from './export-pdf.js';
import { qrSvg, qrMatrix } from './qr.js';
import { icsFor, pollEvent, agendaFor, eventName } from './ics.js';
import {
  createList, addItems, renameItem, assignItem, toggleItem, removeItem, reuseList,
  addListPerson, renameListPerson, removeListPerson, shareOut, progress, mergeLists, isValidList,
  setItemDue, archiveList, makeTemplate,
} from './lists.js';
import {
  createPoll, addOptions, renameOption, removeOption, setVote, voteOf, nextValue, setClosed, tally,
  mergePolls, isValidPoll, addPollPerson, renamePollPerson, removePollPerson, archivePoll, setPollDate,
  setEventName, createEvent, isEvent, seeksDay, lastDay, dayOfChoice, choiceOfDay,
} from './polls.js';
import {
  createSpend, readAmount, showAmount, addSpend, editSpend, removeSpend, archiveSpend,
  addSpendPerson, renameSpendPerson, removeSpendPerson, canRemovePerson,
  balances, spendTotal, settle, mergeSpends, isValidSpend, addRepayment, isRepayment,
} from './spends.js';
import { recentPeople, withMeFirst, withoutMe } from './people.js';
import { inGroup, groupCounts, peopleIn, personFile, isLive, isLate, dayNow, eventParts, forEvent } from './dashboard.js';
import { loadGames, saveGames, loadLists, saveLists, loadPolls, savePolls, loadSpends, saveSpends, loadPrefs, savePrefs } from './storage.js';
import { connectStore } from './cloud.js';
import { createRemote, pickNewer, shareLink, gameIdFrom, listLink, listIdFrom, pollLink, pollIdFrom, setLink, setIdFrom, joinLink, joinFrom, backLink, backTokenFrom, wasDeleted } from './remote.js';
import { canSeal, newCode, readCode, readInvite, seal, unseal } from './lock.js';
import { remoteConfig } from './config.js';
import { t, setLanguage, getLanguage, detectLanguage } from './i18n.js';

const view = document.getElementById('view');

const state = {
  games: loadGames(),
  lists: loadLists(),
  polls: loadPolls(),
  spends: loadSpends(),
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
  // And for a shared account of expenses.
  openingSpend: null,
  // Whose lines are on screen in a list: null for everyone, 'none' for the
  // ones nobody has taken.
  listFilter: null,
};

// The new-list form's draft, kept across re-renders like the new-game one:
// adding a person must not throw away the lines already typed.
let newListName = '';
let newListPeople = ['', ''];
let newListLines = '';

// And the new account's.
let newSpendName = '';
let newSpendPeople = ['', ''];

// Which half of an account's page is showing — reset when a different
// account is opened, kept when this one just redraws (adding a line, say).
let spendTabId = null;
let spendTab = 'expenses';

// And the new-poll form's.
let newEventName = '';
let newEventDay = '';
let newEventHour = '';
let newEventUntil = '';
let newEventPeople = ['', ''];
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

/**
 * A day written `AAAA-MM-JJ`, shown the way the reader's language shows days.
 * Built field by field rather than handed to Date(), which reads that form as
 * UTC midnight and so shows the day before, west of Greenwich.
 */
function formatDay(day) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return String(day || '');
  try {
    return new Date(year, month - 1, date).toLocaleDateString(getLanguage(), {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return String(day);
  }
}

/**
 * When an event is: its day — or its first and last, when it runs over
 * several — and its hour. `long` adds the weekday, as an agenda wants it.
 */
function whenText(poll, { long = false } = {}) {
  const show = long ? formatDayLong : formatDay;
  const days = poll.until && poll.until > poll.date
    ? t('events.range', { from: show(poll.date), to: show(poll.until) })
    : show(poll.date);
  return [days, poll.at].filter(Boolean).join(' · ');
}

/**
 * A day in an agenda: the weekday matters as much as the number, since "jeudi"
 * is how anyone actually holds a date in their head.
 */
function formatDayLong(day) {
  const [year, month, date] = String(day || '').split('-').map(Number);
  if (!year || !month || !date) return String(day || '');
  try {
    return new Date(year, month - 1, date).toLocaleDateString(getLanguage(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return formatDay(day);
  }
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
  state.flash = { message, kind, shownAt: null };
}

/**
 * How long a message stays on screen once it has been read.
 *
 * Long enough to survive what follows it: something is answered, the app asks
 * the database what the answer changed, and redraws when it knows. A message
 * consumed by the first of those two redraws would flash and vanish. Going
 * somewhere else, on the other hand, ends it — a line about a group accepted is
 * nothing to a screen of games.
 */
const FLASH_KEPT = 4000;

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

/** A cell says one thing: available. What was "maybe" or "no" before shows as nothing. */
const VOTE_MARK = { yes: '✓' };

function pollCardHtml(poll) {
  const { answered, leaders, ranked } = tally(poll);
  const leading = ranked.find((row) => leaders.includes(row.option.id));
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
          ? `<span class="game-card__meta">${escapeHtml(
              t('polls.leading', { option: leading.option.text, count: leading.yes }),
            )}</span>`
          : `<span class="game-card__meta">${escapeHtml(t('polls.noAnswerYet'))}</span>`
      }
      <span class="game-card__meta">
        ${escapeHtml(formatDate(poll.updatedAt))}${
          poll.date ? ` — ${escapeHtml(t(poll.until ? 'polls.settledRange' : 'polls.settledOn', { day: whenText(poll) }))}` : ''
        }
      </span>
    </button>`;
}

function pollsView() {
  // An event made without a vote is not a question: it lives in the agenda.
  const sorted = [...shownDocs(state.polls).filter((poll) => !isEvent(poll))].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(isLive);
  const open = live.filter((poll) => !poll.closedAt);
  const closed = live.filter((poll) => poll.closedAt);

  return `
    ${flashHtml()}
    ${kindsHtml('polls')}
    <button type="button" class="button button--primary button--block" data-goto="#/polls/new">
      + ${escapeHtml(t('polls.new'))}
    </button>
    ${groupChipsHtml()}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('polls.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(pollCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('polls.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.polls)}
    </section>

    ${
      closed.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('polls.done'))}</h2></div>
             <div class="game-list">${closed.map(pollCardHtml).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, pollCardHtml)}`;
}

function newPollView() {
  const suggestions = [...new Set([myName(), ...recentPeople(state.polls), ...recentPeople(state.lists), ...recentNames(state.games)].filter(Boolean))].slice(0, 12);
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
      <label class="small add-day">
        ${escapeHtml(t('polls.addDay'))}
        <input type="date" id="poll-add-day" />
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

      ${willBeInHtml()}
      <button type="submit" class="button button--primary button--block">${escapeHtml(t('polls.create'))}</button>
    </form>`;
}

/**
 * Which evenings suit the most people, at a glance: one bar per choice, the
 * longest first.
 *
 * The grid answers "who can make what"; this answers "so, which one?", which
 * is the question everyone opens the poll to ask. A bar's full length is
 * everyone asked — not the best score — so three out of twelve looks like
 * three out of twelve, and not like a landslide. The exact count sits at the
 * end of every bar, in plain text: the length is for the eye, the number is
 * for certainty. Ranked, unlike the grid: nobody taps a bar, so nothing moves
 * under anyone's finger when the order changes.
 */
function gaugeHtml(poll) {
  const total = poll.people.length;
  const { ranked, leaders } = tally(poll);
  if (!total || !ranked.some((row) => row.yes > 0)) return '';
  return `
    <section class="gauge" aria-labelledby="gauge-title">
      <h2 id="gauge-title" class="gauge__title">${escapeHtml(t('polls.gauge'))}</h2>
      <ol class="gauge__rows">
        ${ranked
          .map((row) => {
            const share = Math.round((row.yes / total) * 100);
            const lead = leaders.includes(row.option.id);
            const said = t('polls.countLine', { yes: row.yes, total });
            return `
              <li class="gauge__row ${lead ? 'gauge__row--lead' : ''}" title="${escapeHtml(`${row.option.text} — ${said}`)}">
                <span class="gauge__label">${escapeHtml(row.option.text)}</span>
                <span class="gauge__track" aria-hidden="true">
                  <span class="gauge__fill" style="width: ${share}%"></span>
                </span>
                <span class="gauge__count">
                  <span aria-hidden="true">${row.yes}/${total}</span>
                  <span class="visually-hidden">${escapeHtml(said)}</span>
                </span>
              </li>`;
          })
          .join('')}
      </ol>
    </section>`;
}

function pollView(poll, { solo = false } = {}) {
  const me = state.prefs.voter?.[poll.id] || null;
  // Solo: a visitor from a link, with the app's chrome gone too. Guest: anyone
  // who is not the organiser — a visitor, or another member of the group — and
  // who is therefore shown the voting and nothing else.
  const guest = solo || !isOrganiser(poll);
  const { rows, leaders, answered } = tally(poll);
  const closed = Boolean(poll.closedAt);
  // An event whose day was known from the start: no choices, no votes, only
  // the day, who comes, and what hangs off it.
  const fixed = isEvent(poll);

  const cellHtml = (option, person) => {
    const yes = voteOf(poll, person.id, option.id) === 'yes';
    // Once this device has said who it answers for, the other columns are out
    // of reach: a thumb that lands one column over would tick someone else's
    // evening, and nothing on screen would say so. Switching name is still one
    // tap on the chips above — a choice, rather than a slip.
    const others = Boolean(me) && person.id !== me;
    return `
      <td class="${person.id === me ? 'votes__mine' : ''}">
        <button type="button" class="vote ${yes ? 'vote--yes' : 'vote--none'} ${others ? 'vote--other' : ''}"
                data-vote="${escapeHtml(person.id)}|${escapeHtml(option.id)}" ${closed || others ? 'disabled' : ''}
                aria-pressed="${yes ? 'true' : 'false'}"
                aria-label="${escapeHtml(`${person.name} — ${option.text}`)}">
          ${yes ? VOTE_MARK.yes : ''}
        </button>
      </td>`;
  };

  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(pollTitle(poll))}</h1>
        <p class="muted small">
          ${
            fixed
              ? escapeHtml(poll.people.map((person) => person.name).join(' · ') || t('events.nobody'))
              : `${escapeHtml(t('polls.answered', { count: answered, total: poll.people.length }))}
                 ${closed ? ` · ${escapeHtml(t('polls.closed'))}` : ''}`
          }
          ${poll.shared && !guest ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
        ${signedByHtml(poll)}
      </div>
      ${
        solo
          ? ''
          : `<button type="button" class="button button--small button--ghost" data-goto="${pollHome(poll)}">
               ${escapeHtml(t('action.back'))}
             </button>`
      }
    </div>

    ${guest ? '' : inGroupHtml(poll)}

    ${
      poll.people.length && !fixed
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

    ${guest && !closed ? soloJoinHtml() : ''}

    ${guest ? soloDateHtml(poll) : poll.date || fixed ? dateCardHtml(poll, fixed) : ''}

    ${solo ? '' : eventHtml(poll, { guest })}

    ${fixed ? '' : gaugeHtml(poll)}

    ${guest || poll.date || fixed ? '' : retainHtml(poll)}

    ${
      fixed
        ? ''
        : poll.options.length && poll.people.length
        ? `<div class="table-wrap table-wrap--flush" data-keep-scroll="poll-${escapeHtml(poll.id)}">
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
                           ${
                             guest
                               ? escapeHtml(row.option.text)
                               : `<button type="button" class="line__text" data-option="${escapeHtml(row.option.id)}">
                                    ${escapeHtml(row.option.text)}
                                  </button>`
                           }
                         </th>
                         ${poll.people.map((person) => cellHtml(row.option, person)).join('')}
                         <td class="votes__score">${row.yes}</td>
                       </tr>`,
                   )
                   .join('')}
               </tbody>
             </table>
           </div>
           <p class="muted small">${escapeHtml(
             me && !closed
               ? t('polls.answeringAs', { name: poll.people.find((person) => person.id === me)?.name || '' })
               : t('polls.tapHint'),
           )}</p>`
        : `<p class="muted small">${escapeHtml(poll.people.length ? t('polls.addChoices') : t('polls.addPeople'))}</p>`
    }

    ${
      closed || guest
        ? ''
        : `<form id="add-choice" class="card stack stack--tight">
             <label class="visually-hidden" for="new-choice">${escapeHtml(t('polls.addChoice'))}</label>
             <div class="row row--tight">
               <input type="text" id="new-choice" placeholder="${escapeHtml(t('polls.addChoice'))}" autocomplete="off" />
               <button type="submit" class="button button--primary">+</button>
             </div>
             <label class="small add-day">
               ${escapeHtml(t('polls.addDay'))}
               <input type="date" id="new-choice-day" />
             </label>
           </form>`
    }

    ${guest || poll.date || fixed ? '' : `<details class="details" id="poll-date-by-hand">
      <summary>${escapeHtml(t('polls.dateByHand'))}</summary>
      ${dateCardHtml(poll, fixed)}
    </details>`}

    ${guest ? '' : `<section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small" id="poll-people">${escapeHtml(t('lists.people'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="poll-share">${escapeHtml(t(fixed ? 'events.share' : 'polls.share'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="poll-text">${escapeHtml(t('action.recap'))}</button>
        ${
          fixed
            ? ''
            : `<button type="button" class="button button--small" id="poll-close">
                 ${escapeHtml(closed ? t('polls.reopen') : t('polls.close'))}
               </button>`
        }
        <button type="button" class="button button--small button--ghost" id="poll-archive">
          ${escapeHtml(poll.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="poll-rename">${escapeHtml(t(fixed ? 'events.rename' : 'polls.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="poll-sign">${escapeHtml(t('sign.edit'))}</button>
        <button type="button" class="button button--small button--ghost" id="poll-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </section>`}`;
}

/** The day an event is on, as its organiser sets it by hand. */
function dateCardHtml(poll, fixed) {
  return `<section class="card stack stack--tight">
      <div class="section__head">
        <h2>${escapeHtml(t('polls.date'))}</h2>
        ${poll.date ? `<span class="pill">${escapeHtml(whenText(poll))}</span>` : ''}
      </div>
      <p class="muted small">${escapeHtml(t(fixed ? 'events.dateHint' : 'polls.dateHint'))}</p>
      <div class="row">
        <label class="visually-hidden" for="poll-day">${escapeHtml(t('polls.date'))}</label>
        <input type="date" id="poll-day" value="${escapeHtml(poll.date || '')}" />
        <label class="visually-hidden" for="poll-hour">${escapeHtml(t('polls.hour'))}</label>
        <input type="time" id="poll-hour" value="${escapeHtml(poll.at || '')}" />
      </div>
      <label class="small">
        ${escapeHtml(t('events.until'))}
        <input type="date" id="poll-until" value="${escapeHtml(poll.until || '')}" />
      </label>
      <div class="row">
        <label class="visually-hidden" for="poll-title">${escapeHtml(t('polls.eventName'))}</label>
        <input type="text" id="poll-title" value="${escapeHtml(eventName(poll))}"
               placeholder="${escapeHtml(t('polls.eventNamePlaceholder'))}" />
        <button type="button" class="button" id="poll-date-save">${escapeHtml(t('action.save'))}</button>
      </div>
      ${
        poll.date
          ? `<div class="row">
               <button type="button" class="button button--small" id="poll-ics">${escapeHtml(t('agenda.add'))}</button>
             </div>`
          : ''
      }
    </section>`;
}

/** The day a choice names, read from the day it was written. */
function dayOfOption(poll, option) {
  return dayOfChoice(option.text, new Date(option.createdAt || poll.createdAt || Date.now()));
}

/**
 * The poll has a favourite, and its text names a day: its organiser keeps it
 * in one tap — the day goes in the agendas and the poll closes — instead of
 * writing again a date that is already on screen.
 */
function retainHtml(poll) {
  const { rows, leaders } = tally(poll);
  const kept = rows
    .filter((row) => leaders.includes(row.option.id))
    .map((row) => ({ row, day: dayOfOption(poll, row.option) }))
    .filter(({ day }) => day);
  if (!kept.length) return '';
  const total = poll.people.length;
  return `
    <section class="card stack stack--tight retain">
      <p class="small">${escapeHtml(
        kept.length > 1 ? t('polls.retainTie') : t('polls.retainHint', { choice: kept[0].row.option.text, yes: kept[0].row.yes, total }),
      )}</p>
      <div class="row">
        ${kept
          .map(
            ({ row, day }) => `<button type="button" class="button button--primary" data-retain="${escapeHtml(row.option.id)}">
                ${escapeHtml(t('polls.retain', { day: formatDayLong(day.date) }))}
              </button>`,
          )
          .join('')}
      </div>
    </section>`;
}

/**
 * Once a poll has settled on a day, it is an event: what to bring, and what
 * it cost, hang off it and are one tap away. The organiser starts either; the
 * others see what has been started and nothing to press.
 */
function eventHtml(poll, { guest }) {
  if (!poll.date) return '';
  const { list, spend } = eventParts(poll, state);
  if (guest && !list && !spend) return '';
  const day = formatDay(poll.date);
  return `
    <section class="section stack stack--tight">
      <div class="section__head"><h2>${escapeHtml(t('event.title'))}</h2></div>
      ${list ? `<span class="muted small">${escapeHtml(t('event.list'))}</span>${listCardHtml(list)}` : ''}
      ${spend ? `<span class="muted small">${escapeHtml(t('tab.spends'))}</span>${spendCardHtml(spend)}` : ''}
      ${
        guest || (list && spend)
          ? ''
          : `<p class="muted small">${escapeHtml(t(isEvent(poll) ? 'event.hintFixed' : 'event.hint', { day }))}</p>
             <div class="row">
               ${list ? '' : `<button type="button" class="button button--small" id="event-list">${escapeHtml(t('event.addList'))}</button>`}
               ${spend ? '' : `<button type="button" class="button button--small" id="event-spend">${escapeHtml(t('event.addSpend'))}</button>`}
             </div>`
      }
    </section>`;
}

/** On a list or an account made for an event: the way back to it. */
function eventLinkHtml(document_) {
  const poll = document_.event ? getPoll(document_.event) : null;
  if (!poll) return '';
  const name = eventName(poll) || pollTitle(poll);
  const label = poll.date ? t('event.for', { name, day: whenText(poll) }) : t('event.forUndated', { name });
  return `
    <div class="row row--tight">
      <button type="button" class="button button--small button--ghost" data-goto="#/poll/${escapeHtml(poll.id)}">
        ${escapeHtml(label)}
      </button>
    </div>`;
}

/**
 * For a guest whose name the poll does not have yet: add it, and answer.
 * Whoever sends a link to a chat does not know every name in it; without
 * this, a guest could look but never tick.
 */
function soloJoinHtml() {
  return `
    <form id="solo-me-form" class="row row--tight">
      <label class="visually-hidden" for="solo-me">${escapeHtml(t('polls.soloMe'))}</label>
      <input type="text" id="solo-me" autocomplete="given-name" maxlength="${NAME_KEPT}"
             placeholder="${escapeHtml(t('polls.soloMe'))}" />
      <button type="submit" class="button">${escapeHtml(t('polls.soloAdd'))}</button>
    </form>`;
}

/** The day the poll settled on, to read — and to take away — but not to change. */
function soloDateHtml(poll) {
  if (!poll.date) return '';
  const when = whenText(poll, { long: true });
  return `
    <section class="card stack stack--tight">
      <p><strong>${escapeHtml(t('polls.soloSettled', { when }))}</strong></p>
      <div class="row">
        <button type="button" class="button button--small" id="poll-ics">${escapeHtml(t('agenda.add'))}</button>
      </div>
    </section>`;
}

/* ------------------------------------------------------ polls: behaviour --- */

/**
 * Whether a change that could not be written to this device survives anywhere
 * else — and so whether its loss is worth a word.
 *
 * Holding a database is not enough: only a *shared* document is sent to one.
 * A poll kept to oneself, on a device whose storage refuses, exists in the
 * page and nowhere else, and is gone at the next reload. That used to pass in
 * silence, because a database was configured. It no longer does.
 */
/**
 * What this device is actually holding, all groups and filters aside.
 *
 * The filters are what make a screen look empty when nothing has been lost, so
 * the one place that counts without filtering is worth having: it separates
 * "it is not being shown" from "it is not there", which is the first question
 * to answer when someone says their polls are gone.
 */
function heldCounts() {
  const all = [...state.lists, ...state.polls, ...state.games, ...state.spends];
  return {
    lists: state.lists.length,
    polls: state.polls.length,
    games: state.games.length,
    spends: state.spends.length,
    shared: all.filter((document_) => document_.shared).length,
    archived: all.filter((document_) => document_.archivedAt).length,
  };
}

function keptElsewhere(changed, { store = false } = {}) {
  if (state.remote && changed?.shared) return true;
  return Boolean(store && state.store && changed);
}

/**
 * What to do when a write does not go through. Most often it is the network:
 * the copy here stays, and goes up with the next change. But when the
 * database answers that the thing was deleted, keeping it would only fail
 * again at every change — so it leaves this device too, and the page says why.
 */
function pushFailed(changed) {
  return (error) => {
    if (wasDeleted(error)) dropDeleted(changed.id);
    else flash(t('share.pushFailed'), 'error');
  };
}

function dropDeleted(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const spend = getSpend(id);
  const game = getGame(id);
  if (poll) {
    state.polls = state.polls.filter((item) => item.id !== id);
    savePolls(state.polls);
  } else if (list) {
    state.lists = state.lists.filter((item) => item.id !== id);
    saveLists(state.lists);
  } else if (spend) {
    state.spends = state.spends.filter((item) => item.id !== id);
    saveSpends(state.spends);
  } else if (game) {
    state.games = state.games.filter((item) => item.id !== id);
    saveGames(state.games);
  } else {
    return;
  }
  if (state.store) void state.store.remove(id);
  const name = poll ? pollTitle(poll) : list ? listTitle(list) : spend ? spendTitle(spend) : gameTitle(game);
  flash(t('share.deleted', { name }));
  // On its page, the page finds it gone and says so as any missing thing does.
  if (route().id === id) render();
}

function persistPoll(changed) {
  const ok = savePolls(state.polls);
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    pushPoll(changed).catch(pushFailed(changed));
  }
  return ok;
}

/**
 * Send a poll — after taking in what the database already has.
 *
 * Writing this device's copy straight away used to erase whatever had come
 * in since it last looked: Paul ticks Saturday from a link, the organiser
 * ticks Friday a moment later on a copy without Paul, and Paul was gone —
 * his tick and his name. The copy stored is now merged in first, cell by
 * cell, exactly as a poll arriving on screen is; and the database does the
 * same on its side, for the moment between this read and that write, and
 * for any app not yet up to date.
 */
async function pushPoll(changed) {
  let outgoing = changed;
  try {
    const stored = await state.remote.get(changed.id);
    if (isValidPoll(stored) && adoptPoll(stored)) {
      outgoing = getPoll(changed.id) || changed;
      if (!isBusy()) render();
    }
  } catch {
    // Unreadable just now: the database merges on its side all the same.
  }
  await state.remote.put(outgoing, keyFor(outgoing), organiserSecret(outgoing.id));
}

function getPoll(id) {
  return state.polls.find((poll) => poll.id === id) || null;
}

function persistSpend(changed) {
  const ok = saveSpends(state.spends);
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed, keyFor(changed), organiserSecret(changed.id)).catch(pushFailed(changed));
  }
  return ok;
}

function getSpend(id) {
  return state.spends.find((spend) => spend.id === id) || null;
}

function replaceSpend(next, { redraw = true } = {}) {
  state.spends = state.spends.map((spend) => (spend.id === next.id ? next : spend));
  persistSpend(next);
  if (redraw) render();
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

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

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

  // Picking a day writes it as a choice, in words anyone reads and the app
  // reads back when the poll is settled.
  view.querySelector('#poll-add-day')?.addEventListener('change', (event) => {
    const line = choiceOfDay(event.target.value, getLanguage());
    if (!line) return;
    const box = view.querySelector('#poll-choices');
    const lines = box.value.split('\n').filter((one) => one.trim());
    if (!lines.includes(line)) box.value = [...lines, line].join('\n');
    event.target.value = '';
    newPollChoices = box.value;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    let poll = signed(organise(landing(createPoll({ question: newPollQuestion, names: newPollPeople }))));
    poll = addOptions(poll, newPollChoices);

    state.polls = [...state.polls, poll];
    persistPoll(poll);
    resetGroupChoice();
    newPollQuestion = '';
    newPollChoices = '';
    newPollPeople = withMeFirst(['', ''], myName());
    navigate(`#/poll/${poll.id}`);
  });
}

/**
 * Bring one's own column into view in the poll grid, just right of the column
 * of choices, which stays put. Does nothing when it is already in sight,
 * unless asked to.
 */
function showMyColumn({ always = false } = {}) {
  const box = view.querySelector('.table-wrap[data-keep-scroll]');
  const mine = box?.querySelector('thead th.votes__mine');
  const first = box?.querySelector('thead th');
  if (!box || !mine || !first) return;
  const start = mine.offsetLeft - first.offsetWidth;
  const inSight = start >= box.scrollLeft && mine.offsetLeft + mine.offsetWidth <= box.scrollLeft + box.clientWidth;
  if (inSight && !always) return;

  // Opening the poll: a quiet jump, before anything has been looked at.
  if (!always) {
    box.scrollLeft = Math.max(0, start);
    return;
  }

  // Asked for with a tap on a name: go there, visibly. The name chips sit at
  // the top of the page and the grid well below them — below the fold on a
  // phone — so lighting up a column nobody can see answered nothing. The page
  // comes down to the grid, just under the bar that stays at the top, and the
  // grid slides to the column; both move, so the eye follows where it went.
  const still = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const behavior = still ? 'auto' : 'smooth';
  const bar = document.querySelector('.app-bar');
  const top = box.getBoundingClientRect().top + window.scrollY - (bar?.offsetHeight || 0) - 8;
  window.scrollTo({ top: Math.max(0, top), behavior });
  box.scrollTo({ left: Math.max(0, start), behavior });
}

function bindPoll(poll) {
  view.querySelectorAll('[data-vote]').forEach((button) => {
    button.addEventListener('click', () => {
      const [personId, optionId] = button.dataset.vote.split('|');
      // The screen already refuses; this refuses too, whatever the screen did.
      const answeringAs = state.prefs.voter?.[poll.id];
      if (answeringAs && answeringAs !== personId) return;
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
      // Asked for by the tap itself: show that person's column, wherever the
      // grid had been left.
      showMyColumn({ always: true });
    });
  });

  // A guest not on the list adds their own name, and is then who answers.
  view.querySelector('#solo-me-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = view.querySelector('#solo-me').value.trim();
    if (!name) return;
    // Matched the way everywhere else matches names — case, accents and
    // blanks aside — so "chloe" does not add a second Chloé.
    const same = (person) => sameName(person.name) === sameName(name);
    let next = poll;
    let person = poll.people.find(same);
    if (!person) {
      next = addPollPerson(poll, name);
      person = next.people.find(same);
    }
    state.prefs = { ...state.prefs, voter: { ...state.prefs.voter, [poll.id]: person.id } };
    savePrefs(state.prefs);
    if (next === poll) render();
    else replacePoll(next);
    showMyColumn({ always: true });
  });

  // Opening the poll: straight to one's own column, so answering takes no
  // scrolling at all. A redraw of the same poll keeps its place instead — see
  // render(), which runs after this and puts the grid back where it was.
  showMyColumn();

  view.querySelector('#add-choice')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = view.querySelector('#new-choice');
    const next = addOptions(poll, field.value);
    if (next === poll) return;
    replacePoll(next);
    view.querySelector('#new-choice')?.focus();
  });

  view.querySelector('#new-choice-day')?.addEventListener('change', (event) => {
    const line = choiceOfDay(event.target.value, getLanguage());
    if (!line || poll.options.some((option) => option.text === line)) return;
    replacePoll(addOptions(poll, line));
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

  view.querySelectorAll('[data-retain]').forEach((button) => {
    button.addEventListener('click', () => {
      const option = poll.options.find((one) => one.id === button.dataset.retain);
      const day = option && dayOfOption(poll, option);
      if (!day) return;
      const next = setClosed(setPollDate(poll, day.date, day.at), true);
      flash(t('polls.dateKept', { day: whenText(next) }));
      replacePoll(next);
    });
  });

  view.querySelector('#poll-date-save')?.addEventListener('click', () => {
    const day = view.querySelector('#poll-day').value;
    const hour = view.querySelector('#poll-hour').value;
    const until = view.querySelector('#poll-until')?.value || null;
    const written = view.querySelector('#poll-title').value;
    // Le nom proposé n'est pas un nom choisi : ne le garder que s'il a bougé.
    const named = written.trim() === eventName(poll) ? poll : setEventName(poll, written);
    const next = setPollDate(named, day, hour, until);
    flash(next.date ? t('polls.dateKept', { day: whenText(next) }) : t('polls.dateCleared'));
    replacePoll(next);
  });

  view.querySelector('#event-list')?.addEventListener('click', () => {
    const list = signed(forEvent(poll, createList, eventName(poll) || pollTitle(poll)));
    state.lists = [...state.lists, list];
    persistList(list);
    navigate(`#/list/${list.id}`);
  });

  view.querySelector('#event-spend')?.addEventListener('click', () => {
    const spend = forEvent(poll, createSpend, eventName(poll) || pollTitle(poll));
    state.spends = [...state.spends, spend];
    persistSpend(spend);
    navigate(`#/spend/${spend.id}`);
  });

  view.querySelector('#poll-ics')?.addEventListener('click', () => {
    const event = pollEvent(poll);
    if (!event) return;
    const named = eventName(poll) || pollTitle(poll);
    download(`${fileName(named)}.ics`, icsFor([event], { name: named }), 'text/calendar');
  });

  view.querySelector('#poll-archive')?.addEventListener('click', () => {
    const next = archivePoll(poll, !poll.archivedAt);
    flash(t(next.archivedAt ? 'archive.done' : 'archive.undone'));
    replacePoll(next, { redraw: !next.archivedAt });
    if (next.archivedAt) navigate(pollHome(next));
  });

  view.querySelector('#poll-rename')?.addEventListener('click', () => openPollNameDialog(poll));
  view.querySelector('#poll-sign')?.addEventListener('click', () =>
    openSignatureDialog(poll, (signedBy) => replacePoll({ ...poll, signedBy, updatedAt: Date.now() })));

  view.querySelector('#poll-delete')?.addEventListener('click', async () => {
    if (!(await ask(t('polls.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.polls = state.polls.filter((item) => item.id !== poll.id);
    savePolls(state.polls);
    if (state.store) void state.store.remove(poll.id);
    if (state.remote) state.remote.remove(poll.id, keyFor(poll), organiserSecret(poll.id)).catch(() => {});
    navigate(pollHome(poll));
  });

  view.querySelector('#poll-share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let current = poll;

    if (!current.shared) {
      button.disabled = true;
      button.textContent = t('share.sending');
      current = await startSharing(current);
      if (!current) return;
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

/**
 * "Proposé par …": a nickname under the title of a list or a poll, for the
 * people who open it from a link and would otherwise not know who is asking.
 *
 * Per document, because the same person is "Gui" to the family and "le voisin
 * du 3e" to the building. One nickname is remembered and put on whatever this
 * device creates next; each list or poll can then carry another, or none, and
 * change at any time. On a poll with an organiser it is the organiser's to
 * set, like the rest of what frames the poll — the database keeps it so.
 */
function signedByHtml(document_) {
  const name = String(document_?.signedBy || '').trim();
  if (!name) return '';
  return `<p class="signed small">${escapeHtml(t('sign.by', { name }))}</p>`;
}

/** A new list or poll takes the nickname this device signs with, if it has one. */
function signed(document_) {
  const name = String(state.prefs.signature || '').trim();
  return name ? { ...document_, signedBy: name } : document_;
}

function openSignatureDialog(document_, save) {
  const current = String(document_.signedBy || '').trim();
  const remembered = String(state.prefs.signature || '').trim();
  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('sign.edit'))}</h2>
      <p class="muted small">${escapeHtml(t('sign.hint'))}</p>
      <label class="visually-hidden" for="sign-name">${escapeHtml(t('sign.placeholder'))}</label>
      <input type="text" id="sign-name" maxlength="40" autocomplete="nickname"
             value="${escapeHtml(current || remembered)}" placeholder="${escapeHtml(t('sign.placeholder'))}" />
      <label class="checkbox">
        <input type="checkbox" id="sign-remember" ${!remembered || remembered === (current || remembered) ? 'checked' : ''} />
        ${escapeHtml(t('sign.remember'))}
      </label>
      <div class="row">
        <button type="button" class="button button--primary" id="sign-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="sign-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#sign-name');
  const done = () => {
    const name = field.value.trim().slice(0, 40) || null;
    if (dialog.querySelector('#sign-remember').checked) {
      state.prefs = { ...state.prefs, signature: name };
      savePrefs(state.prefs);
    }
    dialog.close();
    // Emptied: the signature comes off this one, and says so nowhere else.
    if (name !== (current || null)) save(name);
  };
  dialog.querySelector('#sign-save').addEventListener('click', done);
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    done();
  });
  dialog.querySelector('#sign-cancel').addEventListener('click', () => dialog.close());
  dialog.showModal();
  field.focus();
  field.select();
}

/** The poll as text, to paste into a message. */
function pollText(poll) {
  const { rows } = tally(poll);
  const line = (row) =>
    `${row.option.text} — ${t('polls.countLine', { yes: row.yes, total: poll.people.length })}`;
  return [pollTitle(poll), '', ...rows.map(line)].join('\n');
}

/**
 * Fetch a poll from the shared database and take what it knows. False when
 * there is nothing new, and null — falsy all the same — when the database
 * could not be reached: "this poll no longer exists" would be untrue then.
 */
async function pullPoll(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return null;
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
  // Already watching this one: a redraw — a vote, a tick — must not restart
  // the clock, or answers would only ever arrive to a screen left untouched.
  if (state.pollWatched === id && state.poll) return;
  stopWatching();
  if (!state.remote) return;
  state.pollWatched = id;
  const look = async () => {
    if (isBusy() || isHidden()) return;
    if (await pullPoll(id)) render();
  };
  // At once, and then every five seconds: opening a poll should show the
  // answers that are already in, not the ones that were in last time.
  void look();
  state.poll = setInterval(look, 5000);
}

/** Le compte que la base détient, s'il est plus récent que celui d'ici. */
async function pullSpend(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  return isValidSpend(stored) ? adoptSpend(stored) : false;
}

/** Les dépenses arrivent ligne par ligne : celle de l'un ne chasse pas l'autre. */
function adoptSpend(stored) {
  const local = getSpend(stored.id);
  const merged = local ? mergeSpends(local, stored) : stored;
  if (local && merged === local) return false;

  const adopted = { ...merged, shared: true };
  state.spends = local
    ? state.spends.map((spend) => (spend.id === stored.id ? adopted : spend))
    : [...state.spends, adopted];
  saveSpends(state.spends);
  return true;
}

/** Tant qu'un compte partagé est à l'écran, guetter ce que les autres notent. */
function watchSpend(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return;
    if (await pullSpend(id)) render();
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
  const late = list.items.filter((item) => isLate(item)).length;
  return `
    <button type="button" class="game-card" data-goto="#/list/${escapeHtml(list.id)}">
      <span class="game-card__title">
        ${escapeHtml(listTitle(list))}
        <span class="pill ${total && done === total ? 'pill--done' : ''}">
          ${escapeHtml(total ? t('lists.progress', { done, total }) : t('lists.empty'))}
        </span>
      </span>
      ${people ? `<span class="game-card__meta">${escapeHtml(people)}</span>` : ''}
      <span class="game-card__meta">
        ${escapeHtml(formatDate(list.updatedAt))}${
          late ? ` — <span class="late">${escapeHtml(t('lists.late', { count: late }))}</span>` : ''
        }
      </span>
    </button>`;
}

function listsView() {
  const sorted = [...shownDocs(state.lists)].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(isLive);
  const open = live.filter((list) => progress(list).left > 0 || !list.items.length);
  const finished = live.filter((list) => list.items.length && progress(list).left === 0);
  const templates = sorted.filter((list) => list.template && !list.archivedAt);

  return `
    ${flashHtml()}
    ${kindsHtml('lists')}
    <button type="button" class="button button--primary button--block" data-goto="#/lists/new">
      + ${escapeHtml(t('lists.new'))}
    </button>
    ${groupChipsHtml()}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('lists.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(listCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('lists.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.lists)}
    </section>

    ${
      finished.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('lists.done'))}</h2></div>
             <div class="game-list">${finished.map(listCardHtml).join('')}</div>
           </section>`
        : ''
    }

    ${
      templates.length
        ? `<section class="section">
             <div class="section__head">
               <h2>${escapeHtml(t('lists.templates'))}</h2>
               <span class="muted small">${escapeHtml(t('lists.templatesHint'))}</span>
             </div>
             <div class="game-list">${templates.map(listCardHtml).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, listCardHtml)}`;
}

/**
 * What has been put away, folded behind one line. Kept on the page rather than
 * on a page of its own: a thing put away is still a thing you can go and find,
 * and one more screen to go looking on is one more thing to remember.
 */
function archivedHtml(documents, cardHtml) {
  const archived = documents.filter((document_) => document_.archivedAt);
  if (!archived.length) return '';
  return `
    <details class="details">
      <summary>${escapeHtml(t('archive.shown', { count: archived.length }))}</summary>
      <div class="game-list">${archived.map(cardHtml).join('')}</div>
    </details>`;
}

function newListView() {
  const templates = state.lists.filter((list) => list.template && !list.archivedAt);
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.lists), ...recentPeople(state.polls), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('lists.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/lists">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${
      templates.length
        ? `<section class="section">
             <div class="section__head">
               <h2>${escapeHtml(t('lists.fromTemplate'))}</h2>
             </div>
             <div class="row">
               ${templates
                 .map(
                   (list) => `
                     <button type="button" class="chip" data-from-template="${escapeHtml(list.id)}">
                       ${escapeHtml(listTitle(list))}
                     </button>`,
                 )
                 .join('')}
             </div>
           </section>`
        : ''
    }

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

      ${willBeInHtml()}
      <button type="submit" class="button button--primary button--block">${escapeHtml(t('lists.create'))}</button>
    </form>`;
}

function listItemHtml(list, item) {
  const who = personName(list, item.who);
  const late = isLate(item);
  return `
    <li class="line ${item.done ? 'line--done' : ''}">
      <label class="line__tick">
        <input type="checkbox" data-tick="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''}
               aria-label="${escapeHtml(item.text)}" />
      </label>
      <button type="button" class="line__text" data-edit="${escapeHtml(item.id)}">
        <span>${escapeHtml(item.text)}</span>
        ${
          // Only a line that has a day says one: the others would all carry an
          // empty slot to say nothing.
          item.due
            ? `<span class="line__due ${late ? 'line__due--late' : ''}">${escapeHtml(
                late ? t('lists.lateOn', { day: formatDay(item.due) }) : t('lists.dueOn', { day: formatDay(item.due) }),
              )}</span>`
            : ''
        }
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
        ${signedByHtml(list)}
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/lists">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${eventLinkHtml(list)}

    ${inGroupHtml(list)}

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
        <button type="button" class="button button--small button--ghost" id="list-template">
          ${escapeHtml(list.template ? t('lists.unTemplate') : t('lists.makeTemplate'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="list-archive">
          ${escapeHtml(list.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="list-rename">${escapeHtml(t('lists.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="list-sign">${escapeHtml(t('sign.edit'))}</button>
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
  if (!ok && !keptElsewhere(changed, { store: true })) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  // Only a game that has been shared travels: someone else's evening has no
  // business landing in a database they never chose.
  if (state.remote && changed?.shared) {
    // A failure here must never cost the player their round: the local copy is
    // already written, and the next change pushes again.
    state.remote.put(changed, keyFor(changed), organiserSecret(changed.id)).catch(pushFailed(changed));
  }
  return ok;
}

/** `game` is the one just removed from the list: it says which group it was in. */
function forget(id, game = null) {
  saveGames(state.games);
  if (state.store) void state.store.remove(id);
  if (state.remote) state.remote.remove(id, keyFor(game), organiserSecret(id)).catch(() => {});
}

function getGame(id) {
  return state.games.find((game) => game.id === id) || null;
}

function replaceGame(next) {
  state.games = state.games.map((game) => (game.id === next.id ? next : game));
  persist(next);
}

/* --------------------------------------------------------------- dépenses --- */

function spendTitle(spend) {
  return spend.name || t('spends.untitled');
}

/** Ce que ce compte dit de moi : ce qu'on me doit, ou ce que je dois. */
function myBalance(spend) {
  const me = sameName(myName());
  if (!me) return null;
  return balances(spend).find((row) => sameName(row.name) === me) || null;
}

function spendCardHtml(spend) {
  const mine = myBalance(spend);
  const line = mine && mine.balance !== 0
    ? t(mine.balance > 0 ? 'spends.owedToMe' : 'spends.iOwe', { amount: showAmount(Math.abs(mine.balance), getLanguage()) })
    : t('spends.even');
  return `
    <button type="button" class="game-card" data-goto="#/spend/${escapeHtml(spend.id)}">
      <span class="game-card__title">
        ${escapeHtml(spendTitle(spend))}
        <span class="pill">${escapeHtml(showAmount(spendTotal(spend), getLanguage()))}</span>
      </span>
      <span class="game-card__meta">${escapeHtml(spend.people.map((person) => person.name).join(' · '))}</span>
      <span class="game-card__meta">
        ${escapeHtml(formatDate(spend.updatedAt))} — <span class="${mine && mine.balance < 0 ? 'late' : ''}">${escapeHtml(line)}</span>
      </span>
    </button>`;
}

/**
 * The agenda: what is coming, day by day, each event with what hangs off it;
 * then the accounts that belong to no event still coming — a flatshare, or the
 * weekend just past whose money is not settled yet; then the past, folded.
 *
 * An event is a poll with a day: settled by a vote, or made with its day
 * already known. A question still looking for its day comes first, under "to
 * decide": when it settles it only moves down the same page. Questions about
 * anything else stay on the home page, and the accounts have their own.
 */
function agendaView() {
  const today = dayNow();
  const byDay = (a, b) => a.date.localeCompare(b.date) || String(a.at || '').localeCompare(String(b.at || ''));
  const dated = shownDocs(state.polls).filter((poll) => isLive(poll) && poll.date);
  // Under way still counts as coming: a weekend is not past on its Saturday.
  const coming = dated.filter((poll) => lastDay(poll) >= today).sort(byDay);
  const past = dated.filter((poll) => lastDay(poll) < today).sort(byDay).reverse();

  const deciding = shownDocs(state.polls)
    .filter((poll) => isLive(poll) && !poll.date && !poll.closedAt && seeksDay(poll))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const archivedEvents = shownDocs(state.polls).filter((poll) => isEvent(poll) && poll.archivedAt);

  return `
    ${flashHtml()}
    <button type="button" class="button button--primary button--block" data-goto="#/agenda/new">
      + ${escapeHtml(t('events.new'))}
    </button>
    ${groupChipsHtml()}

    ${
      deciding.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('polls.toDecide'))}</h2></div>
             <div class="game-list">${deciding.map(pollCardHtml).join('')}</div>
           </section>`
        : ''
    }

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('events.coming'))}</h2></div>
      ${
        coming.length
          ? `<div class="game-list">${coming.map(eventCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('events.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.polls.filter((poll) => poll.date))}
    </section>

    ${
      past.length
        ? `<details class="details">
             <summary>${escapeHtml(t('events.past', { count: past.length }))}</summary>
             <div class="game-list">${past.map(eventCardHtml).join('')}</div>
           </details>`
        : ''
    }

    ${archivedHtml(archivedEvents, eventCardHtml)}`;
}

/** Every account, on the home page: the ones someone still owes on, then the settled. */
function spendsView() {
  const sorted = [...shownDocs(state.spends)].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(isLive);
  const settled = (spend) => spend.lines.length && balances(spend).every((row) => row.balance === 0);
  const open = live.filter((spend) => !settled(spend));
  const done = live.filter(settled);

  return `
    ${flashHtml()}
    ${kindsHtml('spends')}
    <button type="button" class="button button--primary button--block" data-goto="#/spends/new">
      + ${escapeHtml(t('spends.new'))}
    </button>
    ${groupChipsHtml()}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('events.accounts'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(spendCardHtml).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('spends.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.spends)}
    </section>

    ${
      done.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('spends.settled'))}</h2></div>
             <div class="game-list">${done.map(spendCardHtml).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, spendCardHtml)}`;
}

/** An event in the agenda: its day, who comes, and where its list and account stand. */
function eventCardHtml(poll) {
  const { list, spend } = eventParts(poll, state);
  const when = whenText(poll, { long: true });
  const parts = [];
  if (list) {
    const { done, total } = progress(list);
    parts.push(total ? `${t('event.list')} : ${t('lists.progress', { done, total })}` : `${t('event.list')} : ${t('lists.empty')}`);
  }
  if (spend) parts.push(t('spends.total', { amount: showAmount(spendTotal(spend), getLanguage()) }));
  const people = poll.people.map((person) => person.name).join(' · ');
  return `
    <button type="button" class="game-card" data-goto="#/poll/${escapeHtml(poll.id)}">
      <span class="game-card__title">
        ${escapeHtml(eventName(poll) || pollTitle(poll))}
        <span class="pill">${escapeHtml(when)}</span>
      </span>
      ${people ? `<span class="game-card__meta">${escapeHtml(people)}</span>` : ''}
      ${parts.length ? `<span class="game-card__meta">${escapeHtml(parts.join(' · '))}</span>` : ''}
    </button>`;
}

/** A new event whose day is known: a name, the day, perhaps an hour, and who comes. */
function newEventView() {
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.polls), ...recentPeople(state.lists), ...recentPeople(state.spends), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('events.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/agenda">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-event" class="card stack">
      <label>
        ${escapeHtml(t('events.name'))}
        <input type="text" id="event-name" placeholder="${escapeHtml(t('polls.eventNamePlaceholder'))}"
               value="${escapeHtml(newEventName)}" required />
      </label>

      <div class="row">
        <label>
          ${escapeHtml(t('events.day'))}
          <input type="date" id="event-day" value="${escapeHtml(newEventDay)}" required />
        </label>
        <label>
          ${escapeHtml(t('polls.hour'))}
          <input type="time" id="event-hour" value="${escapeHtml(newEventHour)}" />
        </label>
      </div>
      <label>
        ${escapeHtml(t('events.until'))}
        <input type="date" id="event-until" value="${escapeHtml(newEventUntil)}" />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('events.peopleHint'))}</span>
        ${newEventPeople
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
            newEventPeople.length > 1
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

      ${willBeInHtml()}

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('events.create'))}</button>
    </form>`;
}

function bindNewEvent() {
  const form = view.querySelector('#new-event');
  if (!form) return;

  const snapshot = () => {
    newEventName = view.querySelector('#event-name').value;
    newEventDay = view.querySelector('#event-day').value;
    newEventHour = view.querySelector('#event-hour').value;
    newEventUntil = view.querySelector('#event-until').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      newEventPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    newEventPeople = [...newEventPeople, ''];
    render();
    view.querySelector(`[data-person-index="${newEventPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    newEventPeople = newEventPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (newEventPeople.some((name) => sameName(name) === sameName(suggest))) return;
      const empty = newEventPeople.findIndex((name) => !name.trim());
      if (empty >= 0) newEventPeople[empty] = suggest;
      else newEventPeople = [...newEventPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    const poll = signed(organise(landing(createEvent({
      name: newEventName,
      names: newEventPeople,
      date: newEventDay,
      at: newEventHour,
      until: newEventUntil,
    }))));
    state.polls = [...state.polls, poll];
    persistPoll(poll);
    resetGroupChoice();
    newEventName = '';
    newEventDay = '';
    newEventHour = '';
    newEventUntil = '';
    newEventPeople = withMeFirst(['', ''], myName());
    navigate(`#/poll/${poll.id}`);
  });
}

function newSpendView() {
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.spends), ...recentPeople(state.lists), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('spends.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/spends">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-spend" class="card stack">
      <label>
        ${escapeHtml(t('spends.name'))}
        <input type="text" id="spend-name" placeholder="${escapeHtml(t('spends.namePlaceholder'))}"
               value="${escapeHtml(newSpendName)}" required />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('spends.peopleHint'))}</span>
        ${newSpendPeople
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
            newSpendPeople.length > 1
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

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('spends.create'))}</button>
    </form>`;
}

/** Une dépense, telle qu'elle se lit dans la liste : qui, combien, pour qui. */
function spendLineHtml(spend, line) {
  const who = spend.people.find((person) => person.id === line.by)?.name || '';
  if (isRepayment(line)) {
    const to = spend.people.find((person) => person.id === line.forWhom[0])?.name || '';
    return `
      <li class="line line--repay">
        <button type="button" class="line__text" data-spend-line="${escapeHtml(line.id)}">
          <span>${escapeHtml(t('spends.repaid', { from: who, to }))}</span>
          <span class="line__due">${escapeHtml(t('spends.repayment'))}${line.day ? ` · ${escapeHtml(formatDay(line.day))}` : ''}</span>
        </button>
        <span class="line__amount">${escapeHtml(showAmount(line.amount, getLanguage()))}</span>
      </li>`;
  }
  const forWhom = line.forWhom.length
    ? spend.people.filter((person) => line.forWhom.includes(person.id)).map((person) => person.name).join(', ')
    : t('spends.everyone');
  return `
    <li class="line">
      <button type="button" class="line__text" data-spend-line="${escapeHtml(line.id)}">
        <span>${escapeHtml(line.text || t('spends.untitledLine'))}</span>
        <span class="line__due">
          ${escapeHtml(who ? t('spends.paidBy', { name: who }) : t('spends.paidByNobody'))}
          · ${escapeHtml(t('spends.forWhom', { names: forWhom }))}${line.day ? ` · ${escapeHtml(formatDay(line.day))}` : ''}
        </span>
      </button>
      <span class="line__amount">${escapeHtml(showAmount(line.amount, getLanguage()))}</span>
    </li>`;
}

function spendView(spend) {
  if (spendTabId !== spend.id) {
    spendTabId = spend.id;
    spendTab = 'expenses';
  }
  const rows = balances(spend);
  const moves = settle(spend);
  const me = sameName(myName());

  const segmented = `
    <div class="segmented" role="tablist" aria-label="${escapeHtml(t('spends.sections'))}">
      <button type="button" class="segmented__option" data-spend-tab="expenses"
              role="tab" aria-selected="${spendTab === 'expenses' ? 'true' : 'false'}"
              aria-current="${spendTab === 'expenses' ? 'true' : 'false'}">
        ${escapeHtml(t('spend.tabExpenses'))}
      </button>
      <button type="button" class="segmented__option" data-spend-tab="balances"
              role="tab" aria-selected="${spendTab === 'balances' ? 'true' : 'false'}"
              aria-current="${spendTab === 'balances' ? 'true' : 'false'}">
        ${escapeHtml(t('spend.tabBalances'))}
      </button>
    </div>`;

  const expensesTab = `
    ${
      spend.people.length
        ? `<form id="add-spend" class="card stack">
             <label>
               ${escapeHtml(t('spends.what'))}
               <input class="field-pill" type="text" id="spend-text"
                      placeholder="${escapeHtml(t('spends.textPlaceholder'))}" autocomplete="off" />
             </label>

             <label>
               ${escapeHtml(t('spends.amount'))}
               <span class="field-pill field-pill--amount">
                 <input type="text" id="spend-amount" inputmode="decimal" placeholder="0,00" />
                 <span class="field-pill__suffix">€</span>
               </span>
             </label>

             <div class="field-row">
               <label>
                 ${escapeHtml(t('spends.by'))}
                 <select class="field-pill" id="spend-by">
                   ${spend.people
                     .map(
                       (person) => `<option value="${escapeHtml(person.id)}" ${me && sameName(person.name) === me ? 'selected' : ''}>
                          ${escapeHtml(person.name)}
                        </option>`,
                     )
                     .join('')}
                 </select>
               </label>
               <label>
                 ${escapeHtml(t('spends.when'))}
                 <input class="field-pill" type="date" id="spend-day" value="${escapeHtml(dayNow())}" />
               </label>
             </div>

             ${
               spend.people.length > 1
                 ? `<div class="split-list">
                      <div class="split-list__head">
                        <span>${escapeHtml(t('spends.splitTitle'))}</span>
                        <span class="muted small">${escapeHtml(t('spends.splitHint'))}</span>
                      </div>
                      ${spend.people
                        .map(
                          (person) => `
                            <label class="split-row">
                              <input type="checkbox" data-for="${escapeHtml(person.id)}" checked />
                              <span class="split-row__name">${escapeHtml(person.name)}</span>
                            </label>`,
                        )
                        .join('')}
                    </div>`
                 : ''
             }

             <button type="submit" class="button button--primary button--block field-pill--submit">
               ${escapeHtml(t('spends.add'))}
             </button>
           </form>`
        : `<p class="muted small">${escapeHtml(t('spends.noPeople'))}</p>`
    }

    ${
      spend.lines.length
        ? `<ul class="lines">${[...spend.lines]
            .sort((a, b) => (b.day || '').localeCompare(a.day || '') || b.createdAt - a.createdAt)
            .map((line) => spendLineHtml(spend, line))
            .join('')}</ul>`
        : `<p class="muted small">${escapeHtml(t('spends.addFirst'))}</p>`
    }`;

  const balancesTab = !spend.lines.length
    ? `<p class="muted small">${escapeHtml(t('spends.balancesEmpty'))}</p>`
    : `
    <section class="section card">
      <div class="section__head"><h2>${escapeHtml(t('spends.balances'))}</h2></div>
      <div class="entries">
        ${rows
          .map(
            (row) => `
              <div class="entry">
                <span class="entry__what">
                  ${escapeHtml(row.name)}
                  <span class="muted small">${escapeHtml(t('spends.paidTotal', { amount: showAmount(row.paid, getLanguage()) }))}</span>
                </span>
                <span class="entry__value ${row.balance > 0 ? 'entry__value--good' : row.balance < 0 ? 'entry__value--bad' : ''}">
                  ${escapeHtml(
                    row.balance === 0
                      ? t('spends.even')
                      : t(row.balance > 0 ? 'spends.isOwed' : 'spends.owes', {
                          amount: showAmount(Math.abs(row.balance), getLanguage()),
                        }),
                  )}
                </span>
              </div>`,
          )
          .join('')}
      </div>
    </section>

    ${
      moves.length
        ? `<section class="section card">
             <div class="section__head"><h2>${escapeHtml(t('spends.settle'))}</h2></div>
             <div class="entries">
               ${moves
                 .map(
                   (move, index) => `
                     <div class="move">
                       <div class="entry">
                         <span class="entry__what">${escapeHtml(t('spends.move', { from: move.from, to: move.to }))}</span>
                         <span class="entry__value">${escapeHtml(showAmount(move.amount, getLanguage()))}</span>
                       </div>
                       <button type="button" class="button button--small button--primary" data-repay="${index}">
                         ${escapeHtml(t('spends.markPaid'))}
                       </button>
                     </div>`,
                 )
                 .join('')}
             </div>
             <p class="muted small">${escapeHtml(t('spends.settleHint'))}</p>
           </section>`
        : `<div class="settled-banner">
             <span class="settled-banner__icon" aria-hidden="true">👍</span>
             <span>
               <strong class="settled-banner__title">${escapeHtml(t('spends.allSettled'))}</strong>
               <br />
               <span class="muted small">${escapeHtml(t('spends.allSettledHint'))}</span>
             </span>
           </div>`
    }`;

  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(spendTitle(spend))}</h1>
        <p class="muted small">
          ${escapeHtml(t('spends.total', { amount: showAmount(spendTotal(spend), getLanguage()) }))}
          ${spend.shared ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/spends">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${eventLinkHtml(spend)}

    ${inGroupHtml(spend)}

    ${segmented}

    ${spendTab === 'balances' ? balancesTab : expensesTab}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small" id="spend-people">${escapeHtml(t('lists.people'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="spend-share">${escapeHtml(t('spends.share'))}</button>`
            : ''
        }
        <button type="button" class="button button--small button--ghost" id="spend-archive">
          ${escapeHtml(spend.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="spend-rename">${escapeHtml(t('spends.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="spend-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </section>`;
}

function bindNewSpend() {
  const form = view.querySelector('#new-spend');
  if (!form) return;

  const snapshot = () => {
    newSpendName = view.querySelector('#spend-name').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      newSpendPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    newSpendPeople = [...newSpendPeople, ''];
    render();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    newSpendPeople = newSpendPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (newSpendPeople.some((name) => name.trim().toLowerCase() === suggest.toLowerCase())) return;
      const empty = newSpendPeople.findIndex((name) => !name.trim());
      if (empty >= 0) newSpendPeople[empty] = suggest;
      else newSpendPeople = [...newSpendPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    snapshot();
    const group = await askGroup();
    const spend = createSpend({
      name: newSpendName,
      names: newSpendPeople,
      shared: Boolean(group),
      groupId: group?.id || null,
    });
    state.spends = [...state.spends, spend];
    persistSpend(spend);
    newSpendName = '';
    newSpendPeople = ['', ''];
    navigate(`#/spend/${spend.id}`);
  });
}

function bindSpend(spend) {
  bindData();

  view.querySelectorAll('[data-spend-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      spendTab = button.dataset.spendTab;
      render();
    });
  });

  view.querySelector('#add-spend')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = view.querySelector('#spend-text');
    const amount = view.querySelector('#spend-amount');
    const cents = readAmount(amount.value);
    if (!cents) {
      flash(t('spends.notAnAmount'), 'error');
      render();
      return;
    }
    const boxes = [...view.querySelectorAll('#add-spend [data-for]')];
    const checked = boxes.filter((box) => box.checked).map((box) => box.dataset.for);
    if (boxes.length && !checked.length) {
      flash(t('spends.noOneChosen'), 'error');
      render();
      return;
    }
    // Tous cochés (ou une seule personne, sans case) : « tout le monde » au
    // sens large, qui inclut qui rejoint le compte plus tard. Voir addSpend().
    replaceSpend(addSpend(spend, {
      text: text.value,
      amount: cents,
      by: view.querySelector('#spend-by').value,
      forWhom: checked.length === boxes.length ? [] : checked,
      day: view.querySelector('#spend-day')?.value || dayNow(),
    }));
  });

  view.querySelectorAll('[data-spend-line]').forEach((button) => {
    button.addEventListener('click', () => {
      const line = spend.lines.find((entry) => entry.id === button.dataset.spendLine);
      if (isRepayment(line)) openRepayDialog(spend, { line });
      else openSpendLineDialog(spend, button.dataset.spendLine);
    });
  });

  view.querySelectorAll('[data-repay]').forEach((button) => {
    button.addEventListener('click', () => {
      const move = settle(spend)[Number(button.dataset.repay)];
      if (move) openRepayDialog(spend, { move });
    });
  });

  view.querySelector('#spend-people')?.addEventListener('click', () => openSpendPeopleDialog(spend));

  view.querySelector('#spend-share')?.addEventListener('click', async () => {
    const group = await askGroup();
    if (!group) {
      flash(t('groups.needOne'));
      render();
      return;
    }
    const next = { ...spend, shared: true, groupId: group.id, updatedAt: Date.now() };
    replaceSpend(next);
    flash(t('spends.shared', { name: group.name }));
    render();
  });

  view.querySelector('#spend-archive')?.addEventListener('click', () => {
    const next = archiveSpend(spend, !spend.archivedAt);
    flash(t(next.archivedAt ? 'archive.done' : 'archive.undone'));
    replaceSpend(next, { redraw: !next.archivedAt });
    if (next.archivedAt) navigate('#/spends');
  });

  view.querySelector('#spend-rename')?.addEventListener('click', async () => {
    const name = await askForText({
      title: t('spends.rename'),
      hint: t('spends.renameHint'),
      value: spend.name,
      confirmLabel: t('action.save'),
    });
    if (name === null) return;
    replaceSpend({ ...spend, name: String(name).trim(), updatedAt: Date.now() });
  });

  view.querySelector('#spend-delete')?.addEventListener('click', async () => {
    if (!(await ask(t('spends.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.spends = state.spends.filter((item) => item.id !== spend.id);
    saveSpends(state.spends);
    if (state.store) void state.store.remove(spend.id);
    if (state.remote && spend.shared) state.remote.remove(spend.id, keyFor(spend), organiserSecret(spend.id)).catch(() => {});
    navigate('#/spends');
  });
}

/** Une dépense : ce qu'elle était, pour qui, quel jour — et de quoi l'effacer. */
function openSpendLineDialog(spend, lineId) {
  const line = spend.lines.find((entry) => entry.id === lineId);
  if (!line) return;

  const dialog = makeDialog();
  const chosen = new Set(line.forWhom);
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('spends.lineTitle'))}</h2>
      <label>
        ${escapeHtml(t('spends.what'))}
        <input type="text" id="line-what" value="${escapeHtml(line.text)}" />
      </label>
      <label>
        ${escapeHtml(t('spends.amount'))}
        <input type="text" id="line-amount" inputmode="decimal" value="${escapeHtml((line.amount / 100).toFixed(2).replace('.', ','))}" />
      </label>
      <label>
        ${escapeHtml(t('spends.by'))}
        <select id="line-by">
          ${spend.people
            .map(
              (person) => `<option value="${escapeHtml(person.id)}" ${person.id === line.by ? 'selected' : ''}>
                 ${escapeHtml(person.name)}
               </option>`,
            )
            .join('')}
        </select>
      </label>
      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('spends.forWhomHint'))}</span>
        <div class="row" id="line-for">
          ${spend.people
            .map(
              (person) => `
                <button type="button" class="chip ${chosen.has(person.id) ? 'chip--on' : ''}"
                        data-for="${escapeHtml(person.id)}" aria-pressed="${chosen.has(person.id) ? 'true' : 'false'}">
                  ${escapeHtml(person.name)}
                </button>`,
            )
            .join('')}
        </div>
      </div>
      <label>
        ${escapeHtml(t('lists.due'))}
        <input type="date" id="line-day" value="${escapeHtml(line.day || '')}" />
      </label>
      <div class="row">
        <button type="button" class="button button--primary" id="line-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="line-cancel">${escapeHtml(t('action.cancel'))}</button>
        <button type="button" class="button button--danger" id="line-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </form>`;

  dialog.querySelectorAll('[data-for]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.for;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      chip.classList.toggle('chip--on', chosen.has(id));
      chip.setAttribute('aria-pressed', chosen.has(id) ? 'true' : 'false');
    });
  });

  dialog.querySelector('#line-save').addEventListener('click', () => {
    const amount = dialog.querySelector('#line-amount').value;
    if (!readAmount(amount)) {
      flash(t('spends.notAnAmount'), 'error');
      dialog.close();
      render();
      return;
    }
    dialog.close();
    replaceSpend(editSpend(spend, lineId, {
      text: dialog.querySelector('#line-what').value,
      amount,
      by: dialog.querySelector('#line-by').value,
      forWhom: [...chosen],
      day: dialog.querySelector('#line-day').value,
    }));
  });

  dialog.querySelector('#line-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#line-delete').addEventListener('click', () => {
    dialog.close();
    replaceSpend(removeSpend(spend, lineId));
  });

  dialog.showModal();
}

/**
 * A repayment: who gave back how much to whom, and when. Opened from a line
 * of "who pays whom", filled in with it — the amount stays editable, since a
 * debt is often paid back in more than one go — or from a repayment already
 * noted, to correct it or take it back.
 */
function openRepayDialog(spend, { move = null, line = null }) {
  const from = line ? line.by : move.fromId;
  const to = line ? line.forWhom[0] : move.toId;
  const amount = line ? line.amount : move.amount;
  const person = (id) => spend.people.find((one) => one.id === id)?.name || '';
  const choose = (id, selected) => `
    <select id="${id}">
      ${spend.people
        .map((one) => `<option value="${escapeHtml(one.id)}" ${one.id === selected ? 'selected' : ''}>${escapeHtml(one.name)}</option>`)
        .join('')}
    </select>`;

  const dialog = makeDialog();
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(line ? t('spends.repayment') : t('spends.repaid', { from: person(from), to: person(to) }))}</h2>
      ${
        line
          ? `<div class="field-row">
               <label>${escapeHtml(t('spends.repayFrom'))} ${choose('repay-from', from)}</label>
               <label>${escapeHtml(t('spends.repayTo'))} ${choose('repay-to', to)}</label>
             </div>`
          : `<p class="muted small">${escapeHtml(t('spends.repayHint'))}</p>`
      }
      <label>
        ${escapeHtml(t('spends.amount'))}
        <input type="text" id="repay-amount" inputmode="decimal" value="${escapeHtml((amount / 100).toFixed(2).replace('.', ','))}" />
      </label>
      <label>
        ${escapeHtml(t('spends.when'))}
        <input type="date" id="repay-day" value="${escapeHtml(line?.day || dayNow())}" />
      </label>
      <div class="row">
        <button type="button" class="button button--primary" id="repay-save">
          ${escapeHtml(line ? t('action.save') : t('spends.markPaid'))}
        </button>
        <button type="button" class="button" id="repay-cancel">${escapeHtml(t('action.cancel'))}</button>
        ${line ? `<button type="button" class="button button--danger" id="repay-delete">${escapeHtml(t('action.delete'))}</button>` : ''}
      </div>
    </form>`;

  dialog.querySelector('#repay-save').addEventListener('click', () => {
    const typed = dialog.querySelector('#repay-amount').value;
    const cents = readAmount(typed);
    const day = dialog.querySelector('#repay-day').value || dayNow();
    const payer = dialog.querySelector('#repay-from')?.value || from;
    const payee = dialog.querySelector('#repay-to')?.value || to;
    dialog.close();
    if (!cents) {
      flash(t('spends.notAnAmount'), 'error');
      render();
      return;
    }
    if (payer === payee) {
      flash(t('spends.repaySame'), 'error');
      render();
      return;
    }
    const current = getSpend(spend.id) || spend;
    replaceSpend(line
      ? editSpend(current, line.id, { amount: cents, by: payer, forWhom: [payee], day })
      : addRepayment(current, { from: payer, to: payee, amount: cents, day }));
  });
  dialog.querySelector('#repay-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#repay-delete')?.addEventListener('click', () => {
    dialog.close();
    replaceSpend(removeSpend(getSpend(spend.id) || spend, line.id));
  });

  dialog.showModal();
}

/** Qui ce compte concerne : ajouter, renommer, retirer — quand c'est possible. */
function openSpendPeopleDialog(spend) {
  const dialog = makeDialog();

  const draw = () => {
    const current = getSpend(spend.id) || spend;
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('lists.people'))}</h2>
        <div class="stack stack--tight">
          ${current.people
            .map(
              (person) => `
                <div class="knock">
                  <strong>${escapeHtml(person.name)}</strong>
                  <div class="row">
                    <button type="button" class="button button--small" data-rename="${escapeHtml(person.id)}">
                      ${escapeHtml(t('action.rename'))}
                    </button>
                    <button type="button" class="button button--small button--ghost" data-drop="${escapeHtml(person.id)}">
                      ${escapeHtml(t('action.delete'))}
                    </button>
                  </div>
                </div>`,
            )
            .join('')}
        </div>
        <div class="row row--tight">
          <input type="text" id="spend-person" placeholder="${escapeHtml(t('lists.addPerson'))}" autocomplete="off" />
          <button type="button" class="button" id="spend-person-add">+</button>
        </div>
        <div class="row">
          <button type="button" class="button" id="people-close">${escapeHtml(t('action.close'))}</button>
        </div>
      </div>`;

    dialog.querySelector('#spend-person-add').addEventListener('click', () => {
      const field = dialog.querySelector('#spend-person');
      const next = addSpendPerson(getSpend(spend.id) || spend, field.value);
      field.value = '';
      replaceSpend(next, { redraw: false });
      draw();
    });

    dialog.querySelectorAll('[data-rename]').forEach((button) => {
      button.addEventListener('click', async () => {
        const held = getSpend(spend.id) || spend;
        const person = held.people.find((one) => one.id === button.dataset.rename);
        if (!person) return;
        const name = await askForText({
          title: t('action.rename'),
          hint: t('spends.renamePersonHint'),
          value: person.name,
          confirmLabel: t('action.save'),
        });
        if (name === null) return;
        replaceSpend(renameSpendPerson(held, person.id, name), { redraw: false });
        draw();
      });
    });

    dialog.querySelectorAll('[data-drop]').forEach((button) => {
      button.addEventListener('click', () => {
        const held = getSpend(spend.id) || spend;
        const why = canRemovePerson(held, button.dataset.drop);
        if (why !== 'ok') {
          // Retirer un payeur déséquilibrerait le compte sans rien dire : mieux
          // vaut refuser en expliquant que rendre un remboursement faux.
          flash(t(why === 'paid' ? 'spends.cannotDropPaid' : 'spends.cannotDropAlone'), 'error');
          dialog.close();
          render();
          return;
        }
        replaceSpend(removeSpendPerson(held, button.dataset.drop), { redraw: false });
        draw();
      });
    });

    dialog.querySelector('#people-close').addEventListener('click', () => {
      dialog.close();
      render();
    });
  };

  draw();
  dialog.showModal();
}

/* ----------------------------------------------------------------- router --- */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  if (name === 'games') return { name: 'home' };
  // An invitation link carries both the six digits and the group's name, so
  // the person who receives it has nothing to read out and nothing to type.
  // A return link: a person's own token, which hands this browser a key.
  if (name === 'back' && param) return { name: 'back', token: backTokenFrom(location.hash) };
  if (name === 'join' && param) {
    const invitation = joinFrom(location.hash);
    if (invitation) return { name: 'join', code: invitation.code, group: invitation.name };
    // Half a link is still half a link: whichever of the two survived is kept,
    // and the page asks for the other rather than for both.
    return { name: 'join', code: readCode(param), group: groupSegment(hash) };
  }
  // Someone's own page, reached from the overview. Both spellings open it: the
  // app speaks two languages, and a link once sent is a link for ever.
  if ((name === 'person' || name === 'personne') && param) {
    return { name: 'person', who: personFrom(param) };
  }
  // One group, everything in it: #/group/<id>, from the overview.
  if (name === 'group' && param) return { name: 'group', id: decodeSegment(param) };
  if (name === 'groups') return { name: 'groups' };
  if (name === 'settings' || name === 'reglages') return { name: 'settings' };
  if (name === 'new') return { name: 'new' };
  if (name === 'stats') return { name: 'stats' };
  if (name === 'game' && param) return { name: 'game', id: param };
  if (name === 'set' && param) return { name: 'set', id: param };
  if (name === 'lists' && param === 'new') return { name: 'new-list' };
  if (name === 'lists') return { name: 'lists' };
  if (name === 'list' && param) return { name: 'list', id: param };
  if (name === 'spends' && param === 'new') return { name: 'new-spend' };
  if (name === 'spends') return { name: 'spends' };
  if (name === 'agenda' && param === 'new') return { name: 'new-event' };
  if (name === 'agenda') return { name: 'agenda' };
  if (name === 'spend' && param) return { name: 'spend', id: param };
  if (name === 'polls' && param === 'new') return { name: 'new-poll' };
  if (name === 'polls') return { name: 'polls' };
  // A shared link opens the poll alone: `#/poll/<id>/solo`. See pollView().
  if (name === 'poll' && param) return { name: 'poll', id: param, solo: hash.split('/')[2] === 'solo' };
  return { name: 'overview' };
}

/**
 * Where a poll is listed, so its page goes back there: the agenda for a day
 * that is settled or still being looked for, the home page's polls otherwise.
 */
function pollHome(poll) {
  return isEvent(poll) || poll.date || (!poll.closedAt && seeksDay(poll)) ? '#/agenda' : '#/polls';
}

/** A segment of the address, decoded if it can be. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The name written in `#/person/<name>`, decoded if it can be. */
function personFrom(segment) {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return String(segment).trim();
  }
}

/** The group's name as written in `#/join/<code>/<name>`, decoded if it can be. */
function groupSegment(hash) {
  const segment = hash.split('/')[2] || '';
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ------------------------------------------------------------------ views --- */

function flashHtml() {
  if (!state.flash) return '';
  const { message, kind, shownAt } = state.flash;
  // Shown for the first time: the clock starts here rather than when the message
  // was raised, so one that had to wait — for a screen where someone was typing,
  // say — is still read rather than silently dropped.
  if (!shownAt) {
    state.flash = { ...state.flash, shownAt: Date.now() };
  } else if (Date.now() - shownAt > FLASH_KEPT) {
    state.flash = null;
    return '';
  }
  return `<p class="banner ${kind === 'error' ? 'banner--warn' : ''}">${escapeHtml(message)}</p>`;
}

/**
 * The group pastilles, shown above the lists, the polls and the games.
 *
 * From two groups on: with one, there is nothing to choose between, and a row
 * of buttons that can only say "everything" is noise. The line under them is
 * the same count the overview shows, for whatever is on screen.
 */
function groupChipsHtml() {
  const held = groupsByName();
  const everything = [...state.lists, ...state.polls, ...state.games, ...state.spends];
  const outside = everything.some(outsideGroups);
  // With one group and nothing outside it, there is nothing to choose between.
  if (!held.length || (held.length < 2 && !outside)) return '';
  const active = groupFilter();
  const counted = active === OUTSIDE_GROUPS
    ? groupCounts({
        lists: shownDocs(state.lists), polls: shownDocs(state.polls),
        games: shownDocs(state.games), spends: shownDocs(state.spends),
      })
    : groupCounts(state, active);
  const chip = (id, label) => `
    <button type="button" class="chip ${active === id ? 'chip--on' : ''}"
            data-group-filter="${escapeHtml(id)}" aria-pressed="${active === id ? 'true' : 'false'}">
      ${escapeHtml(label)}
    </button>`;
  return `
    <div class="row" role="group" aria-label="${escapeHtml(t('filter.by'))}">
      ${chip('', t('filter.all'))}
      ${held.map((group) => chip(group.id, group.name)).join('')}
      ${outside || active === OUTSIDE_GROUPS ? chip(OUTSIDE_GROUPS, t('filter.others')) : ''}
    </div>
    <p class="muted small">${escapeHtml(t('overview.counts', counted))}</p>`;
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

/* --------------------------------------------------------------- overview --- */

/**
 * The page the app opens on: what is going on, and what the app is made of.
 *
 * It holds what belongs to no one tab — the groups this device is in, the
 * data, the app's own link — and the few things actually in progress across
 * the three, so that opening the app answers "where were we" before it asks
 * anything.
 */
/**
 * What is coming: the days this group's polls settled on, and the lines that
 * are due on one, in the order they will happen.
 *
 * Built from the very same agendaFor() the .ics is built from, so what shows
 * here and what a subscribed calendar receives cannot drift apart. Overdue
 * lines come first: a day that has passed is the one thing worth looking at
 * before the ones that have not.
 */
function comingHtml() {
  const today = dayNow();
  const events = agendaFor({ lists: shownDocs(state.lists), polls: shownDocs(state.polls) });
  // An event over several days is late only once its last day has gone.
  const ends = (event) => event.until || event.day;
  const late = events.filter((event) => ends(event) < today);
  const coming = events.filter((event) => ends(event) >= today);

  if (!events.length) {
    return `<p class="muted small">${escapeHtml(t('agenda.nothing'))}</p>
            ${hiddenByGroupHtml([...state.lists, ...state.polls])}`;
  }

  const shown = [...late.slice(-3), ...coming.slice(0, 8)];
  const hidden = events.length - shown.length;

  const row = (event) => {
    const overdue = ends(event) < today;
    const when = whenText({ date: event.day, until: event.until, at: event.at }, { long: true });
    return `
      <button type="button" class="game-card" data-goto="#/${event.kind === 'poll' ? 'poll' : 'list'}/${escapeHtml(event.docId)}">
        <span class="game-card__title">
          ${escapeHtml(event.summary)}
          ${overdue ? `<span class="pill pill--late">${escapeHtml(t('agenda.late'))}</span>` : ''}
        </span>
        <span class="game-card__meta">${escapeHtml(when)}${event.description ? ` · ${escapeHtml(event.description)}` : ''}</span>
      </button>`;
  };

  return `
    <div class="game-list">${shown.map(row).join('')}</div>
    ${hidden > 0 ? `<p class="muted small">${escapeHtml(t('agenda.more', { count: hidden }))}</p>` : ''}`;
}

/**
 * The rest of what is going on, a few of each kind — leaving out what "For
 * you" already shows, which is given as the addresses it opens.
 */
function pendingHtml(shown = new Set()) {
  const lines = [];
  const recent = (a, b) => b.updatedAt - a.updatedAt;
  const notShown = (goto) => (document_) => !shown.has(`${goto}${document_.id}`);

  const ongoing = shownDocs(state.games).filter((game) => isLive(game) && !gameStatus(game).finished)
    .filter(notShown('#/game/')).sort(recent);
  const open = shownDocs(state.lists).filter((list) => isLive(list) && progress(list).left > 0)
    .filter(notShown('#/list/')).sort(recent);
  const asked = shownDocs(state.polls).filter((poll) => isLive(poll) && !poll.closedAt)
    .filter(notShown('#/poll/')).sort(recent);
  const owing = shownDocs(state.spends).filter((spend) => isLive(spend) && balances(spend).some((row) => row.balance !== 0))
    .filter(notShown('#/spend/')).sort(recent);

  for (const list of open.slice(0, 3)) {
    const { left } = progress(list);
    lines.push({
      goto: `#/list/${list.id}`,
      title: listTitle(list),
      meta: t('lists.leftToDo', { count: left }),
    });
  }
  for (const poll of asked.slice(0, 3)) {
    const { answered } = tally(poll);
    lines.push({
      goto: `#/poll/${poll.id}`,
      title: pollTitle(poll),
      meta: t('polls.answered', { count: answered, total: poll.people.length }),
    });
  }
  for (const spend of owing.slice(0, 3)) {
    const mine = myBalance(spend);
    lines.push({
      goto: `#/spend/${spend.id}`,
      title: spendTitle(spend),
      meta: mine && mine.balance !== 0
        ? t(mine.balance > 0 ? 'spends.owedToMe' : 'spends.iOwe', { amount: showAmount(Math.abs(mine.balance), getLanguage()) })
        : t('spends.total', { amount: showAmount(spendTotal(spend), getLanguage()) }),
    });
  }
  for (const game of ongoing.slice(0, 3)) {
    lines.push({
      goto: `#/game/${game.id}`,
      title: gameTitle(game),
      meta: t('home.rounds', { count: game.rounds.length }),
    });
  }

  if (!lines.length) {
    return shown.size ? '' : `<p class="muted small">${escapeHtml(t('overview.nothing'))}</p>`;
  }
  return `<div class="game-list">${lines
    .map(
      (line) => `
        <button type="button" class="game-card" data-goto="${escapeHtml(line.goto)}">
          <span class="game-card__title">${escapeHtml(line.title)}</span>
          <span class="game-card__meta">${escapeHtml(line.meta)}</span>
        </button>`,
    )
    .join('')}</div>`;
}

/**
 * What the gatekeeper of a group sees: the people knocking, each with the first
 * name they gave, and one tap to let them in or turn them away.
 */
function requestsHtml(group) {
  const rows = gate().requests[group.id];
  if (!rows) return `<p class="muted small">${escapeHtml(t('gate.loading'))}</p>`;
  if (!rows.length) return `<p class="muted small">${escapeHtml(t('gate.nobody'))}</p>`;

  return `<div class="stack stack--tight">${rows
    .map(
      (row) => `
        <div class="knock">
          <div>
            <strong>${escapeHtml(row.name || t('gate.someone'))}</strong>
            <span class="muted small">${escapeHtml(row.label || '')}</span>
          </div>
          <div class="row row--tight">
            <button type="button" class="button button--small button--primary"
                    data-admit="${escapeHtml(group.id)}" data-request="${escapeHtml(row.id)}">
              ${escapeHtml(t('gate.admit'))}
            </button>
            <button type="button" class="button button--small button--ghost"
                    data-refuse="${escapeHtml(group.id)}" data-request="${escapeHtml(row.id)}">
              ${escapeHtml(t('gate.refuse'))}
            </button>
          </div>
        </div>`,
    )
    .join('')}</div>`;
}

/** Who is in the group, device by device, and the one tap that cuts one off. */
function devicesHtml(group) {
  const rows = gate().devices[group.id];
  if (!rows) return `<p class="muted small">${escapeHtml(t('gate.loading'))}</p>`;

  return `<div class="stack stack--tight">${rows
    .map(
      (row) => `
        <div class="knock">
          <div>
            <strong>${escapeHtml(row.label || t('gate.unnamedDevice'))}</strong>
            <span class="muted small">${escapeHtml(
              [
                row.mine ? t('gate.thisDevice') : '',
                row.admits ? t('gate.admitsToo') : '',
                row.link ? t('back.hasLink') : '',
              ]
                .filter(Boolean)
                .join(' · '),
            )}</span>
          </div>
          <div class="row row--tight">
            ${
              row.link
                ? `<button type="button" class="button button--small button--ghost"
                           data-cut-link="${escapeHtml(group.id)}" data-person="${escapeHtml(row.person)}">
                     ${escapeHtml(t('back.cutLink'))}
                   </button>`
                : ''
            }
            <button type="button" class="button button--small button--ghost"
                    data-admits="${escapeHtml(group.id)}" data-key="${escapeHtml(row.id)}"
                    data-allow="${row.admits ? 'no' : 'yes'}">
              ${escapeHtml(t(row.admits ? 'gate.dropAdmits' : 'gate.giveAdmits'))}
            </button>
            ${
              row.mine
                ? ''
                : `<button type="button" class="button button--small button--ghost"
                           data-cut="${escapeHtml(group.id)}" data-key="${escapeHtml(row.id)}">
                     ${escapeHtml(t('gate.cut'))}
                   </button>`
            }
          </div>
        </div>`,
    )
    .join('')}</div>`;
}

/** The knocks this device is waiting on, so a wait is never invisible. */
function myKnocksHtml() {
  const held = pendings();
  if (!held.length) return '';
  return `
    <div class="stack stack--tight">${held
      .map(
        // The ticket is this device's future key: it stays in storage, and the
        // buttons carry a place in the list instead.
        (knock, index) => `
          <div class="knock">
            <div>
              <strong>${escapeHtml(knock.groupName)}</strong>
              <span class="muted small">${escapeHtml(t('gate.askedAt', { date: formatDate(knock.at) }))}</span>
            </div>
            <div class="row row--tight">
              <button type="button" class="button button--small" data-check="${index}">
                ${escapeHtml(t('gate.check'))}
              </button>
              <button type="button" class="button button--small button--ghost" data-drop="${index}">
                ${escapeHtml(t('gate.dropMine'))}
              </button>
            </div>
          </div>`,
      )
      .join('')}</div>`;
}

function groupsHtml() {
  const held = groups();
  return `
    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('groups.manage'))}</h2></div>
      <p class="muted small">${escapeHtml(t('groups.hint'))}</p>
      ${
        held.length
          ? `<p class="muted small">${escapeHtml(t('groups.keepKey'))}</p>`
          : ''
      }
      ${
        // Une app posée sur l'écran d'accueil part de zéro : le dire ici, avant
        // qu'on la pose, plutôt que de la laisser paraître cassée une fois posée.
        held.length && !onHomeScreen()
          ? `<p class="muted small">${escapeHtml(t('groups.beforeHomeScreen'))}</p>`
          : ''
      }
      ${
        held.length
          ? `<div class="stack stack--tight">${held
              .map(
                (group) => `
                  <div class="group">
                    <div>
                      <strong>${escapeHtml(group.name)}</strong>
                      <span class="muted small">${escapeHtml(t('groups.shared', {
                        count: [...state.games, ...state.lists, ...state.polls, ...state.spends]
                          .filter((document_) => document_.groupId === group.id).length,
                      }))}</span>
                    </div>
                    <div class="row">
                      <button type="button" class="button button--small" data-invite="${escapeHtml(group.id)}">
                        ${escapeHtml(t('groups.invite'))}
                      </button>
                      <button type="button" class="button button--small" data-catch-up="${escapeHtml(group.id)}">
                        ${escapeHtml(t('groups.catchUp'))}
                      </button>
                      <button type="button" class="button button--small button--ghost" data-show-key="${escapeHtml(group.id)}">
                        ${escapeHtml(t('groups.showKey'))}
                      </button>
                      ${
                        // The founder's key belongs to no person, so it has no
                        // return link — it is the one that gets pasted instead.
                        group.admits
                          ? ''
                          : `<button type="button" class="button button--small button--ghost" data-my-link="${escapeHtml(group.id)}">
                               ${escapeHtml(t('back.myLink'))}
                             </button>`
                      }
                      <button type="button" class="button button--small button--ghost" data-calendar="${escapeHtml(group.id)}">
                        ${escapeHtml(t('agenda.group'))}
                      </button>
                      <button type="button" class="button button--small button--ghost" data-cut-calendar="${escapeHtml(group.id)}">
                        ${escapeHtml(t('agenda.cut'))}
                      </button>
                      <button type="button" class="button button--small button--ghost" data-leave="${escapeHtml(group.id)}">
                        ${escapeHtml(t('groups.leave'))}
                      </button>
                    </div>
                    ${
                      group.admits === false
                        ? ''
                        : `<div class="stack stack--tight">
                             <span class="muted small">${escapeHtml(t('gate.knocking'))}</span>
                             ${requestsHtml(group)}
                             <details class="details">
                               <summary>${escapeHtml(t('gate.who'))}</summary>
                               ${devicesHtml(group)}
                             </details>
                           </div>`
                    }
                  </div>`,
              )
              .join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('groups.none'))}</p>
             ${inAppWarningHtml()}
             ${
               // An app added to the home screen keeps its own files and its own
               // storage: it is a second device, not the same one, and the first
               // time that surprises someone is when their group is not there.
               onHomeScreen()
                 ? `<p class="muted small">${escapeHtml(t('groups.standaloneNew'))}</p>`
                 : ''
             }`
      }

      ${
        pendings().length
          ? `<div class="stack stack--tight">
               <span class="muted small">${escapeHtml(t('gate.mine'))}</span>
               ${myKnocksHtml()}
             </div>`
          : ''
      }

      <label for="group-name">${escapeHtml(t('groups.add'))}</label>
      <div class="row row--tight">
        <input type="text" id="group-name" autocomplete="off"
               placeholder="${escapeHtml(t('groups.namePlaceholder'))}" />
        <input type="text" id="group-code" class="code-input" inputmode="numeric" autocomplete="one-time-code"
               placeholder="000000" aria-label="${escapeHtml(t('groups.codePlaceholder'))}" />
      </div>
      <button type="button" class="button button--primary button--block" id="group-join">${escapeHtml(t('gate.knock'))}</button>
      <p class="muted small" id="group-state">${escapeHtml(t('groups.codeHint'))}</p>

      <details class="details">
        <summary>${escapeHtml(t('groups.withKey'))}</summary>
        <p class="muted small">${escapeHtml(t('groups.keyHint'))}</p>
        <div class="row row--tight">
          <input type="password" id="group-key" autocomplete="off" spellcheck="false"
                 placeholder="${escapeHtml(t('groups.keyPlaceholder'))}" />
          <button type="button" class="button" id="group-paste">${escapeHtml(t('groups.join'))}</button>
        </div>
      </details>
    </section>`;
}

/**
 * Who this device belongs to. Shown here rather than buried in a setting,
 * because it is what the app puts in a group's list of keys and what it offers
 * as the first person of every new list.
 */
function meHtml() {
  return `
    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('me.title'))}</h2></div>
      <p class="muted small">${escapeHtml(t(state.remote ? 'me.hint' : 'me.hintAlone'))}</p>
      <div class="row row--tight">
        <input type="text" id="me-name" autocomplete="given-name" maxlength="${NAME_KEPT}"
               value="${escapeHtml(myName())}" placeholder="${escapeHtml(t('me.placeholder'))}"
               aria-label="${escapeHtml(t('me.title'))}" />
        <button type="button" class="button" id="me-save">${escapeHtml(t('action.save'))}</button>
      </div>
    </section>`;
}

/**
 * The overview's group boards: what each group has on the go, in numbers that
 * are also the way in — tapping one opens that tab, already on that group.
 */
function byGroupHtml() {
  const held = groupsByName();
  if (!held.length) return '';
  return `
    <section class="section">
      <div class="section__head">
        <h2>${escapeHtml(t('groups.title'))}</h2>
        <span class="muted small">${escapeHtml(t('dash.groupCount', { count: held.length }))}</span>
      </div>
      ${held.map(groupBoardHtml).join('')}
    </section>`;
}

function groupBoardHtml(group) {
  const counts = groupCounts(state, group.id);
  const tile = (value, label, goto) => `
    <button type="button" class="tile" data-group-tile="${escapeHtml(group.id)}" data-tile-goto="${goto}"
            aria-label="${escapeHtml(`${group.name} — ${value} ${label}`)}">
      <span class="tile__value">${value}</span>
      <span class="tile__label">${escapeHtml(label)}</span>
    </button>`;
  return `
    <div class="card stack stack--tight">
      <div class="spread">
        <button type="button" class="group-link" data-goto="#/group/${escapeHtml(encodeURIComponent(group.id))}">
          <strong>${escapeHtml(group.name)}</strong>
          <span class="muted small">${escapeHtml(t('group.open'))} ›</span>
        </button>
        ${
          // The key that may let people in is the one worth naming: it is the
          // only one whose holder has anything to do when someone knocks.
          group.admits === false
            ? `<span class="muted small">${escapeHtml(t('dash.member'))}</span>`
            : `<span class="pill">${escapeHtml(t('dash.gate'))}</span>`
        }
      </div>
      <div class="tiles">
        ${tile(counts.lists, t('tab.lists'), '#/lists')}
        ${tile(counts.polls, t('tab.polls'), '#/polls')}
        ${tile(counts.games, t('tab.games'), '#/games')}
        ${tile(counts.spends, t('tab.spends'), '#/spends')}
      </div>
      <p class="muted small">
        ${escapeHtml(t('dash.peopleCount', { count: counts.people }))}${
          counts.at ? ` · ${escapeHtml(formatDate(counts.at))}` : ''
        }${counts.late ? ` · <span class="late">${escapeHtml(t('lists.late', { count: counts.late }))}</span>` : ''}
      </p>
    </div>`;
}

/**
 * Who is in a group, and what is still waiting on each of them — folded away
 * by default. It used to sit in the open on the overview, for every group at
 * once; on a page already scoped to one group, it earns a spot, but not one
 * that pushes past what a group is coming here for: what is going on.
 */
function groupPeopleHtml(group) {
  const mine = (documents) => documents.filter((document_) => inGroup(document_, group.id));
  const me = sameName(myName());
  const names = [...peopleIn({
    lists: mine(state.lists), polls: mine(state.polls), games: mine(state.games), spends: mine(state.spends),
  })].sort((a, b) => (me ? (sameName(a) === me ? 0 : 1) - (sameName(b) === me ? 0 : 1) : 0) || a.localeCompare(b));
  if (!names.length) return '';

  const row = (name) => {
    const { counts } = personFile(state, name);
    const waiting = waitingLine(counts);
    return `
      <button type="button" class="game-card" data-goto="#/person/${escapeHtml(encodeURIComponent(name))}">
        <span class="game-card__title">${escapeHtml(me && sameName(name) === me ? t('dash.you', { name }) : name)}</span>
        <span class="game-card__meta">${escapeHtml(waiting || t('dash.nothing'))}</span>
      </button>`;
  };

  return `
    <details class="details">
      <summary>${escapeHtml(t('group.who'))}</summary>
      <div class="game-list">${names.map(row).join('')}</div>
    </details>`;
}

/**
 * One group, and everything going on in it, on one page.
 *
 * The tabs sort by kind — lists here, polls there — but the question people
 * come with is about a group: "what is on with the Thursday lot?". So the
 * answer is on one page: what is coming, what is left to tick, to vote, to
 * play, to pay back. Only what is in progress; "see all" opens the tab,
 * already set on this group, for the rest.
 */
function groupView(group) {
  const ours = (documents) => documents.filter((document_) => isLive(document_) && inGroup(document_, group.id));
  const today = dayNow();
  const byDay = (a, b) => a.date.localeCompare(b.date) || String(a.at || '').localeCompare(String(b.at || ''));
  const recent = (a, b) => b.updatedAt - a.updatedAt;
  const events = ours(state.polls).filter((poll) => poll.date && lastDay(poll) >= today).sort(byDay);
  const polls = ours(state.polls)
    .filter((poll) => !isEvent(poll) && !poll.closedAt && !events.includes(poll))
    .sort(recent);
  const lists = ours(state.lists).filter((list) => progress(list).left > 0).sort(recent);
  const games = ours(state.games).filter((game) => !gameStatus(game).finished).sort(recent);
  const spends = ours(state.spends)
    .filter((spend) => balances(spend).some((row) => row.balance !== 0))
    .sort(recent);
  const counts = groupCounts(state, group.id);

  const section = (title, documents, cardHtml, tab) =>
    documents.length
      ? `<section class="section">
           <div class="section__head">
             <h2>${escapeHtml(title)}</h2>
             <button type="button" class="button button--small button--ghost"
                     data-group-tile="${escapeHtml(group.id)}" data-tile-goto="${tab}">
               ${escapeHtml(t('group.seeAll'))}
             </button>
           </div>
           <div class="game-list">${documents.map(cardHtml).join('')}</div>
         </section>`
      : '';

  const sections = [
    section(t('events.coming'), events, eventCardHtml, '#/agenda'),
    section(t('lists.ongoing'), lists, listCardHtml, '#/lists'),
    section(t('polls.ongoing'), polls, pollCardHtml, '#/polls'),
    section(t('home.ongoing'), games, gameCardHtml, '#/games'),
    section(t('events.accounts'), spends, spendCardHtml, '#/spends'),
  ].join('');

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(group.name)}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/groups">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>
    <p class="muted small">
      ${escapeHtml(t('dash.peopleCount', { count: counts.people }))} · ${escapeHtml(t('overview.counts', counts))}
    </p>
    <button type="button" class="button button--primary button--block" data-create-menu>
      + ${escapeHtml(t('create.title'))}
    </button>
    ${sections || `<p class="muted small">${escapeHtml(t('group.nothing'))}</p>`}
    ${groupPeopleHtml(group)}`;
}

/**
 * The "+" in the tab bar: whatever can be made, from wherever one is — and
 * where it will go, said and changeable right here.
 *
 * The destination was once only stated ("it will go into Mifa"), and followed
 * whatever filter happened to be set; people found everything landing in one
 * group without having chosen it. So the menu shows the choice as chips, set
 * on the obvious answer — the group whose page this is, the group picked at
 * the top of Home, the only group there is — and one tap changes it. The form
 * that opens carries it on, with the same chips.
 */
function openCreateMenu() {
  const dialog = makeDialog();
  const here = route();
  resetGroupChoice();
  const fromPage = here.name === 'group' ? groups().find((group) => group.id === here.id) : null;
  const start = fromPage ? { group: fromPage, linkOnly: false } : destinationForNew();
  let chosen = start.linkOnly ? LINK_ONLY : start.group?.id || '';
  const asks = Boolean(state.remote && groups().length);

  const choice = (goto, label) => `
    <button type="button" class="button button--block" data-create="${goto}">+ ${escapeHtml(label)}</button>`;
  const chip = (id, label) => `
    <button type="button" class="chip ${chosen === id ? 'chip--on' : ''}"
            data-create-into="${escapeHtml(id)}" aria-pressed="${chosen === id ? 'true' : 'false'}">
      ${escapeHtml(label)}
    </button>`;
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('create.what'))}</h2>
      ${
        asks
          ? `<div class="stack stack--tight">
               <span class="muted small">${escapeHtml(t('groups.willGoIn'))}</span>
               <div class="row" role="group" aria-label="${escapeHtml(t('groups.willGoIn'))}">
                 ${groupsByName().map((group) => chip(group.id, group.name)).join('')}
                 ${chip(LINK_ONLY, t('groups.linkOnly'))}
                 ${chip('', t('groups.keepToMyself'))}
               </div>
             </div>`
          : ''
      }
      <div class="create-menu">
        ${choice('#/lists/new', t('lists.new'))}
        ${choice('#/polls/new', t('polls.new'))}
        ${choice('#/agenda/new', t('events.new'))}
        ${choice('#/new', t('action.newGame'))}
        ${choice('#/spends/new', t('spends.new'))}
      </div>
      <div class="row">
        <button type="button" class="button button--ghost" data-create-close>${escapeHtml(t('action.cancel'))}</button>
      </div>
    </div>`;
  dialog.querySelectorAll('[data-create-into]').forEach((node) => {
    node.addEventListener('click', () => {
      chosen = node.dataset.createInto;
      dialog.querySelectorAll('[data-create-into]').forEach((other) => {
        const on = other.dataset.createInto === chosen;
        other.classList.toggle('chip--on', on);
        other.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });
  dialog.querySelectorAll('[data-create]').forEach((node) => {
    node.addEventListener('click', () => {
      // Said in the menu is chosen: the form starts from it.
      if (asks) newGroupChoice = { touched: true, id: chosen };
      dialog.close();
      navigate(node.dataset.create);
    });
  });
  dialog.querySelector('[data-create-close]').addEventListener('click', () => dialog.close());
  dialog.showModal();
}

/**
 * What is waiting on someone, in one line. Late first: a line whose day has
 * passed is the only part of this that is worse today than it was yesterday.
 */
function waitingLine(counts) {
  return [
    counts.late ? t('lists.late', { count: counts.late }) : '',
    counts.left ? t('lists.leftToDo', { count: counts.left }) : '',
    counts.votes ? t('dash.votes', { count: counts.votes }) : '',
    counts.owes ? t('spends.owes', { amount: showAmount(counts.owes, getLanguage()) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function overviewView() {
  const forYou = forYouItems();
  const nothingYet = ![...state.lists, ...state.polls, ...state.games, ...state.spends].length;
  const pending = pendingHtml(new Set(forYou.items.map((item) => item.goto)));

  return `
    ${flashHtml()}
    ${kindsHtml('overview')}
    ${groupChipsHtml()}
    ${nothingYet ? `<p class="lead">${escapeHtml(t('overview.what'))}</p>` : ''}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('forYou.title'))}</h2></div>
      ${forYouHtml(forYou)}
    </section>

    <section class="section">
      <div class="section__head">
        <h2>${escapeHtml(t('agenda.coming'))}</h2>
      </div>
      ${comingHtml()}
    </section>

    ${
      pending
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('overview.pending'))}</h2></div>
             ${pending}
           </section>`
        : ''
    }`;
}

/**
 * Which kind of thing Home shows: everything at once, or one kind in full.
 *
 * The kinds used to be tabs of their own; they are one row of the home page
 * now, so the tab bar can answer other questions — when, with whom — and each
 * kind keeps its own address, so a link once sent still opens it.
 */
function kindsHtml(active) {
  const kind = (id, goto, label) => `
    <button type="button" class="segmented__option" data-goto="${goto}"
            aria-current="${active === id ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  return `
    <nav class="segmented segmented--kinds" aria-label="${escapeHtml(t('home.kinds'))}">
      ${kind('overview', '#/', t('tab.all'))}
      ${kind('lists', '#/lists', t('tab.lists'))}
      ${kind('polls', '#/polls', t('tab.polls'))}
      ${kind('games', '#/games', t('tab.games'))}
      ${kind('spends', '#/spends', t('tab.spends'))}
    </nav>`;
}

/**
 * What is waiting on this device's person, and on nobody else: a poll they
 * have not answered, lines they were given, money they owe — and, for whoever
 * opens a group's door, the people knocking at it. It is what opening the app
 * is for, so it comes first; the rest of what is going on comes after.
 */
function forYouItems() {
  const items = [];
  for (const group of groupsByName()) {
    const rows = group.admits === false ? null : gate().requests[group.id];
    if (!rows?.length) continue;
    items.push({
      goto: '#/groups',
      title: t('forYou.knocks', { count: rows.length }),
      meta: t('forYou.knocksWhere', { name: group.name }),
    });
  }
  const me = myName();
  if (!me) return { items, noName: true };

  const file = personFile({
    lists: shownDocs(state.lists), polls: shownDocs(state.polls), spends: shownDocs(state.spends),
  }, me);
  for (const row of file.votes.filter((one) => !one.closed && !one.answered)) {
    items.push({ goto: `#/poll/${row.poll.id}`, title: pollTitle(row.poll), meta: t('forYou.vote') });
  }
  for (const row of file.lines.filter((one) => one.left > 0).sort((a, b) => b.late - a.late)) {
    items.push({
      goto: `#/list/${row.list.id}`,
      title: listTitle(row.list),
      meta: t('forYou.lines', { count: row.left }),
      late: row.late ? t('lists.late', { count: row.late }) : '',
    });
  }
  for (const row of file.accounts.filter((one) => one.balance < 0)) {
    items.push({
      goto: `#/spend/${row.spend.id}`,
      title: spendTitle(row.spend),
      meta: t('spends.iOwe', { amount: showAmount(-row.balance, getLanguage()) }),
    });
  }
  return { items };
}

function forYouHtml({ items, noName }) {
  const rows = items.map((item) => `
    <button type="button" class="game-card" data-goto="${escapeHtml(item.goto)}">
      <span class="game-card__title">
        ${escapeHtml(item.title)}
        ${item.late ? `<span class="pill pill--late">${escapeHtml(item.late)}</span>` : ''}
      </span>
      <span class="game-card__meta">${escapeHtml(item.meta)}</span>
    </button>`).join('');
  return `
    ${rows ? `<div class="game-list" id="for-you">${rows}</div>` : ''}
    ${
      noName
        ? `<p class="muted small">${escapeHtml(t('forYou.noName'))}
             <button type="button" class="button button--small button--ghost" data-goto="#/settings">
               ${escapeHtml(t('tab.settings'))} ›
             </button>
           </p>`
        : rows ? '' : `<p class="muted small">${escapeHtml(t('forYou.nothing'))}</p>`
    }`;
}

/**
 * The groups tab: each group this device is in, as a board that opens the
 * group's own page — then everything that lets people in or out of one.
 */
function groupsView() {
  if (!state.remote) {
    return `
      ${flashHtml()}
      <p class="muted small">${escapeHtml(t('groups.noDatabase'))}</p>`;
  }
  return `
    ${flashHtml()}
    ${
      // Knocking at a group asks for a first name: better to meet the field
      // here than to be sent to the settings by an error.
      myName() ? '' : meHtml()
    }
    ${byGroupHtml()}
    ${groupsHtml()}`;
}

/** The app's own settings: who this device is, and its data. */
function settingsView() {
  return `
    ${flashHtml()}
    ${meHtml()}
    ${dataHtml()}`;
}

function dataHtml() {
  return `
    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('home.data'))}</h2></div>
      <div class="row">
        <button type="button" class="button button--small button--ghost" id="share-app">${escapeHtml(t('action.shareApp'))}</button>
        <button type="button" class="button button--small" id="export">${escapeHtml(t('action.export'))}</button>
        <button type="button" class="button button--small" id="import">${escapeHtml(t('action.import'))}</button>
        <button type="button" class="button button--small" id="import-paste">${escapeHtml(t('action.importPaste'))}</button>
        ${
          state.remote
            ? `<button type="button" class="button button--small" id="open-link">${escapeHtml(t('action.openLink'))}</button>`
            : ''
        }
        ${
          lots().length
            ? `<button type="button" class="button button--small" id="my-shares">${escapeHtml(t('lots.title', { count: lots().length }))}</button>`
            : ''
        }
        <input type="file" id="import-file" accept="application/json,.json" class="visually-hidden" />
      </div>
      <p class="muted small">${escapeHtml(
        t(state.remote ? 'home.storedShared' : state.store ? 'home.storedCloud' : 'home.storedLocal'),
      )}</p>
      <p class="muted small">${escapeHtml(t('data.holds', heldCounts()))}</p>
      ${
        Object.keys(heldOrganiserSecrets()).length
          ? `<p class="muted small" id="organiser-backup">${escapeHtml(
              t('data.organiserBackup', { count: Object.keys(heldOrganiserSecrets()).length }),
            )}</p>`
          : ''
      }
      ${
        appVersion()
          ? `<p class="muted small">
               ${escapeHtml(t('data.version', { version: appVersion() }))}
               ${
                 'serviceWorker' in navigator
                   ? `<button type="button" class="button button--small button--ghost" id="look-update">
                        ${escapeHtml(t('data.lookForUpdate'))}
                      </button>`
                   : ''
               }
             </p>`
          : ''
      }
      ${
        state.remote && groups().length
          ? `<label class="checkbox">
               <input type="checkbox" id="auto-share" ${state.prefs.autoShare ? 'checked' : ''} />
               ${escapeHtml(t('data.autoShare'))}
             </label>
             <p class="muted small">${escapeHtml(t('data.autoShareHint'))}</p>`
          : ''
      }
    </section>`;
}

/**
 * Paste an invitation into either field and both fill.
 *
 * Whatever lands in the name or the code box is read as a whole invitation
 * first: the message carries the name, the six digits and the link, and
 * selecting exactly one of them on a phone is the step people fail at. What is
 * not an invitation is left to paste normally.
 */
function bindInvitationPaste(nameField, codeField) {
  if (!nameField || !codeField) return;
  const take = (event) => {
    const pasted = event.clipboardData?.getData('text') || '';
    const { name, code } = readInvite(pasted);
    if (!code && !name) return;
    event.preventDefault();
    if (name) nameField.value = name;
    if (code) codeField.value = code;
    // Where the paste landed is where the eye is; the other field is now
    // filled behind it, so the button is the only thing left to press.
    (code ? codeField : nameField).focus();
  };
  nameField.addEventListener('paste', take);
  codeField.addEventListener('paste', take);

  // Typed, or pasted by a route that skips the event: the digits are the only
  // thing this box is for.
  codeField.addEventListener('input', () => {
    const digits = codeField.value.replace(/[^0-9]/g, '').slice(0, 6);
    if (digits !== codeField.value) codeField.value = digits;
  });
}

function bindOverview() {
  bindData();
  bindInAppWarning();

  view.querySelector('#me-save')?.addEventListener('click', () => {
    const name = setMyName(view.querySelector('#me-name').value);
    flash(name ? t('me.saved', { name }) : t('me.cleared'));
    render();
  });
  view.querySelector('#me-name')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    view.querySelector('#me-save')?.click();
  });

  const joining = (line, message) => {
    line.textContent = message;
  };

  bindInvitationPaste(view.querySelector('#group-name'), view.querySelector('#group-code'));

  view.querySelector('#group-join')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const line = view.querySelector('#group-state');
    const name = view.querySelector('#group-name').value.trim();
    const code = readCode(view.querySelector('#group-code').value);
    if (!name) return joining(line, t('groups.needName'));
    if (!code) return joining(line, t('groups.needCode'));
    // Everything that can refuse without asking the database is refused before
    // the button goes dead, or a missing first name would leave it dead.
    if (!myName()) return joining(line, t('gate.needNameFirst'));

    button.disabled = true;
    joining(line, t('groups.checking'));
    const me = myName();

    // Already in this group: knocking again would hand this device a second,
    // ordinary key — and remembering it would throw away the one it holds,
    // which on the founder's phone is the only key that lets anyone in.
    const held = groupNamed(name);
    if (held) {
      let taken = 0;
      try {
        taken = await catchUpWith(held);
      } catch {
        button.disabled = false;
        return joining(line, t('groups.unsure'));
      }
      button.disabled = false;
      flash(taken
        ? t('join.alreadyCaughtUp', { name: held.name, count: taken })
        : t('join.alreadyUpToDate', { name: held.name }));
      render();
      return;
    }

    let answer = { status: 'unknown' };
    try {
      answer = await state.remote.ask(name, code, me, deviceLabel());
    } catch {
      button.disabled = false;
      return joining(line, t('groups.unsure'));
    }
    button.disabled = false;

    if (answer.status === 'busy') return joining(line, t('gate.busy'));
    if (answer.status !== 'waiting') return joining(line, t('groups.codeRefused'));

    rememberPending({
      ticket: answer.ticket,
      groupId: answer.id,
      groupName: answer.name || name,
      me,
      at: Date.now(),
    });
    flash(t('gate.asked', { name: answer.name || name }));
    render();
  });

  view.querySelector('#group-code')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    view.querySelector('#group-join')?.click();
  });

  // The very first device of a group has no one to invite it: it starts from
  // the key the database printed in the SQL editor.
  view.querySelector('#group-paste')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const line = view.querySelector('#group-state');
    const key = view.querySelector('#group-key').value.trim();
    if (!key) return;

    button.disabled = true;
    joining(line, t('groups.checking'));
    let group = null;
    try {
      group = await joinGroup(key);
    } catch {
      button.disabled = false;
      return joining(line, t('groups.unsure'));
    }
    button.disabled = false;
    if (!group) return joining(line, t('groups.refused'));

    flash(t('groups.joined', { name: group.name }));
    render();
  });

  view.querySelectorAll('[data-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.invite);
      if (!group) return;

      // Two shapes, and the usual one first: a link good for the day that
      // several people can knock with, or one meant for a single person.
      const shape = await askInvitationShape();
      if (!shape) return;

      button.disabled = true;
      button.textContent = t('share.sending');
      let invitation = null;
      try {
        invitation = await state.remote.invite(group.key, shape.minutes, shape.uses);
      } catch (error) {
        flash(remoteReason(error), 'error');
        render();
        return;
      }
      if (!invitation) {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      render();
      // Everything in one message: the group, the code in plain sight, the link
      // and how to install the app. It is the only thing the person will read —
      // they will not open a guide, and will remember nothing else.
      const url = joinLink(location, group.name, invitation.code);
      const days = Math.max(1, Math.round(invitation.minutes / (24 * 60)));
      await shareMessage({
        title: t('groups.inviteReady', { name: group.name }),
        hint: t('groups.inviteWhy'),
        message: t('groups.inviteText', { name: group.name, code: invitation.code, url, days }),
        url,
        code: invitation.code,
      });
    });
  });

  view.querySelectorAll('[data-admit], [data-refuse]').forEach((button) => {
    button.addEventListener('click', async () => {
      const admit = 'admit' in button.dataset;
      const group = groups().find((item) => item.id === (admit ? button.dataset.admit : button.dataset.refuse));
      if (!group) return;
      button.disabled = true;
      let status = 'unknown';
      try {
        status = await state.remote.answer(group.key, button.dataset.request, admit);
      } catch {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      forgetGate(group.id);
      await loadGate(group);
      if (status === 'ok') flash(t('gate.admitted'));
      else if (status === 'refused') flash(t('gate.refused'));
      else flash(t('gate.gone'), 'error');
      render();
    });
  });

  // Who may let people in, decided from the app: the same thing the guide used to
  // ask for an `update` in the SQL editor for.
  view.querySelectorAll('[data-admits]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.admits);
      if (!group) return;
      const allow = button.dataset.allow === 'yes';
      const sure = await ask(t(allow ? 'gate.confirmGiveAdmits' : 'gate.confirmDropAdmits'),
        { confirmLabel: t(allow ? 'gate.giveAdmits' : 'gate.dropAdmits'), danger: !allow });
      if (!sure) return;

      button.disabled = true;
      let status = 'unknown';
      try {
        status = await state.remote.setAdmits(group.key, button.dataset.key, allow);
      } catch {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      forgetGate(group.id);
      await loadGate(group);
      // This device may have just changed what it is allowed to do.
      await refreshGroup(group);
      if (status === 'ok') flash(t(allow ? 'gate.gaveAdmits' : 'gate.droppedAdmits'));
      else if (status === 'last') flash(t('gate.cutLast'), 'error');
      else flash(t('gate.gone'), 'error');
      render();
    });
  });

  view.querySelectorAll('[data-cut-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.cutLink);
      if (!group) return;
      if (!(await ask(t('back.confirmCutLink'), { confirmLabel: t('back.cutLink'), danger: true }))) return;
      button.disabled = true;
      let status = 'unknown';
      try {
        status = await state.remote.forgetLink(group.key, button.dataset.person);
      } catch {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      forgetGate(group.id);
      await loadGate(group);
      flash(status === 'ok' ? t('back.cutLinkDone') : t('gate.gone'), status === 'ok' ? 'info' : 'error');
      render();
    });
  });

  view.querySelectorAll('[data-cut]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.cut);
      if (!group) return;
      if (!(await ask(t('gate.confirmCut'), { confirmLabel: t('gate.cut'), danger: true }))) return;
      let status = 'unknown';
      try {
        status = await state.remote.cutKey(group.key, button.dataset.key);
      } catch {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      forgetGate(group.id);
      await loadGate(group);
      if (status === 'ok') flash(t('gate.cutDone'));
      else if (status === 'last') flash(t('gate.cutLast'), 'error');
      else flash(t('gate.gone'), 'error');
      render();
    });
  });

  view.querySelectorAll('[data-check]').forEach((button) => {
    button.addEventListener('click', async () => {
      const knock = pendings()[Number(button.dataset.check)];
      if (!knock) return;
      button.disabled = true;
      const status = await checkPending(knock);
      if (status === 'waiting') flash(t('gate.stillWaiting'));
      else if (status === null) flash(t('groups.unsure'), 'error');
      render();
    });
  });

  view.querySelectorAll('[data-drop]').forEach((button) => {
    button.addEventListener('click', async () => {
      const knock = pendings()[Number(button.dataset.drop)];
      if (!knock) return;
      if (!(await ask(t('gate.confirmDropMine', { name: knock.groupName }),
        { confirmLabel: t('gate.dropMine'), danger: true }))) return;
      forgetPending(knock.ticket);
      flash(t('gate.droppedMine', { name: knock.groupName }));
      render();
    });
  });

  // What the gatekeeper's blocks need, asked once and then kept.
  for (const group of showsGate() ? groups() : []) {
    if (group.admits === undefined) {
      refreshGroup(group).then((learnt) => {
        if (learnt && !isBusy() && showsGate()) render();
      });
      continue;
    }
    if (group.admits === false) continue;
    loadGate(group).then((learnt) => {
      if (learnt && !isBusy() && showsGate()) render();
    });
  }

  view.querySelectorAll('[data-catch-up]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.catchUp);
      if (!group) return;
      button.disabled = true;
      button.textContent = t('share.sending');
      let taken = 0;
      try {
        taken = await catchUpWith(group);
      } catch {
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      flash(taken ? t('groups.caughtUp', { count: taken }) : t('groups.upToDate'));
      render();
    });
  });

  // The key this device holds, readable again — so it can be kept somewhere safe,
  // or put into a second installation (the app on a home screen, a new phone)
  // without inviting anyone or asking anyone to accept anything.
  view.querySelectorAll('[data-my-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.myLink);
      if (!group) return;
      if (!(await ask(t('back.confirmMyLink'), { confirmLabel: t('back.myLink') }))) return;
      button.disabled = true;
      await showMyLink(group);
    });
  });

  view.querySelectorAll('[data-calendar]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.calendar);
      if (!group) return;
      // Disabled while the database is asked, and given back afterwards: the
      // dialog that opens does not redraw the page behind it, so a button left
      // disabled here would stay grey until something else redrew it.
      button.disabled = true;
      try {
        await showCalendar(group);
      } finally {
        button.disabled = false;
      }
    });
  });

  view.querySelectorAll('[data-cut-calendar]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.cutCalendar);
      if (!group) return;
      if (!(await ask(t('agenda.confirmCut'), { confirmLabel: t('agenda.cut'), danger: true }))) return;
      button.disabled = true;
      let answer = 'unknown';
      try {
        answer = await state.remote.forgetCalendar(group.key);
      } catch {
        button.disabled = false;
        flash(t('groups.unsure'), 'error');
        render();
        return;
      }
      flash(answer === 'ok' ? t('agenda.cutDone') : t('agenda.none'), answer === 'ok' ? 'info' : 'error');
      render();
    });
  });

  view.querySelectorAll('[data-show-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = groups().find((item) => item.id === button.dataset.showKey);
      if (!group) return;
      if (!(await ask(t('groups.confirmShowKey', { name: group.name }), { confirmLabel: t('groups.showKey') }))) return;
      showCopyDialog({
        title: t('groups.keyTitle', { name: group.name }),
        // Which key this is matters more than the key itself: the one printed at
        // the group's creation lets people in, every other one does not.
        hint: `${t('groups.keyWarning')} ${t(group.admits ? 'groups.keyAdmits' : 'groups.keyPlain')}`,
        text: group.key,
      });
    });
  });

  view.querySelectorAll('[data-leave]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!(await ask(t('groups.confirmLeave'), { confirmLabel: t('groups.leave'), danger: true }))) return;
      forgetGroup(button.dataset.leave);
      render();
    });
  });
}

/* ------------------------------------------------------------- coming back --- */

/**
 * The screen a return link opens: one button, because there is nothing to ask.
 * The token is the person's own, it was accepted once, and what it hands over is
 * a key for this browser — which is exactly what a browser that knows nothing
 * about the group needs.
 */
function backView(token) {
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('back.title'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${inAppWarningHtml()}

    <div class="card stack">
      <p>${escapeHtml(token ? t('back.what') : t('back.broken'))}</p>
      <p class="muted small" id="back-state"></p>
      ${
        token
          ? `<button type="button" class="button button--primary button--block" id="back-go">
               ${escapeHtml(t('back.action'))}
             </button>`
          : ''
      }
    </div>`;
}

function bindBack(token) {
  bindInAppWarning();
  const line = view.querySelector('#back-state');
  view.querySelector('#back-go')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!state.remote) {
      line.textContent = t('join.noDatabase');
      return;
    }
    button.disabled = true;
    line.textContent = t('groups.checking');

    let answer = { status: 'unknown' };
    try {
      answer = await state.remote.returnWith(token, deviceLabel());
    } catch {
      button.disabled = false;
      line.textContent = t('groups.unsure');
      return;
    }
    button.disabled = false;

    if (answer.status === 'busy') return void (line.textContent = t('gate.busy'));
    if (answer.status !== 'ok') return void (line.textContent = t('back.refused'));

    if (answer.who) setMyName(answer.who);
    const group = { id: answer.id, name: answer.name, key: answer.key, admits: false };
    rememberGroup(group);
    let taken = 0;
    try {
      taken = await catchUpWith(group);
    } catch {
      // In the group either way.
    }
    flash(taken
      ? t('groups.joinedWith', { name: group.name, count: taken })
      : t('groups.joined', { name: group.name }));
    // Onto the groups tab, where the group just joined now shows.
    if (location.hash.startsWith('#/back/')) location.replace(`${location.pathname}${location.search}#/groups`);
    else navigate('#/groups');
  });
}

/**
 * Show this device's return link — drawing a fresh one, which retires the
 * previous. Offered right after being let in, and available afterwards in
 * *Mes groupes*, because the moment someone will want it is not the moment they
 * are told about it.
 */
async function showMyLink(group) {
  let answer = { status: 'none' };
  try {
    answer = await state.remote.myLink(group.key);
  } catch {
    flash(t('groups.unsure'), 'error');
    render();
    return;
  }
  if (answer.status !== 'ok') {
    flash(t('back.noneForThisKey'));
    render();
    return;
  }
  showCopyDialog({
    title: t('back.linkTitle', { name: group.name }),
    hint: t('back.linkHint'),
    text: backLink(location, answer.token),
    qr: true,
  });
}

/**
 * The group's calendar address: one link, which every calendar knows how to
 * subscribe to — and which anyone holding it can read, so it is shown with
 * what it costs, and with the way to cut it.
 */
async function showCalendar(group) {
  let answer = { status: 'unknown' };
  try {
    answer = await state.remote.calendar(group.key);
  } catch {
    flash(t('groups.unsure'), 'error');
    render();
    return;
  }
  if (answer.status !== 'ok') {
    flash(t('agenda.none'), 'error');
    render();
    return;
  }

  showCopyDialog({
    title: t('agenda.title', { name: group.name }),
    hint: t('agenda.hint'),
    text: state.remote.calendarUrl(answer.token),
  });
}

/* ------------------------------------------------------- joining a group --- */

/**
 * The page an invitation link opens: one field, the first name of whoever is
 * joining, and a button. The group's name and the six digits arrived in the
 * link, and are shown so that a link mangled by a messaging app can still be
 * corrected by hand rather than being a dead end.
 */
function joinView(invitation) {
  const waiting = invitation.group ? pendingFor(invitation.group) : null;
  if (waiting) return waitingView(waiting);

  const already = invitation.group ? groupNamed(invitation.group) : null;
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(invitation.group ? t('join.title', { name: invitation.group }) : t('join.titlePlain'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${inAppWarningHtml()}

    <form id="join-form" class="card stack">
      <p class="muted small">${escapeHtml(already ? t('join.already', { name: already.name }) : t('join.hint'))}</p>
      <label>
        ${escapeHtml(t('join.me'))}
        <input type="text" id="join-me" autocomplete="given-name" maxlength="${NAME_KEPT}" aria-required="true"
               value="${escapeHtml(myName())}" placeholder="${escapeHtml(t('me.placeholder'))}" />
      </label>

      <button type="submit" class="button button--primary button--block">
        ${escapeHtml(already ? t('groups.catchUp') : t('join.action'))}
      </button>
      <p class="muted small" id="join-state"></p>

      <details class="details">
        <summary>${escapeHtml(t('join.byHand'))}</summary>
        <div class="row row--tight">
          <input type="text" id="join-group" autocomplete="off" value="${escapeHtml(invitation.group)}"
                 placeholder="${escapeHtml(t('groups.namePlaceholder'))}" aria-label="${escapeHtml(t('groups.namePlaceholder'))}" />
          <input type="text" id="join-code" class="code-input" inputmode="numeric" autocomplete="one-time-code"
                 value="${escapeHtml(invitation.code || '')}" placeholder="000000"
                 aria-label="${escapeHtml(t('groups.codePlaceholder'))}" />
        </div>
      </details>

      ${toHomeScreenHtml(invitation)}
    </form>`;
}

/**
 * How to enter a group from the app rather than from the page this link opened.
 *
 * The invitation travels as a link, and a link always opens in the browser —
 * never in an app sitting on a home screen, which iOS gives its own storage and
 * no way of being handed a URL. So someone who joins here and then installs the
 * app finds it empty, and has every reason to think the app is broken. The only
 * order that works is the other one: install first, join from inside. That is
 * worth saying on the very page where the mistake is made, with the two things
 * to copy right underneath.
 *
 * Folded away, because most people are not installing anything: one line until
 * it is the line they need.
 */
function toHomeScreenHtml(invitation) {
  if (onHomeScreen()) return '';
  const name = String(invitation.group || '').trim();
  const code = String(invitation.code || '').trim();
  return `
    <details class="details">
      <summary>${escapeHtml(t('join.toHomeScreen'))}</summary>
      <p class="muted small">${escapeHtml(t('join.toHomeScreenWhy'))}</p>
      <ol class="steps muted small">
        <li>${escapeHtml(t('join.toHomeScreenStep1'))}</li>
        <li>${escapeHtml(t('join.toHomeScreenStep2'))}</li>
        <li>${escapeHtml(t('join.toHomeScreenStep3'))}</li>
      </ol>
      ${
        name && code
          ? `<p class="small"><strong>${escapeHtml(t('join.toHomeScreenWhat'))}</strong>
               ${escapeHtml(name)} · <span class="code-shown">${escapeHtml(code)}</span></p>
             <div class="row row--tight">
               <button type="button" class="button button--small" id="join-copy-code">
                 ${escapeHtml(t('join.toHomeScreenCopy'))}
               </button>
             </div>`
          : ''
      }
      <p class="muted small">${escapeHtml(t('join.toHomeScreenDone'))}</p>
    </details>`;
}

/**
 * The screen of someone who has knocked: nothing to do but wait, and nothing
 * shown that they are not yet entitled to see. It looks in on its own while it
 * is open, so being accepted needs no gesture on this side.
 */
function waitingView(knock) {
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('gate.waitingTitle', { name: knock.groupName }))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <div class="card stack">
      <p>${escapeHtml(t('gate.waitingWhat', { name: knock.groupName, me: knock.me || t('gate.someone') }))}</p>
      <p class="muted small">${escapeHtml(t('gate.waitingHow'))}</p>
      <p class="muted small" id="waiting-state"></p>
      <div class="row">
        <button type="button" class="button button--primary" id="waiting-check">${escapeHtml(t('gate.check'))}</button>
        <button type="button" class="button button--ghost" id="waiting-drop">${escapeHtml(t('gate.dropMine'))}</button>
      </div>
    </div>`;
}

/**
 * How long an invitation lasts: two days.
 *
 * A day was too short for a link sent in the evening to someone who opens
 * their messages the following evening; two covers a weekend, and a link found
 * a week later is still dead. The database caps it as well — the guide's SQL
 * has to allow it, or the server quietly shortens it back.
 */
const INVITE_MINUTES = 2 * 24 * 60;

/**
 * Which invitation to draw. Both last two days; what separates them is how many
 * people may knock with it: the first is for a family, the second for someone
 * you would rather not see a link forwarded for.
 */
async function askInvitationShape() {
  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('groups.inviteWhich'))}</h2>
        <p class="muted small">${escapeHtml(t('groups.inviteWhichHint'))}</p>
        <div class="stack stack--tight">
          <button type="button" class="button button--primary button--block" id="invite-open">
            ${escapeHtml(t('groups.inviteOpen'))}
          </button>
          <button type="button" class="button button--block" id="invite-one">
            ${escapeHtml(t('groups.inviteOne'))}
          </button>
        </div>
        <div class="row">
          <button type="button" class="button" id="invite-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    let answered = false;
    const done = (shape) => {
      if (answered) return;
      answered = true;
      resolve(shape);
      dialog.close();
    };
    dialog.addEventListener('close', () => done(null));
    dialog.querySelector('#invite-cancel').addEventListener('click', () => done(null));
    dialog.querySelector('#invite-open').addEventListener('click', () => done({ minutes: INVITE_MINUTES, uses: 50 }));
    dialog.querySelector('#invite-one').addEventListener('click', () => done({ minutes: INVITE_MINUTES, uses: 1 }));
    dialog.showModal();
  });
}

/** The group of that name this device is in, if any. */
function groupNamed(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return groups().find((group) => String(group.name || '').trim().toLowerCase() === wanted) || null;
}

/**
 * Leave the invitation screen for the overview, without leaving the link in
 * the history: the code is spent, and a back button that lands on a dead
 * invitation explains nothing to anyone.
 */
function leaveInvitation() {
  // Replacing rather than pushing: the hash really changes, so the redraw comes
  // from the hashchange the way it does everywhere else. Drawing here as well
  // would show the "you are in Mifa" line and then immediately wipe it.
  if (location.hash.startsWith('#/join/')) {
    location.replace(`${location.pathname}${location.search}#/groups`);
    return;
  }
  navigate('#/groups');
}

/** True while a knock is on its way, so no second one leaves for the same form. */
let knocking = false;

function bindJoin() {
  bindInAppWarning();
  bindInvitationPaste(view.querySelector('#join-group'), view.querySelector('#join-code'));

  view.querySelector('#join-copy-code')?.addEventListener('click', () => {
    const invitation = route();
    showCopyDialog({
      title: t('join.toHomeScreen'),
      hint: t('join.toHomeScreenStep3'),
      text: `${invitation.group} · ${invitation.code}`,
    });
  });

  const waitingLine = view.querySelector('#waiting-state');
  if (waitingLine) {
    const knock = pendingFor(route().group);
    const look = async (button) => {
      if (!knock) return;
      if (button) button.disabled = true;
      waitingLine.textContent = t('groups.checking');
      const status = await checkPending(knock);
      if (status === 'waiting') {
        waitingLine.textContent = t('gate.stillWaiting');
        if (button) button.disabled = false;
        return;
      }
      if (status === null) {
        waitingLine.textContent = t('groups.unsure');
        if (button) button.disabled = false;
        return;
      }
      leaveInvitation();
    };

    view.querySelector('#waiting-check')?.addEventListener('click', (event) => look(event.currentTarget));
    view.querySelector('#waiting-drop')?.addEventListener('click', async () => {
      if (!knock) return;
      const sure = await ask(t('gate.confirmDropMine', { name: knock.groupName }),
        { confirmLabel: t('gate.dropMine'), danger: true });
      if (!sure) return;
      forgetPending(knock.ticket);
      flash(t('gate.droppedMine', { name: knock.groupName }));
      leaveInvitation();
    });
    return;
  }

  const form = view.querySelector('#join-form');
  const line = view.querySelector('#join-state');
  const say = (message) => {
    line.textContent = message;
  };

  knocking = false;
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (knocking) return;
    const button = form.querySelector('button[type="submit"]');
    const me = view.querySelector('#join-me').value.trim();
    const group = view.querySelector('#join-group').value.trim();
    const code = readCode(view.querySelector('#join-code').value);
    if (!me) return say(t('join.needMe'));
    if (!group) return say(t('groups.needName'));
    if (!code) return say(t('groups.needCode'));
    if (!state.remote) return say(t('join.noDatabase'));

    setMyName(me);

    // Already in this group: the invitation is worth keeping for someone else,
    // so take what the group shares instead of spending it. Groups are told
    // apart by name here, which is what the link carries — the database keeps
    // those names unique for exactly this reason.
    const held = groupNamed(group);
    if (held) {
      button.disabled = true;
      say(t('groups.checking'));
      let taken = 0;
      try {
        taken = await catchUpWith(held);
      } catch {
        button.disabled = false;
        return say(t('groups.unsure'));
      }
      flash(taken
        ? t('join.alreadyCaughtUp', { name: held.name, count: taken })
        : t('join.alreadyUpToDate', { name: held.name }));
      leaveInvitation();
      return;
    }

    button.disabled = true;
    knocking = true;
    say(t('groups.checking'));
    let answer = { status: 'unknown' };
    try {
      answer = await state.remote.ask(group, code, me, deviceLabel());
    } catch {
      button.disabled = false;
      knocking = false;
      return say(t('groups.unsure'));
    }
    button.disabled = false;
    knocking = false;

    if (answer.status === 'busy') return say(t('gate.busy'));
    if (answer.status !== 'waiting') return say(t('groups.codeRefused'));

    rememberPending({
      ticket: answer.ticket,
      groupId: answer.id,
      groupName: answer.name || group,
      me,
      at: Date.now(),
    });
    render();
  });

  view.querySelector('#join-me')?.focus();
}

/**
 * While the overview is on screen, ask again for the knocks — fifteen seconds
 * apart, and only redraw when the answer actually changed, so the screen does
 * not flicker and the database is not hammered.
 */
/** The pages that show who is knocking: the groups tab, and "for you" at home. */
function showsGate() {
  return ['overview', 'groups'].includes(route().name);
}

function watchGate() {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden() || !showsGate()) return;
    if (await refreshGate()) render();
  }, 15000);
}

/** While someone waits to be let in, look in on their own — five seconds apart. */
function watchPending() {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return;
    const knock = pendingFor(route().group);
    if (!knock) return;
    const status = await checkPending(knock);
    if (status && status !== 'waiting') {
      stopWatching();
      leaveInvitation();
    }
  }, 5000);
}

/**
 * Rename a player in every game they appear in.
 *
 * The statistics gather players by name, because a game mints fresh ids for its
 * own players and nothing ties them together otherwise. So a name that changed —
 * "Alex" who comes back as "Alexandre" — is two people in the table, and only
 * the person concerned can say it is one. This is how they say it.
 */
async function renameEverywhere(before) {
  const after = await askForText({
    title: t('stats.renameTitle'),
    hint: t('stats.renameHint', { name: before }),
    value: before,
    confirmLabel: t('stats.rename'),
  });
  const clean = String(after || '').trim();
  if (!clean || clean === before) return;

  const key = sameName(before);
  let touched = 0;

  // Games first, then lists and polls: the same person, written the same way,
  // in every document that names them. A name matched forgivingly here, as
  // everywhere else — otherwise the rename would miss exactly the spellings it
  // exists to reconcile.
  for (const game of state.games) {
    const players = game.players.filter((player) => sameName(player.name) === key);
    if (!players.length) continue;
    let next = game;
    for (const player of players) next = renamePlayer(next, player.id, clean);
    if (next === game) continue;
    state.games = state.games.map((held) => (held.id === next.id ? next : held));
    persist(next);
    touched += 1;
  }

  for (const list of state.lists) {
    const people = list.people.filter((person) => sameName(person.name) === key);
    if (!people.length) continue;
    let next = list;
    for (const person of people) next = renameListPerson(next, person.id, clean);
    if (next === list) continue;
    state.lists = state.lists.map((held) => (held.id === next.id ? next : held));
    persistList(next);
    touched += 1;
  }

  for (const poll of state.polls) {
    const people = poll.people.filter((person) => sameName(person.name) === key);
    if (!people.length) continue;
    let next = poll;
    for (const person of people) next = renamePollPerson(next, person.id, clean);
    if (next === poll) continue;
    state.polls = state.polls.map((held) => (held.id === next.id ? next : held));
    persistPoll(next);
    touched += 1;
  }

  flash(touched ? t('stats.renamed', { name: clean, count: touched }) : t('stats.renamedNone'));
  // The page may be keyed on the old name: follow the person to their new one.
  if (route().name === 'person' && sameName(route().who) === key) {
    navigate(`#/person/${encodeURIComponent(clean)}`);
    return;
  }
  render();
}

/**
 * Ask for one line of text, the same way the app asks anything else: a dialog
 * that removes itself, Escape answering null.
 */
function askForText({ title, hint, value = '', confirmLabel }) {
  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(title)}</h2>
        <p class="muted small">${escapeHtml(hint)}</p>
        <input type="text" id="asked-text" value="${escapeHtml(value)}" maxlength="40" />
        <div class="row">
          <button type="button" class="button button--primary" id="asked-ok">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="button" id="asked-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    let answered = false;
    const done = (answer) => {
      if (answered) return;
      answered = true;
      resolve(answer);
      dialog.close();
    };
    dialog.addEventListener('close', () => done(null));
    dialog.querySelector('#asked-cancel').addEventListener('click', () => done(null));
    dialog.querySelector('#asked-ok').addEventListener('click', () => done(dialog.querySelector('#asked-text').value));
    dialog.querySelector('#asked-text').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') done(dialog.querySelector('#asked-text').value);
    });
    dialog.showModal();
    dialog.querySelector('#asked-text').select();
  });
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

  const mine = shownDocs(state.games);
  const sorted = [...mine].sort((a, b) => b.updatedAt - a.updatedAt).filter(matches);
  const live = sorted.filter(isLive);
  const ongoing = live.filter((game) => !gameStatus(game).finished);
  const finished = live.filter((game) => gameStatus(game).finished);

  return `
    ${flashHtml()}
    ${kindsHtml('games')}
    <button type="button" class="button button--primary button--block" data-goto="#/new">
      + ${escapeHtml(t('action.newGame'))}
    </button>
    ${groupChipsHtml()}
    ${
      mine.length
        ? `<div class="row">
             <button type="button" class="button button--small button--ghost" data-goto="#/stats">${escapeHtml(t('action.stats'))}</button>
           </div>`
        : ''
    }

    ${
      mine.length > 4
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
      ${hiddenByGroupHtml(state.games)}
    </section>

    ${
      finished.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('home.finished'))}</h2></div>
             <div class="game-list">${finished.map(gameCardHtml).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, gameCardHtml)}`;
}

/* ---------------------------------------------------------------- person --- */

/**
 * One person's page.
 *
 * The three tabs answer "where is this list" and "who is winning"; none of
 * them answers "and Claire?" — what she was given, what she has not answered,
 * how her evenings went. That question is asked about a name, so this page is
 * keyed on a name, matched the forgiving way the tables match it.
 *
 * What waits on her comes first, because it is the only part anyone can act
 * on; the rest is what she has done, newest first.
 */
function personView(who) {
  const file = personFile(state, who);
  const head = (title, tail) => `
    <div class="spread">
      ${title}
      <button type="button" class="button button--small button--ghost" data-goto="#/">
        ${escapeHtml(t('action.back'))}
      </button>
    </div>
    ${tail}`;


  if (!file.known) {
    return `
      ${flashHtml()}
      ${head(`<h1>${escapeHtml(file.name || who)}</h1>`, `<p class="muted small">${escapeHtml(t('person.none'))}</p>`)}`;
  }

  const inGroups = file.groupIds
    .map((id) => groups().find((group) => group.id === id)?.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const waiting = waitingLine(file.counts);

  const tile = (value, label) => `
    <div class="tile">
      <span class="tile__value">${value}</span>
      <span class="tile__label">${escapeHtml(label)}</span>
    </div>`;

  const entry = (goto, what, aside, value, tone) => `
    <button type="button" class="entry" data-goto="${goto}">
      <span class="entry__what">
        ${what}${aside ? ` <span class="muted small">${aside}</span>` : ''}
      </span>
      <span class="entry__value ${tone || ''}">${value}</span>
    </button>`;

  const section = (title, entries) =>
    entries.length
      ? `<section class="section card">
           <div class="section__head"><h2>${escapeHtml(title)}</h2></div>
           <div class="entries">${entries.join('')}</div>
         </section>`
      : '';

  return `
    ${flashHtml()}
    ${head(
      `<div class="who">
         <span class="who__mark" aria-hidden="true">${escapeHtml([...file.name][0] || '?')}</span>
         <span>
           <h1>${escapeHtml(file.name)}</h1>
           ${inGroups.length ? `<span class="muted small">${escapeHtml(inGroups.join(' · '))}</span>` : ''}
         </span>
       </div>`,
      waiting ? `<p class="banner">${escapeHtml(waiting)}</p>` : '',
    )}

    <div class="tiles">
      ${tile(file.counts.games, t('person.statGames'))}
      ${tile(file.counts.wins, t('person.statWins'))}
      ${tile(file.counts.left, t('person.statLines'))}
      ${tile(file.counts.votes, t('person.statVotes'))}
    </div>

    ${section(
      t('person.lists'),
      file.lines.map((row) =>
        entry(
          `#/list/${escapeHtml(row.list.id)}`,
          escapeHtml(listTitle(row.list)),
          // The soonest day still ahead of them, or nothing: a list with no
          // days says nothing about when, and should not pretend to.
          row.next ? escapeHtml(t(row.late ? 'lists.lateOn' : 'lists.dueOn', { day: formatDay(row.next) })) : '',
          escapeHtml(t('person.assigned', { done: row.done, total: row.total })),
          row.late ? 'entry__value--bad' : row.left ? '' : 'entry__value--good',
        ),
      ),
    )}

    ${section(
      t('person.votes'),
      file.votes.map((row) =>
        entry(
          `#/poll/${escapeHtml(row.poll.id)}`,
          escapeHtml(pollTitle(row.poll)),
          row.closed ? escapeHtml(t('polls.closed')) : '',
          escapeHtml(row.answered ? t('person.answered') : t('person.notAnswered')),
          row.closed ? '' : row.answered ? 'entry__value--good' : 'entry__value--bad',
        ),
      ),
    )}

    ${section(
      t('person.spends'),
      file.accounts.map((row) =>
        entry(
          `#/spend/${escapeHtml(row.spend.id)}`,
          escapeHtml(spendTitle(row.spend)),
          escapeHtml(t('spends.paidTotal', { amount: showAmount(row.paid, getLanguage()) })),
          escapeHtml(
            row.balance === 0
              ? t('spends.even')
              : t(row.balance > 0 ? 'spends.isOwed' : 'spends.owes', {
                  amount: showAmount(Math.abs(row.balance), getLanguage()),
                }),
          ),
          row.balance > 0 ? 'entry__value--good' : row.balance < 0 ? 'entry__value--bad' : '',
        ),
      ),
    )}

    ${section(
      t('person.games'),
      file.played
        .slice(0, GAMES_SHOWN)
        .map((row) =>
          entry(
            `#/game/${escapeHtml(row.game.id)}`,
            escapeHtml(gameTitle(row.game)),
            escapeHtml(formatDate(row.game.updatedAt)),
            escapeHtml(
              row.won
                ? t('person.won', { total: row.total })
                : t('person.rank', { rank: row.rank, of: row.of, total: row.total }),
            ),
            row.won ? 'entry__value--good' : '',
          ),
        ),
    )}

    <div class="row">
      <button type="button" class="button button--small button--ghost"
              data-rename-everywhere="${escapeHtml(file.name)}">
        ${escapeHtml(t('stats.rename'))}
      </button>
    </div>

    <p class="notes">${escapeHtml(t('person.sameName'))}</p>`;
}

/** How many of someone's evenings the page shows before it stops being a page. */
const GAMES_SHOWN = 8;

function statsView() {
  const mine = shownDocs(state.games);
  const played = presetsPlayed(mine);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('stats.title'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/games">${escapeHtml(t('action.back'))}</button>
    </div>
    ${groupChipsHtml()}

    ${
      played.length
        ? played
            .map(({ presetId, played: count }) => {
              const preset = getPreset(presetId);
              const rows = statsFor(mine, presetId);
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
                              <td>
                                ${escapeHtml(row.name)}
                                <button type="button" class="button button--small button--ghost"
                                        data-rename-everywhere="${escapeHtml(row.name)}"
                                        title="${escapeHtml(t('stats.renameTitle'))}">✎</button>
                              </td>
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

/**
 * Whether anyone has touched the entrant fields since the form was emptied.
 *
 * My own first name is offered as the first *player*, never as a team, and the
 * preset is only known once the form is drawn — so the offer is made at draw
 * time. Which means it must be made once: put back after someone deleted it, it
 * would put them in a game they had just taken themselves out of.
 */
let newGameTouched = false;

function newGameView() {
  const presetId = state.newPresetId || PRESETS[0].id;
  const preset = getPreset(presetId);
  const config = state.newConfig || presetConfig(preset);
  const isTeam = config.entrantLabel === 'team';
  const [min, max] = preset.players;

  // A team is not a person: my name is offered to players only, and only while
  // nothing has been typed — the preset is not known before this point. Switching
  // from a game of people to a game of teams takes the offer back, since the
  // first field stops being a person and becomes "Équipe 1".
  if (!newGameTouched) {
    newGameNames = isTeam
      ? withoutMe(newGameNames, myName())
      : withMeFirst(newGameNames, myName());
  }
  while (newGameNames.length < min) newGameNames.push('');
  const names = newGameNames.slice(0, Math.max(min, Math.min(newGameNames.length, max)));

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
      <button type="button" class="button button--small button--ghost" data-goto="#/games">${escapeHtml(t('action.back'))}</button>
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
      <button type="button" class="button button--small button--ghost" data-goto="#/games">${escapeHtml(t('action.back'))}</button>
    </div>

    ${inGroupHtml(game)}

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
        <button type="button" class="button button--small button--ghost" id="game-archive">
          ${escapeHtml(game.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
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
    {
      version: 1,
      games: state.games,
      lists: state.lists,
      polls: state.polls,
      spends: state.spends,
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

function showCopyDialog({
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
    : [...(parsed?.games || []), ...(parsed?.lists || []), ...(parsed?.polls || []), ...(parsed?.spends || [])];
  const games = all.filter(isValidGame);
  const lists = all.filter(isValidList);
  const polls = all.filter(isValidPoll);
  const spends = all.filter(isValidSpend);
  if (!games.length && !lists.length && !polls.length && !spends.length) {
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

  for (const document_ of [...freshGames, ...freshLists, ...freshPolls, ...freshSpends]) {
    if (state.store) void state.store.save(document_);
    if (state.remote && document_.shared) {
      // A backup older than a deletion must not bring the thing back for everyone.
      state.remote.put(document_, keyFor(document_), organiserSecret(document_.id))
        .catch((error) => wasDeleted(error) && dropDeleted(document_.id));
    }
  }
  const count = freshGames.length + freshLists.length + freshPolls.length + freshSpends.length;
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
async function shareMessage({ title, hint, message, url, code = null }) {
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

async function shareUrl({ url, title, hint, text, code = null, codeLabel, codeHint }) {
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

/* ----------------------------------------------------------------- groups --- */

/**
 * A group is a circle of people and a key: the family, the Tuesday card
 * players. Holding its key is what lets this device start sharing, and what
 * shows it everything the group shares — games, lists and polls together.
 *
 * The keys live on this device and nowhere else: not in the repository, not in
 * the page, not in an export.
 */
function groups() {
  const value = state.prefs.groups;
  return Array.isArray(value)
    ? value.filter((group) => group && typeof group.key === 'string' && group.key)
    : [];
}

function rememberGroup(group) {
  const others = groups().filter((held) => held.id !== group.id);
  state.prefs = { ...state.prefs, groups: [...others, group] };
  savePrefs(state.prefs);
}

function forgetGroup(id) {
  state.prefs = { ...state.prefs, groups: groups().filter((group) => group.id !== id) };
  savePrefs(state.prefs);
}

/** The groups by name, so the pastilles keep their order from render to render. */
function groupsByName() {
  return [...groups()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Which group the three tabs are showing, '' for all of them.
 *
 * Kept in the preferences rather than in memory: looking at one group means
 * looking at its lists *and* its polls *and* its games, so the choice has to
 * survive a tab change and a reload. A filter left on a group this device has
 * since left means nothing any more, and falls back to all of them.
 */
/**
 * The pastille for what is in none of this device's groups: kept to oneself,
 * sent by link only, or from a group this device is not in. Under "Tous" it
 * is mixed in with everything else; here it is on its own, said as such.
 */
const OUTSIDE_GROUPS = 'outside';

function outsideGroups(document_) {
  return !groups().some((group) => inGroup(document_, group.id));
}

function groupFilter() {
  const wanted = state.prefs.groupFilter || '';
  if (wanted === OUTSIDE_GROUPS) return groups().length ? wanted : '';
  return groups().some((group) => group.id === wanted) ? wanted : '';
}

function setGroupFilter(id) {
  state.prefs = { ...state.prefs, groupFilter: id || '' };
  savePrefs(state.prefs);
}

/** The documents a tab shows, once the chosen group has had its say. */
function shownDocs(documents) {
  const wanted = groupFilter();
  if (wanted === OUTSIDE_GROUPS) return documents.filter(outsideGroups);
  return wanted ? documents.filter((document_) => inGroup(document_, wanted)) : documents;
}

/**
 * What the chosen group is keeping out of sight, when it is keeping anything.
 *
 * A filter that empties a tab tells the same story as having nothing: the page
 * reads "no polls yet" while the polls are right there, one chip away. Worse
 * for what was never shared — it belongs to no group, so *every* group hides
 * it. So wherever the filter can empty a screen, it says how much it is
 * holding back, and offers to stop.
 */
function hiddenByGroupHtml(all) {
  const wanted = groupFilter();
  if (!wanted) return '';
  const hidden = all.length - shownDocs(all).length;
  if (hidden <= 0) return '';
  return `
    <p class="muted small">
      ${escapeHtml(t('filter.hidden', { count: hidden }))}
      <button type="button" class="button button--small button--ghost" data-group-filter="">
        ${escapeHtml(t('filter.all'))}
      </button>
    </p>`;
}

/**
 * The group a device sends its new things to on its own, when it was asked to.
 * Only when there is exactly one: with several, the app asks each time rather
 * than choosing for you.
 */
function autoGroup() {
  if (!state.prefs.autoShare || !state.remote) return null;
  const held = groups();
  return held.length === 1 ? held[0] : null;
}

/**
 * The group a new thing goes into: the one being looked at, or the only one
 * this device sends to on its own.
 *
 * Looking at Mifa and writing a list means writing a list for Mifa. Choosing
 * the group again, in a dialog, for something that was made inside that very
 * filter, is a question whose answer is already on the screen — and one that,
 * unasked, left the list in no group at all.
 */
function groupForNew() {
  const chosen = groupFilter();
  if (chosen) return groups().find((group) => group.id === chosen) || null;
  return autoGroup();
}

/**
 * Where a thing about to be created will land — decided on the form, before it
 * exists, rather than left for a later that never came.
 *
 * A dialog would do the job and was tried; it puts a modal in front of every
 * single creation, which is a heavy price for a question whose answer is
 * almost always the obvious one. Chips answer it in advance, in the open, and
 * cost a tap only when the answer is wrong.
 *
 * `chosen` is null until someone touches a chip, and only then does it beat
 * the default — so opening the form after changing the pastille follows the
 * pastille rather than a stale choice.
 */
let newGroupChoice = { touched: false, id: null };

function resetGroupChoice() {
  newGroupChoice = { touched: false, id: null };
}

/** The group a new thing goes into, chip or no chip. */
/** The chip that means "only those who get the link". */
const LINK_ONLY = '@lien';

/**
 * Where a new thing lands: a group, nowhere, or "link only".
 *
 * Link only still needs a group behind it. Creating anything in the database
 * takes a group's key — that is what keeps strangers from filling it — and the
 * key that created a thing is the one that may delete it. So a link-only thing
 * is written with a key of this device's, and the database is told the group
 * must not list it: not in its tabs, not in its calendar. Which group lends
 * the key matters to nobody but the one deleting, so it is the one being
 * looked at, or the first by name.
 */
function destinationForNew() {
  const held = groups();
  if (!state.remote || !held.length) return { group: null, linkOnly: false };
  if (newGroupChoice.touched) {
    if (newGroupChoice.id === LINK_ONLY) {
      return { group: groupForNew() || groupsByName()[0], linkOnly: true };
    }
    const group = newGroupChoice.id ? held.find((item) => item.id === newGroupChoice.id) || null : null;
    return { group, linkOnly: false };
  }
  // Nobody has touched anything: the group being looked at, the only one there
  // is, or — with several and none chosen — none, said plainly on the form.
  return { group: groupForNew() || (held.length === 1 ? held[0] : null), linkOnly: false };
}

/** What a new document carries about where it went. */
function landing(document_) {
  const { group, linkOnly } = destinationForNew();
  return {
    ...document_,
    shared: Boolean(group),
    groupId: group?.id || null,
    ...(linkOnly ? { linkOnly: true } : {}),
  };
}

/** The chips that say where it will land, and change it. */
function willBeInHtml() {
  const held = groups();
  if (!state.remote || !held.length) return '';
  const { group, linkOnly } = destinationForNew();
  const on = linkOnly ? LINK_ONLY : group?.id || '';
  const chip = (id, label) => `
    <button type="button" class="chip ${on === id ? 'chip--on' : ''}"
            data-new-group="${escapeHtml(id)}" aria-pressed="${on === id ? 'true' : 'false'}">
      ${escapeHtml(label)}
    </button>`;
  const note = linkOnly ? t('groups.linkOnlyHint') : group ? '' : t('groups.willBeInNone');
  return `
    <div class="stack stack--tight">
      <span class="muted small">${escapeHtml(t('groups.willGoIn'))}</span>
      <div class="row row--tight" role="group" aria-label="${escapeHtml(t('groups.willGoIn'))}">
        ${groupsByName().map((item) => chip(item.id, item.name)).join('')}
        ${chip(LINK_ONLY, t('groups.linkOnly'))}
        ${chip('', t('groups.keepToMyself'))}
      </div>
      ${note ? `<p class="muted small">${escapeHtml(note)}</p>` : ''}
    </div>`;
}

/** The group a document belongs to, when it belongs to one this device knows. */
function groupOf(document_) {
  return document_?.groupId ? groups().find((group) => group.id === document_.groupId) || null : null;
}

/**
 * Which group a thing is in, said on the thing itself — and the way to put it
 * in one.
 *
 * Until now the only way to attach a list or a poll to a group was the Share
 * button, which reads as "give me a link", not as "put this in Mifa". With a
 * single group the app did it silently and nobody had to know; with two, it
 * stopped doing it and still nobody was told. So a document sat in no group,
 * invisible to everyone else and hidden by every filter, with nothing on the
 * page to say so or to fix it.
 */
function inGroupHtml(document_) {
  if (!state.remote || !groups().length) return '';
  if (document_.linkOnly) {
    // No group to name, and none to put it in: the database fixed that at
    // its first write. What it is, and how it travels, is all there is to say.
    return `
      <div class="row row--tight">
        <span class="muted small">${escapeHtml(t('groups.inLinkOnly'))}</span>
      </div>`;
  }
  const group = groupOf(document_);
  return `
    <div class="row row--tight">
      <span class="muted small">
        ${escapeHtml(group ? t('groups.inGroup', { name: group.name }) : t('groups.inNone'))}
      </span>
      ${
        group
          ? groups().length > 1
            ? `<button type="button" class="button button--small button--ghost" data-copy-to-group="${escapeHtml(document_.id)}">
                 ${escapeHtml(t('groups.copyTo'))}
               </button>`
            : ''
          : `<button type="button" class="button button--small" data-put-in-group="${escapeHtml(document_.id)}">
               ${escapeHtml(t('groups.putIn'))}
             </button>`
      }
    </div>`;
}

/**
 * Put a document in a group, whichever kind it is. The document travels from
 * here on, and stops being hidden by the group pastilles.
 */
async function putInGroup(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const game = getGame(id);
  const spend = getSpend(id);
  const document_ = poll || list || game || spend;
  if (!document_ || !state.remote) return;

  const group = await askGroup();
  if (!group) {
    render();
    return;
  }

  const next = { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
  try {
    await state.remote.put(next, group.key, organiserSecret(next.id));
  } catch (error) {
    pushFailed(next)(error);
    render();
    return;
  }

  flash(t('groups.putInDone', { name: group.name }));
  if (poll) replacePoll(next);
  else if (list) replaceList(next);
  else if (spend) replaceSpend(next);
  else replaceGame(next);
}

/**
 * Copy a thing into another group.
 *
 * A copy and not a move, and deliberately so: what is shared travels by its
 * own identifier, and the database fixes a document's group when it is first
 * written — a later write never moves it. Worse, a move that only happened
 * here would be undone by anyone else's device, which still holds the thing
 * under the old group and would write it back there at their next change. A
 * copy owes nothing to the old group: a new identifier, a new row, and the
 * original left exactly where it was.
 */
async function copyToGroup(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const game = getGame(id);
  const spend = getSpend(id);
  const document_ = poll || list || game || spend;
  if (!document_ || !state.remote) return;

  const group = await askGroup({ title: t('groups.copyWhere'), except: document_.groupId, always: true });
  if (!group) {
    render();
    return;
  }

  const now = Date.now();
  const fresh = {
    ...document_,
    id: uid(document_.id.split('_')[0] || 'id'),
    shared: true,
    groupId: group.id,
    // Copied into a group, it is the group's: a link-only original makes a
    // copy the group can see, which is the point of copying it there.
    linkOnly: false,
    // The event it was made for stays in the other group, with the original.
    event: null,
    // A copy is its own thing from here on: it is new to the group receiving
    // it, whatever age the original had reached.
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  // A copied poll is a new poll, and whoever copies it organises it.
  const copy = poll ? organise(fresh) : fresh;

  try {
    await state.remote.put(copy, group.key, organiserSecret(copy.id));
  } catch {
    flash(t('share.pushFailed'), 'error');
    render();
    return;
  }

  flash(t('groups.copiedTo', { name: group.name }));
  if (poll) {
    state.polls = [...state.polls, copy];
    persistPoll(copy);
    navigate(`#/poll/${copy.id}`);
  } else if (list) {
    state.lists = [...state.lists, copy];
    persistList(copy);
    navigate(`#/list/${copy.id}`);
  } else if (spend) {
    state.spends = [...state.spends, copy];
    persistSpend(copy);
    navigate(`#/spend/${copy.id}`);
  } else {
    state.games = [...state.games, copy];
    persist(copy);
    navigate(`#/game/${copy.id}`);
  }
}

/**
 * The organiser of a poll: the device that created it, holding a secret the
 * database knows only by its fingerprint.
 *
 * Everyone else — the other members of the group as much as a visitor from a
 * link — ticks their evenings and adds their own name, and that is all: the
 * day, the closing, the question, the choices, the list of people and the
 * poll itself are the organiser's. The screen hides what is not theirs, and
 * the database, told nothing it can check, keeps what the organiser set.
 *
 * The secret lives on this device only. A poll made before the organiser
 * existed has none, and stays open to all, as it always was.
 */
function organiserSecret(id) {
  return state.prefs.organiser?.[id] || null;
}

/** The organiser's secrets for the polls this device still holds. */
function heldOrganiserSecrets() {
  const held = state.prefs.organiser || {};
  return Object.fromEntries(state.polls.filter((poll) => held[poll.id]).map((poll) => [poll.id, held[poll.id]]));
}

/**
 * Take back the organiser's secrets from an export. Only well-formed ones, and
 * never over a secret already here: the one this device holds is the one the
 * database knows. Returns how many polls this device organises again.
 */
function restoreOrganiserSecrets(found) {
  if (!found || typeof found !== 'object' || Array.isArray(found)) return 0;
  const held = { ...state.prefs.organiser };
  let restored = 0;
  for (const [id, secret] of Object.entries(found)) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{16,128}$/.test(secret) || held[id]) continue;
    held[id] = secret;
    restored += 1;
  }
  if (restored) {
    state.prefs = { ...state.prefs, organiser: held };
    savePrefs(state.prefs);
  }
  return restored;
}

function isOrganiser(poll) {
  return !poll?.owned || Boolean(organiserSecret(poll.id));
}

/** Make this device the organiser of a new poll: a secret, kept here. */
function organise(poll) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const secret = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  state.prefs = { ...state.prefs, organiser: { ...state.prefs.organiser, [poll.id]: secret } };
  savePrefs(state.prefs);
  return { ...poll, owned: true };
}

/** The key a document was shared with, or the only group's, or none. */
function keyFor(document_) {
  const held = groups();
  if (document_?.groupId) {
    const group = held.find((item) => item.id === document_.groupId);
    if (group) return group.key;
  }
  return held.length === 1 ? held[0].key : null;
}

/**
 * Which group to share this in. Answers straight away when there is only one
 * — the usual case — and asks when there are several.
 */
async function askGroup({ title = null, except = null, keepToMyself = false, always = false } = {}) {
  const held = groups().filter((group) => group.id !== except);
  if (!held.length) return null;
  // One group and nothing to weigh it against: asking would be a question with
  // a single answer. With "keep it to myself" on the table there are two — and
  // an action worth a second look asks whatever the count.
  if (held.length === 1 && !keepToMyself && !always) return held[0];

  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(title || t('groups.which'))}</h2>
        <div class="stack stack--tight">
          ${held
            .map(
              (group) => `<button type="button" class="button button--block" data-group="${escapeHtml(group.id)}">${escapeHtml(group.name)}</button>`,
            )
            .join('')}
        </div>
        ${
          keepToMyself
            ? `<button type="button" class="button button--block button--ghost" id="group-none">
                 ${escapeHtml(t('groups.keepToMyself'))}
               </button>
               <p class="muted small">${escapeHtml(t('groups.keepToMyselfHint'))}</p>`
            : ''
        }
        <div class="row">
          <button type="button" class="button" id="group-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    let answered = false;
    const done = (group) => {
      if (answered) return;
      answered = true;
      resolve(group);
      dialog.close();
    };
    dialog.addEventListener('close', () => done(null));
    dialog.querySelector('#group-cancel').addEventListener('click', () => done(null));
    dialog.querySelector('#group-none')?.addEventListener('click', () => done(null));
    dialog.querySelectorAll('[data-group]').forEach((button) => {
      button.addEventListener('click', () => done(held.find((group) => group.id === button.dataset.group)));
    });
    dialog.showModal();
  });
}

/**
 * Share a document for the first time: pick the group, send it, and remember
 * which group it went to. Returns the shared document, or null when there was
 * no group to share it in or the database refused.
 */
async function startSharing(document_) {
  if (document_.shared) return document_;
  const group = await askGroup();
  if (!group) {
    flash(t('groups.needOne'), 'error');
    render();
    return null;
  }

  const shared = { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
  try {
    await state.remote.put(shared, group.key, organiserSecret(shared.id));
  } catch (error) {
    flash(remoteReason(error), 'error');
    render();
    return null;
  }
  return shared;
}

/** Long enough for any first name, short enough to leave room on a key's label. */
const NAME_KEPT = 24;

/**
 * Who is holding this device — a first name, nothing more.
 *
 * It is asked once, when joining a group, because that is the moment it is
 * actually wanted: the group needs to know who has just come in, and the
 * person is going to type their name into the first list anyway.
 *
 * Where it goes: the label on this device's key, so the group can tell whose
 * device is whose — and, like any name typed into a list, into that list,
 * which travels to the group when the list is shared. Nowhere else.
 */
function myName() {
  const value = state.prefs.me;
  return typeof value === 'string' ? value.trim().slice(0, NAME_KEPT) : '';
}

function setMyName(name) {
  const clean = String(name || '').trim().slice(0, NAME_KEPT);
  if (clean === myName()) return clean;
  state.prefs = { ...state.prefs, me: clean };
  savePrefs(state.prefs);
  // A name given just now — on joining a group, most of the time — belongs in
  // the forms that are still empty, without waiting for the app to be reopened.
  offerMeInForms();
  return clean;
}

/**
 * Offer me as the first person of each form that is currently empty. Called
 * when the app starts and each time a form is emptied after creating
 * something — never on a redraw, so a name deleted by hand stays deleted.
 */
function offerMeInForms() {
  newListPeople = withMeFirst(newListPeople, myName());
  newPollPeople = withMeFirst(newPollPeople, myName());
  newEventPeople = withMeFirst(newEventPeople, myName());
  // Games are left to newGameView: only there is it known whether this preset
  // is played by people or by teams.
  newGameTouched = false;
}

/**
 * Where this device is, and when it knocked — enough to tell one line from
 * another in the group's list of devices. The first name is *not* in here: it
 * travels beside it, and the database puts the two together, so a line reads
 * "Alice · écran d'accueil · 20 sept. 2026" and never "Alice · Alice · …".
 */
/**
 * The warning to show someone reading this inside Messenger, Instagram or the
 * like: what they do here stays here. It is the most likely way to arrive, since
 * the invitation travels by message — and the least durable place to land.
 */
function inAppWarningHtml() {
  const app = inAppBrowser(navigator.userAgent);
  if (!app) return '';
  return `
    <p class="banner banner--warn">
      ${escapeHtml(t('browser.inApp', { app }))}
      <button type="button" class="button button--small" id="copy-here">
        ${escapeHtml(t('browser.copyLink'))}
      </button>
    </p>`;
}

function bindInAppWarning() {
  view.querySelector('#copy-here')?.addEventListener('click', () => {
    showCopyDialog({
      title: t('browser.copyTitle'),
      hint: t('browser.copyHint'),
      text: location.href,
    });
  });
}

/** Whether this is the app added to a home screen rather than a browser tab. */
function onHomeScreen() {
  return Boolean(matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone);
}

function deviceLabel() {
  const standalone = onHomeScreen();
  const where = standalone ? t('groups.onHomeScreen') : t('groups.inBrowser');
  return `${where} · ${formatDate(Date.now())}`;
}

/**
 * Take in a key: the database says which group it opens, or refuses it. This is
 * the very first device of a group — the one nobody can invite, which starts
 * from the key the SQL editor printed.
 */
async function joinGroup(key) {
  const clean = String(key || '').trim();
  if (!clean || !state.remote) return null;
  const group = await state.remote.groupOf(clean);
  if (!group) return null;
  rememberGroup({ id: group.id, name: group.name, key: clean, admits: Boolean(group.admits) });
  return group;
}

/**
 * Check every group this device believes it is in.
 *
 * A key can be cut off from the other side — a phone lost, someone who left.
 * Without this the group would sit in the list for ever, refusing everything
 * with no explanation. Asked once, on opening the app.
 */
async function verifyGroups() {
  if (!state.remote) return false;
  let learnt = false;
  for (const group of groups()) {
    let found = null;
    try {
      found = await state.remote.groupOf(group.key);
    } catch {
      continue; // No answer is not an answer: the group stays.
    }
    if (!found) {
      forgetGroup(group.id);
      flash(t('gate.cutMe', { name: group.name }), 'error');
      learnt = true;
      continue;
    }
    if (found.name !== group.name || Boolean(found.admits) !== group.admits) {
      rememberGroup({ ...group, name: found.name || group.name, admits: Boolean(found.admits) });
      learnt = true;
    }
  }
  return learnt;
}

/* ------------------------------------------------- knocking, and admitting --- */

/**
 * A device does not let itself into a group: it knocks, and waits.
 *
 * What it keeps while it waits is a ticket — a secret the database handed it
 * once. Accepted, that very ticket becomes its key; refused, it never opened
 * anything. So the wait costs nothing and shows nothing, and an invitation that
 * goes astray is a knock at the door rather than a stranger in the house.
 */
function pendings() {
  const value = state.prefs.pendings;
  return Array.isArray(value)
    ? value.filter((knock) => knock && typeof knock.ticket === 'string' && knock.ticket)
    : [];
}

/**
 * Knocks are kept generously — a ticket is handed over once and stored nowhere
 * else — but not without end: a device that knocks at door after door without
 * ever being let in would grow a list nobody reads, and claim every one of them
 * at each start.
 */
const KNOCKS_KEPT = 20;

function rememberPending(knock) {
  const others = pendings().filter((held) => held.ticket !== knock.ticket);
  state.prefs = { ...state.prefs, pendings: [...others, knock].slice(-KNOCKS_KEPT) };
  savePrefs(state.prefs);
}

function forgetPending(ticket) {
  state.prefs = { ...state.prefs, pendings: pendings().filter((knock) => knock.ticket !== ticket) };
  savePrefs(state.prefs);
}

/** The knock this device is still waiting on for that group, if any. */
function pendingFor(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return pendings().find((knock) => String(knock.groupName || '').trim().toLowerCase() === wanted) || null;
}

/**
 * Ask the database where a knock stands. Accepted, the group is remembered with
 * the ticket as its key and everything it shares comes in; refused, the knock
 * is forgotten. Returns the answer's status, or null when nothing was learnt.
 */
async function checkPending(knock) {
  if (!state.remote) return null;
  let answer = null;
  try {
    answer = await state.remote.claim(knock.ticket);
  } catch {
    return null;
  }

  if (answer.status === 'ok') {
    // A device that is somehow already in this group keeps the key it has: the
    // ticket it was just handed is an ordinary key, and the one it holds may be
    // the only one in the group that lets anyone in.
    const alreadyIn = groups().find((item) => item.id === answer.id);
    const group = alreadyIn || { id: answer.id, name: answer.name || knock.groupName, key: knock.ticket, admits: false };
    rememberGroup(group);
    forgetPending(knock.ticket);
    let taken = 0;
    try {
      taken = await catchUpWith(group);
    } catch {
      // In the group either way; what it shares can be fetched later.
    }
    // Just let in: the one moment they will listen to "keep your return link".
    // Said in the line that greets them rather than in a dialog — a question
    // that blocks the screen on the way in is a question in the wrong place.
    flash(taken
      ? t('groups.joinedWithKeepLink', { name: group.name, count: taken })
      : t('groups.joinedKeepLink', { name: group.name }));
    return 'ok';
  }

  if (answer.status === 'refused') {
    forgetPending(knock.ticket);
    flash(t('gate.refusedMe', { name: knock.groupName }), 'error');
    return 'refused';
  }

  // 'unknown' means the knock is gone — expired, or the group was deleted.
  if (answer.status === 'unknown') {
    forgetPending(knock.ticket);
    flash(t('gate.lostMe', { name: knock.groupName }), 'error');
    return 'unknown';
  }

  return 'waiting';
}

/** Look in on every knock at once — on opening the app, or on demand. */
async function checkAllPendings() {
  let learnt = false;
  for (const knock of pendings()) {
    const status = await checkPending(knock);
    if (status && status !== 'waiting') learnt = true;
  }
  return learnt;
}

/**
 * What the group's gatekeeper sees: who is knocking, and which devices are in.
 * Both are asked of the database and kept until something changes them, so a
 * redraw does not knock again.
 */
function gate() {
  if (!state.gate) state.gate = { requests: {}, devices: {}, asked: {}, at: {} };
  return state.gate;
}

function forgetGate(groupId) {
  const held = gate();
  delete held.requests[groupId];
  delete held.devices[groupId];
  delete held.asked[groupId];
  delete held.at[groupId];
}

/**
 * Ask again for what the gatekeeper is looking at, quietly, while the overview
 * is open — someone knocking on the other side of the room must not stay
 * invisible until the app is closed and opened again.
 */
async function refreshGate() {
  let changed = false;
  for (const group of groups()) {
    if (group.admits === false) continue;
    const before = JSON.stringify(gate().requests[group.id] ?? null)
      + JSON.stringify(gate().devices[group.id] ?? null);
    gate().asked[group.id] = false;
    await loadGate(group);
    const after = JSON.stringify(gate().requests[group.id] ?? null)
      + JSON.stringify(gate().devices[group.id] ?? null);
    if (before !== after) changed = true;
  }
  return changed;
}

/**
 * Load a group's knocks and devices, once — and never draw over a message
 * nobody has read yet: a redraw consumes it, and a second one would wipe it.
 */
async function loadGate(group) {
  const held = gate();
  if (held.asked[group.id]) return false;
  held.asked[group.id] = true;
  if (!state.remote) return false;

  try {
    const [requests, devices] = await Promise.all([
      state.remote.requests(group.key),
      state.remote.groupKeys(group.key),
    ]);
    held.requests[group.id] = requests;
    held.devices[group.id] = devices;
    held.at[group.id] = Date.now();
    return true;
  } catch (error) {
    // Two very different refusals, and taking one for the other used to cost
    // the gatekeeper their own door: the database saying "this key does not let
    // people in" is settled, while a network that failed says nothing at all.
    if (/ne fait pas entrer/i.test(String(error?.message || ''))) {
      rememberGroup({ ...group, admits: false });
      return true;
    }
    held.asked[group.id] = false;
    return false;
  }
}

/**
 * Whether this device's key lets people in. Groups remembered before the
 * question existed do not say, so the database is asked once.
 */
async function refreshGroup(group) {
  if (!state.remote) return false;
  let found = null;
  try {
    found = await state.remote.groupOf(group.key);
  } catch {
    return false;
  }
  if (!found) return false;
  rememberGroup({ ...group, name: found.name || group.name, admits: Boolean(found.admits) });
  return true;
}

/**
 * Fetch what every group shares, for all of them at once.
 *
 * This is what "the other phone pushed something" needs: a game played in
 * Safari and a list ticked off in the app on the home screen are two devices as
 * far as the database is concerned, and nothing but this brings one's work to
 * the other when neither has the document open.
 */
async function catchUpAll() {
  let taken = 0;
  for (const group of groups()) {
    try {
      taken += await catchUpWith(group);
    } catch {
      // One group out of reach is not a reason to skip the others.
    }
  }
  // A link-only poll is listed for no group, on purpose — so no group's
  // catch-up brings its answers. The devices that hold one ask for it by
  // name instead: few of them, and the only way anyone would hear back.
  for (const poll of state.polls.filter((held) => held.shared && held.linkOnly && !held.archivedAt)) {
    try {
      if (await pullPoll(poll.id)) taken += 1;
    } catch {
      // Out of reach now; the next catch-up asks again.
    }
  }
  state.syncedAt = Date.now();
  return taken;
}

/** Not more often than this, when it happens on its own. */
const SYNC_EVERY = 20000;

/**
 * Catch up by itself: when the app opens, and each time it comes back to the
 * front — which on a phone is what "I switched from Safari to the app" means.
 */
async function catchUpQuietly() {
  if (!state.remote || !groups().length) return;
  if (state.syncedAt && Date.now() - state.syncedAt < SYNC_EVERY) return;
  const taken = await catchUpAll();
  const changed = showsGate() ? await refreshGate() : false;
  if ((taken || changed) && !isBusy()) render();
}

/**
 * Fetch everything the group shares that this device is missing or behind on.
 * The database hands over ids and their dates, so a device that is up to date
 * asks for nothing more.
 */
async function catchUpWith(group) {
  if (!state.remote) return 0;
  const rows = await state.remote.groupDocs(group.key);
  let taken = 0;
  for (const row of rows) {
    const held = getGame(row.id) || getList(row.id) || getPoll(row.id);
    if (held && (row.updatedAt || 0) <= (held.updatedAt || 0)) continue;
    if (await pullAny(row.id)) taken += 1;
  }
  return taken;
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
  // "That function does not exist" has two causes, and they call for opposite
  // things: the database has not been brought up to date, or this copy of the app
  // has not. Only whoever set the database up can do the first, so the message
  // names both and points at the update button rather than at the SQL guide.
  if (error?.status === 404 || /PGRST202/.test(text)) {
    return t(groups().some((group) => group.admits) ? 'shareApp.needsSql' : 'shareApp.needsUpdate');
  }
  if (/cle de (partage|groupe)/i.test(text)) return t('groups.refused');
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
  const games = [...state.games, ...state.lists, ...state.polls, ...state.spends].sort((a, b) => b.updatedAt - a.updatedAt);
  const held = groups();
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

  const off = held.length ? '' : ' disabled';
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('shareApp.title'))}</h2>
      <div class="stack stack--tight" role="radiogroup" aria-label="${escapeHtml(t('shareApp.title'))}">
        <label class="choice">
          <input type="radio" name="share-kind" value="app" checked />
          <span>${escapeHtml(t('shareApp.kindApp'))}<span class="muted small"> — ${escapeHtml(t('shareApp.kindAppHint'))}</span></span>
        </label>
        <label class="choice${held.length ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="all"${off} />
          <span>${escapeHtml(t('shareApp.kindAll', { count: games.length }))}</span>
        </label>
        <label class="choice${held.length ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="some"${off} />
          <span>${escapeHtml(t('shareApp.kindSome'))}</span>
        </label>
      </div>

      ${held.length ? '' : `<p class="banner">${escapeHtml(t('groups.needOne'))}</p>`}

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
    const group = await askGroup();
    if (!group) return fail(t('groups.needOne'));

    try {
      // The key first, and only then the documents: a key the database no
      // longer recognises must not cost an evening its privacy on the way to
      // being told so.
      if (!(await state.remote.groupOf(group.key))) return fail(t('groups.refused'));
      // Sealed where the browser can: then the stored lot holds no identifier
      // at all, only their encrypted form.
      const contents = canSeal() ? { sealed: await seal(ids, code) } : { ids };
      await shareGames(chosen, group);
      await state.remote.putSet(setId, contents, code, group.key);
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
async function shareGames(games, group) {
  try {
    for (const document_ of games) {
      const next = document_.shared
        ? document_
        : { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
      await state.remote.put(next, group.key, organiserSecret(next.id));
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
          gone = await state.remote.forgetSet(id, groups()[0]?.key || '');
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
}

/**
 * The data section, which belongs to the app rather than to any one tab: the
 * app's own link, what leaves the device and what comes back.
 */
function bindData() {
  view.querySelector('#look-update')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const answer = await lookForUpdate();
    button.disabled = false;
    if (answer === 'coming') flash(t('data.updateComing'));
    else if (answer === 'current') flash(t('data.updateNone'));
    else flash(t('data.updateUnknown'), 'error');
    render();
  });

  view.querySelector('#share-app')?.addEventListener('click', openShareAppDialog);
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
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed, keyFor(changed), organiserSecret(changed.id)).catch(pushFailed(changed));
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
  // A model is picked, not filled in: the list it cuts is ready at once, with
  // its people, its lines and their days — which is the whole point of having
  // kept one.
  view.querySelectorAll('[data-from-template]').forEach((button) => {
    button.addEventListener('click', () => {
      const template = getList(button.dataset.fromTemplate);
      if (!template) return;
      const next = reuseList(template);
      state.lists = [...state.lists, next];
      persistList(next);
      navigate(`#/list/${next.id}`);
    });
  });

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

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
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
    let list = signed(landing(createList({ name: newListName, names: newListPeople })));
    list = addItems(list, newListLines);

    state.lists = [...state.lists, list];
    persistList(list);
    resetGroupChoice();
    newListName = '';
    newListPeople = withMeFirst(['', ''], myName());
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

  view.querySelector('#list-template')?.addEventListener('click', () => {
    const next = makeTemplate(list, !list.template);
    flash(t(next.template ? 'lists.nowTemplate' : 'lists.noLongerTemplate'));
    replaceList(next);
  });

  view.querySelector('#list-archive')?.addEventListener('click', () => {
    const next = archiveList(list, !list.archivedAt);
    flash(t(next.archivedAt ? 'archive.done' : 'archive.undone'));
    // Put away means out of the way: staying on its page would be the one
    // place it is still in front of you.
    replaceList(next, { redraw: !next.archivedAt });
    if (next.archivedAt) navigate('#/lists');
  });

  view.querySelector('#list-rename')?.addEventListener('click', () => openListNameDialog(list));
  view.querySelector('#list-sign')?.addEventListener('click', () =>
    openSignatureDialog(list, (signedBy) => replaceList({ ...list, signedBy, updatedAt: Date.now() })));

  view.querySelector('#list-delete')?.addEventListener('click', async () => {
    if (!(await ask(t('lists.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) return;
    state.lists = state.lists.filter((item) => item.id !== list.id);
    saveLists(state.lists);
    if (state.store) void state.store.remove(list.id);
    if (state.remote) state.remote.remove(list.id, keyFor(list), organiserSecret(list.id)).catch(() => {});
    navigate('#/lists');
  });

  view.querySelector('#list-share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    let current = list;

    if (!current.shared) {
      button.disabled = true;
      button.textContent = t('share.sending');
      current = await startSharing(current);
      if (!current) return;
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
      <label>
        ${escapeHtml(t('lists.due'))}
        <input type="date" id="line-due" value="${escapeHtml(item.due || '')}" />
      </label>
      <p class="muted small">${escapeHtml(t('lists.dueHint'))}</p>
      <div class="row">
        <button type="button" class="button button--primary" id="line-save">${escapeHtml(t('action.save'))}</button>
        <button type="button" class="button" id="line-cancel">${escapeHtml(t('action.cancel'))}</button>
        <button type="button" class="button button--danger" id="line-delete">${escapeHtml(t('action.delete'))}</button>
      </div>
    </form>`;

  const field = dialog.querySelector('#line-text');
  const day = dialog.querySelector('#line-due');
  const save = () => {
    dialog.close();
    // The words and the day are one edit: saving with the field emptied takes
    // the day off, which is how a date is removed without a second button.
    replaceList(setItemDue(renameItem(list, itemId, field.value), itemId, day.value));
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

  // Typing in a name is what counts as touching the form — not switching preset,
  // which merely keeps what is there.
  view.querySelectorAll('[data-name-index]').forEach((input) => {
    input.addEventListener('input', () => {
      newGameTouched = true;
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

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshotNames();
      state.newName = view.querySelector('#game-name').value;
      state.newConfig = readConfigFromForm();
      newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
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

  form.addEventListener('submit', async (event) => {
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

    const game = landing(createGame({
      presetId,
      names,
      overrides: config,
      name: view.querySelector('#game-name').value,
    }));
    state.games = [...state.games, game];
    persist(game);
    resetGroupChoice();

    newGameNames = ['', '', ''];
    newGameTouched = false;
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

/** A safe-ish file name from any title: letters, digits, and what joins them. */
function fileName(title) {
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
  document.getElementById('create')?.addEventListener('click', openCreateMenu);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.prefs = { ...state.prefs, theme: currentThemeIsDark() ? 'light' : 'dark' };
    savePrefs(state.prefs);
    applyTheme();
  });

  // One button for "bring me what the others have done", on every screen: the
  // tabs each show their own list, and a list is not refreshed by looking at it.
  document.getElementById('sync').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('icon-button--busy');
    let taken = 0;
    let failed = false;
    try {
      taken = await catchUpAll();
      if (showsGate()) await refreshGate();
    } catch {
      failed = true;
    }
    button.disabled = false;
    button.classList.remove('icon-button--busy');
    flash(failed ? t('sync.failed') : taken ? t('sync.done', { count: taken }) : t('sync.nothing'),
      failed ? 'error' : 'info');
    render();
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

/**
 * Where each marked box was scrolled to, taken just before a redraw.
 *
 * A redraw replaces the whole view, and a box that scrolls sideways — the poll
 * grid with a dozen people across it — comes back at its left edge. Tapping
 * Léa's cell at the far right then threw the grid back to Gui's, every single
 * time. Boxes that should hold their place carry data-keep-scroll, keyed by
 * what they show; a redraw of the same thing puts them back where they were.
 */
function keptScrolls() {
  const kept = new Map();
  view.querySelectorAll('[data-keep-scroll]').forEach((box) => {
    kept.set(box.dataset.keepScroll, { left: box.scrollLeft, top: box.scrollTop });
  });
  return kept;
}

function restoreScrolls(kept) {
  view.querySelectorAll('[data-keep-scroll]').forEach((box) => {
    const was = kept.get(box.dataset.keepScroll);
    if (!was) return;
    box.scrollLeft = was.left;
    box.scrollTop = was.top;
  });
}

/**
 * The page reduced to one poll, for whoever opened a shared link.
 *
 * Someone who got the link in a Messenger chat came to tick their evenings,
 * not to find an app: the tabs, the overview, the button that makes a new list
 * were all doors into rooms that are none of theirs — empty rooms, since their
 * device holds nothing else, but doors all the same. Here there are none. The
 * tabs go, the name at the top stops being a link, and the poll page keeps
 * only what a guest does with it.
 *
 * It is a way of showing, not a lock: the data was already walled off by the
 * database, which lists nothing of a group without its key. Someone who edits
 * the address by hand reaches the app — their own, empty one.
 */
function setSolo(on) {
  document.body.classList.toggle('solo', on);
  // Hidden outright, not only by the stylesheet: out of reach of a tap, of the
  // keyboard and of a screen reader alike, whatever the styles do.
  const tabs = document.getElementById('tabs');
  if (tabs) tabs.hidden = on;
  const brand = document.querySelector('.app-bar__brand');
  if (!brand) return;
  if (on) {
    brand.removeAttribute('href');
    brand.setAttribute('aria-disabled', 'true');
  } else {
    brand.setAttribute('href', '#/');
    brand.removeAttribute('aria-disabled');
  }
}

/**
 * A poll that is not there: back to the list — or, for a guest, a sentence and
 * nothing else. Out of reach is not gone: the guest is asked to try again.
 */
function leavePoll(current, { unreachable = false } = {}) {
  if (!current.solo) {
    if (unreachable) flash(t('polls.unreachable'), 'error');
    navigate('#/polls');
    return;
  }
  if (!unreachable) {
    view.innerHTML = `<p class="lead">${escapeHtml(t('polls.soloGone'))}</p>`;
    return;
  }
  view.innerHTML = `
    <p class="lead">${escapeHtml(t('polls.unreachable'))}</p>
    <button type="button" class="button" id="poll-retry">${escapeHtml(t('polls.retry'))}</button>`;
  view.querySelector('#poll-retry').addEventListener('click', () => render());
}

function render() {
  const current = route();
  markTab(current);
  setSolo(Boolean(current.solo));
  const kept = keptScrolls();
  // Nothing to fetch without a database, or before this device is in a group.
  const sync = document.getElementById('sync');
  if (sync) sync.hidden = !(state.remote && groups().length);
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
  } else if (current.name === 'agenda') {
    stopWatching();
    view.innerHTML = agendaView();
  } else if (current.name === 'new-event') {
    stopWatching();
    view.innerHTML = newEventView();
    bindNewEvent();
  } else if (current.name === 'new-spend') {
    stopWatching();
    view.innerHTML = newSpendView();
    bindNewSpend();
  } else if (current.name === 'spend') {
    const spend = getSpend(current.id);
    if (!spend) {
      stopWatching();
      // Peut-être un compte que quelqu'un partage : demander avant d'abandonner.
      if (state.remote) {
        view.innerHTML = `<p class="muted small">${escapeHtml(t('spends.loading'))}</p>`;
        if (state.openingSpend !== current.id) {
          const asked = current.id;
          state.openingSpend = asked;
          pullSpend(asked).then((found) => {
            if (state.openingSpend !== asked) return;
            state.openingSpend = null;
            if (found) render();
            else if (route().id === asked) navigate('#/spends');
          });
        }
        return;
      }
      navigate('#/spends');
      return;
    }
    watchSpend(spend.id);
    view.innerHTML = spendView(spend);
    bindSpend(spend);
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
            else if (route().id === asked) leavePoll(current, { unreachable: found === null });
          });
        }
        return;
      }
      leavePoll(current);
      return;
    }
    watchPoll(poll.id);
    view.innerHTML = pollView(poll, { solo: current.solo });
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
          else if (route().id === current.id) navigate('#/games');
        });
        return;
      }
      navigate('#/games');
      return;
    }
    watchGame(game.id);
    if (state.editingRoundId && !game.rounds.some((round) => round.id === state.editingRoundId)) {
      state.editingRoundId = null;
    }
    view.innerHTML = gameView(game);
    bindGame(game);
  } else if (current.name === 'person') {
    stopWatching();
    view.innerHTML = personView(current.who);
  } else if (current.name === 'group') {
    stopWatching();
    const group = groups().find((held) => held.id === current.id);
    if (!group) {
      navigate('#/groups');
      return;
    }
    // Looking at a group sets nothing for the rest of the app: it used to set
    // the filter, which then quietly sent everything the "+" made afterwards,
    // from anywhere, into this group. The "+" opened here proposes it instead.
    view.innerHTML = groupView(group);
  } else if (current.name === 'back') {
    stopWatching();
    view.innerHTML = backView(current.token);
    bindBack(current.token);
  } else if (current.name === 'join') {
    view.innerHTML = joinView(current);
    bindJoin();
    if (pendingFor(current.group)) watchPending();
    else stopWatching();
  } else if (current.name === 'home') {
    stopWatching();
    view.innerHTML = homeView();
    bindHome();
  } else if (current.name === 'spends') {
    stopWatching();
    view.innerHTML = spendsView();
  } else if (current.name === 'settings') {
    stopWatching();
    view.innerHTML = settingsView();
    bindOverview();
  } else if (current.name === 'groups') {
    view.innerHTML = groupsView();
    bindOverview();
    if (state.remote && groups().some((group) => group.admits !== false)) watchGate();
    else stopWatching();
  } else {
    view.innerHTML = overviewView();
    bindOverview();
    if (state.remote && groups().some((group) => group.admits !== false)) watchGate();
    else stopWatching();
  }

  view.querySelectorAll('[data-goto]').forEach((node) => {
    node.addEventListener('click', () => navigate(node.dataset.goto));
  });
  view.querySelectorAll('[data-create-menu]').forEach((node) => {
    node.addEventListener('click', openCreateMenu);
  });

  // The group pastilles, and the overview's numbers — which pick a group and
  // open its tab in one tap, so the filter is set before the page changes.
  view.querySelectorAll('[data-group-filter]').forEach((node) => {
    node.addEventListener('click', () => {
      setGroupFilter(node.dataset.groupFilter);
      render();
    });
  });
  view.querySelectorAll('[data-put-in-group]').forEach((node) => {
    node.addEventListener('click', () => {
      node.disabled = true;
      void putInGroup(node.dataset.putInGroup);
    });
  });

  view.querySelectorAll('[data-copy-to-group]').forEach((node) => {
    node.addEventListener('click', () => {
      node.disabled = true;
      void copyToGroup(node.dataset.copyToGroup);
    });
  });

  view.querySelectorAll('[data-group-tile]').forEach((node) => {
    node.addEventListener('click', () => {
      setGroupFilter(node.dataset.groupTile);
      navigate(node.dataset.tileGoto);
    });
  });

  // Offered from the statistics, where two spellings show as two lines, and
  // from a person's own page, which is the other place a name is looked at.
  view.querySelectorAll('[data-rename-everywhere]').forEach((button) => {
    button.addEventListener('click', () => renameEverywhere(button.dataset.renameEverywhere));
  });

  restoreScrolls(kept);
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

/** Which part of the app we are in, so the tab bar says so. */
function markTab(current) {
  const bar = document.getElementById('tabs');
  if (!bar) return;
  const poll = current.name === 'poll' ? getPoll(current.id) : null;
  const inAgenda = ['agenda', 'new-event'].includes(current.name) || (poll && pollHome(poll) === '#/agenda');
  const here = inAgenda
    ? 'agenda'
    : ['groups', 'group', 'person', 'join', 'back'].includes(current.name)
      ? 'groups'
      : current.name === 'settings'
        ? 'settings'
        : 'home';
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
  if (isValidSpend(stored)) return adoptSpend(stored);
  return false;
}

/** While a shared list is on screen, watch for what the others are ticking. */
function watchList(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return;
    if (await pullList(id)) render();
  }, 5000);
}

/** While a game is on screen, watch for rounds someone else has entered. */
function watchGame(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return; // never redraw under someone's fingers
    if (await pullGame(id)) render();
  }, 5000);
}

function stopWatching() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
  // The same timer serves lists and games: forget whose it was.
  state.pollWatched = null;
}

/** A list's identity for comparison: which games, and how recently each changed. */
function signature(games) {
  return games
    .map((game) => `${game.id}:${game.updatedAt}`)
    .sort()
    .join('|');
}

/**
 * The app is in the background: nobody is looking, so the watchers ask the
 * base nothing until it comes back (a document is caught up at once then).
 */
function isHidden() {
  return document.visibilityState === 'hidden';
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
  // A message already read belongs to the screen it was read on. One that has
  // not been seen yet follows, so that nothing is lost on the way.
  if (state.flash?.shownAt) state.flash = null;
  render();
});

/**
 * Another tab of the same app changed what is kept on this device. Take it in:
 * two tabs each holding their own idea of the keys, and the last one to write
 * anything would wipe the other's — a ticket that only exists on this device
 * included.
 */
window.addEventListener('storage', (event) => {
  if (event.key && !event.key.startsWith('marque-points:')) return;
  state.prefs = loadPrefs();
  state.games = loadGames();
  state.lists = loadLists();
  state.polls = loadPolls();
  state.spends = loadSpends();
  if (!isBusy()) render();
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
    // `updateViaCache: 'none'` is what makes a published update arrive at all:
    // without it the browser may hand the *old* sw.js back from its own HTTP
    // cache, and an app added to the home screen then stays on that version for
    // as long as the cache holds it.
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        state.worker = registration;
        // Coming back to the app is when to ask whether a new one was published
        // — an app on a home screen is opened far more often than it is
        // reloaded, and may never be reloaded at all.
        const look = () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', look);
        window.addEventListener('focus', look);
      })
      .catch(() => {
        // No offline cache, then: everything else still works.
      });

    // A new worker has taken over: the page is showing the old version's code,
    // so it is reloaded once — never twice, whatever happens next.
    //
    // Only when a worker was already in charge, though. On a page's very first
    // visit the brand-new worker claims it too, and reloading there would make
    // every first visit reload itself — under the fingers of someone who may
    // already be typing.
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) {
        // The first worker taking charge of a page that had none: nothing to
        // reload, and the page is now controlled — so the *next* hand-over is
        // a new version, and that one is worth a reload.
        controlled = true;
        return;
      }
      if (state.reloading) return;
      state.reloading = true;
      location.reload();
    });
  });
}

/**
 * Which copy of the app this is: the version, bumped by hand when something
 * worth announcing changes, and the build stamp, which moves on its own
 * whenever any source file does.
 */
function appVersion() {
  const version = document.querySelector('meta[name="app-version"]')?.content || '';
  const build = document.querySelector('meta[name="app-build"]')?.content || '';
  return [version, build].filter(Boolean).join(' · ');
}

/**
 * Go and see whether a newer copy has been published, and say what came of it.
 *
 * The app is network-first, so a reload with a network is usually enough — but
 * "usually" is not something to leave someone guessing about, least of all on a
 * phone where the app is resumed rather than opened.
 */
async function lookForUpdate() {
  if (!state.worker) return 'unsupported';
  try {
    await state.worker.update();
  } catch {
    return 'failed';
  }
  if (state.worker.installing || state.worker.waiting) return 'coming';
  return 'current';
}

adoptOlderGames();
offerMeInForms();
render();
// What happened while the app was closed, learnt on opening it rather than left
// waiting for someone to press a button: a knock answered, a key cut off.
if (state.remote) {
  (async () => {
    const answered = pendings().length ? await checkAllPendings() : false;
    const changed = await verifyGroups();
    if ((answered || changed) && !isBusy()) render();
    // And what the others pushed meanwhile, without being asked for it.
    await catchUpQuietly();
  })();

  // Coming back to the app — from Safari, from another app, from a locked
  // screen — is exactly the moment to find out what happened elsewhere.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void catchUpQuietly();
  });
  window.addEventListener('focus', () => void catchUpQuietly());

  // And while it stays open in front of someone: the answers to a poll left
  // on the list, or on the overview, arrive without anyone having to leave
  // and come back. Nothing is asked of a hidden page, nor more often than the
  // catch-up allows itself: it is looked at every few seconds, and goes only
  // when its own twenty have passed. Ticking at exactly twenty would miss by
  // a hair every other time, and make it forty.
  setInterval(() => {
    if (document.visibilityState === 'visible') void catchUpQuietly();
  }, 5000);
}
connectToStore();
registerOfflineCache();
