/**
 * Accounts on screen: the form, the expenses, the balances, the repayments.
 *
 * Split out of app.js, which it calls back into: only from inside functions,
 * so the two may import each other.
 */

import {
  askForText, escapeHtml, flash, flashHtml, formatDate, formatDay, groupChipsHtml, kindsHtml,
  navigate, render, state, view, whenText,
} from './app.js';
import {
  actionsHtml, eventLinkHtml, getSpend, persistPoll, persistSpend, pollCardHtml, pollTitle,
  replaceSpend, shareBarHtml, signed,
} from './view-polls.js';
import { archivedHtml } from './view-lists.js';
import { ask, makeDialog } from './view-games.js';
import {
  askGroup, bindData, groups, hiddenByGroupHtml, inGroupHtml, keyFor, landing, myName, organise,
  organiserSecret, resetGroupChoice, shownDocs, willBeInHtml, isOrganiser,
} from './view-groups.js';
import { recentNames } from './model.js';
import { sameName } from './stats.js';
import { eventName } from './ics.js';
import { progress } from './lists.js';
import { createEvent, isEvent, seeksDay, lastDay } from './polls.js';
import {
  createSpend, readAmount, showAmount, spendCurrency, CURRENCIES, addSpend, editSpend, removeSpend,
  archiveSpend, addSpendPerson, renameSpendPerson, removeSpendPerson, canRemovePerson, balances,
  spendTotal, settle, addRepayment, isRepayment,
} from './spends.js';
import { recentPeople, withMeFirst } from './people.js';
import { isLive, dayNow, eventParts } from './dashboard.js';
import { saveSpends } from './storage.js';
import { swipeHtml, swipeable, bindSwipes } from './swipe.js';
import { t, getLanguage } from './i18n.js';

/* --------------------------------------------------------------- dépenses --- */

export function spendTitle(spend) {
  return spend.name || t('spends.untitled');
}

/** Ce que ce compte dit de moi : ce qu'on me doit, ou ce que je dois. */
export function myBalance(spend) {
  const me = sameName(myName());
  if (!me) return null;
  return balances(spend).find((row) => sameName(row.name) === me) || null;
}

export function spendCardHtml(spend) {
  const mine = myBalance(spend);
  const line = mine && mine.balance !== 0
    ? t(mine.balance > 0 ? 'spends.owedToMe' : 'spends.iOwe', { amount: money(Math.abs(mine.balance), spend) })
    : t('spends.even');
  return `
    <button type="button" class="game-card" data-goto="#/spend/${escapeHtml(spend.id)}">
      <span class="game-card__title">
        ${escapeHtml(spendTitle(spend))}
        <span class="pill">${escapeHtml(money(spendTotal(spend), spend))}</span>
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
export function agendaView() {
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
             <div class="game-list">${deciding.map(swipeable(pollCardHtml, isOrganiser)).join('')}</div>
           </section>`
        : ''
    }

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('events.coming'))}</h2></div>
      ${
        coming.length
          ? `<div class="game-list">${coming.map(swipeable(eventCardHtml, isOrganiser)).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('events.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.polls.filter((poll) => poll.date))}
    </section>

    ${
      past.length
        ? `<details class="details">
             <summary>${escapeHtml(t('events.past', { count: past.length }))}</summary>
             <div class="game-list">${past.map(swipeable(eventCardHtml, isOrganiser)).join('')}</div>
           </details>`
        : ''
    }

    ${archivedHtml(archivedEvents, swipeable(eventCardHtml, isOrganiser))}`;
}

