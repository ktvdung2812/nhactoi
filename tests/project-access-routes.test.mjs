import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

async function fixture(t) {
  const s = await boot(t);
  const owner = await user(s, 'acl-owner@example.test');
  const member = await user(s, 'acl-member@example.test');
  const guest = await user(s, 'acl-guest@example.test');
  const outsider = await user(s, 'acl-outsider@example.test');
  addMember(s, owner, member); addMember(s, owner, guest);
  s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id, guest.user.id);
  s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
  const api = (path, method='GET', body, actor=owner) => call(s, path, { method, body, cookie: actor.cookie });
  const created = await api('/projects', 'POST', { name: 'Private canary', accessMode: 'private' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const project = created.body.project;
  const result = await api('/tasks', 'POST', { title: 'CANARY_PRIVATE_84', projectId: project.id, assigneeId: owner.user.id });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.task.projectId, project.id);
  return { s, owner, member, guest, outsider, api, project, task: result.body.task };
}

// W1-T04-A/C/D: direct child URLs and list/count paths must use the same ACL.
test('private task canary is absent from lists, exports, child resources and other tenants', async t => {
  const { s, owner, member, outsider, api, task } = await fixture(t);
  s.db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at)
    VALUES('private_notice',?,?,?,'task_update','CANARY_PRIVATE_84','secret',?)`)
    .run(owner.workspace.id, member.user.id, task.id, new Date().toISOString());
  for (const actor of [member, outsider]) {
    for (const path of ['/tasks', '/tasks?q=CANARY', '/dashboard', '/board-transfer', '/notifications', '/notifications?page=1', '/personal-tasks']) {
      const r = await api(path, 'GET', undefined, actor);
      assert.equal(r.status, 200, path + JSON.stringify(r.body));
      assert.ok(!JSON.stringify(r.body).includes('CANARY_PRIVATE_84'), path);
    }
    for (const suffix of ['', '/detail', '/extras', '/collaboration', '/reminders']) {
      const r = await api('/tasks/' + task.id + suffix, 'GET', undefined, actor);
      assert.equal(r.status, 404, suffix + JSON.stringify(r.body));
    }
    assert.equal((await api('/tasks/' + task.id, 'PATCH', { title: 'stolen' }, actor)).status, 404);
  }
});

test('project roles apply to legacy routes and guest downgrade preserves readonly private access', async t => {
  const { s, owner, member, guest, api, project, task } = await fixture(t);
  const setRole = (actor, role) => api(`/projects/${project.id}/members/${actor.user.id}`, 'PUT', { role });
  assert.equal((await setRole(member, 'viewer')).status, 200);
  assert.equal((await api('/tasks/' + task.id, 'GET', undefined, member)).status, 200);
  assert.notEqual((await api('/tasks/' + task.id, 'PATCH', { title: 'no' }, member)).status, 200);
  assert.notEqual((await api(`/tasks/${task.id}/comments`, 'POST', { body: 'no' }, member)).status, 201);
  assert.equal((await setRole(member, 'commenter')).status, 200);
  assert.equal((await api(`/tasks/${task.id}/comments`, 'POST', { body: 'Comment allowed' }, member)).status, 201);
  assert.equal((await setRole(guest, 'editor')).status, 200);
  assert.equal((await api('/tasks/' + task.id, 'PATCH', { title: 'Guest edit' }, guest)).status, 200);
  assert.notEqual((await api('/tasks/' + task.id, 'DELETE', undefined, guest)).status, 200);
  for (const path of ['/customers', '/services', '/transactions', '/members', '/automations', '/billing'])
    assert.equal((await api(path, 'GET', undefined, guest)).status, 403, path);
  assert.equal((await api(`/projects/${project.id}/members/${owner.user.id}`, 'PUT', { role: 'viewer' }, guest)).status, 403);
  s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);
  assert.equal((await api('/tasks/' + task.id, 'GET', undefined, guest)).status, 200);
  assert.notEqual((await api('/tasks/' + task.id, 'PATCH', { title: 'downgraded' }, guest)).status, 200);
  assert.equal(s.db.prepare('SELECT access_mode FROM projects WHERE id=?').get(project.id).access_mode, 'private');
  assert.equal(s.db.prepare('SELECT COUNT(*) count FROM workspace_members WHERE workspace_id=?').get(owner.workspace.id).count, 3);
});

test('copy and recurrence stay in private project while legacy edits preserve it', async t => {
  const { s, api, project, task } = await fixture(t);
  const patch = await api('/tasks/' + task.id, 'PATCH', { dueAt: '2030-01-01T10:00:00Z', recurrence: 'daily' });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const copy = await api(`/tasks/${task.id}/copy`, 'POST', { dueAt: '2030-01-02T10:00:00Z' });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.equal(s.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(copy.body.task.id).project_id, project.id);
  const done = await api('/tasks/' + task.id, 'PATCH', { status: 'done' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.nextTask.projectId, project.id);
  assert.equal((await api('/tasks/' + task.id, 'PATCH', { title: 'Legacy edit' })).body.task.projectId, project.id);
});

test('project labels, templates and automation cannot expose private metadata or target a different project', async t => {
  const { s, owner, member, api, project, task } = await fixture(t);
  const label = await api('/task-labels', 'POST', { name: 'CANARY_PRIVATE_LABEL', color: 'blue', projectId: project.id });
  assert.equal(label.status,201,JSON.stringify(label.body));
  assert.equal((await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[],labelIds:[label.body.label.id]})).status,200);
  const template = await api('/task-templates','POST',{sourceTaskId:task.id,kind:'task',name:'CANARY_PRIVATE_TEMPLATE'});
  assert.equal(template.status,201,JSON.stringify(template.body));
  const rule = await api('/automations','POST',{projectId:project.id,name:'CANARY_PRIVATE_RULE',trigger:'manual',actions:[{type:'priority',value:'high'}]});
  assert.equal(rule.status,201,JSON.stringify(rule.body));
  for(const path of ['/task-labels','/task-templates','/automations']) {
    const r=await api(path,'GET',undefined,member);
    assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(!JSON.stringify(r.body).includes('CANARY_PRIVATE'),path);
  }
  assert.equal((await api(`/task-templates/${template.body.template.id}/create`,'POST',{},member)).status,404);
  const copy=await api(`/task-templates/${template.body.template.id}/create`,'POST',{});
  assert.equal(copy.status,201,JSON.stringify(copy.body));assert.equal(s.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(copy.body.task.id).project_id,project.id);
  const publicTask=await api('/tasks','POST',{title:'Public task'});
  assert.equal((await api(`/tasks/${publicTask.body.task.id}/extras`,'PUT',{assigneeIds:[],labelIds:[label.body.label.id]})).status,400);
  assert.equal((await api(`/automations/${rule.body.id}/run`,'POST',{taskId:publicTask.body.task.id})).status,404);
  assert.equal((await api(`/automations/${rule.body.id}/run`,'POST',{taskId:task.id})).status,200);
  assert.equal(s.db.prepare('SELECT priority FROM tasks WHERE id=?').get(task.id).priority,'high');
});

test('guest sees scoped boards and task links exclude CRM fields and non-task notices', async t => {
  const {s,owner,guest,api,project,task}=await fixture(t);
  await api(`/projects/${project.id}/members/${guest.user.id}`,'PUT',{role:'editor'});
  const customer=await api('/customers','POST',{name:'CANARY_CRM',email:'secret@example.test'});
  assert.equal(customer.status,201,JSON.stringify(customer.body));
  await api(`/tasks/${task.id}`,'PATCH',{customerId:customer.body.customer.id});
  s.db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,type,title,message,created_at) VALUES('guest_sensitive_notice',?,?,'calendar_event','CANARY_CRM','secret',?)`).run(owner.workspace.id,guest.user.id,new Date().toISOString());
  for(const path of ['/tasks','/tasks?page=1','/dashboard',`/tasks/${task.id}`,`/tasks/${task.id}/detail`,'/personal-tasks','/notifications','/notifications?page=1']) {
    const r=await api(path,'GET',undefined,guest);assert.equal(r.status,200,path+JSON.stringify(r.body));
    assert.ok(!JSON.stringify(r.body).includes('CANARY_CRM'),path);assert.ok(!JSON.stringify(r.body).includes(customer.body.customer.id),path);
  }
  const board=await api(`/boards?projectId=${project.id}`,'GET',undefined,guest);
  assert.equal(board.status,200,JSON.stringify(board.body));
});


