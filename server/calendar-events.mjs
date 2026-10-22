import {readPage} from './read-page.mjs';
import {isValidCalendarDate} from '../shared/service-renewal.mjs';
import {addPlanningDays} from '../shared/week-planning.mjs';
import {createId} from './auth.mjs';
import {recordRevision,assertRevision} from './record-revision.mjs';
import {canAccessTeamTask} from './teams.mjs';
export function invalidateCalendarEventDeliveries(db,eventId,workspaceId){
 db.prepare(`UPDATE notification_outbox SET status='skipped',last_error='calendar schedule changed'
  WHERE status='pending' AND notification_id IN
  (SELECT id FROM notifications WHERE entity_id=? AND workspace_id=? AND type='calendar_event')`).run(eventId,workspaceId);
 db.prepare(`UPDATE notification_outbox_deliveries SET status='skipped',last_error='calendar schedule changed'
  WHERE status='pending' AND outbox_id IN
  (SELECT o.id FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id
   WHERE n.entity_id=? AND n.workspace_id=? AND n.type='calendar_event')`).run(eventId,workspaceId);
}
export function processEventReminders({db,clock}){const at=new Date(clock()).toISOString();let sent=0;for(const e of db.prepare(`SELECT e.* FROM calendar_events e JOIN workspaces w ON w.id=e.workspace_id JOIN subscriptions s ON s.workspace_id=w.id WHERE e.status<>'done' AND e.remind_at<=? AND e.ends_at>? AND w.suspended_at IS NULL AND s.status NOT IN ('expired','canceled') AND s.current_period_end>?`).all(at,at,at)){if(!canAccessTeamTask(db,e.workspace_id,e.created_by,e.team_id,{write:true})||!db.prepare('SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL').get(e.created_by))continue;db.exec('BEGIN');try{const result=db.prepare('INSERT INTO calendar_event_notices VALUES (?,?,?) ON CONFLICT DO NOTHING').run(e.id,e.created_by,e.remind_at);if(result.changes){db.prepare('INSERT INTO notifications(id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(createId('notice_'),e.workspace_id,e.created_by,'calendar_event',e.title,'Sắp đến lịch hẹn. Mở Công việc để xem chi tiết.','calendar_event',e.id,at);sent++}db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}return sent}
export function registerEventRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError}){
 const fail=(message,status=400)=>{throw new HttpError(status,message)},at=()=>new Date(clock()).toISOString();
 const access=(req,team,write=false)=>canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,team,{write});
 function row(req,write=false){const r=db.prepare(`SELECT * FROM calendar_events WHERE id=? AND workspace_id=?${write&&db.dialect==='postgres'?' FOR UPDATE':''}`).get(req.params.id,req.auth.workspaceId);if(!r||!access(req,r.team_id))fail('Không tìm thấy lịch hẹn',404);return r}
 const json=(req,e)=>({...e,revision:recordRevision(e,'event'),canEdit:canEdit(req,e)});
 function edit(req,change){return withTransaction(db,()=>{ensureWritable(req);const old=row(req,true);if(!canEdit(req,old))fail('Bạn không có quyền sửa lịch hẹn',403);assertRevision(req.body,old,'event',HttpError);return change(old);});}
 function eventStatus(value, fallback='todo') {
  if (value === undefined) return fallback;
  if (!['todo','doing','done'].includes(value)) fail('Trạng thái không hợp lệ');
  return value;
 }
 function canEdit(req, event) { return access(req,event.team_id,true) && (event.created_by===req.auth.userId || ['owner','admin'].includes(req.auth.role)); }
 function input(req, previousStatus='todo'){const b=req.body||{};if(typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof (b.description??'')!=='string'||(b.description||'').length>5000)fail('Tên hoặc mô tả không hợp lệ');const start=new Date(b.startsAt),end=new Date(b.endsAt),reminder=b.remindAt?new Date(b.remindAt):null;if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||reminder&&(!Number.isFinite(reminder.getTime())||reminder>start))fail('Thời gian kết thúc phải sau bắt đầu; thời gian nhắc phải trước lịch hẹn');const team=b.teamId||null;if(!access(req,team,true))fail('Không có quyền ghi lịch hẹn của team',403);return {status:eventStatus(b.status,previousStatus),title:b.title.trim(),description:(b.description||'').trim(),team,start:start.toISOString(),end:end.toISOString(),reminder:reminder?.toISOString()||null}}
 app.get('/api/calendar-events',requireAuth,(req,res,next)=>{try{
  if(Object.keys(req.query).length){
   const {page,pageSize,offset}=readPage(req.query,HttpError),q=req.query;
   if((q.from!==undefined||q.to!==undefined)&&(!isValidCalendarDate(q.from)||!isValidCalendarDate(q.to)||q.to<q.from))fail('Khoảng ngày không hợp lệ.');
   const member=db.prepare(`SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?${db.dialect==='postgres'?" AND member_type='member'":''}`).get(req.auth.workspaceId,req.auth.userId);
   const admin=['owner','admin'].includes(member?.role);
   const scope=alias=>`${alias}.workspace_id=? AND (?=1) AND (${alias}.team_id IS NULL OR ?=1 OR EXISTS(SELECT 1 FROM team_members mt WHERE mt.team_id=${alias}.team_id AND mt.workspace_id=${alias}.workspace_id AND mt.user_id=?))`;
   const scopeArgs=[req.auth.workspaceId,member?1:0,admin?1:0,req.auth.userId];
   const start=q.from?new Date(`${q.from}T00:00:00+07:00`).toISOString():null,end=q.to?new Date(`${addPlanningDays(q.to,1)}T00:00:00+07:00`).toISOString():null;
   const eventWhere=`${scope('e')}${start?' AND e.starts_at<? AND e.ends_at>?':''}${q.openOnly==='true'?" AND e.status<>'done'":''}`;
   const serviceWhere=`${scope('s')} AND s.archived_at IS NULL AND s.sync_calendar=1${start?" AND (s.next_date||'T01:00:00.000Z')<? AND (s.next_date||'T02:00:00.000Z')>?":''}`;
   const union=`SELECT 'event' kind,e.id,e.starts_at,e.status,e.team_id,(e.title||' '||e.description||' Lịch hẹn '||coalesce((SELECT name FROM teams WHERE id=e.team_id),'')) search_text FROM calendar_events e WHERE ${eventWhere}
     UNION ALL SELECT 'service' kind,s.id,(s.next_date||'T01:00:00.000Z') starts_at,'todo' status,s.team_id,(s.name||' '||coalesce(s.provider,'')||' Gia hạn dịch vụ '||coalesce((SELECT name FROM teams WHERE id=s.team_id),'')) search_text FROM service_contracts s WHERE ${serviceWhere}`;
   const args=[...scopeArgs,...(start?[end,start]:[]),...scopeArgs,...(start?[end,start]:[])];
   const conditions=[],filterArgs=[];
   if(q.kind!==undefined&&!['event','service','none'].includes(q.kind))fail('Loại lịch không hợp lệ.');
   if(q.kind){conditions.push('kind=?');filterArgs.push(q.kind);}
   if(q.teamId){if(q.teamId==='common')conditions.push('team_id IS NULL');else{conditions.push('team_id=?');filterArgs.push(String(q.teamId));}}
   if(q.q){conditions.push('lower(search_text) LIKE ?');filterArgs.push('%'+String(q.q).trim().toLowerCase().slice(0,200)+'%');}
   const now=at(),day=new Date(Date.parse(now)+7*3600000).toISOString().slice(0,10),dayStart=new Date(`${day}T00:00:00+07:00`).toISOString(),dayEnd=new Date(`${addPlanningDays(day,1)}T00:00:00+07:00`).toISOString();
   if(q.due!==undefined&&!['today','overdue'].includes(q.due))fail('Bộ lọc hạn không hợp lệ.');
   if(q.due==='today'){conditions.push('starts_at>=? AND starts_at<?');filterArgs.push(dayStart,dayEnd);}
   if(q.due==='overdue'){conditions.push('starts_at<?');filterArgs.push(now);}
   const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
   const total=Number(db.prepare(`SELECT count(*) n FROM (${union}) items${where}`).get(...args,...filterArgs).n);
   const selected=db.prepare(`SELECT * FROM (${union}) items${where} ORDER BY starts_at,kind,id LIMIT ? OFFSET ?`).all(...args,...filterArgs,pageSize,offset);
   // Counts stay independent of the current page/search. ACL is applied in SQL.
   const summaryRow=db.prepare(`SELECT sum(CASE WHEN status<>'done' THEN 1 ELSE 0 END) open,
     sum(CASE WHEN kind='event' AND status<>'done' THEN 1 ELSE 0 END) "eventOpen",
     sum(CASE WHEN kind='event' AND status<>'done' AND starts_at>=? AND starts_at<? THEN 1 ELSE 0 END) "eventToday",
     sum(CASE WHEN kind='event' AND status<>'done' AND starts_at<? THEN 1 ELSE 0 END) "eventOverdue"
     FROM (SELECT 'event' kind,e.starts_at,e.status FROM calendar_events e WHERE ${scope('e')}
       UNION ALL SELECT 'service' kind,(s.next_date||'T01:00:00.000Z') starts_at,'todo' status FROM service_contracts s WHERE ${scope('s')} AND s.archived_at IS NULL AND s.sync_calendar=1) items`)
     .get(dayStart,dayEnd,now,...scopeArgs,...scopeArgs);
   const summary=Object.fromEntries(Object.entries(summaryRow).map(([key,value])=>[key,Number(value||0)]));
   const eventIds=selected.filter(e=>e.kind==='event').map(e=>e.id),serviceIds=selected.filter(e=>e.kind==='service').map(e=>e.id);
   const events=eventIds.length?db.prepare(`SELECT e.*,tm.archived_at AS team_archived FROM calendar_events e LEFT JOIN teams tm ON tm.id=e.team_id AND tm.workspace_id=e.workspace_id WHERE e.workspace_id=? AND e.id IN (${eventIds.map(()=>'?').join(',')})`).all(req.auth.workspaceId,...eventIds).map(({team_archived,...e})=>({...e,revision:recordRevision(e,'event'),canEdit:!team_archived&&(e.created_by===req.auth.userId||admin)})):[];
   const renewals=serviceIds.length?db.prepare(`SELECT * FROM service_contracts WHERE workspace_id=? AND id IN (${serviceIds.map(()=>'?').join(',')})`).all(req.auth.workspaceId,...serviceIds).map(s=>({
    id:`service:${s.id}`,service_id:s.id,workspace_id:s.workspace_id,team_id:s.team_id,title:`Gia hạn: ${s.name}`,
    description:`${s.provider ? `Nhà cung cấp: ${s.provider} · ` : ''}Chu kỳ: ${s.interval_count} ${s.cycle==='year'?'năm':'tháng'}. ${s.enabled ? `Nhắc trước ${s.remind_days} ngày.` : 'Đã tắt nhắc gia hạn.'}`,
    starts_at:`${s.next_date}T01:00:00.000Z`,ends_at:`${s.next_date}T02:00:00.000Z`,remind_at:null,status:'todo',canEdit:false
   })):[];
   return res.json({events:[...events,...renewals].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id)),page,pageSize,total,summary,hasMore:offset+selected.length<total});
  }
  const events=db.prepare('SELECT * FROM calendar_events WHERE workspace_id=? ORDER BY starts_at').all(req.auth.workspaceId).filter(e=>access(req,e.team_id)).map(e=>json(req,e));
  // Project current renewal periods on read, so changes/renewals/archive cannot leave stale calendar rows.
  const renewals=db.prepare('SELECT * FROM service_contracts WHERE workspace_id=? AND archived_at IS NULL AND sync_calendar=1 ORDER BY next_date').all(req.auth.workspaceId).filter(s=>access(req,s.team_id)).map(s=>({
   id:`service:${s.id}`,service_id:s.id,workspace_id:s.workspace_id,team_id:s.team_id,title:`Gia hạn: ${s.name}`,
   description:`${s.provider ? `Nhà cung cấp: ${s.provider} · ` : ''}Chu kỳ: ${s.interval_count} ${s.cycle==='year'?'năm':'tháng'}. ${s.enabled ? `Nhắc trước ${s.remind_days} ngày.` : 'Đã tắt nhắc gia hạn.'}`,
   starts_at:`${s.next_date}T01:00:00.000Z`,ends_at:`${s.next_date}T02:00:00.000Z`,remind_at:null,status:'todo',canEdit:false
  }));
 res.json({events:[...events,...renewals].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))});
 }catch(e){next(e)}});
 app.get('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{res.json({event:json(req,row(req))})}catch(e){next(e)}});
 app.post('/api/calendar-events',requireAuth,(req,res,next)=>{try{ensureWritable(req);const v=input(req),id=createId('event_'),now=at();db.prepare('INSERT INTO calendar_events(id,workspace_id,team_id,title,description,starts_at,ends_at,remind_at,created_by,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.auth.workspaceId,v.team,v.title,v.description,v.start,v.end,v.reminder,req.auth.userId,now,now,v.status);res.status(201).json({id})}catch(e){next(e)}});
 app.put('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{edit(req,old=>{
  const v=input(req,old.status);
  db.prepare('UPDATE calendar_events SET team_id=?,title=?,description=?,starts_at=?,ends_at=?,remind_at=?,updated_at=?,status=? WHERE id=? AND workspace_id=?').run(v.team,v.title,v.description,v.start,v.end,v.reminder,at(),v.status,old.id,req.auth.workspaceId);
  if(old.team_id!==v.team||old.starts_at!==v.start||old.ends_at!==v.end||old.remind_at!==v.reminder){
   // Match browser-push invalidation inside the same edit transaction. Old
   // mobile deliveries must not survive a cancellation or schedule change.
   invalidateCalendarEventDeliveries(db,old.id,req.auth.workspaceId);
  }
 });res.json({ok:true})}catch(e){next(e)}});
 app.patch('/api/calendar-events/:id/status',requireAuth,(req,res,next)=>{try{
  const event=edit(req,old=>{
  if (req.body?.status === undefined) fail('Vui lòng chọn trạng thái');
  const status=eventStatus(req.body.status);
  db.prepare('UPDATE calendar_events SET status=?,updated_at=? WHERE id=? AND workspace_id=?').run(status,at(),old.id,req.auth.workspaceId);
  return json(req,row(req));
  });
  res.json({event});
 }catch(e){next(e)}});
 app.delete('/api/calendar-events/:id',requireAuth,(req,res,next)=>{try{ensureWritable(req);const old=row(req);if(!access(req,old.team_id,true)||old.created_by!==req.auth.userId&&!['owner','admin'].includes(req.auth.role))fail('Bạn không có quyền xóa lịch hẹn',403);db.prepare('DELETE FROM calendar_events WHERE id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);res.json({ok:true})}catch(e){next(e)}});
}