/** Every account, on the home page: the ones someone still owes on, then the settled. */
export function spendsView() {
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
      <div class="section__head"><h2>${escapeHtml(t('kinds.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(swipeable(spendCardHtml)).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('spends.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.spends)}
    </section>

    ${
      done.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('spends.settled'))}</h2></div>
             <div class="game-list">${done.map(swipeable(spendCardHtml)).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, swipeable(spendCardHtml))}`;
}

/** An event in the agenda: its day, who comes, and where its list and account stand. */
export function eventCardHtml(poll) {
  const { list, spend } = eventParts(poll, state);
  const when = whenText(poll, { long: true });
  const parts = [];
  if (list) {
    const { done, total } = progress(list);
    parts.push(total ? `${t('event.list')} : ${t('lists.progress', { done, total })}` : `${t('event.list')} : ${t('lists.empty')}`);
  }
  if (spend) parts.push(t('spends.total', { amount: money(spendTotal(spend), spend) }));
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
export function newEventView() {
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.polls), ...recentPeople(state.lists), ...recentPeople(state.spends), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('events.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/agenda" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-event" class="card stack">
      <label>
        ${escapeHtml(t('events.name'))}
        <input type="text" id="event-name" placeholder="${escapeHtml(t('polls.eventNamePlaceholder'))}"
               value="${escapeHtml(state.newEventName)}" required />
      </label>

      <div class="row">
        <label>
          ${escapeHtml(t('events.day'))}
          <input type="date" id="event-day" value="${escapeHtml(state.newEventDay)}" required />
        </label>
        <label>
          ${escapeHtml(t('polls.hour'))}
          <input type="time" id="event-hour" value="${escapeHtml(state.newEventHour)}" />
        </label>
      </div>
      <label>
        ${escapeHtml(t('events.until'))}
        <input type="date" id="event-until" value="${escapeHtml(state.newEventUntil)}" />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('events.peopleHint'))}</span>
        ${state.newEventPeople
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
            state.newEventPeople.length > 1
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

export function bindNewEvent() {
  const form = view.querySelector('#new-event');
  if (!form) return;

  const snapshot = () => {
    state.newEventName = view.querySelector('#event-name').value;
    state.newEventDay = view.querySelector('#event-day').value;
    state.newEventHour = view.querySelector('#event-hour').value;
    state.newEventUntil = view.querySelector('#event-until').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      state.newEventPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    state.newEventPeople = [...state.newEventPeople, ''];
    render();
    view.querySelector(`[data-person-index="${state.newEventPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    state.newEventPeople = state.newEventPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      state.newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (state.newEventPeople.some((name) => sameName(name) === sameName(suggest))) return;
      const empty = state.newEventPeople.findIndex((name) => !name.trim());
      if (empty >= 0) state.newEventPeople[empty] = suggest;
      else state.newEventPeople = [...state.newEventPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    const poll = signed(organise(landing(createEvent({
      name: state.newEventName,
      names: state.newEventPeople,
      date: state.newEventDay,
      at: state.newEventHour,
      until: state.newEventUntil,
    }))));
    state.polls = [...state.polls, poll];
    persistPoll(poll);
    resetGroupChoice();
    state.newEventName = '';
    state.newEventDay = '';
    state.newEventHour = '';
    state.newEventUntil = '';
    state.newEventPeople = withMeFirst(['', ''], myName());
    navigate(`#/poll/${poll.id}`);
  });
}