test('direct team-project grants authorize create, patch, extras, checklist, copy and automation without roster membership', async t => {
  const {s,owner,member,guest,api}=await fixture(t);
  const team=await api('/teams','POST',{name:'Scoped team',color:'green',members:[{userId:owner.user.id,role:'lead'}]});
  assert.equal(team.status,201,JSON.stringify(team.body));
  const created=await api('/projects','POST',{name:'Explicit grants',accessMode:'team',teamId:team.body.team.id});
  const project=created.body.project;
  for(const actor of [member,guest]) assert.equal((await api(`/projects/${project.id}/members/${actor.user.id}`,'PUT',{role:'editor'})).status,200);
  assert.equal(s.db.prepare('SELECT COUNT(*) count FROM team_members WHERE team_id=? AND user_id IN (?,?)').get(team.body.team.id,member.user.id,guest.user.id).count,0);
  const result=await api('/tasks','POST',{title:'Direct project member',projectId:project.id,assigneeId:member.user.id},member);
  assert.equal(result.status,201,JSON.stringify(result.body));const id=result.body.task.id;
  assert.equal((await api(`/tasks/${id}`,'PATCH',{title:'Updated',assigneeId:guest.user.id},member)).status,200);
  const extras=await api(`/tasks/${id}/extras`,'PUT',{assigneeIds:[member.user.id],labelIds:[]},member);
  assert.equal(extras.status,200,JSON.stringify(extras.body));assert.ok(extras.body.members.some(x=>x.id===guest.user.id));
  const checklist=await api(`/tasks/${id}/checklists`,'POST',{title:'Steps'},member);
  const listId=checklist.body.checklist.id;
  const item=await api(`/tasks/${id}/checklists/${listId}/items`,'POST',{title:'Step'},member);
  assert.equal((await api(`/tasks/${id}/checklists/${listId}/items/${item.body.item.id}`,'PATCH',{assigneeIds:[member.user.id]},member)).status,200);
  const copy=await api(`/tasks/${id}/copy`,'POST',{},member);
  assert.equal(copy.status,201,JSON.stringify(copy.body));assert.equal(s.db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(copy.body.task.id).assignee_id,guest.user.id);
  const template=await api('/task-templates','POST',{sourceTaskId:id,kind:'task',name:'Direct member template'},member);
  assert.equal(template.status,201,JSON.stringify(template.body));assert.equal((await api(`/task-templates/${template.body.template.id}/create`,'POST',{},member)).status,201);
  await api(`/projects/${project.id}/members/${member.user.id}`,'PUT',{role:'manager'});
  const rule=await api('/automations','POST',{projectId:project.id,name:'Direct member rule',trigger:'manual',actions:[{type:'assignee',value:member.user.id}]},member);
  assert.equal(rule.status,201,JSON.stringify(rule.body));assert.equal((await api(`/automations/${rule.body.id}/run`,'POST',{taskId:id},member)).status,200);
  await api(`/projects/${project.id}/members/${guest.user.id}`,'DELETE');
  assert.equal((await api(`/tasks/${id}/extras`,'PUT',{assigneeIds:[guest.user.id],labelIds:[]},member)).status,400);
});

