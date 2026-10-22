import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { boot,call,user,addMember } from './roadmap-helpers.mjs';
import { openDatabase,SCHEMA_VERSION } from './database-helpers.mjs';
import { parseCsv,importDate,encodeCsv } from '../shared/data-import.mjs';
import { processWorkflowReminders } from '../server/reminder-workflow.mjs';
import { exportSnapshot,importSnapshot,upgradeSnapshot } from '../server/database-snapshot.mjs';
import { V10_TABLE_COLUMNS } from '../server/database-tables.mjs';

const clock=()=>new Date('2026-10-16T02:00:00Z');
console.info(`[W6] Node ${process.version}; schema ${SCHEMA_VERSION}; dedicated isolated PostgreSQL; fake clock ${clock().toISOString()}`);
async function setup(t,options={}){
 const s=await boot(t,{clock,...options}),owner=await user(s,'import-owner@example.test');s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2032-01-01' WHERE workspace_id=?").run(owner.workspace.id);
 const request=(path,method='GET',body,actor=owner)=>call(s,path,{cookie:actor.cookie,method,body});
 const r=await request('/projects','POST',{name:'Private import',accessMode:'private'});assert.equal(r.status,201,JSON.stringify(r.body));const project=r.body.project,path=`/projects/${project.id}/import`;
 const preview=async body=>{const r=await request(path+'/preview','POST',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const commit=async(body,operationId='import-operation-0001')=>{const p=await preview(body);assert.equal(p.valid,true,JSON.stringify(p));return request(path+'/commit','POST',{...body,operationId,previewToken:p.previewToken});};
 return{...s,owner,request,project,path,preview,commit};
}
const csv=(content,extra={})=>({source:'csv',content,...extra});
const trello=()=>({id:'board-A',lists:[{id:'list-a',name:'Trùng tên',pos:1},{id:'list-b',name:'Trùng tên',pos:2}],labels:[{id:'label-a',name:'Nhãn Việt',color:'red'}],members:[{id:'external-user',fullName:'Nhân sự nguồn'}],cards:[{id:'card-a',idBoard:'board-A',idList:'list-a',name:'Việc 🎉',desc:'<script>throw Error(1)</script>',idMembers:['external-user'],idLabels:['label-a'],idChecklists:['check-a'],attachments:[{url:'https://example.test/a'}],pos:2},{id:'card-b',idList:'list-b',name:'Việc khác',idMembers:[],idLabels:[],pos:1}],checklists:[{id:'check-a',idCard:'card-a',name:'Danh sách',checkItems:[{name:'Hai',pos:2,state:'incomplete'},{name:'Một',pos:1,state:'complete'}]}],actions:[{type:'commentCard'}],automations:[{}]});
const counts=db=>Object.fromEntries(['tasks','board_columns','task_checklists','task_checklist_items','business_events','mutation_receipts','notifications','notification_outbox','notification_outbox_deliveries','reminder_email_outbox','automation_event_queue','google_calendar_jobs','zalo_oa_deliveries','webhook_deliveries','import_sources'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));

test('TC-W6-T01-A/B/C and T05-C: strict CSV Unicode/quotes/physical lines, date format and formula-safe export',()=>{
 const p=parseCsv('\uFEFFtitle,description\r\n"Việt 🎉, quote ""A""","một\r\nhai"\r\n');assert.deepEqual(p.rows,[{line:2,cells:['Việt 🎉, quote "A"','một\r\nhai']}]);
 for(const content of ['title,title\nA,B','title,\nA,B','title\n"unfinished','title\n"a"oops'])assert.throws(()=>parseCsv(content));
 assert.equal(parseCsv('title;description\nA;B',{delimiter:';'}).rows[0].cells[1],'B');
 assert.throws(()=>importDate('01/02/2026T09:00+07:00'),/định dạng/);assert.throws(()=>importDate('31/02/2026T09:00+07:00','dmy'),/không tồn tại/);assert.throws(()=>importDate('2028-02-29'),/giờ/);assert.equal(importDate('29/02/2028T09:00+07:00','dmy'),'2028-02-29T02:00:00.000Z');
 const cells=['=1+1',' +SUM(A1)','-2','@A','\t=1','\r=1','quote"text',false,0];const exported=parseCsv(encodeCsv([['a','b','c','d','e','f','g','h','i'],cells])).rows[0].cells;for(let i=0;i<6;i++)assert.equal(exported[i],"'"+cells[i]);assert.equal(exported[6],cells[6]);assert.deepEqual(exported.slice(7),['false','0']);
});
test('TC-W6-T01-A/B/D and T03-A/C: preview writes nothing; shared typed field validation; row errors rollback batch',async t=>{
 const s=await setup(t),fields=[];for(const [name,type]of [['Number','number'],['Check','checkbox'],['Text','text'],['Date','date'],['Choice','single'],['Choices','multiple']]){const r=await s.request(`/projects/${s.project.id}/fields`,'POST',{name,type,...(['single','multiple'].includes(type)?{options:[{name:'Option'}]}:{})});assert.equal(r.status,201,JSON.stringify(r.body));fields.push(r.body.field);}
 const [num,check,text,date,single,multiple]=fields,body=csv(`title,description,number,check,text,date,single,multiple\r\n"Việt 🎉, quote ""A""","một\r\nhai",0,false,,2028-02-29,${single.options[0].id},${multiple.options[0].id}\r\n`,{mapping:{title:'title',description:'description',customFields:{[num.id]:'number',[check.id]:'check',[text.id]:'text',[date.id]:'date',[single.id]:'single',[multiple.id]:'multiple'}}});
 const before=counts(s.db),p=await s.preview(body);assert.equal(p.valid,true,JSON.stringify(p));assert.deepEqual(counts(s.db),before);
 const r=await s.commit(body);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.imported,1);const values=Object.fromEntries(s.db.prepare('SELECT field_id,value_json FROM task_field_values WHERE task_id=?').all(r.body.taskIds[0]).map(v=>[v.field_id,JSON.parse(v.value_json)]));assert.equal(values[num.id],0);assert.equal(values[check.id],false);assert.equal(values[text.id],'');assert.equal(values[date.id],'2028-02-29');
 const task=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(r.body.taskIds[0]);assert.equal(task.description,'một\r\nhai');
 for(const content of ['title\nValid\n""','title,description\nMissing cell','wrong\nNo title']){const p=await s.preview(csv(content));assert.equal(p.valid,false);if(content.startsWith('title\nValid'))assert.deepEqual(p.summary,{ready:1,skipped:0,failed:1});const snapshot=counts(s.db);const r=await s.request(s.path+'/commit','POST',{...csv(content),operationId:'invalid-operation-1',previewToken:p.previewToken});assert.equal(r.status,400);assert.deepEqual(counts(s.db),snapshot);}
 const invalid=await s.preview({...body,content:body.content.replace(',0,false,',',invalid,invalid,')});assert.equal(invalid.valid,false);assert.ok(invalid.errors.some(e=>e.row===2&&e.column===num.id));
});
test('TC-W6-T02-A/B/C/D: Trello preserves duplicate list identities/checklists, requires mapping and skips existing source cards',async t=>{
 const s=await setup(t),data=trello(),body={source:'trello',content:JSON.stringify(data)};
 const first=await s.preview(body);assert.equal(first.valid,false);assert.equal(first.sourceUsers[0].id,'external-user');assert.deepEqual(first.warnings.filter(w=>['comments','attachments','automation'].includes(w.kind)).map(w=>w.count),[1,1,1]);
 const accountCount=s.db.prepare('SELECT count(*) n FROM users').get().n;body.userMapping={'external-user':s.owner.user.id};const r=await s.commit(body);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.imported,2);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,accountCount);
 const columns=s.db.prepare("SELECT * FROM board_columns WHERE project_id=? AND name='Trùng tên'").all(s.project.id);assert.equal(columns.length,2);assert.notEqual(columns[0].id,columns[1].id);
 const a=s.db.prepare("SELECT * FROM tasks WHERE title='Việc 🎉' AND project_id=?").get(s.project.id);assert.equal(a.description,'<script>throw Error(1)</script>');assert.equal(a.assignee_id,s.owner.user.id);assert.equal(s.db.prepare('SELECT count(*) n FROM task_label_links WHERE task_id=?').get(a.id).n,1);assert.deepEqual(s.db.prepare('SELECT i.title,i.completed FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE c.task_id=? ORDER BY i.position').all(a.id),[{title:'Một',completed:1},{title:'Hai',completed:0}]);
 s.db.prepare("UPDATE tasks SET title='Đã sửa đích' WHERE id=?").run(a.id);const retry=await s.commit(body,'import-new-batch-0002');assert.equal(retry.body.imported,0);assert.equal(retry.body.skipped,2);assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(a.id).title,'Đã sửa đích');
 data.cards.push({id:'card-new',idList:'list-a',name:'Mới',idMembers:[],idLabels:['label-a']});body.content=JSON.stringify(data);const next=await s.commit(body,'import-new-batch-0003');assert.equal(next.body.imported,1);assert.equal(next.body.skipped,2);assert.equal(s.db.prepare('SELECT count(*) n FROM board_columns WHERE project_id=? AND name=?').get(s.project.id,'Trùng tên').n,2);
});
test('TC-W6-T02-A/T03-C: malformed Trello references and shapes reject without partial business effects',async t=>{
 const s=await setup(t),before=counts(s.db);
 const cases=[d=>d.cards.push({...d.cards[0]}),d=>d.lists.push({...d.lists[0]}),d=>d.labels.push({...d.labels[0]}),d=>d.checklists.push({...d.checklists[0]}),d=>{d.cards[0].id='bad\0id';},d=>{d.cards[0].idList='missing';},d=>{d.cards[0].idBoard='another-board';},d=>{d.cards[0].idLabels=['missing'];},d=>{d.cards[0].idLabels={};},d=>{d.cards[0].labels={};},d=>{d.cards[0].idChecklists=['missing'];},d=>{d.checklists[0].idCard='card-b';},d=>{d.cards[1].idChecklists=['check-a'];},d=>{d.checklists[0].checkItems=[null];},d=>{d.actions=[null];},d=>{d.checklists.push({id:'orphan',name:'Orphan',checkItems:[]});}];
 for(const [index,change]of cases.entries()){
  const data=trello();change(data);const body={source:'trello',content:JSON.stringify(data),userMapping:{'external-user':s.owner.user.id}};
  const p=await s.request(s.path+'/preview','POST',body);assert.ok(p.status===400||p.status===200&&p.body.valid===false,`case ${index}: ${JSON.stringify(p)}`);
  const r=await s.request(s.path+'/commit','POST',{...body,operationId:`malformed-import-${index}`,previewToken:p.body.previewToken||'rejected'});assert.equal(r.status,400,`case ${index}: ${JSON.stringify(r.body)}`);assert.deepEqual(counts(s.db),before);
 }
});
test('TC-W6-T03-B/D and T05-D: current ACL/schema validation, receipt retry/payload mismatch, no cross-tenant replay',async t=>{
 const s=await setup(t),body=csv('title\nOne');const outsider=await user(s,'outside-import@example.test');assert.equal((await s.request(s.path,'GET',undefined,outsider)).status,404);
 const editor=await user(s,'editor-import@example.test');addMember(s,s.owner,editor);await s.request(`/projects/${s.project.id}/members/${editor.user.id}`,'PUT',{role:'editor'});
 const p=(await s.request(s.path+'/preview','POST',body,editor)).body;assert.equal(p.valid,true);
 await s.request(`/projects/${s.project.id}/members/${editor.user.id}`,'PUT',{role:'viewer'});assert.equal((await s.request(s.path+'/commit','POST',{...body,operationId:'revoked-operation-1',previewToken:p.previewToken},editor)).status,403);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks').get().n,0);
 const own=await s.preview(body),payload={...body,operationId:'receipt-operation-1',previewToken:own.previewToken};let r=await s.request(s.path+'/commit','POST',payload);assert.equal(r.status,201,JSON.stringify(r.body));r=await s.request(s.path+'/commit','POST',payload);assert.equal(r.body.replayed,true);assert.equal(r.body.imported,1);assert.equal((await s.request(s.path+'/commit','POST',{...payload,content:'title\nOther'})).status,409);
 assert.equal((await s.request(s.path+'/commit','POST',payload,outsider)).status,404);
 const field=(await s.request(`/projects/${s.project.id}/fields`,'POST',{name:'Number',type:'number'})).body.field;
 const typed=csv('title,value\nTyped,2',{mapping:{title:'title',customFields:{[field.id]:'value'}}}),tp=await s.preview(typed);await s.request(`/projects/${s.project.id}/fields/${field.id}`,'PATCH',{retired:true});const before=counts(s.db);r=await s.request(s.path+'/commit','POST',{...typed,operationId:'retired-operation-1',previewToken:tp.previewToken});assert.equal(r.status,400);assert.deepEqual(counts(s.db),before);
});
test('TC-W6-T03-C/E: injected failure rolls back rows/events/source/receipt; imported history never sends or generates successors',async t=>{
 const s=await setup(t),body=csv('title,dueAt,remindAt,recurrence\nHistory,2020-01-01T09:00+07:00,2020-01-01T08:00+07:00,daily\nFail,2020-01-01T09:00+07:00,,none');
 s.db.exec("CREATE FUNCTION import_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Fail' THEN RAISE EXCEPTION 'import injected rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER import_test_fail BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION import_test_fail()");
 const before=counts(s.db),r=await s.commit(body);assert.equal(r.status,500);assert.deepEqual(counts(s.db),before);s.db.exec('DROP TRIGGER import_test_fail ON tasks');
 s.db.prepare('INSERT INTO reminder_policies(workspace_id,scope,policy_json,updated_at) VALUES (?,?,?,?)').run(s.owner.workspace.id,'',JSON.stringify({enabled:true,allowMemberOverride:false,minIntervalMinutes:1,steps:[{offsetMinutes:0,audience:'assignees',condition:'incomplete'}]}),clock().toISOString());
 s.db.prepare("INSERT INTO automation_rules(id,workspace_id,project_id,name,trigger,actions,enabled,created_by,created_at) VALUES ('rule',?,?,?,'task.created',?,1,?,?)").run(s.owner.workspace.id,s.project.id,'Imported must not run',JSON.stringify([{type:'set_status',value:'done'}]),s.owner.user.id,clock().toISOString());
 const ok=await s.commit(body);assert.equal(ok.status,201,JSON.stringify(ok.body));assert.equal(s.db.prepare('SELECT count(*) n FROM automation_event_queue').get().n,0);assert.equal(s.db.prepare("SELECT count(*) n FROM business_events WHERE source<>'import'").get().n,0);assert.equal(s.db.prepare("SELECT count(*) n FROM business_events WHERE type='task.imported'").get().n,2);
 assert.equal(s.app.locals.processReminders().length,0);assert.equal(processWorkflowReminders({db:s.db,clock}).length,0);assert.equal(processWorkflowReminders({db:s.db,clock:()=>new Date('2026-10-17T02:00:00Z')}).length,0);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks').get().n,2);assert.equal(s.db.prepare('SELECT count(*) n FROM notifications').get().n,0);
 const history=await s.request(`/tasks/${ok.body.taskIds[0]}/events`);assert.equal(history.body.historyCoverage,'unknown');
 await s.request(`/tasks/${ok.body.taskIds[0]}`,'PATCH',{remindAt:'2026-10-16T01:00:00Z'});assert.equal(s.db.prepare('SELECT imported_at FROM tasks WHERE id=?').get(ok.body.taskIds[0]).imported_at,null);
});
test('TC-W6-T05-A: configured file and row boundaries reject before business writes',async t=>{
 const s=await setup(t,{env:{NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5173',IMPORT_MAX_FILE_BYTES:'64',IMPORT_MAX_ROWS:'2'}});assert.equal((await s.request(s.path)).body.limits.maxBytes,64);
 const content='title\n'+'a'.repeat(58);assert.equal(Buffer.byteLength(content),64);assert.equal((await s.preview(csv(content))).valid,true);
 const before=counts(s.db);assert.equal((await s.request(s.path+'/preview','POST',csv(content+'b'))).status,413);assert.equal((await s.preview(csv('title\na\nb\nc'))).valid,false);assert.equal((await s.preview(csv('title\na\nb'))).valid,true);assert.deepEqual(counts(s.db),before);
});
test('TC-W6-T05-A: default 512KiB/500-task import commits with bounded preview and rejects one-over limits',async t=>{
 const s=await setup(t),limits=(await s.request(s.path)).body.limits,rows=Array.from({length:limits.maxRows},(_,i)=>[`Limit ${i}`,'x'.repeat(1000)]);
 const render=()=>['title,description',...rows.map(row=>row.join(','))].join('\n');let remaining=limits.maxBytes-Buffer.byteLength(render());
 for(const row of rows){const add=Math.min(remaining,5000-row[1].length);row[1]+='x'.repeat(add);remaining-=add;if(!remaining)break;}
 const content=render();assert.equal(Buffer.byteLength(content),limits.maxBytes);const rssBefore=process.memoryUsage().rss,started=performance.now(),preview=await s.preview(csv(content)),previewMs=performance.now()-started;
 assert.equal(preview.valid,true,JSON.stringify(preview));assert.equal(preview.summary.ready,500);assert.equal(preview.sample.length,20);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks').get().n,0);
 const commitStarted=performance.now(),committed=await s.request(s.path+'/commit','POST',{...csv(content),operationId:'default-limit-import',previewToken:preview.previewToken}),commitMs=performance.now()-commitStarted;
 assert.equal(committed.status,201,JSON.stringify(committed.body));assert.equal(committed.body.imported,500);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(s.project.id).n,500);
 console.info('[W6 default bulk]',JSON.stringify({bytes:Buffer.byteLength(content),tasks:500,sample:preview.sample.length,previewMs:Math.round(previewMs),commitMs:Math.round(commitMs),rssBefore,rssAfter:process.memoryUsage().rss}));
 const before=counts(s.db);assert.equal((await s.request(s.path+'/preview','POST',csv(content+'x'))).status,413);assert.equal((await s.preview(csv('title\n'+Array.from({length:501},(_,i)=>`T${i}`).join('\n')))).valid,false);
 const data={id:'list-boundary',lists:Array.from({length:40},(_,i)=>({id:`l${i}`,name:`List ${i}`})),cards:[]};assert.equal((await s.preview({source:'trello',content:JSON.stringify(data)})).valid,true);data.lists.push({id:'over',name:'Over'});assert.equal((await s.request(s.path+'/preview','POST',{source:'trello',content:JSON.stringify(data)})).status,400);assert.deepEqual(counts(s.db),before);
});
test('TC-W6-T03-F: JSON v1 stays append with import source and historical suppression',async t=>{
 const s=await setup(t),data={format:'nhactoi-board',version:1,columns:[{id:'one',name:'Same',status:'todo',tone:'blue'},{id:'two',name:'Same',status:'todo',tone:'blue'}],tasks:[{title:'Legacy',description:'',status:'todo',priority:'medium',columnId:'two',dueAt:'2020-01-01T00:00:00Z',remindAt:'2020-01-01T00:00:00Z',recurrence:'daily',checklists:[]}]};
 for(let i=0;i<2;i++){const r=await s.request('/board-transfer','POST',{data});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.count,1);}
 assert.equal(s.db.prepare("SELECT count(*) n FROM tasks WHERE title='Legacy'").get().n,2);assert.equal(s.app.locals.processReminders().length,0);assert.equal(s.db.prepare('SELECT count(*) n FROM import_sources').get().n,0);
});
test('W6 snapshot migration: v10 upgrades and imported boundaries/source receipts round-trip',async t=>{
 const s=await setup(t),data=trello();data.cards[0].idMembers=[];const r=await s.commit({source:'trello',content:JSON.stringify(data)});assert.equal(r.status,201,JSON.stringify(r.body));const snapshot=exportSnapshot(s.db),target=openDatabase();t.after(()=>target.close());importSnapshot(target,snapshot);assert.equal(target.prepare('SELECT count(*) n FROM import_sources').get().n,s.db.prepare('SELECT count(*) n FROM import_sources').get().n);assert.equal(target.prepare('SELECT imported_at FROM tasks LIMIT 1').get().imported_at,clock().toISOString());
 const old={...snapshot,schemaVersion:10,tables:Object.fromEntries(Object.entries(V10_TABLE_COLUMNS).map(([table,columns])=>[table,{columns,rows:snapshot.tables[table].rows.map(row=>columns.map(c=>row[snapshot.tables[table].columns.indexOf(c)]))}]))};const upgraded=upgradeSnapshot(old);assert.equal(upgraded.tables.import_sources.rows.length,0);assert.ok(upgraded.tables.tasks.rows.every(row=>row.at(-1)===null));
});

test('TC-W6-T03-D: two API processes behind PostgreSQL barrier commit one batch/receipt/source map',async t=>{
 const s=await setup(t),data=trello();data.cards[0].idMembers=[];const body={source:'trello',content:JSON.stringify(data)},p=await s.preview(body);assert.equal(p.valid,true,JSON.stringify(p));const children=[];
 for(const suffix of ['a','b']){
  const applicationName=s.db.schema+'_import_'+suffix,child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});let errors='';child.stderr.on('data',d=>{errors+=d});
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(timeout);});
  const[ready]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error(errors);})]);children.push({base:`http://127.0.0.1:${ready.port}`,applicationName});
 }
 const control=new Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());await control.query(`SET search_path TO "${s.db.schema}"`);
 const operationId='import-concurrent-operation';await control.query('BEGIN');await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[JSON.stringify([s.owner.workspace.id,s.owner.user.id,operationId])]);
 const requests=children.map(child=>call(child,s.path+'/commit',{cookie:s.owner.cookie,method:'POST',body:{...body,operationId,previewToken:p.previewToken}}));
 try{const deadline=Date.now()+20000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[children.map(c=>c.applicationName)]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both import processes reached barrier');await delay(20);}}finally{await control.query('COMMIT');}
 const responses=await Promise.all(requests);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201],JSON.stringify(responses));assert.deepEqual(responses[0].body.taskIds,responses[1].body.taskIds);assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(operationId).n,1);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(s.project.id).n,2);assert.equal(s.db.prepare("SELECT count(*) n FROM import_sources WHERE source_kind='card'").get().n,2);
});

