/**
 * What linked things do for each other, on screen: on a list, the ideas and
 * the poll's choice waiting to come in, and the lines ticked that the account
 * has not seen; on a board, the way to vote on its ideas; on a closed poll,
 * its choice for the list; on an event, who is coming and missing from its
 * lists and accounts; on Home, what has just been unblocked. And the long
 * press, on anything that opens a document, for what is done to it.
 *
 * Calls back into app.js and the other views only from inside functions.
 */

import {
  askForText, chainLabel, chainOf, documentHref, documentTitle, escapeHtml, everything, flash, formatDayLong, navigate,
  render, state, whenText,
} from './app.js';
import { persistPoll, replacePoll, signed } from './view-polls.js';
import { makeDialog } from './view-games.js';
import {
  deleteDocument, myName, openAttachDialog, openRelateDialog, organise, replaceAny, shownDocs,
} from './view-groups.js';
import { t } from './i18n.js';
import { readAmount } from './spends.js';
import { archiveList } from './lists.js';
import { archivePoll, setPollDate } from './polls.js';
import { archiveSpend } from './spends.js';
import { archiveBoard } from './ideas.js';
import { archiveGame } from './model.js';
import {
  isEventDoc, kindOf, isActivity, parentId, programmeOf, eventDays, outsideEvent, attachTargets, upcomingEvents,
  topEventOf,
} from './dashboard.js';
import { getLanguage } from './i18n.js';
import {
  related, ideasFor, addIdea, pollFromIdeas, winnersOf, winnerOffers, addWinner, spentItems, spendFromLine,
  unblockedNow, missingGoers, addGoers, activityFor, ideaActivities, choiceActivities, whenPoll, activityFromChoice,
  activityVotes,
} from './flows.js';

/** One document by id, whatever its kind. */
function byId(id) {
  return everything().find((one) => one.id === id) || null;
}

/** A block of offers: a title, then a row of buttons. */
function offersHtml(title, buttons) {
  return buttons.length
    ? `<div class="stack stack--tight">
         <span class="muted small">${escapeHtml(title)}</span>
         <div class="row row--chips">${buttons.join('')}</div>
       </div>`
    : '';
}

function offerButton(attr, value, label) {
  return `<button type="button" class="chip" ${attr}="${escapeHtml(value)}">+ ${escapeHtml(label)}</button>`;
}

/* ---------------------------------------------------------------- a list --- */

/**
 * On a list, what the things it is linked to offer: ideas from a board, what
 * a closed poll chose, and — to an account — the lines ticked and not yet
 * written there.
 */
export function listFlowsHtml(list) {
  const all = everything();
  const blocks = [];
  for (const board of related(list, all, 'board')) {
    const offers = ideasFor(list, board).filter((one) => !one.added).slice(0, 12);
    blocks.push(offersHtml(t('flows.ideasFrom', { name: documentTitle(board) }),
      offers.map((one) => offerButton('data-flow-idea', `${board.id}|${one.card.id}`, one.text))));
  }
  for (const poll of related(list, all, 'poll')) {
    const offers = winnerOffers(poll, list).filter((one) => !one.added);
    blocks.push(offersHtml(t('flows.chosenIn', { name: documentTitle(poll) }),
      offers.map((one) => offerButton('data-flow-winner', `${poll.id}|${one.option.id}`, one.option.text))));
  }
  for (const spend of related(list, all, 'spend')) {
    const spent = spentItems(spend, list);
    const ticked = list.items.filter((item) => item.done && !spent.has(item.id)).slice(0, 12);
    blocks.push(offersHtml(t('flows.toAccount', { name: documentTitle(spend) }),
      ticked.map((item) => `<button type="button" class="chip" data-flow-spend="${escapeHtml(`${spend.id}|${item.id}`)}">💶 ${escapeHtml(item.text)}</button>`)));
  }
  const shown = blocks.filter(Boolean);
  return shown.length
    ? `<section class="card stack flows" data-flows-for="${escapeHtml(list.id)}" aria-label="${escapeHtml(t('flows.title'))}">${shown.join('')}</section>`
    : '';
}

