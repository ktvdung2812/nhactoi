import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,call,user,addMember} from './roadmap-helpers.mjs';
const clock=()=>new Date('2026-09-22T04:00:00Z');
const write=(s,a,path,body,method='POST')=>call(s,path,{method,cookie:a.cookie,body});
async function fixture(t){
 const s=await boot(t,{clock}),a=await user(s,'report-owner@example.test'),b=await user(s,'report-member@example.test');addMember(s,a,b);
 const tasks=[];
 for(let i=0;i<5;i++){const r=await write(s,a,'/tasks',{title:`Fixture task ${i}`,assigneeId:i===2||i===4?b.user.id:a.user.id,dueAt:i<2?'2026-09-21T02:00:00Z':'2026-09-25T02:00:00Z'});assert.equal(r.status,201,JSON.stringify(r.body));tasks.push(r.body.task);}
 assert.equal((await write(s,a,`/tasks/${tasks[0].id}/extras`,{assigneeIds:[b.user.id],labelIds:[]},'PUT')).status,200);
 for(const [task,actor] of [[tasks[0],a],[tasks[2],b],[tasks[3],a],[tasks[4],b]])assert.equal((await write(s,actor,`/tasks/${task.id}/reminders/acknowledge`,{})).status,200);
 assert.equal((await write(s,a,`/tasks/${tasks[0].id}/reminders/snooze`,{minutes:30})).status,200);
 return {s,a,b,tasks};
}

test('TC-W2-T01-A/B/D canonical fixture counts task and assignment independently with stable paging and refresh',async t=>{
 const {s,a,tasks}=await fixture(t),get=query=>call(s,'/operations-dashboard'+query,{cookie:a.cookie});
 const events=s.db.prepare('SELECT count(*) n FROM business_events').get().n;
 const first=await get('?pageSize=2');assert.equal(first.status,200,JSON.stringify(first.body));
 assert.deepEqual(first.body.summary,{taskCount:5,assignmentCount:6,overdueTaskCount:2,unacknowledgedAssignmentCount:2,snoozedTaskCount:1,completedTaskCount:0});assert.equal(first.body.tasks.length,2);assert.equal(first.body.hasMore,true);assert.equal(first.body.generatedAt,clock().toISOString());
 const second=await get('?pageSize=2&page=2'),third=await get('?pageSize=2&page=3');const ids=[...first.body.tasks,...second.body.tasks,...third.body.tasks].map(t=>t.id);assert.equal(new Set(ids).size,5);assert.equal(third.body.hasMore,false);
 const filtered=await get(`?pageSize=2&assigneeId=${a.user.id}&projectId=${tasks[0].projectId}&status=todo`);assert.equal(filtered.body.summary.taskCount,3);assert.equal(filtered.body.summary.assignmentCount,3);
 assert.equal((await get('?group=overdue')).body.total,2);assert.equal((await get('?group=snoozed')).body.total,1);assert.equal((await get('?group=unacknowledged')).body.total,2);
 assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,events,'report reads must not generate business events');
 assert.equal((await write(s,a,`/tasks/${tasks[1].id}`,{status:'done'},'PATCH')).status,200);
 const changed=(await get('')).body.summary;assert.equal(changed.overdueTaskCount,1);assert.equal(changed.unacknowledgedAssignmentCount,1);assert.equal(changed.completedTaskCount,1);
});

test('TC-W2-T01-C project and tenant filters cannot reveal private counts or task details',async t=>{
 const {s,a,b}=await fixture(t),other=await user(s,'report-other@example.test');s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(a.workspace.id);
 const project=await write(s,a,'/projects',{name:'Private canary project',accessMode:'private'});assert.equal(project.status,201,JSON.stringify(project.body));
 const privateTask=await write(s,a,'/tasks',{title:'secret-report-canary',projectId:project.body.project.id,assigneeId:a.user.id,dueAt:'2026-09-01T01:00:00Z'});assert.equal(privateTask.status,201,JSON.stringify(privateTask.body));
 const member=await call(s,'/operations-dashboard',{cookie:b.cookie});assert.equal(member.status,200,JSON.stringify(member.body));assert.equal(member.body.summary.taskCount,5);assert.equal(member.body.summary.overdueTaskCount,2);assert.doesNotMatch(JSON.stringify(member.body),/secret-report-canary/);
 const scoped=await call(s,`/operations-dashboard?projectId=${project.body.project.id}`,{cookie:b.cookie});assert.equal(scoped.body.total,0);assert.equal(scoped.body.summary.taskCount,0);
 const tenant=await call(s,`/operations-dashboard?projectId=${project.body.project.id}`,{cookie:other.cookie});assert.equal(tenant.body.total,0);
 for(const query of ['?page=-1','?pageSize=101','?from=2026-02-30','?from=2026-10-01&to=2026-09-01','?status=bogus','?workspaceId=foreign','?group=bad'])assert.equal((await call(s,'/operations-dashboard'+query,{cookie:b.cookie})).status,400,query);
});

test('assignment aggregation deduplicates a legacy primary link and retains secondary-only tasks',async t=>{
 const {s,a,b,tasks}=await fixture(t),get=query=>call(s,'/operations-dashboard'+query,{cookie:a.cookie});
 // A primary/secondary overlap is possible in legacy rows even though current
 // writes prohibit it. The unique secondary key alone does not remove it.
 s.db.prepare('INSERT INTO task_assignees(task_id,user_id,position,created_at) VALUES(?,?,0,?)').run(tasks[0].id,a.user.id,clock().toISOString());
 const overlap=await get('');assert.equal(overlap.status,200,JSON.stringify(overlap.body));
 assert.equal(overlap.body.summary.assignmentCount,6);assert.equal(overlap.body.tasks.find(row=>row.id===tasks[0].id).assignmentCount,2);
 s.db.prepare('UPDATE tasks SET assignee_id=NULL WHERE id=?').run(tasks[4].id);
 s.db.prepare('INSERT INTO task_assignees(task_id,user_id,position,created_at) VALUES(?,?,0,?)').run(tasks[4].id,b.user.id,clock().toISOString());
 const secondaryOnly=await get(`?assigneeId=${b.user.id}`);assert.equal(secondaryOnly.status,200,JSON.stringify(secondaryOnly.body));
 assert.equal(secondaryOnly.body.summary.taskCount,3);assert.equal(secondaryOnly.body.summary.assignmentCount,3);
 assert.equal(secondaryOnly.body.tasks.find(row=>row.id===tasks[4].id).assignmentCount,1);
 const empty=await get('?from=2031-01-01');assert.equal(empty.status,200,JSON.stringify(empty.body));
 assert.equal(empty.body.total,0);assert.deepEqual(empty.body.tasks,[]);
 assert.deepEqual(empty.body.summary,{taskCount:0,assignmentCount:0,overdueTaskCount:0,unacknowledgedAssignmentCount:0,snoozedTaskCount:0,completedTaskCount:0});
});
