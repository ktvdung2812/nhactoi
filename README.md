# Nhắc tôi

SaaS tiếng Việt quản lý công việc, nhắc lịch dịch vụ, cộng tác nhóm và sổ thu–chi. Gói thuê bao theo tháng/năm, thanh toán qua VC Billing (tên cũ BillGateway). Dự án độc lập ở thư mục gốc; `demo/task-crm` là mã tham khảo và không bị sửa.

Nhập/xuất JSON của bảng hỗ trợ tối đa **500 công việc, 40 cột và 1 MiB payload UTF-8** mỗi lần. Dung lượng được tính trên JSON gửi lên API (gồm bảng đích và dữ liệu), không tính phần thụt lề của tệp. Cả xuất và nhập dùng cùng giới hạn; bảng vượt giới hạn sẽ nhận thông báo để giảm dữ liệu trước khi xuất. Tệp đính kèm, bình luận và tài khoản không nằm trong bản xuất bảng; hãy dùng sao lưu hệ thống để phục hồi đầy đủ.

## Chạy thử với EnvKit

Website trên máy này: **https://nhactoi.test**.

- Next.js phục vụ giao diện và toàn bộ `/api/*` trong **một tiến trình**, tại `127.0.0.1:5170` qua Dev server của EnvKit (`npm run dev`).
- nginx của EnvKit chuyển tiếp toàn bộ website tới cổng này. Không còn Vite hay API riêng tại cổng 3100.
- Trong Configuration chọn framework **Next.js**; trong Overview bật Dev server, dùng script `dev`, cổng `5170`. Tắt tiến trình **Nhac Toi API** cũ; `envkit.json` không khai báo worker riêng vì worker đã nằm trong Next. Máy hiện tại đã được chuyển theo cấu hình này.
- Chọn runtime Node 24 trở lên trong EnvKit. Đặt `PUBLIC_APP_URL=https://nhactoi.test` và thêm tên miền vào `FRONTEND_ORIGIN` trong `.env`.
- Bật PostgreSQL trong EnvKit, cấu hình `DATABASE_URL` và giữ `NHACTOI_DATA_DIR=./data`; xem [thiết lập và chuyển dữ liệu cũ](docs/POSTGRESQL.md).
- `.env.example` liệt kê các biến cấu hình; không đưa `.env` vào Git.

Tài khoản dữ liệu mẫu sau khi chạy `npm run seed`:

| Vai trò | Email | Mật khẩu thử nghiệm |
| --- | --- | --- |
| Chủ không gian | `demo@nhactoi.local` | `NhacToi2026!` |
| Quản trị viên | `an@nhactoi.local` | `NhacToi2026!` |
| Thành viên | `minh@nhactoi.local` | `NhacToi2026!` |

Nút đăng nhập nhanh bằng ba tài khoản mẫu (`/api/auth/dev-login`) chỉ bật khi `.env` có `NHACTOI_DEV_LOGIN=true` và `NODE_ENV` khác `production`; không đặt biến này trên máy chủ dùng chung hoặc công khai.

Dữ liệu mẫu được tạo **chỉ khi chạy lệnh seed**, không tự tạo khi khởi động server. Seed không xóa dữ liệu có sẵn. Có thể đăng ký tài khoản riêng từ màn hình đăng nhập để tạo không gian trống, dùng thử 14 ngày. Không đưa dữ liệu mẫu lên môi trường phục vụ khách hàng thật.

## Chạy trực tiếp bằng Node

Cần Node.js **24 trở lên**, khuyến nghị bản Node đã cài trong EnvKit.

```sh
npm install
cp .env.example .env
# Tạo database PostgreSQL và điền DATABASE_URL trong .env trước khi seed.
npm run seed
npm run dev
```

Trước khi chạy trực tiếp, dừng tiến trình Nhắc tôi trong EnvKit để tránh chạy trùng worker/database. Với `.env.example`, ứng dụng và API cùng ở `http://localhost:3000`. Biến `PORT` trong `.env` hoặc `npm run dev -- --port 5170` chọn cổng khác; cập nhật `PUBLIC_APP_URL` và `FRONTEND_ORIGIN` tương ứng.

Tạo `.env.test.local` với `TEST_DATABASE_URL` trỏ đến database kiểm thử riêng theo [hướng dẫn PostgreSQL](docs/POSTGRESQL.md).

```sh
npm test
npm run build
npm run test:next
npm start
```

`npm start` và `npm run dev` kiểm tra PostgreSQL rồi áp dụng migration trước khi mở Next. `npm start` phục vụ bản build Next.js và API trên cùng cổng (`PORT`, mặc định 3000). Production cần HTTPS reverse proxy; đặt `PUBLIC_APP_URL` và `FRONTEND_ORIGIN` theo tên miền thật. Cookie production có cờ Secure nên không dùng HTTP trực tiếp để đăng nhập production.

Quy trình Git Manager, webhook và vận hành `nhactoi.ktvdung.io.vn`: [Triển khai trên aaPanel](docs/DEPLOYMENT.md).

## Kiến trúc Next.js full stack

- `app/`: App Router, layout tiếng Việt, trang ứng dụng, trang lỗi và HTTP 404 cho URL không được hỗ trợ. Các màn hình nghiệp vụ hiện có trong `src/` là Client Components, điều hướng bằng Next.js.
- `pages/api/[[...path]].js`: Next API Route xử lý mọi `/api/*` trong cùng máy chủ. Router Express trong `server/index.mjs` giữ hợp đồng API, middleware phân quyền và nghiệp vụ; không mở cổng API riêng, không proxy tới dịch vụ khác.
- API tắt bộ đọc body mặc định của Next để giữ đúng byte webhook HMAC và stream tải tệp. Giới hạn JSON/tệp tiếp tục được kiểm tra trong tầng API.
- `server/runtime.mjs` giữ một kết nối PostgreSQL và một worker cho mỗi tiến trình. `instrumentation.js` khởi động worker khi Next server sẵn sàng, kể cả khi chưa có request; build không khởi tạo DB hay worker.
- `server/`, `shared/`: nghiệp vụ, database, tích hợp và hợp đồng chung với mobile. Các lệnh seed, admin và restore vẫn chạy ngoại tuyến bằng Node.
- `npm test`: bộ kiểm thử nghiệp vụ với DB tạm. `npm run test:next`: kiểm thử tích hợp qua máy chủ Next production sau `npm run build`, dùng DB riêng.

Triển khai trên một Node server chạy liên tục, có volume lưu `data/` và các kho tệp đã cấu hình. PostgreSQL, tệp riêng và lịch chạy nền hiện tại cần môi trường này; không triển khai bằng static export, Edge runtime hoặc hàm serverless tạm thời. Sau khi thay đổi mã nghiệp vụ backend trong lúc phát triển, khởi động lại `npm run dev` để nạp lại singleton và worker.

## Các luồng đã có

