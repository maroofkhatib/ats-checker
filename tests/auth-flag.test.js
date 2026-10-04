// Run: npm test
// Starts the real server twice: login OFF (default) and login ON (AUTH_ENABLED=true), and checks both behave.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const J = { 'Content-Type': 'application/json' };
const RESUME = 'Jane Doe\njane@example.com | +1 555 010 2030\n\nEXPERIENCE\nEngineer, Acme   Jan 2020 - Present\n- Built Python APIs used by 5000 customers, cutting latency by 30%\n- Led a team of 3 engineers\n\nEDUCATION\nB.S. Computer Science 2019\n\nSKILLS\nPython, SQL, Git';
const JD = 'Backend Engineer\nRequirements\n- Python and SQL\n- Experience with Docker';

async function withServer(port, extraEnv, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-flag-'));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', AUTH_ENABLED: '', ...extraEnv };
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 80; i++) { // wait up to ~20s for the server to come up
      try { await fetch(base + '/api/me'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
      if (i === 79) throw new Error('server did not start');
    }
    await fn(base, dataDir);
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows may still hold the file for a moment */ }
  }
}
const manual = { redirect: 'manual' };
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { ...J, ...headers }, body: JSON.stringify(body) });

test('login OFF (default): the main page opens directly and the tools work without signing in', async () => {
  await withServer(3710, {}, async (base, dataDir) => {
    assert.equal((await fetch(base + '/', manual)).status, 200);
    assert.equal((await fetch(base + '/app.js', manual)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/me')).json(), { auth: false });

    // old login links go to the main page
    const l = await fetch(base + '/login.html', manual);
    assert.equal(l.status, 302);
    assert.equal(new URL(l.headers.get('location'), base).pathname, '/');
    assert.equal((await fetch(base + '/reset.html', manual)).status, 302);

    // account endpoints don't exist
    assert.equal((await post(base + '/api/signup', { email: 'a@b.com', password: 'password123' })).status, 404);
    assert.equal((await post(base + '/api/login', { email: 'a@b.com', password: 'password123' })).status, 404);

    // scoring + export work with no cookie
    const r = await post(base + '/api/rescore', { resume: RESUME, jd: JD });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Number.isInteger(body.score));
    assert.ok(body.skills.missing.some((m) => m.name === 'Docker'));
    const d = await post(base + '/api/export-docx', { text: RESUME, template: 'classic' });
    assert.equal(d.status, 200);

    // the account database is not even created while login is off
    assert.equal(fs.existsSync(path.join(dataDir, 'app.db')), false);
  });
});

test('login ON (AUTH_ENABLED=true): pages and tools require a session, accounts still work', async () => {
  await withServer(3711, { AUTH_ENABLED: 'true' }, async (base) => {
    const root = await fetch(base + '/', manual);
    assert.equal(root.status, 302);
    assert.equal(new URL(root.headers.get('location'), base).pathname, '/login.html');
    assert.equal((await fetch(base + '/app.js', manual)).status, 401);
    assert.equal((await fetch(base + '/login.html', manual)).status, 200);
    assert.equal((await post(base + '/api/rescore', { resume: RESUME, jd: JD })).status, 401);

    const su = await post(base + '/api/signup', { email: 'flag@example.com', password: 'password123' });
    assert.equal(su.status, 200);
    const cookie = (su.headers.get('set-cookie') || '').split(';')[0];
    const me = await (await fetch(base + '/api/me', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(me, { auth: true, email: 'flag@example.com' });
    assert.equal((await post(base + '/api/rescore', { resume: RESUME, jd: JD }, { Cookie: cookie })).status, 200);
    assert.equal((await fetch(base + '/', { ...manual, headers: { Cookie: cookie } })).status, 200);
  });
});
