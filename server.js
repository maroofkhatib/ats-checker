require('./lib/env');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const mammoth = require('mammoth');
const { analyze } = require('./lib/analyzer');
const llm = require('./lib/llm');
const schemas = require('./lib/schemas');
const { buildDocx } = require('./lib/cv');
const { extractPdfText } = require('./lib/pdftext');
const { addSkillsToDocx } = require('./lib/docxedit');
const { rateLimit } = require('./lib/ratelimit');
const { validate } = schemas;

// Login is switched OFF by default: the main page opens directly. All the login code is kept; set AUTH_ENABLED=true
// to turn accounts back on (sign-up, sign-in, password reset, delete account). The database and mailer are only
// loaded when it is on.
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const auth = AUTH_ENABLED ? require('./lib/auth') : null;
const mailer = AUTH_ENABLED ? require('./lib/mailer') : null;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    return extractPdfText(file.buffer);
  }
  if (name.endsWith('.docx')) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (name.endsWith('.txt')) return file.buffer.toString('utf8');
  if (name.endsWith('.doc')) {
    throw new Error('Legacy .doc files are not supported. Please save as .docx or PDF.');
  }
  throw new Error('Unsupported file type. Upload a PDF or DOCX.');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
  // Pages only use same-origin scripts/styles. Don't force https on plain-http local development.
  contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null } },
  strictTransportSecurity: process.env.NODE_ENV === 'production',
}));
app.use(['/api/rescore', '/api/export-docx'], express.json({ limit: '400kb' }));
app.use(express.json({ limit: '10kb' }));

// Without login every visitor is "guest:<ip>", which the per-user AI limit and AI cache key on.
const attachUser = AUTH_ENABLED ? auth.attachUser : (req, _res, next) => { req.user = `guest:${req.ip}`; next(); };
const requireAuth = AUTH_ENABLED ? auth.requireAuth : (_req, _res, next) => next();
app.use(attachUser);

