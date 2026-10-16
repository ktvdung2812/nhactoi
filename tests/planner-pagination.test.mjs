import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,call,user,addMember} from './roadmap-helpers.mjs';
import {personalTaskGroups} from '../shared/personal-planning.mjs';

const ids=tasks=>tasks.map(t=>t.id).sort();
async function context(t){
 const s=await boot(t,{clock:()=>new Date('2028-02-28T17:00:00Z')}),owner=await user(s,'paged-owner@test.local');
 const api=(path,method='GET',body,actor=owner)=>call(s,path,{method,body,cookie:actor.cookie});
 const create=async(body)=>{const r=await api('/tasks','POST',{assigneeId:owner.user.id,...body});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.task;};
 return {s,owner,api,create};
}

test('personal pages match grouping at UTC+7 leap midnight, preserve legacy data and expose all pages',async t=>{
 const {s,owner,api,create}=await context(t);
 const rows=[];
 for(const [title,dueAt,plannedDate] of [
  ['Inbox',null,null],['Yesterday','2028-02-28T16:59:59Z',null],['Midnight','2028-02-28T17:00:00Z',null],
  ['Deadline later, plan old','2028-03-02T03:00:00Z','2028-02-28'],['Deadline old, plan later','2028-02-28T01:00:00Z','2028-03-01'],
  ['Same week','2028-03-05T16:59:59Z',null],['Next week','2028-03-05T17:00:00Z',null],['Plan only',null,'2028-02-29'],
 ]){const row=await create({title,dueAt});if(plannedDate)assert.equal((await api(`/tasks/${row.id}/plan`,'PATCH',{plannedDate})).status,200);rows.push(row);}
 const done=await create({title:'Done today',dueAt:'2028-02-29T03:00:00Z'});assert.equal((await api(`/tasks/${done.id}`,'PATCH',{status:'done'})).status,200);
 const legacy=await api('/personal-tasks');assert.equal(legacy.body.tasks.length,9);assert.equal(legacy.body.page,undefined);
 for(const date of ['2028-02-28','2028-02-29','2028-03-01','2028-03-06'])for(const view of ['inbox','today','upcoming','week']){
  const expected=personalTaskGroups(legacy.body.tasks,view,new Date(`${date}T12:00:00+07:00`)).flatMap(g=>g.tasks);
  const gathered=[];let page=1;
  do{const r=await api(`/personal-tasks?view=${view}&date=${date}&pageSize=2&page=${page}`);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.total,expected.length,`${view}:${date}`);assert.ok(r.body.tasks.length<=2);gathered.push(...r.body.tasks);if(!r.body.hasMore)break;page++;assert.ok(page<10);}while(true);
  assert.deepEqual(ids(gathered),ids(expected),`${view}:${date}`);assert.equal(new Set(ids(gathered)).size,gathered.length);
 }
 const today=await api('/personal-tasks?view=today');assert.equal(today.body.doneToday,1);assert.equal(today.body.total,5);
 const picked=await api(`/personal-tasks?id=${rows[0].id}`);assert.deepEqual(ids(picked.body.tasks),[rows[0].id]);assert.ok(picked.body.tasks[0].planRevision);
 const searched=await api('/personal-tasks?q=Inbox&openOnly=true');assert.deepEqual(ids(searched.body.tasks),[rows[0].id]);
 for(const q of ['page=0','pageSize=101','view=unknown','date=2028-02-30','page=1.2'])assert.equal((await api(`/personal-tasks?${q}`)).status,400,q);
 const hidden=await user(s,'paged-outsider@test.local');assert.equal((await api('/personal-tasks?page=1','GET',undefined,hidden)).body.total,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM personal_task_plans WHERE user_id=?').get(owner.user.id).n,3);
});

