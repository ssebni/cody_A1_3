import { api, getSession, onSession } from './session.js?v=7';
const $ = selector => document.querySelector(selector);
let state = null, selected = null, epoch = 0, loadVersion = 0;
let pendingPhotoFiles = [], editingProfile = null, editingOwnProfile = false, optimizingPhotos = false;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_UPLOAD_MAX_BYTES = 1.5 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1600;
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
function photoImage(src, alt, fallbackClass = '') {
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    image.replaceWith(el('span', '사진을 불러오지 못했습니다', fallbackClass));
  }, { once: true });
  return image;
}
function distanceText(value) { return value === null ? '연결된 초대 관계 없음' : `나와 ${value}촌`; }
function renderAlbum(profile, target) {
  const album = el('div', undefined, 'photo-album');
  const photos = profile.photos || [];
  for (let index = 0; index < 3; index++) {
    const slot = el('div', undefined, `photo-slot${index === 0 ? ' photo-main' : ''}`);
    const photo = photos[index];
    if (photo) {
      slot.append(photoImage(photo.url, `${profile.nickname} 사진 ${index + 1}`));
    } else slot.append(el('span', '사진 없음'));
    album.append(slot);
  }
  target.append(album);
}
function description(profile, target, showAlbum = true, showFacts = true) {
  if (showAlbum) renderAlbum(profile, target);
  const age = profile.age == null ? profile.age_band : `만 ${profile.age}세`;
  target.append(el('h3', profile.nickname), el('p', `${age} · ${profile.region}`, 'meta'));
  if (showFacts) {
    const facts = el('dl', undefined, 'profile-facts');
    const rows = [
      ['고향', profile.hometown], ['직업', profile.job],
      ['키', profile.height_cm ? `${profile.height_cm}cm` : ''],
      ['종교', profile.religion], ['MBTI', profile.mbti]
    ];
    rows.filter(([, value]) => value).forEach(([label, value]) => {
      facts.append(el('dt', label), el('dd', value));
    });
    target.append(facts);
  }
  target.append(el('p', profile.introduction, 'quote'));
  const tags = el('div', undefined, 'tags');
  (profile.hobbies || []).forEach(hobby => tags.append(el('span', hobby)));
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
  editingProfile = null;
  $('#profile-dialog').close();
  clearData();
  ['profile-form','intro-form','contact-form'].forEach(id => document.getElementById(id).reset());
  updateNotesCount();
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
    const photo = profile.photos?.[0];
    if (photo) {
      portrait.append(photoImage(photo.url, `${profile.nickname} 대표 사진`, 'portrait-empty'));
    } else portrait.append(el('span', '사진 없음', 'portrait-empty'));
    portrait.append(el('span', distanceText(profile.distance), 'distance'));
    const body = el('div', undefined, 'card-body');
    description(profile, body, false, false);
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
    const profileActions = el('div', undefined, 'actions');
    profileActions.append(button('내 프로필 직접 수정', () => editProfile(profile)));
    profileActions.append(button(publish ? '이 내용을 확인하고 공개 승인' : '내 프로필 비공개로 전환', control => perform(control, $('#approval-status'), async alive => {
      await api('/api/profile-approval', { body: { id: profile.id, publish, version: profile.updated_at } });
      if (!alive()) return;
      $('#approval-status').textContent = publish ? '공개 승인했습니다.' : '비공개로 전환했습니다.';
      await refresh();
    })));
    own.append(profileActions);
  }
  const authored = $('#authored-profiles'); authored.replaceChildren();
  state.authored.forEach(profile => {
    const item = el('div', undefined, 'list-item');
    item.append(el('strong', profile.nickname), el('p', statusNames[profile.status], 'meta'), button('소개 수정하기', () => editProfile(profile)));
    authored.append(item);
  });
  if (!state.authored.length) empty(authored, '아직 소개한 지인이 없습니다. 초대 코드를 발급하고 첫 소개를 준비해 보세요.');
  const invitations = $('#invitation-list'); invitations.replaceChildren();
  state.invitations.forEach((invite, index) => {
    const expired = Date.parse(invite.expires_at) <= Date.now();
    const label = invitationLabel(invite, index);
    const item = el('div', undefined, 'list-item invitation-item');
    item.append(el('p', `${label} · ${invite.used ? '가입 완료' : expired ? '만료' : '가입 대기'}${invite.has_profile ? ' · 프로필 등록됨' : ''}${invite.used ? '' : ` · ${new Date(invite.expires_at).toLocaleDateString('ko-KR')} 만료`}`, 'meta'));
    const controls = el('div', undefined, 'invitation-controls');
    const memo = document.createElement('input');
    memo.value = invite.memo || '';
    memo.maxLength = 10;
    memo.placeholder = '메모 최대 10자';
    memo.setAttribute('aria-label', `${label} 메모`);
    controls.append(memo, button('메모 저장', control => perform(control, $('#invitation-status'), async alive => {
      await api('/api/invitation-memo', { body: { id: invite.id, memo: memo.value.trim() } });
      if (!alive()) return;
      $('#invitation-status').textContent = '초대 메모를 저장했습니다.';
      await refresh();
    })));
    if (!invite.used && !invite.has_profile) {
      controls.append(button('초대 삭제', control => {
        if (!window.confirm(`${label}을 삭제할까요? 삭제한 초대코드는 사용할 수 없습니다.`)) return;
        perform(control, $('#invitation-status'), async alive => {
          await api('/api/invitation-delete', { body: { id: invite.id } });
          if (!alive()) return;
          $('#invitation-status').textContent = '초대를 삭제했습니다.';
          await refresh();
        });
      }, 'danger-button'));
    }
    item.append(controls);
    invitations.append(item);
  });
  if (!state.invitations.length) empty(invitations, '발급한 초대가 없습니다.');
  if (!$('#profile-id').value) renderInviteOptions();
}
function invitationLabel(invite, index) {
  const fallback = `초대 ${state.invitations.length - index}`;
  if (invite.invitee_name && invite.memo) return `${invite.invitee_name} #${invite.memo}`;
  if (invite.memo) return `#${invite.memo}`;
  return invite.invitee_name || fallback;
}
function renderInviteOptions(preferred) {
  const select = $('#profile-invitation'), previous = preferred || select.value;
  select.replaceChildren(new Option('초대를 선택하세요', ''));
  (state?.invitations || []).forEach((invite, index) => {
    const eligible = invite.can_create_profile ?? (!invite.used && !invite.has_profile && Date.parse(invite.expires_at) > Date.now());
    if (!eligible) return;
    const label = invitationLabel(invite, index);
    select.add(new Option(`${label} · ${invite.used ? '가입 완료 · 프로필 작성 가능' : `가입 대기 · ${new Date(invite.expires_at).toLocaleDateString('ko-KR')} 만료`}`, invite.id));
  });
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function clearPendingPhotos() {
  pendingPhotoFiles.forEach(item => URL.revokeObjectURL(item.url));
  pendingPhotoFiles = [];
  $('#profile-photos').value = '';
}
function renderPhotoEditor() {
  const target = $('#profile-photo-editor'); target.replaceChildren();
  const existing = editingProfile?.photos || [];
  const entries = [...existing.map(photo => ({ kind: 'saved', photo })),
    ...pendingPhotoFiles.map(item => ({ kind: 'pending', item }))];
  for (let index = 0; index < 3; index++) {
    const entry = entries[index];
    const slot = el('div', undefined, `photo-slot${index === 0 ? ' photo-main' : ''}`);
    if (!entry) {
      slot.append(el('span', '사진 없음'));
    } else {
      slot.append(photoImage(entry.kind === 'saved' ? entry.photo.url : entry.item.url, `프로필 사진 ${index + 1}`));
      if (entry.kind === 'pending') {
        slot.append(button('선택 취소', () => {
          URL.revokeObjectURL(entry.item.url);
          pendingPhotoFiles = pendingPhotoFiles.filter(item => item !== entry.item);
          renderPhotoEditor();
        }, 'photo-remove'));
      } else {
        slot.append(button('사진 삭제', control => {
          if (!window.confirm('이 사진을 삭제할까요? 공개 중인 프로필은 다시 승인이 필요합니다.')) return;
          perform(control, $('#profile-status'), async alive => {
            await api('/api/profile-photo-delete', { body: { id: entry.photo.id } });
            if (!alive()) return;
            await refresh();
            const updated = state.authored.find(profile => profile.id === editingProfile.id)
              || (state.own_profile?.id === editingProfile.id ? state.own_profile : null);
            if (updated) editProfile(updated);
            $('#profile-status').textContent = '사진을 삭제했습니다. 지인의 재승인이 필요합니다.';
          });
        }, 'photo-remove'));
      }
    }
    target.append(slot);
  }
}
function updateAgeDisplay() {
  const value = $('#profile-birth').value;
  if (!value) return $('#profile-age-display').textContent = '출생년월을 입력하면 나이가 계산됩니다.';
  const [year, month] = value.split('-').map(Number), now = new Date();
  const age = now.getFullYear() - year - ((now.getMonth() + 1) < month ? 1 : 0);
  $('#profile-age-display').textContent = age >= 18 && age <= 99 ? `현재 만 ${age}세` : '만 18~99세 범위로 입력해 주세요.';
}
function resetProfile() {
  clearPendingPhotos();
  editingProfile = null;
  editingOwnProfile = false;
  $('#profile-form').reset();
  $('#profile-id').value = '';
  $('#profile-invitation').disabled = false;
  $('#profile-invitation').required = true;
  $('#profile-introduction-count').textContent = '0';
  updateAgeDisplay();
  renderPhotoEditor();
  renderInviteOptions();
}
function editProfile(profile) {
  clearPendingPhotos();
  editingProfile = profile;
  editingOwnProfile = profile.owner_id === state?.me?.id;
  $('#profile-id').value = profile.id;
  $('#profile-invitation').disabled = true;
  $('#profile-invitation').required = false;
  $('#profile-invitation').replaceChildren(new Option('기존 지인의 프로필 수정', ''));
  $('#profile-name').value = profile.nickname || '';
  $('#profile-birth').value = profile.birth_year_month?.slice(0, 7) || '';
  $('#profile-hometown').value = profile.hometown || '';
  $('#profile-region').value = profile.region || '';
  $('#profile-hobbies').value = (profile.hobbies || []).join(', ');
  $('#profile-job').value = profile.job || '';
  $('#profile-height').value = profile.height_cm || '';
  $('#profile-religion').value = profile.religion || '';
  $('#profile-mbti').value = profile.mbti || '';
  $('#profile-introduction').value = profile.introduction || '';
  $('#profile-introduction-count').textContent = $('#profile-introduction').value.length;
  updateAgeDisplay();
  renderPhotoEditor();
  $('#profile-status').textContent = editingOwnProfile
    ? '내용을 직접 수정한 뒤 마이페이지에서 공개 승인해 주세요.'
    : '수정한 내용은 지인이 다시 승인해야 공개됩니다.';
  location.hash = 'register';
}
$('#reset-profile').addEventListener('click', () => { resetProfile(); $('#profile-status').textContent = ''; });
$('#profile-birth').addEventListener('input', updateAgeDisplay);
$('#profile-introduction').addEventListener('input', () => {
  $('#profile-introduction-count').textContent = $('#profile-introduction').value.length;
});
function canvasBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
}
async function optimizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('INVALID_IMAGE');
    const attempts = [
      [1600, .82], [1400, .78], [1200, .74], [1000, .70], [800, .65], [640, .58], [480, .52]
    ];
    let blob = null;
    for (const [edge, quality] of attempts) {
      const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, quality);
      if (!blob) throw new Error('CONVERSION_FAILED');
      if (blob.size <= PHOTO_UPLOAD_MAX_BYTES && Math.max(canvas.width, canvas.height) <= PHOTO_MAX_EDGE) break;
    }
    if (!blob || blob.size > PHOTO_UPLOAD_MAX_BYTES) throw new Error('TOO_LARGE');
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'profile-photo';
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}
$('#profile-photos').addEventListener('change', async event => {
  const existingCount = editingProfile?.photos?.length || 0;
  const available = 3 - existingCount - pendingPhotoFiles.length;
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length > available) {
    $('#profile-status').textContent = `사진은 최대 3장입니다. 지금 ${Math.max(0, available)}장 더 선택할 수 있어요.`;
    return;
  }
  for (const file of files) {
    if (!PHOTO_TYPES.includes(file.type) || file.size > PHOTO_SOURCE_MAX_BYTES) {
      $('#profile-status').textContent = 'JPG, PNG, WebP 파일만 가능하며 원본 사진 한 장은 15MB 이하여야 합니다.';
      return;
    }
  }
  optimizingPhotos = true;
  $('#profile-status').textContent = '사진을 모바일에 맞게 최적화하고 있습니다…';
  try {
    const optimizedFiles = [];
    for (const file of files) {
      optimizedFiles.push(await optimizePhoto(file));
    }
    pendingPhotoFiles.push(...optimizedFiles.map(file => ({ file, url: URL.createObjectURL(file) })));
    $('#profile-status').textContent = '사진을 긴 변 1600px 이하로 최적화했습니다.';
    renderPhotoEditor();
  } catch {
    $('#profile-status').textContent = '사진을 처리하지 못했습니다. 다른 JPG, PNG 또는 WebP 사진을 선택해 주세요.';
  } finally {
    optimizingPhotos = false;
  }
});
$('#profile-form').addEventListener('submit', event => {
  event.preventDefault();
  if (optimizingPhotos) {
    $('#profile-status').textContent = '사진을 최적화하고 있습니다. 잠시만 기다려 주세요.';
    return;
  }
  if (!event.target.reportValidity()) return;
  const body = {
    ...($('#profile-id').value ? { id: $('#profile-id').value } : { invitation_id: $('#profile-invitation').value }),
    nickname: $('#profile-name').value.trim(), birth_year_month: $('#profile-birth').value,
    hometown: $('#profile-hometown').value.trim(), region: $('#profile-region').value.trim(),
    hobbies: $('#profile-hobbies').value.split(',').map(s => s.trim()).filter(Boolean),
    job: $('#profile-job').value.trim(), height_cm: Number($('#profile-height').value),
    religion: $('#profile-religion').value.trim(), mbti: $('#profile-mbti').value,
    introduction: $('#profile-introduction').value.trim()
  };
  perform(event.submitter, $('#profile-status'), async alive => {
    const ownerEdited = editingOwnProfile;
    const result = await api('/api/profile', { body });
    while (pendingPhotoFiles.length) {
      const current = pendingPhotoFiles[0], form = new FormData();
      form.append('profile_id', result.id); form.append('file', current.file);
      await api('/api/profile-photo', { body: form, timeout: 60000 });
      URL.revokeObjectURL(current.url); pendingPhotoFiles.shift();
    }
    if (!alive()) return;
    resetProfile();
    await refresh();
    if (ownerEdited) {
      location.hash = 'my';
      $('#approval-status').textContent = '수정 내용을 저장했습니다. 확인 후 공개 승인해 주세요.';
    } else {
      $('#profile-status').textContent = '프로필과 사진을 저장했습니다. 지인이 내용을 승인하면 공개됩니다.';
    }
  });
});
$('#issue-invite').addEventListener('click', () => perform($('#issue-invite'), $('#invitation-status'), async alive => {
  const result = await api('/api/invitations', { body: { memo: $('#invite-memo').value.trim() } });
  if (!alive()) return;
  $('#my-invite-code').textContent = result.code;
  $('#invite-memo').value = '';
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
function updateNotesCount() {
  const length = $('#notes').value.trim().length;
  const counter = $('#notes-count');
  counter.textContent = length < 20
    ? `앞뒤 공백 제외 ${length.toLocaleString('ko-KR')} / 1,000자 · 최소 20자까지 ${20 - length}자 남음`
    : `앞뒤 공백 제외 ${length.toLocaleString('ko-KR')} / 1,000자 · AI 소개글 생성 가능`;
  counter.classList.toggle('count-warning', length < 20);
  counter.classList.toggle('count-ready', length >= 20);
}
$('#notes').addEventListener('input', updateNotesCount);
updateNotesCount();
$('#intro-form').addEventListener('submit', event => {
  event.preventDefault();
  const notes = $('#notes').value.trim();
  if (notes.length < 20 || notes.length > 1000) { $('#intro-status').textContent = '앞뒤 공백을 제외하고 20~1,000자를 입력해 주세요.'; return; }
  perform(event.submitter, $('#intro-status'), async alive => {
    $('#ai-result-panel').hidden = true;
    $('#intro-status').textContent = '친구의 매력을 소개글로 다듬고 있어요. 최대 45초 정도 걸릴 수 있습니다…';
    const result = await api('/api/introduction', { body: { notes } });
    if (!alive()) return;
    $('#ai-result').value = result.introduction.slice(0, 200);
    $('#ai-result-panel').hidden = false;
    $('#intro-status').textContent = '초안을 만들었습니다. 사실과 다른 내용이 없는지 확인하고 수정해 주세요.';
  });
});
$('#use-intro').addEventListener('click', () => {
  $('#profile-introduction').value = $('#ai-result').value;
  $('#profile-introduction-count').textContent = $('#profile-introduction').value.length;
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
