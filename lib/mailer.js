// Minimal SMTP client using only Node built-ins (net/tls). Configure with environment variables:
//   SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS, MAIL_FROM (default SMTP_USER)
//   SMTP_SECURE = ssl (default for 465) | starttls (default otherwise) | none (testing only)
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const configured = () => !!process.env.SMTP_HOST;
const clean = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();

function makeReader(sock) {
  let buf = '';
  let pending = null;
  const check = () => {
    if (!pending) return;
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3}( |$)/.test(lines[i])) {
        const text = lines.slice(0, i + 1).join('\n');
        buf = lines.slice(i + 1).join('\r\n');
        const p = pending;
        pending = null;
        return p.resolve({ code: +text.slice(0, 3), text });
      }
    }
  };
  sock.on('data', (d) => { buf += d.toString('utf8'); check(); });
  sock.on('error', (e) => pending && pending.reject(e));
  sock.on('close', () => pending && pending.reject(new Error('SMTP connection closed')));
  return () => new Promise((resolve, reject) => { pending = { resolve, reject }; check(); });
}

async function sendMail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const port = +process.env.SMTP_PORT || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = clean(process.env.MAIL_FROM || user || 'no-reply@localhost');
  const secure = process.env.SMTP_SECURE || (port === 465 ? 'ssl' : 'starttls');
  const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];

  let sock = secure === 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  sock.setTimeout(20000, () => sock.destroy(new Error('SMTP timeout')));
  let read = makeReader(sock);

  const expect = async (codes, label) => {
    const r = await read();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${label} failed: ${r.text}`);
    return r;
  };
  const cmd = async (line, codes, label) => { sock.write(line + '\r\n'); return expect(codes, label || line.split(' ')[0]); };

  try {
    await expect([220], 'greeting');
    await cmd(`EHLO ${process.env.SMTP_EHLO || 'localhost'}`, [250]);
    if (secure === 'starttls') {
      await cmd('STARTTLS', [220]);
      sock.removeAllListeners('data');
      sock = tls.connect({ socket: sock, servername: host });
      sock.setTimeout(20000, () => sock.destroy(new Error('SMTP timeout')));
      read = makeReader(sock);
      await cmd(`EHLO ${process.env.SMTP_EHLO || 'localhost'}`, [250]);
    }
    if (user && pass) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(Buffer.from(user).toString('base64'), [334], 'AUTH user');
      await cmd(Buffer.from(pass).toString('base64'), [235], 'AUTH password');
    }
    await cmd(`MAIL FROM:<${clean(fromAddr)}>`, [250]);
    await cmd(`RCPT TO:<${clean(to)}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const msg = [
      `From: ${from}`,
      `To: ${clean(to)}`,
      `Subject: ${clean(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@ats-checker>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '.',
    ].join('\r\n');
    await cmd(msg, [250], 'message');
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}

module.exports = { sendMail, configured };
