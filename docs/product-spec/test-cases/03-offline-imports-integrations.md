# Test case W4, W6–W9: offline, import và tích hợp

Ngày cập nhật: 2026-10-16. Đây là catalog expected. Cột tái sử dụng và hồ sơ `NOT RUN` trong từng dòng giữ baseline lúc lập kế hoạch; các chữ “Chưa viết” không mô tả toàn bộ implementation hiện tại. Đối chiếu suite mới bên dưới và [sổ nghiệm thu](runs/2026-10-16-acceptance-ledger.md) cho bằng chứng theo lớp/biến thể. Quy ước tổng thể và gate: [README](README.md).

[Lượt kiểm chứng hiện tại](runs/2026-10-16-integration-catalog-verification.md) đối soát đủ **114/114** ID bắt buộc của W4, W6–W9 và chạy **85/85 test API/DB/unit/transport giả lập PASS** trên PostgreSQL thử riêng. Lỗi role database từ cấu hình ban đầu được giữ trong hồ sơ. Kết quả này không thay bằng chứng browser, SQLCipher/thiết bị hoặc provider thật, không tự mở gate.

## Đối chiếu triển khai hiện tại

| Wave | Bộ test chuyên biệt hiện có / giới hạn nghiệm thu |
|---|---|
| W4 | `mobile/tests/offline-state.test.ts`, `mobile/tests/offline-store.test.tsx`, `mobile/tests/offline-sync.test.tsx`, `mobile/tests/session.test.tsx`, `tests/android-offline-replay.test.mjs`, `tests/planner-pagination.test.mjs`; [W4](runs/2026-10-16-w4-internal.md). State/API/component và APK có bằng chứng; SQLCipher vật lý, mạng/vòng đời thiết bị vẫn chưa nghiệm thu |
| W6 | `tests/project-imports.test.mjs`, `tests/import-offline-acl.test.mjs`, `mobile/tests/project-import.test.tsx`; [W6](runs/2026-10-16-w6-imports.md). Có parser/atomic commit/receipt/source dedupe/ACL; cần file và flow UI thực |
| W7 | `tests/google-calendar.test.mjs`, `tests/google-calendar-transport.test.mjs`, `mobile/tests/google-calendar.test.tsx`; [W7](runs/2026-10-16-w7-internal.md). Provider giả lập có assertion; Google thật BLOCKED theo nợ được chấp nhận |
| W8 | `tests/zalo-oa.test.mjs`, `tests/zalo-oa-transport.test.mjs`, `tests/zalo-restore.test.mjs`, `mobile/tests/zalo-oa.test.tsx`; [W8](runs/2026-10-16-w8-internal.md). Có transport/callback/restore giả lập; OA/người nhận thật BLOCKED |
| W9 | `tests/public-api.test.mjs`, `tests/cross-wave-downgrade.test.mjs`, `mobile/tests/public-integrations.test.tsx`; [W9](runs/2026-10-16-w9-internal.md). Có token/v1/SSRF/signature/contract/queue; receiver transport giả lập, gate phát hành chưa mở |

Các wave vẫn **Cần mở rộng nghiệm thu toàn ca** theo phần thiếu trong hồ sơ; không dùng mock hoặc component để đổi gate provider/device/UI thành PASS.

## Quy ước áp dụng cho từng ca

Mỗi hàng là một ca độc lập. `TC-W4-T01-A` truy vết requirement **RQ-W4-T01-A** trong catalog tổng hợp của spec và task **W4-T01**; quy tắc tương tự áp dụng mọi ID dưới đây. Metadata ngay dưới tiêu đề task là một phần bắt buộc của mỗi ca trong task, không phải tùy chọn. Cột tiền điều kiện bổ sung account/fixture/thời gian riêng của ca.

- Dùng fixture chung ở [nền tảng](01-foundation.md): workspace A/B, PA-C/PA-T/PA-P/PB-C, O/A1/M/E/C/V, N, G-E/G-C/G-V, B1 và SA. Tài khoản mặc định **E** thao tác task; **O** cấu hình tích hợp, import và token; thử trực tiếp API bằng **V, N, B1** cho mọi mutation của task. Thất bại quyền/validation phải không đổi business row, event thành công, receipt thành công hoặc outbox. UI không báo thành công và giữ dữ liệu nhập hợp lệ. Các ca ACL chuyên biệt tăng độ phủ này, không thay thế guard của từng task.
- Đồng hồ mặc định **T0 = 2026-10-16T02:00:00Z (09:00 UTC+7)**. PostgreSQL thử nghiệm/schema riêng; không dùng SQLite thay cho cạnh tranh server. Hai connection/process độc lập và barrier cho ca đồng thời. DB local Android/SQLCipher được kiểm tra trên thiết bị riêng, không phải DB thay thế PostgreSQL.
- `API`, `DB`, `Unit`, `Component`, `UI`, `E2E`, `Device`, `Contract`, `Review` là lớp bằng chứng khác nhau. `UI` cần thao tác giao diện thực; source/component không được ghi thành browser E2E hoặc thiết bị thật. Mọi đối soát ghi ở cột kết quả phải quan sát được, không suy từ status HTTP.
- Cột **Tái sử dụng / triển khai** phân biệt `Cần mở rộng`, `Chưa viết`, `Thủ công`. Tên suite là điểm bắt đầu có thật; chưa xác nhận suite đó đáp ứng ca. Với phần chưa triển khai, giữ `NOT RUN`; chỉ ghi `BLOCKED` khi có lý do và bằng chứng điều kiện cản trở cụ thể.
- Mỗi ô **Hồ sơ chạy** là `trạng thái; thực tế; build/snapshot; bằng chứng`. Ban đầu đều `NOT RUN; —; —; —`. Khi chạy, bổ sung runtime/schema/seed/T0/device/provider/request IDs đã che secret theo README. Tất cả P0 và P1 phải đạt trước gate tương ứng.
- Với mutation hợp lệ, đối soát **API + UI + DB + tác dụng phụ**: kết quả đúng hợp đồng, UI phản ánh server sau tải lại, chỉ các business/event/receipt/revision/outbox được phép thay đổi. Ca chỉ đọc không được ghi nghiệp vụ/gửi thông báo; ca provider ghi rõ fake hay thật. Những kiểm tra này áp dụng cả khi một hàng chỉ nêu phần khác biệt.

## W4 — Planner và Android offline

<a id="w4-t01"></a>
### W4-T01 — Planner

