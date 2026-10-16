import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from './database-helpers.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot } from '../server/database-snapshot.mjs';
import { V7_TABLE_COLUMNS } from '../server/database-tables.mjs';

console.info(`[W3] Runtime ${process.version}; application schema ${SCHEMA_VERSION}; isolated PostgreSQL fixtures`);
const clock=()=>new Date('2026-10-16T02:00:00Z');
async function setup(t){
  const s=await boot(t,{clock});const owner=await user(s,'advanced-owner@example.test');
  s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2032-01-01' WHERE workspace_id=?").run(owner.workspace.id);
  const request=(path,method='GET',body,actor=owner)=>call(s,path,{cookie:actor.cookie,method,body});
  const result=await request('/projects','POST',{name:'W3 private',accessMode:'private'});assert.equal(result.status,201,JSON.stringify(result.body));const project=result.body.project;
  async function task(title,extra={}){const r=await request('/tasks','POST',{title,projectId:project.id,dueAt:'2028-02-28T02:00:00Z',...extra});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.task;}
  async function field(name,type,extra={}){const r=await request(`/projects/${project.id}/fields`,'POST',{name,type,...extra});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.field;}
  return{...s,owner,request,project,task,field};
}
test('TC-W3-T01-A/B/C/D: six typed fields, atomic validation and numeric filter/sort/export data',async t=>{
  const s=await setup(t),a=await s.task('A'),b=await s.task('B');
  const fields=await Promise.all([s.field('Text','text'),s.field('Number','number'),s.field('Date','date'),s.field('Single','single',{options:[{name:'One'}]}),s.field('Multiple','multiple',{options:[{name:'Two'},{name:'Three'}]}),s.field('Check','checkbox')]);
  const [text,num,date,single,multiple,check]=fields;
  const values={[text.id]:'',[num.id]:0,[date.id]:'2028-02-29',[single.id]:single.options[0].id,[multiple.id]:multiple.options.map(o=>o.id),[check.id]:false};
  let r=await s.request(`/tasks/${a.id}/fields`,'PUT',{values,expectedRevision:a.revision});assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.values,values);assert.notEqual(r.body.revision,a.revision);
  assert.equal((await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[num.id]:8},expectedRevision:a.revision})).status,409);
  for(const invalid of [{[date.id]:'2027-02-29'},{[num.id]:'2'},{[check.id]:0},{[single.id]:'outside-option'}]){
    r=await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[text.id]:'must rollback',...invalid}});assert.equal(r.status,400,JSON.stringify(r.body));assert.equal((await s.request(`/tasks/${a.id}/fields`)).body.values[text.id],'');
  }
  r=await s.request(`/projects/${s.project.id}/fields/${num.id}`,'PATCH',{name:'Renamed',position:2});assert.equal(r.body.field.id,num.id);
  assert.equal((await s.request(`/projects/${s.project.id}/fields/${num.id}`,'PATCH',{type:'text'})).status,409);
  await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[num.id]:10,[text.id]:null}});await s.request(`/tasks/${b.id}/fields`,'PUT',{values:{[num.id]:2}});
  const config={sort:{fieldId:num.id,direction:'asc'}};r=await s.request(`/projects/${s.project.id}/tasks?config=${encodeURIComponent(JSON.stringify(config))}`);assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.tasks.map(t=>t.id),[b.id,a.id]);assert.equal(r.body.tasks[1].customValues[text.id],null);
  r=await s.request(`/projects/${s.project.id}/tasks?config=${encodeURIComponent(JSON.stringify({filters:[{fieldId:num.id,op:'gt',value:2}]}))}`);assert.deepEqual(r.body.tasks.map(t=>t.id),[a.id]);
});
test('TC-W3-T01-E and T02-C/D: retire and downgrade preserve values; views revalidate identity and ACL',async t=>{
  const s=await setup(t),a=await s.task('Canary'),field=await s.field('Stage','single',{options:[{name:'Keep'},{name:'Retire'}]});
  await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:field.options[1].id}});
  const view=await s.request(`/projects/${s.project.id}/views`,'POST',{name:'Saved',visibility:'personal',config:{filters:[{fieldId:field.id,op:'eq',value:field.options[1].id}]}});assert.equal(view.status,201,JSON.stringify(view.body));
  const outsider=await user(s,'advanced-outside@example.test');assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${view.body.view.id}`,'GET',undefined,outsider)).status,404);
  const member=await user(s,'advanced-member@example.test');addMember(s,s.owner,member);await s.request(`/projects/${s.project.id}/members/${member.user.id}`,'PUT',{role:'editor'});
  assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${view.body.view.id}`,'GET',undefined,member)).status,404);
  await s.request(`/projects/${s.project.id}/fields/${field.id}`,'PATCH',{options:[field.options[0]]});
  assert.equal((await s.request(`/tasks/${a.id}/fields`)).body.values[field.id],field.options[1].id);
  const second=await s.task('Second');assert.equal((await s.request(`/tasks/${second.id}/fields`,'PUT',{values:{[field.id]:field.options[1].id}})).status,400);
  assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${view.body.view.id}`)).status,400);
  assert.equal((await s.request(`/projects/${s.project.id}/views`)).body.views[0].valid,false);
  await s.request(`/projects/${s.project.id}/fields/${field.id}`,'PATCH',{retired:true});
  s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(s.owner.workspace.id);
  assert.equal((await s.request(`/tasks/${a.id}/fields`)).status,200);assert.equal((await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:null}})).status,409);
  assert.equal((await s.request(`/projects/${s.project.id}/tasks`)).body.tasks.length,2);
});
test('TC-W3-T01-D/T02-A/D: typed filters agree across layouts and saved assignee views invalidate after revoke',async t=>{
  const s=await setup(t),a=await s.task('First'),b=await s.task('Second'),undated=await s.task('No date',{dueAt:null});
  const text=await s.field('Text','text'),date=await s.field('Date','date'),check=await s.field('Check','checkbox'),multi=await s.field('Multiple','multiple',{options:[{name:'One'},{name:'Two'}]});
  for(const [task,values]of [[a,{[text.id]:'Tiếng Việt 100%', [date.id]:'2028-02-29',[check.id]:false,[multi.id]:multi.options.map(o=>o.id)}],[b,{[text.id]:'Another',[date.id]:'2028-03-01',[check.id]:true,[multi.id]:[multi.options[1].id]}],[undated,{[text.id]:'Tiếng Việt',[check.id]:false}]])assert.equal((await s.request(`/tasks/${task.id}/fields`,'PUT',{values})).status,200);
  const query=async config=>{const r=await s.request(`/projects/${s.project.id}/tasks?config=${encodeURIComponent(JSON.stringify(config))}`);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.tasks.map(t=>t.id);};
  for(const [filter,expected]of [[{fieldId:text.id,op:'contains',value:'100%'},[a.id]],[{fieldId:check.id,op:'eq',value:true},[b.id]],[{fieldId:multi.id,op:'contains',value:[multi.options[0].id]},[a.id]],[{fieldId:date.id,op:'lt',value:'2028-03-01'},[a.id]]])for(const layout of ['list','kanban','calendar'])assert.deepEqual(await query({layout,filters:[filter]}),expected);
  assert.deepEqual(await query({sort:{fieldId:date.id,direction:'asc'}}),[a.id,b.id,undated.id]);
  assert.deepEqual(await query({filters:[{fieldId:date.id,op:'empty'}]}),[undated.id]);
  const assignee=await user(s,'view-assignee@example.test');addMember(s,s.owner,assignee);await s.request(`/projects/${s.project.id}/members/${assignee.user.id}`,'PUT',{role:'editor'});
  const view=(await s.request(`/projects/${s.project.id}/views`,'POST',{name:'Shared assignee',visibility:'project',config:{assigneeId:assignee.user.id}})).body.view;
  const outside=await user(s,'view-outsider@example.test');assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${view.id}`,'GET',undefined,outside)).status,404);
  await s.request(`/projects/${s.project.id}/members/${assignee.user.id}`,'DELETE');
  assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${view.id}`)).status,400);assert.equal((await s.request(`/projects/${s.project.id}/views`)).body.views.find(v=>v.id===view.id).valid,false);
});
test('TC-W3-T02-A/B and T04: views share paging; timeline rejects invalid dates and revisions without changing personal plan',async t=>{
  const s=await setup(t),dated=await s.task('Dated'),undated=await s.task('Undated',{dueAt:null});
  assert.equal((await s.request(`/tasks/${dated.id}/plan`,'PATCH',{plannedDate:'2028-02-26',plannedTime:'10:00',plannedDuration:60})).status,200);
  const plan=s.db.prepare('SELECT * FROM personal_task_plans WHERE task_id=?').get(dated.id);
  const list=await s.request(`/projects/${s.project.id}/tasks?pageSize=1`);assert.equal(list.body.total,2);assert.equal(list.body.tasks.length,1);
  const timeline=await s.request(`/projects/${s.project.id}/tasks?config=${encodeURIComponent(JSON.stringify({layout:'timeline'}))}`);assert.equal(timeline.body.total,2);
  const calendar=await s.request(`/projects/${s.project.id}/tasks?config=${encodeURIComponent(JSON.stringify({layout:'calendar'}))}`);assert.deepEqual(calendar.body.tasks.map(t=>t.id),[dated.id]);
  let r=await s.request(`/tasks/${dated.id}/timeline`,'PATCH',{startAt:'2028-02-29T02:00:00Z',expectedRevision:dated.revision});assert.equal(r.status,400);
  for(const startAt of ['2028-02-27T24:00:00Z','2028-02-30T02:00:00Z','2028-02-27'])assert.equal((await s.request(`/tasks/${dated.id}/timeline`,'PATCH',{startAt})).status,400);
  r=await s.request(`/tasks/${dated.id}/timeline`,'PATCH',{startAt:'2028-02-27T02:00:00Z',expectedRevision:dated.revision});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.task.dueAt,dated.dueAt);assert.notEqual(r.body.task.revision,dated.revision);
  assert.equal((await s.request(`/tasks/${dated.id}/timeline`,'PATCH',{startAt:null,expectedRevision:dated.revision})).status,409);
  assert.equal((await s.request(`/tasks/${undated.id}/timeline`,'PATCH',{startAt:null})).status,200);
  assert.deepEqual(s.db.prepare('SELECT * FROM personal_task_plans WHERE task_id=?').get(dated.id),plan);
  const before=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(dated.id),events=s.db.prepare('SELECT count(*) n FROM business_events').get().n;
  assert.equal((await s.request(`/tasks/${dated.id}`,'PATCH',{dueAt:'2028-02-26T02:00:00Z'})).status,400);
  assert.deepEqual(s.db.prepare('SELECT * FROM tasks WHERE id=?').get(dated.id),before);assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,events);
  const viewer=await user(s,'timeline-viewer@example.test');addMember(s,s.owner,viewer);await s.request(`/projects/${s.project.id}/members/${viewer.user.id}`,'PUT',{role:'viewer'});
  assert.equal((await s.request(`/tasks/${dated.id}/timeline`,'PATCH',{startAt:null},viewer)).status,403);
});
test('TC-W3-T03-A/C/D/E/F: DAG and archived predecessors retain warning and block cross-project move',async t=>{
  const s=await setup(t),a=await s.task('A'),b=await s.task('B'),c=await s.task('C');
  const edge=(x,y)=>s.request(`/projects/${s.project.id}/dependencies`,'POST',{predecessorId:x.id,successorId:y.id});
  assert.equal((await edge(a,b)).status,201);assert.equal((await edge(b,c)).status,201);assert.equal((await edge(c,a)).status,409);assert.equal((await edge(a,a)).status,400);assert.equal((await edge(a,b)).body.created,false);
  assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(b.id).status,'todo');
  assert.equal((await s.request(`/tasks/${b.id}`,'PATCH',{status:'done'})).status,200,'blocking warns but does not prohibit completion');
  s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(a.id);assert.equal((await s.request(`/projects/${s.project.id}/dependencies`)).body.dependencies.find(d=>d.predecessorId===a.id).blocking,false);
  assert.equal((await s.request(`/tasks/${a.id}`,'PATCH',{status:'todo'})).status,200);assert.equal((await s.request(`/projects/${s.project.id}/dependencies`)).body.dependencies.find(d=>d.predecessorId===a.id).blocking,true);
  s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(a.id);
  s.db.prepare('UPDATE tasks SET deleted_at=? WHERE id=?').run(clock().toISOString(),a.id);assert.equal((await s.request(`/projects/${s.project.id}/dependencies`)).body.dependencies.find(d=>d.predecessorId===a.id).blocking,true);
  const target=(await s.request('/projects','POST',{name:'Target',accessMode:'workspace'})).body.project;
  assert.throws(()=>s.db.prepare('UPDATE tasks SET project_id=? WHERE id=?').run(target.id,b.id),/Resolve dependencies/);
  const foreign=(await s.request('/tasks','POST',{title:'Foreign',projectId:target.id})).body.task;assert.equal((await edge(b,foreign)).status,400);
});
test('TC-W3-T03-B: independent PostgreSQL connections serialize opposing dependency writes',async t=>{
  const s=await setup(t),a=await s.task('A'),b=await s.task('B');
  const clients=[new Client({connectionString:process.env.TEST_DATABASE_URL}),new Client({connectionString:process.env.TEST_DATABASE_URL})];
  await Promise.all(clients.map(c=>c.connect()));t.after(()=>Promise.all(clients.map(c=>c.end())));
  await Promise.all(clients.map(c=>c.query(`SET search_path TO "${s.db.schema}",public`)));
  const secondPid=(await clients[1].query('SELECT pg_backend_pid() pid')).rows[0].pid;
  await clients[0].query('BEGIN');await clients[0].query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[s.project.id]);
  const insert=(c,x,y)=>c.query('INSERT INTO task_dependencies(workspace_id,project_id,predecessor_id,successor_id,created_at) VALUES ($1,$2,$3,$4,$5)',[s.owner.workspace.id,s.project.id,x.id,y.id,clock().toISOString()]);
  const second=insert(clients[1],b,a).then(()=>({ok:true}),error=>({error}));
  try{const deadline=Date.now()+5000;while(true){const waiting=await clients[0].query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[secondPid]);if(waiting.rows[0]?.wait_event_type==='Lock')break;assert.ok(Date.now()<deadline,'opposing insert reached project-lock barrier');await delay(10);}await insert(clients[0],a,b);}finally{await clients[0].query('COMMIT');}const result=await second;
  assert.match(result.error?.message||'',/Dependency cycle/);assert.equal(s.db.prepare('SELECT count(*) n FROM task_dependencies WHERE project_id=?').get(s.project.id).n,1);
});
test('TC-W3-T05-A/B/D: template remaps all internal IDs and relative dates; retries/faults are atomic',async t=>{
  const s=await setup(t),a=await s.task('Recurring',{recurrence:'monthly'}),b=await s.task('Dependent');
  const field=await s.field('Choice','single',{options:[{name:'Red'}]});await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:field.options[0].id}});
  await s.request(`/projects/${s.project.id}/dependencies`,'POST',{predecessorId:a.id,successorId:b.id});
  const checklist=(await s.request(`/tasks/${a.id}/checklists`,'POST',{title:'Checklist'})).body.checklist;
  assert.ok(checklist);const item=await s.request(`/tasks/${a.id}/checklists/${checklist.id}/items`,'POST',{title:'Child'});assert.equal(item.status,201,JSON.stringify(item.body));
  const template=await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Reusable',anchorAt:'2028-02-28T02:00:00Z'});assert.equal(template.status,201,JSON.stringify(template.body));
  const path=`/project-templates/${template.body.template.id}`,body={name:'Instance',startAt:'2028-02-29T02:00:00Z',operationId:'template-operation-1'};
  const before=s.db.prepare('SELECT count(*) n FROM projects').get().n;assert.equal((await s.request(path+'/preview','POST',body)).body.valid,true);assert.equal(s.db.prepare('SELECT count(*) n FROM projects').get().n,before);
  const created=await s.request(path+'/apply','POST',body);assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(s.db.prepare('SELECT access_mode FROM projects WHERE id=?').get(created.body.projectId).access_mode,'private','template defaults preserve private source scope');
  const result=s.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY title').all(created.body.projectId);assert.equal(result.length,2);assert.equal(result.find(t=>t.title==='Recurring').due_at,'2028-02-29T02:00:00.000Z');assert.ok(result.every(t=>![a.id,b.id].includes(t.id)));
  const links=s.db.prepare('SELECT * FROM task_dependencies WHERE project_id=?').all(created.body.projectId);assert.equal(links.length,1);assert.ok(result.some(t=>t.id===links[0].predecessor_id));
  const newField=s.db.prepare('SELECT * FROM project_fields WHERE project_id=?').get(created.body.projectId);assert.notEqual(newField.id,field.id);assert.notEqual(JSON.parse(newField.options_json)[0].id,field.options[0].id);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_checklists WHERE task_id=?').get(result.find(t=>t.title==='Recurring').id).n,1);
  const replay=await s.request(path+'/apply','POST',body);assert.equal(replay.body.projectId,created.body.projectId);assert.equal(replay.body.replayed,true);assert.equal((await s.request(path+'/apply','POST',{...body,name:'Different'})).status,409);
  s.db.exec("CREATE FUNCTION test_template_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Dependent' THEN RAISE EXCEPTION 'injected rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_template_failure BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION test_template_failure()");
  const failed=await s.request(path+'/apply','POST',{...body,operationId:'template-operation-2'});assert.equal(failed.status,500);assert.equal(s.db.prepare('SELECT count(*) n FROM projects').get().n,before+1);assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get('template-operation-2').n,0);
});
test('TC-W3-T05-C: template preview requires mapping for removed assignees; viewer cannot write premium data',async t=>{
  const s=await setup(t),person=await user(s,'advanced-assignee@example.test');addMember(s,s.owner,person);await s.request(`/projects/${s.project.id}/members/${person.user.id}`,'PUT',{role:'editor'});
  const customer=(await s.request('/customers','POST',{name:'Old customer'})).body.customer;
  const task=await s.task('Assigned',{assigneeId:person.user.id,customerId:customer.id});const tmpl=await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Mapping',anchorAt:'2028-02-28T02:00:00Z'});
  s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(s.owner.workspace.id,person.user.id);
  s.db.prepare('UPDATE customers SET deleted_at=? WHERE id=?').run(clock().toISOString(),customer.id);
  const body={name:'Target',startAt:'2029-01-01T02:00:00Z',operationId:'mapping-operation-1'},path=`/project-templates/${tmpl.body.template.id}`;
  const preview=await s.request(path+'/preview','POST',body);assert.equal(preview.body.valid,false);assert.deepEqual(preview.body.issues.map(i=>i.kind).sort(),['customer','user']);assert.equal((await s.request(path+'/apply','POST',body)).status,400);
  assert.equal((await s.request(path+'/apply','POST',{...body,userMapping:{[person.user.id]:null},customerMapping:{[customer.id]:null}})).status,201);
  const viewer=await user(s,'advanced-viewer@example.test');addMember(s,s.owner,viewer);await s.request(`/projects/${s.project.id}/members/${viewer.user.id}`,'PUT',{role:'viewer'});
  assert.equal((await s.request(`/tasks/${task.id}/fields`,'PUT',{values:{}},viewer)).status,403);assert.equal((await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Forbidden',anchorAt:body.startAt},viewer)).status,403);
});
test('TC-W3-T05-A/B: template checklist dates remain calendar days across leap day and differing anchor hours',async t=>{
  const s=await setup(t),task=await s.task('Checklist calendar',{assigneeId:s.owner.user.id,dueAt:'2028-02-29T02:00:00Z'});
  const checklist=(await s.request(`/tasks/${task.id}/checklists`,'POST',{title:'Calendar'})).body.checklist;
  const item=(await s.request(`/tasks/${task.id}/checklists/${checklist.id}/items`,'POST',{title:'Dated child'})).body.item;
  const set=await s.request(`/tasks/${task.id}/checklists/${checklist.id}/items/${item.id}`,'PATCH',{startAt:'2028-02-28',dueAt:'2028-02-29',remindAt:'2028-02-29T02:00:00Z',assigneeIds:[s.owner.user.id]});assert.equal(set.status,200,JSON.stringify(set.body));
  const template=(await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Calendar days',anchorAt:'2028-02-28T16:00:00Z'})).body.template;
  const r=await s.request(`/project-templates/${template.id}/apply`,'POST',{name:'Next day',startAt:'2028-02-28T18:00:00Z',operationId:'calendar-day-template'});assert.equal(r.status,201,JSON.stringify(r.body));
  const cloned=s.db.prepare('SELECT i.*,c.task_id FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id JOIN tasks t ON t.id=c.task_id WHERE t.project_id=?').get(r.body.projectId);
  assert.equal(cloned.start_at,'2028-02-29');assert.equal(cloned.due_at,'2028-03-01');assert.equal(cloned.remind_at,'2028-02-29T04:00:00.000Z');assert.notEqual(cloned.id,item.id);
  assert.deepEqual(s.db.prepare('SELECT user_id FROM task_checklist_assignees WHERE item_id=?').all(cloned.id),[{user_id:s.owner.user.id}]);
  const edited=await s.request(`/tasks/${cloned.task_id}/checklists/${cloned.checklist_id}/items/${cloned.id}`,'PATCH',{startAt:cloned.start_at,dueAt:cloned.due_at});assert.equal(edited.status,200,JSON.stringify(edited.body));
});
test('W3 migration/snapshot: current data restores and v7 upgrades with no invented task dates',async t=>{
  const s=await setup(t),a=await s.task('Snapshot'),field=await s.field('Number','number');await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:0}});
  const snapshot=exportSnapshot(s.db),target=openDatabase();t.after(()=>target.close());importSnapshot(target,snapshot);assert.deepEqual(exportSnapshot(target),snapshot);
  const old={...snapshot,schemaVersion:7,tables:Object.fromEntries(Object.entries(V7_TABLE_COLUMNS).map(([name,columns])=>[name,{columns,rows:snapshot.tables[name].rows.map(row=>columns.map(c=>row[snapshot.tables[name].columns.indexOf(c)]))}]))};
  const upgraded=upgradeSnapshot(old);assert.equal(upgraded.tables.tasks.rows[0].at(-1),null);assert.equal(upgraded.tables.project_fields.rows.length,0);
});

test('TC-W3-T06-A/B: recurring completion and task copy retain custom fields and relative start without duplicate successor',async t=>{
 const s=await setup(t),a=await s.task('Repeat',{recurrence:'daily'}),field=await s.field('Hours','number');
 await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:0}});await s.request(`/tasks/${a.id}/timeline`,'PATCH',{startAt:'2028-02-27T02:00:00Z'});
 const done=await s.request(`/tasks/${a.id}`,'PATCH',{status:'done',operationId:'advanced-repeat-done'});assert.equal(done.status,200,JSON.stringify(done.body));const next=done.body.nextTask;
 assert.ok(next);assert.equal((await s.request(`/tasks/${next.id}/fields`)).body.values[field.id],0);assert.equal(next.startAt,'2028-02-28T02:00:00.000Z');
 const replay=await s.request(`/tasks/${a.id}`,'PATCH',{status:'done',operationId:'advanced-repeat-done'});assert.equal(replay.body.nextTask.id,next.id);
 const copy=await s.request(`/tasks/${next.id}/copy`,'POST',{dueAt:'2028-03-01T02:00:00Z'});assert.equal(copy.status,201,JSON.stringify(copy.body));assert.equal((await s.request(`/tasks/${copy.body.task.id}/fields`)).body.values[field.id],0);
 const revision=(await s.request(`/tasks/${copy.body.task.id}`)).body.task.revision;
 const cleared=await s.request(`/tasks/${copy.body.task.id}/fields`,'DELETE',{expectedRevision:revision,operationId:'advanced-clear-values'});assert.equal(cleared.status,200,JSON.stringify(cleared.body));assert.deepEqual(cleared.body.values,{});
});
test('TC-W3-T06-A: Kanban, automation and mobile API completion preserve advanced data with one successor after retry',async t=>{
 const s=await setup(t),field=await s.field('Effort','number'),doneColumn=s.db.prepare("SELECT id FROM board_columns WHERE project_id=? AND status='done' LIMIT 1").get(s.project.id).id;
 const rule=await s.request('/automations','POST',{name:'Complete recurrent',projectId:s.project.id,trigger:'manual',actions:[{type:'status',value:'done'}]});assert.equal(rule.status,201,JSON.stringify(rule.body));
 const login=await s.request('/mobile/auth/login','POST',{email:s.owner.user.email,password:'Password123!'});assert.equal(login.status,200);
 for(const mode of ['kanban','automation','android']){
  const task=await s.task(`Recurring ${mode}`,{recurrence:'daily'});await s.request(`/tasks/${task.id}/fields`,'PUT',{values:{[field.id]:0}});await s.request(`/tasks/${task.id}/timeline`,'PATCH',{startAt:'2028-02-27T02:00:00Z'});
  const operationId=`advanced-${mode}-complete`,send=async()=>{
   if(mode==='kanban')return s.request(`/boards/tasks/${task.id}/move`,'POST',{columnId:doneColumn,operationId});
   if(mode==='automation')return s.request(`/automations/${rule.body.id}/run`,'POST',{taskId:task.id,operationId});
   const response=await fetch(`${s.base}/api/tasks/${task.id}`,{method:'PATCH',headers:{'content-type':'application/json',authorization:`Bearer ${login.body.token}`},body:JSON.stringify({status:'done',operationId})});return{status:response.status,body:await response.json()};
  };
  for(let attempt=0;attempt<2;attempt++){const result=await send();assert.equal(result.status,200,mode+JSON.stringify(result.body));if(mode==='automation')assert.equal(result.body.ok,true);}
  const successors=s.db.prepare('SELECT * FROM tasks WHERE generated_from_task_id=?').all(task.id);assert.equal(successors.length,1,mode);assert.equal(successors[0].start_at,'2028-02-28T02:00:00.000Z');assert.equal((await s.request(`/tasks/${successors[0].id}/fields`)).body.values[field.id],0);
 }
});


test('TC-W3-T05-D: independent API processes applying one operation produce one template instance',async t=>{
 const s=await setup(t);await s.task('Template race');
 const template=(await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Race',anchorAt:'2028-02-28T02:00:00Z'})).body.template;
 const children=[];
 for(const suffix of ['a','b']){const applicationName=s.db.schema+'_template_'+suffix,child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});let errors='';child.stderr.on('data',d=>{errors+=d});t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(timeout);});const [ready]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error(errors);})]);children.push({base:`http://127.0.0.1:${ready.port}`,applicationName});}
 const control=new Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());await control.query(`SET search_path TO "${s.db.schema}"`);
 const operationId='template-concurrent-operation';await control.query('BEGIN');await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[JSON.stringify([s.owner.workspace.id,s.owner.user.id,operationId])]);
 const requests=children.map(child=>call(child,`/project-templates/${template.id}/apply`,{cookie:s.owner.cookie,method:'POST',body:{name:'One instance',startAt:'2029-01-01T02:00:00Z',operationId}}));
 try{const deadline=Date.now()+20000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[children.map(c=>c.applicationName)]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both template requests reached the barrier');await delay(20);}}finally{await control.query('COMMIT');}
 const responses=await Promise.all(requests);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201],JSON.stringify(responses));assert.equal(responses[0].body.projectId,responses[1].body.projectId);assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(operationId).n,1);assert.equal(s.db.prepare("SELECT count(*) n FROM projects WHERE name='One instance'").get().n,1);
});

