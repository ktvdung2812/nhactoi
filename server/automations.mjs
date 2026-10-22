import { canAccessTask } from './task-access.mjs';
import { canAccessProject, getProjectAccess, defaultProjectId } from './projects.mjs';
import {withMutationContext} from './task-mutation-pipeline.mjs';
import {validAssigneeId,reconcileTaskAssignees} from './task-extras.mjs';
import {createId} from './auth.mjs';
import {canAccessTeamTask,canManageAllTeams,getTeamAccess} from './teams.mjs';
import {syncTaskColumn} from './boards.mjs';
import {notifyTaskAudience} from './collaboration.mjs';
import {hasWorkspaceEntitlement} from './entitlements.mjs';
import {withWorkMutation} from './work-time.mjs';
import {vietnamDate,isValidCalendarDate} from '../shared/service-renewal.mjs';
const hooks=new WeakMap();
export function emitTaskEvent(db,event){hooks.get(db)?.(event)}
const typed=['task.created','task.assigned','task.unassigned','task.deadline_changed','task.acknowledged','task.snoozed','task.completed','task.reopened','task.status_changed'];
export function registerAutomationRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError,transitionTaskStatus}){
 const pg=db.dialect==='postgres',now=()=>new Date(clock()).toISOString(),running=new Set();
 const manage=(auth,team,projectId)=>pg?getProjectAccess(db,auth.workspaceId,auth.userId,projectId||defaultProjectId(auth.workspaceId,team),{config:db.projectConfig,clock})?.canManage:team?getTeamAccess(db,auth.workspaceId,auth.userId,team)?.canManage:canManageAllTeams(db,auth.workspaceId,auth.userId);
 const visible=(auth,team,write=false,projectId)=>pg?canAccessProject(db,auth.workspaceId,auth.userId,projectId||defaultProjectId(auth.workspaceId,team),{action:write?'write':'read',config:db.projectConfig,clock}):canAccessTeamTask(db,auth.workspaceId,auth.userId,team,{write});
 const fail=(message,status=400)=>{throw new HttpError(status,message)};
 const advanced=r=>typed.includes(r.trigger)||r.trigger==='scheduled'||JSON.parse(r.conditions_json||'[]').length>0;
 function entitlement(workspaceId,r){if(pg&&!hasWorkspaceEntitlement(db,db.projectConfig,workspaceId,advanced(r)?'automation.advanced':'automation.basic',clock))fail('Gói hiện tại không cho chạy quy tắc này',403);}
 function rule(req,write=false){const r=db.prepare('SELECT * FROM automation_rules WHERE id=? AND workspace_id=?').get(req.params.id,req.auth.workspaceId);if(!r||!visible(req.auth,r.team_id,false,r.project_id))fail('Không tìm thấy quy tắc',404);if(write){ensureWritable(req);if(!manage(req.auth,r.team_id,r.project_id)||!visible(req.auth,r.team_id,true,r.project_id))fail('Chỉ quản lý dự án được thay đổi quy tắc',403)}return r}
 function actions(value,auth,team,projectId){if(!Array.isArray(value)||!value.length||value.length>10)fail('Cần từ 1 đến 10 hành động');return value.map(a=>{if(!a||typeof a!=='object')fail('Hành động không hợp lệ');const {type,value}=a;if(type==='status'&&!['todo','doing','done'].includes(value)||type==='priority'&&!['low','medium','high'].includes(value))fail('Trạng thái hoặc độ ưu tiên không hợp lệ');if(type==='assignee'&&(typeof value!=='string'||(!validAssigneeId(db,auth.workspaceId,team,value,projectId)||(projectId&&!canAccessProject(db,auth.workspaceId,value,projectId)))))fail('Người phụ trách không hợp lệ');if(type==='comment'&&(typeof value!=='string'||!value.trim()||value.length>5000))fail('Bình luận không hợp lệ');if(!['status','priority','assignee','comment'].includes(type))fail('Hành động chưa được hỗ trợ');return {type,value}})}
 function configuration(b,auth,team,projectId){
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>120||!['created','status_changed','manual',...(pg?[...typed,'scheduled']:[])].includes(b.trigger)||b.conditionStatus&&!['todo','doing','done'].includes(b.conditionStatus))fail('Tên, sự kiện hoặc điều kiện không hợp lệ');
  const conditions=b.conditions||[];
  if(!Array.isArray(conditions)||conditions.length>10||!pg&&conditions.length)fail('Điều kiện không hợp lệ');
  for(const c of conditions){
   if(!c||typeof c.fieldId!=='string'||!['eq','neq','gt','lt','contains','is_empty'].includes(c.operator)||Object.keys(c).some(k=>!['fieldId','operator','value'].includes(k)))fail('Điều kiện không hợp lệ');
   const field=db.prepare('SELECT * FROM project_fields WHERE id=? AND workspace_id=? AND project_id=? AND retired_at IS NULL').get(c.fieldId,auth.workspaceId,projectId);
   if(!field)fail('Trường điều kiện không thuộc dự án');
   if(c.operator==='is_empty')continue;
   if(['gt','lt'].includes(c.operator)&&!['number','date'].includes(field.type)||c.operator==='contains'&&!['text','multiple'].includes(field.type))fail('Phép so sánh không đúng kiểu trường');
   const value=c.value,options=JSON.parse(field.options_json).map(o=>o.id);
   if(field.type==='number'&&(typeof value!=='number'||!Number.isFinite(value))||field.type==='checkbox'&&typeof value!=='boolean'||field.type==='date'&&!isValidCalendarDate(value)||field.type==='text'&&(typeof value!=='string'||value.length>5000)||field.type==='single'&&!options.includes(value)||field.type==='multiple'&&(c.operator==='contains'?!options.includes(value):!Array.isArray(value)||value.some(v=>!options.includes(v))))fail('Giá trị điều kiện không đúng kiểu trường');
  }
  const schedule=b.trigger==='scheduled'?b.schedule:null;
  if(schedule&&(!schedule||Object.keys(schedule).some(k=>!['time','weekdays'].includes(k))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)||!Array.isArray(schedule.weekdays)||!schedule.weekdays.length||schedule.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)))fail('Lịch chạy không hợp lệ');
  if(b.trigger==='scheduled'&&!schedule)fail('Chọn giờ và ngày chạy');
  const result={name:b.name.trim(),trigger:b.trigger,condition_status:b.conditionStatus||null,actions:JSON.stringify(actions(b.actions,auth,team,projectId)),conditions_json:JSON.stringify(conditions),schedule_json:schedule?JSON.stringify(schedule):null};
  entitlement(auth.workspaceId,result);return result;
 }
 function matches(r,task){
  if(r.condition_status&&r.condition_status!==task.status)return false;
  return JSON.parse(r.conditions_json||'[]').every(c=>{
   if(!db.prepare('SELECT 1 FROM project_fields WHERE id=? AND project_id=? AND retired_at IS NULL').get(c.fieldId,task.project_id))return false;
   const row=db.prepare('SELECT value_json FROM task_field_values WHERE task_id=? AND field_id=?').get(task.id,c.fieldId),value=row?JSON.parse(row.value_json):null;
   if(c.operator==='is_empty')return value===null||value===''||Array.isArray(value)&&!value.length;
   if(c.operator==='eq')return JSON.stringify(value)===JSON.stringify(c.value);
   if(c.operator==='neq')return JSON.stringify(value)!==JSON.stringify(c.value);
   if(c.operator==='contains')return value?.includes?.(c.value)||false;
   return value!==null&&(c.operator==='gt'?value>c.value:value<c.value);
  });
 }
 function execute(r,task,key=null){
  if(running.has(task.id))return {ok:false,error:'Vòng tự động hóa đã được chặn'};
  if(pg){db.prepare('SELECT id FROM tasks WHERE id=? FOR UPDATE').get(task.id);task=db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);if(key){const existing=db.prepare('SELECT status,error FROM automation_runs WHERE rule_id=? AND task_id=? AND trigger_key=?').get(r.id,task.id,key);if(existing)return {ok:existing.status==='success',error:existing.error};}}
  const scopeChanged=pg&&(task.workspace_id!==r.workspace_id||task.project_id!==r.project_id);
  if(!scopeChanged&&!matches(r,task))return {ok:true,skipped:true};
  running.add(task.id);const at=now();let error=null;
  db.exec('SAVEPOINT automation_action');
  try{withMutationContext(db,{actorUserId:r.created_by,source:'automation',causationId:r.id,occurredAt:at},()=>{
   // The task can move while execute waits for its row lock, even if the owner
   // can write both projects. Reject before evaluating any action or receipt.
   if(scopeChanged)fail('Công việc không còn thuộc dự án của quy tắc',409);
   entitlement(r.workspace_id,r);
   if(task.deleted_at||!visible({workspaceId:r.workspace_id,userId:r.created_by},task.team_id,true,task.project_id))fail('Chủ quy tắc không còn quyền ghi công việc',403);
   for(const a of JSON.parse(r.actions)){
    task=db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
    if(a.type==='status'){const result=transitionTaskStatus({db,task,nextStatus:a.value,actorUserId:r.created_by,now:at});syncTaskColumn(db,{workspaceId:task.workspace_id,taskId:task.id,teamId:task.team_id,status:a.value,clock,HttpError});if(result.nextTaskId)syncTaskColumn(db,{workspaceId:task.workspace_id,taskId:result.nextTaskId,teamId:task.team_id,status:'todo',clock,HttpError});}
    else if(a.type==='priority')db.prepare('UPDATE tasks SET priority=?,updated_at=? WHERE id=?').run(a.value,at,task.id);
    else if(a.type==='assignee'){actions([a],{workspaceId:task.workspace_id,userId:r.created_by},task.team_id,task.project_id);db.prepare('UPDATE tasks SET assignee_id=?,updated_at=? WHERE id=?').run(a.value,at,task.id);reconcileTaskAssignees(db,{...task,assignee_id:a.value});}
    else if(a.type==='comment')db.prepare('INSERT INTO task_comments(id,task_id,author_user_id,body,created_at) VALUES (?,?,?,?,?)').run(createId('comment_'),task.id,r.created_by,a.value,at);
   }
   const summary=`đã chạy tự động hóa “${r.name}”`;db.prepare('INSERT INTO task_activity(id,task_id,actor_user_id,action,summary,created_at) VALUES (?,?,?,?,?,?)').run(createId('activity_'),task.id,r.created_by,'automation',summary,at);notifyTaskAudience(db,{taskId:task.id,actorUserId:r.created_by,summary,createdAt:at});
  });db.exec('RELEASE automation_action');
  }catch(e){db.exec('ROLLBACK TO automation_action');db.exec('RELEASE automation_action');error=e instanceof HttpError?e.message:'Không thể hoàn thành các hành động. Kiểm tra cấu hình và thử lại.';}finally{running.delete(task.id);}
  db.prepare(`INSERT INTO automation_runs(id,rule_id,workspace_id,task_id,rule_name,status,error,created_at${pg?',trigger_key':''}) VALUES (?,?,?,?,?,?,?,?${pg?',?':''})`).run(createId('run_'),r.id,r.workspace_id,task.id,r.name,error?'failed':'success',error,at,...(pg?[key]:[]));return {ok:!error,error};
 }
 hooks.set(db,({taskId,action,summary})=>{
  if(running.has(taskId)||!['task_created','task_updated','board_task_moved'].includes(action))return;
  if(pg){const context=db.prepare('SELECT mutation_context() context').get().context;if(['automation','import','migration'].includes(context.source)||context.causationId)return;}
  const task=db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId);if(!task)return;
  const trigger=action==='task_created'?'created':'status_changed';if(trigger==='status_changed'&&!String(summary).includes('trạng thái')&&action!=='board_task_moved')return;
  const rules=db.prepare(`SELECT * FROM automation_rules WHERE workspace_id=? AND ${pg?'project_id':'team_id'} IS NOT DISTINCT FROM ? AND enabled=1 AND trigger=?`).all(task.workspace_id,pg?task.project_id:task.team_id,trigger);
  for(const r of rules)execute(r,task,pg?`revision:${trigger}:${task.aggregate_revision}`:null);
 });
 app.locals.processAutomations=()=>{
  if(!pg)return {processed:0};let processed=0;
  // Queue rows are created in the event transaction, so concurrent commits cannot
  // be missed by a timestamp/sequence cursor; enabling never replays old events.
  const pending=db.prepare('SELECT rule_id,event_id FROM automation_event_queue WHERE processed_at IS NULL ORDER BY created_at,event_id LIMIT 200').all();
  for(const q of pending)withTransaction(db,()=>{
   const row=db.prepare('SELECT * FROM automation_event_queue WHERE rule_id=? AND event_id=? AND processed_at IS NULL FOR UPDATE SKIP LOCKED').get(q.rule_id,q.event_id);if(!row)return;
   const r=db.prepare('SELECT * FROM automation_rules WHERE id=? FOR UPDATE').get(row.rule_id),task=db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(row.task_id);
   if(r?.enabled&&task&&task.project_id===r.project_id)execute(r,task,`event:${row.event_id}`);
   db.prepare('UPDATE automation_event_queue SET processed_at=? WHERE rule_id=? AND event_id=?').run(now(),row.rule_id,row.event_id);processed++;
  });
  const date=vietnamDate(clock()),weekday=new Date(`${date}T12:00Z`).getUTCDay();
  for(const r of db.prepare("SELECT * FROM automation_rules WHERE trigger='scheduled' AND enabled=1").all()){
   const schedule=JSON.parse(r.schedule_json),slot=new Date(`${date}T${schedule.time}:00+07:00`).toISOString();
   if(!schedule.weekdays.includes(weekday)||slot>now()||slot<=r.activated_at)continue;
   const tasks=db.prepare('SELECT * FROM tasks WHERE workspace_id=? AND project_id=? AND deleted_at IS NULL AND created_at<=? ORDER BY id').all(r.workspace_id,r.project_id,slot);
   for(const task of tasks)withTransaction(db,()=>{const current=db.prepare('SELECT * FROM automation_rules WHERE id=? FOR UPDATE').get(r.id);if(current?.enabled&&current.activated_at===r.activated_at){execute(current,task,`schedule:${slot}`);processed++;}});
  }
  return {processed};
 };
 const route=fn=>(req,res,next)=>{try{fn(req,res);}catch(e){next(e);}};
 app.get('/api/automations',requireAuth,route((req,res)=>{const rules=db.prepare('SELECT * FROM automation_rules WHERE workspace_id=? ORDER BY created_at DESC').all(req.auth.workspaceId).filter(r=>visible(req.auth,r.team_id,false,r.project_id)).map(r=>({...r,actions:JSON.parse(r.actions),conditions:JSON.parse(r.conditions_json||'[]'),conditionDescriptions:pg?conditionDescriptions(r):[],schedule:r.schedule_json?JSON.parse(r.schedule_json):null,canManage:!!manage(req.auth,r.team_id,r.project_id)}));const runs=db.prepare('SELECT r.*,t.team_id,t.project_id,t.deleted_at FROM automation_runs r JOIN tasks t ON t.id=r.task_id WHERE r.workspace_id=? ORDER BY r.created_at DESC LIMIT 200').all(req.auth.workspaceId).filter(r=>!r.deleted_at&&visible(req.auth,r.team_id,false,r.project_id));res.json({rules,runs});}));
 function conditionDescriptions(r){return JSON.parse(r.conditions_json||'[]').map(c=>{const f=db.prepare('SELECT name,options_json FROM project_fields WHERE id=? AND project_id=?').get(c.fieldId,r.project_id);const options=f?JSON.parse(f.options_json):[];const display=value=>options.find(o=>o.id===value)?.name??String(value);return `${f?.name||'Trường không còn hợp lệ'} · ${{eq:'bằng',neq:'khác',gt:'lớn hơn',lt:'nhỏ hơn',contains:'chứa',is_empty:'chưa có giá trị'}[c.operator]}${c.operator==='is_empty'?'':': '+(Array.isArray(c.value)?c.value.map(display).join(', '):display(c.value))}`;});}
 function insert(req,b,projectId,team){const c=configuration(b,req.auth,team,projectId),id=createId('rule_');db.prepare(`INSERT INTO automation_rules(id,workspace_id,team_id,name,trigger,condition_status,actions,created_by,created_at${pg?',project_id,conditions_json,schedule_json,activated_at':''}) VALUES (?,?,?,?,?,?,?,?,?${pg?',?,?,?,?':''})`).run(id,req.auth.workspaceId,team,c.name,c.trigger,c.condition_status,c.actions,req.auth.userId,now(),...(pg?[projectId,c.conditions_json,c.schedule_json,now()]:[]));return id;}
 app.post('/api/automations',requireAuth,route((req,res)=>{ensureWritable(req);const b=req.body||{},projectId=pg?(b.projectId||defaultProjectId(req.auth.workspaceId,b.teamId||null)):null,project=projectId&&getProjectAccess(db,req.auth.workspaceId,req.auth.userId,projectId,{config:db.projectConfig,clock}),team=project?project.project.team_id:b.teamId||null;if(!manage(req.auth,team,projectId)||!visible(req.auth,team,true,projectId))fail('Bạn không có quyền quản lý quy tắc của dự án này',403);res.status(201).json({id:insert(req,b,projectId,team)});}));
 app.patch('/api/automations/:id',requireAuth,route((req,res)=>{withTransaction(db,()=>{const r=rule(req,true),b=req.body||{};if(pg)db.prepare('SELECT id FROM automation_rules WHERE id=? FOR UPDATE').get(r.id);
  if(Object.keys(b).some(k=>!['enabled','name','trigger','conditionStatus','actions','conditions','schedule'].includes(k)))fail('Trường quy tắc không được hỗ trợ');
  if(b.enabled!==undefined&&typeof b.enabled!=='boolean')fail('Trạng thái không hợp lệ');
  const c=configuration({name:r.name,trigger:r.trigger,conditionStatus:r.condition_status,actions:JSON.parse(r.actions),conditions:JSON.parse(r.conditions_json||'[]'),schedule:r.schedule_json?JSON.parse(r.schedule_json):null,...b},req.auth,r.team_id,r.project_id);
  db.prepare(`UPDATE automation_rules SET name=?,trigger=?,condition_status=?,actions=?,enabled=?${pg?',conditions_json=?,schedule_json=?,activated_at=?':''} WHERE id=?`).run(c.name,c.trigger,c.condition_status,c.actions,b.enabled===undefined?r.enabled:b.enabled?1:0,...(pg?[c.conditions_json,c.schedule_json,now()]:[]),r.id);
  if(pg)db.prepare('DELETE FROM automation_event_queue WHERE rule_id=? AND processed_at IS NULL').run(r.id);
 });res.json({ok:true});}));
 app.post('/api/automations/:id/duplicate',requireAuth,route((req,res)=>{const r=rule(req,true);res.status(201).json({id:insert(req,{name:req.body?.name||`${r.name.slice(0,110)} (bản sao)`,trigger:r.trigger,conditionStatus:r.condition_status,actions:JSON.parse(r.actions),conditions:JSON.parse(r.conditions_json||'[]'),schedule:r.schedule_json?JSON.parse(r.schedule_json):null},r.project_id,r.team_id)});}));
 app.delete('/api/automations/:id',requireAuth,route((req,res)=>{const r=rule(req,true);db.prepare('DELETE FROM automation_rules WHERE id=?').run(r.id);res.json({ok:true});}));
 app.post('/api/automations/:id/run',requireAuth,route((req,res)=>{
  const authorize=()=>{ensureWritable(req);const r=rule(req);if(r.trigger!=='manual'||!r.enabled)fail('Nút tự động hóa đang tắt hoặc không cho chạy thủ công',409);const task=db.prepare(`SELECT * FROM tasks WHERE id=? AND workspace_id=? AND ${pg?'project_id':'team_id'} IS NOT DISTINCT FROM ? AND deleted_at IS NULL`).get(req.body?.taskId,req.auth.workspaceId,pg?r.project_id:r.team_id);if(!task||!canAccessTask(db,req.auth.workspaceId,req.auth.userId,task,{write:true}))fail('Không tìm thấy công việc phù hợp',404);return {r,task};};
  const run=({r,task})=>{if(!matches(r,task))fail('Công việc chưa đáp ứng điều kiện',409);return execute(r,task);};
  res.json(pg?withWorkMutation(db,req,`automation.run:${req.params.id}`,clock,HttpError,authorize,run):withTransaction(db,()=>run(authorize())));
 }));
}