test('TC-W6-T01-D/T02-B/T03-B: imports cannot create managed resources as editor or use cross-project mappings/premium writes',async t=>{
 const s=await setup(t),editor=await user(s,'restricted-import@example.test');addMember(s,s.owner,editor);await s.request(`/projects/${s.project.id}/members/${editor.user.id}`,'PUT',{role:'editor'});
 const data=trello(),body={source:'trello',content:JSON.stringify(data),userMapping:{'external-user':s.owner.user.id}};
 let r=await s.request(s.path+'/preview','POST',body,editor);assert.equal(r.status,200);assert.equal(r.body.valid,false);assert.ok(r.body.errors.some(e=>e.message.includes('quản lý dự án')));
 const column=s.db.prepare("SELECT id FROM board_columns WHERE project_id=? AND status='todo' LIMIT 1").get(s.project.id).id;
 body.listMapping={'list-a':column,'list-b':column};body.labelMapping={'label-a':null};r=await s.request(s.path+'/preview','POST',body,editor);assert.equal(r.body.valid,true,JSON.stringify(r.body));const before=counts(s.db);
 const committedBody={...body,previewToken:r.body.previewToken,operationId:'editor-import-operation'};
 r=await s.request(s.path+'/commit','POST',committedBody,editor);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(counts(s.db).board_columns,before.board_columns);assert.equal(s.db.prepare('SELECT count(*) n FROM task_labels WHERE project_id=?').get(s.project.id).n,0);
 const target=(await s.request('/projects','POST',{name:'Private inaccessible target',accessMode:'private'})).body.project;
 const targetColumn=s.db.prepare("SELECT id FROM board_columns WHERE project_id=? AND status='todo' LIMIT 1").get(target.id).id;
 s.db.prepare('UPDATE tasks SET project_id=?,column_id=? WHERE id=?').run(target.id,targetColumn,r.body.taskIds[0]);
 assert.equal((await s.request(s.path+'/commit','POST',committedBody,editor)).status,403,'receipt must not expose results moved into a private project after import');
 const outsider=await user(s,'unmapped-import@example.test');const foreignBody={...body,content:JSON.stringify({...data,id:'different-board'}),userMapping:{'external-user':outsider.user.id}};assert.equal((await s.preview(foreignBody)).valid,false);
 assert.equal((await s.preview({...foreignBody,userMapping:{'external-user':null},listMapping:{'list-a':'other-project-column'}})).valid,false);
 assert.equal((await s.preview(csv('title,dueAt\nWrong,31/02/2028T09:00+07:00',{dateFormat:'dmy'}))).valid,false);
 const field=(await s.request(`/projects/${s.project.id}/fields`,'POST',{name:'Number',type:'number'})).body.field;
 s.db.prepare("UPDATE projects SET access_mode='workspace' WHERE id=?").run(s.project.id);s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(s.owner.workspace.id);
 const noPremium=await s.preview(csv('title,number\nBlocked,1',{mapping:{title:'title',customFields:{[field.id]:'number'}}}));assert.equal(noPremium.valid,false);assert.equal((await s.request(s.path)).body.fields.length,0);
});


