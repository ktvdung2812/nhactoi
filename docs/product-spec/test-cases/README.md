# Bộ test case cho 58 task và 10 wave

Nguồn: tổng hợp yêu cầu người dùng và kế hoạch kiểm thử trong phiên ngày 2026-10-16. Phạm vi gồm W0–W9, Web/Android, nghiệp vụ, quyền, độ tin cậy, migration và tích hợp thật. Bao phủ 275 mục A/B/C của kế hoạch gốc; thêm TC-W2-T03-H/I cho ranh giới task gia hạn trong spec hiện có, tổng 277 mục wave và 12 ca xuyên suốt. Catalog mô tả điều kiện nghiệm thu; không đồng nghĩa đã có test tự động hoặc sản phẩm đã đạt các yêu cầu này.

| Tài liệu | Phạm vi |
|---|---|
| [01-foundation.md](01-foundation.md) | W0–W1; giữ 80 ID TC-FND cũ và bổ sung phần thiếu |
| [02-business-projects-automation.md](02-business-projects-automation.md) | W2, W3, W5; doanh nghiệp dịch vụ, dự án, automation, thời gian và báo cáo |
| [03-offline-imports-integrations.md](03-offline-imports-integrations.md) | W4, W6–W9; offline, import, Google, Zalo, API và webhook |
| [04-cross-cutting-and-release.md](04-cross-cutting-and-release.md) | TC-X01–TC-X12; kiểm thử xuyên suốt và phát hành |
| [Checklist 58 task](../07-tasks.md) | Checklist gắn trực tiếp vào từng task; giữ nguyên phạm vi/dependency |
| [10 wave](../08-waves.md) | Checklist gate gắn trực tiếp vào từng wave |
| [Sổ nghiệm thu 58 task](runs/2026-10-16-acceptance-ledger.md) | Bằng chứng API/component/review, biến thể chưa chạy, ảnh và gate từng task/wave; không suy PASS từ tổng suite |
| [Đối soát và chạy lại kế hoạch](runs/2026-10-16-test-plan-review.md) | 58 task/10 wave, 275 mục bắt buộc; kết quả suite/build trên snapshot hiện tại và các gate còn thiếu bằng chứng |
| [Baseline ngày 2026-10-16](runs/2026-10-16-baseline.md) | Kết quả chạy suite/build thực tế và các điều kiện bị chặn; tách khỏi catalog NOT RUN |
| [W4 nội bộ ngày 2026-10-16](runs/2026-10-16-w4-internal.md) | Planner/offline, queue HTTP→PostgreSQL và APK của snapshot đã ghi; build cuối xem báo cáo tổng, thiết bị thật còn BLOCKED |
| [W8 nội bộ ngày 2026-10-16](runs/2026-10-16-w8-internal.md) | OA/transport/callback, TC-X10 hạ gói và Android; OA thật còn BLOCKED |

Trạng thái triển khai và các lượt chạy mới nhất ở [báo cáo tổng](../10-implementation-status.md), [sổ nghiệm thu từng task](runs/2026-10-16-acceptance-ledger.md) và [ma trận ảnh](screenshots.md); catalog bên dưới giữ expected độc lập với implementation. 58 task được lưu trong repo, chưa xác minh task Nhắc Tới trên bảng kết nối: [kết quả tìm lại bảng](../../../artifacts/spec-all-2026-10-16/board-recheck.json). Không đổi trạng thái bảng ngoài repo.

Google Calendar, Zalo OA và thiết bị Android thật còn thiếu bằng chứng nghiệm thu; kế hoạch kiểm thử này không miễn các gate đó. Các test giả lập tiếp tục phục vụ nghiệm thu nội bộ; gate provider/device vẫn BLOCKED. VC đã lưu 20 ảnh: 7 development lịch sử và 13 production (11 trước audit, 2 trước audit client). TC-W2-T01-A có scoped PASS fixture Web 5/6/2/2/1; TC-W0-T03-D có scoped PASS luồng checklist Web tạo/thêm/complete/reload. Private project/membership, automation manual và trang tích hợp có ảnh PARTIAL; chưa đủ ảnh hoặc PASS cho toàn bộ 58 task. Timeout tab mới cũ được giữ riêng; `tab_2` từng phục hồi trên build trước audit client và thêm ảnh danh sách dịch vụ/form gia hạn, mới PARTIAL dữ liệu đọc/form. [Lần tiếp tục cuối](../../../artifacts/spec-all-2026-10-16/browser/continuation-timeout-2026-10-16.json) lại timeout ở snapshot/mở tab; form chưa submit và không thêm ảnh/PASS.

Runner lịch sử trước audit client đạt PostgreSQL **419/419**, **19 ca SQLite legacy có tên**, production build và Next HTTP **1/1**; [manifest](../../../artifacts/spec-all-2026-10-16/post-view-acl-verification-manifest.json) giữ snapshot và exit code từng stage.

[X07 lượt bảy](../../../artifacts/spec-all-2026-10-16/x07-full-load-seventh-byte-order.json) đạt ngân sách API tham chiếu sau 300 giây/5.187 request/0 lỗi (đọc p95 ≤ 884,61 ms, ghi 780,90 ms); browser memory/render/provider latency còn thiếu, mọi failure trước vẫn giữ; [Android cuối](../../../artifacts/spec-all-2026-10-16/mobile-final-source-manifest.json) đã đạt typecheck/lint, unit 24/24, component 111/111, APK ARM64 debug và Hermes; chưa kiểm thiết bị thật. [Audit mới](runs/2026-10-16-acceptance-audit.md) đã sửa guard view cá nhân, primary assignee trong import và mapping template: hồi quy API/DB cuối 53/53 đạt. Các sửa này và query đã được kiểm lại trong runner 419/419 phía trên; [77/77 hồi quy query](runs/2026-10-16-query-tuning.md) và lượt tải 7 giữ bằng chứng riêng. Build của snapshot 419/419 là `9p78H6S5kA_tmJEvvaVfK`; 11 ảnh production thuộc build trước audit `UrOs5-ByXy9LJn4yiJXMP`, chưa chứng minh UI của các bản sửa mới. Full regression không thay bằng chứng UI/provider/device, và suite nhỏ không thay kết quả tải.

[Audit client/template/automation mới nhất](runs/2026-10-16-client-safety-audit.md) đã hoàn tất full runner: **32/32 component Web, 434/434 PostgreSQL, 19 ca SQLite legacy, build và Next HTTP 1/1 PASS**. [Manifest](../../../artifacts/spec-all-2026-10-16/client-safety-verification-manifest.json) ghi 5 stage exit 0/source không đổi; build `_nEQHTJmp3jJQpYGhLk5-`. [Runtime mới](../../../artifacts/spec-all-2026-10-16/browser-run4/manifest.json) sẵn sàng HTTP, nhưng [VC mở tab mới/snapshot đều timeout](../../../artifacts/spec-all-2026-10-16/browser/client-safety-build-timeout.json). Tổng vẫn 20 ảnh lịch sử, chưa ảnh cho các sửa client/checklist/automation mới; không nâng các gate browser/provider/device.

