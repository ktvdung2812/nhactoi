import {randomBytes,randomUUID} from 'node:crypto';
import {createId} from './auth.mjs';
import {withTransaction} from './db.mjs';
import {getProjectAccess} from './projects.mjs';
import {canAccessTask} from './task-access.mjs';
import {hasWorkspaceEntitlement} from './entitlements.mjs';
import {outboundSendersPaused} from './restore-safety.mjs';
import {resolveWebhookDestination,sendWebhook,signWebhook} from './webhook-transport.mjs';

export const WEBHOOK_EVENTS=['task.created','task.updated','task.completed','task.reopened','task.status_changed','task.deleted','task.restored','task.assigned','task.unassigned','task.deadline_changed','task.acknowledged','task.snoozed','task.checklist_changed','task.labels_changed','task.fields_changed'];
export function registerWebhooks(app,{db,config,clock,requireAuth,ensureWritable,HttpError,settingsKey,loadStoredSettings,writeStoredSetting,writeAdminAudit,transport,lookup}){
 if(db.dialect!=='postgres')return;
 const now=()=>new Date(clock()).toISOString();
 const fail=(status,message)=>{throw new HttpError(status,message);};
 const creator=s=>db.prepare(`SELECT wm.role,wm.member_type FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND wm.user_id=? AND u.disabled_at IS NULL`).get(s.workspace_id,s.created_by);
 const eligible=s=>s?.active===1&&creator(s)?.member_type==='member'&&['owner','admin'].includes(creator(s)?.role)&&hasWorkspaceEntitlement(db,config,s.workspace_id,'webhooks',clock);
 const manage=req=>{if(req.auth.memberType==='guest'||!['owner','admin'].includes(req.auth.role))fail(403,'Chỉ chủ doanh nghiệp hoặc quản trị viên quản lý webhook.');};
 const own=(req,id)=>{manage(req);const s=db.prepare('SELECT * FROM webhook_subscriptions WHERE id=? AND workspace_id=? AND created_by=?').get(id,req.auth.workspaceId,req.auth.userId);if(!s)fail(404,'Không tìm thấy webhook.');return s;};
 const secretKey=id=>'webhookSecret:'+id;
 const safe=s=>({id:s.id,name:s.name,url:s.url,projectIds:JSON.parse(s.projects_json),events:JSON.parse(s.events_json),active:!!s.active,keyVersion:s.key_version,createdAt:s.created_at,updatedAt:s.updated_at});
 const route=(method,path,handler)=>app[method](path,requireAuth,async(req,res,next)=>{try{await handler(req,res);}catch(e){next(e);}});
 const audit=(req,action,id)=>writeAdminAudit(db,{actorUserId:req.auth.userId,action,targetType:'webhook',targetId:id,reason:'Người dùng quản lý webhook',createdAt:now()});
 async function destination(url){try{return await resolveWebhookDestination(url,lookup);}catch{fail(400,'Webhook cần HTTPS cổng 443 và địa chỉ public; không nhận mạng nội bộ, redirect hoặc thông tin đăng nhập.');}}
 route('get','/api/webhooks',async(req,res)=>{manage(req);res.json({subscriptions:db.prepare('SELECT * FROM webhook_subscriptions WHERE workspace_id=? AND created_by=? ORDER BY created_at DESC,id').all(req.auth.workspaceId,req.auth.userId).map(safe),eventTypes:WEBHOOK_EVENTS,policy:{maxAttempts:8,maxManualRetries:3,maxBackoffSeconds:3600,leaseSeconds:30,signatureToleranceSeconds:300,delivery:'at-least-once',redirects:false}});});
 route('post','/api/webhooks',async(req,res)=>{
  manage(req);ensureWritable(req);if(!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'webhooks',clock))fail(403,'Gói hiện tại không cấp webhook.');
  const body=req.body;if(!body||Object.keys(body).some(k=>!['name','url','projectIds','events'].includes(k)))fail(400,'Payload webhook không hợp lệ.');
  const {name,url,events}=body,projects=body.projectIds||[];
  if(typeof name!=='string'||!name.trim()||name.length>120||typeof url!=='string'||!Array.isArray(events)||!events.length||events.length>WEBHOOK_EVENTS.length||events.some(x=>!WEBHOOK_EVENTS.includes(x))||new Set(events).size!==events.length||!Array.isArray(projects)||projects.length>100||projects.some(x=>typeof x!=='string'))fail(400,'Cấu hình webhook không hợp lệ.');
  await destination(url);
  const id=createId('wh_'),secret=randomBytes(32).toString('base64url');
  withTransaction(db,()=>{
   const current=creator({workspace_id:req.auth.workspaceId,created_by:req.auth.userId});
   if(!['owner','admin'].includes(current?.role)||current?.member_type!=='member'||!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'webhooks',clock)||projects.some(p=>!getProjectAccess(db,req.auth.workspaceId,req.auth.userId,p,{config,clock})))fail(403,'Quyền đã thay đổi khi kiểm tra đích gửi.');
   db.prepare('INSERT INTO webhook_subscriptions(id,workspace_id,created_by,name,url,projects_json,events_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,req.auth.userId,name.trim(),url,JSON.stringify([...new Set(projects)]),JSON.stringify(events),now(),now());
   writeStoredSetting(db,secretKey(id),{secret},{encrypted:true,keyBytes:settingsKey,updatedAt:now()});audit(req,'webhook.created',id);
  });res.status(201).json({subscription:safe(db.prepare('SELECT * FROM webhook_subscriptions WHERE id=?').get(id)),signingSecret:secret});
 });
 route('patch','/api/webhooks/:id',async(req,res)=>{
  const s=own(req,req.params.id);if(!req.body||Object.keys(req.body).some(k=>k!=='active')||typeof req.body.active!=='boolean')fail(400,'Chỉ nhận trạng thái active.');
  if(req.body.active&&!eligible({...s,active:1}))fail(403,'Không thể bật webhook khi thiếu quyền hoặc gói.');
  withTransaction(db,()=>{db.prepare('UPDATE webhook_subscriptions SET active=?,updated_at=? WHERE id=?').run(req.body.active?1:0,now(),s.id);audit(req,req.body.active?'webhook.enabled':'webhook.disabled',s.id);});res.json({subscription:safe(db.prepare('SELECT * FROM webhook_subscriptions WHERE id=?').get(s.id))});
 });
 route('post','/api/webhooks/:id/rotate',async(req,res)=>{
  const s=own(req,req.params.id);if(!eligible({...s,active:1}))fail(403,'Thiếu quyền hoặc gói.');const secret=randomBytes(32).toString('base64url');
  withTransaction(db,()=>{db.prepare('UPDATE webhook_subscriptions SET key_version=key_version+1,updated_at=? WHERE id=?').run(now(),s.id);writeStoredSetting(db,secretKey(s.id),{secret},{encrypted:true,keyBytes:settingsKey,updatedAt:now()});audit(req,'webhook.secret_rotated',s.id);});
  res.json({keyVersion:db.prepare('SELECT key_version FROM webhook_subscriptions WHERE id=?').get(s.id).key_version,signingSecret:secret,previousKeyAcceptanceSeconds:300});
 });
 route('get','/api/webhooks/:id/deliveries',async(req,res)=>{
  const s=own(req,req.params.id),page=Number(req.query.page||1);if(!Number.isInteger(page)||page<1||page>100000)fail(400,'Trang không hợp lệ.');
  const rows=db.prepare('SELECT id,event_id,state,attempt_count,manual_retries,next_attempt_at,last_status,last_error,created_at,updated_at FROM webhook_deliveries WHERE subscription_id=? ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?').all(s.id,(page-1)*25);
  res.json({deliveries:rows,total:Number(db.prepare('SELECT count(*) n FROM webhook_deliveries WHERE subscription_id=?').get(s.id).n),page,pageSize:25});
 });
 route('post','/api/webhooks/:id/deliveries/:deliveryId/retry',async(req,res)=>{
  const s=own(req,req.params.id);if(!eligible(s))fail(403,'Webhook không còn quyền gửi.');
  withTransaction(db,()=>{const d=db.prepare('SELECT * FROM webhook_deliveries WHERE id=? AND subscription_id=? FOR UPDATE').get(req.params.deliveryId,s.id);
   if(!d)fail(404,'Không tìm thấy delivery.');if(d.state!=='failed'||d.manual_retries>=3)fail(409,'Chỉ thử lại delivery lỗi tối đa 3 lần.');
   db.prepare("UPDATE webhook_deliveries SET state='pending',manual_retries=manual_retries+1,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE id=?").run(now(),d.id);audit(req,'webhook.delivery_retried',d.id);
  });res.json({ok:true});
 });
 function payload(s,event){
  if(!eligible(s)||!event||!JSON.parse(s.events_json).includes(event.type))return null;
  const task=db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(event.task_id,s.workspace_id),projects=JSON.parse(s.projects_json);
  if(!task||!canAccessTask(db,s.workspace_id,s.created_by,task)||(projects.length&&(!projects.includes(event.project_id)||!projects.includes(task.project_id))))return null;
  // A move out of a formerly private scope never exports its historical text to
  // a principal who only acquired the new project. Revalidate both projects.
  if(event.project_id&&!getProjectAccess(db,s.workspace_id,s.created_by,event.project_id,{config,clock}))return null;
  const source=JSON.parse(event.after_json),data={};
  for(const [key,dest] of Object.entries({title:'title',description:'description',status:'status',priority:'priority',due_at:'dueAt',dueAt:'dueAt',assignee_id:'assigneeId',userId:'userId',acknowledged_at:'acknowledgedAt',snoozed_until:'snoozedUntil'}))if(Object.hasOwn(source,key))data[dest]=source[key];
  return {eventId:event.id,schemaVersion:1,eventType:event.type,occurredAt:event.occurred_at,workspaceId:event.workspace_id,
   resource:{type:'task',id:event.task_id,projectId:event.project_id,revision:event.resource_revision||null},operationId:event.operation_id,causationId:event.causation_id,data};
 }
 async function processOne(){
  if(outboundSendersPaused(db))return false;
  const claim=withTransaction(db,()=>{
   const at=now(),d=db.prepare(`SELECT * FROM webhook_deliveries WHERE (state IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (state='sending' AND lease_until<=?) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`).get(at,at);if(!d)return null;
   db.prepare("UPDATE webhook_attempts SET outcome='unknown',completed_at=? WHERE delivery_id=? AND outcome='sending'").run(at,d.id);
   const lease=randomUUID();db.prepare("UPDATE webhook_deliveries SET state='sending',lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease,new Date(+new Date(clock())+30000).toISOString(),at,d.id);return {...d,lease_token:lease};
  });if(!claim)return false;
  const finish=(state,{status=null,error=null,retryAt=null}={})=>db.prepare('UPDATE webhook_deliveries SET state=?,last_status=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?').run(state,status,error,retryAt,now(),claim.id,claim.lease_token);
  // A worker may crash after persisting an attempt and crossing the provider
  // boundary. Lease recovery still consumes that attempt; only an explicit
  // manual retry adds another allowance after the automatic budget is spent.
  if(Number(claim.attempt_count)>=8+Number(claim.manual_retries)){finish('failed',{error:'Đã hết số lần thử tự động; có thể đối soát trước khi thử lại thủ công.'});return true;}
  let s=db.prepare('SELECT * FROM webhook_subscriptions WHERE id=?').get(claim.subscription_id),event=db.prepare('SELECT * FROM business_events WHERE id=?').get(claim.event_id),content=payload(s,event);
  if(!content){finish('suppressed',{error:'Quyền, project, gói hoặc subscription không còn hợp lệ.'});return true;}
  let endpoint;try{endpoint=await resolveWebhookDestination(s.url,lookup);}catch{finish('failed',{error:'Đích HTTPS/DNS không hợp lệ hoặc không phân giải được.'});return true;}
  // DNS is asynchronous: recheck rights, configuration, lease and restore hold
  // after it returns, immediately before creating an outbound attempt.
  s=db.prepare('SELECT * FROM webhook_subscriptions WHERE id=?').get(claim.subscription_id);content=payload(s,event);
  if(!content||outboundSendersPaused(db)){finish('suppressed',{error:'Quyền hoặc trạng thái gửi đã thay đổi.'});return true;}
  if(s.url!==endpoint.url.href&&new URL(s.url).href!==endpoint.url.href){finish('failed',{error:'Đích gửi đã thay đổi.'});return true;}
  const lease=db.prepare('SELECT * FROM webhook_deliveries WHERE id=? AND lease_token=? AND lease_until>?').get(claim.id,claim.lease_token,now());if(!lease)return true;
  let secret;try{secret=JSON.parse(loadStoredSettings(db,settingsKey).get(secretKey(s.id))||'null')?.secret;}catch{}
  if(!secret){finish('failed',{error:'Thiếu khóa ký hoặc không giải mã được.'});return true;}
  const attemptId=createId('wha_'),attempt=Number(lease.attempt_count)+1,body=Buffer.from(JSON.stringify(content)),timestamp=Math.floor(+new Date(clock())/1000);
  withTransaction(db,()=>{db.prepare('UPDATE webhook_deliveries SET attempt_count=? WHERE id=? AND lease_token=?').run(attempt,claim.id,claim.lease_token);db.prepare("INSERT INTO webhook_attempts(id,delivery_id,attempt_number,key_version,started_at,outcome) VALUES(?,?,?,?,?,'sending')").run(attemptId,claim.id,attempt,s.key_version,now());});
  let result,status=null;try{result=await (transport||sendWebhook)(endpoint,body,{'x-nhactoi-signature':signWebhook(secret,s.key_version,timestamp,body),'x-nhactoi-event-id':event.id,'x-nhactoi-attempt-id':attemptId});status=Number(result.status)||null;}catch{}
  const success=status>=200&&status<300,retry=status===null||status===429||status>=500;
  const outcome=success?'accepted':status===null?'unknown':'failed';
  db.prepare('UPDATE webhook_attempts SET completed_at=?,status=?,outcome=? WHERE id=?').run(now(),status,outcome,attemptId);
  if(success)finish('delivered',{status});
  else if(retry&&attempt<8){const retryAfter=Number(result?.retryAfter),seconds=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(3600,retryAfter):Math.min(3600,15*2**(attempt-1))+Math.floor(Math.random()*5);finish('retry',{status,error:status===null?'Chưa biết bên nhận đã nhận; lần thử lại có thể trùng event.':'Đích tạm thời từ chối; sẽ thử lại.',retryAt:new Date(+new Date(clock())+seconds*1000).toISOString()});}
  else finish('failed',{status,error:retry?'Đã hết số lần thử tự động.':'Đích từ chối vĩnh viễn hoặc redirect; không tự thử lại.'});
  return true;
 }
 app.locals.processWebhooks=async({limit=25}={})=>{let processed=0;while(processed<Math.min(100,limit)&&await processOne())processed++;return {processed};};
}
