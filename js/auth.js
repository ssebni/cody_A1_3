import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { api, setClient, setSession, onSession, getSession } from './session.js';
const $ = selector => document.querySelector(selector);
let client;
let busy = false;
function panel(id) {
  $('#account').hidden = id !== 'account';
  $('#invite').hidden = id !== 'invite';
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}
onSession(session => {
  const loggedIn = Boolean(session);
  $('#member-content').hidden = !loggedIn;
  $('#site-footer').hidden = !loggedIn;
  document.querySelectorAll('[data-member-link]').forEach(link => { link.hidden = !loggedIn; });
  $('#auth-link').textContent = loggedIn ? '로그아웃' : '로그인';
  $('#auth-link').href = loggedIn ? '#home' : '#account';
  $('#account').hidden = true;
  $('#invite').hidden = true;
  $('#account-info').hidden = !loggedIn;
  $('#login-form').hidden = loggedIn;
  $('#account-email').textContent = session?.user.email || '';
});
$('#show-invite').addEventListener('click', () => panel('invite'));
$('#show-login').addEventListener('click', () => panel('account'));
$('#hero-start').addEventListener('click', () => getSession() ? $('#explore').scrollIntoView({ behavior: 'smooth' }) : panel('account'));
async function logout() {
  if (!client || busy) return;
  busy = true;
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    setSession(null);
    location.hash = 'home';
  } catch { $('#global-status').textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; }
  finally { busy = false; }
}
$('#auth-link').addEventListener('click', event => {
  event.preventDefault();
  if (getSession()) logout(); else panel('account');
});
$('#logout-button').addEventListener('click', logout);
function authError(error) {
  if (error?.code === 'invalid_credentials') return '이메일과 비밀번호를 확인해 주세요.';
  if (error?.code === 'email_not_confirmed') return '이메일 인증을 완료해 주세요.';
  if (error?.status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  return '로그인하지 못했습니다. 연결 상태와 계정을 확인해 주세요.';
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || busy || !event.target.reportValidity()) return;
  busy = true;
  $('#login-submit').disabled = true;
  $('#auth-status').textContent = '로그인 정보를 확인하고 있습니다…';
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
    if (error || !data.session) throw error;
    setSession(data.session);
    location.hash = 'explore';
  } catch (error) { $('#auth-status').textContent = authError(error); }
  finally { busy = false; $('#login-submit').disabled = false; $('#login-password').value = ''; }
});
$('#invite-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || busy || !event.target.reportValidity()) return;
  busy = true;
  $('#invite-submit').disabled = true;
  $('#invite-status').textContent = '초대 코드를 확인하고 가입하고 있습니다…';
  let joined = false;
  try {
    const email = $('#invite-email').value.trim(), password = $('#invite-password').value;
    await api('/api/verify_invite', { publicRequest: true, body: { email, password,
      invitation_code: $('#invite-code').value.trim(), display_name: $('#invite-name').value.trim(),
      adult_confirmed: $('#adult-confirmed').checked } });
    joined = true;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error;
    event.target.reset();
    setSession(data.session);
    location.hash = 'my';
  } catch (error) {
    $('#invite-status').textContent = joined ? '가입은 완료되었습니다. 로그인 화면에서 다시 로그인해 주세요.' : error.message;
  } finally { busy = false; $('#invite-submit').disabled = false; $('#invite-password').value = ''; }
});
async function initialize() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }
    });
    setClient(client);
    client.auth.onAuthStateChange((_event, session) => {
      // Leave the Supabase auth lock before listeners make another auth call.
      setTimeout(() => setSession(session), 0);
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    setSession(data.session);
    $('#login-submit').disabled = false;
    $('#invite-submit').disabled = false;
    $('#auth-status').textContent = '이메일과 비밀번호로 로그인하세요.';
    $('#invite-status').textContent = '초대 코드는 1회만 사용할 수 있습니다.';
  } catch {
    $('#auth-status').textContent = '로그인 연결을 준비하지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
    $('#invite-status').textContent = $('#auth-status').textContent;
  }
}
initialize();
