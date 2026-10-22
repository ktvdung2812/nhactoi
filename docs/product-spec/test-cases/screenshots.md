# Ma trận ảnh xác minh 58 task

Ảnh phải đúng build/snapshot và ca đã chạy. Lượt VC integrated preview lúc **08:24 ngày 16/10/2026 (UTC+7)** đã chụp dashboard với **5 task / 6 lượt giao / 2 quá hạn / 2 chưa xác nhận / 1 hoãn**. Chỉ phần quan sát fixture Web của **TC-W2-T01-A** được ghi PASS; chưa nghiệm thu toàn W2-T01, W2 hoặc 58 task.

Trên build production `UrOs5-ByXy9LJn4yiJXMP`, đã thao tác checklist bằng VC: tạo checklist, thêm mục, đánh dấu hoàn thành rồi tải lại URL; ảnh dưới fold giữ **1/1, 100%** và DOM có đúng một khu vực checklist/một form thêm. **TC-W0-T03-D PASS trong phạm vi luồng Web này**; TC-X05, các biến thể còn lại và Android vẫn chưa nghiệm thu đầy đủ. Các ảnh lỗi/style hoặc chỉ kiểm DOM trước đó được giữ nguyên theo lượt lịch sử.

Nguồn từng ảnh, SHA256, thời điểm và phạm vi: [screenshots.json](../../../artifacts/spec-all-2026-10-16/browser/screenshots.json). [Runtime2 trước schema 14](../../../artifacts/spec-all-2026-10-16/browser-run2/runtime-before-schema14.json) ghi Next development, database/schema thử riêng, sender tắt và source snapshot; working tree đang tích hợp, chưa phải bằng chứng build phát hành. Hai kết quả development có [dashboard JSON](../../../artifacts/spec-all-2026-10-16/browser/run2-dashboard-canonical.json) và [task detail JSON](../../../artifacts/spec-all-2026-10-16/browser/run2-task-detail-retest.json).

| Lượt ảnh | Actual / phạm vi bằng chứng |
|---|---|
| [Login ban đầu](../../../artifacts/spec-all-2026-10-16/browser/screenshots/login.png) | Màn hình đăng nhập; chưa chạy các biến thể session. PARTIAL TC-X01. |
| [Dashboard loading ban đầu](../../../artifacts/spec-all-2026-10-16/browser/screenshots/dashboard-loading.png) | Sau đăng nhập còn đang tải; không chứng minh fixture. PARTIAL. |
| [Login runtime2](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-login.png) | Đã tiếp tục đăng nhập bằng UI; chưa đủ toàn TC-X01. |
| [Dashboard runtime2 trước chỉnh fixture](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-dashboard-loaded.png) | 5/6/2/2/0 do snooze fixture đã hết hạn. Giữ kết quả chưa đạt fixture chuẩn; không thay bằng ảnh mới. |
| [Task detail trước reload](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-task-detail-before-reload.png) | Style chưa hoàn chỉnh trong lượt development/HMR. Không phải visual PASS; giữ ảnh lỗi để đối chiếu. |
| [Dashboard fixture chuẩn](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-dashboard-canonical.png) | **PASS — chỉ fixture Web TC-W2-T01-A**, 5/6/2/2/1, consoleEntries rỗng. Badge “Công việc” ở sidebar là 6 = 5 task + 1 lịch gia hạn trên bảng chung, đã [đối soát HTTP](../../../artifacts/spec-all-2026-10-16/browser-run2/unified-count-check.json). Không mở rộng PASS sang toàn màn hình hoặc mọi filter. |
| [Task detail kiểm tra lại](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-task-detail-retest.png) | Phần đầu detail có style đúng, không có duplicate-key warning trong snapshot. Checklist chỉ được kiểm tra DOM, chưa chụp phần dưới. PARTIAL. |
| [Production — dự án](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-projects.png) | Mở trực tiếp trang dự án; form/picker/quyền owner/admin hiện rõ. PARTIAL W1-T06. |
| [Production — tạo private project](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-private-project-created.png) | Tạo dự án riêng tư qua UI, giữ tên tiếng Việt. Không phải bằng chứng backfill. PARTIAL W1-T03/W1-T06. |
| [Production — thêm editor](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-project-member-added.png) | Chọn Nguyễn Minh và thêm vào dự án; danh sách hiện Chỉnh sửa. PARTIAL W1-T06. |
| [Production — đổi viewer](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-project-member-viewer.png) | Đổi thành Chỉ xem; [HTTP readback](../../../artifacts/spec-all-2026-10-16/browser-run2/ui-project-readback.json) xác nhận project private và role viewer. Select dùng DOM change, chưa chứng minh bàn phím/refresh trên tài khoản bị đổi quyền/Android. PARTIAL W1-T06. |
| [Production — checklist sau reload](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-checklist-roundtrip.png) | **PASS luồng Web TC-W0-T03-D**: tạo → thêm mục → complete → reload, vẫn 1/1 và 100%; một khu vực checklist, console rỗng. TC-X05/Android vẫn PARTIAL. |
| [Production — chạy automation manual](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-automation-manual.png) | Tạo rule manual ưu tiên Cao, chọn task và Chạy 1 bước; nhật ký Hoàn thành. PARTIAL W0-T03-C/W5-T02-B; typed/scheduled/role/fault chưa chạy bằng browser. |
| [Production — kết quả automation](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-automation-task-result.png) | Mở lại task thấy ưu tiên Cao/high, console rỗng; đối soát kết quả lượt manual ở ảnh trên. PARTIAL W5-T02-B. |
| [Production — Google readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-google-readiness.png) | Hiển thị chưa cấu hình và consent Calendar riêng với Google login. PARTIAL W0-T05-A/W7-T01-A; chưa kết nối provider, gate thật BLOCKED. |
| [Production — OA readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-zalo-readiness.png) | Form trống và điều kiện OA thuộc doanh nghiệp/được ủy quyền. PARTIAL W0-T06-A/W8-T01-B; không credential/send, gate thật BLOCKED. |
| [Production — API/webhook settings](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-public-api-settings.png) | Form scope/subscription hiện rõ. Chưa cấp token hoặc tạo webhook; PARTIAL W9-T01-A/W9-T03-A. |
| [Production — mẫu công việc trống](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-templates-empty.png) | PARTIAL W0-T03-C: ảnh trang Mẫu công việc, ba bộ đếm 0, Chưa có mẫu và Tạo mẫu. Metadata phục hồi từ ảnh gốc; không có DOM/console để xác nhận tạo mẫu, navigation hoặc quyền API. |
| [Build trước audit client — danh sách dịch vụ](../../../artifacts/spec-all-2026-10-16/browser/screenshots/final-services-list.png) | PARTIAL phía Web của W2-T04-A/TC-X05: tab mới `tab_2` tải danh sách có một dịch vụ thử còn hạn, 100.000đ/tháng, hạn 31/10/2026, nhắc 09:00; console rỗng. Chưa kiểm Android hoặc toàn flow gia hạn. |
| [Build trước audit client — form gia hạn mặc định](../../../artifacts/spec-all-2026-10-16/browser/screenshots/final-renewal-default-form.png) | PARTIAL W2-T03-A/F: ngày kế tiếp để tự tính, chi phí 100.000đ; Ghi khoản chi và Tạo việc cho kỳ mới đều bỏ chọn. UI nói rõ không chuyển tiền/không coi đã thanh toán; ảnh này chưa submit hoặc chứng minh kết quả DB. |

