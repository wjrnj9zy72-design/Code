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
  createSpend, readAmount, showAmount, spendCurrency, CURRENCIES, addSpend, editSpend, removeSpend, archiveSpend,
  addSpendPerson, renameSpendPerson, removeSpendPerson, canRemovePerson,
  balances, spendTotal, settle, mergeSpends, isValidSpend, addRepayment, isRepayment,
} from './spends.js';
import { isValidBoard } from './ideas.js';
import { recentPeople, withMeFirst, withoutMe } from './people.js';
import { inGroup, groupCounts, peopleIn, personFile, isLive, isLate, dayNow, eventParts, forEvent } from './dashboard.js';
import {
  loadGames, saveGames, loadLists, saveLists, loadPolls, savePolls, loadSpends, saveSpends, loadBoards, loadPrefs,
  savePrefs,
} from './storage.js';
import { connectStore } from './cloud.js';
import { createRemote, pickNewer, shareLink, gameIdFrom, listLink, listIdFrom, pollLink, pollIdFrom, setLink, setIdFrom, joinLink, joinFrom, backLink, backTokenFrom, wasDeleted } from './remote.js';
import { canSeal, newCode, readCode, readInvite, seal, unseal } from './lock.js';
import { remoteConfig } from './config.js';
import { t, setLanguage, getLanguage, detectLanguage } from './i18n.js';

import {
  adoptPoll, adoptSpend, bindNewPoll, bindPoll, getPoll, getSpend, heldCounts, newPollView,
  persistPoll, pollCardHtml, pollTitle, pollView, pollsView, pullPoll, pullSpend, watchPoll,
  watchSpend,
} from './view-polls.js';
import {
  adoptList, archivedHtml, bindList, bindNewList, forget, getGame, getList, listCardHtml,
  listTitle, listView, listsView, newListView, persist, persistList, pullList,
} from './view-lists.js';
import {
  agendaView, bindNewEvent, bindNewSpend, bindSpend, eventCardHtml, money, myBalance, newEventView,
  newSpendView, spendCardHtml, spendTitle, spendView, spendsView,
} from './view-spends.js';
import {
  adoptBoard, bindBoard, bindIdeas, bindNewBoard, boardCardHtml, boardTitle, boardView, getBoard, ideasView,
  newBoardView, pullBoard, watchBoard,
} from './view-ideas.js';
import {
  ask, bindGame, bindNewGame, gameView, makeDialog, newGameView, shareMessage, showCopyDialog,
} from './view-games.js';
import {
  LINK_ONLY, NAME_KEPT, OUTSIDE_GROUPS, bindData, bindHome, bindInAppWarning, catchUpAll,
  catchUpQuietly, catchUpWith, checkAllPendings, checkPending, copyToGroup, destinationForNew,
  deviceLabel, forgetGate, forgetGroup, forgetPending, gate, groupFilter, groups, groupsByName,
  heldOrganiserSecrets, hiddenByGroupHtml, inAppWarningHtml, joinGroup, landing, loadGate, lots,
  myName, offerMeInForms, onHomeScreen, openSet, outsideGroups, pendingFor, pendings, putInGroup,
  refreshGate, refreshGroup, rememberGroup, rememberPending, remoteReason, resetGroupChoice,
  setGroupFilter, setMyName, shownDocs, verifyGroups,
} from './view-groups.js';
export const view = document.getElementById('view');

export const state = {
  games: loadGames(),
  lists: loadLists(),
  polls: loadPolls(),
  spends: loadSpends(),
  boards: loadBoards(),
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
  // And for a board of ideas.
  openingBoard: null,
  // Whose lines are on screen in a list: null for everyone, 'none' for the
  // ones nobody has taken.
  listFilter: null,
  // The new-list form's draft, kept across re-renders like the new-game one:
  // adding a person must not throw away the lines already typed.
  newListName: '',
  newListPeople: ['', ''],
  newListLines: '',
  // And the new board's.
  newBoardName: '',
  // And the new account's.
  newSpendName: '',
  newSpendCurrency: 'EUR',
  // The account whose « add an expense » form is unfolded. Once an account has
  // lines, the form folds behind one button, so the lines are what is in sight.
  spendFormOpen: null,
  newSpendPeople: ['', ''],
  // Which half of an account's page is showing — reset when a different
  // account is opened, kept when this one just redraws (adding a line, say).
  spendTabId: null,
  spendTab: 'expenses',
  // And the new-poll form's.
  newEventName: '',
  newEventDay: '',
  newEventHour: '',
  newEventUntil: '',
  newEventPeople: ['', ''],
  newPollQuestion: '',
  newPollChoices: '',
  newPollPeople: ['', ''],
  // Names typed so far, so switching preset does not wipe them.
  newGameNames: ['', '', ''],
  // Whether anyone has touched the entrant fields since the form was emptied.
  //
  // My own first name is offered as the first *player*, never as a team, and the
  // preset is only known once the form is drawn — so the offer is made at draw
  // time. Which means it must be made once: put back after someone deleted it, it
  // would put them in a game they had just taken themselves out of.
  newGameTouched: false,
  // Where a thing about to be created will land — decided on the form, before it
  // exists, rather than left for a later that never came.
  //
  // A dialog would do the job and was tried; it puts a modal in front of every
  // single creation, which is a heavy price for a question whose answer is
  // almost always the obvious one. Chips answer it in advance, in the open, and
  // cost a tap only when the answer is wrong.
  //
  // `chosen` is null until someone touches a chip, and only then does it beat
  // the default — so opening the form after changing the pastille follows the
  // pastille rather than a stale choice.
  newGroupChoice: { touched: false, id: null },
  // The deal being entered on the Tarot screen.
  deal: null,
};

