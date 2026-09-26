/**
 * Polls and events on screen: the list, the form, the grid, the day kept,
 * and what a document's page shares with the others (its share bar, its
 * « Plus d’actions »).
 *
 * Split out of app.js, which it calls back into: only from inside functions,
 * so the two may import each other.
 */

import {
  escapeHtml, flash, flashHtml, formatDate, formatDay, formatDayLong, gameTitle, groupChipsHtml,
  isBusy, isHidden, kindsHtml, navigate, pollHome, render, route, signature, state, stopWatching,
  view, whenText,
} from './app.js';
import { archivedHtml, getGame, getList, listCardHtml, listTitle, persistList } from './view-lists.js';
import { spendCardHtml, spendTitle } from './view-spends.js';
import { boardTitle, getBoard } from './view-ideas.js';
import { ask, download, fileName, makeDialog, showCopyDialog } from './view-games.js';
import {
  NAME_KEPT, groups, hiddenByGroupHtml, inGroupHtml, isOrganiser, keyFor, landing, myName,
  organise, organiserSecret, resetGroupChoice, shownDocs, startSharing, willBeInHtml,
} from './view-groups.js';
import { recentNames } from './model.js';
import { sameName } from './stats.js';
import { icsFor, pollEvent, eventName } from './ics.js';
import { createList } from './lists.js';
import {
  createPoll, addOptions, renameOption, removeOption, setVote, voteOf, nextValue, setClosed, tally,
  mergePolls, isValidPoll, addPollPerson, renamePollPerson, removePollPerson, archivePoll,
  setPollDate, setEventName, isEvent, dayOfChoice, choiceOfDay,
} from './polls.js';
import { createSpend, addSpend, mergeSpends, isValidSpend } from './spends.js';
import { recentPeople, withMeFirst } from './people.js';
import { isLive, eventParts, forEvent } from './dashboard.js';
import { saveGames, saveLists, savePolls, saveSpends, saveBoards, savePrefs } from './storage.js';
import { pollLink, wasDeleted } from './remote.js';
import { swipeable } from './swipe.js';
import { t, getLanguage } from './i18n.js';

/* ------------------------------------------------------------------ polls --- */

/**
 * A poll is a question, the choices it offers, and a grid: one answer per
 * person and per choice. The "which evening suits you" case is the one worth
 * building, and picking one thing out of several is the same grid with a
 * single yes in it.
 */

export function pollTitle(poll) {
  return poll.question || t('polls.untitled');
}

/** A cell says one thing: available. What was "maybe" or "no" before shows as nothing. */
const VOTE_MARK = { yes: '✓' };