- Đăng ký doanh nghiệp, đăng nhập/đăng xuất, phiên làm việc lưu bằng cookie HttpOnly. Mật khẩu băm bằng scrypt, token phiên chỉ lưu hash trong DB.
- Dữ liệu tách theo không gian; vai trò chủ không gian, quản trị viên và thành viên. Có thể chuyển giữa các không gian đã được tham gia từ bộ chọn ở góc trên bên trái.
- Mục **Công việc** là một bảng cho công việc, lịch hẹn và mốc nhắc, theo cột **Cần làm → Đang làm → Hoàn thành**. Lịch hẹn vẫn giữ giờ bắt đầu/kết thúc và lời nhắc; hoàn thành lịch hẹn sẽ dừng nhắc. Đường dẫn cũ `/calendar` và `/events` mở cùng bảng này. Dữ liệu cũ được giữ nguyên.
- Hoàn thành một việc lặp theo ngày/tuần/tháng sẽ tạo kỳ tiếp theo một lần. Lịch lặp theo tháng sử dụng ngày lịch Việt Nam (Asia/Ho_Chi_Minh); ngày cuối tháng được chặn theo số ngày thực tế của tháng sau.
- Lịch nhắc tạo thông báo trong ứng dụng ở phía máy chủ; giao diện cập nhật khoảng 30 giây/lần. **Máy chủ phải đang chạy**. Đóng trình duyệt không làm mất lịch; tắt máy hoặc tắt EnvKit thì lịch được xử lý khi máy chủ chạy lại. Web Push của trình duyệt là kênh tùy chọn, cần cấu hình VAPID và người dùng bật tại Tài khoản (xem đợt 3). App Android có luồng FCM riêng, phụ thuộc cấu hình Firebase và bản app đã build.
- Email nhắc việc là tùy chọn, chỉ hoạt động khi cấu hình SMTP. Lời mời nhóm được tạo thành liên kết để tự gửi; ứng dụng không tự gửi email mời.
- Hồ sơ khách hàng và dịch vụ. Sổ thu–chi VND với danh mục, khách hàng liên quan và tổng theo tháng. Đây là sổ quản lý nội bộ.
- Gói Starter, Team, Business với giới hạn 3/10/50 thành viên. Giá mẫu sửa trong quản trị SaaS hoặc qua biến môi trường khi chưa có cấu hình lưu; giá năm là tổng cho 12 tháng. Quyền ghi dữ liệu được chặn khi thuê bao hết hạn; vẫn có thể đọc dữ liệu và gia hạn.

## Inbox và kế hoạch cá nhân

- Web có **Inbox** (`/inbox`), **Hôm nay** (`/today`) và **Sắp tới** (`/upcoming`). Hiển thị việc giao cho bạn (gồm người phối hợp) và việc bạn tạo chưa giao ai, trong workspace hiện tại và theo quyền team. Đây là góc nhìn cá nhân; công việc vẫn giữ quyền chia sẻ hiện có, không tự trở thành việc riêng tư.
- **Thêm việc nhanh** chỉ cần nội dung; hạn hoàn thành không bắt buộc trên web/API và Android. Nhận diện giới hạn các cụm “hôm nay”, “mai”, “ngày mai”, “ngày kia” và giờ `9h`, `9h30`, `09:30`. Có ngày chưa có giờ thì gợi ý 17:00. Luôn xem trước tên/hạn, có thể sửa giờ hoặc tắt nhận diện để giữ nguyên câu. Kế hoạch và nhận diện dùng giờ Việt Nam (UTC+7).
- Inbox chứa việc chưa có hạn và chưa chọn ngày làm. **Làm hôm nay** hoặc **Ngày dự định làm** lưu kế hoạch riêng từng người; không sửa deadline, không thay lịch nhắc và không ảnh hưởng kế hoạch của người cùng được giao. Hôm nay hiển thị việc đến hạn/ngày làm hôm nay, cùng nhóm **Cần xem lại** cho việc quá hạn hoặc kế hoạch cũ chưa hoàn thành. Sắp tới nhóm theo mốc tương lai sớm nhất giữa hạn và ngày làm.
- Thêm nhanh có tùy chọn **Nhắc đúng hạn** khi đặt hạn. Không đặt hạn thì không tự phát sinh lời nhắc. Lời nhắc có thời điểm riêng vẫn hoạt động; chuỗi nhắc theo deadline bỏ qua việc chưa có hạn. Công việc lặp vẫn bắt buộc có hạn. Sao chép, mẫu, nhập/xuất bảng hỗ trợ hạn trống cho việc không lặp.
- Android đọc, sửa và tạo được việc chưa có hạn; việc chưa có hạn xếp sau việc có lịch và không bị tính là quá hạn. Ba màn hình kế hoạch cá nhân hiện có trên web; chưa bổ sung màn hình tương ứng trên Android.
- API `GET /api/personal-tasks` trả công việc kèm `plannedDate` của người đăng nhập. `PATCH /api/tasks/:id/plan` nhận `{ plannedDate: "YYYY-MM-DD" }` hoặc `null` để bỏ kế hoạch. Hết thuê bao, workspace tạm ngưng hoặc team lưu trữ không cho ghi.
- Migration **29** cho phép `tasks.due_at` rỗng và thêm `personal_task_plans`. Migration dựng lại bảng tasks trong transaction, giữ bản ghi liên quan/index/trigger và kiểm tra foreign key. Sao lưu DB/kho tệp trước khi triển khai, khởi động lại Next để nạp backend; Android cần build lại. Không đổi migration đã áp dụng và không xóa dữ liệu để nâng cấp.

### Cá nhân & freelancer — đợt 2

- **Lịch tuần** (`/week`) hiển thị Thứ 2–Chủ nhật theo giờ Việt Nam: lịch làm cá nhân, deadline, lịch hẹn được phép xem và kỳ gia hạn hiện tại của dịch vụ bật đồng bộ lịch. Deadline luôn có mục riêng kể cả khi ngày làm khác ngày hạn. Lịch hẹn nhiều ngày xuất hiện ở từng ngày giao nhau; giờ kết thúc đúng 00:00 không chiếm ngày kế tiếp. Việc/lịch hẹn đã hoàn thành không hiển thị.
- “Lên lịch việc” chọn công việc hiện có, ngày làm, giờ bắt đầu tùy chọn và thời lượng 15–1440 phút, kết thúc trong cùng ngày. “Sắp lịch” hỗ trợ bàn phím/điện thoại; máy tính có thể kéo mục dự định làm sang ngày khác. Lịch chỉ áp dụng cho từng người, không sửa deadline/nhắc. Tạo việc mới qua Inbox hoặc Công việc trước khi lên lịch.
- `PATCH /api/tasks/:id/plan` nhận `{ plannedDate: "2026-10-01", plannedTime: "09:00", plannedDuration: 90 }`. Bỏ giờ bằng `plannedTime: null`, bỏ cả lịch bằng `plannedDate: null`. Bỏ qua giờ/thời lượng khi cập nhật ngày sẽ giữ giá trị cũ. `GET /api/personal-tasks` trả thêm `plannedTime`, `plannedDuration` (mặc định 60 phút).
- **Lặp nâng cao** trên web/Android: theo ngày/tuần/tháng/năm, mỗi 1–365 kỳ, chọn thứ trong tuần và preset Thứ 2–Thứ 6 (chưa loại trừ ngày lễ). `recurrenceOptions: { interval: 2, weekdays: [1,3], basis: "due" }`; thứ 1=Thứ 2, 7=Chủ nhật, chỉ dùng `weekdays` với `weekly`. `basis` là `due` (hạn kỳ trước) hoặc `completion` (thời điểm hoàn thành). Client cũ không gửi options vẫn giữ quy tắc nếu không đổi tần suất.
- Kỳ tiếp theo chỉ tạo một lần sau hoàn thành, kể cả qua board/automation; chưa dựng trước các kỳ tương lai trong lịch. Mốc `due` có thể tạo kỳ còn quá hạn nếu hoàn thành muộn. Mốc `completion` tính cả giờ từ lúc hoàn thành. Lặp theo hạn giữ ngày gốc qua tháng ngắn/năm nhuận (31/1 → 28/2 → 31/3). Khi đổi hạn/quy tắc, mốc gốc được đặt lại. Sao chép/template giữ quy tắc và lấy hạn mới làm mốc; nhập/xuất board giữ mốc gốc.
- Migration **30** mở rộng ràng buộc lặp, thêm quy tắc/mốc gốc và giờ/thời lượng kế hoạch. Sao lưu DB trước triển khai; khởi động lại Next để áp dụng. Android cần build lại để dùng các điều khiển mới. Chưa có Google Calendar sync, Web Push hay ghi offline trong đợt này.

- Kiểm tra mới: `node --test tests/personal-*.test.mjs`; kiểm tra đầy đủ dùng `npm test`, build và `npm run test:next`, cùng bộ kiểm thử Android. Email/FCM thật vẫn cần cấu hình và thiết bị để xác minh; thay đổi này chưa thêm Web Push hay phát hành store.

