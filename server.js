const express = require('express');
const multer = require('multer');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { analyze } = require('./lib/analyzer');
const auth = require('./lib/auth');
const mailer = require('./lib/mailer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    return (await pdfParse(file.buffer)).text;
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
app.use(express.json({ limit: '10kb' }));
app.use(auth.attachUser);

// --- Auth API ---
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
app.post('/api/signup', auth.rateLimit(), async (req, res) => {
  const email = cleanEmail(req.body.email), password = req.body.password;
  if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!auth.validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    await auth.createUser(email, password);
    auth.setSession(req, res, email);
    res.json({ email });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.post('/api/login', auth.rateLimit(), async (req, res) => {
  const email = cleanEmail(req.body.email), password = req.body.password;
  if (!auth.validEmail(email) || typeof password !== 'string' || !(await auth.verifyUser(email, password))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  auth.setSession(req, res, email);
  res.json({ email });
});
app.post('/api/logout', (_req, res) => { auth.clearSession(res); res.json({ ok: true }); });
app.post('/api/forgot', auth.rateLimit(5), (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!auth.validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
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
app.post('/api/reset', auth.rateLimit(10), async (req, res) => {
  const { token, password } = req.body;
  if (!auth.validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    await auth.resetPassword(token, password);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.delete('/api/account', auth.requireAuth, auth.rateLimit(), async (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !(await auth.verifyUser(req.user, password))) {
    return res.status(403).json({ error: 'Incorrect password.' });
  }
  auth.deleteUser(req.user);
  auth.clearSession(res);
  res.json({ ok: true });
});
app.get('/api/me', auth.requireAuth, (req, res) => res.json({ email: req.user }));

// --- Page gate: the checker UI requires a session; the login page does not ---
app.get(['/', '/index.html'], (req, res, next) => (req.user ? next() : res.redirect('/login.html')));
app.get('/app.js', (req, res, next) => (req.user ? next() : res.status(401).end()));
app.get('/login.html', (req, res, next) => (req.user ? res.redirect('/') : next()));
app.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', auth.requireAuth, upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'jdFile', maxCount: 1 }]), async (req, res) => {
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
    res.json(analyze(resume, jd));
  } catch (e) {
    console.error(e);
    res.status(422).json({ error: e.message || 'Failed to analyze files.' });
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 8 MB).' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ATS Checker running at http://localhost:${PORT}`));
