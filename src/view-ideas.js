/**
 * Ideas on screen: the boards, one board's cards, and the two editors — a note
 * and a sketch.
 *
 * Split out like the other screens: it calls back into app.js only from inside
 * functions, so the two may import each other.
 */

import {
  askForText, escapeHtml, flash, flashHtml, formatDate, groupChipsHtml, isBusy, isHidden, kindsHtml,
  navigate, render, state, stopWatching, view,
} from './app.js';
import { actionsHtml, keptElsewhere, pushFailed, shareBarHtml } from './view-polls.js';
import { archivedHtml } from './view-lists.js';
import { ask, makeDialog } from './view-games.js';
import {
  askGroup, bindData, hiddenByGroupHtml, inGroupHtml, keyFor, landing, organiserSecret, resetGroupChoice,
  shownDocs, willBeInHtml,
} from './view-groups.js';
import {
  createBoard, addCard, editCardText, addStrokes, eraseStrokes, removeCard, archiveBoard, cleanStroke, simplifyPoints,
  rubOut, strokePath, boardSize, cardsInOrder, mergeBoards, isValidBoard, INKS, PENS, ERASERS, SKETCH_WIDTH,
  SKETCH_HEIGHT, BOARD_LIMIT,
} from './ideas.js';
import { isLive } from './dashboard.js';
import { uid } from './model.js';
import { saveBoards, savePrefs } from './storage.js';
import { swipeHtml, swipeable, bindSwipes } from './swipe.js';
import { t } from './i18n.js';

export function boardTitle(board) {
  return board.name || t('ideas.untitled');
}

/** A board in a list of boards: its topic, and what it holds. */
export function boardCardHtml(board) {
  const notes = board.cards.filter((card) => card.type !== 'sketch').length;
  const sketches = board.cards.length - notes;
  const holds = [
    notes ? t('ideas.notes', { count: notes }) : '',
    sketches ? t('ideas.sketches', { count: sketches }) : '',
  ].filter(Boolean).join(' · ');
  return `
    <button type="button" class="game-card" data-goto="#/idea/${escapeHtml(board.id)}">
      <span class="game-card__title">
        ${escapeHtml(boardTitle(board))}
        <span class="pill">${escapeHtml(t('ideas.cards', { count: board.cards.length }))}</span>
      </span>
      <span class="game-card__meta">${escapeHtml(formatDate(board.updatedAt))}${holds ? ` — ${escapeHtml(holds)}` : ''}</span>
    </button>`;
}

/** Delete a whole board, here and in the database. Asked first: it is everyone's. */
async function deleteBoard(board, { then = null } = {}) {
  if (!(await ask(t('ideas.confirmDelete'), { confirmLabel: t('action.delete'), danger: true }))) {
    render();
    return;
  }
  state.boards = state.boards.filter((item) => item.id !== board.id);
  saveBoards(state.boards);
  if (state.store) void state.store.remove(board.id);
  if (state.remote && board.shared) state.remote.remove(board.id, keyFor(board), organiserSecret(board.id)).catch(() => {});
  flash(t('ideas.deleted', { name: boardTitle(board) }));
  if (then) navigate(then);
  else render();
}

/** Every board, on the home page: the live ones, then what was put away. */
export function ideasView() {
  const sorted = [...shownDocs(state.boards)].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = sorted.filter(isLive);
  return `
    ${flashHtml()}
    ${kindsHtml('ideas')}
    <button type="button" class="button button--primary button--block" data-goto="#/ideas/new">
      + ${escapeHtml(t('ideas.new'))}
    </button>
    ${groupChipsHtml()}

    <section class="section">
      <div class="section__head"><h2>${escapeHtml(t('kinds.ongoing'))}</h2></div>
      ${
        live.length
          ? `<div class="game-list">${live.map(swipeable(boardCardHtml)).join('')}</div>
             <p class="muted small">${escapeHtml(t('ideas.swipeHint'))}</p>`
          : `<p class="muted small">${escapeHtml(t('ideas.none'))}</p>`
      }
      ${hiddenByGroupHtml(state.boards)}
    </section>

    ${archivedHtml(sorted, swipeable(boardCardHtml))}`;
}

