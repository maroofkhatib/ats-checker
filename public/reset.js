const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');
history.replaceState(null, '', location.pathname); // keep the token out of the address bar / history

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('error'), btn = $('go');
  err.hidden = true;
  if ($('password').value !== $('confirm').value) { err.textContent = 'Passwords do not match.'; err.hidden = false; return; }
  btn.disabled = true;
  try {
    const res = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: $('password').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    $('ok').hidden = false;
    btn.hidden = true;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
  }
});