test('TC-W6-T02-A/T05-D and W9-T02-A: import assignees round-trip through extras and public labels',async t=>{
  for(const source of ['csv','trello'])for(const count of [1,3])await t.test(`${source}, ${count} assignees`,async sub=>{
    const s=await setup(sub),people=[s.owner];
    for(let i=1;i<count;i++){
      const actor=await user(s,`import-collaborator-${i}@example.test`);addMember(s,s.owner,actor);
      assert.equal((await s.request(`/projects/${s.project.id}/members/${actor.user.id}`,'PUT',{role:'editor'})).status,200);people.push(actor);
    }
    const sourceIds=people.map((_,i)=>'source-'+i),userMapping=Object.fromEntries(sourceIds.map((id,i)=>[id,people[i].user.id]));
    const input=source==='csv'?csv(`title,assignees,dueAt\nImported,${sourceIds.join('|')},2028-02-29T09:00+07:00`,{userMapping}):{source:'trello',content:JSON.stringify({id:'assignment-board',lists:[{id:'one',name:'Tasks'}],cards:[{id:'one-card',idList:'one',name:'Imported',due:'2028-02-29T09:00+07:00',idMembers:sourceIds}]}),userMapping};
    const committed=await s.commit(input);assert.equal(committed.status,201);const id=committed.body.taskIds[0],base=`/tasks/${id}`,expected=people.slice(1).map(p=>p.user.id);
    for(const actor of people)assert.equal((await s.request(base+'/reminders/acknowledge','POST',{},actor)).status,200);
    const assignments=()=>Object.fromEntries(['task_assignment_cycles','task_reminder_responses'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table} WHERE task_id=?`).all(id).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
    const before=assignments(),extras=await s.request(base+'/extras');assert.equal(extras.status,200);
    const label=await s.request('/task-labels','POST',{name:'Round-trip',color:'blue',projectId:s.project.id});assert.equal(label.status,201);
    const changed=await s.request(base+'/extras','PUT',{assigneeIds:extras.body.assigneeIds,labelIds:[label.body.label.id]});
    assert.equal(changed.status,200,JSON.stringify(changed.body));assert.deepEqual(changed.body.assigneeIds,expected);assert.deepEqual(assignments(),before);
    const issued=await s.request('/api-tokens','POST',{name:'Imported label test',scopes:['tasks:read','tasks:write'],projectIds:[s.project.id]});assert.equal(issued.status,201);
    const token=issued.body.rawToken;
    async function v1(path,method='GET',body){const r=await fetch(s.base+'/api/v1'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};}
    const task=(await v1(base)).body.task;
    const value={labelIds:[],expectedRevision:task.revision,operationId:`import-labels-${source}-${count}`};
    const cleared=await v1(base+'/labels','PUT',value);assert.equal(cleared.status,200,JSON.stringify(cleared.body));
    assert.equal((await v1(base+'/labels','PUT',value)).status,200,'label retry replays once');
    assert.deepEqual((await v1(base+'/labels')).body.labels,[]);assert.deepEqual(assignments(),before);
    assert.equal(s.db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(id).assignee_id,s.owner.user.id);
    assert.deepEqual((await s.request(base+'/extras')).body.assigneeIds.sort(),[...expected].sort());
    assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(value.operationId).n,1);
  });
});
