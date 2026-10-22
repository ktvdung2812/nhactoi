# Readiness Google Calendar và Zalo OA — W0

Kiểm tra lúc **02:05 ngày 16/10/2026 (UTC+7)**. HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9` cùng working tree chưa commit. Đây là review source và tài liệu công khai; chưa phải thử nghiệm kết nối hoặc gửi thật. Không truy cập credential của workspace hoặc gửi tin tới người nhận.

**W7 và W8 vẫn BLOCKED để phát hành tích hợp thật.** Các wave nội bộ W1–W6 có thể tiếp tục. Tài khoản/provider chưa được cung cấp bằng chứng trong hồ sơ này; không suy ra rằng chúng chắc chắn chưa tồn tại ở môi trường khác.

## Google Calendar — W0-T05

| Hạng mục | Kết quả kiểm tra | Trạng thái / người xử lý |
|---|---|---|
| Login hiện hữu | `server/google-login.mjs` chỉ yêu cầu `openid email profile`; callback `/api/auth/google/callback`. Không có Calendar scope trong flow login. | PASS — review source `TC-W0-T05-A`; chưa thay thế regression login trên DB |
| Scope Calendar | Tài liệu Google định nghĩa `https://www.googleapis.com/auth/calendar.app.created`: tạo lịch phụ và xem/tạo/sửa/xóa event trên các lịch đó. Không cấp quyền đọc mọi lịch hay free/busy của tài khoản. | PASS — review hợp đồng scope; chưa có consent Calendar chạy thật |
| Client Calendar | Chưa có manifest OAuth client, Cloud project, consent publishing status hoặc bằng chứng bật Calendar API cho môi trường thử trong repo. Không dùng client ID giả trong test làm bằng chứng. | BLOCKED — quản trị Google Cloud của ứng dụng |
| Callback Calendar | Chưa có route connector Calendar trong source đang kiểm tra. Callback login không được dùng làm bằng chứng Calendar. Callback HTTPS thực phải được ghi vào manifest và allowlist đúng tuyệt đối. | BLOCKED — kỹ sư W7-T01 và quản trị Google Cloud |
| State / phạm vi | Thiết kế [§3.1 tích hợp](04-integrations.md#31-kết-nối-và-quyền) yêu cầu state ngắn hạn, một lần, ràng buộc user/workspace/callback. State login hiện hữu không mang workspace và không được tái sử dụng như state connector. | Thiết kế có sẵn; implementation/test W7-T01 NOT RUN |
| Test account | Chưa có bằng chứng tài khoản được phép consent, Google account ID đã che thông tin cá nhân hoặc workspace thử tương ứng. | BLOCKED — quản trị ứng dụng/test account |
| Verification | Chưa kiểm tra OAuth consent screen, loại người dùng, domain đã xác minh hoặc yêu cầu xác minh áp dụng cho client/scope thực. Không kết luận được miễn xác minh chỉ dựa trên scope. | BLOCKED — quản trị Google Cloud |
| Quota | Tài liệu xác nhận giới hạn theo phút/project và phút/user/project; lỗi giới hạn có thể là `403 usageLimits` hoặc `429 usageLimits`. Chưa có quota thực của project thử hoặc giới hạn vận hành. | Hợp đồng đọc được; quota môi trường BLOCKED — quản trị Google Cloud |
| Gate thật | Chưa có request/event ID của tạo/sửa/xóa hai chiều, revoke/reconnect, timezone/DST và all-day. | BLOCKED — W7-T05 |

Manifest cần bổ sung khi có môi trường: tên môi trường, app origin, Cloud project ID, client ID (không client secret), callback HTTPS đã đăng ký, scope thực, consent status, tài khoản thử được phép, quota đọc từ Cloud Console, ngày/nguồn và người xác nhận. Secret lưu ở hệ thống cấu hình mã hóa, không ghi vào tài liệu.

`TC-W0-T05-B`: BLOCKED do chưa có manifest và kiểm chứng cấu hình thực. `TC-W0-T05-C`: PASS cho việc ghi nhận blocker/nguồn trong review này; W0-T05 tổng thể chưa nghiệm thu đầy đủ. Sender Calendar chưa được coi là sẵn sàng.

## Zalo OA — W0-T06

| Hạng mục | Bằng chứng hiện có / còn thiếu | Trạng thái / người xử lý |
|---|---|---|
| OA doanh nghiệp | Chưa có OA ID thử, workspace sở hữu, bằng chứng ủy quyền hoặc người quản trị OA trong hồ sơ. | BLOCKED — chủ OA doanh nghiệp |
| App / API / phiên bản | Chưa xác định ứng dụng được OA cấp quyền, API chính thức/phiên bản được phép và callback xác thực. `developers.zalo.me` trả trang ứng dụng, chưa phải bằng chứng tài liệu hợp đồng API cụ thể. | BLOCKED — chủ OA và kỹ sư W8-T01 |
| Tên sản phẩm | `zalo.cloud` hiện chuyển tới `zalo.solutions`; trang công khai gọi giải pháp mẫu là **ZBS Template Message**. Không dùng tên ZNS cũ để tự suy endpoint, phí hoặc policy hiện hành. | PASS — review trang công khai, chưa xác nhận quyền gửi của OA |
| Token | Không đọc/in token hoặc thử gửi để kiểm tra readiness; cần bằng chứng token hợp lệ qua cấu hình bảo mật của workspace thử. | BLOCKED — chủ OA và kỹ sư W8-T01 |
| Người nhận | Chưa có registry người nhận thử nội bộ/khách hàng được phép hoặc bằng chứng điều kiện/opt-out. Số điện thoại một mình không chứng minh đủ điều kiện. | BLOCKED — chủ OA/test coordinator |
| Quota / phí / policy | Chưa có tài liệu chính sách cụ thể kèm ngày/phiên bản áp dụng cho OA, loại template và API được chọn. | BLOCKED — chủ OA và người phụ trách sản phẩm |
| Gate thật | Chưa có template ID/version được duyệt, request/message ID và callback có xác thực cho gửi thử. | BLOCKED — W8-T04 |

Ma trận template cần được xác nhận bằng chính sách và template thực của OA; các mục dưới đây là yêu cầu kiểm tra của spec, chưa phải tuyên bố provider đã cho phép:

| Mục đích | Template / CTA | Điều kiện người nhận / thời điểm | Kết quả |
|---|---|---|---|
| Thông báo nội bộ nhân viên | Mẫu approved, tham số và nội dung nội bộ hợp lệ; CTA theo mẫu duyệt | Nhân viên thử được phép nhận theo API/policy thực | BLOCKED |
| Giao dịch/dịch vụ | Mẫu approved gắn giao dịch thực; không thêm nội dung khác qua biến | Người nhận có quan hệ và điều kiện được policy cho phép | BLOCKED |
| Chăm sóc trước hết hạn | Mẫu chăm sóc được duyệt, mốc trước hạn và CTA hợp lệ | Đủ điều kiện nhận ở thời điểm gửi; chưa opt-out | BLOCKED |
| Sau hết hạn/quảng bá | Phân loại mục đích theo policy hiện hành, mẫu tương ứng | Không mặc định được dùng điều kiện chăm sóc trước hạn | BLOCKED |

`TC-W0-T06-A/B/C`: BLOCKED cho phần kiểm chứng OA/API/template/người nhận thật. Review thiếu điều kiện đã ghi rõ; không đổi các ca này thành PASS từ homepage hoặc fake transport. Kỹ sư W8 chỉ triển khai adapter theo hợp đồng được xác minh, không đoán endpoint hay chuyển loại tin để vượt điều kiện gửi.

## Nguồn và bằng chứng

HTTP GET công khai được thực hiện ngày 16/10/2026; không đăng nhập, không gửi mutation. SHA-256 dưới đây là body tải về tại thời điểm review; trang có thể thay đổi.

| Nguồn | HTTP / đích cuối | Bằng chứng SHA-256 |
|---|---|---|
| [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) | 200 | `246e1190c6d823318360a1396f3cfddcc0319f900f6266e40690160a2d1d10e5` |
| [Calendar usage limits](https://developers.google.com/workspace/calendar/api/guides/quota) | 200 | `d8b95309a57837507cb571a24dcf6d33bd7c699a39b89610f715da4460992598` |
| [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server) | 200 | `5ca2f5cb250592d7b2ffee01c7730d734e3de76cf57d28cffa2dbd058790ad1d` |
| [Zalo Developers](https://developers.zalo.me/) | 200, trang ứng dụng chưa đủ policy | `66e5ef30d3c05a59ecdaafa6dfb5fb774ec356b21a3361fbf12af6eae699c723` |
| [Zalo Cloud](https://zalo.cloud/) | 200, chuyển tới `https://zalo.solutions/` | `72d73c9aaafc94515bc85b32146549b5396f71ce45f84dd3ff684103c439790d` |
| [Zalo OA](https://oa.zalo.me/) | 200, `https://oa.zalo.me/home` | `7cbcf0da32f5d767dfedb83de2d94faedbf41ee9342c32860af3b660d42e66fa` |

Source login được review: `server/google-login.mjs`, SHA-256 `8dae01b014a808e27543fef076ace0f39e9c939875083b4155ba85ff8cc101c0`. Các test `tests/google-recovery.test.mjs` là regression bằng fake OAuth transport; hồ sơ này không ghi chúng là provider PASS hoặc đã chạy lại.
