// Run: npm test
// Years of experience must be read from the many ways resumes write dates; a failure here once showed 0 years for a
// CV with 11 years of experience (it used an en dash), so these cover dashes, formats, phrases and the "unknown" case.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyze } = require('../lib/analyzer');

const JD = 'Requirements\n- 5+ years of experience\n- Python';
const years = (resume, jd = JD) => analyze(resume, jd).experience.resumeYears;
const cv = (body) => `Alex Roe\nalex@example.com\n\nEXPERIENCE\n${body}\n- Built things\n\nSKILLS\nPython`;
const close = (got, want, msg) => assert.ok(got != null && Math.abs(got - want) <= 0.15, `${msg}: expected ~${want}, got ${got}`);

test('every kind of dash between dates is understood (hyphen, en dash, em dash, minus, non-breaking hyphen)', () => {
  for (const [name, dash] of [['hyphen', '-'], ['en dash', '–'], ['em dash', '—'], ['minus', '−'], ['non-breaking hyphen', '‑'], ['figure dash', '‒']]) {
    close(years(cv(`Engineer, Acme   Jan 2012 ${dash} Jan 2020`)), 8, name);
    close(years(cv(`Engineer, Acme   Jan 2012${dash}Jan 2020`)), 8, name + ' without spaces');
  }
});

test('different date formats all give the same 8 years', () => {
  const formats = [
    'Jan 2012 - Jan 2020', 'January 2012 – January 2020', 'Jan, 2012 – Jan, 2020', "Jan'12 - Jan'20", "Jan '12 – Jan '20",
    '01/2012 - 01/2020', '01.2012 – 01.2020', '01-2012 - 01-2020', '2012 – 2020', 'Sept 2012 - Sep 2020',
    'Jan 2012 to Jan 2020', 'Jan 2012 until Jan 2020', 'Jan 2012 through Jan 2020', 'June 2012-June 2020', 'Jan 2012 – Jan 2020',
  ];
  for (const f of formats) close(years(cv(`Engineer, Acme   ${f}`)), 8, f);
});

test('open-ended ranges ("Present", "Till date", "Currently", "Since 2020", ...) all run to today', () => {
  const ref = years(cv('Engineer, Acme   Jan 2020 - Present'));
  assert.ok(ref >= 5, 'sanity: Jan 2020 to today is several years');
  for (const end of ['Present', 'present', 'Till Date', 'to date', 'To Date', 'till now', 'Currently', 'Current', 'ongoing', 'Now', 'Today']) {
    close(years(cv(`Engineer, Acme   Jan 2020 – ${end}`)), ref, 'end word "' + end + '"');
  }
  close(years(cv('Engineer, Acme   Since Jan 2020')), ref, 'Since');
});

test('stated experience is understood when there are no dates', () => {
  const phrases = ['11 years of experience', '11+ years of professional experience', "11 years' experience", '11 yrs of experience', 'Experience of 11 years', 'Over eleven years of software development', 'eleven years of experience in operations'];
  for (const p of phrases) {
    const r = analyze(`Alex Roe\nalex@example.com\nSummary\nEngineer with ${p}.\n\nSkills\nPython`, JD);
    assert.equal(r.experience.resumeYears, 11, 'phrase: ' + p);
  }
});

test('years of study are not counted as work experience', () => {
  const text = 'Alex Roe\nalex@example.com\n\nEducation\nB.S. Computer Science   2012 – 2016\n\nExperience\nEngineer, Acme   Jan 2016 – Jan 2020\n- Built things\n\nSkills\nPython';
  close(years(text), 4, 'education excluded');
});

test('overlapping jobs are counted once', () => {
  close(years(cv('Engineer, Acme   Jan 2015 - Jan 2020\nConsultant, Side Co   Jan 2018 - Jan 2021')), 6, 'overlap');
});

test('if no dates can be read, experience is "unknown": not scored as 0, and the user is told', () => {
  const r = analyze('Alex Roe\nalex@example.com\n\nExperience\nEngineer at Acme, built many things\n\nSkills\nPython', JD);
  assert.equal(r.experience.resumeYears, null);
  assert.ok(!r.breakdown.some((b) => b.key === 'experience'), 'experience left out of the score');
  assert.ok(r.suggestions.some((s) => /couldn't read the dates/i.test(s.text)));
  // and it is not worse than the same CV once the dates are readable
  const withDates = analyze('Alex Roe\nalex@example.com\n\nExperience\nEngineer at Acme   Jan 2015 - Jan 2024\n- built many things\n\nSkills\nPython', JD);
  assert.ok(withDates.score >= r.score - 10, 'unreadable dates must not cost the 25-point experience share');
});

test('the displayed years are rounded to one decimal', () => {
  const y = years(cv('Engineer, Acme   Mar 2019 - Feb 2024'));
  assert.equal(y, Math.round(y * 10) / 10);
});

test('source files contain no scrambled characters (UTF-8 text re-read as Windows-1252)', () => {
  const root = path.join(__dirname, '..');
  // the typical debris: U+00C2 / U+00C3 / U+00E2 followed by a Windows-1252-style punctuation character
  const bad = /[ÂÃâ][\u0080-¿ŒœŠšŸŽžˆ˜–-›€]/;
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'tests'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|html|css)$/.test(e.name)) files.push(p);
  } };
  walk(root);
  const hits = [];
  for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (bad.test(l)) hits.push(path.relative(root, f) + ':' + (i + 1)); });
  assert.deepEqual(hits, []);
});
