const $ = (id) => document.getElementById(id);
const colorFor = (n) => (n >= 75 ? 'var(--good)' : n >= 50 ? 'var(--mid)' : 'var(--bad)');
let resumeFile = null, jdFile = null;

function setResume(f) {
  resumeFile = f;
  $('fileName').textContent = f ? f.name : 'Drop your resume here or click to browse';
  $('drop').classList.toggle('has', !!f);
}

$('resume').addEventListener('change', (e) => setResume(e.target.files[0] || null));
$('jdFile').addEventListener('change', (e) => {
  jdFile = e.target.files[0] || null;
  $('jdFileName').textContent = jdFile ? jdFile.name : '';
});
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setResume(e.dataTransfer.files[0]); });

function chips(el, items, cls, render) {
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = '<span class="empty">None</span>'; return; }
  for (const it of items) {
    const s = document.createElement('span');
    const r = render(it);
    s.className = 'chip ' + (typeof cls === 'function' ? cls(it) : cls);
    s.textContent = r;
    el.appendChild(s);
  }
}

function li(el, rows) {
  el.innerHTML = '';
  for (const [icon, text, cls] of rows) {
    const l = document.createElement('li');
    const kind = icon === '✅' ? 'pass' : icon === '⚠️' ? 'warn' : ''; // drawn with CSS icons
    if (cls || kind) l.className = cls || kind;
    const kv = !kind && text.match(/^([^:]{2,40}):\s+(.+)$/); // "Label: value" rows get a two-column look
    if (kv) {
      const k = document.createElement('span'); k.className = 'k'; k.textContent = kv[1];
      const v = document.createElement('span'); v.className = 'v'; v.textContent = kv[2];
      l.append(k, v);
    } else l.textContent = text;
    el.appendChild(l);
  }
}

let cv = { jd: '', text: '', added: [], firstScore: null, lastScore: null, lastText: '' };

function updateAddButton() {
  const all = document.querySelectorAll('#picks input');
  const n = document.querySelectorAll('#picks input:checked').length;
  $('rescore').textContent = n ? `Add ${n} selected skill${n === 1 ? '' : 's'} & re-score` : 'Add selected skills & re-score';
  $('pickAll').checked = all.length > 0 && n === all.length;
}

function renderPicks(missing) {
  const box = $('picks');
  box.innerHTML = '';
  const empty = !missing.length;
  $('pickAllRow').hidden = empty;
  $('rescore').hidden = empty;
  if (empty) { box.innerHTML = '<span class="empty">No missing skills detected &mdash; nothing to add.</span>'; return; }
  const ordered = [...missing].sort((a, b) => b.required - a.required);
  ordered.forEach((m, i) => {
    const id = 'pick' + i;
    const row = document.createElement('label');
    row.className = 'pick';
    row.htmlFor = id;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = id; cb.value = m.name;
    const span = document.createElement('span');
    span.textContent = 'I have used ' + m.name + (m.required ? '' : ' (preferred)');
    cb.addEventListener('change', updateAddButton);
    row.append(cb, span);
    box.appendChild(row);
  });
  updateAddButton();
}

