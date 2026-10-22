# Kiểm thử xuyên suốt và nghiệm thu phát hành

Nguồn yêu cầu: kế hoạch 58 task/10 wave ngày 2026-10-16. Dùng [fixture và quy ước chung](README.md); đây là đặc tả nghiệm thu, không phải tuyên bố tính năng đã triển khai. Các biến thể trong mỗi ca phải có dòng kết quả riêng theo nền tảng, vai trò và đường truy cập.

## Hồ sơ thực thi kế thừa cho từng ca

Mỗi TC-X01–TC-X12 kế thừa: thời gian `CLOCK-VN`, tài khoản và dữ liệu `BASE` trừ khi ghi đè; PostgreSQL/schema riêng; build/commit **chưa gán**; kết quả **NOT RUN**; thực tế **chưa thực thi ca đầy đủ**; bằng chứng **chưa có**. Cột “Triển khai” mô tả bộ test, tách khỏi kết quả chạy. Sau khi chạy, ghi hồ sơ theo mẫu trong README, không đổi cả catalog sang PASS vì một suite cũ đạt. `API/DB/UI/side effects` đều là tiêu chí bắt buộc; lớp không áp dụng phải ghi lý do trong hồ sơ.

<a id="tc-x01"></a>
## TC-X01 — Auth/session

- Requirement: `RQ-X01`; task: W0-T03, W0-T05, W1-T04/T06, W4-T02/T04, W7-T01, W9-T01/T05. **P0; API + component + E2E; Web/Android.**
- Tiền điều kiện: E đăng nhập A; B1 ở B; phiên cũ đang tải task TP; transport giữ được response. Có tài khoản reset mật khẩu và Google login thử hợp lệ.
- Bước: (1) Đăng nhập, đọc dữ liệu. (2) Lần lượt hết phiên, logout, reset mật khẩu, khóa user, đổi workspace/account; giữ request cũ đang bay. (3) Thả response cũ, back/refresh/restart, gọi API bằng cookie/bearer cũ. (4) Lặp login Google và reconnect Calendar độc lập.
- API: phiên/credential không hợp lệ bị từ chối đúng hợp đồng; Google login không cấp Calendar scope. UI: không hồi sinh phiên hoặc render cache scope trước; bản nháp offline bị khóa, giữ theo chính sách. DB: phiên bị thu hồi không sống lại; draft không bị xóa ngoài lựa chọn của user. Tác dụng phụ: request/response trễ không enqueue hoặc gửi bằng quyền cũ; không lộ secret trong log.
- Triển khai: **cần mở rộng toàn ca**; các suite auth nêu trong [sổ nghiệm thu](runs/2026-10-16-acceptance-ledger.md) được bổ sung bởi `mobile/tests/session.test.tsx`, `mobile/tests/offline-state.test.ts`, `tests/web-denial-component-check.mjs` cho TTL/high-water clock/response đến trễ. Đã có assertion nội bộ về TTL offline; E2E hai thiết bị và provider thật vẫn cần bằng chứng riêng.

<a id="tc-x02"></a>
## TC-X02 — Chống rò dữ liệu

- Requirement: `RQ-X02`; task: W1-T04/T06/T11, W2-T01, W3-T02, W5-T04/T05, W6-T05, W7-T02/T03, W8-T03, W9-T01/T02/T03/T05. **P0; API + DB + E2E; Web/Android/worker.**
- Tiền điều kiện: TP/private và PB-C mang hai canary khác nhau, có file, comment, history, CRM và bản xóa mềm; N/B1/G-V/SA không được cấp các phạm vi tương ứng.
- Bước: (1) Lập inventory route từ server/mobile/API v1/worker và đánh dấu mỗi role/resource. (2) Dò canary qua path/query/body, search/AI/count/export/trash/download/history và mọi trang. (3) Thu hồi quyền sau enqueue, chạy worker và xem cache UI. (4) Thử các role có quyền để phân biệt chặn đúng với endpoint hỏng.
- API: không tiết lộ nội dung, actor, tổng, liên kết hoặc sự tồn tại qua response khác biệt ngoài hợp đồng. UI: không giữ cache nhạy cảm sau khi phát hiện revoke. DB: không có ghi trái quyền. Tác dụng phụ: payload notification/projection/webhook không mang canary ngoài phạm vi; file URL cũ không bỏ ACL.
- Triển khai: **cần mở rộng toàn bộ route/role matrix**; `tests/project-role-matrix.test.mjs`, `tests/project-access-routes.test.mjs`, `tests/ai-assistant.test.mjs`, `tests/security-logic-regressions.test.mjs` và các suite file/trash đã có assertion project/guest/canary. [Ma trận quyền](runs/2026-10-16-role-matrix.md) liệt kê chính xác 12 nhóm tài khoản và đường đã kiểm; không suy mọi endpoint đã được phủ. Liên kết TC-FND-021–040, không tính hai lần cùng bằng chứng.

