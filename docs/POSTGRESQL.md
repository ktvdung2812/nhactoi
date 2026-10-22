# PostgreSQL

Backend dùng PostgreSQL 15 trở lên, driver `pg`. `DATABASE_URL` là bắt buộc;
ứng dụng không tự quay lại SQLite khi cấu hình thiếu hoặc kết nối lỗi.
Migration PostgreSQL bắt đầu từ baseline 1, tương đương SQLite version 31.
Các migration SQLite đã phát hành nằm nguyên trong `server/legacy-sqlite.mjs`,
chỉ dùng cho nhập dữ liệu cũ và kiểm thử nâng cấp cũ.

## Local với EnvKit

Bật PostgreSQL trong EnvKit (thường `127.0.0.1:5432`). Dùng pgAdmin/psql tạo
role đăng nhập `nhactoi` với mật khẩu riêng và database `nhactoi` do role đó sở hữu.
Role chỉ cần sở hữu database/schema của ứng dụng; không cần superuser hoặc extension.
Cấu hình `.env` (không commit):

```dotenv
DATABASE_URL=postgresql://nhactoi:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/nhactoi
NHACTOI_DATA_DIR=./data
```

Giữ `data/.nhactoi-settings.key` và các thư mục upload cũ. `NHACTOI_DATA_DIR`
chứa tệp đính kèm, khóa mã hóa và snapshot; dữ liệu database nằm trong PostgreSQL.
`DATABASE_PATH`/`DB_PATH` không còn được dùng. Nếu trước đây dùng đường dẫn SQLite
riêng, đặt `NHACTOI_DATA_DIR` về thư mục chứa file đó, hoặc giữ nguyên cấu hình
`NHACTOI_SETTINGS_KEY_FILE`. Cấu hình SSL qua tham số URL tiêu chuẩn của `pg`
(ví dụ `sslmode=verify-full` và CA hợp lệ khi dùng database từ xa).

```sh
npm ci
npm run dev
```

Database trống được khởi tạo khi mở kết nối. `npm run seed` là tùy chọn cho
môi trường demo; `npm run admin -- grant EMAIL "lý do"` dùng PostgreSQL.

## Admin SaaS ban đầu

Chạy `npm run db:migrate` để áp dụng migration và tạo một admin SaaS nếu chưa
có admin đang hoạt động. Ứng dụng cũng chạy bước này lúc khởi động. Tài khoản
mới có workspace riêng và có thể đăng nhập ngay; các lần chạy sau giữ nguyên
admin và mật khẩu hiện có, kể cả khi thay cấu hình bootstrap.

Có thể đặt `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` và
`BOOTSTRAP_ADMIN_PASSWORD` trong `.env` trước lần chạy đầu. Mật khẩu cấu hình
phải dài 12–200 ký tự. Mặc định tên là `Admin SaaS`, email `admin@nhactoi.local`;
nếu không đặt mật khẩu, hệ thống sinh mật khẩu ngẫu nhiên và lưu email/mật khẩu
vào `NHACTOI_DATA_DIR/bootstrap-admin-user_*.json` với quyền `0600`. Log chỉ in
đường dẫn tệp, không in mật khẩu. Lưu thông tin vào nơi quản lý mật khẩu rồi
xóa tệp này khi không còn cần.

Nếu email cấu hình đã thuộc tài khoản khác (kể cả admin bị khóa), migration
báo lỗi và rollback; chọn email mới hoặc chủ động dùng `npm run admin -- grant`
cho tài khoản hiện có. Nếu email mặc định bị trùng, hệ thống sinh địa chỉ
`admin+<mã ngẫu nhiên>@nhactoi.local`. Không tự nâng quyền, mở khóa hoặc đặt lại
mật khẩu của tài khoản cũ. Bước tạo admin có khóa transaction để tránh tạo
trùng khi hai tiến trình cùng khởi động.

## Chuyển dữ liệu SQLite

1. Dừng ứng dụng/worker; giữ PostgreSQL đang chạy. Giữ bản sao cả thư mục dữ liệu
   và khóa mã hóa trước khi chuyển.
