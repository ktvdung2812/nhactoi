import {createId} from './auth.mjs';
import {canAccessTeamTask} from './teams.mjs';
export function processEventReminders({db,clock}){const at=new Date(clock()).toISOString();let sent=0;for(const e of db.prepare(`SELECT e.* FROM calendar_events e JOIN workspaces w ON w.id=e.workspace_id JOIN subscriptions s ON s.workspace_id=w.id WHERE e.status<>'done' AND e.remind_at<=? AND e.ends_at>? AND w.suspended_at IS NULL AND s.status NOT IN ('expired','canceled') AND s.current_period_end>?`).all(at,at,at)){if(!canAccessTeamTask(db,e.workspace_id,e.created_by,e.team_id,{write:true})||!db.prepare('SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL').get(e.created_by))continue;db.exec('BEGIN');try{const result=db.prepare('INSERT INTO calendar_event_notices VALUES (?,?,?) ON CONFLICT DO NOTHING').run(e.id,e.created_by,e.remind_at);if(result.changes){db.prepare('INSERT INTO notifications(id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(createId('notice_'),e.workspace_id,e.created_by,'calendar_event',e.title,'Sắp đến lịch hẹn. Mở Công việc để xem chi tiết.','calendar_event',e.id,at);sent++}db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}return sent}
export function registerEventRoutes(app,{db,clock,requireAuth,ensureWritable,HttpError}){
 const fail=(message,status=400)=>{throw new HttpError(status,message)},at=()=>new Date(clock()).toISOString();
 const access=(req,team,write=false)=>canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,team,{write});
 function row(req){const r=db.prepare('SELECT * FROM calendar_events WHERE id=? AND workspace_id=?').get(req.params.id,req.auth.workspaceId);if(!r||!access(req,r.team_id))fail('Không tìm thấy lịch hẹn',404);return r}
 function eventStatus(value, fallback='todo') {
  if (value === undefined) return fallback;
  if (!['todo','doing','done'].includes(value)) fail('Trạng thái không hợp lệ');
  return value;
 }
 function canEdit(req, event) { return access(req,event.team_id,true) && (event.created_by===req.auth.userId || ['owner','admin'].includes(req.auth.role)); }
 function input(req, previousStatus='todo'){const b=req.body||{};if(typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof (b.description??'')!=='string'||(b.description||'').length>5000)fail('Tên hoặc mô tả không hợp lệ');const start=new Date(b.startsAt),end=new Date(b.endsAt),reminder=b.remindAt?new Date(b.remindAt):null;if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||reminder&&(!Number.isFinite(reminder.getTime())||reminder>start))fail('Thời gian kết thúc phải sau bắt đầu; thời gian nhắc phải trước lịch hẹn');const team=b.teamId||null;if(!access(req,team,true))fail('Không có quyền ghi lịch hẹn của team',403);return {status:eventStatus(b.status,previousStatus),title:b.title.trim(),description:(b.description||'').trim(),team,start:start.toISOString(),end:end.toISOString(),reminder:reminder?.toISOString()||null}}
 app.get('/api/calendar-events',requireAuth,(req,res,next)=>{try{
  const events=db.prepare('SELECT * FROM calendar_events WHERE workspace_id=? ORDER BY starts_at').all(req.auth.workspaceId).filter(e=>access(req,e.team_id)).map(e=>({...e,canEdit:access(req,e.team_id,true)&&(e.created_by===req.auth.userId||['owner','admin'].includes(req.auth.role))}));
  // Project current renewal periods on read, so changes/renewals/archive cannot leave stale calendar rows.
  const renewals=db.prepare('SELECT * FROM service_contracts WHERE workspace_id=? AND archived_at IS NULL AND sync_calendar=1 ORDER BY next_date').all(req.auth.workspaceId).filter(s=>access(req,s.team_id)).map(s=>({
   id:`service:${s.id}`,service_id:s.id,workspace_id:s.workspace_id,team_id:s.team_id,title:`Gia hạn: ${s.name}`,
   description:`${s.provider ? `Nhà cung cấp: ${s.provider} · ` : ''}Chu kỳ: ${s.interval_count} ${s.cycle==='year'?'năm':'tháng'}. ${s.enabled ? `Nhắc trước ${s.remind_days} ngày.` : 'Đã tắt nhắc gia hạn.'}`,
   starts_at:`${s.next_date}T01:00:00.000Z`,ends_at:`${s.next_date}T02:00:00.000Z`,remind_at:null,status:'todo',canEdit:false
  }));
 res.json({events:[...events,...renewals].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))});
 }catch(e){next(e)}});
 app.get('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{const e=row(req);res.json({event:{...e,canEdit:access(req,e.team_id,true)&&(e.created_by===req.auth.userId||['owner','admin'].includes(req.auth.role))}})}catch(e){next(e)}});
 app.post('/api/calendar-events',requireAuth,(req,res,next)=>{try{ensureWritable(req);const v=input(req),id=createId('event_'),now=at();db.prepare('INSERT INTO calendar_events(id,workspace_id,team_id,title,description,starts_at,ends_at,remind_at,created_by,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,v.team,v.title,v.description,v.start,v.end,v.reminder,req.auth.userId,now,now,v.status);res.status(201).json({id})}catch(e){next(e)}});
 app.put('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{ensureWritable(req);const old=row(req);if(!access(req,old.team_id,true)||old.created_by!==req.auth.userId&&!['owner','admin'].includes(req.auth.role))fail('Bạn không có quyền sửa lịch hẹn',403);const v=input(req,old.status);db.prepare('UPDATE calendar_events SET team_id=?,title=?,description=?,starts_at=?,ends_at=?,remind_at=?,updated_at=?,status=? WHERE id=? AND workspace_id=?').run(v.team,v.title,v.description,v.start,v.end,v.reminder,at(),v.status,old.id,req.auth.workspaceId);res.json({ok:true})}catch(e){next(e)}});
 app.patch('/api/calendar-events/:id/status',requireAuth,(req,res,next)=>{try{
  ensureWritable(req);
  const old=row(req);
  if (!canEdit(req,old)) fail('Bạn không có quyền sửa lịch hẹn',403);
  if (req.body?.status === undefined) fail('Vui lòng chọn trạng thái');
  const status=eventStatus(req.body.status);
  db.prepare('UPDATE calendar_events SET status=?,updated_at=? WHERE id=? AND workspace_id=?').run(status,at(),old.id,req.auth.workspaceId);
  res.json({event:{...row(req),canEdit:true}});
 }catch(e){next(e)}});
 app.delete('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{ensureWritable(req);const old=row(req);if(!access(req,old.team_id,true)||old.created_by!==req.auth.userId&&!['owner','admin'].includes(req.auth.role))fail('Bạn không có quyền xóa lịch hẹn',403);db.prepare('DELETE FROM calendar_events WHERE id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);res.json({ok:true})}catch(e){next(e)}});
}
