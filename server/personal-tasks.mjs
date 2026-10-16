import { createHash } from 'node:crypto';
import { canAccessTask, taskAccessSql } from './task-access.mjs';
import { planningDay } from '../shared/personal-planning.mjs';
import { planningWeek } from '../shared/week-planning.mjs';
import { readPage } from './read-page.mjs';
import { isValidCalendarDate } from '../shared/service-renewal.mjs';

const planRevision = (row, userId) => createHash('sha256').update(JSON.stringify([row.id,userId,row.plan_revision ?? 0,row.planned_date ?? null,row.start_time ?? null,row.duration_minutes ?? null])).digest('hex');

export function registerPersonalTaskRoutes(app, { db, requireAuth, ensureWritable, HttpError, taskJson, clock = () => new Date() }) {
  // Personal views project existing permissions; they do not make tasks private.
  const base = auth => ({
    sql: `FROM tasks t
      LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id
      LEFT JOIN personal_task_plans p ON p.task_id=t.id AND p.user_id=?
      WHERE t.workspace_id=? AND t.deleted_at IS NULL AND ${db.dialect === 'postgres' ? taskAccessSql() : "? IS NOT NULL"}
        AND (t.assignee_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=?)
          OR (t.assignee_id IS NULL AND t.created_by=? AND NOT EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id)))`,
    args: [auth.userId, auth.workspaceId, auth.userId, auth.userId, auth.userId, auth.userId],
  });
  const select = auth => ({
    sql: `SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived, p.planned_date, p.start_time, p.duration_minutes${db.dialect === 'postgres' ? ', coalesce((SELECT revision FROM personal_plan_revisions WHERE task_id=t.id AND user_id=?),0) AS plan_revision' : ''}`,
    args: db.dialect === 'postgres' ? [auth.userId] : [],
  });
  const rows = (auth, id = null) => {
    const from=base(auth), fields=select(auth);
    return db.prepare(`${fields.sql} ${from.sql}${id ? ' AND t.id=?' : ''} ORDER BY t.created_at DESC,t.id`)
      .all(...fields.args,...from.args,...(id?[id]:[])).filter(t=>db.dialect==='postgres'||canAccessTask(db,auth.workspaceId,auth.userId,t));
  };
  const json = (t, auth) => ({ ...taskJson(t, auth), planRevision: planRevision(t,auth.userId), plannedDate: t.planned_date || null, plannedTime: t.start_time || null, plannedDuration: t.duration_minutes || 60 });

  app.get('/api/personal-tasks', requireAuth, (req, res) => {
    const q=req.query;
    if(!Object.keys(q).length) return res.json({tasks:rows(req.auth).map(t=>json(t,req.auth))});
    const {page,pageSize,offset}=readPage(q,HttpError);
    const date=q.date??planningDay(clock()),view=q.view??'';
    if(!isValidCalendarDate(date)||!['','inbox','today','upcoming','week'].includes(view))throw new HttpError(400,'Ngày hoặc cách xem kế hoạch không hợp lệ.');
    const fields=select(req.auth),from=base(req.auth),conditions=[],args=[];
    const due=db.dialect==='postgres'?"to_char(t.due_at::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD')":"date(t.due_at,'+7 hours')";
    let orderArgs=[];
    let order=`coalesce(t.due_at,'9999'),t.title,t.id`;
    if(view||q.openOnly==='true')conditions.push("t.status<>'done' AND tm.archived_at IS NULL");
    if(q.id){conditions.push('t.id=?');args.push(String(q.id));}
    if(q.q){conditions.push('lower(t.title) LIKE ?');args.push('%'+String(q.q).trim().toLowerCase().slice(0,200)+'%');}
    if(view==='inbox')conditions.push('t.due_at IS NULL AND p.planned_date IS NULL');
    if(view==='today'){
      conditions.push(`(${due}<=? OR p.planned_date<=?)`);args.push(date,date);
      order=`CASE WHEN ${due}<? OR p.planned_date<? THEN 0 ELSE 1 END,${order}`;orderArgs=[date,date];
    }
    if(view==='upcoming'){
      conditions.push(`(${due}>? OR p.planned_date>?)`);args.push(date,date);
      order=`CASE WHEN ${due}>? AND (p.planned_date IS NULL OR p.planned_date<=? OR ${due}<p.planned_date) THEN ${due} ELSE p.planned_date END,${order}`;orderArgs=[date,date];
    }
    if(view==='week'){
      const dates=planningWeek(date),start=dates[0],end=dates[6];
      conditions.push(`((${due} BETWEEN ? AND ?) OR (p.planned_date BETWEEN ? AND ?))`);args.push(start,end,start,end);
    }
    const where=`${from.sql}${conditions.length?' AND '+conditions.join(' AND '):''}`;
    // SQLite remains a legacy test harness; authorization still precedes paging there.
    let total,tasks;
    if(db.dialect==='postgres'){
      total=Number(db.prepare(`SELECT count(*) n ${where}`).get(...from.args,...args).n);
      tasks=db.prepare(`${fields.sql} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...fields.args,...from.args,...args,...orderArgs,pageSize,offset);
    }else{
      const allowed=db.prepare(`${fields.sql} ${where} ORDER BY ${order}`).all(...fields.args,...from.args,...args,...orderArgs).filter(t=>canAccessTask(db,req.auth.workspaceId,req.auth.userId,t));
      total=allowed.length;tasks=allowed.slice(offset,offset+pageSize);
    }
    const doneToday=view==='today'?(db.dialect==='postgres'
      ?Number(db.prepare(`SELECT count(*) n ${from.sql} AND t.status='done' AND tm.archived_at IS NULL AND (${due}=? OR p.planned_date=?)`).get(...from.args,date,date).n)
      :rows(req.auth).filter(t=>t.status==='done'&&!t.team_archived&&(t.planned_date===date||(t.due_at&&planningDay(t.due_at)===date))).length):undefined;
    res.json({tasks:tasks.map(t=>json(t,req.auth)),page,pageSize,total,hasMore:offset+tasks.length<total,...(doneToday!==undefined?{doneToday}:{})});
  });

  app.patch('/api/tasks/:id/plan', requireAuth, (req, res) => {
    ensureWritable(req);
    const task = rows(req.auth, req.params.id)[0];
    if (!task) throw new HttpError(404, 'Không tìm thấy công việc của bạn.');
    if (!canAccessTask(db, req.auth.workspaceId, req.auth.userId, task, { write: true }))
      throw new HttpError(409, 'Đội nhóm đã lưu trữ và chỉ được đọc');
    const body = req.body;
    const expected = req.expectedRevision ?? body?.expectedRevision;
    if (expected !== undefined && expected !== planRevision(task,req.auth.userId))
      throw new HttpError(409, 'Kế hoạch cá nhân đã thay đổi. Tải lại trước khi lưu.', { code: 'revision_conflict', resourceId: task.id, currentRevision: planRevision(task,req.auth.userId) });
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !['plannedDate', 'plannedTime', 'plannedDuration', 'expectedRevision'].includes(k)) ||
      (body.plannedDate !== null && !isValidCalendarDate(body.plannedDate)))
      throw new HttpError(400, 'Ngày dự định làm phải có dạng YYYY-MM-DD hoặc để trống.');
    const startTime = body.plannedTime === undefined ? task.start_time || null : body.plannedTime;
    const duration = body.plannedDuration === undefined ? task.duration_minutes || 60 : body.plannedDuration;
    if (startTime !== null && (typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)))
      throw new HttpError(400, 'Giờ dự định làm phải có dạng HH:mm hoặc để trống.');
    if (!Number.isInteger(duration) || duration < 15 || duration > 1440)
      throw new HttpError(400, 'Thời lượng phải là số phút nguyên từ 15 đến 1440.');
    if (body.plannedDate && startTime && Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + duration > 1440)
      throw new HttpError(400, 'Khoảng làm việc phải kết thúc trong cùng ngày.');
    if (body.plannedDate === null) {
      db.prepare('DELETE FROM personal_task_plans WHERE task_id=? AND user_id=?').run(task.id, req.auth.userId);
    } else {
      db.prepare(`INSERT INTO personal_task_plans(task_id,user_id,planned_date,start_time,duration_minutes) VALUES(?,?,?,?,?)
        ON CONFLICT(task_id,user_id) DO UPDATE SET planned_date=excluded.planned_date,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes`)
        .run(task.id, req.auth.userId, body.plannedDate, startTime, duration);
    }
    res.json({ ok: true, plannedDate: body.plannedDate, planRevision: planRevision(rows(req.auth,task.id)[0],req.auth.userId) });
  });
}
