import test from 'node:test';import assert from 'node:assert/strict';import {boot,call,user,task,addMember} from './roadmap-helpers.mjs';
test('automation executes multiple actions, respects scope and rolls back a failed action',async t=>{const s=await boot(t),owner=await user(s,'automation@test.local'),other=await user(s,'other-automation@test.local');const rule=await call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Xử lý nhanh',trigger:'manual',actions:[{type:'priority',value:'high'},{type:'comment',value:'Đã tiếp nhận'}]}});assert.equal(rule.status,201);const card=await task(s,owner);assert.equal((await call(s,`/automations/${rule.body.id}/run`,{method:'POST',cookie:other.cookie,body:{taskId:card.id}})).status,404);const run=await call(s,`/automations/${rule.body.id}/run`,{method:'POST',cookie:owner.cookie,body:{taskId:card.id}});assert.equal(run.body.ok,true);assert.equal(s.db.prepare('SELECT priority FROM tasks WHERE id=?').get(card.id).priority,'high');assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(card.id).n,1);
 addMember(s,owner,other);const failing=await call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Rollback',trigger:'manual',actions:[{type:'priority',value:'low'},{type:'assignee',value:other.user.id}]}});assert.equal(failing.status,201);s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(owner.workspace.id,other.user.id);const fail=await call(s,`/automations/${failing.body.id}/run`,{method:'POST',cookie:owner.cookie,body:{taskId:card.id}});assert.equal(fail.body.ok,false);assert.equal(s.db.prepare('SELECT priority FROM tasks WHERE id=?').get(card.id).priority,'high');assert.equal(s.db.prepare("SELECT count(*) n FROM automation_runs WHERE status='failed'").get().n,1);
 const auto=await call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Tạo mới ưu tiên cao',trigger:'created',actions:[{type:'priority',value:'high'}]}});assert.equal(auto.status,201);const created=await task(s,owner);assert.equal(created.priority,'high');});
test('calendar events require valid dates and isolate tenant data; board transfer validates atomically',async t=>{const s=await boot(t),owner=await user(s,'events@test.local'),other=await user(s,'other-events@test.local');const created=await call(s,'/calendar-events',{method:'POST',cookie:owner.cookie,body:{title:'Hẹn khách hàng',startsAt:'2030-01-01T10:00:00Z',endsAt:'2030-01-01T11:00:00Z'}});assert.equal(created.status,201);assert.equal((await call(s,'/calendar-events',{cookie:other.cookie})).body.events.length,0);assert.equal((await call(s,`/calendar-events/${created.body.id}`,{method:'DELETE',cookie:other.cookie})).status,404);assert.equal((await call(s,'/calendar-events',{method:'POST',cookie:owner.cookie,body:{title:'Sai ngày',startsAt:'2030-01-01T12:00:00Z',endsAt:'2030-01-01T11:00:00Z'}})).status,400);
 const card=await task(s,owner);await call(s,`/tasks/${card.id}/checklists`,{method:'POST',cookie:owner.cookie,body:{title:'Các bước'}});const exported=await call(s,'/board-transfer',{cookie:owner.cookie});assert.equal(exported.status,200);assert.equal(exported.body.tasks.length,1);const imported=await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data:exported.body}});assert.equal(imported.status,201,JSON.stringify(imported.body));assert.equal(imported.body.count,1);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,2);const bad={...exported.body,tasks:[...exported.body.tasks,{...exported.body.tasks[0],dueAt:'not a date'}]};assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data:bad}})).status,400);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,2);});

test('status automation runs after board placement and keeps canonical status and column aligned',async t=>{const s=await boot(t),owner=await user(s,'board-rule@test.local');const rule=await call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Doing completes',trigger:'status_changed',conditionStatus:'doing',actions:[{type:'status',value:'done'}]}});assert.equal(rule.status,201);const card=await task(s,owner);const cols=(await call(s,'/boards',{cookie:owner.cookie})).body.columns;const r=await call(s,`/boards/tasks/${card.id}/move`,{method:'POST',cookie:owner.cookie,body:{columnId:cols.find(c=>c.status==='doing').id}});assert.equal(r.status,200);assert.equal(r.body.task.status,'done');assert.equal(cols.find(c=>c.id===r.body.task.columnId).status,'done');const card2=await task(s,owner);const patch=await call(s,`/tasks/${card2.id}`,{method:'PATCH',cookie:owner.cookie,body:{status:'doing'}});assert.equal(patch.body.task.status,'done');assert.equal(cols.find(c=>c.id===patch.body.task.columnId).status,'done');});

test('board transfer preserves checklist order and rejects unsupported recurrence without partial writes',async t=>{
 const s=await boot(t),owner=await user(s,'transfer-order@test.local'),card=await task(s,owner);
 const checklist=(await call(s,`/tasks/${card.id}/checklists`,{method:'POST',cookie:owner.cookie,body:{title:'Các bước'}})).body;
 const cid=s.db.prepare('SELECT id FROM task_checklists WHERE task_id=?').get(card.id).id;
 const now=new Date().toISOString();
 for(const [id,title,position] of [['order_a','Bước sau',1],['order_z','Bước đầu',0]])s.db.prepare('INSERT INTO task_checklist_items(id,checklist_id,title,completed,position,created_at,updated_at) VALUES (?,?,?,0,?,?,?)').run(id,cid,title,position,now,now);
 const exported=(await call(s,'/board-transfer',{cookie:owner.cookie})).body;
 assert.deepEqual(exported.tasks[0].checklists[0].items.map(i=>i.title),['Bước đầu','Bước sau']);
 assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data:exported}})).status,201);
 const imported=s.db.prepare('SELECT id FROM tasks WHERE workspace_id=? AND id!=?').get(owner.workspace.id,card.id);
 assert.deepEqual(s.db.prepare('SELECT i.title,i.position FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE c.task_id=? ORDER BY i.position').all(imported.id).map(i=>[i.title,i.position]),[['Bước đầu',0],['Bước sau',1]]);
 const invalid={...exported,tasks:[{...exported.tasks[0],recurrence:'hourly'}]};
 assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data:invalid}})).status,400);
 assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,2);
});