/** Write a ticked line in the account: how much, and who paid. */
function openSpendDialog(spend, list, item) {
  const given = list.people.find((person) => person.id === item.who)?.name || '';
  const names = [...new Set([given, ...spend.people.map((person) => person.name), ...list.people.map((person) => person.name)]
    .map((name) => String(name || '').trim()).filter(Boolean))];
  let payer = given || myName() || names[0] || '';
  const dialog = makeDialog();
  const draw = () => {
    dialog.innerHTML = `
      <form class="stack" method="dialog">
        <h2>${escapeHtml(t('flows.spendTitle', { name: item.text }))}</h2>
        <label class="stack stack--tight">
          <span class="small">${escapeHtml(t('flows.amount'))}</span>
          <input type="text" inputmode="decimal" id="flow-amount" autocomplete="off" placeholder="0,00" />
        </label>
        ${
          names.length
            ? `<span class="small">${escapeHtml(t('flows.paidBy'))}</span>
               <div class="row row--chips" role="group">${names.map((name) => `
                 <button type="button" class="chip ${name === payer ? 'chip--on' : ''}" data-flow-payer="${escapeHtml(name)}"
                         aria-pressed="${name === payer ? 'true' : 'false'}">${escapeHtml(name)}</button>`).join('')}
               </div>`
            : ''
        }
        <p class="muted small">${escapeHtml(t('flows.spendHint', { name: documentTitle(spend) }))}</p>
        <div class="row">
          <button type="submit" class="button button--primary" id="flow-spend-ok">${escapeHtml(t('flows.spendAdd'))}</button>
          <button type="button" class="button" data-flow-cancel>${escapeHtml(t('action.cancel'))}</button>
        </div>
      </form>`;
    dialog.querySelector('[data-flow-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-flow-payer]').forEach((node) => {
      node.addEventListener('click', () => {
        const amount = dialog.querySelector('#flow-amount').value;
        payer = node.dataset.flowPayer;
        draw();
        dialog.querySelector('#flow-amount').value = amount;
      });
    });
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const cents = readAmount(dialog.querySelector('#flow-amount').value);
      if (!cents) {
        dialog.querySelector('#flow-amount').focus();
        return;
      }
      const fresh = byId(spend.id) || spend;
      const next = spendFromLine(fresh, byId(list.id) || list, item, cents, payer);
      dialog.close();
      if (next === fresh) return;
      flash(t('flows.spent', { name: item.text, account: documentTitle(spend) }));
      replaceAny(next);
    });
  };
  draw();
  dialog.showModal();
  dialog.querySelector('#flow-amount').focus();
}

/* ---------------------------------------------------------------- a board --- */

/** On a board with ideas, the way to vote on them. */
export function boardFlowsHtml(board) {
  if (ideasFor({ items: [] }, board).length < 2) return '';
  return `<button type="button" class="button button--small" data-flow-vote="${escapeHtml(board.id)}">🗳️ ${escapeHtml(t('flows.vote'))}</button>`;
}

async function voteOnIdeas(board) {
  const question = await askForText({
    title: t('flows.voteTitle'),
    hint: t('flows.voteHint'),
    value: documentTitle(board),
    confirmLabel: t('flows.voteMake'),
  });
  if (question === null || question === undefined) return;
  const poll = signed(organise(pollFromIdeas(board, { question, names: [myName()].filter(Boolean) })));
  state.polls = [...state.polls, poll];
  persistPoll(poll);
  flash(t('flows.voteMade'));
  navigate(`#/poll/${poll.id}`);
}

/* ----------------------------------------------------------------- a poll --- */

/** On a closed poll, its choice for the lists it goes with. */
export function pollFlowsHtml(poll) {
  if (!winnersOf(poll).length) return '';
  const blocks = related(poll, everything(), 'list').map((list) => offersHtml(
    t('flows.intoList', { name: documentTitle(list) }),
    winnerOffers(poll, list).filter((one) => !one.added)
      .map((one) => offerButton('data-flow-winner-to', `${list.id}|${one.option.id}`, one.option.text)),
  )).filter(Boolean);
  return blocks.length
    ? `<section class="card stack flows" data-flows-for="${escapeHtml(poll.id)}" aria-label="${escapeHtml(t('flows.title'))}">${blocks.join('')}</section>`
    : '';
}

/* ---------------------------------------------------------------- an event --- */

