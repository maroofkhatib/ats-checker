// Email via nodemailer. Configure with environment variables:
//   SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS, MAIL_FROM (default SMTP_USER)
//   SMTP_SECURE = ssl (default for 465) | starttls (default otherwise) | none (testing only)
const nodemailer = require('nodemailer');

const configured = () => !!process.env.SMTP_HOST;
let transport = null;

function getTransport() {
  if (transport) return transport;
  const port = +process.env.SMTP_PORT || 465;
  const mode = process.env.SMTP_SECURE || (port === 465 ? 'ssl' : 'starttls');
  const { SMTP_USER: user, SMTP_PASS: pass } = process.env;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: mode === 'ssl',
    requireTLS: mode === 'starttls',
    ignoreTLS: mode === 'none',
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return transport;
}

function sendMail({ to, subject, text }) {
  return getTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
}

module.exports = { sendMail, configured };
