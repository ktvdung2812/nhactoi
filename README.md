# Nhắc tôi

SaaS tiếng Việt quản lý công việc, nhắc lịch dịch vụ, cộng tác nhóm và sổ thu–chi. Gói thuê bao theo tháng/năm, tích hợp BillGateway Payment Hub. Dự án độc lập ở thư mục gốc; `demo/task-crm` là mã tham khảo và không bị sửa.

Nhập/xuất JSON của bảng hỗ trợ tối đa **500 công việc, 40 cột và 1 MiB payload UTF-8** mỗi lần. Dung lượng được tính trên JSON gửi lên API (gồm bảng đích và dữ liệu), không tính phần thụt lề của tệp. Cả xuất và nhập dùng cùng giới hạn; bảng vượt giới hạn sẽ nhận thông báo để giảm dữ liệu trước khi xuất. Tệp đính kèm, bình luận và tài khoản không nằm trong bản xuất bảng; hãy dùng sao lưu hệ thống để phục hồi đầy đủ.

## Chạy thử với EnvKit

Website trên máy này: **https://nhactoi.test**.

Trong EnvKit → Sites → nhactoi:

- Giao diện React/Vite chạy tại `127.0.0.1:5170`, được nginx của EnvKit chuyển tiếp qua HTTPS.
- Process **Nhac Toi API** chạy API và bộ xử lý nhắc việc tại `127.0.0.1:3100` bằng Node 26 của EnvKit. Process được đặt tự khởi động lại.
- `envkit.json` lưu cấu hình tiến trình. Đường dẫn Node trong file là đường dẫn trên máy hiện tại; chọn lại runtime nếu chuyển máy.
- `.env` chứa tên miền và danh sách origin dùng thử. `.env.example` liệt kê các biến cấu hình; không đưa `.env` vào Git.

Tài khoản dữ liệu mẫu sau khi chạy `npm run seed`:

| Vai trò | Email | Mật khẩu thử nghiệm |
| --- | --- | --- |
| Chủ không gian | `demo@nhactoi.local` | `NhacToi2026!` |
| Quản trị viên | `an@nhactoi.local` | `NhacToi2026!` |
| Thành viên | `minh@nhactoi.local` | `NhacToi2026!` |

Dữ liệu mẫu được tạo **chỉ khi chạy lệnh seed**, không tự tạo khi khởi động server. Seed không xóa dữ liệu có sẵn. Có thể đăng ký tài khoản riêng từ màn hình đăng nhập để tạo không gian trống, dùng thử 14 ngày. Không đưa dữ liệu mẫu lên môi trường phục vụ khách hàng thật.

## Chạy trực tiếp bằng Node

Cần Node.js **24 trở lên**, khuyến nghị bản Node đã cài trong EnvKit.

```sh
npm install
cp .env.example .env
npm run seed
npm run dev
```

Trước khi chạy trực tiếp, dừng tiến trình API của dự án trong EnvKit để tránh trùng cổng. Giao diện ở `http://127.0.0.1:5173`; API ở `http://127.0.0.1:3100`. Nếu chỉ chạy bằng localhost, đặt `PUBLIC_APP_URL=http://127.0.0.1:5173` để liên kết mời đúng địa chỉ.

```sh
npm test
npm run build
npm start
```

`npm start` phục vụ cả bản build và API trên cổng 3100. Khi triển khai, đặt HTTPS reverse proxy phía trước, `PUBLIC_APP_URL` và `FRONTEND_ORIGIN` theo tên miền thật. Cookie production có cờ Secure nên không dùng HTTP trực tiếp để đăng nhập production.

## Các luồng đã có

