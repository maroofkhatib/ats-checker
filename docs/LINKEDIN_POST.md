# LinkedIn post drafts

Fill in the two placeholders (live link and your own sentence about why you built it) before posting. Attach the demo GIF or MP4 as the media; put the links in the first comment if you want better reach, or in the post if you prefer.

## Version A (recommended, about 200 words)

Most people never find out why their CV gets rejected.

So I built a tool to show them. Upload your CV (PDF or Word), paste a job description, and it tells you how well they match, which skills you're missing, and lets you add the ones you genuinely have and re-score in one click.

A few things I enjoyed building:

- Implied skills. If your CV says LSTM and autoencoders, it should be credited for Deep Learning. I built a skill graph for software, data/ML, cloud, finance and operations, plus an optional Claude step that has to quote evidence from the CV before it counts.
- Your design stays yours. For a Word file, only the Skills text is edited inside the file; photos, fonts and layout are left byte for byte untouched.
- Real-world PDFs. The text of PDFs doesn't come out in reading order, so dates jumped to the top of the page. I fixed it by reading text by position.
- A bug that taught me something: CVs using an en dash in their dates were scored as "0 years of experience". Now covered by regression tests.

It's a match estimate, not a simulation of any particular ATS, and my accuracy numbers come from test cases I wrote myself, so treat them as a safety net rather than proof.

Try it: https://ats-checker-md7l.onrender.com
Code: https://github.com/maroofkhatib/ats-checker

What would make a tool like this actually useful to you?

#NodeJS #JavaScript #Resume #JobSearch #BuildInPublic #AI

## Version B (shorter, about 90 words)

I built a resume checker.

Upload a CV and a job description. It scores the match, lists the skills you're missing, and lets you add the ones you really have, then re-score. Word files come back with their original design intact.

Under the hood: a skill graph that understands implied skills (LSTM implies Deep Learning), an optional Claude layer that must quote evidence, PDF reading by position, and 52 automated tests.

It's an estimate, not a real ATS simulation.

Live: https://ats-checker-md7l.onrender.com
Code: https://github.com/maroofkhatib/ats-checker

## First comment (optional)

Stack: Node 20, Express, mammoth, pdf-parse, docx, jszip, zod, SQLite, Claude Haiku 4.5 (optional). Feedback and CV layouts that break it are very welcome: open an issue on the repo.

## Posting tips

- Post Tuesday to Thursday, morning in your main audience's time zone.
- Open the live site just before posting so it isn't asleep when the first people click.
- Reply to every comment in the first hour.
- Don't post screenshots with real names or contact details.