export function newSpendView() {
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.spends), ...recentPeople(state.lists), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);

  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('spends.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/spends" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-spend" class="card stack">
      <label>
        ${escapeHtml(t('spends.name'))}
        <input type="text" id="spend-name" placeholder="${escapeHtml(t('spends.namePlaceholder'))}"
               value="${escapeHtml(state.newSpendName)}" required />
      </label>

      <label>
        ${escapeHtml(t('spends.currency'))}
        <select id="spend-currency">
          ${CURRENCIES.map((code) => `<option value="${code}" ${code === state.newSpendCurrency ? 'selected' : ''}>${escapeHtml(currencyName(code))}</option>`).join('')}
        </select>
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('spends.peopleHint'))}</span>
        ${state.newSpendPeople
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
            state.newSpendPeople.length > 1
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

      <button type="submit" class="button button--primary button--block">${escapeHtml(t('spends.create'))}</button>
    </form>`;
}

/** An amount of an account, in that account's currency. */
export function money(cents, spend) {
  return showAmount(cents, getLanguage(), spendCurrency(spend));
}

/** « € », « CHF », « £ »: what follows an amount being typed. */
function currencySymbol(code) {
  try {
    return new Intl.NumberFormat(getLanguage(), { style: 'currency', currency: code })
      .formatToParts(0).find((part) => part.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

/** « € — euro », as the currency list of a new account shows it. */
function currencyName(code) {
  try {
    const symbol = currencySymbol(code);
    const name = new Intl.DisplayNames([getLanguage()], { type: 'currency' }).of(code) || code;
    return `${symbol} — ${name}`;
  } catch {
    return code;
  }
}

/** Une dépense, telle qu'elle se lit dans la liste : qui, combien, pour qui. */
function spendLineHtml(spend, line) {
  const who = spend.people.find((person) => person.id === line.by)?.name || '';
  if (isRepayment(line)) {
    const to = spend.people.find((person) => person.id === line.forWhom[0])?.name || '';
    return swipeHtml(line.id, `
        <button type="button" class="line__text" data-spend-line="${escapeHtml(line.id)}">
          <span>${escapeHtml(t('spends.repaid', { from: who, to }))}</span>
          <span class="line__due">${escapeHtml(t('spends.repayment'))}${line.day ? ` · ${escapeHtml(formatDay(line.day))}` : ''}</span>
        </button>
        <span class="line__amount">${escapeHtml(money(line.amount, spend))}</span>`,
      { kind: 'line', tag: 'li', bodyClass: 'line line--repay' });
  }
  const forWhom = line.forWhom.length
    ? spend.people.filter((person) => line.forWhom.includes(person.id)).map((person) => person.name).join(', ')
    : t('spends.everyone');
  return swipeHtml(line.id, `
      <button type="button" class="line__text" data-spend-line="${escapeHtml(line.id)}">
        <span>${escapeHtml(line.text || t('spends.untitledLine'))}</span>
        <span class="line__due">
          ${escapeHtml(who ? t('spends.paidBy', { name: who }) : t('spends.paidByNobody'))}
          · ${escapeHtml(t('spends.forWhom', { names: forWhom }))}${line.day ? ` · ${escapeHtml(formatDay(line.day))}` : ''}
        </span>
      </button>
      <span class="line__amount">${escapeHtml(money(line.amount, spend))}</span>`,
    { kind: 'line', tag: 'li', bodyClass: 'line' });
}

export function spendView(spend) {
  if (state.spendTabId !== spend.id) {
    state.spendTabId = spend.id;
    state.spendTab = 'expenses';
  }
  const rows = balances(spend);
  const moves = settle(spend);
  const me = sameName(myName());

  const segmented = `
    <div class="segmented" role="tablist" aria-label="${escapeHtml(t('spends.sections'))}">
      <button type="button" class="segmented__option" data-spend-tab="expenses"
              role="tab" aria-selected="${state.spendTab === 'expenses' ? 'true' : 'false'}"
              aria-current="${state.spendTab === 'expenses' ? 'true' : 'false'}">
        ${escapeHtml(t('spend.tabExpenses'))}
      </button>
      <button type="button" class="segmented__option" data-spend-tab="balances"
              role="tab" aria-selected="${state.spendTab === 'balances' ? 'true' : 'false'}"
              aria-current="${state.spendTab === 'balances' ? 'true' : 'false'}">
        ${escapeHtml(t('spend.tabBalances'))}
      </button>
    </div>`;

  const formShut = spend.lines.length > 0 && state.spendFormOpen !== spend.id;
  const expensesTab = `
    ${
      spend.people.length && formShut
        ? `<button type="button" class="button button--block" id="spend-add-open">+ ${escapeHtml(t('spends.addOpen'))}</button>`
        : spend.people.length
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
                 <span class="field-pill__suffix">${escapeHtml(currencySymbol(spendCurrency(spend)))}</span>
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
                  <span class="muted small">${escapeHtml(t('spends.paidTotal', { amount: money(row.paid, spend) }))}</span>
                </span>
                <span class="entry__value ${row.balance > 0 ? 'entry__value--good' : row.balance < 0 ? 'entry__value--bad' : ''}">
                  ${escapeHtml(
                    row.balance === 0
                      ? t('spends.even')
                      : t(row.balance > 0 ? 'spends.isOwed' : 'spends.owes', {
                          amount: money(Math.abs(row.balance), spend),
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
                         <span class="entry__value">${escapeHtml(money(move.amount, spend))}</span>
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
          ${escapeHtml(t('spends.total', { amount: money(spendTotal(spend), spend) }))}
          ${spend.shared ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/spends" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${eventLinkHtml(spend)}

    ${inGroupHtml(spend)}

    ${state.remote ? shareBarHtml(`<button type="button" class="button button--primary" id="spend-share">${escapeHtml(t('spends.share'))}</button>`) : ''}

    ${segmented}

    ${state.spendTab === 'balances' ? balancesTab : expensesTab}

    ${actionsHtml(`
        <button type="button" class="button button--small" id="spend-people">${escapeHtml(t('lists.people'))}</button>`, `
        <button type="button" class="button button--small button--ghost" id="spend-rename">${escapeHtml(t('spends.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="spend-archive">
          ${escapeHtml(spend.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="spend-delete">${escapeHtml(t('action.delete'))}</button>`)}`;
}

export function bindNewSpend() {
  const form = view.querySelector('#new-spend');
  if (!form) return;

  const snapshot = () => {
    state.newSpendName = view.querySelector('#spend-name').value;
    state.newSpendCurrency = view.querySelector('#spend-currency')?.value || 'EUR';
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      state.newSpendPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    state.newSpendPeople = [...state.newSpendPeople, ''];
    render();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    state.newSpendPeople = state.newSpendPeople.slice(0, -1);
    render();
  });

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      state.newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  view.querySelectorAll('[data-suggest]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      const { suggest } = chip.dataset;
      if (state.newSpendPeople.some((name) => name.trim().toLowerCase() === suggest.toLowerCase())) return;
      const empty = state.newSpendPeople.findIndex((name) => !name.trim());
      if (empty >= 0) state.newSpendPeople[empty] = suggest;
      else state.newSpendPeople = [...state.newSpendPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    const spend = landing(createSpend({
      name: state.newSpendName,
      names: state.newSpendPeople,
      currency: state.newSpendCurrency,
    }));
    state.spends = [...state.spends, spend];
    persistSpend(spend);
    resetGroupChoice();
    state.newSpendName = '';
    state.newSpendCurrency = 'EUR';
    state.newSpendPeople = withMeFirst(['', ''], myName());
    navigate(`#/spend/${spend.id}`);
  });
}

export function bindSpend(spend) {
  bindData();

  // An expense or a repayment slides left to be deleted, as in its dialog.
  bindSwipes('line', (lineId) => {
    const current = getSpend(spend.id);
    if (!current) return;
    flash(t('swipe.lineDeleted'));
    replaceSpend(removeSpend(current, lineId));
  });

  view.querySelectorAll('[data-spend-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.spendTab = button.dataset.spendTab;
      render();
    });
  });

  view.querySelector('#spend-add-open')?.addEventListener('click', () => {
    state.spendFormOpen = spend.id;
    render();
    view.querySelector('#spend-text')?.focus();
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
    state.spendFormOpen = null;
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