- Đăng ký doanh nghiệp, đăng nhập/đăng xuất, phiên làm việc lưu bằng cookie HttpOnly. Mật khẩu băm bằng scrypt, token phiên chỉ lưu hash trong DB.
- Dữ liệu tách theo không gian; vai trò chủ không gian, quản trị viên và thành viên. Có thể chuyển giữa các không gian đã được tham gia từ bộ chọn ở góc trên bên trái.
- Công việc có khách hàng, người phụ trách, ưu tiên, trạng thái, hạn và thời điểm nhắc. Xem danh sách, bảng trạng thái hoặc lịch tháng; tìm kiếm và lọc.
- Hoàn thành một việc lặp theo ngày/tuần/tháng sẽ tạo kỳ tiếp theo một lần. Lịch lặp theo tháng sử dụng ngày lịch Việt Nam (Asia/Ho_Chi_Minh); ngày cuối tháng được chặn theo số ngày thực tế của tháng sau.
- Lịch nhắc tạo thông báo trong ứng dụng ở phía máy chủ; giao diện cập nhật khoảng 30 giây/lần. **Máy chủ phải đang chạy**. Đóng trình duyệt không làm mất lịch; tắt máy hoặc tắt EnvKit thì lịch được xử lý khi máy chủ chạy lại. Đây chưa phải Web Push đến điện thoại khi ứng dụng đã đóng.
- Email nhắc việc là tùy chọn, chỉ hoạt động khi cấu hình SMTP. Lời mời nhóm được tạo thành liên kết để tự gửi; ứng dụng không tự gửi email mời.
- Hồ sơ khách hàng và dịch vụ. Sổ thu–chi VND với danh mục, khách hàng liên quan và tổng theo tháng. Đây là sổ quản lý nội bộ.
- Gói Starter, Team, Business với giới hạn 3/10/50 thành viên. Giá mẫu sửa trong quản trị SaaS hoặc qua biến môi trường khi chưa có cấu hình lưu; giá năm là tổng cho 12 tháng. Quyền ghi dữ liệu được chặn khi thuê bao hết hạn; vẫn có thể đọc dữ liệu và gia hạn.

## Làm việc theo team

- Một doanh nghiệp có nhiều team; mỗi thành viên có thể tham gia nhiều team mà không tăng số chỗ thuê bao. Mời người vào doanh nghiệp ở **Thành viên**, sau đó thêm họ vào team.
- Chủ doanh nghiệp/quản trị viên tạo và quản lý mọi team. Trưởng nhóm cập nhật thông tin và thêm/bớt thành viên thường trong team của mình; chỉ quản trị doanh nghiệp được thay đổi trưởng nhóm. Mỗi team luôn có ít nhất một trưởng nhóm.
- Mục **Teams** có danh sách team, bảng công việc ba trạng thái và danh sách thành viên. Giao việc cho người trong team, đặt hạn/lịch nhắc và cập nhật tiến độ bằng biểu mẫu công việc hiện có.
- Công việc cũ thuộc **Việc chung của doanh nghiệp**. Biểu mẫu công việc có lựa chọn team; chỉ quản trị doanh nghiệp được chuyển công việc giữa các team hoặc về việc chung. Danh sách công việc và lịch nhắc có bộ lọc theo team.
- Thành viên thường chỉ xem công việc của team mình tham gia và việc chung. Phân quyền được kiểm tra tại API, gồm cả bảng tổng quan, công việc lặp và lời nhắc. Phải giao lại công việc chưa hoàn thành trước khi đưa người phụ trách ra khỏi team.
- Lưu trữ team giữ nguyên lịch sử, dừng cập nhật công việc và nhắc việc. Quản trị doanh nghiệp có thể khôi phục để tiếp tục. Team thuộc phạm vi vận hành doanh nghiệp; quản trị SaaS không có API quản lý nội bộ này.

## Bảng công việc theo cột

- Trang Công việc mặc định mở bảng cột; Teams dùng cùng một thành phần `TaskBoard` để giữ giao diện và thao tác nhất quán.
- Ba cột trạng thái hiện tại: Cần làm, Đang làm, Hoàn thành. Mỗi cột có số lượng, vùng thẻ cuộn riêng và nút thêm ở đáy; bảng cuộn ngang trên màn hình nhỏ.
- Kéo thẻ giữa các cột trên desktop hoặc dùng menu **⋮** của thẻ để chuyển trạng thái bằng chuột, cảm ứng hay bàn phím. Trạng thái chỉ cập nhật sau khi máy chủ lưu thành công; công việc lặp lại tiếp tục dùng quy tắc hiện có.
- Menu cột cho phép thu gọn và đổi thứ tự hiển thị trong phiên xem. Đây là thiết lập hiển thị, không đổi quy trình hay trạng thái công việc.
- Team lưu trữ và doanh nghiệp tạm ngưng chỉ xem bảng, không thêm hoặc chuyển thẻ.

## Chi tiết công việc