<a id="tc-x03"></a>
## TC-X03 — Nội dung và file

- Requirement: `RQ-X03`; task: W0-T03, W1-T04, W3-T01, W6-T01/T05, W9-T02. **P0; API + component + browser/device; Web/Android.**
- Tiền điều kiện: E được ghi, V chỉ đọc, N không có quyền; fixture tiếng Việt/emoji, HTML/script, Markdown link `javascript:`, URL nguy hiểm, filename traversal, MIME sai và byte ở/vượt giới hạn cấu hình.
- Bước: (1) Nhập từng payload vào title/comment/custom field/import. (2) Upload/download/preview tệp đúng và sai MIME/kích thước, đổi parent ID. (3) Render lại trên hai client rồi thu hồi quyền và tải URL cũ.
- API: validate size/type/path và URL theo allowlist; lỗi field rõ, không trả bytes ngoài ACL. UI: nội dung được escape/sanitize, script không chạy, tên dài vẫn đọc được. DB: input bị từ chối không để bản ghi/file mồ côi. Tác dụng phụ: không thực thi HTML, gọi URL nguy hiểm hoặc để tệp vượt thư mục; export CSV không kích hoạt formula.
- Triển khai: **cần mở rộng** `tests/task-files.test.mjs`, `tests/comment-files.test.mjs`, `tests/assistant-markdown.test.mjs`, `tests/services.test.mjs`, `mobile/tests/files.test.tsx`; browser/device thật **thủ công**, không thay bằng source assertion.

<a id="tc-x04"></a>
## TC-X04 — Khả năng truy cập

- Requirement: `RQ-X04`; task: mọi task có UI; W1-T06, W2-T04/T05, W3-T06, W4-T05, W6-T04, W9-T05 là gate đại diện. **P1; UI thủ công; Web keyboard/Android TalkBack.**
- Tiền điều kiện: E và G-V; build Web/Android cụ thể; fixture form lỗi, loading, danh sách dài; ghi browser, OS, thiết bị, cỡ font trong hồ sơ.
- Bước: (1) Chỉ dùng bàn phím mở picker/modal, thêm task, xử lý conflict, đóng và quay focus. (2) Dùng TalkBack với font lớn qua cùng luồng. (3) Thử lỗi validation/loading/retry, trạng thái không chỉ có màu và role readonly.
- API: thao tác hợp lệ qua công cụ trợ năng có cùng hợp đồng; không có submit do focus nhầm. UI: tên/role/state được đọc đúng, thứ tự focus hợp lý, không focus trap ngoài modal, lỗi gắn với field và có thông báo thay đổi. DB: một submit tạo một bản ghi. Tác dụng phụ: không double-submit hoặc kích hoạt thao tác khi đang loading.
- Triển khai: **thủ công**; `mobile/tests/layout.test.ts`, `mobile/tests/task-form.test.tsx` và `tests/web-app.test.mjs` chỉ hỗ trợ regression cấu trúc/component, không chứng minh keyboard/TalkBack thực tế.

<a id="tc-x05"></a>
## TC-X05 — Giao diện và lỗi