/** On an event, who is coming and missing from its lists and accounts. */
export function eventFlowsHtml(event) {
  const missing = missingGoers(event, everything());
  if (!missing.length) return '';
  return `
    <div class="card stack stack--tight flows">
      ${missing.map((one) => `<p class="small">${escapeHtml(t('flows.missing', { names: one.names.join(', '), name: documentTitle(one.document) }))}</p>`).join('')}
      <div class="row"><button type="button" class="button button--small" data-flow-people="${escapeHtml(event.id)}">${escapeHtml(t('flows.people'))}</button></div>
    </div>`;
}

/* ------------------------------------------------------------------ Home --- */

/** On Home, what has just been unblocked. */
export function unblockedHtml() {
  const found = unblockedNow(shownDocs(everything())).slice(0, 5);
  if (!found.length) return '';
  return `
    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('flows.unblocked'))}</h2></div>
      <div class="game-list">${found.map(({ document: one, by }) => `
        <button type="button" class="game-card" data-goto="${escapeHtml(documentHref(one))}">
          <span class="game-card__title">🔓 ${escapeHtml(documentTitle(one))}</span>
          <span class="game-card__meta">${escapeHtml(t('flows.freedBy', { names: by.map(chainLabel).join(', ') }))}</span>
        </button>`).join('')}
      </div>
    </section>`;
}

/* ------------------------------------------------------------ activities --- */

/** An activity's day and hour, or « à caler ». */
function activityWhen(activity) {
  return activity.date ? whenText(activity) : t('activity.unscheduled');
}

/**
 * On an event, its programme: the activities in the order they happen, each
 * a way to its page, and the way to add one.
 */
export function programmeHtml(event, { guest = false } = {}) {
  const activities = programmeOf(event, everything());
  const votes = activityVotes(event, everything());
  if (guest && !activities.length && !votes.length) return '';
  return `
    <div class="stack stack--tight programme" data-flows-for="${escapeHtml(event.id)}">
      <span class="muted small">${escapeHtml(t('activity.programme'))}</span>
      ${
        activities.length
          ? `<ul class="programme__list">${activities.map((one) => `
              <li>
                <button type="button" class="programme__item" data-goto="${escapeHtml(documentHref(one))}">
                  <span class="programme__when">${escapeHtml(activityWhen(one))}</span>
                  <span class="programme__what">${escapeHtml(documentTitle(one))}</span>
                  ${outsideEvent(one, event) ? `<span class="pill pill--late">${escapeHtml(t('activity.outsideShort'))}</span>` : ''}
                </button>
              </li>`).join('')}</ul>`
          : votes.length ? '' : `<p class="muted small">${escapeHtml(t('activity.none'))}</p>`
      }
      ${votes.length ? `<ul class="programme__list">${votes.map((one) => `
        <li>
          <button type="button" class="programme__item programme__item--vote" data-goto="${escapeHtml(documentHref(one))}">
            <span class="programme__when">🎯 ${escapeHtml(t('activity.voting'))}</span>
            <span class="programme__what">${escapeHtml(documentTitle(one))}</span>
          </button>
        </li>`).join('')}</ul>` : ''}
      ${guest ? '' : `<div class="row"><button type="button" class="button button--small" data-flow-activity="${escapeHtml(event.id)}">+ ${escapeHtml(t('activity.add'))}</button></div>`}
    </div>`;
}

/** Day chips for an event's days, one picked; `none` offers « à caler ». */
function dayChipsHtml(event, picked, { none = true, attr = 'data-activity-day' } = {}) {
  const chip = (value, label) => `<button type="button" class="chip ${value === picked ? 'chip--on' : ''}" ${attr}="${escapeHtml(value)}"
      aria-pressed="${value === picked ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  return `<div class="row row--chips" role="group">
      ${eventDays(event).map((day) => chip(day, formatDayLong(day))).join('')}
      ${none ? chip('', t('activity.unscheduled')) : ''}
    </div>`;
}

/**
 * « + → Activité », away from any event: which event it is for — the coming
 * ones, soonest first —, straight to it when there is only one.
 */
export function openActivityPicker() {
  const all = everything();
  const events = upcomingEvents(shownDocs(state.polls));
  if (events.length === 1) {
    openActivityDialog(events[0]);
    return;
  }
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('activity.forWhich'))}</h2>
      ${
        events.length
          ? `<div class="game-list">${events.map((one) => `
              <button type="button" class="game-card" data-activity-for="${escapeHtml(one.id)}">
                <span class="game-card__title">${escapeHtml(documentTitle(one))}</span>
                <span class="game-card__meta">${escapeHtml([whenText(one, { long: true }), t('count.activities', { count: programmeOf(one, all).length })].join(' · '))}</span>
              </button>`).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('activity.noEvent'))}</p>
             <div class="row"><button type="button" class="button button--primary" data-activity-new-event>+ ${escapeHtml(t('events.new'))}</button></div>`
      }
      <div class="row"><button type="button" class="button button--ghost" data-activity-pick-close>${escapeHtml(t('action.cancel'))}</button></div>
    </div>`;
  dialog.querySelector('[data-activity-pick-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-activity-new-event]')?.addEventListener('click', () => {
    dialog.close();
    navigate('#/agenda/new');
  });
  dialog.querySelectorAll('[data-activity-for]').forEach((node) => {
    node.addEventListener('click', () => {
      const event = byId(node.dataset.activityFor);
      dialog.close();
      if (event) openActivityDialog(event);
    });
  });
  dialog.showModal();
}

