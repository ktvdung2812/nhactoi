# W0-T03 — Lối truy cập chức năng Web và lịch sử nhắc

Ngày chạy: 2026-10-16. HEAD nền: `894f068ad4ad6288cbe467459fd4e0039c4764c9`; kiểm thử trên working tree, không phải commit sạch. Node `v24.21.0`, Next `16.3.8`, PostgreSQL `17.2`, schema PostgreSQL `2`. Hash từng file được kiểm thử và build ID ở [manifest local](../../../../artifacts/w0-web-controls-2026-10-16/manifest.json).

## Phần đã triển khai

- Task detail dùng lại `TaskExtras` cho nhãn, người phối hợp, sao chép công việc và lưu mẫu. Picker chỉ dùng danh sách thành viên do API của task trả về. Tạo nhãn chỉ hiện cho owner/admin; lỗi tải khóa mutation, giữ lựa chọn chưa lưu qua refresh, chặn double submit trong lúc gửi.
- `TaskChecklists` là luồng thao tác checklist duy nhất trong detail; bỏ panel thao tác checklist trùng trong `TaskExtras`. Chọn checklist để lưu mẫu vẫn có ở phần mẫu.
- Menu tiện ích có Mẫu công việc/Tự động hóa. Cấu hình menu cũ bổ sung hai mục mới mà giữ thứ tự và lựa chọn đã lưu. Trang mẫu khóa nút ghi khi workspace chỉ đọc.
- Lịch sử nhắc hiển thị email, FCM và tổng trạng thái từng trình duyệt Web Push. Provider chấp nhận, đọc thông báo trong ứng dụng và xác nhận nhận việc được trình bày riêng. API gom Web Push theo notification/status, không nhân dòng thông báo hoặc trả endpoint/khóa đăng ký.

## Kết quả thực thi

| Kiểm tra | Expected | Actual / kết quả | Bằng chứng |
|---|---|---|---|
| `node --test --test-concurrency=3 --test-timeout=60000 --test-skip-pattern='\\[SQLite legacy\\]' tests/reminder-workflow.test.mjs tests/task-extras.test.mjs tests/appearance.test.mjs` | Bộ hồi quy API/quyền/copy/recurrence/reminder/menu đạt trên PostgreSQL riêng | **PASS — 22/22**. Ca mới kiểm tra copy checklist/recurrence bằng ID mới; mixed sent/failed trên nhiều browser nhưng một dòng notification; giữ thứ tự menu cũ | [tests.log](../../../../artifacts/w0-web-controls-2026-10-16/tests.log) |
| `NHACTOI_DIST_DIR=.next-w0-web-controls npm run build` | Web biên dịch thành công | **PASS**, exit 0; thư mục build cách ly đã dọn sau khi lưu build ID | [build.log](../../../../artifacts/w0-web-controls-2026-10-16/build.log) |
| Browser flow, keyboard, layout hẹp/rộng, hai phiên Web/Android | Thao tác thực qua UI và đồng bộ hai thiết bị | **NOT RUN trong báo cáo này** | Không suy kết quả từ build hoặc API test |

Các ca API tái sử dụng kiểm tra round-trip nhãn/người phối hợp, tenant trái quyền, template/checklist order/convert, acknowledgement, snooze, retry và suppression. Fixture bổ sung tạo hai browser `sent`, một browser `failed`, email `sent`, FCM `failed`; expected/actual là một notification chưa đọc và chưa xác nhận nhận việc, với `web_push_statuses={sent:2,failed:1}`. Provider là fixture DB; không gửi mạng thật.

Database thử được tạo bằng tên `nhactoi_web_test_<uuid>` trên PostgreSQL local, mỗi fixture dùng schema riêng qua `tests/database-helpers.mjs`, rồi xóa database sau khi các connection đóng. Cấu hình `.env.test.local` hiện dùng role `nhactoi` không tồn tại (`28000`); lần chạy này dùng `TEST_DATABASE_URL` trỏ database thử riêng với role local `postgres`, không sửa `.env`, role hoặc dữ liệu ứng dụng. Không thay bằng SQLite.

Các alias `TC-W0-T03-A…E` / ca chuẩn tương ứng vẫn chưa được đánh dấu PASS toàn phần: báo cáo này cung cấp bằng chứng lớp API/build; browser, Android và đối soát liên thiết bị cần bằng chứng riêng trước gate W0-T03.