- Requirement: `RQ-X05`; task: tất cả task có UI và gate W2–W9. **P0; component + E2E; Web/Android.**
- Tiền điều kiện: E, G-V; viewport Web 320/768/1440px, Android hẹp/rộng và font lớn; nội dung dài; transport lỗi trước/sau commit, giữ response và gửi trùng.
- Bước: (1) Mở list/detail/form với empty/loading/long/error/cache. (2) Nhập draft, mất mạng, retry và double-submit. (3) Đổi quyền/scope khi modal đang mở; nhận response trễ. (4) Reload trên thiết bị khác và đối soát.
- API: error/revision/idempotency đúng; trường hợp mất response phải đối soát receipt trước kết luận. UI: không mất input, không báo đã lưu khi chưa bền vững, pending/error/stale có nhãn rõ; không tràn mất nút thao tác. DB: không trùng mutation; phiên cũ không ghi. Tác dụng phụ: chỉ số logical delivery/event đúng với mutation đã commit.
- Triển khai: **cần mở rộng** `mobile/tests/task-form.test.tsx`, `mobile/tests/service-detail.test.tsx`, `mobile/tests/event-form.test.tsx`, `mobile/tests/notifications.test.tsx`, `tests/cross-platform-sync.test.mjs`; browser/device **thủ công**.

<a id="tc-x06"></a>
## TC-X06 — Thời gian

- Requirement: `RQ-X06`; task: W0-T04, W2-T02/T03, W3-T04/T05, W4-T01/T04, W5-T01/T02/T03/T05, W7-T02/T03/T05. **P0; unit + API + E2E; Web/Android/worker/provider.**
- Tiền điều kiện: CLOCK-VN và CLOCK-EDGE; task không hạn/lặp, quiet hours 22:00–07:00, planner cá nhân; device đổi timezone hoặc lùi đồng hồ.
- Bước: (1) Tiến fake clock qua 17:00 UTC, cuối tháng/năm và 29/2/2028. (2) Đổi timezone UTC/Asia/Ho_Chi_Minh/America/New_York; chạy DST gap/fold. (3) Chạy recurrence, reminder, report, TTL; đổi lùi giờ thiết bị; retry tick. (4) Kiểm tra Google timed/all-day riêng.
- API: ngày hợp lệ giữ nghĩa; ngày sai/mơ hồ không bị tự chọn. UI: bucket Today và ngày Việt Nam đúng, không suy hạn cho task không hạn. DB: deadline chung, plan cá nhân và recurrence anchor độc lập; TTL không kéo dài do lùi giờ. Tác dụng phụ: một logical reminder tại mốc hợp lệ, không catch-up toàn lịch sử; không tự chuyển all-day thành deadline có giờ.
- Triển khai: **cần mở rộng toàn tổ hợp thời gian**; recurrence/service/week/reminder được bổ sung bởi `tests/personal-planning.test.mjs`, `tests/planner-pagination.test.mjs`, `tests/google-calendar.test.mjs`, `mobile/tests/offline-state.test.ts`, `mobile/tests/session.test.tsx`. Đã có TTL, clock rollback và Calendar giả lập; xem [W4](runs/2026-10-16-w4-internal.md), [W7](runs/2026-10-16-w7-internal.md). Timezone thiết bị/provider thật vẫn **thủ công/NOT RUN**.

<a id="tc-x07"></a>
## TC-X07 — Hiệu năng

