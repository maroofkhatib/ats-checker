// Infers skills a resume implies but never names, using the IMPLIES graph.
const { IMPLIES } = require('./implications');

const MIN_CONF = 0.6;   // ignore links weaker than this (after multiplying along a chain)
const MAX_DEPTH = 3;    // LSTM -> Deep Learning -> Machine Learning is depth 2
const MAX_CONF = 0.95;  // an inferred skill never scores as high as an explicit mention

// supporters[target] = [{ from, conf }]: every skill that implies target, with the best chain confidence.
const supporters = {};
for (const from of Object.keys(IMPLIES)) {
  const best = new Map();
  let frontier = [[from, 1, 0]];
  while (frontier.length) {
    const next = [];
    for (const [node, conf, depth] of frontier) {
      if (depth >= MAX_DEPTH) continue;
      for (const [to, w] of Object.entries(IMPLIES[node] || {})) {
        const c = conf * w;
        if (to !== from && c > (best.get(to) || 0) + 1e-9) { best.set(to, c); next.push([to, c, depth + 1]); }
      }
    }
    frontier = next;
  }
  for (const [to, conf] of best) {
    if (conf >= MIN_CONF - 1e-9) (supporters[to] ||= []).push({ from, conf });
  }
}

// have: Set of skill names found explicitly in the resume.
// Returns { confidence, via } or null. Several independent pieces of evidence combine (noisy-OR).
function infer(target, have) {
  const evidence = (supporters[target] || []).filter((s) => have.has(s.from)).sort((a, b) => b.conf - a.conf);
  if (!evidence.length) return null;
  const top = evidence.slice(0, 3);
  const confidence = Math.min(MAX_CONF, 1 - top.reduce((miss, e) => miss * (1 - e.conf), 1));
  return { confidence: Math.round(confidence * 100) / 100, via: evidence.slice(0, 4).map((e) => e.from) };
}

module.exports = { infer, IMPLIES };
