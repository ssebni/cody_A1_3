import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const form = document.querySelector('#login-form');
const status = document.querySelector('#auth-status');
const submit = document.querySelector('#login-submit');
const logout = document.querySelector('#logout-button');
const account = document.querySelector('#account-info');
let client;
let busy = false;

function showSession(session) {
  const loggedIn = Boolean(session?.user);
  form.hidden = loggedIn;
  account.hidden = !loggedIn;
  document.querySelector('#account-email').textContent = session?.user?.email || '';
  document.querySelector('#auth-link').textContent = loggedIn ? '계정' : '로그인';
}
function errorMessage(error) {
  if (error?.code === 'email_not_confirmed') return '이메일 인증을 완료한 뒤 다시 로그인해 주세요.';
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (error?.code === 'invalid_credentials' || error?.status === 400) return '이메일과 비밀번호를 확인해 주세요. 초대 가입을 완료한 계정만 로그인할 수 있습니다.';
  return '로그인 서버에 연결하지 못했습니다. 네트워크를 확인하고 잠시 후 다시 시도해 주세요.';
}
async function initialize() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // 초기 연결 단계에서는 브라우저 저장소에 로그인 토큰을 남기지 않습니다.
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }
    });
    client.auth.onAuthStateChange((_event, session) => showSession(session));
    submit.disabled = false;
    status.textContent = '초대 가입을 완료한 계정으로 로그인하세요.';
  } catch {
    status.textContent = '로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || busy || !form.reportValidity()) return;
  busy = true;
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '로그인 정보를 확인하고 있습니다…';
  const password = document.querySelector('#login-password');
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: document.querySelector('#login-email').value.trim(), password: password.value });
    if (error) throw error;
    if (!data.session) throw new Error('No session');
    showSession(data.session);
    status.textContent = '로그인되었습니다. 내친소 회원·초대 관계 연결은 다음 단계에서 진행합니다.';
  } catch (error) {
    status.textContent = errorMessage(error);
  } finally {
    password.value = '';
    busy = false;
    submit.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
logout.addEventListener('click', async () => {
  if (!client || busy) return;
  busy = true;
  logout.disabled = true;
  status.textContent = '로그아웃 중입니다…';
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    showSession(null);
    status.textContent = '로그아웃되었습니다.';
  } catch {
    status.textContent = '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요. 이 시제품은 새로고침하면 로컬 로그인 상태가 초기화됩니다.';
  } finally {
    busy = false;
    logout.disabled = false;
  }
});
initialize();
