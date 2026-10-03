// Authentication: scrypt password hashing, HMAC-signed session cookies, SQLite user store, password-reset tokens.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { db, DATA_DIR } = require('./db');

const scrypt = promisify(crypto.scrypt);
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const COOKIE = 'ats_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 60 * 60 * 1000;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch { /* generate below */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch { /* read-only fs: lasts until restart */ }
  return s;
}
const SECRET = loadSecret();

const q = {
  get: db.prepare('SELECT * FROM users WHERE email = ?'),
  insert: db.prepare('INSERT INTO users (email, salt, hash, created) VALUES (?, ?, ?, ?)'),
  delete: db.prepare('DELETE FROM users WHERE email = ?'),
  setReset: db.prepare('UPDATE users SET reset_hash = ?, reset_created = ?, reset_expires = ? WHERE email = ?'),
  byReset: db.prepare('SELECT * FROM users WHERE reset_hash = ?'),
  setPassword: db.prepare('UPDATE users SET salt = ?, hash = ?, pw_changed = ?, reset_hash = NULL, reset_created = NULL, reset_expires = NULL WHERE email = ?'),
};

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
    const u = q.get.get(e);
    // Reject expired sessions, deleted users, and sessions issued before the last password change.
    return x > Date.now() && u && i >= u.pw_changed ? e : null;
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
const hashPassword = async (pw, salt) => (await scrypt(pw, salt, 64)).toString('hex');
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

async function createUser(email, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  try {
    q.insert.run(email, salt, hash, new Date().toISOString());
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
    throw e;
  }
}
async function verifyUser(email, password) {
  const u = q.get.get(email);
  const hash = await hashPassword(password, u ? u.salt : DUMMY_SALT); // same work either way
  return !!u && safeEq(hash, u.hash);
}
function deleteUser(email) {
  q.delete.run(email);
}

// --- Password reset ---
// Returns a one-time token (only its hash is stored), or null if the user doesn't exist
// or a reset was already requested in the last minute.
function createResetToken(email) {
  const u = q.get.get(email);
  if (!u || (u.reset_created && Date.now() - u.reset_created < 60 * 1000)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  q.setReset.run(sha256(token), now, now + RESET_MS, email);
  return token;
}
async function resetPassword(token, password) {
  const u = q.byReset.get(sha256(String(token || '')));
  if (!u || u.reset_expires < Date.now()) {
    throw Object.assign(new Error('This reset link is invalid or has expired. Request a new one.'), { status: 400 });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  // pw_changed signs out every existing session
  q.setPassword.run(salt, await hashPassword(password, salt), Date.now(), u.email);
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

module.exports = { attachUser, requireAuth, createUser, verifyUser, deleteUser, createResetToken, resetPassword, setSession, clearSession, rateLimit };
