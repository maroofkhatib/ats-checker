// Turns plain resume text into a polished, single-column, ATS-friendly DOCX.
// Step 1 (parseResume) understands the structure; step 2 (render) applies a visual template.
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, TabStopType, Tab, LevelFormat,
} = require('docx');

// ---------- Templates ----------
const TEMPLATES = {
  modern:  { label: 'Modern',  font: 'Calibri',         accent: '1F4E79', text: '262626', muted: '595959', nameAlign: 'left',   nameSize: 44, headRule: true,  headColor: 'accent' },
  classic: { label: 'Classic', font: 'Times New Roman', accent: '000000', text: '000000', muted: '404040', nameAlign: 'center', nameSize: 40, headRule: true,  headColor: 'text' },
  minimal: { label: 'Minimal', font: 'Arial',           accent: '333333', text: '222222', muted: '666666', nameAlign: 'left',   nameSize: 36, headRule: false, headColor: 'accent' },
};

// ---------- Parsing ----------
const SECTION_TITLES = /^(summary|professional summary|career summary|profile|about me|objective|career objective|experience|work experience|professional experience|employment|employment history|work history|internships?|education|academic background|skills|technical skills|key skills|core competencies|competencies|technologies|projects|personal projects|academic projects|certifications?|licenses?|achievements|accomplishments|awards|honors|languages|publications|volunteering|volunteer experience|interests|references)$/i;
const BULLET = /^\s*[-•*▪●◦■]\s+/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?,?\\s+\\d{4}';
const DATE_PART = `(?:${MONTH}|\\d{1,2}[/.]\\d{4}|(?:19|20)\\d{2})`;
const RANGE = new RegExp(`${DATE_PART}\\s*(?:-|–|—|to)\\s*(?:${DATE_PART}|present|current|now|ongoing)`, 'i');
const LONE_YEAR_END = /^(.*?)[\s,|–—-]+((?:19|20)\d{2})$/;
const CONTACT_HINT = /@|linkedin|github|https?:|www\.|(\+?\d[\d\s().-]{7,}\d)/i;

const kindOf = (title) => {
  const t = title.toLowerCase();
  if (/skill|competenc|technolog/.test(t)) return 'skills';
  if (/experience|employment|work history|internship|project|volunteer/.test(t)) return 'experience';
  if (/education|academic background|certif|licen|award|honor|publication|achievement/.test(t)) return 'education';
  return 'text';
};

const isHeading = (line) => {
  const t = line.trim().replace(/:$/, '');
  if (SECTION_TITLES.test(t)) return true;
  return t.length >= 4 && t.length <= 40 && /[A-Z]/.test(t) && !/[a-z]/.test(t) && !/\d{3,}/.test(t) && !BULLET.test(line) && !t.includes(',');
};

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

function parseResume(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  // First line is the name unless it looks like contact info or a known section title (ALL-CAPS names are fine).
  let name = '';
  const first = i < lines.length ? lines[i].trim() : '';
  if (first && first.length <= 60 && !CONTACT_HINT.test(first) && !SECTION_TITLES.test(first.replace(/:$/, ''))) { name = first; i++; }

  // Contact + any intro text before the first section heading
  const contact = [];
  const intro = [];
  while (i < lines.length && !(lines[i].trim() && isHeading(lines[i]))) {
    const l = lines[i++].trim();
    if (!l) continue;
    if (!BULLET.test(l) && l.length <= 110 && (CONTACT_HINT.test(l) || /[|•·]/.test(l) || (contact.length < 3 && intro.length === 0 && l.length < 60 && !/[.!?]$/.test(l)))) {
      contact.push(...l.split(/\s*[|•·]\s*/).map((s) => s.trim()).filter(Boolean));
    } else intro.push(l);
  }

  const sections = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && isHeading(l)) {
      const title = l.trim().replace(/:$/, '');
      cur = { title, kind: kindOf(title), lines: [] };
      sections.push(cur);
    } else if (cur) cur.lines.push(l);
  }
  return { name, contact, intro, sections };
}

// ---------- Rendering ----------
function render(parsed, tpl) {
  const { font } = tpl;
  const W = 10240; // text width in twips (Letter, 1000-twip side margins)
  const run = (text, o = {}) => new TextRun({ text, font, size: 21, color: tpl.text, ...o });
  const out = [];

  if (parsed.name) {
    out.push(new Paragraph({
      alignment: tpl.nameAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [run(parsed.name, { bold: true, size: tpl.nameSize, color: tpl.accent })],
    }));
  }
  if (parsed.contact.length) {
    out.push(new Paragraph({
      alignment: tpl.nameAlign === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 120 },
      children: [run(parsed.contact.join('   |   '), { size: 19, color: tpl.muted })],
    }));
  }
  for (const l of parsed.intro) out.push(new Paragraph({ spacing: { after: 80 }, children: [run(l)] }));

  for (const sec of parsed.sections) {
    const hc = tpl.headColor === 'accent' ? tpl.accent : tpl.text;
    out.push(new Paragraph({
      keepNext: true,
      spacing: { before: 220, after: 90 },
      border: tpl.headRule ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: hc, space: 2 } } : undefined,
      children: [run(sec.title.toUpperCase(), { bold: true, size: 22, color: hc, characterSpacing: 20 })],
    }));

    let afterHeader = false; // inside the lines that directly follow an entry header
    for (const raw of sec.lines) {
      const line = raw.trim();
      if (!line) continue;

      if (BULLET.test(line)) {
        afterHeader = false;
        out.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [run(line.replace(BULLET, ''))] }));
        continue;
      }

      if (sec.kind === 'skills') {
        const m = line.match(/^([^:]{2,32}):\s*(.+)$/);
        out.push(new Paragraph({ spacing: { after: 50 }, children: m ? [run(m[1] + ': ', { bold: true }), run(m[2])] : [run(line)] }));
        continue;
      }

      if (sec.kind === 'experience' || sec.kind === 'education') {
        const sd = splitDates(line, sec.kind === 'education');
        if (sd) {
          afterHeader = true;
          out.push(new Paragraph({
            keepNext: true,
            spacing: { before: 120, after: 20 },
            tabStops: [{ type: TabStopType.RIGHT, position: W }],
            children: [run(sd.left, { bold: true }), new TextRun({ children: [new Tab(), sd.dates], font, size: 20, color: tpl.muted })],
          }));
          continue;
        }
        if (afterHeader && line.length < 110 && !/[.!?]$/.test(line)) {
          out.push(new Paragraph({ keepNext: true, spacing: { after: 30 }, children: [run(line, { italics: true, color: tpl.muted })] }));
          continue;
        }
      }
      afterHeader = false;
      out.push(new Paragraph({ spacing: { after: 60 }, children: [run(line)] }));
    }
  }
  return out;
}

async function buildDocx(text, template = 'modern') {
  const tpl = TEMPLATES[template] || TEMPLATES.modern;
  const parsed = parseResume(text);
  const doc = new Document({
    creator: 'ATS Resume Checker',
    title: parsed.name ? `${parsed.name} - Resume` : 'Resume',
    styles: { default: { document: { run: { font: tpl.font, size: 21 } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }],
      }],
    },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: render(parsed, tpl) }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocx, parseResume, TEMPLATES };
