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

## Add missing skills to your CV

After a check, the "Add missing skills to your CV" card lists the skills the job wants that your resume lacks. Tick only the ones you genuinely have (or use **Select all**), then click **Add selected skills & re-score**: they are added to your resume's Skills section (or a new one) and the new score is shown next to the original. **Download updated CV (DOCX)** exports the same updated resume. Nothing is added unless the user ticks it. There is no editable text box; the resume text is kept in memory on the page. `npm test` covers the insertion logic and the export.
### Keeping your own Word design

If the uploaded resume is a **.docx**, **Download my original CV with the new skills** returns the user's own file with only the new skills added. A .docx is a zip of XML parts; the server (`lib/docxedit.js`) finds the Skills section, appends the skills to the matching sub-group (e.g. tools vs. team skills) using the list's own separator (`,`, `•`, ...) and the formatting of the text it extends, or adds new bullets / a new Skills section styled like the existing headings. Every other part of the file (photo, fonts, styles, tables, text boxes, headers) is carried over byte-for-byte; tests check this. The file is processed in memory and not stored.

If no safe place can be found, or the upload is a PDF (which has no editable structure), the site falls back to the restyled document below and says so.

### Resume export

**Download as DOCX** rebuilds the resume as a polished, single-column, ATS-friendly Word document in one of three styles (Modern, Classic, Minimal). The text is first parsed into name, contact line, summary, jobs/education with right-aligned dates, bullets, and labelled skills, then rendered with real Word styling. The original PDF/Word file's own layout is not preserved. Parsing is heuristic, so unusual layouts may be arranged differently.

## Login is currently switched off

By default the site has **no login**: it opens straight to the checker and anyone can use it. All the account code is still in the repo and is switched on with one setting:

```bash
AUTH_ENABLED=true npm start     # or set AUTH_ENABLED=true in .env / your host's environment
```

With it off, the database and email modules are never loaded (no `data/` folder is created), `/login.html` redirects to the main page, and the account endpoints do not exist. Visitors are told apart by IP address, which the per-user AI limit and the rate limits use. **If you set `ANTHROPIC_API_KEY` while login is off, anyone who finds the site can trigger AI calls on your key** (limited by `AI_DAILY_LIMIT` per IP and the rate limiter); keep that in mind before making the site public.

## Accounts & login (only when `AUTH_ENABLED=true`)

Users sign up / sign in on `/login.html`; the checker and `/api/analyze` require a session.

- **Storage:** accounts live in a SQLite database (`data/app.db`, via better-sqlite3). Passwords are salted scrypt hashes, never plain text. An older `data/users.json` is imported automatically on first start and kept as `users.json.migrated`.
- **Sessions:** signed HttpOnly cookie valid for 7 days, so users stay logged in. Set `SESSION_SECRET` so sessions survive restarts.
- **Delete account:** button in the header; requires the password.
- **Forgot password:** emails a one-hour, single-use reset link (only its hash is stored). The response is identical whether or not the email exists. Resetting signs out all existing sessions.
- **Validation and headers:** request bodies are validated with zod; helmet sets security headers (CSP, nosniff, HSTS in production). Login/signup/reset are rate-limited per IP.
- Set `NODE_ENV=production` when serving over HTTPS (enables HSTS and `upgrade-insecure-requests`).

### Sending reset emails (nodemailer)

Example for Gmail with an [app password](https://myaccount.google.com/apppasswords):

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM="ATS Checker <you@gmail.com>"
APP_URL=https://your-site.example.com   # base URL used in the reset link
```

Port 465 uses TLS; other ports use STARTTLS. If `SMTP_HOST` is not set, no email is sent and the reset link is printed to the server console instead (handy for local development). Set `APP_URL` in production so links don't depend on the request's Host header.

### Persisting accounts

The database lives in `data/`. With Docker, mount a volume or accounts are lost when the container is removed:

```bash
docker run -d -p 7860:7860 -v ats-data:/app/data ats-checker
```

On hosts without persistent disk (Render free, Hugging Face Spaces) accounts are lost on redeploy/restart.

## AI skill inference (optional)

Skills are matched by keywords, then by a skill graph that infers implied skills (e.g. LSTM and autoencoders imply Deep Learning). If `ANTHROPIC_API_KEY` is set (put it in a git-ignored `.env`), Claude Haiku 4.5 is also asked about job skills that are still unmatched, and must quote evidence from the resume. If the API is unavailable the app falls back to the graph.

- `AI_DAILY_LIMIT` (default 20) caps AI-assisted checks per user per day; `LLM_MODEL` changes the model; `LLM_ENABLED=false` turns it off.
- Resume text is sent to the Anthropic API when this is enabled. Say so in your privacy notice.
- `npm run eval` scores keyword-only vs graph vs AI on the labelled cases in `tests/cases.js` (the AI row makes real API calls).

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
lib/implications.js  Skill graph: which skills imply others
lib/skillgraph.js    Inference over that graph
lib/llm.js       Optional Claude skill inference
lib/auth.js      Sessions, passwords, reset tokens
lib/db.js        SQLite schema + legacy import
lib/mailer.js    nodemailer wrapper
lib/schemas.js   zod request validation
lib/cv.js        DOCX export
public/cvedit.js Inserts skills into the resume text (also unit-tested in Node)
tests/           Labelled evaluation cases and runner
public/          Front end (HTML, CSS, JS)
samples/         Example resume and job description
```
