# Hiện trạng, quyết định và giả định

Ngày: 16/10/2026; mốc HEAD đọc được: `894f068`. Working tree có nhiều thay đổi có trước trong server, Web, Android, tests và lockfiles. Baseline này dựa trên **working tree được đọc**, không chỉ HEAD, không xác nhận mọi thay đổi đã merge hoặc pass CI. Lần lưu spec chỉ sửa tài liệu trong `docs/product-spec/`; không reset các thay đổi khác.

## 1. Cách phân loại thông tin

- **Có trong mã:** quan sát được implementation hoặc test, chưa tự động đồng nghĩa đã nghiệm thu trên runtime.
- **Khoảng trống:** thiếu hành vi đích hoặc implementation hiện hữu chưa bao phủ đúng phạm vi.
- **Đã chốt:** yêu cầu người dùng xác định trong quá trình lập kế hoạch.
- **Mặc định thiết kế:** lựa chọn kỹ thuật được đề xuất để triển khai nhất quán; ghi nguồn riêng, không gán thành phát biểu của người dùng.
- **Discovery:** nghiên cứu chưa cam kết đưa vào release; nằm ngoài 58 task W0–W9.

Tài liệu [enterprise-reminders cũ](../plans/enterprise-reminders.md) mô tả trạng thái trước triển khai tháng 9. Không dùng các câu “chưa có” ở đó để phủ nhận tính năng đã có trong working tree hiện tại.

## 2. Inventory theo mã nguồn

