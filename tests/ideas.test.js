import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBoard, addCard, editCardText, addStrokes, eraseStrokes, removeCard, archiveBoard,
  cleanStroke, simplifyPoints, strokeNear, strokePath, cardsInOrder, mergeBoards, isValidBoard,
  boardSize, pointsOf, SKETCH_WIDTH, SKETCH_HEIGHT,
} from '../src/ideas.js';

const stroke = (id, points, extra = {}) => ({ id, ink: 'ink', pen: 4, points, ...extra });

test('a board is a title and cards', () => {
  const board = createBoard({ name: '  Corse  ' });
  assert.equal(board.name, 'Corse');
  assert.equal(board.kind, 'board');
  assert.ok(board.id.startsWith('b_'));
  assert.deepEqual(board.cards, []);
  assert.equal(board.shared, false, 'nothing leaves the device unasked');
  assert.ok(isValidBoard(board));
});

test('a note and a sketch are both cards, and the page is told which was added', () => {
  const { board, cardId } = addCard(createBoard(), 'note', '  Bateau à Bonifacio  ');
  const note = board.cards.find((card) => card.id === cardId);
  assert.equal(note.type, 'note');
  assert.equal(note.text, 'Bateau à Bonifacio');
  const second = addCard(board, 'sketch');
  assert.equal(second.board.cards.length, 2);
  assert.equal(second.board.cards[1].type, 'sketch');
  assert.equal(addCard(createBoard(), 'anything').board.cards[0].type, 'note', 'an unknown type is a note');
});

test('editing a note moves its text clock, and nothing when the text is the same', () => {
  const { board, cardId } = addCard(createBoard(), 'note', 'Plage');
  const edited = editCardText(board, cardId, 'Plage de Palombaggia');
  assert.equal(edited.cards[0].text, 'Plage de Palombaggia');
  assert.ok(edited.cards[0].textAt > board.cards[0].textAt);
  assert.equal(editCardText(edited, cardId, ' Plage de Palombaggia '), edited, 'no change, no new stamp');
});

test('a stroke is kept as whole numbers inside the frame, whatever came in', () => {
  const clean = cleanStroke({ id: 's_1', ink: 'purple', pen: 7, points: [-5, 10.4, 2000, 900, 'x', 3, 50] });
  assert.equal(clean.points, `0 10 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`, 'kept as text: the database weighs numbers double');
  assert.deepEqual(pointsOf(clean), [0, 10, SKETCH_WIDTH, SKETCH_HEIGHT]);
  assert.equal(cleanStroke(clean).points, clean.points, 'cleaning what is kept changes nothing');
  assert.equal(clean.ink, 'ink', 'an unknown ink falls back to the theme ink');
  assert.equal(clean.pen, 4, 'an unknown pen falls back to the thinnest');
  assert.equal(cleanStroke({ points: [] }), null);
  assert.equal(cleanStroke(null), null);
});

test('strokes are added and rubbed out, and the rubbing out is remembered', () => {
  const { board, cardId } = addCard(createBoard(), 'sketch');
  const drawn = addStrokes(board, cardId, [stroke('s_a', [0, 0, 10, 10]), stroke('s_b', [5, 5])]);
  assert.equal(drawn.cards[0].strokes.length, 2);
  const erased = eraseStrokes(drawn, cardId, ['s_a']);
  assert.deepEqual(erased.cards[0].strokes.map((s) => s.id), ['s_b']);
  assert.ok(erased.removed.s_a, 'a trace, so the other phone cannot bring it back');
  assert.equal(eraseStrokes(erased, cardId, ['nothing']), erased);
});

test('removing a card leaves a trace', () => {
  const { board, cardId } = addCard(createBoard(), 'note', 'x');
  const gone = removeCard(board, cardId);
  assert.equal(gone.cards.length, 0);
  assert.ok(gone.removed[cardId]);
  assert.equal(removeCard(gone, cardId), gone);
});

test('two phones drawing on the same sketch keep both drawings', () => {
  const { board, cardId } = addCard(createBoard(), 'sketch');
  const mine = addStrokes(board, cardId, [stroke('s_mine', [1, 1, 2, 2])]);
  const theirs = addStrokes(board, cardId, [stroke('s_theirs', [3, 3, 4, 4])]);
  const merged = mergeBoards(mine, theirs);
  assert.deepEqual(merged.cards[0].strokes.map((s) => s.id).sort(), ['s_mine', 's_theirs']);
  assert.deepEqual(mergeBoards(theirs, mine).cards[0].strokes.map((s) => s.id).sort(), ['s_mine', 's_theirs']);
});

