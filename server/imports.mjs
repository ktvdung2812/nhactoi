import { createId } from './auth.mjs';
import { getProjectAccess } from './projects.mjs';
import { hasWorkspaceEntitlement } from './entitlements.mjs';
import { validateProjectFieldValue } from './project-advanced.mjs';
import { mutationFingerprint, withMutationContext } from './task-mutation-pipeline.mjs';
import { validateRecurrenceOptions } from './recurrence.mjs';
import { RECURRENCES } from '../shared/task-recurrence.mjs';
import { parseCsv, importDate, IMPORT_DEFAULT_LIMITS } from '../shared/data-import.mjs';

const keys = ['source','content','delimiter','dateFormat','mapping','userMapping','labelMapping','listMapping','listStatuses','fieldOptionMapping','operationId','previewToken'];
const csvKeys = ['title','description','status','priority','dueAt','remindAt','startAt','assignees','labels','column','recurrence','recurrenceOptions','customFields'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sourceId = value => typeof value === 'string' && value.trim() && value.length <= 160 && !value.includes('\0');
const split = value => [...new Set(String(value || '').split('|').map(s=>s.trim()).filter(Boolean))];
const labelColors = { green:'#22c55e', yellow:'#eab308', orange:'#f97316', red:'#ef4444', purple:'#a855f7', blue:'#3b82f6', sky:'#0ea5e9', lime:'#84cc16', pink:'#ec4899', black:'#64748b' };

export function registerImportRoutes(app,{db,clock,config,requireAuth,ensureWritable,HttpError,withTransaction}) {
  if (db.dialect !== 'postgres') return;
  const limits = { ...IMPORT_DEFAULT_LIMITS, ...config.importLimits };
  const fail = (status,message,details) => { throw new HttpError(status,message,details); };
  const now = () => new Date(clock()).toISOString();
  const access = req => {
    const a = getProjectAccess(db,req.auth.workspaceId,req.auth.userId,req.params.id,{clock,config});
    if (!a) fail(404,'Không tìm thấy dự án');
    ensureWritable(req);
    if (!a.canEdit) fail(a.readonly?409:403,'Cần quyền chỉnh sửa dự án để nhập dữ liệu');
    if (!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,'imports',clock)) fail(403,'Gói hiện tại không cho nhập dữ liệu');
    return a;
  };
  const route = (method,path,fn) => app[method](path,requireAuth,(req,res,next)=>{try{fn(req,res);}catch(error){next(error);}});
  function metadata(req,a,lock=false) {
    const wid=req.auth.workspaceId,pid=req.params.id;
    const users=db.prepare('SELECT u.id,u.name FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE m.workspace_id=? AND u.disabled_at IS NULL ORDER BY u.name,u.id').all(wid)
      .filter(u=>getProjectAccess(db,wid,u.id,pid,{clock,config}));
    const suffix=lock?' FOR SHARE':'';
    return { limits, users, fields:db.prepare('SELECT * FROM project_fields WHERE workspace_id=? AND project_id=? ORDER BY position,id'+suffix).all(wid,pid),
      columns:db.prepare('SELECT id,name,status,archived_at FROM board_columns WHERE workspace_id=? AND project_id=? ORDER BY position,id'+suffix).all(wid,pid),
      labels:db.prepare('SELECT id,name,color FROM task_labels WHERE workspace_id=? AND project_id=? ORDER BY name,id'+suffix).all(wid,pid),
      canWriteFields:hasWorkspaceEntitlement(db,config,wid,'custom_fields',clock),canWriteStart:hasWorkspaceEntitlement(db,config,wid,'timeline',clock),teamId:a.project.team_id,canManage:a.canManage };
  }
  const publicMeta = m => ({ limits:m.limits,users:m.users,columns:m.columns.filter(c=>!c.archived_at),labels:m.labels,
    fields:m.canWriteFields?m.fields.filter(f=>!f.retired_at).map(f=>({id:f.id,name:f.name,type:f.type,options:JSON.parse(f.options_json).filter(o=>!o.retired)})):[],canWriteStart:m.canWriteStart });
  route('get','/api/projects/:id/import',(req,res)=>res.json(publicMeta(metadata(req,access(req)))));

  function prepare(req,m) {
    const b=req.body;
    if(!object(b)||Object.keys(b).some(k=>!keys.includes(k))||!['csv','trello'].includes(b.source)||typeof b.content!=='string')fail(400,'Chọn nguồn CSV hoặc Trello JSON');
    if(!b.content.isWellFormed())fail(400,'Nội dung Unicode không hợp lệ');
    if(Buffer.byteLength(b.content,'utf8')>limits.maxBytes)fail(413,`Tệp tối đa ${limits.maxBytes} byte`);
    if(!['iso','dmy','mdy'].includes(b.dateFormat||'iso'))fail(400,'Định dạng ngày không hợp lệ');
    for(const key of ['mapping','userMapping','labelMapping','listMapping','listStatuses','fieldOptionMapping'])if(b[key]!==undefined&&(!object(b[key])||Object.keys(b[key]).length>500))fail(400,'Mapping không hợp lệ');
    const errors=[],warnings=[],tasks=[],sourceUsers=new Map(),sourceLabels=new Map(),sourceLists=new Map();
    const issue=(row,column,message)=>errors.push({row,column,message});
    const str=(value,max,required=false)=>{if(typeof value!=='string'||value.includes('\0')||value.length>max||required&&!value.trim())throw new Error(`Nội dung ${required?'bắt buộc, ':''}tối đa ${max} ký tự`);return required?value.trim():value;};
    const userMap=b.userMapping||{},labelMap=b.labelMapping||{},listMap=b.listMapping||{},optionMap=b.fieldOptionMapping||{};
    let board=null,headers=[],suggestedMapping={},existing=new Map();
    const sourceKey=(kind,id)=>kind+':'+id;
    const known=(kind,id)=>existing.get(sourceKey(kind,id));
    const mappedUser=id=>{
      if(!Object.hasOwn(userMap,id))throw new Error(`Chọn người nhận hoặc bỏ gán cho ${id}`);
      const target=userMap[id];if(target===null)return null;
      if(typeof target!=='string'||!m.users.some(u=>u.id===target))throw new Error('Người được gán không có quyền dự án');
      return target;
    };
    const mappedLabel=id=>{if(!Object.hasOwn(labelMap,id))throw new Error(`Chọn nhãn hoặc bỏ nhãn cho ${id}`);const target=labelMap[id];if(target===null)return null;if(typeof target!=='string'||!m.labels.some(l=>l.id===target))throw new Error('Nhãn không thuộc dự án');return target;};
    const columnFor=(source,status,allowArchived=false)=>{
      if(source){const target=listMap[source]||known('list',source)?.destination_id;if(target){const col=m.columns.find(c=>c.id===target&&(!c.archived_at||allowArchived));if(!col)throw new Error('Cột được map không còn trong dự án');if(col.status!==status)throw new Error('Trạng thái công việc không khớp cột');return target;}
        if(b.source==='csv')throw new Error(`Chọn cột đích cho ${source}`);
        if(!m.canManage)throw new Error('Cần quản lý dự án để tạo cột mới; hãy chọn cột hiện hữu');
        return null;
      }
      const col=m.columns.find(c=>c.status===status&&!c.archived_at);if(!col)throw new Error('Dự án thiếu cột cho trạng thái này');return col.id;
    };
    const fieldValue=(field,raw)=>{
      if(raw==='')return field.type==='text'?'':null;
      if(field.type==='number'){if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw))throw new Error('Cần giá trị số');return Number(raw);}
      if(field.type==='checkbox'){if(!['true','false'].includes(raw))throw new Error('Checkbox dùng true/false; ô rỗng là null');return raw==='true';}
      if(field.type==='date'){
        if(b.dateFormat==='dmy'||b.dateFormat==='mdy'){const x=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);if(x)return`${x[3]}-${b.dateFormat==='dmy'?x[2]:x[1]}-${b.dateFormat==='dmy'?x[1]:x[2]}`;}return raw;
      }
      const choice=id=>object(optionMap[field.id])&&Object.hasOwn(optionMap[field.id],id)?optionMap[field.id][id]:id;
      if(field.type==='single')return choice(raw);
      if(field.type==='multiple')return split(raw).map(choice);
      return raw;
    };
    function checked(row,column,fn){try{return fn();}catch(e){issue(row,column,e.message);return undefined;}}
    function normalize(raw,line){
      const t={line,sourceId:raw.sourceId||null,sourceList:raw.sourceList||null,archived:!!raw.archived,checklists:[],values:{}};
      for(const [key,max,required]of [['title',240,true],['description',5000,false]])t[key]=checked(line,key,()=>str(raw[key]??'',max,required));
      t.priority=raw.priority||'medium';if(!['low','medium','high'].includes(t.priority))issue(line,'priority','Dùng low, medium hoặc high');
      t.status=raw.status||'todo';if(!['todo','doing','done'].includes(t.status))issue(line,'status','Dùng todo, doing hoặc done');
      for(const key of ['dueAt','remindAt','startAt'])t[key]=checked(line,key,()=>importDate(raw[key],b.dateFormat||'iso'));
      if(t.startAt&&!m.canWriteStart)issue(line,'startAt','Gói hiện tại không cho ghi timeline');
      if(t.startAt&&t.dueAt&&t.startAt>t.dueAt)issue(line,'startAt','Ngày bắt đầu phải trước hạn');
      t.recurrence=raw.recurrence||'none';if(!RECURRENCES.includes(t.recurrence)||t.recurrence!=='none'&&!t.dueAt)issue(line,'recurrence','Quy tắc lặp không hợp lệ hoặc thiếu hạn');
      t.recurrenceOptions=checked(line,'recurrenceOptions',()=>validateRecurrenceOptions(t.recurrence,raw.recurrenceOptions,HttpError));
      t.columnId=checked(line,'column',()=>columnFor(raw.sourceList||raw.column,t.status,t.archived));
      t.assignees=[...new Set((raw.assignees||[]).map(id=>checked(line,'assignees',()=>mappedUser(id))).filter(Boolean))];
      t.labels=b.source==='csv'?(raw.labels||[]).map(id=>checked(line,'labels',()=>mappedLabel(id))).filter(Boolean):raw.labels||[];
      for(const [id,rawValue]of Object.entries(raw.values||{}))checked(line,id,()=>{const field=m.fields.find(f=>f.id===id);if(!field||!m.canWriteFields)throw new Error('Trường không thuộc phạm vi được phép ghi');const value=fieldValue(field,rawValue);validateProjectFieldValue(field,value);t.values[id]=value;});
      if(raw.checklists){
        if(!Array.isArray(raw.checklists)||raw.checklists.length>50)issue(line,'checklists','Tối đa 50 checklist mỗi công việc');
        else for(const c of raw.checklists)checked(line,'checklists',()=>{if(!Array.isArray(c.items)||c.items.length>100)throw new Error('Tối đa 100 mục mỗi checklist');t.checklists.push({title:str(c.title,240,true),items:c.items.map(i=>({title:str(i.title,240,true),completed:i.completed===true}))});});
      }
      if(t.remindAt&&t.remindAt<=now())warnings.push({kind:'pastReminder',count:1,row:line,message:'Giữ thời điểm nhắc lịch sử, không gửi lại'});
      tasks.push(t);
    }
    if(b.source==='csv'){
      let parsed;
      try{parsed=parseCsv(b.content,{...limits,delimiter:b.delimiter||','});}catch(e){return{valid:false,errors:[{row:e.row||1,column:e.column||'file',message:e.message}],warnings,headers,sourceUsers:[],sourceLabels:[],sourceLists:[],tasks,board,existing,summary:{ready:0,skipped:0,failed:1},suggestedMapping};}
      headers=parsed.headers;
      for(const key of csvKeys.filter(k=>k!=='customFields'))if(headers.includes(key))suggestedMapping[key]=key;
      const mapping=b.mapping||suggestedMapping;
      if(Object.keys(mapping).some(k=>!csvKeys.includes(k)))issue(1,'mapping','Mapping chứa trường không hỗ trợ');
      if(!mapping.title||!headers.includes(mapping.title))issue(1,'title','Chọn header tiêu đề bắt buộc');
      if(mapping.customFields!==undefined&&!object(mapping.customFields))issue(1,'customFields','Mapping trường không hợp lệ');
      const entries=Object.entries(mapping).filter(([key])=>key!=='customFields');
      for(const [key,column]of [...entries,...Object.entries(object(mapping.customFields)?mapping.customFields:{})])if(typeof column!=='string'||!headers.includes(column))issue(1,key,'Header mapping không tồn tại');
      for(const row of parsed.rows){
        if(row.cells.length!==headers.length){issue(row.line,'row',`Cần ${headers.length} ô, nhận ${row.cells.length}`);continue;}
        const values=Object.fromEntries(headers.map((h,i)=>[h,row.cells[i]])),raw=Object.fromEntries(entries.map(([key,column])=>[key,values[column]]));
        raw.assignees=split(raw.assignees);for(const id of raw.assignees)sourceUsers.set(id,{id,name:id});
        raw.labels=split(raw.labels);for(const id of raw.labels)sourceLabels.set(id,{id,name:id});
        if(raw.column)sourceLists.set(raw.column,{id:raw.column,name:raw.column});
        if(raw.recurrenceOptions)raw.recurrenceOptions=checked(row.line,'recurrenceOptions',()=>JSON.parse(raw.recurrenceOptions));else delete raw.recurrenceOptions;
        raw.values=Object.fromEntries(Object.entries(object(mapping.customFields)?mapping.customFields:{}).map(([id,column])=>[id,values[column]]));
        normalize(raw,row.line);
      }
    }else{
      let data;
      try{data=JSON.parse(b.content);if(!object(data))throw new Error('Cần object Trello');board=str(data.id,160,true);}catch(e){fail(400,'Tệp JSON Trello không hợp lệ');}
      for(const [key,max]of [['lists',limits.maxLists],['cards',limits.maxRows],['labels',100],['members',500],['checklists',limits.maxRows*50]])if(!Array.isArray(data[key]||[])||(data[key]||[]).length>max)fail(400,`${key}: tối đa ${max} mục`);
      if(!Array.isArray(data.cards)||!Array.isArray(data.lists))fail(400,'Trello cần lists và cards');
      for(const key of ['actions','automations','rules','powerUps'])if(data[key]!==undefined&&!Array.isArray(data[key]))fail(400,`${key} phải là danh sách`);
      if((data.actions||[]).some(action=>!object(action)))fail(400,'Action Trello không hợp lệ');
      existing=new Map(db.prepare('SELECT * FROM import_sources WHERE workspace_id=? AND project_id=? AND source_board=?').all(req.auth.workspaceId,req.params.id,board).map(s=>[sourceKey(s.source_kind,s.source_id),s]));
      const ids=new Set();for(const c of data.cards){if(!object(c)||!sourceId(c.id)||ids.has(c.id))fail(400,'Card thiếu hoặc trùng source ID');ids.add(c.id);}
      for(const l of data.lists){if(!object(l)||!sourceId(l.id)||sourceLists.has(l.id))fail(400,'List thiếu hoặc trùng source ID');sourceLists.set(l.id,{id:l.id,name:checked(1,'lists',()=>str(l.name,120,true)),status:b.listStatuses?.[l.id]||'todo',archived:!!l.closed,position:Number.isFinite(l.pos)?l.pos:sourceLists.size});}
      for(const l of data.labels||[]){if(!object(l)||!sourceId(l.id)||sourceLabels.has(l.id))fail(400,'Label thiếu hoặc trùng source ID');sourceLabels.set(l.id,{id:l.id,name:checked(1,'labels',()=>str(l.name||l.color||'Nhãn Trello',80,true)),color:labelColors[l.color]||'#64748b'});}
      const names=new Map((data.members||[]).filter(object).map(u=>[u.id,u.fullName||u.username||u.id]));
      let attachments=0,closed=0,dueComplete=0,custom=0;
      const checkIds=new Set();for(const c of data.checklists||[]){if(!object(c)||!sourceId(c.id)||checkIds.has(c.id))fail(400,'Checklist thiếu hoặc trùng source ID');checkIds.add(c.id);if(c.idCard&&!ids.has(c.idCard)||!Array.isArray(c.checkItems)||c.checkItems.some(i=>!object(i)))fail(400,'Checklist có card hoặc mục không hợp lệ');}
      const checklistOwners=new Map();for(const c of data.cards){if(c.idChecklists!==undefined&&(!Array.isArray(c.idChecklists)||new Set(c.idChecklists).size!==c.idChecklists.length))fail(400,'Tham chiếu checklist không hợp lệ');for(const id of c.idChecklists||[]){if(!sourceId(id)||checklistOwners.has(id))fail(400,'Checklist phải thuộc đúng một card');checklistOwners.set(id,c.id);}}
      for(const c of data.checklists||[])if(!c.idCard&&!checklistOwners.has(c.id))fail(400,'Checklist không có card đích');
      for(const [i,c]of [...data.cards].sort((a,b)=>(a.pos||0)-(b.pos||0)).entries()){
        if(known('card',c.id)){tasks.push({line:i+1,sourceId:c.id,skipped:true,title:typeof c.name==='string'?c.name.slice(0,240):''});continue;}
        if(c.idBoard&&c.idBoard!==board)issue(i+1,'idBoard','Card không thuộc source board');
        const list=sourceLists.get(c.idList);if(!list)issue(i+1,'idList','Card tham chiếu list không có trong tệp');
        if(c.labels!==undefined&&(!Array.isArray(c.labels)||c.labels.some(l=>!object(l))))fail(400,'Danh sách nhãn trong card không hợp lệ');
        const members=c.idMembers||[],labels=c.idLabels||c.labels?.map(l=>l.id)||[];
        if(!Array.isArray(members)||members.length>100||members.some(id=>!sourceId(id)))fail(400,'Danh sách người trong card không hợp lệ');
        if(!Array.isArray(labels))fail(400,'Danh sách nhãn trong card không hợp lệ');
        for(const id of members)sourceUsers.set(id,{id,name:String(names.get(id)||id).slice(0,160)});
        if(!Array.isArray(labels)||labels.length>100||labels.some(id=>!sourceLabels.has(id)))issue(i+1,'labels','Label không tồn tại trong tệp');
        if(c.idChecklists&&!Array.isArray(c.idChecklists))fail(400,'Tham chiếu checklist không hợp lệ');
        for(const id of c.idChecklists||[])if(!checkIds.has(id))issue(i+1,'checklists','Checklist tham chiếu bị thiếu');
        const checklists=(data.checklists||[]).filter(x=>x.idCard===c.id||(c.idChecklists||[]).includes(x.id));
        for(const x of checklists)if(x.idCard&&x.idCard!==c.id)issue(i+1,'checklists','Checklist thuộc card khác');
        normalize({sourceId:c.id,sourceList:c.idList,title:c.name,description:c.desc||'',dueAt:c.due,startAt:c.start,status:list?.status,assignees:members,labels,
          archived:c.closed||list?.archived,checklists:checklists.map(x=>({title:x.name,items:Array.isArray(x.checkItems)?[...x.checkItems].sort((a,b)=>(a.pos||0)-(b.pos||0)).map(item=>({title:item.name,completed:item.state==='complete'})):null}))},i+1);
        attachments+=Array.isArray(c.attachments)?c.attachments.length:0;closed+=c.closed?1:0;dueComplete+=c.dueComplete?1:0;custom+=Array.isArray(c.customFieldItems)?c.customFieldItems.length:0;
      }
      for(const [kind,count,message]of [['comments',(data.actions||[]).filter?.(a=>a.type==='commentCard').length||0,'Bình luận không được nhập'],['attachments',attachments,'Tệp đính kèm không được nhập'],['automation',Array.isArray(data.automations)?data.automations.length:Array.isArray(data.rules)?data.rules.length:0,'Automation nguồn không được nhập'],['powerUps',Array.isArray(data.powerUps)?data.powerUps.length:0,'Power-Up không được nhập'],['customFields',custom,'Custom field Trello chưa được hỗ trợ; dùng CSV mapping'],['dueComplete',dueComplete,'Dấu hoàn thành hạn Trello không đổi trạng thái task; chọn trạng thái theo list'],['archived',closed,'Card lưu trữ được nhập dưới dạng xóa mềm']])if(count)warnings.push({kind,count,message});
      for(const l of sourceLists.values())if(!['todo','doing','done'].includes(l.status))issue(1,'listStatuses','Trạng thái list không hợp lệ');
      for(const l of sourceLabels.values())if(tasks.some(t=>!t.skipped&&t.labels.includes(l.id))&&!known('label',l.id)&&!Object.hasOwn(labelMap,l.id)&&!m.canManage)issue(1,'labels','Cần quản lý dự án để tạo nhãn mới; hãy chọn nhãn hiện hữu hoặc bỏ qua');
      for(const l of sourceLabels.values()){const old=known('label',l.id);if(old&&tasks.some(t=>!t.skipped&&t.labels.includes(l.id))&&!Object.hasOwn(labelMap,l.id)&&!m.labels.some(x=>x.id===old.destination_id))issue(1,'labels','Nhãn đã mất hoặc chuyển phạm vi; chọn mapping khác');}
      for(const [id,target]of Object.entries(labelMap)){if(!sourceLabels.has(id))issue(1,'labels','Mapping nhãn nguồn không tồn tại');if(target!==null&&!m.labels.some(l=>l.id===target))issue(1,'labels','Nhãn đích không thuộc dự án');}
    }
    const skipped=tasks.filter(t=>t.skipped).length,badRows=new Set(errors.map(e=>e.row));
    const ready=b.source==='csv'&&badRows.has(1)?0:tasks.filter(t=>!t.skipped&&!badRows.has(t.line)).length;
    return{valid:!errors.length,errors,warnings,headers,suggestedMapping,sourceUsers:[...sourceUsers.values()],sourceLabels:[...sourceLabels.values()],sourceLists:[...sourceLists.values()],tasks,board,existing,
      summary:{ready,skipped,failed:badRows.size}};
  }
  function preview(req,m){const plan=prepare(req,m);const input={...req.body};delete input.operationId;delete input.previewToken;
    plan.previewToken=mutationFingerprint({projectId:req.params.id,input,fields:m.fields,columns:m.columns,labels:m.labels,users:m.users,rows:plan.tasks});return plan;}
  const publicPlan=p=>({valid:p.valid,errors:p.errors,warnings:p.warnings,headers:p.headers,suggestedMapping:p.suggestedMapping,sourceUsers:p.sourceUsers,sourceLabels:p.sourceLabels,sourceLists:p.sourceLists,summary:p.summary,previewToken:p.previewToken,
    sample:p.tasks.slice(0,20).map(t=>({line:t.line,title:t.title,status:t.status,dueAt:t.dueAt,skipped:!!t.skipped,archived:!!t.archived})),sampleLimit:20});
  route('post','/api/projects/:id/import/preview',(req,res)=>res.json(publicPlan(preview(req,metadata(req,access(req))))));
  route('post','/api/projects/:id/import/commit',(req,res)=>{
    const result=withTransaction(db,()=>{
      access(req);
      const operation=req.body?.operationId;if(typeof operation!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(operation))fail(400,'Cần operationId ổn định cho lô nhập');
      const fingerprint=mutationFingerprint({projectId:req.params.id,...req.body}),action='project.import';
      db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))').get(JSON.stringify([req.auth.workspaceId,req.auth.userId,operation]));
      // ponytail: serialize imports per destination project; split source-board locks only if import throughput requires it.
      db.prepare('SELECT id FROM projects WHERE workspace_id=? AND id=? FOR UPDATE').get(req.auth.workspaceId,req.params.id);
      db.prepare('SELECT user_id FROM workspace_members WHERE workspace_id=? FOR SHARE').all(req.auth.workspaceId);
      db.prepare('SELECT user_id FROM project_members WHERE project_id=? FOR SHARE').all(req.params.id);
      db.prepare('SELECT workspace_id FROM subscriptions WHERE workspace_id=? FOR SHARE').get(req.auth.workspaceId);
      const a=access(req),receipt=db.prepare('SELECT * FROM mutation_receipts WHERE workspace_id=? AND principal_id=? AND operation_id=?').get(req.auth.workspaceId,req.auth.userId,operation);
      if(receipt){
        if(receipt.action!==action||receipt.payload_hash!==fingerprint)fail(409,'operationId đã dùng với nội dung khác');
        const response=JSON.parse(receipt.response_json),ids=response.taskIds;
        if(ids.length){const rows=db.prepare(`SELECT id,project_id FROM tasks WHERE workspace_id=? AND id IN (${ids.map(()=>'?').join(',')})`).all(req.auth.workspaceId,...ids);const visible=new Map();
          for(const row of rows)if(!visible.has(row.project_id))visible.set(row.project_id,!!getProjectAccess(db,req.auth.workspaceId,req.auth.userId,row.project_id,{clock,config}));
          if(rows.length!==ids.length||rows.some(row=>!visible.get(row.project_id)))fail(403,'Quyền truy cập kết quả lô nhập đã thay đổi');
        }
        return{...response,replayed:true};
      }
      const m=metadata(req,a,true),p=preview(req,m);
      if(!p.valid)fail(400,'Lô nhập có lỗi; chưa ghi dữ liệu',{errors:p.errors});
      if(!req.body.previewToken||req.body.previewToken!==p.previewToken)fail(409,'Dữ liệu hoặc schema đã đổi; xem trước lại trước khi nhập');
      return withMutationContext(db,{actorUserId:req.auth.userId,source:'import',operationId:operation,occurredAt:now()},()=>{
        const at=now(),wid=req.auth.workspaceId,pid=req.params.id,ids=[],columns=new Map(),labels=new Map();
        const source=(kind,id)=>p.existing.get(kind+':'+id)?.destination_id;
        const saveSource=(kind,id,target)=>db.prepare('INSERT INTO import_sources(workspace_id,project_id,source_board,source_kind,source_id,destination_id,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,project_id,source_board,source_kind,source_id) DO UPDATE SET destination_id=excluded.destination_id').run(wid,pid,p.board,kind,id,target,at);
        const active=p.tasks.filter(t=>!t.skipped);
        if(p.board){
          let position=Number(db.prepare('SELECT coalesce(max(position),0) n FROM board_columns WHERE project_id=?').get(pid).n)+1;
          for(const l of p.sourceLists.filter(l=>active.some(t=>t.sourceList===l.id))){
            const old=source('list',l.id),mapped=req.body.listMapping?.[l.id];let id=mapped||old;
            if(!id){id=createId('column_');db.prepare('INSERT INTO board_columns(id,workspace_id,project_id,team_id,name,status,tone,position,archived_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,wid,pid,m.teamId,l.name,l.status,'blue',position++,l.archived?at:null,at,at);}
            columns.set(l.id,id);if(!old||mapped&&old!==id)saveSource('list',l.id,id);
          }
          for(const l of p.sourceLabels.filter(l=>active.some(t=>t.labels.includes(l.id)))){
            const old=source('label',l.id),mapped=Object.hasOwn(req.body.labelMapping||{},l.id);let id=mapped?req.body.labelMapping[l.id]:old;
            if(id===null){labels.set(l.id,null);continue;}
            if(id&&!m.labels.some(x=>x.id===id))fail(409,'Nhãn nguồn đã mất hoặc chuyển phạm vi; chọn mapping khác');
            if(!id){id=createId('label_');db.prepare('INSERT INTO task_labels(id,workspace_id,project_id,name,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,wid,pid,l.name,l.color,req.auth.userId,at,at);}
            labels.set(l.id,id);if(!old||mapped&&old!==id)saveSource('label',l.id,id);
          }
        }
        let position=Number(db.prepare('SELECT coalesce(max(board_position),0) n FROM tasks WHERE project_id=?').get(pid).n)+1;
        for(const t of active){
          const id=createId('task_');ids.push(id);
          db.prepare('INSERT INTO tasks(id,workspace_id,project_id,team_id,title,description,status,priority,column_id,board_position,due_at,remind_at,start_at,recurrence,recurrence_options,recurrence_anchor,assignee_id,created_by,created_at,updated_at,deleted_at,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,wid,pid,m.teamId,t.title,t.description,t.status,t.priority,t.columnId||columns.get(t.sourceList),position++,t.dueAt,t.remindAt,t.startAt,t.recurrence,JSON.stringify(t.recurrenceOptions),t.recurrence==='none'?null:t.dueAt,t.assignees[0]||null,req.auth.userId,at,at,t.archived?at:null,at);
          for(const [n,person]of t.assignees.slice(1).entries())db.prepare('INSERT INTO task_assignees(task_id,user_id,position,created_at) VALUES (?,?,?,?)').run(id,person,n,at);
          for(const label of new Set(t.labels.map(l=>p.board?labels.get(l):l).filter(Boolean)))db.prepare('INSERT INTO task_label_links(task_id,label_id,created_at) VALUES (?,?,?)').run(id,label,at);
          for(const [field,value]of Object.entries(t.values))db.prepare('INSERT INTO task_field_values(task_id,field_id,workspace_id,project_id,value_json) VALUES (?,?,?,?,?)').run(id,field,wid,pid,JSON.stringify(value));
          for(const [n,c]of t.checklists.entries()){const cid=createId('checklist_');db.prepare('INSERT INTO task_checklists(id,task_id,title,position,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(cid,id,c.title,n,req.auth.userId,at,at);for(const [pos,item]of c.items.entries())db.prepare('INSERT INTO task_checklist_items(id,checklist_id,title,completed,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(createId('item_'),cid,item.title,item.completed?1:0,pos,at,at);}
          db.prepare("UPDATE business_events SET type='task.imported' WHERE task_id=? AND source='import' AND type='task.created'").run(id);
          db.prepare('UPDATE task_assignment_cycles SET history_known=0,started_at=NULL WHERE task_id=?').run(id);
          if(p.board)saveSource('card',t.sourceId,id);
        }
        const response={imported:ids.length,skipped:p.summary.skipped,failed:0,taskIds:ids,operationId:operation};
        db.prepare('INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(wid,req.auth.userId,operation,action,pid,fingerprint,201,JSON.stringify(response),at);
        return response;
      });
    });
    res.status(result.replayed?200:201).json(result);
  });
}