/** A new activity: what, which day of the event — or later —, and when. */
export function openActivityDialog(event, { name = '', from = null, names = null } = {}) {
  let day = '';
  const dialog = makeDialog();
  const draw = () => {
    const typed = dialog.querySelector('#activity-name')?.value ?? name;
    const hour = dialog.querySelector('#activity-at')?.value ?? '';
    dialog.innerHTML = `
      <form class="stack" method="dialog">
        <h2>${escapeHtml(t('activity.newTitle', { name: documentTitle(event) }))}</h2>
        <label class="stack stack--tight">
          <span class="small">${escapeHtml(t('activity.name'))}</span>
          <input type="text" id="activity-name" maxlength="80" autocomplete="off" placeholder="${escapeHtml(t('activity.namePlaceholder'))}" />
        </label>
        <span class="small">${escapeHtml(t('activity.day'))}</span>
        ${dayChipsHtml(event, day)}
        <label class="stack stack--tight">
          <span class="small">${escapeHtml(t('activity.at'))}</span>
          <input type="time" id="activity-at" ${day ? '' : 'disabled'} />
        </label>
        <p class="muted small">${escapeHtml(t('activity.newHint'))}</p>
        <div class="row">
          <button type="submit" class="button button--primary" id="activity-ok">${escapeHtml(t('activity.create'))}</button>
          <button type="button" class="button" data-activity-cancel>${escapeHtml(t('action.cancel'))}</button>
        </div>
      </form>`;
    dialog.querySelector('#activity-name').value = typed;
    dialog.querySelector('#activity-at').value = day ? hour : '';
    dialog.querySelector('[data-activity-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-activity-day]').forEach((node) => {
      node.addEventListener('click', () => {
        day = node.dataset.activityDay;
        draw();
      });
    });
    dialog.querySelector('form').addEventListener('submit', (submitted) => {
      submitted.preventDefault();
      const what = dialog.querySelector('#activity-name').value.trim();
      if (!what) {
        dialog.querySelector('#activity-name').focus();
        return;
      }
      const at = dialog.querySelector('#activity-at').value || null;
      const made = organise(signed(activityFor(event, { name: what, date: day || null, at: day ? at : null, from, names })));
      dialog.close();
      state.polls = [...state.polls, made];
      persistPoll(made);
      flash(t('activity.made', { name: what, event: documentTitle(event) }));
      render();
    });
  };
  draw();
  dialog.showModal();
  dialog.querySelector('#activity-name').focus();
}

/**
 * On an activity's page: whose activity it is and when that is; with no day
 * yet, the days of the event to pick from, or a poll to ask; a word when its
 * day falls outside the event.
 */
