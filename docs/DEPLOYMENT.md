# Triển khai production trên aaPanel

Ứng dụng chạy bằng **một tiến trình Node.js** (Next.js phục vụ cả giao diện,
API và background worker). Không bật cluster hoặc thêm worker Node thứ hai.
Máy chủ dùng Node **24.14.1** và ít nhất Node 24.

## Đường dẫn và cấu hình aaPanel

- Mã nguồn Git Manager: `/www/wwwroot/nhactoi.ktvdung.io.vn/nhactoi`
- Symlink release đang chạy: `/www/wwwroot/nhactoi.ktvdung.io.vn/current`
- Symlink release trước: `/www/wwwroot/nhactoi.ktvdung.io.vn/previous`
- Release và dữ liệu dùng chung: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared`
- File môi trường: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared/.env` (không commit)
- PostgreSQL: kết nối bằng `DATABASE_URL`; cần tạo database và role riêng.
- Tệp/khóa/snapshot: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared/data`
- npm cache dùng khi build: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared/npm-cache`
- Node: `/www/server/nodejs/v24.14.1/bin`

Project aaPanel tên `nhactoi`, user chạy là `www`, port nội bộ `3100`, một
instance. Trong mục khởi động của project Node, chọn script npm `start`.
aaPanel đặt `node_modules/.bin` lên đầu `PATH`; giá trị `next` thành
`nohup next` và thất bại với `Permission denied` vì shim đó không thực thi
được trên `/www`. Script deploy ghi lại `project_script=start` và port `3100`
trước mỗi lần restart. Lệnh tương đương:

```sh
npm --prefix /www/wwwroot/nhactoi.ktvdung.io.vn/current start
```

Reverse proxy chuyển `https://nhactoi.ktvdung.io.vn` tới
`http://127.0.0.1:3100`. DNS A của tên miền trỏ tới `163.61.73.68`; bật
certificate HTTPS trên aaPanel trước khi mở đăng nhập production. Máy chủ hiện
dùng Let's Encrypt có tự gia hạn, chuyển HTTP sang HTTPS và TLS 1.2/1.3.
Reverse proxy chuyển tiếp `X-Forwarded-Proto` và nhận upload tối đa 50 MB;
giới hạn ứng dụng vẫn áp dụng riêng.

VPS có 2 GB RAM. `build:server` dùng webpack, một worker và Node heap 512 MB.
Máy chủ có tổng 3 GB swap, gồm file bổ sung `/www/nhactoi-build.swap` 2 GB
được khai báo trong `/etc/fstab`. Theo dõi dung lượng khi giữ nhiều release.

## File môi trường

Tạo file `.env` dùng chung với quyền chỉ user vận hành đọc được. Các tên biến
cốt lõi:

```dotenv
NODE_ENV=production
PORT=3100
PUBLIC_APP_URL=https://nhactoi.ktvdung.io.vn
FRONTEND_ORIGIN=https://nhactoi.ktvdung.io.vn
COOKIE_SECURE=true
DATABASE_URL=postgresql://nhactoi:REPLACE_WITH_SECRET@127.0.0.1:5432/nhactoi
NHACTOI_DATA_DIR=/www/wwwroot/nhactoi.ktvdung.io.vn/shared/data
DISABLE_BACKGROUND_WORKER=false
```

Điền các secret VC Billing (tên cũ BillGateway; `BILLGATE_API_KEY` là project
key `bg_proj_…`, `BILLGATE_WEBHOOK_SECRET`), SMTP, OAuth, FCM và khóa mã hóa
settings trong aaPanel secret storage hoặc file dùng chung; không in file, không
đưa secret vào Git và không gửi secret trong log deploy. Cấu hình đã lưu trong DB
có thể ưu tiên biến môi trường. Giữ nguyên `NHACTOI_SETTINGS_KEY` hoặc file key
của production khi sao lưu/khôi phục.