test('project moves reject invalid labels and secondary/checklist assignments without business or side-effect changes', async t => {
  const {s,owner,member,api,project,task}=await fixture(t);
  await api(`/projects/${project.id}/members/${member.user.id}`,'PUT',{role:'editor'});
  const target=(await api('/projects','POST',{name:'Move target',accessMode:'private'})).body.project;
  const label=(await api('/task-labels','POST',{name:'Source label',color:'blue',projectId:project.id})).body.label;
  await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[],labelIds:[label.id]});
  const snapshot=()=>JSON.stringify({task:s.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),events:s.db.prepare('SELECT * FROM business_events WHERE task_id=? ORDER BY id').all(task.id),receipts:s.db.prepare('SELECT * FROM mutation_receipts ORDER BY operation_id').all(),effects:Object.fromEntries(['delivery_leases','notifications','reminder_email_outbox','notification_outbox','web_push_deliveries','automation_event_queue','task_label_links','task_assignees','task_checklist_assignees'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]))});
  const rejected=async()=>{const before=snapshot();const r=await api(`/tasks/${task.id}`,'PATCH',{projectId:target.id,title:'Must rollback'});assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(snapshot(),before);};
  await rejected();
  await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[member.user.id],labelIds:[]});await rejected();
  const list=(await api(`/tasks/${task.id}/checklists`,'POST',{title:'Move checklist'})).body.checklist;
  const item=(await api(`/tasks/${task.id}/checklists/${list.id}/items`,'POST',{title:'Move step'})).body.item;
  await api(`/tasks/${task.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{assigneeIds:[member.user.id]});
  await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[],labelIds:[]});await rejected();
  // The restore-only historical exception must not carry a completed item's
  // former recipient into another project where they have no access.
  assert.equal((await api(`/tasks/${task.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{completed:true})).status,200);
  await rejected();
  await api(`/tasks/${task.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{assigneeIds:[]});
  const moved=await api(`/tasks/${task.id}`,'PATCH',{projectId:target.id});assert.equal(moved.status,200,JSON.stringify(moved.body));assert.equal(moved.body.task.projectId,target.id);
});

test('copy, checklist assignment and restore revalidate revoked project recipients', async t => {
  const {s,member,api,project,task}=await fixture(t);
  await api(`/projects/${project.id}/members/${member.user.id}`,'PUT',{role:'editor'});
  await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[member.user.id],labelIds:[]});
  const list=(await api(`/tasks/${task.id}/checklists`,'POST',{title:'Revoked checklist'})).body.checklist;
  const item=(await api(`/tasks/${task.id}/checklists/${list.id}/items`,'POST',{title:'Revoked step'})).body.item;
  await api(`/projects/${project.id}/members/${member.user.id}`,'DELETE');
  assert.equal((await api(`/tasks/${task.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{assigneeIds:[member.user.id]})).status,400);
  assert.equal((await api(`/tasks/${task.id}/copy`,'POST',{})).status,409);
  await api(`/tasks/${task.id}`,'DELETE');
  const trash=(await api('/trash')).body.items.find(x=>x.entityId===task.id);
  assert.equal(trash.canRestore,false);assert.equal((await api('/trash/restore','POST',{ids:[trash.id]})).status,409);
  assert.ok(s.db.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(task.id).deleted_at);
});

