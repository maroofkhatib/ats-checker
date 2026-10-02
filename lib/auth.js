// Authentication using only Node built-ins: scrypt password hashing, HMAC-signed session cookies, JSON file user store.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const COOKIE = 'ats_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { /* first run */ }
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users));
  fs.renameSync(tmp, USERS_FILE);
}

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8'); } catch { /* generate below */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch { /* read-only fs: secret lasts until restart */ }
  return s;
}
const SECRET = loadSecret();

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function makeToken(email) {
  const body = Buffer.from(JSON.stringify({ e: email, x: Date.now() + SESSION_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!safeEq(sig, sign(body))) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return x > Date.now() && users[e] ? e : null;
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

// Simple in-memory limiter for login/signup attempts per IP.
const attempts = new Map();
function rateLimit(max = 10, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const now = Date.now();
    const rec = attempts.get(req.ip);
    if (!rec || rec.reset < now) attempts.set(req.ip, { n: 1, reset: now + windowMs });
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

module.exports = { attachUser, requireAuth, createUser, verifyUser, deleteUser, setSession, clearSession, rateLimit, validEmail, validPassword };