| Năng lực | Bằng chứng trong repo | Hiện trạng và khoảng trống |
|---|---|---|
| Server/Web | [package](../../package.json), [server](../../server/index.mjs), [App](../../src/App.jsx) | Node yêu cầu ≥24; Next/React và server nghiệp vụ đã có. Không thiết kế lại framework để lưu hoặc triển khai spec |
| Database | [db](../../server/db.mjs), [PostgreSQL migrations](../../server/migrations/postgres/001-baseline.sql), [legacy SQLite](../../server/legacy-sqlite.mjs), [hướng dẫn](../POSTGRESQL.md) | PostgreSQL là database runtime; SQLite là nguồn legacy/import và fixture tương thích. Dùng migration version mới, không sửa migration đã áp dụng |
| Task/board | [boards](../../server/boards.mjs), [task detail](../../server/task-details.mjs), [recurrence](../../server/recurrence.mjs) | Task, cột, todo/doing/done, priority, deadline, recurrence và lịch sử đã có. Chưa có project/ACL/guest đích hoàn chỉnh |
| Team/quyền | [teams](../../server/teams.mjs) | Scope chung hiện cho workspace member truy cập; team có cơ chế riêng. Guest không thể chỉ thêm một role UI vì mọi đường scope chung cần đổi |
| Checklist/cộng tác | [task extras](../../server/task-extras.mjs), [collaboration](../../server/collaboration.mjs), [TaskChecklists](../../src/TaskChecklists.jsx), [TaskExtras](../../src/TaskExtras.jsx) | Checklist, nhiều người, nhãn, comment/mention/file đã có. Cần tích hợp đầy đủ controls đang rời và không tạo checklist UI thứ hai |
| Templates/automation | [automations](../../server/automations.mjs), [task extras](../../server/task-extras.mjs), [UI automation](../../src/Automations.jsx), [UI templates](../../src/TaskTemplates.jsx) | Có basic rules và task/checklist templates. Navigation đang loại automation/templates ở một số nơi; rule edit chỉ bật/tắt, status trigger còn dựa summary ở đường hiện hữu. Max 10 actions đã có; cần mở rộng, không xây trùng |
| Planner/calendar nội bộ | [personal tasks](../../server/personal-tasks.mjs), [calendar events](../../server/calendar-events.mjs), [WeekCalendar](../../src/WeekCalendar.jsx) | Task có thể không hạn; kế hoạch theo người tách deadline; time block và lịch hẹn có sẵn. Không đồng nghĩa đã kết nối Google Calendar |
| Nhắc việc | [reminder workflow](../../server/reminder-workflow.mjs), [mobile backend](../../server/mobile.mjs), [web push](../../server/web-push.mjs) | Email/FCM/Web Push, phản hồi ack/snooze và delivery/outbox có sẵn. Cần lịch sử đủ kênh, typed business events, outbox dùng chung và revalidation project/entitlement |
| Dịch vụ/khách/thu–chi | [services](../../server/services.mjs), [Services](../../src/Services.jsx), [CustomerDetail](../../src/CustomerDetail.jsx) | Hồ sơ dịch vụ, license, kỳ/lịch sử gia hạn, chăm sóc và liên kết lịch có sẵn. Cần task gia hạn + expense tùy chọn nguyên tử, dashboard và parity Android |
| Lỗi hiển thị thu–chi | [CustomerDetail](../../src/CustomerDetail.jsx) | Có nhánh dựa `kind`/dấu amount thay vì `type`; amount chi dương có nguy cơ bị coi là thu. W0-T04 phải đối soát cùng dữ liệu với trang tài chính |
| Filter/ngày/tên gói | [App](../../src/App.jsx) | Một số thống kê chỉ dùng primary assignee; billing còn map tên cứng; helper ngày local theo thiết bị chưa đủ chứng minh business day UTC+7. W0-T04 khóa lại hành vi bằng tests |
| Revision | [record revision](../../server/record-revision.mjs), [cross-platform tests](../../tests/cross-platform-sync.test.mjs) | Có hash revision scalar và expectedRevision tùy chọn, stale edit 409 và test đa process. Còn thiếu revision tổng hợp child, revision planner riêng và mutation receipt chung |
| Android | [mobile package](../../mobile/package.json), [session](../../mobile/src/core/session.tsx), [policy](../../mobile/src/core/policy.ts), [cache](../../mobile/src/core/cache.ts), [hướng dẫn](../ANDROID.md) | Expo 57/RN 0.86.3, SQLCipher cache scope và TTL 24h; ghi hiện yêu cầu online. Không mô tả cache này thành queue tạo/sửa offline đã có |
| Import/export | [board transfer](../../server/board-transfer.mjs), [BoardTransfer](../../src/BoardTransfer.jsx) | JSON board transfer có hợp đồng append và regression. CSV/Trello preview/dedupe/atomic commit là phần bổ sung |
| Google hiện tại | [Google login](../../server/google-login.mjs), [remote storage](../../server/remote-storage.mjs) | Google login và Drive/storage là các chức năng khác Calendar/Tasks connector; không tái dùng scope/token một cách ngầm định |
| Billing/gói | [index](../../server/index.mjs), [admin plans tests](../../tests/admin-plans.test.mjs), [billing contract tests](../../tests/billgateway-contract.test.mjs) | Catalog tùy chỉnh, invoices/payment và kiểm tra số member+pending invite đã có. Entitlement code và guest/project seat concurrency cần mở rộng |
| Backup/trash/storage | [backups](../../server/backups.mjs), [snapshot](../../server/database-snapshot.mjs), [trash](../../server/trash.mjs), [registry](../../server/database-tables.mjs) | Có nền tảng backup/restore và trash. Mọi entity mới phải vào migration/snapshot/restore/ACL, không chỉ bảng runtime |
| Tests | [tests](../../tests), [mobile tests](../../mobile/tests), [test spec](test-cases/README.md) | Có node:test/PostgreSQL/legacy/Next runtime và mobile unit/component. Có suite không đồng nghĩa assertion cho feature mới đã có hoặc đã pass |

Những điều đã có trong code phải được tận dụng. W0 mở lại UI và sửa lỗi hiện hữu; W1 trở đi thêm năng lực chưa có. Các file bị sửa trong working tree có thể tiếp tục thay đổi; W0-T02 lưu baseline/test result mới trước khi triển khai feature.

## 3. Quyết định sản phẩm đã chốt

