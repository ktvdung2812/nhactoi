import {extraAssigneeIds} from "./task-extras.mjs";
import { createId } from './auth.mjs';
import { canAccessTeamTask } from './teams.mjs';

export const COLLABORATION_SCHEMA = `
CREATE TABLE task_watchers (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, PRIMARY KEY(task_id,user_id)
);
CREATE TABLE comment_reactions (
 comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 emoji TEXT NOT NULL CHECK(emoji IN ('👍','❤️','🎉','👀')),
 PRIMARY KEY(comment_id,user_id,emoji)
);
CREATE TABLE comment_mentions (
 comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(comment_id,user_id)
);
ALTER TABLE task_comments ADD COLUMN edited_at TEXT;
`;

export function notifyTaskAudience(db, { taskId, actorUserId, summary, createdAt, recipients = [], type = 'task_update' }) {
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId);
  if (!task) return;
  const ids = new Set([...recipients, ...extraAssigneeIds(db,taskId), ...db.prepare('SELECT user_id FROM task_watchers WHERE task_id=?').all(taskId).map(row => row.user_id), task.assignee_id]);
  for (const id of ids) {
    if (!id || id === actorUserId) continue;
    const user = db.prepare('SELECT u.id FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=? AND m.workspace_id=? AND u.disabled_at IS NULL').get(id,task.workspace_id);
    if (!user || !canAccessTeamTask(db,task.workspace_id,id,task.team_id)) continue;
    db.prepare('INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,entity_type,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(createId('notice_'),task.workspace_id,id,taskId,type,task.title,summary,'task',taskId,createdAt);
  }
}

export function recordCommentMentions(db, { commentId, taskId, actorUserId, ids, createdAt, HttpError }) {
  if (!Array.isArray(ids) || ids.length > 30 || ids.some(id => typeof id !== 'string')) throw new HttpError(400,'Danh sách nhắc tên không hợp lệ');
  const task = db.prepare('SELECT workspace_id,team_id FROM tasks WHERE id=? AND deleted_at IS NULL').get(taskId);
  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!db.prepare('SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND u.disabled_at IS NULL').get(task.workspace_id,id) || !canAccessTeamTask(db,task.workspace_id,id,task.team_id)) throw new HttpError(400,'Chỉ nhắc tên thành viên có quyền xem công việc');
    db.prepare('INSERT INTO comment_mentions(comment_id,user_id) VALUES (?,?)').run(commentId,id);
  }
  // Mention recipients are notified together with watchers by the activity hook.
  return unique;
}