### Cá nhân & freelancer — đợt 3

- **Web Push**: vào **Tài khoản → Thông báo & ứng dụng web → Bật thông báo**. Chỉ thao tác này mới yêu cầu quyền trình duyệt. Đăng ký riêng cho mỗi trình duyệt/phiên, nhận nhắc việc, cập nhật công việc, lịch hẹn và gia hạn từ các workspace còn quyền truy cập. Có thể tắt riêng; đăng xuất, reset mật khẩu hoặc vô hiệu tài khoản sẽ hủy đăng ký phía máy chủ. Chuyển workspace giữ đăng ký. Sau khi đăng nhập lại/hết phiên, cần bật lại.
- Thông báo ngoài ứng dụng chỉ có nội dung chung. Bấm thông báo sẽ xác thực lại, chuyển đến workspace và mở công việc/lịch hẹn/dịch vụ tương ứng nếu còn quyền. Không tự đánh dấu đã đọc. Trình duyệt/hệ điều hành có thể trì hoãn thông báo; cần máy chủ/worker đang chạy, không bảo đảm gửi khi trình duyệt bị buộc dừng.
- **Cài ứng dụng web**: dùng nút “Cài Nhắc tôi” khi trình duyệt cung cấp, hoặc menu Cài ứng dụng/Thêm vào Màn hình chính. Trên iPhone/iPad hỗ trợ Web Push, mở ứng dụng từ Màn hình chính rồi bật thông báo. Manifest, icon và service worker đi kèm; mất mạng hiển thị trang hướng dẫn kết nối lại. Không cache API, trang có xác thực hay dữ liệu công việc; chưa hỗ trợ ghi offline.
- Migration **31** thêm đăng ký trình duyệt và hàng đợi theo từng thông báo/trình duyệt. Chỉ xếp hàng các thông báo mới sau khi đăng ký; không gửi lại lịch sử. Kiểm tra lại tài khoản, phiên, workspace/team, trạng thái việc và chính sách hoãn/giờ yên lặng trước mỗi lần gửi. Thành công ở một trình duyệt không bị gửi lại khi trình duyệt khác lỗi; lỗi tạm thời retry tối đa 5 lần, đăng ký 404/410 tự xóa, thông báo chờ hơn 24 giờ bị bỏ qua. Push service giữ thông báo tối đa 1 giờ. Network timeout vẫn có thể dẫn đến gửi trùng; notification tag gộp cùng một thông báo.
- Địa chỉ đăng ký chỉ chấp nhận các push service Chrome/Firefox/Edge/Safari được hỗ trợ, không gửi HTTP đến URL tùy ý do client cung cấp. Khóa VAPID riêng không trả về client, không ghi endpoint/khóa vào lỗi worker. Hiện giữ mô hình một tiến trình worker như FCM/email.

Cấu hình máy chủ (không cần Firebase cho Web Push):

```bash
npm run web-push:keys
```

Lưu cặp `publicKey`/`privateKey` vừa tạo vào `WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY`; đặt `WEB_PUSH_SUBJECT=mailto:dia-chi-quan-tri@ten-mien-cua-ban`. Giữ private key trong secret store/.env không commit, giữ cùng cặp khóa qua các lần triển khai. Sao lưu DB, khởi động lại Next để nạp migration/cấu hình. Dùng HTTPS ngoài localhost; bảo đảm proxy phục vụ `/sw.js`, `/manifest.webmanifest`, `/icons/*`, `/offline.html` và cho máy chủ gọi HTTPS outbound đến push services. Thiếu/sai cấu hình thì Web Push tắt, các kênh nhắc cũ vẫn hoạt động. Khi đổi cặp khóa, người dùng vào Tài khoản bật lại đăng ký.

Kiểm thử tự động: `node --test tests/web-push.test.mjs tests/web-app.test.mjs`, toàn bộ `npm test`, build và `npm run test:next`. Transport push được giả lập trong test, không gửi thông báo thật. Sau triển khai, bật trên trình duyệt thật, tạo một lời nhắc tương lai cho chính mình, đóng tab và kiểm tra nhận/bấm thông báo; thử tắt quyền, đăng xuất và chuyển workspace. Phần này cần VAPID, HTTPS và thiết bị thực tế.


## Đăng ký và khôi phục mật khẩu

