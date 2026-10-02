const express = require('express');
const multer = require('multer');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { analyze } = require('./lib/analyzer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    return (await pdfParse(file.buffer)).text;
  }
  if (name.endsWith('.docx')) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (name.endsWith('.txt')) return file.buffer.toString('utf8');
  if (name.endsWith('.doc')) {
    throw new Error('Legacy .doc files are not supported. Please save as .docx or PDF.');
  }
  throw new Error('Unsupported file type. Upload a PDF or DOCX.');
}

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'jdFile', maxCount: 1 }]), async (req, res) => {
  try {
    const resumeFile = req.files?.resume?.[0];
    if (!resumeFile) return res.status(400).json({ error: 'Please upload a resume (PDF or DOCX).' });
    let jd = (req.body.jd || '').trim();
    const jdFile = req.files?.jdFile?.[0];
    if (!jd && jdFile) jd = (await extractText(jdFile)).trim();
    if (jd.length < 40) return res.status(400).json({ error: 'Please paste (or upload) a job description of reasonable length.' });

    const resume = (await extractText(resumeFile)).trim();
    if (resume.length < 100) {
      return res.status(422).json({ error: 'Could not read enough text from the resume. It may be a scanned image — ATS systems cannot read those either. Use a text-based PDF or DOCX.' });
    }
    res.json(analyze(resume, jd));
  } catch (e) {
    console.error(e);
    res.status(422).json({ error: e.message || 'Failed to analyze files.' });
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 8 MB).' : err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ATS Checker running at http://localhost:${PORT}`));