- Mở từ thẻ Kanban, danh sách, lịch hoặc thông báo tại `#/tasks/:id`; liên kết có thể mở trực tiếp.
- Bố cục hai vùng: nội dung công việc, checklist và liên kết đính kèm; bình luận và lịch sử thao tác. Màn hình nhỏ tự chuyển thành một cột.
- Cập nhật trạng thái, ưu tiên và thông tin công việc; thêm checklist, đánh dấu từng mục và theo dõi tiến độ.
- Bình luận, checklist, tệp, liên kết và lịch sử được lưu trên máy chủ. Liên kết đính kèm chỉ chấp nhận HTTP/HTTPS.
- Quyền truy cập theo doanh nghiệp và team; team lưu trữ hoặc không gian chỉ đọc không cho sửa. Xóa vào thùng rác giữ lại nội dung chi tiết để khôi phục.
- Bộ lọc team nằm bên phải ô tìm kiếm trên trang Công việc, tự xuống hàng khi thiếu chiều rộng.

### Tệp đính kèm và nơi lưu

- Bình luận công việc hỗ trợ tối đa 10 tệp, dùng chung giới hạn dung lượng và nơi lưu do admin thiết lập. Có thể gửi chỉ tệp hoặc kèm nội dung. Tệp cũng xuất hiện trong đính kèm của task; nếu gửi bình luận lỗi, các tệp đã tải lên vẫn được giữ và có thể thử gửi lại.

- Task hỗ trợ tải tệp từ thiết bị và tải xuống qua API có xác thực. Tệp không được phục vụ bằng thư mục web công khai; quyền xem theo doanh nghiệp/team của task.
- Admin SaaS vào **Cấu hình → Lưu trữ tệp đính kèm** để bật/tắt tải tệp, chọn thư mục riêng trên máy chủ và giới hạn mỗi tệp (1–50 MB, mặc định 10 MB). Thay đổi yêu cầu lý do và được ghi nhật ký.
- Thư mục mới chỉ áp dụng cho tệp tải lên sau khi đổi cấu hình. Mỗi tệp giữ nơi lưu ban đầu; cần giữ các thư mục cũ và sao lưu chúng cùng cơ sở dữ liệu.
- Xóa task vào thùng rác giữ lại tệp để khôi phục. Xóa tệp hoặc xóa task vĩnh viễn sẽ dọn nội dung tệp tương ứng.

## Thùng rác cấp 2

- Trang `#/trash` quản lý công việc, khách hàng và khoản thu/chi đã xóa trong doanh nghiệp hiện tại. Xóa thông thường giữ lại dữ liệu để khôi phục; chỉ thao tác xóa vĩnh viễn trong thùng rác mới loại bỏ bản ghi.
- Tìm kiếm, lọc loại, phân trang và chọn nhiều mục. Các thao tác khôi phục/xóa hàng loạt chỉ áp dụng cho danh sách mục đã xác nhận, không tự chọn dữ liệu ẩn ở trang khác.
- Chủ doanh nghiệp/quản trị viên quản lý toàn bộ thùng rác trong doanh nghiệp. Thành viên chỉ thấy công việc do mình xóa và vẫn có quyền truy cập team; quyền quản trị SaaS không cho phép truy cập thùng rác nội bộ.
- Khôi phục kiểm tra lại team, người phụ trách và khách hàng liên quan. Khi có xung đột, dữ liệu vẫn nằm trong thùng rác và giao diện hiển thị lý do. Thao tác hàng loạt là nguyên khối: một mục không hợp lệ thì không mục nào bị thay đổi.
- Dữ liệu đã xóa trước khi triển khai được bổ sung vào thùng rác; nếu không có thông tin người xóa thì chỉ quản trị viên doanh nghiệp thấy. Nhật ký gửi nhắc việc được giữ lại để tránh gửi trùng khi khôi phục.
- Xóa vĩnh viễn yêu cầu xác nhận tên/số mục và nhập `XOA VINH VIEN`. Kiểm thử xóa vĩnh viễn dùng cơ sở dữ liệu cô lập.

## Tickets hỗ trợ

