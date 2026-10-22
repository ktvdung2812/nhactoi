# Hợp đồng Zalo OA/ZBS đã kiểm chứng — 16/10/2026

Tài liệu công khai đã được đọc qua website chính thức `developers.zalo.me`, iframe tài liệu `stc-developers.zdn.vn/docs/v2` và các MDX asset được trang đó tham chiếu. HTML ban đầu chỉ là shell; không suy hợp đồng từ tên sản phẩm cũ. Bản tải và SHA-256: [sources.json](../../artifacts/spec-all-2026-10-16/zalo-contract-docs/sources.json). Các trường ví dụ trong tài liệu provider là dữ liệu công khai, không phải credential của workspace.

## Hợp đồng đã triển khai

| Luồng | API chính thức | Nội dung đã đối chiếu |
|---|---|---|
| Xác minh OA | `GET https://openapi.zalo.me/v2.0/oa/getoa` | Header `access_token`, `data.oaid`, `oa_type=2`, `is_verified`; token phải thuộc OA doanh nghiệp được chọn |
| Danh mục mẫu | `GET https://business.openapi.zalo.me/template/all?offset=…&limit=100&filterPreset=1` | Phân trang, trạng thái; chỉ mẫu của app tương ứng token |
| Chi tiết mẫu | `GET https://business.openapi.zalo.me/template/info/v2?template_id=…` | `listParams`, `listButtons`, `templateTag`, `status`, `previewUrl`; version nội bộ là hash định nghĩa thực, không bịa version của provider |
| Gửi qua số điện thoại | `POST https://business.openapi.zalo.me/message/template` | `phone`, `template_id`, `template_data`, `tracking_id`; gửi thường `sending_mode=1`, không tự chuyển kênh hoặc dùng chế độ vượt quota |
| Gửi qua UID | `POST https://openapi.zalo.me/v3.0/oa/message/template` | `user_id`, `template_id`, `template_data`; kết quả `data.message_id`; không thêm khóa idempotency chưa được tài liệu hỗ trợ |
| Đối soát số điện thoại | `GET https://business.openapi.zalo.me/message/status?message_id=…&phone=…` | Status 0 là accepted, 1 là delivered, -1 không đủ để khẳng định chưa từng nhận; không tự retry |
| Callback số điện thoại | `user_received_message`, header `X-ZEvent-Server: ZNS` | `sender.id` OA, `recipient.id` số điện thoại, `message.msg_id`, `tracking_id`, `delivery_time`; chứng minh delivered, không phải read |
| Callback UID | `user_received_message`, `user_seen_message` | `message.msg_id` hoặc `msg_ids[]`; sender OA, recipient UID; chứng minh delivered/read tương ứng, không đổi ack task |

Callback dùng đúng công thức công bố: `sha256(appId + rawJsonBody + timestamp + OAsecretKey)`, so sánh constant-time với `X-ZEvent-Signature`. Header chấp nhận hex hoặc `mac=hex`; nội dung JSON bị sửa sẽ thất bại. App/OA/người nhận/message phải khớp bản ghi; callback trùng/đảo thứ tự không làm lùi trạng thái. Cửa sổ replay local 7 ngày, sai số tương lai tối đa 5 phút; đây là chính sách bảo vệ của ứng dụng, không tuyên bố là thời hạn retry của Zalo.

Token, App ID và OA Secret Key được lưu trong cấu hình mã hóa bằng hạ tầng AES-GCM hiện có. Token được nhập sau khi doanh nghiệp cấp quyền OA cho app; `getoa` xác minh binding. Không dùng token workspace khác. Kết nối lại tăng generation; job cũ bị chặn. Ứng dụng chưa tự thực hiện OAuth redirect/refresh-token; khi token hết hạn phải kết nối lại qua UI, sender dừng với lý do.

## Mục đích, người nhận và giới hạn được thể hiện rõ

`TRANSACTION`, `CUSTOMER_CARE`, `PROMOTION` ánh xạ đúng các mục đích provider. Endpoint chi tiết có ví dụ `IN_TRANSACTION`; adapter chấp nhận tên này như transactional. Nội bộ là mục đích nghiệp vụ riêng: owner/admin phải lưu bằng chứng đã xem mẫu được duyệt và xác nhận mẫu có chữ “Thông báo nội bộ”. Approval gắn hash định nghĩa; mẫu thay đổi thì approval không còn hiệu lực.

