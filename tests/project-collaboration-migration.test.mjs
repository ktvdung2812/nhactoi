import test from 'node:test';
import assert from 'node:assert/strict';
import { boot,call,user } from './roadmap-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';
import { exportSnapshot,importSnapshot } from '../server/database-snapshot.mjs';
import { V5_TABLE_COLUMNS } from '../server/database-tables.mjs';
test('schema5 labels shared across projects upgrade without losing links, IDs or task revisions',async t=>{
 const s=await boot(t);const owner=await user(s,'label-migration@example.test');
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 const req=(path,body)=>call(s,path,{method:'POST',cookie:owner.cookie,body});
 const project=(await req('/projects',{name:'Private',accessMode:'private'})).body.project;
 const created=await req('/tasks',{title:'Historical',projectId:project.id});assert.equal(created.status,201);
 const taskId=created.body.task.id;
 const at=new Date().toISOString();
 s.db.prepare('INSERT INTO task_labels(id,workspace_id,name,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('old-label',owner.workspace.id,'Shared','blue',owner.user.id,at,at);
 const current=exportSnapshot(s.db);
 const old={...current,schemaVersion:5,tables:Object.fromEntries(Object.entries(V5_TABLE_COLUMNS).map(([table,columns])=>[table,{columns:[...columns],rows:current.tables[table].rows.map(row=>columns.map(c=>row[current.tables[table].columns.indexOf(c)]))}]))};
 old.tables.task_label_links.rows.push([taskId,'old-label',at]);
 const target=openDatabase();try{
  importSnapshot(target,old);
  const label=target.prepare('SELECT l.* FROM task_labels l JOIN task_label_links x ON x.label_id=l.id WHERE x.task_id=?').get(taskId);
  assert.equal(label.project_id,project.id);assert.equal(label.id,'old-label:'+project.id);assert.equal(label.name,'Shared');
  assert.ok(target.prepare("SELECT 1 FROM task_labels WHERE id='old-label'").get());
  assert.equal(target.prepare('SELECT aggregate_revision FROM tasks WHERE id=?').get(taskId).aggregate_revision,s.db.prepare('SELECT aggregate_revision FROM tasks WHERE id=?').get(taskId).aggregate_revision);
  assert.throws(()=>target.prepare('UPDATE task_label_links SET label_id=? WHERE task_id=?').run('old-label',taskId),/outside project/);
 }finally{target.close();}
});
test('legacy source templates inherit their private source project and cannot be published to the common scope',async t=>{
 const s=await boot(t);const owner=await user(s,'template-scope@example.test');s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 const req=(path,body)=>call(s,path,{method:'POST',cookie:owner.cookie,body});
 const project=(await req('/projects',{name:'Private',accessMode:'private'})).body.project;
 const task=(await req('/tasks',{title:'PRIVATE_TEMPLATE_CANARY',projectId:project.id})).body.task;const at=new Date().toISOString();
 s.db.prepare(`INSERT INTO task_templates(id,workspace_id,source_task_id,kind,name,payload_json,created_by,created_at,updated_at) VALUES ('private-template',?,?,'task','Private','{}',?,?,?)`).run(owner.workspace.id,task.id,owner.user.id,at,at);
 assert.equal(s.db.prepare("SELECT project_id FROM task_templates WHERE id='private-template'").get().project_id,project.id);
 assert.throws(()=>s.db.prepare("UPDATE task_templates SET project_id=? WHERE id='private-template'").run('prj_ws_'+owner.workspace.id),/outside project/);
});
