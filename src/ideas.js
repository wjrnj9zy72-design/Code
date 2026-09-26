/**
 * Ideas: a board of cards, before anything is decided.
 *
 * A board — "Holidays in Corsica", "Léa's present" — holds cards. A card is a
 * note (a title's worth of text, or a paragraph) or a sketch drawn with a
 * finger. Cards and not one big page, because two people writing in the same
 * page at the same moment would lose one of the two; two cards never collide.
 *
 * A sketch is kept as strokes, not as a picture: each stroke is a colour, a
 * width and a row of points in a fixed 1000 × 750 frame. That is small enough
 * for the shared database, draws the same on every screen, and merges stroke
 * by stroke — two people drawing on the same sketch keep both drawings.
 *
 * Pure, like the lists: every mutator returns a new board.
 */

import { uid } from './model.js';
import { later, touch, prune } from './stamp.js';

/** The frame every sketch is drawn in, whatever the screen. */
export const SKETCH_WIDTH = 1000;
export const SKETCH_HEIGHT = 750;

/** The inks a stroke can take. 'ink' follows the theme: dark on light, light on dark. */
export const INKS = ['ink', 'red', 'blue', 'green', 'orange'];
/** The pen sizes, in frame units. */
export const PENS = [4, 10, 24];

/** How far the eraser reaches, in the frame's units: fine, medium, broad. */
export const ERASERS = [8, 20, 45];

/**
 * How much a board may weigh, as JSON. The database refuses a document past
 * 200 000 bytes; this leaves room, so a board that is nearly full says so
 * before a write fails.
 */
export const BOARD_LIMIT = 150000;

/** A new board. */
export function createBoard({ name = '', shared = false, groupId = null } = {}) {
  const now = Date.now();
  return {
    id: uid('b'),
    kind: 'board',
    name: String(name).trim(),
    createdAt: now,
    updatedAt: now,
    shared: Boolean(shared),
    groupId: groupId || null,
    archivedAt: null,
    // Cards and strokes deleted here, and when: without it, a deletion is
    // undone by the next copy that still holds what was deleted.
    removed: {},
    cards: [],
  };
}

/** Add a card — a note or a sketch — and say which, so the page can open it. */
export function addCard(board, type = 'note', text = '') {
  const now = Date.now();
  const card = {
    id: uid('c'),
    type: type === 'sketch' ? 'sketch' : 'note',
    text: String(text || '').trim(),
    textAt: now,
    strokes: [],
    createdAt: now,
    updatedAt: now,
  };
  return { board: touch(board, { cards: [...board.cards, card] }), cardId: card.id };
}

function patchCard(board, cardId, change) {
  let changed = false;
  const cards = board.cards.map((card) => {
    if (card.id !== cardId) return card;
    const next = change(card);
    if (next === card) return card;
    changed = true;
    return { ...next, updatedAt: later(card.updatedAt) };
  });
  return changed ? touch(board, { cards }) : board;
}

/** What a card says: the note's text, or a sketch's caption. */
export function editCardText(board, cardId, text) {
  const clean = String(text || '').trim();
  return patchCard(board, cardId, (card) =>
    card.text === clean ? card : { ...card, text: clean, textAt: later(card.textAt) },
  );
}

/**
 * Add strokes to a sketch. Each keeps its own identity, so strokes drawn on two
 * phones at once are both there after the merge.
 */
export function addStrokes(board, cardId, strokes) {
  const fresh = (strokes || []).map(cleanStroke).filter(Boolean);
  if (!fresh.length) return board;
  return patchCard(board, cardId, (card) => ({ ...card, strokes: [...card.strokes, ...fresh] }));
}

/** Rub strokes out, and remember having done so. */
export function eraseStrokes(board, cardId, strokeIds) {
  const gone = new Set(strokeIds || []);
  const card = board.cards.find((entry) => entry.id === cardId);
  if (!card || !card.strokes.some((stroke) => gone.has(stroke.id))) return board;
  const now = Date.now();
  const removed = { ...board.removed };
  for (const id of gone) removed[id] = now;
  const next = patchCard(board, cardId, (current) => ({
    ...current,
    strokes: current.strokes.filter((stroke) => !gone.has(stroke.id)),
  }));
  return { ...next, removed };
}