export function newBoardView() {
  return `
    ${flashHtml()}
    <div class="spread">
      <h1>${escapeHtml(t('ideas.new'))}</h1>
      <button type="button" class="button button--small button--ghost" data-goto="#/ideas" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    <form id="new-board" class="card stack">
      <label>
        ${escapeHtml(t('ideas.name'))}
        <input type="text" id="board-name" placeholder="${escapeHtml(t('ideas.namePlaceholder'))}"
               value="${escapeHtml(state.newBoardName)}" required />
      </label>
      ${willBeInHtml()}
      <button type="submit" class="button button--primary button--block">${escapeHtml(t('ideas.create'))}</button>
    </form>`;
}

export function bindNewBoard() {
  const form = view.querySelector('#new-board');
  if (!form) return;
  const snapshot = () => {
    state.newBoardName = view.querySelector('#board-name').value;
  };

  view.querySelectorAll('[data-new-group]').forEach((chip) => {
    chip.addEventListener('click', () => {
      snapshot();
      state.newGroupChoice = { touched: true, id: chip.dataset.newGroup || null };
      render();
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    snapshot();
    // Where it goes is said on the form, « Garder pour moi » included, as for
    // a list: no question asked after the button.
    const board = landing(createBoard({ name: state.newBoardName }));
    state.boards = [...state.boards, board];
    persistBoard(board);
    resetGroupChoice();
    state.newBoardName = '';
    navigate(`#/idea/${board.id}`);
  });
}

/** A sketch as SVG, in the frame it was drawn in: the same on every screen. */
function sketchSvg(strokes, { id = '', label = '' } = {}) {
  return `
    <svg class="sketch" viewBox="0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}" preserveAspectRatio="xMidYMid meet"
         ${id ? `id="${id}"` : ''} ${label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'}>
      ${strokes.map(strokeSvg).join('')}
    </svg>`;
}

function strokeSvg(stroke) {
  return `<path class="ink-${escapeHtml(stroke.ink)}" data-stroke="${escapeHtml(stroke.id)}"
                stroke-width="${Number(stroke.pen) || PENS[0]}" d="${strokePath(stroke)}" />`;
}

function ideaCardHtml(card) {
  if (card.type === 'sketch') {
    return `
      <button type="button" class="idea-card idea-card--sketch" data-card="${escapeHtml(card.id)}"
              aria-label="${escapeHtml(card.text || t('ideas.sketchTitle'))}">
        ${card.strokes.length ? sketchSvg(card.strokes) : `<span class="muted small">${escapeHtml(t('ideas.emptySketch'))}</span>`}
        ${card.text ? `<span class="idea-card__caption">${escapeHtml(card.text)}</span>` : ''}
      </button>`;
  }
  return `
    <button type="button" class="idea-card" data-card="${escapeHtml(card.id)}">
      <span class="idea-card__text">${escapeHtml(card.text)}</span>
    </button>`;
}

export function boardView(board) {
  const cards = cardsInOrder(board);
  return `
    ${flashHtml()}
    <div class="spread">
      <div>
        <h1>${escapeHtml(boardTitle(board))}</h1>
        <p class="muted small">
          ${escapeHtml(t('ideas.cards', { count: board.cards.length }))}
          ${board.shared ? ` · ${escapeHtml(t('lists.sharedMark'))}` : ''}
        </p>
      </div>
      <button type="button" class="button button--small button--ghost" data-goto="#/ideas" data-back>
        ${escapeHtml(t('action.back'))}
      </button>
    </div>

    ${inGroupHtml(board)}

    ${state.remote ? shareBarHtml(`<button type="button" class="button button--primary" id="board-share">${escapeHtml(t('ideas.share'))}</button>`) : ''}

    <div class="row idea-add">
      <button type="button" class="button" id="board-add-note">${escapeHtml(t('ideas.addNote'))}</button>
      <button type="button" class="button" id="board-add-sketch">${escapeHtml(t('ideas.addSketch'))}</button>
    </div>

    ${
      cards.length
        ? `<div class="idea-grid">${cards.map((card) => swipeHtml(card.id, ideaCardHtml(card), { kind: 'card' })).join('')}</div>
           <p class="muted small idea-hint">${escapeHtml(t('ideas.swipeHint'))}</p>`
        : `<p class="muted small">${escapeHtml(t('ideas.empty'))}</p>`
    }

    ${actionsHtml('', `
        <button type="button" class="button button--small button--ghost" id="board-rename">${escapeHtml(t('ideas.rename'))}</button>
        <button type="button" class="button button--small button--ghost" id="board-archive">
          ${escapeHtml(board.archivedAt ? t('archive.back') : t('archive.put'))}
        </button>
        <button type="button" class="button button--small button--ghost" id="board-delete">${escapeHtml(t('action.delete'))}</button>`)}`;
}

export function bindBoard(board) {
  bindData();

  bindSwipes('card', (cardId) => {
    const current = getBoard(board.id);
    if (!current) return;
    flash(t('ideas.cardDeleted'));
    replaceBoard(removeCard(current, cardId));
  });

  view.querySelector('#board-add-note')?.addEventListener('click', () => openNoteDialog(board.id, null));
  view.querySelector('#board-add-sketch')?.addEventListener('click', () => openSketchDialog(board.id, null));
  view.querySelectorAll('[data-card]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = board.cards.find((entry) => entry.id === button.dataset.card);
      if (!card) return;
      if (card.type === 'sketch') openSketchDialog(board.id, card.id);
      else openNoteDialog(board.id, card.id);
    });
  });

  view.querySelector('#board-share')?.addEventListener('click', async () => {
    const group = await askGroup();
    if (!group) {
      flash(t('groups.needOne'));
      render();
      return;
    }
    replaceBoard({ ...board, shared: true, groupId: group.id, updatedAt: Date.now() });
    flash(t('ideas.shared', { name: group.name }));
    render();
  });

  view.querySelector('#board-archive')?.addEventListener('click', () => {
    const next = archiveBoard(board, !board.archivedAt);
    flash(t(next.archivedAt ? 'archive.done' : 'archive.undone'));
    replaceBoard(next, { redraw: !next.archivedAt });
    if (next.archivedAt) navigate('#/ideas');
  });

  view.querySelector('#board-rename')?.addEventListener('click', async () => {
    const name = await askForText({
      title: t('ideas.rename'),
      hint: t('ideas.renameHint'),
      value: board.name,
      confirmLabel: t('action.save'),
    });
    if (name === null) return;
    replaceBoard({ ...board, name: String(name).trim(), updatedAt: Date.now() });
  });

  view.querySelector('#board-delete')?.addEventListener('click', () => deleteBoard(board, { then: '#/ideas' }));
}