function render(r, { rescored = false } = {}) {
  $('results').hidden = false;
  if (!rescored) {
    cv = { jd: r.jdText, text: r.resumeText, added: [], firstScore: r.score, lastScore: r.score, lastText: r.resumeText };
    const isDocx = !!resumeFile && /\.docx$/i.test(resumeFile.name);
    $('downloadOriginal').hidden = !isDocx;
    $('docxHint').hidden = isDocx;
    $('delta').hidden = true;
    $('edError').hidden = true;
  }
  renderPicks(r.skills.missing);
  $('scoreNum').textContent = r.score;
  $('grade').textContent = r.grade;
  $('gradeWrap').style.setProperty('--pill', colorFor(r.score));
  $('ring').style.setProperty('--ringc', colorFor(r.score));
  const note = $('aiNote');
  const msgs = {
    limit: "You've reached today's AI limit, so skills that still needed a fresh AI check were scored by keyword and skill-graph matching only. AI credit already earned for your resume is kept.",
    error: 'AI skill matching was temporarily unavailable, so skills that still needed a fresh AI check were scored by keyword and skill-graph matching only. Try again in a moment. AI credit already earned for your resume is kept.',
  };
  note.textContent = msgs[r.ai && r.ai.status] || '';
  note.hidden = !note.textContent;
  const inferred = r.skills.matched.filter((s) => s.inferred).length;
  $('summary').textContent = `${r.skills.matched.length} of ${r.skills.matched.length + r.skills.missing.length} detected job skills found in your resume` + (inferred ? ` (${inferred} inferred from related skills).` : '.');
  const arc = $('arc');
  arc.style.stroke = colorFor(r.score);
  requestAnimationFrame(() => (arc.style.strokeDashoffset = 326.7 * (1 - r.score / 100)));

  $('bars').innerHTML = '';
  for (const b of r.breakdown) {
    const d = document.createElement('div');
    d.className = 'bar';
    d.innerHTML = `<div class="row"><span>${b.label} <small class="muted">(${b.weight}%)</small></span><b>${b.score}%</b></div><div class="track"><div class="fill"></div></div>`;
    $('bars').appendChild(d);
    const f = d.querySelector('.fill');
    f.style.background = colorFor(b.score);
    requestAnimationFrame(() => (f.style.width = b.score + '%'));
  }

  $('mCount').textContent = r.skills.matched.length;
  $('xCount').textContent = r.skills.missing.length;
  chips($('matched'), r.skills.matched, (s) => (s.inferred ? 'inf' : 'ok'), (s) => (s.inferred ? `${s.name} ← ${s.source === 'ai' ? 'AI: ' : 'inferred from '}${s.via.slice(0, 3).join(', ')}` : s.name));
  chips($('missing'), r.skills.missing, (s) => (s.required ? 'no' : 'soft'), (s) => s.name + (s.required ? '' : ' (preferred)'));

  const e = r.experience, ed = r.education;
  li($('facts'), [
    ['', `Required experience: ${e.requiredYears != null ? e.requiredYears + '+ years' : 'not specified'}`],
    ['', e.resumeYears != null ? `Experience on resume: ~${e.resumeYears} years${e.computedFromDates ? ` (${e.computedFromDates} from dates)` : ''}` : 'Experience on resume: not detected (work dates not readable)'],
    ['', `Education required: ${ed.required || 'not specified'}`],
    ['', `Education found: ${ed.found || 'not detected'}`],
    ...(r.title ? [['', `Job title coverage: ${Math.round(r.title.ratio * 100)}%`]] : []),
  ]);
  li($('checks'), r.format.checks.map((c) => [c.pass ? '✅' : '⚠️', c.label]));
  const tips = $('tips');
  tips.innerHTML = '';
  if (!r.suggestions.length) tips.innerHTML = '<li class="low">Looks great — no major issues found.</li>';
  for (const t of r.suggestions) {
    const l = document.createElement('li');
    l.className = t.level;
    l.textContent = t.text;
    tips.appendChild(l);
  }
  if (!rescored) $('results').scrollIntoView({ behavior: 'smooth' });
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('error');
  err.hidden = true;
  if (!resumeFile) { err.textContent = 'Please choose a resume file.'; err.hidden = false; return; }
  const fd = new FormData();
  fd.append('resume', resumeFile);
  fd.append('jd', $('jd').value);
  if (jdFile) fd.append('jdFile', jdFile);
  const btn = $('go');
  btn.disabled = true; btn.textContent = 'Analyzing…';
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: fd });
    if (res.status === 401) { location.href = '/login.html'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    render(data);
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Analyze match';
  }
});

// Login is optional (server setting AUTH_ENABLED). The account bar is shown only when it is on.
fetch('/api/me')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((u) => { if (u.auth) { $('userEmail').textContent = u.email; $('userbar').hidden = false; } })
  .catch(() => (location.href = '/login.html'));
