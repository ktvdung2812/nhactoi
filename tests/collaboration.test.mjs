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
test('mention list follows current project access, including admins and direct grants without team membership',async t=>{
 const s=await boot(t),owner=await user(s,'owner-board@example.test'),mate=await user(s,'mate-board@example.test'),admin=await user(s,'admin-board@example.test');
 const other=await user(s,'other-board@example.test'),outsider=await user(s,'outsider-board@example.test');
 addMember(s,owner,mate);addMember(s,owner,admin);addMember(s,owner,other);
 s.db.prepare("UPDATE workspace_members SET role='admin' WHERE user_id=?").run(admin.user.id);
 const team=await call(s,'/teams',{method:'POST',cookie:owner.cookie,body:{name:'Kinh doanh',description:'',color:'green',members:[{userId:owner.user.id,role:'lead'},{userId:mate.user.id,role:'member'}]}});
 assert.equal(team.status,201,JSON.stringify(team.body));
 const card=await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:'Việc trong team',dueAt:'2030-01-01T10:00:00Z',teamId:team.body.team.id}});
 assert.equal(card.status,201,JSON.stringify(card.body));
 const info=await call(s,`/tasks/${card.body.task.id}/collaboration`,{cookie:owner.cookie});
 assert.equal(info.status,200,JSON.stringify(info.body));
 // FR-PROJ 3.2/3.3 grants workspace admins access to team projects. The
 // legacy SQLite board has no project ACL and retains its team-only picker.
 const inherited=[owner.user.id,mate.user.id,...(s.db.dialect==='postgres'?[admin.user.id]:[])].sort();
 assert.deepEqual(info.body.members.map(m=>m.id).sort(),inherited);
 assert.ok(!info.body.members.some(m=>m.id===other.user.id||m.id===outsider.user.id));
 if(s.db.dialect==='postgres'){
  const projectId=card.body.task.projectId;
  assert.ok(projectId);
  s.db.prepare('INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)').run(projectId,owner.workspace.id,other.user.id,'editor',new Date().toISOString());
  const granted=await call(s,`/tasks/${card.body.task.id}/collaboration`,{cookie:owner.cookie});
  assert.deepEqual(granted.body.members.map(m=>m.id).sort(),[...inherited,other.user.id].sort());
  assert.equal(s.db.prepare('SELECT count(*) n FROM team_members WHERE team_id=? AND user_id=?').get(team.body.team.id,other.user.id).n,0);
  s.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(projectId,other.user.id);
  const revoked=await call(s,`/tasks/${card.body.task.id}/collaboration`,{cookie:owner.cookie});
  assert.deepEqual(revoked.body.members.map(m=>m.id).sort(),inherited);
 }
 const shared=await task(s,owner,'Việc chung');
 const common=await call(s,`/tasks/${shared.id}/collaboration`,{cookie:owner.cookie});
 assert.deepEqual(common.body.members.map(m=>m.id).sort(),[owner.user.id,mate.user.id,admin.user.id,other.user.id].sort());
});
test('guests see mention names but never member emails',async t=>{
 const s=await boot(t),owner=await user(s,'owner-guest-mail@example.test');
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 const project=await call(s,'/projects',{method:'POST',cookie:owner.cookie,body:{name:'Chia sẻ',accessMode:'private'}});assert.equal(project.status,201,JSON.stringify(project.body));
 const invite=await call(s,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:'guest-mail@example.test',memberType:'guest',projectId:project.body.project.id,projectRole:'commenter'}});assert.equal(invite.status,201,JSON.stringify(invite.body));
 const token=new URLSearchParams(new URL(invite.body.inviteUrl).hash.slice(1)).get('invite');
 const guest=await call(s,'/invitations/accept',{method:'POST',body:{token,name:'Khách',password:'Password123!'}});assert.equal(guest.status,200,JSON.stringify(guest.body));
 const card=await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:'Việc chia sẻ',dueAt:'2030-01-01T10:00:00Z',projectId:project.body.project.id}});assert.equal(card.status,201,JSON.stringify(card.body));
 const path=`/tasks/${card.body.task.id}/collaboration`;
 const seen=await call(s,path,{cookie:guest.cookie});assert.equal(seen.status,200,JSON.stringify(seen.body));
 assert.ok(seen.body.members.some(m=>m.id===owner.user.id&&m.name));
 assert.ok(seen.body.members.every(m=>!('email' in m)));
 assert.doesNotMatch(JSON.stringify(seen.body),/owner-guest-mail@example\.test/);
 const own=await call(s,path,{cookie:owner.cookie});assert.equal(own.body.members.find(m=>m.id===owner.user.id).email,'owner-guest-mail@example.test');
});