Nền tảng: Web + Android; fixture task thường/không hạn/lặp, hai người có personal plan độc lập; E và C có ACL. Thời gian T0 trừ mốc riêng ở ca D. Requirement RQ-W4-T01-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w4-t01-a"></a>TC-W4-T01-A | P0 / Unit+API+UI | Task chưa lập kế hoạch, hôm nay, tuần này và tương lai | 1. Mở Inbox/Today/Upcoming/Week. 2. Đổi plan và tải lại cả hai nền tảng | Cùng nguồn personal plan; bucket đúng và task không ngày còn trong Inbox; DB không có kế hoạch trùng; chuyển view không sinh mutation | Cần mở rộng: `tests/personal-planning.test.mjs`, `tests/week-planning.test.mjs`; UI thực chưa viết | NOT RUN; —; —; — |
| <a id="tc-w4-t01-b"></a>TC-W4-T01-B | P0 / API+UI | E và C có plan riêng cho TP có deadline | 1. E dời ngày/giờ plan. 2. C và Web/Android tải lại | Chỉ plan của E/revision tương ứng đổi; deadline và plan C giữ nguyên; không có deadline event/reminder ngoài ý muốn | Cần mở rộng: `tests/personal-planning.test.mjs`, `tests/cross-platform-sync.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w4-t01-c"></a>TC-W4-T01-C | P0 / Unit+UI | Các câu “mai 9h gọi An”, ngày mơ hồ, “31/02”, “25h”; T0 | 1. Nhập nhanh từng mẫu. 2. Xem preview rồi xác nhận/sửa | Câu rõ hiển thị ngày/giờ đúng; ngày sai bị chặn và mơ hồ yêu cầu xác nhận, không âm thầm chọn; chưa xác nhận không ghi task/outbox | Cần mở rộng: `tests/personal-planning.test.mjs`, `mobile/tests/task-form.test.tsx`; thêm UI thực | NOT RUN; —; —; — |
| <a id="tc-w4-t01-d"></a>TC-W4-T01-D | P0 / Unit+API+UI | Đồng hồ 2026-10-15T16:59:59Z và 2026-12-31T16:59:59Z; thiết bị UTC−5 | 1. Đọc bucket. 2. Tiến 1 giây. 3. Tải lại | Ngày Việt Nam đổi tại 17:00Z, kể cả sang năm; deadline/plan lưu nguyên nghĩa; không dời task hay tạo reminder trùng khi đổi bucket | Cần mở rộng: `tests/personal-planning.test.mjs`, `tests/week-planning.test.mjs` | NOT RUN; —; —; — |

<a id="w4-t02"></a>
### W4-T02 — Lưu trữ offline

Nền tảng: Android (emulator cho harness, thiết bị thật cho lưu trữ/reboot/APK); E có draft và queue ở A/PA-P, cache đọc, khóa local riêng. T0; không gửi dữ liệu nhạy cảm ra log. Requirement RQ-W4-T02-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w4-t02-a"></a>TC-W4-T02-A | P0 / Device+DB | Draft và outbox chứa canary; cache đọc tồn tại | 1. Ghi offline. 2. Inspect file DB không khóa. 3. Xóa cache đọc bằng chức năng hợp lệ | Draft/outbox mã hóa không đọc được như plaintext; xóa cache không xóa pending/draft; UI giữ trạng thái lưu local, server chưa nhận mutation | Chưa viết: harness SQLCipher + inspect thiết bị; `mobile/tests/session.test.tsx` chỉ tái sử dụng lifecycle | NOT RUN; —; —; — |
| <a id="tc-w4-t02-b"></a>TC-W4-T02-B | P0 / Component+Device | E/A, E/B, B1 và hai origin thử nghiệm có storage riêng | 1. Lưu canary trong từng scope. 2. Đổi account/workspace/origin. 3. Mở lại | Scope khác không giải mã/đọc hoặc replay dữ liệu cũ; UI không lộ cache; operation không bị gán tenant mới | Cần mở rộng: `mobile/tests/session.test.tsx`, `mobile/tests/api.test.tsx`; SQLCipher/scope chưa viết | NOT RUN; —; —; — |
| <a id="tc-w4-t02-c"></a>TC-W4-T02-C | P0 / Device | Có draft, pending operation ID, conflict; APK phiên bản trước | 1. Đóng app. 2. Reboot. 3. Nâng APK theo đường nâng cấp. 4. Mở lại | Giữ đủ draft/queue/operation ID/conflict và khóa dùng được; không tự replay với ID mới; API không có duplicate | Thủ công + Chưa viết: migration storage Android; `mobile/tests/session.test.tsx` chỉ regression bổ trợ | NOT RUN; —; —; — |
| <a id="tc-w4-t02-d"></a>TC-W4-T02-D | P0 / Component+Device | Harness gây hết dung lượng hoặc lỗi DB trong giao dịch ghi | 1. Sửa draft. 2. Gây lỗi trước commit. 3. Khôi phục tài nguyên và thử lại | Báo chưa lưu, giữ nội dung đang nhập để phục hồi; không tự xóa DB; bản đã lưu trước còn nguyên; không hiển thị đã lưu hoặc enqueue nửa operation | Chưa viết: fault storage harness; tái sử dụng `mobile/tests/serial.test.ts` cho thứ tự thao tác | NOT RUN; —; —; — |
| <a id="tc-w4-t02-e"></a>TC-W4-T02-E | P0 / Device+Review | Draft canary và khóa riêng; đã thực hiện A–D trên fixture mới | 1. Kiểm tra logcat, crash report, file tạm/backup theo cấu hình. 2. Tìm canary/khóa | Không có plaintext nội dung hoặc khóa ngoài storage được bảo vệ; bằng chứng đã che secret; inspect không gửi mutation | Thủ công: audit thiết bị; Chưa viết: kiểm tra log redaction | NOT RUN; —; —; — |

<a id="w4-t03"></a>
### W4-T03 — Replay queue

Nền tảng: Android + API/PostgreSQL; E có quyền PA-P, fake transport chặn response sau commit, task tạm và checklist/planner; T0. Requirement RQ-W4-T03-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w4-t03-a"></a>TC-W4-T03-A | P0 / API+Device | Mất mạng trước tạo task; queue rỗng | 1. Tạo task offline. 2. Reconnect. 3. Retry/reload | Một task server và một receipt/event/outbox hợp lệ; temp ID ánh xạ một server ID; UI hết pending sau đối soát | Cần mở rộng: `tests/cross-platform-sync.test.mjs`; queue Android chưa viết | NOT RUN; —; —; — |
| <a id="tc-w4-t03-b"></a>TC-W4-T03-B | P0 / API+Device | Task tạm có checklist và personal plan | 1. Tạo cha rồi child offline. 2. Replay với mạng chập chờn | Cha resolve trước child; FK đúng ID server, không orphan hoặc trùng; UI giữ cấu trúc; mỗi operation có receipt riêng đúng scope | Chưa viết: queue dependency harness; tái sử dụng `mobile/tests/task-form.test.tsx` | NOT RUN; —; —; — |
| <a id="tc-w4-t03-c"></a>TC-W4-T03-C | P0 / Component+API | Operation op1 đang gửi, transport giữ response | 1. Gửi op1. 2. Người dùng sửa tiếp thành draft2. 3. Thả response | Payload/hash op1 bất biến; draft2 còn riêng và dùng operation/revision phù hợp khi gửi; không mất nội dung mới hoặc đổi receipt op1 | Chưa viết: in-flight queue harness; `tests/cross-platform-sync.test.mjs` hỗ trợ race server | NOT RUN; —; —; — |
| <a id="tc-w4-t03-d"></a>TC-W4-T03-D | P0 / API+Device | Provider nội bộ commit create rồi mất response | 1. Force-stop trước nhận response. 2. Mở app và replay | Cùng operation ID/payload; server trả kết quả đã có sau kiểm tra quyền; một task/receipt/event/outbox, UI đối soát thành công | Cần mở rộng: `tests/cross-platform-sync.test.mjs`; Thủ công force-stop | NOT RUN; —; —; — |
| <a id="tc-w4-t03-e"></a>TC-W4-T03-E | P0 / Component+API | Hai edits cùng task và một edit task khác đang chờ | 1. Kích hoạt hai vòng flush. 2. Giữ request đầu tại barrier. 3. Quan sát rồi thả | Tối đa một operation đang gửi/resource; thứ tự revision hợp lệ; task khác không gây ghi đè; không nhân request nghiệp vụ/receipt | Chưa viết: queue scheduler race; `mobile/tests/serial.test.ts` chỉ tham khảo serialization | NOT RUN; —; —; — |

<a id="w4-t04"></a>
### W4-T04 — Conflict và phiên

Nền tảng: Web + Android; E/A có queue mã hóa và phiên quyền local cấp tại T0, fake clock và delayed response. Quyền đọc offline hết lúc min(T0 + 24h, session expiry); quyền ghi còn bị giới hạn bởi write eligibility đã biết, gồm subscription currentPeriodEnd. Thu hồi server khi hoàn toàn offline được phát hiện khi reconnect hoặc hết hạn local, không đòi khóa tức thời. Requirement RQ-W4-T04-A…G.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w4-t04-a"></a>TC-W4-T04-A | P0 / API+UI+Device | Android sửa offline từ revision r; Web đã sửa cùng trường thành r+1 | 1. Reconnect. 2. Replay. 3. Mở conflict | API conflict đúng hợp đồng; UI giữ local/server để so sánh; draft không mất; server winner/event/receipt/outbox không bị ghi đè | Cần mở rộng: `tests/cross-platform-sync.test.mjs`; conflict UI chưa viết | NOT RUN; —; —; — |
| <a id="tc-w4-t04-b"></a>TC-W4-T04-B | P0 / API+UI | Hai fixture conflict độc lập từ A | 1. Chọn server ở fixture 1. 2. Chọn local ở fixture 2 | Chọn server không gửi write; chọn local tạo operation mới dựa revision hiện tại và vẫn revalidate; một mutation/event nếu hợp lệ | Chưa viết: conflict resolution API+Android; dùng harness `tests/cross-platform-sync.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w4-t04-c"></a>TC-W4-T04-C | P0 / Component+Device | Ba biến thể: session expiry sau 48h; session sau 8h; session sau 48h nhưng subscription currentPeriodEnd sau 4h; pending có canary | 1. Tiến trước/đúng T0+24h ở biến thể 1. 2. Đến T0+8h ở biến thể 2. 3. Đến T0+4h ở biến thể 3 và thử tạo/sửa task offline | Hết TTL/session khóa nội dung bảo vệ, không render cache nhạy cảm hoặc replay; thuê bao hết hạn sớm khóa ghi dù session còn sống; draft/outbox mã hóa không tự bị xóa; quyền đọc còn lại tuân chính sách thuê bao và TTL | Cần mở rộng: `mobile/tests/session.test.tsx`, `mobile/tests/auth-api-errors.test.tsx`, `mobile/tests/policy.test.ts` | NOT RUN; —; —; — |
| <a id="tc-w4-t04-d"></a>TC-W4-T04-D | P0 / Device+Component | Phiên gần hết local TTL; clock server đã neo | 1. Đổi lùi đồng hồ thiết bị. 2. Reboot/offline. 3. Đến hạn đã neo | Không kéo dài quyền bằng clock rollback; không xác định được thời gian tin cậy thì khóa theo chính sách; giữ draft mã hóa, không phát request mới trái phiên | Chưa viết: clock trust harness + Thủ công thiết bị | NOT RUN; —; —; — |
| <a id="tc-w4-t04-e"></a>TC-W4-T04-E | P0 / API+Device | Queue pending; server lần lượt trả 401, 423, mất ACL | 1. Flush. 2. Cho thêm operation chờ. 3. Kiểm tra storage và DB | Dừng gửi và cách ly queue mã hóa theo scope; UI yêu cầu xử lý phiên/quyền, không tự xóa draft; không business/event/outbox mới trái quyền | Cần mở rộng: `mobile/tests/auth-api-errors.test.tsx`, `mobile/tests/session.test.tsx` | NOT RUN; —; —; — |
| <a id="tc-w4-t04-f"></a>TC-W4-T04-F | P0 / Component+Device | Ba fixture có pending, gồm mạng tốt và mất mạng | 1. Logout. 2. Chọn lần lượt đồng bộ, giữ mã hóa, xóa. 3. Đăng nhập lại | Đồng bộ chỉ kết thúc sau đối soát, lỗi giữ lựa chọn/nháp; giữ mã hóa không lộ cho account khác; xóa là lựa chọn rõ và không bị write đến muộn phục hồi | Cần mở rộng: `mobile/tests/session.test.tsx`, `mobile/tests/serial.test.ts`; Device thủ công | NOT RUN; —; —; — |
| <a id="tc-w4-t04-g"></a>TC-W4-T04-G | P0 / Component+API | Response A bị giữ trong transport | 1. Gửi request ở A. 2. Đổi B/account/origin. 3. Thả response A | Response cũ không render, ghi cache scope mới, restore session hoặc enqueue trong B; dữ liệu đúng scope còn được xử lý theo chính sách | Cần mở rộng: `mobile/tests/session.test.tsx`, `mobile/tests/api.test.tsx` | NOT RUN; —; —; — |

