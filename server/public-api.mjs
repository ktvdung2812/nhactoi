import {publicOpenApi} from './public-api-contract.mjs';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {createId} from './auth.mjs';
import {withTransaction} from './db.mjs';
import {getProjectAccess,defaultProjectId} from './projects.mjs';
import {taskAccessSql,canAccessTask} from './task-access.mjs';
import {hasWorkspaceEntitlement} from './entitlements.mjs';
import {recordRevision} from './record-revision.mjs';
import {mutationFingerprint} from './task-mutation-pipeline.mjs';

export const API_SCOPES=['projects:read','tasks:read','tasks:write','customers:read','services:read'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const taskJsonKeys=['id','projectId','title','description','status','priority','dueAt','remindAt','assigneeId','recurrence','recurrenceOptions','createdAt','updatedAt','revision'];
const safeTaskJson=task=>Object.fromEntries(taskJsonKeys.map(key=>[key,task[key]??null]));
export function publicTask(row){return {id:row.id,projectId:row.project_id,title:row.title,description:row.description,status:row.status,priority:row.priority,
 dueAt:row.due_at,remindAt:row.remind_at,assigneeId:row.assignee_id,recurrence:row.recurrence,recurrenceOptions:JSON.parse(row.recurrence_options||'{}'),
 createdAt:row.created_at,updatedAt:row.updated_at,revision:recordRevision(row,'task')};}
export function publicApiErrorEnvelope(req,res,next){
 if(!/^\/api\/v1(?:\/|$)/.test(req.path))return next();
  const originalJson=res.json;
  res.json=function(value){if(this.statusCode>=400)value={error:{code:value?.details?.code||({400:'validation_error',401:'invalid_token',403:'forbidden',404:'not_found',409:'conflict',413:'payload_too_large',429:'rate_limited'}[this.statusCode])||'internal_error',message:typeof value?.error==='string'?value.error:'Yêu cầu không thành công.',...(value?.details?.currentRevision?{currentRevision:value.details.currentRevision}:{})}};return originalJson.call(this,value);};
 next();
}
export function registerPublicApi(app,{db,config,clock,settingsKey,requireAuth,ensureWritable,HttpError,writeAdminAudit}){
 if(db.dialect!=='postgres')return;
 app.locals.publicOpenApi=publicOpenApi;
 const now=()=>new Date(clock()).toISOString();
 const fail=(status,message,code)=>{throw new HttpError(status,message,{code:code||({400:'validation_error',401:'invalid_token',403:'forbidden',404:'not_found',409:'conflict',413:'payload_too_large',429:'rate_limited'}[status])});};
 const keys=(body,allowed)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'Payload chứa trường không được hỗ trợ.');};
 const ids=(value)=>{if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||!v||v.length>160)||new Set(value).size!==value.length)fail(400,'Danh sách project không hợp lệ.');return value;};
 const access=(auth,id,write=false)=>getProjectAccess(db,auth.workspaceId,auth.userId,id,{config,clock})?.[write?'canEdit':'canRead'];
 const member=(workspace,user)=>db.prepare(`SELECT wm.role,wm.member_type,u.name,u.email FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND wm.user_id=? AND u.disabled_at IS NULL`).get(workspace,user);
 const permitted=t=>t&&!t.revoked_at&&member(t.workspace_id,t.created_by)&&hasWorkspaceEntitlement(db,config,t.workspace_id,'public_api',clock);
 const safeToken=t=>({id:t.id,name:t.name,scopes:JSON.parse(t.scopes_json),projectIds:JSON.parse(t.projects_json),createdAt:t.created_at,lastUsedAt:t.last_used_at,revokedAt:t.revoked_at});
 const route=(method,path,fn)=>app[method](path,requireAuth,(req,res,next)=>{try{return fn(req,res);}catch(e){next(e);}});
 route('get','/api/api-tokens',(req,res)=>res.json({tokens:db.prepare('SELECT * FROM api_tokens WHERE workspace_id=? AND created_by=? ORDER BY created_at DESC,id').all(req.auth.workspaceId,req.auth.userId).map(safeToken),scopes:API_SCOPES,rateLimit:{requests:120,windowSeconds:60,pageSize:50,maxPageSize:100}}));
 route('post','/api/api-tokens',(req,res)=>{
  ensureWritable(req);if(req.auth.memberType==='guest'||!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'public_api',clock))fail(403,'Gói hiện tại không cấp quyền public API.');
  keys(req.body,['name','scopes','projectIds']);const {name,scopes}=req.body,projects=ids(req.body.projectIds||[]);
  if(typeof name!=='string'||!name.trim()||name.length>120||!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!API_SCOPES.includes(s))||new Set(scopes).size!==scopes.length)fail(400,'Tên hoặc scope token không hợp lệ.');
  if(projects.some(p=>!access(req.auth,p,scopes.includes('tasks:write'))))fail(403,'Token không được cấp quyền ngoài phạm vi của bạn.');
  if(projects.length&&scopes.some(s=>['customers:read','services:read'].includes(s)))fail(400,'Scope khách hàng/dịch vụ cần token phạm vi doanh nghiệp riêng.');
  const raw='nt_api_'+randomBytes(32).toString('base64url'),id=createId('apit_'),at=now();
  withTransaction(db,()=>{db.prepare('INSERT INTO api_tokens(id,workspace_id,created_by,name,token_hash,scopes_json,projects_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,req.auth.userId,name.trim(),digest(raw),JSON.stringify(scopes),JSON.stringify(projects),at);
   writeAdminAudit(db,{actorUserId:req.auth.userId,action:'api_token.created',targetType:'api_token',targetId:id,reason:'Người dùng tạo API token',after:{scopes,projectIds:projects},createdAt:now()});});
  res.status(201).json({token:safeToken(db.prepare('SELECT * FROM api_tokens WHERE id=?').get(id)),rawToken:raw});
 });
 route('delete','/api/api-tokens/:id',(req,res)=>{
  const t=db.prepare('SELECT * FROM api_tokens WHERE id=? AND workspace_id=? AND created_by=?').get(req.params.id,req.auth.workspaceId,req.auth.userId);if(!t)fail(404,'Không tìm thấy token.');
  withTransaction(db,()=>{db.prepare('UPDATE api_tokens SET revoked_at=coalesce(revoked_at,?) WHERE id=?').run(now(),t.id);writeAdminAudit(db,{actorUserId:req.auth.userId,action:'api_token.revoked',targetType:'api_token',targetId:t.id,reason:'Người dùng thu hồi API token',createdAt:now()});});res.json({ok:true});
 });
 app.use((req,res,next)=>{
  if(!/^\/api\/v1(?:\/|$)/.test(req.path))return next();
  try{
   if(req.path==='/api/v1/openapi.json'&&req.method==='GET')return res.json(app.locals.publicOpenApi);
   const raw=/^Bearer (nt_api_[A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'')?.[1];
   const token=raw&&db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(digest(raw));
   if(!token||token.revoked_at||!member(token.workspace_id,token.created_by))fail(401,'Token không hợp lệ hoặc đã bị thu hồi.');
   if(!permitted(token))fail(403,'Gói hoặc quyền doanh nghiệp không còn cho phép public API.');
   const creator=member(token.workspace_id,token.created_by),scopes=JSON.parse(token.scopes_json),projects=JSON.parse(token.projects_json);
   req.auth={userId:token.created_by,workspaceId:token.workspace_id,role:creator.role,memberType:creator.member_type,sessionKind:'public_api'};req.mobileToken=null;req.publicApi={id:token.id,scopes,projects};
   const enforceProject=(id,write=false)=>{if((projects.length&&!projects.includes(id))||!access(req.auth,id,write))fail(404,'Không tìm thấy project hoặc task.');};
   req.authorizePublicMutation=task=>{const current=db.prepare('SELECT * FROM api_tokens WHERE id=? FOR SHARE').get(token.id);if(!permitted(current))fail(403,'Quyền API đã thay đổi.');if(task)enforceProject(task.project_id,true);else if(req.path==='/api/tasks')enforceProject(req.body?.projectId||defaultProjectId(token.workspace_id),true);};
   const stamp=new Date(clock()).getTime(),bucket=`public-api:${token.id}:${Math.floor(stamp/60000)}`;
   const count=db.prepare(`INSERT INTO auth_request_limits(bucket,expires_at,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=auth_request_limits.count+1 RETURNING count`).get(bucket,(Math.floor(stamp/60000)+1)*60000).count;
   res.set('X-RateLimit-Limit','120');res.set('X-RateLimit-Remaining',String(Math.max(0,120-count)));
   if(count>120){res.set('Retry-After',String(60-Math.floor(stamp/1000)%60));fail(429,'Vượt giới hạn 120 yêu cầu/phút.');}
   db.prepare('DELETE FROM auth_request_limits WHERE expires_at<?').run(stamp-60000);
   db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(now(),token.id);
   const path=req.path.slice('/api/v1'.length),write=!['GET','HEAD'].includes(req.method);
   const requireScope=scope=>{if(!scopes.includes(scope))fail(403,'Token thiếu scope '+scope);};
   const query=req.query;
   if(req.method==='GET'&&['/tasks','/projects','/customers','/services'].includes(path)){
    const kind=path.slice(1);requireScope(kind+':read');
    if(['customers','services'].includes(kind)&&(creator.member_type==='guest'||projects.length))fail(403,'Không có quyền dữ liệu doanh nghiệp.');
    const allowed=kind==='tasks'?['limit','cursor','projectId','status','priority','q','sort']:['limit','cursor'];
    if(Object.keys(query).some(k=>!allowed.includes(k))||Object.values(query).some(v=>typeof v!=='string'))fail(400,'Bộ lọc không hợp lệ.');
    const limit=query.limit===undefined?50:Number(query.limit);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'limit phải từ 1 đến 100.');
    const sort=query.sort||'createdAt',column={createdAt:'created_at','-createdAt':'created_at',updatedAt:'updated_at','-updatedAt':'updated_at',title:'title','-title':'title'}[sort];
    if(!column)fail(400,'sort không hợp lệ.');const desc=sort.startsWith('-'),direction=desc?'DESC':'ASC',op=desc?'<':'>';
    const binding=mutationFingerprint({id:token.id,path,query:{...query,cursor:undefined,limit:undefined},projects,scopes});
    let last=null;if(query.cursor){const parts=query.cursor.split('.');if(parts.length!==2||parts[0].length>2000||!/^[a-f0-9]{64}$/.test(parts[1]))fail(400,'Cursor không hợp lệ.');const mac=createHmac('sha256',settingsKey).update(parts[0]).digest();if(!timingSafeEqual(mac,Buffer.from(parts[1],'hex')))fail(400,'Cursor không hợp lệ.');try{last=JSON.parse(Buffer.from(parts[0],'base64url'));}catch{fail(400,'Cursor không hợp lệ.');}if(last.binding!==binding||typeof last.id!=='string'||typeof last.value!=='string')fail(400,'Cursor thuộc phạm vi hoặc bộ lọc khác.');}
    let table,where=['t.workspace_id=?'],values=[token.workspace_id],select='t.*',map,orderColumn=column;
    if(kind==='tasks'){
     table='tasks';where.push('t.deleted_at IS NULL',taskAccessSql('t'));values.push(token.created_by);
     if(projects.length){where.push(`t.project_id IN (${projects.map(()=>'?').join(',')})`);values.push(...projects);}
     for(const [key,col,allowedValues] of [['projectId','project_id',null],['status','status',['todo','doing','done']],['priority','priority',['low','medium','high']]])if(query[key]){if(allowedValues&&!allowedValues.includes(query[key]))fail(400,'Bộ lọc không hợp lệ.');where.push(`t.${col}=?`);values.push(query[key]);}
     if(query.q){if(query.q.length>200)fail(400,'Từ khóa quá dài.');where.push('t.title ILIKE ?');values.push('%'+query.q.replace(/[\\%_]/g,'\\$&')+'%');}map=publicTask;
    }else if(kind==='projects'){
     table='projects';where.push(taskAccessSql('acl'));select='t.*';
     // Reuse the project predicate through a fixed relational alias.
     table='projects t CROSS JOIN LATERAL (SELECT t.id project_id,t.workspace_id) acl';values.push(token.created_by);
     if(projects.length){where.push(`t.id IN (${projects.map(()=>'?').join(',')})`);values.push(...projects);}
     map=row=>({id:row.id,name:row.name,description:row.description,accessMode:row.access_mode,teamId:row.team_id,archivedAt:row.archived_at});
    }else if(kind==='customers'){
     table='customers';where.push('t.deleted_at IS NULL');map=r=>({id:r.id,name:r.name,company:r.company});
    }else{
     table='service_contracts';where.push('t.archived_at IS NULL',`(t.team_id IS NULL OR ? IN ('owner','admin') OR EXISTS(SELECT 1 FROM team_members tm WHERE tm.workspace_id=t.workspace_id AND tm.team_id=t.team_id AND tm.user_id=?))`);values.push(creator.role,token.created_by);map=r=>({id:r.id,name:r.name,provider:r.provider,nextDate:r.next_date,cycle:r.cycle});
    }
    const from=kind==='projects'?table:table+' t',countValues=[...values],countWhere=where.join(' AND ');
    if(last){where.push(`(t.${orderColumn},t.id) ${op} (?,?)`);values.push(last.value,last.id);}
    const rows=db.prepare(`SELECT ${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY t.${orderColumn} ${direction},t.id ${direction} LIMIT ?`).all(...values,limit+1),more=rows.length>limit;if(more)rows.pop();
    let cursor=null;if(more){const row=rows.at(-1),encoded=Buffer.from(JSON.stringify({binding,id:row.id,value:row[orderColumn]})).toString('base64url');cursor=encoded+'.'+createHmac('sha256',settingsKey).update(encoded).digest('hex');}
    return res.json({data:rows.map(map),nextCursor:cursor,total:Number(db.prepare(`SELECT count(*) n FROM ${from} WHERE ${countWhere}`).get(...countValues).n)});
   }
   let target,bodyKeys=[],taskId;
   let m=/^\/tasks\/([^/]+)(.*)$/.exec(path);
   if(path==='/tasks'&&req.method==='POST'){requireScope('tasks:write');enforceProject(req.body?.projectId||defaultProjectId(token.workspace_id),true);target='/api/tasks';bodyKeys=['title','description','status','priority','dueAt','remindAt','assigneeId','projectId','category','recurrence','recurrenceOptions','columnId'];}
   else if(m){taskId=m[1];const suffix=m[2];requireScope(write?'tasks:write':'tasks:read');
    const task=db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(taskId,token.workspace_id);if(!task||(task.deleted_at&&req.method!=='DELETE'))fail(404,'Không tìm thấy task.');enforceProject(task.project_id,write);
    if(!suffix&&['GET','PATCH','DELETE'].includes(req.method)){target='/api/tasks/'+taskId;bodyKeys=['title','description','status','priority','dueAt','remindAt','assigneeId','category','recurrence','recurrenceOptions','columnId'];}
    else if(suffix==='/checklists'&&req.method==='GET'){
     const checklists=db.prepare('SELECT id,title,position FROM task_checklists WHERE task_id=? ORDER BY position,id').all(task.id);
     const items=db.prepare('SELECT i.* FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE c.task_id=? ORDER BY i.position,i.id').all(task.id);
     return res.json({checklists:checklists.map(c=>({...c,items:items.filter(i=>i.checklist_id===c.id).map(i=>({id:i.id,title:i.title,completed:!!i.completed,startAt:i.start_at,dueAt:i.due_at,remindAt:i.remind_at,position:i.position}))})),revision:recordRevision(task,'task')});
    }else if(/^\/checklists(?:\/[^/]+(?:\/items(?:\/[^/]+)?)?)?$/.test(suffix)&&['POST','PATCH','DELETE'].includes(req.method)){target='/api/tasks/'+taskId+suffix;bodyKeys=suffix.includes('/items/')?['title','completed','startAt','dueAt','remindAt']:['title'];}
    else if(suffix==='/labels'&&['GET','PUT'].includes(req.method)){
     const labels=db.prepare('SELECT l.id,l.name,l.color,l.project_id AS "projectId" FROM task_labels l JOIN task_label_links x ON x.label_id=l.id WHERE x.task_id=? AND l.workspace_id=?').all(task.id,token.workspace_id);
     if(!write)return res.json({labels,revision:recordRevision(task,'task')});
     target='/api/tasks/'+taskId+'/extras';bodyKeys=['labelIds'];
    }else if(suffix==='/fields'&&['GET','PUT','DELETE'].includes(req.method)){target='/api/tasks/'+taskId+'/fields';bodyKeys=['values'];}
    else fail(404,'Endpoint không thuộc API v1.');
   }else if((m=/^\/projects\/([^/]+)(\/fields)?$/.exec(path))&&req.method==='GET'){requireScope('projects:read');enforceProject(m[1]);target='/api/projects/'+m[1]+(m[2]||'');}
   else if(path==='/labels'&&req.method==='GET'){requireScope('tasks:read');if(typeof query.projectId!=='string')fail(400,'Cần projectId khi đọc nhãn.');enforceProject(query.projectId);target='/api/task-labels';}
   else if((m=/^\/(customers|services)\/([^/]+)$/.exec(path))&&req.method==='GET'){
    requireScope(m[1]+':read');if(creator.member_type==='guest'||projects.length)fail(403,'Không có quyền dữ liệu doanh nghiệp.');
    const r=db.prepare(`SELECT * FROM ${m[1]==='customers'?'customers':'service_contracts'} WHERE id=? AND workspace_id=?`).get(m[2],token.workspace_id);
    if(!r||r.deleted_at||r.archived_at||(r.team_id&&!['owner','admin'].includes(creator.role)&&!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND workspace_id=? AND user_id=?').get(r.team_id,token.workspace_id,token.created_by)))fail(404,'Không tìm thấy dữ liệu.');
    return res.json({data:m[1]==='customers'?{id:r.id,name:r.name,company:r.company}:{id:r.id,name:r.name,provider:r.provider,nextDate:r.next_date,cycle:r.cycle}});
   }else fail(404,'Endpoint không thuộc API v1.');
   if(write){
    keys(req.body||{},[...bodyKeys,'operationId','expectedRevision']);
    if(!req.get('Idempotency-Key')&&!req.body?.operationId)fail(400,'Mutation yêu cầu Idempotency-Key hoặc operationId.');
    if(taskId&&(typeof req.body?.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(req.body.expectedRevision)))fail(400,'Mutation yêu cầu expectedRevision đã đọc.');
    for(const field of (path.includes('/items/')?['remindAt']:['dueAt','remindAt']))if(req.body?.[field]!=null&&req.body[field]!==''&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(req.body[field]))fail(400,field+' cần ISO timestamp có timezone.');
    req.publicPayload={...req.body};delete req.publicPayload.operationId;
    if(path.endsWith('/labels'))req.body={...req.body,assigneeIds:db.prepare('SELECT user_id FROM task_assignees WHERE task_id=? ORDER BY user_id').all(taskId).map(r=>r.user_id)};
   }else if(Object.keys(query).some(k=>!(path==='/labels'&&k==='projectId')))fail(400,'Query không được hỗ trợ.');
   const apiJson=res.json;res.json=function(value){if(this.statusCode<400){
    if(value?.project)value={project:Object.fromEntries(['id','name','description','accessMode','teamId','archivedAt'].map(key=>[key,value.project[key]??null]))};
    if(value?.task)value={...value,task:safeTaskJson(value.task)};
    if(value?.nextTask)value={...value,nextTask:safeTaskJson(value.nextTask)};
    if(path.endsWith('/labels')&&write)value={labels:value.labels,revision:value.taskRevision};
    if(write)value={...value,operationId:req.get('Idempotency-Key')||req.body?.operationId,revision:value.taskRevision||value.revision||value.task?.revision};
   }return apiJson.call(this,value);};
   req.url=target+(path==='/labels'?'?projectId='+encodeURIComponent(query.projectId):'');return next();
  }catch(error){next(error);}
 });
}
