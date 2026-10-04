// Turns plain resume text into a polished, single-column, ATS-friendly DOCX.
// Step 1 (structure) labels every line IN ITS ORIGINAL ORDER (name, contact, heading, job line, bullet...).
// Step 2 (render) styles each labelled line with a template. Nothing is ever moved, merged or dropped.
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType, Tab, LevelFormat,
} = require('docx');

// ---------- Templates ----------
const TEMPLATES = {
  modern:  { label: 'Modern',  font: 'Calibri',         accent: '1F4E79', text: '262626', muted: '595959', nameAlign: 'left',   nameSize: 44, headRule: true,  headColor: 'accent' },
  classic: { label: 'Classic', font: 'Times New Roman', accent: '000000', text: '000000', muted: '404040', nameAlign: 'center', nameSize: 40, headRule: true,  headColor: 'text' },
  minimal: { label: 'Minimal', font: 'Arial',           accent: '333333', text: '222222', muted: '666666', nameAlign: 'left',   nameSize: 36, headRule: false, headColor: 'accent' },
};

// ---------- Line classification ----------
const SECTION_TITLES = /^(summary|professional summary|career summary|profile|about me|objective|career objective|experience|work experience|professional experience|employment|employment history|work history|internships?|education|academic background|skills|technical skills|key skills|core competencies|competencies|technologies|projects|personal projects|academic projects|certifications?|licenses?|achievements|accomplishments|awards|honors|languages|publications|volunteering|volunteer experience|interests|hobbies|activities|extracurricular activities|courses|training|links|references)$/i;
const BULLET = /^\s*[-•*▪●◦■]\s+/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?,?\\s+\\d{4}';
const DATE_PART = `(?:${MONTH}|\\d{1,2}[/.]\\d{4}|(?:19|20)\\d{2})`;
const RANGE = new RegExp(`${DATE_PART}\\s*(?:-|–|—|to)\\s*(?:${DATE_PART}|present|current|now|ongoing)`, 'i');
const LONE_YEAR_END = /^(.*?)[\s,|–—-]+((?:\d{1,2}[/.])?(?:19|20)\d{2})$/;
const ORG_SUFFIX = /\b(ltd|limited|inc|incorporated|corp|co|llc|llp|plc|pvt|gmbh|ag|sa|bv)\.?$/i;
const GRADE = /cgpa|gpa|%|grade|honou?rs?|distinction|first class|percent|rank|thesis|dissertation/i;
const CONTACT_HINT = /@|linkedin|github|https?:|www\.|(\+?\d[\d\s().-]{7,}\d)/i;

const kindOf = (title) => {
  const t = title.toLowerCase();
  if (/skill|competenc|technolog/.test(t)) return 'skills';
  if (/experience|employment|work history|internship|project|volunteer/.test(t)) return 'experience';
  if (/education|academic background|certif|licen|award|honor|publication|achievement/.test(t)) return 'education';
  return 'text';
};

// An ALL-CAPS line that could be a heading (but also could be a sidebar item such as "PYTHON").
const capsLike = (line) => {
  const t = line.trim().replace(/:$/, '');
  return t.length >= 4 && t.length <= 40 && t.split(/\s+/).length <= 4 && /^[A-Z]/.test(t) && !/[a-z]/.test(t) && !/\d/.test(t) && !BULLET.test(line) && !t.includes(',');
};

// Known section titles always count. Other ALL-CAPS lines count only when followed by normal text, so a run of
// ALL-CAPS items (typical sidebar of a two-column resume) is not turned into a pile of fake headings.
function isHeadingAt(lines, i) {
  const t = lines[i].trim().replace(/:$/, '');
  if (SECTION_TITLES.test(t)) return true;
  if (!capsLike(lines[i])) return false;
  let j = i + 1;
  while (j < lines.length && !lines[j].trim()) j++;
  return j < lines.length && !capsLike(lines[j]) && !SECTION_TITLES.test(lines[j].trim());
}

function splitDates(line, allowLoneYear) {
  const m = line.match(RANGE);
  if (m) {
    const left = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    return { left, dates: m[0].replace(/\s*(?:-|–|—)\s*/, ' – ') };
  }
  if (allowLoneYear) {
    const y = line.match(LONE_YEAR_END);
    if (y && y[1].trim()) return { left: y[1].trim(), dates: y[2] };
  }
  return null;
}

