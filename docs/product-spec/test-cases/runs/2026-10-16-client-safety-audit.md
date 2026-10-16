# Audit bổ sung client mutation và ranh giới cạnh tranh — 16/10/2026

Lượt này bắt đầu sau snapshot đã đạt PostgreSQL 419/419, build `9p78H6S5kA_tmJEvvaVfK`. Kết quả snapshot đó được giữ nguyên; không dùng để chứng minh các sửa mới trong lượt này. Database dùng PostgreSQL thử riêng, không thay production. Không có kiểm provider hoặc thiết bị thật mới.

## Phạm vi audit

| Requirement | Phát hiện từ mã nguồn | Kiểm chứng cần hoàn tất |
|---|---|---|
| W1-T08, W1-T09; TC-X05 | Một số Web task create/copy/checklist/status/extras/board writers chưa gửi operation ID ổn định hoặc revision đã đọc. Backend chỉ có receipt/conflict khi client tham gia hợp đồng; hỗ trợ legacy không tự bảo vệ current Web writer | Component thật với phản hồi bị mất sau commit và retry; hai client cùng revision, giữ draft/bản thắng; sửa caller và hồi quy |
| W5-T02-F; W1-T04-F | Automation có thể chọn task ở project cũ trước khi khóa rồi đọc lại task đã move | Hai connection/process với barrier, đối soát scope sau lock và không có business/event/outbox ngoài quyền |
| W1-T01-B | Snapshot upgrade/index rollback hiện hữu chưa thay được lỗi giữa data backfill trên schema cũ thực | Tạo schema cũ, fault giữa data write, đối soát rollback rồi cạnh tranh startup/retry |

Các phần Web, template, automation và migration có kết quả theo phạm vi dưới đây. Full runner cho bản mã tích hợp đã đạt 5 stage, source không đổi; chưa nâng gate browser hoặc phát hành.

## W1-T08/T09, TC-X05 — mutation từ Web và template

**Web: 32/32 component PASS sau hợp nhất**, gồm 19 kiểm tra mutation và 13 kiểm tra denial hiện hữu: [log](../../../../artifacts/spec-all-2026-10-16/web-mutation-after-template-merge.log). Trước sửa, [5 ca component FAIL](../../../../artifacts/spec-all-2026-10-16/web-mutation-before.log) tái hiện duplicate quick-create/copy/checklist và thiếu revision ở labels/status. [Ca copy sau background refresh FAIL](../../../../artifacts/spec-all-2026-10-16/web-copy-background-before.log) tái hiện deadline nguồn đổi làm retry thành thao tác mới. Các lỗi này đã sửa; khai báo hook trùng do hợp nhất TaskTemplates đã được gỡ trước lượt 32/32 trên.

`useTaskMutation` giữ operation ID và toàn bộ payload đã gửi khi response mất hoặc 5xx; retry không lấy revision mới từ background refresh. Form giữ revision của draft, dữ liệu nhập và trạng thái conflict. Confirmed write rồi refresh lỗi vẫn là đã lưu; quick-add qua nửa đêm và copy có deadline nguồn đổi giữ payload ban đầu. Component thật được render với transport/receipt giả lập; **không phải browser, PostgreSQL hoặc ảnh UI**. Retry Web chỉ sống theo component/editor đang mở, không chứng minh lưu qua reload/đóng mở lại trang. Android offline có cơ chế lưu riêng và không bị sửa ở lượt này.

**Template backend: 18/18 PostgreSQL PASS**, gồm 6 ca mới và regression pipeline/task-extras: [log](../../../../artifacts/spec-all-2026-10-16/template-mutation-after.log), [snapshot](../../../../artifacts/spec-all-2026-10-16/template-mutation-after.json). [Hai ca trước sửa FAIL](../../../../artifacts/spec-all-2026-10-16/template-mutation-before.log) vì endpoint từ chối operationId/revision. `/task-templates/:id/create` và `/apply` nay dùng transaction/receipt/context chung; apply kiểm revision target, replay kiểm lại quyền template và task kết quả. Kiểm concurrent bằng hai process với advisory-lock barrier; cùng operation có một mutation/receipt, payload khác trả 409. Fault tại receipt rollback task/checklist/activity/event/outbox; retry không lộ kết quả task đã move private. Legacy HTTP 201 và Android actor/source được giữ. Source không đổi trong lượt này; kết quả bổ sung về checklist ở phần dưới.

