import { DEFAULT_ASSISTANT, containsAssistantMention } from '../shared/assistant-mentions.mjs';
import { createId } from './auth.mjs';
import { canAccessTask } from './task-access.mjs';

export const ACTIVE_AI_RUNS = ['queued', 'reading', 'executing'];
export const jsonValue = (value, fallback) => { try { return JSON.parse(value || 'null') ?? fallback; } catch { return fallback; } };

export function workspaceAssistant(db, workspaceId) {
  const row = db.dialect === 'postgres' && db.prepare('SELECT name,handle,enabled FROM workspace_ai_settings WHERE workspace_id=?').get(workspaceId);
  return row ? { name: row.name, handle: row.handle, enabled: Boolean(row.enabled) } : { ...DEFAULT_ASSISTANT };
}

export function aiRunJson(row, auth) {
  return { id: row.id, commentId: row.comment_id, status: row.status, error: row.error,
    requestedBy: row.requested_by, replyCommentId: row.reply_comment_id,
    canRetry: row.status === 'failed' && Boolean(row.comment_id) && row.attempts < 5
      && !jsonValue(row.state_json, {}).requiresNewRequest && auth?.userId === row.requested_by,
    canApply: auth?.userId === row.requested_by && ['completed', 'failed'].includes(row.status),
    sources: jsonValue(row.sources_json, []), actions: jsonValue(row.actions_json, []),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export function enqueueAiComment(db, { task, auth, comment, createdAt, ready }) {
  if (db.dialect !== 'postgres' || comment.author_type === 'assistant') return null;
  const assistant = workspaceAssistant(db, auth.workspaceId);
  if (!containsAssistantMention(comment.body, assistant.handle)) return null;
  const recent = db.prepare('SELECT count(*) n FROM ai_comment_runs WHERE workspace_id=? AND requested_by=? AND created_at>=?')
    .get(auth.workspaceId, auth.userId, new Date(Date.parse(createdAt) - 600_000).toISOString()).n;
  const error = !assistant.enabled ? 'Trợ lý đang tắt trong không gian này.' : !ready
    ? 'Trợ lý AI chưa được cấu hình. Quản trị viên SaaS cần bật mô hình và khóa API.'
    : recent >= 20 ? 'Bạn đã gọi trợ lý 20 lần trong 10 phút. Hãy thử lại sau.' : null;
  const id = createId('airun_');
  db.prepare(`INSERT INTO ai_comment_runs(id,workspace_id,project_id,task_id,comment_id,requested_by,request_body,assistant_name,assistant_handle,status,error,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, auth.workspaceId, task.project_id, task.id, comment.id, auth.userId, comment.body,
      assistant.name, assistant.handle, error ? 'failed' : 'queued', error, createdAt, createdAt);
  return aiRunJson(db.prepare('SELECT * FROM ai_comment_runs WHERE id=?').get(id), auth);
}

export function cancelCommentRuns(db, commentId, at) {
  if (db.dialect !== 'postgres') return;
  db.prepare(`UPDATE ai_comment_runs SET status='cancelled',error=?,lease_token=NULL,lease_until=NULL,updated_at=?
    WHERE comment_id=? AND status IN ('queued','reading','executing','failed')`)
    .run('Bình luận gọi trợ lý đã được sửa hoặc xóa; các thao tác đã hoàn tất được giữ nguyên.', at, commentId);
}

// Shared comments must never reveal a project that was moved or revoked after
// the answer was generated. Apply this on reads, including AI's next context.
export function readableAiMetadata(db, auth, task, row) {
  const metadata = jsonValue(row.ai_metadata, {});
  if (row.author_type !== 'assistant') return { metadata, accessible: true };
  const accessible = metadata.projectId === task.project_id && (metadata.taskIds || [task.id]).every(id => {
    const source = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(id, auth.workspaceId);
    return source?.project_id === task.project_id && canAccessTask(db, auth.workspaceId, auth.userId, source);
  });
  return { metadata: accessible ? metadata : {}, accessible };
}
