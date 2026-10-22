# Lưu trữ: tiến độ giai đoạn W0/W1 ban đầu — 16/10/2026

Đây là ảnh chụp tiến độ lịch sử, đã được thay thế bởi [báo cáo hiện tại](../../10-implementation-status.md). Không dùng các giới hạn và kết quả cũ dưới đây để mô tả mã nguồn hiện tại.

Đã bắt đầu triển khai mã nguồn từ W0 và nền W1 trên working tree của HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9`. **Chưa hoàn thành 58 task và chưa mở gate W1 hoặc phát hành.** Không đổi trạng thái task trên bảng đang kết nối vì bảng đó chưa có ID Nhắc Tôi được xác minh.

## Phần đã triển khai

| Task | Thay đổi thực tế | Phần còn thiếu trước nghiệm thu toàn task |
|---|---|---|
| W0-T01/T02 | Spec/test catalog truy vết 58 task; lưu diff/hash baseline; PostgreSQL 17.2 riêng, schema cách ly; đọc tài liệu Next 16.3.8/Expo 57 | Hoàn tất bằng chứng UI/thiết bị trong gate tương ứng |
| W0-T03 | Web nối nhãn, người phối hợp, copy/lưu mẫu vào task detail; một luồng checklist; menu automation/template; Android bổ sung nhãn/phối hợp/copy; lịch sử email/FCM/Web Push tách accepted khỏi read/ack | Browser E2E và thiết bị thật chưa đạt gate |
| W0-T04 | Thu/chi theo `type` khi amount dương; tên gói catalog gồm custom/ngừng bán trên Web/Android; filter gồm assignee chính/phối hợp, dùng EXISTS tránh nhân dòng; ngày Việt Nam và refresh qua nửa đêm | Kiểm chứng UI thực tế |
| W0-T05/T06 | [Readiness provider](../../09-provider-readiness.md), nguồn và điều kiện thực còn thiếu được ghi rõ | W7/W8 thật BLOCKED; review source/mock không thay kết nối/gửi thật |
| W1-T01 | Snapshot schema 1 nâng lên 2 theo migration thật, validation/checksum chặt, rollback khi lỗi; restore giữ queue/history, vô hiệu phiên cũ, dừng sender qua restart; thiếu/sai khóa báo rõ; resume offline có backup ID/lý do và receipt | Chưa có dữ liệu project/guest/event/receipt tương lai để nghiệm thu migration toàn W1; phải bổ sung mapping khi thêm schema mới |
| W1-T02 | Mã entitlement theo tier; custom có danh sách mã hợp lệ; baseline/giá/ghế giữ nguyên; session trả planName/capabilities; request và guard đọc catalog hiện hành; sửa catalog đồng thời không làm mất cập nhật gói khác | Premium endpoints/workers chưa triển khai phải nối guard; chưa chứng minh toàn ma trận role × chức năng của spec |
| W1-T05 | Ghế member + reservation theo email duy nhất, không cộng lại thành viên; lock dùng chung cho invite/accept/revoke/checkout/settlement/admin downgrade; catalog giảm ghế khóa cùng đường chuyển gói; hai tiến trình tranh ghế không vượt hạn mức | Guest/project membership và readonly guest sau downgrade chưa triển khai |

Chưa triển khai mới trong đợt này: project/backfill/ACL toàn hệ thống W1-T03/T04/T06; typed events W1-T07; aggregate revision W1-T08; durable mutation receipt W1-T09; claim/lease/unknown của outbox W1-T10 và gate W1-T11. Các phần baseline hiện hữu không được ghi thành hoàn thành thiết kế mới. W2–W9 tiếp tục theo dependency đã ghi trong [tasks](../../07-tasks.md) và [waves](../../08-waves.md).

## Kiểm chứng thực tế

Môi trường: Node 24.21.0, PostgreSQL 17.2, schema 2, Next 16.3.8, Expo 57.0.26. Test PostgreSQL dùng cluster riêng và schema ngẫu nhiên qua `tests/database-helpers.mjs`; test cạnh tranh có hai process API, connection điều khiển và barrier. Không dùng SQLite thay PostgreSQL.

| Kiểm tra | Kết quả / bằng chứng |
|---|---|
| PostgreSQL baseline trước sửa | PASS 191/191 — [log](../../../../artifacts/spec-implementation-2026-10-16/baseline-postgres.log) |
| PostgreSQL hồi quy sau tích hợp | PASS 206/206 — [log](../../../../artifacts/spec-implementation-2026-10-16/regression-postgres-final.log) |
| Kiểm tra sau sửa cạnh tranh catalog và lỗi khóa | PASS 14/14 — [log](../../../../artifacts/spec-implementation-2026-10-16/review-fixes.log); tên gói khác nhau cùng được giữ, giới hạn ghế và dữ liệu restore đúng |
| Thu hồi phiên sau restore và hồi quy auth | PASS 27/27 — [log](../../../../artifacts/spec-implementation-2026-10-16/restore-session-final.log); cookie/bearer cũ vẫn bị chặn và không mất receipt |
| Admin settings/catalog | PASS 4/4 — [log](../../../../artifacts/spec-implementation-2026-10-16/admin-settings-final.log) |
| Legacy SQLite | PASS các ca migration legacy — [log](../../../../artifacts/spec-implementation-2026-10-16/regression-legacy.log); số mục runner bao gồm file không có test khớp, không dùng làm số ca nghiệm thu |
| Web build và Next production runtime | PASS — [build](../../../../artifacts/spec-implementation-2026-10-16/web-build-final.log), [runtime](../../../../artifacts/spec-implementation-2026-10-16/next-runtime-final.log) |
| Android typecheck/lint | PASS — [typecheck](../../../../artifacts/spec-implementation-2026-10-16/mobile-typecheck.log), [lint](../../../../artifacts/spec-implementation-2026-10-16/mobile-lint.log) |
| Android unit/component | PASS 14 unit và 56 component với TZ=UTC — [unit](../../../../artifacts/spec-implementation-2026-10-16/mobile-unit.log), [component](../../../../artifacts/spec-implementation-2026-10-16/mobile-components.log). Jest thoát bình thường, không dùng forceExit |
| Android APK | PASS — [build log](../../../../artifacts/spec-implementation-2026-10-16/android-build.log), `BUILD SUCCESSFUL`; không thay kiểm thử thiết bị thật |
| Browser E2E | BLOCKED — [lần đầu](2026-10-16-w0-browser.md), [thử lại theo yêu cầu bằng VC browser](2026-10-16-w0-browser-retry.md). Lần mới dùng production build: open/navigate/snapshot timeout, tab không chuyển URL; browser dự phòng vẫn thiếu capability `browser` |
| Android thiết bị thật; Google/Zalo thật | NOT RUN / BLOCKED theo điều kiện provider, không suy PASS từ build hoặc mock |

Lần hồi quy đầu có ba failure: assertion cũ ẩn menu và hai test filter chạy trước khi lane filter hoàn tất. Đã cập nhật assertion đúng spec, tích hợp filter và chạy lại đạt. Log lỗi đầu được giữ tại `regression-postgres.log` để truy vết.

Review độc lập phát hiện cookie cũ sau restore gây xóa cascade delivery history qua cleanup phiên. Đã sửa chung đường hết phiên/logout/reset mật khẩu/khóa tài khoản: trong thời gian `restoreSenderHold`, vô hiệu hóa bằng expiry và giữ bản ghi để đối soát. Regression HTTP dùng cả cookie và bearer hết hạn, kiểm tra API 401 nhưng queue/history không đổi; bằng chứng ở `restore-session-final.log`.

## Phạm vi và phục hồi

- Không chạy migration/restore trên database ứng dụng; schema production không đổi. Lockfile và thay đổi có trước được giữ nguyên. Baseline diff/hash và manifest cuối trong `artifacts/spec-implementation-2026-10-16/`.
- Restore chỉ dùng offline. `restoreSenderHold` tồn tại trong DB sẽ dừng email, FCM, Web Push và remote cleanup; hết hạn phiên không cascade xóa delivery history. Xem [hướng dẫn PostgreSQL](../../../POSTGRESQL.md) trước khi resume có đối soát.
- Sender tích hợp mới phải sử dụng cùng guard. Chưa có trạng thái provider `unknown` đầy đủ trong queue hiện hữu; không coi `sent` là exactly-once, đã đọc hay ack công việc.
- Các checklist P0/P1 chỉ đánh dấu khi toàn bộ expected của case có bằng chứng đúng lớp. Các kết quả suite trên không tự chuyển toàn bộ case catalog thành PASS.
