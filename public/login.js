const $ = (id) => document.getElementById(id);
let mode = 'login';

function setMode(m) {
  mode = m;
  $('tabIn').classList.toggle('on', m === 'login');
  $('tabUp').classList.toggle('on', m === 'signup');
  $('go').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('forgotWrap').hidden = m === 'signup';
  $('error').hidden = true;
}
$('tabIn').onclick = () => setMode('login');
$('tabUp').onclick = () => setMode('signup');

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('error'), btn = $('go');
  err.hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch(mode === 'login' ? '/api/login' : '/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    location.href = '/';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// --- Forgot password ---
const show = (forgot) => { $('form').hidden = forgot; $('forgotForm').hidden = !forgot; if (forgot) $('fEmail').value = $('email').value; };
$('forgot').onclick = (e) => { e.preventDefault(); show(true); };
$('back').onclick = (e) => { e.preventDefault(); show(false); };
$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('fMsg'), err = $('fErr'), btn = $('fGo');
  msg.hidden = err.hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch('/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('fEmail').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    msg.textContent = data.message;
    msg.hidden = false;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});
