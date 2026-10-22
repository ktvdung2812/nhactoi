import { taskAccessSql } from './task-access.mjs';
import { isValidCalendarDate, addCalendarDays } from '../shared/service-renewal.mjs';

export function registerOperationsDashboard(app, { db, clock, requireAuth, HttpError }) {
  app.get('/api/operations-dashboard', requireAuth, (req, res, next) => {
    try {
      const q=req.query, where=['t.workspace_id=?','t.deleted_at IS NULL',taskAccessSql('t')], values=[req.auth.workspaceId,req.auth.userId];
      const fail=message=>{throw new HttpError(400,message);};
      const allowed=['page','pageSize','projectId','teamId','assigneeId','status','from','to','group'];
      if(Object.keys(q).some(key=>!allowed.includes(key))||Object.values(q).some(value=>typeof value!=='string'))fail('Bộ lọc không hợp lệ');
      const page=Number(q.page||1),pageSize=Number(q.pageSize||25);
      if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('Trang không hợp lệ');
      for(const [key,column] of [['projectId','project_id'],['teamId','team_id']])if(q[key]){if(q[key].length>160)fail('Phạm vi không hợp lệ');where.push(`t.${column}=?`);values.push(q[key]);}
      if(q.status){if(!['todo','doing','done'].includes(q.status))fail('Trạng thái không hợp lệ');where.push('t.status=?');values.push(q.status);}
      for(const [key,op] of [['from','>='],['to','<']])if(q[key]){
        if(!isValidCalendarDate(q[key]))fail('Khoảng ngày không hợp lệ');
        where.push(`t.due_at${op}?`);values.push(new Date(`${key==='to'?addCalendarDays(q[key],1):q[key]}T00:00:00+07:00`).toISOString());
      }
      if(q.from&&q.to&&q.from>q.to)fail('Khoảng ngày không hợp lệ');
      if(q.assigneeId){if(q.assigneeId.length>160)fail('Người được giao không hợp lệ');where.push('(t.assignee_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=?))');values.push(q.assigneeId,q.assigneeId);}
      const groups={all:'true',overdue:'is_overdue',unacknowledged:'unacknowledged_count>0',snoozed:'snoozed_count>0',open:"status<>'done'",completed:"status='done'"};
      const group=q.group||'all';if(!Object.hasOwn(groups,group))fail('Nhóm không hợp lệ');
      const now=new Date(clock()).toISOString();
      // One database statement keeps counts/page consistent and authorization
      // is applied before any assignment aggregation or limit.
      const result=db.prepare(`WITH visible AS MATERIALIZED (
        SELECT t.id,t.assignee_id,t.status,t.due_at
        FROM tasks t WHERE ${where.join(' AND ')}
      ), assignments AS (
        SELECT id task_id,assignee_id user_id FROM visible WHERE assignee_id IS NOT NULL
        UNION ALL SELECT a.task_id,a.user_id FROM task_assignees a JOIN visible t ON t.id=a.task_id
        WHERE a.user_id IS DISTINCT FROM t.assignee_id
      ), response_counts AS (
        SELECT a.task_id,count(*) assignment_count,
          sum(CASE WHEN r.acknowledged_at IS NULL THEN 1 ELSE 0 END) unacknowledged_count,
          sum(CASE WHEN r.snoozed_until>? THEN 1 ELSE 0 END) snoozed_count
        FROM assignments a LEFT JOIN task_reminder_responses r ON r.task_id=a.task_id AND r.user_id=a.user_id
        ${q.assigneeId?'WHERE a.user_id=?':''} GROUP BY a.task_id
      ), counted AS (
        SELECT t.id,t.status,t.due_at,
          coalesce(r.assignment_count,0) assignment_count,
          CASE WHEN t.status='done' THEN 0 ELSE coalesce(r.unacknowledged_count,0) END unacknowledged_count,
          CASE WHEN t.status='done' THEN 0 ELSE coalesce(r.snoozed_count,0) END snoozed_count,
          (t.status<>'done' AND t.due_at IS NOT NULL AND t.due_at<?) is_overdue
        FROM visible t LEFT JOIN response_counts r ON r.task_id=t.id
      ), totals AS (
        SELECT count(*) task_count,coalesce(sum(assignment_count),0) assignment_count,
          count(*) FILTER(WHERE is_overdue) overdue_task_count,
          coalesce(sum(unacknowledged_count),0) unacknowledged_assignment_count,
          count(*) FILTER(WHERE snoozed_count>0) snoozed_task_count,
          count(*) FILTER(WHERE status='done') completed_task_count,
          count(*) FILTER(WHERE ${groups[group]}) total FROM counted
      ), page_keys AS (
        SELECT * FROM counted WHERE ${groups[group]} ORDER BY due_at ASC NULLS LAST,id LIMIT ? OFFSET ?
      ), page_rows AS (
        SELECT p.*,t.title,t.priority,t.project_id,t.team_id FROM page_keys p JOIN tasks t ON t.id=p.id
      ) SELECT
        totals.*,coalesce((SELECT json_agg(page_rows ORDER BY due_at ASC NULLS LAST,id) FROM page_rows),'[]'::json) tasks FROM totals`)
        .get(...values,now,...(q.assigneeId?[q.assigneeId]:[]),now,pageSize,(page-1)*pageSize);
      res.json({generatedAt:now,page,pageSize,total:Number(result.total),hasMore:page*pageSize<Number(result.total),
        summary:{taskCount:Number(result.task_count),assignmentCount:Number(result.assignment_count),overdueTaskCount:Number(result.overdue_task_count),unacknowledgedAssignmentCount:Number(result.unacknowledged_assignment_count),snoozedTaskCount:Number(result.snoozed_task_count),completedTaskCount:Number(result.completed_task_count)},
        tasks:result.tasks.map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,dueAt:t.due_at,projectId:t.project_id,teamId:t.team_id,assignmentCount:Number(t.assignment_count),unacknowledgedCount:Number(t.unacknowledged_count),snoozedCount:Number(t.snoozed_count),overdue:t.is_overdue})),
      });
    } catch(error){next(error);}
  });
}