## W0-T03-B, W1-T04-C/E — giữ quan hệ checklist khi copy/apply

[Bốn ca trước sửa FAIL](../../../../artifacts/spec-all-2026-10-16/template-checklist-integrity-before.log): copy task và apply template làm mất toàn bộ assignee checklist hợp lệ; template mới chèn ở đầu thay vì sau danh sách có sẵn; template chứa người mất quyền vẫn thành công nhưng âm thầm bỏ người nhận. Hai helper copy/insert trước đây không SELECT `project_id`, khiến kiểm quyền PostgreSQL luôn loại người được giao.

Đã đọc đầy đủ scope task ở helper, append từ `MAX(position)+1`, và kiểm người nhận template trước ghi. Người mất quyền dự án hoặc không thuộc task đích làm apply trả 409 để xử lý lại; không tạo task/checklist/activity/event/receipt/outbox hay tự cấp membership. [Hồi quy 22/22 PostgreSQL PASS](../../../../artifacts/spec-all-2026-10-16/template-checklist-integrity-after.log), [manifest](../../../../artifacts/spec-all-2026-10-16/template-checklist-integrity-after.json), source không đổi. Đối soát ID mới, thứ tự list/item, trạng thái, ngày/giờ, primary và secondary assignee; nguồn và checklist đích cũ giữ nguyên. [Lượt harness ban đầu](../../../../artifacts/spec-all-2026-10-16/template-checklist-integrity-after-initial.log) giữ 22/23 PASS: một ca SQLite legacy bị chạy nhầm qua PostgreSQL; runner sửa theo skip pattern của repo rồi mới chạy lại, không sửa expected nghiệp vụ để pass. Toàn SQLite legacy còn được chạy riêng ở full runner.

## W5-T02-F — automation sau khi task chuyển project

**Đã tái hiện và sửa.** Khi worker/API đã chọn task ở project A rồi chờ row lock, một HTTP move hợp lệ có thể chuyển task sang B. Chủ rule có quyền ở cả hai project nên ACL đơn thuần không ngăn rule A chạy trên task B. Cả typed event, scheduled và manual đều tái hiện đổi priority `medium` → `high` ngoài scope: [3 FAIL trước sửa](../../../../artifacts/spec-all-2026-10-16/automation-scope-race/before.log).

`server/automations.mjs` kiểm lại workspace/project ngay sau đọc task đã khóa, trước conditions/actions. Scope đổi đi qua đường failed-run hiện hữu, có lý do, không có receipt thành công. [Hồi quy cuối 26/26 PASS](../../../../artifacts/spec-all-2026-10-16/automation-scope-race/regression-final.log), [manifest](../../../../artifacts/spec-all-2026-10-16/automation-scope-race/manifest-final.json), source không đổi. Test dùng HTTP move và worker/API process độc lập; PostgreSQL lock barrier xác nhận đúng thời điểm chờ. Sau move chỉ revision của move được giữ; không thêm automation comment/activity/event/notification/outbox/delivery/receipt. Test hook chỉ nằm trong schema thử, không có endpoint fault production. Kết quả này chưa chứng minh UI hoặc toàn gate W5; source đã được kiểm lại trong full runner dưới đây.

## W1-T01-B — backfill dữ liệu thật

**PASS phạm vi PostgreSQL**, [hồi quy 16/16](../../../../artifacts/spec-all-2026-10-16/migration-backfill-faults-regression.log), [manifest nguồn](../../../../artifacts/spec-all-2026-10-16/migration-backfill-faults-manifest.json), `changedDuringRun: []`. Hai ca mới trong `tests/migration-backfill-faults.test.mjs` dựng schema2/schema5 bằng SQL migration gốc, không chỉ đổi version tag hoặc import snapshot. Fixture giữ task/checklist/comment/file thực, cột trùng tên, nhãn dùng chung, scope rỗng, recurrence/personal plan; schema5 có revision37, event và receipt cũ.

