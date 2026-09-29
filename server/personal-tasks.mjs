import { canAccessTeamTask } from './teams.mjs';
import { isValidCalendarDate } from '../shared/service-renewal.mjs';

export const PERSONAL_TASKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS personal_task_plans (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    planned_date TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS personal_task_plans_user_idx ON personal_task_plans(user_id, planned_date);
`;

export function registerPersonalTaskRoutes(app, { db, requireAuth, ensureWritable, HttpError, taskJson }) {
  // Personal views project existing permissions; they do not make tasks private.
  const rows = (auth, id = null) => db.prepare(`
    SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived, p.planned_date, p.start_time, p.duration_minutes
    FROM tasks t
    LEFT JOIN teams tm ON tm.id=t.team_id AND tm.workspace_id=t.workspace_id
    LEFT JOIN personal_task_plans p ON p.task_id=t.id AND p.user_id=?
    WHERE t.workspace_id=? AND t.deleted_at IS NULL AND (? IS NULL OR t.id=?) AND
      (t.assignee_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=?)
       OR (t.assignee_id IS NULL AND t.created_by=? AND NOT EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id)))
    ORDER BY t.created_at DESC, t.id
  `).all(auth.userId, auth.workspaceId, id, id, auth.userId, auth.userId, auth.userId)
    .filter(t => canAccessTeamTask(db, auth.workspaceId, auth.userId, t.team_id));

  app.get('/api/personal-tasks', requireAuth, (req, res) => {
    res.json({ tasks: rows(req.auth).map(t => ({ ...taskJson(t), plannedDate: t.planned_date || null, plannedTime: t.start_time || null, plannedDuration: t.duration_minutes || 60 })) });
  });

  app.patch('/api/tasks/:id/plan', requireAuth, (req, res) => {
    ensureWritable(req);
    const task = rows(req.auth, req.params.id)[0];
    if (!task) throw new HttpError(404, 'Không tìm thấy công việc của bạn.');
    if (!canAccessTeamTask(db, req.auth.workspaceId, req.auth.userId, task.team_id, { write: true }))
      throw new HttpError(409, 'Đội nhóm đã lưu trữ và chỉ được đọc');
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !['plannedDate', 'plannedTime', 'plannedDuration'].includes(k)) ||
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
    res.json({ ok: true, plannedDate: body.plannedDate });
  });
}
