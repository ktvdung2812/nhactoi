# Product spec — Nhắc Tôi

Bộ spec ngày **16/10/2026** ghi toàn bộ phân tích và kế hoạch sản phẩm đã trao đổi: hiện trạng, so sánh đối thủ, lý do mua, quyết định chức năng, tích hợp, kiến trúc/dữ liệu, **58 task**, **10 wave** và test case. Người triển khai sử dụng bộ tài liệu này độc lập, không cần tìm mô tả trong lịch sử chat.

**Trạng thái:** tài liệu đặc tả và backlog; việc ghi tài liệu không đánh dấu các feature hoặc tests đã hoàn thành. Các task W0–W9 là ID kế hoạch, không phải task-board IDs đã được tạo. Những chức năng có trong mã, quyết định đã chốt, mặc định kỹ thuật và discovery được phân biệt tại baseline.

**Triển khai mã nguồn:** đã bắt đầu W0 và phần nền W1 ngày 16/10; xem [tiến độ, kết quả thực và phần còn thiếu](10-implementation-status.md). Chưa nghiệm thu toàn bộ 58 task.

## Mục lục

| Tài liệu | Nội dung và người đọc chính |
|---|---|
| [01 — Sản phẩm và đối thủ](01-product-and-competition.md) | Hiện diện Trello/monday/Google Calendar/Google Tasks; khách nào chọn Nhắc Tôi và cách chứng minh giá trị |
| [02 — Baseline và quyết định](02-baseline-and-decisions.md) | Bằng chứng repo, khoảng trống, quyết định người dùng, giá/ghế, mặc định kỹ thuật và discovery |
| [03 — Functional spec](03-functional-spec.md) | Vai trò, entitlement, luồng Web/Android, quy tắc nghiệp vụ, validation và hành vi lỗi |
| [04 — Tích hợp](04-integrations.md) | CSV/Trello, Google Calendar, Zalo OA, API/webhook; mapping, quyền, retry/conflict và giới hạn provider |
| [05 — Kiến trúc và dữ liệu](05-architecture-and-data.md) | Entity/interface, ACL, migration/restore, revision, idempotency, outbox, offline và bảo mật |
| [06 — Roadmap và validation](06-roadmap-and-validation.md) | Mốc giá trị, pilot với khách dùng Google, chỉ số, rollout và điều kiện phát hành |
| [07 — 58 task](07-tasks.md) | Đầu ra, dependency, acceptance, test mapping và trạng thái từng task |
| [08 — 10 wave](08-waves.md) | Thứ tự phụ thuộc, lane triển khai, gate và các blocker bên ngoài |
| [Test case và truy vết](test-cases/README.md) | Fixture, test catalog toàn roadmap, ma trận 58 task, lớp bằng chứng và mẫu kết quả chạy |

## Cách sử dụng

1. Đọc baseline/decisions trước khi phân công: không coi phần “có trong mã” là đã pass, không xây trùng tính năng hiện hữu.
2. Chọn task theo dependency ở backlog/waves; đọc functional spec và contracts tích hợp/dữ liệu liên quan trước khi sửa code.
3. Dùng test case của task làm acceptance; thêm đầy đủ API/DB/side-effect assertions, không chỉ UI hoặc HTTP status.
4. Ghi kết quả thực thi theo build và gate. Các yêu cầu chưa được triển khai vẫn giữ Planned/NOT RUN, provider thiếu điều kiện là BLOCKED.
5. Khi quyết định thay đổi, cập nhật spec, task, dependency và expected test cùng nhau; ghi rõ nguồn và lý do.

## Phạm vi đã chốt

Ưu tiên SME dịch vụ/agency, sau đó quản lý dự án và cá nhân/freelancer. Core features trên Web và Android. Dự án kế thừa workspace/team, private và guest; owner/admin workspace có quyền private, SaaS admin không tự có quyền nghiệp vụ. Guest tính ghế, invitation hợp lệ giữ ghế. Android tạo/sửa task offline có draft/queue/conflict. Calendar hai chiều bao gồm deadline chung; Zalo dùng OA của từng doanh nghiệp cho nhân viên và khách; có import và API/webhook.

Giữ giá/ghế Starter 199.000 VND/tháng–3 ghế, Team 499.000–10 ghế, Business 999.000–50 ghế; giữ giá năm và chức năng baseline. Không tự đổi commercial quotas. Downgrade giữ dữ liệu/private ACL, dừng premium writes/senders, guest hiện hữu readonly vẫn tính ghế; phải xử lý thừa ghế trước checkout nhỏ hơn.

Google Tasks connector, deadline date-only và booking là discovery, không thuộc 58 task bắt buộc. Google Calendar UI hiển thị Tasks không có nghĩa Calendar API quản lý Tasks. API `due` của Google Tasks là ngày dự kiến làm, không phải deadline và không giữ giờ.

## Nguồn chuẩn và tính nhất quán

- Quyết định người dùng và phân tầng gói: [02](02-baseline-and-decisions.md).
- Hành vi chức năng: [03](03-functional-spec.md); external mappings/contracts: [04](04-integrations.md); invariants dữ liệu: [05](05-architecture-and-data.md).
- Danh sách/dependency task: [07](07-tasks.md); wave scheduling/gates: [08](08-waves.md).
- Expected test phải phù hợp spec. Bất đồng phải sửa tài liệu liên quan và ghi quyết định, không coi file nào viết sau tự động ghi đè yêu cầu.
- [Kế hoạch enterprise cũ](../plans/enterprise-reminders.md) là tài liệu lịch sử, không phải baseline hiện tại.

Các tham chiếu source theo working tree ngày ghi, vốn có thay đổi có trước tại HEAD `894f068`. Phiên lưu spec không thay đổi source ứng dụng, không tạo task board, không triển khai migration và không chạy kiểm thử sản phẩm. Kiểm chứng tài liệu gồm sự tồn tại tệp, liên kết nội bộ, số task/dependency/wave và traceability; kết quả đó không thay bằng chứng release phần mềm.

## Kiểm tra bộ tài liệu ngày 16/10/2026

| Hạng mục | Kết quả kiểm tra tài liệu |
|---|---|
| Tệp Markdown | 14: 9 tệp spec chính và 5 tệp trong `test-cases/` |
| Backlog | 58 ID duy nhất, đủ W0–W9; dependency tham chiếu task tồn tại và không có chu trình |
| Ma trận task–test–gate | 58/58 task có liên kết đến case hoặc review phù hợp |
| Test case chuẩn | 308 định nghĩa: foundation 98, business/projects/automation 84, offline/import/integrations 114, cross-cutting 12 |
| Alias requirement | 277 ca theo catalog task được ánh xạ; W0/W1 dùng alias về case chuẩn, không cộng alias vào 308 |
| Liên kết và cấu trúc | Đường dẫn/anchor nội bộ hợp lệ; task/case anchors không trùng; code fences khép kín |
| Kiểm thử ứng dụng | Chưa chạy trong lần lưu spec; 308 là số ca được đặc tả, không phải số ca đã tự động hóa hoặc PASS |

Thay đổi nhỏ khi hợp nhất: chuẩn hóa requirement prefix `RQ-`, sửa đường dẫn backlog và bỏ liên kết baseline-run chưa tồn tại; bổ sung hai ca tạo/hoàn thành task gia hạn không tự đổi kỳ/tiền; làm rõ write eligibility khi thuê bao hết hạn trước TTL; thêm dependency lịch làm W5-T01 cho capacity W5-T04. Các thay đổi này không tăng số task hoặc đổi giá/ghế/phạm vi discovery.
