import {nextTaskOccurrence} from '../shared/task-recurrence.mjs';
import {createId} from './auth.mjs';
import {canAccessTask} from './task-access.mjs';
import {hasWorkspaceEntitlement} from './entitlements.mjs';
import {vietnamDate,isValidCalendarDate,addCalendarDays} from '../shared/service-renewal.mjs';
export const DEFAULT_WORK_CALENDAR=Object.freeze({enabled:false,weekdays:[1,2,3,4,5],intervals:[['09:00','12:00'],['13:00','18:00']],holidays:[],overrides:{},quietStart:null,quietEnd:null});
const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
const time=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateWorkCalendar(value,HttpError=Error){
 const fail=()=>{throw HttpError===Error?new Error('Lịch làm việc không hợp lệ'):new HttpError(400,'Lịch làm việc không hợp lệ');};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_WORK_CALENDAR,k)))fail();
 const c={...DEFAULT_WORK_CALENDAR,...value};
 if(typeof c.enabled!=='boolean'||!Array.isArray(c.weekdays)||new Set(c.weekdays).size!==c.weekdays.length||c.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))fail();
 const validateWindows=windows=>{if(!Array.isArray(windows)||windows.length>8)fail();let end='00:00';for(const pair of windows){if(!Array.isArray(pair)||pair.length!==2||!time(pair[0])||!time(pair[1])||pair[0]>=pair[1]||pair[0]<end)fail();end=pair[1];}return windows;};
 validateWindows(c.intervals);
 if(!Array.isArray(c.holidays)||c.holidays.length>500||c.holidays.some(d=>!isValidCalendarDate(d)))fail();
 if(!c.overrides||typeof c.overrides!=='object'||Array.isArray(c.overrides)||Object.keys(c.overrides).length>500)fail();
 for(const [date,windows] of Object.entries(c.overrides)){if(!isValidCalendarDate(date))fail();validateWindows(windows);}
 if((c.quietStart===null)!==(c.quietEnd===null)||(c.quietStart!==null&&(!time(c.quietStart)||!time(c.quietEnd)||c.quietStart===c.quietEnd)))fail();
 return c;
}
export function calendarWindows(c,date){
 if(!c?.enabled)return null;
 const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
 const windows=Object.hasOwn(c.overrides||{},date)?c.overrides[date]:(c.holidays.includes(date)||!c.weekdays.includes(weekday)?[]:c.intervals);
 let ranges=windows.map(([a,b])=>[minute(a),minute(b)]);
 if(c.quietStart&&c.quietEnd){const a=minute(c.quietStart),b=minute(c.quietEnd),quiet=a<b?[[a,b]]:[[a,1440],[0,b]];
  for(const [from,to] of quiet)ranges=ranges.flatMap(([x,y])=>[[x,Math.min(y,from)],[Math.max(x,to),y]].filter(([p,q])=>q>p));
 }
 return ranges;
}
export function getWorkCalendar(db,workspaceId,userId=''){
 if(db.dialect!=='postgres')return DEFAULT_WORK_CALENDAR;
 const row=db.prepare("SELECT config_json FROM work_calendars WHERE workspace_id=? AND user_scope IN ('',?) ORDER BY (user_scope=?) DESC LIMIT 1").get(workspaceId,userId,userId);
 return row?JSON.parse(row.config_json):DEFAULT_WORK_CALENDAR;
}
export function nextWorkingInstant(calendar,value){
 const start=new Date(value);if(!Number.isFinite(start.getTime()))return null;
 if(!calendar?.enabled)return start;
 let date=vietnamDate(start);
 for(let i=0;i<370;i++,date=addCalendarDays(date,1)){
  const base=Date.parse(`${date}T00:00:00+07:00`);
  for(const [from,to] of calendarWindows(calendar,date)){const candidate=Math.max(start.getTime(),base+from*60000);if(candidate<base+to*60000)return new Date(candidate);}
 }
 return null;
}
// Enumerate from the unchanged anchor only when opting into workday shifting.
// The shifted Monday deadline must not turn a Sunday weekly series into Mondays.
export function nextWorkingOccurrence(task,options,completedAt,calendar){
 let due=nextTaskOccurrence(task.due_at,task.recurrence,options,completedAt,task.recurrence_anchor);
 if(!calendar?.enabled)return due;
 if(options.basis!=='completion'&&task.recurrence_anchor){
  let base=task.recurrence_anchor;
  for(let i=0;i<36600;i++){
   const candidate=nextTaskOccurrence(base,task.recurrence,options,completedAt,task.recurrence_anchor);
   if(!candidate)return null;
   if(candidate.getTime()>Date.parse(task.due_at)){due=candidate;break;}
   base=candidate.toISOString();
  }
 }
 return due?nextWorkingInstant(calendar,due):null;
}
export function workingSeconds(calendar,start,end){
 if(!calendar?.enabled||!start||!end)return null;
 const from=Date.parse(start),to=Date.parse(end);if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return null;
 let total=0,date=vietnamDate(new Date(from));const last=vietnamDate(new Date(to));
 for(let days=0;date<=last&&days<36600;days++,date=addCalendarDays(date,1)){
  const base=Date.parse(`${date}T00:00:00+07:00`);
  for(const [a,b] of calendarWindows(calendar,date))total+=Math.max(0,Math.min(to,base+b*60000)-Math.max(from,base+a*60000));
 }
 return Math.floor(total/1000);
}
export function workReminderAllowed(db,task,userId,now){
 if(db.dialect!=='postgres'||!hasWorkspaceEntitlement(db,db.projectConfig,task.workspace_id,'work_calendar',()=>new Date(now)))return true;
 const next=nextWorkingInstant(getWorkCalendar(db,task.workspace_id,userId),now);
 return !!next&&next.getTime()===Date.parse(now);
}
export function delegatedRecipients(db,task,people,now){
 if(db.dialect!=='postgres'||!hasWorkspaceEntitlement(db,db.projectConfig,task.workspace_id,'delegation',()=>new Date(now)))return people;
 const result=new Map(people.map(u=>[u.id,u]));
 for(const person of people){const rows=db.prepare(`SELECT u.id,u.name,u.email FROM reminder_delegates d JOIN users u ON u.id=d.delegate_id AND u.disabled_at IS NULL
  WHERE d.workspace_id=? AND d.principal_id=? AND d.starts_at<=? AND d.ends_at>?`).all(task.workspace_id,person.id,now,now);
  for(const row of rows)if(canAccessTask(db,task.workspace_id,row.id,task))!result.has(row.id)&&result.set(row.id,{...row,delegatedBy:person.id});
 }
 return [...result.values()];
}
export function registerWorkCalendarRoutes(app,{db,clock,config,requireAuth,ensureWritable,HttpError,withTransaction}){
 const fail=(message,status=400)=>{throw new HttpError(status,message);};
 const admin=req=>['owner','admin'].includes(req.auth.role)&&req.auth.memberType!=='guest';
 const entitled=(req,code)=>{ensureWritable(req);if(!hasWorkspaceEntitlement(db,config,req.auth.workspaceId,code,clock))fail('Gói hiện tại chưa hỗ trợ chức năng này',403);};
 app.get('/api/work-calendar',requireAuth,(req,res,next)=>{try{const scope=req.query.userId||'';if(typeof scope!=='string'||scope&&scope!==req.auth.userId&&!admin(req))fail('Không có quyền xem lịch cá nhân này',403);res.json({calendar:getWorkCalendar(db,req.auth.workspaceId,scope),canEdit:scope===req.auth.userId||admin(req),userId:scope});}catch(e){next(e);}});
 app.put('/api/work-calendar',requireAuth,(req,res,next)=>{try{entitled(req,'work_calendar');const scope=req.body?.userId||'';if(typeof scope!=='string'||scope&&scope!==req.auth.userId&&!admin(req)||!scope&&!admin(req))fail('Không có quyền sửa lịch này',403);if(scope&&!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND member_type='member'").get(req.auth.workspaceId,scope))fail('Thành viên không hợp lệ');const calendar=validateWorkCalendar(req.body?.calendar,HttpError);db.prepare(`INSERT INTO work_calendars(workspace_id,user_scope,config_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_scope) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`).run(req.auth.workspaceId,scope,JSON.stringify(calendar),clock().toISOString());res.json({calendar});}catch(e){next(e);}});
 app.get('/api/reminder-delegates',requireAuth,(req,res,next)=>{try{res.json({delegates:db.prepare(`SELECT d.*,u.name delegate_name FROM reminder_delegates d JOIN users u ON u.id=d.delegate_id WHERE d.workspace_id=?${admin(req)?'':' AND d.principal_id=?'} ORDER BY starts_at,id`).all(req.auth.workspaceId,...(admin(req)?[]:[req.auth.userId]))});}catch(e){next(e);}});
 app.post('/api/reminder-delegates',requireAuth,(req,res,next)=>{try{entitled(req,'delegation');const b=req.body||{},principalId=b.principalId||req.auth.userId;if(typeof principalId!=='string'||principalId!==req.auth.userId&&!admin(req))fail('Không có quyền ủy quyền người này',403);if(typeof b.delegateId!=='string'||b.delegateId===principalId)fail('Người nhận thay không hợp lệ');
  if([b.startsAt,b.endsAt].some(v=>typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!isValidCalendarDate(v.slice(0,10))))fail('Khoảng ủy quyền không hợp lệ');
  const start=new Date(b.startsAt),end=new Date(b.endsAt);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>=end)fail('Khoảng ủy quyền không hợp lệ');
  const id=createId('delegate_');withTransaction(db,()=>{db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))').get(`delegate:${req.auth.workspaceId}:${principalId}`);for(const userId of [principalId,b.delegateId])if(!db.prepare("SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.user_id AND u.disabled_at IS NULL WHERE wm.workspace_id=? AND wm.user_id=? AND wm.member_type='member'").get(req.auth.workspaceId,userId))fail('Người nhận phải là thành viên hiện hữu');if(db.prepare('SELECT 1 FROM reminder_delegates WHERE workspace_id=? AND principal_id=? AND starts_at<? AND ends_at>?').get(req.auth.workspaceId,principalId,end.toISOString(),start.toISOString()))fail('Khoảng ủy quyền bị chồng lấn',409);db.prepare('INSERT INTO reminder_delegates(id,workspace_id,principal_id,delegate_id,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,principalId,b.delegateId,start.toISOString(),end.toISOString(),clock().toISOString());});res.status(201).json({id});
 }catch(e){next(e);}});
 app.delete('/api/reminder-delegates/:id',requireAuth,(req,res,next)=>{try{entitled(req,'delegation');const d=db.prepare('SELECT * FROM reminder_delegates WHERE id=? AND workspace_id=?').get(req.params.id,req.auth.workspaceId);if(!d||d.principal_id!==req.auth.userId&&!admin(req))fail('Không tìm thấy ủy quyền',404);db.prepare('DELETE FROM reminder_delegates WHERE id=?').run(d.id);res.json({ok:true});}catch(e){next(e);}});
}