- Người dùng chọn **Hỗ trợ** để tạo yêu cầu về thanh toán, tài khoản, kỹ thuật hoặc vấn đề khác; chọn mức ưu tiên và trao đổi ngay trong từng ticket.
- Mỗi người dùng chỉ xem được yêu cầu do mình gửi trong không gian hiện tại. Hỗ trợ vẫn hoạt động khi doanh nghiệp tạm ngưng hoặc thuê bao hết hạn; tài khoản đã khóa vẫn bị chặn đăng nhập.
- Quản trị SaaS mở **Tickets hỗ trợ** để tìm kiếm, lọc theo chủ đề/trạng thái, phản hồi và cập nhật ưu tiên. Có thể mở danh sách ticket liên quan từ hồ sơ doanh nghiệp hoặc người dùng.
- Luồng xử lý: **Mới tiếp nhận → Đang xử lý → Chờ khách phản hồi → Đã giải quyết**. Khách hàng phản hồi một yêu cầu đang chờ hoặc đã giải quyết sẽ mở lại yêu cầu đó.
- Nội dung trao đổi, người thực hiện và lịch sử thay đổi được lưu trong SQLite. Ticket chỉ phục vụ hỗ trợ dịch vụ; không truy cập công việc, khách hàng, nhân sự hoặc sổ thu–chi nội bộ của doanh nghiệp.
- Phiên bản này trao đổi trong ứng dụng, chưa có tệp đính kèm hoặc thông báo email tự động.

## Quyền quản trị SaaS

Truy cập **https://nhactoi.test/#/admin/overview** hoặc chọn **Quản trị SaaS** trong menu sau khi tài khoản được cấp quyền. Quyền này độc lập với vai trò chủ không gian/quản trị viên của một doanh nghiệp; đăng ký thông thường không cấp quyền admin SaaS.

Phạm vi quản trị SaaS là **thanh toán, thông tin liên hệ và nhật ký hỗ trợ**. API quản trị không trả thống kê công việc, khách hàng, thu–chi nội bộ hoặc danh sách nhân sự doanh nghiệp. Số chỗ sử dụng được giữ trong thông tin thuê bao để đối chiếu giới hạn gói. Các nghiệp vụ nội bộ thuộc không gian riêng của khách hàng.

Khu vực quản trị gồm:

- **Tổng quan:** doanh nghiệp, người dùng, thuê bao còn hạn, MRR ước tính và tiền thu từ hóa đơn đã xác nhận.
- **Doanh nghiệp:** tìm kiếm, lọc và mở hồ sơ liên hệ/thanh toán. Chỉnh sửa tên, ngành nghề, email, điện thoại, địa chỉ, website, mã số thuế, ghi chú hỗ trợ; xem đầu mối liên hệ, thuê bao, hóa đơn và nhật ký.
- **Người dùng:** tìm kiếm, xem/cập nhật tên và email, tra cứu doanh nghiệp liên quan để hỗ trợ thanh toán, xem lịch sử thay đổi. Trang chi tiết không có thao tác quản lý công việc hoặc nhân sự.
- **Thuê bao:** xem và điều chỉnh gói, chu kỳ, trạng thái, ngày hết hạn. Thay đổi cần lý do; hạ gói phải đủ số chỗ cho thành viên và lời mời đang chờ. Điều chỉnh không tạo giao dịch tiền, không sửa hóa đơn.
- **Thanh toán:** tra cứu hóa đơn và mã BillGateway. Trạng thái thanh toán không thể sửa thủ công.
- **Nhật ký quản trị:** người thực hiện, thời gian, đối tượng, lý do và các trường thực sự thay đổi. Modal diễn giải giá trị trước/sau bằng tiếng Việt; mã nội bộ và JSON được thu gọn trong phần thông tin kỹ thuật.
- **Cấu hình:** chỉnh sửa địa chỉ ứng dụng, tên/giá gói/giới hạn thành viên, kết nối BillGateway và SMTP. Mỗi lần lưu cần lý do và được ghi nhật ký. Cấu hình lưu trong DB được ưu tiên hơn biến môi trường, có hiệu lực ngay và tồn tại sau khi khởi động lại. Giá mới áp dụng cho hóa đơn tạo mới; hóa đơn đang chờ giữ nguyên số tiền. Không thể hạ giới hạn dưới tổng thành viên và lời mời đang chờ của doanh nghiệp dùng gói.

Khóa API, khóa webhook và mật khẩu SMTP chỉ nhập để thay thế: để trống sẽ giữ giá trị hiện tại, tùy chọn xóa cần được chọn rõ ràng. API đọc và nhật ký chỉ trả trạng thái đã cấu hình, không trả khóa bí mật. Trạng thái cấu hình không đồng nghĩa đã kiểm tra kết nối thực tế. Thay đổi địa chỉ ứng dụng không tự thay tên miền, reverse proxy hay danh sách `FRONTEND_ORIGIN`.

