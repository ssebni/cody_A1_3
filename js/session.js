let client;
let session = null;
const listeners = new Set();
export function setClient(value) { client = value; }
export function getSession() { return session; }
export function setSession(value) {
  const changed = session?.user?.id !== value?.user?.id;
  session = value;
  if (changed || !value) listeners.forEach(callback => callback(value));
}
export function onSession(callback) { listeners.add(callback); callback(session); }
export async function api(path, { body, publicRequest = false, timeout = 45000 } = {}) {
  const form = body instanceof FormData;
  const headers = form ? {} : { 'Content-Type': 'application/json' };
  if (!publicRequest) {
    if (!client) throw new Error('로그인 연결을 확인해 주세요.');
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error('로그인 후 이용해 주세요.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }), signal: controller.signal, cache: 'no-store' });
    const result = await response.json().catch(() => { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
    if (!response.ok) throw new Error(result.error?.message || '처리하지 못했습니다. 다시 시도해 주세요.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('응답이 늦어지고 있습니다. 입력은 유지되며, 저장 상태는 새로고침으로 확인할 수 있습니다.');
    if (error instanceof TypeError) throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}
