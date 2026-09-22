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
- SQLite production: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared/data/nhactoi.sqlite`
- npm cache dùng khi build: `/www/wwwroot/nhactoi.ktvdung.io.vn/shared/npm-cache`
- Node: `/www/server/nodejs/v24.14.1/bin`

Project aaPanel tên `nhactoi`, user chạy là `www`, port nội bộ `3100`, một
instance. Lệnh chạy của project là:

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
DATABASE_PATH=/www/wwwroot/nhactoi.ktvdung.io.vn/shared/data/nhactoi.sqlite
DISABLE_BACKGROUND_WORKER=false
```

Điền các secret BillGateway, SMTP, OAuth, FCM và khóa mã hóa settings trong
aaPanel secret storage hoặc file dùng chung; không in file, không đưa secret
vào Git và không gửi secret trong log deploy. Cấu hình đã lưu trong DB có thể
ưu tiên biến môi trường. Giữ nguyên `NHACTOI_SETTINGS_KEY` hoặc file key của
production khi sao lưu/khôi phục.

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
git fetch origin main
git checkout main
git merge --ff-only origin/main
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
VPS ít RAM; `npm run build` mặc định và development vẫn giữ nguyên.
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

Deploy sạch không seed dữ liệu và không tạo admin tự động. Người vận hành đăng
ký tài khoản đầu tiên trên website bằng email, mật khẩu và workspace mình chọn.
Email người vận hành chọn trở thành định danh để cấp quyền. Khi tài khoản đã
tồn tại, cấp quyền admin SaaS từ máy chủ:

```sh
runuser -u www -- env PATH=/www/server/nodejs/v24.14.1/bin:$PATH \
  npm --prefix /www/wwwroot/nhactoi.ktvdung.io.vn/current run admin -- \
  grant EMAIL_DA_DANG_KY "cap admin production"
```

Thay `EMAIL_DA_DANG_KY` bằng đúng email người dùng đã chọn; lệnh không tạo
tài khoản mới. Không chạy `npm run seed` trên production.

## SQLite, worker và rollback

SQLite, WAL/SHM, settings encryption key, tệp đính kèm và snapshot phải nằm
trong vùng persistent và được sao lưu cùng nhau. Migration chạy khi mở DB;
script deploy không tự rollback DB khi code rollback. Muốn phục hồi DB phải
dừng Node/worker, kiểm tra bản sao lưu và thực hiện quy trình offline của
`scripts/restore-backup.mjs`, sau đó khởi động lại và kiểm tra health. Không xóa
DB để “hạ phiên bản”.

Sau deploy, kiểm tra cả `https://nhactoi.ktvdung.io.vn/` và
`https://nhactoi.ktvdung.io.vn/api/auth/google/config`; endpoint thứ hai chỉ
kiểm tra cấu hình công khai OAuth và không thay thế kiểm tra đăng nhập, email,
webhook hoặc thanh toán.