[Log các lần truy cập trước](../../../artifacts/spec-all-2026-10-16/browser/attempts.json) và [lần thử lại tab mới](../../../artifacts/spec-all-2026-10-16/browser/new-tab-retry-2026-10-16.json) giữ các timeout. Tab `tab_l` đã được tạo nhưng lần thử được ghi ở đó vẫn URL null, chưa có ảnh ứng dụng; [lượt agent mở tab riêng](../../../artifacts/spec-all-2026-10-16/browser/extra-ui-screenshots.json) cũng timeout và không thêm ảnh. Sau đó **tab_f phục hồi**, chụp được mười một ảnh production ở bảng trên. Không dùng HTTP 200 làm bằng chứng browser và không mô tả ảnh từ `tab_f` là ảnh từ tab mới. [Lượt tiếp tục sau đó](../../../artifacts/spec-all-2026-10-16/browser/new-tab-resumed-2026-10-16.json) đã mở được tab mới `tab_2`, ban đầu hiển thị offline vì runtime dừng. Sau khi khởi động lại cùng build production, thao tác navigate/snapshot/retry vẫn timeout; chưa lưu ảnh mới hoặc thêm browser PASS từ lượt này. Lượt tiếp tục trên [runtime trước audit client](../../../artifacts/spec-all-2026-10-16/browser-run3/manifest.json) đã phục hồi `tab_2` và có ảnh dịch vụ/form gia hạn ở bảng trên; timeout lịch sử không được dùng mô tả lần truy cập thành công mới.

