# Audit nghiệm thu — saved view cá nhân và người được giao sau import

Ngày chạy: 16/10/2026. HEAD nền `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree có thay đổi chưa commit. Node `v24.21.0`, PostgreSQL riêng tại `127.0.0.1:55882`, schema ứng dụng **14**. Mỗi fixture dùng schema ngẫu nhiên riêng qua `tests/database-helpers.mjs` và cleanup sau chạy; không dùng SQLite hoặc database production. Đồng hồ fixture cố định `2026-10-16T02:00:00Z` (09:00 UTC+7), sender/provider thật không được gọi.

## Kết quả thực

| Lượt | Kết quả | Bằng chứng |
|---|---|---|
| Trước sửa | **FAIL: 2 pass / 9 fail** trong 11 test/subtest. Manager/admin/workspace owner đọc được canary qua PATCH view; CSV/Trello có 1 hoặc 3 người được giao đều lỗi 400 khi lưu extras. | [Log trước sửa](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-before.log), [snapshot nguồn](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-before-manifest.json) |
| Hai regression sau sửa | **11/11 PASS** gồm 9 kịch bản và 2 container của Node test runner. Không phải 11 requirement độc lập. | [Log sau sửa](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-after.log), [snapshot nguồn](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-after-manifest.json) |
| Hồi quy 4 suite | **52/52 PASS** — `project-advanced`, `project-imports`, `public-api`, `task-extras`. Bao gồm ca mới và các ca hiện hữu, không cộng 11 vào 52. | [Log hồi quy](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-regression.log), [snapshot nguồn](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-regression-manifest.json) |
| Reproduction nhánh template | **11/12 PASS, 1 FAIL**: mapping primary sang một collaborator hợp lệ làm PUT extras trả 400. | [Log template trước sửa](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-template-before.log), [snapshot nguồn](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-template-before-manifest.json) |
| Sau sửa nhánh template | **12/12 PASS** gồm 3 test cha và 9 subtest; không cộng với các lượt trước. | [Log template sau sửa](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-template-after.log), [snapshot nguồn](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-template-after-manifest.json) |
| Hồi quy cuối sau sửa template | **53/53 PASS** trên cùng 4 suite, bao gồm regression template. `changedDuringRun: []`. | [Log cuối](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-regression-with-template.log), [snapshot nguồn cuối](../../../../artifacts/spec-all-2026-10-16/acceptance-audit-regression-with-template-manifest.json) |

Ba manifest đầu và reproduction template ghi `changedDuringRun: []`; giữ nguyên failure trước sửa để đối chiếu. Lượt focused sau sửa template ghi hai file `server/index.mjs` và `server/operations-dashboard.mjs` thay đổi trong lúc agent khác tối ưu hiệu năng; các file thuộc audit không đổi. Không dùng lượt này để khẳng định toàn working tree đã cố định. Các log fault injection trong suite hồi quy là lỗi giả lập dự kiến, assertion rollback tương ứng đã đạt. [Runner của lượt kiểm tra](../../../../tmp/run-acceptance-audit-tests.mjs) đọc URL database từ cấu hình riêng, không in credentials.

## P0 — Quyền saved view cá nhân

Liên quan **W3-T02 / TC-W3-T02-C**, **TC-X02**. Trước sửa, GET list/task view đã lọc owner nhưng PATCH/DELETE cho phép mọi người quản lý dự án. Khi biết ID, manager/admin/owner workspace có thể PATCH `{}` để đọc tên/cấu hình của personal view người khác; cùng nhánh còn cho đổi thành view chung hoặc xóa.

[API project](../../../../server/project-advanced.mjs) nay áp cùng điều kiện `(visibility='project' OR owner_id=currentUser)` cho đọc hàng cần PATCH/DELETE. DELETE dùng transaction và khóa hàng, tránh việc view đổi từ chung sang cá nhân giữa lúc kiểm quyền và xóa. Quyền quản lý project không cấp quyền tới view cá nhân của người khác.

[Test PostgreSQL](../../../../tests/project-advanced.test.mjs) tạo personal view có canary bằng editor, rồi kiểm viewer/editor/manager/admin/workspace owner khác chủ view:

- GET danh sách không lộ tên; GET task theo view ID trả 404.
- PATCH rỗng, sửa name/config, đổi visibility thành project và DELETE đều trả 404, không lộ canary.
- Snapshot 12 bảng — view, task, assignment, event, receipt, notification/outbox và các queue provider — giữ nguyên sau từng mutation bị từ chối.
- Chủ personal view vẫn đọc/sửa/xóa được; manager có thể publish view của chính mình và sửa/xóa view chung do người khác tạo.

**PASS phạm vi API/DB của quyền view cá nhân và các đối chứng trên.** Chưa ghi browser/Android PASS hoặc toàn bộ TC-X02 từ suite này.

## P1 — Primary assignee bị lặp trong collaborators sau CSV/Trello

Liên quan **W6-T02-A / W6-T05-D**, **W0-T03-A**, **W9-T02-A**. Import trước sửa lưu người đầu vào `tasks.assignee_id` rồi lưu toàn bộ danh sách, kể cả người đầu, vào `task_assignees`. API extras yêu cầu collaborators không chứa primary. Vì vậy GET extras rồi PUT nguyên danh sách để đổi nhãn trả 400; Web picker còn ẩn primary nên người dùng khó sửa danh sách này. Public labels dùng cùng pipeline cũng bị ảnh hưởng.

[Importer](../../../../server/imports.mjs) nay giữ primary ở task và chỉ lưu các người còn lại vào collaborators theo thứ tự. Không thay schema hoặc chỉnh dữ liệu production; importer W6 là phần mới chưa phát hành trong working tree này. Dữ liệu fixture/artifact được tạo bằng phiên bản lỗi trước không được mô tả là đã migrate hoặc tự sửa.

[Test PostgreSQL](../../../../tests/project-imports.test.mjs) chạy bốn fixture: CSV/Trello × 1/3 assignee. Mỗi fixture thực hiện preview/commit → mọi người ack → GET/PUT extras để thêm nhãn → public API bỏ nhãn → retry cùng operation. Kết quả:

- Primary giữ nguyên; extras chỉ gồm collaborators đúng thứ tự khi import và lưu Web, không trùng primary.
- Web extras và public labels thành công, đọc lại nhãn đúng.
- Assignment cycles và ack không thay đổi khi sửa nhãn; retry chỉ có một receipt của operation public API.

**PASS phạm vi API/DB của import và round-trip trên.** Không thay nghiệm thu toàn bộ import, browser, Android hay gate phát hành; ảnh thao tác UI cho hai lỗi này vẫn chưa chạy trong lượt audit.

## P1 — Mapping assignee khi tạo project từ template

Liên quan **W3-T05-A/C**. Dù task nguồn có primary/collaborators phân biệt, hai ID nguồn hợp lệ có thể map vào cùng một người đích. Vòng apply template trước sửa loại trùng giữa collaborators nhưng không loại người đã được map thành primary, dẫn tới cùng lỗi 400 khi lưu extras.

[Template API](../../../../server/project-advanced.mjs) nay loại mapped primary khỏi danh sách collaborators, dedupe các đích còn lại và ghi vị trí theo thứ tự nguồn. Payload template đọc collaborators với thứ tự xác định theo position. Regression tạo task có primary và ba collaborators, map primary thành collaborator đầu rồi apply vào project workspace; kiểm fresh rows giữ primary đúng, chỉ còn hai collaborators theo thứ tự/vị trí 0–1, PUT extras thành công và retry apply trả cùng project/một task.

Đã đọc tất cả nơi INSERT `task_assignees`: task template/copy và recurrence hiện hữu đã loại primary; hai nhánh mới import/project-template được sửa tại writer. Không thêm migration cho dữ liệu production giả định của feature chưa phát hành, không sửa dữ liệu người dùng hoặc fixture cũ. **PASS phạm vi API/DB của mapping và retry trên; chưa có ảnh browser/Android cho ca này.**
