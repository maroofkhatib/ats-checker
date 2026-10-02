const $ = (id) => document.getElementById(id);
let mode = 'login';

function setMode(m) {
  mode = m;
  $('tabIn').classList.toggle('on', m === 'login');
  $('tabUp').classList.toggle('on', m === 'signup');
  $('go').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
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
