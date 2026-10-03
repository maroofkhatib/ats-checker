// Cleans text extracted from PDFs: trailing spaces, and letter-spaced headings ("S K I L L S" -> "SKILLS").
function cleanPdfText(text) {
  return String(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    // runs of 4+ single capital letters separated by single spaces; words in a heading are separated by 2+ spaces
    .replace(/(?:\b[A-Z] ){3,}[A-Z]\b(?:  +(?:[A-Z] )+[A-Z]\b)*/g, (m) => m.split(/\s{2,}/).map((w) => w.replace(/ /g, '')).join(' '));
}

module.exports = { cleanPdfText };
