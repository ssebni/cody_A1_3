import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const loginSection = document.querySelector('#account');
const inviteSection = document.querySelector('#invite');
const memberContent = document.querySelector('#member-content');
const footer = document.querySelector('#site-footer');
const myLink = document.querySelector('#my-link');
const authLink = document.querySelector('#auth-link');

const form = document.querySelector('#login-form');
const status = document.querySelector('#auth-status');
const submit = document.querySelector('#login-submit');
const logout = document.querySelector('#logout-button');
const account = document.querySelector('#account-info');
const inviteForm = document.querySelector('#invite-form');
const inviteSubmit = document.querySelector('#invite-submit');
const inviteStatus = document.querySelector('#invite-status');
const showInviteButton = document.querySelector('#show-invite');
const showLoginButton = document.querySelector('#show-login');
const copyInviteButton = document.querySelector('#copy-invite-code');

let client;
let busy = false;
let loggedIn = false;

function scrollToSection(section) {
  section.hidden = false;
  requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function showLoginPanel() {
  inviteSection.hidden = true;
  scrollToSection(loginSection);
}

function showInvitePanel() {
  loginSection.hidden = true;
  scrollToSection(inviteSection);
}

function showSession(session) {
  loggedIn = Boolean(session?.user);

  memberContent.hidden = !loggedIn;
  footer.hidden = !loggedIn;
  myLink.hidden = !loggedIn;

  form.hidden = loggedIn;
  account.hidden = !loggedIn;
  document.querySelector('#account-email').textContent = session?.user?.email || '';

  if (loggedIn) {
    loginSection.hidden = true;
    inviteSection.hidden = true;
    authLink.textContent = '로그아웃';
    authLink.setAttribute('href', '#home');
  } else {
    loginSection.hidden = true;
    inviteSection.hidden = true;
    authLink.textContent = '로그인';
    authLink.setAttribute('href', '#account');
  }
}

function errorMessage(error) {
  if (error?.code === 'email_not_confirmed') return '이메일 인증을 완료한 뒤 다시 로그인해 주세요.';
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (error?.code === 'invalid_credentials' || error?.status === 400) return '이메일과 비밀번호를 확인해 주세요. 초대 가입을 완료한 계정만 로그인할 수 있습니다.';
  return '로그인 서버에 연결하지 못했습니다. 네트워크를 확인하고 잠시 후 다시 시도해 주세요.';
}

async function initialize() {
  showSession(null);

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) }
    });

    client.auth.onAuthStateChange((_event, session) => showSession(session));

    const { data } = await client.auth.getSession();
    showSession(data.session);

    submit.disabled = false;
    inviteSubmit.disabled = false;
    status.textContent = '이메일과 비밀번호로 로그인하세요.';
    inviteStatus.textContent = '친구에게 받은 초대 코드가 있어야 가입할 수 있습니다.';
  } catch {
    status.textContent = '로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
    inviteStatus.textContent = '가입 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
  }
}

authLink.addEventListener('click', async event => {
  event.preventDefault();

  if (loggedIn) {
    if (!client || busy) return;
    busy = true;
    try {
      await client.auth.signOut();
      showSession(null);
      window.location.hash = 'home';
    } finally {
      busy = false;
    }
    return;
  }

  showLoginPanel();
});

showInviteButton.addEventListener('click', showInvitePanel);
showLoginButton.addEventListener('click', showLoginPanel);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || busy || !form.reportValidity()) return;

  busy = true;
  submit.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = '로그인 정보를 확인하고 있습니다…';

  const password = document.querySelector('#login-password');

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: document.querySelector('#login-email').value.trim(),
      password: password.value
    });
    if (error) throw error;
    if (!data.session) throw new Error('No session');

    showSession(data.session);
    window.location.hash = 'home';
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
    const { error } = await client.auth.signOut();
    if (error) throw error;
    showSession(null);
    window.location.hash = 'home';
  } catch {
    status.textContent = '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.';
  } finally {
    busy = false;
    logout.disabled = false;
  }
});

inviteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!client || busy || !inviteForm.reportValidity()) return;

  busy = true;
  inviteSubmit.disabled = true;
  inviteStatus.textContent = '초대 코드를 확인하고 가입을 진행하고 있습니다…';

  const email = document.querySelector('#invite-email').value.trim();
  const password = document.querySelector('#invite-password').value;
  const code = document.querySelector('#invite-code').value.trim();

  try {
    const response = await fetch('/api/verify_invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, invitation_code: code })
    });

    let result = {};
    try {
      result = await response.json();
    } catch {
      throw new Error('가입 서버 응답을 읽을 수 없습니다.');
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.detail || '초대 코드가 유효하지 않거나 사용할 수 없습니다.');
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (result.my_invite_code) {
      document.querySelector('#my-invite-code').textContent = result.my_invite_code;
    }

    showSession(data.session);
    window.location.hash = 'home';
  } catch (error) {
    inviteStatus.textContent = error?.message || '회원가입을 완료하지 못했습니다.';
  } finally {
    busy = false;
    inviteSubmit.disabled = false;
  }
});

copyInviteButton.addEventListener('click', async () => {
  const code = document.querySelector('#my-invite-code').textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    copyInviteButton.textContent = '복사 완료 ✓';
    setTimeout(() => { copyInviteButton.textContent = '초대 코드 복사하기 ↗'; }, 1400);
  } catch {
    alert(`초대 코드: ${code}`);
  }
});

initialize();