test('team pagination and member-only reads preserve totals, archived visibility and current project ACL',async t=>{
 const {s,owner,api,create}=await context(t),member=await user(s,'paged-member@test.local');addMember(s,owner,member);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 const tr=await api('/teams','POST',{name:'Paged team',color:'green',members:[{userId:owner.user.id,role:'lead'},{userId:member.user.id,role:'member'}]});assert.equal(tr.status,201,JSON.stringify(tr.body));const team=tr.body.team;
 for(let i=0;i<6;i++)await create({title:`Team ${i}`,teamId:team.id});
 const pr=await api('/projects','POST',{name:'Private within team',accessMode:'private'});assert.equal(pr.status,201,JSON.stringify(pr.body));
 const secret=await create({title:'PRIVATE_CANARY',projectId:pr.body.project.id});
 assert.equal(secret.teamId,null); // Schema rejects crossing private/team scopes.
 const legacy=await api(`/teams/${team.id}`);assert.equal(legacy.body.tasks.length,6);assert.equal(legacy.body.taskPage,undefined);
 const a=await api(`/teams/${team.id}?page=1&pageSize=3`,'GET',undefined,member),b=await api(`/teams/${team.id}?page=2&pageSize=3`,'GET',undefined,member);
 assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.team.taskCount,6);assert.equal(a.body.taskPage.total,6);assert.equal(a.body.taskPage.hasMore,true);assert.equal(b.body.taskPage.hasMore,false);assert.equal(new Set(ids([...a.body.tasks,...b.body.tasks])).size,6);assert.ok(!JSON.stringify(a.body).includes('PRIVATE_CANARY'));
 const teams=await api('/teams','GET',undefined,member);assert.equal(teams.body.teams.find(t=>t.id===team.id).taskCount,6);
 const compact=await api(`/teams/${team.id}?tasks=none`);assert.equal(compact.body.tasks.length,0);assert.equal(compact.body.members.length,2);assert.equal(compact.body.taskPage.total,6);
 const patched=await api(`/teams/${team.id}?tasks=none`,'PATCH',{name:'Renamed'});assert.equal(patched.status,200,JSON.stringify(patched.body));assert.deepEqual(patched.body.tasks,[]);
 const archived=await api(`/teams/${team.id}?tasks=none`,'PATCH',{archived:true});assert.equal(archived.status,200,JSON.stringify(archived.body));assert.equal((await api(`/teams/${team.id}?page=1`,'GET',undefined,member)).body.tasks.length,6);
 assert.equal((await api(`/teams/${team.id}?pageSize=101`)).status,400);
});

test('week event pages include overlaps and renewal projections, exclude inaccessible teams and keep stable union paging',async t=>{
 const {s,owner,api}=await context(t),member=await user(s,'events-member@test.local');addMember(s,owner,member);
 const event=async title=>{const r=await api('/calendar-events','POST',{title,startsAt:'2028-02-27T16:00:00Z',endsAt:'2028-02-29T03:00:00Z'});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;};
 for(let i=0;i<4;i++)await event(`Overlap ${i}`);
 const sr=await api('/services','POST',{name:'Leap renewal',nextDate:'2028-02-29',syncCalendar:true});assert.equal(sr.status,201,JSON.stringify(sr.body));
 const legacy=await api('/calendar-events');assert.equal(legacy.body.events.length,5);assert.equal(legacy.body.page,undefined);
 const query='/calendar-events?from=2028-02-28&to=2028-03-05&openOnly=true&pageSize=2';
 const pages=await Promise.all([1,2,3].map(p=>api(query+`&page=${p}`)));assert.ok(pages.every(r=>r.status===200&&r.body.total===5));assert.deepEqual(ids(pages.flatMap(r=>r.body.events)),ids(legacy.body.events));assert.equal(pages[2].body.hasMore,false);
 const filtered=await api('/calendar-events?q=Leap&kind=service&pageSize=1');assert.equal(filtered.body.total,1);assert.equal(filtered.body.events[0].service_id,sr.body.service.id);assert.deepEqual(filtered.body.summary,{open:5,eventOpen:4,eventToday:0,eventOverdue:4});
 assert.equal((await api('/calendar-events?kind=none')).body.total,0);
 assert.equal((await api('/calendar-events?due=today')).body.total,1);
 const outside=await api('/calendar-events?from=2028-03-01&to=2028-03-05');assert.equal(outside.body.total,0);
 const team=await api('/teams','POST',{name:'Private events',color:'green',members:[{userId:owner.user.id,role:'lead'}]});assert.equal(team.status,201);
 s.db.prepare('UPDATE calendar_events SET team_id=?').run(team.body.team.id);s.db.prepare('UPDATE service_contracts SET team_id=?').run(team.body.team.id);
 assert.equal((await api(query,'GET',undefined,member)).body.total,0);
 for(const q of ['from=2028-02-30&to=2028-03-01','from=2028-03-01','from=2028-03-02&to=2028-03-01','pageSize=101','kind=bad','due=bad'])assert.equal((await api('/calendar-events?'+q)).status,400);
});
