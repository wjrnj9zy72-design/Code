/**
 * A QR code, computed here rather than fetched from a service — the app has
 * no dependencies and must work with no network.
 *
 * Only what a link needs is implemented: byte mode, error correction level M,
 * and whichever version (size) fits. That covers URLs up to a few hundred
 * characters, which is every link this app hands out.
 *
 * Returns a square matrix of booleans; drawing it is the caller's business.
 */

/* --- Galois field arithmetic, for the error-correction codewords ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data, count) {
  const poly = generatorPoly(count);
  const result = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < count; i += 1) result[i] ^= mul(poly[i + 1], factor);
  }
  return result;
}

/* --- Per-version parameters, error correction level M --------------------- */

/**
 * [ total codewords, ec codewords per block, blocks in group 1, blocks in group 2 ]
 *
 * Stops at version 6, which holds 106 bytes — more than any link this app
 * hands out. Every one of these was checked module for module against a
 * reference encoder, for all eight masks; the block tables beyond version 6
 * were not, so they are not here. Longer text returns null and the caller
 * shows the plain link.
 */
const VERSIONS = {
  1: [26, 10, 1, 0], 2: [44, 16, 1, 0], 3: [70, 26, 1, 0],
  4: [100, 18, 2, 0], 5: [134, 24, 2, 0], 6: [172, 16, 4, 0],
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
};

/** Data codewords available, total minus error correction. */
function dataCapacity(version) {
  const [total, ecPerBlock, group1, group2] = VERSIONS[version];
  return total - ecPerBlock * (group1 + group2);
}

function chooseVersion(byteLength) {
  for (const version of Object.keys(VERSIONS).map(Number)) {
    // 4 bits of mode, 8 of length (versions 1 to 9), then the data itself.
    if (dataCapacity(version) * 8 >= 4 + 8 + byteLength * 8) return version;
  }
  return null;
}

/** The longest text this encoder will take, in bytes. */
export const MAX_BYTES = (() => {
  let max = 0;
  for (const version of Object.keys(VERSIONS).map(Number)) {
    max = Math.max(max, Math.floor((dataCapacity(version) * 8 - 12) / 8));
  }
  return max;
})();

/* --- Bit assembly --------------------------------------------------------- */

function encodeData(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);

  const capacity = dataCapacity(version) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  const padding = [0xec, 0x11];
  let index = 0;
  while (codewords.length < dataCapacity(version)) {
    codewords.push(padding[index++ % 2]);
  }
  return codewords;
}

/** Split into blocks, add error correction, then interleave as the spec says. */
function finalCodewords(dataCodewords, version) {
  const [, ecPerBlock, group1, group2] = VERSIONS[version];
  const blocks = group1 + group2;
  const shortLength = Math.floor(dataCodewords.length / blocks);

  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (let i = 0; i < blocks; i += 1) {
    const length = i < group1 ? shortLength : shortLength + 1;
    const block = dataCodewords.slice(at, at + length);
    at += length;
    dataBlocks.push(block);
    ecBlocks.push(errorCorrection(block, ecPerBlock));
  }

  const out = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* --- The matrix ----------------------------------------------------------- */

function emptyMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => new Array(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

function placeFinder(matrix, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= matrix.size || x < 0 || x >= matrix.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix.modules[y][x] = inRing || inCore;
      matrix.reserved[y][x] = true;
    }
  }
}

