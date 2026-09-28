import { api, getSession, onSession } from './session.js';
const $ = selector => document.querySelector(selector);
let state = null, selected = null, epoch = 0, loadVersion = 0;
let filter = 'all';
const statusNames = { draft: '가입 대기', pending: '승인 대기', published: '공개 중', hidden: '비공개', accepted: '매칭 성사', declined: '거절됨', cancelled: '취소됨' };
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, callback, className = 'secondary') {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', () => callback(node));
  return node;
}
function empty(target, message) { target.replaceChildren(el('p', message, 'muted')); }
function distanceText(value) { return value === null ? '연결된 초대 관계 없음' : `나와 ${value}촌`; }
function description(profile, target) {
  target.append(el('h3', profile.nickname), el('p', `${profile.age_band} · ${profile.region}`, 'meta'), el('p', profile.introduction, 'quote'));
  const tags = el('div', undefined, 'tags');
  profile.hobbies.forEach(hobby => tags.append(el('span', hobby)));
  target.append(tags);
}
async function perform(control, status, work) {
  if (control.disabled) return;
  const current = epoch;
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  status.textContent = '처리하고 있습니다…';
  try { await work(() => current === epoch); }
  catch (error) { if (current === epoch) status.textContent = error.message; }
  finally { control.disabled = false; control.removeAttribute('aria-busy'); }
}
async function refresh() {
  const current = epoch, version = ++loadVersion;
  $('#data-status').textContent = '회원 정보를 불러오고 있습니다…';
  try {
    const data = await api('/api/state');
    if (current !== epoch || version !== loadVersion) return;
    state = data;
    renderAll();
    $('#data-status').textContent = '';
  } catch (error) {
    if (current !== epoch || version !== loadVersion) return;
    state = null;
    clearData();
    $('#data-status').textContent = error.message + ' 위의 새로고침으로 다시 불러올 수 있습니다.';
  }
}
function clearData() {
  ['profiles', 'requests', 'received-requests', 'own-profile', 'authored-profiles', 'invitation-list'].forEach(id => empty(document.getElementById(id), '회원 정보를 불러온 뒤 표시됩니다.'));
  $('#contact-value').value = '';
  $('#request-count').textContent = '0';
  $('#profile-invitation').replaceChildren(new Option('초대 코드를 먼저 발급하세요', ''));
}
onSession(session => {
  epoch++;
  state = null;
  selected = null;
  $('#profile-dialog').close();
  clearData();
  ['profile-form','intro-form','contact-form'].forEach(id => document.getElementById(id).reset());
  resetProfile();
  $('#ai-result').value = '';
  $('#ai-result-panel').hidden = true;
  $('#new-invite').hidden = true;
  $('#my-invite-code').textContent = '';
  ['profile-status','intro-status','invitation-status','contact-status','approval-status','global-status','data-status'].forEach(id => { document.getElementById(id).textContent = ''; });
  if (session) refresh();
});
$('#refresh-data').addEventListener('click', refresh);
function renderProfiles() {
  const target = $('#profiles');
  target.replaceChildren();
  for (const profile of state?.profiles || []) {
    if (filter !== 'all' && profile.distance !== Number(filter)) continue;
    const card = el('article', undefined, 'card');
    const portrait = el('div', undefined, 'portrait');
    portrait.style.setProperty('--tone', '#e3e9db');
    portrait.append(el('span', distanceText(profile.distance), 'distance'), el('span', '🌿'));
    const body = el('div', undefined, 'card-body');
    description(profile, body);
    body.append(button(`${profile.nickname}님 소개 보기 ↗`, () => {
      selected = profile;
      $('#detail').replaceChildren();
      description(profile, $('#detail'));
      $('#detail').append(el('p', distanceText(profile.distance), 'muted'));
      $('#match-status').textContent = '';
      const existing = state.matches.some(m => m.other_id === profile.owner_id && ['pending','accepted'].includes(m.status));
      $('#match-button').disabled = existing;
      $('#match-button').textContent = existing ? '이미 진행 중인 매칭입니다' : '연락처 공유에 동의하고 매칭 요청';
      $('#profile-dialog').showModal();
    }, 'detail-button'));
    card.append(portrait, body);
    target.append(card);
  }
  if (!target.children.length) empty(target, '아직 이 조건에 맞는 공개 프로필이 없어요. 지인을 초대하고 소개를 준비해 보세요.');
}
document.querySelectorAll('[data-distance]').forEach(control => control.addEventListener('click', () => {
  filter = control.dataset.distance;
  document.querySelectorAll('[data-distance]').forEach(other => {
    other.classList.toggle('active', control === other);
    other.setAttribute('aria-pressed', String(control === other));
  });
  renderProfiles();
}));
$('#close-dialog').addEventListener('click', () => $('#profile-dialog').close());
$('#match-button').addEventListener('click', () => {
  if (!selected) return;
  const recipient = selected.owner_id;
  perform($('#match-button'), $('#match-status'), async alive => {
    await api('/api/matches', { body: { recipient_id: recipient } });
    if (!alive()) return;
    $('#profile-dialog').close();
    $('#global-status').textContent = '매칭 요청을 보냈습니다. 마이페이지에서 진행 상황을 확인하세요.';
    await refresh();
  });
});
function renderMatches(outgoing, target) {
  target.replaceChildren();
  const rows = state.matches.filter(m => m.outgoing === outgoing);
  if (!rows.length) return empty(target, outgoing ? '아직 보낸 요청이 없습니다.' : '아직 받은 요청이 없습니다.');
  rows.forEach(match => {
    const item = el('div', undefined, 'list-item');
    item.append(el('strong', match.name), el('p', match.status === 'pending' ? '응답 대기' : statusNames[match.status], 'meta'));
    if (match.contact) item.append(el('p', `공유된 연락 방법: ${match.contact}`, 'contact-shared'));
    const status = el('p', '', 'inline-status'); status.setAttribute('role','status');
    if (match.status === 'pending') {
      const actions = el('div', undefined, 'actions');
      const choices = outgoing ? [['cancelled','요청 취소']] : [['accepted','연락처 공유에 동의하고 수락'],['declined','거절']];
      choices.forEach(([next, label]) => actions.append(button(label, control => perform(control, status, async alive => {
        await api('/api/match-response', { body: { id: match.id, status: next } });
        if (!alive()) return;
        status.textContent = '처리되었습니다.';
        await refresh();
      }))));
      item.append(actions);
    }
    item.append(status); target.append(item);
  });
}
function renderAll() {
  renderProfiles();
  renderMatches(true, $('#requests'));
  renderMatches(false, $('#received-requests'));
  $('#request-count').textContent = state.matches.filter(m => m.outgoing).length;
  if (document.activeElement !== $('#contact-value')) $('#contact-value').value = state.contact || '';
  const own = $('#own-profile'); own.replaceChildren();
  const profile = state.own_profile;
  if (!profile) empty(own, '아직 연결된 프로필이 없습니다. 주선자가 프로필을 연결한 초대 코드로 가입해야 내 소개가 나타납니다.');
  else {
    description(profile, own);
    own.append(el('p', statusNames[profile.status], 'pill'));
    const publish = profile.status !== 'published';
    own.append(button(publish ? '이 내용을 확인하고 공개 승인' : '내 프로필 비공개로 전환', control => perform(control, $('#approval-status'), async alive => {
      await api('/api/profile-approval', { body: { id: profile.id, publish, version: profile.updated_at } });
      if (!alive()) return;
      $('#approval-status').textContent = publish ? '공개 승인했습니다.' : '비공개로 전환했습니다.';
      await refresh();
    })));
  }
  const authored = $('#authored-profiles'); authored.replaceChildren();
  state.authored.forEach(profile => {
    const item = el('div', undefined, 'list-item');
    item.append(el('strong', profile.nickname), el('p', statusNames[profile.status], 'meta'), button('소개 수정하기', () => editProfile(profile)));
    authored.append(item);
  });
  if (!state.authored.length) empty(authored, '아직 소개한 지인이 없습니다. 초대 코드를 발급하고 첫 소개를 준비해 보세요.');
  const invitations = $('#invitation-list'); invitations.replaceChildren();
  state.invitations.forEach(invite => {
    const expired = Date.parse(invite.expires_at) <= Date.now();
    invitations.append(el('p', `${invite.id.slice(0,8)} · ${invite.used ? '가입 완료' : expired ? '만료' : '가입 대기'} · ${new Date(invite.expires_at).toLocaleDateString('ko-KR')} 만료`, 'meta'));
  });
  if (!state.invitations.length) empty(invitations, '발급한 초대가 없습니다.');
  if (!$('#profile-id').value) renderInviteOptions();
}
function renderInviteOptions(preferred) {
  const select = $('#profile-invitation'), previous = preferred || select.value;
  select.replaceChildren(new Option('초대를 선택하세요', ''));
  (state?.invitations || []).filter(i => !i.used && !i.has_profile && Date.parse(i.expires_at) > Date.now()).forEach(i => select.add(new Option(`${i.id.slice(0,8)} · ${new Date(i.expires_at).toLocaleDateString('ko-KR')} 만료`, i.id)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function resetProfile() {
  $('#profile-form').reset();
  $('#profile-id').value = '';
  $('#profile-invitation').disabled = false;
  $('#profile-invitation').required = true;
  renderInviteOptions();
}
function editProfile(profile) {
  $('#profile-id').value = profile.id;
  $('#profile-invitation').disabled = true;
  $('#profile-invitation').required = false;
  $('#profile-invitation').replaceChildren(new Option('기존 지인의 프로필 수정', ''));
  for (const key of ['nickname','region','introduction']) $(`#profile-${key}`).value = profile[key];
  const age = $('#profile-age');
  if (![...age.options].some(option => option.value === profile.age_band)) age.add(new Option(profile.age_band, profile.age_band));
  age.value = profile.age_band;
  $('#profile-hobbies').value = profile.hobbies.join(', ');
  $('#profile-status').textContent = '수정한 내용은 지인이 다시 승인해야 공개됩니다.';
  location.hash = 'register';
}
$('#reset-profile').addEventListener('click', () => { resetProfile(); $('#profile-status').textContent = ''; });
$('#profile-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.target.reportValidity()) return;
  const body = {
    ...($('#profile-id').value ? { id: $('#profile-id').value } : { invitation_id: $('#profile-invitation').value }),
    nickname: $('#profile-nickname').value.trim(), age_band: $('#profile-age').value, region: $('#profile-region').value.trim(),
    hobbies: $('#profile-hobbies').value.split(',').map(s => s.trim()).filter(Boolean), introduction: $('#profile-introduction').value.trim()
  };
  perform(event.submitter, $('#profile-status'), async alive => {
    await api('/api/profile', { body });
    if (!alive()) return;
    resetProfile();
    $('#profile-status').textContent = '저장했습니다. 지인이 가입하고 내용을 승인하면 공개됩니다.';
    await refresh();
  });
});
$('#issue-invite').addEventListener('click', () => perform($('#issue-invite'), $('#invitation-status'), async alive => {
  const result = await api('/api/invitations', { body: {} });
  if (!alive()) return;
  $('#my-invite-code').textContent = result.code;
  $('#new-invite').hidden = false;
  $('#invitation-status').textContent = '발급했습니다. 코드를 복사해서 보관하세요.';
  await refresh();
  if (alive() && !$('#profile-id').value) renderInviteOptions(result.id);
}));
$('#copy-invite-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#my-invite-code').textContent); $('#invitation-status').textContent = '초대 코드를 복사했습니다.'; }
  catch { $('#invitation-status').textContent = '복사하지 못했습니다. 위의 코드를 직접 선택해 복사해 주세요.'; }
});
$('#contact-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.target.reportValidity()) return;
  perform(event.submitter, $('#contact-status'), async alive => {
    await api('/api/contact', { body: { contact_value: $('#contact-value').value.trim() } });
    if (alive()) { $('#contact-status').textContent = '저장했습니다. 매칭이 성사된 상대에게만 공개됩니다.'; await refresh(); }
  });
});
$('#intro-form').addEventListener('submit', event => {
  event.preventDefault();
  const notes = $('#notes').value.trim();
  if (notes.length < 20 || notes.length > 1000) { $('#intro-status').textContent = '앞뒤 공백을 제외하고 20~1,000자를 입력해 주세요.'; return; }
  perform(event.submitter, $('#intro-status'), async alive => {
    $('#ai-result-panel').hidden = true;
    $('#intro-status').textContent = '친구의 매력을 소개글로 다듬고 있어요. 최대 45초 정도 걸릴 수 있습니다…';
    const result = await api('/api/introduction', { body: { notes } });
    if (!alive()) return;
    $('#ai-result').value = result.introduction;
    $('#ai-result-panel').hidden = false;
    $('#intro-status').textContent = '초안을 만들었습니다. 사실과 다른 내용이 없는지 확인하고 수정해 주세요.';
  });
});
$('#use-intro').addEventListener('click', () => {
  $('#profile-introduction').value = $('#ai-result').value;
  location.hash = 'register';
  $('#profile-introduction').focus();
});
const tabs = [...document.querySelectorAll('[role="tab"]')];
function activate(tab) {
  tabs.forEach(other => {
    const active = tab === other;
    other.setAttribute('aria-selected', String(active)); other.tabIndex = active ? 0 : -1;
    other.classList.toggle('active', active);
    document.getElementById(other.getAttribute('aria-controls')).hidden = !active;
  });
}
tabs.forEach((tab,index) => {
  tab.addEventListener('click', () => activate(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowRight: (index+1)%tabs.length, ArrowLeft: (index-1+tabs.length)%tabs.length, Home: 0, End: tabs.length-1 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); activate(tabs[next]); tabs[next].focus();
  });
});
