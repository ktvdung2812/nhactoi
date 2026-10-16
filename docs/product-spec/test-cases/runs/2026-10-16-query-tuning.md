# Đối soát truy vấn phân trang và dashboard — 2026-10-16

**Hồi quy 77/77 PostgreSQL và ngân sách API tham chiếu TC-X07 đã PASS.** Lượt tải thứ bảy đo đủ 300 giây sau warm-up 60 giây, 10 process client, 50 người/50.000 task/100.000 lượt giao/250.000 event: **5.187 request, 0 lỗi**. Tất cả p95 đọc ≤ 884,61 ms và ghi 780,90 ms, trong ngưỡng giữ nguyên đọc ≤ 1 giây/ghi ≤ 2 giây. Kết quả này chưa nghiệm thu toàn TC-X07: browser memory/render, thiết bị và provider cần bằng chứng riêng.

Thay đổi giữ lại:

- Hai đường danh sách task PostgreSQL, có và không phân trang, dùng `COLLATE "C"` cho **ID phá hòa cuối cùng**. Thứ tự trạng thái, deadline và thời điểm tạo không đổi. ID là định danh opaque; byte order giúp thứ tự ổn định giữa các locale. Các ID tùy chỉnh từ dữ liệu cũ có thể đổi vị trí tương đối khi cả ba trường trước đó bằng nhau. Không thay đổi ID hay dữ liệu; regression mới kiểm tra chữ hoa/thường, dấu câu, ký tự tiếng Việt và đối soát tất cả trang với danh sách đầy đủ.
- Operations dashboard chỉ mang ID, assignee, trạng thái và hạn qua các bước tổng hợp; title, priority, project và team được đọc sau khi chọn trang. Predicate ACL, bộ lọc, cách đếm task/lượt giao và thứ tự trang không đổi.

Không thêm migration, cache quyền giữa request, cấu hình planner hoặc ngân sách hiệu năng mới. SQLite giữ thứ tự hiện có.

## Bằng chứng

| Kiểm tra | Kết quả và phạm vi |
|---|---|
| Migration, task filters, project ACL, AI, 12 vai trò, operations dashboard, work automation | [77/77 PASS](../../../../artifacts/spec-all-2026-10-16/x07-final-query-regression.log); [manifest và source hashes](../../../../artifacts/spec-all-2026-10-16/x07-final-query-manifest.json). Số test bao gồm container/subtest, không phải số requirement. |
| Query diagnostic 50.000 task, owner/guest/outsider | [ID-only collation](../../../../artifacts/spec-all-2026-10-16/x07-task-collation-plan.json): trang owner 250 khoảng 99,5→86,9 ms; trang 500 khoảng 106,5→84,0 ms. Dữ liệu và thứ tự fixture giống nhau. Đây là từng lượt EXPLAIN, không phải p95 tải đồng thời. |
| Query diagnostic Operations: 50 người, 50.000 task, 100.000 lượt giao | [Narrow projection](../../../../artifacts/spec-all-2026-10-16/x07-operations-page-only-plan.json): năm mẫu trước khoảng 109–119 ms, sau khoảng 93–100 ms; tổng và trang giống nhau. Không thay thế tải đầy đủ. |
| Tham chiếu trước thay đổi | [Sixth awake](../../../../artifacts/spec-all-2026-10-16/x07-full-load-sixth-awake.json): FAIL ngân sách đọc; không có sự cố ngủ máy hoặc request lỗi. |
| Tải đầy đủ sau thay đổi | [Lượt 7](../../../../artifacts/spec-all-2026-10-16/x07-full-load-seventh-byte-order.json), [log](../../../../artifacts/spec-all-2026-10-16/x07-full-load-seventh-byte-order.log), [manifest](../../../../artifacts/spec-all-2026-10-16/x07-full-load-seventh-byte-order-manifest.json): **PASS ngân sách API**, đủ measurement, exit 0, `changedDuringRun: []`. p95 trang đầu 269,84 ms; trang 250/500 là 842,28/884,61 ms; dashboard 812,56 ms; operations 846,26 ms; guest/tenant ngoài 863,72/853,48 ms; ghi 780,90 ms. |
| Hồi quy toàn repo sau thay đổi | [Manifest bốn stage](../../../../artifacts/spec-all-2026-10-16/post-view-acl-verification-manifest.json): **419/419 PostgreSQL**, **19 ca SQLite legacy có tên**, Next build và HTTP runtime **1/1 PASS**; source không đổi trong lượt chạy. Đây là kiểm đúng chức năng, tách khỏi phép đo tải. |

Diagnostic từng truy vấn không được dùng thay p95 tải đồng thời. Lượt 7 đã đo lại cả trang đầu và trang sâu sau patch trên môi trường tham chiếu; không suy kết quả này cho mọi kích thước dữ liệu hoặc cấu hình triển khai. Browser rendering/memory và provider latency chưa có bằng chứng từ harness; thiết bị Android và provider thật giữ BLOCKED theo nợ kiểm thử người dùng đã chấp nhận. Mọi failure ở các lượt 1–6 vẫn được giữ trong [báo cáo tổng](../../10-implementation-status.md).

Các thử nghiệm không đem lại cải thiện đã được bỏ khỏi source: ép giữ ACL dưới dạng hashed subplan, array membership, tách riêng phản hồi người phụ trách chính. [IS TRUE diagnostic](../../../../artifacts/spec-all-2026-10-16/x07-ordered-acl-istrue-plan.json) chỉ PASS đối soát dữ liệu, vẫn có sort lớn; [primary-response diagnostic](../../../../artifacts/spec-all-2026-10-16/x07-operations-narrow-plan.json) chậm hơn và không được giữ. Lỗi socket của harness sau seed đồng bộ và lỗi bind tham số đối chiếu được giữ ở artifact riêng; chúng không được ghi thành lỗi production hay bằng chứng gate đã đạt.
