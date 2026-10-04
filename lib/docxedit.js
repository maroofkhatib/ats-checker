// Adds skills to an existing .docx WITHOUT touching its design. A .docx is a zip of XML parts; we change only the
// text of one paragraph (or clone one paragraph) inside word/document.xml. Every other part (images, styles, fonts,
// headers/footers, text boxes, tables...) is carried over untouched, and the new text reuses the formatting of the
// text it is appended to.
const JSZip = require('jszip');

const SKILLS_HEAD = /skill|competenc|technolog|tools|expertise|proficienc|capabilit/i;
const TECH_HEAD = /tool|tech|software|system|digital|program|language|data|engineer|platform|stack/i;
const SOFT_HEAD = /team|leader|communicat|soft|interpersonal|people|management|collaborat/i;
const SECTION_WORD = /^(summary|profile|objective|experience|work experience|professional experience|employment|education|skills|technical skills|projects|certifications?|achievements|awards|languages|publications|interests|references)$/i;
const SOFT_SKILLS = new Set(['Project Management', 'Product Management', 'Stakeholder Management', 'Leadership', 'Communication', 'Problem Solving', 'Collaboration', 'Budgeting', 'Customer Service', 'Recruiting', 'Agile', 'Scrum', 'Kanban']);

const regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch);
const has = (text, skill) => new RegExp('(^|[^a-z0-9+#])' + regexEscape(skill) + '($|[^a-z0-9+#])', 'i').test(text);
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// All paragraphs with their nesting (a paragraph in a text box / table cell knows its container).
function scanParagraphs(xml) {
  const re = /<(\/?)w:(p|tbl|txbxContent|tc|tr)(?=[\s>\/])([^>]*?)(\/?)>/g;
  const stack = [];
  const paras = [];
  let m;
  while ((m = re.exec(xml))) {
    const [full, close, tag, , self] = m;
    if (self) { if (tag === 'p') paras.push({ start: m.index, end: m.index + full.length, ctx: stack.map((s) => s.tag), empty: true }); continue; }
    if (!close) stack.push({ tag, start: m.index });
    else {
      const top = stack.pop();
      if (tag === 'p' && top) paras.push({ start: top.start, end: m.index + full.length, ctx: stack.map((s) => s.tag) });
    }
  }
  paras.sort((a, b) => a.start - b.start);
  for (const p of paras) {
    p.xml = xml.slice(p.start, p.end);
    p.nested = paras.some((q) => q !== p && q.start > p.start && q.end < p.end); // contains a text box with its own paragraphs
    p.inTextBox = p.ctx.includes('txbxContent');
    p.style = (p.xml.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    p.isList = /<w:numPr>/.test(p.xml);
    p.texts = [...p.xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => ({ index: t.index, full: t[0], text: unescapeXml(t[1]) }));
    p.text = p.texts.map((t) => t.text).join('').replace(/\s+/g, ' ').trim();
  }
  return paras;
}

// Heading level: 0/none for body text. Uses the Word style, or a short section word when the document has no styles.
function headingLevel(p) {
  const s = /^heading\s*(\d)$/i.exec(p.style) || /^Heading(\d)$/.exec(p.style);
  if (s) return +s[1];
  if (/^title$/i.test(p.style)) return 1;
  if (p.text && p.text.length < 45 && !p.nested && !p.inTextBox) {
    if (SECTION_WORD.test(p.text.replace(/:$/, ''))) return 1;
    if (p.text === p.text.toUpperCase() && SKILLS_HEAD.test(p.text) && !/[.,;]/.test(p.text)) return 1;
  }
  return 0;
}

// The section whose heading looks like "Skills": returns { heading, groups: [{ title, paras }] }
function findSkillsSection(paras) {
  const body = paras.filter((p) => !p.inTextBox && !p.nested && !p.empty);
  let best = null;
  body.forEach((p, i) => {
    const lvl = headingLevel(p);
    if (!lvl || !SKILLS_HEAD.test(p.text)) return;
    const score = /skill/i.test(p.text) ? 2 : 1;
    if (!best || score > best.score) best = { i, lvl, score };
  });
  if (!best) return null;
  const heading = body[best.i];
  const groups = [{ title: '', paras: [] }];
  for (let j = best.i + 1; j < body.length; j++) {
    const p = body[j];
    const lvl = headingLevel(p);
    if (lvl && lvl <= best.lvl) break; // next top-level section
    if (lvl) { groups.push({ title: p.text, paras: [] }); continue; } // sub-heading such as "Digital Tools"
    if (p.text) groups[groups.length - 1].paras.push(p);
  }
  return { heading, groups: groups.filter((g) => g.paras.length) };
}

const LEAD_LIKE = new Set(['Leadership', 'Project Management', 'Product Management', 'Stakeholder Management', 'Recruiting', 'Budgeting', 'Agile', 'Scrum', 'Kanban']);
function chooseGroup(groups, skill) {
  if (groups.length === 1) return groups[0];
  const find = (...res) => { for (const re of res) { const g = groups.find((x) => re.test(x.title)); if (g) return g; } return null; };
  if (SOFT_SKILLS.has(skill)) {
    return (LEAD_LIKE.has(skill) ? find(/team|leader|people|management/i, /communicat|interpersonal|soft|collaborat/i) : find(/communicat|interpersonal|soft|collaborat/i, /team|leader|people/i)) || groups[0];
  }
  return find(TECH_HEAD) || groups[0];
}

// How the existing items in this paragraph are separated: "•", ",", ";" or "|"
function separatorOf(text) {
  if (text.includes('•')) return ' • ';
  if (text.includes(';')) return '; ';
  if (text.includes('|')) return ' | ';
  return ', ';
}

// Append "<sep>skills" to the text of the paragraph's last visible run (keeps that run's font/size/colour).
function appendToParagraph(p, skills) {
  const last = [...p.texts].reverse().find((t) => /\S/.test(t.text));
  if (!last) return null;
  const sep = separatorOf(p.text);
  const trailing = /[•,;|]\s*$/.test(last.text); // list already ends with a separator
  const add = (trailing ? (/\s$/.test(last.text) ? '' : ' ') : sep) + skills.join(sep);
  const open = last.full.match(/^<w:t((?: [^>]*)?)>/)[1];
  const attrs = /xml:space=/.test(open) ? open : open + ' xml:space="preserve"';
  const newT = `<w:t${attrs}>${escapeXml(last.text + add)}</w:t>`;
  const at = p.start + last.index;
  return { start: at, end: at + last.full.length, replacement: newT };
}

// For skills written one per bullet: clone the last bullet paragraph for each new skill.
function cloneAfter(p, skill) {
  const runs = [...p.xml.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)];
  const firstText = runs.find((r) => /<w:t[ >]/.test(r[0]));
  if (!firstText) return null;
  const open = p.xml.slice(0, p.xml.indexOf(runs[0][0]));
  const run = firstText[0].replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${escapeXml(skill)}</w:t>`).replace(/<w:t(?: [^>]*)?\/>/, '');
  const closing = '</w:p>';
  return open + run + closing;
}

function isBulletList(group) {
  return group.paras.length >= 2 && group.paras.every((p) => p.isList && !/[•,;|]/.test(p.text));
}

async function addSkillsToDocx(buffer, skills) {
  const list = [...new Set((skills || []).map((s) => String(s).trim()).filter(Boolean))];
  const zip = await JSZip.loadAsync(buffer);
  // refuse zip bombs: a few MB of upload must not inflate to a huge amount of data
  let total = 0;
  zip.forEach((_p, f) => { total += (f._data && f._data.uncompressedSize) || 0; });
  if (total > 120 * 1024 * 1024) throw new Error('docx-too-large');
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('not-a-docx');
  const xml = await docFile.async('string');
  const paras = scanParagraphs(xml);
  const placed = [];
  const edits = [];

  const section = findSkillsSection(paras);
  if (section && section.groups.length) {
    const sectionText = section.groups.map((g) => g.paras.map((p) => p.text).join(' ')).join(' ');
    const perPara = new Map(); // paragraph -> skills to append
    const clones = new Map();  // paragraph -> skills to add as new bullets after it
    for (const skill of list) {
      if (has(sectionText, skill)) continue; // already listed in the Skills section
      const group = chooseGroup(section.groups, skill);
      const target = group.paras[group.paras.length - 1];
      const map = isBulletList(group) ? clones : perPara;
      if (!map.has(target)) map.set(target, []);
      map.get(target).push(skill);
      placed.push({ skill, section: group.title || section.heading.text });
    }
    for (const [p, sk] of perPara) { const e = appendToParagraph(p, sk); if (e) edits.push(e); else throw new Error('no-text-run'); }
    for (const [p, sk] of clones) {
      const add = sk.map((s) => cloneAfter(p, s)).filter(Boolean).join('');
      if (!add) throw new Error('cannot-clone');
      edits.push({ start: p.end, end: p.end, replacement: add });
    }
  } else if (list.length) {
    // No skills section: add one at the end, copying an existing heading and body paragraph so it matches the design.
    const body = paras.filter((p) => !p.inTextBox && !p.nested && !p.empty && p.text);
    const headings = body.filter((p) => headingLevel(p) === 1);
    const headingP = headings[headings.length - 1];
    const bodyP = [...body].reverse().find((p) => !p.isList && headingLevel(p) === 0 && p.texts.length);
    const sectAt = xml.lastIndexOf('<w:sectPr');
    if (!headingP || !bodyP || sectAt < 0) throw new Error('no-template');
    const setText = (p, text) => {
      const firstRun = [...p.xml.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)].find((r) => /<w:t[ >]/.test(r[0]));
      if (!firstRun) throw new Error('no-template');
      const open = p.xml.slice(0, p.xml.indexOf(firstRun[0]));
      const run = firstRun[0].replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`);
      return open + run + '</w:p>';
    };
    const sep = ', ';
    edits.push({ start: sectAt, end: sectAt, replacement: setText(headingP, 'SKILLS') + setText(bodyP, list.join(sep)) });
    list.forEach((s) => placed.push({ skill: s, section: 'new Skills section' }));
  }

  if (!edits.length) return { buffer, placed: [], changed: false };

  let out = xml;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  zip.file('word/document.xml', out);
  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer: result, placed, changed: true };
}

module.exports = { addSkillsToDocx, scanParagraphs, findSkillsSection, headingLevel };