Lượt [đối soát kế hoạch mới nhất](runs/2026-10-16-test-plan-review.md) bổ sung 11 fault gia hạn, full PostgreSQL **445/445 PASS**; legacy/Web component/Next runtime và Android typecheck/lint/unit/component/APK đều đạt trong các lượt có snapshot riêng. Các đoạn audit phía trên là bằng chứng lịch sử; không thay gate browser/provider/device.

## Quy ước ID và hồ sơ từng ca

`TC-Wn-Tnn-A`, `-B`, `-C`… là những ca độc lập, không phải lựa chọn thay thế. Requirement `RQ-Wn-Tnn-A` trỏ tới mục A của task tương ứng trong kế hoạch này; đây là ID truy vết bổ sung, không giả định đã có tài liệu quyết định sản phẩm khác. W0–W1 dùng bảng alias đến các `TC-FND-*` tương đương; một requirement có thể cần nhiều FND để bao phủ hết vai trò/đường truy cập. Giữ nguyên TC-FND-001–080; không đếm alias thành test mới. `RQ-X01`–`RQ-X12` tương ứng ca xuyên suốt.

Mỗi ca có ID/requirement/task, P0/P1, lớp, nền tảng, tiền điều kiện/tài khoản/fixture/thời gian, bước, expected tại API/UI/DB/tác dụng phụ, suite tái sử dụng và phần cần thêm. Metadata chung ở đầu từng tài liệu được kế thừa vào **từng** ca; giá trị riêng của ca ghi đè mặc định. Khi chạy, bắt buộc lưu hồ sơ riêng cho từng case × role × platform × biến thể, gồm actual, build và bằng chứng. Không kết luận PASS cho cả requirement khi chỉ một biến thể đạt.

- **P0:** rò/mất dữ liệu, vượt quyền, sai tiền, mutation trùng, mất nháp, sai lịch, tác dụng phụ trái phép.
- **P1:** chức năng bắt buộc còn lại. Cả P0 và P1 đều phải đạt trước gate tương ứng.
- **Lớp:** review/build, unit/component, API/integration/DB/worker, browser E2E, thiết bị thật, provider thật. Ghi đúng lớp bằng chứng: source/component không chứng minh browser hay thiết bị; `test:next` kiểm thử HTTP runtime, không thao tác browser.
- **Mức triển khai:** `Có sẵn` (đã đối chiếu assertion đủ phạm vi), `Cần mở rộng`, `Chưa viết`, `Thủ công`. Một suite liên quan không tự làm ca thành “Có sẵn”.
- **Kết quả chạy:** `NOT RUN` chưa chạy; `PASS` đủ expected/bằng chứng; `FAIL` đã chạy và sai expected; `BLOCKED` thiếu điều kiện cụ thể. Thiếu Google/OA/device không ghi PASS. Ghi ngày, người phụ trách và việc cần làm để bỏ block.

Mỗi task chức năng phải chạy cả biến thể thành công, dữ liệu sai, quyền sai bằng API trực tiếp, failure/retry có liên quan. Với mutation thất bại, đối soát business row, revision, success event, success receipt, recurrence, expense, projection và outbox đều không thay ngoài dự kiến; log lỗi hợp lệ được phép. Review W0-T01/T02/T05/T06 dùng bằng chứng môi trường/tài liệu/provider, không tạo unit test hình thức. Trường không áp dụng phải ghi lý do, không bỏ trống.

## Fixture chung

### BASE — Tenant, dự án, vai trò và gói

Hai workspace A/B độc lập; A có team TA/TB. `PA-C` kế thừa workspace, `PA-T` kế thừa TA, `PA-P` riêng tư có guest; B có `PB-C`. Tạo cả phạm vi legacy rỗng để thử backfill. `TP` ở PA-P mang `PRIVATE-CANARY-2026`, task B mang canary khác; có child resource và bản xóa mềm tương ứng.

| Tài khoản | Phạm vi |
|---|---|
| O / A1 | Owner / admin A |
| M / E / C / V | Project manager / editor / commenter / viewer |
| G-E / G-C / G-V | Guest editor / commenter / viewer riêng PA-P |
| N | Thành viên A không có quyền PA-P |
| B1 | Chỉ thuộc B; người ngoài tenant A |
| SA | SaaS admin không có membership nghiệp vụ |

Dùng Starter, Team, Business, gói tùy chỉnh cùng entitlement khác tên, gói ngừng bán và workspace còn đúng một ghế. Có pending invitation giữ ghế. Người thử CRM/tài chính phải có quyền nghiệp vụ tương ứng; quyền task không tự cấp quyền tiền. Đối chứng SaaS admin không có quyền nghiệp vụ tự động.

`PRJ`: task thường, lặp, không hạn, nhiều assignee, checklist, file, comment, nhãn, kế hoạch cá nhân, customer/service liên kết. `SVC`: khách KH-A, dịch vụ DV-A chu kỳ tháng anchor 31, lịch sử chăm sóc, kỳ gia hạn và task. `PAY`: thu 100, chi 40, cả hai amount dương, balance 60. Fixture project/guest/receipt/outbox đã có trong các suite theo wave và các lượt browser thử riêng; không có một seed duy nhất tự bao phủ toàn ma trận. Chọn fixture/version đúng ca và đối soát ID theo hồ sơ chạy.

### CLOCK-VN / CLOCK-EDGE

T0 chung là `2026-10-16T02:00:00Z` = 09:00 UTC+7; CLOCK-VN có thể tiến tới 10:00 để đối soát báo cáo. Nếu ca không ghi riêng thì dùng T0. Dùng fake clock ở harness, không đổi đồng hồ máy hoặc sleep dài.

- Qua ngày: `2026-10-15T16:59:59Z` → `2026-10-15T17:00:00Z` (00:00 Việt Nam).
- Cuối tháng/năm, 31/01/2026 → 28/02 → 31/03; 31/12 → 01/01; 29/02/2028 và ngày sai 29/02/2027.
- Thiết bị UTC, Asia/Ho_Chi_Minh, America/New_York; DST gap/fold, all-day; quiet hours qua đêm 22:00–07:00; đổi lùi giờ máy không kéo dài TTL offline.
- Lịch làm mặc định 09:00–12:00, 13:00–18:00 thứ Hai–thứ Sáu, chưa có ngày nghỉ. Thứ Sáu 16/10/2026 16:00 → thứ Hai 19/10 10:00 là 66h wall time và 3h working time.

### REPORT-5 / R — Đối soát dashboard và SLA

Tại 09:00 ngày 16/10/2026 UTC+7; tất cả đang mở và thuộc phạm vi người xem O. Thời điểm bên dưới là giờ Việt Nam. E/M có quyền task và kế hoạch riêng.

