import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../docs/evidence/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
await mkdir(decodeURIComponent(output),{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const me='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const sample={id:'33333333-3333-4333-8333-333333333333',owner_id:other,nickname:'윤슬 (테스트)',age_band:'20대 후반',region:'서울',hobbies:['산책','독립서점'],introduction:'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구예요. 함께 걷고 이야기하는 시간을 즐겨요.',distance:2,updated_at:'2026-09-28T00:00:00+00:00',status:'published'};
const fixture={me:{id:me,display_name:'테스트 주선자'},profiles:[sample],own_profile:{...sample,id:'44444444-4444-4444-8444-444444444444',owner_id:me,nickname:'나 (테스트)',status:'pending'},authored:[],invitations:[],matches:[],contact:null};
let aiFailure=false, savedProfile=null;
await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:`
export function createClient() {
  let session = null, listener;
  return { auth: {
    onAuthStateChange(fn) { listener=fn; },
    async getSession() { return {data:{session}}; },
    async signInWithPassword() { session={user:{id:'${me}',email:'test@example.com'},access_token:'mock-token'}; listener('SIGNED_IN',session); return {data:{session}}; },
    async signOut() { session=null; listener('SIGNED_OUT',null); return {error:null}; }
  }};
}`}));
await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=route.request().method()==='POST' ? route.request().postDataJSON() : {};
  let result={ok:true},status=200;
  if(path==='/api/state') result=fixture;
  else if(path==='/api/introduction') {
    if(aiFailure) {status=504;result={error:{message:'AI 응답이 늦어지고 있습니다. 입력은 유지되니 다시 시도해 주세요.'}};}
    else result={introduction:'[UI 테스트용 모의 응답] 산책과 독립서점을 좋아하는 친구예요. 약속을 소중히 여기며 함께 걷는 시간을 즐겨요.'};
  } else if(path==='/api/invitations') {
    const invite={id:'55555555-5555-4555-8555-555555555555',expires_at:'2099-10-28T00:00:00Z',used:false,has_profile:false};
    fixture.invitations.push(invite); result={...invite,code:'UI-TEST-INVITATION'};
  } else if(path==='/api/profile') {
    savedProfile=body; fixture.authored.push({...body,id:sample.id,status:'draft'}); fixture.invitations[0].has_profile=true;
  } else if(path==='/api/profile-approval') fixture.own_profile.status=body.publish?'published':'hidden';
  else if(path==='/api/contact') fixture.contact=body.contact_value;
  else if(path==='/api/matches') fixture.matches.push({id:sample.id,other_id:other,name:sample.nickname,outgoing:true,status:'pending',contact:null});
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
});
await page.goto('http://127.0.0.1:8000');
await page.screenshot({path:decodeURIComponent(output)+'/desktop-home.png'});
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:decodeURIComponent(output)+'/mobile-home.png',fullPage:true});
await page.getByRole('button',{name:'우리의 연결 시작하기'}).click();
await page.locator('#login-email').fill('test@example.com');
await page.locator('#login-password').fill('test-password');
await page.locator('#login-submit').click();
await page.locator('#profiles .card').waitFor();
for(const width of [390,768,1440]) {
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${width}`);
}
await page.locator('#notes').fill('산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.');
await page.locator('#intro-form button').click();
await page.locator('#ai-result-panel').waitFor();
assert.match(await page.locator('#ai-result').inputValue(),/UI 테스트용/);
await page.locator('#introduce').screenshot({path:decodeURIComponent(output)+'/ai-ui-mock.png'});
await page.locator('#use-intro').click();
assert.match(await page.locator('#profile-introduction').inputValue(),/UI 테스트용/);
aiFailure=true;
await page.locator('#intro-form button').click();
await page.getByText('AI 응답이 늦어지고 있습니다. 입력은 유지되니 다시 시도해 주세요.',{exact:true}).waitFor();
assert.match(await page.locator('#notes').inputValue(),/독립서점/);
assert.equal(await page.locator('#intro-form button').isEnabled(),true);
await page.locator('#host-tab').click();
await page.locator('#issue-invite').click();
await page.locator('#new-invite').waitFor();
assert.equal(await page.locator('#my-invite-code').textContent(),'UI-TEST-INVITATION');
await page.waitForFunction(()=>document.querySelector('#profile-invitation').value.length>0);
await page.locator('#profile-nickname').fill('<img src=x onerror=alert(1)>');
await page.locator('#profile-age').selectOption('20대 후반');
await page.locator('#profile-region').fill('서울');
await page.locator('#profile-hobbies').fill('산책, 커피');
await page.locator('#profile-form button[type=submit]').click();
await page.getByText('저장했습니다. 지인이 가입하고 내용을 승인하면 공개됩니다.',{exact:true}).waitFor();
assert.ok(savedProfile.invitation_id);
assert.equal('author_id' in savedProfile,false);
assert.equal(await page.locator('#authored-profiles img').count(),0);
assert.match(await page.locator('#authored-profiles').textContent(),/<img/);
await page.locator('#recipient-tab').click();
await page.getByRole('button',{name:'이 내용을 확인하고 공개 승인'}).click();
await page.getByRole('button',{name:'내 프로필 비공개로 전환'}).waitFor();
await page.locator('#contact-value').fill('test-contact');
await page.locator('#contact-form button').click();
await page.getByText('저장했습니다. 매칭이 성사된 상대에게만 공개됩니다.',{exact:true}).waitFor();
await page.locator('#profiles .detail-button').click();
await page.locator('#match-button').click();
await page.locator('#requests').getByText('응답 대기',{exact:true}).waitFor();
await page.locator('#profiles .detail-button').click();
assert.equal(await page.locator('#match-button').isDisabled(),true);
await page.locator('#close-dialog').click();
await page.setViewportSize({width:390,height:844});
await page.locator('#explore').screenshot({path:decodeURIComponent(output)+'/mobile-profiles-mock.png'});
await page.locator('#auth-link').click();
await page.waitForFunction(()=>document.querySelector('#member-content').hidden);
assert.equal(await page.locator('#contact-value').inputValue(),'');
assert.equal(await page.locator('#my-invite-code').textContent(),'');
assert.equal(await page.locator('#ai-result').inputValue(),'');
assert.deepEqual(errors,[]);
console.log('PASS browser: 390/768/1440px, login/logout, AI success/failure, draft transfer, invitation, profile save, XSS text rendering, approval, contact, matching, duplicate prevention, private UI cleanup. Network mocked; screenshots are NOT live AI proof.');
await browser.close();
