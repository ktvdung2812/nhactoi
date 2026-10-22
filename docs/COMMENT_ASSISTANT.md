# Trợ lý @Vyvy trong bình luận

## Sử dụng và cấu hình

Gửi bình luận mới như `@vyvy tóm tắt trao đổi, tạo checklist và giao cho An` trên web hoặc mobile. Có thể chọn trợ lý trong gợi ý `@` hoặc gõ trực tiếp; tên gọi không phân biệt hoa/thường. Mỗi bình luận chỉ tạo một lượt xử lý, kể cả khi có nhiều mention. Phản hồi AI không tự gọi tiếp trợ lý.

Owner/admin thay đổi tên, tên gọi và trạng thái bật tại **Tài khoản → Trợ lý trong bình luận**. Tên hiển thị tối đa 60 ký tự; tên gọi gồm 2–32 chữ Latin, số hoặc gạch dưới, bắt đầu bằng chữ. Mặc định là **Vyvy / @vyvy**. Trợ lý dùng cấu hình nhà cung cấp, mô hình và khóa API hiện có của SaaS; không cần tài khoản thành viên hoặc suất thuê bao riêng.

Bình luận được lưu ngay. Worker tiếp tục khi người gọi đóng màn hình. Trạng thái, phản hồi có nhãn AI, bình luận gốc, nguồn và kết quả thao tác được chia sẻ cho người có quyền xem công việc. Khi cần làm rõ, trả lời bằng một bình luận gọi trợ lý tiếp.

## Phạm vi và quyền

- Đọc thông tin công việc, toàn bộ bình luận/lịch sử hoạt động, checklist, người phụ trách/phối hợp, nhãn, trường tùy chỉnh, liên kết, tệp và URL; tra cứu thêm công việc trong cùng dự án khi cần.
- Không đưa hội thoại AI riêng hoặc dữ liệu CRM vào ngữ cảnh bình luận chung. Phản hồi dẫn xuất được ẩn khi công việc nguồn chuyển dự án hoặc người xem mất quyền.
- Có thể **đề xuất** tạo công việc; sửa tiêu đề, mô tả, trạng thái, ưu tiên, hạn, phân công; tạo/sửa/đánh dấu checklist. Trợ lý không tự ghi dữ liệu: mỗi đề xuất hiện trong phản hồi với trạng thái **Chờ xác nhận**, và chỉ người gọi mới thấy nút **Thực hiện** / **Bỏ qua**. Khi bấm Thực hiện, thao tác chạy bằng quyền hiện tại của người gọi qua nghiệp vụ dùng chung với API, giữ revision, lịch lặp, thông báo và sự kiện.
- Đề xuất lỗi thời (công việc đã đổi sau khi trợ lý đọc, đã chuyển dự án/xóa, hoặc quá 24 giờ) bị từ chối với trạng thái **Đã lỗi thời**; hãy gửi yêu cầu mới. Thao tác cần ID của đối tượng chưa tạo (ví dụ thêm mục vào checklist mới) phải gửi yêu cầu tiếp theo sau khi xác nhận.
- Tham số mô hình trả về được kiểm tra theo schema công cụ (kiểu, độ dài chuỗi — tiêu đề 240, mặc định 2000 ký tự —, giá trị cho phép, định dạng ID, số phần tử danh sách) trước khi thành đề xuất. Tham số sai ghi thao tác **Chưa thực hiện** với lỗi "Tham số thao tác không hợp lệ." và không lưu giá trị đó; khi thực hiện, nghiệp vụ vẫn kiểm tra lại lần nữa.
- Người chỉ có quyền bình luận được hỏi/nhận đề xuất; công cụ sửa dữ liệu vẫn kiểm tra quyền chỉnh sửa hiện tại. Tài khoản, thuê bao, quyền dự án, trạng thái công việc và cấu hình AI được kiểm tra lại trước thao tác và trước khi đăng kết quả.
- Mặc định thao tác công việc đang trao đổi. Mô hình được hướng dẫn hỏi lại khi đối tượng hoặc ngày giờ chưa rõ, dùng múi giờ `Asia/Ho_Chi_Minh`. Xóa dữ liệu và đổi quyền phải thực hiện tại màn hình hiện có.
- Tài liệu, website và lịch sử là dữ liệu tham khảo, không phải chỉ dẫn có quyền thực hiện thao tác.

## Nguồn và giới hạn

