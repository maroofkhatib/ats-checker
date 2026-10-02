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

Users sign up / sign in on `/login.html`; the checker and `/api/analyze` require a session. Auth uses only Node built-ins (no extra packages): scrypt-hashed passwords, HMAC-signed HttpOnly cookies (7 days), and per-IP rate limiting on login/signup.

- Users are stored in `data/users.json` (git-ignored). Set `DATA_DIR` to change the location.
- Set `SESSION_SECRET` in production so sessions survive restarts; otherwise one is generated in `data/session-secret`.
- On hosts without persistent disk (Render free, Hugging Face Spaces) accounts are lost on redeploy/restart.

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