$('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; });

const dlg = $('delDialog');
$('delete').addEventListener('click', () => { $('delPassword').value = ''; $('delError').hidden = true; dlg.showModal(); $('delPassword').focus(); });
$('delCancel').addEventListener('click', () => dlg.close());
$('delForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('delConfirm'), err = $('delError');
  btn.disabled = true; err.hidden = true;
  try {
    const res = await fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('delPassword').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not delete account.');
    location.href = '/login.html';
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// --- Add missing skills to the CV (the CV text is kept in memory; there is no editable text box) ---
const edError = (msg) => { $('edError').textContent = msg || ''; $('edError').hidden = !msg; };
const showNote = (msg) => { $('delta').textContent = msg; $('delta').hidden = !msg; };

$('pickAll').addEventListener('change', (e) => {
  document.querySelectorAll('#picks input').forEach((c) => (c.checked = e.target.checked));
  updateAddButton();
});

// Adds every ticked skill to the CV text, then clears the ticks. Returns the skills that were ticked.
function applyTicked() {
  const chosen = [...document.querySelectorAll('#picks input:checked')].map((c) => c.value);
  if (chosen.length) {
    cv.text = CvEdit.addSkills(cv.text, chosen);
    for (const c of chosen) if (!cv.added.includes(c)) cv.added.push(c);
    document.querySelectorAll('#picks input:checked').forEach((c) => (c.checked = false));
    updateAddButton();
  }
  return chosen;
}

$('rescore').addEventListener('click', async () => {
  edError('');
  const added = applyTicked();
  if (!added.length && cv.text === cv.lastText) {
    return edError('Tick the missing skills you have (or use "Select all") first, then click this button.');
  }
  const btn = $('rescore');
  btn.disabled = true; btn.textContent = 'Scoring…';
  try {
    const res = await fetch('/api/rescore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: cv.text, jd: cv.jd }) });
    if (res.status === 401) { location.href = '/login.html'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not score the updated CV.');
    render(data, { rescored: true });
    cv.lastScore = data.score;
    cv.lastText = cv.text;
    const d = data.score - cv.firstScore;
    showNote((added.length ? `Added ${added.join(', ')}. ` : '') + `Score: ${cv.firstScore} → ${data.score}` + (d ? ` (${d > 0 ? '+' : ''}${d} vs. your uploaded CV)` : ' (no change)'));
    $('results').scrollIntoView({ behavior: 'smooth' });
  } catch (ex) {
    edError(ex.message);
  } finally {
    btn.disabled = false; updateAddButton();
  }
});

// --- Saving the CV: ask the user where to put it ---
// Chrome/Edge: the system "Save as" dialog (File System Access API) so the user picks the folder and file name.
// Other browsers: a normal download. The dialog must open straight after the click (before the file is built),
// otherwise the browser refuses it, so we open it first and fill the file afterwards.
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const baseName = () => (resumeFile ? resumeFile.name.replace(/\.[^.]+$/, '') : 'resume').replace(/[\\/:*?"<>|]+/g, '').trim() || 'resume';

// build() runs after the dialog and returns { blob, ...anything }. Resolves to { cancelled } or { saved, name, via, ...build result }.
async function saveWithDialog(suggestedName, build) {
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName, startIn: 'documents', types: [{ description: 'Word document', accept: { [DOCX_TYPE]: ['.docx'] } }] });
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true }; // user closed the dialog
      handle = null; // dialog unavailable here (e.g. blocked): use a normal download instead
    }
  }
  let built;
  try {
    built = await build();
    if (handle) {
      const w = await handle.createWritable();
      await w.write(built.blob);
      await w.close();
      return { ...built, saved: true, name: handle.name, via: 'dialog' };
    }
  } catch (e) {
    if (handle && handle.remove) { try { await handle.remove(); } catch { /* leave no empty file behind if we can */ } }
    throw e;
  }
  const url = URL.createObjectURL(built.blob);
  const link = document.createElement('a');
  link.href = url; link.download = suggestedName;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
  return { ...built, saved: true, name: suggestedName, via: 'download' };
}
const whereSaved = (r) => (r.via === 'dialog' ? 'Saved as "' + r.name + '".' : 'Downloaded as "' + r.name + '" (your browser saves it to its download folder).');

$('download').addEventListener('click', async () => {
  edError('');
  const added = applyTicked(); // ticked skills are included in the file too
  const btn = $('download');
  btn.disabled = true;
  try {
    const r = await saveWithDialog(baseName() + '-restyled.docx', async () => {
      const res = await fetch('/api/export-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cv.text, template: $('template').value }) });
      if (res.status === 401) { location.href = '/login.html'; throw new Error('Please sign in.'); }
      if (!res.ok) throw new Error((await res.json()).error || 'Could not create the document.');
      return { blob: await res.blob() };
    });
    if (r.cancelled) return showNote('Save cancelled.');
    showNote(whereSaved(r) + (added.length ? ' It includes ' + added.join(', ') + '. Click "Add selected skills & re-score" to see the updated score.' : ''));
  } catch (ex) {
    edError(ex.message);
  } finally {
    btn.disabled = false;
  }
});

// Word upload: the user's own file with only the new skills added (the server edits just the Skills text).
$('downloadOriginal').addEventListener('click', async () => {
  edError('');
  applyTicked(); // ticked skills are included too
  if (!cv.added.length) return edError('Tick the missing skills you have first, then save.');
  const btn = $('downloadOriginal');
  btn.disabled = true;
  try {
    const r = await saveWithDialog(baseName() + '-updated.docx', async () => {
      const fd = new FormData();
      fd.append('resume', resumeFile);
      fd.append('skills', JSON.stringify(cv.added));
      fd.append('text', cv.text);
      fd.append('template', $('template').value);
      const res = await fetch('/api/export-original', { method: 'POST', body: fd });
      if (res.status === 401) { location.href = '/login.html'; throw new Error('Please sign in.'); }
      if (!res.ok) throw new Error((await res.json()).error || 'Could not create the document.');
      let placed = [];
      try { placed = JSON.parse(decodeURIComponent(res.headers.get('X-Placed') || '[]')); } catch { /* ignore */ }
      return { blob: await res.blob(), mode: res.headers.get('X-Export-Mode'), placed };
    });
    if (r.cancelled) return showNote('Save cancelled.');
    if (r.mode === 'original') {
      const where = [...new Set(r.placed.map((x) => x.section))];
      showNote(whereSaved(r) + (r.placed.length
        ? ' Your original CV now has ' + r.placed.map((x) => x.skill).join(', ') + ' added (in "' + where.join('", "') + '"). Nothing else was changed.'
        : ' Those skills were already listed, so nothing needed to change.'));
    } else {
      showNote(whereSaved(r) + " Couldn't find a safe place in your Word file to add the skills, so this is the restyled version instead.");
    }
  } catch (ex) {
    edError(ex.message);
  } finally {
    btn.disabled = false;
  }
});