test('automation uses project access, revalidates removed assignees and reconciles extra assignments', async t => {
 const s=await boot(t),owner=await user(s,'roster-owner@test.local'),member=await user(s,'roster-member@test.local');
 addMember(s,owner,member);
 const team=(await call(s,'/teams',{method:'POST',cookie:owner.cookie,body:{name:'Roster',color:'blue',members:[{userId:member.user.id,role:'lead'}]}})).body.team;
 const outside=await user(s,'roster-no-grant@test.local');addMember(s,owner,outside);
 const createRule=value=>call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Assign',teamId:team.id,trigger:'manual',actions:[{type:'assignee',value}]}});
 assert.equal((await createRule(outside.user.id)).status,400);
 assert.equal((await createRule(owner.user.id)).status,201);
 const rule=await createRule(member.user.id);assert.equal(rule.status,201);
 const card=(await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:'Valid card',teamId:team.id}})).body.task;
 await call(s,`/tasks/${card.id}/extras`,{method:'PUT',cookie:owner.cookie,body:{assigneeIds:[member.user.id],labelIds:[]}});
 const run=()=>call(s,`/automations/${rule.body.id}/run`,{method:'POST',cookie:owner.cookie,body:{taskId:card.id}});
 assert.equal((await run()).body.ok,true);
 assert.equal(s.db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(card.id).assignee_id,member.user.id);
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_assignees WHERE task_id=? AND user_id=?').get(card.id,member.user.id).n,0);
 assert.equal((await call(s,`/tasks/${card.id}`,{method:'PATCH',cookie:owner.cookie,body:{title:'Still editable'}})).status,200);
 s.db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(team.id,member.user.id);
 assert.equal((await run()).body.ok,false);
});

test('board transfer preserves duplicate-name column identities and colors on repeated imports',async t=>{
 const s=await boot(t),owner=await user(s,'column-owner@test.local'),target=await user(s,'column-target@test.local');
 const ids=[];
 for(const tone of ['blue','rose','rose']){
  const r=await call(s,'/boards/columns',{method:'POST',cookie:owner.cookie,body:{name:'Review',status:'doing',tone}});assert.equal(r.status,201);ids.push(r.body.column.id);
 }
 for(const [i,columnId] of ids.entries())assert.equal((await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:`Review ${i}`,status:'doing',columnId}})).status,201);
 const data=(await call(s,'/board-transfer',{cookie:owner.cookie})).body;
 assert.deepEqual(data.tasks.map(task=>task.columnId).sort(),[...ids].sort());
 for(let i=0;i<2;i++)assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:target.cookie,body:{data}})).status,201);
 const cols=s.db.prepare("SELECT id,tone FROM board_columns WHERE workspace_id=? AND name='Review' ORDER BY position").all(target.workspace.id);
 assert.deepEqual(cols.map(c=>c.tone),['blue','rose','rose']);
 for(const [i,c] of cols.entries())assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=? AND title=? AND column_id=?').get(target.workspace.id,`Review ${i}`,c.id).n,2);
 const bad=structuredClone(data);bad.tasks[0].columnId='unknown';
 assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:target.cookie,body:{data:bad}})).status,400);
});

test('legacy board imports reject impossible checklist dates atomically and accept real leap days',async t=>{
 const s=await boot(t),owner=await user(s,'calendar-import@test.local');
 const data={format:'nhactoi-board',version:1,columns:[{name:'Legacy',status:'todo',tone:'green'}],tasks:[{title:'Imported',column:'Legacy',status:'todo',priority:'medium',checklists:[{title:'Steps',items:[{title:'Step',dueAt:'2026-02-31'}]}]}]};
 for(const invalid of ['2026-02-31','2026-02-29','2026-04-31']){
  data.tasks[0].checklists[0].items[0].dueAt=invalid;
  assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data}})).status,400);
 }
 assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,0);
 data.tasks[0].checklists[0].items[0].dueAt='2028-02-29';
 assert.equal((await call(s,'/board-transfer',{method:'POST',cookie:owner.cookie,body:{data}})).status,201);
 assert.equal(s.db.prepare('SELECT due_at FROM task_checklist_items').get().due_at,'2028-02-29');
 assert.equal(s.db.prepare('SELECT c.name FROM tasks t JOIN board_columns c ON c.id=t.column_id WHERE t.workspace_id=?').get(owner.workspace.id).name,'Legacy');
});
