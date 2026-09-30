import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create schema storage; create table storage.buckets(
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );`);
for (const file of ['001_initial_schema.sql','002_service_functions.sql','003_profiles_after_signup.sql','004_invitation_management.sql','005_profile_details_and_photos.sql','006_owner_profile_edit.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+file, import.meta.url),'utf8'));
}
const host=randomUUID(), a=randomUUID(), b=randomUUID(), outsider=randomUUID();
for (const id of [host,a,b,outsider]) await db.query('insert into auth.users values($1)',[id]);
await db.query("insert into members(id,display_name,status) values($1,'주선자','active')",[host]);
const hash = text => createHash('sha256').update(text).digest('hex');
const action = async (user, name, data={}) => (await db.query('select service_action($1,$2,$3) as value',[user,name,JSON.stringify(data)])).rows[0].value;
const inviteAction = async (user, name, data={}) => (await db.query('select invitation_action($1,$2,$3) as value',[user,name,JSON.stringify(data)])).rows[0].value;
const saveProfile = async (user, data) => (await db.query('select profile_action($1,$2) as value',[user,JSON.stringify(data)])).rows[0].value;
const photoAction = async (user, name, data={}) => (await db.query('select profile_photo_action($1,$2,$3) as value',[user,name,JSON.stringify(data)])).rows[0].value;
const join = (id,code) => db.query('select finish_join($1,$2,$3)',[id,hash(code),'친구']);
let count=0;
async function test(label,fn) { await fn(); count++; console.log('PASS',label); }
async function reject(fn,pattern) { await assert.rejects(fn,pattern); }
const invitation = async code => {
  const id=randomUUID();
  await db.query("insert into invitations(id,code_hash,inviter_id,expires_at) values($1,$2,$3,now()+interval '30 days')",[id,hash(code),host]);
  return id;
};
const info={nickname:'윤슬',age_band:'31세',birth_year_month:'1995-06-01',hometown:'부산',region:'서울 마포구',
  hobbies:['산책'],job:'브랜드 마케터',height_cm:170,religion:'',mbti:'ENFP',introduction:'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구예요.'};
const ia=await invitation('a'), ib=await invitation('b');
const pa=(await saveProfile(host,{...info,invitation_id:ia})).id;
const pb=(await saveProfile(host,{...info,nickname:'도담',invitation_id:ib})).id;
await test('one-use invite binds profile and member atomically',async()=>{
  await join(a,'a');
  const own=(await action(a,'state')).own_profile;
  assert.equal(own.id,pa); assert.equal(own.status,'pending');
  await reject(()=>join(b,'a'),/INVITE_INVALID/);
  assert.equal((await db.query('select id from members where id=$1',[b])).rows.length,0);
  await join(a,'a'); // Same-user retry is idempotent.
  await join(b,'b');
});
await test('unapproved profiles invisible and outsiders cannot enter',async()=>{
  assert.equal((await action(a,'state')).profiles.length,0);
  await reject(()=>action(outsider,'state'),/MEMBER_REQUIRED/);
});
await test('only owner can approve and unrelated members cannot edit',async()=>{
  const own=(await action(a,'state')).own_profile;
  await reject(()=>action(host,'approval',{id:pa,publish:true,version:own.updated_at}),/FORBIDDEN/);
  await reject(()=>saveProfile(b,{...info,id:pa}),/FORBIDDEN/);
  await action(a,'approval',{id:pa,publish:true,version:own.updated_at});
  const other=(await action(b,'state')).own_profile;
  await action(b,'approval',{id:pb,publish:true,version:other.updated_at});
  assert.equal((await action(a,'state')).profiles.length,1);
});
await test('editing clears consent and stale approval is rejected',async()=>{
  const before=(await action(a,'state')).own_profile;
  await saveProfile(host,{...info,id:pa,introduction:info.introduction+' 수정한 소개입니다.'});
  await reject(()=>action(a,'approval',{id:pa,publish:true,version:before.updated_at}),/STALE_PROFILE/);
  const after=(await action(a,'state')).own_profile;
  assert.equal(after.status,'pending'); assert.equal(after.approved_at,null);
  assert.equal((await action(b,'state')).profiles.length,0);
  await action(a,'approval',{id:pa,publish:true,version:after.updated_at});
});
await test('profile owner can correct details before approving again',async()=>{
  await saveProfile(a,{...info,id:pa,region:'서울 성동구',introduction:info.introduction+' 본인이 확인하고 수정했습니다.'});
  const corrected=(await action(a,'state')).own_profile;
  assert.equal(corrected.region,'서울 성동구');
  assert.equal(corrected.status,'pending');
  assert.equal(corrected.approved_at,null);
  await action(a,'approval',{id:pa,publish:true,version:corrected.updated_at});
});
let match;
await test('matching requires own contact, rejects self and duplicate pairs',async()=>{
  await reject(()=>action(a,'match',{recipient_id:a}),/SELF_MATCH/);
  await reject(()=>action(a,'match',{recipient_id:b}),/CONTACT_REQUIRED/);
  await action(a,'contact',{contact_value:'test-a'});
  await action(b,'contact',{contact_value:'test-b'});
  match=(await action(a,'match',{recipient_id:b})).id;
  await reject(()=>action(b,'match',{recipient_id:a}),/duplicate key/);
});
await test('pending requests never expose either contact',async()=>{
  for (const id of [a,b]) assert.equal((await action(id,'state')).matches[0].contact,null);
  await reject(()=>action(a,'respond',{id:match,status:'accepted'}),/FORBIDDEN/);
  await reject(()=>action(host,'respond',{id:match,status:'accepted'}),/FORBIDDEN/);
});
await test('only recipient accepts and mutual contact appears after acceptance',async()=>{
  await action(b,'respond',{id:match,status:'accepted'});
  assert.equal((await action(a,'state')).matches[0].contact,'test-b');
  assert.equal((await action(b,'state')).matches[0].contact,'test-a');
  await reject(()=>action(a,'respond',{id:match,status:'cancelled'}),/STATE_CONFLICT/);
});
await test('rate limits persist across calls',async()=>{
  await action(a,'ai');
  await reject(()=>action(a,'ai'),/RATE_LIMIT/);
});
await test('expired invitations cannot create members or profiles',async()=>{
  const id=await invitation('expired');
  await db.query("update invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[id]);
  await reject(()=>join(outsider,'expired'),/INVITE_INVALID/);
  await reject(()=>saveProfile(host,{...info,invitation_id:id}),/INVITE_INVALID/);
});
await test('anonymous and authenticated roles cannot execute service RPCs',async()=>{
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await reject(()=>action(a,'state'),/permission denied/);
    await reject(()=>db.query('select * from contact_shares'),/permission denied/);
    await db.exec('reset role');
  }
});
await test('service role can execute the application RPC with table permissions',async()=>{
  await db.exec('set role service_role');
  assert.equal((await action(a,'state')).me.id,a);
  await action(a,'contact',{contact_value:'updated-contact'});
  await db.exec('reset role');
});
await test('original inviter creates a pending profile after signup, even after code expiration',async()=>{
  const late=randomUUID();
  await db.query('insert into auth.users values($1)',[late]);
  const invitationId=await invitation('late');
  await join(late,'late');
  await db.query("update invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[invitationId]);
  const entry=(await action(host,'state')).invitations.find(i=>i.id===invitationId);
  assert.equal(entry.can_create_profile,true);
  assert.equal(entry.invitee_name,'친구');
  await reject(()=>saveProfile(a,{...info,invitation_id:invitationId}),/INVITE_INVALID/);
  const created=await saveProfile(host,{...info,invitation_id:invitationId});
  const own=(await action(late,'state')).own_profile;
  assert.equal(own.id,created.id);
  assert.equal(own.owner_id,late);
  assert.equal(own.status,'pending');
  assert.equal(own.approved_at,null);
  assert.equal((await action(a,'state')).profiles.some(p=>p.id===created.id),false);
  assert.equal((await action(host,'state')).invitations.find(i=>i.id===invitationId).can_create_profile,false);
  await reject(()=>saveProfile(host,{...info,invitation_id:invitationId}),/duplicate key/);
  await action(late,'approval',{id:own.id,publish:true,version:own.updated_at});
  assert.equal((await action(a,'state')).profiles.some(p=>p.id===created.id),true);
});
await test('invitation memo is limited, editable, and visible in the owner list',async()=>{
  const codeHash=hash('memo-code');
  const created=await inviteAction(host,'create',{code_hash:codeHash,memo:'대학 친구'});
  let row=(await inviteAction(host,'list')).find(i=>i.id===created.id);
  assert.equal(row.memo,'대학 친구');
  await inviteAction(host,'memo',{id:created.id,memo:'동아리 친구'});
  row=(await inviteAction(host,'list')).find(i=>i.id===created.id);
  assert.equal(row.memo,'동아리 친구');
  await reject(()=>inviteAction(host,'memo',{id:created.id,memo:'열한글자가넘는메모입니다'}),/INVALID_INPUT/);
});
await test('only unused invitations without profiles can be deleted',async()=>{
  const deletableId=await invitation('delete-me');
  await reject(()=>inviteAction(a,'delete',{id:deletableId}),/FORBIDDEN/);
  await inviteAction(host,'delete',{id:deletableId});
  assert.equal((await inviteAction(host,'list')).some(i=>i.id===deletableId),false);
  await reject(()=>inviteAction(host,'delete',{id:ia}),/STATE_CONFLICT/);
  const withProfile=await invitation('profile-delete-blocked');
  await saveProfile(host,{...info,invitation_id:withProfile});
  await reject(()=>inviteAction(host,'delete',{id:withProfile}),/STATE_CONFLICT/);
});
await test('expanded profile details are stored and returned',async()=>{
  const profile=(await action(a,'state')).own_profile;
  assert.equal(profile.nickname,'윤슬'); assert.equal(profile.birth_year_month,'1995-06-01');
  assert.equal(profile.hometown,'부산'); assert.equal(profile.region,'서울 성동구');
  assert.equal(profile.job,'브랜드 마케터'); assert.equal(profile.height_cm,170); assert.equal(profile.mbti,'ENFP');
});
await test('profile photo metadata is private, limited to three, and resets approval',async()=>{
  await reject(()=>photoAction(b,'authorize',{profile_id:pa}),/FORBIDDEN/);
  for (let index=0; index<3; index++) {
    await photoAction(host,'register',{profile_id:pa,object_path:`${pa}/${index}.jpg`});
  }
  await reject(()=>photoAction(host,'register',{profile_id:pa,object_path:`${pa}/3.jpg`}),/PHOTO_LIMIT/);
  const rows=await photoAction(a,'list');
  assert.equal(rows.filter(photo=>photo.profile_id===pa).length,3);
  assert.equal((await action(a,'state')).own_profile.status,'pending');
  const removed=await photoAction(a,'delete',{id:rows.find(photo=>photo.profile_id===pa).id});
  assert.match(removed.object_path,/\.jpg$/);
  assert.equal((await photoAction(a,'list')).filter(photo=>photo.profile_id===pa).length,2);
});
console.log(`${count} database scenarios passed (PGlite PostgreSQL; hosted concurrency still needs verification).`);
await db.close();
