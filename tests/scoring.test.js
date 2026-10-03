// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../lib/analyzer');
const { addSkills } = require('../public/cvedit');
const { evidenceInResume } = require('../lib/llm');
const cases = require('./cases');
const { cleanPdfText } = require('../lib/text');

const layouts = {
  'no skills section': (r) => `Jane Doe\njane@x.com | 555 010 2030\n\nEXPERIENCE\nEngineer, Acme   Jan 2020 - Present\n- ${r}\n\nEDUCATION\nB.S. Computer Science 2019`,
  'skills heading + list': (r) => `Jane Doe\njane@x.com | 555 010 2030\n\nEXPERIENCE\nEngineer, Acme   Jan 2020 - Present\n- ${r}\n\nSKILLS\nPython, Git\n\nEDUCATION\nB.S. Computer Science 2019`,
  'bullet skills last': (r) => `Jane Doe\njane@x.com\n\nEXPERIENCE\nEngineer, Acme   Jan 2020 - Present\n- ${r}\n\nEDUCATION\nB.S. 2019\n\nSKILLS\n- Python\n- Git`,
  'ML skills line (several "Learning")': (r) => `Jane Doe
jane@x.com

EXPERIENCE
Engineer, Acme   Jan 2020 - Present
- ${r}

SKILLS
Machine Learning, Deep Learning, Reinforcement Learning, Transfer Learning, Python

EDUCATION
B.S. 2019`,
  'inline skills': (r) => `Jane Doe\njane@x.com\nSkills: Python, Git\nEXPERIENCE\nEngineer, Acme   Jan 2020 - Present\n- ${r}`,
};

test('adding missing skills to a resume never lowers the (deterministic) score', () => {
  let scenarios = 0;
  for (const c of cases) {
    for (const [layout, make] of Object.entries(layouts)) {
      const text = make(c.resume);
      const before = analyze(text, c.jd);
      const names = before.skills.missing.map((m) => m.name);
      for (const added of names.length ? [names, ...names.map((n) => [n])] : []) {
        const after = analyze(addSkills(text, added), c.jd);
        scenarios++;
        const stillMissing = after.skills.missing.map((m) => m.name).filter((n) => added.includes(n));
        assert.deepEqual(stillMissing, [], `[${c.name} / ${layout}] added but still reported missing`);
        assert.ok(after.score >= before.score, `[${c.name} / ${layout}] adding ${added.join('+')}: ${before.score} -> ${after.score}`);
      }
    }
  }
  assert.ok(scenarios > 100, `only ${scenarios} scenarios ran`);
});

test('evidence must really be in the resume (guards against invented evidence)', () => {
  const resume = 'Trained multi-layer perceptrons with backpropagation for image recognition, improving accuracy by 12%.';
  assert.ok(evidenceInResume('Trained multi-layer perceptrons with backpropagation', resume));
  assert.ok(evidenceInResume('trained multi layer perceptrons, with backpropagation!', resume)); // punctuation/case differences
  assert.ok(!evidenceInResume('Built a transformer language model from scratch', resume));
  assert.ok(!evidenceInResume('Deep Learning', 'Skills: Python, SQL')); // too short / absent
  assert.ok(!evidenceInResume('', resume));
});

test('a skills line with several "Learning" skills is not erased by the "currently learning" rule', () => {
  const jd = 'Requirements\n- Docker\n- Kubernetes\n- Python\n- Deep Learning\n- Reinforcement Learning';
  const r = analyze('Jane\njane@x.com\nSKILLS\nMachine Learning, Deep Learning, Reinforcement Learning, Python, Docker, Kubernetes\nEDUCATION\nB.S.', jd);
  assert.deepEqual(r.skills.missing, []);
});

test('"eager to learn" / "no experience with" are still ignored', () => {
  const jd = 'Requirements\n- Deep Learning\n- SQL';
  const r = analyze('Analyst.\nNo experience with LSTM yet, but eager to learn deep learning.\nInterested in learning TensorFlow.\nSkills: SQL', jd);
  assert.deepEqual(r.skills.missing.map((m) => m.name), ['Deep Learning']);
});

test('PDF text cleanup: letter-spaced headings and trailing spaces', () => {
  const out = cleanPdfText('Jane Doe \nS K I L L S \nPython, SQL \nW O R K  E X P E R I E N C E \nI like A B tests');
  assert.equal(out, 'Jane Doe\nSKILLS\nPython, SQL\nWORK EXPERIENCE\nI like A B tests');
});

test('letter-spaced PDF headings: skills go into the existing Skills section, not a duplicate', () => {
  const pdfText = cleanPdfText('Jane Doe \nE X P E R I E N C E \nEngineer, Acme Jan 2020 – Present \n• Built things \nS K I L L S \nPython, SQL \nE D U C A T I O N \nB.S. 2019 ');
  const out = addSkills(pdfText, ['Docker']);
  assert.equal(out.split('SKILLS').length - 1, 1);
  assert.match(out, /Python, SQL, Docker\n/);
});
