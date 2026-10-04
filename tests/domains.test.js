// Run: npm test
// Finance and operations coverage: the keyword + skill-graph layer (no AI) must never credit a skill the labelled
// answer says the resume doesn't have, and may only miss the cases that are deliberately paraphrases for the AI layer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../lib/analyzer');
const { SKILLS } = require('../lib/skills');
const { IMPLIES } = require('../lib/implications');
const cases = require('./cases');

const domain = cases.filter((c) => /^(finance|ops|cross):/.test(c.name));

test('finance/ops: the graph never credits a skill the resume does not show (no false positives)', () => {
  assert.ok(domain.length >= 20, 'expected the finance/ops/cross cases to be present');
  const falsePositives = [];
  for (const c of domain) {
    const got = new Set(analyze(c.resume, c.jd).skills.matched.map((m) => m.name));
    for (const [skill, truth] of Object.entries(c.gold)) if (got.has(skill) && !truth) falsePositives.push(`[${c.name}] ${skill}`);
  }
  assert.deepEqual(falsePositives, []);
});

test('finance/ops: without AI the only misses are the cases written as paraphrases for the AI layer', () => {
  const misses = [];
  for (const c of domain) {
    const got = new Set(analyze(c.resume, c.jd).skills.matched.map((m) => m.name));
    for (const [skill, truth] of Object.entries(c.gold)) if (truth && !got.has(skill)) misses.push(c.name);
  }
  assert.ok(misses.every((n) => /AI case/.test(n)), 'unexpected misses: ' + JSON.stringify([...new Set(misses)]));
});

test('finance/ops: graph links point at real skills, and specific skills imply their field', () => {
  for (const [from, targets] of Object.entries(IMPLIES)) {
    assert.ok(SKILLS[from], 'unknown skill in graph: ' + from);
    for (const to of Object.keys(targets)) assert.ok(SKILLS[to], `unknown target in graph: ${from} -> ${to}`);
  }
  const needs = (jdSkill, resumeText) => analyze(resumeText, `Requirements\n- Experience with ${jdSkill}`).skills.matched.some((m) => m.name === jdSkill);
  assert.ok(needs('Accounting', 'Reconciled bank accounts and ran the month-end close.'));
  assert.ok(needs('Supply Chain Management', 'Managed freight and warehouse operations.'));
  assert.ok(needs('Financial Analysis', 'Built a DCF valuation model.'));
  assert.ok(!needs('Accounting', 'Managed a marketing budget.'));
  assert.ok(!needs('Supply Chain Management', 'Built web apps in React.'));
});

test('words that are ordinary English do not trigger skills on their own', () => {
  const hit = (skill, text) => analyze(text, `Requirements\n- ${skill}`).skills.matched.some((m) => m.name === skill);
  assert.ok(!hit('Lean Manufacturing', 'Worked in a lean startup team.'));
  assert.ok(!hit('Sage Accounting', 'A sage mentor guided me.'));
  assert.ok(!hit('People Management', 'Studied supervised learning methods.'));
  assert.ok(!hit('Accounts Receivable', 'Used Java collections and streams.'));
});