- Web và app mobile đều có **Đăng ký** và **Quên mật khẩu** ở màn hình đăng nhập. Đăng ký tạo không gian dùng thử 14 ngày; web dùng cookie, mobile dùng phiên bearer lưu trong SecureStore.
- Quên mật khẩu gửi mã 6 chữ số qua email. Nhập email, mã và mật khẩu mới trên web hoặc app. Mã dùng một lần, hết hạn sau 15 phút và không còn dùng được sau 5 lần nhập sai. Có thể yêu cầu mã mới sau 60 giây, tối đa 5 lần/giờ cho mỗi email.
- Sau khi đặt lại mật khẩu, mọi phiên web/mobile cũ bị thu hồi; người dùng đăng nhập lại bằng mật khẩu mới. Liên kết Google cũng bị thu hồi để kẻ đã chiếm phiên không giữ được đường vào; liên kết lại trong **Tài khoản** nếu cần.
- **Liên kết Google** (Tài khoản → Liên kết Google) cần nhập mật khẩu hiện tại; sai 5 lần thì khóa 15 phút cho tài khoản đó. Nút "Tiếp tục với Google" ở màn hình đăng nhập chỉ dùng để đăng nhập, không liên kết tài khoản đang đăng nhập.
- **Đổi email đăng nhập** (Tài khoản → Email đăng nhập) cần mật khẩu hiện tại và mã 6 chữ số gửi tới email mới; email chỉ đổi sau khi xác nhận mã, các phiên khác bị đăng xuất. Tài khoản đăng nhập bằng Google đã liên kết được bỏ trống mật khẩu trong 10 phút sau khi đăng nhập Google; quá thời gian đó, giao diện hiện nút **Đăng nhập lại bằng Google**. Phiên đăng nhập bằng mật khẩu luôn cần mật khẩu, kể cả khi tài khoản đã liên kết Google. Sai mật khẩu 5 lần thì khóa 15 phút cho tài khoản; nhập đúng sẽ xóa bộ đếm. Mỗi tài khoản gửi mã cách nhau ít nhất 60 giây, kể cả sau khi hủy hoặc vừa đổi xong; mỗi địa chỉ nhận tối đa 5 mã/giờ, chỉ tính các lần đã qua bước mật khẩu. Nếu địa chỉ đã thuộc tài khoản khác, giao diện vẫn sang bước nhập mã như thường, còn hộp thư đó chỉ nhận thư cảnh báo không kèm mã, nên không dò được email nào đã đăng ký.
- Cần bật SMTP trong cấu hình quản trị SaaS hoặc qua `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Khi chưa có SMTP, màn hình báo chức năng chưa được cấu hình. Phản hồi yêu cầu mã không tiết lộ email đã có tài khoản hay chưa; khi SMTP gửi lỗi, người dùng có thể yêu cầu lại sau thời gian chờ.

## Quản lý gia hạn dịch vụ và giấy phép

Mở **Quản lý gia hạn** (`/services`) để theo dõi thuê bao, giấy phép vĩnh viễn, dùng thử và bảo trì. Dữ liệu dịch vụ cũ được giữ lại khi nâng cấp.

- Hồ sơ gồm nhà cung cấp, ngày mua/hết hạn, chu kỳ tháng/năm, số lượng, đơn giá, thành tiền, thực chi, tài khoản sử dụng/thanh toán, cổng quản lý, hợp đồng/chứng từ, khách hàng, team và người nhận nhắc. Chỉ lưu thông tin nhận diện tài khoản, không lưu mật khẩu hoặc mã bảo mật thẻ.
- Lọc theo trạng thái còn hạn, sắp hết hạn, quá hạn hoặc tắt theo dõi; tìm kiếm và lọc team. Có xem chi tiết, sao chép và lịch sử gia hạn.
- **Ghi nhận gia hạn** chuyển đến kỳ tiếp theo còn hạn theo lịch Việt Nam, chặn ngày cuối tháng theo tháng đích. Có thể nhập ngày kế tiếp và thực chi; đây là ghi nhận nội bộ, không chuyển tiền. Gia hạn hàng loạt dùng chu kỳ và thành tiền riêng của từng dịch vụ.
- Nhắc **mỗi ngày một lần cho từng người nhận** từ số ngày đã đặt trước hạn và tiếp tục khi quá hạn, cho đến khi gia hạn, tắt theo dõi hoặc lưu trữ. Người nhận là người phụ trách; khi chưa chọn thì gửi chủ sở hữu/quản trị doanh nghiệp có quyền truy cập. Máy chủ xử lý lịch khi đang chạy, không cần mở trình duyệt. Thông báo mở đúng dịch vụ; email tùy thuộc cấu hình SMTP. Email lỗi không làm mất thông báo trong ứng dụng.
- Bật **Hiển thị ngày gia hạn trên board Công việc** để đưa kỳ hiện tại lên lịch lúc 08:00 giờ Việt Nam. Lịch tự cập nhật khi sửa hoặc gia hạn; tắt nhắc vẫn có thể giữ mục lịch. Thông tin thanh toán và tài khoản không đưa vào nội dung lịch.
- Lưu trữ dừng nhắc và ẩn mục lịch, giữ lại hồ sơ/lịch sử để khôi phục. Trong danh sách đã lưu trữ có xóa vĩnh viễn, yêu cầu nhập đúng tên dịch vụ. Gia hạn/lưu trữ/khôi phục hàng loạt tối đa 100 mục mỗi lần, xử lý nguyên khối.
- Quyền truy cập theo không gian và team; team lưu trữ, doanh nghiệp tạm ngưng hoặc thuê bao hết hạn không cho ghi dữ liệu. Lời nhắc cũ không còn hiển thị khi người nhận mất quyền với team của dịch vụ.

## Làm việc theo team

- Một doanh nghiệp có nhiều team; mỗi thành viên có thể tham gia nhiều team mà không tăng số chỗ thuê bao. Mời người vào doanh nghiệp ở **Teams**, sau đó thêm họ vào team. Đường dẫn cũ `/team` mở cùng trang này.
- Chủ doanh nghiệp/quản trị viên tạo và quản lý mọi team. Trưởng nhóm cập nhật thông tin và thêm/bớt thành viên thường trong team của mình; chỉ quản trị doanh nghiệp được thay đổi trưởng nhóm. Mỗi team luôn có ít nhất một trưởng nhóm.
- Mục **Teams** có danh sách team, bảng công việc ba trạng thái và danh sách thành viên. Giao việc cho người trong team, đặt hạn/lịch nhắc và cập nhật tiến độ bằng biểu mẫu công việc hiện có.
- Công việc cũ thuộc **Việc chung của doanh nghiệp**. Biểu mẫu công việc có lựa chọn team; chỉ quản trị doanh nghiệp được chuyển công việc giữa các team hoặc về việc chung. Danh sách công việc và lịch nhắc có bộ lọc theo team.
- Thành viên thường chỉ xem công việc của team mình tham gia và việc chung. Phân quyền được kiểm tra tại API, gồm cả bảng tổng quan, công việc lặp và lời nhắc. Phải giao lại công việc chưa hoàn thành trước khi đưa người phụ trách ra khỏi team.
- Lưu trữ team giữ nguyên lịch sử, dừng cập nhật công việc và nhắc việc. Quản trị doanh nghiệp có thể khôi phục để tiếp tục. Team thuộc phạm vi vận hành doanh nghiệp; quản trị SaaS không có API quản lý nội bộ này.

## Bảng công việc theo cột

- Trang Công việc chỉ có bảng cột; Teams dùng cùng một thành phần `TaskBoard` để giữ giao diện và thao tác nhất quán.
- Ba cột trạng thái hiện tại: Cần làm, Đang làm, Hoàn thành. Mỗi cột có số lượng, vùng thẻ cuộn riêng và nút thêm ở đáy; bảng cuộn ngang trên màn hình nhỏ.
- Kéo thẻ giữa các cột trên desktop hoặc dùng menu **⋮** của thẻ để chuyển trạng thái bằng chuột, cảm ứng hay bàn phím. Trạng thái chỉ cập nhật sau khi máy chủ lưu thành công; công việc lặp lại tiếp tục dùng quy tắc hiện có.
- Menu cột cho phép thu gọn và đổi thứ tự hiển thị trong phiên xem. Đây là thiết lập hiển thị, không đổi quy trình hay trạng thái công việc.
- Team lưu trữ và doanh nghiệp tạm ngưng chỉ xem bảng, không thêm hoặc chuyển thẻ.

## Chi tiết công việc

- Mở từ thẻ Kanban, danh sách, lịch hoặc thông báo tại `/tasks/:id`; liên kết có thể mở trực tiếp.
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

- Trang `/trash` quản lý công việc, khách hàng và khoản thu/chi đã xóa trong doanh nghiệp hiện tại. Xóa thông thường giữ lại dữ liệu để khôi phục; chỉ thao tác xóa vĩnh viễn trong thùng rác mới loại bỏ bản ghi.
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
- Nội dung trao đổi, người thực hiện và lịch sử thay đổi được lưu trong PostgreSQL. Ticket chỉ phục vụ hỗ trợ dịch vụ; không truy cập công việc, khách hàng, nhân sự hoặc sổ thu–chi nội bộ của doanh nghiệp.
- Phiên bản này trao đổi trong ứng dụng, chưa có tệp đính kèm hoặc thông báo email tự động.

## Trợ lý AI dạng chat

- Sau khi đăng nhập, bấm **Trợ lý AI** ở góc dưới bên phải. Cửa sổ hỗ trợ mở rộng, hội thoại mới, xem lại và xóa lịch sử; lịch sử được lưu trên máy chủ, riêng theo tài khoản và không gian.
- Trợ lý dùng công cụ để tìm công việc, đếm tiến độ/quá hạn và soạn bản nháp công việc. Công cụ tìm kiếm áp dụng cùng quyền workspace/team như bảng công việc. Bấm **Kiểm tra và tạo** để sửa bản nháp, chọn team/người phụ trách rồi lưu bằng biểu mẫu hiện có. AI không tự sửa, xóa hay tạo công việc.
- Quản trị SaaS → **Cấu hình → Trợ lý AI**: chọn OpenRouter hoặc Anthropic, tìm/chọn mô hình trong dropdown và nhập khóa API, bật trợ lý rồi lưu kèm lý do. Danh sách model được tải từ nhà cung cấp; OpenRouter chỉ hiển thị model hỗ trợ gọi công cụ, Anthropic dùng khóa đã lưu để tải danh sách. Khi không tải được, giao diện thông báo dùng danh sách dự phòng. Khóa được mã hóa và không trả về trình duyệt/nhật ký. Đổi nhà cung cấp cần khóa mới. Có thể đặt mặc định qua `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`; cấu hình lưu trong quản trị được ưu tiên.
- Nội dung hội thoại và dữ liệu công việc được tra cứu sẽ được gửi tới nhà cung cấp AI đã chọn. Cấu hình thành công không đồng nghĩa khóa, số dư hoặc mô hình đã được kiểm tra; cần gửi một tin nhắn để kiểm tra kết nối thực tế.
- Mỗi lượt gửi tối đa 6.000 ký tự; AI dùng 20 tin nhắn gần nhất làm ngữ cảnh. Mỗi hội thoại tối đa 100 lượt trao đổi và mỗi người tối đa 100 hội thoại/không gian. Có giới hạn 20 lượt gửi/10 phút/người dùng và một yêu cầu đang chạy tại một thời điểm trong tiến trình máy chủ. Thuê bao hết hạn không gọi được AI; vẫn xem/xóa được lịch sử.
- Sau khi cập nhật backend trên máy đang chạy, khởi động lại dev server để nạp API và migration mới. Kiểm thử tự động dùng phản hồi nhà cung cấp giả lập, không tiêu tốn API thật.

## Trợ lý @Vyvy trong bình luận

Hợp đồng API, vận hành và kết quả kiểm thử: [docs/COMMENT_ASSISTANT.md](docs/COMMENT_ASSISTANT.md).

- Trên web/mobile, gửi `@vyvy tóm tắt trao đổi, tạo checklist và giao cho An`. Gợi ý khi gõ `@` phân biệt trợ lý với thành viên; tên gọi gõ tay không phân biệt hoa/thường. Owner/admin đổi tên, tên gọi hoặc bật/tắt tại **Tài khoản → Trợ lý trong bình luận**. Nhà cung cấp, mô hình và khóa dùng chung với cấu hình AI của SaaS; hội thoại riêng vẫn hoạt động như trước.
- Bình luận được lưu trước khi xử lý. Trạng thái và phản hồi AI được chia sẻ trong công việc, gồm bình luận gốc, nguồn và kết quả từng thao tác. Đóng màn hình không hủy yêu cầu. Sửa/xóa bình luận gọi dừng phần chưa thực hiện; những thay đổi đã lưu được giữ. Chỉ người gọi thử lại lượt lỗi; mất quyền hoặc xung đột revision cần gửi yêu cầu mới sau khi kiểm tra dữ liệu.
- Trợ lý đọc toàn bộ thông tin và lịch sử công việc hiện tại, nhãn, trường tùy chỉnh, checklist, người tham gia, liên kết và tài liệu. Việc khác được tra cứu trong cùng dự án khi cần. Hội thoại riêng và dữ liệu CRM không được đưa vào ngữ cảnh bình luận chung. Người có quyền bình luận được hỏi/nhận đề xuất; tạo/sửa công việc, phân công và checklist dùng đúng quyền chỉnh sửa hiện tại. Xóa dữ liệu và đổi quyền thực hiện tại màn hình hiện có.
- Đọc DOCX, XLSX/CSV, TXT/Markdown qua bộ trích xuất; không chạy macro/công thức. PDF (kể cả scan) và PNG/JPEG/WebP gửi trực tiếp tới mô hình hỗ trợ tài liệu/ảnh. Cấu hình hiển thị khả năng của mô hình; khả năng chưa xác nhận được coi là chưa hỗ trợ. Đọc tệp kho nội bộ/S3/Drive và các URL công khai được dẫn; kiểm tra DNS/redirect, không dùng cookie ứng dụng, không thu thập trang khác.
- Giới hạn mỗi nguồn: tệp 10 MiB, URL 2 MiB, tổng tệp 25 MiB, 100 nguồn, 20 giây tải/nguồn. Nội dung dài được chia phần và tổng hợp kèm ID nguồn; tối đa 250.000 ký tự trích xuất/nguồn, 60.000 ký tự văn bản nguồn trước tổng hợp ngữ cảnh. Nguồn lỗi, quá lớn, trang cần đăng nhập/JavaScript hoặc bị cắt luôn có trạng thái riêng. Giới hạn toàn lượt 10 phút, 90 giây/lần gọi mô hình, 12 vòng công cụ, tối đa 5 lần thử và 20 lượt xử lý/10 phút/người/không gian (gồm thử lại).
- Triển khai migration PostgreSQL **015** và backend trước web/mobile (`npm run db:migrate`, build rồi khởi động lại dịch vụ). Worker dùng hàng đợi PostgreSQL cùng transaction với bình luận và mutation receipts; cần bật background worker. Sau crash, lease hết hạn tối đa 15 phút được nhận lại; shutdown bình thường giải phóng lease ngay. Sao lưu/khôi phục giữ cấu hình, lượt chạy và metadata AI; cơ chế tạm dừng gửi sau restore vẫn áp dụng.
- Theo dõi bằng ID trong `ai_comment_runs`, `actions_json` và log `assistant run completed/failed` (thời gian, mã lỗi, số thao tác hoàn tất). Log không ghi khóa API hoặc nguyên văn tài liệu. Các kiểm thử nhà cung cấp dùng mock; cần kiểm tra mô hình đã chọn với tài liệu thực tế trước khi mở rộng sử dụng.

## Quyền quản trị SaaS

Truy cập **https://nhactoi.test/admin/overview** hoặc chọn **Quản trị SaaS** trong menu sau khi tài khoản được cấp quyền. Quyền này độc lập với vai trò chủ không gian/quản trị viên của một doanh nghiệp; đăng ký thông thường không cấp quyền admin SaaS.

Phạm vi quản trị SaaS là **thanh toán, thông tin liên hệ và nhật ký hỗ trợ**. API quản trị không trả thống kê công việc, khách hàng, thu–chi nội bộ hoặc danh sách nhân sự doanh nghiệp. Số chỗ sử dụng được giữ trong thông tin thuê bao để đối chiếu giới hạn gói. Các nghiệp vụ nội bộ thuộc không gian riêng của khách hàng.

Khu vực quản trị gồm:

- **Tổng quan:** doanh nghiệp, người dùng, thuê bao còn hạn, MRR ước tính và tiền thu từ hóa đơn đã xác nhận.
- **Doanh nghiệp:** tìm kiếm, lọc và mở hồ sơ liên hệ/thanh toán. Chỉnh sửa tên, ngành nghề, email, điện thoại, địa chỉ, website, mã số thuế, ghi chú hỗ trợ; xem đầu mối liên hệ, thuê bao, hóa đơn và nhật ký.
- **Người dùng:** tìm kiếm, xem/cập nhật tên và email, tra cứu doanh nghiệp liên quan để hỗ trợ thanh toán, xem lịch sử thay đổi. Trang chi tiết không có thao tác quản lý công việc hoặc nhân sự.
- **Thuê bao:** xem và điều chỉnh gói, chu kỳ, trạng thái, ngày hết hạn. Thay đổi cần lý do; hạ gói phải đủ số chỗ cho thành viên và lời mời đang chờ. Điều chỉnh không tạo giao dịch tiền, không sửa hóa đơn.
- **Thanh toán:** tra cứu hóa đơn và mã VC Billing. Danh sách hiển thị mã thanh toán, tạm tính, VAT, tổng tiền và trạng thái (Chờ thanh toán, Thanh toán một phần, Đã thanh toán, Đã hủy, Hết hạn, Đã hoàn tiền). Trạng thái thanh toán không thể sửa thủ công.
- **Nhật ký quản trị:** người thực hiện, thời gian, đối tượng, lý do và các trường thực sự thay đổi. Modal diễn giải giá trị trước/sau bằng tiếng Việt; mã nội bộ và JSON được thu gọn trong phần thông tin kỹ thuật.
- **Gói thuê bao** (`/admin/plans`): thêm gói, sửa tên, giá tháng/năm, giới hạn thành viên, quyền lợi hiển thị và bật/ngừng bán. Mã gói giữ nguyên sau khi tạo; không xóa gói để giữ lịch sử. Quyền lợi là mô tả, không tự cấp quyền tính năng; giới hạn thành viên được kiểm soát thực tế. Ngừng bán ẩn gói khỏi trang thanh toán và chặn hóa đơn mới; thuê bao hiện có và xác nhận hóa đơn đã tạo vẫn hoạt động. Có tìm kiếm, lọc trạng thái bán và số doanh nghiệp gắn với gói. Mỗi thay đổi cần lý do và được ghi nhật ký. Giá mới chỉ áp dụng cho hóa đơn mới; không thể giảm giới hạn dưới tổng thành viên và lời mời đang chờ.
- **Cấu hình:** chỉnh sửa địa chỉ ứng dụng, kết nối VC Billing (gồm tiền tố mã thanh toán, thuế VAT, tiền tố SKU và URL webhook để sao chép) và SMTP. Mỗi lần lưu cần lý do và được ghi nhật ký. Cấu hình lưu trong DB được ưu tiên hơn biến môi trường, có hiệu lực ngay và tồn tại sau khi khởi động lại.

Khóa API, khóa webhook và mật khẩu SMTP chỉ nhập để thay thế: để trống sẽ giữ giá trị hiện tại, tùy chọn xóa cần được chọn rõ ràng. API đọc và nhật ký chỉ trả trạng thái đã cấu hình, không trả khóa bí mật. Trạng thái cấu hình không đồng nghĩa đã kiểm tra kết nối thực tế; với VC Billing, dùng nút **Kiểm tra kết nối** để gọi thử API. Thay đổi địa chỉ ứng dụng không tự thay tên miền, reverse proxy hay danh sách `FRONTEND_ORIGIN`.

Tài khoản chưa có quyền thấy màn hình “Không phận sự miễn vào”, với minh họa SVG chuyển động, nút dừng/bật và hỗ trợ tùy chọn giảm chuyển động trên thiết bị.

Danh sách có tìm kiếm, bộ lọc phù hợp và phân trang 20 dòng. MRR là ước tính từ giá gói hiện tại, gói năm chia 12; không phải doanh thu kế toán. Giao diện dùng múi giờ của thiết bị.

Migration (`npm run db:migrate` hoặc lúc khởi động) tự tạo admin SaaS khi chưa
có admin hoạt động, giữ nguyên tài khoản/mật khẩu đã có. Có thể đặt thông tin
qua `BOOTSTRAP_ADMIN_*`; mặc định email `admin@nhactoi.local` và mật khẩu ngẫu
nhiên được lưu trong `data/bootstrap-admin-user_*.json` (quyền `0600`). Xem
[hướng dẫn khởi tạo admin](docs/POSTGRESQL.md#admin-saas-ban-đầu).

Cấp hoặc thu hồi quyền cho tài khoản đã tồn tại bằng lệnh trên máy chủ:

```sh
npm run admin -- grant demo@nhactoi.local
npm run admin -- revoke user@example.com
```

Quyền được kiểm tra lại từ DB ở mỗi yêu cầu API. Không có API công khai để tự cấp quyền; lệnh thu hồi bảo vệ admin hoạt động cuối cùng. Seed không cấp quyền admin cho người dùng mẫu; migration có thể tạo admin riêng trước khi seed. Môi trường EnvKit trên máy hiện tại đã cấp quyền cho tài khoản mẫu `demo@nhactoi.local` để kiểm thử các trang quản trị; không dùng tài khoản mẫu khi triển khai thật.

## Quy ước menu thao tác

- Gom các thao tác phụ theo ngữ cảnh vào dropdown dấu **⋮** bằng `src/ActionMenu.jsx`; dùng tên thao tác và icon rõ ràng.
- Giữ nút chính (tạo mới, lưu, gửi) và nút hủy của biểu mẫu hiển thị trực tiếp. Bộ lọc, tab và chuyển dạng xem vẫn là điều khiển riêng.
- Chỉ đưa vào menu các thao tác được phép; thao tác nguy hiểm vẫn đi qua hộp thoại xác nhận hiện có.
- Menu hỗ trợ phím mũi tên, Home/End, Escape và Tab; hiển thị qua portal để không bị cắt trong bảng cuộn.

## Bộ trang lỗi Gen Z

Mở **https://nhactoi.test/errors** để xem bộ thiết kế. Từ admin có thể vào **Cấu hình → Xem bộ thiết kế**. Mỗi bản xem thử có nhãn rõ ràng và không tạo lỗi hoặc giao dịch thật.

Có thiết kế riêng cho **400, 401, 402, 403, 404, 408, 409, 410, 422, 423, 429, 500, 502, 503, 504**; các mã 4xx/5xx khác dùng nội dung dự phòng phù hợp. Đường dẫn mẫu: `/errors/404`, `/errors/500`. Minh họa SVG chuyển động được đóng gói cùng ứng dụng, có nút dừng/bật và mặc định dừng nếu thiết bị yêu cầu giảm chuyển động.

Đã kết nối với các trường hợp thực tế:

- Đường dẫn trang/hash không tồn tại hiển thị 404; máy chủ production trả HTTP 404 cho đường dẫn trang không được hỗ trợ.
- Tài khoản không có quyền quản trị thấy trang 403. Các API vẫn kiểm tra quyền ở máy chủ.
- Lỗi tải phiên khởi động hoặc lỗi đọc dữ liệu admin hiển thị trang lỗi phù hợp, có thể thử lại; lỗi mạng khi gọi API hiển thị 503. Lỗi API không bị hiểu nhầm thành yêu cầu đăng nhập.
- Lỗi render React được Error Boundary hiển thị bằng trang 500.
- Lỗi kiểm tra dữ liệu khi gửi biểu mẫu vẫn hiển thị ngay tại biểu mẫu/thông báo, để người dùng sửa mà không mất nội dung đang nhập. API giữ phản hồi JSON và mã HTTP cho các ứng dụng tích hợp.

Các trang này chạy trong ứng dụng. Nếu nginx/EnvKit hoặc toàn bộ máy chủ ngừng phục vụ cả HTML và JavaScript, cần cấu hình trang lỗi ở reverse proxy riêng; bộ trang React không thể chạy khi chưa tải được ứng dụng.

## Kết nối VC Billing

Thanh toán thuê bao đi qua Payment API của **VC Billing** (tên cũ BillGateway), dịch vụ chạy tại **https://billing.vce.codes**. Tên biến môi trường vẫn là `BILLGATE_*` và khóa cấu hình vẫn là `billgateway.*` để tương thích với bản đã triển khai.

1. Trên VC Billing, mở **Quản lý dự án & API key**, tạo project Nhắc tôi và lấy **project API key** (`bg_proj_…`) cùng webhook secret của project. Payment API chỉ nhận project key. Khóa `bg_live_…` chỉ dùng để tra cứu giao dịch ngân hàng và bị từ chối khi lưu vào cấu hình quản trị.
2. Vào **Quản trị SaaS → Cấu hình → VC Billing** để nhập kết nối, hoặc điền các biến `BILLGATE_*` trong `.env` (xem bảng dưới). `BILLGATE_API_URL` là origin của gateway, không kèm `/api/v1`; để trống thì dùng `https://billing.vce.codes`. Có thể đặt `BILLGATE_PROJECT_ID` để khóa đúng project.
3. Thẻ cấu hình hiển thị URL webhook `https://<ten-mien-nhac-toi>/api/billing/webhook` kèm nút sao chép. Dán URL này vào phần webhook của project trên VC Billing.
4. Chọn **Kiểm tra kết nối**. Nhắc tôi gọi `GET /api/v1/integration/payments?limit=1` bằng project key để xác nhận địa chỉ API và khóa dùng được. Nút này không kiểm tra webhook secret, cũng không kiểm tra VC Billing có gọi tới được webhook hay không.
5. Nếu sửa `.env`, khởi động lại API Nhắc tôi; lưu trên giao diện quản trị có hiệu lực ngay. Chủ không gian mở **Gói dịch vụ**, chọn tháng/năm và gói để tạo hóa đơn.