test('W3 restore rejects corrupted graph and cross-project custom-value ownership even with user triggers suppressed',async t=>{
 const s=await setup(t),a=await s.task('A'),b=await s.task('B'),field=await s.field('Number','number');
 await s.request(`/tasks/${a.id}/fields`,'PUT',{values:{[field.id]:2}});await s.request(`/projects/${s.project.id}/dependencies`,'POST',{predecessorId:a.id,successorId:b.id});
 const foreign=(await s.request('/tasks','POST',{title:'Other project'})).body.task;
 const snapshot=exportSnapshot(s.db),cycle=structuredClone(snapshot),edge=cycle.tables.task_dependencies;
 edge.rows.push(edge.columns.map(c=>({workspace_id:s.owner.workspace.id,project_id:s.project.id,predecessor_id:b.id,successor_id:a.id,created_at:clock().toISOString()})[c]));
 const target=openDatabase();t.after(()=>target.close());assert.throws(()=>importSnapshot(target,cycle),/chu trình/);assert.equal(target.prepare('SELECT count(*) n FROM tasks').get().n,0);
 const ownership=structuredClone(snapshot),values=ownership.tables.task_field_values;values.rows[0][values.columns.indexOf('task_id')]=foreign.id;
 assert.throws(()=>importSnapshot(target,ownership),/foreign key/i);assert.equal(target.prepare('SELECT count(*) n FROM tasks').get().n,0);
});


