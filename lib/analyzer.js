const { SKILLS } = require('./skills');
const { infer } = require('./skillgraph');

const STOP = new Set(`a about above after again all also an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your
ability able across additional applicants apply based benefits candidate candidates company compensation consider day demonstrated description duties employer equal excellent experience experienced following full good great help include includes including job join knowledge looking make must need new office opportunity paid part per plus position preferred qualifications required requirements responsibilities responsible role salary seeking skills strong team time understanding use using want well work working year years etc ensure within will`.split(/\s+/));

const DEGREES = [
  { level: 4, label: 'Doctorate', re: /\b(ph\.?d|doctorate|doctoral)\b/i },
  { level: 3, label: "Master's", re: /\b(master'?s?|m\.?s\.?c?|m\.?tech|mba|m\.?eng)\b(?!\w)/i },
  { level: 2, label: "Bachelor's", re: /\b(bachelor'?s?|b\.?s\.?c?|b\.?tech|b\.?e\.?|b\.?a\.?|undergraduate|bca)\b(?!\w)/i },
  { level: 1, label: 'Associate/Diploma', re: /\b(associate'?s?|diploma)\b/i },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
// Normalise typographic characters (written as \u escapes on purpose: this file must survive any editor/encoding).
const norm = (t) => t
  .replace(/[\u2018\u2019\u201A\u2032]/g, "'")          // curly quotes -> '
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2010-\u2015\u2212]/g, '-')              // hyphens, en dash, em dash, minus -> -
  .replace(/[\u00A0\u2007\u2009\u202F]/g, ' ');       // non-breaking / thin spaces -> space

function aliasRegex(alias) {
  return new RegExp(`(?<![a-z0-9+#.])${esc(alias)}(?![a-z0-9+#]|\\.[a-z0-9])`, 'i');
}
const SKILL_RES = Object.entries(SKILLS).map(([name, aliases]) => ({
  name,
  res: [name.toLowerCase(), ...aliases].map(aliasRegex),
}));

function countSkill(text, entry) {
  let n = 0;
  for (const re of entry.res) {
    const g = new RegExp(re.source, 'gi');
    n += (text.match(g) || []).length;
  }
  return n;
}

// Drop clauses where the candidate says they lack or are only learning a skill, so they earn no credit.
const NEGATED = [
  // "no experience with X", "limited exposure to X", "without any background in X"
  /\b(?:no|not any|little|limited|without|lack(?:s|ing)?(?: of)?|never (?:used|worked|had))\s+(?:prior |professional |hands-on |direct |formal )*(?:experience|exposure|knowledge|background|familiarity)[^.\n;]*/gi,
  // an intent word AND "to learn" / "in learning": "eager to learn X", "interested in learning X". A bare "learning" (Machine Learning) never triggers this.
  /\b(?:eager|keen|hop(?:e|es|ing)|want(?:s|ing)?|plan(?:s|ning)?|look(?:s|ing)?|interested|aim(?:s|ing)?)\b[^.\n;,]{0,25}?\b(?:to learn|to study|to pick up|in learning)\b[^.\n;]*/gi,
  /\bcurrently (?:learning|studying)\b[^.\n;]*/gi,
];
const stripNegated = (t) => NEGATED.reduce((acc, re) => acc.replace(re, ' '), t);

// ---------- Job description parsing ----------
function parseJD(jd) {
  const lines = norm(jd).split(/\r?\n/);
  let mode = 'required';
  const reqText = [], prefText = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const short = line.length < 70;
    if (short && /(nice to have|preferred|bonus|desirable|good to have|a plus|extra credit)/i.test(line)) mode = 'preferred';
    else if (short && /(requirements?|qualifications?|responsibilit|must have|what you|who you|about the role|skills|you will)/i.test(line)) mode = 'required';
    const inlinePref = /(nice to have|preferred|bonus|a plus|desirable|good to have)/i.test(line);
    (mode === 'preferred' || inlinePref ? prefText : reqText).push(line);
  }
  return { required: reqText.join('\n'), preferred: prefText.join('\n') };
}

function extractJDSkills(jd) {
  const { required, preferred } = parseJD(jd);
  const out = [];
  for (const e of SKILL_RES) {
    const r = countSkill(required, e), p = countSkill(preferred, e);
    if (!r && !p) continue;
    const isReq = r > 0;
    out.push({ name: e.name, weight: (isReq ? 1 : 0.5) * (1 + Math.min(r + p - 1, 3) * 0.15), required: isReq, entry: e });
  }
  return out;
}

// ---------- Experience ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// One date: "Jan 2013", "January, 2013", "Jan'13", "Jan '13", "03/2013", "03.2013", "03-2013" or just "2013".
const DATE_RE = `(?:${MONTH_RE}\\.?,?\\s*(?:'\\s?\\d{2}|\\d{4})|\\d{1,2}\\s?[\\/.\\-]\\s?\\d{4}|(?:19|20)\\d{2})`;
const OPEN_END = '(?:present|currently|current|now|today|ongoing|till\\s+date|to\\s+date|till\\s+now|until\\s+now|up\\s+to\\s+date|date)';
const RANGE_RE = `(?<!\\d)(${DATE_RE})\\s*(?:-|to|until|till|through|thru)\\s*(${DATE_RE}|${OPEN_END})(?![\\d])`;
const SINCE_RE = `\\bsince\\s+(${DATE_RE})`;
const EDU_HEAD = /^(education|academic|qualifications?|certifications?|courses?|training)\b/i;
const OTHER_HEAD = /^(experience|work|employment|professional|career|projects?|internships?|skills|summary|profile|objective|achievements|awards|languages|publications|volunteer|references|interests)\b/i;

function parseDate(tok, now) {
  const t = tok.toLowerCase().trim();
  if (new RegExp('^' + OPEN_END + '$').test(t)) return now.getFullYear() * 12 + now.getMonth();
  let m = t.match(new RegExp('^(' + MONTH_RE + ')\\.?,?\\s*(?:\'\\s?(\\d{2})|(\\d{4}))$'));
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3)];
    let y = m[3] ? +m[3] : 2000 + +m[2];
    if (!m[3] && y > now.getFullYear() + 1) y -= 100;
    return y * 12 + mon;
  }
  m = t.match(/^(\d{1,2})\s?[\/.\-]\s?(\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[2] * 12 + (+m[1] - 1);
  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return +m[1] * 12 + 6; // a bare year counts as mid-year
  return null;
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const NUM = '(\\d{1,2}|' + Object.keys(NUM_WORDS).join('|') + ')';
const toNum = (s) => (/^\d+$/.test(s) ? +s : NUM_WORDS[s.toLowerCase()]);

// "11 years of experience", "11+ years' experience", "experience of 11 years", "over eleven years" (intro only)
function statedYears(text) {
  const found = [];
  const add = (re, scope) => { for (const m of scope.matchAll(re)) { const n = toNum(m[1]); if (n >= 1 && n <= 45) found.push(n); } };
  add(new RegExp(NUM + "\\+?\\s*(?:years?|yrs?)'?\\s+(?:of\\s+)?(?:[\\w\\-&,/]+\\s+){0,4}?(?:experience|expertise)", 'gi'), text);
  add(new RegExp("(?:experience|expertise)\\s*(?:of|:|-|spanning|totall?ing)?\\s*(?:over|more than|around|about|nearly|almost)?\\s*" + NUM + '\\+?\\s*(?:years?|yrs?)', 'gi'), text);
  add(new RegExp('(?:over|more than|around|nearly|almost|about)\\s+' + NUM + '\\+?\\s*(?:years?|yrs?)(?!\\s+(?:old|ago))', 'gi'), text.slice(0, 800));
  return found.length ? Math.max(...found) : 0;
}

function resumeYears(text) {
  const now = new Date();
  const spans = [];
  let inEducation = false;
  for (const line of text.split(/\r?\n/)) {
    const head = line.trim().replace(/:$/, '');
    if (head && head.length < 40) { // short line: maybe a section heading
      if (EDU_HEAD.test(head)) inEducation = true;
      else if (OTHER_HEAD.test(head)) inEducation = false;
    }
    if (inEducation) continue; // years of study are not years of work
    let m;
    const range = new RegExp(RANGE_RE, 'gi');
    while ((m = range.exec(line))) {
      const a = parseDate(m[1], now), b = parseDate(m[2], now);
      if (a != null && b != null && b >= a && b - a <= 12 * 45) spans.push([a, b]);
    }
    const since = new RegExp(SINCE_RE, 'gi');
    while ((m = since.exec(line))) {
      const a = parseDate(m[1], now);
      if (a != null && now.getFullYear() * 12 + now.getMonth() >= a) spans.push([a, now.getFullYear() * 12 + now.getMonth()]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); // overlapping jobs count once
    else merged.push([...s]);
  }
  const computed = Math.round((merged.reduce((t, [x, y]) => t + (y - x), 0) / 12) * 10) / 10;
  const stated = statedYears(text);
  const years = Math.max(computed, stated);
  return { computed, stated, years, known: years > 0 };
}

function jdYears(jd) {
  const nums = [];
  const re = /(\d{1,2})\s*(?:\+|-|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)/gi;
  let m;
  while ((m = re.exec(jd))) {
    const ctx = jd.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    if (/experience|exp\b|background|working|professional/i.test(ctx) && +m[1] <= 25) nums.push(+m[1]);
  }
  return nums.length ? Math.min(...nums) === Math.max(...nums) ? nums[0] : Math.min(...nums) : null;
}

function bestDegree(text) {
  let best = null;
  for (const d of DEGREES) if (d.re.test(text)) { best = d; break; }
  return best;
}

// ---------- Format / ATS-friendliness ----------
function formatCheck(text) {
  const lower = text.toLowerCase();
  const checks = [];
  const add = (label, pass, tip, pts) => checks.push({ label, pass, tip, pts });
  add('Email address', /[\w.+-]+@[\w-]+\.[\w.]+/.test(text), 'Add a professional email address.', 10);
  add('Phone number', /(\+?\d[\d\s().-]{8,}\d)/.test(text), 'Add a phone number.', 8);
  add('Experience section', /\b(work experience|professional experience|experience|employment)\b/.test(lower), 'Add a clearly labelled "Experience" heading.', 15);
  add('Education section', /\b(education|academic|university|college)\b/.test(lower), 'Add a clearly labelled "Education" heading.', 12);
  add('Skills section', /\b(skills|technical skills|core competencies|technologies)\b/.test(lower), 'Add a dedicated "Skills" section listing your tools and technologies.', 15);
  add('Summary / profile', /\b(summary|profile|objective|about me)\b/.test(lower), 'Add a 2-3 line professional summary tailored to the job.', 8);
  const words = text.split(/\s+/).filter(Boolean).length;
  add('Appropriate length (250-1200 words)', words >= 250 && words <= 1200, words < 250 ? 'Resume looks short; expand on achievements.' : 'Resume is long; trim to the most relevant 1-2 pages.', 12);
  const metrics = (text.match(/\b\d+(?:[.,]\d+)?\s?(%|k\b|m\b|x\b|\+)|\$\s?\d|\u20B9\s?\d|\b\d{2,}\s+(users|customers|clients|projects|engineers|people|team|members)/gi) || []).length;
  add('Quantified achievements', metrics >= 3, 'Add measurable results (e.g. "reduced latency by 35%").', 12);
  const verbs = (lower.match(/\b(led|built|designed|developed|implemented|managed|created|improved|reduced|increased|launched|delivered|optimized|architected|automated|achieved|drove|owned)\b/g) || []).length;
  add('Strong action verbs', verbs >= 5, 'Start bullets with action verbs such as "Built", "Led", "Optimized".', 8);
  return { checks, words, metrics, verbs, score: checks.reduce((s, c) => s + (c.pass ? c.pts : 0), 0) / checks.reduce((s, c) => s + c.pts, 0) };
}

// ---------- Main ----------
const clamp = (x) => Math.max(0, Math.min(1, x));

function analyze(resumeRaw, jdRaw, { inference = true, aiCredits = null } = {}) {
  const resume = norm(resumeRaw), jd = norm(jdRaw);
  const rLower = resume.toLowerCase();

  // Skills
  const jdSkills = extractJDSkills(jd);
  const matched = [], missing = [];
  const resumeCounts = new Map();
  const skillText = stripNegated(resume);
  for (const e of SKILL_RES) {
    const n = countSkill(skillText, e);
    if (n) resumeCounts.set(e.name, n);
  }
  const haveSkills = new Set(resumeCounts.keys());
  let got = 0, total = 0;
  for (const s of jdSkills) {
    total += s.weight;
    const n = resumeCounts.get(s.name);
    const inf = !n && inference ? infer(s.name, haveSkills) : null;
    const ai = !n && !inf && aiCredits ? aiCredits.get(s.name) : null;
    if (n) { got += s.weight; matched.push({ name: s.name, required: s.required, count: n }); }
    else if (inf) { got += s.weight * inf.confidence; matched.push({ name: s.name, required: s.required, count: 0, inferred: true, confidence: inf.confidence, via: inf.via }); }
    else if (ai && ai.confidence >= 0.6) { got += s.weight * ai.confidence; matched.push({ name: s.name, required: s.required, count: 0, inferred: true, source: 'ai', confidence: ai.confidence, via: [ai.evidence] }); }
    else missing.push({ name: s.name, required: s.required });
  }
  const resumeSkills = [...haveSkills];
  const extraSkills = resumeSkills.filter((n) => !jdSkills.some((s) => s.name === n));
  const skillRatio = total ? got / total : null;

  // Experience
  const need = jdYears(jd);
  const have = resumeYears(resume);
  let expRatio;
  if (!have.known) expRatio = null; // couldn't read any dates: leave experience out of the score instead of scoring 0
  else if (need == null) expRatio = 0.85;
  else expRatio = clamp(have.years / need);
  if (have.known && need != null && have.years >= need * 0.8 && have.years < need) expRatio = Math.max(expRatio, 0.85);

  // Education
  const needDeg = bestDegree(jd.slice(0, 4000).split('\n').filter((l) => /degree|bachelor|master|ph\.?d|diploma|b\.?tech|b\.?s\b|m\.?s\b|education/i.test(l)).join('\n'));
  const haveDeg = bestDegree(resume);
  let eduRatio;
  if (!needDeg) eduRatio = haveDeg ? 1 : 0.7;
  else if (!haveDeg) eduRatio = 0.2;
  else eduRatio = clamp(haveDeg.level >= needDeg.level ? 1 : 0.5 + 0.25 * (haveDeg.level - needDeg.level + 1));

  // Job title
  const titleMatch = (() => {
    const first = jd.split('\n').map((l) => l.trim()).find((l) => l && l.length < 80) || '';
    const tWords = first.toLowerCase().replace(/^(job title|title|position|role)\s*:/, '').match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) || [];
    if (!tWords.length) return null;
    const hit = tWords.filter((w) => rLower.includes(w)).length;
    return { title: first, ratio: hit / tWords.length };
  })();

  const fmt = formatCheck(resume);

  // Weighted blend; re-normalise if a component is not applicable
  const parts = [
    { key: 'skills', label: 'Skills match', weight: 50, ratio: skillRatio },
    { key: 'experience', label: 'Experience match', weight: 25, ratio: expRatio },
    { key: 'education', label: 'Education match', weight: 10, ratio: eduRatio },
    { key: 'format', label: 'ATS formatting', weight: 15, ratio: fmt.score },
  ].filter((p) => p.ratio != null);
  const wsum = parts.reduce((s, p) => s + p.weight, 0);
  let score = parts.reduce((s, p) => s + p.ratio * p.weight, 0) / wsum * 100;
  if (titleMatch && titleMatch.ratio < 0.34) score -= 3;
  score = Math.round(Math.max(0, Math.min(100, score)));
  const breakdown = parts.map((p) => ({ key: p.key, label: p.label, weight: p.weight, score: Math.round(p.ratio * 100) }));

  // Suggestions
  const tips = [];
  const reqMissing = missing.filter((m) => m.required);
  if (reqMissing.length) tips.push({ level: 'high', text: `Add these required skills if you have them (in your Skills section and in experience bullets): ${reqMissing.slice(0, 10).map((m) => m.name).join(', ')}.` });
  const prefMissing = missing.filter((m) => !m.required);
  if (prefMissing.length) tips.push({ level: 'low', text: `Nice-to-have skills missing: ${prefMissing.slice(0, 8).map((m) => m.name).join(', ')}.` });
  if (!have.known && need != null) tips.push({ level: 'medium', text: "We couldn't read the dates in your work history, so experience wasn't scored. Write each role's dates like 'Jan 2019 - Present' (or 'Jan 2019 - Mar 2022'), or state 'X years of experience' in your summary." });
  if (have.known && need != null && have.years < need) tips.push({ level: 'high', text: `The job asks for ~${need}+ years of experience; your resume shows ~${have.years}. Make sure all roles have clear start/end dates and highlight the most relevant work.` });
  if (needDeg && (!haveDeg || haveDeg.level < needDeg.level)) tips.push({ level: 'medium', text: `The job mentions a ${needDeg.label} degree; ${haveDeg ? `your resume shows ${haveDeg.label}` : 'no degree was detected on your resume'}.` });
  if (titleMatch && titleMatch.ratio < 0.5) tips.push({ level: 'medium', text: `Your resume rarely mentions the job title ("${titleMatch.title}"). Mirror it in your headline or summary when accurate.` });
  for (const c of fmt.checks) if (!c.pass) tips.push({ level: 'low', text: c.tip });

  return {
    score,
    grade: score >= 85 ? 'Excellent match' : score >= 70 ? 'Good match' : score >= 50 ? 'Fair match' : 'Low match',
    breakdown,
    skills: { matched, missing, extra: extraSkills.slice(0, 20) },
    experience: { requiredYears: need, resumeYears: have.known ? have.years : null, computedFromDates: have.computed, statedYears: have.stated },
    education: { required: needDeg?.label || null, found: haveDeg?.label || null },
    title: titleMatch,
    format: { checks: fmt.checks.map(({ label, pass }) => ({ label, pass })), words: fmt.words },
    suggestions: tips,
  };
}

module.exports = { analyze };