| Trường trong Cấu hình | Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| Địa chỉ API | `BILLGATE_API_URL` | `https://billing.vce.codes` | Origin của VC Billing, không kèm `/api/v1`. |
| Mã dự án | `BILLGATE_PROJECT_ID` | trống | Tùy chọn, khóa đúng project. |
| Khóa API | `BILLGATE_API_KEY` | — | Project key `bg_proj_…`. |
| Khóa webhook | `BILLGATE_WEBHOOK_SECRET` | — | Webhook secret của project, dùng để xác thực chữ ký. |
| Tiền tố mã thanh toán | `BILLGATE_PAYMENT_CODE_PREFIX` | trống | Để trống thì VC Billing tự sinh mã. Nếu đặt, dùng 2–10 chữ in hoa hoặc chữ số; mã gửi đi là `<tiền tố><8 ký tự ngẫu nhiên>`. |
| Thuế VAT (%) | `BILLGATE_TAX_RATE` | `0` | Thuế cộng thêm vào giá gói (xem quy tắc bên dưới). |
| Tiền tố SKU | `BILLGATE_SKU_PREFIX` | `NHACTOI` | SKU dòng hóa đơn là `<tiền tố>-<MÃ GÓI>-M` (tháng) hoặc `-Y` (năm), ví dụ `NHACTOI-TEAM-Y`. |

