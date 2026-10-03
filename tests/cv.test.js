// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const mammoth = require('mammoth');
const { addSkills } = require('../public/cvedit');
const { buildDocx } = require('../lib/cv');
const { analyze } = require('../lib/analyzer');

const base = `Jane Doe
jane@example.com

EXPERIENCE
Engineer, Acme  Jan 2020 - Present
- Built APIs in Python

EDUCATION
B.S. Computer Science

SKILLS
Python, SQL, Git

CERTIFICATIONS
AWS Cloud Practitioner`;

test('appends to the existing comma list in the Skills section only', () => {
  const out = addSkills(base, ['Kubernetes', 'Docker']);
  assert.match(out, /Python, SQL, Git, Kubernetes, Docker\n/);
  assert.match(out, /CERTIFICATIONS\nAWS Cloud Practitioner$/); // later sections untouched
  assert.equal(out.split('Kubernetes').length - 1, 1);
});

test('handles "Skills: a, b" on one line', () => {
  const out = addSkills('Jane\nSkills: Python, SQL\nEducation\nB.S.', ['Docker']);
  assert.match(out, /Skills: Python, SQL, Docker\n/);
});

test('creates a Skills section when there is none', () => {
  const out = addSkills('Jane Doe\nEXPERIENCE\n- Built things', ['Docker', 'Kubernetes']);
  assert.match(out, /\n\nSKILLS\nDocker, Kubernetes\n$/);
});

test('bullet-style skills section gets a new line instead of a mangled bullet', () => {
  const out = addSkills('Jane\nSkills\n- Python\n- SQL\nEducation\nB.S.', ['Docker']);
  assert.match(out, /- SQL\nDocker\nEducation/);
});

test('does not duplicate skills already listed, ignores blanks/duplicates', () => {
  assert.equal(addSkills(base, ['sql', 'Python']), base);
  const out = addSkills(base, ['Docker', 'docker', ' ', 'Docker']);
  assert.equal(out.split(/docker/i).length - 1, 1);
});

test('preserves CRLF line endings', () => {
  const out = addSkills('Jane\r\nSKILLS\r\nPython, SQL\r\n', ['Docker']);
  assert.ok(out.includes('Python, SQL, Docker\r\n') && !/[^\r]\n/.test(out));
});

test('added skills raise the score and fix the gap', () => {
  const jd = 'Requirements\n- Experience with Docker and Kubernetes\n- Python';
  const before = analyze(base, jd);
  const after = analyze(addSkills(base, ['Docker', 'Kubernetes']), jd);
  assert.ok(before.skills.missing.some((m) => m.name === 'Kubernetes'));
  assert.ok(after.score > before.score);
  assert.equal(after.skills.missing.length, 0);
});

test('DOCX export round-trips the text with sections and bullets', async () => {
  const buf = await buildDocx(addSkills(base, ['Docker']));
  assert.equal(buf.subarray(0, 2).toString(), 'PK'); // a zip/docx
  const { value } = await mammoth.extractRawText({ buffer: buf });
  for (const needle of ['Jane Doe', 'EXPERIENCE', 'Built APIs in Python', 'Python, SQL, Git, Docker', 'AWS Cloud Practitioner']) {
    assert.ok(value.includes(needle), `missing in DOCX: ${needle}`);
  }
  // the exported file is still readable by the checker's own parser
  assert.ok(analyze(value, 'Requirements\n- Docker').skills.matched.some((m) => m.name === 'Docker'));
});

// ---------- structure parser + templates ----------
const { parseResume, TEMPLATES } = require('../lib/cv');

test('parser: ALL-CAPS name is a name, not a heading; contact line is split', () => {
  const p = parseResume('JANE DOE\njane@x.com | 555 010 2030 | Boston, MA\n\nEXPERIENCE\nDev, Acme   2020 - 2022\n- did things');
  assert.equal(p.name, 'JANE DOE');
  assert.deepEqual(p.contact, ['jane@x.com', '555 010 2030', 'Boston, MA']);
  assert.equal(p.sections[0].title, 'EXPERIENCE');
  assert.equal(p.sections[0].kind, 'experience');
});

test('parser: city line under the name counts as contact; summary paragraph stays as intro', () => {
  const p = parseResume('Jane Doe\nBoston, MA\nSeasoned engineer who builds reliable systems for a living and loves it.\n\nSKILLS\nPython');
  assert.deepEqual(p.contact, ['Boston, MA']);
  assert.equal(p.intro.length, 1);
});

test('parser: no sections / only paragraphs does not crash', async () => {
  const p = parseResume('Just some text without any structure at all.');
  assert.equal(p.sections.length, 0);
  const buf = await buildDocx('Just some text without any structure at all.');
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

test('every template builds and keeps all the content', async () => {
  const text = `Jane Doe\njane@x.com | 555 010 2030\n\nEXPERIENCE\nSenior Engineer (2019 - 2022)\nAcme Corp, Boston\n- Shipped a payments platform used by 1,000,000 customers\n\nEDUCATION\nB.S. Computer Science, MIT 2018\n\nSKILLS\nCloud: AWS, Azure\nPython, Go`;
  for (const t of Object.keys(TEMPLATES)) {
    const { value } = await mammoth.extractRawText({ buffer: await buildDocx(text, t) });
    for (const needle of ['Jane Doe', 'jane@x.com', 'Senior Engineer', '2019', '2022', 'Acme Corp, Boston', 'payments platform used by 1,000,000 customers', 'B.S. Computer Science, MIT', '2018', 'Cloud:', 'AWS, Azure', 'Python, Go']) {
      assert.ok(value.includes(needle), `[${t}] lost: ${needle}`);
    }
  }
});

test('date range inside parentheses leaves no stray "( )" in the document', async () => {
  const { value } = await mammoth.extractRawText({ buffer: await buildDocx('Jane\nEXPERIENCE\nSenior Engineer, Acme (2019 - 2022)\n- Did things') });
  assert.ok(value.includes('Senior Engineer, Acme'));
  assert.ok(!/\(\s*\)/.test(value), 'empty parentheses left behind');
  assert.ok(value.includes('2019') && value.includes('2022'));
});

test('unknown template falls back to modern', async () => {
  assert.equal((await buildDocx('Jane\nSKILLS\nPython', 'nope')).subarray(0, 2).toString(), 'PK');
});
