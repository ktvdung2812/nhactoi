# TC-W2-T03-E — Gia hạn lỗi giữa chừng và retry

Ngày chạy: 2026-10-16, 18:10:33–18:10:38 UTC+7. HEAD nền `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree đang có thay đổi. Node `v24.21.0`, PostgreSQL `17.2`, schema `14`. [Manifest](../../../../artifacts/plan-verification-2026-10-16/business/manifest.json) và [SHA-256 của 87 file nguồn/harness/lockfile](../../../../artifacts/plan-verification-2026-10-16/business/source-snapshot.json) xác nhận nguồn không đổi từ trước đến sau lượt chạy.

**Kết quả: 20/20 PASS, 0 FAIL, 0 SKIP** trong 4.999 giây: 11 test mới của [service-renewal-faults.test.mjs](../../../../tests/service-renewal-faults.test.mjs) và 9 test hiện hữu của [service-operations.test.mjs](../../../../tests/service-operations.test.mjs). [Log đầy đủ](../../../../artifacts/plan-verification-2026-10-16/business/service-renewal-faults.log). Các exception `injected renewal boundary failure` là fault cố ý và đã được assertion kiểm chứng; runner exit 0.

| Metadata | Giá trị |
|---|---|
| Requirement / task / ca | RQ-W2-T03-E / W2-T03 / TC-W2-T03-E; giữ nguyên ID catalog |
| Ưu tiên / lớp / nền tảng | P0 / HTTP API + transaction PostgreSQL / server |
| Triển khai | Bổ sung tự động 11 ranh giới lỗi, tái sử dụng `roadmap-helpers.mjs` → `database-helpers.mjs`; không thêm dependency hoặc endpoint production |
| Fixture / tài khoản | Owner tạo dịch vụ; thành viên khác là assignee để thật sự phát notification/outbox; dịch vụ 100, kỳ tháng, hạn 31/10/2026; bật ghi chi và tạo task |
| Clock / database | Fixed `2026-10-16T02:00:00.000Z` (09:00 UTC+7); database thử riêng `nhactoi_plan_tests_20261016`, schema độc lập và cleanup tự động |
| Trạng thái thực thi | PASS cho phần API/DB của TC-W2-T03-E đã mô tả dưới đây; không nghiệm thu UI hoặc toàn wave |

Mỗi test đặt trigger `RAISE EXCEPTION` tại đúng một ranh giới: `transactions`, `tasks`, `business_events`, `task_assignment_cycles`, `service_cycle_tasks`, `task_activity`, `notifications`, `notification_outbox`, `service_renewals`, `service_contracts` (UPDATE), hoặc `mutation_receipts`. HTTP 500 phải xảy ra để chứng minh đã chạm fault; test không được PASS nếu đường ghi chưa đi tới bảng đó.

Expected và actual đều khớp: sau request lỗi, snapshot đầy đủ của 15 bảng nghiệp vụ/receipt/event/outbox không đổi; API trả lại revision và ngày dịch vụ cũ, history rỗng. Sau gỡ trigger, gửi lại **cùng operation ID và payload** thành công với kỳ 30/11/2026, đúng một khoản chi 100, một task và một liên kết kỳ. History liên kết đúng expense/task; assignment cycle, activity, receipt, notification và FCM outbox mỗi loại đúng một hàng. Hai typed event `task.created`/`task.assigned` có actor, operation ID và nguồn `web` đúng. Replay tiếp trả cùng response, snapshot không thêm hoặc thay đổi hàng nào.

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/nhactoi_plan_tests_20261016 \
node --test --test-concurrency=2 --test-timeout=60000 \
  tests/service-operations.test.mjs tests/service-renewal-faults.test.mjs
```

Không sửa code production, cấu hình môi trường hoặc dữ liệu ứng dụng. Không gọi provider, chạy browser hay thiết bị Android trong lượt này. Bằng chứng được lưu local tại đường dẫn trên; kiểm thử UI, provider và các gate khác giữ trạng thái riêng, không suy PASS từ tổng 20 test.