<a id="w4-t05"></a>
### W4-T05 — Gate thiết bị thật

Nền tảng: APK trên Android thật; ghi model/OS/build/APK hash, Web đối chiếu; E/A, mạng điều khiển được, task lặp và danh mục người/nhãn. T0/fake server clock; không cam kết sync khi OS force-stop. Requirement RQ-W4-T05-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w4-t05-a"></a>TC-W4-T05-A | P0 / Device+E2E | Task draft mới cho từng chế độ mạng | 1. Airplane. 2. Wi-Fi không internet. 3. Wi-Fi↔4G. 4. Chập chờn rồi ổn định | UI phân biệt offline/pending/retrying/synced; retry cùng operation, một mutation; không báo saved-to-server khi chưa đối soát; draft không mất | Thủ công thiết bị; harness queue Chưa viết | NOT RUN; —; —; — |
| <a id="tc-w4-t05-b"></a>TC-W4-T05-B | P0 / Device+E2E | Có draft/pending/in-flight/conflict | 1. Background. 2. Force-stop. 3. Mở lại/reconnect | Giữ nội dung/operation/conflict qua vòng đời; tiếp tục khi app chạy hợp lệ; không đòi network sync trong force-stop; không duplicate | Thủ công thiết bị; tham chiếu W4-T02-C và W4-T03-D với fixture độc lập | NOT RUN; —; —; — |
| <a id="tc-w4-t05-c"></a>TC-W4-T05-C | P0 / Device+API | Task lặp đến hạn có revision hiện tại | 1. Complete offline. 2. Reconnect và mất response một lần. 3. Retry | Đúng một successor với anchor và quan hệ đúng; một logical completion/event; Web/Android thấy cùng kỳ mới | Cần mở rộng: `tests/task-recurrence.test.mjs`; Thủ công replay Android | NOT RUN; —; —; — |
| <a id="tc-w4-t05-d"></a>TC-W4-T05-D | P0 / Device+DB | Offline; E có quyền hợp lệ với tất cả thao tác khi online | 1. Soạn comment. 2. Thử upload/delete/move/finance/renewal/timer. 3. Inspect queue/reconnect | Comment chỉ là draft; các thao tác ngoài whitelist không vào queue, UI báo cần online; reconnect không tự gửi tác dụng phụ bị cấm | Cần mở rộng: `mobile/tests/policy.test.ts`, `mobile/tests/service-detail.test.tsx`, `mobile/tests/files.test.tsx`; Device thủ công | NOT RUN; —; —; — |
| <a id="tc-w4-t05-e"></a>TC-W4-T05-E | P0 / Device+API | Offline draft chọn assignee/label từ cache | 1. Web thu hồi quyền/xóa label. 2. Reconnect và replay | Server revalidate; giữ draft và chỉ rõ mapping cần sửa; không tự thêm membership/gán ID trái quyền; không receipt success/event/outbox cho mutation lỗi | Cần mở rộng: `tests/cross-platform-sync.test.mjs`; Device thủ công | NOT RUN; —; —; — |

## W6 — CSV/Trello và import

Triển khai API/Web/Android và bằng chứng nội bộ: [hồ sơ W6 ngày 16/10/2026](runs/2026-10-16-w6-imports.md). Các checklist UI/device/gate vẫn theo đúng lớp bằng chứng; không tự đổi toàn bộ catalog thành PASS.

<a id="w6-t01"></a>
### W6-T01 — CSV

Nền tảng: API + Web/Android chọn file; O/A có quyền import PA-P, custom fields đủ kiểu; T0. Fixture input giữ nguyên byte để tái chạy. Requirement RQ-W6-T01-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w6-t01-a"></a>TC-W6-T01-A | P1 / Unit+API+UI | CSV UTF-8 có/không BOM, tiếng Việt, emoji, quote, dấu phẩy, CRLF, multiline | 1. Parse/preview. 2. Commit fixture hợp lệ. 3. Export/đọc lại | Nội dung từng ô nguyên vẹn, đúng số dòng logic; UI không tách dòng trong ô thành task; DB một task/dòng hợp lệ và không gửi nhắc lịch sử | Chưa viết: CSV parser/import suite; tham khảo `tests/automation-events-transfer.test.mjs` cho import nguyên tử | NOT RUN; —; —; — |
| <a id="tc-w6-t01-b"></a>TC-W6-T01-B | P1 / Unit+API+UI | Bốn file thiếu header, trùng header, thiếu title, title rỗng | 1. Preview từng file. 2. Thử commit trực tiếp | Lỗi chỉ đúng dòng/cột và nguyên nhân; không đoán cột hoặc ghi task; UI giữ mapping để sửa; không event/receipt success/outbox | Chưa viết: CSV validation + preview UI | NOT RUN; —; —; — |
| <a id="tc-w6-t01-c"></a>TC-W6-T01-C | P0 / Unit+API | Ngày “01/02/2026”, “31/02/2026”, “29/02/2028” | 1. Preview chưa chọn format. 2. Chọn dd/MM/yyyy. 3. Commit | Ngày mơ hồ yêu cầu format; ngày sai từ chối cả lô; ngày nhuận thật giữ đúng; không tự dịch timezone/giờ deadline | Chưa viết CSV; tái sử dụng kiểm tra ngày của `tests/automation-events-transfer.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w6-t01-d"></a>TC-W6-T01-D | P0 / API+UI | Sáu kiểu field, option PA-P và option PB-C | 1. Map đúng. 2. Thử số/ngày sai, boolean rỗng, option ngoài project | Preview/commit cùng validation kiểu; phân biệt 0/false/null; ID ngoài scope không hợp lệ và không lộ tên; lỗi không ghi một phần | Chưa viết: CSV/custom-field mapping suite | NOT RUN; —; —; — |

<a id="w6-t02"></a>
### W6-T02 — Trello

Nền tảng: API + Web/Android preview; O/A có quyền import; fixture JSON Trello có source IDs ổn định, list trùng tên, card/checklist/label/user/comment/attachment/rule. T0. Requirement RQ-W6-T02-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w6-t02-a"></a>TC-W6-T02-A | P0 / API+DB+UI | Hai list cùng tên khác ID; checklist/label phân biệt | 1. Preview. 2. Commit. 3. Đối chiếu graph nguồn/đích | List giữ danh tính riêng; task/checklist/label đúng FK/thứ tự; UI thống kê đúng; không gộp theo tên hoặc phát historical reminders | Chưa viết: Trello suite; tái sử dụng duplicate-column fixture `tests/automation-events-transfer.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w6-t02-b"></a>TC-W6-T02-B | P0 / API+UI | Trello user chưa map, user ngoài project/tenant | 1. Preview. 2. Map ID không hợp lệ. 3. Commit theo mapping được giải quyết | UI yêu cầu xử lý assignee; không tạo account/member/seat tự động; server từ chối mapping trái quyền, không lộ directory ngoài scope | Chưa viết: Trello identity mapping + ACL | NOT RUN; —; —; — |
| <a id="tc-w6-t02-c"></a>TC-W6-T02-C | P0 / API+DB | Đã import source IDs; task đích được sửa title/deadline | 1. Import lại cùng file. 2. Thêm một source mới và import | Source cũ mặc định skip; sửa đích nguyên vẹn; chỉ source mới được tạo; thống kê/receipt/map đúng và không nhân event/outbox | Chưa viết: Trello source dedupe (khác JSON v1 append) | NOT RUN; —; —; — |
| <a id="tc-w6-t02-d"></a>TC-W6-T02-D | P1 / API+UI | File có comment/attachment/automation chưa hỗ trợ | 1. Preview. 2. Xem cảnh báo rồi commit | Liệt kê chính xác loại/số lượng bỏ qua trước commit; không báo nhập đủ hoặc kích hoạt rule nguồn; task hỗ trợ nhập đúng | Chưa viết: Trello unsupported-content preview | NOT RUN; —; —; — |

<a id="w6-t03"></a>
### W6-T03 — Preview/commit