test('a stroke rubbed out on one phone stays out when the other still has it', () => {
  const { board, cardId } = addCard(createBoard(), 'sketch');
  const both = addStrokes(board, cardId, [stroke('s_a', [1, 1]), stroke('s_b', [2, 2])]);
  const erased = eraseStrokes(both, cardId, ['s_a']);
  assert.deepEqual(mergeBoards(both, erased).cards[0].strokes.map((s) => s.id), ['s_b']);
  assert.deepEqual(mergeBoards(erased, both).cards[0].strokes.map((s) => s.id), ['s_b']);
});

test('a note written on one phone and a stroke on another: both survive', () => {
  const { board, cardId } = addCard(createBoard(), 'sketch');
  const captioned = editCardText(board, cardId, 'La maison');
  const drawn = addStrokes(board, cardId, [stroke('s_a', [1, 1])]);
  // Drawn last: its card is newer, but its text is not.
  drawn.cards[0].updatedAt = captioned.cards[0].updatedAt + 10;
  drawn.updatedAt = captioned.updatedAt + 10;
  const merged = mergeBoards(captioned, drawn);
  assert.equal(merged.cards[0].text, 'La maison');
  assert.equal(merged.cards[0].strokes.length, 1);
});

test('cards added on two phones are both there, and one deleted anywhere stays deleted', () => {
  const base = createBoard();
  const a = addCard(base, 'note', 'Kayak');
  const b = addCard(base, 'note', 'Randonnée');
  const merged = mergeBoards(a.board, b.board);
  assert.deepEqual(merged.cards.map((card) => card.text).sort(), ['Kayak', 'Randonnée']);
  const dropped = removeCard(merged, a.cardId);
  assert.deepEqual(mergeBoards(dropped, a.board).cards.map((card) => card.text), ['Randonnée']);
});

test('merging with nothing new hands back the same object', () => {
  const { board, cardId } = addCard(createBoard(), 'sketch');
  const drawn = addStrokes(board, cardId, [stroke('s_a', [1, 1])]);
  assert.equal(mergeBoards(drawn, structuredClone(drawn)), drawn);
  assert.equal(mergeBoards(drawn, board), drawn, 'an older copy with nothing of its own changes nothing');
  assert.notEqual(mergeBoards(board, drawn), board);
});

test('a board from elsewhere is checked before it is used', () => {
  assert.equal(isValidBoard({ kind: 'list', id: 'x', cards: [] }), false);
  assert.equal(isValidBoard({ kind: 'board', id: 'x', cards: [{ id: 'c', text: 1, strokes: [] }] }), false);
  assert.equal(isValidBoard({ kind: 'board', id: 'x', cards: [{ id: 'c', text: '', strokes: [{ id: 's' }] }] }), false);
  assert.equal(mergeBoards(null, createBoard()).kind, 'board');
});

test('a straight line drawn with a hundred points keeps two', () => {
  const points = [];
  for (let i = 0; i <= 100; i += 1) points.push(i * 5, 100);
  assert.deepEqual(simplifyPoints(points), [0, 100, 500, 100]);
  const corner = [0, 0, 50, 0, 100, 0, 100, 50, 100, 100];
  assert.deepEqual(simplifyPoints(corner), [0, 0, 100, 0, 100, 100], 'a corner is kept');
  assert.deepEqual(simplifyPoints([3, 4]), [3, 4]);
});

test('the eraser finds a stroke it passes over, and not one it misses', () => {
  const line = stroke('s', [0, 0, 100, 0]);
  assert.equal(strokeNear(line, 50, 10), true);
  assert.equal(strokeNear(line, 50, 60), false);
  assert.equal(strokeNear(stroke('d', [10, 10]), 15, 15), true, 'a dot can be rubbed out');
});

test('a stroke is drawn as a path, a single point as a dot', () => {
  assert.equal(strokePath(stroke('s', [0, 0, 10, 20])), 'M0 0L10 20');
  assert.equal(strokePath(stroke('d', [5, 5])), 'M5 5h0');
});

test('cards show newest first; a board says what it weighs', () => {
  let board = createBoard();
  board = addCard(board, 'note', 'first').board;
  board.cards[0].createdAt -= 1000;
  board = addCard(board, 'note', 'second').board;
  assert.deepEqual(cardsInOrder(board).map((card) => card.text), ['second', 'first']);
  assert.ok(boardSize(board) > 100);
});

test('archiving a board puts it away without deleting it', () => {
  const board = createBoard();
  const away = archiveBoard(board);
  assert.ok(away.archivedAt);
  assert.equal(archiveBoard(away, true), away);
  assert.equal(archiveBoard(away, false).archivedAt, null);
});
