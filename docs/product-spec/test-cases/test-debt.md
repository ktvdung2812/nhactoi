# Nợ kiểm thử môi trường thực

Ngày ghi nhận: 2026-10-16. Người dùng yêu cầu tiếp tục triển khai toàn spec, **giả lập giá trị trả về trước**, sẽ cung cấp môi trường kiểm thử thực sau. Đây là hoãn lớp kiểm thử thực, không phải bỏ requirement hoặc coi mock là bằng chứng provider/thiết bị.

| Phạm vi | Ca cần môi trường thực | Trạng thái thực | Thay thế tạm thời để phát triển |
|---|---|---|---|
| Android thiết bị thật | TC-W4-T02-C/D/E, TC-W4-T04-C/D/E/F/G, TC-W4-T05-A…E; phần parity/device của các wave | NOT RUN — nợ kiểm thử đã được người dùng chấp thuận hoãn | Unit/component và native build; mô phỏng reconnect, timeout, conflict, scope, disk failure. Không chứng minh force-stop, keystore/SQLCipher hoặc TalkBack trên thiết bị |
| Google Calendar thật | TC-W0-T05-B/C, TC-W7-T05-A…D; TC-X09 khi dùng Google thật | NOT RUN — chờ môi trường/tài khoản thử | Fake transport: OAuth state, token refresh/revoke, ETag, pagination, 410, duplicate/out-of-order callbacks và timeout sau nhận. Không chứng minh consent/quota/watch tại Google |
| Zalo OA thật | TC-W0-T06-A…C, TC-W8-T04-A…D | NOT RUN — chờ OA/template/recipient đủ điều kiện | Fake provider cho accepted/delivered/read, template status, lỗi, callback và unknown. Không gửi tới người nhận thật |
| VC browser | W0 UI và các luồng browser mới; TC-X04/X05 phần browser | BLOCKED ở kết nối/capability trong hai lần thử trước | Test API/component không thay browser evidence. Thử lại VC khi công cụ hoạt động |

Gate tích hợp thực và release hoàn chỉnh tiếp tục chưa đạt cho đến khi nợ tương ứng được chạy và đối soát. Có thể nghiệm thu riêng phần nội bộ đã có bằng chứng đạt. Mỗi lần trả nợ cần build/commit, thiết bị/provider, expected/actual, request/event ID hoặc ảnh/log đã che secret; không sửa trạng thái thành PASS chỉ vì fixture giả lập đạt.

## Yêu cầu ảnh xác minh bổ sung (16/10/2026)

Người dùng yêu cầu ảnh chụp màn hình cho tất cả phần nghiệm thu. Mỗi task có UI phải liên kết ảnh thật của luồng đã chạy; ca nền tảng không có UI giữ log/API/DB phù hợp và ảnh màn hình báo cáo thực thi để đối chiếu. Ảnh báo cáo không thay bằng chứng nghiệp vụ, source/component/mock không được coi là ảnh UI hay thiết bị thật. Phần chưa có ảnh vẫn thiếu bằng chứng nghiệm thu, kể cả unit/API đã PASS. Root đang thử lại VC Browser.
