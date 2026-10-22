import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createId } from './auth.mjs';
import { withTransaction } from './db.mjs';
import { canAccessTask } from './task-access.mjs';
import { canAccessTeamTask } from './teams.mjs';
import { hasWorkspaceEntitlement } from './entitlements.mjs';
import { recordRevision } from './record-revision.mjs';
import { withMutationContext, mutationFingerprint } from './task-mutation-pipeline.mjs';
import { outboundSendersPaused } from './restore-safety.mjs';
import { googleCalendarTransport } from './google-calendar-transport.mjs';
import { isValidCalendarDate } from '../shared/service-renewal.mjs';
import { invalidateCalendarEventDeliveries } from './calendar-events.mjs';

const kinds = ['personal','deadline','appointment','renewal'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
const parse = (value, fallback=null) => value ? JSON.parse(value) : fallback;
const addDay = day => new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const instant = value => typeof value==='string' && isValidCalendarDate(value.slice(0,10)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const localTime = value => new Date(Date.parse(value)+7*3600000).toISOString();
const equal = (a,b) => json(a)===json(b);

export function googleEventValue(kind,event) {
  if (kind==='renewal') return null;
  if (kind==='personal' && event.start?.date) {
    const day=event.start.date;
    if(!isValidCalendarDate(day)||event.end?.date!==addDay(day)) throw new Error('Kế hoạch cả ngày phải nằm trong một ngày.');
    return {plannedDate:day,plannedTime:null,plannedDuration:60};
  }
  const start=instant(event.start?.dateTime),end=instant(event.end?.dateTime);
  if(!start||!end||end<=start) throw new Error('Cần thời gian có múi giờ; hạn chỉ có ngày chưa được hỗ trợ.');
  if(kind==='deadline') return {dueAt:start};
  if(kind==='personal') {
    const local=localTime(start),duration=(Date.parse(end)-Date.parse(start))/60000;
    if(!Number.isInteger(duration)||duration<15||duration>1440||Number(local.slice(11,13))*60+Number(local.slice(14,16))+duration>1440)
      throw new Error('Kế hoạch phải dài 15–1440 phút và kết thúc trong cùng ngày Việt Nam.');
    return {plannedDate:local.slice(0,10),plannedTime:local.slice(11,16),plannedDuration:duration};
  }
  if(typeof event.summary!=='string'||!event.summary.trim()||event.summary.length>200||typeof (event.description??'')!=='string'||(event.description||'').length>5000)
    throw new Error('Tên hoặc mô tả lịch hẹn không hợp lệ.');
  return {title:event.summary.trim(),description:event.description||'',startsAt:start,endsAt:end};
}

export function registerGoogleCalendar(app, {db,config,clock,requireAuth,requirePlatformAdmin,ensureWritable,HttpError,
  writeStoredSetting,loadStoredSettings,settingsKey,recordTaskActivity,writeAdminAudit,transport}) {
  if(db.dialect!=='postgres') return;
  const now=()=>new Date(clock()).toISOString();
  const fail=(status,message)=>{throw new HttpError(status,message);};
  const settings=()=>parse(loadStoredSettings(db,settingsKey).get('googleCalendar'),{enabled:false,clientId:'',clientSecret:''});
  const callback=()=>new URL('/api/integrations/google-calendar/callback',config.publicAppUrl).href;
  const watchUrl=()=>new URL('/api/integrations/google-calendar/watch',config.publicAppUrl).href;
  const tokenKey=id=>'googleCalendarTokens:'+id;
  const tokens=id=>parse(loadStoredSettings(db,settingsKey).get(tokenKey(id)));
  const saveTokens=(id,value)=>writeStoredSetting(db,tokenKey(id),value,{encrypted:true,keyBytes:settingsKey,updatedAt:now()});
  const provider=c=>transport||googleCalendarTransport(settings(),callback(),refresh=>{
    if(active(c)) saveTokens(c.id,{...tokens(c.id),...refresh});
  });
  const current=id=>db.prepare('SELECT * FROM google_calendar_connections WHERE id=?').get(id);
  const own=req=>db.prepare('SELECT * FROM google_calendar_connections WHERE workspace_id=? AND user_id=?').get(req.auth.workspaceId,req.auth.userId);
  const entitled=(workspace,user)=>!!db.prepare(`SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.user_id
    WHERE wm.workspace_id=? AND wm.user_id=? AND u.disabled_at IS NULL AND wm.member_type='member'`).get(workspace,user)
    &&hasWorkspaceEntitlement(db,config,workspace,'google_calendar',clock);
  const oauthAuthorized=state=>settings().enabled&&entitled(state.workspace_id,state.user_id)&&!!db.prepare(
    'SELECT 1 FROM sessions WHERE id=? AND user_id=? AND workspace_id=? AND expires_at>?')
    .get(state.session_id,state.user_id,state.workspace_id,now());
  const active=c=>{
    const fresh=current(c.id);
    return !!(fresh&&fresh.status==='active'&&fresh.generation===c.generation&&settings().enabled&&entitled(fresh.workspace_id,fresh.user_id)&&!outboundSendersPaused(db));
  };
  const assertActive=c=>{if(!active(c))fail(409,'Kết nối hoặc quyền Google Calendar đã thay đổi.');};
  const safeConnection=c=>c?{id:c.id,status:c.status,calendarId:c.calendar_id,enabledKinds:parse(c.enabled_json,[]),lastSuccessAt:c.last_success_at,error:c.last_error}:null;
  function enqueue(c,kind,id) {
    db.prepare(`INSERT INTO google_calendar_jobs(connection_id,kind,source_id) VALUES(?,?,?)
      ON CONFLICT(connection_id,kind,source_id) DO UPDATE SET revision=google_calendar_jobs.revision+1,attempts=0,next_attempt_at=NULL,last_error=NULL`).run(c.id,kind,id);
  }
  function enqueueAll(c) {
    for(const [table,types] of [['tasks',['personal','deadline']],['calendar_events',['appointment']],['service_contracts',['renewal']]])
      for(const row of db.prepare(`SELECT id FROM ${table} WHERE workspace_id=?`).all(c.workspace_id)) for(const kind of types)enqueue(c,kind,row.id);
    for(const row of db.prepare('SELECT kind,source_id FROM google_calendar_mappings WHERE connection_id=?').all(c.id))enqueue(c,row.kind,row.source_id);
  }
  function source(c,kind,id,{write=false,lock=false}={}) {
    if(!entitled(c.workspace_id,c.user_id))return null;
    if(['personal','deadline'].includes(kind)) {
      const task=db.prepare(`SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL${lock?' FOR UPDATE':''}`).get(id,c.workspace_id);
      if(!task||!canAccessTask(db,c.workspace_id,c.user_id,task,{write}))return null;
      if(kind==='deadline') return task.due_at?{row:task,value:{dueAt:task.due_at},revision:recordRevision(task,'task'),title:task.title}:null;
      const personal=task.assignee_id===c.user_id||!!db.prepare('SELECT 1 FROM task_assignees WHERE task_id=? AND user_id=?').get(id,c.user_id)||(!task.assignee_id&&task.created_by===c.user_id&&!db.prepare('SELECT 1 FROM task_assignees WHERE task_id=?').get(id));
      if(!personal)return null;
      const plan=db.prepare('SELECT * FROM personal_task_plans WHERE task_id=? AND user_id=?').get(id,c.user_id);
      if(!plan)return null;
      const value={plannedDate:plan.planned_date,plannedTime:plan.start_time||null,plannedDuration:plan.duration_minutes||60};
      const revision=hash(json([id,c.user_id,db.prepare('SELECT revision FROM personal_plan_revisions WHERE task_id=? AND user_id=?').get(id,c.user_id)?.revision||0,value]));
      return {row:task,value,revision,title:task.title};
    }
    const table=kind==='appointment'?'calendar_events':'service_contracts';
    const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=?${lock?' FOR UPDATE':''}`).get(id,c.workspace_id);
    if(!row||row.archived_at||!canAccessTeamTask(db,c.workspace_id,c.user_id,row.team_id,{write}))return null;
    if(kind==='appointment') {
      const role=db.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?').get(c.workspace_id,c.user_id)?.role;
      if(write&&row.created_by!==c.user_id&&!['owner','admin'].includes(role))return null;
      return {row,revision:recordRevision(row,'event'),title:row.title,value:{title:row.title,description:row.description,startsAt:row.starts_at,endsAt:row.ends_at}};
    }
    return row.sync_calendar?{row,revision:recordRevision(row,'service'),title:'Gia hạn: '+row.name,value:{date:row.next_date}}:null;
  }
  function eventFor(c,kind,id,s,eventId) {
    const e={id:eventId,summary:(kind==='personal'?'Kế hoạch: ':kind==='deadline'?'Hạn: ':'')+s.title,
      description:kind==='appointment'?s.value.description:'',transparency:kind==='deadline'?'transparent':'opaque',reminders:{useDefault:false,overrides:[]},
      extendedProperties:{private:{nhactoiMapping:hash(json([c.id,kind,id]))}}};
    if(kind==='personal'&&!s.value.plannedTime) {e.start={date:s.value.plannedDate};e.end={date:addDay(s.value.plannedDate)};}
    else if(kind==='renewal') {e.start={date:s.value.date};e.end={date:addDay(s.value.date)};e.transparency='transparent';}
    else {
      const start=kind==='deadline'?s.value.dueAt:kind==='personal'?new Date(`${s.value.plannedDate}T${s.value.plannedTime}:00+07:00`).toISOString():s.value.startsAt;
      const end=kind==='appointment'?s.value.endsAt:new Date(Date.parse(start)+(kind==='deadline'?15:s.value.plannedDuration)*60000).toISOString();
      e.start={dateTime:start,timeZone:'Asia/Ho_Chi_Minh'};e.end={dateTime:end,timeZone:'Asia/Ho_Chi_Minh'};
    }
    return e;
  }
  function mapping(c,kind,id) {
    let row=db.prepare('SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind=? AND source_id=?').get(c.id,kind,id);
    if(!row) {
      const mid=createId('gmap_'),eventId=hash(json([c.id,kind,id]));
      db.prepare('INSERT INTO google_calendar_mappings(id,connection_id,workspace_id,kind,source_id,event_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
        .run(mid,c.id,c.workspace_id,kind,id,eventId,now());
      row=db.prepare('SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind=? AND source_id=?').get(c.id,kind,id);
    }
    return row;
  }
  function conflict(m,event,s,message='Hai phía cùng thay đổi. Hãy chọn dữ liệu cần giữ.') {
    db.prepare("UPDATE google_calendar_mappings SET state='conflict',conflict_json=?,last_error=?,updated_at=? WHERE id=?")
      .run(json({event,server:s?.value||null,revision:s?.revision||null}),message,now(),m.id);
  }
  function updateBase(m,event,s) {
    db.prepare("UPDATE google_calendar_mappings SET state='synced',etag=?,base_revision=?,base_json=?,conflict_json=NULL,last_error=NULL,updated_at=? WHERE id=?")
      .run(event.etag,s.revision,json(s.value),now(),m.id);
  }
  function apply(c,m,value,event) {
    const s=source(c,m.kind,m.source_id,{write:true,lock:true});
    if(!s)fail(403,'Bạn không còn quyền sửa dữ liệu này.');
    const operationId='google:'+hash(json([m.id,event.etag,event.status||'',value]));
    if(db.prepare('SELECT 1 FROM mutation_receipts WHERE workspace_id=? AND principal_id=? AND operation_id=?').get(c.workspace_id,c.user_id,operationId))return;
    withMutationContext(db,{actorUserId:c.user_id,source:'google_calendar',operationId,occurredAt:now()},()=>{
      if(m.kind==='deadline') {
        if(s.row.start_at&&s.row.start_at>value.dueAt)fail(400,'Hạn hoàn thành phải sau ngày bắt đầu.');
        db.prepare('UPDATE tasks SET due_at=?,recurrence_anchor=?,updated_at=? WHERE id=? AND workspace_id=?')
          .run(value.dueAt,s.row.recurrence==='none'?null:value.dueAt,now(),m.source_id,c.workspace_id);
        recordTaskActivity(db,{taskId:m.source_id,actorUserId:c.user_id,action:'task_updated',summary:'đã đổi hạn hoàn thành từ Google Calendar',createdAt:now()});
      } else if(m.kind==='personal') {
        if(value===null)db.prepare('DELETE FROM personal_task_plans WHERE task_id=? AND user_id=?').run(m.source_id,c.user_id);
        else db.prepare(`INSERT INTO personal_task_plans(task_id,user_id,planned_date,start_time,duration_minutes) VALUES(?,?,?,?,?) ON CONFLICT(task_id,user_id)
          DO UPDATE SET planned_date=excluded.planned_date,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes`)
          .run(m.source_id,c.user_id,value.plannedDate,value.plannedTime,value.plannedDuration);
      } else if(m.kind==='appointment') {
        if(s.row.remind_at&&s.row.remind_at>value.startsAt)fail(400,'Thời gian nhắc phải trước lịch hẹn. Hãy sửa lịch nhắc trước khi áp dụng thời gian từ Google.');
        db.prepare('UPDATE calendar_events SET title=?,description=?,starts_at=?,ends_at=?,updated_at=? WHERE id=? AND workspace_id=?')
          .run(value.title,value.description,value.startsAt,value.endsAt,now(),m.source_id,c.workspace_id);
        if(s.row.starts_at!==value.startsAt||s.row.ends_at!==value.endsAt)invalidateCalendarEventDeliveries(db,m.source_id,c.workspace_id);
      }
      db.prepare('INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at) VALUES(?,?,?,?,?,?,200,?,?)')
        .run(c.workspace_id,c.user_id,operationId,'google_calendar.'+m.kind,m.source_id,mutationFingerprint(value),json({ok:true}),now());
    });
  }
  function inbound(c,event) {
    return withTransaction(db,()=>{
      assertActive(c);
      const m=db.prepare('SELECT * FROM google_calendar_mappings WHERE connection_id=? AND event_id=? FOR UPDATE').get(c.id,event.id);
      if(!m||!parse(c.enabled_json,[]).includes(m.kind)||['suppressed','removed'].includes(m.state)||m.etag===event.etag)return;
      const s=source(c,m.kind,m.source_id,{lock:true});
      if(!s)return;
      if(event.status==='cancelled') {
        if(m.kind==='personal') {
          if(m.base_revision&&m.base_revision!==s.revision){conflict(m,event,s);return;}
          apply(c,m,null,event);
        }
        db.prepare("UPDATE google_calendar_mappings SET state='suppressed',etag=?,conflict_json=NULL,last_error=NULL,updated_at=? WHERE id=?").run(event.etag||null,now(),m.id);return;
      }
      if(m.kind==='renewal') {enqueue(c,m.kind,m.source_id);return;}
      if(event.recurrence?.length){conflict(m,event,s,'Không đồng bộ RRULE từ Google. Mỗi kỳ công việc dùng một sự kiện riêng.');return;}
      let remote;try{remote=googleEventValue(m.kind,event);}catch(e){conflict(m,event,s,e.message);return;}
      const base=parse(m.base_json);
      if(!base) { // Provider accepted create before our response was persisted.
        if(equal(remote,s.value))updateBase(m,event,s);else conflict(m,event,s);return;
      }
      const changed=Object.keys(remote).filter(key=>!equal(remote[key],base[key]));
      if(!changed.length){db.prepare('UPDATE google_calendar_mappings SET etag=? WHERE id=?').run(event.etag,m.id);return;}
      if(changed.some(key=>!equal(s.value[key],base[key])&&!equal(s.value[key],remote[key]))) {conflict(m,event,s);return;}
      const merged={...s.value,...Object.fromEntries(changed.map(key=>[key,remote[key]]))};
      try {if(!equal(merged,s.value))withTransaction(db,()=>apply(c,m,merged,event));}
      catch(error){conflict(m,event,s,error instanceof HttpError?error.message:'Không thể áp dụng thay đổi; dữ liệu đã được giữ.');return;}
      const updated=source(c,m.kind,m.source_id);
      updateBase(m,event,updated);enqueue(c,m.kind,m.source_id);
    });
  }
  async function remoteEvent(p,c,id) {
    try{return await p.getEvent(tokens(c.id),c.calendar_id,id);}catch(e){if(e.status===404||e.status===410)return null;throw e;}
  }
  async function outbound(c,job,checkLease) {
    checkLease();assertActive(c);
    const m=mapping(c,job.kind,job.source_id);
    const s=parse(c.enabled_json,[]).includes(job.kind)?source(c,job.kind,job.source_id):null,p=provider(c);
    if(!s) {
      if(m.etag&&m.state!=='removed') {
        try{await p.deleteEvent(tokens(c.id),c.calendar_id,m.event_id,m.etag);}catch(e){if(![404,410].includes(e.status))throw e;}
        checkLease();assertActive(c);
      }
      db.prepare("UPDATE google_calendar_mappings SET state='removed',updated_at=? WHERE id=?").run(now(),m.id);return true;
    }
    if(['suppressed','conflict'].includes(m.state))return true;
    const existing=await remoteEvent(p,c,m.event_id);checkLease();assertActive(c);
    if(existing&&existing.etag!==m.etag) {
      inbound(c,existing);
      const refreshed=db.prepare('SELECT * FROM google_calendar_mappings WHERE id=?').get(m.id);
      if(['suppressed','conflict'].includes(refreshed.state))return true;
      Object.assign(m,refreshed);
    }
    const latest=source(c,job.kind,job.source_id);
    if(!latest)return false;
    const body=eventFor(c,job.kind,job.source_id,latest,m.event_id);
    // Read-before-create and a stable Google-valid ID make ambiguous creates reconcilable.
    let event;
    const scheduleMatches=existing&&(body.start.date ? existing.start?.date===body.start.date&&existing.end?.date===body.end.date : instant(existing.start?.dateTime)===instant(body.start.dateTime)&&instant(existing.end?.dateTime)===instant(body.end.dateTime));
    if(existing&&scheduleMatches&&equal(parse(m.base_json),latest.value)&&existing.summary===body.summary&&existing.description===body.description&&existing.reminders?.useDefault===false&&existing.transparency===body.transparency) event=existing;
    else {
      checkLease();assertActive(c);
      try {event=existing?await p.patchEvent(tokens(c.id),c.calendar_id,m.event_id,body,existing.etag):await p.createEvent(tokens(c.id),c.calendar_id,body);}
      catch(e){if(e.status===409){event=await remoteEvent(p,c,m.event_id);if(!event)throw e;checkLease();assertActive(c);inbound(c,event);return false;}else if(e.status===412){const remote=await remoteEvent(p,c,m.event_id);conflict(m,remote,latest);return true;}else throw e;}
    }
    checkLease();assertActive(c);
    // A concurrent local edit stays queued by the dirty revision and is sent next.
    updateBase(m,event,latest);return true;
  }
  async function syncConnection(connectionId) {
    let c=current(connectionId);if(!c||!active(c)||c.next_attempt_at&&c.next_attempt_at>now())return {skipped:true};
    const lease=randomUUID(),expires=()=>new Date(Date.parse(now())+120000).toISOString();
    const claimed=db.prepare(`UPDATE google_calendar_connections SET lease_token=?,lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<=?) RETURNING id`).get(lease,expires(),c.id,now());
    if(!claimed)return {skipped:true};c=current(c.id);
    const checkLease=()=>{
      if(!db.prepare('UPDATE google_calendar_connections SET lease_until=? WHERE id=? AND lease_token=? AND lease_until>?').run(expires(),c.id,lease,now()).changes)fail(409,'Phiên đồng bộ đã được thay thế.');
    };
    try {
      const p=provider(c);let syncToken=c.sync_token,pageToken,finalToken,restarted=false;
      // Full resync never clears mappings or their suppression tombstones.
      while (true) {
        checkLease();assertActive(c);let page;
        try{page=await p.listEvents(tokens(c.id),c.calendar_id,{syncToken,pageToken});}
        catch(e){if(e.status===410&&!restarted){syncToken=null;pageToken=undefined;restarted=true;continue;}throw e;}
        checkLease();assertActive(c);
        for(const event of page.items||[])inbound(c,event);
        pageToken=page.nextPageToken;finalToken=page.nextSyncToken;
        if(!pageToken)break;
      }
      if(!finalToken)throw new Error('Missing final sync token');
      checkLease();assertActive(c);
      db.prepare('UPDATE google_calendar_connections SET sync_token=?,sync_processed=? WHERE id=? AND lease_token=?').run(finalToken,c.sync_requested,c.id,lease);
      for(const job of db.prepare('SELECT * FROM google_calendar_jobs WHERE connection_id=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY kind,source_id LIMIT 100').all(c.id,now())) {
        try {
          if(await outbound(c,job,checkLease))db.prepare('DELETE FROM google_calendar_jobs WHERE connection_id=? AND kind=? AND source_id=? AND revision=?').run(c.id,job.kind,job.source_id,job.revision);
        }catch(e){
          if(e.invalidGrant||e.status===401)throw e;
          const attempts=job.attempts+1,terminal=attempts>=5||e.status>=400&&e.status<500&&![408,429].includes(e.status);
          const reason=e.status?`Google HTTP ${e.status}`:'Kết quả chưa rõ; lần sau đối soát cùng event ID.';
          db.prepare('UPDATE google_calendar_jobs SET attempts=?,next_attempt_at=?,last_error=? WHERE connection_id=? AND kind=? AND source_id=? AND revision=?')
            .run(attempts,terminal?'9999-12-31T00:00:00.000Z':new Date(Date.parse(now())+Math.min(3600000,30000*2**(attempts-1))).toISOString(),reason,c.id,job.kind,job.source_id,job.revision);
          db.prepare("UPDATE google_calendar_mappings SET state=?,last_error=? WHERE connection_id=? AND kind=? AND source_id=? AND state NOT IN ('suppressed','conflict')")
            .run(terminal?'failed':'unknown',reason,c.id,job.kind,job.source_id);
        }
      }
      checkLease();assertActive(c);
      if(!c.channel_expires_at||Date.parse(c.channel_expires_at)<Date.parse(now())+3600000) {
        const channelId=randomUUID(),token=randomBytes(32).toString('base64url');
        // Persist channel identity before watch: the first callback may arrive first.
        db.prepare('UPDATE google_calendar_connections SET channel_id=?,channel_token_hash=?,channel_resource=NULL,channel_sequence=NULL WHERE id=? AND lease_token=?').run(channelId,hash(token),c.id,lease);
        const watch=await p.watch(tokens(c.id),c.calendar_id,{id:channelId,type:'web_hook',address:watchUrl(),token,params:{ttl:'604800'}});
        checkLease();assertActive(c);
        db.prepare('UPDATE google_calendar_connections SET channel_resource=?,channel_expires_at=? WHERE id=? AND channel_id=? AND lease_token=?')
          .run(watch.resourceId,new Date(Number(watch.expiration)).toISOString(),c.id,channelId,lease);
      }
      const pending=db.prepare('SELECT count(*) n FROM google_calendar_jobs WHERE connection_id=?').get(c.id).n;
      const conflicts=db.prepare("SELECT count(*) n FROM google_calendar_mappings WHERE connection_id=? AND state='conflict'").get(c.id).n;
      db.prepare('UPDATE google_calendar_connections SET last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,last_error=?,next_attempt_at=NULL WHERE id=? AND lease_token=?')
        .run(pending+conflicts,now(),pending||conflicts?'Còn thay đổi đang chờ hoặc cần xử lý xung đột.':null,c.id,lease);
      return {ok:pending===0&&conflicts===0,pending,conflicts};
    }catch(e){
      const revoked=e.invalidGrant||[401,403,404].includes(e.status);
      db.prepare('UPDATE google_calendar_connections SET status=?,last_error=?,next_attempt_at=? WHERE id=? AND lease_token=? AND generation=?')
        .run(revoked?'reconnect':'active',revoked?'Cần kết nối lại Google Calendar.':'Đồng bộ chưa hoàn tất; dữ liệu và mốc đồng bộ đã được giữ.',new Date(Date.parse(now())+60000).toISOString(),c.id,lease,c.generation);
      return {ok:false};
    }finally{db.prepare('UPDATE google_calendar_connections SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(c.id,lease);}
  }
  app.locals.processGoogleCalendar=async()=>{
    if(!settings().enabled||outboundSendersPaused(db))return;
    for(const c of db.prepare("SELECT id FROM google_calendar_connections WHERE status='active' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY updated_at LIMIT 50").all(now()))await syncConnection(c.id);
  };
  app.get('/api/admin/google-calendar',requirePlatformAdmin,(req,res)=>{const s=settings();res.json({enabled:!!s.enabled,clientId:s.clientId||'',hasSecret:!!s.clientSecret,redirectUri:callback(),watchUrl:watchUrl()});});
  app.put('/api/admin/google-calendar',requirePlatformAdmin,(req,res)=>{
    const b=req.body||{},old=settings();
    if(typeof b.enabled!=='boolean'||typeof b.clientId!=='string'||b.clientId.length>300||b.clientSecret!==undefined&&(typeof b.clientSecret!=='string'||b.clientSecret.length>1000))fail(400,'Cấu hình Calendar không hợp lệ.');
    const value={enabled:b.enabled,clientId:b.clientId.trim(),clientSecret:b.clientSecret||old.clientSecret||''};
    if(value.enabled&&(!value.clientId||!value.clientSecret||!callback().startsWith('https://')&&config.env.NODE_ENV!=='test'))fail(400,'Cần OAuth client, secret và callback HTTPS.');
    if(typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500)fail(400,'Cần ghi lý do thay đổi cấu hình.');
    withTransaction(db,()=>{
      writeStoredSetting(db,'googleCalendar',value,{encrypted:true,keyBytes:settingsKey,updatedAt:now()});
      writeAdminAudit(db,{actorUserId:req.auth.userId,action:'google_calendar.configure',targetType:'settings',targetId:'googleCalendar',reason:b.reason.trim(),before:{enabled:!!old.enabled},after:{enabled:value.enabled,clientId:value.clientId,secretChanged:!!b.clientSecret},createdAt:now()});
    });res.json({ok:true});
  });
  app.get('/api/integrations/google-calendar',requireAuth,(req,res)=>{
    const c=own(req);
    const mappings=c?db.prepare('SELECT * FROM google_calendar_mappings WHERE connection_id=? ORDER BY updated_at DESC LIMIT 200').all(c.id)
      .filter(m=>source(c,m.kind,m.source_id)).map(m=>({id:m.id,kind:m.kind,sourceId:m.source_id,eventId:m.event_id,state:m.state,error:m.last_error,conflict:parse(m.conflict_json)})):[];
    res.json({configured:!!settings().enabled,connection:safeConnection(c),mappings});
  });
  app.post('/api/integrations/google-calendar/start',requireAuth,(req,res)=>{
    ensureWritable(req);if(!settings().enabled||!entitled(req.auth.workspaceId,req.auth.userId))fail(403,'Google Calendar chưa được bật hoặc bạn không có quyền.');
    if(['needs_review','connecting','disconnecting'].includes(own(req)?.status))fail(409,'Kết nối đang được xử lý hoặc cần kiểm tra lịch Google trước khi kết nối lại.');
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    db.prepare('DELETE FROM google_calendar_states WHERE expires_at<=?').run(now());
    db.prepare('INSERT INTO google_calendar_states(state_hash,user_id,workspace_id,session_id,callback_uri,verifier,expires_at) VALUES(?,?,?,?,?,?,?)')
      .run(hash(state),req.auth.userId,req.auth.workspaceId,req.auth.sessionId,callback(),verifier,new Date(Date.parse(now())+600000).toISOString());
    res.json({url:provider({}).authUrl({state,challenge:createHash('sha256').update(verifier).digest('base64url')})});
  });
  app.get('/api/integrations/google-calendar/callback',requireAuth,async(req,res,next)=>{
    try {
      const state=withTransaction(db,()=>db.prepare('DELETE FROM google_calendar_states WHERE state_hash=? RETURNING *').get(hash(String(req.query.state||''))));
      if(!state||state.expires_at<=now()||state.user_id!==req.auth.userId||state.workspace_id!==req.auth.workspaceId||state.session_id!==req.auth.sessionId||state.callback_uri!==callback()||typeof req.query.code!=='string')fail(400,'OAuth state không hợp lệ hoặc đã hết hạn.');
      ensureWritable(req);if(!settings().enabled||!entitled(state.workspace_id,state.user_id))fail(403,'Không có quyền kết nối Calendar.');
      const p=provider({}),identity=await p.exchange(req.query.code,state.verifier);
      if(!oauthAuthorized(state))fail(403,'Phiên hoặc quyền kết nối đã thay đổi.');
      const c=withTransaction(db,()=>{
        // Serialize callbacks even before a connection exists; only one may create the app calendar.
        db.prepare('SELECT user_id FROM workspace_members WHERE workspace_id=? AND user_id=? FOR UPDATE').get(state.workspace_id,state.user_id);
        if(!oauthAuthorized(state))fail(403,'Phiên hoặc quyền kết nối đã thay đổi.');
        const previous=own(req);
        if(previous&&['connecting','needs_review','disconnecting'].includes(previous.status))fail(409,'Kết nối đang được xử lý hoặc cần kiểm tra lịch Google.');
        if(previous?.account_id&&previous.account_id!==identity.accountId&&previous.calendar_id)fail(409,'Hãy chọn lại tài khoản Google đã tạo lịch này. Ngắt kết nối vẫn giữ liên kết với lịch cũ; không thể gắn lịch đó với tài khoản khác.');
        const id=previous?.id||createId('gcal_');
        db.prepare(`INSERT INTO google_calendar_connections(id,workspace_id,user_id,account_id,created_at,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(workspace_id,user_id) DO UPDATE SET account_id=excluded.account_id,status='connecting',generation=google_calendar_connections.generation+1,updated_at=excluded.updated_at`).run(id,state.workspace_id,state.user_id,identity.accountId,now(),now());
        saveTokens(id,{...tokens(id),...identity.tokens});return current(id);
      });
      const id=c.id;
      let calendarId=c.calendar_id;
      if(!calendarId) {
        try{calendarId=(await p.createCalendar(tokens(id))).id;}
        catch{db.prepare("UPDATE google_calendar_connections SET status='needs_review',last_error='Chưa rõ việc tạo lịch. Kiểm tra tài khoản Google trước khi kết nối lại.' WHERE id=? AND generation=? AND status='connecting'").run(id,c.generation);fail(502,'Chưa rõ việc tạo lịch Google. Cần kiểm tra trước khi thử lại.');}
      }
      // Provider creation cannot be rolled back. Preserve its known identity
      // even if consent/session rights changed while the request was in flight.
      // A newer disconnect stays inactive and can safely reuse this calendar.
      if(calendarId)withTransaction(db,()=>{
        const fresh=db.prepare('SELECT * FROM google_calendar_connections WHERE id=? FOR UPDATE').get(id);
        if(!fresh||fresh.account_id!==c.account_id||fresh.calendar_id)return;
        db.prepare("UPDATE google_calendar_connections SET calendar_id=?,status=CASE WHEN status='needs_review' THEN 'disconnected' ELSE status END,updated_at=? WHERE id=?")
          .run(calendarId,now(),id);
      });
      if(!calendarId||!oauthAuthorized(state)||current(id)?.generation!==c.generation){
        db.prepare("UPDATE google_calendar_connections SET status=?,last_error='Phiên hoặc quyền đã thay đổi; đồng bộ chưa được bật.' WHERE id=? AND generation=? AND status='connecting'")
          .run(calendarId?'disconnected':'needs_review',id,c.generation);
        fail(409,'Kết nối đã thay đổi.');
      }
      withTransaction(db,()=>{
        const fresh=db.prepare('SELECT generation,status FROM google_calendar_connections WHERE id=? FOR UPDATE').get(id);
        if(!oauthAuthorized(state)||fresh?.generation!==c.generation||fresh.status!=='connecting')fail(409,'Kết nối đã thay đổi.');
        db.prepare("UPDATE google_calendar_connections SET calendar_id=?,status='active',sync_requested=sync_requested+1,next_attempt_at=NULL,last_error=NULL WHERE id=? AND generation=?").run(calendarId,id,c.generation);
        enqueueAll(c);
      });
      res.redirect('/google-calendar');
    }catch(e){next(e instanceof HttpError?e:new HttpError(502,'Không thể kết nối Google Calendar. Kiểm tra consent và thử lại.'));}
  });
  app.post('/api/integrations/google-calendar/watch',(req,res)=>{
    const c=db.prepare('SELECT * FROM google_calendar_connections WHERE channel_id=?').get(String(req.headers['x-goog-channel-id']||''));
    const sequence=String(req.headers['x-goog-message-number']||'');
    if(!c||hash(String(req.headers['x-goog-channel-token']||''))!==c.channel_token_hash||!c.channel_resource||String(req.headers['x-goog-resource-id'])!==c.channel_resource||!/^\d{1,30}$/.test(sequence)||!active(c))return res.sendStatus(403);
    withTransaction(db,()=>{
      const fresh=db.prepare('SELECT channel_sequence FROM google_calendar_connections WHERE id=? FOR UPDATE').get(c.id);
      if(!fresh.channel_sequence||BigInt(sequence)>BigInt(fresh.channel_sequence))db.prepare('UPDATE google_calendar_connections SET sync_requested=sync_requested+1,channel_sequence=?,next_attempt_at=NULL WHERE id=?').run(sequence,c.id);
    });res.sendStatus(204);
  });
  app.patch('/api/integrations/google-calendar',requireAuth,(req,res)=>{
    ensureWritable(req);const c=own(req),selected=req.body?.enabledKinds;
    if(!c)fail(404,'Chưa kết nối Google Calendar.');
    if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(x=>!kinds.includes(x)))fail(400,'Loại lịch không hợp lệ.');
    withTransaction(db,()=>{db.prepare('UPDATE google_calendar_connections SET enabled_json=?,generation=generation+1 WHERE id=?').run(json(selected),c.id);enqueueAll(c);});res.json({ok:true});
  });
  app.post('/api/integrations/google-calendar/sync',requireAuth,async(req,res)=>{
    ensureWritable(req);const c=own(req);if(!c)fail(404,'Chưa kết nối.');
    db.prepare('UPDATE google_calendar_connections SET next_attempt_at=NULL,sync_requested=sync_requested+1 WHERE id=?').run(c.id);
    res.json(await syncConnection(c.id));
  });
  app.post('/api/integrations/google-calendar/mappings/:id/resolve',requireAuth,async(req,res)=>{
    ensureWritable(req);const c=own(req),m=c&&db.prepare('SELECT * FROM google_calendar_mappings WHERE id=? AND connection_id=?').get(req.params.id,c.id);
    if(!m)fail(404,'Không tìm thấy liên kết.');assertActive(c);
    if(!parse(c.enabled_json,[]).includes(m.kind))fail(409,'Loại đồng bộ này đã tắt. Hãy bật lại trước khi xử lý liên kết.');
    const choice=req.body?.choice;if(!['local','google','relink'].includes(choice))fail(400,'Lựa chọn không hợp lệ.');
    const event=await remoteEvent(provider(c),c,m.event_id);assertActive(c);
    withTransaction(db,()=>{
      const latest=db.prepare('SELECT * FROM google_calendar_mappings WHERE id=? FOR UPDATE').get(m.id),s=source(c,m.kind,m.source_id,{write:choice==='google',lock:true});
      if(!s)fail(403,'Không còn quyền với dữ liệu này.');
      if(choice==='relink') {if(!['suppressed','removed','failed'].includes(latest.state))fail(409,'Liên kết đang hoạt động.');}
      else {
        if(latest.state!=='conflict'||req.body.expectedRevision!==s.revision||req.body.expectedEtag!==(event?.etag||null))fail(409,'Dữ liệu đã thay đổi; hãy tải lại xung đột.');
        if(choice==='google') {
          if(event?.status==='cancelled') {
            if(m.kind==='personal')apply(c,m,null,event);
            db.prepare("UPDATE google_calendar_mappings SET state='suppressed',conflict_json=NULL,last_error=NULL WHERE id=?").run(m.id);return;
          }
          if(!event||m.kind==='renewal')fail(400,'Không thể áp dụng dữ liệu này từ Google.');
          let value;try{value=googleEventValue(m.kind,event);}catch(e){fail(400,e.message);}apply(c,m,value,event);
        }
      }
      // A deleted Google event cannot reliably be resurrected. Only explicit user resolution
      // rotates its ID; ambiguous create retries retain the already persisted ID.
      const recreate=event?.status==='cancelled'||!event&&!!latest.etag;
      db.prepare("UPDATE google_calendar_mappings SET state='pending',event_id=?,etag=?,base_revision=?,base_json=?,conflict_json=NULL,last_error=NULL WHERE id=?")
        .run(recreate?hash(randomUUID()):latest.event_id,recreate?null:event?.etag||null,s.revision,json(choice==='google'?source(c,m.kind,m.source_id)?.value:s.value),m.id);
      enqueue(c,m.kind,m.source_id);
    });res.json({ok:true});
  });
  app.delete('/api/integrations/google-calendar',requireAuth,async(req,res)=>{
    const c=own(req);if(!c)return res.json({ok:true});
    // Stop applies/sends before touching the provider; history and tombstones remain.
    // Keep reconnect behind provider cleanup. An old cleanup must neither read
    // newly issued credentials nor delete a newer connection's tokens.
    const credentials=tokens(c.id),p=provider(c),lease=randomUUID();
    const claim=db.prepare(`UPDATE google_calendar_connections SET status='disconnecting',generation=generation+1,lease_token=?,lease_until=?
      WHERE id=? AND generation=? AND (status<>'disconnecting' OR lease_until IS NULL OR lease_until<=?) RETURNING generation`)
      .get(lease,new Date(Date.parse(now())+120000).toISOString(),c.id,c.generation,now());
    if(!claim)fail(409,'Kết nối đang được ngắt. Hãy chờ hoàn tất trước khi thử lại.');
    let cleaned=true;try{if(c.channel_id&&c.channel_resource)await p.stopWatch(credentials,{id:c.channel_id,resourceId:c.channel_resource});await p.revoke(credentials);}catch{cleaned=false;}
    withTransaction(db,()=>{
      const fresh=db.prepare('SELECT generation,lease_token,calendar_id FROM google_calendar_connections WHERE id=? FOR UPDATE').get(c.id);
      if(fresh?.generation!==claim.generation||fresh.lease_token!==lease)return;
      db.prepare('DELETE FROM app_settings WHERE key=?').run(tokenKey(c.id));
      db.prepare("UPDATE google_calendar_connections SET status=?,last_error=?,channel_id=NULL,channel_resource=NULL,channel_token_hash=NULL,lease_token=NULL,lease_until=NULL WHERE id=?")
        .run(fresh.calendar_id?'disconnected':'needs_review',!fresh.calendar_id?'Đã dừng đồng bộ; kết quả tạo lịch chưa rõ. Cần đối soát lịch Google trước khi kết nối lại.':cleaned?'Bản sao sự kiện vẫn ở lịch Google; có thể xóa lịch đó trong Google.':'Đã dừng đồng bộ; chưa xác nhận thu hồi quyền bên Google.',c.id);
    });
    res.json({ok:true,providerRevoked:cleaned,eventsDeleted:false});
  });
}