/* ------------------------------------------------------------- utilities --- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]),
  );
}

/** Read a score input: '' means "not filled in" (null), otherwise a number. */
export function parseScore(raw) {
  const value = String(raw ?? '').trim().replace(',', '.');
  if (value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? NaN : number;
}

export function parseIntOrNull(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export function presetLabel(preset) {
  return preset.labelKey ? t(preset.labelKey) : preset.name;
}

export function gameTitle(game) {
  if (game.name) return game.name;
  const preset = getPreset(game.presetId);
  return preset ? presetLabel(preset) : t('new.customLabel');
}

/** The title of a game or of a list, whichever this is. */
export function documentTitle(document_) {
  if (isValidList(document_)) return listTitle(document_);
  if (isValidPoll(document_)) return pollTitle(document_);
  if (isValidBoard(document_)) return boardTitle(document_);
  return gameTitle(document_);
}

/**
 * A day written `AAAA-MM-JJ`, shown the way the reader's language shows days.
 * Built field by field rather than handed to Date(), which reads that form as
 * UTC midnight and so shows the day before, west of Greenwich.
 */
export function formatDay(day) {
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
export function whenText(poll, { long = false } = {}) {
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
export function formatDayLong(day) {
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

export function formatDate(timestamp) {
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
export function appLink() {
  const { origin, pathname, search } = location;
  return `${origin}${pathname}${search}`;
}

export function flash(message, kind = 'info') {
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

/* ----------------------------------------------------------------- router --- */

export function route() {
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
  if (name === 'ideas' && param === 'new') return { name: 'new-board' };
  if (name === 'ideas') return { name: 'ideas' };
  if (name === 'idea' && param) return { name: 'board', id: param };
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
export function pollHome(poll) {
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

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ------------------------------------------------------------------ views --- */

export function flashHtml() {
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
export function groupChipsHtml() {
  const held = groupsByName();
  const everything = [...state.lists, ...state.polls, ...state.games, ...state.spends, ...state.boards];
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
        ? t(mine.balance > 0 ? 'spends.owedToMe' : 'spends.iOwe', { amount: money(Math.abs(mine.balance), spend) })
        : t('spends.total', { amount: money(spendTotal(spend), spend) }),
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
                        count: [...state.games, ...state.lists, ...state.polls, ...state.spends, ...state.boards]
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
    const waiting = waitingLine(personFile(state, name));
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
  const boards = ours(state.boards).sort(recent);
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
    section(t('ideas.boards'), boards, boardCardHtml, '#/ideas'),
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
        ${choice('#/ideas/new', t('ideas.new'))}
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
      if (asks) state.newGroupChoice = { touched: true, id: chosen };
      dialog.close();
      navigate(node.dataset.create);
    });
  });
  dialog.querySelector('[data-create-close]').addEventListener('click', () => dialog.close());
  dialog.showModal();
}

/**
 * What someone owes across accounts: added up per currency, since euros and
 * pounds do not add — « 12,00 € + 8,00 £ ».
 */
function owedText(accounts) {
  const byCurrency = new Map();
  for (const row of accounts) {
    if (row.balance >= 0) continue;
    const code = spendCurrency(row.spend);
    byCurrency.set(code, (byCurrency.get(code) || 0) - row.balance);
  }
  return [...byCurrency].map(([code, cents]) => showAmount(cents, getLanguage(), code)).join(' + ');
}

/**
 * What is waiting on someone, in one line. Late first: a line whose day has
 * passed is the only part of this that is worse today than it was yesterday.
 */
function waitingLine({ counts, accounts = [] }) {
  return [
    counts.late ? t('lists.late', { count: counts.late }) : '',
    counts.left ? t('lists.leftToDo', { count: counts.left }) : '',
    counts.votes ? t('dash.votes', { count: counts.votes }) : '',
    counts.owes ? t('spends.owes', { amount: owedText(accounts) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The first time the app opens, empty and in no group: what it is for, the
 * first name it goes by, and three ways to begin — rather than three empty
 * sections, each saying there is nothing yet.
 */
function welcomeHtml() {
  const start = (goto, label, primary = false) =>
    `<button type="button" class="button ${primary ? 'button--primary' : ''}" data-goto="${goto}">${escapeHtml(label)}</button>`;
  return `
    <section class="card stack welcome">
      <h2>${escapeHtml(t('welcome.title'))}</h2>
      <p class="lead">${escapeHtml(t('overview.what'))}</p>
      ${
        myName()
          ? `<p>${escapeHtml(t('welcome.hello', { name: myName() }))}</p>`
          : `<label for="me-name">${escapeHtml(t('welcome.name'))}</label>
             <div class="row row--tight">
               <input type="text" id="me-name" autocomplete="given-name" maxlength="${NAME_KEPT}"
                      placeholder="${escapeHtml(t('me.placeholder'))}" />
               <button type="button" class="button" id="me-save">${escapeHtml(t('welcome.itsMe'))}</button>
             </div>
             <p class="muted small">${escapeHtml(t(state.remote ? 'me.hint' : 'me.hintAlone'))}</p>`
      }
      <span class="muted small">${escapeHtml(t('welcome.then'))}</span>
      <div class="row">
        ${state.remote ? start('#/groups', t('welcome.join'), true) : ''}
        ${start('#/polls/new', t('welcome.poll'))}
        ${start('#/lists/new', t('welcome.list'))}
        ${start('#/spends/new', t('welcome.spend'))}
      </div>
    </section>`;
}

function overviewView() {
  const forYou = forYouItems();
  const nothingYet = ![...state.lists, ...state.polls, ...state.games, ...state.spends, ...state.boards].length;
  const pending = pendingHtml(new Set(forYou.items.map((item) => item.goto)));
  // The first opening: the welcome says it all, and empty sections under it
  // would only say « nothing yet » three more times.
  if (nothingYet && !groups().length) {
    return `
      ${flashHtml()}
      ${kindsHtml('overview')}
      ${welcomeHtml()}`;
  }

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
export function kindsHtml(active) {
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
      ${kind('ideas', '#/ideas', t('tab.ideas'))}
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
      meta: t('spends.iOwe', { amount: money(-row.balance, row.spend) }),
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
        ? `<p class="muted small">${escapeHtml(t('forYou.noName'))}</p>
           <div class="row row--tight">
             <input type="text" id="me-name" autocomplete="given-name" maxlength="${NAME_KEPT}"
                    placeholder="${escapeHtml(t('me.placeholder'))}" aria-label="${escapeHtml(t('me.title'))}" />
             <button type="button" class="button" id="me-save">${escapeHtml(t('welcome.itsMe'))}</button>
           </div>`
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
export let knocking = false;

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
export function showsGate() {
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
export function askForText({ title, hint, value = '', confirmLabel }) {
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

  const waiting = waitingLine(file);

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
          escapeHtml(t('spends.paidTotal', { amount: money(row.paid, row.spend) })),
          escapeHtml(
            row.balance === 0
              ? t('spends.even')
              : t(row.balance > 0 ? 'spends.isOwed' : 'spends.owes', {
                  amount: money(Math.abs(row.balance), row.spend),
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

export function render() {
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
  } else if (current.name === 'ideas') {
    stopWatching();
    view.innerHTML = ideasView();
    bindIdeas();
  } else if (current.name === 'new-board') {
    stopWatching();
    view.innerHTML = newBoardView();
    bindNewBoard();
  } else if (current.name === 'board') {
    const board = getBoard(current.id);
    if (!board) {
      stopWatching();
      // Perhaps a board someone shares: ask before giving up.
      if (state.remote) {
        view.innerHTML = `<p class="muted small">${escapeHtml(t('ideas.loading'))}</p>`;
        if (state.openingBoard !== current.id) {
          const asked = current.id;
          state.openingBoard = asked;
          pullBoard(asked).then((found) => {
            if (state.openingBoard !== asked) return;
            state.openingBoard = null;
            if (found) render();
            else if (route().id === asked) navigate('#/ideas');
          });
        }
        return;
      }
      navigate('#/ideas');
      return;
    }
    watchBoard(board.id);
    view.innerHTML = boardView(board);
    bindBoard(board);
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
export async function pullGame(id) {
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
export async function pullAny(id) {
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
  if (isValidBoard(stored)) return adoptBoard(stored);
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

export function stopWatching() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
  // The same timer serves lists and games: forget whose it was.
  state.pollWatched = null;
}

/** A list's identity for comparison: which games, and how recently each changed. */
export function signature(games) {
  return games
    .map((game) => `${game.id}:${game.updatedAt}`)
    .sort()
    .join('|');
}

/**
 * The app is in the background: nobody is looking, so the watchers ask the
 * base nothing until it comes back (a document is caught up at once then).
 */
export function isHidden() {
  return document.visibilityState === 'hidden';
}

/** Someone is typing, or a dialog is open: a bad moment to redraw the view. */
export function isBusy() {
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
  state.boards = loadBoards();
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
export async function lookForUpdate() {
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