Manifest hiện ghi **20 ảnh: 7 development lịch sử và 13 production** (11 trước audit, 2 trước audit client). Lượt production dùng [manifest runtime](../../../artifacts/spec-all-2026-10-16/browser-run2/production-manifest.json) cùng [snapshot nguồn production](../../../artifacts/spec-all-2026-10-16/browser-run2/production-source-snapshot.json); manifest đã sửa nhãn runtime/snapshot kế thừa development và giữ giá trị cũ cùng lý do trong `metadataCorrection`. Không suy ảnh lịch sử đã chạy lại trên build mới. Mười một ảnh production thuộc build **trước audit saved view/import/template**; hai ảnh mới có [snapshot trước audit client](../../../artifacts/spec-all-2026-10-16/browser-run3/source-snapshot.json). Chưa chụp lại các bản sửa saved view/import/template, không dùng ảnh cũ hoặc ảnh màn hình khác để xác nhận chúng. Ma trận hiện có ảnh liên quan cho **13/58 task**; ảnh liên quan không có nghĩa hoàn thành mọi ca của task. Chưa đủ ảnh/thao tác cho toàn bộ 58 task. Trạng thái dưới đây chỉ nói về **bằng chứng ảnh**, không phủ định kết quả API/DB/component tại [sổ nghiệm thu](runs/2026-10-16-acceptance-ledger.md). Ca review tài liệu/DB có artifact phù hợp trong sổ; chưa tạo ảnh nghiệp vụ thay thế cho review.

[Lần tiếp tục trước audit client](../../../artifacts/spec-all-2026-10-16/browser/continuation-timeout-2026-10-16.json) gặp `PreviewAutomationTimeoutError` ở hai snapshot, mở lại tab và mở tab mới; status vẫn báo `tab_2` tại `/services`, `available:true`, `loading:false`. Không có ảnh hoặc mutation mới; form gia hạn **chưa submit**. [Baseline DB trước submit](../../../artifacts/spec-all-2026-10-16/browser-run3/renewal-default-before.json) có 0 renewal và `actual_paid:null`, chỉ làm mốc đối soát, chưa chứng minh kết quả gia hạn. [Lượt planner bằng tab riêng](../../../artifacts/spec-all-2026-10-16/browser/planner-screenshots.json) cũng timeout, `screenshots:[]`; chưa chạy UI Inbox/Today/Upcoming/Week hoặc lịch làm/capacity/portfolio/SLA. Đây là các lần automation bị chặn, không kết luận toàn ứng dụng hoặc VC không hoạt động; 20 ảnh trước giữ nguyên phạm vi bằng chứng.

**Build hiện tại `_nEQHTJmp3jJQpYGhLk5-` chưa có ảnh.** [Runtime4](../../../artifacts/spec-all-2026-10-16/browser-run4/manifest.json) đã khởi động sau full runner 434/434; [mở tab mới và snapshot](../../../artifacts/spec-all-2026-10-16/browser/client-safety-build-timeout.json) đều timeout. [Đối soát readback/nguồn](../../../artifacts/spec-all-2026-10-16/browser-run4/integrity.json) không có thay đổi nghiệp vụ; form gia hạn chưa submit. 20 ảnh lịch sử không được dùng xác nhận retry/revision Web, template/checklist hoặc scope automation vừa sửa. Browser proof tiếp tục BLOCKED tại thao tác chụp; không suy toàn VC/ứng dụng không khả dụng.

