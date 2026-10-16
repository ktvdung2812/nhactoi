# W1 — Mutation, revision và typed events

Môi trường: PostgreSQL 17 riêng, schema ngẫu nhiên qua `tests/database-helpers.mjs`; đồng hồ fixture `2026-10-16T02:00:00.000Z`. Working tree chưa commit; không chạy trên dữ liệu production. Đây là API/database integration, không phải browser E2E hoặc thiết bị Android thật.

| Requirement | Bằng chứng chạy | Kết quả |
|---|---|---|
| TC-W1-T07-A/B/C/D | `tests/task-mutation-pipeline.test.mjs`: create/assign/ack/snooze/deadline/done/reopen; actor/source/time/snapshot; ack không reset vì đổi extras; lỗi receipt rollback events | PASS |
| TC-W1-T07-E | Endpoint events trả `historyCoverage: unknown` khi thiếu sự kiện tạo; không suy lịch sử cũ | PASS ở API; UI chưa kiểm tra |
| TC-W1-T08-B | Checklist và label đổi aggregate revision; revision cũ không tạo thêm checklist | PASS |
| TC-W1-T08-C/D | Hai user có plan revision riêng; sửa hạn không ghi đè plan; clear plan vẫn giữ version tombstone | PASS |
| TC-W1-T09-A/C/D | Retry trả receipt đã commit; payload khác bị 409; tenant/principal khác không nhận receipt; mất membership không replay | PASS |
| TC-W1-T09-E | Trigger lỗi tại INSERT receipt: task, revision, events, notification intent và recurrence successor rollback; retry sau bỏ fault thành công | PASS |
| TC-W1-T09-B/F | Hai process API đợi cùng barrier advisory PostgreSQL rồi complete cùng operation/revision: một receipt, một completed event, một successor | PASS |
| Cleanup | DELETE retry sau soft delete giữ cùng response; xóa vật lý task có plan không bị trigger chặn | PASS |

Log: `artifacts/spec-implementation-2026-10-16/task-mutation-pipeline-final.log` (15/15 gồm 8 ca mới và 7 ca automation/transfer có sẵn); `revision-targeted.log` (11/11 kiểm tra hiện hữu).

Hợp đồng hiện tại: `operationId` trong body hoặc `Idempotency-Key` header cho các mutation JSON đồng bộ trên task, checklist, extras, personal plan, acknowledge/snooze và board move. Hai giá trị nếu cùng gửi phải khớp. Payload đã gửi bất biến, replay revalidate quyền hiện tại trước trả receipt. Client legacy không gửi operation/revision vẫn hoạt động; không coi chúng có bảo vệ conflict/retry hoàn chỉnh.

Lưu ý gate: nguồn `web`/`android` được xác định bởi session; automation dùng owner rule và source `automation`; writer ngoài pipeline được ghi `unknown` thay vì suy nguồn. UI conflict, browser E2E, import/Google/public API writers mới và bằng chứng thiết bị vẫn cần kiểm tra ở các task tương ứng. Chưa dùng báo cáo này để tuyên bố toàn bộ W1 hoặc toàn bộ 58 task đã hoàn tất.