export function registerCollaborationRoutes(app, {db,clock,requireAuth,ensureWritable,withTransaction,HttpError}) {
  const now = () => new Date(clock()).toISOString();
  function task(req,write=false) {
    if (write) ensureWritable(req);
    const row = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(req.params.id,req.auth.workspaceId);
    if (!row || !canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,row.team_id)) throw new HttpError(404,'Không tìm thấy công việc');
    if (write && !canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,row.team_id,{write:true})) throw new HttpError(409,'Team đã lưu trữ, chỉ có thể xem');
    return row;
  }
  function comment(req) {
    const row = db.prepare('SELECT * FROM task_comments WHERE id=? AND task_id=?').get(req.params.commentId,req.params.id);
    if (!row) throw new HttpError(404,'Không tìm thấy bình luận');
    return row;
  }
  function editable(req,row) {
    return row.author_user_id===req.auth.userId || ['owner','admin'].includes(req.auth.role);
  }
  function activity(req,summary) {
    const at=now();
    db.prepare('INSERT INTO task_activity(id,task_id,actor_user_id,action,summary,created_at) VALUES (?,?,?,?,?,?)').run(createId('activity_'),req.params.id,req.auth.userId,'comment_updated',summary,at);
    notifyTaskAudience(db,{taskId:req.params.id,actorUserId:req.auth.userId,summary,createdAt:at});
  }
  app.get('/api/tasks/:id/collaboration',requireAuth,(req,res,next)=>{try{
    const row=task(req);
    const reactions=db.prepare('SELECT r.comment_id,r.emoji,r.user_id FROM comment_reactions r JOIN task_comments c ON c.id=r.comment_id WHERE c.task_id=?').all(row.id);
    const comments=db.prepare('SELECT id,author_user_id,edited_at FROM task_comments WHERE task_id=?').all(row.id).map(c=>({id:c.id,canEdit:editable(req,c),editedAt:c.edited_at,reactions:['👍','❤️','🎉','👀'].map(emoji=>({emoji,count:reactions.filter(r=>r.comment_id===c.id&&r.emoji===emoji).length,mine:reactions.some(r=>r.comment_id===c.id&&r.emoji===emoji&&r.user_id===req.auth.userId)}))}));
    const members=db.prepare('SELECT u.id,u.name FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.disabled_at IS NULL').all(req.auth.workspaceId).filter(u=>canAccessTeamTask(db,req.auth.workspaceId,u.id,row.team_id));
    res.json({watching:!!db.prepare('SELECT 1 FROM task_watchers WHERE task_id=? AND user_id=?').get(row.id,req.auth.userId),comments,members});
  }catch(e){next(e)}});
  app.put('/api/tasks/:id/watch',requireAuth,(req,res,next)=>{try{
    task(req,true); if(typeof req.body?.watching!=='boolean') throw new HttpError(400,'Trạng thái theo dõi không hợp lệ');
    if(req.body.watching) db.prepare('INSERT OR IGNORE INTO task_watchers(task_id,user_id,created_at) VALUES (?,?,?)').run(req.params.id,req.auth.userId,now());
    else db.prepare('DELETE FROM task_watchers WHERE task_id=? AND user_id=?').run(req.params.id,req.auth.userId);
    res.json({watching:req.body.watching});
  }catch(e){next(e)}});
  app.put('/api/tasks/:id/comments/:commentId/reaction',requireAuth,(req,res,next)=>{try{
    task(req,true);comment(req); const {emoji,active}=req.body||{};
    if(!['👍','❤️','🎉','👀'].includes(emoji)||typeof active!=='boolean') throw new HttpError(400,'Phản ứng không hợp lệ');
    if(active) db.prepare('INSERT OR IGNORE INTO comment_reactions(comment_id,user_id,emoji) VALUES (?,?,?)').run(req.params.commentId,req.auth.userId,emoji);
    else db.prepare('DELETE FROM comment_reactions WHERE comment_id=? AND user_id=? AND emoji=?').run(req.params.commentId,req.auth.userId,emoji);
    res.json({ok:true});
  }catch(e){next(e)}});
  app.patch('/api/tasks/:id/comments/:commentId',requireAuth,(req,res,next)=>{try{
    task(req,true);const row=comment(req);if(!editable(req,row))throw new HttpError(403,'Bạn không có quyền sửa bình luận này');
    const body=req.body?.body; if(typeof body!=='string'||body.trim().length>5000)throw new HttpError(400,'Nội dung bình luận không hợp lệ');
    if(!body.trim()&&!db.prepare('SELECT 1 FROM task_attachments WHERE comment_id=? AND task_id=?').get(row.id,req.params.id))throw new HttpError(400,'Bình luận cần nội dung hoặc tệp');
    withTransaction(db,()=>{db.prepare('UPDATE task_comments SET body=?,edited_at=? WHERE id=? AND task_id=?').run(body.trim(),now(),row.id,req.params.id);activity(req,'đã chỉnh sửa bình luận')});res.json({ok:true});
  }catch(e){next(e)}});
  app.delete('/api/tasks/:id/comments/:commentId',requireAuth,(req,res,next)=>{try{
    task(req,true);const row=comment(req);if(!editable(req,row))throw new HttpError(403,'Bạn không có quyền xóa bình luận này');
    withTransaction(db,()=>{db.prepare('DELETE FROM task_comments WHERE id=? AND task_id=?').run(row.id,req.params.id);activity(req,'đã xóa bình luận; tệp được giữ trong đính kèm công việc')});res.json({ok:true});
  }catch(e){next(e)}});
}