| Task | Lượt giao | Deadline | Phản hồi chu kỳ hiện tại | Hoãn |
|---|---|---|---|---|
| R1 | E | 15/10 17:00 | E chưa xác nhận | Không |
| R2 | M | 16/10 08:00 | M đã xác nhận | Không |
| R3 | E, M | 17/10 17:00 | E chưa xác nhận; M đã xác nhận | Không |
| R4 | E | 18/10 17:00 | E đã xác nhận | Đến 16/10 11:00 |
| R5 | M | Không hạn | M đã xác nhận | Không |

Kết quả: **5 task, 6 lượt giao, 2 task quá hạn (R1/R2), 2 lượt chưa xác nhận (R1-E/R3-E), 1 task hoãn (R4)**. Nhóm giao nhau hợp lệ. Có bản đối chứng private/tenant khác ngoài tổng này; mỗi query đối soát cả tập ID và số đếm. Case cần completed cycles dùng bản sao fixture riêng, ghi expected mới, không sửa R gốc rồi tiếp tục kỳ vọng 5/6/2/2/1.

### DB, fault và provider

Dùng `tests/database-helpers.mjs` với `TEST_DATABASE_URL` chuyên biệt, schema độc lập và cleanup. Cạnh tranh dùng ít nhất hai connection/process độc lập với barrier; không dùng SQLite thay PostgreSQL, không coi `Promise.all` trong một process/transaction là đủ. Suite legacy chỉ chứng minh hợp đồng SQLite cũ/import tương ứng.

Fault injection qua dependency/harness đã có, không thêm endpoint production. Chạy lỗi trước/sau business/event/receipt/outbox/expense/projection, trước commit và sau commit trước response. Fake provider phải mô phỏng 429, 5xx, lỗi vĩnh viễn, timeout **sau khi nhận**, response bị mất, callback trùng/đảo thứ tự và sai tenant/channel/OA. Phân biệt logical delivery, attempt và delivery thực; không hứa exactly-once nếu provider không hỗ trợ đối soát/idempotency.

PERF-50K được mô tả ở TC-X07. Fixture import có UTF-8/BOM, tiếng Việt/emoji, CSV quote/CRLF/multiline, Trello ID/list trùng tên và user chưa map. Mỗi ca reset dữ liệu riêng để chạy độc lập.

## Các mặc định kỹ thuật đề xuất

Các điểm này bổ sung expected result cho kế hoạch thử; **không ghi thành quyết định người dùng đã xác nhận trước đó**. Hồ sơ chạy ghi phiên bản spec áp dụng; khi có quyết định khác, cập nhật expected và truy vết thay đổi, không tự coi implementation hiện tại là chuẩn.

| Chủ đề | Mặc định đề xuất |
|---|---|
| Custom fields | Field đã có dữ liệu không đổi kiểu trực tiếp; retire field/option giữ giá trị cũ để đọc/export, chặn lựa chọn mới |
| Dependencies | Archive/xóa mềm không là hoàn thành; giữ cạnh để restore; chặn move trước khi xử lý cạnh sẽ vượt project |
| Automation | Dùng quyền hiện tại của chủ rule; thiếu quyền thì skip có lý do, không dùng quyền hệ thống vượt ACL |
| Time tracking | Giây nguyên, tổng hợp trước định dạng; user sửa entry của mình; mất quyền ghi/task bị xóa mềm thì timer đóng tại lúc server xử lý, giữ lịch sử |
| SLA | Đúng hạn trên chu kỳ completed có deadline snapshot; reopen mở chu kỳ mới; task duy nhất và chu kỳ trình bày riêng |
| Catch-up | Chỉ mốc mới nhất còn hợp lệ của kỳ hiện tại; hằng ngày không phát bù từng ngày cũ |
| Hiệu năng | API phân trang thông thường p95 đọc ≤1s, ghi ≤2s trên môi trường tham chiếu cố định; bulk/provider đo riêng; không là quota hay SLA bán hàng |

Google Tasks connector, deadline chỉ có ngày và booking còn ở discovery, không thành yêu cầu bắt buộc của 58 task. Thu hồi quyền khi Android hoàn toàn offline chỉ được phát hiện lúc reconnect hoặc hết TTL local; expected không đòi khóa tức thời khi mất kết nối. Offline comment chỉ là draft; upload/delete/move/finance/renewal/timer không vào task queue.

## Lệnh chạy và bằng chứng phù hợp

Trước khi chạy ghi git status/HEAD, snapshot thay đổi sẵn có và SHA-256 lockfile. Cài theo lockfile, không nâng dependency để làm test pass. Đọc tài liệu Next đúng bản tại `node_modules/next/dist/docs/` và Expo đúng SDK trước khi viết code. Kiểm tra URL test khác database ứng dụng; không in credential vào log.

```bash
# Gốc repo, dùng TEST_DATABASE_URL chuyên biệt trong .env.test.local
npm run test:postgres
npm run test:legacy
npm run build
npm run test:next
# Component Web dùng transport giả lập, không phải browser E2E
node --test tests/web-denial-component-check.mjs tests/web-mutation-component-check.mjs
```

```bash
# Trong mobile/
npm run typecheck
npm run lint
npm run test:unit
npm run test:components
npm run build:android
```

`test:next` phụ thuộc production build mới và PostgreSQL thử. Khi giữ build làm việc hiện có, dùng cùng `NHACTOI_DIST_DIR` cho build và test:next. `build:android` tạo native project/APK; build thành công vẫn cần cài APK lên thiết bị thật để nghiệm thu W4. `test:legacy` lọc theo tên `[SQLite legacy]`; số lượng runner báo có thể gồm file không có case khớp, không dùng số này làm coverage. Nếu Jest có assertion đạt nhưng không tự thoát, ghi rõ lỗi vòng đời runner thay vì coi command hoàn tất.

Tái sử dụng suite PostgreSQL/migration/backup/ACL/payment/recurrence/reminder/cross-platform-sync và unit/component Android được chỉ ra ở từng ca. Chưa thêm framework, production fault endpoint hoặc test tự động cho tính năng tương lai chỉ để tăng số pass. Google login/Drive test hiện có không chứng minh Calendar hai chiều; notification/payment callback không thay Zalo OA hoặc public webhook.

## Mẫu hồ sơ chạy

Tạo hồ sơ dưới `runs/<ngày>-<build>.md`, một dòng cho mỗi ID/biến thể; log lớn đặt ở artifact CI/local và gắn hash. Nếu artifact chỉ tồn tại local, ghi rõ chưa được tải lên kho bằng chứng chung.

