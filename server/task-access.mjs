import { canAccessProject } from './projects.mjs';
import { canAccessTeamTask } from './teams.mjs';

// All task children and workers authorize the parent project with current
// membership. Only the separate legacy SQLite migration harness has no projects.
export function canAccessTask(db, workspaceId, userId, task, options = {}) {
  if (!task || (task.workspace_id && task.workspace_id !== workspaceId)) return false;
  if (db.dialect !== 'postgres')
    return canAccessTeamTask(db, workspaceId, userId, task.team_id, { write: options.write || (options.action && options.action !== "read") });
  if (!task.project_id) return false;
  return canAccessProject(db, workspaceId, userId, task.project_id, {
    action: options.action || (options.write ? 'write' : 'read'),
    config: db.projectConfig,
    clock: db.projectClock || (() => new Date()),
  });
}

// Only fixed source aliases/expressions are accepted. User IDs remain SQL
// parameters, including when this predicate is embedded in a count query.
export function taskAccessSql(alias = 't', userExpression = '?') {
  if (!/^[a-z][a-z0-9_]*$/.test(alias) || !['?', 'n.user_id'].includes(userExpression))
    throw new Error('Unsupported task access SQL context');
  return `EXISTS (
    SELECT 1 FROM projects acl_p
    JOIN workspace_members acl_wm ON acl_wm.workspace_id=acl_p.workspace_id
    JOIN users acl_u ON acl_u.id=acl_wm.user_id AND acl_u.disabled_at IS NULL
    JOIN workspaces acl_w ON acl_w.id=acl_p.workspace_id AND acl_w.suspended_at IS NULL
    WHERE acl_p.id=${alias}.project_id AND acl_p.workspace_id=${alias}.workspace_id
      AND acl_wm.user_id=${userExpression}
      AND (
        (acl_wm.member_type='member' AND acl_wm.role IN ('owner','admin'))
        OR EXISTS (SELECT 1 FROM project_members acl_pm WHERE acl_pm.project_id=acl_p.id
          AND acl_pm.workspace_id=acl_p.workspace_id AND acl_pm.user_id=acl_wm.user_id)
        OR (acl_wm.member_type='member' AND (acl_p.access_mode='workspace'
          OR (acl_p.access_mode='team' AND EXISTS (SELECT 1 FROM team_members acl_tm
            WHERE acl_tm.team_id=acl_p.team_id AND acl_tm.workspace_id=acl_p.workspace_id
              AND acl_tm.user_id=acl_wm.user_id))))
      )
  )`;
}

// Guests receive task notifications only; CRM/calendar/billing text is private.
export function guestNotificationAccessSql() {
  return `(NOT EXISTS (SELECT 1 FROM workspace_members guest_wm WHERE guest_wm.workspace_id=n.workspace_id AND guest_wm.user_id=n.user_id AND guest_wm.member_type='guest')
    OR (n.task_id IS NOT NULL AND n.service_id IS NULL AND n.type IN ('task_reminder','task_update') AND (n.entity_type IS NULL OR n.entity_type='task')))`;
}