- Requirement: `RQ-X07`; task: W1-T04/T10/T11, W2-T01, W3-T02/T04, W5-T04/T05/T06, W6-T05, W9-T02/T05. **P1; load + query review + UI; PostgreSQL/Web/Android.**
- Tiền điều kiện: PERF-50K: 50 người, 50.000 task, tối thiểu 60.000 assignment và 250.000 event, đủ private/tenant/guest; seed cố định. Ghi CPU/RAM/disk/PG/pool/process/network/build, không dùng production. Provider là fake transport có latency cố định.
- Bước: (1) Seed/ANALYZE và chụp execution plan cho paging/count/report/queue claim. (2) Warm-up 60s rồi đo 5 phút với 10 client độc lập; chạy đọc/ghi/bulk/provider riêng; ghi sample count và error rate. (3) Đo p50/p95, query count/request, process memory/peak và payload bytes. (4) So sánh page 1/giữa/cuối và kích thước page 20/100, theo dõi UI thực tế.
- API: mục tiêu đề xuất p95 đọc ≤1s, ghi ≤2s cho endpoint phân trang thông thường; mọi error tính vào báo cáo, không loại sample chậm. UI: chỉ tải page/window cần dùng, không fetch 50.000 task hoặc đứng giao diện. DB: không N+1 theo từng row; tổng/paging cùng ACL, không nhân assignment. Tác dụng phụ: queue backlog/claim/retry và bộ nhớ hữu hạn; bulk/provider có bảng kết quả riêng.
- Triển khai: **có harness API tham chiếu** `tests/performance-x07.mjs`; [lượt 7](../../../artifacts/spec-all-2026-10-16/x07-full-load-seventh-byte-order.json) đã đo đủ 300 giây sau warm-up 60 giây, 10 client, 50 người/50.000 task/100.000 assignment/250.000 event. **PASS ngân sách API** với 5.187 request/0 lỗi, đọc p95 tối đa 884,61 ms, ghi 780,90 ms; [báo cáo query](runs/2026-10-16-query-tuning.md) giữ nguồn, execution plan và các failure trước. **Cần mở rộng** browser memory/render, các kích thước trang/biến thể chưa đo, scheduled automation và provider latency; toàn TC-X07 chưa PASS. Giữ ngưỡng đề xuất, không coi là SLA thương mại.

<a id="tc-x08"></a>
## TC-X08 — Import + ACL + offline

- Requirement: `RQ-X08`; task: W1-T04/T09, W4-T02/T03/T04/T05, W6-T02/T03/T05, W9-T05. **P0; E2E; Web + Android thật + PostgreSQL.**
- Tiền điều kiện: Business, private PA-P, E có quyền; Trello fixture có checklist/label; Android đã tải task và quyền local chưa hết hạn.
- Bước: (1) Preview/commit Trello vào PA-P, gán E. (2) Bật airplane mode, sửa task/checklist/planner. (3) Web thu hồi E, dùng B1/N dò canary. (4) Reconnect, kiểm tra replay; cấp lại quyền hợp lệ và xử lý draft thủ công.
- API: import kiểm tra ACL, retry không nhân lô; replay sau revoke bị chặn. UI: giữ draft mã hóa và lý do cần xử lý; thiết bị hoàn toàn offline chỉ phát hiện revoke khi reconnect hoặc hết TTL. DB: không mutation/receipt thành công sau mất quyền, không orphan ID tạm. Tác dụng phụ: không import automation/nhắc lịch sử, không gửi nội dung private.
- Triển khai: **có sẵn** `tests/import-offline-acl.test.mjs` kết hợp Trello/private ACL/mobile token và production offline-state qua HTTP thật trong PostgreSQL thử; **PASS lớp API + state simulation**. `mobile/tests/offline-store.test.tsx` kiểm policy kho mã hóa bằng mock Expo. [Hồ sơ W6](runs/2026-10-16-w6-imports.md) có actual/log. **E2E Web/Android thật NOT RUN**; còn kiểm airplane mode, SQLCipher vật lý, cấp lại quyền và xử lý draft trên thiết bị.

<a id="tc-x09"></a>
## TC-X09 — Google + recurrence

- Requirement: `RQ-X09`; task: W1-T08/T09, W3-T06, W4-T03/T04/T05, W7-T02/T03/T04/T05, W9-T05. **P0; E2E + fault; Web/Android/Google.**
- Tiền điều kiện: task lặp cuối tháng, deadline mapping Calendar hợp lệ; E có quyền deadline; Android offline có revision cũ; fake provider hỗ trợ callback đảo thứ tự và mất response. Gate thật cần tài khoản Google được phép.
- Bước: (1) Google đổi deadline khi Android offline complete task. (2) Đảo callback và reconnect; gửi lại operation sau timeout. (3) Giải quyết conflict bằng lựa chọn rõ; full resync/restart worker. (4) Lặp trên Google thật cho gate W7.
- API: inbound và replay đi qua revision/lifecycle chung, stale update conflict, không blind overwrite. UI: giữ local/server để chọn, hiển thị kết quả đã đối soát. DB: đúng một successor và event/mapping mỗi occurrence; personal plan không bị ghi đè. Tác dụng phụ: không echo-loop/duplicate reminder/event Google; unknown được đối soát trước retry.
- Triển khai: **có sẵn** TC-X09 trong `tests/google-calendar.test.mjs`: provider giả đổi deadline, production offline-state nhận409, chọn local theo revision mới rồi retry; đúng một successor/completed event/receipt, hai deadline mapping và tick tiếp không phát thêm provider write. **PASS API/PostgreSQL + state simulation** trong lượt16/16 tại [hồ sơ W7](runs/2026-10-16-w7-internal.md). **Cần mở rộng** tổ hợp cuối tháng, callback đảo thứ tự, restart/full resync, đối soát reminder và personal plan trong cùng flow; **E2E Web/Android/Google thật NOT RUN/BLOCKED**. Không suy UI/device/provider PASS từ fake transport.

