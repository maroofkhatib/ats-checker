// Inserts skills into the Skills section of plain resume text. Works in the browser and in Node (for tests).
(function (root) {
  const HEADING = /^\s*(summary|profile|professional summary|objective|experience|work experience|professional experience|employment|employment history|education|projects|certifications|achievements|awards|languages|publications|volunteering|interests|references)\s*:?\s*$/i;
  const SKILLS_HEADING = /^\s*(?:technical\s+|key\s+|core\s+)?(?:skills|competencies|technologies)\s*:?\s*$/i;
  const SKILLS_INLINE = /^\s*(?:technical\s+|key\s+|core\s+)?skills\s*:\s*\S/i;
  const BULLET = /^\s*[-•*▪●◦]\s+/;

  // ALL-CAPS line = heading, unless it looks like a skill entry (bullet, comma list, or a short acronym such as SQL/AWS)
  const isAllCapsHeading = (l) => { const t = l.trim(); return t.length >= 4 && t.length <= 40 && /[A-Z]/.test(t) && !/[a-z]/.test(t) && !/\d{3,}/.test(t) && !BULLET.test(l) && !t.includes(','); };
  const isHeading = (l) => HEADING.test(l) || SKILLS_HEADING.test(l) || isAllCapsHeading(l);
  const has = (line, skill) => new RegExp('(^|[^a-z0-9+#])' + skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9+#])', 'i').test(line);

  function addSkills(text, skills) {
    const seen = new Set();
    const list = (skills || []).map((s) => String(s).trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
    if (!list.length) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);

    // 1) "Skills" heading on its own line: add to the last line of that section
    const h = lines.findIndex((l) => SKILLS_HEADING.test(l));
    if (h !== -1) {
      let end = lines.length;
      for (let i = h + 1; i < lines.length; i++) if (lines[i].trim() && isHeading(lines[i])) { end = i; break; }
      let last = -1;
      for (let i = end - 1; i > h; i--) if (lines[i].trim()) { last = i; break; }
      const section = lines.slice(h + 1, end).join(' ');
      const fresh = list.filter((s) => !has(section, s));
      if (!fresh.length) return text;
      if (last !== -1 && lines[last].includes(',') && !BULLET.test(lines[last])) {
        lines[last] = lines[last].replace(/[,;\s]+$/, '') + ', ' + fresh.join(', ');
      } else {
        lines.splice(last === -1 ? h + 1 : last + 1, 0, fresh.join(', '));
      }
      return lines.join(eol);
    }

    // 2) "Skills: a, b, c" on one line
    const inl = lines.findIndex((l) => SKILLS_INLINE.test(l));
    if (inl !== -1) {
      const fresh = list.filter((s) => !has(lines[inl], s));
      if (!fresh.length) return text;
      lines[inl] = lines[inl].replace(/[,;\s]+$/, '') + ', ' + fresh.join(', ');
      return lines.join(eol);
    }

    // 3) No skills section: add one at the end
    return text.replace(/\s+$/, '') + eol + eol + 'SKILLS' + eol + list.join(', ') + eol;
  }

  const api = { addSkills };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CvEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