| Trường | Giá trị bắt buộc |
|---|---|
| Run / requirement / task / case / gate | ID canonical, alias nếu có, role/transport/platform/biến thể |
| Mức triển khai / kết quả | Có sẵn/Cần mở rộng/Chưa viết/Thủ công; NOT RUN/PASS/FAIL/BLOCKED |
| Build | Commit, branch, dirty snapshot/diff hash, lockfile hash, build/APK hash |
| Môi trường | Node/Next/Expo/OS/device; PostgreSQL version/schema/migration; clock/timezone; provider thật hay fake |
| Fixture | Seed/version, account/role/entitlement, tập resource ID và trạng thái trước thử |
| Thao tác / expected / actual | Các bước đã thực hiện, assertion từng lớp, dữ liệu trước/sau; không chỉ HTTP status |
| Đối soát | task/child/revision/receipt/event/recurrence/outbox/expense/projection và số logical send/attempt |
| Bằng chứng | Log/request/provider ID/SQL/ảnh/video đã che secret, đường dẫn và checksum |
| Thiếu/lỗi | Issue hoặc lý do BLOCKED, người phụ trách, việc cần làm và phạm vi cần chạy lại |

## Gate từng wave

| Wave | Gate | Bằng chứng bắt buộc |
|---|---|---|
| W0 | Review baseline/readiness W0-T01/T02/T05/T06 + sửa UI/nghiệp vụ | Spec/task/test, build/runtime/schema; Google/OA readiness tách khỏi gửi thật |
| W1 | W1-T11 | ACL đủ đường, ghế/receipt/revision/outbox, concurrency/fault, upgrade/restore |
| W2 | W2-T05 | SME end-to-end, dashboard 5/6/2/2/1, tiền/kỳ/nhắc hai nền tảng |
| W3 | W3-T06 | Dự án nâng cao, recurrence một successor qua mọi entrypoint, role/downgrade |
| W4 | W4-T05 | Android thật: mạng/vòng đời/SQLCipher/queue/conflict/TTL và giữ draft |
| W5 | W5-T06 | Automation atomicity, lịch làm, timer, SLA và export đối soát |
| W6 | W6-T05 | Import nguyên tử/dedupe, file giới hạn/nội dung, private ACL và báo cáo |
| W7 | W7-T05 | Google thật: hai chiều/xóa/reconnect/timezone, request/event ID |
| W8 | W8-T04 | OA thật: nội bộ/khách hàng được phép, template/token revoke, provider evidence |
| W9 | W9-T05 | Luồng toàn hệ thống, recovery, OpenAPI/webhook, đủ gate W2–W8 |

Mỗi wave chỉ đạt khi toàn bộ P0/P1 bắt buộc của wave có bằng chứng phù hợp. Case wave tương lai không chặn wave hiện tại. Với ca xuyên suốt, chỉ áp dụng phần đã thuộc wave hiện tại; TC-X08 đầy đủ ở W6, TC-X09 ở W7, TC-X10 có Zalo/webhook ở W9. W0 có thể hoàn tất review ghi nhận thiếu provider, nhưng điều đó không mở gate gửi thật W7/W8. Thiếu điều kiện tích hợp ghi BLOCKED và giữ chặn phát hành tích hợp; nghiệm thu phần nội bộ độc lập không bị biến thành FAIL vì provider chưa sẵn sàng. Mục tiêu: 100% requirement bắt buộc có bằng chứng phù hợp, không thay bằng tỷ lệ coverage hoặc tổng test pass.

<a id="ma-trận-tasktestgate"></a>
## Ma trận task–test–gate

Bảng dưới liên kết từng task tới các case độc lập. Với W0–W1, mở alias để xem ca FND tương đương và chạy đủ mọi ca được ánh xạ. Checklist chi tiết nằm trong [07-tasks.md](../07-tasks.md).

