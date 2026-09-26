/**
 * Lists on screen: the form, the lines, and what is done to them.
 *
 * Split out of app.js, which it calls back into: only from inside functions,
 * so the two may import each other.
 */

import {
  escapeHtml, flash, flashHtml, formatDate, formatDay, groupChipsHtml, kindsHtml, navigate, render,
  state, view,
} from './app.js';
import {
  actionsHtml, eventLinkHtml, keptElsewhere, openSignatureDialog, pushFailed, shareBarHtml, signed,
  signedByHtml,
} from './view-polls.js';
import { ask, makeDialog, showCopyDialog } from './view-games.js';
import {
  hiddenByGroupHtml, inGroupHtml, keyFor, landing, myName, organiserSecret, resetGroupChoice,
  shownDocs, startSharing, willBeInHtml,
} from './view-groups.js';
import { recentNames } from './model.js';
import {
  createList, addItems, renameItem, assignItem, toggleItem, removeItem, reuseList, addListPerson,
  renameListPerson, removeListPerson, shareOut, progress, mergeLists, isValidList, setItemDue,
  archiveList, makeTemplate,
} from './lists.js';
import { recentPeople, withMeFirst } from './people.js';
import { isLive, isLate } from './dashboard.js';
import { saveGames, saveLists } from './storage.js';
import { listLink } from './remote.js';
import { swipeHtml, swipeable, bindSwipes } from './swipe.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ lists --- */

/**
 * A list is a title, the people it concerns, and lines to hand out. The views
 * below are deliberately few: all the lines, or one person's — because what a
 * shared list is asked in practice is "what do I still have to do".
 */

export function listTitle(list) {
  return list.name || t('lists.untitled');
}

function personName(list, who) {
  return list.people.find((person) => person.id === who)?.name || '';
}

