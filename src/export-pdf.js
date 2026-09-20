/**
 * A PDF, written by hand.
 *
 * A PDF is a small set of numbered objects followed by a table saying where
 * each one starts. Text is drawn at coordinates with one of the fonts every
 * reader carries, so nothing has to be embedded and the file stays a few
 * kilobytes.
 *
 * Only what a results sheet needs is implemented: a title, lines of text, and
 * simple rules. Pages break when the bottom is reached.
 */

const PAGE = { width: 595, height: 842, margin: 56 }; // A4, in points

/**
 * The file is written byte per character, not as UTF-8: the standard fonts
 * declare WinAnsi, so an "é" encoded as two UTF-8 bytes would come back out
 * as "Ã©". Everything drawn goes through toLatin1 first, so every character
 * here fits in one byte — which also makes a string's length its byte length,
 * and that is what the cross-reference table needs.
 */
function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Escape what a PDF string literal cannot hold raw. */
function pdfString(value) {
  return String(value ?? '').replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * PDF's standard fonts are Latin-1: anything outside it would be mangled, so
 * the few characters a score sheet is likely to meet are folded to their
 * nearest plain form rather than shown as rubbish.
 */
export function toLatin1(value) {
  const replacements = { '—': '-', '–': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '·': '-', '×': 'x', '♥': 'C', '♦': 'K', '♠': 'P', '♣': 'T' };
  return String(value ?? '')
    .replace(/[—–’‘“”…·×♥♦♠♣]/g, (char) => replacements[char])
    .replace(/[^\x00-\xFF]/g, '?');
}

/** Width of a string in points, close enough to place and wrap text. */
export function textWidth(text, size) {
  return toLatin1(text).length * size * 0.5;
}

export function buildPdf(report) {
  const lines = [];
  let y = PAGE.height - PAGE.margin;
  const pages = [];
  let current = [];

  const breakPage = () => {
    pages.push(current.join('\n'));
    current = [];
    y = PAGE.height - PAGE.margin;
  };

  const write = (text, { size = 11, bold = false, gap = 16 } = {}) => {
    if (y - gap < PAGE.margin) breakPage();
    current.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${PAGE.margin} ${y} Tm (${pdfString(toLatin1(text))}) Tj ET`,
    );
    y -= gap;
  };

  const rule = () => {
    if (y - 8 < PAGE.margin) breakPage();
    current.push(`0.75 w 0.75 0.75 0.75 RG ${PAGE.margin} ${y + 4} m ${PAGE.width - PAGE.margin} ${y + 4} l S`);
    y -= 8;
  };

  /** One row of a table: each column at its own x. */
  const columns = (cells, widths, { bold = false, size = 11, gap = 15 } = {}) => {
    if (y - gap < PAGE.margin) breakPage();
    let x = PAGE.margin;
    cells.forEach((cell, index) => {
      current.push(
        `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(toLatin1(cell))}) Tj ET`,
      );
      x += widths[index];
    });
    y -= gap;
  };

  write(report.title, { size: 20, bold: true, gap: 26 });
  if (report.subtitle) write(report.subtitle, { size: 10, gap: 20 });
  if (report.winner) write(report.winner, { size: 13, bold: true, gap: 24 });

  write(report.standingsTitle, { size: 13, bold: true, gap: 18 });
  rule();
  const usable = PAGE.width - 2 * PAGE.margin;
  const standingWidths = [50, usable - 150, 100];
  columns(report.standingsHeader, standingWidths, { bold: true, size: 10 });
  rule();
  report.standings.forEach((cells) => columns(cells, standingWidths));

  if (report.rounds.length) {
    y -= 14;
    write(report.roundsTitle, { size: 13, bold: true, gap: 18 });
    rule();
    const width = usable / report.roundsHeader.length;
    const roundWidths = report.roundsHeader.map(() => width);
    columns(report.roundsHeader, roundWidths, { bold: true, size: 10 });
    rule();
    report.rounds.forEach((cells) => columns(cells, roundWidths, { size: 10 }));
  }

  pages.push(current.join('\n'));

  // --- assemble the objects
  const objects = [];
  const pageCount = pages.length;
  const pageIds = pages.map((_, index) => 4 + index * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Font << /F1 100 0 R /F2 101 0 R >> >>';
  pages.forEach((content, index) => {
    const id = pageIds[index];
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources 3 0 R /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[100] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[101] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  const used = objects.map((value, index) => (value === undefined ? null : index)).filter((index) => index !== null);
  const maxId = Math.max(...used);

  let body = '%PDF-1.4\n';
  const offsets = {};
  for (const id of used) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefAt = body.length;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += offsets[id] === undefined
      ? '0000000000 65535 f \n'
      : `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1Bytes(body + xref + trailer);
}