Cấu hình lưu trong DB được ưu tiên hơn biến môi trường. Mã thanh toán là nội dung chuyển khoản mà VC Billing dùng để tự đối soát giao dịch ngân hàng, nên người trả cần giữ nguyên khi chuyển khoản.

### Tạo hóa đơn

Nhắc tôi gọi `POST /api/v1/integration/payments` phía máy chủ với project key. Số tiền lấy từ cấu hình gói trên máy chủ, không lấy từ trình duyệt. Body theo Payment Hub gồm `code` (chỉ khi có tiền tố), `externalId`, `description`, `currency` (`VND`), `customer` (`name`, `email`, `taxCode`, `address`), `items` (`description`, `unit`, `sku`, `quantity`, `unitAmount`, `taxRate`), `taxRate`, `totalAmount` và `metadata`. Mỗi hóa đơn có một dòng cho gói đã chọn: đơn vị “Tháng” hoặc “Năm”, số lượng 1. Người dùng được chuyển sang `hostedUrl` của hóa đơn VC Billing.

**VAT cộng thêm vào giá gói.** Khi Thuế VAT lớn hơn 0: tạm tính = giá gói; VAT = làm tròn(tạm tính × thuế suất / 100); tổng hóa đơn = tạm tính + VAT. Webhook phải khớp đúng tổng này. Ví dụ gói 499.000 ₫ với VAT 8%: VAT 39.920 ₫, tổng 538.920 ₫. Thuế 0% thì tổng bằng giá gói.

