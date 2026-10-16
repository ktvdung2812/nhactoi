import { createId } from './auth.mjs';
import { getProjectAccess } from './projects.mjs';
import { hasWorkspaceEntitlement } from './entitlements.mjs';
import { recordRevision, assertRevision } from './record-revision.mjs';
import { mutationFingerprint, withMutationContext } from './task-mutation-pipeline.mjs';
import { addCalendarDays, calendarDaysBetween } from '../shared/service-renewal.mjs';
import { importDate } from '../shared/data-import.mjs';

export const PROJECT_ADVANCED_COLUMNS = {
  project_fields: ['id','workspace_id','project_id','name','type','position','options_json','retired_at','created_at','updated_at'],
  task_field_values: ['task_id','field_id','workspace_id','project_id','value_json'],
  project_views: ['id','workspace_id','project_id','owner_id','name','visibility','config_json','created_at','updated_at'],
  task_dependencies: ['workspace_id','project_id','predecessor_id','successor_id','created_at'],
  project_templates: ['id','workspace_id','source_project_id','name','payload_json','created_by','created_at'],
};
const TYPES = new Set(['text','number','date','single','multiple','checkbox']);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const fieldJson = row => ({ id: row.id, name: row.name, type: row.type, position: row.position, options: JSON.parse(row.options_json), retiredAt: row.retired_at });
const viewJson = row => ({ id:row.id,name:row.name,ownerId:row.owner_id,visibility:row.visibility,config:JSON.parse(row.config_json) });

export function validateProjectFieldValue(field,value,{oldValue,fail=message=>{throw new Error(message);}}={}) {
    if(field.retired_at&&JSON.stringify(value)!==oldValue)fail('Trường đã ngừng sử dụng');
    if(value===null)return value;
    const options=JSON.parse(field.options_json);
    const choice=id=>typeof id==='string'&&options.some(o=>o.id===id&&(!o.retired||oldValue!==undefined&&([JSON.parse(oldValue)].flat().includes(id))));
    const valid={text:()=>typeof value==='string'&&!value.includes('\0')&&value.length<=5000,number:()=>typeof value==='number'&&Number.isFinite(value),date:()=>day(value),checkbox:()=>typeof value==='boolean',single:()=>choice(value),multiple:()=>Array.isArray(value)&&value.length<=100&&new Set(value).size===value.length&&value.every(choice)}[field.type];
    if(!valid())fail(`Giá trị không hợp lệ: ${field.name}`);
    return value;
  }

