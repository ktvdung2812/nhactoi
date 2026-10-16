import {workReminderAllowed,delegatedRecipients,nextWorkingInstant,getWorkCalendar} from './work-calendar.mjs';
import {vietnamDate,addCalendarDays} from '../shared/service-renewal.mjs';
import { canAccessTask } from './task-access.mjs';
import { createId } from './auth.mjs';
import { taskProjectAccess } from './projects.mjs';
import { claimDelivery, beginDelivery, settleDelivery, deliveryFailure } from './delivery-leases.mjs';
import { outboundSendersPaused } from './restore-safety.mjs';
import { mutationFingerprint } from './task-mutation-pipeline.mjs';
import { canAccessTeamTask, canManageAllTeams, getTeamAccess } from './teams.mjs';
export const DEFAULT_REMINDER_POLICY = {
 enabled: false, allowMemberOverride: false, quietStart: null, quietEnd: null,
 minIntervalMinutes: 60,
 steps: [
  { offsetMinutes: -60, audience: 'assignees', condition: 'incomplete' },
  { offsetMinutes: 120, audience: 'assignees', condition: 'unacknowledged' },
  { offsetMinutes: 1440, audience: 'leads', condition: 'incomplete' },
 ],
};
const at = clock => new Date(clock()).toISOString();
export function reminderPolicy(db, task) {
 const row=db.prepare('SELECT policy_json FROM reminder_policies WHERE workspace_id=? AND scope=?').get(task.workspace_id,task.team_id||'');
 return row ? JSON.parse(row.policy_json) : structuredClone(DEFAULT_REMINDER_POLICY);
}
function effectivePolicy(db,task) {
 const policy=reminderPolicy(db,task);
 const own=db.prepare('SELECT settings_json FROM task_reminder_settings WHERE task_id=?').get(task.id);
 // Revoking member overrides takes effect immediately for existing overrides too.
 return own && policy.allowMemberOverride ? {...policy,...JSON.parse(own.settings_json)} : policy;
}
function activeWorkspace(db,workspaceId,now) {
 return !!db.prepare(`SELECT 1 FROM workspaces w JOIN subscriptions s ON s.workspace_id=w.id
 WHERE w.id=? AND w.suspended_at IS NULL AND s.status NOT IN ('expired','canceled') AND s.current_period_end>?`).get(workspaceId,now);
}
export function inQuietHours(policy,now) {
 if(!policy.quietStart || !policy.quietEnd) return false;
 const local=new Date(new Date(now).getTime()+7*3600000).toISOString().slice(11,16);
 return policy.quietStart<policy.quietEnd
  ? local>=policy.quietStart && local<policy.quietEnd
  : local>=policy.quietStart || local<policy.quietEnd;
}
export function taskReminderRecipients(db,task,now) {
 const assigned=new Set(db.prepare('SELECT user_id FROM task_assignees WHERE task_id=?').all(task.id).map(r=>r.user_id));
 if(task.assignee_id) assigned.add(task.assignee_id);
 const people=db.prepare(`SELECT u.id,u.name,u.email FROM users u JOIN workspace_members wm ON wm.user_id=u.id
 WHERE wm.workspace_id=? AND u.disabled_at IS NULL`).all(task.workspace_id);
 return people.filter(u=>(!assigned.size||assigned.has(u.id))&&canAccessTask(db,task.workspace_id,u.id,task,{action:'comment'}));
}
function leads(db,task) {
 return db.prepare(`SELECT u.id,u.name,u.email FROM users u JOIN workspace_members wm ON wm.user_id=u.id
 WHERE wm.workspace_id=? AND u.disabled_at IS NULL AND ${task.team_id
 ? "EXISTS(SELECT 1 FROM team_members tm WHERE tm.team_id=? AND tm.workspace_id=wm.workspace_id AND tm.user_id=u.id AND tm.role='lead')"
 : "wm.role IN ('owner','admin')"}`).all(task.workspace_id,...(task.team_id?[task.team_id]:[]));
}
export function legacyReminderAllowed(db,task,userId,now,{ignoreWorkCalendar=false}={}) {
 if(!activeWorkspace(db,task.workspace_id,now)) return false;
 if(task.imported_at && task.remind_at && task.remind_at<=task.imported_at)return false;
 const response=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(task.id,userId);
 return !(response?.snoozed_until && (response.snoozed_until>now || !response.snooze_sent_at)) && !inQuietHours(reminderPolicy(db,task),now) && (ignoreWorkCalendar||workReminderAllowed(db,task,userId,now));
}
export function reminderRetryAt(db,task,userId,now){
 const response=db.prepare('SELECT snoozed_until FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(task.id,userId);
 let candidate=new Date(Math.max(Date.parse(now)+60000,Date.parse(response?.snoozed_until)||0));
 const policy=reminderPolicy(db,task);
 for(let i=0;i<370;i++){
  if(!workReminderAllowed(db,task,userId,candidate.toISOString())){
   const next=nextWorkingInstant(getWorkCalendar(db,task.workspace_id,userId),candidate);
   if(!next)return new Date(Date.parse(now)+86400000).toISOString();
   candidate=next;
  }
  if(!inQuietHours(policy,candidate))return candidate.toISOString();
  let date=vietnamDate(candidate);const local=new Date(candidate.getTime()+7*3600000).toISOString().slice(11,16);
  if(policy.quietStart>policy.quietEnd&&local>=policy.quietStart)date=addCalendarDays(date,1);
  candidate=new Date(`${date}T${policy.quietEnd}:00+07:00`);
 }
 return new Date(Date.parse(now)+86400000).toISOString();
}
function activity(db,task,userId,action,summary,now) {
 db.prepare('INSERT INTO task_activity(id,task_id,actor_user_id,action,summary,created_at) VALUES(?,?,?,?,?,?)')
 .run(createId('activity_'),task.id,userId,action,summary,now);
}
function notify(db,task,userId,key,title,message,now,step=null) {
 db.exec('BEGIN');
 try {
  const claimed=db.prepare('INSERT INTO task_reminder_deliveries(id,task_id,user_id,schedule_key,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING')
   .run(createId('delivery_'),task.id,userId,key,now);
  if(!claimed.changes){db.exec('COMMIT');return null;}
  const id=createId('notice_');
  db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,entity_type,entity_id,created_at)
   VALUES(?,?,?,?,'task_reminder',?,?,'task',?,?)`).run(id,task.workspace_id,userId,task.id,title,message,task.id,now);
  db.prepare('UPDATE reminder_notice_context SET schedule_key=? WHERE notification_id=?').run(key,id);
  if(step)db.prepare('UPDATE reminder_notice_context SET audience=?,condition=? WHERE notification_id=?').run(step.audience,step.condition,id);
  db.exec('COMMIT');return {taskId:task.id,userId,notificationId:id};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function processWorkflowReminders({db,clock=()=>new Date()}) {
 const now=at(clock),sent=[];
 const tasks=db.prepare(`SELECT t.* FROM tasks t JOIN workspaces w ON w.id=t.workspace_id
 JOIN subscriptions s ON s.workspace_id=t.workspace_id LEFT JOIN teams tm ON tm.id=t.team_id
 WHERE t.deleted_at IS NULL AND t.status<>'done' AND w.suspended_at IS NULL
 AND (t.team_id IS NULL OR tm.archived_at IS NULL) AND s.status NOT IN ('expired','canceled') AND s.current_period_end>?`).all(now);
 for(const task of tasks){
  const policy=effectivePolicy(db,task);
  if(inQuietHours(policy,now))continue;
  const recipients=taskReminderRecipients(db,task,now);
  for(const recipient of recipients){
   const response=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(task.id,recipient.id);
   if(response?.snoozed_until && response.snoozed_until<=now && !response.snooze_sent_at && workReminderAllowed(db,task,recipient.id,now)){
    for(const target of delegatedRecipients(db,task,[recipient],now).filter(u=>workReminderAllowed(db,task,u.id,now))){const notice=notify(db,task,target.id,`workflow:snooze:${response.snoozed_until}`,'Đến giờ nhắc lại',task.title,now);if(notice)sent.push(notice);}
    if(task.remind_at && task.remind_at<=now) db.prepare('INSERT INTO task_reminder_deliveries(id,task_id,user_id,schedule_key,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').run(createId('delivery_'),task.id,recipient.id,task.remind_at,now);
    db.prepare('UPDATE task_reminder_responses SET snooze_sent_at=? WHERE task_id=? AND user_id=?').run(now,task.id,recipient.id);
   }
  }
  if(!policy.enabled || !task.due_at)continue;
  const currentSteps=[...new Map(policy.steps.filter(step=>Date.parse(task.due_at)+step.offsetMinutes*60000<=Date.parse(now)).sort((a,b)=>a.offsetMinutes-b.offsetMinutes).map(step=>[`${step.audience}:${step.condition}`,step])).values()];
  for(const step of currentSteps){
   if(Date.parse(task.due_at)+step.offsetMinutes*60000>Date.parse(now))continue;
   if(task.imported_at && Date.parse(task.due_at)+step.offsetMinutes*60000<=Date.parse(task.imported_at))continue;
   const audience=(step.audience==='leads'?leads(db,task):recipients).filter(u=>db.dialect!=='postgres'||taskProjectAccess(db,task.workspace_id,u.id,task,{action:'write',clock:()=>new Date(now)}));
   const pending=recipients.filter(u=>!db.prepare('SELECT 1 FROM task_reminder_responses WHERE task_id=? AND user_id=? AND acknowledged_at IS NOT NULL').get(task.id,u.id));
   const eligible=audience.filter(u=>{const response=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(task.id,u.id);return !(response?.snoozed_until>now)&&!(step.condition==='unacknowledged'&&(step.audience==='leads'?!pending.length:response?.acknowledged_at));});
   for(const recipient of delegatedRecipients(db,task,eligible,now)){
    if(!workReminderAllowed(db,task,recipient.id,now))continue;
    const recent=db.prepare('SELECT created_at FROM task_reminder_deliveries WHERE task_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1').get(task.id,recipient.id);
    if(recent && Date.parse(now)-Date.parse(recent.created_at)<policy.minIntervalMinutes*60000)continue;
    const key=`workflow:${task.due_at}:${step.offsetMinutes}:${step.audience}:${step.condition}`;
    const notice=notify(db,task,recipient.id,key,step.audience==='leads'?'Công việc cần trưởng nhóm theo dõi':'Nhắc tiến độ công việc',`${task.title} — hạn ${task.due_at}.${step.condition==='unacknowledged'?' Chưa xác nhận nhận việc.':''}`,now,step);
    if(notice)sent.push(notice);
   }
  }
 }
 return sent;
}
// Checked immediately before each external send, including retries.
export function reminderDeliveryAllowed(db,notice,now) {
 if(!notice || !activeWorkspace(db,notice.workspace_id,now))return false;
 if(!db.prepare('SELECT 1 FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE u.id=? AND u.disabled_at IS NULL AND wm.workspace_id=?').get(notice.user_id,notice.workspace_id))return false;
 const context=db.prepare('SELECT * FROM reminder_notice_context WHERE notification_id=?').get(notice.id);
 if(notice.type==='service_renewal'){
  const s=db.prepare('SELECT * FROM service_contracts WHERE id=? AND workspace_id=?').get(notice.service_id||notice.entity_id,notice.workspace_id);
  if(!s)return false;
  if(db.dialect==='postgres'&&!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND member_type='member'").get(s.workspace_id,notice.user_id))return false;
  if(s.assignee_id?s.assignee_id!==notice.user_id:!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND role IN ('owner','admin')").get(s.workspace_id,notice.user_id))return false;
  if(context?.schedule_key?.startsWith('service:')&&!context.schedule_key.startsWith(`service:${mutationFingerprint([s.reminder_time,s.reminder_mode,s.remind_days,s.assignee_id,s.team_id])}:`))return false;
  if(db.dialect==='postgres'&&db.prepare(`SELECT 1 FROM service_cycle_tasks c JOIN tasks t ON t.id=c.task_id WHERE c.service_id=? AND c.period_date=? AND t.status='done' AND t.deleted_at IS NULL`).get(s.id,s.next_date))return false;
  return !!s && (!context?.due_at||context.due_at===s.next_date) && !s.archived_at && !!s.enabled && (!s.last_renewed_at||s.last_renewed_at<notice.created_at)
   && canAccessTeamTask(db,s.workspace_id,notice.user_id,s.team_id,{write:true});
 }
 if(notice.task_id){
  const task=db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(notice.task_id,notice.workspace_id);
  if(task && notice.type==='task_reminder'){
   const key=context?.schedule_key;
   if(key?.startsWith('checklist:')){
    const [,itemId,remindAt]=key.match(/^checklist:([^:]+):(.*)$/)||[];
    const item=db.prepare(`SELECT i.* FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id
     WHERE i.id=? AND c.task_id=? AND i.completed=0 AND i.remind_at=?
     AND EXISTS(SELECT 1 FROM task_checklist_assignees a WHERE a.item_id=i.id AND a.user_id=?)`).get(itemId,task.id,remindAt,notice.user_id);
    if(!item)return false;
   }else if(key?.startsWith('workflow:snooze:')){
    // Recipient eligibility, including current delegation, is rechecked below.
   }else if(key?.startsWith('workflow:')){
    const policy=effectivePolicy(db,task);
    if(!policy.enabled||!policy.steps.some(step=>key===`workflow:${task.due_at}:${step.offsetMinutes}:${step.audience}:${step.condition}`))return false;
   }else if(key&&!key.startsWith('test:')&&key!==task.remind_at)return false;
   if(context?.due_at && context.due_at!==task.due_at)return false;
   const recipients=taskReminderRecipients(db,task,now);
   let eligible=context?.audience==='leads'?leads(db,task).filter(u=>canAccessTask(db,task.workspace_id,u.id,task,{write:true})):recipients;
   if(key?.startsWith('workflow:snooze:'))eligible=eligible.filter(u=>db.prepare('SELECT 1 FROM task_reminder_responses WHERE task_id=? AND user_id=? AND snoozed_until=? AND snooze_sent_at IS NOT NULL').get(task.id,u.id,key.slice('workflow:snooze:'.length)));
   else eligible=eligible.filter(u=>{const response=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(task.id,u.id);return !(response?.snoozed_until&&(response.snoozed_until>now||!response.snooze_sent_at));});
   if(context?.condition==='unacknowledged'){
    const pending=recipients.filter(u=>!db.prepare('SELECT 1 FROM task_reminder_responses WHERE task_id=? AND user_id=? AND acknowledged_at IS NOT NULL').get(task.id,u.id));
    eligible=context.audience==='leads'?(pending.length?eligible:[]):eligible.filter(u=>pending.some(p=>p.id===u.id));
   }
   if(!key?.startsWith('checklist:')&&!delegatedRecipients(db,task,eligible,now).some(u=>u.id===notice.user_id))return false;
  }
  return !!task && (notice.type!=='task_reminder'||task.status!=='done')
   && canAccessTask(db,task.workspace_id,notice.user_id,task,{action:notice.type==='task_reminder'?'read':'comment'});
 }
 return false;
}
const emailLocks=new WeakMap();
export async function processReminderEmails({db,clock=()=>new Date(),transport,from='no-reply@nhactoi.local',publicAppUrl=''}) {
 if(outboundSendersPaused(db))return {sent:0,failed:0,skipped:0,paused:true};
 if(!transport)return {sent:0,failed:0,skipped:0};
 if(emailLocks.has(db))return emailLocks.get(db);
 const run=(async()=>{
  const stats={sent:0,failed:0,skipped:0};
  const rows=db.prepare(`SELECT n.*,e.attempts FROM reminder_email_outbox e JOIN notifications n ON n.id=e.notification_id
   WHERE e.status='pending' AND e.next_attempt_at<=? ORDER BY e.next_attempt_at LIMIT 100`).all(at(clock));
  for(const n of rows){
   if(outboundSendersPaused(db))return {...stats,paused:true};
   const now=at(clock),claim=claimDelivery(db,'email',n.id,n.user_id,now);
   if(!claim)continue;
   if(claim.unknown){db.prepare("UPDATE reminder_email_outbox SET status='unknown',last_error='delivery outcome unknown' WHERE notification_id=? AND status='pending'").run(n.id);stats.failed++;continue;}
   if(db.prepare('SELECT status FROM reminder_email_outbox WHERE notification_id=?').get(n.id)?.status!=='pending'){
    settleDelivery(db,claim,'suppressed',now,()=>{});continue;
   }
   if(!reminderDeliveryAllowed(db,n,now)){
    settleDelivery(db,claim,'suppressed',now,()=>db.prepare("UPDATE reminder_email_outbox SET status='skipped' WHERE notification_id=? AND status='pending'").run(n.id));stats.skipped++;continue;
   }
   if(n.task_id){const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(n.task_id);if(!legacyReminderAllowed(db,task,n.user_id,now)){
    const retryAt=reminderRetryAt(db,task,n.user_id,now);
    settleDelivery(db,claim,'retry',now,()=>db.prepare("UPDATE reminder_email_outbox SET next_attempt_at=? WHERE notification_id=? AND status='pending'").run(retryAt,n.id),{nextAttemptAt:retryAt,error:"reminder deferred by working hours or quiet policy"});
    continue;
   }}
   const recipient=db.prepare('SELECT email FROM users WHERE id=?').get(n.user_id);
   if(!beginDelivery(db,claim,at(clock)))continue;
   let result;
   try{
    const path=n.type==='service_renewal'?`/services?service=${encodeURIComponent(n.service_id||n.entity_id)}`:`/tasks/${encodeURIComponent(n.task_id)}`;
    result=await transport.sendMail({from,to:recipient.email,subject:n.title,text:`${n.message}\n${publicAppUrl}${path}`});
   }catch(error){
    const attempts=Number(n.attempts)+1,failure=deliveryFailure(error,attempts,{now:at(clock),baseDelay:120000});
    settleDelivery(db,claim,failure.status==='pending'?'retry':failure.status,at(clock),()=>db.prepare("UPDATE reminder_email_outbox SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE notification_id=? AND status IN ('pending','unknown')")
     .run(failure.status,attempts,failure.nextAttemptAt,failure.error,n.id),{error:failure.error,nextAttemptAt:failure.nextAttemptAt});stats.failed++;continue;
   }
    settleDelivery(db,claim,'sent',at(clock),()=>db.prepare("UPDATE reminder_email_outbox SET status='sent',attempts=attempts+1,sent_at=?,last_error=NULL WHERE notification_id=? AND status IN ('pending','unknown')").run(at(clock),n.id),{reference:result?.messageId});stats.sent++;
  }return stats;
 })();
 emailLocks.set(db,run);try{return await run;}finally{emailLocks.delete(db);}
}
export function registerReminderRoutes(app,{db,clock,requireAuth,ensureWritable,HttpError,withTransaction}) {
 const fail=(message,status=400)=>{throw new HttpError(status,message)};
 const route=fn=>(req,res,next)=>{try{fn(req,res);}catch(e){next(e)}};
 const canManage=(req,teamId)=>teamId?!!getTeamAccess(db,req.auth.workspaceId,req.auth.userId,teamId)?.canManage:canManageAllTeams(db,req.auth.workspaceId,req.auth.userId);
 function scope(req,write=false){
  const teamId=req.query.teamId||null;
  if(teamId!==null && typeof teamId!=='string')fail('Team không hợp lệ');
  if(!canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,teamId,{write}))fail('Không có quyền với phạm vi này',403);
  if(write){ensureWritable(req);if(!canManage(req,teamId))fail('Chỉ quản lý được thay đổi chính sách nhắc',403);}
  return teamId;
 }
 function task(req,write=false){
  const row=db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(req.params.id,req.auth.workspaceId);
  if(!row||!canAccessTask(db,row.workspace_id,req.auth.userId,row))fail('Không tìm thấy công việc',404);
  if(write){ensureWritable(req);if(!canAccessTask(db,row.workspace_id,req.auth.userId,row,{action:/\/reminders\/(acknowledge|snooze)$/.test(req.path)?'comment':'write'})||row.status==='done')fail('Công việc chỉ đọc hoặc đã hoàn thành',409);}
  return row;
 }
 function validate(body,own=false){
  const allowed=own?['enabled','steps']:Object.keys(DEFAULT_REMINDER_POLICY);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail('Chính sách nhắc không hợp lệ');
  if(typeof body.enabled!=='boolean'||!Array.isArray(body.steps)||body.steps.length<1||body.steps.length>6)fail('Chọn từ 1 đến 6 mốc nhắc');
  const seen=new Set();
  for(const s of body.steps){
   if(!s||Object.keys(s).some(k=>!['offsetMinutes','audience','condition'].includes(k))||!Number.isInteger(s.offsetMinutes)||s.offsetMinutes< -43200||s.offsetMinutes>43200||!['assignees','leads'].includes(s.audience)||!['incomplete','unacknowledged'].includes(s.condition))fail('Mốc nhắc không hợp lệ (tối đa 30 ngày trước/sau hạn)');
   const key=JSON.stringify([s.offsetMinutes,s.audience,s.condition]);if(seen.has(key))fail('Mốc nhắc bị trùng');seen.add(key);
  }
  if(!own){
   if(typeof body.allowMemberOverride!=='boolean'||!Number.isInteger(body.minIntervalMinutes)||body.minIntervalMinutes<15||body.minIntervalMinutes>1440)fail('Khoảng cách nhắc phải từ 15 đến 1440 phút');
   const time=v=>v===null||typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
   if(!time(body.quietStart)||!time(body.quietEnd)||!!body.quietStart!==!!body.quietEnd||body.quietStart&&body.quietStart===body.quietEnd)fail('Giờ yên lặng không hợp lệ');
  }
  return {...body,steps:[...body.steps].sort((a,b)=>a.offsetMinutes-b.offsetMinutes)};
 }
 app.get('/api/reminder-policy',requireAuth,route((req,res)=>{const teamId=scope(req);res.json({policy:reminderPolicy(db,{workspace_id:req.auth.workspaceId,team_id:teamId}),canManage:canManage(req,teamId)});}));
 app.put('/api/reminder-policy',requireAuth,route((req,res)=>{
  const teamId=scope(req,true),policy=validate(req.body);
  db.prepare(`INSERT INTO reminder_policies VALUES(?,?,?,?) ON CONFLICT(workspace_id,scope) DO UPDATE SET policy_json=excluded.policy_json,updated_at=excluded.updated_at`).run(req.auth.workspaceId,teamId||'',JSON.stringify(policy),at(clock));res.json({policy});
 }));
 app.get('/api/tasks/:id/reminders',requireAuth,route((req,res)=>{
  const t=task(req),policy=reminderPolicy(db,t),recipients=taskReminderRecipients(db,t,at(clock));
  const responses=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=?').all(t.id);
  const history=db.prepare(`SELECT n.id,n.user_id,u.name,n.created_at,n.read_at,n.title,
   e.status AS email_status,e.attempts AS email_attempts,e.last_error AS email_error,o.status AS push_status
   FROM notifications n JOIN users u ON u.id=n.user_id LEFT JOIN reminder_email_outbox e ON e.notification_id=n.id
   LEFT JOIN notification_outbox o ON o.notification_id=n.id
   WHERE n.task_id=? AND n.workspace_id=? AND n.type='task_reminder' ORDER BY n.created_at DESC,n.id DESC LIMIT 50`).all(t.id,t.workspace_id);
  const browserStatuses=history.length?db.prepare(`SELECT d.notification_id,d.status,COUNT(*) AS count
   FROM web_push_deliveries d JOIN notifications n ON n.id=d.notification_id
   WHERE n.task_id=? AND n.workspace_id=? AND n.id IN (${history.map(()=>'?').join(',')})
   GROUP BY d.notification_id,d.status`).all(t.id,t.workspace_id,...history.map(n=>n.id)):[];
  for(const notification of history) notification.web_push_statuses=Object.fromEntries(browserStatuses.filter(row=>row.notification_id===notification.id).map(row=>[row.status,Number(row.count)]));
  const zaloHistory=db.dialect==='postgres'?db.prepare(`SELECT d.id,d.status,d.attempts,d.created_at,d.updated_at,d.last_error AS error,d.provider_message_id AS provider_reference,u.name
   FROM zalo_oa_deliveries d JOIN zalo_oa_recipients r ON r.id=d.recipient_id LEFT JOIN users u ON u.id=r.user_id
   WHERE d.workspace_id=? AND d.source_kind='task' AND d.source_id=? ORDER BY d.created_at DESC LIMIT 50`).all(t.workspace_id,t.id):[];
  res.json({policy,effectivePolicy:effectivePolicy(db,t),canConfigure:policy.allowMemberOverride,
   canRespond:recipients.some(u=>u.id===req.auth.userId),recipients:recipients.map(u=>({id:u.id,name:u.name,...responses.find(r=>r.user_id===u.id)})),history,zaloHistory});
 }));
 app.put('/api/tasks/:id/reminders',requireAuth,route((req,res)=>{
  const t=task(req,true),policy=reminderPolicy(db,t);
  if(!policy.allowMemberOverride)fail('Team chưa cho phép tùy chỉnh mốc nhắc từng việc',403);
  withTransaction(db,()=>{
   if(req.body?.inherit===true&&Object.keys(req.body).length===1)db.prepare('DELETE FROM task_reminder_settings WHERE task_id=?').run(t.id);
   else {const value=validate(req.body,true);db.prepare('INSERT INTO task_reminder_settings VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').run(t.id,JSON.stringify(value),at(clock));}
   activity(db,t,req.auth.userId,'reminder_settings','đã cập nhật các mốc nhắc',at(clock));
  });res.json({ok:true});
 }));
 for(const action of ['acknowledge','snooze'])app.post(`/api/tasks/:id/reminders/${action}`,requireAuth,route((req,res)=>{
  const t=task(req,true),now=at(clock);
  if(!taskReminderRecipients(db,t,at(clock)).some(u=>u.id===req.auth.userId))fail('Bạn không phải người được giao việc',403);
  let until=null;
  if(action==='snooze'){
   const minutes=req.body?.minutes;if(!Number.isInteger(minutes)||minutes<5||minutes>10080)fail('Chọn thời gian hoãn từ 5 phút đến 7 ngày');
   until=new Date(Date.parse(now)+minutes*60000).toISOString();
  }
  withTransaction(db,()=>{
   db.prepare('INSERT INTO task_reminder_responses(task_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING').run(t.id,req.auth.userId);
   if(action==='acknowledge'){
    const result=db.prepare('UPDATE task_reminder_responses SET acknowledged_at=? WHERE task_id=? AND user_id=? AND acknowledged_at IS NULL').run(now,t.id,req.auth.userId);
    if(result.changes)activity(db,t,req.auth.userId,'task_acknowledged','đã xác nhận nhận việc',now);
   }else{
    db.prepare('UPDATE task_reminder_responses SET snoozed_until=?,snooze_sent_at=NULL WHERE task_id=? AND user_id=?').run(until,t.id,req.auth.userId);
    for(const table of ['reminder_email_outbox','notification_outbox'])db.prepare(`UPDATE ${table} SET status='skipped' WHERE status='pending' AND notification_id IN (SELECT id FROM notifications WHERE task_id=? AND workspace_id=? AND user_id=? AND type='task_reminder')`).run(t.id,t.workspace_id,req.auth.userId);
    activity(db,t,req.auth.userId,'reminder_snoozed' ,`đã hoãn nhắc đến ${new Date(until).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`,now);
   }
  });res.json({ok:true,snoozedUntil:until});
 }));
 app.post('/api/tasks/:id/reminders/test',requireAuth,route((req,res)=>{
  const t=task(req,true),now=at(clock);
  if(!taskReminderRecipients(db,t,at(clock)).some(u=>u.id===req.auth.userId))fail('Chỉ người được giao việc được gửi thử cho chính mình',403);
  const previous=db.prepare("SELECT created_at FROM task_reminder_deliveries WHERE task_id=? AND user_id=? AND schedule_key LIKE 'test:%' ORDER BY created_at DESC LIMIT 1").get(t.id,req.auth.userId);
  if(previous&&Date.parse(now)-Date.parse(previous.created_at)<60000)fail('Chờ 1 phút trước khi gửi thử tiếp',429);
  const result=notify(db,t,req.auth.userId,`test:${now}`,'Nhắc thử công việc',t.title,now);
  res.status(201).json({ok:true,notificationId:result.notificationId});
 }));
 app.post('/api/tasks/:id/reminders/retry-email',requireAuth,route((req,res)=>{
  const t=task(req,true);
  const result=withTransaction(db,()=>{
   if(db.dialect==='postgres')db.prepare(`UPDATE delivery_leases SET status='retry',updated_at=?,lease_until=? WHERE channel='email' AND status='failed'
    AND notification_id IN (SELECT n.id FROM notifications n JOIN reminder_email_outbox e ON e.notification_id=n.id
     WHERE e.status='failed' AND n.task_id=? AND n.workspace_id=? AND n.user_id=?)`).run(at(clock),at(clock),t.id,t.workspace_id,req.auth.userId);
   return db.prepare(`UPDATE reminder_email_outbox SET status='pending',attempts=0,next_attempt_at=?,last_error=NULL
    WHERE status='failed' AND notification_id IN (SELECT id FROM notifications WHERE task_id=? AND workspace_id=? AND user_id=?)`).run(at(clock),t.id,t.workspace_id,req.auth.userId);
  });
  res.json({count:result.changes});
 }));
}