export function activityHeadHtml(activity) {
  const all = everything();
  if (!isActivity(activity, all)) return '';
  const event = all.find((one) => one.id === parentId(activity));
  const asking = all.find((one) => one.whenFor === activity.id && !one.closedAt && !one.archivedAt);
  return `
    <section class="card stack stack--tight activity-head" data-flows-for="${escapeHtml(activity.id)}">
      <p class="small">${escapeHtml(t('activity.of', { name: documentTitle(event), when: whenText(event, { long: true }) }))}</p>
      ${outsideEvent(activity, event) ? `<p class="small late">${escapeHtml(t('activity.outside'))}</p>` : ''}
      ${
        activity.date
          ? ''
          : `<span class="small">${escapeHtml(t('activity.pickDay'))}</span>
             ${dayChipsHtml(event, '', { none: false, attr: 'data-activity-set-day' })}
             <div class="row">
               ${
                 asking
                   ? `<button type="button" class="button button--small" data-goto="${escapeHtml(documentHref(asking))}">🗳️ ${escapeHtml(t('activity.seeWhen'))}</button>`
                   : `<button type="button" class="button button--small" data-flow-when="${escapeHtml(activity.id)}">🗳️ ${escapeHtml(t('activity.askWhen'))}</button>`
               }
             </div>`
      }
    </section>`;
}

/** On a board that is part of an event, the way to make activities of its ideas. */
export function boardActivitiesHtml(board) {
  const { event, ideas } = ideaActivities(board, everything());
  if (!event || !ideas.length) return '';
  return `<button type="button" class="button button--small" data-flow-idea-activities="${escapeHtml(board.id)}">🎯 ${escapeHtml(t('activity.fromIdeas'))}</button>`;
}