Nền tảng: API/PostgreSQL + Web/Android; O/A có quyền import PA-P, CSV/Trello batch 3 dòng, JSON v1; T0; fault bằng harness/transport, không endpoint production. Requirement RQ-W6-T03-A…F.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w6-t03-a"></a>TC-W6-T03-A | P0 / API+DB | Snapshot số task/event/outbox/receipt trước preview | 1. Preview nhiều lần. 2. Hủy wizard. 3. Đối soát DB/transport | Preview không ghi dữ liệu nghiệp vụ hoặc event/receipt thành công, không gửi; bản preview tạm theo hợp đồng không được coi là import đã commit | Chưa viết preview; dùng `tests/database-helpers.mjs` cách ly schema | NOT RUN; —; —; — |
| <a id="tc-w6-t03-b"></a>TC-W6-T03-B | P0 / API+DB+UI | Preview hợp lệ; O cấp M quyền import rồi thu hồi hoặc retire field | 1. Preview bằng M. 2. Đổi ACL/schema. 3. Commit bản preview cũ | Revalidate tại commit; báo điều kiện đã đổi và giữ mapping để sửa; không ghi nửa lô/field trái schema hoặc dùng quyền cũ | Chưa viết: preview commit revalidation | NOT RUN; —; —; — |
| <a id="tc-w6-t03-c"></a>TC-W6-T03-C | P0 / API+DB | Ba dòng, dòng cuối sai; lần khác inject lỗi sau dòng 2 | 1. Commit từng fixture. 2. Đối soát. 3. Sửa rồi retry | Cả lô rollback: không task/child/map/event/receipt success/outbox thừa; UI báo lô chưa nhập; retry hợp lệ tạo đủ một lô | Cần mở rộng: `tests/automation-events-transfer.test.mjs`; CSV/Trello fault chưa viết | NOT RUN; —; —; — |
| <a id="tc-w6-t03-d"></a>TC-W6-T03-D | P0 / API+DB | Một commit ID; hai process/connection cùng payload | 1. Thả barrier commit đồng thời. 2. Mất response rồi retry | Một lô/receipt/map và tập tác dụng phụ; trả kết quả đã có sau ACL; payload khác cùng ID bị chặn | Chưa viết: import idempotency/concurrency; tái sử dụng `tests/cross-platform-sync.test.mjs` harness | NOT RUN; —; —; — |
| <a id="tc-w6-t03-e"></a>TC-W6-T03-E | P0 / API+DB | Import task cũ overdue/done/lặp, created automation đang bật | 1. Commit lịch sử. 2. Tick worker. 3. Restart và tick lại | Không gửi nhắc cũ, chạy created rule hoặc sinh hàng loạt successor; dữ liệu/số đếm đúng source; chỉ event nguồn import được spec cho phép | Cần mở rộng: `tests/automation-events-transfer.test.mjs`, `tests/task-recurrence.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w6-t03-f"></a>TC-W6-T03-F | P1 / API+Contract | Board export JSON format v1 hợp lệ với cột trùng tên/checklist | 1. Import hai lần theo hợp đồng hiện hữu. 2. Đọc graph | Giữ append v1, hai đợt task theo hợp đồng; cột/quan hệ đúng; không áp mặc định Trello source-skip vào v1; validation/ACL vẫn giữ | Cần mở rộng/đối chiếu: `tests/automation-events-transfer.test.mjs` đã có regression append | NOT RUN; —; —; — |

<a id="w6-t04"></a>
### W6-T04 — UI import

Nền tảng: browser Web và APK Android thực; O/A, CSV/Trello hợp lệ/sai; T0; fixture có 2 imported, 1 skipped, 1 lỗi ở preview (sửa trước commit nguyên tử). Requirement RQ-W6-T04-A…C.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w6-t04-a"></a>TC-W6-T04-A | P0 / UI+Device | File picker hai nền tảng và mapping đã chuẩn bị | 1. Chọn file. 2. Map/preview. 3. Sửa lỗi. 4. Commit và mở task | Wizard thao tác được, lỗi gắn field/dòng, giữ dữ liệu nhập; server/DB khớp preview đã xác nhận; một commit dù double-click | Chưa viết browser E2E; Thủ công Android; `mobile/tests/files.test.tsx` chỉ regression file | NOT RUN; —; —; — |
| <a id="tc-w6-t04-b"></a>TC-W6-T04-B | P1 / API+UI | Fixture count nêu trên; snapshot DB trước/sau | 1. Xem preview lỗi. 2. Sửa. 3. Commit và đối soát counts | Preview không gọi “imported” cho dữ liệu chưa commit; lỗi commit nguyên tử không báo partial success; imported/skipped/failed khớp thực tế | Chưa viết: import counters + UI | NOT RUN; —; —; — |
| <a id="tc-w6-t04-c"></a>TC-W6-T04-C | P0 / API+UI+Device | Transport bỏ response sau commit | 1. Bấm commit. 2. Mất mạng. 3. Retry/đối soát cùng ID | UI hiển thị chưa xác định/đang đối soát; không kết luận thất bại chắc chắn; một lô/receipt; kết quả cuối đúng cả hai nền tảng | Chưa viết: UI import retry; dùng concurrency harness hiện hữu | NOT RUN; —; —; — |

<a id="w6-t05"></a>
### W6-T05 — Gate import

Nền tảng: Web/Android + API/PostgreSQL; O/A và G-V/N/B1 đọc thử, PA-P; T0; giới hạn kích thước/số dòng lấy cấu hình build và ghi vào bằng chứng. Requirement RQ-W6-T05-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w6-t05-a"></a>TC-W6-T05-A | P1 / API+UI+E2E | File đúng giới hạn và vượt 1 byte/1 dòng; môi trường giới hạn tài nguyên cố định | 1. Preview/commit từng file. 2. Theo dõi memory/time | File hợp lệ xử lý có paging/progress; vượt giới hạn bị chặn rõ trước ghi; không crash/hang/partial batch; lưu số đo thực | Chưa viết: import limits; Thủ công đo UX | NOT RUN; —; —; — |
| <a id="tc-w6-t05-b"></a>TC-W6-T05-B | P0 / API+UI | Title/description/label có HTML/script/Markdown/URL độc hại | 1. Preview. 2. Commit. 3. Mở list/detail | Nội dung hiển thị như dữ liệu/escape theo loại trường; không thực thi script hay gọi URL nguy hiểm; DB lưu đúng dữ liệu, không phát tác dụng phụ | Cần mở rộng: `tests/security-logic-regressions.test.mjs`; import UI chưa viết | NOT RUN; —; —; — |
| <a id="tc-w6-t05-c"></a>TC-W6-T05-C | P0 / API+Contract | Ô bắt đầu =, +, -, @, tab/CR; tiêu đề chứa dấu quote | 1. Import. 2. Export CSV. 3. Parse và mở bằng spreadsheet thử cô lập | Export vô hiệu formula injection theo hợp đồng, quote/round-trip nội dung đúng; không thực thi công thức/network; DB không sửa để che lỗi export | Chưa viết: CSV export injection regression + kiểm tra file thực | NOT RUN; —; —; — |
| <a id="tc-w6-t05-d"></a>TC-W6-T05-D | P0 / E2E+Device | Trello nhập PA-P gồm task lặp, người đã map, task không ngày | 1. Import. 2. Kiểm tra ACL/planner/recurrence/report trên Web/Android. 3. Thử N/B1 | Dữ liệu chỉ trong phạm vi được cấp; planner đúng, không tự phát lịch sử/successor; báo cáo không double count; không canary ở tổng ngoài quyền | Chưa viết E2E; mở rộng `tests/automation-events-transfer.test.mjs`, `tests/personal-planning.test.mjs` | NOT RUN; —; —; — |

## W7 — Google Calendar hai chiều

<a id="w7-t01"></a>
### W7-T01 — Kết nối

Nền tảng: Web/Android/API + fake Google; O cấu hình, E kết nối cá nhân A, B1 thuộc B. T0; OAuth Calendar tách Google login, state riêng. Tài khoản Google thật chỉ ở W7-T05. Requirement RQ-W7-T01-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w7-t01-a"></a>TC-W7-T01-A | P0 / API+UI+Contract | Google login đã hoạt động, chưa có consent Calendar | 1. Đăng nhập Google. 2. Mở kết nối Calendar và consent riêng | Login không tự cấp Calendar; scope đúng cấu hình tối thiểu, lịch app tạo gắn đúng user/workspace; UI thể hiện kết nối riêng; không gửi trước consent | Cần mở rộng: `tests/google-recovery.test.mjs` chỉ giữ login; Calendar Chưa viết | NOT RUN; —; —; — |
| <a id="tc-w7-t01-b"></a>TC-W7-T01-B | P0 / API+Contract | State mới, sai, hết hạn, đã dùng và state của B1 | 1. Gọi callback từng mẫu. 2. Thay user/workspace giữa start/callback | Chỉ callback đúng binding/TTL dùng một lần thành công; còn lại từ chối không lộ account hoặc ghi token/mapping/event | Chưa viết Calendar state; tham khảo `tests/google-recovery.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t01-c"></a>TC-W7-T01-C | P0 / DB+API+Review | Token fake có canary đã consent | 1. Inspect DB. 2. Gọi API config/history/export. 3. Kiểm tra logs | Token mã hóa at rest; raw token không có trong API/log/export; UI chỉ metadata đã che; tài khoản ngoài quyền không lấy được ciphertext/key | Chưa viết: encrypted Calendar token/redaction | NOT RUN; —; —; — |
| <a id="tc-w7-t01-d"></a>TC-W7-T01-D | P0 / API+E2E | E/A kết nối; B1/B có connection riêng; Google login E đang hợp lệ | 1. Refresh. 2. Revoke. 3. Reconnect. 4. Thử login | Mapping/token không gắn nhầm workspace; revoked dừng sync; reconnect xử lý binding rõ; Google login không hỏng hoặc tự khôi phục Calendar consent | Cần mở rộng: `tests/google-recovery.test.mjs`; Calendar lifecycle Chưa viết | NOT RUN; —; —; — |

<a id="w7-t02"></a>
### W7-T02 — Outbound

