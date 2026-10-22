ALTER TABLE reminder_notice_context ADD COLUMN schedule_key TEXT;

-- Old notices did not retain their schedule. Recover only an unambiguous
-- delivery claim; ambiguous historical notices must not send stale reminders.
UPDATE reminder_notice_context
SET schedule_key = COALESCE((
  SELECT MIN(d.schedule_key)
  FROM task_reminder_deliveries d
  JOIN notifications n ON n.id = reminder_notice_context.notification_id
  WHERE d.task_id = n.task_id AND d.user_id = n.user_id AND d.created_at = n.created_at
  HAVING COUNT(*) = 1
), 'legacy:unknown')
WHERE notification_id IN (SELECT id FROM notifications WHERE type = 'task_reminder');