/** Pick the ideas that become activities: one tap each, the dialog stays. */
function openIdeaActivitiesDialog(board) {
  const dialog = makeDialog();
  const draw = () => {
    const { event, ideas } = ideaActivities(byId(board.id) || board, everything());
    if (!event) {
      dialog.close();
      return;
    }
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('activity.fromIdeasTitle', { name: documentTitle(event) }))}</h2>
        <p class="muted small">${escapeHtml(t('activity.fromIdeasHint'))}</p>
        <div class="row row--chips">${ideas.map((one) => (one.made
          ? `<span class="chip chip--on">✓ ${escapeHtml(one.text)}</span>`
          : `<button type="button" class="chip" data-idea-activity="${escapeHtml(one.card.id)}">+ ${escapeHtml(one.text)}</button>`)).join('')}
        </div>
        <div class="row"><button type="button" class="button button--ghost" data-idea-activities-close>${escapeHtml(t('action.close'))}</button></div>
      </div>`;
    dialog.querySelector('[data-idea-activities-close]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-idea-activity]').forEach((node) => {
      node.addEventListener('click', () => {
        const one = ideas.find((idea) => idea.card.id === node.dataset.ideaActivity);
        if (!one) return;
        const made = organise(signed(activityFor(event, { name: one.text, from: { doc: board.id, part: one.card.id } })));
        state.polls = [...state.polls, made];
        persistPoll(made);
        flash(t('activity.made', { name: one.text, event: documentTitle(event) }));
        render();
        draw();
      });
    });
  };
  draw();
  dialog.showModal();
}

/** On a closed poll that is part of an event, its choice to organise. */
export function pollActivitiesHtml(poll) {
  const { event, choices } = choiceActivities(poll, everything());
  const open = choices.filter((one) => !one.made);
  if (!event || !open.length) return '';
  return `
    <section class="card stack stack--tight flows" data-flows-for="${escapeHtml(poll.id)}">
      ${offersHtml(t('activity.organise', { name: documentTitle(event) }),
        open.map((one) => offerButton('data-flow-choice-activity', one.option.id, one.option.text)))}
    </section>`;
}

/* ------------------------------------------------------------ the binder --- */

/** Every offer on the page, bound. Called after each render. */
export function bindFlows(root) {
  const pair = (value) => String(value || '').split('|');
  const current = (id) => byId(id);
  const owner = (node) => current(node.closest('[data-flows-for]')?.dataset.flowsFor);
  root.querySelectorAll('[data-flow-idea]').forEach((node) => {
    node.addEventListener('click', () => {
      const [boardId, cardId] = pair(node.dataset.flowIdea);
      const list = owner(node);
      addFrom(list, boardId, (target, board) => addIdea(target, board, board.cards.find((card) => card.id === cardId)));
    });
  });
  root.querySelectorAll('[data-flow-winner]').forEach((node) => {
    node.addEventListener('click', () => {
      const [pollId, optionId] = pair(node.dataset.flowWinner);
      const list = owner(node);
      addFrom(list, pollId, (target, poll) => addWinner(target, poll, poll.options.find((option) => option.id === optionId)));
    });
  });
  root.querySelectorAll('[data-flow-winner-to]').forEach((node) => {
    node.addEventListener('click', () => {
      const [listId, optionId] = pair(node.dataset.flowWinnerTo);
      const poll = owner(node);
      if (!poll) return;
      addFrom(current(listId), poll.id, (target, source) => addWinner(target, source, source.options.find((option) => option.id === optionId)));
    });
  });
  root.querySelectorAll('[data-flow-spend]').forEach((node) => {
    node.addEventListener('click', () => {
      const [spendId, itemId] = pair(node.dataset.flowSpend);
      const list = owner(node);
      const spend = current(spendId);
      const item = list?.items.find((one) => one.id === itemId);
      if (list && spend && item) openSpendDialog(spend, list, item);
    });
  });
  root.querySelectorAll('[data-flow-vote]').forEach((node) => {
    node.addEventListener('click', () => {
      const board = current(node.dataset.flowVote);
      if (board) void voteOnIdeas(board);
    });
  });
  root.querySelectorAll('[data-flow-people]').forEach((node) => {
    node.addEventListener('click', () => {
      const event = current(node.dataset.flowPeople);
      if (!event) return;
      const missing = missingGoers(event, everything());
      flash(t('flows.peopleDone', { count: missing.length }));
      for (const one of missing) replaceAny(addGoers(one.document, one.names));
    });
  });
  root.querySelectorAll('[data-flow-activity]').forEach((node) => {
    node.addEventListener('click', () => {
      const event = current(node.dataset.flowActivity);
      if (event) openActivityDialog(event);
    });
  });
  root.querySelectorAll('[data-activity-set-day]').forEach((node) => {
    node.addEventListener('click', () => {
      const activity = owner(node);
      if (!activity) return;
      flash(t('activity.dayKept', { day: formatDayLong(node.dataset.activitySetDay) }));
      replacePoll(setPollDate(activity, node.dataset.activitySetDay, activity.at || null, null));
    });
  });
  root.querySelectorAll('[data-flow-when]').forEach((node) => {
    node.addEventListener('click', () => {
      const activity = current(node.dataset.flowWhen);
      const event = activity && current(parentId(activity));
      if (!activity || !event) return;
      const poll = signed(organise(whenPoll(activity, event, {
        question: t('activity.whenQuestion', { name: documentTitle(activity) }),
        language: getLanguage(),
      })));
      state.polls = [...state.polls, poll];
      persistPoll(poll);
      flash(t('activity.whenMade'));
      navigate(`#/poll/${poll.id}`);
    });
  });
  root.querySelectorAll('[data-flow-idea-activities]').forEach((node) => {
    node.addEventListener('click', () => {
      const board = current(node.dataset.flowIdeaActivities);
      if (board) openIdeaActivitiesDialog(board);
    });
  });
  root.querySelectorAll('[data-flow-choice-activity]').forEach((node) => {
    node.addEventListener('click', () => {
      const poll = owner(node);
      const { event, choices } = poll ? choiceActivities(poll, everything()) : { event: null, choices: [] };
      const one = choices.find((choice) => choice.option.id === node.dataset.flowChoiceActivity);
      if (!event || !one) return;
      const keen = activityFromChoice(event, poll, one.option);
      openActivityDialog(event, { name: one.option.text, from: keen.from, names: keen.people.map((person) => person.name) });
    });
  });
  bindLongPress(root);
}

/** Add to a list from another document, and say so. */
function addFrom(list, sourceId, make) {
  const source = byId(sourceId);
  if (!list || !source) return;
  const next = make(list, source);
  if (!next || next === list) return;
  flash(t('flows.added', { name: next.items[next.items.length - 1].text, list: documentTitle(list) }));
  replaceAny(next);
}

/* ------------------------------------------------------------ long press --- */

const PRESS_MS = 500;
const PRESS_SLOP = 10;

/**
 * Whatever opens a document's page, as that document — or what says which
 * document it stands for without opening it: the tree's node for the page
 * one is on (`data-press`).
 */
function pressedDocument(node) {
  if (node.dataset.press) return byId(node.dataset.press);
  const match = /^#\/(list|poll|spend|game|idea)\/([^/]+)$/.exec(node.dataset.goto || '');
  return match ? byId(match[2]) : null;
}