Tài khoản chưa có quyền thấy màn hình “Không phận sự miễn vào”, với minh họa SVG chuyển động, nút dừng/bật và hỗ trợ tùy chọn giảm chuyển động trên thiết bị.

Danh sách có tìm kiếm, bộ lọc phù hợp và phân trang 20 dòng. MRR là ước tính từ giá gói hiện tại, gói năm chia 12; không phải doanh thu kế toán. Giao diện dùng múi giờ của thiết bị.

Cấp hoặc thu hồi quyền cho tài khoản đã tồn tại bằng lệnh trên máy chủ:

```sh
npm run admin -- grant demo@nhactoi.local
npm run admin -- revoke user@example.com
```

Quyền được kiểm tra lại từ DB ở mỗi yêu cầu API. Không có API công khai để tự cấp quyền; lệnh thu hồi bảo vệ admin hoạt động cuối cùng. Lệnh seed không tự cấp admin. Môi trường EnvKit trên máy hiện tại đã cấp quyền cho tài khoản mẫu `demo@nhactoi.local` để kiểm thử các trang quản trị; không dùng tài khoản mẫu khi triển khai thật.

## Quy ước menu thao tác

- Gom các thao tác phụ theo ngữ cảnh vào dropdown dấu **⋮** bằng `src/ActionMenu.jsx`; dùng tên thao tác và icon rõ ràng.
- Giữ nút chính (tạo mới, lưu, gửi) và nút hủy của biểu mẫu hiển thị trực tiếp. Bộ lọc, tab và chuyển dạng xem vẫn là điều khiển riêng.
- Chỉ đưa vào menu các thao tác được phép; thao tác nguy hiểm vẫn đi qua hộp thoại xác nhận hiện có.
- Menu hỗ trợ phím mũi tên, Home/End, Escape và Tab; hiển thị qua portal để không bị cắt trong bảng cuộn.

## Bộ trang lỗi Gen Z

Mở **https://nhactoi.test/#/errors** để xem bộ thiết kế. Từ admin có thể vào **Cấu hình → Xem bộ thiết kế**. Mỗi bản xem thử có nhãn rõ ràng và không tạo lỗi hoặc giao dịch thật.

Có thiết kế riêng cho **400, 401, 402, 403, 404, 408, 409, 410, 422, 423, 429, 500, 502, 503, 504**; các mã 4xx/5xx khác dùng nội dung dự phòng phù hợp. Đường dẫn mẫu: `#/errors/404`, `#/errors/500`. Minh họa SVG chuyển động được đóng gói cùng ứng dụng, có nút dừng/bật và mặc định dừng nếu thiết bị yêu cầu giảm chuyển động.

Đã kết nối với các trường hợp thực tế:

- Đường dẫn trang/hash không tồn tại hiển thị 404; máy chủ production trả HTTP 404 cho đường dẫn trang không được hỗ trợ.
- Tài khoản không có quyền quản trị thấy trang 403. Các API vẫn kiểm tra quyền ở máy chủ.
- Lỗi tải phiên khởi động hoặc lỗi đọc dữ liệu admin hiển thị trang lỗi phù hợp, có thể thử lại; lỗi mạng khi gọi API hiển thị 503. Lỗi API không bị hiểu nhầm thành yêu cầu đăng nhập.
- Lỗi render React được Error Boundary hiển thị bằng trang 500.
- Lỗi kiểm tra dữ liệu khi gửi biểu mẫu vẫn hiển thị ngay tại biểu mẫu/thông báo, để người dùng sửa mà không mất nội dung đang nhập. API giữ phản hồi JSON và mã HTTP cho các ứng dụng tích hợp.

Các trang này chạy trong ứng dụng. Nếu nginx/EnvKit hoặc toàn bộ máy chủ ngừng phục vụ cả HTML và JavaScript, cần cấu hình trang lỗi ở reverse proxy riêng; bộ trang React không thể chạy khi chưa tải được ứng dụng.

## Kết nối BillGateway

Dùng project Payment Hub của dự án `/Users/ledung/Documents/Github/billgateway`. Không dùng API key truy vấn giao dịch ngân hàng thay cho project key.