2. Đặt `DATABASE_URL` tới database PostgreSQL trống, role có quyền sở hữu schema.
3. Chạy:

   ```sh
   npm run db:import-sqlite -- ./data/nhactoi.sqlite --offline-confirm-migrate
   ```

Công cụ tạo snapshot SQLite bằng backup API (bao gồm WAL) trong
`data/migration-backups/`, nâng cấp một bản tạm lên version 31, rồi nhập toàn bộ
65 bảng trong một transaction. Giữ ID, mật khẩu đã hash, settings đã mã hóa,
phiên đăng nhập, thứ tự lịch sử và hàng đợi thông báo. Trigger người dùng tạm
ngừng trong transaction để không phát lại thông báo cũ; khóa ngoại vẫn được kiểm
tra trước commit. Database có dữ liệu bị từ chối; lỗi nhập rollback toàn bộ.
Sau khi nhập, công cụ kiểm tra admin ngay trong cùng transaction và chỉ tạo
một tài khoản nếu dữ liệu nhập chưa có admin hoạt động. Log có đường dẫn backup,
số dòng nhập từng bảng và kết quả khởi tạo admin (không chứa mật khẩu). Database
nguồn và tệp đính kèm không bị sửa/xóa. Giữ cùng đường dẫn kho tệp và khóa mã hóa
khi đổi engine. Với database đích trống để nhập SQLite, chạy lệnh import trước
khi chạy ứng dụng hoặc `db:migrate`, vì bootstrap sẽ tạo dữ liệu trong database.

4. Khởi động lại ứng dụng bằng EnvKit và kiểm tra đăng nhập, dữ liệu, tệp đính kèm.
   Nếu cần rollback ngay, dừng ứng dụng, dùng mã nguồn bản SQLite và database
   nguồn đã giữ. Các ghi mới trên PostgreSQL không tự đồng bộ ngược về SQLite.

## Sao lưu và khôi phục

Sao lưu trong trang quản trị dùng manifest v2, `database.json` và bản sao bytes
của mọi tệp đính kèm. Database được đọc từ một snapshot `REPEATABLE READ`.
Khôi phục cần dừng ứng dụng, đặt đúng `DATABASE_URL`/`NHACTOI_DATA_DIR`, rồi:

```sh
npm run db:restore -- backup-ID --offline-confirm-restore
```

Công cụ kiểm tra manifest/hash/danh sách bảng/cột/tệp, lưu snapshot database hiện hành vào `restore-backups/before-restore-*.json`
trước khi thay dữ liệu, và nhập trong transaction. Lỗi rollback giữ dữ
liệu hiện tại. Các phiên, mã reset mật khẩu, OAuth state và lịch backup cũ bị
thu hồi sau khôi phục. Các tệp của trạng thái cũ được giữ nguyên tại đường dẫn cũ; snapshot trước
khôi phục chỉ lưu database để việc khôi phục vẫn hoạt động khi tệp hiện hành
bị mất hoặc kho ngoài không truy cập được. Khóa mã hóa phải được sao lưu riêng. Snapshot SQLite v1
cũ cần phục hồi với bản SQLite cũ trước khi chuyển bằng công cụ nhập.

Snapshot PostgreSQL schema 1 và 2 được hỗ trợ. Bản schema 1 được kiểm đúng danh
sách bảng/cột cũ rồi nâng nguồn lịch nhắc theo migration 002 trước khi nhập;
nguồn thiếu hoặc không xác định duy nhất được giữ là `legacy:unknown` để không
gửi nhầm. Nội dung snapshot gốc không bị sửa. Schema mới hơn ứng dụng, cột/bảng
không đúng phiên bản hoặc checksum không khớp vẫn bị từ chối.

Khôi phục đặt chốt `restoreSenderHold` trong database. Email nhắc việc, FCM,
Web Push và hàng đợi xóa tệp từ xa đều dừng qua các lần khởi động; trạng thái
pending/sent và số lần thử được giữ để đối soát. Phiên cũ hết hạn ngay nhưng
bản ghi phiên/device được giữ trong lúc chờ để không xóa lịch sử delivery.
Thiếu hoặc sai khóa mã hóa gốc không cho bật lại sender.