Nền tảng: API/worker + fake Google; E/A kết nối lịch app, có personal plan/deadline/appointment/renewal và recurring occurrences đã tồn tại; T0. Đối soát payload, mapping, job/attempt/provider event IDs. Requirement RQ-W7-T02-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w7-t02-a"></a>TC-W7-T02-A | P0 / API+Contract | Personal plan 09:00 UTC+7, duration 90 phút; fixture khác timezone | 1. Tạo/sửa plan. 2. Flush worker. 3. Đọc provider event | start/end/timezone ánh xạ đúng thời điểm/thời lượng; một mapping và event cho plan người kết nối; deadline/người khác không đổi | Chưa viết Calendar outbound; tái sử dụng `tests/personal-planning.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t02-b"></a>TC-W7-T02-B | P0 / API+Contract | Deadline 17:00 UTC+7, Google default reminder bật | 1. Tạo/sửa deadline. 2. Flush. 3. Inspect event payload | Event 15 phút, transparency=transparent/free, reminders không dùng Google default; task deadline nguyên nghĩa; một mapping, không thêm reminder trái phép | Chưa viết: deadline projection contract | NOT RUN; —; —; — |
| <a id="tc-w7-t02-c"></a>TC-W7-T02-C | P0 / API+Contract | Appointment/renewal chứa canary ở tiền/credential; guest không có CRM | 1. Enqueue projection hợp lệ. 2. Inspect payload và API/history | Chỉ trường allowlist xuất ra Google; không tiền/credential/nội dung ngoài ACL; UI/history không lộ secret; không tạo expense/gia hạn | Chưa viết: projection allowlist; dùng fixture `tests/services.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t02-d"></a>TC-W7-T02-D | P0 / API+DB | Task lặp có 3 occurrence đã tồn tại và rule kỳ tương lai | 1. Flush. 2. Retry/restart. 3. Complete một kỳ hợp lệ | Một event/mapping mỗi occurrence tồn tại; không RRULE hoặc tạo vô hạn event; kỳ mới chỉ được xuất sau nghiệp vụ tạo thành công | Chưa viết Calendar; tái sử dụng `tests/task-recurrence.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t02-e"></a>TC-W7-T02-E | P0 / API+Contract | Fake Google lưu event rồi timeout create response | 1. Gửi create. 2. Restart/retry/lookup. 3. Đối soát | Dùng ID/idempotency/lookup provider để không tạo event thứ hai; giữ unknown cho tới đối soát; một logical mapping, attempts truy vết được | Chưa viết: Google ambiguity transport; liên kết TC-FND-068 cho nền outbox | NOT RUN; —; —; — |

<a id="w7-t03"></a>
### W7-T03 — Inbound

Nền tảng: Google fake/HTTP callbacks + API/PostgreSQL, Web/Android đọc kết quả; E/A có ACL, B1 khác tenant; T0; fake provider hỗ trợ ETag, nhiều trang, 410, đảo callback. Requirement RQ-W7-T03-A…G.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w7-t03-a"></a>TC-W7-T03-A | P0 / API+Contract | E/C có plan riêng; event mapped cho E | 1. Google sửa start/duration. 2. Callback/sync. 3. Đọc Web/Android | Chỉ plan E thay đổi; deadline và plan C nguyên vẹn; revision/event theo nguồn Google; không echo-loop | Chưa viết: Calendar inbound personal plan | NOT RUN; —; —; — |
| <a id="tc-w7-t03-b"></a>TC-W7-T03-B | P0 / API+DB+Contract | Deadline event; E có quyền sửa và phiên khác E đã bị revoke | 1. Google sửa hạn mỗi fixture. 2. Sync. 3. Đối soát mapping còn hợp lệ | Quyền hợp lệ qua revision/lifecycle chung và cập nhật mapping; revoke bị chặn; chu kỳ/reminder/event đúng một lần, UI không báo sync giả | Chưa viết: inbound deadline pipeline; tái sử dụng `tests/reminder-workflow.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t03-c"></a>TC-W7-T03-C | P0 / API+Contract | Appointment và renewal projection với tiền/kỳ hiện tại | 1. Sửa trường được phép/cấm ở Google. 2. Sync | Appointment chỉ cập nhật allowlist; renewal không thực hiện gia hạn/expense; dữ liệu tiền/kỳ giữ nguyên; trường không hỗ trợ được báo rõ | Chưa viết: inbound type allowlist; fixture `tests/services.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w7-t03-d"></a>TC-W7-T03-D | P0 / API+Contract | Callback hợp lệ c1/c2, c1 lặp, sai channel và channel B1 | 1. Gửi c2 trước c1. 2. Gửi bản lặp/sai channel. 3. Sync | Xác thực channel/binding, đọc trạng thái provider hiện tại; không rollback theo callback cũ hoặc vượt tenant; một logical mutation/event | Chưa viết: callback auth/dedupe/order | NOT RUN; —; —; — |
| <a id="tc-w7-t03-e"></a>TC-W7-T03-E | P0 / API+DB+Contract | Sync 3 trang; syncToken S0; trang 3 lỗi một lần | 1. Sync đến lỗi. 2. Inspect checkpoint. 3. Retry toàn chuỗi | Chưa nâng token thành S1 trước trang cuối; retry không mất thay đổi/nhân mapping; chỉ commit checkpoint hoàn chỉnh theo hợp đồng | Chưa viết: paginated sync checkpoint | NOT RUN; —; —; — |
| <a id="tc-w7-t03-f"></a>TC-W7-T03-F | P0 / API+Contract | Sync token trả 410, watch hết hạn hoặc thiếu notification; task server tồn tại | 1. Chạy catch-up/full sync từng lỗi. 2. Renew watch. 3. Đối soát | Phục hồi checkpoint/watch an toàn, bắt thay đổi bị lỡ; không xóa task do thiếu page/token; không tạo mapping tombstone đã tắt | Chưa viết: catch-up/watch recovery | NOT RUN; —; —; — |
| <a id="tc-w7-t03-g"></a>TC-W7-T03-G | P0 / API+DB+Contract | Web và Google sửa cùng trường từ revision/ETag cũ | 1. Giữ hai thao tác tại barrier. 2. Commit một phía. 3. Thả phía còn lại | Conflict được ghi/hiển thị, giữ hai giá trị để xử lý; không blind overwrite; event/outbox chỉ cho mutation đã commit, không echo-loop | Chưa viết: revision↔ETag conflict; tái sử dụng `tests/cross-platform-sync.test.mjs` | NOT RUN; —; —; — |

<a id="w7-t04"></a>
### W7-T04 — Xóa, conflict và ngắt nối

Nền tảng: fake Google + API/worker + Web/Android; E/A và C có mapping; T0. Mỗi ca có snapshot task/plan/appointment/renewal/expense để kiểm tra tác dụng phụ. Requirement RQ-W7-T04-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w7-t04-a"></a>TC-W7-T04-A | P0 / API+Contract | Task có plan E và plan C, event personal E | 1. Xóa event E. 2. Sync. 3. Reload UI | Bỏ plan E theo hợp đồng, giữ task/deadline/plan C; mapping tombstone đúng; không delete task hoặc phát completion | Chưa viết: personal deletion mapping | NOT RUN; —; —; — |
| <a id="tc-w7-t04-b"></a>TC-W7-T04-B | P0 / API+Contract | Ba fixture deadline/appointment/renewal projection | 1. Xóa từng event Google. 2. Sync | Unlink projection, giữ task/appointment/kỳ/tiền; UI nêu đã ngắt liên kết; không tự xóa hay gia hạn nghiệp vụ | Chưa viết: projection deletion semantics | NOT RUN; —; —; — |
| <a id="tc-w7-t04-c"></a>TC-W7-T04-C | P0 / API+DB+Contract | Mapping đã tắt/tombstone sau xóa projection | 1. Full resync. 2. Restart worker. 3. Chỉnh field không liên quan | Tombstone bền vững; event/mapping bị tắt không tự tạo lại; không resurrect dữ liệu đã chọn unlink; task vẫn đọc được | Chưa viết: tombstone persistence/full-sync regression | NOT RUN; —; —; — |
| <a id="tc-w7-t04-d"></a>TC-W7-T04-D | P0 / API+UI+Contract | Deadline timed event 17:00 UTC+7 | 1. Google đổi sang all-day. 2. Sync. 3. Mở trạng thái conflict | Không tự chọn 00:00/09:00 hoặc biến date-only thành deadline bắt buộc; giữ deadline cũ và báo cần xử lý theo hợp đồng; không gửi nhắc sai giờ | Chưa viết: all-day unsupported-conversion handling | NOT RUN; —; —; — |
| <a id="tc-w7-t04-e"></a>TC-W7-T04-E | P0 / API+UI+Contract | Job pending; ba fixture mất ACL, token revoked, lịch bị xóa; cleanup trả lỗi | 1. Thay điều kiện. 2. Flush/disconnect. 3. Đọc trạng thái | Dừng sync trước tác dụng phụ ngoài quyền; UI/history báo cleanup chưa xong, không khẳng định đã xóa provider; dữ liệu nghiệp vụ giữ nguyên | Chưa viết: disconnect/revocation/cleanup failure | NOT RUN; —; —; — |

<a id="w7-t05"></a>
### W7-T05 — Gate Google thật