test('TC-W3-T02-C: personal view ownership rejects manager/admin disclosure and mutations',async t=>{
  const s=await setup(t),base=`/projects/${s.project.id}/views`;
  const author=await user(s,'personal-view-author@example.test');addMember(s,s.owner,author);
  assert.equal((await s.request(`/projects/${s.project.id}/members/${author.user.id}`,'PUT',{role:'editor'})).status,200);
  const actors=[];
  for(const role of ['viewer','editor','manager','admin']){
    const actor=await user(s,`personal-view-${role}@example.test`);addMember(s,s.owner,actor);
    if(role==='admin')s.db.prepare("UPDATE workspace_members SET role='admin' WHERE workspace_id=? AND user_id=?").run(s.owner.workspace.id,actor.user.id);
    else assert.equal((await s.request(`/projects/${s.project.id}/members/${actor.user.id}`,'PUT',{role})).status,200);
    actors.push([role,actor]);
  }
  actors.push(['workspace owner',s.owner]);
  const snapshot=()=>Object.fromEntries(['project_views','tasks','task_assignees','business_events','mutation_receipts','notifications','notification_outbox','reminder_email_outbox','automation_event_queue','google_calendar_jobs','zalo_oa_deliveries','webhook_deliveries'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  for(const [role,actor]of actors)await t.test(role,async()=>{
    const canary=`PRIVATE-VIEW-${role}`,created=await s.request(base,'POST',{name:canary,visibility:'personal',config:{layout:'kanban',status:'doing'}},author);
    assert.equal(created.status,201);const path=base+'/'+created.body.view.id,before=snapshot();
    const listed=await s.request(base,'GET',undefined,actor);assert.equal(listed.status,200);assert.ok(!JSON.stringify(listed.body).includes(canary));
    assert.equal((await s.request(`/projects/${s.project.id}/tasks?viewId=${created.body.view.id}`,'GET',undefined,actor)).status,404);
    for(const [method,body]of [['PATCH',{}],['PATCH',{name:'Changed',config:{status:'done'}}],['PATCH',{visibility:'project'}],['DELETE',undefined]]){
      const denied=await s.request(path,method,body,actor);
      assert.equal(denied.status,404,`${role} ${method}: ${JSON.stringify(denied.body)}`);
      assert.ok(!JSON.stringify(denied.body).includes(canary));assert.deepEqual(snapshot(),before);
    }
    assert.equal((await s.request(path,'PATCH',{name:'Own renamed',config:{layout:'list',status:'todo'}},author)).status,200);
    assert.equal((await s.request(base,'GET',undefined,author)).body.views.find(v=>v.id===created.body.view.id).name,'Own renamed');
    assert.equal((await s.request(path,'DELETE',undefined,author)).status,200);
  });
  const manager=actors.find(([role])=>role==='manager')[1];
  const personal=await s.request(base,'POST',{name:'Manager own',visibility:'personal',config:{layout:'list'}},manager);assert.equal(personal.status,201);
  assert.equal((await s.request(base+'/'+personal.body.view.id,'PATCH',{visibility:'project'},manager)).status,200,'owner-manager can publish their own view');
  const shared=await s.request(base,'POST',{name:'Shared',visibility:'project',config:{layout:'list'}},s.owner);assert.equal(shared.status,201);
  assert.equal((await s.request(base+'/'+shared.body.view.id,'PATCH',{name:'Managed shared'},manager)).status,200,'manager can edit a shared view created by someone else');
  assert.equal((await s.request(base+'/'+shared.body.view.id,'DELETE',undefined,manager)).status,200,'manager can delete a shared view created by someone else');
});


test('TC-W3-T05-A/C: template assignee mapping excludes primary and preserves collaborator order',async t=>{
  const s=await setup(t),people=[];
  for(const name of ['first','second','third']){
    const actor=await user(s,`template-map-${name}@example.test`);addMember(s,s.owner,actor);
    assert.equal((await s.request(`/projects/${s.project.id}/members/${actor.user.id}`,'PUT',{role:'editor'})).status,200);people.push(actor);
  }
  const source=await s.task('Mapped assignments',{assigneeId:s.owner.user.id});
  assert.equal((await s.request(`/tasks/${source.id}/extras`,'PUT',{assigneeIds:people.map(p=>p.user.id),labelIds:[]})).status,200);
  const saved=await s.request(`/projects/${s.project.id}/templates`,'POST',{name:'Assignment mapping',anchorAt:'2028-02-28T02:00:00Z'});assert.equal(saved.status,201);
  const path=`/project-templates/${saved.body.template.id}`,body={name:'Mapped project',startAt:'2028-02-29T02:00:00Z',accessMode:'workspace',userMapping:{[s.owner.user.id]:people[0].user.id},operationId:'template-assignee-mapping'};
  assert.equal((await s.request(path+'/preview','POST',body)).body.valid,true);
  const result=await s.request(path+'/apply','POST',body);assert.equal(result.status,201,JSON.stringify(result.body));
  const copy=s.db.prepare('SELECT * FROM tasks WHERE project_id=?').get(result.body.projectId);assert.equal(copy.assignee_id,people[0].user.id);
  const initialCollaborators=s.db.prepare('SELECT user_id,position FROM task_assignees WHERE task_id=? ORDER BY position').all(copy.id);
  const extras=await s.request(`/tasks/${copy.id}/extras`);assert.equal(extras.status,200);
  const roundtrip=await s.request(`/tasks/${copy.id}/extras`,'PUT',{assigneeIds:extras.body.assigneeIds,labelIds:[]});
  assert.equal(roundtrip.status,200,JSON.stringify(roundtrip.body));
  assert.deepEqual(roundtrip.body.assigneeIds,people.slice(1).map(p=>p.user.id));
  assert.deepEqual(initialCollaborators,people.slice(1).map((p,position)=>({user_id:p.user.id,position})));
  assert.deepEqual(s.db.prepare('SELECT user_id,position FROM task_assignees WHERE task_id=? ORDER BY position').all(copy.id),initialCollaborators);
  assert.equal((await s.request(path+'/apply','POST',body)).body.projectId,result.body.projectId);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(result.body.projectId).n,1);
});
