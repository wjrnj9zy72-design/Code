/**
 * Slide left to delete — the gesture a phone's own lists taught everyone.
 *
 * A card or a line slides left to uncover a red « Supprimer » behind it.
 * Sliding only uncovers the button; it takes a tap on it to delete, so a swipe
 * meant as a scroll deletes nothing. The same everywhere something can be
 * deleted from a list of things: documents in their tab, the lines of a list,
 * an account's expenses, the cards of a board.
 */

import { escapeHtml, view } from './app.js';
import { t } from './i18n.js';

/** How far a row slides to uncover its button, in pixels. */
const SWIPE_OPEN = 96;

/**
 * A row that slides. `kind` says which binder handles it; `tag` and `bodyClass`
 * let a line of a list stay an `<li>` holding the line itself.
 */
export function swipeHtml(id, inner, { kind, tag = 'div', bodyClass = '' } = {}) {
  return `
    <${tag} class="swipe" data-swipe="${escapeHtml(id)}" data-swipe-kind="${escapeHtml(kind)}">
      <button type="button" class="swipe__delete" data-swipe-delete tabindex="-1" aria-hidden="true">
        ${escapeHtml(t('action.delete'))}
      </button>
      <div class="swipe__body ${bodyClass}">${inner}</div>
    </${tag}>`;
}

/**
 * A card function made slideable, for the documents in their tab. `canDelete`
 * leaves a card as it was where deleting is not this device's to do — a poll
 * someone else organises.
 */
export function swipeable(cardHtml, canDelete = () => true) {
  return (document_) =>
    canDelete(document_) ? swipeHtml(document_.id, cardHtml(document_), { kind: 'doc' }) : cardHtml(document_);
}

/** Make every row of that kind on the page slide, and delete through `onDelete(id)`. */
export function bindSwipes(kind, onDelete) {
  view.querySelectorAll(`[data-swipe-kind="${kind}"]`).forEach((row) => {
    const body = row.querySelector('.swipe__body');
    const button = row.querySelector('[data-swipe-delete]');
    let start = null;
    let offset = 0;
    let moved = false;
    let open = false;

    const place = (x, animate) => {
      offset = x;
      body.style.transition = animate ? 'transform 0.18s ease' : 'none';
      body.style.transform = x ? `translateX(${x}px)` : '';
    };
    const settle = (wanted) => {
      open = wanted;
      place(open ? -SWIPE_OPEN : 0, true);
      row.classList.toggle('swipe--open', open);
      button.tabIndex = open ? 0 : -1;
      button.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    body.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, from: open ? -SWIPE_OPEN : 0 };
      moved = false;
    });
    body.addEventListener('pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved) {
        if (Math.abs(dx) < 8) return;
        // Mostly up or down: a scroll, not a swipe.
        if (Math.abs(dy) > Math.abs(dx)) {
          start = null;
          return;
        }
        moved = true;
        body.setPointerCapture?.(event.pointerId);
      }
      place(Math.min(0, Math.max(-row.clientWidth * 0.6, start.from + dx)), false);
    });
    const end = () => {
      if (!start) return;
      start = null;
      if (moved) settle(offset < -SWIPE_OPEN / 2);
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    // The click that ends a swipe is not a tap on what slid; nor is a tap on a
    // row left open, which only closes it again.
    body.addEventListener('click', (event) => {
      if (!moved && !open) return;
      event.preventDefault();
      event.stopPropagation();
      if (!moved) settle(false);
      moved = false;
    }, true);

    button.addEventListener('click', () => onDelete(row.dataset.swipe));
  });
}