/**
 * The card's own changes, applied to the board as it is *now*: while the
 * editor was open, the others' cards and strokes may have come in, and they
 * must not be written over by the copy the editor was opened on.
 */
function commitCard(boardId, cardId, type, change) {
  const current = getBoard(boardId);
  if (!current) return;
  let next = current;
  let id = cardId;
  if (!id || !next.cards.some((card) => card.id === id)) {
    ({ board: next, cardId: id } = addCard(next, type));
  }
  next = change(next, id);
  if (next === current) return;
  if (boardSize(next) > BOARD_LIMIT) {
    flash(t('ideas.full'), 'error');
    render();
    return;
  }
  replaceBoard(next);
}

/** Save, leave without saving, and — for a card that exists — delete. */
function cardButtonsHtml(cardId) {
  return `
    <div class="row">
      <button type="submit" class="button button--primary" data-card-save>${escapeHtml(t('action.save'))}</button>
      <button type="button" class="button" data-card-cancel>${escapeHtml(t('action.cancel'))}</button>
      ${cardId ? `<button type="button" class="button button--danger" data-card-delete>${escapeHtml(t('action.delete'))}</button>` : ''}
    </div>`;
}

/**
 * Wire a card's editor: only « Enregistrer » keeps what was done. « Annuler »
 * and Escape leave without saving — after asking, when something would be
 * lost, so a slip of the finger never throws a thought away. Calls `leave`
 * with 'save', 'drop' (the card deleted) or 'cancel' when the dialog closes.
 */
function bindCardButtons(dialog, { changed, leave }) {
  let outcome = 'cancel';
  const cancel = async () => {
    if (changed() && !(await ask(t('ideas.discard'), { confirmLabel: t('ideas.discardYes'), danger: true }))) return;
    outcome = 'cancel';
    dialog.close();
  };
  dialog.querySelector('form').addEventListener('submit', () => {
    outcome = 'save';
  });
  dialog.querySelector('[data-card-cancel]').addEventListener('click', (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.querySelector('[data-card-delete]')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!(await ask(t('ideas.confirmDeleteCard'), { confirmLabel: t('action.delete'), danger: true }))) return;
    outcome = 'drop';
    dialog.close();
  });
  dialog.addEventListener('close', () => leave(outcome));
}

/**
 * A note: one text box. « Enregistrer » keeps it; « Annuler » leaves it as it
 * was, after asking if something had been typed.
 */