| Nguồn | Cách đọc |
| --- | --- |
| PDF, PNG/JPEG/WebP | Gửi tài liệu gốc tới mô hình có khả năng đọc tương ứng; đưa bản tổng hợp vào ngữ cảnh |
| DOCX | `mammoth`, trích xuất văn bản, không truy cập tệp ngoài |
| XLSX | `exceljs`, đọc dữ liệu và kết quả công thức đã lưu, không thực thi công thức/macro |
| CSV, TXT, Markdown | Đọc như dữ liệu văn bản |
| Website công khai (chỉ HTTPS) | Kiểm tra IP công khai, ghim DNS, kiểm tra lại từng redirect, chuyển HTML thành văn bản bằng `html-to-text` |

Tệp dùng kho nội bộ/S3/Drive hiện có, kiểm tra quyền trước khi chuyển nội dung tới AI. Website không nhận cookie hoặc khóa ứng dụng; chỉ tải URL được dẫn, không thu thập toàn website. Liên kết được tải chỉ lấy từ mô tả công việc, tệp/URL đính kèm và bình luận của chính người gọi; bình luận của người khác (kể cả khách) vẫn vào ngữ cảnh dưới dạng văn bản nhưng liên kết trong đó không được tải. Trang cần đăng nhập/JavaScript hoặc nguồn không trích xuất được nội dung được báo chưa đọc được. Khả năng ảnh/PDF chưa xác nhận được coi là chưa hỗ trợ.

- Tệp tối đa 10 MiB; URL tối đa 2 MiB; tổng tài liệu tối đa 25 MiB; tối đa 100 nguồn/lượt, trong đó tối đa 10 liên kết lấy từ văn bản (mô tả và bình luận). Liên kết thứ 11 trở đi có trạng thái `skipped` ("Vượt giới hạn 10 liên kết trong văn bản."); tệp và URL đính kèm không tính vào giới hạn 10 này.
- Tải mỗi nguồn tối đa 20 giây; trích xuất tối đa 250.000 ký tự/nguồn; giữ tối đa 60.000 ký tự văn bản nguồn trước tổng hợp ngữ cảnh.
- Văn bản dài được chia phần, tổng hợp và giữ ID nguồn. Nguồn bị cắt, lỗi hoặc không hỗ trợ luôn có trạng thái riêng.
- Mỗi lượt tối đa 10 phút, 90 giây/lần gọi mô hình, 12 vòng công cụ; tối đa 5 lần xử lý. Hạn mức 20 lượt xử lý/10 phút/người/không gian, gồm thử lại.

## API và lưu trữ

Các endpoint dùng cơ chế xác thực hiện có; quyền được kiểm tra theo không gian và dự án hiện tại.

| Endpoint | Hợp đồng bổ sung |
| --- | --- |
| `GET /api/ai/config` | `enabled`, `ready`, `assistant`, `canManageAssistant`, `capabilities`; `provider` và `model` chỉ trả cho người quản lý trợ lý |
| `PUT /api/ai/workspace-settings` | Owner/admin gửi `{ name, handle, enabled }` |
| `POST /api/tasks/:id/comments` | Nhận `operationId` hoặc `Idempotency-Key`; trả `{ comment, aiRun? }` |
| `GET /api/tasks/:id/detail` | Bình luận có `authorType`, `replyToCommentId`, `aiRunId`, `sources`, `actions` |
| `GET /api/tasks/:id/ai-runs` | Trả `{ runs }` gồm trạng thái, lỗi, nguồn, thao tác, `canRetry` và `canApply` |
| `POST /api/tasks/:id/ai-runs/:runId/retry` | Người gọi thử lại lượt lỗi sau khi kiểm tra quyền và ngữ cảnh |
| `POST /api/tasks/:id/ai-runs/:runId/actions/:actionId/apply` | Người gọi thực hiện một đề xuất của lượt `completed`/`failed`; trả `{ run, action, taskRevision }`. 409 khi đã xử lý hoặc lỗi thời, 403 khi không còn quyền sửa |
| `POST /api/tasks/:id/ai-runs/:runId/actions/:actionId/dismiss` | Người gọi bỏ qua đề xuất; trả `{ run, action }` |

Mỗi thao tác trong `actions` có `id`, `name`, `taskId`, `status` (`proposed`, `completed`, `failed`, `stale`, `dismissed`), `summary`, `args`, `proposedAt`, và khi đã xử lý thì `resolvedAt`, `error` hoặc `result`; đề xuất bị bỏ qua do sửa/xóa bình luận gọi có thêm `dismissedAt` và `reason`. Thao tác cũ (trước khi có bước xác nhận) không có `operation` nên không thực hiện lại được.

