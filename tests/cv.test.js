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

// ---------- structure + templates ----------
const { structure, TEMPLATES } = require('../lib/cv');
const kinds = (text) => structure(text).map((x) => x.t);

test('structure: ALL-CAPS name is a name, not a heading; contact stays on its line', () => {
  const items = structure('JANE DOE\njane@x.com | 555 010 2030 | Boston, MA\n\nEXPERIENCE\nDev, Acme   2020 - 2022\n- did things');
  assert.deepEqual(kinds('JANE DOE\njane@x.com | 555 010 2030 | Boston, MA\n\nEXPERIENCE\nDev, Acme   2020 - 2022\n- did things'), ['name', 'contact', 'heading', 'entry', 'bullet']);
  assert.equal(items[0].text, 'JANE DOE');
  assert.equal(items[1].text, 'jane@x.com   |   555 010 2030   |   Boston, MA');
});

test('structure: a city line under the name is contact; a summary sentence stays plain text, in order', () => {
  const items = structure('Jane Doe\nBoston, MA\nSeasoned engineer who builds reliable systems for a living and loves it.\n\nSKILLS\nPython');
  assert.deepEqual(items.map((x) => x.t), ['name', 'contact', 'text', 'heading', 'text']);
});

test('structure: a run of ALL-CAPS sidebar items is NOT turned into fake headings', () => {
  const items = structure('Jane Doe\nSKILLS\nPYTHON\nDOCKER\nKUBERNETES\nEXPERIENCE\nEngineer, Acme 2020 - 2022');
  assert.deepEqual(items.filter((x) => x.t === 'heading').map((x) => x.text), ['SKILLS', 'EXPERIENCE']);
});

test('structure: no sections / only paragraphs does not crash', async () => {
  assert.deepEqual(kinds('Just some text without any structure at all.'), ['name']);
  const buf = await buildDocx('Just some text without any structure at all.');
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

// The DOCX must read in exactly the same order as the updated CV text (no regrouping, no dropped lines).
const firstWords = (line) => line.replace(/[^A-Za-z0-9@. ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
async function assertSameOrder(text, label) {
  for (const t of Object.keys(TEMPLATES)) {
    const { value } = await mammoth.extractRawText({ buffer: await buildDocx(text, t) });
    const flat = value.replace(/[^A-Za-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ');
    let pos = 0;
    for (const line of text.split('\n').filter((l) => l.trim())) {
      const key = firstWords(line);
      if (!key) continue;
      const at = flat.toLowerCase().indexOf(key.toLowerCase().replace(/\s+/g, ' '), pos);
      assert.ok(at >= 0, '[' + label + '/' + t + '] line missing or out of order: "' + line.trim().slice(0, 60) + '"');
      pos = at;
    }
  }
}

test('DOCX keeps every line in the original order (contact lines interleaved with text, sidebar, odd layouts)', async () => {
  await assertSameOrder('Jane Doe\nBoston, MA\nBackend engineer with six years of experience building APIs.\njane@x.com | 555 010 2030\nlinkedin.com/in/jane\nPYTHON\nDOCKER\nSQL\n\nSKILLS\nLanguages: Python, Go\nTools: Git\n\nEXPERIENCE\nSenior Engineer, Acme   Jan 2021 - Present\nPayments team\n- Shipped a payments platform\n- Led four engineers\nEngineer, Beta  2018 - 2020\n- Wrote tests\n\nEDUCATION\nB.S. Computer Science, MIT 2018\n\nCERTIFICATIONS\nAWS Cloud Practitioner 2022\nNotes at the very end', 'interleaved');
  await assertSameOrder('MAROOF KHATIB\nMumbai, India\nmaroof@example.com\n+91 98765 43210\n\nProfile\nData scientist.\n\nWork Experience\nMachine Learning Engineer (Mar 2022 - Present)\nGlobex Analytics, Mumbai\n- Built an LSTM autoencoder\n\nTechnical Skills\nPython, PyTorch, SQL, Docker, Go\n\nAwards\nBest Paper Award, Regional ML Conference, 2023', 'messy');
  await assertSameOrder(addSkills('Jane Doe\njane@x.com\n\nEXPERIENCE\nEngineer, Acme 2020 - 2022\n- Did things\n\nEDUCATION\nB.S. 2019', ['Docker', 'Kubernetes']), 'skills added to a resume without a Skills section');
});

test('every template builds and keeps all the content', async () => {
  const text = 'Jane Doe\njane@x.com | 555 010 2030\n\nEXPERIENCE\nSenior Engineer (2019 - 2022)\nAcme Corp, Boston\n- Shipped a payments platform used by 1,000,000 customers\n\nEDUCATION\nB.S. Computer Science, MIT 2018\n\nSKILLS\nCloud: AWS, Azure\nPython, Go';
  for (const t of Object.keys(TEMPLATES)) {
    const { value } = await mammoth.extractRawText({ buffer: await buildDocx(text, t) });
    for (const needle of ['Jane Doe', 'jane@x.com', 'Senior Engineer', '2019', '2022', 'Acme Corp, Boston', 'payments platform used by 1,000,000 customers', 'B.S. Computer Science, MIT', '2018', 'Cloud:', 'AWS, Azure', 'Python, Go']) {
      assert.ok(value.includes(needle), '[' + t + '] lost: ' + needle);
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