/**
 * Hold anything that opens a document — a card, a line of Home, a node of the
 * chain's tree — for its menu: open, attach, link, put away, delete. A right
 * click does the same on a computer. Moving the finger, as a scroll or a
 * swipe does, cancels it; once the menu is out, the tap that ends the press
 * opens nothing — neither the page under the finger nor the menu's button
 * that has just appeared there.
 */
export function bindLongPress(root) {
  root.querySelectorAll('[data-goto], [data-press]').forEach((node) => {
    if (!pressedDocument(node) || node.dataset.pressBound) return;
    node.dataset.pressBound = '1';
    node.classList.add('pressable');
    let timer = null;
    let start = null;
    let fired = false;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      node.classList.remove('pressable--held');
    };
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      fired = false;
      start = { x: event.clientX, y: event.clientY };
      node.classList.add('pressable--held');
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        node.classList.remove('pressable--held');
        const document_ = pressedDocument(node);
        if (!document_) return;
        navigator.vibrate?.(12);
        openDocumentMenu(document_, { underFinger: true });
      }, PRESS_MS);
    });
    node.addEventListener('pointermove', (event) => {
      if (timer && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > PRESS_SLOP) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => node.addEventListener(type, cancel));
    // Capture: the menu's press must not also open the page.
    node.addEventListener('click', (event) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      cancel();
      if (fired) return;
      const document_ = pressedDocument(node);
      if (document_) openDocumentMenu(document_);
    });
  });
}

const ARCHIVERS = { list: archiveList, poll: archivePoll, spend: archiveSpend, board: archiveBoard, game: archiveGame };

/** What can be done to a document, from wherever it shows. */
export function openDocumentMenu(document_, { underFinger = false } = {}) {
  const kind = kindOf(document_) || 'game';
  const dialog = makeDialog('dialog dialog--ask doc-menu-dialog');
  // Opened under a finger still down: the tap that lifts it would land on
  // whichever button appeared there. The menu listens once the finger is up.
  if (underFinger) {
    dialog.classList.add('dialog--deaf');
    const listen = () => setTimeout(() => dialog.classList.remove('dialog--deaf'), 350);
    document.addEventListener('pointerup', listen, { once: true });
    document.addEventListener('touchend', listen, { once: true });
    setTimeout(listen, 1500);
  }
  const button = (attr, label, extra = '') => `<button type="button" class="button ${extra}" ${attr}>${escapeHtml(label)}</button>`;
  dialog.innerHTML = `
    <div class="stack">
      <div>
        <h2>${escapeHtml(chainLabel(document_))}</h2>
        <p class="muted small">${escapeHtml([t(isEventDoc(document_) ? 'chain.kind.event' : `chain.kind.${kind}`), ...chainOf(document_).map(chainLabel)].join(' · '))}</p>
      </div>
      <div class="stack stack--tight doc-menu">
        ${location.hash === documentHref(document_) ? '' : button('data-menu-open', t('menu.open'), 'button--primary')}
        ${attachTargets(document_, everything()).length || parentId(document_) ? button('data-menu-attach', t(isEventDoc(document_) ? 'activity.attach' : 'chain.attach')) : ''}
        ${button('data-menu-relate', t('relate.button'))}
        ${button('data-menu-archive', t(document_.archivedAt ? 'archive.back' : 'archive.put'))}
        ${button('data-menu-delete', t('action.delete'), 'button--danger')}
        ${button('data-menu-cancel', t('action.cancel'), 'button--ghost')}
      </div>
    </div>`;
  const on = (attr, run) => dialog.querySelector(`[${attr}]`)?.addEventListener('click', () => {
    dialog.close();
    run();
  });
  on('data-menu-open', () => navigate(documentHref(document_)));
  on('data-menu-attach', () => openAttachDialog(byId(document_.id) || document_));
  on('data-menu-relate', () => openRelateDialog(byId(document_.id) || document_));
  on('data-menu-archive', () => {
    const fresh = byId(document_.id) || document_;
    flash(t(fresh.archivedAt ? 'menu.unarchived' : 'menu.archived', { name: documentTitle(fresh) }));
    replaceAny(ARCHIVERS[kind](fresh, !fresh.archivedAt));
    if (kind === 'game') render(); // a game's writer does not redraw
  });
  on('data-menu-delete', () => void deleteDocument(document_.id));
  on('data-menu-cancel', () => {});
  dialog.showModal();
}