`operationId` gồm 8–160 ký tự hợp lệ và phải được giữ nguyên khi gửi lại cùng yêu cầu sau lỗi mạng. Dùng lại khóa với nội dung khác bị từ chối. Nếu gửi cả khóa trong body và header, hai giá trị phải khớp.

Migration PostgreSQL **015** thêm `workspace_ai_settings`, `ai_comment_runs` và metadata bình luận AI. Bình luận và lượt xử lý được lưu trong cùng transaction; việc gọi nhà cung cấp diễn ra sau commit. Worker lưu lời gọi công cụ, tiến độ và đề xuất. Khi người gọi xác nhận, thao tác dùng `operationId` là ID đề xuất nên có mutation receipt và sự kiện nghiệp vụ mang `causation_id` của lượt xử lý.

Trạng thái gồm `queued`, `reading`, `executing`, `completed`, `failed`, `cancelled`. Sửa/xóa bình luận gọi dừng phần chưa thực hiện, không hoàn tác những thay đổi đã lưu; mọi đề xuất còn **Chờ xác nhận** của bình luận đó chuyển thành `dismissed` với `reason: "comment_removed"` nên không áp dụng được nữa (apply trả 409). Xung đột revision hoặc thay đổi quyền/ngữ cảnh yêu cầu bình luận mới; không tự ghi đè dữ liệu.

## Triển khai và vận hành

1. Sao lưu theo [hướng dẫn PostgreSQL](POSTGRESQL.md), cài dependencies và chạy `npm run db:migrate` để áp dụng migration 015.
2. Build và khởi động lại backend theo [hướng dẫn triển khai](DEPLOYMENT.md). Background worker phải được bật; `DISABLE_BACKGROUND_WORKER=true` sẽ ngừng xử lý hàng đợi.
3. Phát hành web/mobile sau backend tương thích. Kiểm tra cấu hình AI và khả năng đọc ảnh/PDF của mô hình đã chọn.
4. Thử một yêu cầu đọc và một đề xuất (xác nhận rồi kiểm tra kết quả) trên công việc thử nghiệm bằng mô hình thực tế trước khi mở rộng sử dụng.

Sau crash, lease hết hạn được nhận lại trong tối đa 15 phút cộng chu kỳ worker. Shutdown bình thường giải phóng lease ngay. Sao lưu/khôi phục giữ cấu hình, tiến độ, kết quả và liên kết run/reply; cơ chế tạm dừng gửi sau restore vẫn áp dụng.

Theo dõi theo ID trong `ai_comment_runs`, `actions_json` và log `assistant run completed/failed`. Log chỉ chứa ID, thời gian, mã lỗi và số đề xuất đang chờ; không chứa khóa API hoặc nguyên văn tài liệu.

## Kết quả kiểm thử ngày 18–19/10/2026

Kiểm thử backend dùng PostgreSQL riêng và nhà cung cấp AI giả lập, không dùng dữ liệu hoặc khóa sản xuất.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run test:postgres` | 481 đạt |
| `npm run test:legacy` | 89 đạt |
| `npm run build` và `npm run test:next` | Đạt |
| Web component checks | 24 đạt |
| Mobile `npm run lint`, `npm run typecheck` | Đạt |
| Mobile unit/component tests | 24 unit + 115 component đạt |
| Expo export Android | Đạt, 1.497 modules |

Các kiểm thử chuyên biệt nằm tại `tests/ai-comments.test.mjs`, `tests/ai-comment-migration.test.mjs`, `tests/ai-task-mutations.test.mjs`, `tests/ai-sources.test.mjs`. Bao phủ chống gửi trùng, hủy khi sửa/xóa, quyền bình luận/sửa, thu hồi quyền, cách ly dự án, xung đột revision, lease/restart, lỗi sau một phần thao tác, rollback journal, nguồn tài liệu, SSRF và sao lưu/khôi phục.

Kiểm tra trình duyệt thực tế đã xác nhận gợi ý `@`, đổi tên trợ lý, tạo checklist, nguồn/kết quả, đóng/mở lại và gửi lại sau khi mất HTTP response không tạo trùng. Đã kiểm tra desktop 1280px và web responsive 390px. VC preview bị `PreviewAutomationTimeoutError`, browser VC không có Chrome, nên kiểm tra tương tác/ảnh dùng Playwright Chromium dự phòng.

Chưa xác minh tương tác trên thiết bị/simulator Expo native vì môi trường không có thiết bị kết nối hoặc simulator khả dụng. Export Android không thay thế kiểm thử native. Khả năng hiểu tài liệu/ảnh và chất lượng thao tác của mô hình thực tế vẫn cần kiểm tra với cấu hình nhà cung cấp được triển khai.
