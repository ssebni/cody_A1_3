import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);`);
for (const file of ['001_initial_schema.sql','002_service_functions.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+file, import.meta.url),'utf8'));
}
const host=randomUUID(), a=randomUUID(), b=randomUUID(), outsider=randomUUID();
for (const id of [host,a,b,outsider]) await db.query('insert into auth.users values($1)',[id]);
await db.query("insert into members(id,display_name,status) values($1,'주선자','active')",[host]);
const hash = text => createHash('sha256').update(text).digest('hex');
const action = async (user, name, data={}) => (await db.query('select service_action($1,$2,$3) as value',[user,name,JSON.stringify(data)])).rows[0].value;
const join = (id,code) => db.query('select finish_join($1,$2,$3)',[id,hash(code),'친구']);
let count=0;
async function test(label,fn) { await fn(); count++; console.log('PASS',label); }
async function reject(fn,pattern) { await assert.rejects(fn,pattern); }
const invitation = async code => {
  const id=randomUUID();
  await db.query("insert into invitations(id,code_hash,inviter_id,expires_at) values($1,$2,$3,now()+interval '30 days')",[id,hash(code),host]);
  return id;
};
const info={nickname:'윤슬',age_band:'20대 후반',region:'서울',hobbies:['산책'],introduction:'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구예요.'};
const ia=await invitation('a'), ib=await invitation('b');
const pa=(await action(host,'profile',{...info,invitation_id:ia})).id;
const pb=(await action(host,'profile',{...info,nickname:'도담',invitation_id:ib})).id;
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
await test('only owner can approve, only author can edit',async()=>{
  const own=(await action(a,'state')).own_profile;
  await reject(()=>action(host,'approval',{id:pa,publish:true,version:own.updated_at}),/FORBIDDEN/);
  await reject(()=>action(b,'profile',{...info,id:pa}),/FORBIDDEN/);
  await action(a,'approval',{id:pa,publish:true,version:own.updated_at});
  const other=(await action(b,'state')).own_profile;
  await action(b,'approval',{id:pb,publish:true,version:other.updated_at});
  assert.equal((await action(a,'state')).profiles.length,1);
});
await test('editing clears consent and stale approval is rejected',async()=>{
  const before=(await action(a,'state')).own_profile;
  await action(host,'profile',{...info,id:pa,introduction:info.introduction+' 수정한 소개입니다.'});
  await reject(()=>action(a,'approval',{id:pa,publish:true,version:before.updated_at}),/STALE_PROFILE/);
  const after=(await action(a,'state')).own_profile;
  assert.equal(after.status,'pending'); assert.equal(after.approved_at,null);
  assert.equal((await action(b,'state')).profiles.length,0);
  await action(a,'approval',{id:pa,publish:true,version:after.updated_at});
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
  await reject(()=>action(host,'profile',{...info,invitation_id:id}),/INVITE_INVALID/);
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
console.log(`${count} database scenarios passed (PGlite PostgreSQL; hosted concurrency still needs verification).`);
await db.close();