| Task / requirement | Các test case độc lập | Gate |
|---|---|---|
| [W0-T01](../07-tasks.md#w0-t01) — Hoàn thiện bộ spec và truy vết | `TC-W0-T01-` [A](01-foundation.md#alias-tc-w0-t01-a), [B](01-foundation.md#alias-tc-w0-t01-b), [C](01-foundation.md#alias-tc-w0-t01-c) | W0-T01–T04; provider readiness riêng |
| [W0-T02](../07-tasks.md#w0-t02) — Ghi nhận baseline và môi trường kiểm thử | `TC-W0-T02-` [A](01-foundation.md#alias-tc-w0-t02-a), [B](01-foundation.md#alias-tc-w0-t02-b), [C](01-foundation.md#alias-tc-w0-t02-c) | W0-T01–T04; provider readiness riêng |
| [W0-T03](../07-tasks.md#w0-t03) — Hoàn thiện lối truy cập các chức năng hiện hữu | `TC-W0-T03-` [A](01-foundation.md#alias-tc-w0-t03-a), [B](01-foundation.md#alias-tc-w0-t03-b), [C](01-foundation.md#alias-tc-w0-t03-c), [D](01-foundation.md#alias-tc-w0-t03-d), [E](01-foundation.md#alias-tc-w0-t03-e) | W0-T01–T04; provider readiness riêng |
| [W0-T04](../07-tasks.md#w0-t04) — Sửa các sai lệch nghiệp vụ và hiển thị | `TC-W0-T04-` [A](01-foundation.md#alias-tc-w0-t04-a), [B](01-foundation.md#alias-tc-w0-t04-b), [C](01-foundation.md#alias-tc-w0-t04-c), [D](01-foundation.md#alias-tc-w0-t04-d) | W0-T01–T04; provider readiness riêng |
| [W0-T05](../07-tasks.md#w0-t05) — Readiness Google Calendar | `TC-W0-T05-` [A](01-foundation.md#alias-tc-w0-t05-a), [B](01-foundation.md#alias-tc-w0-t05-b), [C](01-foundation.md#alias-tc-w0-t05-c) | W0-T01–T04; provider readiness riêng |
| [W0-T06](../07-tasks.md#w0-t06) — Readiness Zalo OA và template | `TC-W0-T06-` [A](01-foundation.md#alias-tc-w0-t06-a), [B](01-foundation.md#alias-tc-w0-t06-b), [C](01-foundation.md#alias-tc-w0-t06-c) | W0-T01–T04; provider readiness riêng |
| [W1-T01](../07-tasks.md#w1-t01) — Migration, backup và restore phiên bản mới | `TC-W1-T01-` [A](01-foundation.md#alias-tc-w1-t01-a), [B](01-foundation.md#alias-tc-w1-t01-b), [C](01-foundation.md#alias-tc-w1-t01-c), [D](01-foundation.md#alias-tc-w1-t01-d), [E](01-foundation.md#alias-tc-w1-t01-e), [F](01-foundation.md#alias-tc-w1-t01-f) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T02](../07-tasks.md#w1-t02) — Entitlement bằng mã và thực thi tại backend | `TC-W1-T02-` [A](01-foundation.md#alias-tc-w1-t02-a), [B](01-foundation.md#alias-tc-w1-t02-b), [C](01-foundation.md#alias-tc-w1-t02-c), [D](01-foundation.md#alias-tc-w1-t02-d), [E](01-foundation.md#alias-tc-w1-t02-e) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T03](../07-tasks.md#w1-t03) — Project, một board và backfill quan hệ | `TC-W1-T03-` [A](01-foundation.md#alias-tc-w1-t03-a), [B](01-foundation.md#alias-tc-w1-t03-b), [C](01-foundation.md#alias-tc-w1-t03-c), [D](01-foundation.md#alias-tc-w1-t03-d) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T04](../07-tasks.md#w1-t04) — Project ACL xuyên toàn hệ thống | `TC-W1-T04-` [A](01-foundation.md#alias-tc-w1-t04-a), [B](01-foundation.md#alias-tc-w1-t04-b), [C](01-foundation.md#alias-tc-w1-t04-c), [D](01-foundation.md#alias-tc-w1-t04-d), [E](01-foundation.md#alias-tc-w1-t04-e), [F](01-foundation.md#alias-tc-w1-t04-f) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T05](../07-tasks.md#w1-t05) — Guest, lời mời, ghế và downgrade nguyên tử | `TC-W1-T05-` [A](01-foundation.md#alias-tc-w1-t05-a), [B](01-foundation.md#alias-tc-w1-t05-b), [C](01-foundation.md#alias-tc-w1-t05-c), [D](01-foundation.md#alias-tc-w1-t05-d), [E](01-foundation.md#alias-tc-w1-t05-e), [F](01-foundation.md#alias-tc-w1-t05-f), [G](01-foundation.md#alias-tc-w1-t05-g) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T06](../07-tasks.md#w1-t06) — UI project, vai trò và thành viên Web/Android | `TC-W1-T06-` [A](01-foundation.md#alias-tc-w1-t06-a), [B](01-foundation.md#alias-tc-w1-t06-b), [C](01-foundation.md#alias-tc-w1-t06-c), [D](01-foundation.md#alias-tc-w1-t06-d) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T07](../07-tasks.md#w1-t07) — Sự kiện nghiệp vụ có cấu trúc | `TC-W1-T07-` [A](01-foundation.md#alias-tc-w1-t07-a), [B](01-foundation.md#alias-tc-w1-t07-b), [C](01-foundation.md#alias-tc-w1-t07-c), [D](01-foundation.md#alias-tc-w1-t07-d), [E](01-foundation.md#alias-tc-w1-t07-e) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T08](../07-tasks.md#w1-t08) — Revision tổng hợp task và kế hoạch cá nhân | `TC-W1-T08-` [A](01-foundation.md#alias-tc-w1-t08-a), [B](01-foundation.md#alias-tc-w1-t08-b), [C](01-foundation.md#alias-tc-w1-t08-c), [D](01-foundation.md#alias-tc-w1-t08-d), [E](01-foundation.md#alias-tc-w1-t08-e) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T09](../07-tasks.md#w1-t09) — Mutation receipt và idempotency | `TC-W1-T09-` [A](01-foundation.md#alias-tc-w1-t09-a), [B](01-foundation.md#alias-tc-w1-t09-b), [C](01-foundation.md#alias-tc-w1-t09-c), [D](01-foundation.md#alias-tc-w1-t09-d), [E](01-foundation.md#alias-tc-w1-t09-e), [F](01-foundation.md#alias-tc-w1-t09-f) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T10](../07-tasks.md#w1-t10) — Durable outbox, retry và revalidation | `TC-W1-T10-` [A](01-foundation.md#alias-tc-w1-t10-a), [B](01-foundation.md#alias-tc-w1-t10-b), [C](01-foundation.md#alias-tc-w1-t10-c), [D](01-foundation.md#alias-tc-w1-t10-d), [E](01-foundation.md#alias-tc-w1-t10-e), [F](01-foundation.md#alias-tc-w1-t10-f), [G](01-foundation.md#alias-tc-w1-t10-g) | [W1-T11](../07-tasks.md#w1-t11) |
| [W1-T11](../07-tasks.md#w1-t11) — Gate tích hợp nền tảng | `TC-W1-T11-` [A](01-foundation.md#alias-tc-w1-t11-a), [B](01-foundation.md#alias-tc-w1-t11-b), [C](01-foundation.md#alias-tc-w1-t11-c) | [W1-T11](../07-tasks.md#w1-t11) |
| [W2-T01](../07-tasks.md#w2-t01) — Dashboard vận hành phân trang | `TC-W2-T01-` [A](02-business-projects-automation.md#tc-w2-t01-a), [B](02-business-projects-automation.md#tc-w2-t01-b), [C](02-business-projects-automation.md#tc-w2-t01-c), [D](02-business-projects-automation.md#tc-w2-t01-d), [E](02-business-projects-automation.md#tc-w2-t01-e) | [W2-T05](../07-tasks.md#w2-t05) |
| [W2-T02](../07-tasks.md#w2-t02) — Giờ và chính sách nhắc gia hạn | `TC-W2-T02-` [A](02-business-projects-automation.md#tc-w2-t02-a), [B](02-business-projects-automation.md#tc-w2-t02-b), [C](02-business-projects-automation.md#tc-w2-t02-c), [D](02-business-projects-automation.md#tc-w2-t02-d), [E](02-business-projects-automation.md#tc-w2-t02-e) | [W2-T05](../07-tasks.md#w2-t05) |
| [W2-T03](../07-tasks.md#w2-t03) — Gia hạn, task và khoản chi tùy chọn | `TC-W2-T03-` [A](02-business-projects-automation.md#tc-w2-t03-a), [B](02-business-projects-automation.md#tc-w2-t03-b), [C](02-business-projects-automation.md#tc-w2-t03-c), [D](02-business-projects-automation.md#tc-w2-t03-d), [E](02-business-projects-automation.md#tc-w2-t03-e), [F](02-business-projects-automation.md#tc-w2-t03-f), [G](02-business-projects-automation.md#tc-w2-t03-g), [H](02-business-projects-automation.md#tc-w2-t03-h), [I](02-business-projects-automation.md#tc-w2-t03-i) | [W2-T05](../07-tasks.md#w2-t05) |
| [W2-T04](../07-tasks.md#w2-t04) — Android: dịch vụ, chăm sóc và gia hạn | `TC-W2-T04-` [A](02-business-projects-automation.md#tc-w2-t04-a), [B](02-business-projects-automation.md#tc-w2-t04-b), [C](02-business-projects-automation.md#tc-w2-t04-c) | [W2-T05](../07-tasks.md#w2-t05) |
| [W2-T05](../07-tasks.md#w2-t05) — Gate SME end-to-end | `TC-W2-T05-` [A](02-business-projects-automation.md#tc-w2-t05-a), [B](02-business-projects-automation.md#tc-w2-t05-b), [C](02-business-projects-automation.md#tc-w2-t05-c) | [W2-T05](../07-tasks.md#w2-t05) |
| [W3-T01](../07-tasks.md#w3-t01) — Custom fields có kiểu | `TC-W3-T01-` [A](02-business-projects-automation.md#tc-w3-t01-a), [B](02-business-projects-automation.md#tc-w3-t01-b), [C](02-business-projects-automation.md#tc-w3-t01-c), [D](02-business-projects-automation.md#tc-w3-t01-d), [E](02-business-projects-automation.md#tc-w3-t01-e) | [W3-T06](../07-tasks.md#w3-t06) |
| [W3-T02](../07-tasks.md#w3-t02) — Views nhất quán và saved views | `TC-W3-T02-` [A](02-business-projects-automation.md#tc-w3-t02-a), [B](02-business-projects-automation.md#tc-w3-t02-b), [C](02-business-projects-automation.md#tc-w3-t02-c), [D](02-business-projects-automation.md#tc-w3-t02-d) | [W3-T06](../07-tasks.md#w3-t06) |
| [W3-T03](../07-tasks.md#w3-t03) — Dependency finish-to-start trong project | `TC-W3-T03-` [A](02-business-projects-automation.md#tc-w3-t03-a), [B](02-business-projects-automation.md#tc-w3-t03-b), [C](02-business-projects-automation.md#tc-w3-t03-c), [D](02-business-projects-automation.md#tc-w3-t03-d), [E](02-business-projects-automation.md#tc-w3-t03-e), [F](02-business-projects-automation.md#tc-w3-t03-f) | [W3-T06](../07-tasks.md#w3-t06) |
| [W3-T04](../07-tasks.md#w3-t04) — Timeline và ngày chung của task | `TC-W3-T04-` [A](02-business-projects-automation.md#tc-w3-t04-a), [B](02-business-projects-automation.md#tc-w3-t04-b), [C](02-business-projects-automation.md#tc-w3-t04-c), [D](02-business-projects-automation.md#tc-w3-t04-d) | [W3-T06](../07-tasks.md#w3-t06) |
| [W3-T05](../07-tasks.md#w3-t05) — Project templates và ngày tương đối | `TC-W3-T05-` [A](02-business-projects-automation.md#tc-w3-t05-a), [B](02-business-projects-automation.md#tc-w3-t05-b), [C](02-business-projects-automation.md#tc-w3-t05-c), [D](02-business-projects-automation.md#tc-w3-t05-d) | [W3-T06](../07-tasks.md#w3-t06) |
| [W3-T06](../07-tasks.md#w3-t06) — Gate dự án nâng cao | `TC-W3-T06-` [A](02-business-projects-automation.md#tc-w3-t06-a), [B](02-business-projects-automation.md#tc-w3-t06-b), [C](02-business-projects-automation.md#tc-w3-t06-c) | [W3-T06](../07-tasks.md#w3-t06) |
| [W4-T01](../07-tasks.md#w4-t01) — Inbox, Today, Upcoming và Week | `TC-W4-T01-` [A](03-offline-imports-integrations.md#tc-w4-t01-a), [B](03-offline-imports-integrations.md#tc-w4-t01-b), [C](03-offline-imports-integrations.md#tc-w4-t01-c), [D](03-offline-imports-integrations.md#tc-w4-t01-d) | [W4-T05](../07-tasks.md#w4-t05) |
| [W4-T02](../07-tasks.md#w4-t02) — SQLCipher cho draft và outbox Android | `TC-W4-T02-` [A](03-offline-imports-integrations.md#tc-w4-t02-a), [B](03-offline-imports-integrations.md#tc-w4-t02-b), [C](03-offline-imports-integrations.md#tc-w4-t02-c), [D](03-offline-imports-integrations.md#tc-w4-t02-d), [E](03-offline-imports-integrations.md#tc-w4-t02-e) | [W4-T05](../07-tasks.md#w4-t05) |
| [W4-T03](../07-tasks.md#w4-t03) — Queue replay, pending overlay và temp IDs | `TC-W4-T03-` [A](03-offline-imports-integrations.md#tc-w4-t03-a), [B](03-offline-imports-integrations.md#tc-w4-t03-b), [C](03-offline-imports-integrations.md#tc-w4-t03-c), [D](03-offline-imports-integrations.md#tc-w4-t03-d), [E](03-offline-imports-integrations.md#tc-w4-t03-e) | [W4-T05](../07-tasks.md#w4-t05) |
| [W4-T04](../07-tasks.md#w4-t04) — Conflict, TTL, quyền và logout | `TC-W4-T04-` [A](03-offline-imports-integrations.md#tc-w4-t04-a), [B](03-offline-imports-integrations.md#tc-w4-t04-b), [C](03-offline-imports-integrations.md#tc-w4-t04-c), [D](03-offline-imports-integrations.md#tc-w4-t04-d), [E](03-offline-imports-integrations.md#tc-w4-t04-e), [F](03-offline-imports-integrations.md#tc-w4-t04-f), [G](03-offline-imports-integrations.md#tc-w4-t04-g) | [W4-T05](../07-tasks.md#w4-t05) |
| [W4-T05](../07-tasks.md#w4-t05) — Gate Android thật và lỗi mạng/vòng đời | `TC-W4-T05-` [A](03-offline-imports-integrations.md#tc-w4-t05-a), [B](03-offline-imports-integrations.md#tc-w4-t05-b), [C](03-offline-imports-integrations.md#tc-w4-t05-c), [D](03-offline-imports-integrations.md#tc-w4-t05-d), [E](03-offline-imports-integrations.md#tc-w4-t05-e) | [W4-T05](../07-tasks.md#w4-t05) |
| [W5-T01](../07-tasks.md#w5-t01) — Lịch làm việc, ngày nghỉ và delegate | `TC-W5-T01-` [A](02-business-projects-automation.md#tc-w5-t01-a), [B](02-business-projects-automation.md#tc-w5-t01-b), [C](02-business-projects-automation.md#tc-w5-t01-c), [D](02-business-projects-automation.md#tc-w5-t01-d), [E](02-business-projects-automation.md#tc-w5-t01-e), [F](02-business-projects-automation.md#tc-w5-t01-f) | [W5-T06](../07-tasks.md#w5-t06) |
| [W5-T02](../07-tasks.md#w5-t02) — Automation nâng cao có sự kiện và lịch | `TC-W5-T02-` [A](02-business-projects-automation.md#tc-w5-t02-a), [B](02-business-projects-automation.md#tc-w5-t02-b), [C](02-business-projects-automation.md#tc-w5-t02-c), [D](02-business-projects-automation.md#tc-w5-t02-d), [E](02-business-projects-automation.md#tc-w5-t02-e), [F](02-business-projects-automation.md#tc-w5-t02-f), [G](02-business-projects-automation.md#tc-w5-t02-g) | [W5-T06](../07-tasks.md#w5-t06) |
| [W5-T03](../07-tasks.md#w5-t03) — Manual time và timer | `TC-W5-T03-` [A](02-business-projects-automation.md#tc-w5-t03-a), [B](02-business-projects-automation.md#tc-w5-t03-b), [C](02-business-projects-automation.md#tc-w5-t03-c), [D](02-business-projects-automation.md#tc-w5-t03-d), [E](02-business-projects-automation.md#tc-w5-t03-e), [F](02-business-projects-automation.md#tc-w5-t03-f) | [W5-T06](../07-tasks.md#w5-t06) |
| [W5-T04](../07-tasks.md#w5-t04) — Estimate từng assignee, capacity và portfolio | `TC-W5-T04-` [A](02-business-projects-automation.md#tc-w5-t04-a), [B](02-business-projects-automation.md#tc-w5-t04-b), [C](02-business-projects-automation.md#tc-w5-t04-c), [D](02-business-projects-automation.md#tc-w5-t04-d), [E](02-business-projects-automation.md#tc-w5-t04-e) | [W5-T06](../07-tasks.md#w5-t06) |
| [W5-T05](../07-tasks.md#w5-t05) — SLA từ lịch sử có cấu trúc | `TC-W5-T05-` [A](02-business-projects-automation.md#tc-w5-t05-a), [B](02-business-projects-automation.md#tc-w5-t05-b), [C](02-business-projects-automation.md#tc-w5-t05-c), [D](02-business-projects-automation.md#tc-w5-t05-d), [E](02-business-projects-automation.md#tc-w5-t05-e), [F](02-business-projects-automation.md#tc-w5-t05-f) | [W5-T06](../07-tasks.md#w5-t06) |
| [W5-T06](../07-tasks.md#w5-t06) — Gate automation và báo cáo | `TC-W5-T06-` [A](02-business-projects-automation.md#tc-w5-t06-a), [B](02-business-projects-automation.md#tc-w5-t06-b), [C](02-business-projects-automation.md#tc-w5-t06-c) | [W5-T06](../07-tasks.md#w5-t06) |
| [W6-T01](../07-tasks.md#w6-t01) — CSV parser và mapping | `TC-W6-T01-` [A](03-offline-imports-integrations.md#tc-w6-t01-a), [B](03-offline-imports-integrations.md#tc-w6-t01-b), [C](03-offline-imports-integrations.md#tc-w6-t01-c), [D](03-offline-imports-integrations.md#tc-w6-t01-d) | [W6-T05](../07-tasks.md#w6-t05) |
| [W6-T02](../07-tasks.md#w6-t02) — Import Trello có source identity | `TC-W6-T02-` [A](03-offline-imports-integrations.md#tc-w6-t02-a), [B](03-offline-imports-integrations.md#tc-w6-t02-b), [C](03-offline-imports-integrations.md#tc-w6-t02-c), [D](03-offline-imports-integrations.md#tc-w6-t02-d) | [W6-T05](../07-tasks.md#w6-t05) |
| [W6-T03](../07-tasks.md#w6-t03) — Preview và commit nguyên tử/idempotent | `TC-W6-T03-` [A](03-offline-imports-integrations.md#tc-w6-t03-a), [B](03-offline-imports-integrations.md#tc-w6-t03-b), [C](03-offline-imports-integrations.md#tc-w6-t03-c), [D](03-offline-imports-integrations.md#tc-w6-t03-d), [E](03-offline-imports-integrations.md#tc-w6-t03-e), [F](03-offline-imports-integrations.md#tc-w6-t03-f) | [W6-T05](../07-tasks.md#w6-t05) |
| [W6-T04](../07-tasks.md#w6-t04) — Giao diện import Web/Android | `TC-W6-T04-` [A](03-offline-imports-integrations.md#tc-w6-t04-a), [B](03-offline-imports-integrations.md#tc-w6-t04-b), [C](03-offline-imports-integrations.md#tc-w6-t04-c) | [W6-T05](../07-tasks.md#w6-t05) |
| [W6-T05](../07-tasks.md#w6-t05) — Gate import và an toàn dữ liệu | `TC-W6-T05-` [A](03-offline-imports-integrations.md#tc-w6-t05-a), [B](03-offline-imports-integrations.md#tc-w6-t05-b), [C](03-offline-imports-integrations.md#tc-w6-t05-c), [D](03-offline-imports-integrations.md#tc-w6-t05-d) | [W6-T05](../07-tasks.md#w6-t05) |
| [W7-T01](../07-tasks.md#w7-t01) — Consent, lịch riêng và token | `TC-W7-T01-` [A](03-offline-imports-integrations.md#tc-w7-t01-a), [B](03-offline-imports-integrations.md#tc-w7-t01-b), [C](03-offline-imports-integrations.md#tc-w7-t01-c), [D](03-offline-imports-integrations.md#tc-w7-t01-d) | [W7-T05](../07-tasks.md#w7-t05) |
| [W7-T02](../07-tasks.md#w7-t02) — Outbound projections và identity | `TC-W7-T02-` [A](03-offline-imports-integrations.md#tc-w7-t02-a), [B](03-offline-imports-integrations.md#tc-w7-t02-b), [C](03-offline-imports-integrations.md#tc-w7-t02-c), [D](03-offline-imports-integrations.md#tc-w7-t02-d), [E](03-offline-imports-integrations.md#tc-w7-t02-e) | [W7-T05](../07-tasks.md#w7-t05) |
| [W7-T03](../07-tasks.md#w7-t03) — Inbound, watch, incremental sync và conflict | `TC-W7-T03-` [A](03-offline-imports-integrations.md#tc-w7-t03-a), [B](03-offline-imports-integrations.md#tc-w7-t03-b), [C](03-offline-imports-integrations.md#tc-w7-t03-c), [D](03-offline-imports-integrations.md#tc-w7-t03-d), [E](03-offline-imports-integrations.md#tc-w7-t03-e), [F](03-offline-imports-integrations.md#tc-w7-t03-f), [G](03-offline-imports-integrations.md#tc-w7-t03-g) | [W7-T05](../07-tasks.md#w7-t05) |
| [W7-T04](../07-tasks.md#w7-t04) — Conflict UI, xóa/unlink và thu hồi quyền | `TC-W7-T04-` [A](03-offline-imports-integrations.md#tc-w7-t04-a), [B](03-offline-imports-integrations.md#tc-w7-t04-b), [C](03-offline-imports-integrations.md#tc-w7-t04-c), [D](03-offline-imports-integrations.md#tc-w7-t04-d), [E](03-offline-imports-integrations.md#tc-w7-t04-e) | [W7-T05](../07-tasks.md#w7-t05) |
| [W7-T05](../07-tasks.md#w7-t05) — Gate tài khoản Google thật | `TC-W7-T05-` [A](03-offline-imports-integrations.md#tc-w7-t05-a), [B](03-offline-imports-integrations.md#tc-w7-t05-b), [C](03-offline-imports-integrations.md#tc-w7-t05-c), [D](03-offline-imports-integrations.md#tc-w7-t05-d) | [W7-T05](../07-tasks.md#w7-t05) |
| [W8-T01](../07-tasks.md#w8-t01) — OA theo workspace và registry | `TC-W8-T01-` [A](03-offline-imports-integrations.md#tc-w8-t01-a), [B](03-offline-imports-integrations.md#tc-w8-t01-b), [C](03-offline-imports-integrations.md#tc-w8-t01-c), [D](03-offline-imports-integrations.md#tc-w8-t01-d) | [W8-T04](../07-tasks.md#w8-t04) |
| [W8-T02](../07-tasks.md#w8-t02) — Mục đích và preview template | `TC-W8-T02-` [A](03-offline-imports-integrations.md#tc-w8-t02-a), [B](03-offline-imports-integrations.md#tc-w8-t02-b), [C](03-offline-imports-integrations.md#tc-w8-t02-c), [D](03-offline-imports-integrations.md#tc-w8-t02-d), [E](03-offline-imports-integrations.md#tc-w8-t02-e) | [W8-T04](../07-tasks.md#w8-t04) |
| [W8-T03](../07-tasks.md#w8-t03) — Delivery, callback và đối soát timeout | `TC-W8-T03-` [A](03-offline-imports-integrations.md#tc-w8-t03-a), [B](03-offline-imports-integrations.md#tc-w8-t03-b), [C](03-offline-imports-integrations.md#tc-w8-t03-c), [D](03-offline-imports-integrations.md#tc-w8-t03-d), [E](03-offline-imports-integrations.md#tc-w8-t03-e) | [W8-T04](../07-tasks.md#w8-t04) |
| [W8-T04](../07-tasks.md#w8-t04) — Gate OA thật và lịch sử đa kênh | `TC-W8-T04-` [A](03-offline-imports-integrations.md#tc-w8-t04-a), [B](03-offline-imports-integrations.md#tc-w8-t04-b), [C](03-offline-imports-integrations.md#tc-w8-t04-c), [D](03-offline-imports-integrations.md#tc-w8-t04-d) | [W8-T04](../07-tasks.md#w8-t04) |
| [W9-T01](../07-tasks.md#w9-t01) — API token có scope và thu hồi | `TC-W9-T01-` [A](03-offline-imports-integrations.md#tc-w9-t01-a), [B](03-offline-imports-integrations.md#tc-w9-t01-b), [C](03-offline-imports-integrations.md#tc-w9-t01-c), [D](03-offline-imports-integrations.md#tc-w9-t01-d) | [W9-T05](../07-tasks.md#w9-t05) |
| [W9-T02](../07-tasks.md#w9-t02) — API v1 dùng cùng nghiệp vụ | `TC-W9-T02-` [A](03-offline-imports-integrations.md#tc-w9-t02-a), [B](03-offline-imports-integrations.md#tc-w9-t02-b), [C](03-offline-imports-integrations.md#tc-w9-t02-c), [D](03-offline-imports-integrations.md#tc-w9-t02-d), [E](03-offline-imports-integrations.md#tc-w9-t02-e), [F](03-offline-imports-integrations.md#tc-w9-t02-f) | [W9-T05](../07-tasks.md#w9-t05) |
| [W9-T03](../07-tasks.md#w9-t03) — Webhook có chữ ký và chống SSRF | `TC-W9-T03-` [A](03-offline-imports-integrations.md#tc-w9-t03-a), [B](03-offline-imports-integrations.md#tc-w9-t03-b), [C](03-offline-imports-integrations.md#tc-w9-t03-c), [D](03-offline-imports-integrations.md#tc-w9-t03-d), [E](03-offline-imports-integrations.md#tc-w9-t03-e), [F](03-offline-imports-integrations.md#tc-w9-t03-f) | [W9-T05](../07-tasks.md#w9-t05) |
| [W9-T04](../07-tasks.md#w9-t04) — OpenAPI, ví dụ consumer và contract tests | `TC-W9-T04-` [A](03-offline-imports-integrations.md#tc-w9-t04-a), [B](03-offline-imports-integrations.md#tc-w9-t04-b), [C](03-offline-imports-integrations.md#tc-w9-t04-c), [D](03-offline-imports-integrations.md#tc-w9-t04-d) | [W9-T05](../07-tasks.md#w9-t05) |
| [W9-T05](../07-tasks.md#w9-t05) — Gate phát hành toàn hệ thống | `TC-W9-T05-` [A](03-offline-imports-integrations.md#tc-w9-t05-a), [B](03-offline-imports-integrations.md#tc-w9-t05-b), [C](03-offline-imports-integrations.md#tc-w9-t05-c), [D](03-offline-imports-integrations.md#tc-w9-t05-d) | [W9-T05](../07-tasks.md#w9-t05) |

Chữ A/B/C… trong bảng là hậu tố của ID case đầy đủ. Requirement tương ứng là `RQ-Wn-Tnn-A`…; W0/W1 dẫn vào alias để xem các ca FND phải chạy. Một alias không được tính thành một test thực thi thứ hai.

Các ca xuyên suốt: [TC-X01](04-cross-cutting-and-release.md#tc-x01), [TC-X02](04-cross-cutting-and-release.md#tc-x02), [TC-X03](04-cross-cutting-and-release.md#tc-x03), [TC-X04](04-cross-cutting-and-release.md#tc-x04), [TC-X05](04-cross-cutting-and-release.md#tc-x05), [TC-X06](04-cross-cutting-and-release.md#tc-x06), [TC-X07](04-cross-cutting-and-release.md#tc-x07), [TC-X08](04-cross-cutting-and-release.md#tc-x08), [TC-X09](04-cross-cutting-and-release.md#tc-x09), [TC-X10](04-cross-cutting-and-release.md#tc-x10), [TC-X11](04-cross-cutting-and-release.md#tc-x11), [TC-X12](04-cross-cutting-and-release.md#tc-x12). Áp dụng đúng phạm vi của từng wave và hoàn thành toàn luồng tại gate phát hành.


## Ảnh chụp xác minh theo yêu cầu bổ sung

Yêu cầu người dùng ngày 16/10/2026: mọi task cần ảnh chụp xác minh gắn với ca kiểm thử và snapshot/build đang chạy. Với task có UI, chụp trạng thái thực tế sau thao tác, gồm lỗi/quyền sai khi áp dụng. Với task nền tảng, ảnh báo cáo chạy phải đi kèm log/API/DB gốc; ảnh không chứng minh tính nguyên tử hay cạnh tranh. Che secret trước khi chụp và không dựng lại giao diện để giả bằng chứng.

[Ma trận ảnh](screenshots.md) theo dõi riêng khỏi kết quả unit/API/component. Chỉ ghi ảnh đã thực sự được công cụ lưu; thiếu ảnh là thiếu bằng chứng, không biến kết quả giả lập thành kiểm thử provider/thiết bị thật.
