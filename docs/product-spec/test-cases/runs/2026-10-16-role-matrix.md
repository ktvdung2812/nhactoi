# Ma trận vai trò qua HTTP — private project

Trạng thái: **PASS nội bộ**, thực thi sau khi phép đo tải X07 kết thúc. [Log 33/33 Node tests](../../../../artifacts/spec-all-2026-10-16/w3-role-matrix.log): 32 subtest (12 đọc, 12 mutation/trash, 7 thu hồi grant, 1 admin mất role) và test bao ngoài; không tính chúng thành 33 ca catalog riêng. Source [project-role-matrix.test.mjs](../../../../tests/project-role-matrix.test.mjs), [manifest snapshot](../../../../artifacts/spec-all-2026-10-16/w3-role-matrix-manifest.json). Node 24.21.0, PostgreSQL 17.2, schema 13, base commit `894f068ad4ad6288cbe467459fd4e0039c4764c9` và working tree đang tích hợp. Phạm vi TC-W1-T04-A/B/C/D, nhánh trash/file của E và TC-X02; chính sách từ [FR-PROJECT §3.3–3.4](../../03-functional-spec.md#33-vai-trò), D-05. Đây là PostgreSQL + API HTTP và tệp local thật trên máy kiểm thử, không là browser/device E2E.

Fixture: một private project Business, clock `2026-10-16T02:00:00Z`, task có checklist/comment/file và chín lượt giao, shared view, các task xóa mềm riêng để kiểm trash. 12 tài khoản gồm sáu role nội bộ, ba role guest, member không có grant, SaaS admin không có membership workspace đích và người ở workspace khác. Owner/admin không có project grant trực tiếp. Mọi workspace dùng Business để test report tenant isolation không bị che bởi lỗi entitlement. SaaS admin chỉ cấu hình thư mục storage thử qua API quản trị; không được thêm quyền nghiệp vụ trong fixture.

| Vai trò độc lập | Đọc task/file/view/report/export đã chia sẻ | Tạo/sửa task/checklist/link/file | Comment/ack lượt giao của mình | View chung/membership nội bộ | Xóa task/restore phần mình xóa |
|---|---|---|---|---|---|
| Owner | Có | Có | Có | Có | Có; trash toàn workspace |
| Admin workspace | Có | Có | Có | Có | Có; trash toàn workspace |
| Manager project | Có | Có | Có | Có | Có; chỉ trash mình xóa |
| Editor | Có | Có | Có | Không | Có; chỉ trash mình xóa |
| Commenter | Có | Không | Có | Không | Không |
| Viewer | Có, gồm tải byte tệp | Không | Không | Không | Không |
| Guest editor | Có | Có | Có | Không | Không |
| Guest commenter | Có | Không | Có | Không | Không |
| Guest viewer | Có, gồm tải byte tệp | Không | Không | Không | Không |
| Member không grant | Không | Không | Không | Không | Không |
| SaaS admin không membership | Không | Không | Không | Không | Không |
| Người workspace khác | Không | Không | Không | Không | Không |

Bước kiểm tra:

1. Dùng cookie riêng từng tài khoản đọc task, detail (checklist/comment/file), extras, collaboration, reminder, upload policy; project, fields, dependencies, shared views và dữ liệu view. Truy cập không được cấp trả 404, không chứa canary. Tải tệp có quyền trả đúng byte và `Cache-Control: private, no-store`; URL biết trước không vượt ACL.
2. Tìm task qua API phân trang; xem tổng dashboard vận hành, portfolio, SLA và CSV SLA. Chín người có quyền thấy cùng task; ba người không quyền thấy tập/tổng rỗng. JSON v1 board export chỉ gồm board mặc định theo hợp đồng cũ, không xuất private project kể cả cho owner; guest không được gọi endpoint này.
3. Thử tạo/sửa task, sửa checklist, comment, thêm link, upload byte, ack chính mình, tạo shared view và thay membership nội bộ. Đối chiếu từng cột quyền ở bảng. Mutation bị chặn chỉ chấp nhận lỗi phân quyền 403/404/409; lỗi validation 400 không được tính là bằng chứng ACL. Snapshot trước/sau đối soát 25 bảng nghiệp vụ, revision, cycle/event/activity, receipt, notification/outbox/queue và view/membership/trash không đổi.
4. Guest gọi CRM, dịch vụ, thu–chi, danh bạ, billing, automation và cấu hình Google/OA: 403. Task được đọc không cấp các quyền workspace này.
5. Tạo task probe, xóa và đọc/list/count/restore trash bằng từng vai trò. Owner/admin có quyền workspace; manager/editor chỉ thấy phần mình xóa. Vai trò khác không đọc chi tiết hoặc restore task probe.
6. Thu hồi từng grant trực tiếp qua API; lặp lại đọc/byte download/search/report/CSV, thử sửa có operation ID và đọc trash mình đã xóa. Không dùng quyền cũ. Hạ workspace admin thành member không có project grant cũng mất quyền private; owner vẫn đọc được.

Actual: toàn bộ expected phía trên đạt, không sửa production code trong lượt này. Lượt đầu dùng nhầm URL `/google-calendar` thay `/integrations/google-calendar` nên ba subtest guest dừng ở 404; [log harness sai đường dẫn](../../../../artifacts/spec-all-2026-10-16/w3-role-matrix-harness-path-error.log) được giữ riêng. Đã sửa đúng endpoint Google/OA và chạy lại toàn ma trận; không tính 404 từ endpoint không tồn tại là bằng chứng guest guard.

Chạy lại sau migration 014 và tối ưu truy vấn phân trang: cùng 33 test ma trận tiếp tục PASS ở schema 14 trong [lượt 58/58 gồm ACL/AI/filter/migration](../../../../artifacts/spec-all-2026-10-16/w3-paged-acl-regression.log), với [snapshot nguồn mới](../../../../artifacts/spec-all-2026-10-16/w3-paged-acl-manifest.json). Manifest schema 13 ban đầu được giữ nguyên làm bằng chứng lịch sử.

Giới hạn: ma trận này không kiểm mọi tổ hợp gói, team inheritance, AI provider, custom-field writes, move/copy/dependencies, in-flight upload/download revocation, notification transports/workers hoặc thao tác browser. Các nhánh đó dùng suite chuyên biệt; không suy toàn TC-W1-T04-C đã PASS từ ma trận endpoint chọn lọc. Offline hết quyền local và thiết bị/provider thật vẫn là nợ riêng đã được người dùng hoãn.
