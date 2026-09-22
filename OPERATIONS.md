# Vận hành Nhắc tôi

## Sao lưu và khôi phục

Admin SaaS → Cấu hình → Sao lưu hệ thống cho phép tạo bản sao ngay và đặt lịch 6/12/24 giờ hoặc hằng tuần. Lịch chạy khi dịch vụ Node đang hoạt động. Bản sao gồm SQLite bằng `VACUUM INTO`, các tệp đính kèm trên máy chủ và kho ngoài và SHA-256 kiểm tra toàn vẹn. Bản sao đang chạy dùng thư mục `.pending`; nếu lỗi, dữ liệu tạm được dọn và không được liệt kê là bản sao hoàn chỉnh. Chưa tự xóa bản sao cũ; cần theo dõi dung lượng đĩa.

Giữ riêng khóa mã hóa cấu hình của máy chủ. Tệp S3/Drive cũng được tải vào bản sao. Nếu kho không truy cập được, bản sao bị đánh dấu chưa hoàn tất. Khi khôi phục, mọi tệp được chép vào thư mục riêng mới trên máy chủ.

Khôi phục được thực hiện ngoại tuyến để tránh ghi đè dữ liệu đang sử dụng:

1. Dừng dịch vụ Nhắc tôi trong EnvKit, đảm bảo không còn tiến trình dùng DB. Công cụ từ chối nếu còn WAL/SHM; không tự xóa các tệp này.
2. Chạy `node scripts/restore-backup.mjs /duong-dan/nhactoi.sqlite backup-ID --offline-confirm-restore`.
3. Công cụ xác minh DB/tệp, chép tệp vào kho riêng mới, giữ DB trước khôi phục, vô hiệu các phiên cũ và lịch sao lưu, rồi thay DB.
4. Khởi động lại trong EnvKit, đăng nhập và kiểm tra dữ liệu. Đặt lại lịch sao lưu phù hợp.

Không khôi phục bản sao từ nguồn không tin cậy. Công cụ chỉ dùng bản sao trong thư mục `snapshots` cạnh DB, có manifest hợp lệ.

## Google

Admin SaaS cấu hình OAuth Client ID/Secret và URI chuyển hướng hiển thị ở trang Cấu hình. Secret được mã hóa cùng cơ chế cấu hình của ứng dụng. Google cần cho phép URI của môi trường đang chạy.

Tài khoản có sẵn: đăng nhập bằng mật khẩu → Tài khoản → Liên kết Google. Không tự nối tài khoản chỉ vì email trùng nhau. Tài khoản Google chưa có email trong Nhắc tôi được tạo không gian dùng thử. OAuth sử dụng state, cookie HttpOnly, PKCE, nonce và xác minh ID token.

## Nhập / xuất bảng

Xuất JSON phiên bản 1 chứa cột, task và checklist. Nhập thêm bản ghi mới vào bảng đã chọn, không ghi đè task cũ. Không chuyển bình luận, tệp, lịch sử và danh tính người dùng giữa doanh nghiệp. Chỉ người quản lý bảng được nhập. Giới hạn 500 task/40 cột và HTTP payload 1 MB.

## Kho tệp S3 và Google Drive

Admin SaaS → Cấu hình → Kho S3 / Google Drive:

1. Thêm cấu hình S3 (bucket, region, access key/secret; endpoint tùy chọn cho MinIO/R2) hoặc thư mục Google Shared Drive và service account đã được cấp quyền thư mục.
2. Kiểm tra kết nối, sau đó chọn kho dùng cho tệp tải lên mới và nhập lý do. Cấu hình cũ được giữ để các tệp đã lưu vẫn tải được; bí mật được mã hóa và không trả lại qua API.
3. Có thể chuyển tệp từ máy chủ sang kho đang chọn theo lô 10 tệp. Hệ thống tải lại để đối chiếu SHA-256 trước khi đổi tham chiếu và dọn bản cũ; liên kết tải xuống giữ nguyên.

Tệp luôn tải qua API có kiểm tra quyền doanh nghiệp/team. Giới hạn dung lượng do admin đặt tiếp tục áp dụng cho đính kèm task và bình luận. Chưa hỗ trợ chuyển trực tiếp S3 ↔ Drive. Nút kiểm tra kết nối không thay cho thử tải lên/tải xuống bằng tài khoản được cấp quyền.

Cần cấu hình thông tin kết nối thật trước khi xác nhận S3/Drive và Google OAuth hoạt động. Không đặt khóa vào mã nguồn hoặc ghi chúng trong nhật ký.

## Dịch vụ, cộng tác và tự động hóa

Các thông báo mới xuất hiện trong ứng dụng. Nhắc gia hạn và lịch hẹn chạy cùng tiến trình Node; cần giữ dịch vụ EnvKit hoạt động. Lịch hẹn nhắc người tạo. Quy tắc tự động hóa chạy theo phạm vi bảng/team, có nhật ký thành công/lỗi; các bước của một lần chạy được hoàn tác cùng nhau khi lỗi. Nút thủ công được tạo bằng sự kiện “Nút chạy thủ công”.
