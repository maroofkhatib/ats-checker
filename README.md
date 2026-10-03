---
title: ATS Resume Checker
emoji: 📄
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# ATS Resume Checker

Upload a resume (PDF or DOCX) and paste a job description to get an ATS match score based on skills, experience, education and resume formatting.

## How the score works

| Component | Weight | What it checks |
|---|---|---|
| Skills | 50% | ~190 known skills (with aliases) found in the job description vs. the resume. "Required" skills count fully, "nice to have" skills count half. |
| Experience | 25% | Years required in the job description vs. years from your resume's date ranges (overlaps merged) or stated "X years of experience". |
| Education | 10% | Degree level required vs. degree level found. |
| ATS formatting | 15% | Contact info, section headings, length, quantified results, action verbs. |

If the job description doesn't mention a component (e.g. no years required), it is left out and the others are re-weighted. The score is a heuristic estimate; real ATS systems vary.

## Run locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Open http://localhost:3000. Set `PORT` to use a different port.

## Run with Docker

```bash
docker build -t ats-checker .
docker run -p 7860:7860 ats-checker
```

Open http://localhost:7860.

## Deploy free on Hugging Face Spaces

The YAML block at the top of this file and the `Dockerfile` (port 7860) are what Spaces needs.

1. Create a Space at https://huggingface.co/new-space — choose **Docker** as the SDK and **Blank** template.
2. Push this repo to it:
   ```bash
   git remote add space https://huggingface.co/spaces/<your-username>/ats-checker
   git push space main
   ```
   (Use a Hugging Face access token with write permission as the password.)
3. Spaces builds the image and serves the app at `https://<your-username>-ats-checker.hf.space`.

## Accounts & login

Users sign up / sign in on `/login.html`; the checker and `/api/analyze` require a session. Everything uses only Node built-ins (no extra packages).

- **Passwords:** salted scrypt hashes, never stored in plain text.
- **User file:** `data/users.json` is AES-256-GCM encrypted (file mode 0600). The key comes from `DATA_KEY`, or is generated in `data/data.key`. Back up the key — without it the accounts can't be read. The folder is git-ignored.
- **Sessions:** signed HttpOnly cookie, valid 7 days, so users stay logged in. Set `SESSION_SECRET` so sessions survive restarts.
- **Delete account:** button in the header; requires the password.
- **Forgot password:** "Forgot password?" on the login page emails a one-hour, single-use reset link (only its hash is stored). The response is identical whether or not the email exists. Resetting signs out all existing sessions.
- Login/signup/reset requests are rate-limited per IP.

### Sending reset emails

Set these environment variables (example for Gmail with an [app password](https://myaccount.google.com/apppasswords)):

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM="ATS Checker <you@gmail.com>"
APP_URL=https://your-site.example.com   # base URL used in the reset link
```

Port 465 uses TLS; other ports use STARTTLS. If `SMTP_HOST` is not set, no email is sent and the reset link is printed to the server console instead (handy for local development). Set `APP_URL` in production so links don't depend on the request's Host header.

On hosts without persistent disk (Render free, Hugging Face Spaces) accounts are lost on redeploy/restart.

## Notes

- Supported inputs: PDF, DOCX, TXT (max 8 MB). Legacy `.doc` is not supported — save as DOCX or PDF.
- Scanned/image-only PDFs have no extractable text and are rejected.
- Files are processed in memory and never stored.
- To add or change recognised skills, edit `lib/skills.js`.

## Project layout

```
server.js        Express server, file upload and text extraction
lib/analyzer.js  Scoring engine
lib/skills.js    Skill dictionary
public/          Front end (HTML, CSS, JS)
samples/         Example resume and job description
```
