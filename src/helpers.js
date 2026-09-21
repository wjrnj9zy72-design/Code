/**
 * Card counters.
 *
 * Several games ask you to add up the cards in front of you at the end of a
 * round — exactly the sum a phone should be doing. A preset can therefore
 * carry a `helper` spec, and the round form offers a counter built from it:
 *
 *   mode     'count'  the same value can be tapped several times (Skyjo)
 *            'toggle' each value exists once and is picked or not (Papayoo)
 *   values   the tappable values, in the order they are shown
 *   labels   optional display text for a value, keyed by value
 *   toggles  extra switches, each adding a fixed amount (the queen of spades)
 *            or multiplying the total (Skyjo's doubling penalty)
 *
 * An entry is what someone has tapped: { cards: [value, …], toggles: {} }.
 * Nothing here touches the DOM, so the arithmetic can be tested on its own.
 */

export function emptyHelperEntry() {
  return { cards: [], toggles: {} };
}

/** Tap a value: 'toggle' mode picks or unpicks it, 'count' mode adds one more. */
export function tapCard(helper, entry, value) {
  if (helper.mode === 'toggle') {
    const cards = entry.cards.includes(value)
      ? entry.cards.filter((card) => card !== value)
      : [...entry.cards, value];
    return { ...entry, cards };
  }
  return { ...entry, cards: [...entry.cards, value] };
}

/** Undo the last tap — the way a mis-tap is actually corrected. */
export function undoCard(entry) {
  return { ...entry, cards: entry.cards.slice(0, -1) };
}

export function toggleSwitch(entry, key) {
  return { ...entry, toggles: { ...entry.toggles, [key]: !entry.toggles[key] } };
}

/** How many times a value has been tapped. */
export function cardCount(entry, value) {
  return entry.cards.filter((card) => card === value).length;
}

/**
 * The score an entry adds up to: the cards, plus every switch that adds,
 * then multiplied by every switch that multiplies.
 */
export function helperTotal(helper, entry) {
  let total = entry.cards.reduce((sum, value) => sum + value, 0);

  for (const item of helper.toggles || []) {
    if (entry.toggles?.[item.key] && Number.isFinite(item.add)) total += item.add;
  }
  for (const item of helper.toggles || []) {
    if (entry.toggles?.[item.key] && Number.isFinite(item.multiply)) total *= item.multiply;
  }
  return total;
}

/** True when nothing has been tapped at all — used to keep "Apply" honest. */
export function isEmptyEntry(entry) {
  return entry.cards.length === 0 && !Object.values(entry.toggles || {}).some(Boolean);
}

/**
 * Whether a page is running inside an app's own browser — Messenger, Instagram,
 * Facebook, and their like — rather than in a real one.
 *
 * It matters here for one reason: those browsers keep their own files and their
 * own storage. A group joined inside Messenger's browser is joined *there*, and
 * Safari next door knows nothing about it — the person then believes they were
 * let in and finds nothing. Worse, they cannot add an app to the home screen
 * from there at all, so the only way forward is Safari anyway.
 *
 * This is user-agent sniffing, which is a heuristic and nothing more: it names
 * the common ones, and a browser it does not know is taken for a real one. The
 * cost of a wrong guess is one line of advice too many, which is why it only
 * ever advises.
 */
const IN_APP_BROWSERS = [
  // Order matters, and twice over. Messenger announces itself inside Facebook's
  // own marker — "FBAN/MessengerForiOS" — so it is looked for first, or everyone
  // reading in Messenger would be told about Facebook. And "MicroMessenger" is
  // WeChat, which contains the word Messenger.
  ['MessengerForiOS', 'Messenger'],
  ['MESSENGER', 'Messenger'],
  ['MicroMessenger', 'WeChat'],
  ['FBAN', 'Facebook'],
  ['FBAV', 'Facebook'],
  ['FB_IAB', 'Facebook'],
  ['Messenger', 'Messenger'],
  ['Instagram', 'Instagram'],
  ['LinkedInApp', 'LinkedIn'],
  ['Twitter', 'X'],
  ['Line/', 'LINE'],
  ['Snapchat', 'Snapchat'],
  ['TikTok', 'TikTok'],
  ['BytedanceWebview', 'TikTok'],
  ['Pinterest', 'Pinterest'],
  ['WhatsApp', 'WhatsApp'],
];

/** The name of the app whose browser this is, or null for a real browser. */
export function inAppBrowser(userAgent) {
  const text = String(userAgent || '');
  if (!text) return null;
  for (const [needle, name] of IN_APP_BROWSERS) {
    if (text.includes(needle)) return name;
  }
  return null;
}
