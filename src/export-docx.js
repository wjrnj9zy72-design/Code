/**
 * A Word document, written by hand.
 *
 * A .docx is a ZIP holding a few XML parts. The app carries no dependencies,
 * so both the ZIP and the XML are produced here — the ZIP with stored (that
 * is, uncompressed) entries, which a reader accepts just as well and which
 * needs no deflate implementation.
 *
 * Everything is bytes in, bytes out: no DOM, so it can be checked outside a
 * browser by opening the result with a real Word reader.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

/** Build a ZIP from { name, text } entries, stored without compression. */
export function zip(entries) {
  const files = entries.map(({ name, text }) => ({
    name: encoder.encode(name),
    data: encoder.encode(text),
  }));

  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const sum = crc32(file.data);
    const header = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0x21), // a fixed date: the document's content is what matters
      ...u32(sum), ...u32(file.data.length), ...u32(file.data.length),
      ...u16(file.name.length), ...u16(0),
    ];
    chunks.push(Uint8Array.from(header), file.name, file.data);

    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(sum), ...u32(file.data.length), ...u32(file.data.length),
      ...u16(file.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]);
    offset += header.length + file.name.length + file.data.length;
  }

  const directory = [];
  let directorySize = 0;
  central.forEach((entry, index) => {
    directory.push(Uint8Array.from(entry), files[index].name);
    directorySize += entry.length + files[index].name.length;
  });

  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(directorySize), ...u32(offset), ...u16(0),
  ];

  const parts = [...chunks, ...directory, Uint8Array.from(end)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]),
  );
}

const paragraph = (text, { bold = false, size = 22, spacing = 120 } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${spacing}"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

const cell = (text, bold) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(text, { bold, spacing: 0 })}</w:tc>`;


const row = (cells, bold) => `<w:tr>${cells.map((value) => cell(value, bold)).join('')}</w:tr>`;

/** A4 minus the margins declared below, in twentieths of a point. */
const USABLE_WIDTH = 9638;

const table = (header, rows) => {
  // w:tblGrid is required: without it a reader rejects the table outright.
  const width = Math.floor(USABLE_WIDTH / Math.max(header.length, 1));
  const grid = `<w:tblGrid>${header.map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;

  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${USABLE_WIDTH}" w:type="dxa"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="BFBFBF"/>`)
      .join('')}</w:tblBorders></w:tblPr>${grid}` +
    row(header, true) +
    rows.map((cells) => row(cells, false)).join('') +
    `</w:tbl>`;
};

/**
 * `report` is what the app knows about the game, already translated:
 * { title, subtitle, winner, standings: [[rank, name, total]],
 *   roundsHeader: [...], rounds: [[...]] }
 */
export function buildDocx(report) {
  const body = [
    paragraph(report.title, { bold: true, size: 36 }),
    report.subtitle ? paragraph(report.subtitle, { size: 20 }) : '',
    report.winner ? paragraph(report.winner, { bold: true, size: 24 }) : '',
    paragraph(report.standingsTitle, { bold: true, size: 26 }),
    table(report.standingsHeader, report.standings),
    paragraph('', { spacing: 200 }),
    report.rounds.length ? paragraph(report.roundsTitle, { bold: true, size: 26 }) : '',
    report.rounds.length ? table(report.roundsHeader, report.rounds) : '',
    paragraph('', { spacing: 0 }),
  ].join('');

  return zip([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/document.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    },
  ]);
}