Trên project VC Billing, đặt webhook tới
`https://nhactoi.ktvdung.io.vn/api/billing/webhook` (URL này cũng hiển thị ở
**Quản trị SaaS → Cấu hình → VC Billing**). VC Billing không gửi lại webhook;
giữ `DISABLE_BACKGROUND_WORKER=false` để worker tự đối soát hóa đơn đang chờ theo
`BILLING_RECONCILE_INTERVAL_MS` (mặc định 5 phút). Xem
[Kết nối VC Billing](../README.md#kết-nối-vc-billing).

`NHACTOI_SETTINGS_KEY` phải là 32 byte: 64 ký tự hex hoặc base64. Bản cũ chấp
nhận chuỗi mật khẩu bất kỳ; bản hiện tại từ chối khởi động với giá trị đó. Trước
khi deploy, nếu production đang dùng chuỗi mật khẩu, chạy trong thư mục ứng dụng:

```bash
printf %s '<giá trị cũ>' | npm run -s settings-key:migrate
```

rồi thay `NHACTOI_SETTINGS_KEY` bằng 64 ký tự hex được in ra. Script tái hiện
đúng cách bản cũ tạo khóa: không phải lúc nào cũng là SHA-256, vì chuỗi chứa đúng
43 ký tự base64 (khoảng trắng, dấu câu bị bỏ qua) từng được giải mã base64. Vì
vậy không dùng `shasum` thay cho script. Giá trị đọc từ stdin nên không lọt vào
lịch sử shell qua tham số; script không đọc database và không ghi log. Nếu khóa
không khớp dữ liệu đã mã hóa, server dừng ngay khi khởi động với thông báo "khóa
mã hóa gốc không khớp dữ liệu đã mã hóa". Không tạo khóa ngẫu nhiên mới cho máy
chủ đã có dữ liệu: cấu hình và bản sao cũ sẽ không giải mã được nữa.

## Git Manager và release an toàn

Git Manager dùng script `NhacToi_production`. Webhook của GitHub gửi sự kiện
`push`, bật xác minh SSL. Giữ URL webhook trong cấu hình GitHub/aaPanel, không
đưa URL chứa access key vào Git hoặc tài liệu chia sẻ.

Nội dung script trong aaPanel đồng bộ `main` trước khi chạy bản deploy đã commit:

```sh
#!/bin/bash
set -euo pipefail
exec 8>/www/wwwroot/nhactoi.ktvdung.io.vn/shared/git-manager.lock
flock -x 8
cd /www/wwwroot/nhactoi.ktvdung.io.vn/nhactoi
export GIT_SSH_COMMAND='ssh -i /root/.ssh/aapanel/163061073068_95627 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes'
source_git() { git -c safe.directory=/www/wwwroot/nhactoi.ktvdung.io.vn/nhactoi "$@"; }
source_git fetch origin main
source_git checkout main
source_git merge --ff-only origin/main
bash scripts/deploy-aapanel.sh 8>&-
```

Đường dẫn SSH key ở trên là key hiện được chọn trong Git Manager; cập nhật
đồng bộ nếu đổi key. Wrapper này luôn triển khai `main`; khôi phục code cũ bằng
commit revert trên `main` hoặc symlink `previous`, không dùng nút Run để chọn
một commit lịch sử. Plugin webhook hiện giới hạn mỗi lần chạy ở 600 giây.

Script không `git pull`. Nó khóa deploy bằng `flock`, archive đúng `HEAD` vào
`shared/releases`, liên kết `.env`, chạy `npm ci --omit=dev` và
`npm run build:server` dưới user `www`, rồi mới đổi symlink `current` atomically.
Script build này dùng webpack, một CPU worker và heap Node 512 MiB để phù hợp
VPS ít RAM; `npm run build` cũng dùng webpack, development giữ bundler Next mặc định.
Build hỏng giữ nguyên release đang chạy. Sau khi đổi symlink, script gọi
`restart_project(get)` của aaPanel và thử lần lượt `/` và
`/api/auth/google/config` tại `127.0.0.1:3100`. Nếu khởi động hoặc probe hỏng,
script trả `current` về release cũ và restart lại. Lỗi rollback cần xem log
aaPanel trước khi thử tiếp.

Release cũ không bị xóa tự động ở bản đầu để tránh xóa nhầm điểm rollback.
Định kỳ kiểm tra `current`, `previous` và các thư mục `.failed` trong
`shared/releases`; chỉ xóa thủ công release không còn được symlink trỏ tới sau
khi xác nhận đã có bản sao lưu và không cần rollback.

```sh
readlink -f /www/wwwroot/nhactoi.ktvdung.io.vn/current
readlink -f /www/wwwroot/nhactoi.ktvdung.io.vn/previous
find /www/wwwroot/nhactoi.ktvdung.io.vn/shared/releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -n
```

## Tài khoản đầu tiên

Migration tự khởi tạo một admin SaaS nếu chưa có admin hoạt động. Đặt
`BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
trong môi trường trước lần khởi động đầu, rồi chạy `npm run db:migrate` hoặc
khởi động Next. Nếu để trống mật khẩu, hệ thống sinh mật khẩu ngẫu nhiên và
lưu tại `NHACTOI_DATA_DIR/bootstrap-admin-user_*.json` (quyền `0600`); đường dẫn
được in trong log. Mặc định email là `admin@nhactoi.local`. Lưu thông tin đăng
nhập vào nơi quản lý mật khẩu rồi xóa tệp khi không còn cần.

Chạy lại migration không đổi admin/mật khẩu hiện có. Email cấu hình trùng tài
khoản đã có sẽ báo lỗi thay vì tự nâng quyền. Xem [quy tắc bootstrap](POSTGRESQL.md#admin-saas-ban-đầu).
Nếu muốn cấp quyền cho tài khoản đã đăng ký, dùng lệnh trên máy chủ:

```sh
runuser -u www -- env PATH=/www/server/nodejs/v24.14.1/bin:$PATH \
  npm --prefix /www/wwwroot/nhactoi.ktvdung.io.vn/current run admin -- \
  grant EMAIL_DA_DANG_KY "cap admin production"
```

Thay `EMAIL_DA_DANG_KY` bằng đúng email người dùng đã chọn; lệnh không tạo
tài khoản mới. Không chạy `npm run seed` trên production.

## PostgreSQL, worker và rollback

Trước lần triển khai bản PostgreSQL, dừng Node, tạo database/role riêng, sao lưu
SQLite và nhập bằng [hướng dẫn PostgreSQL](POSTGRESQL.md). Script deploy không
tự chuyển dữ liệu hoặc tạo database. Cấu hình DATABASE_URL và giữ thư mục tệp,
settings encryption key. Đây là chuyển đổi engine: rollback về release SQLite
chỉ dùng được bản SQLite trước chuyển đổi và không bao gồm ghi mới trên PostgreSQL.

Sao lưu PostgreSQL và thư mục dữ liệu persistent cùng nhau. Migration chạy khi
mở DB; deploy không tự rollback DB. Khôi phục bằng `npm run db:restore -- backup-ID
--offline-confirm-restore` khi Node/worker đã dừng, PostgreSQL vẫn hoạt động.
Giữ một tiến trình ứng dụng vì khóa gửi FCM/email/push vẫn nằm trong tiến trình.

Sau deploy, kiểm tra cả `https://nhactoi.ktvdung.io.vn/` và
`https://nhactoi.ktvdung.io.vn/api/auth/google/config`; endpoint thứ hai chỉ
kiểm tra cấu hình công khai OAuth và không thay thế kiểm tra đăng nhập, email,
webhook hoặc thanh toán.

## Xác minh production ngày 22/09/2026

Commit `c8e5b67` đã được triển khai bằng sự kiện push thật từ GitHub qua
Git Manager. Log kết thúc với `deployment is healthy`; `/` và
`/api/auth/google/config` trả HTTP 200, `/api/me` trả 401 khi chưa đăng nhập,
HTTP chuyển hướng 301 sang HTTPS với certificate hợp lệ. Giao diện đăng nhập
và đăng ký tải được trên trình duyệt.

Database production được khởi tạo mới, có 0 user và 0 workspace tại thời điểm
kiểm tra. Tiến trình phục vụ ứng dụng chỉ lắng nghe `127.0.0.1:3100`.
Google OAuth hiện chưa cấu hình (`enabled: false`); đăng ký đầu tiên dùng email
và mật khẩu do người vận hành chọn.

Khi kiểm tra những lần deploy tiếp theo, cần đối chiếu symlink `current` với
commit mới và log `deployment is healthy`. HTTP 200 của webhook chỉ xác nhận
aaPanel đã nhận yêu cầu, không xác nhận build đã hoàn tất. Các mục lỗi từ lần
cấu hình ban đầu vẫn còn trong lịch sử; đọc lượt chạy mới nhất.


## Web Push và ứng dụng web (migration 31)

Sau khi sao lưu DB, chạy `npm ci`, build và khởi động lại Next để áp dụng migration 31. Tạo VAPID một lần bằng `npm run web-push:keys`; cấu hình `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT=mailto:...` trong môi trường máy chủ. Không commit private key hoặc thay key mỗi lần deploy. Web Push tắt nếu cấu hình thiếu/sai; không thay thế FCM hoặc SMTP.

Cần HTTPS ngoài localhost, một worker Node đang chạy và outbound HTTPS đến Chrome/Firefox/Edge/Safari push services. `/sw.js` phải phục vụ JavaScript cùng origin với header `Cache-Control: no-cache`; `/manifest.webmanifest`, `/icons/*` và `/offline.html` là tài nguyên công khai. Không cache API hoặc trang đã đăng nhập tại reverse proxy. Service worker của ứng dụng chỉ cache trang mất mạng và icon.

Kiểm tra thủ công sau triển khai: đăng nhập → Tài khoản → Bật thông báo → tạo lời nhắc cho mình → đóng tab → kiểm tra nhận và mở đúng nội dung/workspace. Kiểm tra cài PWA trên thiết bị mục tiêu; iOS/iPadOS cần trình duyệt/OS hỗ trợ và thêm vào Màn hình chính trước. Push phụ thuộc chính sách nền của hệ điều hành, không cam kết hoạt động khi trình duyệt bị force-stop. Đăng xuất/reset mật khẩu thu hồi đăng ký máy chủ; sau đăng nhập lại cần bật lại. Nếu xoay VAPID, người dùng phải bật lại; giữ key cũ trong secret backup cho đến khi hoàn tất chuyển đổi.

Rollback mã nguồn nên giữ nguyên các bảng migration 31 (additive), không hạ schema/xóa dữ liệu đang chạy. Dừng worker mới trước khi rollback; service worker không cache dữ liệu nghiệp vụ và mọi thông báo còn trong hàng đợi chỉ chứa nội dung chung.

## GitHub Actions

Mỗi push lên `main` chạy workflow **Publish deploy**. Workflow cài dependency, chạy `npm run build`, rồi cập nhật nhánh `deploy` với thư mục `.next` đã build (kèm `.next/BUILD_NEXT_VERSION`). aaPanel lắng nghe push của nhánh `deploy`; script deploy bỏ qua `build:server` khi archive có `.next/BUILD_ID` và kiểm tra phiên bản Next trước khi start.

Nếu thấy lỗi `getAssetPrefixForRender is not a function` hoặc log báo Next.js khác với `.next/BUILD_NEXT_VERSION`, release đang chạy `node_modules/next` không khớp artifact đã build. Trong thư mục release mới, chạy `npm ci --omit=dev` (không `npm install`, không tái dùng `node_modules` cũ), rồi restart.
