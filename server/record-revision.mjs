import { createHash } from 'node:crypto';

// Hash persisted fields, not joined display names or clock precision. This also
// detects edits from older clients and other writers using the same timestamp.
const fields = {
  task: 'aggregate_revision id workspace_id team_id title description status priority start_at due_at remind_at assignee_id customer_id category recurrence recurrence_options recurrence_anchor column_id deleted_at updated_at',
  event: 'id workspace_id team_id title description status starts_at ends_at remind_at updated_at',
  service: 'id workspace_id team_id name provider contract_number amount next_date cycle interval_count remind_days customer_id assignee_id note archived_at license_type quantity unit_price actual_paid purchase_date account_hint payment_account payment_method portal_url provider_contact invoice_type enabled sync_calendar last_renewed_at reminder_time reminder_mode renewal_anchor updated_at',
};

export function recordRevision(row, kind) {
  return createHash('sha256').update(JSON.stringify(fields[kind].split(' ').map(key => row[key] ?? null))).digest('hex');
}

export function assertRevision(body, row, kind, HttpError) {
  if (body?.expectedRevision !== undefined && body.expectedRevision !== recordRevision(row, kind))
    throw new HttpError(409, 'Dữ liệu đã thay đổi trên thiết bị khác. Đóng biểu mẫu rồi mở lại để xem bản mới nhất trước khi lưu.', { code: 'revision_conflict', resourceId: row.id, currentRevision: recordRevision(row,kind) });
}