| ID | Quyết định | Hệ quả bắt buộc |
|---|---|---|
| D-01 | Ưu tiên SME dịch vụ/agency, sau đó quản lý dự án, rồi cá nhân/freelancer | Roadmap ưu tiên độ tin cậy và vận hành dịch vụ trước breadth cạnh tranh |
| D-02 | Spec và kế hoạch phải đầy đủ toàn roadmap | Không chỉ mô tả phase đầu; đủ 58 task, 10 wave, dependency, acceptance và tests |
| D-03 | Core features chạy Web + Android | Có parity nghiệp vụ; UI phù hợp thiết bị, không bắt buộc layout giống nhau |
| D-04 | Project hỗ trợ kế thừa workspace/team, private nội bộ và guest | ACL ở backend và mọi projection/worker, không chỉ giấu menu |
| D-05 | Workspace owner/admin truy cập được private project; SaaS admin không tự có quyền nghiệp vụ | UX private phải diễn đạt đúng; test hai loại admin riêng |
| D-06 | Guest tính một ghế mỗi workspace; pending invitation hợp lệ giữ ghế | Dedupe cùng người/email chuẩn hóa và lock cạnh tranh invite/accept/checkout |
| D-07 | Android phải tạo/sửa task offline | Có durable draft/outbox, conflict và phục hồi, không chỉ đọc cache |
| D-08 | Nhập CSV/Trello; giữ JSON v1 tương thích | Preview, mapping, duplicate policy và atomic commit; không tự tạo users |
| D-09 | Google Calendar hai chiều, có deadline chung | Deadline edit có ACL/revision; personal plan riêng; không ngầm triển khai Google Tasks |
| D-10 | Zalo cho nhân viên và khách hàng, bằng OA từng doanh nghiệp | Kiểm tra mục đích/template/recipient/provider readiness; tenant isolation |
| D-11 | Có public API/webhook | Giao quyền theo token ∩ creator ∩ entitlement; delivery at-least-once có event ID |
| D-12 | Ba tier chức năng; giữ giá/ghế và baseline hiện hữu | Mã entitlement có kiểm soát; không khóa lại feature baseline chỉ vì đổi marketing |
| D-13 | Downgrade không xóa dữ liệu hoặc công khai private | Premium writes/senders dừng; đọc/export theo ACL giữ; guest readonly vẫn tính ghế |
| D-14 | Giảm ghế trước checkout gói nhỏ hơn | Không xóa member/guest tự động; settlement recheck và concurrency an toàn |
| D-15 | Ghi toàn bộ mô tả, tasks/waves/tests trong thư mục spec riêng | Bộ tài liệu dùng độc lập, không trỏ người triển khai về lịch sử chat |

## 4. Gói chức năng và giới hạn thương mại

| Gói | Giá tháng / năm hiện hữu | Ghế hiện hữu | Năng lực mới được phân tầng |
|---|---|---|---|
| Starter | 199.000 / 1.990.000 VND | 3 | Dự án cơ bản, planner, Android offline, import, Calendar, báo cáo vận hành |
| Team | 499.000 / 4.990.000 VND | 10 | Starter + private project, custom fields, dependencies/timeline/project templates, time tracking, lịch làm/delegate, automation nâng cao |
| Business | 999.000 / 9.990.000 VND | 50 | Team + guest, Zalo, API/webhook, SLA, portfolio/capacity |

Giá năm ghi để bảo toàn catalog hiện có, không đề xuất đổi chính sách giá. Gói custom dựa entitlement codes, không suy quyền từ tên. Giá, AI/storage/automation commercial quota chưa được yêu cầu đổi. Giới hạn max 10 actions/rule là validation kỹ thuật đang có, không biến thành quota số lượt chạy mới.

Private data sau downgrade giữ riêng tư và đọc/export hợp lệ; không cho workaround bằng API cũ, API token, offline queue hoặc worker cầm quyền cũ. Cấu hình/lịch sử premium được giữ để người có quyền xem và nâng lại, nhưng không replay lịch sử khi nâng gói lại.

## 5. Mặc định kỹ thuật đề xuất, phân biệt với quyết định người dùng

