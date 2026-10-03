// SQLite storage (better-sqlite3). Creates the schema and, once, imports accounts from the old encrypted users.json.
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email         TEXT PRIMARY KEY,
    salt          TEXT NOT NULL,
    hash          TEXT NOT NULL,
    created       TEXT NOT NULL,
    pw_changed    INTEGER NOT NULL DEFAULT 0,
    reset_hash    TEXT,
    reset_created INTEGER,
    reset_expires INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_users_reset ON users(reset_hash);
`);
try { fs.chmodSync(path.join(DATA_DIR, 'app.db'), 0o600); } catch { /* not supported on this fs */ }

// --- one-time import from the previous JSON store (AES-256-GCM, key in DATA_KEY or data/data.key) ---
(function migrateLegacy() {
  const file = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(file)) return;
  let users;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const o = JSON.parse(raw);
    if (o && o.v === 1) {
      const keyFile = path.join(DATA_DIR, 'data.key');
      const secret = process.env.DATA_KEY || fs.readFileSync(keyFile, 'utf8').trim();
      const key = crypto.createHash('sha256').update(secret).digest();
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
      d.setAuthTag(Buffer.from(o.tag, 'base64'));
      users = JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'));
    } else users = o;
  } catch (e) {
    console.error(`Could not import legacy ${file} (${e.message}); leaving it untouched.`);
    return;
  }
  const insert = db.prepare('INSERT OR IGNORE INTO users (email, salt, hash, created, pw_changed, reset_hash, reset_created, reset_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const run = db.transaction((entries) => {
    for (const [email, u] of entries) {
      insert.run(email, u.salt, u.hash, u.created || new Date().toISOString(), u.pwChanged || 0, u.reset?.h ?? null, u.reset?.t ?? null, u.reset?.x ?? null);
    }
  });
  run(Object.entries(users));
  fs.renameSync(file, file + '.migrated');
  console.log(`Imported ${Object.keys(users).length} account(s) from users.json into SQLite (old file kept as users.json.migrated).`);
})();

module.exports = { db, DATA_DIR };
