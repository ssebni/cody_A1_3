import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../test-results/browser/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
await mkdir(decodeURIComponent(output),{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const me='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const pixel=`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#cad9d0"/><stop offset="1" stop-color="#d7b999"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><circle cx="300" cy="285" r="115" fill="#f8f3e9"/><path d="M95 800c20-205 92-310 205-310s185 105 205 310" fill="#416b58"/></svg>')}`;
const sample={id:'33333333-3333-4333-8333-333333333333',owner_id:other,nickname:'윤슬 (테스트)',age:31,age_band:'31세',birth_year_month:'1995-06-01',hometown:'부산',region:'서울 마포구',hobbies:['산책','독립서점'],job:'마케터',height_cm:170,religion:'',mbti:'ENFP',introduction:'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구예요. 함께 걷고 이야기하는 시간을 즐겨요.',photos:[{id:'77777777-7777-4777-8777-777777777777',position:0,url:pixel}],distance:2,updated_at:'2026-09-28T00:00:00+00:00',status:'published'};
const fixture={me:{id:me,display_name:'테스트 주선자'},profiles:[sample],own_profile:{...sample,id:'44444444-4444-4444-8444-444444444444',owner_id:me,nickname:'나 (테스트)',status:'pending'},authored:[],invitations:[{id:'66666666-6666-4666-8666-666666666666',memo:'',used:true,has_profile:false,can_create_profile:true,invitee_name:'가입한 지인',expires_at:'2020-01-01T00:00:00Z'}],matches:[],contact:null};
let aiFailure=false, savedProfile=null, issuedMemo=null, uploadedPhotos=0, uploadedPhotoBody=null;
await page.route('**/js/vendor/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`
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
  const isJson=route.request().headers()['content-type']?.includes('application/json');
  const body=route.request().method()==='POST' && isJson ? route.request().postDataJSON() : {};
  let result={ok:true},status=200;
  if(path==='/api/state') result=fixture;
  else if(path==='/api/introduction') {
    if(aiFailure) {status=504;result={error:{message:'AI 응답이 늦어지고 있습니다. 입력은 유지되니 다시 시도해 주세요.'}};}
    else result={introduction:'[UI 테스트용 모의 응답] 산책과 독립서점을 좋아하는 친구예요. 약속을 소중히 여기며 함께 걷는 시간을 즐겨요.'};
  } else if(path==='/api/invitations') {
    issuedMemo=body.memo;
    const invite={id:'55555555-5555-4555-8555-555555555555',memo:body.memo,expires_at:'2099-10-28T00:00:00Z',used:false,has_profile:false,can_create_profile:true,invitee_name:null};
    fixture.invitations.push(invite); result={...invite,code:'UI-TEST-INVITATION'};
  } else if(path==='/api/invitation-memo') {
    fixture.invitations.find(i=>i.id===body.id).memo=body.memo;
  } else if(path==='/api/invitation-delete') {
    fixture.invitations=fixture.invitations.filter(i=>i.id!==body.id);
  } else if(path==='/api/profile') {
    savedProfile=body;
    if(body.id===fixture.own_profile.id) {
      fixture.own_profile={...fixture.own_profile,...body,status:'pending',updated_at:'2026-09-29T01:00:00+00:00'};
      result={id:fixture.own_profile.id};
    } else {
      fixture.authored.push({...body,id:sample.id,age:31,photos:[],status:'draft'});
      const invite=fixture.invitations.find(i=>i.id===body.invitation_id);
      invite.has_profile=true; invite.can_create_profile=false; result={id:sample.id};
    }
  } else if(path==='/api/profile-photo') {
    uploadedPhotos++;
    uploadedPhotoBody=route.request().postDataBuffer();
    result={id:'88888888-8888-4888-8888-888888888888',position:0};
  } else if(path==='/api/profile-photo-delete') {
    fixture.own_profile.photos=fixture.own_profile.photos.filter(photo=>photo.id!==body.id);
  } else if(path==='/api/profile-approval') fixture.own_profile.status=body.publish?'published':'hidden';
  else if(path==='/api/contact') fixture.contact=body.contact_value;
  else if(path==='/api/matches') fixture.matches.push({id:sample.id,other_id:other,name:sample.nickname,outgoing:true,status:'pending',contact:null});
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
});
await page.goto('http://127.0.0.1:8000');
assert.equal(await page.locator('#account').isVisible(),true);
assert.equal(await page.locator('#home').isVisible(),false);
assert.equal(await page.locator('#member-content').isVisible(),false);
await page.screenshot({path:decodeURIComponent(output)+'/desktop-login.png'});
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:decodeURIComponent(output)+'/mobile-login.png',fullPage:true});
await page.locator('#show-invite').click();
assert.equal(await page.locator('#invite').isVisible(),true);
assert.equal(await page.locator('#home').isVisible(),false);
await page.locator('#show-login').click();
await page.locator('#login-email').fill('test@example.com');
await page.locator('#login-password').fill('test-password');
await page.locator('#login-submit').click();
await page.locator('#home').waitFor();
assert.equal(await page.locator('#account').isVisible(),false);
assert.equal(await page.locator('#home').isVisible(),true);
assert.equal(await page.locator('#member-content').isVisible(),false);
assert.equal(new URL(page.url()).hash,'#home');
await page.locator('#hero-start').click();
assert.equal(new URL(page.url()).hash,'#register');
await page.locator('#register').waitFor();
assert.equal(await page.locator('#profile-form').isVisible(),true);
for(const width of [390,768,1440]) {
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`No horizontal overflow at ${width}`);
}
await page.locator('nav a[href="#introduce"]').click();
await page.locator('#introduce').waitFor();
assert.equal(await page.locator('#introduce').isVisible(),true);
assert.equal(await page.locator('#register').isVisible(),false);
assert.match(await page.locator('#notes-count').textContent(),/0 \/ 1,000자 · 최소 20자까지 20자 남음/);
await page.locator('#notes').fill('짧은 메모');
assert.match(await page.locator('#notes-count').textContent(),/5 \/ 1,000자 · 최소 20자까지 15자 남음/);
await page.locator('#notes').fill('산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.');
assert.match(await page.locator('#notes-count').textContent(),/AI 소개글 생성 가능/);
await page.locator('#intro-form button').click();
await page.locator('#ai-result-panel').waitFor();
assert.match(await page.locator('#ai-result').inputValue(),/UI 테스트용/);
await page.locator('#introduce').screenshot({path:decodeURIComponent(output)+'/ai-ui-mock.png'});
await page.locator('#use-intro').click();
assert.match(await page.locator('#profile-introduction').inputValue(),/UI 테스트용/);
await page.locator('nav a[href="#introduce"]').click();
await page.locator('#introduce').waitFor();
aiFailure=true;
await page.locator('#intro-form button').click();
await page.getByText('AI 응답이 늦어지고 있습니다. 입력은 유지되니 다시 시도해 주세요.',{exact:true}).waitFor();
assert.match(await page.locator('#notes').inputValue(),/독립서점/);
assert.equal(await page.locator('#intro-form button').isEnabled(),true);
await page.locator('nav a[href="#my"]').click();
await page.locator('#my').waitFor();
await page.locator('#host-tab').click();
await page.locator('#invite-memo').fill('수업 친구');
await page.locator('#issue-invite').click();
await page.locator('#new-invite').waitFor();
assert.equal(await page.locator('#my-invite-code').textContent(),'UI-TEST-INVITATION');
assert.equal(issuedMemo,'수업 친구');
const usedInviteItem=page.locator('.invitation-item').filter({hasText:'가입한 지인'});
await usedInviteItem.locator('input').fill('홍길동');
await usedInviteItem.getByRole('button',{name:'메모 저장'}).click();
await page.getByText('초대 메모를 저장했습니다.',{exact:true}).waitFor();
assert.match(await page.locator('#invitation-list').textContent(),/가입한 지인 #홍길동/);
const deletableInviteItem=page.locator('.invitation-item').filter({hasText:'수업 친구'});
page.once('dialog',dialog=>dialog.accept());
await deletableInviteItem.getByRole('button',{name:'초대 삭제'}).click();
await page.getByText('초대를 삭제했습니다.',{exact:true}).waitFor();
assert.equal(fixture.invitations.some(i=>i.id==='55555555-5555-4555-8555-555555555555'),false);
await page.waitForFunction(()=>document.querySelector('#profile-invitation').options.length>1);
assert.match(await page.locator('#profile-invitation').textContent(),/가입한 지인 #홍길동 · 가입 완료/);
await page.locator('nav a[href="#register"]').click();
await page.locator('#register').waitFor();
await page.locator('#profile-invitation').selectOption('66666666-6666-4666-8666-666666666666');
await page.locator('#profile-name').fill('<img src=x onerror=alert(1)>');
await page.locator('#profile-birth').fill('1995-06');
assert.match(await page.locator('#profile-age-display').textContent(),/만 \d+세/);
await page.locator('#profile-hometown').fill('부산');
await page.locator('#profile-region').fill('서울 마포구');
await page.locator('#profile-hobbies').fill('산책, 커피');
await page.locator('#profile-job').fill('마케터');
await page.locator('#profile-height').fill('170');
await page.locator('#profile-religion').fill('무교');
await page.locator('#profile-mbti').selectOption('ENFP');
await page.locator('#profile-photos').setInputFiles({
  name:'profile.png', mimeType:'image/png',
  buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
});
await page.getByText('사진을 긴 변 1600px 이하로 최적화했습니다.', {exact:true}).waitFor();
assert.equal(await page.locator('#profile-photo-editor img').count(),1);
const desktopPhotoBox=await page.locator('#profile-photo-editor').boundingBox();
assert.ok(desktopPhotoBox.width<=720 && desktopPhotoBox.height<=348);
await page.setViewportSize({width:390,height:844});
const mobilePhotoBox=await page.locator('#profile-photo-editor').boundingBox();
assert.ok(mobilePhotoBox.width<390 && mobilePhotoBox.height<=218);
await page.locator('#profile-form button[type=submit]').click();
await page.getByText('프로필과 사진을 저장했습니다. 지인이 내용을 승인하면 공개됩니다.',{exact:true}).waitFor();
assert.equal(savedProfile.invitation_id,'66666666-6666-4666-8666-666666666666');
assert.equal(savedProfile.nickname,'<img src=x onerror=alert(1)>');
assert.equal(savedProfile.birth_year_month,'1995-06');
assert.equal(savedProfile.height_cm,170);
assert.equal(uploadedPhotos,1);
assert.ok(uploadedPhotoBody.length<1.6*1024*1024);
assert.match(uploadedPhotoBody.toString('latin1'),/filename="profile\.webp"[\s\S]*Content-Type: image\/webp/i);
assert.equal('author_id' in savedProfile,false);
assert.equal(await page.locator('#authored-profiles img').count(),0);
assert.match(await page.locator('#authored-profiles').textContent(),/<img/);
await page.locator('nav a[href="#my"]').click();
await page.locator('#my').waitFor();
await page.locator('#recipient-tab').click();
await page.getByRole('button',{name:'내 프로필 직접 수정'}).click();
await page.locator('#register').waitFor();
assert.equal(await page.locator('#register').isVisible(),true);
assert.equal(await page.locator('#my').isVisible(),false);
page.once('dialog',dialog=>dialog.accept());
await page.locator('#profile-photo-editor').getByRole('button',{name:'사진 삭제'}).click();
await page.getByText('사진을 삭제했습니다. 지인의 재승인이 필요합니다.',{exact:true}).waitFor();
assert.equal(await page.locator('#profile-photo-editor img').count(),0);
await page.locator('#profile-region').fill('서울 성동구');
await page.locator('#profile-form button[type=submit]').click();
await page.getByText('수정 내용을 저장했습니다. 확인 후 공개 승인해 주세요.',{exact:true}).waitFor();
assert.equal(savedProfile.id,fixture.own_profile.id);
assert.equal(savedProfile.region,'서울 성동구');
assert.equal(await page.locator('#my').isVisible(),true);
await page.getByRole('button',{name:'이 내용을 확인하고 공개 승인'}).click();
await page.getByRole('button',{name:'내 프로필 비공개로 전환'}).waitFor();
await page.locator('#contact-value').fill('test-contact');
await page.locator('#contact-form button').click();
await page.getByText('저장했습니다. 매칭이 성사된 상대에게만 공개됩니다.',{exact:true}).waitFor();
await page.locator('nav a[href="#explore"]').click();
await page.locator('#explore').waitFor();
await page.locator('#profiles .detail-button').click();
await page.locator('#match-button').click();
await page.locator('nav a[href="#my"]').click();
await page.locator('#my').waitFor();
await page.locator('#requests').getByText('응답 대기',{exact:true}).waitFor();
await page.locator('nav a[href="#explore"]').click();
await page.locator('#explore').waitFor();
await page.locator('#profiles .detail-button').click();
assert.equal(await page.locator('#match-button').isDisabled(),true);
await page.locator('#close-dialog').click();
await page.setViewportSize({width:1440,height:1000});
await page.locator('#explore').screenshot({path:decodeURIComponent(output)+'/desktop-profiles-mock.png'});
await page.setViewportSize({width:390,height:844});
await page.locator('#explore').screenshot({path:decodeURIComponent(output)+'/mobile-profiles-mock.png'});
await page.locator('#auth-link').click();
await page.waitForFunction(()=>document.querySelector('#member-content').hidden);
assert.equal(await page.locator('#home').isVisible(),false);
assert.equal(await page.locator('#account').isVisible(),true);
assert.equal(await page.locator('#contact-value').inputValue(),'');
assert.equal(await page.locator('#my-invite-code').textContent(),'');
assert.equal(await page.locator('#ai-result').inputValue(),'');
assert.deepEqual(errors,[]);
console.log('PASS browser: 390/768/1440px, page navigation, login/logout, AI success/failure, invitation, owner profile edit, age calculation, photo preview/upload, album, XSS text rendering, approval, contact, matching, duplicate prevention, private UI cleanup. Network mocked; screenshots are NOT live AI proof.');
await browser.close();