Nền tảng: tài khoản Google thử thật được phép, Calendar app-created, Web/Android thực; E/A, app/client/scopes/quota đã kiểm chứng theo W0-T05. Ghi timezone và giờ thật của mỗi request. Thiếu điều kiện thì chuyển ca liên quan thành **BLOCKED**, ghi lý do; fake pass không thay thế gate. Requirement RQ-W7-T05-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w7-t05-a"></a>TC-W7-T05-A | P0 / E2E+Provider thật | Consent thật, personal/deadline/appointment/renewal fixture cô lập | 1. Tạo/sửa/xóa hai chiều. 2. Revoke/reconnect. 3. Đối soát IDs | Semantics W7-T01–T04 đúng trên provider thật; request/event/channel IDs có thể truy vết; không duplicate/lộ dữ liệu; UI sync state đúng | Thủ công: Google sandbox/test account thật; Chưa thực thi | NOT RUN; —; —; — |
| <a id="tc-w7-t05-b"></a>TC-W7-T05-B | P0 / E2E+Provider thật | UTC+7, America/New_York; DST 2026-03-08 và 2026-11-01; event all-day | 1. Tạo/sửa quanh DST gap/fold và ngày all-day. 2. So Google/Web/Android | Timestamp/timezone giữ nghĩa, ngày all-day không âm thầm thành deadline giờ cụ thể; conflict/unsupported rõ; reminder không lệch hoặc nhân | Thủ công: Calendar thật; ghi thiết bị/provider timezone | NOT RUN; —; —; — |
| <a id="tc-w7-t05-c"></a>TC-W7-T05-C | P0 / E2E+Provider thật | Event tự tạo trong lịch nhưng chưa có mapping | 1. Tạo/sửa/xóa event đó. 2. Full/incremental sync | Không tự nhập thành task hoặc tạo mapping ngầm; task count/receipt/event/outbox nghiệp vụ không đổi; UI không nhận nhầm projection | Thủ công: Calendar thật | NOT RUN; —; —; — |
| <a id="tc-w7-t05-d"></a>TC-W7-T05-D | P1 / Review+Contract | Tài khoản thấy Google Tasks trong Calendar; docs/payload ghi nhận | 1. Đối chiếu scope/API/copy UI. 2. Inspect deadline mapping | Không quảng bá Google Tasks connector; không dùng Google Tasks.due làm deadline; discovery giữ riêng; không thêm yêu cầu ngoài 58 task | Thủ công review hợp đồng + bằng chứng request thật từ A | NOT RUN; —; —; — |

## W8 — Zalo OA của doanh nghiệp

Cập nhật triển khai16/10: [báo cáo nội bộ W8](runs/2026-10-16-w8-internal.md) liên kết module, suite PostgreSQL32/32 và Android/APK hiện tại. Cột kết quả từng ca dưới đây giữ NOT RUN khi chưa chạy đủ biến thể/UI; kết quả nội bộ và giới hạn được tách trong báo cáo. Gate provider thật A–C đang BLOCKED, không thay bằng mock PASS.

<a id="w8-t01"></a>
### W8-T01 — OA và quyền

Nền tảng: API/worker + Web/Android cấu hình nếu được hỗ trợ + fake Zalo; O/A cấu hình OA-A, O/B cấu hình OA-B; V/G-E/N/B1/SA thử sai quyền; T0. Requirement RQ-W8-T01-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w8-t01-a"></a>TC-W8-T01-A | P0 / API+Contract | Hai workspace có OA và recipient riêng | 1. B1 dùng OA-A ID/config/send. 2. Giả workspace trong payload | Không đọc config/token hoặc gửi OA-A từ B; lỗi không lộ tồn tại OA/recipient; DB/job/transport không thay | Cần mở rộng: đã có `tests/zalo-oa.test.mjs`, tenant isolation + ACL | NOT RUN; —; —; — |
| <a id="tc-w8-t01-b"></a>TC-W8-T01-B | P0 / API+UI | Ma trận entitlement × O/A1/M/E/guest/V/SA | 1. Configure/test/send qua UI. 2. Gọi API trực tiếp ở từng vai trò | Chỉ quyền ∩ gói hợp lệ được phép; UI/API nhất quán; token/session capability cũ không vượt backend; failed writes không enqueue | Cần mở rộng: đã có API `tests/zalo-oa.test.mjs`; browser matrix cần chạy | NOT RUN; —; —; — |
| <a id="tc-w8-t01-c"></a>TC-W8-T01-C | P0 / DB+API+Contract | Token canary mã hóa, authorization sai/revoked | 1. Inspect DB/API/log. 2. Revoke/giả authorization. 3. Tick sender | Secret không lộ; authorization sai không tạo connection; revoked dừng send, trạng thái lỗi rõ; không gửi bằng token cũ | Cần mở rộng: đã có OA encryption/authorization/revocation trong suite W8 | NOT RUN; —; —; — |
| <a id="tc-w8-t01-d"></a>TC-W8-T01-D | P0 / API+UI+DB | Có delivery history và queued jobs trên Business | 1. Disconnect ở fixture 1. 2. Downgrade ở fixture 2. 3. Tick/reload | Giữ history/config theo chính sách, dừng sender trước gửi mới; UI phản ánh disconnected/blocked; không tự replay khi nâng lại | Cần mở rộng: đã có OA lifecycle; liên kết TC-FND-053; UI cần chạy | NOT RUN; —; —; — |

<a id="w8-t02"></a>
### W8-T02 — Template và người nhận

Nền tảng: API/preview UI + fake provider; O/A, OA-A, nhân viên và khách hàng thử đã cho phép; T0. Provider policy/template version/ngày kiểm chứng phải lưu; không suy loại gửi chỉ từ tên tính năng. Requirement RQ-W8-T02-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w8-t02-a"></a>TC-W8-T02-A | P0 / API+Contract | Bốn template approved/pending/rejected/inactive | 1. Preview/enqueue từng mẫu. 2. Đổi trạng thái sau enqueue. 3. Send | Chỉ template hiện còn hợp lệ được gửi; pending/rejected/inactive bị chặn với lý do; history không ghi accepted giả | Cần mở rộng: đã có template status/revalidation trong suite W8 | NOT RUN; —; —; — |
| <a id="tc-w8-t02-b"></a>TC-W8-T02-B | P0 / Review+Contract | Thông báo nhân sự có task/assignee đúng ACL; tài liệu mục đích gửi | 1. Chọn template nội bộ. 2. Preview/send bằng fake. 3. Đối chiếu policy | Nội dung/mục đích/CTA đúng mẫu nội bộ và điều kiện provider; không dùng mẫu khách hàng để lách; payload không vượt dữ liệu được phép | Cần mở rộng: đã có contract; policy đã đối chiếu16/10 trong `12-zalo-provider-contract.md` | NOT RUN; —; —; — |
| <a id="tc-w8-t02-c"></a>TC-W8-T02-C | P0 / Review+Contract | Nhắc trước/sau hết hạn với hai recipient đủ/thiếu điều kiện | 1. Chọn mục đích chăm sóc/quảng bá theo policy đã ghi. 2. Preview/send | Loại gửi và điều kiện phù hợp từng ngữ cảnh; thiếu điều kiện chặn gửi với lý do; không giả định mọi nhắc gia hạn là chăm sóc | Cần mở rộng: đã có contract; policy đã đối chiếu16/10 trong `12-zalo-provider-contract.md` | NOT RUN; —; —; — |
| <a id="tc-w8-t02-d"></a>TC-W8-T02-D | P0 / API+Contract | Thiếu tham số, CTA sai, recipient không đủ điều kiện hoặc opt-out | 1. Preview. 2. Gọi send trực tiếp. 3. Thay opt-out trước worker | Validation cả enqueue/send chặn; UI lỗi cụ thể không lộ recipient ngoài scope; không gọi provider/event accepted/receipt success sai | Cần mở rộng: đã có template/recipient validation trong suite W8 | NOT RUN; —; —; — |
| <a id="tc-w8-t02-e"></a>TC-W8-T02-E | P0 / API+UI+Contract | Mẫu approved với tiếng Việt, giá trị dài và biến tùy chọn | 1. Preview. 2. Send. 3. So payload đã redaction | Preview khớp nội dung/tham số/CTA gửi thực, nêu rõ phần provider render; không thêm field nhạy cảm sau preview; history đủ template version | Cần mở rộng: đã có preview-to-payload contract; UI đầy đủ cần chạy | NOT RUN; —; —; — |

<a id="w8-t03"></a>
### W8-T03 — Delivery/callback

