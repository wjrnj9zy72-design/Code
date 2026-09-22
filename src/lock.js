/**
 * The six-digit code that guards a lot of games, and the sealing of what the
 * lot holds with it.
 *
 * Two different secrets protect a lot, because they answer two different
 * questions:
 *
 *   * the sharing key, held only by whoever runs the database, answers "may
 *     this person create a lot at all". It never leaves the device it was
 *     typed into, and the database refuses to write a lot without it.
 *   * this code, drawn afresh for every share, answers "may this person open
 *     that lot". It is what the receiver types in.
 *
 * Six digits is a million possibilities — far too few to resist a machine
 * trying them one after another, which is why the database counts the
 * attempts and stops at ten. The sealing below adds the other half: the game
 * identifiers are not in the stored lot at all, only their encrypted form, so
 * a row read by some other means still says nothing about which games it
 * designates.
 *
 * Sealing needs Web Crypto, which browsers only offer in a secure context
 * (https, or localhost). Where it is missing the lot is stored as a plain list
 * instead — still behind the key and the code — and the app says so rather
 * than pretending.
 */

const DIGITS = 6;
const ITERATIONS = 310000; // a few tenths of a second on a phone
const VERSION = 1;

/** Can this copy of the app seal a lot? */
export function canSeal() {
  return Boolean(globalThis.crypto?.subtle);
}

/**
 * A six-digit code, uniform over the million. Values above the last whole
 * multiple of a million are thrown away: taking the remainder of everything
 * would make the low codes very slightly likelier.
 */
export function newCode() {
  const range = 10 ** DIGITS;
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  let drawn = limit;
  while (drawn >= limit) {
    globalThis.crypto.getRandomValues(buffer);
    [drawn] = buffer;
  }
  return String(drawn % range).padStart(DIGITS, '0');
}

/** Is this a code, whatever the person typed around it? */
export function isCode(value) {
  return /^[0-9]{6}$/.test(String(value ?? '').trim());
}

/** The digits inside whatever was typed — spaces and dashes are forgiven. */
export function readCode(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits.length === DIGITS ? digits : null;
}

/**
 * What can be pulled out of an invitation pasted whole.
 *
 * The message that travels carries the group's name, the six digits and the
 * link. Asking someone to select exactly "Mifa" and exactly "123456" out of it,
 * on a phone, with two taps of a magnifier, is asking for the paste to fail —
 * so anything pasted into either field is read for both.
 *
 * Returns { name, code }, either of which may be null.
 */
export function readInvite(text) {
  const source = String(text ?? '');

  // The link is the most reliable of the three, because the app wrote it.
  const link = /#\/join\/(\d{6})(?:\/([^\s/?#]+))?/.exec(source);

  const labelled = /(?:^|\n)\s*(?:code)\s*[:：]\s*(\d{6})\b/i.exec(source);
  const bare = /^\s*(\d{6})\s*$/.exec(source);
  const code = link?.[1] || labelled?.[1] || bare?.[1] || null;

  let name = null;
  if (link?.[2]) {
    try {
      name = decodeURIComponent(link[2]).trim() || null;
    } catch {
      name = link[2].trim() || null;
    }
  }
  if (!name) {
    const written = /(?:^|\n)\s*(?:nom|name|groupe|group)\s*[:：]\s*(.+)/i.exec(source);
    name = written ? written[1].trim() || null : null;
  }

  return { name, code };
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) => Uint8Array.from(atob(String(text)), (char) => char.charCodeAt(0));

async function keyFrom(code, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Seal any small value with a code. The salt and the nonce travel with it. */
export async function seal(value, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(code, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return {
    v: VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(sealed)),
  };
}

/**
 * What was sealed, or null — a wrong code and a tampered-with document are
 * both simply "null", because AES-GCM refuses to decrypt either.
 */
export async function unseal(sealed, code) {
  if (!sealed || sealed.v !== VERSION || !canSeal()) return null;
  try {
    const key = await keyFrom(code, fromBase64(sealed.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
      key,
      fromBase64(sealed.data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
