'use strict';
// 가상 회원 그래프. 실서비스에서는 서버가 인증된 회원 기준으로 계산한다.
const members = [{ id: 'me', inviter: 'host' }, { id: 'host', inviter: null }, { id: 'a', inviter: 'host' }, { id: 'bridge', inviter: 'host' }, { id: 'b', inviter: 'bridge' }, { id: 'c', inviter: 'host' }];
function distanceBetween(start, target) {
  const queue = [[start, 0]], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const [id, depth] = queue[i];
    if (id === target) return depth;
    for (const person of members) {
      const neighbor = person.id === id ? person.inviter : person.inviter === id ? person.id : null;
      if (neighbor && !seen.has(neighbor)) { seen.add(neighbor); queue.push([neighbor, depth + 1]); }
    }
  }
  return null;
}
const profiles = [
  { id: 'a', name: '윤슬', meta: '20대 후반 · 서울', emoji: '🌿', tone: '#e3e9db', tags: ['산책', '독립서점', '커피'], intro: '작은 일에도 즐거움을 찾는 친구예요. 함께 걸으면 평범한 골목도 특별해져요.' },
  { id: 'b', name: '도담', meta: '30대 초반 · 경기', emoji: '🎧', tone: '#e9dfd2', tags: ['음악', '러닝', '요리'], intro: '좋은 음악과 직접 만든 음식을 나누는 걸 좋아해요. 늘 약속을 소중하게 생각해요.' },
  { id: 'c', name: '여름', meta: '20대 후반 · 서울', emoji: '📷', tone: '#e1e6e9', tags: ['사진', '전시', '여행'], intro: '새로운 풍경을 발견하면 꼭 나누고 싶어 하는 친구예요. 이야기를 따뜻하게 들어줘요.' }
];
const sent = new Set();
let selected = null;
const dialog = document.querySelector('#profile-dialog');
function render(filter = 'all') {
  const container = document.querySelector('#profiles');
  container.replaceChildren();
  for (const profile of profiles) {
    const distance = distanceBetween('me', profile.id);
    if (filter !== 'all' && distance !== Number(filter)) continue;
    const card = document.createElement('article');
    card.className = 'card';
    // 아래 템플릿에는 코드에 정의된 가상 데이터만 사용한다.
    card.innerHTML = `<div class="portrait" style="--tone:${profile.tone}"><span class="distance">나와 ${distance}촌</span><span aria-hidden="true">${profile.emoji}</span></div><div class="card-body"><h3>${profile.name}</h3><p class="meta">${profile.meta} · 가상 프로필</p><p class="quote">“${profile.intro}”</p><div class="tags">${profile.tags.map(tag => `<span>${tag}</span>`).join('')}</div><button class="detail-button">${profile.name}님 소개 보기 ↗</button></div>`;
    card.querySelector('button').addEventListener('click', () => {
      selected = profile;
      document.querySelector('#detail').replaceChildren();
      const title = document.createElement('h2'); title.textContent = profile.name;
      const meta = document.createElement('p'); meta.textContent = `${profile.meta} · 나와 ${distance}촌 (초대 연결 기준)`;
      const intro = document.createElement('p'); intro.textContent = profile.intro;
      document.querySelector('#detail').append(title, meta, intro);
      const button = document.querySelector('#match-button'); button.disabled = sent.has(profile.id); button.textContent = sent.has(profile.id) ? '체험 요청 완료' : '매칭 요청 체험하기';
      dialog.showModal();
    });
    container.append(card);
  }
}
document.querySelectorAll('[data-distance]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-distance]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  render(button.dataset.distance);
}));
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#match-button').addEventListener('click', () => {
  if (!selected || sent.has(selected.id)) return;
  sent.add(selected.id);
  document.querySelector('#empty-request')?.remove();
  const li = document.createElement('li'); li.textContent = `${selected.name} · 매칭 요청 체험 완료 (전송되지 않음)`;
  document.querySelector('#requests').append(li);
  document.querySelector('#request-count').textContent = sent.size;
  document.querySelector('#match-button').disabled = true;
  document.querySelector('#match-button').textContent = '체험 요청 완료';
});
document.querySelector('#intro-form').addEventListener('submit', event => {
  event.preventDefault();
  const notes = document.querySelector('#notes').value.trim();
  document.querySelector('#intro-status').textContent = notes.length < 20 || notes.length > 1000 ? '공백을 제외한 앞뒤 내용을 기준으로 20~1,000자를 입력해 주세요.' : '입력 형식을 확인했습니다. 실제 AI 소개글 생성은 백엔드 연결 후 사용할 수 있습니다.';
});
render();

// 역할 전환은 화면 구분이며 서버의 접근 권한과는 별개다.
const dashboardTabs = [...document.querySelectorAll('[role="tab"]')];
function activateDashboard(tab) {
  dashboardTabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    item.classList.toggle('active', active);
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
}
dashboardTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateDashboard(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % dashboardTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + dashboardTabs.length) % dashboardTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = dashboardTabs.length - 1;
    else return;
    event.preventDefault();
    activateDashboard(dashboardTabs[next]);
    dashboardTabs[next].focus();
  });
});