Nền tảng: API/worker/PostgreSQL + fake Zalo có timeout sau nhận, 429/5xx, callback reorder; O/E/A, OA-A và OA-B; T0, barrier process độc lập. Requirement RQ-W8-T03-A…E.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w8-t03-a"></a>TC-W8-T03-A | P0 / API+DB | Một reminder/task/kỳ/recipient/template; hai worker | 1. Enqueue/retry trùng. 2. Claim đồng thời. 3. Restart | Một logical delivery và claim hiệu lực; attempts tách riêng; một provider send khi kết quả đã rõ; không duplicate nội dung lịch sử | Cần mở rộng: đã có hai process/barrier trong suite W8; TC-FND-066/071 | NOT RUN; —; —; — |
| <a id="tc-w8-t03-b"></a>TC-W8-T03-B | P0 / API+DB+Contract | Queued send cho task/kỳ hiện tại | 1. Lần lượt complete/renew/reassign/revoke/downgrade trước send. 2. Tick | Revalidate trạng thái/recipient/ACL/entitlement hiện tại; suppressed có lý do, không gửi lịch cũ hoặc nội dung ngoài quyền; DB nghiệp vụ không bị sender sửa | Cần mở rộng: đã có Zalo revalidation; TC-X10 hạ gói; TC-FND-070 | NOT RUN; —; —; — |
| <a id="tc-w8-t03-c"></a>TC-W8-T03-C | P0 / API+Contract | Fake provider lưu message nhưng mất response | 1. Send. 2. Retry tick. 3. Đối soát callback/lookup nếu hỗ trợ | Unknown được giữ và hiển thị; đối soát trước resend theo khả năng provider; không tuyên bố exactly-once hoặc accepted khi chưa có bằng chứng | Cần mở rộng: đã có Zalo ambiguous-delivery harness | NOT RUN; —; —; — |
| <a id="tc-w8-t03-d"></a>TC-W8-T03-D | P1 / API+Contract | Các response 429+Retry-After, 5xx, timeout trước nhận, template invalid | 1. Tick tại trước/đúng retry. 2. Restart. 3. Đọc attempts | Tạm thời backoff theo policy; lỗi mẫu vĩnh viễn dừng/cần sửa; không retry dồn/vô hạn, history/UI đúng trạng thái | Cần mở rộng: đã có W8 worker + `tests/zalo-oa-transport.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w8-t03-e"></a>TC-W8-T03-E | P0 / API+Contract | Callback ký đúng, giả, lặp, read trước delivered và khác OA | 1. Gửi từng callback/reorder. 2. Inspect message state | Xác thực đúng cơ chế provider/binding OA; dedupe, không lùi trạng thái hoặc vượt tenant; accepted/delivered/read tách ack công việc, không mutation task | Cần mở rộng: đã có raw-byte callback authentication/order trong suite W8 | NOT RUN; —; —; — |

<a id="w8-t04"></a>
### W8-T04 — Gate OA thật

Nền tảng: OA doanh nghiệp thật được ủy quyền, template approved và recipient nội bộ/khách hàng thử được phép; Web/Android hiển thị history. Điều kiện W0-T06 có bằng chứng; thời gian thật và provider policy version phải lưu. Thiếu điều kiện thì **BLOCKED**, không gửi tùy tiện và không dùng mock thay thế. Requirement RQ-W8-T04-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w8-t04-a"></a>TC-W8-T04-A | P0 / E2E+Provider thật | Hai recipient thử được phép cho mục đích nội bộ và khách hàng | 1. Preview/gửi từng mục đích. 2. Nhận callback. 3. Đối soát history | Gửi đúng template/recipient/mục đích; lưu request/message/template IDs và phản hồi đã che secret; không coi send accepted là đã đọc/ack | Thủ công: Zalo OA thật; Chưa thực thi | BLOCKED; hoãn kiểm thử OA thật; chưa có request/message ID thật; xem báo cáo W8 |
| <a id="tc-w8-t04-b"></a>TC-W8-T04-B | P0 / E2E+Provider thật | Fixture token/template thử có thể thu hồi hợp lệ | 1. Thu hồi token hoặc template. 2. Thử send mới. 3. Khôi phục cấu hình thử nếu cần | Lỗi đúng provider và UI; sender ngừng phù hợp, không báo success hoặc resend vô hạn; không ảnh hưởng recipient ngoài thử nghiệm | Thủ công: OA thật với tài nguyên thử | BLOCKED; hoãn kiểm thử OA thật; chưa có request/message ID thật; xem báo cáo W8 |
| <a id="tc-w8-t04-c"></a>TC-W8-T04-C | P0 / E2E+Provider thật | Message có accepted và các trạng thái delivery provider hỗ trợ; task chưa ack | 1. Quan sát chuyển trạng thái. 2. Mở task/history. 3. Ack task riêng | Trạng thái provider chỉ theo bằng chứng nhận được; ack công việc độc lập, không suy từ read; Web/Android cùng dữ liệu | Thủ công: OA thật; Web/Android history đã triển khai | BLOCKED; hoãn kiểm thử OA thật; chưa có request/message ID thật; xem báo cáo W8 |
| <a id="tc-w8-t04-d"></a>TC-W8-T04-D | P1 / Review | Báo cáo fake suites và bằng chứng A–C | 1. Đối chiếu loại môi trường/build/IDs. 2. Kiểm tra gate | Không gán PASS gate thật bằng fake transport; thiếu OA/template/recipient/bằng chứng ghi BLOCKED có lý do; nghiệm thu phần nội bộ tách riêng | Thủ công: review bằng chứng gate | NOT RUN; —; —; — |


## W9 — Public API, webhook và phát hành

<a id="w9-t01"></a>
### W9-T01 — API token

Nền tảng: API/DB + Web quản lý token, Android kiểm tra quyền nghiệp vụ liên quan; O cấp token, E creator giới hạn PA-P; N/B1/SA ngoài quyền; T0. Requirement RQ-W9-T01-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w9-t01-a"></a>TC-W9-T01-A | P0 / API+DB+UI | Token mới có canary; log/API config bật redaction | 1. Cấp token. 2. Reload/list/export. 3. Inspect DB/log | Raw chỉ hiện một lần khi cấp; DB chỉ hash thích hợp, không plaintext/reversible raw; UI/list/log không khôi phục secret; một credential record | Chưa viết: public token issuance/storage suite | NOT RUN; —; —; — |
| <a id="tc-w9-t01-b"></a>TC-W9-T01-B | P0 / API | Token sai, revoked, creator locked, creator mất ACL | 1. Gọi read/write cho từng fixture. 2. Thử receipt replay | Không truy cập/mutation hoặc trả receipt nhạy cảm; lỗi đúng hợp đồng không lộ tenant; token cũ không phục hồi quyền | Chưa viết: token lifecycle; dùng `tests/account.test.mjs` fixture khóa tài khoản | NOT RUN; —; —; — |
| <a id="tc-w9-t01-c"></a>TC-W9-T01-C | P0 / API+Contract | Ma trận scope × ACL × entitlement với token creator E | 1. Gọi endpoint đọc/ghi ở mỗi tổ hợp. 2. Giả scope trong body | Chỉ giao của ba tập quyền được thực thi; tenant từ context; không dùng quyền hệ thống/owner rộng hơn token; UI capabilities không thay backend | Chưa viết: public API effective permission matrix | NOT RUN; —; —; — |
| <a id="tc-w9-t01-d"></a>TC-W9-T01-D | P0 / API | Token read và token PA-P; premium token trước downgrade | 1. Read-token write. 2. PA-P token đọc project khác. 3. Downgrade rồi retry | Từ chối write/scope khác/premium sau downgrade; không lộ counts/receipt; private data giữ nguyên, chỉ quyền đọc còn hợp lệ được dùng | Chưa viết token scope/downgrade; liên kết TC-FND-054 | NOT RUN; —; —; — |

<a id="w9-t02"></a>
### W9-T02 — API v1

Nền tảng: HTTP API/PostgreSQL + Web/Android đối soát; E token đủ scope PA-P, read token và N/B1, task thường/lặp/checklist/labels/custom fields; T0. Endpoint/limit lấy OpenAPI build đang thử, không tự phát minh route. Requirement RQ-W9-T02-A…F.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w9-t02-a"></a>TC-W9-T02-A | P0 / API+Contract+UI | Cùng payload nghiệp vụ dùng cho Web/Android/API | 1. CRUD task/checklist/labels/custom fields. 2. Complete lặp. 3. Đọc history/UI | Cùng validation/ACL/lifecycle/reminder/history; revision đúng, một successor; không đường API bỏ event/outbox hoặc khác quy tắc nền tảng | Chưa viết v1; mở rộng `tests/task-details.test.mjs`, `tests/task-extras.test.mjs`, `tests/task-recurrence.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w9-t02-b"></a>TC-W9-T02-B | P0 / API+DB+Contract | op1 thành công mất response; stale revision; hai process cùng ID | 1. Retry cùng payload. 2. Thay payload. 3. Gửi stale update | Kết quả cũ được revalidate; payload khác/stale conflict đúng contract; một business/receipt/event/outbox; không mất bản thắng | Chưa viết v1 contract; liên kết TC-FND-055/059–063 | NOT RUN; —; —; — |
| <a id="tc-w9-t02-c"></a>TC-W9-T02-C | P0 / API+Contract | Task nhiều trang, cùng sort key và private canary ngoài ACL | 1. Filter/sort/page đến cuối. 2. Thử cursor khác scope | Thứ tự/tie-break/cursor theo hợp đồng ổn định; không lặp/bỏ task ở snapshot được bảo đảm; total không lộ ngoài quyền; read không mutation | Chưa viết: API pagination/filter/sort/ACL | NOT RUN; —; —; — |
| <a id="tc-w9-t02-d"></a>TC-W9-T02-D | P0 / API+Contract | Invalid type/date/unknown fields, body tại/vượt limit, giả workspace/role | 1. Gửi từng payload. 2. Đối soát response/DB/log | Từ chối an toàn theo schema, không mass assignment hoặc partial write; lỗi không lộ stack/secret; UI dữ liệu hiện tại không đổi | Chưa viết v1 validation; mở rộng `tests/security-logic-regressions.test.mjs` | NOT RUN; —; —; — |
| <a id="tc-w9-t02-e"></a>TC-W9-T02-E | P0 / API+Contract | Token write cao nhất trong v1; routes quản lý seat/billing/renewal hiện hữu | 1. Gọi writes ngoài surface v1 bằng token. 2. Đổi method/path/alias | Không mở quyền quản lý ghế/billing/gia hạn ngoài v1; hợp đồng public không quảng bá; không expense/payment/seat/event/outbox trái phép | Chưa viết: public surface denylist/route contract | NOT RUN; —; —; — |
| <a id="tc-w9-t02-f"></a>TC-W9-T02-F | P1 / API+Contract | Policy limit/window được ghi; fake clock T0; token khác và tenant khác | 1. Gửi tại/vượt ngưỡng. 2. Tiến qua retry boundary. 3. Thử token đối chứng | Rate limit đúng policy/status/Retry-After, không vượt scope hoặc chặn sai tenant; mutation bị limit không ghi nghiệp vụ; logs không lộ raw token | Chưa viết API rate-limit; tham khảo `tests/login-rate-limit.test.mjs` (không thay API test) | NOT RUN; —; —; — |

