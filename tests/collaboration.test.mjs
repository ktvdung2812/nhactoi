import test from 'node:test';import assert from 'node:assert/strict';
import {boot,call,user,addMember,task} from './roadmap-helpers.mjs';
test('task watchers and mentions notify authorized recipients, comments preserve edit rights',async t=>{
 const s=await boot(t),owner=await user(s,'owner-collab@example.test'),member=await user(s,'member-collab@example.test'),outsider=await user(s,'outside-collab@example.test');addMember(s,owner,member);const card=await task(s,owner);const path=`/tasks/${card.id}`;
 assert.equal((await call(s,path+'/watch',{method:'PUT',cookie:member.cookie,body:{watching:true}})).status,200);
 const posted=await call(s,path+'/comments',{method:'POST',cookie:owner.cookie,body:{body:'Xin kiểm tra',mentionIds:[member.user.id]}});assert.equal(posted.status,201,JSON.stringify(posted.body));const id=posted.body.comment.id;
 const notices=s.db.prepare('SELECT * FROM notifications WHERE task_id=? AND user_id=?').all(card.id,member.user.id);assert.equal(notices.length,1);
 assert.equal((await call(s,path+'/collaboration',{cookie:outsider.cookie})).status,404);
 assert.equal((await call(s,path+'/comments/'+id,{method:'PATCH',cookie:member.cookie,body:{body:'Không được sửa'}})).status,403);
 assert.equal((await call(s,path+'/comments/'+id+'/reaction',{method:'PUT',cookie:member.cookie,body:{emoji:'👍',active:true}})).status,200);
 assert.equal((await call(s,path+'/comments/'+id,{method:'PATCH',cookie:owner.cookie,body:{body:'Đã cập nhật'}})).status,200);
 const info=await call(s,path+'/collaboration',{cookie:member.cookie});assert.equal(info.body.comments[0].reactions[0].count,1);assert.ok(info.body.comments[0].editedAt);
 const count=s.db.prepare('SELECT COUNT(*) n FROM task_comments').get().n;assert.equal((await call(s,path+'/comments',{method:'POST',cookie:owner.cookie,body:{body:'wrong recipient',mentionIds:[outsider.user.id]}})).status,400);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM task_comments').get().n,count);
 assert.equal((await call(s,path+'/comments/'+id,{method:'DELETE',cookie:owner.cookie})).status,200);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM comment_reactions').get().n,0);
});