| ID | Mặc định triển khai | Lý do và giới hạn |
|---|---|---|
| A-01 | Một board chính mỗi project; backfill default project cho scope cũ | Giữ mô hình hiện tại đơn giản, không mở multi-board mới trong cùng scope |
| A-02 | Cột custom ánh xạ todo/doing/done | Không thay lifecycle nền tảng và recurrence bằng tên cột tùy ý |
| A-03 | Deadline có timestamp; personal plan theo `(task,user)` | Không dùng ngày dự định làm làm hạn chung; date-only deadline còn discovery |
| A-04 | Calendar riêng do app tạo; deadline projection 15 phút/free/reminders off | Giới hạn scope và tránh tạo cảm giác deadline là cuộc họp bận |
| A-05 | SQLCipher draft/queue riêng cache đọc; TTL tối đa 24h và bị giới hạn bởi session/quyền ghi | Cache bị invalidation không được xóa draft chưa gửi; không có thu hồi tức thời khi offline hoàn toàn |
| A-06 | Một operation đang gửi/resource; op ID và payload bất biến sau send | Giảm conflict tự gây; không dùng replay không nhận diện được kết quả |
| A-07 | Giữ triển khai một sender worker; claim/dedup bằng DB | Có test overlapping workers để chống sự cố, chưa cam kết scale multiworker |
| A-08 | Work calendar opt-in, Mon–Fri 09–12/13–18, ngày nghỉ khai báo | Không tự thay hành vi dữ liệu cũ; recurrence dời ngày nhưng giữ anchor |
| A-09 | Field có dữ liệu không đổi type trực tiếp; retire giữ giá trị cũ | Tránh chuyển kiểu mất dữ liệu; UI/filter/export vẫn giải thích giá trị lịch sử |
| A-10 | Dependency cùng project, finish-to-start DAG, advisory; archive tiền nhiệm không là done | Không tự reschedule; chặn move cho đến khi xử lý cạnh không còn hợp lệ |
| A-11 | Automation chạy bằng quyền hiện tại của chủ rule, skip nếu mất quyền | Không mượn quyền hệ thống; typed events thay việc suy summary text |
| A-12 | Time entry lưu giây nguyên, cộng trước định dạng; người dùng sửa entry của mình | Một timer/user/workspace; mất quyền ghi hoặc xóa mềm task đóng timer ở thời điểm server xử lý và giữ lịch sử |
| A-13 | SLA theo completed cycles có deadline snapshot; reopen mở chu kỳ mới | Tách task count, assignment count, completion-cycle count; dữ liệu cũ thiếu event là unknown |
| A-14 | Catch-up chỉ mốc mới nhất còn hợp lệ của chu kỳ; không bù từng ngày lịch sử | Không gửi dồn sau downtime, import hoặc nâng lại gói |
| A-15 | p95 API phân trang đọc ≤1s, ghi ≤2s trên môi trường đo cố định | Ngân sách đề xuất; bulk/provider đo riêng; không là SLA bán hàng hay quota thương mại |

Mặc định được lưu để implementer không tự phát minh hành vi khác nhau giữa Web/Android/API. Nếu có thay đổi sản phẩm, cập nhật ID quyết định/phiên bản spec và toàn bộ expected test liên quan trước khi đổi hành vi, không suy implementation hiện tại là chuẩn.

## 6. Discovery và phần chưa cam kết

| ID | Nội dung | Điều kiện quyết định tiếp |
|---|---|---|
| D01 | Google Tasks connector | Chứng minh mapping khả thi với API hiện tại, date-only scheduled date, polling và hidden/deleted; không hứa full fidelity |
| D02 | Deadline chỉ có ngày | Chốt nghĩa overdue/timezone/reminder/migration và UI trước khi thay `dueAt` |
| D03 | Booking khách tự đặt hẹn | Chốt quy trình, availability, quyền calendar và API hỗ trợ; không suy scope app-created đọc được mọi lịch |
| D04 | Pilot 5–8 doanh nghiệp đang dùng Google trong khoảng một tháng | Đo thời gian đôn đốc, kỳ bỏ sót, adoption và thanh toán thực; không tự liên hệ/gửi tin |
| D05 | Đổi ưu tiên/pricing dựa pilot | Dùng bằng chứng; không tự đổi giá/ghế/quota của 58 task hiện tại |

External prerequisites gồm cấu hình OAuth/verification, tài khoản thử Google, OA/template/recipient đủ điều kiện và thiết bị Android. Đây là blockers có tên cho gate tương ứng, không là lý do ngừng làm phần nội bộ độc lập.

## 7. Chất lượng bằng chứng và trạng thái

Lần này có đọc mã, kiểm tra cấu trúc tài liệu và GET discovery Google Tasks; không chạy suite ứng dụng, thử UI runtime hoặc gửi Google/Zalo thật. Không đánh dấu test mới PASS từ việc có tên suite. [Test README](test-cases/README.md) định nghĩa NOT RUN/PASS/FAIL/BLOCKED và hồ sơ thực thi.

W0-T02 phải lưu baseline test/runtime thực tế khi bắt đầu triển khai, gồm dirty snapshot, lockfile, môi trường test riêng và lỗi sẵn có. Tài liệu hiện hữu hoặc bằng chứng từ một lần chạy khác chỉ được dẫn lại kèm ngày/build/phạm vi, không nhập chung thành kết luận toàn roadmap đã đạt.
