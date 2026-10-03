require('../lib/env');
// Compares keyword-only vs keyword+graph vs keyword+graph+AI against tests/cases.js.
// Run: npm run eval            (AI row runs only when ANTHROPIC_API_KEY is set; costs a few cents)
//      LLM_MODEL=claude-sonnet-5-5 npm run eval   to compare models
//      npm run eval -- --no-ai  to skip the AI row
const { analyze } = require('../lib/analyzer');
const llm = require('../lib/llm');
const cases = require('./cases');

const PRICE = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] }; // $ per 1M tokens (in, out)

async function run(mode) {
  let tp = 0, fp = 0, fn = 0, tn = 0, inTok = 0, outTok = 0, calls = 0;
  const errors = [];
  for (const c of cases) {
    let r;
    if (mode === 'keyword') r = analyze(c.resume, c.jd, { inference: false });
    else {
      r = analyze(c.resume, c.jd);
      const unmatched = r.skills.missing.map((m) => m.name);
      if (mode === 'ai' && unmatched.length) {
        const ai = await llm.inferSkills(c.resume, unmatched);
        if (ai) {
          calls++; inTok += ai.usage.input_tokens; outTok += ai.usage.output_tokens;
          r = analyze(c.resume, c.jd, { aiCredits: ai.credits });
        }
      }
    }
    const got = new Set(r.skills.matched.map((m) => m.name));
    for (const [skill, truth] of Object.entries(c.gold)) {
      const pred = got.has(skill);
      if (pred && truth) tp++;
      else if (pred && !truth) { fp++; errors.push(`FALSE POSITIVE  [${c.name}] ${skill}`); }
      else if (!pred && truth) { fn++; errors.push(`MISSED          [${c.name}] ${skill}`); }
      else tn++;
    }
  }
  const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1);
  return { tp, fp, fn, tn, precision, recall, f1: (2 * precision * recall) / (precision + recall || 1), errors, inTok, outTok, calls };
}

(async () => {
  const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
  const useAi = llm.enabled() && !process.argv.includes('--no-ai');
  const rows = [['keyword only', await run('keyword')], ['keyword + graph', await run('graph')]];
  if (useAi) rows.push([`+ AI (${llm.MODEL})`, await run('ai')]);
  const n = rows[0][1];
  console.log(`${cases.length} cases, ${n.tp + n.fp + n.fn + n.tn} labelled skill decisions\n`);
  console.log('                                  precision  recall     F1    (TP FP FN TN)');
  for (const [label, m] of rows) {
    console.log(`${label.padEnd(32)}  ${pct(m.precision)}   ${pct(m.recall)}  ${pct(m.f1)}   (${m.tp} ${m.fp} ${m.fn} ${m.tn})`);
  }
  for (const [label, m] of rows) {
    if (label.includes('graph') && !label.includes('AI')) { console.log(`\nErrors, ${label}:`); console.log(m.errors.length ? m.errors.map((e) => '  ' + e).join('\n') : '  none'); }
  }
  if (useAi) {
    const m = rows[2][1];
    const [pi, po] = PRICE[llm.MODEL] || [0, 0];
    const cost = (m.inTok * pi + m.outTok * po) / 1e6;
    console.log(`\nErrors, with AI:`); console.log(m.errors.length ? m.errors.map((e) => '  ' + e).join('\n') : '  none');
    console.log(`\nAI usage: ${m.calls} calls, ${m.inTok} in / ${m.outTok} out tokens, ~$${cost.toFixed(4)} total, ~$${(cost / (m.calls || 1)).toFixed(4)} per call`);
  } else console.log('\n(AI row skipped: no ANTHROPIC_API_KEY or --no-ai)');
})();
