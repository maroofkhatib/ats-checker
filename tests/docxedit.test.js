// Run: npm test
// Adding skills to an uploaded .docx must change ONLY the skills text; every other part (images, styles...) stays identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = require('docx');
const { addSkillsToDocx } = require('../lib/docxedit');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (t) => new Paragraph({ children: [new TextRun({ text: t, font: 'Georgia', size: 26, color: '2E75B6' })] });
const B = (t) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(t)] });
const IMG = () => new Paragraph({ children: [new ImageRun({ type: 'png', data: PNG, transformation: { width: 20, height: 20 } })] });
const make = (children) => Packer.toBuffer(new Document({ sections: [{ children }] }));

async function parts(buf) {
  const z = await JSZip.loadAsync(buf);
  const out = {};
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) out[n] = await z.file(n).async('nodebuffer');
  return out;
}
const norm = (s) => s.replace(/ xml:space="preserve"/g, '');
const text = async (buf) => (await mammoth.extractRawText({ buffer: buf })).value;

// Everything except word/document.xml must be byte-identical; document.xml must differ only by the inserted text.
async function assertOnlySkillsChanged(before, after, inserted) {
  const a = await parts(before), b = await parts(after);
  assert.deepEqual(Object.keys(b), Object.keys(a), 'same files in the package');
  for (const n of Object.keys(a)) if (n !== 'word/document.xml') assert.ok(a[n].equals(b[n]), n + ' must be unchanged');
  assert.ok(Object.keys(a).some((n) => n.startsWith('word/media/')), 'test document really contains an image');
  let x = norm(b['word/document.xml'].toString('utf8'));
  for (const piece of inserted) { assert.ok(x.includes(piece), 'inserted text present: ' + piece); x = x.replace(piece, ''); }
  assert.equal(x, norm(a['word/document.xml'].toString('utf8')), 'document.xml differs only by the inserted text');
}

test('comma list: skills appended to the existing list, same run formatting, image and styles untouched', async () => {
  const before = await make([H1('Experience'), P('Built APIs.'), IMG(), H1('Skills'), P('Python, SQL, Git'), H1('Education'), P('B.S. Computer Science')]);
  const r = await addSkillsToDocx(before, ['Docker', 'Kubernetes']);
  assert.equal(r.changed, true);
  assert.deepEqual(r.placed.map((p) => p.skill), ['Docker', 'Kubernetes']);
  assert.ok((await text(r.buffer)).includes('Python, SQL, Git, Docker, Kubernetes'));
  await assertOnlySkillsChanged(before, r.buffer, [', Docker, Kubernetes']);
  // the formatting of the existing run (font, size, colour) is still on that run
  const xml = (await parts(r.buffer))['word/document.xml'].toString('utf8');
  assert.match(xml, /Georgia[\s\S]*?Python, SQL, Git, Docker, Kubernetes/);
});

test('bullet-separated list (•) keeps its separator style', async () => {
  const before = await make([H1('Skills'), P('Excel • HubSpot CRM • Word'), IMG()]);
  const r = await addSkillsToDocx(before, ['Python', 'Docker']);
  assert.ok((await text(r.buffer)).includes('Excel • HubSpot CRM • Word • Python • Docker'));
  await assertOnlySkillsChanged(before, r.buffer, [' • Python • Docker']);
});

test('one skill per bullet: new bullets are cloned from the last one', async () => {
  const before = await make([H1('Skills'), B('Python'), B('SQL'), B('Git'), IMG(), H1('Education'), P('B.S.')]);
  const r = await addSkillsToDocx(before, ['Docker', 'Kubernetes']);
  const t = await text(r.buffer);
  assert.ok(/Git\s+Docker\s+Kubernetes\s+Education/.test(t.replace(/\n+/g, ' ')), 'new bullets sit right after the last one: ' + JSON.stringify(t));
  const a = await parts(before), b = await parts(r.buffer);
  for (const n of Object.keys(a)) if (n !== 'word/document.xml') assert.ok(a[n].equals(b[n]), n);
  const count = (buf) => (buf['word/document.xml'].toString('utf8').match(/<w:numPr>/g) || []).length;
  assert.equal(count(b), count(a) + 2, 'two more list paragraphs, same list style');
});

test('sub-headings: tools go under the tools group, soft skills under the team group', async () => {
  const before = await make([H1('Tools & Professional Skills'), H2('Digital Tools'), P('Excel • Word'), H2('Team Contribution'), P('Mentoring • Planning'), H1('Education'), P('B.S.')]);
  const r = await addSkillsToDocx(before, ['Kubernetes', 'Leadership']);
  assert.deepEqual(r.placed, [{ skill: 'Kubernetes', section: 'Digital Tools' }, { skill: 'Leadership', section: 'Team Contribution' }]);
  const t = await text(r.buffer);
  assert.ok(t.includes('Excel • Word • Kubernetes'));
  assert.ok(t.includes('Mentoring • Planning • Leadership'));
});

test('no Skills section: a new one is added at the end, styled like the other headings', async () => {
  const before = await make([H1('Experience'), P('Built APIs.'), IMG(), H1('Education'), P('B.S. Computer Science')]);
  const r = await addSkillsToDocx(before, ['Python', 'Docker']);
  assert.equal(r.changed, true);
  assert.equal(r.placed[0].section, 'new Skills section');
  const t = await text(r.buffer);
  assert.ok(/SKILLS\s+Python, Docker\s*$/.test(t.trim()), JSON.stringify(t.slice(-80)));
  const a = await parts(before), b = await parts(r.buffer);
  for (const n of Object.keys(a)) if (n !== 'word/document.xml') assert.ok(a[n].equals(b[n]), n);
  assert.match(b['word/document.xml'].toString('utf8'), /<w:pStyle w:val="Heading1"\/>[\s\S]*SKILLS/);
});

test('skills that are already listed change nothing', async () => {
  const before = await make([H1('Skills'), P('Python, SQL, Git'), IMG()]);
  const r = await addSkillsToDocx(before, ['python', 'SQL']);
  assert.equal(r.changed, false);
  assert.ok(r.buffer.equals(before), 'the file is returned unchanged');
});

test('special characters are escaped and the file still opens', async () => {
  const before = await make([H1('Skills'), P('Python, SQL'), IMG()]);
  const r = await addSkillsToDocx(before, ['R&D tooling', 'C++', 'CI/CD', '<script>']);
  const xml = (await parts(r.buffer))['word/document.xml'].toString('utf8');
  assert.ok(xml.includes('R&amp;D tooling') && xml.includes('&lt;script&gt;'));
  const t = await text(r.buffer);
  assert.ok(t.includes('R&D tooling') && t.includes('C++') && t.includes('CI/CD'));
});

test('a file that is not a .docx is rejected so the caller can fall back', async () => {
  await assert.rejects(() => addSkillsToDocx(Buffer.from('this is not a zip file'), ['Python']));
  const z = new JSZip(); z.file('hello.txt', 'hi'); // a zip, but not Word
  const notWord = await z.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => addSkillsToDocx(notWord, ['Python']), /not-a-docx/);
});