1. Tạo project Nhắc tôi trên BillGateway, lấy **project API key** (`bg_proj_…`) và webhook secret.
2. Vào **Quản trị SaaS → Cấu hình → BillGateway** để nhập kết nối, hoặc điền `BILLGATE_API_URL`, `BILLGATE_API_KEY`, `BILLGATE_WEBHOOK_SECRET` trong `.env`. `BILLGATE_API_URL` là origin của gateway, ví dụ `https://gateway.example.com`, không kèm `/api/v1`. Có thể đặt `BILLGATE_PROJECT_ID` để khóa đúng project.
3. Trên project BillGateway đặt webhook tới `https://<ten-mien-nhac-toi>/api/billing/webhook`.
4. Nếu sửa `.env`, khởi động lại API Nhắc tôi; lưu trên giao diện quản trị có hiệu lực ngay. Chủ không gian mở **Gói dịch vụ**, chọn tháng/năm và gói để tạo hóa đơn.

Nhắc tôi gọi `POST /api/v1/integration/payments` phía máy chủ với project API key. Số tiền lấy từ cấu hình gói trên máy chủ, không lấy từ trình duyệt. Người dùng được chuyển sang `hostedUrl` của hóa đơn BillGateway. Mỗi kỳ được thanh toán bằng một hóa đơn; không tự trừ tiền định kỳ. Gia hạn cùng gói nối tiếp hạn hiện tại; đổi sang gói khác bắt đầu kỳ mới tại lúc thanh toán, không cộng dồn thời gian còn lại của gói cũ. Quy tắc này được hiển thị ngay trên màn hình chọn gói.

Webhook xác thực HMAC-SHA256 trên raw body theo header `x-billgate-signature`. Chỉ xác nhận thanh toán phù hợp hóa đơn đã lưu mới được gia hạn. Tải lại trang hay mở URL trả về không tự kích hoạt gói; thông báo trùng không gia hạn thêm lần nữa.

BillGateway không nhận callback localhost/IP riêng. `nhactoi.test` chỉ phân giải trên máy này nên gateway bên ngoài không gọi được. Kiểm thử webhook bên ngoài cần tên miền HTTPS có thể truy cập được hoặc tunnel được chủ dự án cho phép. Ở lịch sử thuê bao, chủ không gian chọn **Kiểm tra thanh toán** để đối soát lại hóa đơn qua API khi bỏ lỡ webhook. Không tự mở tunnel hoặc công khai môi trường local.

**Hiện chưa có khóa project được cấu hình và chưa chạy giao dịch tiền thật.** Kiểm thử tích hợp dùng gateway giả lập theo hợp đồng API thực tế, trong database cách ly.

## Dữ liệu và phạm vi bản đầu

Stack: React + Vite, Express 5, SQLite (`node:sqlite`), Nodemailer tùy chọn. Font tiếng Việt được đóng gói cùng app. Không cần MySQL để chạy bản thử nghiệm này.

Dữ liệu mặc định ở `data/nhactoi.sqlite`. Migration theo phiên bản chạy khi mở DB. Kiểm thử dùng DB tạm, không dùng DB đang chạy. Khóa kết nối lưu trong DB được mã hóa AES-256-GCM. Mặc định khóa mã hóa được tạo tại `data/.nhactoi-settings.key` với quyền `0600`; có thể dùng `NHACTOI_SETTINGS_KEY` hoặc `NHACTOI_SETTINGS_KEY_FILE` trên máy chủ. Khi sao lưu thủ công, dừng API rồi sao lưu toàn bộ thư mục `data/`, bao gồm tệp khóa ẩn; nếu dùng khóa từ môi trường hoặc đường dẫn riêng, lưu bản sao khóa đó an toàn cùng quy trình sao lưu. Cần đúng khóa để giải mã khi phục hồi; không đổi hoặc xóa khóa nếu đã lưu thông tin kết nối. Phục hồi khi API đang dừng. Không xóa DB để cập nhật phiên bản.

Đây là bản MVP chạy local cho các luồng cốt lõi. Chưa có Web Push/SMS/Zalo, khôi phục mật khẩu qua email, hóa đơn điện tử hay hệ thống vận hành production nhiều máy. Dữ liệu, thư mục `demo/` và tệp nén tham khảo không được phục vụ qua Express production; chỉ thư mục `dist/` được phục vụ công khai.