/** Drop a card, and remember having dropped it. */
export function removeCard(board, cardId) {
  const cards = board.cards.filter((card) => card.id !== cardId);
  if (cards.length === board.cards.length) return board;
  return touch(board, { cards, removed: { ...board.removed, [cardId]: Date.now() } });
}

/** Put a board away, or bring it back. Nothing is deleted. */
export function archiveBoard(board, yes = true) {
  const at = yes ? Date.now() : null;
  return at === (board.archivedAt || null) ? board : touch(board, { archivedAt: at });
}

/**
 * A stroke's points as numbers, `[x0, y0, x1, y1, …]`, whether it is kept (as
 * text) or still being drawn (as numbers).
 */
export function pointsOf(stroke) {
  const { points } = stroke || {};
  if (Array.isArray(points)) return points;
  return typeof points === 'string' && points.trim() ? points.trim().split(/\s+/).map(Number) : [];
}

/**
 * A stroke as it is kept: an id, an ink, a pen, and the points as whole
 * numbers inside the frame, written as text — `"x0 y0 x1 y1 …"`. Text and not
 * an array of numbers: the database weighs a document in its own format, where
 * each number of an array costs about twice what it does written out, and a
 * sketch is almost nothing but numbers. Anything else is dropped rather than
 * stored.
 */
export function cleanStroke(stroke) {
  if (!stroke) return null;
  const raw = pointsOf(stroke);
  const points = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const x = Number(raw[index]);
    const y = Number(raw[index + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push(
      Math.round(Math.min(SKETCH_WIDTH, Math.max(0, x))),
      Math.round(Math.min(SKETCH_HEIGHT, Math.max(0, y))),
    );
  }
  if (!points.length) return null;
  return {
    id: typeof stroke.id === 'string' && stroke.id ? stroke.id : uid('s'),
    ink: INKS.includes(stroke.ink) ? stroke.ink : 'ink',
    pen: PENS.includes(stroke.pen) ? stroke.pen : PENS[0],
    points: points.join(' '),
  };
}

/**
 * Fewer points for the same line (Ramer–Douglas–Peucker). A finger sends a
 * point every few milliseconds; most of them add nothing a reader could see,
 * and every one of them would travel to the database and back.
 */
export function simplifyPoints(points, tolerance = 2) {
  const count = Math.floor((points?.length || 0) / 2);
  if (count <= 2) return (points || []).slice(0, count * 2);
  const keep = new Array(count).fill(false);
  keep[0] = true;
  keep[count - 1] = true;
  const stack = [[0, count - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const d = segmentDistance(
        points[index * 2], points[index * 2 + 1],
        points[first * 2], points[first * 2 + 1],
        points[last * 2], points[last * 2 + 1],
      );
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const kept = [];
  for (let index = 0; index < count; index += 1) {
    if (keep[index]) kept.push(points[index * 2], points[index * 2 + 1]);
  }
  return kept;
}

/** How far a point is from a segment. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
}

/** Whether a stroke passes within `reach` of a point — what the eraser touches. */
export function strokeNear(stroke, x, y, reach = 16) {
  const points = pointsOf(stroke);
  const margin = reach + (stroke.pen || 0) / 2;
  if (points.length === 2) return Math.hypot(points[0] - x, points[1] - y) <= margin;
  for (let index = 0; index + 3 < points.length; index += 2) {
    if (segmentDistance(x, y, points[index], points[index + 1], points[index + 2], points[index + 3]) <= margin) {
      return true;
    }
  }
  return false;
}

/**
 * Rub out only the part of a stroke under the eraser: what is left on either
 * side becomes strokes of their own, with new ids — the old one is erased and
 * the pieces added, which is how any two copies of a board already merge.
 * Null when the eraser does not touch the stroke.
 */
export function rubOut(stroke, x, y, reach = ERASERS[0]) {
  const points = pointsOf(stroke);
  if (!points.length) return null;
  const margin = reach + (stroke.pen || 0) / 2;
  // The kept points can be far apart along a straight line: fill in, so the
  // eraser cuts where it is and not at the nearest corner.
  const step = Math.max(2, reach / 3);
  const dense = [points[0], points[1]];
  for (let index = 2; index + 1 < points.length; index += 2) {
    const [ax, ay, bx, by] = [points[index - 2], points[index - 1], points[index], points[index + 1]];
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let part = 1; part <= parts; part += 1) {
      dense.push(ax + ((bx - ax) * part) / parts, ay + ((by - ay) * part) / parts);
    }
  }
  const pieces = [];
  let run = [];
  let touched = false;
  for (let index = 0; index + 1 < dense.length; index += 2) {
    if (Math.hypot(dense[index] - x, dense[index + 1] - y) <= margin) {
      touched = true;
      if (run.length) pieces.push(run);
      run = [];
    } else {
      run.push(dense[index], dense[index + 1]);
    }
  }
  if (!touched) return null;
  if (run.length) pieces.push(run);
  return pieces
    .map((piece) => cleanStroke({ id: uid('s'), ink: stroke.ink, pen: stroke.pen, points: simplifyPoints(piece.map(Math.round)) }))
    .filter(Boolean);
}

/** The SVG path of a stroke: a dot for a single point, a line otherwise. */
export function strokePath(stroke) {
  const points = pointsOf(stroke);
  if (points.length === 2) return `M${points[0]} ${points[1]}h0`;
  let path = `M${points[0]} ${points[1]}`;
  for (let index = 2; index + 1 < points.length; index += 2) path += `L${points[index]} ${points[index + 1]}`;
  return path;
}

/** How much the board weighs as it travels. */
export function boardSize(board) {
  return JSON.stringify(board).length;
}

/** The cards, newest first — what was just added is what one looks for. */
export function cardsInOrder(board) {
  return [...board.cards].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (a.id < b.id ? -1 : 1));
}

/**
 * Merge two copies of the same board — this browser's and the database's.
 *
 * Card by card. A card's text follows whichever copy changed it last (its own
 * clock, `textAt`, so that a stroke drawn meanwhile does not count as a change
 * of text); its strokes are the union of both sides, less those rubbed out on
 * either. A card or a stroke deleted anywhere stays deleted.
 */
export function mergeBoards(a, b) {
  if (!isValidBoard(a)) return b;
  if (!isValidBoard(b)) return a;
  if (a.id !== b.id) return a;

  const [newer, older] = (a.updatedAt || 0) >= (b.updatedAt || 0) ? [a, b] : [b, a];
  const removed = prune({ ...older.removed, ...newer.removed });

  const byId = new Map();
  for (const card of [...older.cards, ...newer.cards]) {
    if (removed[card.id]) continue;
    const held = byId.get(card.id);
    byId.set(card.id, held ? mergeCards(held, card, removed) : liveStrokes(card, removed));
  }
  const cards = [...byId.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || (x.id < y.id ? -1 : 1));

  const merged = { ...newer, removed, cards, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0) };
  // Nothing new on either side: hand back the very same object, which is how
  // the page knows there is nothing to redraw.
  const sameAs = (board) =>
    JSON.stringify(board.cards) === JSON.stringify(merged.cards) &&
    Object.keys(board.removed || {}).length === Object.keys(removed).length &&
    (board.updatedAt || 0) === merged.updatedAt;
  if (sameAs(newer)) return newer;
  return merged;
}