export function pollCardHtml(poll) {
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

export function pollsView() {
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
          ? `<div class="game-list">${open.map(swipeable(pollCardHtml, isOrganiser)).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('polls.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.polls)}
    </section>

    ${
      closed.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('polls.done'))}</h2></div>
             <div class="game-list">${closed.map(swipeable(pollCardHtml, isOrganiser)).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, swipeable(pollCardHtml, isOrganiser))}`;
}

export function newPollView() {
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
               value="${escapeHtml(state.newPollQuestion)}" required />
      </label>

      <label>
        ${escapeHtml(t('polls.choices'))}
        <textarea id="poll-choices" rows="5" placeholder="${escapeHtml(t('polls.choicesPlaceholder'))}">${escapeHtml(state.newPollChoices)}</textarea>
      </label>
      <label class="small add-day">
        ${escapeHtml(t('polls.addDay'))}
        <input type="date" id="poll-add-day" />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('polls.peopleHint'))}</span>
        ${state.newPollPeople
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
            state.newPollPeople.length > 1
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

export function pollView(poll, { solo = false } = {}) {
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

    ${guest ? '' : shareBarHtml(`
      ${state.remote ? `<button type="button" class="button button--primary" id="poll-share">${escapeHtml(t(fixed ? 'events.share' : 'polls.share'))}</button>` : ''}
      ${state.remote && !fixed && !closed && answered < poll.people.length && poll.options.length
        ? `<button type="button" class="button" id="poll-nudge">${escapeHtml(t('polls.nudge'))}</button>`
        : ''}`)}

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

    ${guest ? '' : actionsHtml(`
        <button type="button" class="button button--small" id="poll-people">${escapeHtml(t('lists.people'))}</button>
        <button type="button" class="button button--small" id="poll-text">${escapeHtml(t('action.recap'))}</button>
        ${
          fixed
            ? ''
            : `<button type="button" class="button button--small" id="poll-close">
                 ${escapeHtml(closed ? t('polls.reopen') : t('polls.close'))}
               </button>`
        }
`, `
        <button type="button" class="button button--small button--ghost" id="poll-archive">
          ${escapeHtml(poll.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="poll-rename">${escapeHtml(t(fixed ? 'events.rename' : 'polls.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="poll-sign">${escapeHtml(t('sign.edit'))}</button>
        <button type="button" class="button button--small button--ghost" id="poll-delete">${escapeHtml(t('action.delete'))}</button>`)}`;
}

/**
 * Sharing is what a document is made for here, so it has a row of its own
 * under the title, not a place among nine buttons at the bottom.
 */
export function shareBarHtml(buttons) {
  return buttons.trim() ? `<div class="row share-bar">${buttons}</div>` : '';
}

/**
 * A document's other actions: the everyday ones in sight, the rare ones —
 * archive, rename, sign, delete — folded under « Plus d’actions ».
 */
export function actionsHtml(everyday, rare) {
  return `
    <section class="section actions">
      <div class="row">${everyday}</div>
      <details class="details actions__more">
        <summary>${escapeHtml(t('actions.more'))}</summary>
        <div class="row">${rare}</div>
      </details>
    </section>`;
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
export function eventLinkHtml(document_) {
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
export function heldCounts() {
  const all = [...state.lists, ...state.polls, ...state.games, ...state.spends, ...state.boards];
  return {
    lists: state.lists.length,
    polls: state.polls.length,
    games: state.games.length,
    spends: state.spends.length,
    shared: all.filter((document_) => document_.shared).length,
    archived: all.filter((document_) => document_.archivedAt).length,
  };
}

export function keptElsewhere(changed, { store = false } = {}) {
  if (state.remote && changed?.shared) return true;
  return Boolean(store && state.store && changed);
}

/**
 * What to do when a write does not go through. Most often it is the network:
 * the copy here stays, and goes up with the next change. But when the
 * database answers that the thing was deleted, keeping it would only fail
 * again at every change — so it leaves this device too, and the page says why.
 */
export function pushFailed(changed) {
  return (error) => {
    if (wasDeleted(error)) dropDeleted(changed.id);
    else flash(t('share.pushFailed'), 'error');
  };
}

export function dropDeleted(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const spend = getSpend(id);
  const board = getBoard(id);
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
  } else if (board) {
    state.boards = state.boards.filter((item) => item.id !== id);
    saveBoards(state.boards);
  } else if (game) {
    state.games = state.games.filter((item) => item.id !== id);
    saveGames(state.games);
  } else {
    return;
  }
  if (state.store) void state.store.remove(id);
  const name = poll ? pollTitle(poll) : list ? listTitle(list) : spend ? spendTitle(spend) : board ? boardTitle(board) : gameTitle(game);
  flash(t('share.deleted', { name }));
  // On its page, the page finds it gone and says so as any missing thing does.
  if (route().id === id) render();
}

export function persistPoll(changed) {
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

export function getPoll(id) {
  return state.polls.find((poll) => poll.id === id) || null;
}

export function persistSpend(changed) {
  const ok = saveSpends(state.spends);
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed, keyFor(changed), organiserSecret(changed.id)).catch(pushFailed(changed));
  }
  return ok;
}

export function getSpend(id) {
  return state.spends.find((spend) => spend.id === id) || null;
}

export function replaceSpend(next, { redraw = true } = {}) {
  state.spends = state.spends.map((spend) => (spend.id === next.id ? next : spend));
  persistSpend(next);
  if (redraw) render();
}

export function replacePoll(next, { redraw = true } = {}) {
  state.polls = state.polls.map((poll) => (poll.id === next.id ? next : poll));
  persistPoll(next);
  if (redraw) render();
}

export function bindNewPoll() {
  const form = view.querySelector('#new-poll');
  if (!form) return;

  const snapshot = () => {
    state.newPollQuestion = view.querySelector('#poll-question').value;
    state.newPollChoices = view.querySelector('#poll-choices').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      state.newPollPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      state.newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    state.newPollPeople = [...state.newPollPeople, ''];
    render();
    view.querySelector(`[data-person-index="${state.newPollPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    state.newPollPeople = state.newPollPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (state.newPollPeople.includes(suggest)) return;
      const empty = state.newPollPeople.findIndex((name) => !name.trim());
      if (empty >= 0) state.newPollPeople[empty] = suggest;
      else state.newPollPeople = [...state.newPollPeople, suggest];
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
    state.newPollChoices = box.value;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    let poll = signed(organise(landing(createPoll({ question: state.newPollQuestion, names: state.newPollPeople }))));
    poll = addOptions(poll, state.newPollChoices);

    state.polls = [...state.polls, poll];
    persistPoll(poll);
    resetGroupChoice();
    state.newPollQuestion = '';
    state.newPollChoices = '';
    state.newPollPeople = withMeFirst(['', ''], myName());
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

export function bindPoll(poll) {
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

  // Nobody is told a poll waits for them unless someone says so: the
  // organiser sends a reminder naming who has not answered, with the link.
  view.querySelector('#poll-nudge')?.addEventListener('click', async (event) => {
    let current = poll;
    if (!current.shared) {
      event.currentTarget.disabled = true;
      current = await startSharing(current);
      if (!current) return;
      replacePoll(current);
    }
    showCopyDialog({
      title: t('polls.nudge'),
      hint: t('polls.nudgeHint'),
      text: nudgeText(current, pollLink(location, current.id)),
      send: true,
    });
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
export function signedByHtml(document_) {
  const name = String(document_?.signedBy || '').trim();
  if (!name) return '';
  return `<p class="signed small">${escapeHtml(t('sign.by', { name }))}</p>`;
}

/** A new list or poll takes the nickname this device signs with, if it has one. */
export function signed(document_) {
  const name = String(state.prefs.signature || '').trim();
  return name ? { ...document_, signedBy: name } : document_;
}

export function openSignatureDialog(document_, save) {
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
/** The reminder: the question, who has not answered yet, and the link. */
function nudgeText(poll, link) {
  const silent = poll.people
    .filter((person) => !poll.options.some((option) => voteOf(poll, person.id, option.id)))
    .map((person) => person.name);
  return t('polls.nudgeText', { question: pollTitle(poll), names: silent.join(', '), count: silent.length, link });
}

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
export async function pullPoll(id) {
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
export function adoptPoll(stored) {
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
export function watchPoll(id) {
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
export async function pullSpend(id) {
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
export function adoptSpend(stored) {
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
export function watchSpend(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return;
    if (await pullSpend(id)) render();
  }, 5000);
}