**Thông tin xuất hóa đơn.** Ở trang **Gói dịch vụ**, chủ không gian điền Tên công ty, Mã số thuế (10 hoặc 13 chữ số), Địa chỉ và Email nhận hóa đơn. Thông tin này được gửi làm `customer` cho các hóa đơn tạo sau khi lưu; hóa đơn đã tạo giữ nguyên. Khi chưa điền, Nhắc tôi dùng thông tin doanh nghiệp của không gian, sau đó tới tên và email của chủ không gian.

Mỗi kỳ được thanh toán bằng một hóa đơn; không tự trừ tiền định kỳ. Gia hạn cùng gói nối tiếp hạn hiện tại; đổi sang gói khác bắt đầu kỳ mới tại lúc thanh toán, không cộng dồn thời gian còn lại của gói cũ. Quy tắc này được hiển thị ngay trên màn hình chọn gói.

### Webhook và đối soát

VC Billing gửi tên sự kiện trong header `x-billgate-event` và chữ ký `x-billgate-signature: sha256=<hex>`, là HMAC-SHA256 trên raw body bằng webhook secret của project. Body có dạng `{event, data: {payment, transaction}}`. Chỉ thanh toán khớp hóa đơn đã lưu mới được ghi nhận.

| Sự kiện | Trạng thái hóa đơn | Thuê bao |
| --- | --- | --- |
| `payment.created` | Không đổi | Không đổi |
| `payment.partially_paid` | Thanh toán một phần | Chưa kích hoạt |
| `payment.paid` | Đã thanh toán | Kích hoạt hoặc gia hạn, đúng một lần |
| `payment.canceled` | Đã hủy | Không đổi |
| `payment.expired` | Hết hạn | Không đổi |
| `payment.refunded` | Đã hoàn tiền | Không tự thay đổi; admin điều chỉnh ở **Thuê bao** nếu cần |

Tải lại trang hay mở URL trả về không tự kích hoạt gói; thông báo trùng không gia hạn thêm lần nữa.

VC Billing không gửi lại webhook, nên worker nền của Nhắc tôi tự đối soát: mỗi `BILLING_RECONCILE_INTERVAL_MS` (mặc định `300000`, tức 5 phút), worker kiểm tra tối đa 20 hóa đơn đang chờ hoặc thanh toán một phần trong 30 ngày gần nhất qua `GET /api/v1/integration/payments/:id`. Worker không chạy khi `DISABLE_BACKGROUND_WORKER=true`. Ở lịch sử thuê bao, chủ không gian vẫn có thể chọn **Kiểm tra thanh toán** để đối soát ngay, hoặc **Hủy hóa đơn** với hóa đơn đang chờ chưa được thanh toán (gọi `POST /api/v1/integration/payments/:id/cancel`).

VC Billing không nhận callback localhost/IP riêng. `nhactoi.test` chỉ phân giải trên máy này nên gateway bên ngoài không gọi được; trên môi trường local, trạng thái hóa đơn chỉ cập nhật qua đối soát API. Kiểm thử webhook bên ngoài cần tên miền HTTPS có thể truy cập được hoặc tunnel được chủ dự án cho phép. Không tự mở tunnel hoặc công khai môi trường local.

**Hiện chưa có khóa project được cấu hình và chưa chạy giao dịch tiền thật.** Kiểm thử tích hợp dùng gateway giả lập theo hợp đồng API thực tế, trong database cách ly.

## Dữ liệu và phạm vi bản đầu

Các số migration 1–31 trong mô tả tính năng là lịch sử SQLite. PostgreSQL dùng baseline 1 với đầy đủ các tính năng này; các migration SQLite được giữ riêng để nhập dữ liệu cũ.

Stack: Next.js 16 + React 19 (App Router), Next API Routes với router nghiệp vụ Express 5, PostgreSQL 15+ (`pg`), Nodemailer tùy chọn. Font tiếng Việt được đóng gói cùng app. Không cần MySQL để chạy bản thử nghiệm này.

Kết nối database qua `DATABASE_URL`; cần tạo database PostgreSQL trước khi chạy. Thiết lập local bằng EnvKit và chuyển dữ liệu cũ: [hướng dẫn PostgreSQL](docs/POSTGRESQL.md). `NHACTOI_DATA_DIR` (mặc định `data/`) chứa tệp và khóa, độc lập với database. Migration theo phiên bản chạy khi mở DB. Kiểm thử dùng `TEST_DATABASE_URL` và schema riêng, không dùng DB đang chạy. Khóa kết nối lưu trong DB được mã hóa AES-256-GCM. Mặc định khóa mã hóa được tạo tại `data/.nhactoi-settings.key` với quyền `0600`; có thể dùng `NHACTOI_SETTINGS_KEY` hoặc `NHACTOI_SETTINGS_KEY_FILE` trên máy chủ. Khi sao lưu thủ công, dừng API rồi sao lưu PostgreSQL bằng `pg_dump` cùng toàn bộ thư mục `data/`, bao gồm tệp khóa ẩn; nếu dùng khóa từ môi trường hoặc đường dẫn riêng, lưu bản sao khóa đó an toàn cùng quy trình sao lưu. Cần đúng khóa để giải mã khi phục hồi; không đổi hoặc xóa khóa nếu đã lưu thông tin kết nối. Phục hồi khi API đang dừng. Không xóa DB để cập nhật phiên bản.

Đây là bản MVP chạy local cho các luồng cốt lõi. Chưa có SMS/Zalo, hóa đơn điện tử hay hệ thống vận hành production nhiều máy. Dữ liệu, thư mục `demo/` và tệp nén tham khảo không được phục vụ công khai. Next.js chỉ phục vụ các trang, tài nguyên build và tài nguyên chủ động đặt trong `public/`; tệp đính kèm luôn đi qua API có xác thực.

## Ứng dụng Android

Mã nguồn React Native/Expo ở `mobile/`, dùng chung API và quyền truy cập với web. Có bố cục điện thoại, màn hình lớn và thiết bị gập; cache ngoại tuyến chỉ đọc được mã hóa. Xem [hướng dẫn build, chạy và kiểm thử Android](docs/ANDROID.md). Bản local là development APK cần Metro; cấu hình Firebase và phát hành store là bước riêng.