function placePatterns(matrix, version) {
  const size = matrix.size;
  placeFinder(matrix, 0, 0);
  placeFinder(matrix, 0, size - 7);
  placeFinder(matrix, size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    matrix.modules[6][i] = dark;
    matrix.reserved[6][i] = true;
    matrix.modules[i][6] = dark;
    matrix.reserved[i][6] = true;
  }

  for (const row of ALIGNMENT[version]) {
    for (const col of ALIGNMENT[version]) {
      if (matrix.reserved[row][col]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          matrix.modules[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          matrix.reserved[row + r][col + c] = true;
        }
      }
    }
  }

  // The dark module, and the space the format information will occupy.
  matrix.modules[size - 8][8] = true;
  matrix.reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i += 1) {
    if (!matrix.reserved[8][i]) { matrix.modules[8][i] = false; matrix.reserved[8][i] = true; }
    if (!matrix.reserved[i][8]) { matrix.modules[i][8] = false; matrix.reserved[i][8] = true; }
  }
  for (let i = size - 8; i < size; i += 1) {
    if (!matrix.reserved[8][i]) { matrix.modules[8][i] = false; matrix.reserved[8][i] = true; }
    if (!matrix.reserved[i][8]) { matrix.modules[i][8] = false; matrix.reserved[i][8] = true; }
  }
}

function placeData(matrix, codewords) {
  const size = matrix.size;
  const bits = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >> i) & 1);
  }

  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1; // the vertical timing pattern is skipped
    // Which way this pair of columns runs follows from its position, not from
    // a flag: the skipped column would put a toggle out of step.
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (matrix.reserved[row][col]) continue;
        matrix.modules[row][col] = bit < bits.length ? bits[bit] === 1 : false;
        bit += 1;
      }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Format information: error correction level M with the chosen mask. */
function placeFormat(matrix, mask) {
  const data = (0b00 << 3) | mask; // 00 = level M
  let bits = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (bits & (1 << (i + 10))) bits ^= 0b10100110111 << i;
  }
  const format = ((data << 10) | bits) ^ 0b101010000010010;

  const size = matrix.size;
  // The specification names these positions as (x, y); everything here is
  // addressed [row][col], so each one is written the other way round.
  for (let i = 0; i < 15; i += 1) {
    const dark = ((format >> i) & 1) === 1;

    // First copy, wrapped around the top-left finder
    if (i < 6) matrix.modules[i][8] = dark;
    else if (i === 6) matrix.modules[7][8] = dark;
    else if (i === 7) matrix.modules[8][8] = dark;
    else if (i === 8) matrix.modules[8][7] = dark;
    else matrix.modules[8][14 - i] = dark;

    // Second copy, split between the other two finders
    if (i < 8) matrix.modules[8][size - 1 - i] = dark;
    else matrix.modules[size - 15 + i][8] = dark;
  }
}

function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const run = (get) => {
    for (let a = 0; a < size; a += 1) {
      let last = null;
      let length = 0;
      for (let b = 0; b < size; b += 1) {
        const value = get(a, b);
        if (value === last) length += 1;
        else { last = value; length = 1; }
        if (length === 5) score += 3;
        else if (length > 5) score += 1;
      }
    }
  };
  run((r, c) => modules[r][c]);
  run((c, r) => modules[r][c]);

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  let dark = 0;
  for (const row of modules) for (const value of row) if (value) dark += 1;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * The matrix for `text`, or null when it is too long for what is implemented.
 * `mask` forces one of the eight patterns instead of picking the best; it
 * exists so the result can be compared against a reference encoder.
 */
export function qrMatrix(text, { mask: forced = null } = {}) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length);
  if (!version) return null;

  const codewords = finalCodewords(encodeData(bytes, version), version);
  const size = 17 + version * 4;

  let best = null;
  const masks = forced === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forced];
  for (const mask of masks) {
    const matrix = emptyMatrix(size);
    placePatterns(matrix, version);
    placeData(matrix, codewords);
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!matrix.reserved[r][c] && MASKS[mask](r, c)) matrix.modules[r][c] = !matrix.modules[r][c];
      }
    }
    placeFormat(matrix, mask);
    const score = penalty(matrix.modules);
    if (!best || score < best.score) best = { score, modules: matrix.modules };
  }
  return best.modules;
}

/** The matrix as an SVG, with the quiet zone every reader expects. */
export function qrSvg(text, { size = 220, quiet = 4 } = {}) {
  const modules = qrMatrix(text);
  if (!modules) return null;
  const count = modules.length + quiet * 2;
  const rects = [];
  modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" role="img"><rect width="${count}" height="${count}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}
