# Kiểm tra xuyên wave — project ACL, chuyển task và bootstrap phân trang

Lượt chạy ngày 16/10/2026 (UTC+7). Node 24.21.0, PostgreSQL 17.2, schema 13; base commit `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree đang được nhiều agent triển khai. [Manifest SHA256](../../../../artifacts/spec-all-2026-10-16/cross-wave-manifest.json) ghi các file thực tế. Database riêng, schema ngẫu nhiên do `tests/database-helpers.mjs` tạo/dọn. Không gửi provider thật và không thay đổi dữ liệu production.

## Thay đổi

- Quyền project hiện tại quyết định người phụ trách, người phối hợp, checklist, copy, template và action giao việc của automation. Người được cấp trực tiếp vào project thuộc team được thao tác theo role dù không nằm trong roster team. Picker cộng tác/mention và automation dùng phạm vi project; quyền team không được cấp ngầm.
- Chuyển project có label của project cũ hoặc người phối hợp/checklist không được xem project đích trả 409, giữ nguyên dữ liệu. Người dùng phải xử lý liên kết trước. Copy kiểm tra lại các liên kết; restore task đang mở kiểm tra assignee hiện tại và chặn project đã archive. Task hoàn thành giữ chính sách lịch sử của restore hiện hữu.
- Reminder task/checklist xét project ACL tại lúc xử lý, kể cả grant trực tiếp; người bị thu hồi/không còn quyền tương tác không nhận nhắc mới. Checklist import có mốc nhắc cũ không phát lại.
- `/api/dashboard` mặc định trả tối đa 50 task (tối đa cấu hình request 100), `taskPage` và tổng SQL theo ACL; `tasks=none` bỏ task records. Tổng task, trạng thái, người phụ trách chính và khách hàng được tính độc lập trang đang xem.
- Web dashboard/bảng task/khách hàng có phân trang và tổng thật; template/automation có picker tìm kiếm phân trang; mở task từ notification gọi detail nếu task không có ở trang hiện tại. Các màn hình tự tải dữ liệu không tải lại toàn bộ task từ bootstrap. Personal planner/Week giữ endpoint dữ liệu riêng và tín hiệu refresh; truy vấn personal task lọc ACL trong SQL, bỏ N+1 kiểm tra quyền từng task.

## Bằng chứng và kết quả thực tế

Fixture ACL: hai tenant; owner/member/guest; private project và team project; direct grant bên ngoài team; task có primary/secondary/checklist/label; gói Business. Fixture phân trang có 125 task công khai + private canary và khách hàng. Thời gian API dùng clock test của fixture; worker dùng mốc nhắc đã qua, không chờ giờ thật. Các case ghi dưới đây là kiểm tra API/PostgreSQL/worker, chưa là bằng chứng UI.

| Requirement / case | Bước và expected chính | Actual / trạng thái |
|---|---|---|
| TC-W1-T04-A/C, TC-X02 | Dò private canary qua list/search/dashboard/detail/extras/collaboration/reminder/notification/legacy export, cả tenant khác | Không trả canary ngoài quyền; PASS nội bộ |
| TC-W1-T04-C, TC-W1-T06-A/D | Grant editor/manager trực tiếp trong team project; tạo/sửa/giao việc, extras/checklist/copy/template/automation, picker | Không bị roster team cũ chặn; không cấp membership team; người không có grant bị từ chối; PASS API |
| TC-W1-T04-E, TC-W3-T03-F | Move task có label cũ, secondary không hợp lệ, rồi checklist không hợp lệ; xử lý hết liên kết và move lại | Ba lỗi 409; task/revision/event/receipt/notifications/outbox/queue/links không đổi; move hợp lệ thành công; PASS |
| TC-W1-T04-E | Revoke recipient rồi copy/checklist assignment/restore; archive project rồi restore | Không sao chép/giao mới vào phạm vi sai; restore bị chặn; PASS |
| TC-W1-T04-F, TC-W1-T10-E | Worker nhắc cho direct project member; revoke trước tick kế; mốc checklist import trong quá khứ | Nhắc hợp lệ được tạo một lần; revoke và import cũ không phát thêm; PASS worker |
| TC-W1-T04-C/F, TC-X02 | AI search rồi revoke private project trong lúc fake provider trả response; lưu hội thoại hợp lệ rồi revoke và đọc lại | Request giữa chừng 409, không lưu message; lịch sử sau revoke không trả canary/reference; PASS fake provider |
| TC-W2-T01-B/C/E, TC-X07 | Bootstrap mặc định/trang 2/compact; filter customer/open; tổng từ 125+1 task; user không có private grant | 50 records/trang, trang không trùng; total 126/125 theo ACL, 63 open thuộc customer; invalid pageSize 101 bị chặn; PASS API |
| TC-W4-T01-A/B, TC-W1-T08-C/D | Regression personal planner sau đổi predicate SQL | Quyền/tenant và kế hoạch mỗi người giữ độc lập, deadline không đổi; PASS API |

- [Hồi quy 66/66](../../../../artifacts/spec-all-2026-10-16/cross-wave-regression.log): project ACL, task details/extras, trash, automation/transfer, AI, personal plans, server/mobile backend và W5.
- [Kiểm tra sau chỉnh sửa cuối 25/25](../../../../artifacts/spec-all-2026-10-16/cross-wave-final-focused.log): ACL/paging, personal planner, task extras và AI. [Private AI revoke 1/1](../../../../artifacts/spec-all-2026-10-16/cross-wave-ai-private.log) bổ sung sau lượt này. Các suite trùng ca; không cộng số lượng làm coverage.
- Next SWC parse thành công App, TaskPicker, TaskTemplates, Automations, Teams, CustomerDetail; Node syntax và `git diff --check` đạt cho các file thay đổi. Đây không phải browser E2E hoặc build phát hành.

## Phép đo TC-X07 một phần

[Harness chạy được](../../../../tests/performance-x07.mjs), [JSON kết quả](../../../../artifacts/spec-all-2026-10-16/x07-performance.json), [log](../../../../artifacts/spec-all-2026-10-16/x07-performance.log). Fixed clock `2030-01-02T03:00:00Z`; 50 người, 50.000 task, 100.000 assignment, 140.000 business event, 90.000 automation queue items. Apple M1 Pro 10 logical CPU, RAM 16 GiB, macOS Darwin 25.6.0; shared development host, load average trước đo khoảng 5.28/5.19/12.45. Seed chia lô 1.000, ANALYZE trước đo. Mỗi API warm-up 2 request rồi đo 15 request tuần tự qua loopback HTTP, kết nối mới cho mỗi request. Query count gồm statements chuẩn bị và transaction statements do ứng dụng phát; không gồm statements nội bộ PostgreSQL trigger.

| Phép đo | p50 / p95 ms | Query/request | Payload task |
|---|---:|---:|---:|
| Bootstrap `tasks=none` | 52.6 / 57.8 | 13 | 0 |
| Bootstrap mặc định + tổng SQL | 107.0 / 108.9 | 17 | 50 |
| Task page 300, pageSize 100 | 109.1 / 118.1 | 6 | 100 |
| Task theo primary hoặc secondary assignee | 30.2 / 34.4 | 6 | 100; total 2.000 |
| PATCH một task, operation ID mới | 17.3 / 19.3 | 72 | 1 |
| Worker, 200 pending events/tick, 3 tick | 1.289,4 / 1.290,3 | 7.960–7.978/tick | 600 event đã xử lý |

RSS Node cao nhất khoảng 232 MiB, heap khoảng 58 MiB; không đo memory PostgreSQL hoặc browser. Queue sau 3 tick còn 89.400 item, mỗi tick xử lý hữu hạn 200. Các API đã đo nằm trong ngân sách kỹ thuật đề xuất; kết quả này không phải SLA và không phải nghiệm thu toàn bộ TC-X07.

Lần thử queue trước đó bị statement timeout trong bulk seed trên máy dùng chung: [log thất bại được giữ](../../../../artifacts/spec-all-2026-10-16/x07-queued-setup-timeout.log). Chia lô nhỏ giải quyết bước dựng fixture ở lần đo cuối. [Kết quả ban đầu](../../../../artifacts/spec-all-2026-10-16/x07-initial-idle-queue.json) có queue rỗng được tách riêng, không dùng thay phép đo backlog.

**TC-X07 còn NOT RUN cho nghiệm thu đầy đủ:** fixture private/guest/tenant ở quy mô 50k; đủ 250k event theo catalog; warm-up 60 giây + 5 phút/10 client; mẫu page đầu/cuối và 20/100 đầy đủ; EXPLAIN, memory DB/browser, payload bytes; provider latency; UI Web/Android. Tại thời điểm phép đo này, team detail và personal views còn dùng toàn bộ tập task; phần bổ sung bên dưới đã chuyển các UI này sang paging/window. Phép đo ban đầu không được dùng để khẳng định hiệu năng của query mới. `/api/tasks` không có query vẫn giữ hợp đồng legacy trả toàn bộ; Web picker/list mới dùng query phân trang.

## Nợ nghiệm thu còn lại

- Browser VC: next/previous + search/filter, tổng dashboard, customer filters/modal, picker template/automation, notification tới task ngoài trang, planner/Week refresh. Chưa có screenshot cho thay đổi này; parent thực hiện trong lượt browser chung.
- Audit source đã xác nhận file upload revalidate sau I/O, remote download revalidate trước stream, search/report predicates, AI references/history, copy/restore và legacy export. Chưa chạy mới toàn bộ upload bị revoke giữa stream, mọi role trên tất cả endpoint, mọi worker transport. Bằng chứng cũ phải được liên kết riêng khi tổng hợp gate.
- Google/OA/Android thiết bị thật tiếp tục BLOCKED/chờ môi trường theo chỉ đạo người dùng; fake provider không thay thế gate thực tế. Không đánh dấu W1/W2/W5 hay release gate PASS chỉ từ các suite trên.

## Bổ sung planner/team/calendar và sửa lỗi browser

Snapshot riêng: [planner-pagination-manifest.json](../../../../artifacts/spec-all-2026-10-16/planner-pagination-manifest.json), cùng base commit/schema 13; working tree chưa commit. Dùng PostgreSQL riêng qua test helpers; không sửa schema hoặc dùng dữ liệu production.

- **TC-W4-T01-A/B/D, TC-X06/X07:** `/personal-tasks` có query hỗ trợ `view=inbox|today|upcoming|week`, `date=YYYY-MM-DD`, `page/pageSize` (mặc định 50, tối đa 100), tìm tên, tìm ID và open-only picker. Lọc ACL/assignment/ngày trước COUNT/LIMIT. Ngày UTC+7, deadline tương lai vẫn xuất hiện dù personal plan đã cũ; Week giữ cả ngày kế hoạch và deadline độc lập. GET không query giữ hợp đồng legacy.
- **TC-W1-T06, TC-X07:** team detail có paging và `tasks=none` cho picker/thao tác chỉ cần member. Tổng team giữ toàn bộ phạm vi; board/list ghi rõ trang hiện tại. Web giữ form đang mở khi refresh cùng team; response cũ không được áp vào scope mới.
- **TC-W4-T01, TC-X06/X07:** calendar query lấy lịch giao khoảng ngày (kể cả lịch bắt đầu trước tuần) và renewal projection qua một UNION phân trang ổn định. Search/team/kind/due được áp trên phạm vi hợp lệ; SQL summary không lấy số lượng trang làm tổng. App không tải lại toàn bộ lịch hẹn trên các trang personal, dashboard/tasks phân trang lịch hẹn riêng. Week có hai bộ phân trang và picker tìm các task ngoài tuần/chưa có ngày; revision kế hoạch vẫn được gửi khi lưu.
- **TC-W4-T02/T03/T04:** Android dùng query cùng Web; cache key vẫn chứa scope/path. Bản kế hoạch chờ gửi giữ snapshot công việc trong queue mã hóa để chuyển view chưa cache không làm mất nháp. Snapshot được bỏ khỏi body trước enqueue/replay; current revision/operation ID không đổi, mất quyền vẫn cách ly. Thống kê cached/pending có nhãn rõ, số liệu biểu đồ chỉ thuộc trang đang xem.
- **TC-X05:** sửa đúng nguồn cảnh báo duplicate React key: TaskExtras và TaskReminders là hai sibling cùng task ID, nay có suffix riêng. Week next-items có date trong key cho event kéo nhiều ngày. App fallback backend cũ tính member/customer totals từ legacy full dataset khi thiếu SQL summary. Các sửa này parse thành công; browser VC phải kiểm tra lại trong lượt nghiệm thu chung.

| Kiểm tra | Kết quả / bằng chứng |
|---|---|
| API planner/team/event + hồi quy ACL, services, automation | **26/26 PASS** — [planner-pagination-regression.log](../../../../artifacts/spec-all-2026-10-16/planner-pagination-regression.log). So sánh cả 4 view trên 4 ngày quanh 29/2 với shared grouping; union mọi trang không thiếu/trùng; noquery legacy; ID picker/revision; team archive/compact; calendar overlap/renewal/search/totals và quyền team. |
| Android typecheck/lint | **PASS** — `planner-pagination-mobile-typecheck.log`, `planner-pagination-mobile-lint.log` trong thư mục artifact cùng ngày. |
| Android unit | **24/24 PASS** — [planner-pagination-mobile-unit.log](../../../../artifacts/spec-all-2026-10-16/planner-pagination-mobile-unit.log), gồm projection vào view chưa cache và resource bị cách ly. |
| Android component toàn bộ sau UI mới | **23 suites, 110/110 PASS** — [planner-pagination-mobile-components-all.log](../../../../artifacts/spec-all-2026-10-16/planner-pagination-mobile-components-all.log). |
| Session integration bổ sung sau lượt toàn bộ | **11/11 PASS** — [planner-pagination-mobile-session.log](../../../../artifacts/spec-all-2026-10-16/planner-pagination-mobile-session.log); thêm queue snapshot → đọc trang chưa cache → reconnect, payload gửi chỉ có field nghiệp vụ/revision/operation ID. Suite trùng phần lớn với lượt trên, không cộng làm coverage. |
| Web | Next SWC parse 7 file App/TaskDetail/TaskPicker/PersonalTasks/PersonalDashboard/WeekCalendar/Teams; Node syntax và diff whitespace PASS. **Không phải browser E2E**. |

Lỗi restore từ audit chéo được sửa riêng: khi restore cùng project, completed checklist giữ assignee cũ như lịch sử; checklist chưa hoàn thành và secondary assignment vẫn kiểm tra quyền hiện tại. Copy/move vẫn kiểm tra tất cả recipient vì tạo scope/thực thể mới. Regression thêm xác nhận history còn nguyên và người đã mất quyền vẫn 404. **18/18 PASS** — [log kiểm tra](../../../../artifacts/spec-all-2026-10-16/restore-completed-history-regression.log); lượt chạy nhầm harness SQLite trên PostgreSQL được giữ riêng ở `restore-completed-history-wrong-harness.log`, không dùng làm bằng chứng PASS.

**Nợ bằng chứng:** root chạy load X07 đầy đủ và browser VC riêng. APK/Hermes trước phần bổ sung này là snapshot cũ; cần build/export mới sau khi đo tải xong. Không có gate Google/OA/thiết bị thật được đánh dấu PASS từ các test giả lập/component này.

## Rà lỗi quyền và cache Web sau phân trang

**TC-X01/X02/X05, TC-W4-T04-G, TC-W7-T04-E, TC-W8-T01, TC-W9-T01:** các surface PersonalTasks, WeekCalendar, Teams, task picker và Google/Public API/Zalo dùng guard request chung. HTTP 401/403/404/423 xóa dữ liệu server và vô hiệu hóa kết quả đọc đang chờ; response sau đổi API/scope/unmount không khôi phục dữ liệu hoặc bắt đầu follow-up read. Snapshot planner gắn query identity để trang cũ không hiện như trang mới khi request thất bại. Nút ghi bị khóa sau denial cho đến khi đọc lại thành công. Nội dung quick-entry và phần ngày/giờ draft được giữ; metadata task/revision của editor bị bỏ khi mất quyền. Token chỉ hiện một lần, lịch sử webhook, preview OA, credential form và Calendar conflict không còn hiển thị sau denial. Cache tích hợp còn hiện khi lỗi chưa xác định quyền có nhãn chưa đối soát lại.

[Web component harness](../../../../tests/web-denial-component-check.mjs): chạy `node --test tests/web-denial-component-check.mjs` sau khi dependency gốc và mobile đã cài. Tái sử dụng ReactDOM/SWC của repo và jsdom đã có trong mobile, không thêm dependency production. Đây là file opt-in để suite root không mặc định yêu cầu mobile install.

**13/13 PASS** — [web-denial-components.log](../../../../artifacts/spec-all-2026-10-16/web-denial-components.log), [snapshot](../../../../artifacts/spec-all-2026-10-16/web-denial-manifest.json). Render component Web thật với API giả lập, kiểm tra canary biến mất, input draft còn đúng giá trị, pending mutation không thực hiện read tiếp sau unmount, parallel response không hồi sinh cache, Team 423, Google old-scope response, API one-time secret và OA preview. Harness phát hiện thêm React key trùng ở chip “Chưa đặt giờ”; NextCard dùng khóa theo vị trí chip cố định, lượt cuối không còn cảnh báo này. SWC parse 9 file và diff whitespace PASS.

**Browser VC vẫn NOT RUN cho thay đổi này.** Không gọi DOM giả lập là browser E2E; không đổi trạng thái gate provider/device thật. Backend/mobile không thay đổi trong lượt rà này, không khởi chạy build nặng trong lúc root đo tải.