### Cá nhân hóa không gian và quyền giao diện team

Mở biểu tượng bảng màu trên thanh trên cùng hoặc **Tài khoản → Cá nhân hóa toàn bộ giao diện** (`/appearance`). Không gian cá nhân cho phép đổi chế độ sáng/tối, màu nhấn, nền, phông/cỡ chữ, độ giãn, bo góc, chiều rộng thanh bên/nội dung và ẩn/sắp xếp menu. Thay đổi được xem trước, chỉ lưu khi bấm **Lưu giao diện**; có hủy và khôi phục mặc định. Cấu hình lưu theo người dùng và workspace trên máy chủ.

Chọn một team để tùy chỉnh giao diện khi mở team, bảng công việc lọc theo team hoặc chi tiết công việc thuộc team. Chủ/admin workspace và team lead mở **Giao diện & quyền của team** để đặt giao diện chung và chọn từng mục thành viên được tùy chỉnh. Mặc định team dùng giao diện chung, chưa mở mục tùy chỉnh cá nhân nào. Các mục bị khóa luôn theo cấu hình chung, kể cả khi trước đó thành viên đã lưu giá trị riêng; kiểm tra quyền thực hiện tại API. Quyền/giao diện mới được tải khi chuyển team, quay lại cửa sổ hoặc mỗi 30 giây. Nút cá nhân hóa luôn truy cập được ngay cả khi đã ẩn toàn bộ menu.

API: `GET/PUT/DELETE /api/appearance?teamId=…` quản lý cấu hình của người đăng nhập; bỏ `teamId` cho không gian cá nhân. `PUT /api/teams/:teamId/appearance` dành cho quản trị team, nhận `{ preferences, editableFields }`. Migration 25 thêm bảng `user_appearance` và `team_appearance`, không sửa dữ liệu nghiệp vụ hiện có. Kiểm tra riêng: `node --test tests/appearance.test.mjs`.


## Nhắc nhiều mốc, nhận việc và hoãn nhắc

- **Teams → mở team → Chính sách nhắc của team**: quản lý bật chuỗi nhắc, chọn tối đa 6 mốc trước/sau hạn, người nhận (người được giao hoặc trưởng nhóm), điều kiện chưa hoàn thành/chưa nhận việc. Với việc chung, chính sách nằm trong chi tiết công việc, do chủ/admin quản lý.
- Mặc định chuỗi nâng cao **tắt**, không tự bật cho dữ liệu đang có. Các mốc mẫu −60, +120 và +1440 phút chỉ chạy sau khi bật. Nhắc riêng `remindAt` vẫn hoạt động. Mỗi mốc gửi một lần cho mỗi người; thay đổi hạn tính lại chuỗi.
- Giờ yên lặng theo **Asia/Ho_Chi_Minh**, hỗ trợ qua nửa đêm; lời nhắc công việc đến trong khoảng này được hoãn tới lần xử lý ngoài khoảng. Khoảng cách tối thiểu giữa các mốc nâng cao là 15–1440 phút cho cùng công việc/người. Đây chưa phải lịch ngày làm việc/ngày nghỉ.
- Quản lý có thể cho phép tùy chỉnh chuỗi riêng từng việc. Khi thu hồi quyền này, các việc lập tức dùng lại chính sách team. Nhắc trưởng nhóm của việc chung gửi owner/admin; của team gửi các team lead đang có quyền.
- Trong **Chi tiết công việc → Nhận việc & nhắc lại**, người được giao xác nhận nhận việc hoặc hoãn 15 phút/1 giờ/4 giờ/1 ngày. Xác nhận theo từng người, không đổi trạng thái. Hoãn không đổi hạn, không hoãn nhắc của người khác hoặc tự dừng báo trưởng nhóm. API cho phép hoãn từ 5 phút đến 7 ngày.
- Android có nút **Đã nhận việc** và **Nhắc lại sau 1 giờ**. Lịch sử nhận/hoãn được ghi vào hoạt động công việc. Đổi hạn, người phụ trách chính hoặc team sẽ xóa trạng thái phản hồi cũ để nhận lại; bỏ người phối hợp chỉ xóa phản hồi của người bị bỏ. Đổi nhãn/thứ tự không xóa phản hồi.
- Hoàn thành/xóa việc, lưu trữ team, mất quyền hoặc hết thuê bao dừng gửi nhắc công việc. Nhắc checklist vẫn dùng mốc riêng, có áp dụng giờ yên lặng và hoãn của người nhận trên công việc cha; chưa có chuỗi nâng cao riêng cho checklist.
- **Gửi nhắc thử cho tôi** tạo thông báo cho người được giao đang thao tác, tối đa một lần/phút/công việc. Email/push gửi qua worker; việc tạo thông báo không chứng minh đã giao nhận bên ngoài.

### Email nhắc có thử lại và trạng thái giao nhận

- Thông báo nhắc công việc/gia hạn mới tự tạo hàng đợi email bền vững. Khi SMTP hoạt động, worker gửi và thử lại tối đa 5 lần với khoảng đợi tăng dần; thiếu SMTP thì giữ chờ. Không gửi lại thông báo lịch sử trước migration.
- Chi tiết công việc hiển thị 50 thông báo nhắc gần nhất, trạng thái email/push và đã đọc trong ứng dụng. Người dùng có thể thử lại email bị lỗi của chính mình.
- Hoãn nhắc bỏ các email/push cũ đang chờ của người đó, rồi tạo một lần nhắc lại. Mỗi lần gửi/thử lại kiểm tra quyền và tình trạng công việc/dịch vụ. SMTP có thể đã nhận thư trước khi tiến trình bị ngắt nhưng chưa ghi kết quả; vì SMTP không có idempotency, trường hợp này vẫn có thể gửi trùng khi chạy lại.
- Trạng thái “đã gửi” là nhà cung cấp chấp nhận, không phải xác nhận thiết bị đã nhận hoặc người dùng đã đọc. Chưa kiểm thử SMTP/FCM thật trong đợt cập nhật này.

### Push gia hạn và màn hình dịch vụ Android

- Thông báo `service_renewal` mới được đưa vào FCM outbox; không phát lại thông báo cũ. Trước khi gửi kiểm tra quyền, lưu trữ, tắt theo dõi, kỳ gia hạn và thuê bao.
- Bấm thông báo gia hạn trong app/push mở đúng dịch vụ. Màn hình hiển thị kỳ hiện tại và cho ghi nhận gia hạn sau bước xác nhận thực chi; có kiểm tra kỳ kỳ vọng để tránh gia hạn đúp. Không chuyển tiền hoặc tự ghi khoản chi. Offline chỉ xem bản lưu nếu có.
- Chưa có danh sách/quản trị dịch vụ đầy đủ trên mobile, chưa có Zalo/SMS, ứng dụng iOS native hoặc phát hành store. Web Push trình duyệt được bổ sung ở đợt 3.

### Nâng cấp và kiểm tra

Migration **27–28** thêm chính sách, phản hồi, ngữ cảnh giao nhận, hàng đợi email và thay trigger FCM; không xóa dữ liệu nghiệp vụ hiện có. Sao lưu DB và kho tệp theo quy trình vận hành trước khi triển khai; khởi động lại tiến trình Next để nạp backend/migration. Bản Android cần build lại để có màn hình mới. Không dùng nhiều tiến trình worker cùng chia sẻ database; khóa gửi email/FCM hiện bảo vệ trong một tiến trình.

Kiểm tra: `npm test`, `npm run build`, `npm run test:next`; trong `mobile/`: `npm run typecheck`, `npm run lint`, `npm test`. Mọi test nhắc dùng DB cô lập và transport giả, không gửi email/push thật. Lịch lặp ngày làm việc, ủy quyền khi vắng và báo cáo SLA chuyên sâu vẫn thuộc đợt tiếp theo.
