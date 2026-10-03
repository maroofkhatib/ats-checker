// Authentication using only Node built-ins: scrypt password hashing, HMAC-signed session cookies,
// AES-256-GCM encrypted user store, password-reset tokens.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const KEY_FILE = path.join(DATA_DIR, 'data.key');
const COOKIE = 'ats_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// Read a secret from env, else from a 0600 file, else generate it.
function loadOrCreate(envName, file) {
  if (process.env[envName]) return process.env[envName];
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* generate below */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, s, { mode: 0o600 }); } catch { /* read-only fs: lasts until restart */ }
  return s;
}
const SECRET = loadOrCreate('SESSION_SECRET', SECRET_FILE);
const DATA_KEY = crypto.createHash('sha256').update(loadOrCreate('DATA_KEY', KEY_FILE)).digest();

// --- Encrypted user store ---
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', DATA_KEY, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function decrypt(raw) {
  const o = JSON.parse(raw);
  if (o.v !== 1) return raw; // legacy plain JSON, re-encrypted on next save
  const d = crypto.createDecipheriv('aes-256-gcm', DATA_KEY, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8');
}

let users = {};
try {
  users = JSON.parse(decrypt(fs.readFileSync(USERS_FILE, 'utf8')));
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error('Could not read users file (wrong DATA_KEY or corrupted?):', e.message);
    process.exit(1); // refuse to start rather than overwrite existing accounts
  }
}
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, encrypt(JSON.stringify(users)), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}
saveUsers(); // migrates legacy plain files and enforces permissions

// --- Sessions ---
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeToken(email) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ e: email, i: now, x: now + SESSION_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!safeEq(sig, sign(body))) return null;
  try {
    const { e, i = 0, x } = JSON.parse(Buffer.from(body, 'base64url').toString());
    const u = users[e];
    // Reject expired sessions, deleted users, and sessions issued before the last password change.
    return x > Date.now() && u && i >= (u.pwChanged || 0) ? e : null;
  } catch { return null; }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(req, res, email) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// --- Users ---
async function hashPassword(pw, salt) {
  return (await scrypt(pw, salt, 64)).toString('hex');
}
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

async function createUser(email, password) {
  if (users[email]) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
  const salt = crypto.randomBytes(16).toString('hex');
  users[email] = { salt, hash: await hashPassword(password, salt), created: new Date().toISOString() };
  saveUsers();
}
async function verifyUser(email, password) {
  const u = users[email];
  const hash = await hashPassword(password, u ? u.salt : DUMMY_SALT); // same work either way
  return !!u && safeEq(hash, u.hash);
}
function deleteUser(email) {
  delete users[email];
  saveUsers();
}

// --- Password reset ---
// Returns a one-time token (only its hash is stored), or null if the user doesn't exist
// or a reset was already requested in the last minute.
function createResetToken(email) {
  const u = users[email];
  if (!u || (u.reset && Date.now() - u.reset.t < 60 * 1000)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  u.reset = { h: sha256(token), t: Date.now(), x: Date.now() + RESET_MS };
  saveUsers();
  return token;
}
async function resetPassword(token, password) {
  const h = sha256(String(token || ''));
  const email = Object.keys(users).find((e) => users[e].reset && safeEq(users[e].reset.h, h));
  const u = email && users[email];
  if (!u || u.reset.x < Date.now()) {
    throw Object.assign(new Error('This reset link is invalid or has expired. Request a new one.'), { status: 400 });
  }
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = await hashPassword(password, u.salt);
  u.pwChanged = Date.now(); // signs out every existing session
  delete u.reset;
  saveUsers();
}

// Simple in-memory limiter for auth endpoints, per IP and route.
const attempts = new Map();
function rateLimit(max = 10, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || rec.reset < now) attempts.set(key, { n: 1, reset: now + windowMs });
    else if (++rec.n > max) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    next();
  };
}

function attachUser(req, _res, next) {
  req.user = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  next();
}
function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

module.exports = {
  attachUser, requireAuth, createUser, verifyUser, deleteUser, createResetToken, resetPassword,
  setSession, clearSession, rateLimit, validEmail, validPassword,
};