Registry yêu cầu định danh `phone:84…` hoặc `uid:…`, liên kết nhân viên/khách hàng cùng workspace, mục đích, bằng chứng quan hệ/điều kiện nhận, ngày hết hiệu lực và xác nhận chưa opt-out. Đây là **bằng chứng nghiệp vụ do doanh nghiệp ghi nhận**, không trình bày như một API provider xác nhận universal eligibility. Worker kiểm tra lại registry, nguồn, ACL, gói, kỳ/task, template tại provider trước mỗi lượt. Provider vẫn kiểm tra điều kiện gửi/quota tại API thật; lỗi vĩnh viễn không bị né bằng kênh/mục đích khác.

Preview hỗ trợ toàn bộ tham số kiểu STRING của mẫu, giới hạn chiều dài theo định nghĩa và tối đa một CTA HTTPS tĩnh. Mẫu nhiều CTA, CTA động/loại khác hoặc tham số kiểu chưa hỗ trợ được giữ trong danh mục với trạng thái không gửi được và lý do; không âm thầm bỏ thành phần. Picker hiện giới hạn 200 nguồn/người nhận gần nhất; chưa có tìm kiếm phân trang sâu trong trang OA. Đây là giới hạn triển khai cần theo dõi, không phải quota thương mại.

Năm attempt tối đa cho các lỗi xác định chưa gửi/429; backoff 30s × 2, tôn trọng Retry-After (tối đa một ngày). Timeout/5xx sau bước gửi hoặc crash khi đang gửi → `unknown`; không blind retry. API status theo số điện thoại cần message ID; nếu response create mất ID thì chờ callback có tracking_id. UID không có tracking_id/lookup theo operation trong hợp đồng đã đọc; mất response gửi UID giữ unknown để đối soát ngoài hệ thống, không gửi lại mù.

## Gate thật còn nợ

`ZALO_OA_LIVE_SEND_ENABLED` mặc định tắt. Adapter thật và UI cấu hình tồn tại; có thể xác minh OA, đồng bộ mẫu, chuẩn bị registry/preview trước khi bật sender. Chỉ bật ở môi trường đã có OA/app/quyền/token/mẫu/người nhận thử được phép và gate phát hành được chủ dự án xử lý. `realGate: BLOCKED` không được thay bằng PASS từ contract test hoặc build.

Chưa có bằng chứng gửi thật, revoke token/template thật, quota/phí thực hoặc request/message ID thật. Người dùng cho phép hoãn kiểm thử tài khoản/provider và thiết bị thật thành nợ; không suy ra cho phép gửi tới khách hàng/nhân viên ngoài nhóm thử.

## Nguồn chính thức

- [OA getoa](https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-thong-tin-oa/lay-thong-tin-zalo-official-account)
- [Gửi ZBS qua số điện thoại](https://developers.zalo.me/docs/zbs-template-message/gui-tin-template-qua-sdt/api-gui-tin-qua-sdt/api-gui-tin)
- [Gửi ZBS qua UID](https://developers.zalo.me/docs/zbs-template-message/gui-tin-template-qua-uid/api-gui-tin-qua-uid)
- [Template list](https://developers.zalo.me/docs/zbs-template-message/quan-ly-template/template-api/api-lay-danh-sach-template), [Template detail](https://developers.zalo.me/docs/zbs-template-message/quan-ly-template/template-api/api-lay-thong-tin-chi-tiet-template)
- [Phone status](https://developers.zalo.me/docs/zbs-template-message/gui-tin-template-qua-sdt/api-truy-xuat-thong-tin-gui-tin-qua-sdt/api-lay-thong-tin-trang-thai-gui-tin-qua-sdt)
- [Phone callback](https://developers.zalo.me/docs/zbs-template-message/gui-tin-template-qua-sdt/webhook-gui-tin-qua-sdt/su-kien-nguoi-dung-nhan-tin-qua-sdt)
- [UID delivered](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-nhan-tin-nhan-tu-official-account), [UID read](https://developers.zalo.me/docs/official-account/webhook/tin-nhan/su-kien-nguoi-dung-da-xem-tin-nhan-duoc-gui-tu-official-account)
- [Quy chuẩn nội dung/CTA/nội bộ](https://zalo.solutions/business-message/guidelines/quy-dinh-chung-khi-kiem-duyet-mau-zbs-template-message)

Toàn bộ kiểm chứng nguồn trên ngày 16/10/2026 là đọc tài liệu công khai. Không đăng nhập provider, không gửi tin thử thật.

Lịch sử Zalo của task được trả trong `/api/tasks/:id/reminders` cùng màn hình email/FCM/Web Push; chỉ có tên người nhận, trạng thái, số attempt và correlation provider. Task ACL vẫn áp dụng, không trả số điện thoại/token. Registry và toàn bộ lịch sử OA nằm trong màn hình quản trị OA dành riêng owner/admin.
