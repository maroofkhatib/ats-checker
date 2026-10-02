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
    if (cls) l.className = cls;
    l.textContent = (icon ? icon + ' ' : '') + text;
    el.appendChild(l);
  }
}

function render(r) {
  $('results').hidden = false;
  $('scoreNum').textContent = r.score;
  $('grade').textContent = r.grade;
  $('summary').textContent = `${r.skills.matched.length} of ${r.skills.matched.length + r.skills.missing.length} detected job skills found in your resume.`;
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
  chips($('matched'), r.skills.matched, 'ok', (s) => s.name);
  chips($('missing'), r.skills.missing, (s) => (s.required ? 'no' : 'soft'), (s) => s.name + (s.required ? '' : ' (preferred)'));

  const e = r.experience, ed = r.education;
  li($('facts'), [
    ['', `Required experience: ${e.requiredYears != null ? e.requiredYears + '+ years' : 'not specified'}`],
    ['', `Experience on resume: ~${e.resumeYears} years${e.computedFromDates ? ` (${e.computedFromDates} from dates)` : ''}`],
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
  $('results').scrollIntoView({ behavior: 'smooth' });
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

fetch('/api/me').then((r) => (r.ok ? r.json() : Promise.reject())).then((u) => ($('userEmail').textContent = u.email)).catch(() => (location.href = '/login.html'));
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