function openNoteDialog(boardId, cardId) {
  const card = getBoard(boardId)?.cards.find((entry) => entry.id === cardId) || null;
  const dialog = makeDialog('dialog dialog--note');
  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('ideas.noteTitle'))}</h2>
      <textarea id="note-text" rows="8" placeholder="${escapeHtml(t('ideas.notePlaceholder'))}"
                aria-label="${escapeHtml(t('ideas.noteTitle'))}">${escapeHtml(card?.text || '')}</textarea>
      ${cardButtonsHtml(cardId)}
    </form>`;

  const text = dialog.querySelector('#note-text');
  const before = card?.text || '';
  bindCardButtons(dialog, {
    changed: () => text.value.trim() !== before.trim(),
    leave: (outcome) => {
      if (outcome === 'drop') {
        const current = getBoard(boardId);
        if (current) replaceBoard(removeCard(current, cardId));
        return;
      }
      const written = text.value.trim();
      // A new note left empty was never a note: nothing to keep.
      if (outcome === 'save' && (cardId || written)) {
        commitCard(boardId, cardId, 'note', (board, id) => editCardText(board, id, written));
      }
      render();
    },
  });

  dialog.showModal();
  text.focus();
}

/**
 * A sketch: a drawing area, a few inks, three pens, an eraser and an undo.
 *
 * Drawn in SVG rather than on a canvas: the strokes are already kept as paths,
 * so what is drawn here is exactly what the card will show, on any screen and
 * in either theme, with nothing to scale for the pixel density.
 */
function openSketchDialog(boardId, cardId) {
  const card = getBoard(boardId)?.cards.find((entry) => entry.id === cardId) || null;
  const dialog = makeDialog('dialog dialog--sketch');
  let ink = state.prefs.sketchInk && INKS.includes(state.prefs.sketchInk) ? state.prefs.sketchInk : 'ink';
  let pen = PENS.includes(state.prefs.sketchPen) ? state.prefs.sketchPen : PENS[0];
  let rubber = ERASERS.includes(state.prefs.sketchRubber) ? state.prefs.sketchRubber : ERASERS[0];
  let erasing = false;

  const toolsHtml = () => `
    <div class="sketch-tools" role="toolbar" aria-label="${escapeHtml(t('ideas.sketchTitle'))}">
      <button type="button" class="chip ${erasing ? '' : 'chip--on'}" data-tool="pen" aria-pressed="${erasing ? 'false' : 'true'}">${escapeHtml(t('ideas.pen'))}</button>
      <button type="button" class="chip ${erasing ? 'chip--on' : ''}" data-tool="eraser" aria-pressed="${erasing ? 'true' : 'false'}">${escapeHtml(t('ideas.eraser'))}</button>
      <button type="button" class="chip" data-tool="undo">${escapeHtml(t('ideas.undoStroke'))}</button>
    </div>
    <div class="sketch-tools" role="group" aria-label="${escapeHtml(t('ideas.inks'))}">
      ${INKS.map((name) => `
        <button type="button" class="swatch ink-${name} ${!erasing && ink === name ? 'swatch--on' : ''}" data-ink="${name}"
                aria-pressed="${!erasing && ink === name ? 'true' : 'false'}" aria-label="${escapeHtml(t(`ideas.ink.${name}`))}"
                title="${escapeHtml(t(`ideas.ink.${name}`))}"></button>`).join('')}
      <span class="sketch-tools__gap"></span>
      ${
        // The three sizes are the pen's while drawing, the eraser's while
        // rubbing out: a fine eraser takes off a corner, a broad one a whole
        // scribble.
        erasing
          ? ERASERS.map((size, index) => `
              <button type="button" class="swatch swatch--pen ${rubber === size ? 'swatch--on' : ''}" data-rubber="${size}"
                      aria-pressed="${rubber === size ? 'true' : 'false'}" aria-label="${escapeHtml(t(`ideas.rubber.${index}`))}"
                      title="${escapeHtml(t(`ideas.rubber.${index}`))}"><span class="swatch__rubber" style="width:${6 + index * 6}px;height:${6 + index * 6}px"></span></button>`).join('')
          : PENS.map((size) => `
              <button type="button" class="swatch swatch--pen ${pen === size ? 'swatch--on' : ''}" data-pen="${size}"
                      aria-pressed="${pen === size ? 'true' : 'false'}" aria-label="${escapeHtml(t(`ideas.pen.${size}`))}"
                      title="${escapeHtml(t(`ideas.pen.${size}`))}"><span style="width:${4 + size / 2}px;height:${4 + size / 2}px"></span></button>`).join('')
      }
    </div>`;

  dialog.innerHTML = `
    <form method="dialog" class="stack">
      <h2>${escapeHtml(t('ideas.sketchTitle'))}</h2>
      <div id="sketch-tools">${toolsHtml()}</div>
      <div class="sketch-pad">${sketchSvg(card?.strokes || [], { id: 'sketch-pad', label: t('ideas.canvas') })}</div>
      <label>
        ${escapeHtml(t('ideas.caption'))}
        <input type="text" id="sketch-caption" value="${escapeHtml(card?.text || '')}"
               placeholder="${escapeHtml(t('ideas.captionPlaceholder'))}" />
      </label>
      ${cardButtonsHtml(cardId)}
    </form>`;

  const pad = dialog.querySelector('#sketch-pad');
  const tools = dialog.querySelector('#sketch-tools');
  // What this editor changed: strokes drawn, strokes rubbed out, and the order
  // it happened in, for the undo button.
  const drawn = [];
  const erased = new Set();
  const history = [];
  const visible = () => [
    ...(card?.strokes || []).filter((stroke) => !erased.has(stroke.id)),
    ...drawn.filter((stroke) => !erased.has(stroke.id)),
  ];

  const refreshTools = () => {
    tools.innerHTML = toolsHtml();
  };
  tools.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.tool === 'pen') erasing = false;
    else if (button.dataset.tool === 'eraser') erasing = true;
    else if (button.dataset.tool === 'undo') undo();
    else if (button.dataset.ink) {
      ink = button.dataset.ink;
      erasing = false;
      state.prefs = { ...state.prefs, sketchInk: ink };
      savePrefs(state.prefs);
    } else if (button.dataset.pen) {
      pen = Number(button.dataset.pen);
      erasing = false;
      state.prefs = { ...state.prefs, sketchPen: pen };
      savePrefs(state.prefs);
    } else if (button.dataset.rubber) {
      rubber = Number(button.dataset.rubber);
      state.prefs = { ...state.prefs, sketchRubber: rubber };
      savePrefs(state.prefs);
    }
    refreshTools();
  });

  function undo() {
    const last = history.pop();
    if (!last) return;
    if (last.type === 'draw') {
      const index = drawn.findIndex((stroke) => stroke.id === last.id);
      if (index >= 0) drawn.splice(index, 1);
      pad.querySelector(`[data-stroke="${last.id}"]`)?.remove();
    } else {
      for (const id of last.ids) erased.delete(id);
      for (const id of last.added) erased.add(id);
      pad.innerHTML = visible().map(strokeSvg).join('');
    }
  }

  // Where a pointer is, in the frame the strokes are kept in.
  const toFrame = (event) => {
    const box = pad.getBoundingClientRect();
    // The frame is centred inside the box when their proportions differ.
    const scale = Math.min(box.width / SKETCH_WIDTH, box.height / SKETCH_HEIGHT) || 1;
    const left = box.left + (box.width - SKETCH_WIDTH * scale) / 2;
    const top = box.top + (box.height - SKETCH_HEIGHT * scale) / 2;
    return [(event.clientX - left) / scale, (event.clientY - top) / scale];
  };

  let current = null;
  let rubbed = null;
  // Only what is under the eraser goes: a stroke it crosses is cut in two.
  const rub = (x, y) => {
    for (const stroke of visible()) {
      const pieces = rubOut(stroke, x, y, rubber);
      if (!pieces) continue;
      erased.add(stroke.id);
      rubbed.ids.push(stroke.id);
      const node = pad.querySelector(`[data-stroke="${stroke.id}"]`);
      node?.insertAdjacentHTML('afterend', pieces.map(strokeSvg).join(''));
      node?.remove();
      for (const piece of pieces) {
        drawn.push(piece);
        rubbed.added.push(piece.id);
      }
    }
  };

  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pad.setPointerCapture?.(event.pointerId);
    const [x, y] = toFrame(event);
    if (erasing) {
      rubbed = { ids: [], added: [] };
      rub(x, y);
      return;
    }
    current = { id: uid('s'), ink, pen, points: [x, y] };
    pad.insertAdjacentHTML('beforeend', strokeSvg({ ...current, points: current.points.map(Math.round) }));
  });

  pad.addEventListener('pointermove', (event) => {
    if (rubbed) {
      const [x, y] = toFrame(event);
      rub(x, y);
      return;
    }
    if (!current) return;
    const [x, y] = toFrame(event);
    const [lastX, lastY] = current.points.slice(-2);
    // A finger sends far more points than a line needs.
    if (Math.hypot(x - lastX, y - lastY) < 3) return;
    current.points.push(x, y);
    pad.querySelector(`[data-stroke="${current.id}"]`)
      ?.setAttribute('d', strokePath({ points: current.points.map(Math.round) }));
  });

  const finish = () => {
    if (rubbed) {
      if (rubbed.ids.length) history.push({ type: 'erase', ...rubbed });
      rubbed = null;
      return;
    }
    if (!current) return;
    const stroke = cleanStroke({ ...current, points: simplifyPoints(current.points.map(Math.round)) });
    current = null;
    if (!stroke) return;
    drawn.push(stroke);
    history.push({ type: 'draw', id: stroke.id });
    pad.querySelector(`[data-stroke="${stroke.id}"]`)?.setAttribute('d', strokePath(stroke));
  };
  pad.addEventListener('pointerup', finish);
  pad.addEventListener('pointercancel', finish);

  const caption = dialog.querySelector('#sketch-caption');
  const captionBefore = card?.text || '';
  bindCardButtons(dialog, {
    changed: () => history.length > 0 || caption.value.trim() !== captionBefore.trim(),
    leave: (outcome) => {
      finish();
      if (outcome === 'drop') {
        const board = getBoard(boardId);
        if (board) replaceBoard(removeCard(board, cardId));
        return;
      }
      const kept = drawn.filter((stroke) => !erased.has(stroke.id));
      const text = caption.value.trim();
      if (outcome === 'save' && (cardId || kept.length || text)) {
        commitCard(boardId, cardId, 'sketch', (board, id) => {
          let next = addStrokes(board, id, kept);
          next = eraseStrokes(next, id, [...erased]);
          return editCardText(next, id, text);
        });
      }
      render();
    },
  });

  dialog.showModal();
}

/* --------------------------------------------------------- synchronisation --- */

export function getBoard(id) {
  return state.boards.find((board) => board.id === id) || null;
}

export function replaceBoard(next, { redraw = true } = {}) {
  state.boards = state.boards.map((board) => (board.id === next.id ? next : board));
  persistBoard(next);
  if (redraw) render();
}

export function persistBoard(changed) {
  const ok = saveBoards(state.boards);
  if (!ok && !keptElsewhere(changed)) flash(t('home.storageWarning'), 'error');
  if (state.store && changed) void state.store.save(changed);
  if (state.remote && changed?.shared) pushBoard(changed).catch(pushFailed(changed));
  return ok;
}

/**
 * Send a board — after taking in what the database already has. The database
 * keeps whatever it is sent, so a copy written straight away would erase the
 * cards and strokes someone else added since this device last looked.
 */
async function pushBoard(changed) {
  let outgoing = changed;
  try {
    const stored = await state.remote.get(changed.id);
    if (isValidBoard(stored) && adoptBoard(stored)) {
      outgoing = getBoard(changed.id) || changed;
      if (!isBusy()) render();
    }
  } catch {
    // Unreadable just now: this copy goes up, and the next look merges.
  }
  await state.remote.put(outgoing, keyFor(outgoing), organiserSecret(outgoing.id));
}

/** The board the database holds, merged into this one if it brings anything. */
export async function pullBoard(id) {
  if (!state.remote) return false;
  let stored = null;
  try {
    stored = await state.remote.get(id);
  } catch {
    return false;
  }
  return isValidBoard(stored) ? adoptBoard(stored) : false;
}

export function adoptBoard(stored) {
  const local = getBoard(stored.id);
  const merged = local ? mergeBoards(local, stored) : stored;
  if (local && merged === local) return false;

  const adopted = { ...merged, shared: true };
  state.boards = local
    ? state.boards.map((board) => (board.id === stored.id ? adopted : board))
    : [...state.boards, adopted];
  saveBoards(state.boards);
  return true;
}

/** While a shared board is on screen, watch for the others' cards. */
export function watchBoard(id) {
  stopWatching();
  if (!state.remote) return;
  state.poll = setInterval(async () => {
    if (isBusy() || isHidden()) return;
    if (await pullBoard(id)) render();
  }, 5000);
}
