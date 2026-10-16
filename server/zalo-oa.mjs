import {createHash,randomUUID} from 'node:crypto';
import {withTransaction} from './db.mjs';
import {canAccessTask} from './task-access.mjs';
import {canAccessTeamTask} from './teams.mjs';
import {hasWorkspaceEntitlement} from './entitlements.mjs';
import {outboundSendersPaused} from './restore-safety.mjs';
import {zaloOaTransport} from './zalo-oa-transport.mjs';

const encode=JSON.stringify,decode=value=>JSON.parse(value),digest=value=>createHash('sha256').update(encode(value)).digest('hex');
const purposes=['internal','transactional','customer_care','promotional'];
const rank={accepted:1,delivered:2,read:3};
const text=(v,max=200)=>typeof v==='string'&&v.trim()&&v.length<=max;
// No live endpoint is assumed. A verified provider adapter must supply authorization,
// template/recipient policy and callback verification for the actual OA API contract.
export function registerZaloOa(app,{db,config,clock,requireAuth,ensureWritable,HttpError,writeStoredSetting,loadStoredSettings,settingsKey,transport,liveSendEnabled=false,fetchImpl}) {
 if(db.dialect!=='postgres')return;
 const now=()=>new Date(clock()).toISOString(),fail=(s,m)=>{throw new HttpError(s,m);};
 const conn=workspace=>db.prepare('SELECT * FROM zalo_oa_connections WHERE workspace_id=?').get(workspace);
 const tokenKey=id=>'zaloOaToken:'+id;
 const credential=c=>{const value=loadStoredSettings(db,settingsKey).get(tokenKey(c.id));if(!value)fail(409,'Thiếu khóa hoặc credential OA.');return decode(value);};
 transport ||= zaloOaTransport({fetchImpl,clock,sendEnabled:liveSendEnabled,credentialsForOa:oaId=>{const c=db.prepare('SELECT * FROM zalo_oa_connections WHERE oa_id=?').get(oaId);return c?credential(c):null;}});
 const membership=(w,u)=>db.prepare(`SELECT wm.* FROM workspace_members wm JOIN users u ON u.id=wm.user_id JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.workspace_id=? AND wm.user_id=? AND u.disabled_at IS NULL AND w.suspended_at IS NULL`).get(w,u);
 const entitled=w=>hasWorkspaceEntitlement(db,config,w,'zalo_oa',clock);
 const manager=(w,u)=>{const m=membership(w,u);return m?.member_type==='member'&&['owner','admin'].includes(m.role);};
 const connected=c=>c?.status==='active'&&manager(c.workspace_id,c.authorized_by)&&entitled(c.workspace_id)&&!!transport;
 const active=c=>connected(c)&&transport.canSend!==false&&!outboundSendersPaused(db);
 const admin=(req,write=false)=>{if(!req.auth)fail(401,'Cần đăng nhập.');if(!manager(req.auth.workspaceId,req.auth.userId))fail(403,'Chỉ owner/admin được quản lý OA.');if(write){ensureWritable(req);if(!entitled(req.auth.workspaceId))fail(403,'Gói hiện tại không có Zalo OA.');}return conn(req.auth.workspaceId);};
 const ready=(c,send=false)=>{if(!(send?active(c):connected(c)))fail(409,'OA chưa sẵn sàng hoặc sender đang dừng.');};
 const template=(c,id)=>db.prepare('SELECT * FROM zalo_oa_templates WHERE connection_id=? AND template_id=?').get(c.id,id);
 const recipient=(c,id)=>db.prepare('SELECT * FROM zalo_oa_recipients WHERE connection_id=? AND id=?').get(c.id,id);
 function source(c,actor,kind,id,recipientRow,purpose) {
  const m=membership(c.workspace_id,actor);if(!m||m.member_type!=='member')fail(403,'Người gửi không còn quyền.');
  if(kind==='task') {
   const task=db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(id,c.workspace_id);
   if(!task||!canAccessTask(db,c.workspace_id,actor,task,{write:true})||task.status==='done')fail(403,'Task không còn hợp lệ để gửi.');
   if(purpose!=='internal'||!recipientRow.user_id||!membership(c.workspace_id,recipientRow.user_id)||!canAccessTask(db,c.workspace_id,recipientRow.user_id,task))fail(403,'Thông báo task cần người nhận nội bộ có quyền.');
   const assigned=task.assignee_id===recipientRow.user_id||db.prepare('SELECT 1 FROM task_assignees WHERE task_id=? AND user_id=?').get(id,recipientRow.user_id);
   if(!assigned)fail(403,'Người nhận không còn được giao công việc.');
   const response=db.prepare('SELECT * FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(id,recipientRow.user_id);
   if(response?.acknowledged_at||response?.snoozed_until&&response.snoozed_until>now())fail(409,'Công việc đã xác nhận hoặc đang hoãn.');
   const cycle=db.prepare('SELECT id FROM task_assignment_cycles WHERE task_id=? AND user_id=? AND closed_at IS NULL ORDER BY started_at DESC LIMIT 1').get(id,recipientRow.user_id)?.id;
   return {kind,id,cycle:cycle||digest([task.due_at,task.created_at,recipientRow.user_id]),title:task.title,dueAt:task.due_at,assignees:db.prepare('SELECT user_id FROM task_assignees WHERE task_id=? ORDER BY user_id').all(id).map(r=>r.user_id),assigneeId:task.assignee_id};
  }
  if(kind!=='service')fail(400,'Nguồn gửi không hợp lệ.');
  const service=db.prepare('SELECT * FROM service_contracts WHERE id=? AND workspace_id=? AND archived_at IS NULL AND enabled=1').get(id,c.workspace_id);
  if(!service||!canAccessTeamTask(db,c.workspace_id,actor,service.team_id,{write:true})||!service.customer_id||recipientRow.customer_id!==service.customer_id)fail(403,'Dịch vụ/người nhận không còn hợp lệ.');
  const today=new Date(Date.parse(now())+7*3600000).toISOString().slice(0,10);
  if(!['transactional','customer_care','promotional'].includes(purpose)||purpose==='customer_care'&&service.next_date<today)fail(400,'Sau hết hạn cần mục đích được provider cho phép; không tự dùng chăm sóc.');
  return {kind,id,cycle:service.next_date,title:service.name,nextDate:service.next_date,customerId:service.customer_id};
 }
 function prepare(c,actor,b) {
  ready(c);if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Nội dung yêu cầu không hợp lệ.');const t=template(c,b.templateId),r=recipient(c,b.recipientId);
  if(!t||t.status!=='approved'||t.purpose!==b.purpose)fail(400,'Mẫu chưa được duyệt/không đúng mục đích.');
  if(!r||r.opted_out)fail(400,'Người nhận không hợp lệ hoặc đã từ chối.');
  const eligibility=decode(r.eligibility_json),definition=decode(t.definition_json);
  if(!eligibility.purposes?.includes(b.purpose)||!eligibility.evidenceId||!eligibility.expiresAt||eligibility.expiresAt<=now())fail(400,'Thiếu điều kiện người nhận còn hiệu lực.');
  const s=source(c,actor,b.sourceKind,b.sourceId,r,b.purpose),params=b.parameters;
  if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length!==definition.parameters.length||definition.parameters.some(key=>!text(params[key],500)))fail(400,'Tham số không khớp mẫu được duyệt.');
  if((b.cta||null)!==(definition.cta||null))fail(400,'CTA không khớp mẫu được duyệt.');
  const payload={oaId:c.oa_id,recipient:r.recipient_key,templateId:t.template_id,version:t.version,purpose:t.purpose,parameters:params,cta:definition.cta||null};
  return {payload,source:s,recipient:r,template:t,previewHash:digest([c.generation,payload,s])};
 }
 const publicConnection=c=>c?{id:c.id,oaId:c.oa_id,status:c.status,contract:decode(c.contract_json),senderReady:active(c)}:null;
 const choices=req=>({
  tasks:db.prepare('SELECT * FROM tasks WHERE workspace_id=? AND deleted_at IS NULL AND status<>? ORDER BY updated_at DESC LIMIT 200').all(req.auth.workspaceId,'done').filter(t=>canAccessTask(db,req.auth.workspaceId,req.auth.userId,t,{write:true})).map(t=>({id:t.id,label:t.title})),
  services:db.prepare('SELECT * FROM service_contracts WHERE workspace_id=? AND archived_at IS NULL AND enabled=1 ORDER BY updated_at DESC LIMIT 200').all(req.auth.workspaceId).filter(s=>canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,s.team_id,{write:true})).map(s=>({id:s.id,label:s.name})),
  members:db.prepare("SELECT u.id,u.name AS label FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND wm.member_type='member' AND u.disabled_at IS NULL ORDER BY u.name LIMIT 200").all(req.auth.workspaceId),
  customers:db.prepare('SELECT id,name AS label FROM customers WHERE workspace_id=? AND deleted_at IS NULL ORDER BY name LIMIT 200').all(req.auth.workspaceId),
 });
 const safeDelivery=d=>({id:d.id,sourceKind:d.source_kind,sourceId:d.source_id,cycle:d.cycle,purpose:d.purpose,status:d.status,attempts:d.attempts,providerMessageId:d.provider_message_id,error:d.last_error,nextAttemptAt:d.next_attempt_at,createdAt:d.created_at});
 function verifyDelivery(d) {
  const c=conn(d.workspace_id);ready(c,true);if(c.id!==d.connection_id||c.generation!==d.generation)fail(409,'Ủy quyền OA đã thay đổi.');
  const payload=decode(d.payload_json);const p=prepare(c,d.actor_id,{sourceKind:d.source_kind,sourceId:d.source_id,templateId:d.template_id,recipientId:d.recipient_id,purpose:d.purpose,parameters:payload.parameters,cta:payload.cta});
  if(encode(p.payload)!==d.payload_json||encode(p.source)!==d.source_json)fail(409,'Nguồn/mẫu đã thay đổi sau preview.');return c;
 }
 function finish(d,lease,status,{messageId=null,error=null,retryAt=null}={}) {
  return withTransaction(db,()=>{
   const current=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=? FOR UPDATE').get(d.id);
   if(current.lease_token!==lease)return false;
   const final=rank[current.status]>(rank[status]||0)?current.status:status;
   db.prepare('UPDATE zalo_oa_deliveries SET status=?,provider_message_id=COALESCE(?,provider_message_id),last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(final,messageId,error,retryAt,now(),d.id);
   db.prepare('UPDATE zalo_oa_attempts SET status=?,provider_reference=?,error_code=?,finished_at=? WHERE delivery_id=? AND attempt=?').run(final,messageId,error,now(),d.id,d.attempts);return true;
  });
 }
 async function runDelivery(id) {
  const lease=randomUUID();let d=withTransaction(db,()=>{
   const row=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=? FOR UPDATE').get(id);
   if(!row||!['pending','retry'].includes(row.status)||row.next_attempt_at&&row.next_attempt_at>now())return null;
   try{verifyDelivery(row);}catch{db.prepare("UPDATE zalo_oa_deliveries SET status='suppressed',last_error='revalidation_failed',updated_at=? WHERE id=?").run(now(),id);return null;}
   db.prepare("UPDATE zalo_oa_deliveries SET status='sending',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease,new Date(Date.parse(now())+120000).toISOString(),now(),id);
   const fresh=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=?').get(id);
   db.prepare('INSERT INTO zalo_oa_attempts(id,delivery_id,attempt,status,started_at) VALUES(?,?,?,?,?)').run(randomUUID(),id,fresh.attempts,'sending',now());return fresh;
  });if(!d)return {skipped:true};
  let sent=false;
  try {
   let c=verifyDelivery(d);
   // Provider contract owns current template/recipient checks; local registry alone
   // never establishes that a recipient is still eligible at send time.
   await transport.validateDelivery(credential(c),decode(d.payload_json));
   c=verifyDelivery(d);
   if(!db.prepare("UPDATE zalo_oa_deliveries SET lease_until=? WHERE id=? AND status='sending' AND lease_token=? AND lease_until>?").run(new Date(Date.parse(now())+120000).toISOString(),d.id,lease,now()).changes)fail(409,'Lease gửi đã hết hiệu lực.');
   sent=true;const result=await transport.send(credential(c),decode(d.payload_json),{requestId:d.id});
   if(!text(result?.messageId))throw {ambiguous:true};
   finish(d,lease,'accepted',{messageId:result.messageId});return {accepted:true};
  } catch(error) {
   const status=Number(error?.status)||0;
   const ambiguous=sent&&(error?.ambiguous||!status||status>=500&&error?.definitivelyNotAccepted!==true);
   if(error instanceof HttpError){finish(d,lease,'suppressed',{error:'revalidation_failed'});return {suppressed:true};}
   if(ambiguous){finish(d,lease,'unknown',{error:'provider_outcome_unknown'});return {unknown:true};}
   const retry=(status===429||!sent&&(!status||status>=500)||status>=500&&error?.definitivelyNotAccepted===true)&&d.attempts<5;
   if(status===401||status===403)db.prepare("UPDATE zalo_oa_connections SET status='revoked',updated_at=? WHERE id=?").run(now(),d.connection_id);
   const seconds=Math.min(86400,Math.max(1,Number(error?.retryAfterSeconds)||Math.min(3600,30*2**(d.attempts-1))));
   finish(d,lease,retry?'retry':'failed',{error:status===429?'provider_rate_limited':status>=500?'provider_temporary_error':status===401||status===403?'provider_authorization_failed':'provider_rejected',retryAt:retry?new Date(Date.parse(now())+seconds*1000).toISOString():null});
   return {retry};
  }
 }
 async function process() {
  if(!transport||outboundSendersPaused(db))return {blocked:true};
  // A crash after claim may have crossed the provider boundary. Never send it blindly.
  withTransaction(db,()=>{
   const expired=db.prepare("SELECT * FROM zalo_oa_deliveries WHERE status='sending' AND lease_until<=? FOR UPDATE").all(now());
   for(const d of expired)finish(d,d.lease_token,'unknown',{error:'worker_lease_expired'});
  });
  const due=db.prepare("SELECT id FROM zalo_oa_deliveries WHERE status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at LIMIT 100").all(now());
  for(const d of due)await runDelivery(d.id);return {processed:due.length};
 }
 app.locals.processZaloOa=process;
 app.get('/api/integrations/zalo-oa',requireAuth,(req,res,next)=>{try{const c=admin(req);res.json({configured:!!transport,realGate:'BLOCKED',options:choices(req),connection:publicConnection(c),templates:c?db.prepare('SELECT template_id AS id,version,status,purpose,definition_json FROM zalo_oa_templates WHERE connection_id=?').all(c.id).map(t=>({...t,definition:decode(t.definition_json),definition_json:undefined})):[],recipients:c?db.prepare('SELECT id,recipient_key AS recipient,user_id AS "userId",customer_id AS "customerId",eligibility_json,opted_out AS "optedOut" FROM zalo_oa_recipients WHERE connection_id=?').all(c.id).map(r=>({...r,eligibility:decode(r.eligibility_json),eligibility_json:undefined})):[],deliveries:c?db.prepare('SELECT * FROM zalo_oa_deliveries WHERE connection_id=? ORDER BY created_at DESC LIMIT 100').all(c.id).map(safeDelivery):[]});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/connect',requireAuth,async(req,res,next)=>{try{
  admin(req,true);const b=req.body||{};if(!transport)fail(503,'Chưa có adapter theo hợp đồng OA đã xác minh; gate gửi thật đang bị chặn.');
  if(!text(b.oaId)||!text(b.token,8192)||b.consent!==true||transport.mode==='live'&&(!text(b.appId)||!text(b.oaSecretKey,8192)))fail(400,'Cần OA, token và xác nhận doanh nghiệp được ủy quyền.');
  const proof=await transport.authorize({oaId:b.oaId,token:b.token});
  if(proof?.oaId!==b.oaId||!text(proof.apiVersion)||!text(proof.policyVersion))fail(403,'Provider chưa xác nhận OA và hợp đồng API.');
  const c=withTransaction(db,()=>{admin(req,true);db.prepare('SELECT id FROM workspaces WHERE id=? FOR UPDATE').get(req.auth.workspaceId);
   const old=conn(req.auth.workspaceId);if(old&&old.oa_id!==b.oaId)fail(409,'Giữ OA cũ để bảo toàn lịch sử; đổi OA cần quy trình chuyển riêng.');if(db.prepare('SELECT 1 FROM zalo_oa_connections WHERE oa_id=? AND workspace_id<>?').get(b.oaId,req.auth.workspaceId))fail(403,'Không thể xác minh quyền sử dụng cấu hình OA.');
   const id=old?.id||randomUUID();const contract={apiVersion:proof.apiVersion,policyVersion:proof.policyVersion,mode:transport.mode==='simulation'?'simulation':'verified_adapter',verifiedAt:now()};
   db.prepare(`INSERT INTO zalo_oa_connections(id,workspace_id,oa_id,authorized_by,status,contract_json,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET oa_id=excluded.oa_id,authorized_by=excluded.authorized_by,status='active',contract_json=excluded.contract_json,generation=zalo_oa_connections.generation+1,updated_at=excluded.updated_at`).run(id,req.auth.workspaceId,b.oaId,req.auth.userId,encode(contract),now(),now());
   writeStoredSetting(db,tokenKey(id),{token:b.token,appId:text(b.appId)?b.appId:null,oaSecretKey:text(b.oaSecretKey,8192)?b.oaSecretKey:null,internalTemplates:{}},{encrypted:true,keyBytes:settingsKey,updatedAt:now()});return conn(req.auth.workspaceId);
  });res.json({connection:publicConnection(c)});
 }catch(e){next(e instanceof HttpError?e:new HttpError(502,'Không thể xác minh ủy quyền OA.'));}});
 app.delete('/api/integrations/zalo-oa',requireAuth,(req,res,next)=>{try{const c=admin(req);if(c)withTransaction(db,()=>{db.prepare("UPDATE zalo_oa_connections SET status='disconnected',generation=generation+1,updated_at=? WHERE id=?").run(now(),c.id);db.prepare('DELETE FROM app_settings WHERE key=?').run(tokenKey(c.id));});res.json({ok:true,providerRevoked:false});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/templates/refresh',requireAuth,async(req,res,next)=>{try{
  const c=admin(req,true);ready(c);const list=await transport.templates(credential(c),c.oa_id);
  if(!Array.isArray(list)||list.length>1000||list.some(t=>!text(t.id)||!text(t.version)||!['approved','pending','rejected','inactive'].includes(t.status)||!purposes.includes(t.purpose)||!Array.isArray(t.parameters)||t.parameters.some(k=>!text(k,80))||new Set(t.parameters).size!==t.parameters.length||t.cta&&(!text(t.cta,2000)||!t.cta.startsWith('https://'))))fail(502,'Danh mục mẫu provider không hợp lệ.');
  withTransaction(db,()=>{admin(req,true);if(conn(c.workspace_id)?.generation!==c.generation)fail(409,'Kết nối đã đổi.');db.prepare("UPDATE zalo_oa_templates SET status='inactive' WHERE connection_id=?").run(c.id);for(const t of list)db.prepare(`INSERT INTO zalo_oa_templates(connection_id,template_id,version,status,purpose,definition_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_id,template_id) DO UPDATE SET version=excluded.version,status=excluded.status,purpose=excluded.purpose,definition_json=excluded.definition_json,updated_at=excluded.updated_at`).run(c.id,t.id,t.version,t.status,t.purpose,encode({parameters:t.parameters,parameterRules:t.parameterRules||[],cta:t.cta||null,label:text(t.label)?t.label:t.id,providerPreviewUrl:t.providerPreviewUrl||null,unsupportedReason:t.unsupportedReason||null,providerTag:t.providerTag||null}),now());});res.json({count:list.length});
 }catch(e){next(e instanceof HttpError?e:new HttpError(502,'Không thể tải mẫu OA.'));}});
 app.post('/api/integrations/zalo-oa/recipients',requireAuth,async(req,res,next)=>{try{
  const c=admin(req,true);ready(c);const b=req.body||{};
  if(!text(b.recipient)||!!b.userId===!!b.customerId)fail(400,'Cần người nhận và đúng một liên kết nhân viên/khách hàng.');
  if(b.userId&&!membership(c.workspace_id,b.userId)||b.customerId&&!db.prepare('SELECT 1 FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(b.customerId,c.workspace_id))fail(403,'Liên kết người nhận ngoài doanh nghiệp.');
  const proof=await transport.recipient(credential(c),{oaId:c.oa_id,recipient:b.recipient,purpose:b.purpose,evidence:b.evidence});
  if(!proof||!Array.isArray(proof.purposes)||proof.purposes.some(p=>!purposes.includes(p))||!text(proof.evidenceId)||!text(proof.expiresAt)||!Number.isFinite(Date.parse(proof.expiresAt))||proof.expiresAt<=now())fail(400,'Provider chưa xác minh điều kiện người nhận.');
  withTransaction(db,()=>{admin(req,true);if(conn(c.workspace_id)?.generation!==c.generation)fail(409,'Kết nối đã đổi.');db.prepare(`INSERT INTO zalo_oa_recipients(id,connection_id,recipient_key,user_id,customer_id,eligibility_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_id,recipient_key) DO UPDATE SET user_id=excluded.user_id,customer_id=excluded.customer_id,eligibility_json=excluded.eligibility_json,updated_at=excluded.updated_at`).run(randomUUID(),c.id,b.recipient,b.userId||null,b.customerId||null,encode({purposes:proof.purposes,evidenceId:proof.evidenceId,expiresAt:new Date(proof.expiresAt).toISOString(),relationship:proof.relationship||null,providerCheck:proof.providerCheck||'simulation'}),now());});res.json({ok:true});
 }catch(e){next(e instanceof HttpError?e:new HttpError(502,'Không thể xác minh người nhận.'));}});
 app.patch('/api/integrations/zalo-oa/recipients/:id',requireAuth,(req,res,next)=>{try{const c=admin(req);if(!c||!recipient(c,req.params.id))fail(404,'Không tìm thấy người nhận.');if(req.body.optedOut!==true)fail(400,'Chỉ hỗ trợ ghi nhận từ chối; đăng ký nhận lại cần bằng chứng mới từ provider.');db.prepare('UPDATE zalo_oa_recipients SET opted_out=1,updated_at=? WHERE id=? AND connection_id=?').run(now(),req.params.id,c.id);res.json({ok:true});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/templates/:id/internal-approval',requireAuth,(req,res,next)=>{try{const c=admin(req,true);ready(c);const t=template(c,req.params.id),b=req.body||{};
  if(!t||t.status!=='approved'||b.expectedVersion!==t.version||!text(b.evidenceId,500)||b.internalLabelPresent!==true)fail(400,'Cần mẫu duyệt hiện tại và bằng chứng nội dung thể hiện Thông báo nội bộ.');
  const value=credential(c);value.internalTemplates={...(value.internalTemplates||{}),[t.template_id]:{version:t.version,evidenceId:b.evidenceId,internalLabelPresent:true}};
  writeStoredSetting(db,tokenKey(c.id),value,{encrypted:true,keyBytes:settingsKey,updatedAt:now()});res.json({ok:true,refreshRequired:true});
 }catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/preview',requireAuth,(req,res,next)=>{try{const c=admin(req,true);const p=prepare(c,req.auth.userId,req.body);res.json({payload:p.payload,source:p.source,previewHash:p.previewHash});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/deliveries',requireAuth,(req,res,next)=>{try{const result=withTransaction(db,()=>{
  const c=admin(req,true);ready(c,true);db.prepare('SELECT id FROM zalo_oa_connections WHERE id=? FOR UPDATE').get(c?.id||'');const p=prepare(c,req.auth.userId,req.body);
  if(req.body.previewHash!==p.previewHash)fail(409,'Preview đã thay đổi; cần xem lại trước khi gửi.');
  const old=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE connection_id=? AND source_kind=? AND source_id=? AND cycle=? AND recipient_id=? AND purpose=?').get(c.id,p.source.kind,p.source.id,p.source.cycle,p.recipient.id,p.payload.purpose);
  if(old){if(old.payload_json!==encode(p.payload))fail(409,'Logical delivery đã tồn tại với payload khác.');return safeDelivery(old);}
  const id=randomUUID();db.prepare(`INSERT INTO zalo_oa_deliveries(id,connection_id,workspace_id,actor_id,source_kind,source_id,cycle,recipient_id,purpose,template_id,generation,payload_json,source_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(id,c.id,c.workspace_id,req.auth.userId,p.source.kind,p.source.id,p.source.cycle,p.recipient.id,p.payload.purpose,p.template.template_id,c.generation,encode(p.payload),encode(p.source),now(),now());return safeDelivery(db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=?').get(id));});res.status(201).json({delivery:result});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/process',requireAuth,async(req,res,next)=>{try{admin(req,true);const c=conn(req.auth.workspaceId);ready(c,true);const due=db.prepare("SELECT id FROM zalo_oa_deliveries WHERE connection_id=? AND status IN ('pending','retry') ORDER BY created_at LIMIT 100").all(c.id);for(const d of due)await runDelivery(d.id);res.json({processed:due.length});}catch(e){next(e);}});
 app.post('/api/integrations/zalo-oa/deliveries/:id/reconcile',requireAuth,async(req,res,next)=>{try{
  const c=admin(req);if(!c||!transport?.lookup)fail(409,'Provider chưa hỗ trợ đối soát.');const d=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=? AND connection_id=?').get(req.params.id,c.id);if(!d||d.status!=='unknown')fail(409,'Chỉ đối soát delivery chưa rõ kết quả.');
  const proof=await transport.lookup(credential(c),{oaId:c.oa_id,requestId:d.id,messageId:d.provider_message_id,recipient:decode(d.payload_json).recipient});
  withTransaction(db,()=>{admin(req);if(conn(c.workspace_id)?.generation!==c.generation)fail(409,'Kết nối đã đổi.');const current=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=? FOR UPDATE').get(d.id);if(current.status!=='unknown')return;
   if(proof&&rank[proof.status]&&text(proof.messageId))db.prepare('UPDATE zalo_oa_deliveries SET status=?,provider_message_id=?,last_error=NULL,updated_at=? WHERE id=?').run(proof.status,proof.messageId,now(),d.id);
   else if(proof?.definitivelyNotAccepted===true&&d.attempts<5&&transport.reliableNegativeLookup===true){verifyDelivery(d);db.prepare("UPDATE zalo_oa_deliveries SET status='retry',next_attempt_at=?,last_error=NULL,updated_at=? WHERE id=?").run(now(),now(),d.id);}
  });res.json({delivery:safeDelivery(db.prepare('SELECT * FROM zalo_oa_deliveries WHERE id=?').get(d.id))});
 }catch(e){next(e instanceof HttpError?e:new HttpError(502,'Chưa đối soát được kết quả OA.'));}});
 app.post('/api/integrations/zalo-oa/callback',async(req,res,next)=>{try{
  if(!transport?.verifyCallback)fail(503,'Chưa cấu hình xác thực callback OA.');
  const verified=await transport.verifyCallback({headers:req.headers,rawBody:req.zaloRawBody}),events=Array.isArray(verified)?verified:[verified];
  if(events.length>100||events.some(event=>!event||!text(event.oaId)||!text(event.eventId)||!text(event.messageId)||!rank[event.status]))fail(403,'Callback OA không hợp lệ.');
  withTransaction(db,()=>{for(const event of events){
   const c=db.prepare('SELECT * FROM zalo_oa_connections WHERE oa_id=?').get(event.oaId);if(!c)fail(403,'OA callback không thuộc kết nối.');
   const d=db.prepare('SELECT * FROM zalo_oa_deliveries WHERE connection_id=? AND (provider_message_id=? OR id=?) FOR UPDATE').get(c.id,event.messageId,event.requestId||'');
   if(!d)continue; // Authenticated events for messages outside this app mapping are acknowledged without a write.
   if(event.recipient&&decode(d.payload_json).recipient!==event.recipient)fail(403,'Người nhận callback không khớp.');
   if(!d||!['sending','unknown','accepted','delivered','read'].includes(d.status)||d.provider_message_id&&d.provider_message_id!==event.messageId)fail(403,'Message callback không khớp.');
   const inserted=db.prepare('INSERT INTO zalo_oa_callbacks(connection_id,event_id,delivery_id,status,received_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').run(c.id,event.eventId,d.id,event.status,now());
   if(inserted.changes&&(rank[event.status]>(rank[d.status]||0)))db.prepare('UPDATE zalo_oa_deliveries SET status=?,provider_message_id=?,last_error=NULL,updated_at=? WHERE id=?').run(event.status,event.messageId,now(),d.id);
  }});res.json({ok:true});
 }catch(e){next(e instanceof HttpError?e:new HttpError(403,'Không xác minh được callback OA.'));}});
}