function liveStrokes(card, removed) {
  return card.strokes.some((stroke) => removed[stroke.id])
    ? { ...card, strokes: card.strokes.filter((stroke) => !removed[stroke.id]) }
    : card;
}

/** `second` is the newer board's copy: it wins what cannot be told apart. */
function mergeCards(first, second, removed) {
  const text = (first.textAt || 0) > (second.textAt || 0) ? first : second;
  const seen = new Set();
  const strokes = [];
  for (const stroke of [...first.strokes, ...second.strokes]) {
    if (seen.has(stroke.id) || removed[stroke.id]) continue;
    seen.add(stroke.id);
    strokes.push(stroke);
  }
  return {
    ...second,
    text: text.text,
    textAt: Math.max(first.textAt || 0, second.textAt || 0),
    strokes,
    updatedAt: Math.max(first.updatedAt || 0, second.updatedAt || 0),
  };
}

/** Defensive read of anything coming back from storage, a link, or a file. */
export function isValidBoard(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.kind === 'board' &&
      typeof value.id === 'string' &&
      Array.isArray(value.cards) &&
      value.cards.every(
        (card) =>
          card &&
          typeof card.id === 'string' &&
          typeof card.text === 'string' &&
          Array.isArray(card.strokes) &&
          card.strokes.every((stroke) => stroke && typeof stroke.id === 'string' && typeof stroke.points === 'string'),
      ),
  );
}
