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
docker run -p 3000:3000 ats-checker
```

Open http://localhost:3000.

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