Fault xảy ra sau cập nhật project cho task ở migration003; sau clone nhãn và sau nối lại label links lúc trigger revision còn tắt ở migration006. Mỗi lỗi đối soát rollback toàn bộ rows/ledger/columns/indexes/constraints/functions/triggers và bytes file. Sau đó hai process/connection độc lập cùng chờ advisory-lock barrier; đúng một process áp dụng các migration còn thiếu. Đối soát cuối giữ identity/quan hệ/history/receipt/pending effects và chạy lại không thay dữ liệu. Không phát hiện bug production ở phạm vi này, không sửa migration cũ. Đây là bằng chứng DB, không phải ảnh UI hoặc nghiệm thu toàn W1.

## Browser và catalog

VC `tab_2` ở `/services` còn được status nhận diện; snapshot, mở lại tab và mở tab mới trả `PreviewAutomationTimeoutError`. [Lần thử](../../../../artifacts/spec-all-2026-10-16/browser/continuation-timeout-2026-10-16.json) không có ảnh hoặc submit mới. [Đối soát tiếp tục](../../../../artifacts/spec-all-2026-10-16/browser-run3/continuation-integrity.json) xác nhận kỳ dịch vụ/renewal/transactions/receipt/counts chưa thay đổi, 317 tệp nguồn khớp snapshot tại thời điểm trước sửa mới. HTTP login 200 chỉ chứng minh runtime sẵn sàng, không phải browser PASS.

Bốn catalog giữ nguyên ID/expected và trạng thái nghiệm thu toàn ca; đã bổ sung bảng đối chiếu suite hiện tại để phân biệt metadata baseline “Chưa viết” với test đã bổ sung. TC-X01/X02/X06/X07/X11/X12 đã cập nhật truy vết nội bộ, vẫn ghi rõ phần UI/provider/device chưa đủ.

[Lần yêu cầu tab mới tiếp theo](../../../../artifacts/spec-all-2026-10-16/browser/client-safety-open-timeout.json) cũng trả `PreviewAutomationTimeoutError`; status sau lỗi vẫn `available:true`, `tab_2`, `/services`, `visible:false`. Không tạo ảnh hoặc thay đổi nghiệp vụ. Runtime lúc thử vẫn là build trước các sửa client/template trong báo cáo này.

## Kết quả tích hợp cuối và bằng chứng browser

[Manifest](../../../../artifacts/spec-all-2026-10-16/client-safety-verification-manifest.json) ghi 5 stage exit 0 và `changedDuringRun: []`: Web component **32/32**, PostgreSQL **434/434**, **19** ca SQLite legacy có tên, build và Next HTTP **1/1**. Build `_nEQHTJmp3jJQpYGhLk5-`, Node 24.21.0, schema14; hoàn tất 17:31:22 UTC+7 ngày 16/10. [Log Web](../../../../artifacts/spec-all-2026-10-16/client-safety-web-components.log), [PostgreSQL](../../../../artifacts/spec-all-2026-10-16/client-safety-postgres.log), [legacy](../../../../artifacts/spec-all-2026-10-16/client-safety-legacy.log), [build](../../../../artifacts/spec-all-2026-10-16/client-safety-web-build.log), [HTTP](../../../../artifacts/spec-all-2026-10-16/client-safety-next-runtime.log). Tổng runner legacy 84 gồm file không có test khớp, không gọi là 84 ca legacy. Các suite nhỏ phía trên chồng lặp full runner, không cộng số đếm.

[Runtime mới](../../../../artifacts/spec-all-2026-10-16/browser-run4/manifest.json) dùng schema fixture cũ và sender tắt; `/login` HTTP200. [Mở tab mới và snapshot `tab_2`](../../../../artifacts/spec-all-2026-10-16/browser/client-safety-build-timeout.json) vẫn timeout; không có ảnh, submit gia hạn hoặc browser PASS mới. [Readback và source integrity](../../../../artifacts/spec-all-2026-10-16/browser-run4/integrity.json) giữ dữ liệu trước/sau và snapshot. 20 ảnh trước chỉ chứng minh build/phạm vi đã ghi, không chứng minh các sửa ở lượt này. [Mobile source unchanged](../../../../artifacts/spec-all-2026-10-16/mobile-client-safety-source-check.json) xác nhận 95 tệp vẫn khớp lượt mobile trước; provider/device thật tiếp tục nợ theo yêu cầu người dùng.