export function listCardHtml(list) {
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

export function listsView() {
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
      <div class="section__head"><h2>${escapeHtml(t('kinds.ongoing'))}</h2></div>
      ${
        open.length
          ? `<div class="game-list">${open.map(swipeable(listCardHtml)).join('')}</div>`
          : `<p class="muted small">${escapeHtml(t('lists.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.lists)}
    </section>

    ${
      finished.length
        ? `<section class="section">
             <div class="section__head"><h2>${escapeHtml(t('lists.done'))}</h2></div>
             <div class="game-list">${finished.map(swipeable(listCardHtml)).join('')}</div>
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
             <div class="game-list">${templates.map(swipeable(listCardHtml)).join('')}</div>
           </section>`
        : ''
    }

    ${archivedHtml(sorted, swipeable(listCardHtml))}`;
}

/**
 * What has been put away, folded behind one line. Kept on the page rather than
 * on a page of its own: a thing put away is still a thing you can go and find,
 * and one more screen to go looking on is one more thing to remember.
 */
export function archivedHtml(documents, cardHtml) {
  const archived = documents.filter((document_) => document_.archivedAt);
  if (!archived.length) return '';
  return `
    <details class="details">
      <summary>${escapeHtml(t('archive.shown', { count: archived.length }))}</summary>
      <div class="game-list">${archived.map(cardHtml).join('')}</div>
    </details>`;
}

export function newListView() {
  const templates = state.lists.filter((list) => list.template && !list.archivedAt);
  const suggestions = [...new Set([
    myName(), ...recentPeople(state.lists), ...recentPeople(state.polls), ...recentNames(state.games),
  ].filter(Boolean))].slice(0, 12);
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('lists.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/lists" data-back>
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
               value="${escapeHtml(state.newListName)}" required />
      </label>

      <div class="stack stack--tight">
        <span class="muted small">${escapeHtml(t('lists.peopleHint'))}</span>
        ${state.newListPeople
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
            state.newListPeople.length > 1
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
        <textarea id="list-lines" rows="5" placeholder="${escapeHtml(t('lists.firstLinesPlaceholder'))}">${escapeHtml(state.newListLines)}</textarea>
      </label>

      ${willBeInHtml()}
      <button type="submit" class="button button--primary button--block">${escapeHtml(t('lists.create'))}</button>
    </form>`;
}

function listItemHtml(list, item) {
  const who = personName(list, item.who);
  const late = isLate(item);
  return swipeHtml(item.id, `
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
      </button>`,
    { kind: 'item', tag: 'li', bodyClass: `line ${item.done ? 'line--done' : ''}` });
}

export function listView(list) {
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
      <button type="button" class="button button--small button--ghost" data-goto="#/lists" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${eventLinkHtml(list)}

    ${inGroupHtml(list)}

    ${state.remote ? shareBarHtml(`<button type="button" class="button button--primary" id="list-share">${escapeHtml(t('lists.share'))}</button>`) : ''}

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

    ${actionsHtml(`
        <button type="button" class="button button--small" id="list-people">${escapeHtml(t('lists.people'))}</button>
        <button type="button" class="button button--small" id="list-text">${escapeHtml(t('action.recap'))}</button>
        ${
          list.people.length
            ? `<button type="button" class="button button--small" id="share-out">${escapeHtml(t('lists.shareOut'))}</button>`
            : ''
        }
        ${
          done
            ? `<button type="button" class="button button--small" id="clear-done">${escapeHtml(t('lists.clearDone'))}</button>`
            : ''
        }
        <button type="button" class="button button--small" id="list-reuse">${escapeHtml(t('lists.reuse'))}</button>`, `
        <button type="button" class="button button--small button--ghost" id="list-rename">${escapeHtml(t('lists.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="list-sign">${escapeHtml(t('sign.edit'))}</button>
        <button type="button" class="button button--small button--ghost" id="list-template">
          ${escapeHtml(list.template ? t('lists.unTemplate') : t('lists.makeTemplate'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="list-archive">
          ${escapeHtml(list.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="list-delete">${escapeHtml(t('action.delete'))}</button>`)}`;
}

/**
 * Keep the local copy, and hand the changed game to the store when there is
 * one. Writing per game rather than per list keeps one write to one document,
 * which is what the store asks for.
 */
export function persist(changed) {
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
export function forget(id, game = null) {
  saveGames(state.games);
  if (state.store) void state.store.remove(id);
  if (state.remote) state.remote.remove(id, keyFor(game), organiserSecret(id)).catch(() => {});
}

export function getGame(id) {
  return state.games.find((game) => game.id === id) || null;
}

export function replaceGame(next) {
  state.games = state.games.map((game) => (game.id === next.id ? next : game));
  persist(next);
}

/* ------------------------------------------------------- lists: behaviour --- */

/** Keep the list where it lives, and send it on if it has been shared. */
export function persistList(changed) {
  const ok = saveLists(state.lists);
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) {
    state.remote.put(changed, keyFor(changed), organiserSecret(changed.id)).catch(pushFailed(changed));
  }
  return ok;
}

export function getList(id) {
  return state.lists.find((list) => list.id === id) || null;
}

/** Put a changed list back in place, write it down, and redraw. */
export function replaceList(next, { redraw = true } = {}) {
  state.lists = state.lists.map((list) => (list.id === next.id ? next : list));
  persistList(next);
  if (redraw) render();
}

export function bindNewList() {
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
    state.newListName = view.querySelector('#list-name').value;
    state.newListLines = view.querySelector('#list-lines').value;
    view.querySelectorAll('[data-person-index]').forEach((input) => {
      state.newListPeople[Number(input.dataset.personIndex)] = input.value;
    });
  };

  view.querySelector('#add-person')?.addEventListener('click', () => {
    snapshot();
    state.newListPeople = [...state.newListPeople, ''];
    render();
    view.querySelector(`[data-person-index="${state.newListPeople.length - 1}"]`)?.focus();
  });

  view.querySelector('#drop-person')?.addEventListener('click', () => {
    snapshot();
    state.newListPeople = state.newListPeople.slice(0, -1);
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
      if (state.newListPeople.includes(suggest)) return;
      const empty = state.newListPeople.findIndex((name) => !name.trim());
      if (empty >= 0) state.newListPeople[empty] = suggest;
      else state.newListPeople = [...state.newListPeople, suggest];
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    let list = signed(landing(createList({ name: state.newListName, names: state.newListPeople })));
    list = addItems(list, state.newListLines);

    state.lists = [...state.lists, list];
    persistList(list);
    resetGroupChoice();
    state.newListName = '';
    state.newListPeople = withMeFirst(['', ''], myName());
    state.newListLines = '';
    navigate(`#/list/${list.id}`);
  });
}

export function bindList(list) {
  // A line slides left to be deleted, as from its dialog.
  bindSwipes('item', (itemId) => {
    const current = getList(list.id);
    if (!current) return;
    flash(t('swipe.lineDeleted'));
    replaceList(removeItem(current, itemId));
  });

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
export async function pullList(id) {
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
export function adoptList(stored) {
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
