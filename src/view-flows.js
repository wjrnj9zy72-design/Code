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
  askForText, chainLabel, documentHref, documentTitle, escapeHtml, everything, flash, navigate, render, state,
} from './app.js';
import { persistPoll, signed } from './view-polls.js';
import { makeDialog } from './view-games.js';
import {
  deleteDocument, myName, openAttachDialog, openRelateDialog, organise, replaceAny, shownDocs,
} from './view-groups.js';
import { t } from './i18n.js';
import { readAmount } from './spends.js';
import { archiveList } from './lists.js';
import { archivePoll } from './polls.js';
import { archiveSpend } from './spends.js';
import { archiveBoard } from './ideas.js';
import { archiveGame } from './model.js';
import { isEventDoc, kindOf } from './dashboard.js';
import {
  related, ideasFor, addIdea, pollFromIdeas, winnersOf, winnerOffers, addWinner, spentItems, spendFromLine,
  unblockedNow, missingGoers, addGoers,
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
         <div class="row row--tight">${buttons.join('')}</div>
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
          <input type="text" inputmode="decimal" id="flow-amount" autocomplete="off" />
        </label>
        ${
          names.length
            ? `<span class="small">${escapeHtml(t('flows.paidBy'))}</span>
               <div class="row row--tight" role="group">${names.map((name) => `
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

/** Whatever opens a document's page, as the id of that document. */
function pressedDocument(node) {
  const match = /^#\/(list|poll|spend|game|idea)\/([^/]+)$/.exec(node.dataset.goto || '');
  return match ? byId(match[2]) : null;
}

/**
 * Hold anything that opens a document — a card, a line of Home, a node of the
 * chain's tree — for its menu: open, attach, link, put away, delete. A right
 * click does the same on a computer. Moving the finger, as a scroll or a
 * swipe does, cancels it; once the menu is out, the tap that ends the press
 * opens nothing.
 */
export function bindLongPress(root) {
  root.querySelectorAll('[data-goto]').forEach((node) => {
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
        if (document_) openDocumentMenu(document_);
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
export function openDocumentMenu(document_) {
  const kind = kindOf(document_) || 'game';
  const dialog = makeDialog('dialog dialog--ask');
  const button = (attr, label, extra = '') => `<button type="button" class="button ${extra}" ${attr}>${escapeHtml(label)}</button>`;
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(chainLabel(document_))}</h2>
      <div class="stack stack--tight doc-menu">
        ${button('data-menu-open', t('menu.open'), 'button--primary')}
        ${isEventDoc(document_) ? '' : button('data-menu-attach', t('chain.attach'))}
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