export function registerProjectAdvancedRoutes(app, { db, clock, config, requireAuth, ensureWritable, HttpError, withTransaction, taskJson }) {
  if (db.dialect !== 'postgres') return;
  const fail = (status,message,details) => { throw new HttpError(status,message,details); };
  const now = () => new Date(clock()).toISOString();
  const body = (value,allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) fail(400,'Dữ liệu có trường không hợp lệ');
    return value;
  };
  const text = (value,max=120) => { if(typeof value!=='string'||value.includes('\0')||!value.trim()||value.trim().length>max)fail(400,'Nội dung không hợp lệ');return value.trim(); };
  const timestamp=value=>{if(typeof value!=='string'||!value.trim())fail(400,'Cần ngày giờ có múi giờ');try{return importDate(value);}catch{fail(400,'Ngày giờ không hợp lệ hoặc thiếu múi giờ');}};
  const access = (req,id=req.params.id,action='read',entitlement) => {
    const result = getProjectAccess(db,req.auth.workspaceId,req.auth.userId,id,{clock,config});
    if (!result) fail(404,'Không tìm thấy dự án');
    if (action!=='read') {
      ensureWritable(req);
      if (!(action==='manage'?result.canManage:result.canEdit)) fail(403,'Không có quyền thay đổi dự án');
      if(entitlement&&!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,entitlement,clock)) fail(403,'Gói hiện tại không cho ghi chức năng này');
    }
    return result;
  };
  const task = (req,action='read',entitlement) => {
    const row=db.prepare('SELECT * FROM tasks WHERE workspace_id=? AND id=? AND deleted_at IS NULL'+(action==='read'?'':' FOR UPDATE')).get(req.auth.workspaceId,req.params.taskId);
    if(!row)fail(404,'Không tìm thấy công việc');
    access(req,row.project_id,action,entitlement);
    return row;
  };
  const mutation=(req,fn)=>withTransaction(db,()=>withMutationContext(db,{actorUserId:req.auth.userId,source:req.mobileToken?'android':'web',occurredAt:now()},fn));
  const route=(method,path,fn)=>app[method](path,requireAuth,(req,res,next)=>{try{fn(req,res);}catch(error){next(error);}});
  const fields = (projectId,workspaceId) => db.prepare('SELECT * FROM project_fields WHERE project_id=? AND workspace_id=? ORDER BY position,id').all(projectId,workspaceId);
  function fieldDefinition(value,old) {
    body(value,['name','type','position','options','retired']);
    const type=value.type??old?.type;
    if(!TYPES.has(type))fail(400,'Kiểu trường không hợp lệ');
    if(old&&type!==old.type&&db.prepare('SELECT 1 FROM task_field_values WHERE field_id=? LIMIT 1').get(old.id))fail(409,'Không đổi kiểu trường đã có dữ liệu');
    const position=value.position??old?.position??0;
    if(!Number.isInteger(position)||position<0||position>10000)fail(400,'Thứ tự không hợp lệ');
    if(value.retired!==undefined&&typeof value.retired!=='boolean')fail(400,'Trạng thái trường không hợp lệ');
    const existing=old?JSON.parse(old.options_json):[];
    const options=value.options??existing;
    if(!Array.isArray(options)||options.length>100||(!['single','multiple'].includes(type)&&options.length))fail(400,'Lựa chọn không hợp lệ');
    const ids=new Set();
    const parsed=options.map(option=>{
      body(option,['id','name','retired']);
      if(option.id&&!existing.some(o=>o.id===option.id))fail(400,'ID lựa chọn không thuộc trường');
      const id=option.id||createId('option_');
      if(ids.has(id)||option.retired!==undefined&&typeof option.retired!=='boolean')fail(400,'Lựa chọn trùng hoặc sai trạng thái');
      ids.add(id);return{id,name:text(option.name),retired:Boolean(option.retired)};
    });
    // Omitted choices become retired, so old values keep their stable labels.
    for(const option of existing)if(!ids.has(option.id))parsed.push({...option,retired:true});
    return{name:text(value.name??old?.name),type,position,options:parsed,retiredAt:value.retired===undefined?old?.retired_at??null:value.retired?now():null};
  }
  const validValue=(field,value,options={})=>validateProjectFieldValue(field,value,{...options,fail:message=>fail(400,message)});
  route('get','/api/projects/:id/fields',(req,res)=>{access(req);res.json({fields:fields(req.params.id,req.auth.workspaceId).map(fieldJson)});});
  route('post','/api/projects/:id/fields',(req,res)=>mutation(req,()=>{
    access(req,req.params.id,'manage','custom_fields');
    const data=fieldDefinition(req.body),id=createId('field_'),at=now();
    db.prepare('INSERT INTO project_fields(id,workspace_id,project_id,name,type,position,options_json,retired_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,req.params.id,data.name,data.type,data.position,JSON.stringify(data.options),data.retiredAt,at,at);
    res.status(201).json({field:fieldJson(db.prepare('SELECT * FROM project_fields WHERE id=?').get(id))});
  }));
  route('patch','/api/projects/:id/fields/:fieldId',(req,res)=>mutation(req,()=>{
    access(req,req.params.id,'manage','custom_fields');
    const old=db.prepare('SELECT * FROM project_fields WHERE id=? AND project_id=? AND workspace_id=? FOR UPDATE').get(req.params.fieldId,req.params.id,req.auth.workspaceId);
    if(!old)fail(404,'Không tìm thấy trường');
    const data=fieldDefinition(req.body,old);
    db.prepare('UPDATE project_fields SET name=?,type=?,position=?,options_json=?,retired_at=?,updated_at=? WHERE id=?').run(data.name,data.type,data.position,JSON.stringify(data.options),data.retiredAt,now(),old.id);
    res.json({field:fieldJson(db.prepare('SELECT * FROM project_fields WHERE id=?').get(old.id))});
  }));
  route('get','/api/tasks/:taskId/fields',(req,res)=>{
    const row=task(req);
    res.json({revision:recordRevision(row,'task'),fields:fields(row.project_id,row.workspace_id).map(fieldJson),values:Object.fromEntries(db.prepare('SELECT field_id,value_json FROM task_field_values WHERE task_id=? AND workspace_id=?').all(row.id,row.workspace_id).map(v=>[v.field_id,JSON.parse(v.value_json)]))});
  });
  route('put','/api/tasks/:taskId/fields',(req,res)=>mutation(req,()=>{
    const row=task(req,'write','custom_fields');body(req.body,['values','expectedRevision']);assertRevision(req.body,row,'task',HttpError);
    const values=req.body.values;
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>100)fail(400,'Giá trị trường không hợp lệ');
    const definitions=new Map(db.prepare('SELECT * FROM project_fields WHERE project_id=? AND workspace_id=? FOR SHARE').all(row.project_id,row.workspace_id).map(f=>[f.id,f]));
    for(const [id,value] of Object.entries(values)){
      const f=definitions.get(id);if(!f)fail(400,'Trường không thuộc dự án');
      const old=db.prepare('SELECT value_json FROM task_field_values WHERE task_id=? AND field_id=?').get(row.id,id);
      validValue(f,value,{oldValue:old?.value_json});
      db.prepare('INSERT INTO task_field_values(task_id,field_id,workspace_id,project_id,value_json) VALUES (?,?,?,?,?) ON CONFLICT(task_id,field_id) DO UPDATE SET value_json=excluded.value_json').run(row.id,id,row.workspace_id,row.project_id,JSON.stringify(value));
    }
    res.json({revision:recordRevision(db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id),'task'),values:Object.fromEntries(db.prepare('SELECT field_id,value_json FROM task_field_values WHERE task_id=?').all(row.id).map(v=>[v.field_id,JSON.parse(v.value_json)]))});
  }));
  route('delete','/api/tasks/:taskId/fields',(req,res)=>mutation(req,()=>{
    const row=task(req,'write','custom_fields');body(req.body||{},['expectedRevision']);assertRevision(req.body,row,'task',HttpError);
    db.prepare('DELETE FROM task_field_values WHERE task_id=? AND workspace_id=?').run(row.id,row.workspace_id);
    res.json({values:{},revision:recordRevision(db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id),'task')});
  }));

  function viewConfig(req,projectId,value) {
    body(value,['layout','status','assigneeId','filters','sort']);
    const layout=value.layout||'list';if(!['list','kanban','calendar','timeline'].includes(layout))fail(400,'Chế độ xem không hợp lệ');
    if(value.status!==undefined&&!['todo','doing','done'].includes(value.status))fail(400,'Trạng thái không hợp lệ');
    if(value.assigneeId&&!getProjectAccess(db,req.auth.workspaceId,value.assigneeId,projectId,{clock,config}))fail(400,'Người trong điều kiện không còn quyền dự án');
    const definitions=new Map(fields(projectId,req.auth.workspaceId).map(f=>[f.id,f]));
    const filters=value.filters||[];if(!Array.isArray(filters)||filters.length>20)fail(400,'Bộ lọc không hợp lệ');
    for(const f of filters){body(f,['fieldId','op','value']);const definition=definitions.get(f.fieldId);if(!definition||definition.retired_at)fail(400,'Trường trong điều kiện không còn hợp lệ');if(!['eq','gt','lt','contains','empty'].includes(f.op))fail(400,'Phép lọc không hợp lệ');if(f.op!=='empty')validValue(definition,f.value);if(['gt','lt'].includes(f.op)&&!['number','date'].includes(definition.type))fail(400,'Kiểu trường không hỗ trợ so sánh');if(f.op==='contains'&&!['text','multiple'].includes(definition.type))fail(400,'Kiểu trường không hỗ trợ chứa');}
    if(value.sort){body(value.sort,['fieldId','direction']);if(!['asc','desc'].includes(value.sort.direction))fail(400,'Thứ tự sắp xếp không hợp lệ');const f=definitions.get(value.sort.fieldId);if(!f||f.retired_at||f.type==='multiple')fail(400,'Trường sắp xếp không còn hợp lệ');}
    return{...value,layout,filters};
  }
  route('get','/api/projects/:id/views',(req,res)=>{access(req);res.json({views:db.prepare("SELECT * FROM project_views WHERE project_id=? AND workspace_id=? AND (visibility='project' OR owner_id=?) ORDER BY name,id").all(req.params.id,req.auth.workspaceId,req.auth.userId).map(row=>{try{return{...viewJson(row),valid:true,config:viewConfig(req,req.params.id,JSON.parse(row.config_json))};}catch(e){return{...viewJson(row),valid:false,error:e.message};}})});});
  for(const method of ['post','patch'])route(method,'/api/projects/:id/views'+(method==='patch'?'/:viewId':''),(req,res)=>mutation(req,()=>{
    const a=access(req);ensureWritable(req);body(req.body,['name','visibility','config']);
    const old=method==='patch'?db.prepare("SELECT * FROM project_views WHERE id=? AND project_id=? AND workspace_id=? AND (visibility='project' OR owner_id=?) FOR UPDATE").get(req.params.viewId,req.params.id,req.auth.workspaceId,req.auth.userId):null;
    if(method==='patch'&&(!old||old.owner_id!==req.auth.userId&&!a.canManage))fail(404,'Không tìm thấy view được quản lý');
    const visibility=req.body.visibility??old?.visibility??'personal';if(!['personal','project'].includes(visibility))fail(400,'Phạm vi view không hợp lệ');
    if((visibility==='project'||old?.visibility==='project')&&!a.canManage)fail(403,'Chỉ quản lý được thay đổi view chung');
    const parsed=viewConfig(req,req.params.id,req.body.config??(old&&JSON.parse(old.config_json))),id=old?.id||createId('view_'),at=now();
    db.prepare('INSERT INTO project_views(id,workspace_id,project_id,owner_id,name,visibility,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,visibility=excluded.visibility,config_json=excluded.config_json,updated_at=excluded.updated_at').run(id,req.auth.workspaceId,req.params.id,old?.owner_id||req.auth.userId,text(req.body.name??old?.name),visibility,JSON.stringify(parsed),old?.created_at||at,at);
    res.status(old?200:201).json({view:viewJson(db.prepare('SELECT * FROM project_views WHERE id=?').get(id))});
  }));
  route('delete','/api/projects/:id/views/:viewId',(req,res)=>mutation(req,()=>{
    const a=access(req);ensureWritable(req);const v=db.prepare("SELECT * FROM project_views WHERE id=? AND project_id=? AND workspace_id=? AND (visibility='project' OR owner_id=?) FOR UPDATE").get(req.params.viewId,req.params.id,req.auth.workspaceId,req.auth.userId);
    if(!v||v.owner_id!==req.auth.userId&&!a.canManage||v.visibility==='project'&&!a.canManage)fail(404,'Không tìm thấy view được quản lý');
    db.prepare('DELETE FROM project_views WHERE id=?').run(v.id);res.json({deleted:true});
  }));
  route('get','/api/projects/:id/tasks',(req,res)=>{
    access(req);let requested={};
    if(req.query.viewId){const v=db.prepare("SELECT * FROM project_views WHERE id=? AND project_id=? AND workspace_id=? AND (visibility='project' OR owner_id=?)").get(req.query.viewId,req.params.id,req.auth.workspaceId,req.auth.userId);if(!v)fail(404,'Không tìm thấy view');requested=JSON.parse(v.config_json);}
    else if(req.query.config){try{requested=JSON.parse(req.query.config);}catch{fail(400,'Cấu hình view không hợp lệ');}}
    const parsed=viewConfig(req,req.params.id,requested),params=[req.params.id,req.auth.workspaceId],where=['t.project_id=?','t.workspace_id=?','t.deleted_at IS NULL'];
    if(parsed.status){where.push('t.status=?');params.push(parsed.status);}
    if(parsed.assigneeId){where.push('(t.assignee_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=?))');params.push(parsed.assigneeId,parsed.assigneeId);}
    if(parsed.layout==='calendar')where.push('(t.due_at IS NOT NULL OR t.start_at IS NOT NULL)');
    const definitions=new Map(fields(req.params.id,req.auth.workspaceId).map(f=>[f.id,f]));
    for(const f of parsed.filters){
      if(f.op==='empty'){where.push("NOT EXISTS(SELECT 1 FROM task_field_values v WHERE v.task_id=t.id AND v.field_id=? AND v.value_json NOT IN ('null','\"\"','[]'))");params.push(f.fieldId);continue;}
      const type=definitions.get(f.fieldId).type,extract=type==='number'?"(v.value_json::jsonb #>> '{}')::numeric":type==='checkbox'?"(v.value_json::jsonb #>> '{}')::boolean":"(v.value_json::jsonb #>> '{}')";
      let expression;
      if(f.op==='eq'){expression='v.value_json::jsonb=?::jsonb';params.push(f.fieldId,JSON.stringify(f.value));}
      else if(f.op==='contains'){expression=type==='multiple'?'v.value_json::jsonb @> ?::jsonb':"position(? in (v.value_json::jsonb #>> '{}'))>0";params.push(f.fieldId,type==='multiple'?JSON.stringify(f.value):f.value);}
      else{expression=`${extract} ${f.op==='gt'?'>':'<'} ?`;params.push(f.fieldId,f.value);}
      where.push(`EXISTS(SELECT 1 FROM task_field_values v WHERE v.task_id=t.id AND v.field_id=? AND ${expression})`);
    }
    let order='t.created_at,t.id';const sortParams=[];
    if(parsed.sort){const type=definitions.get(parsed.sort.fieldId).type;const cast=type==='number'?'::numeric':type==='checkbox'?'::boolean':'';order=`(SELECT (v.value_json::jsonb #>> '{}')${cast} FROM task_field_values v WHERE v.task_id=t.id AND v.field_id=?) ${parsed.sort.direction==='desc'?'DESC':'ASC'} NULLS LAST,t.id`;sortParams.push(parsed.sort.fieldId);}
    const page=Number(req.query.page||1),pageSize=Number(req.query.pageSize||50);if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail(400,'Phân trang không hợp lệ');
    const clause=where.join(' AND '),total=db.prepare(`SELECT count(*) n FROM tasks t WHERE ${clause}`).get(...params).n;
    const rows=db.prepare(`SELECT t.* FROM tasks t WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,...sortParams,pageSize,(page-1)*pageSize);
    const valueRows=rows.length?db.prepare(`SELECT task_id,field_id,value_json FROM task_field_values WHERE workspace_id=? AND project_id=? AND task_id IN (${rows.map(()=>'?').join(',')})`).all(req.auth.workspaceId,req.params.id,...rows.map(r=>r.id)):[];
    const values=new Map(rows.map(r=>[r.id,{}]));for(const v of valueRows)values.get(v.task_id)[v.field_id]=JSON.parse(v.value_json);
    res.json({tasks:rows.map(r=>({...taskJson(r,req.auth),startAt:r.start_at,customValues:values.get(r.id)})),fields:[...definitions.values()].map(fieldJson),page,pageSize,total,config:parsed});
  });

  route('get','/api/projects/:id/dependencies',(req,res)=>{
    access(req);const links=db.prepare('SELECT d.*,p.status predecessor_status,p.deleted_at predecessor_deleted_at FROM task_dependencies d JOIN tasks p ON p.id=d.predecessor_id WHERE d.project_id=? AND d.workspace_id=? ORDER BY d.predecessor_id,d.successor_id').all(req.params.id,req.auth.workspaceId);
    res.json({dependencies:links.map(d=>({predecessorId:d.predecessor_id,successorId:d.successor_id,blocking:d.predecessor_status!=='done'||Boolean(d.predecessor_deleted_at)}))});
  });
  route('post','/api/projects/:id/dependencies',(req,res)=>mutation(req,()=>{
    access(req,req.params.id,'write','dependencies');body(req.body,['predecessorId','successorId']);
    const predecessor=text(req.body.predecessorId,160),successor=text(req.body.successorId,160);
    db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR UPDATE').get(req.params.id,req.auth.workspaceId);
    for(const id of [predecessor,successor])if(!db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=? AND workspace_id=? AND deleted_at IS NULL').get(id,req.params.id,req.auth.workspaceId))fail(400,'Công việc phải cùng dự án');
    if(predecessor===successor)fail(400,'Không thể phụ thuộc chính mình');
    if(db.prepare('SELECT 1 FROM task_dependencies WHERE predecessor_id=? AND successor_id=?').get(predecessor,successor))return res.json({created:false});
    const cycle=db.prepare('WITH RECURSIVE reachable(id) AS (SELECT ?::text UNION SELECT d.successor_id FROM task_dependencies d JOIN reachable r ON d.predecessor_id=r.id WHERE d.project_id=?) SELECT 1 FROM reachable WHERE id=?').get(successor,req.params.id,predecessor);
    if(cycle)fail(409,'Quan hệ tạo chu trình');
    db.prepare('INSERT INTO task_dependencies(workspace_id,project_id,predecessor_id,successor_id,created_at) VALUES (?,?,?,?,?)').run(req.auth.workspaceId,req.params.id,predecessor,successor,now());res.status(201).json({created:true});
  }));
  route('delete','/api/projects/:id/dependencies',(req,res)=>mutation(req,()=>{
    access(req,req.params.id,'write','dependencies');body(req.body,['predecessorId','successorId']);
    db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR UPDATE').get(req.params.id,req.auth.workspaceId);
    db.prepare('DELETE FROM task_dependencies WHERE workspace_id=? AND project_id=? AND predecessor_id=? AND successor_id=?').run(req.auth.workspaceId,req.params.id,req.body.predecessorId,req.body.successorId);res.json({deleted:true});
  }));
  // Only the extra start date is written here. Deadline edits use the shared task
  // PATCH lifecycle, including recurrence anchors, history and reminder validation.
  route('patch','/api/tasks/:taskId/timeline',(req,res)=>mutation(req,()=>{
    const row=task(req,'write','timeline');body(req.body,['startAt','expectedRevision']);assertRevision(req.body,row,'task',HttpError);
    const value=req.body.startAt;
    const start=value===null?null:timestamp(value);if(start&&row.due_at&&Date.parse(start)>Date.parse(row.due_at))fail(400,'Ngày bắt đầu phải trước hạn');
    db.prepare('UPDATE tasks SET start_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(start,now(),row.id,row.workspace_id);
    const updated=db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id);res.json({task:{...taskJson(updated,req.auth),startAt:updated.start_at}});
  }));

  registerTemplates();
  function registerTemplates(){
    const template=(req)=>{const row=db.prepare('SELECT * FROM project_templates WHERE id=? AND workspace_id=?').get(req.params.templateId,req.auth.workspaceId);if(!row)fail(404,'Không tìm thấy mẫu');access(req,row.source_project_id);return row;};
    route('get','/api/project-templates',(req,res)=>{res.json({templates:db.prepare('SELECT * FROM project_templates WHERE workspace_id=? ORDER BY name,id').all(req.auth.workspaceId).filter(t=>getProjectAccess(db,req.auth.workspaceId,req.auth.userId,t.source_project_id,{clock,config})).map(t=>({id:t.id,name:t.name,sourceProjectId:t.source_project_id,createdAt:t.created_at}))});});
    route('post','/api/projects/:id/templates',(req,res)=>mutation(req,()=>{
      const a=access(req,req.params.id,'manage','project_templates');body(req.body,['name','anchorAt']);
      const anchor=iso(req.body.anchorAt),projectId=req.params.id;
      db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR UPDATE').get(projectId,req.auth.workspaceId);
      const tasks=db.prepare('SELECT * FROM tasks WHERE project_id=? AND workspace_id=? AND deleted_at IS NULL ORDER BY board_position,id FOR SHARE').all(projectId,req.auth.workspaceId);
      if(tasks.length>1000)fail(400,'Mẫu tối đa 1000 công việc');
      const taskIds=new Set(tasks.map(t=>t.id));
      const payload={version:1,anchorAt:anchor,description:a.project.description,columns:db.prepare('SELECT id,name,status,tone,position FROM board_columns WHERE project_id=? AND workspace_id=? ORDER BY position,id').all(projectId,req.auth.workspaceId),fields:db.prepare('SELECT * FROM project_fields WHERE project_id=? AND workspace_id=? ORDER BY position,id FOR SHARE').all(projectId,req.auth.workspaceId),labels:db.prepare('SELECT * FROM task_labels WHERE project_id=? AND workspace_id=? FOR SHARE').all(projectId,req.auth.workspaceId),dependencies:db.prepare('SELECT predecessor_id,successor_id FROM task_dependencies WHERE project_id=? AND workspace_id=?').all(projectId,req.auth.workspaceId).filter(d=>taskIds.has(d.predecessor_id)&&taskIds.has(d.successor_id)),tasks:tasks.map(t=>({
        id:t.id,title:t.title,description:t.description,status:t.status,priority:t.priority,columnId:t.column_id,position:t.board_position,category:t.category,recurrence:t.recurrence,recurrenceOptions:t.recurrence_options,
        startAt:t.start_at,dueAt:t.due_at,remindAt:t.remind_at,recurrenceAnchor:t.recurrence_anchor,assigneeId:t.assignee_id,customerId:t.customer_id,
        assignees:db.prepare('SELECT user_id FROM task_assignees WHERE task_id=? ORDER BY position,created_at,user_id').all(t.id).map(r=>r.user_id),
        labels:db.prepare('SELECT label_id FROM task_label_links WHERE task_id=?').all(t.id).map(r=>r.label_id),
        values:db.prepare('SELECT field_id,value_json FROM task_field_values WHERE task_id=?').all(t.id),
        checklists:db.prepare('SELECT * FROM task_checklists WHERE task_id=? ORDER BY position,id').all(t.id).map(c=>({...c,items:db.prepare('SELECT * FROM task_checklist_items WHERE checklist_id=? ORDER BY position,id').all(c.id).map(i=>({...i,assignees:db.prepare('SELECT user_id FROM task_checklist_assignees WHERE item_id=?').all(i.id).map(r=>r.user_id)}))})),
      }))};
      const id=createId('project_template_');db.prepare('INSERT INTO project_templates(id,workspace_id,source_project_id,name,payload_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,projectId,text(req.body.name),JSON.stringify(payload),req.auth.userId,now());
      res.status(201).json({template:{id,name:text(req.body.name),taskCount:tasks.length}});
    }));
    const iso=timestamp;
    function preview(req,t){
      ensureWritable(req);body(req.body,['name','startAt','accessMode','teamId','userMapping','customerMapping','operationId']);
      const membership=db.prepare('SELECT role,member_type FROM workspace_members WHERE workspace_id=? AND user_id=?').get(req.auth.workspaceId,req.auth.userId);
      if(membership?.member_type==='guest'||!['owner','admin'].includes(membership?.role))fail(403,'Chỉ quản trị workspace được tạo dự án từ mẫu');
      if(!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'project_templates',clock))fail(403,'Gói không cho dùng mẫu dự án');
      const source=access(req,t.source_project_id).project;
      const startAt=iso(req.body.startAt),name=text(req.body.name),mode=req.body.accessMode||source.access_mode,teamId=req.body.teamId===undefined?(mode==='team'?source.team_id:null):req.body.teamId||null;
      if(!['workspace','team','private'].includes(mode)||(mode==='team')!==Boolean(teamId))fail(400,'Phạm vi dự án không hợp lệ');
      if(mode==='private'&&!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'projects.private',clock))fail(403,'Gói không cho tạo dự án riêng tư');
      if(teamId&&!db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(teamId,req.auth.workspaceId))fail(400,'Team không hợp lệ');
      const payload=JSON.parse(t.payload_json),userMapping=req.body.userMapping||{},customerMapping=req.body.customerMapping||{};
      body(userMapping,Object.keys(userMapping));body(customerMapping,Object.keys(customerMapping));
      const invalid=[];const users=new Set(payload.tasks.flatMap(t=>[t.assigneeId,...t.assignees,...t.checklists.flatMap(c=>c.items.flatMap(i=>i.assignees))]).filter(Boolean));
      const customers=new Set(payload.tasks.map(t=>t.customerId).filter(Boolean));
      const mapped=(map,id)=>Object.hasOwn(map,id)?map[id]:id;
      for(const id of users){const target=mapped(userMapping,id);if(target===null)continue;const m=typeof target==='string'?db.prepare('SELECT wm.* FROM workspace_members wm JOIN users u ON u.id=wm.user_id AND u.disabled_at IS NULL WHERE wm.workspace_id=? AND wm.user_id=?').get(req.auth.workspaceId,target):null;const admin=m&&['owner','admin'].includes(m.role);if(!m||m.member_type==='guest'||mode==='private'&&!admin||mode==='team'&&!admin&&!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND workspace_id=? AND user_id=?').get(teamId,req.auth.workspaceId,target))invalid.push({kind:'user',sourceId:id,reason:'Cần chọn người thuộc phạm vi dự án hoặc bỏ giao việc'});}
      for(const id of customers){const target=mapped(customerMapping,id);if(target!==null&&(typeof target!=='string'||!db.prepare('SELECT 1 FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(target,req.auth.workspaceId)))invalid.push({kind:'customer',sourceId:id,reason:'Cần chọn khách hàng hiện có hoặc bỏ liên kết'});}
      if(Object.keys(userMapping).some(id=>!users.has(id))||Object.keys(customerMapping).some(id=>!customers.has(id)))fail(400,'Mapping có ID không thuộc mẫu');
      return{payload,name,startAt,mode,teamId,userMapping,customerMapping,invalid,taskCount:payload.tasks.length};
    }
    route('post','/api/project-templates/:templateId/preview',(req,res)=>{const result=preview(req,template(req));res.json({valid:!result.invalid.length,issues:result.invalid,taskCount:result.taskCount,startAt:result.startAt,accessMode:result.mode,teamId:result.teamId});});
    route('post','/api/project-templates/:templateId/apply',(req,res)=>mutation(req,()=>{
      const t=template(req),p=preview(req,t),operation=req.body.operationId;
      if(typeof operation!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(operation))fail(400,'Cần operationId ổn định để tạo dự án');
      const fingerprint=mutationFingerprint({templateId:t.id,...req.body}),action='project_template.apply';
      db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))').get(JSON.stringify([req.auth.workspaceId,req.auth.userId,operation]));
      const receipt=db.prepare('SELECT * FROM mutation_receipts WHERE workspace_id=? AND principal_id=? AND operation_id=?').get(req.auth.workspaceId,req.auth.userId,operation);
      if(receipt){if(receipt.action!==action||receipt.payload_hash!==fingerprint)fail(409,'operationId đã dùng với nội dung khác');access(req,receipt.resource_id,'manage','project_templates');return res.json({...JSON.parse(receipt.response_json),replayed:true});}
      if(p.invalid.length)fail(400,'Cần xử lý mapping trước khi tạo dự án',{issues:p.invalid});
      const id=createId('project_'),at=now(),shift=value=>value?new Date(Date.parse(value)+Date.parse(p.startAt)-Date.parse(p.payload.anchorAt)).toISOString():null;
      // Checklist start/due are Vietnam calendar days, unlike task deadlines.
      const dayOffset=calendarDaysBetween(p.payload.anchorAt,p.startAt),shiftDay=value=>value?addCalendarDays(value,dayOffset):null;
      const mapUser=id=>id?(Object.hasOwn(p.userMapping,id)?p.userMapping[id]:id):null,mapCustomer=id=>id?(Object.hasOwn(p.customerMapping,id)?p.customerMapping[id]:id):null;
      db.prepare('INSERT INTO projects(id,workspace_id,name,description,access_mode,team_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,p.name,p.payload.description,p.mode,p.teamId,req.auth.userId,at,at);
      const columns=new Map(),fieldIds=new Map(),options=new Map(),tasks=new Map(),labels=new Map();
      for(const c of p.payload.columns){const key=createId('boardcol_');columns.set(c.id,key);db.prepare('INSERT INTO board_columns(id,workspace_id,project_id,team_id,name,status,tone,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(key,req.auth.workspaceId,id,p.teamId,c.name,c.status,c.tone,c.position,at,at);}
      for(const f of p.payload.fields){const key=createId('field_');fieldIds.set(f.id,key);const choices=JSON.parse(f.options_json).map(o=>{const option=createId('option_');options.set(o.id,option);return{...o,id:option};});db.prepare('INSERT INTO project_fields(id,workspace_id,project_id,name,type,position,options_json,retired_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(key,req.auth.workspaceId,id,f.name,f.type,f.position,JSON.stringify(choices),f.retired_at,at,at);}
      for(const label of p.payload.labels||[]){const key=createId('label_');labels.set(label.id,key);db.prepare('INSERT INTO task_labels(id,workspace_id,project_id,name,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(key,req.auth.workspaceId,id,label.name,label.color,req.auth.userId,at,at);}
      for(const source of p.payload.tasks){
        const key=createId('task_');tasks.set(source.id,key);
        db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,title,description,status,priority,column_id,board_position,category,recurrence,recurrence_options,recurrence_anchor,start_at,due_at,remind_at,assignee_id,customer_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,req.auth.workspaceId,id,p.teamId,source.title,source.description,source.status,source.priority,columns.get(source.columnId)||null,source.position,source.category,source.recurrence,source.recurrenceOptions,shift(source.recurrenceAnchor),shift(source.startAt),shift(source.dueAt),shift(source.remindAt),mapUser(source.assigneeId),mapCustomer(source.customerId),req.auth.userId,at,at);
        const assignees=[...new Set(source.assignees.map(mapUser).filter(person=>person&&person!==mapUser(source.assigneeId)))];
        for(const [position,person]of assignees.entries())db.prepare('INSERT INTO task_assignees(task_id,user_id,position,created_at) VALUES (?,?,?,?)').run(key,person,position,at);
        for(const label of source.labels||[])db.prepare('INSERT INTO task_label_links(task_id,label_id,created_at) VALUES (?,?,?)').run(key,labels.get(label),at);
        for(const v of source.values){const f=p.payload.fields.find(f=>f.id===v.field_id),value=JSON.parse(v.value_json),remapped=f.type==='single'&&value!==null?options.get(value):f.type==='multiple'&&value!==null?value.map(o=>options.get(o)):value;db.prepare('INSERT INTO task_field_values(task_id,field_id,workspace_id,project_id,value_json) VALUES (?,?,?,?,?)').run(key,fieldIds.get(v.field_id),req.auth.workspaceId,id,JSON.stringify(remapped));}
        for(const c of source.checklists){const checklist=createId('checklist_');db.prepare('INSERT INTO task_checklists(id,task_id,title,position,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(checklist,key,c.title,c.position,req.auth.userId,at,at);for(const i of c.items){const item=createId('item_');db.prepare('INSERT INTO task_checklist_items(id,checklist_id,title,completed,position,start_at,due_at,remind_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(item,checklist,i.title,i.completed,i.position,shiftDay(i.start_at),shiftDay(i.due_at),shift(i.remind_at),at,at);for(const person of new Set(i.assignees.map(mapUser).filter(Boolean)))db.prepare('INSERT INTO task_checklist_assignees(item_id,user_id) VALUES (?,?)').run(item,person);}}
      }
      for(const d of p.payload.dependencies)db.prepare('INSERT INTO task_dependencies(workspace_id,project_id,predecessor_id,successor_id,created_at) VALUES (?,?,?,?,?)').run(req.auth.workspaceId,id,tasks.get(d.predecessor_id),tasks.get(d.successor_id),at);
      const response={projectId:id,taskCount:tasks.size};db.prepare('INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(req.auth.workspaceId,req.auth.userId,operation,action,id,fingerprint,201,JSON.stringify(response),at);res.status(201).json(response);
    }));
  }
}
