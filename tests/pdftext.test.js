// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutText } = require('../lib/pdftext');
const { structure } = require('../lib/cv');

// Build a fake text piece the way pdf.js reports it: (x, y) from the bottom-left of the page, y grows upwards.
const W = 600;
const piece = (s, x, y) => ({ s, x, y, w: s.length * 5, h: 10 });
const lines = (text) => text.split('\n');

test('PDF text is read in visual order even when dates/name are stored out of order', () => {
  // content-stream order: all the dates first, then the body, and the name + contact LAST (as in many Canva/Word PDFs)
  const items = [
    piece('12/2023 - Present', 500, 560), piece('04/2021 - 08/2023', 500, 400),
    piece('Summary', 40, 650), piece('Acme Corp', 40, 580),
    piece('Sales Representative • Dublin', 40, 560),
    piece('Did useful things for customers.', 40, 540),
    piece('Tata Consultancy Services', 40, 420), piece('Systems Engineer • Mumbai', 40, 400),
    piece('Jane Doe', 40, 740), piece('jane@example.com', 40, 720),
  ];
  assert.deepEqual(lines(layoutText(items, W)), [
    'Jane Doe', 'jane@example.com', 'Summary', 'Acme Corp',
    'Sales Representative • Dublin   12/2023 - Present',
    'Did useful things for customers.',
    'Tata Consultancy Services',
    'Systems Engineer • Mumbai   04/2021 - 08/2023',
  ]);
});

test('pieces of one row are joined with a space, and slight baseline differences do not split the row', () => {
  const out = layoutText([piece('Python,', 40, 500), { ...piece('SQL', 80, 500.4), w: 15 }, piece('and more filler text here', 40, 480)], W);
  assert.deepEqual(lines(out), ['Python, SQL', 'and more filler text here']);
});

test('single column with right-aligned dates is NOT mistaken for two columns', () => {
  const items = [];
  for (let k = 0; k < 14; k++) {
    items.push({ s: 'A long description line that spans most of the page width number ' + k, x: 40, y: 700 - k * 20, w: 420, h: 10 });
    items.push(piece('0' + (k % 9 + 1) + '/2020', 520, 700 - k * 20));
  }
  const out = lines(layoutText(items, W));
  assert.equal(out.length, 14);
  assert.match(out[0], /number 0 {3}01\/2020$/);
});

test('two-column page: left column is read fully before the right column', () => {
  const items = [piece('JANE DOE', 40, 780), { s: 'Full width header line that crosses the whole page for the name block', x: 40, y: 760, w: 520, h: 10 }];
  for (let k = 0; k < 10; k++) {
    items.push(piece('left item ' + k, 40, 700 - k * 20));
    items.push(piece('right item ' + k, 400, 700 - k * 20));
  }
  const out = lines(layoutText(items, W));
  const at = (t) => out.findIndex((l) => l.includes(t));
  assert.ok(at('JANE DOE') < at('left item 0'));
  assert.ok(at('left item 9') < at('right item 0'), 'left column must finish before the right one starts');
  assert.ok(out.every((l) => !(l.includes('left item') && l.includes('right item'))), 'left and right items must not share a row');
});

// ---------- layout rules for the DOCX (descriptions that lost their bullet glyphs, schools, companies) ----------
test('structure: company above a dated title line; undotted descriptions become bullets; wrapped lines are joined', () => {
  const t = [
    'Jane Doe', 'jane@example.com', '', 'Experience',
    'Acme Corp', 'Engineer • Dublin   12/2023 - Present',
    'Achieved targets through proactive customer engagement and', 'product knowledge.', 'Provided excellent service.',
    'Latest Project :', 'Wrote a parser.',
    'Revitech Solutions Pvt. Ltd.', 'Intern • Mumbai   05/2019 - 09/2019', 'Worked as a developer',
  ].join('\n');
  const items = structure(t);
  const kinds = items.map((x) => x.t);
  assert.deepEqual(kinds, ['name', 'contact', 'heading', 'org', 'entry', 'bullet', 'bullet', 'label', 'bullet', 'org', 'entry', 'bullet']);
  assert.equal(items[5].text, 'Achieved targets through proactive customer engagement and product knowledge.');
  assert.equal(items[3].text, 'Acme Corp');
  assert.equal(items[9].text, 'Revitech Solutions Pvt. Ltd.'); // company ending in a dot is still a company, not a bullet
  assert.equal(items[10].dates, '05/2019 – 09/2019');
});

test('structure: grades are not headings; each school gets its own line; MM/YYYY dates are split off', () => {
  const t = ['Jane', 'Education', 'University College', 'MSc Computer Science • Dublin   09/2024', 'St. Francis Institute', 'B.E. Computer Science • Mumbai   10/2020', '7.35 CGPA', 'Skills', 'Python'].join('\n');
  const items = structure(t);
  assert.deepEqual(items.filter((x) => x.t === 'heading').map((x) => x.text), ['Education', 'Skills']);
  assert.deepEqual(items.filter((x) => x.t === 'org').map((x) => x.text), ['University College', 'St. Francis Institute']);
  assert.deepEqual(items.filter((x) => x.t === 'entry').map((x) => x.dates), ['09/2024', '10/2020']);
  assert.equal(items.find((x) => x.t === 'subtitle').text, '7.35 CGPA');
});

test('structure: project titles (short line above a longer description) are bold titles; "Links" is a section', () => {
  const items = structure(['Jane', 'Projects', 'Solar Power Prediction', 'A project made to predict the power generated at a plant.', 'Links', 'Linkedin'].join('\n'));
  assert.deepEqual(items.map((x) => x.t), ['name', 'heading', 'org', 'text', 'heading', 'text']);
});