test('completed checklist history restores in place but cannot create copies for a revoked recipient', async t => {
  const {s,member,api,project,task}=await fixture(t);
  assert.equal((await api(`/projects/${project.id}/members/${member.user.id}`,'PUT',{role:'editor'})).status,200);
  assert.equal((await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[member.user.id],labelIds:[]})).status,200);
  const list=(await api(`/tasks/${task.id}/checklists`,'POST',{title:'Historical checklist'})).body.checklist;
  const item=(await api(`/tasks/${task.id}/checklists/${list.id}/items`,'POST',{title:'Completed step'})).body.item;
  assert.equal((await api(`/tasks/${task.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{assigneeIds:[member.user.id],completed:true})).status,200);
  assert.equal((await api(`/tasks/${task.id}/extras`,'PUT',{assigneeIds:[],labelIds:[]})).status,200);
  assert.equal((await api(`/projects/${project.id}/members/${member.user.id}`,'DELETE')).status,200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_assignees WHERE task_id=?').get(task.id).n,0);
  const tables=['tasks','task_checklists','task_checklist_items','task_checklist_assignees','business_events','task_activity','mutation_receipts','notifications','notification_outbox','reminder_email_outbox','web_push_deliveries','automation_event_queue','google_calendar_jobs','zalo_oa_deliveries','webhook_deliveries'];
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  for(const path of [`/tasks/${task.id}/copy`,`/tasks/${task.id}/checklists/${list.id}/copy`]) {
    const before=snapshot();
    const response=await api(path,'POST',{});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.deepEqual(snapshot(),before);
  }
  assert.equal((await api(`/tasks/${task.id}`,'DELETE')).status,200);
  const trash=(await api('/trash')).body.items.find(row=>row.entityId===task.id);
  assert.equal(trash.canRestore,true);
  assert.equal((await api('/trash/restore','POST',{ids:[trash.id]})).status,200);
  const restored=s.db.prepare('SELECT deleted_at,project_id FROM tasks WHERE id=?').get(task.id);
  assert.equal(restored.deleted_at,null);assert.equal(restored.project_id,project.id);
  assert.equal(s.db.prepare('SELECT completed FROM task_checklist_items WHERE id=?').get(item.id).completed,1);
  assert.equal(s.db.prepare('SELECT user_id FROM task_checklist_assignees WHERE item_id=?').get(item.id).user_id,member.user.id);
  assert.equal((await api(`/tasks/${task.id}/detail`,'GET',undefined,member)).status,404);
  assert.equal(s.db.prepare('SELECT count(*) n FROM project_members WHERE project_id=? AND user_id=?').get(project.id,member.user.id).n,0);
});


test('dashboard pages task records while SQL summaries and customer filters retain full authorized totals', async t => {
  const {s,owner,member,api,task}=await fixture(t);
  const customer=(await api('/customers','POST',{name:'Paged customer'})).body.customer;
  s.db.prepare(`INSERT INTO tasks(id,workspace_id,project_id,title,description,status,priority,recurrence,assignee_id,customer_id,created_by,created_at,updated_at)
    SELECT 'paged_'||n,?,?, 'Paged task '||n,'',CASE WHEN n%2=0 THEN 'done' ELSE 'todo' END,'medium','none',?,?,?,'2030-01-01T00:00:00Z','2030-01-01T00:00:00Z'
    FROM generate_series(1,125) n`).run(owner.workspace.id,'prj_ws_'+owner.workspace.id,owner.user.id,customer.id,owner.user.id);
  const first=await api('/dashboard');assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.tasks.length,50);assert.equal(first.body.taskPage.total,126);assert.equal(first.body.taskPage.hasMore,true);
  assert.equal(first.body.taskSummary.total,126);assert.equal(first.body.taskSummary.completed,62);
  const next=await api('/dashboard?page=2');assert.equal(next.body.tasks.length,50);assert.ok(next.body.tasks.every(x=>!first.body.tasks.some(y=>x.id===y.id)));
  const compact=await api('/dashboard?tasks=none');assert.equal(compact.body.tasks.length,0);assert.equal(compact.body.taskPage,null);assert.equal(compact.body.taskSummary.total,126);
  const scoped=await api(`/dashboard?customerId=${customer.id}&openOnly=true`);assert.equal(scoped.body.taskPage.total,63);assert.equal(scoped.body.taskSummary.byCustomer.find(x=>x.id===customer.id).total,125);
  const hidden=await api('/dashboard?tasks=none','GET',undefined,member);assert.equal(hidden.body.taskSummary.total,125);assert.ok(!JSON.stringify(hidden.body).includes(task.id));
  assert.equal((await api('/dashboard?pageSize=101')).status,400);
  assert.equal((await api(`/tasks?customerId=${customer.id}&page=3`)).body.total,125);
});


test('archived projects block restore and legacy reminder workers revalidate direct grants and imported checklist history',async t=>{
 const {s,owner,member,api,project,task}=await fixture(t);
 const team=(await api('/teams','POST',{name:'Reminder scope',color:'green',members:[{userId:owner.user.id,role:'lead'}]})).body.team;
 const target=(await api('/projects','POST',{name:'Reminder direct grant',accessMode:'team',teamId:team.id})).body.project;
 await api(`/projects/${target.id}/members/${member.user.id}`,'PUT',{role:'editor'});
 const card=(await api('/tasks','POST',{title:'Direct reminder',projectId:target.id,assigneeId:member.user.id,dueAt:'2020-01-01T10:00:00Z',remindAt:'2020-01-01T09:00:00Z'})).body.task;
 const list=(await api(`/tasks/${card.id}/checklists`,'POST',{title:'Reminder list'})).body.checklist;
 const item=(await api(`/tasks/${card.id}/checklists/${list.id}/items`,'POST',{title:'Reminder item'})).body.item;
 await api(`/tasks/${card.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{assigneeIds:[member.user.id],remindAt:'2020-01-01T08:00:00Z'});
 assert.ok((await api(`/tasks/${card.id}/collaboration`,'GET',undefined,member)).body.members.some(x=>x.id===member.user.id));
 const first=s.app.locals.processReminders();assert.ok(first.some(x=>x.taskId===card.id));assert.ok(first.some(x=>x.checklistItemId===item.id));
 await api(`/tasks/${card.id}`,'PATCH',{remindAt:'2020-01-02T09:00:00Z'});
 await api(`/tasks/${card.id}/checklists/${list.id}/items/${item.id}`,'PATCH',{remindAt:'2020-01-02T08:00:00Z'});
 await api(`/projects/${target.id}/members/${member.user.id}`,'DELETE');
 const before=s.db.prepare('SELECT count(*) n FROM notifications WHERE task_id=?').get(card.id).n;
 s.app.locals.processReminders();assert.equal(s.db.prepare('SELECT count(*) n FROM notifications WHERE task_id=?').get(card.id).n,before);
 await api(`/projects/${target.id}/members/${member.user.id}`,'PUT',{role:'editor'});
 s.db.prepare("UPDATE tasks SET imported_at='2021-01-01T00:00:00Z' WHERE id=?").run(card.id);
 s.app.locals.processReminders();assert.equal(s.db.prepare('SELECT count(*) n FROM notifications WHERE task_id=?').get(card.id).n,before);
 await api(`/tasks/${task.id}`,'DELETE');s.db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run(new Date().toISOString(),project.id);
 const trash=(await api('/trash')).body.items.find(x=>x.entityId===task.id);assert.equal(trash.canRestore,false);assert.equal((await api('/trash/restore','POST',{ids:[trash.id]})).status,409);
});
