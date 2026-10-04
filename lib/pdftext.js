// Reads a PDF in VISUAL order (top to bottom, left to right), not in the order the producer stored the text.
// Many resume PDFs store right-aligned dates, names or contact blocks as separate objects at the start or end of
// the file, so the default extraction scatters them. Here every text piece is placed by its position on the page,
// pieces on the same row are joined, and two-column pages are read one column after the other.
const pdfParse = require('pdf-parse');
const { cleanPdfText } = require('./text');

// items: [{ s, x, y, w, h }] in PDF coordinates (y grows upwards). Returns the page text.
function layoutText(items, pageWidth) {
  const pieces = items.filter((i) => i.s && i.s.trim());
  if (!pieces.length) return '';
  const cols = splitColumns(pieces, pageWidth);
  if (!cols) return rowsToText(pieces);
  return [rowsToText(cols.top), rowsToText(cols.left), rowsToText(cols.right), rowsToText(cols.bottom)].filter(Boolean).join('\n');
}

// A real gutter: a vertical strip no text crosses (apart from a few full-width header/footer rows).
function splitColumns(pieces, W) {
  if (!W || pieces.length < 20) return null;
  const narrow = pieces.filter((i) => i.w < W * 0.45).sort((a, b) => a.x - b.x);
  // free gaps between the x-extents of the narrow pieces, only near the middle of the page
  const gaps = [];
  let reach = -Infinity;
  for (const p of narrow) {
    if (p.x > reach && reach > -Infinity) gaps.push([reach, p.x]);
    reach = Math.max(reach, p.x + p.w);
  }
  const mid = gaps.filter(([a, b]) => b - a >= W * 0.03 && (a + b) / 2 > W * 0.25 && (a + b) / 2 < W * 0.75).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!mid) return null;
  const g = (mid[0] + mid[1]) / 2;
  const crossing = pieces.filter((i) => i.x < g && i.x + i.w > g);
  if (crossing.length > Math.max(3, pieces.length * 0.04)) return null; // lots of text crosses the middle: single column
  const side = pieces.filter((i) => !crossing.includes(i));
  const left = side.filter((i) => i.x + i.w / 2 < g);
  const right = side.filter((i) => i.x + i.w / 2 >= g);
  if (left.length < 8 || right.length < 8) return null;
  const colTop = Math.max(...side.map((i) => i.y)), colBottom = Math.min(...side.map((i) => i.y));
  const top = crossing.filter((i) => i.y > colTop);
  const bottom = crossing.filter((i) => i.y < colBottom);
  const inside = crossing.filter((i) => i.y <= colTop && i.y >= colBottom);
  return { top, left: left.concat(inside), right, bottom };
}

function rowsToText(pieces) {
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const p of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - p.y) <= Math.max(2, 0.45 * Math.min(last.h, p.h))) last.items.push(p);
    else rows.push({ y: p.y, h: p.h, items: [p] });
  }
  return rows.map((r) => joinRow(r.items)).filter((l) => l.trim()).join('\n');
}

function joinRow(items) {
  let out = '';
  let prev = null;
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const size = Math.max(prev.h, it.h, 6);
      if (gap > size * 2.5) out += '   ';
      else if (gap > size * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.s)) out += ' ';
    }
    out += it.s;
    prev = it;
  }
  return out.replace(/\s+$/, '');
}

// pdf-parse page renderer: positions every text piece instead of trusting the stored order
async function pageRender(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const items = content.items.map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 10 }));
  const W = pageData.view ? pageData.view[2] - pageData.view[0] : 0;
  return layoutText(items, W);
}

async function extractPdfText(buffer) {
  const data = await pdfParse(buffer, { pagerender: pageRender });
  return cleanPdfText(data.text);
}

module.exports = { extractPdfText, layoutText };