| Task | Phạm vi | Ảnh | Trạng thái bằng chứng ảnh |
|---|---|---|---|
| W0-T01 | Hoàn thiện bộ spec và truy vết | Chưa có | Review spec/ma trận tại sổ nghiệm thu; chưa có ảnh review |
| W0-T02 | Ghi nhận baseline và môi trường kiểm thử | Chưa có | Manifest môi trường/log tại sổ nghiệm thu; chưa có ảnh review |
| W0-T03 | Hoàn thiện lối truy cập các chức năng hiện hữu | [Checklist sau reload](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-checklist-roundtrip.png), [automation](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-automation-manual.png) | PASS luồng Web TC-W0-T03-D; C mới PARTIAL. Toàn A–E/Android chưa đủ |
| W0-T04 | Sửa các sai lệch nghiệp vụ và hiển thị | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W0-T05 | Readiness Google Calendar | [Google readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-google-readiness.png) | PARTIAL UI; cấu hình/account/quota và gate Google thật BLOCKED |
| W0-T06 | Readiness Zalo OA và template | [OA readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-zalo-readiness.png) | PARTIAL UI; OA/template/người nhận thật và gate OA BLOCKED |
| W1-T01 | Migration, backup và restore phiên bản mới | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T02 | Entitlement bằng mã và thực thi tại backend | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T03 | Project, một board và backfill quan hệ | [Tạo private project](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-private-project-created.png) | PARTIAL thao tác Web; ảnh này không chứng minh backfill |
| W1-T04 | Project ACL xuyên toàn hệ thống | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T05 | Guest, lời mời, ghế và downgrade nguyên tử | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T06 | UI project, vai trò và thành viên Web/Android | [Thêm editor](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-project-member-added.png), [đổi viewer](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-project-member-viewer.png) | PARTIAL: private project/member/role đã lưu; chưa đủ mọi role, tài khoản bị đổi quyền, picker ACL và Android |
| W1-T07 | Sự kiện nghiệp vụ có cấu trúc | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T08 | Revision tổng hợp task và kế hoạch cá nhân | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T09 | Mutation receipt và idempotency | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T10 | Durable outbox, retry và revalidation | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W1-T11 | Gate tích hợp nền tảng | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W2-T01 | Dashboard vận hành phân trang | [Dashboard fixture chuẩn](../../../artifacts/spec-all-2026-10-16/browser/screenshots/run2-dashboard-canonical.png) | PASS chỉ phần quan sát fixture Web TC-W2-T01-A: 5/6/2/2/1. Toàn task PARTIAL; B–E và đối soát đa thiết bị chưa đủ |
| W2-T02 | Giờ và chính sách nhắc gia hạn | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W2-T03 | Gia hạn, task và khoản chi tùy chọn | [Form gia hạn mặc định](../../../artifacts/spec-all-2026-10-16/browser/screenshots/final-renewal-default-form.png) | PARTIAL A/F: form bỏ chọn ghi chi/tạo task; ảnh này chưa submit hoặc đối soát DB |
| W2-T04 | Android: dịch vụ, chăm sóc và gia hạn | [Danh sách dịch vụ Web](../../../artifacts/spec-all-2026-10-16/browser/screenshots/final-services-list.png) | PARTIAL dữ liệu đọc phía Web; Android thật BLOCKED/NOT RUN theo nợ được chấp nhận |
| W2-T05 | Gate SME end-to-end | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T01 | Custom fields có kiểu | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T02 | Views nhất quán và saved views | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T03 | Dependency finish-to-start trong project | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T04 | Timeline và ngày chung của task | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T05 | Project templates và ngày tương đối | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W3-T06 | Gate dự án nâng cao | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W4-T01 | Inbox, Today, Upcoming và Week | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W4-T02 | SQLCipher cho draft và outbox Android | Chưa có | BLOCKED/NOT RUN — thiết bị Android thật được hoãn |
| W4-T03 | Queue replay, pending overlay và temp IDs | Chưa có | BLOCKED/NOT RUN — thiết bị Android thật được hoãn |
| W4-T04 | Conflict, TTL, quyền và logout | Chưa có | BLOCKED/NOT RUN — thiết bị Android thật được hoãn |
| W4-T05 | Gate Android thật và lỗi mạng/vòng đời | Chưa có | BLOCKED/NOT RUN — thiết bị Android thật được hoãn |
| W5-T01 | Lịch làm việc, ngày nghỉ và delegate | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W5-T02 | Automation nâng cao có sự kiện và lịch | [Rule manual](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-automation-manual.png), [task high](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-automation-task-result.png) | PARTIAL: tạo/chạy manual và kết quả; typed/scheduled/role/fault chưa đủ UI |
| W5-T03 | Manual time và timer | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W5-T04 | Estimate từng assignee, capacity và portfolio | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W5-T05 | SLA từ lịch sử có cấu trúc | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W5-T06 | Gate automation và báo cáo | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W6-T01 | CSV parser và mapping | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W6-T02 | Import Trello có source identity | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W6-T03 | Preview và commit nguyên tử/idempotent | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W6-T04 | Giao diện import Web/Android | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W6-T05 | Gate import và an toàn dữ liệu | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W7-T01 | Consent, lịch riêng và token | [Google readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-google-readiness.png) | PARTIAL trang chưa cấu hình; consent thật chưa chạy |
| W7-T02 | Outbound projections và identity | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W7-T03 | Inbound, watch, incremental sync và conflict | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W7-T04 | Conflict UI, xóa/unlink và thu hồi quyền | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W7-T05 | Gate tài khoản Google thật | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W8-T01 | OA theo workspace và registry | [OA readiness](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-zalo-readiness.png) | PARTIAL form trống; chưa chứng minh ownership/token/quyền provider thật |
| W8-T02 | Mục đích và preview template | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W8-T03 | Delivery, callback và đối soát timeout | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W8-T04 | Gate OA thật và lịch sử đa kênh | Chưa có | BLOCKED — provider thật được hoãn; UI còn thiếu ảnh |
| W9-T01 | API token có scope và thu hồi | [API settings](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-public-api-settings.png) | PARTIAL trang cấu hình; chưa cấp/revoke token bằng UI |
| W9-T02 | API v1 dùng cùng nghiệp vụ | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W9-T03 | Webhook có chữ ký và chống SSRF | [Webhook settings](../../../artifacts/spec-all-2026-10-16/browser/screenshots/production-public-api-settings.png) | PARTIAL trang cấu hình; chưa subscription/delivery bằng UI |
| W9-T04 | OpenAPI, ví dụ consumer và contract tests | Chưa có | NOT RUN — chưa có ảnh/thao tác |
| W9-T05 | Gate phát hành toàn hệ thống | Chưa có | NOT RUN — chưa có ảnh/thao tác |