if (AUTH_ENABLED) {
  // --- Auth API ---
  app.post('/api/signup', rateLimit(), validate(schemas.signup), async (req, res) => {
    const { email, password } = req.data;
    try {
      await auth.createUser(email, password);
      auth.setSession(req, res, email);
      res.json({ email });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  app.post('/api/login', rateLimit(), validate(schemas.login, 'Incorrect email or password.'), async (req, res) => {
    const { email, password } = req.data;
    if (!(await auth.verifyUser(email, password))) return res.status(401).json({ error: 'Incorrect email or password.' });
    auth.setSession(req, res, email);
    res.json({ email });
  });
  app.post('/api/logout', (_req, res) => { auth.clearSession(res); res.json({ ok: true }); });
  app.post('/api/forgot', rateLimit(5), validate(schemas.forgot), (req, res) => {
    const { email } = req.data;
    // Same response whether or not the account exists, sent before any work, so it can't be used to probe emails.
    res.json({ message: 'If an account exists for that email, a password reset link has been sent.' });
    const token = auth.createResetToken(email);
    if (!token) return;
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base.replace(/\/$/, '')}/reset.html?token=${token}`;
    if (!mailer.configured()) {
      console.log(`[mail not configured] Password reset link for ${email}: ${link}`);
      return;
    }
    mailer.sendMail({
      to: email,
      subject: 'Reset your ATS Resume Checker password',
      text: `Someone asked to reset the password for this account.

Reset it here (valid for 1 hour):
${link}

If this wasn't you, ignore this email and your password will stay the same.`,
    }).catch((e) => console.error('Failed to send reset email:', e.message));
  });
  app.post('/api/reset', rateLimit(10), validate(schemas.reset), async (req, res) => {
    try {
      await auth.resetPassword(req.data.token, req.data.password);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  app.delete('/api/account', requireAuth, rateLimit(), validate(schemas.deleteAccount, 'Incorrect password.'), async (req, res) => {
    if (!(await auth.verifyUser(req.user, req.data.password))) return res.status(403).json({ error: 'Incorrect password.' });
    auth.deleteUser(req.user);
    auth.clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/me', requireAuth, (req, res) => res.json({ auth: true, email: req.user }));

  // --- Page gate: the checker UI requires a session; the login page does not ---
  app.get(['/', '/index.html'], (req, res, next) => (req.user ? next() : res.redirect('/login.html')));
  app.get('/app.js', (req, res, next) => (req.user ? next() : res.status(401).end()));
  app.get('/login.html', (req, res, next) => (req.user ? res.redirect('/') : next()));
} else {
  // Login is off: tell the page so it hides the account controls, and send old login links to the main page.
  app.get('/api/me', (_req, res) => res.json({ auth: false }));
  app.get(['/login.html', '/reset.html'], (_req, res) => res.redirect('/'));
}
app.use(express.static(path.join(__dirname, 'public')));

const AI_DAILY_LIMIT = +process.env.AI_DAILY_LIMIT || 40;
const aiUse = new Map(); // user (email, or guest:<ip> when login is off) -> { day, n }   (in memory: resets on restart)
function takeAiQuota(user) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = aiUse.get(user);
  if (!rec || rec.day !== day) { aiUse.set(user, { day, n: 1 }); return true; }
  return ++rec.n <= AI_DAILY_LIMIT;
}

// Remembered AI judgements, so re-scoring after edits gives the same credit for the same evidence and never
// depends on the daily limit or a flaky API call. A credit is reused only while its quoted evidence is still in the resume.
const aiCache = new Map(); // "user|jdHash|skill" -> { confidence, evidence }
const jdKey = (jd) => crypto.createHash('sha256').update(jd).digest('hex').slice(0, 16);
function rememberCredits(user, jd, credits) {
  for (const [skill, c] of credits) aiCache.set(`${user}|${jdKey(jd)}|${skill}`, c);
  while (aiCache.size > 5000) aiCache.delete(aiCache.keys().next().value);
}
function recalledCredits(user, jd, resume, names) {
  const out = new Map();
  for (const n of names) {
    const c = aiCache.get(`${user}|${jdKey(jd)}|${n}`);
    if (c && llm.evidenceInResume(c.evidence, resume)) out.set(n, c);
  }
  return out;
}

// Keyword + graph scoring, then the optional AI pass over still-unmatched skills.
async function runAnalysis(resume, jd, user) {
  let result = analyze(resume, jd);
  const unmatched = result.skills.missing.map((m) => m.name);
  const aiInfo = { enabled: llm.enabled(), status: 'off' };
  if (aiInfo.enabled && unmatched.length) {
    const credits = recalledCredits(user, jd, resume, unmatched);
    const toAsk = unmatched.filter((n) => !credits.has(n));
    aiInfo.status = 'ok';
    if (toAsk.length) {
      if (!takeAiQuota(user)) aiInfo.status = 'limit';
      else {
        const ai = await llm.inferSkills(resume, toAsk);
        if (!ai) aiInfo.status = 'error';
        else { aiInfo.model = ai.model; rememberCredits(user, jd, ai.credits); for (const [k, v] of ai.credits) credits.set(k, v); }
      }
    }
    if (credits.size) result = analyze(resume, jd, { aiCredits: credits });
  }
  result.ai = aiInfo;
  // Returned so the page can offer an editable copy of the resume and re-score it without re-uploading.
  result.resumeText = resume;
  result.jdText = jd;
  return result;
}

app.post('/api/analyze', requireAuth, rateLimit(60), upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'jdFile', maxCount: 1 }]), async (req, res) => {
  try {
    const resumeFile = req.files?.resume?.[0];
    if (!resumeFile) return res.status(400).json({ error: 'Please upload a resume (PDF or DOCX).' });
    let jd = (req.body.jd || '').trim();
    const jdFile = req.files?.jdFile?.[0];
    if (!jd && jdFile) jd = (await extractText(jdFile)).trim();
    if (jd.length < 40) return res.status(400).json({ error: 'Please paste (or upload) a job description of reasonable length.' });

    const resume = (await extractText(resumeFile)).trim();
    if (resume.length < 100) {
      return res.status(422).json({ error: 'Could not read enough text from the resume. It may be a scanned image — ATS systems cannot read those either. Use a text-based PDF or DOCX.' });
    }
    res.json(await runAnalysis(resume, jd, req.user));
  } catch (e) {
    console.error(e);
    res.status(422).json({ error: e.message || 'Failed to analyze files.' });
  }
});

app.post('/api/rescore', requireAuth, rateLimit(40), validate(schemas.rescore), async (req, res) => {
  try {
    res.json(await runAnalysis(req.data.resume.trim(), req.data.jd.trim(), req.user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not score the updated resume.' });
  }
});
app.post('/api/export-docx', requireAuth, rateLimit(40), validate(schemas.exportDocx), async (req, res) => {
  try {
    const buf = await buildDocx(req.data.text, req.data.template);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="updated-resume.docx"',
    });
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create the document.' });
  }
});

// For Word uploads: return the user's OWN file with only the new skills added (design, images, fonts untouched).
// If a safe place can't be found (or the upload isn't a .docx), fall back to the restyled document built from the text.
app.post('/api/export-original', requireAuth, rateLimit(40), upload.single('resume'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Please upload your resume again to download it.' });
    let skills = [];
    try { skills = JSON.parse(req.body.skills || '[]'); } catch { /* ignore */ }
    skills = (Array.isArray(skills) ? skills : []).filter((x) => typeof x === 'string' && x.length > 0 && x.length < 60).slice(0, 80);
    const template = ['modern', 'classic', 'minimal'].includes(req.body.template) ? req.body.template : 'modern';
    const text = String(req.body.text || '').slice(0, 100000);
    const base = (file.originalname || 'resume').replace(/\.[^.]+$/, '').replace(/[^\w .()-]+/g, '').trim() || 'resume';

    let mode = 'restyled', out = null, placed = [];
    if (/\.docx$/i.test(file.originalname || '')) {
      try {
        const r = await addSkillsToDocx(file.buffer, skills);
        out = r.buffer; placed = r.placed; mode = 'original';
      } catch (e) {
        console.error('in-place DOCX edit failed, using the restyled version:', e.message);
      }
    }
    if (!out) {
      if (text.length < 10) return res.status(400).json({ error: 'Nothing to export.' });
      out = await buildDocx(text, template);
    }
    res.set({
      'X-Export-Mode': mode,
      'X-Placed': encodeURIComponent(JSON.stringify(placed)),
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    res.attachment(base + (mode === 'original' ? '-updated.docx' : '-restyled.docx'));
    res.send(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create the document.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 8 MB).' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ATS Checker running at http://localhost:${PORT} (login ${AUTH_ENABLED ? 'ON' : 'off'})`));
