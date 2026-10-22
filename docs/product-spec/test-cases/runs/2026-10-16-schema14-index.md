# Migration 014 — chỉ mục thứ tự task

**PASS nội bộ: 20/20** trên PostgreSQL 17.2, schema ứng dụng 14, Node 24.21.0. [Log](../../../../artifacts/spec-all-2026-10-16/w3-schema14-index-regression.log), [manifest nguồn/command](../../../../artifacts/spec-all-2026-10-16/w3-schema14-index-manifest.json), [test mới](../../../../tests/task-page-migration.test.mjs). Base commit `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree đang tích hợp. Không dùng database production; các schema do helper kiểm thử tạo/dọn riêng.

[Migration 014](../../../../server/migrations/postgres/014-task-page-order.sql) chỉ thêm B-tree index cho task đang hoạt động theo workspace, thứ tự trạng thái doing/todo/done, deadline tăng dần (null sau cùng), thời điểm tạo và ID giảm dần. Index khớp thứ tự API đang dùng, không thay ACL/filter hoặc thứ tự nghiệp vụ. Các cột include phục vụ project/team/status. Không thêm/bớt cột dữ liệu; snapshot 13 và 14 dùng cùng danh sách bảng/cột, nâng snapshot chỉ đổi phiên bản. Migrator hiện hữu giữ advisory lock và transaction cho cả DDL lẫn version ledger.

| Case / bước | Expected | Actual |
|---|---|---|
| TC-W1-T01-A/B; dựng schema 13 thật | Bỏ index 014 và bản ghi migration 14 trên schema riêng; max version 13, không có index | PASS; không chỉ đổi nhãn một snapshot schema 14 |
| TC-W1-T01-A; dữ liệu đại diện | Task, checklist/item, comment, attachment link, revision, receipt, event, pending notification/outbox giữ ID và giá trị | PASS; toàn bộ bảng snapshot trước/sau bằng nhau |
| TC-W1-T01-B; lỗi sau CREATE INDEX | Cả index và version 14 rollback; dữ liệu giữ nguyên để chạy lại | PASS; lỗi được chèn ở adapter test, không thêm endpoint production |
| TC-W1-T01-B; migrate hai lần | Một version 14, index hợp lệ/ready; lần hai không tạo lại index | PASS; OID/definition index và dòng ledger không đổi |
| TC-W1-T09-A; receipt cũ sau migrate | Retry operation/payload trả đúng response đã commit, không mutation/event/outbox mới | PASS; response và mọi bảng không đổi |
| TC-W0-T04-C/D; thứ tự/phân trang | doing trước todo trước done; deadline null cuối; created_at và ID phá hòa; bỏ task đã xóa/tenant khác | PASS; tập 7 task trên 4 trang giống expected trước và sau migration |
| TC-W1-T01-D; snapshot 13 | Restore vào schema 14 giữ mọi bảng/ID/quan hệ/receipt/pending history; artifact gốc không đổi | PASS; snapshot đích bằng kết quả upgrade và index vẫn hợp lệ |
| TC-W1-T01-D/F; validation và startup | Snapshot dư cột bị từ chối nguyên tử; future schema bị chặn; hai process startup không nhân migration/admin | PASS qua test mới và PostgreSQL/snapshot suite hiện hữu |

Lệnh gồm `task-page-migration`, `postgresql`, `snapshot-compatibility`, `task-filters`, `project-access-routes`; chạy tuần tự và loại test có nhãn SQLite legacy theo hợp đồng repo. SQLite→PostgreSQL/WAL trong suite PostgreSQL vẫn được chạy như test import thực, không dùng SQLite thay database cạnh tranh.

Đây là bằng chứng migration, tính đúng dữ liệu và API. Không thay kết quả tải X07: các lượt schema 13 trước đó vẫn được giữ với trạng thái ngân sách thất bại; lượt tải schema 14 được điều phối riêng sau khi suite này hoàn tất. Browser, Android và provider thật không nằm trong lượt này.

Kiểm tra tiếp sau tối ưu truy vấn project ACL: [58/58 regression PASS](../../../../artifacts/spec-all-2026-10-16/w3-paged-acl-regression.log) ở schema 14, [manifest riêng](../../../../artifacts/spec-all-2026-10-16/w3-paged-acl-manifest.json). Bao gồm migration 1, task filters 3, project-access 11, AI 10 và role matrix 33 (có test bao ngoài); số lượng trùng với các suite trước, không cộng thành coverage hoặc 58 task đã nghiệm thu. Truy vấn phân trang tính tập project đọc được bằng cùng `taskAccessSql` trong từng statement, có workspace binding và trạng thái user/workspace hiện tại; không cache quyền giữa request. Bộ lọc team đã archive giữ nghĩa cũ; tìm kiếm vẫn join team để tìm tên tiếng Việt. Test mới đối chiếu độc lập API legacy/phân trang, direct project grant khi không nằm trong roster, tìm kiếm chỉ khớp tên team, revoke/regrant và archive/unarchive. Toàn bộ thứ tự, tổng và private canary đúng expected. Không phát hiện lỗi cần sửa production trong lượt review; phép đo tải tiếp theo vẫn được điều phối riêng.