Trước khi bật lại, dừng ứng dụng; xác nhận database/môi trường đích, người nhận,
provider và khóa; kiểm tra job đã gửi, job chưa rõ kết quả ở provider và những
job pending còn đúng thời gian/quyền. Không chạy lệnh dưới đây trên bản sao thử
đang trỏ tới khách hàng thật. Ghi lý do đối soát và đúng mã backup vừa khôi phục:

```sh
node --env-file-if-exists=.env scripts/resume-senders.mjs backup-ID --offline-confirm-resume-senders "Đã đối soát môi trường và hàng đợi"
```

Lệnh kiểm tra cấu hình mã hóa, ghi receipt `restoreSenderResume`, rồi bỏ chốt.
Sau đó khởi động ứng dụng; worker kiểm lại điều kiện nghiệp vụ của pending job.
Lệnh không đổi job sent thành pending hoặc tự retry kết quả chưa rõ. Các hàng
đợi hiện tại chưa có trạng thái unknown riêng; phải đối soát timeout tại provider
trước khi bật lại, không coi pending là bằng chứng provider chưa nhận.

Snapshot JSON hiện giữ dữ liệu trong bộ nhớ; với database lớn, dùng `pg_dump`
/ `pg_restore` cùng bản sao kho tệp và khóa mã hóa trong quy trình vận hành.

Để quay lại snapshot database trước lần khôi phục, dừng ứng dụng, giữ nguyên
các kho tệp cũ và dùng đường dẫn `.json` công cụ đã in:

```sh
node --env-file=.env --input-type=module - /path/to/before-restore-ID.json <<'JS'
import { readFileSync } from 'node:fs';
import { openDatabase } from './server/db.mjs';
import { importSnapshot } from './server/database-snapshot.mjs';
import { pauseRestoredSenders } from './server/restore-safety.mjs';
const db = openDatabase(undefined, { bootstrapAdmin: false });
try {
  importSnapshot(db, JSON.parse(readFileSync(process.argv[2], 'utf8')), {
    replace: true,
    afterImport: db => {
      db.exec("UPDATE sessions SET expires_at='1970-01-01T00:00:00.000Z'; DELETE FROM password_reset_codes; DELETE FROM google_oauth_states; DELETE FROM app_settings WHERE key='backupSchedule'");
      pauseRestoredSenders(db, process.argv[2], new Date().toISOString());
    },
  });
} finally { db.close(); }
JS
```

## Kiểm thử

Tạo database riêng `nhactoi_test`. Trong `.env.test.local` (không commit):

```dotenv
TEST_DATABASE_URL=postgresql://nhactoi:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/nhactoi_test
```

```sh
npm test
npm run build
npm run test:next
```

`test:postgres` chạy kiểm thử API trên schema ngẫu nhiên, được dọn khi kết thúc.
`test:legacy` chỉ chạy các fixture `[SQLite legacy]` bằng migration SQLite đã
đóng băng. `test:next` cũng dùng schema PostgreSQL riêng, không mở database local.
Không trỏ `TEST_DATABASE_URL` tới database ứng dụng hoặc production.

## Giới hạn vận hành

Các hàm nghiệp vụ hiện dùng transaction đồng bộ. `synckit` giữ ranh giới này
và chạy driver `pg` trong worker thread; truy vấn vẫn chặn luồng request trong
khi chờ PostgreSQL. Kết nối có timeout; không tự retry lệnh ghi khi mất kết nối.
Dùng PostgreSQL gần ứng dụng, một tiến trình Next chạy lâu dài. Muốn tăng thông
lượng cần chuyển toàn bộ các hàm gọi DB sang async và thêm cơ chế khóa job giữa
các tiến trình. Không bật cluster/serverless chỉ vì đã chuyển engine.

Build production dùng Webpack (`next build --webpack`): Turbopack 16.3.5 hiện
phân tích nhầm file khai báo `.d.cts` khi trace dependency `synckit`. Dev server
vẫn dùng cấu hình Next mặc định; build không kết nối database hoặc chạy job.