<a id="tc-x10"></a>
## TC-X10 — Downgrade có queue

- Requirement: `RQ-X10`; task: W1-T02/T04/T05/T10, W5-T02, W8-T01/T03, W9-T01/T03/T05. **P0; API + DB + E2E; Web/Android/worker.**
- Tiền điều kiện: Business có private PA-P, guest nhiều project, job Zalo/webhook/automation pending; target plan đủ ghế. Lặp nhánh target thiếu ghế.
- Bước: (1) Barrier giữ job trước send; yêu cầu hạ gói cùng lúc lời mời mới. (2) Sau commit hạ gói, thả worker và client capabilities cũ. (3) Guest đọc/thử ghi; nâng lại gói và tick.
- API: checkout/seat atomically hợp lệ hoặc từ chối toàn bộ; quyền hiện tại chặn premium writes. UI: guest readonly, tên plan đúng, lý do suppressed rõ. DB: private không thành public, không mất dữ liệu/cấu hình; guest vẫn một ghế/workspace. Tác dụng phụ: pending job thiếu quyền không gửi, nâng lại không phát lại lịch sử; giữ audit/receipt chính xác.
- Triển khai: **có sẵn** `tests/cross-wave-downgrade.test.mjs`, **1/1 PASS API/PostgreSQL + fake transport** tại [hồ sơ W8](runs/2026-10-16-w8-internal.md). Private guest và OA/webhook/automation pending cùng chuyển Business→Starter: dừng premium send/write, giữ task/event/receipt/lịch sử, guest readonly vẫn tính ghế, outsider không đọc canary. Ca bắt đầu ở **plan transition đã commit**; chưa chứng minh checkout đồng thời invite, target thiếu ghế, guest nhiều project hoặc nâng lại gói không replay. Các biến thể này dùng suite billing/seat riêng hoặc còn cần bổ sung; UI/Android/provider thật NOT RUN.

<a id="tc-x11"></a>
## TC-X11 — Khôi phục sau sự cố

- Requirement: `RQ-X11`; task: W1-T01/T09/T10/T11, W4-T03, W7-T04, W8-T03, W9-T03/T05. **P0; DB + E2E; CLI/server/Web/Android.**
- Tiền điều kiện: backup cũ/mới với pending/sent/unknown jobs, revision, receipt, token mã hóa, file/checksum; hai target thử độc lập, một target thiếu key.
- Bước: (1) Restore offline vào target riêng và migrate. (2) Khởi động, kiểm tra sender mặc định chưa bật; retry operation từng commit trước backup. (3) Kiểm tra target thiếu key và backup sai manifest. (4) Sau đối soát, bật sender có chủ đích trong môi trường thử và xử lý pending/unknown.
- API: replay revalidate ACL và dùng receipt, không mutate lại; phiên/token không hợp lệ bị chặn. UI: báo rõ recovery/thiếu key/unknown. DB: ID/FK/file/revision/receipt/queue giữ đúng; lỗi restore không để nửa dữ liệu. Tác dụng phụ: không tự gửi lại sent hoặc gửi mù khi không giải mã; unknown được đối soát theo khả năng provider.
- Triển khai: **có sẵn các fixture nội bộ riêng** TC-X11 trong `tests/google-calendar.test.mjs` ([W7](runs/2026-10-16-w7-internal.md)) và `tests/zalo-restore.test.mjs` ([W8](runs/2026-10-16-w8-internal.md)). Fixture Google giữ mapping/job/token/task/event/receipt/webhook; fixture OA bổ sung credential mã hóa, pending/accepted/read/unknown, attempts/callbacks/receipt/ACL và sender hold qua restore. `tests/restore-safety.test.mjs`/`tests/snapshot-compatibility.test.mjs` kiểm key/manifest/legacy hold và resume giả lập. **Cần mở rộng** full representative flow cùng file/device queue, đối soát vận hành/provider thật và UI; full E2E NOT RUN. Không dùng worker OA rỗng trong fixture Google để suy kết quả OA.