// Returns items in the same order as the input lines: [{ t, text, ...}]
function structure(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const items = [];
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  // First line is the name unless it looks like contact info or a known section title (ALL-CAPS names are fine).
  const first = i < lines.length ? lines[i].trim() : '';
  if (first && first.length <= 60 && !CONTACT_HINT.test(first) && !SECTION_TITLES.test(first.replace(/:$/, ''))) {
    items.push({ t: 'name', text: first });
    i++;
  }

  let section = null;
  let inBody = false;        // inside the description lines that follow a dated job/education line
  let expectSubtitle = false; // the very next short line may be a subtitle (e.g. "7.35 CGPA")
  let contactLines = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (isHeadingAt(lines, i)) {
      const title = line.replace(/:$/, '');
      section = { kind: kindOf(title) };
      inBody = false; expectSubtitle = false;
      items.push({ t: 'heading', text: title });
      continue;
    }
    if (BULLET.test(line)) { expectSubtitle = false; items.push({ t: 'bullet', text: line.replace(BULLET, '') }); continue; }

    if (!section) {
      // Before the first heading: contact details stay where they are, other text stays as plain text.
      const sepContact = /[|•·]/.test(line) && line.length <= 110;
      const shortPlace = contactLines < 3 && line.length < 60 && !/[.!?]$/.test(line) && items.every((x) => x.t === 'name' || x.t === 'contact');
      if (CONTACT_HINT.test(line) || sepContact || shortPlace) {
        contactLines++;
        items.push({ t: 'contact', text: line.split(/\s*[|•·]\s*/).map((s) => s.trim()).filter(Boolean).join('   |   ') });
      } else items.push({ t: 'text', text: line });
      continue;
    }

    if (section.kind === 'skills') {
      const m = line.match(/^([^:]{2,32}):\s*(.+)$/);
      items.push(m ? { t: 'skill', label: m[1], text: m[2] } : { t: 'text', text: line });
      continue;
    }
    if (section.kind === 'experience' || section.kind === 'education') {
      const sd = splitDates(line, section.kind === 'education');
      if (sd) {
        // A short unpunctuated line right above a dated title line is the company/school ("Acme Corp" / "Engineer  2020 - 2022").
        const prev = items[items.length - 1];
        const orgLine = prev && (prev.t === 'text' || (prev.t === 'bullet' && prev.inferred)) && prev.text.length < 90 && (!/[.!?:]$/.test(prev.text) || ORG_SUFFIX.test(prev.text)) && !CONTACT_HINT.test(prev.text);
        if (orgLine) { prev.t = 'org'; delete prev.inferred; }
        items.push({ t: 'entry', text: sd.left, dates: sd.dates, sub: !!orgLine });
        inBody = true;
        expectSubtitle = !orgLine || section.kind === 'education';
        continue;
      }
      if (expectSubtitle) {
        expectSubtitle = false;
        if (line.length < 110 && !/[.!?]$/.test(line) && (section.kind !== 'education' || GRADE.test(line))) { items.push({ t: 'subtitle', text: line }); continue; }
      }
      if (inBody && section.kind === 'experience') {
        // PDFs often drop the bullet glyphs. Rebuild bullets: a line starting in lower case continues the previous one.
        if (/^[^:]{1,45}\s?:$/.test(line)) { items.push({ t: 'label', text: line.replace(/\s*:$/, ':') }); continue; }
        const last = items[items.length - 1];
        if (/^[a-z0-9(]/.test(line) && last && last.t === 'bullet' && last.inferred) { last.text += ' ' + line; continue; }
        items.push({ t: 'bullet', text: line, inferred: true });
        continue;
      }
    }
    expectSubtitle = false;
    if (section.kind === 'experience' && !inBody && line.length < 80 && !/[.!?:,]$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length ? lines[j].trim() : '';
      if (next.length > line.length && !isHeadingAt(lines, j) && !splitDates(next, section.kind === 'education')) { items.push({ t: 'org', text: line }); continue; }
    }
    items.push({ t: 'text', text: line });
  }
  return items;
}

// ---------- Rendering ----------
function render(items, tpl) {
  const { font } = tpl;
  const W = 10240; // text width in twips (Letter, 1000-twip side margins)
  const run = (text, o = {}) => new TextRun({ text, font, size: 21, color: tpl.text, ...o });
  const align = tpl.nameAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const hc = tpl.headColor === 'accent' ? tpl.accent : tpl.text;

  return items.map((it) => {
    switch (it.t) {
      case 'name':
        return new Paragraph({ alignment: align, spacing: { after: 60 }, children: [run(it.text, { bold: true, size: tpl.nameSize, color: tpl.accent })] });
      case 'contact':
        return new Paragraph({ alignment: align, spacing: { after: 60 }, children: [run(it.text, { size: 19, color: tpl.muted })] });
      case 'heading':
        return new Paragraph({
          keepNext: true,
          spacing: { before: 220, after: 90 },
          border: tpl.headRule ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: hc, space: 2 } } : undefined,
          children: [run(it.text.toUpperCase(), { bold: true, size: 22, color: hc, characterSpacing: 20 })],
        });
      case 'bullet':
        return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [run(it.text)] });
      case 'skill':
        return new Paragraph({ spacing: { after: 50 }, children: [run(it.label + ': ', { bold: true }), run(it.text)] });
      case 'label':
        return new Paragraph({ keepNext: true, spacing: { before: 60, after: 20 }, children: [run(it.text, { bold: true, color: tpl.muted })] });
      case 'org':
        return new Paragraph({ keepNext: true, spacing: { before: 140, after: 10 }, children: [run(it.text, { bold: true })] });
      case 'entry':
        return new Paragraph({
          keepNext: true,
          spacing: { before: it.sub ? 0 : 120, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: W }],
          children: [run(it.text, it.sub ? { italics: true } : { bold: true }), new TextRun({ children: [new Tab(), it.dates], font, size: 20, color: tpl.muted })],
        });
      case 'subtitle':
        return new Paragraph({ keepNext: true, spacing: { after: 30 }, children: [run(it.text, { italics: true, color: tpl.muted })] });
      default:
        return new Paragraph({ spacing: { after: 60 }, children: [run(it.text)] });
    }
  });
}

async function buildDocx(text, template = 'modern') {
  const tpl = TEMPLATES[template] || TEMPLATES.modern;
  const items = structure(text);
  const name = (items.find((x) => x.t === 'name') || {}).text;
  const doc = new Document({
    creator: 'ATS Resume Checker',
    title: name ? `${name} - Resume` : 'Resume',
    styles: { default: { document: { run: { font: tpl.font, size: 21 } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }],
      }],
    },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: render(items, tpl) }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx, structure, TEMPLATES };