<a id="w9-t03"></a>
### W9-T03 — Webhook

Nền tảng: API/worker/PostgreSQL + receiver HTTP thử cô lập và fake resolver/transport; E creator chỉ PA-P, O/A, B1/B; T0, retry clock/barrier. Không gửi thử tới hạ tầng nội bộ thật; SSRF harness ghi đích được/chặn trước connect. Requirement RQ-W9-T03-A…F.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w9-t03-a"></a>TC-W9-T03-A | P0 / API+Contract | Creator E có PA-P nhưng không project khác; payload scope giả | 1. Tạo/sửa subscription. 2. Phát event trong/ngoài scope. 3. Chạy worker | Subscription không vượt ACL/entitlement/scopes người tạo; payload allowlist; receiver không nhận canary/event ngoài quyền; UI chỉ thấy subscription hợp lệ | Chưa viết: webhook subscription ACL | NOT RUN; —; —; — |
| <a id="tc-w9-t03-b"></a>TC-W9-T03-B | P0 / API+Contract | URL HTTP, localhost, 127/8, RFC1918, link-local, ::1, fc00::/7, fe80::/10, mapped IPv6; DNS đổi IP và redirect | 1. Validate/create. 2. Đổi DNS giữa validation/send. 3. Redirect public→internal | Chặn protocol/đích cấm tại kết nối và mọi redirect theo policy; không request tới private/link-local; DNS rebinding không vượt guard; không leak body/secret | Chưa viết: SSRF resolver/transport fixture và regression | NOT RUN; —; —; — |
| <a id="tc-w9-t03-c"></a>TC-W9-T03-C | P0 / Contract+API | Body byte chứa tiếng Việt/whitespace; old/new signing secrets | 1. Verify chữ ký raw body. 2. Sửa một byte. 3. Rotate trước/đúng/sau cửa sổ policy | Đúng body verify được, sửa byte fail; rotation theo version/window đã ghi; secret không log/API; consumer không parse rồi reserialize để verify | Chưa viết: webhook signature + rotation contract | NOT RUN; —; —; — |
| <a id="tc-w9-t03-d"></a>TC-W9-T03-D | P0 / API+DB+Contract | Receiver nhận rồi timeout; event ID cố định | 1. Deliver. 2. Retry/restart. 3. Consumer dedupe | Event ID giữ nguyên qua attempts; delivery mô tả at-least-once, consumer áp dụng business một lần; UI phân biệt delivery attempt và event | Chưa viết: webhook delivery identity/consumer example | NOT RUN; —; —; — |
| <a id="tc-w9-t03-e"></a>TC-W9-T03-E | P0 / API+DB | Queued event chứa canary khi creator còn quyền | 1. Revoke hoặc downgrade trước send. 2. Tick/retry thủ công | Revalidate quyền hiện tại, không gửi payload cũ ngoài quyền; suppressed có lý do, giữ lịch sử đúng ACL; retry không dùng quyền hệ thống để vượt | Chưa viết: webhook send-time authorization; liên kết TC-FND-053/070 | NOT RUN; —; —; — |
| <a id="tc-w9-t03-f"></a>TC-W9-T03-F | P1 / API+DB+Contract | Timeout/429/5xx/4xx; crash sau claim; manual retry có/không quyền | 1. Chạy từng lỗi qua lịch retry. 2. Restart/lease expire. 3. Manual retry | Backoff/Retry-After/terminal đúng policy, không vô hạn; lease phục hồi; manual retry có kiểm quyền/audit và event ID cũ; UI/history trung thực | Chưa viết webhook retries; liên kết TC-FND-067/069 | NOT RUN; —; —; — |

<a id="w9-t04"></a>
### W9-T04 — Hợp đồng và ví dụ

Nền tảng: OpenAPI + endpoint thật trên PostgreSQL thử + consumer mẫu trong process riêng; O/E token thử được che, receiver cô lập; T0. Requirement RQ-W9-T04-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w9-t04-a"></a>TC-W9-T04-A | P1 / Contract+API | Build server và OpenAPI cùng snapshot; example request từ docs | 1. Chạy từng ví dụ với IDs/token fixture. 2. Đối soát response/DB | Ví dụ chạy được không sửa tay semantics; đúng operation/revision/header; docs không dùng secret thật; business/side effects đúng loại request | Chưa viết: executable OpenAPI examples | NOT RUN; —; —; — |
| <a id="tc-w9-t04-b"></a>TC-W9-T04-B | P1 / Contract+API | Success/error/validation/ACL/conflict/pagination/rate-limit fixtures | 1. Gọi endpoint thật. 2. Validate request/response theo schema | Status/error/revision/pagination khớp schema; required/nullable/type đúng; không trường nhạy cảm không khai báo; UI client xử lý theo contract | Chưa viết: OpenAPI schema conformance | NOT RUN; —; —; — |
| <a id="tc-w9-t04-c"></a>TC-W9-T04-C | P0 / Contract+E2E | Consumer mẫu, đúng/sai signature, hai delivery cùng event ID | 1. Gửi đúng rồi duplicate. 2. Gửi body sửa/secret sai | Consumer verify raw bytes trước xử lý; sai signature bị chặn; duplicate không áp dụng nghiệp vụ lần hai; logs không chứa signing secret | Chưa viết: sample consumer integration | NOT RUN; —; —; — |
| <a id="tc-w9-t04-d"></a>TC-W9-T04-D | P1 / Contract | Snapshot OpenAPI baseline; bản thử cố ý bỏ field/đổi type/status | 1. Chạy contract checker với baseline hợp lệ. 2. Chạy mutations phá hợp đồng | Bản hợp lệ đạt; breaking changes bị phát hiện và làm check fail với vị trí rõ; không “pass” chỉ vì snapshot tự cập nhật | Chưa viết: contract compatibility negative fixture | NOT RUN; —; —; — |

<a id="w9-t05"></a>
### W9-T05 — Gate phát hành

Nền tảng: Web browser + Android thật + PostgreSQL đại diện + Google/OA thật và webhook receiver thử; O/E/G-E/G-V/N/B1/SA, toàn bộ fixture chung. Ghi build/commit/schema/runtime/device/provider/time của từng lượt; không gộp bằng chứng từ build không tương thích. Requirement RQ-W9-T05-A…D.

| ID | Ưu tiên / lớp | Tiền điều kiện | Bước thao tác | Kết quả mong đợi API / UI / dữ liệu / tác dụng phụ | Tái sử dụng / triển khai | Hồ sơ chạy |
|---|---|---|---|---|---|---|
| <a id="tc-w9-t05-a"></a>TC-W9-T05-A | P0 / E2E+Device | Các P0/P1 wave liên quan đã có hồ sơ; fixture sạch | 1. Chạy luồng private project→guest→import→offline→automation→Google/Zalo/API/webhook. 2. Revoke/downgrade. 3. Đối soát | Web/Android cùng trạng thái được phép; receipt/revision/event/recurrence/outbox/expense/projection khớp; không dữ liệu/tác dụng phụ ngoài quyền hoặc draft mất | Chưa viết E2E + Thủ công thiết bị/provider; liên kết TC-X08/09/10 | NOT RUN; —; —; — |
| <a id="tc-w9-t05-b"></a>TC-W9-T05-B | P0 / DB+E2E+Device | Snapshot đại diện gồm quyền/queue/pending/sent/unknown/receipt/token mã hóa | 1. Backup. 2. Migrate/restore môi trường mới. 3. Đối soát và replay có kiểm soát | ID/FK/count/quyền/queue/receipt giữ đúng; sender chưa tự bật; thiếu khóa báo rõ; không lặp nghiệp vụ hoặc gửi lại job đã biết sent | Cần mở rộng: `tests/operations.test.mjs`, `tests/backup-team-regression.test.mjs`, `tests/postgres-recovery.test.mjs`; liên kết TC-X11 | NOT RUN; —; —; — |
| <a id="tc-w9-t05-c"></a>TC-W9-T05-C | P0 / Review | Hồ sơ W2–W8, API/webhook, cross-cutting và danh mục requirement | 1. Đối chiếu từng P0/P1/task/gate với build/bằng chứng. 2. Kiểm tra provider/device thật | 100% requirement bắt buộc có bằng chứng phù hợp; không dùng pass count/coverage hoặc component thay E2E; thiếu/FAIL/BLOCKED/NOT RUN chặn gate liên quan | Thủ công review; kiểm tra liên kết catalog tự động có thể bổ trợ | NOT RUN; —; —; — |
| <a id="tc-w9-t05-d"></a>TC-W9-T05-D | P0 / Review+E2E | Một provider thiếu điều kiện hoặc gate thật BLOCKED; nội bộ có evidence PASS độc lập | 1. Thử quy trình quyết định release. 2. Inspect feature/sender trạng thái triển khai | Tích hợp chưa đủ điều kiện vẫn bị chặn phát hành/bật sender; nghiệm thu nội bộ độc lập đã đạt được ghi riêng; không đổi BLOCKED thành PASS vì mock đạt | Thủ công release review + kiểm tra cấu hình thực | NOT RUN; —; —; — |