<a id="tc-x12"></a>
## TC-X12 — Quan sát vận hành

- Requirement: `RQ-X12`; task: W0-T03, W1-T07/T09/T10, W2-T05, W5-T06, W7-T05, W8-T03/T04, W9-T03/T05. **P0; API + log review + E2E; Web/Android/worker.**
- Tiền điều kiện: operation thành công/rollback/retry/suppressed, provider accepted/delivered/read/unknown và ack riêng; secret/canary có giá trị dò trong fixture.
- Bước: (1) Gửi từng tình huống, restart worker, callback trùng/đảo thứ tự. (2) Tra operation→event→job→attempt→provider ID qua log/metrics/history. (3) Dò raw token, key, nội dung private bằng tài khoản không có quyền. (4) So sánh timeline UI/API với DB.
- API: chỉ vai trò hợp lệ xem/retry; lỗi không lộ secret. UI: accepted/delivered/read/failed/unknown và xác nhận công việc tách biệt; không biến accepted thành read/ack. DB: timestamp, causation và suppression reason khớp commit. Tác dụng phụ: quan sát/retry không nhân business mutation, không ghi success ma; metric không gắn payload nhạy cảm vào label.
- Triển khai: **cần mở rộng toàn chuỗi quan sát**; reminder/mobile notification suites được bổ sung bởi `tests/durable-delivery.test.mjs`, `tests/google-calendar.test.mjs`, `tests/zalo-oa.test.mjs`, `tests/public-api.test.mjs` cho operation/event/job/attempt và trạng thái provider giả lập. [Sổ nghiệm thu](runs/2026-10-16-acceptance-ledger.md) giữ giới hạn từng lớp; log/history UI và đối soát provider thật còn **thủ công/NOT RUN**.

## Trình tự nghiệm thu phát hành

1. Chốt build/commit và snapshot working tree, fixture/schema/thiết bị/provider; kiểm tra [ma trận 58 task](README.md#ma-trận-tasktestgate) và các checklist trong [07-tasks.md](../07-tasks.md). Không gắn kết quả build cũ vào build mới.
2. Đối chiếu từng yêu cầu P0/P1 với case canonical và bằng chứng từng biến thể. Alias TC-W0/1 không được tính thành một ca mới để tăng tỷ lệ. Rerun các đường bị ảnh hưởng khi thay đổi quyền/lifecycle/transaction.
3. Chạy gate nội bộ từng wave khi các dependency của ca đã có. Ca TC-X liên wave chỉ chặn wave sớm ở phần đã thuộc phạm vi của wave đó; ví dụ TC-X09 đầy đủ chỉ chặn W7/W9, không chặn W1 vì Calendar chưa có.
4. W4 cần thiết bị thật; W7/W8 cần Google/OA thật được phép và request/event/delivery ID đã che secret. Thiếu điều kiện ghi BLOCKED có chủ sở hữu và việc cần làm; mock không thay bằng chứng thật.
5. W9 đối soát toàn luồng, restore trên dữ liệu đại diện, contract/API/webhook và đủ gate W2–W8. Tích hợp chưa sẵn sàng tiếp tục bị chặn phát hành; phần nội bộ độc lập đã đủ bằng chứng được nghiệm thu riêng.
6. Lưu expected/actual, status, issue, artifact hash và đường dẫn bằng chứng. Điều kiện đạt là 100% requirement bắt buộc có bằng chứng phù hợp, không thay bằng số test pass hay tỷ lệ code coverage.
