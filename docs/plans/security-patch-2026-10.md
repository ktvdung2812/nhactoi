# Spec vá lỗi bảo mật còn lại sau đợt rà soát 22/10/2026

Ngày lập: 22/10/2026. Nhánh: `security-hardening`.

Đợt đánh giá lại ngày 22/10 xác nhận toàn bộ 3 lỗi cao, 5 lỗi trung bình và 9 lỗi thấp của đợt rà soát trước đã đóng. Spec này mô tả cách vá những điểm còn lại mà đợt đánh giá lại phát hiện: 1 lỗi trung bình mới (P1) và 11 điểm mức thấp hoặc củng cố (P2–P12). Mỗi mục ghi hiện trạng với số dòng tại thời điểm lập spec, thay đổi cần làm, test bắt buộc và tiêu chí chấp nhận.

Quy ước chung cho người thực hiện:

- Đọc `AGENTS.md` và tài liệu trong `node_modules/next/dist/docs/` trước khi đụng tới Next.js. Các mục dưới đây không yêu cầu thay đổi Next.
- Server chạy trên PostgreSQL (`server/database-tables.mjs`, `server/migrations/postgres/`) và SQLite legacy (`server/legacy-sqlite.mjs`). Luồng đổi email và Vyvy chỉ có trên PostgreSQL (`postgresOnly`), nhưng cột mới trên bảng dùng chung (`sessions`) phải có ở cả hai dialect.
- Thông báo lỗi hướng tới người dùng viết tiếng Việt, theo giọng hiện có. Không ghi email, mã hoặc mật khẩu vào log.
- Mọi thay đổi có test hồi quy trong `tests/`. Chạy `npm test`, `npm run build`, `npm run test:next` trước khi mở PR.

## 0. Nền tảng trước khi bắt đầu

Working tree đang có thay đổi chưa commit (CSP nonce qua `proxy.js` và `shared/content-security-policy.mjs`, giữ lại bản sao lưu, giới hạn đoán mật khẩu khi đổi email, ghi chú chuyển khóa, override `uuid` cho `exceljs`). Các thay đổi này đã qua test và build xanh. Commit chúng thành một commit riêng trước khi thực hiện spec, ví dụ `security: nonce CSP, backup retention, email-change guess limit`. P2 và P6 sửa tiếp trên phần vừa commit.

Thứ tự thực hiện đề xuất: P6 (độc lập, rủi ro vận hành cao nhất) → P1 → P2, P3, P4, P5 (cùng file) → P7 → P8, P10, P11, P12 (Vyvy) → P9. Mỗi nhóm một commit.

## P1. Đổi email bỏ qua mật khẩu nhờ liên kết Google (trung bình)

### Hiện trạng

- `server/email-change.mjs:63-65`: nếu request không gửi `password`, server chỉ kiểm tra tài khoản có **bất kỳ** dòng nào trong `google_identities`, không kiểm tra phiên hiện tại đăng nhập bằng gì.
- `server/google-login.mjs:12`: `GET /api/auth/google/start` khi đang đăng nhập ghi `user_id` của phiên vào `google_oauth_states`; callback (`:21`, `:40-41`) chỉ cần phiên còn hiệu lực là liên kết Google vào tài khoản. Không cần mật khẩu.
- Kịch bản: kẻ có cookie phiên bị đánh cắp liên kết tài khoản Google của chính mình, gọi `POST /api/me/email-change` không kèm mật khẩu, nhận mã ở hộp thư của mình, xác nhận; các phiên khác của nạn nhân bị hủy và khôi phục mật khẩu chuyển sang kẻ tấn công. Chỉ khả thi khi admin đã bật đăng nhập Google.

### Thiết kế

Hai quy tắc bổ sung:

1. **Liên kết Google cần mật khẩu hiện tại.** Tài khoản tạo bằng Google đã có identity nên không cần liên kết. Tài khoản tạo bằng mật khẩu biết mật khẩu. Tài khoản Google bị thu hồi identity sau khôi phục mật khẩu (`tests/google-recovery.test.mjs`) vừa đặt mật khẩu mới nên cũng biết.
2. **Chỉ phiên đăng nhập bằng Google mới được bỏ qua mật khẩu khi đổi email, và phiên đó phải mới.** Phiên được ghi `auth_method` lúc tạo. Phiên `google` được bỏ qua mật khẩu chỉ khi `created_at` trong vòng 10 phút; quá hạn thì client yêu cầu đăng nhập lại bằng Google. Kẻ cắp phiên không điều khiển được tài khoản Google nên không tạo được phiên `google` mới.

### Thay đổi dữ liệu

- Migration mới `server/migrations/postgres/018-session-auth-method.sql`:

  ```sql
  ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'
    CHECK (auth_method IN ('password', 'google', 'dev'));
  ```

- SQLite legacy, `server/legacy-sqlite.mjs` cạnh khối thêm cột `kind` (`:804-807`): thêm `auth_method` cùng ràng buộc nếu chưa có cột.
- Tương thích sao lưu/khôi phục (`server/database-tables.mjs`, `server/database-snapshot.mjs`): schema hiện tại là 17 (`TABLE_COLUMNS`, thêm `email_change_requests`). Thực hiện:
  - Đổi tên `TABLE_COLUMNS` hiện tại thành `V17_TABLE_COLUMNS`; khai báo `TABLE_COLUMNS` mới = `{ ...V17_TABLE_COLUMNS, sessions: [...V17_TABLE_COLUMNS.sessions, 'auth_method'] }`.
  - `SCHEMA_VERSION` tăng lên 18; `SNAPSHOT_COLUMNS[17] = V17_TABLE_COLUMNS`, `[18] = TABLE_COLUMNS`.
  - `upgradeSnapshot`: bản 17 → 18 thêm `'password'` vào cuối mỗi dòng `sessions` (giống cách bản 15 → 16 thêm `'team', null` cho `workspaces` ở `database-snapshot.mjs:73`).
  - `tests/postgresql.test.mjs` và test migration tương ứng (mẫu: `tests/personal-workspace.test.mjs` với `V15_TABLE_COLUMNS`) kiểm tra khôi phục bản sao schema 17 vào server schema 18 thành công và mọi phiên khôi phục có `auth_method = 'password'`.

### Thay đổi server

- `createSession` (`server/index.mjs:751`): thêm tùy chọn `authMethod` (mặc định `'password'`), ghi vào cột mới.
  - Đăng nhập mật khẩu (`:2962`, mobile và web) và đăng ký: `'password'`.
  - Dev login (`:3135`): `'dev'`.
  - Google callback (`server/google-login.mjs:58`): `'google'`.
  - Đổi workspace (`:3990`) và chấp nhận lời mời khi đã đăng nhập (`:4817`): **kế thừa** `req.auth.sessionAuthMethod` và giữ `created_at` của phiên gốc, để việc chuyển workspace không làm phiên cũ trở thành "mới". Khi chấp nhận lời mời bằng cách đăng ký tài khoản mới: `'password'`.
- `authContext` (`server/index.mjs:783`): đọc thêm `s.auth_method`, `s.created_at`; trả về `sessionAuthMethod` và `sessionCreatedAt` trong object auth.
- `server/google-login.mjs`:
  - `GET /api/auth/google/start` chỉ còn phục vụ **đăng nhập** khi chưa có phiên. Nếu `req.auth` tồn tại, trả 400 `"Hãy liên kết Google trong mục Tài khoản."` và không ghi `user_id` vào `google_oauth_states`.
  - Thêm `POST /api/auth/google/link` (`requireAuth`, body `{password}`): dùng cùng bộ giới hạn đoán mật khẩu của P2 (bucket `google-link:password:<userId>`, 5 lần/15 phút), `verifyPassword`, rồi tạo state như `start` với `user_id` của phiên và trả `{url}` để client chuyển hướng. Set cookie `nhactoi_google_state` như hiện nay.
  - Callback giữ nguyên logic kiểm tra phiên (`:21`, `:40-41`); vì state có `user_id` chỉ được tạo qua `link`, liên kết luôn đã qua mật khẩu.
- `server/email-change.mjs:63-65` thay bằng:

  ```js
  if (password === undefined) {
    const viaGoogle = req.auth.sessionAuthMethod === "google"
      && db.prepare("SELECT 1 FROM google_identities WHERE user_id = ?").get(user.id);
    if (!viaGoogle) throw new HttpError(403, "Vui lòng nhập mật khẩu hiện tại.");
    if (nowMs() - Date.parse(req.auth.sessionCreatedAt) > 10 * 60_000)
      throw new HttpError(403, "Hãy đăng nhập lại bằng Google rồi thử lại.", { code: "reauth_required" });
  }
  ```

  Nếu `HttpError` chưa hỗ trợ `code`, thêm trường tùy chọn và cho error handler trả `{error, code}`.

### Thay đổi client

- `src/App.jsx:3348` và `src/OperationsSettings.jsx` (`GoogleAccount`): thay `<a href="/api/auth/google/start">` bằng form nhỏ gồm ô mật khẩu hiện tại và nút "Liên kết tài khoản Google"; submit gọi `POST /auth/google/link`, rồi `location.assign(result.url)`. Lỗi 403/429 hiển thị tại chỗ.
- `src/Account.jsx` (`EmailChange`): ghi chú ở `:398-400` đổi thành "Bỏ trống mật khẩu nếu bạn vừa đăng nhập bằng Google đã liên kết." Khi nhận lỗi có `code === "reauth_required"`, hiển thị nút "Đăng nhập lại bằng Google" trỏ tới `/api/auth/google/start` (server sẽ hủy phiên hiện tại sau khi callback tạo phiên mới, như hành vi đăng nhập hiện tại).

### Test

- `tests/account.test.mjs`:
  - Phiên đăng nhập bằng mật khẩu của tài khoản đã liên kết Google, không gửi `password` → 403.
  - Phiên tạo qua Google callback (mock như `tests/google-recovery.test.mjs`) trong 10 phút → 200; `s.advance(10 phút + 1 s)` → 403 với `code: "reauth_required"`.
  - Đổi workspace từ phiên `password` rồi gọi không mật khẩu → 403 (kế thừa `auth_method`).
- Test mới `tests/google-link.test.mjs`:
  - `GET /api/auth/google/start` khi đã đăng nhập → 400, không có dòng `google_oauth_states` mang `user_id`.
  - `POST /api/auth/google/link` sai mật khẩu 5 lần → lần 6 trả 429 kể cả khi đúng; đúng mật khẩu → 200 có `url` chứa `state`, cookie state được set; callback với state đó liên kết thành công.
  - Kịch bản tấn công đầy đủ: phiên `password` bị đánh cắp không thể liên kết Google không mật khẩu, không thể đổi email không mật khẩu.
- `tests/web-mutation-component-check.mjs`: form liên kết Google gửi `{password}` tới `/auth/google/link`.
- SQLite legacy: `tests/dev-auth.test.mjs` hoặc test tương đương xác nhận cột `auth_method` tồn tại và dev login ghi `'dev'`.

### Chấp nhận

Kịch bản tấn công trong mục Hiện trạng thất bại ở cả hai bước. Người dùng Google-only vẫn đổi được email trong 10 phút sau khi đăng nhập Google. Người dùng mật khẩu liên kết được Google sau khi nhập mật khẩu.

## P2. Giới hạn đoán mật khẩu khi đổi email có race (thấp)

### Hiện trạng

`server/email-change.mjs:70-80` đọc `count`, chạy `verifyPassword` (scrypt), rồi mới tăng, ngoài transaction và không khóa dòng. N request song song đều thấy `count < 5` và đều được kiểm tra mật khẩu thật trước khi bộ đếm cập nhật. `authRequestLimiter` trong `server/password-reset.mjs:22-33` đã có mẫu claim nguyên tử.

### Thay đổi

- Tách helper trong `server/password-reset.mjs` và export:

  ```js
  // Claim one attempt in `bucket`; returns false once `limit` is reached in the window.
  export function claimAttempt(db, { bucket, limit, windowMs, now })
  export function releaseAttempt(db, { bucket })   // DELETE bucket
  ```

  `claimAttempt` dùng đúng câu `INSERT ... ON CONFLICT(bucket) DO UPDATE ... WHERE count < ? RETURNING expires_at` hiện có, chạy trong `withTransaction` do caller mở hoặc tự mở.
- `server/email-change.mjs`: thay khối `:70-80` bằng claim-trước-verify:
  1. `claimAttempt(bucket = email-change:password:<userId>, limit 5, windowMs = ttl)`; nếu thất bại → 429 với `Retry-After` như hiện tại.
  2. `verifyPassword`; nếu đúng → `releaseAttempt` (mật khẩu đúng xóa bộ đếm, giống `authRateLimiter` sau khi đăng nhập thành công). Nếu sai → 403, giữ claim.
- `POST /api/auth/google/link` (P1) dùng cùng helper.
- Ghi chú ở `:67-69` cập nhật theo hành vi mới.

### Test

- `tests/account.test.mjs`, test "locks password guessing per account" hiện có giữ nguyên kỳ vọng.
- Thêm: 10 request sai mật khẩu gửi **đồng thời** (`Promise.all`) → đúng 5 trả 403 và 5 trả 429; sau đó mật khẩu đúng trả 429 cho tới khi hết cửa sổ.
- Thêm: 3 lần sai rồi 1 lần đúng → bộ đếm được xóa, 5 lần sai tiếp theo mới khóa.

## P3. Hủy yêu cầu rồi gửi lại bỏ qua cooldown 60 giây (thấp)

### Hiện trạng

`DELETE /api/me/email-change` (`server/email-change.mjs:38-45`) xóa hẳn dòng chờ; `POST` tiếp theo không thấy `previous` (`:90-94`) nên gửi mã ngay. Một người đăng nhập có thể đẩy tới 20 email mã/15 phút mỗi IP tới địa chỉ bất kỳ.

### Thay đổi

- `DELETE` chuyển thành soft-cancel: `UPDATE email_change_requests SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`. Partial unique index `email_change_requests_active_idx` vẫn giải phóng cho yêu cầu mới.
- Cooldown tính trên **mọi** dòng của user, kể cả đã tiêu thụ: ở `:90` đổi thành `SELECT max(created_at) AS created_at FROM email_change_requests WHERE user_id = ?` (giữ `FOR UPDATE` trên dòng active nếu còn, hoặc khóa bằng `SELECT ... FROM users WHERE id = ? FOR UPDATE` trước để tuần tự hóa).
- Dọn dẹp ở `:89` chỉ xóa dòng có `expires_at <= now`, tức ≥ 15 phút tuổi, nên không ảnh hưởng cửa sổ 60 giây.
- `GET` (`:25-26`) không đổi vì đã lọc `consumed_at IS NULL`.

### Test

`tests/account.test.mjs`: gửi mã → hủy → gửi lại ngay → 429 với `Retry-After` ≤ 60; `s.advance(60_001)` → 200. Sau khi xác nhận thành công, yêu cầu đổi email mới trong 60 giây → 429 (chấp nhận được, ghi trong test).

## P4. Khóa địa chỉ email mới của người khác trong 1 giờ (thấp)

### Hiện trạng

Middleware `limit("email-change", { emailLimits: [{limit: 5, windowMs: 1h}] })` ở `server/email-change.mjs:49-51` băm `req.body.email` và claim **trước** khi kiểm tra mật khẩu. 5 POST sai mật khẩu nhắm vào `victim@x` làm địa chỉ đó không dùng được làm email mới của bất kỳ ai trong 60 phút.

### Thay đổi

- Bỏ `emailLimits` khỏi middleware; giữ `ipLimit: 20`.
- Sau khi mật khẩu (hoặc phiên Google theo P1) đã được xác nhận và trước khi tạo mã, gọi `claimAttempt(bucket = email-change:target:<hmac(email)>, limit 5, windowMs 1h)`; thất bại → 429 cùng thông báo cũ. HMAC dùng `settingsKey` như `authRequestLimiter`.
- Thứ tự kiểm tra cuối cùng trong handler: validate body → IP limit (middleware) → mật khẩu/phiên Google → bucket theo tài khoản của P2 đã release → bucket theo địa chỉ đích → cooldown 60 s → tạo mã.

### Test

`tests/account.test.mjs`: 5 request sai mật khẩu tới cùng địa chỉ đích từ tài khoản A → tài khoản B với mật khẩu đúng vẫn gửi mã được tới địa chỉ đó. 5 request đúng mật khẩu tới cùng địa chỉ (xen `s.advance(61_000)` để qua cooldown) → lần 6 trả 429.

## P5. Request đổi email trả 409 lộ email đã đăng ký (thấp)

### Hiện trạng

`server/email-change.mjs:82-83` trả 409 `"email is already registered"` ngay ở bước request. Người đã đăng nhập, biết mật khẩu của mình, có thể dò email của người khác với tốc độ 20 lần/15 phút mỗi IP.

### Thay đổi

- Ở bước request, khi địa chỉ đã thuộc tài khoản khác: **không** tạo dòng yêu cầu, **không** tiết lộ; gửi tới địa chỉ đó email "Có người dùng địa chỉ này làm email mới cho một tài khoản Nhắc tôi khác. Địa chỉ đã gắn với tài khoản của bạn nên không thay đổi gì. Nếu không phải bạn, hãy bỏ qua." và trả cùng body 200 như trường hợp bình thường (`email`, `expiresAt`, `retryAfterSeconds`). Vẫn claim bucket đích (P4) và cooldown (P3) để hành vi giống hệt.
- Bước confirm giữ 409 tại `:147` vì chỉ đạt tới khi có mã, tức người gọi kiểm soát hộp thư đích.
- `docs/COMMENT_ASSISTANT.md` không liên quan; cập nhật mô tả luồng trong `README.md` nếu có đoạn nói "báo email đã tồn tại".

### Test

`tests/account.test.mjs:152` đổi kỳ vọng: request tới email đã tồn tại trả 200, `s.mails` có 1 thư gửi tới địa chỉ đó không chứa mã 6 chữ số, bảng `email_change_requests` không có dòng mới cho user. Test `:159` (race ở confirm) giữ 409.

## P6. Ghi chú chuyển khóa mã hóa sai cho một lớp passphrase (thấp, nguy cơ mất dữ liệu khi nâng cấp)

### Hiện trạng

Bản cũ (`git show 49aacda^:server/index.mjs`, hàm `deriveSettingsKey`) thử `Buffer.from(text, "base64")` **trước** SHA-256 và dùng 32 byte giải mã nếu đúng độ dài. Decoder của Node bỏ qua ký tự không hợp lệ, nên passphrase chứa đúng 43 ký tự thuộc bảng base64 (khoảng trắng và dấu câu bị bỏ qua) từng được dùng theo bản giải mã base64. Ghi chú hiện tại ở `server/index.mjs:280-284`, `docs/DEPLOYMENT.md:62-68`, `.env.example:32-33` chỉ hướng dẫn SHA-256, sẽ tạo khóa sai cho lớp này và không báo lỗi cho tới lần giải mã đầu.

### Thay đổi

- Thêm `scripts/settings-key-from-legacy.mjs`: nhận giá trị cũ qua stdin (không qua argv để không lọt vào lịch sử shell), tái hiện **chính xác** thuật toán cũ (hex 64 → hex; base64 giải mã ra 32 byte → bytes; còn lại → SHA-256) và in ra 64 ký tự hex của khóa tương đương. Script không ghi log, không đọc DB.
- Thêm script npm `settings-key:migrate` chạy file trên.
- Sửa thông điệp lỗi ở `server/index.mjs:280-284` và hai tài liệu: hướng dẫn chạy `printf %s '<giá trị cũ>' | npm run -s settings-key:migrate`, thay vì `shasum`. Giữ cảnh báo không tạo khóa mới cho máy chủ đã có dữ liệu.
- Tùy chọn an toàn thêm: sau khi tải khóa, nếu bảng `app_settings` có dòng `encrypted=1` thì thử giải mã một dòng lúc khởi động; thất bại → in lỗi rõ "khóa không khớp dữ liệu đã mã hóa" và dừng. Ghi vào `OPERATIONS.md`.

### Test

- `tests/settings-key.test.mjs` (mới hoặc file hiện có): với ba đầu vào (hex 64, chuỗi 43 ký tự base64 có khoảng trắng, passphrase thường) script trả đúng khóa mà hàm cũ tạo ra (copy nguyên hàm cũ vào test làm oracle).
- Test khởi động với khóa sai và một setting đã mã hóa → tiến trình từ chối chạy (nếu làm mục tùy chọn).

## P7. `listBackups` ném lỗi khi manifest thiếu `createdAt` (thấp)

### Hiện trạng

`server/backups.mjs:95`: `createdAt` đọc trong `try`, nhưng `localeCompare` chạy trong comparator ngoài `try`. Manifest thiếu hoặc sai kiểu làm `GET /api/admin/backups` trả 500 và `pruneBackups` lỗi mỗi lần chạy.

### Thay đổi

Trong `map`, coi manifest hợp lệ chỉ khi `typeof m.createdAt === "string" && Number.isFinite(Date.parse(m.createdAt)) && Array.isArray(m.files)`; ngược lại trả `null` (không liệt kê, không prune). Ghi `console.warn('[nhactoi] backup manifest unreadable', id)` một lần mỗi id mỗi tiến trình.

### Test

`tests/operations.test.mjs`: tạo thư mục `backup-broken` với `manifest.json` là `{}` → danh sách bỏ qua nó, `pruneBackups` không xóa nó và không ném lỗi.

## P8. Vyvy tải URL do bất kỳ người bình luận nào dán (thấp)

### Hiện trạng

`server/ai-comments.mjs:290` gom `task.description` và toàn bộ bình luận không phải trợ lý; `server/ai-sources.mjs:259-260` trích mọi URL trong đó và tải tới 100 nguồn × 2 MiB × 20 giây mỗi lần chạy. Guest có quyền bình luận có thể làm mỗi lần gọi trợ lý tốn tới ~33 phút tải và nhét nội dung tùy ý vào ngữ cảnh.

### Thay đổi

- URL trích từ văn bản chỉ lấy từ: mô tả công việc và các bình luận có `author_user_id === run.requested_by`. Bình luận người khác vẫn đưa vào ngữ cảnh dưới dạng văn bản nhưng không được tải.
- Giới hạn mới trong `AI_SOURCE_LIMITS`: `textUrls: 10` (URL trích từ văn bản), tổng nguồn vẫn 100 tính cả tệp và URL đính kèm. Vượt quá: nguồn thứ 11 trở đi đánh dấu `status: "skipped"`, `detail: "Vượt giới hạn 10 liên kết trong văn bản."`.
- `docs/COMMENT_ASSISTANT.md:31-33`: ghi rõ chỉ tải liên kết trong mô tả, tệp/URL đính kèm và bình luận của người gọi; tối đa 10 liên kết trong văn bản.

### Test

`tests/ai-comments.test.mjs` hoặc `tests/ai-sources.test.mjs`: guest dán URL trong bình luận → lần chạy của member không có nguồn URL đó; người gọi dán 12 URL → 10 nguồn được đọc, 2 nguồn `skipped`.

## P9. `.env.example` bật dev login mặc định (thấp)

`.env.example:20` đổi thành `# NHACTOI_DEV_LOGIN=true` với chú thích giữ nguyên. `README.md:26` đã mô tả đúng, không đổi. Không cần test; `tests/dev-auth.test.mjs` đã bao phủ server.

## P10. `/api/ai/config` lộ nhà cung cấp và tên mô hình cho mọi người dùng (thông tin)

### Hiện trạng

`server/ai-assistant.mjs:135-140` trả `provider`, `model` cho mọi phiên, kể cả guest. Client chỉ hiển thị hai trường này ở `src/Account.jsx:444` cho người quản lý trợ lý.

### Thay đổi

Trả `provider` và `model` chỉ khi `assistant.canManage`; các trường khác giữ nguyên. `src/Account.jsx:444` đã nằm trong nhánh quản lý nên không đổi; `src/AssistantChat.jsx:40` và `src/TaskDetail.jsx:80` kiểm tra không dùng hai trường này (grep xác nhận).

### Test

`tests/ai-assistant.test.mjs` (hoặc file tương ứng): member thường và guest nhận body không có `provider`/`model`; owner nhận đủ.

## P11. Đề xuất Vyvy còn áp dụng được sau khi bình luận gọi bị xóa (thấp, nhất quán audit)

### Hiện trạng

`server/ai-comment-state.mjs:39-44` chỉ hủy run ở trạng thái `queued/reading/executing/failed`; run `completed` giữ nguyên nên các đề xuất `proposed` vẫn áp dụng được dù bình luận gốc không còn.

### Thay đổi

Trong `cancelCommentRuns`, thêm bước: với run `completed` của `comment_id`, cập nhật mọi action `status: 'proposed'` trong `actions_json` thành `'dismissed'` kèm `dismissedAt`, `reason: 'comment_removed'`. Dùng cùng khóa `FOR UPDATE` như luồng apply (`server/ai-comments.mjs:114-119`) để không đua với apply đang chạy. Giữ `apply`/`dismiss` trả 409 cho action không còn `proposed` như hiện nay.

### Test

`tests/ai-comments.test.mjs`: run hoàn tất với 1 đề xuất → sửa hoặc xóa bình luận gọi → `apply` trả 409, `GET` chi tiết cho thấy action `dismissed` với `reason: 'comment_removed'`.

## P12. `validateCall` chỉ kiểm tra khóa, không kiểm tra kiểu giá trị (thấp)

### Hiện trạng

`server/ai-comments.mjs:319-325` kiểm tra tên công cụ, tập khóa, định dạng ID và `dueAt`. `title`, `assigneeIds`, `completed`, nội dung bình luận... có thể là bất kỳ kiểu JSON nào; được lưu vào `actions_json`, hiển thị cho mọi người xem công việc, và chỉ bị từ chối lúc apply.

### Thay đổi

- Khai báo `type`/`maxLength`/`items`/`enum` trong `parameters.properties` của từng tool trong `commentTools` (đã có cấu trúc JSON-schema tối giản).
- `validateCall` kiểm tra theo schema: string có `maxLength` (mặc định 2000, `title` 300), boolean, array of ID (`assigneeIds` ≤ 20 phần tử, cùng regex ID), enum cho `status`/`priority` nếu có. Giá trị sai → `fail(400, 'Tham số thao tác không hợp lệ.')` và action ghi `status: 'failed'` như các lỗi validate hiện tại.
- Không thay đổi hành vi apply: pipeline vẫn validate lần hai.

### Test

`tests/ai-comments.test.mjs`: mock mô hình trả `title` là object, `completed` là chuỗi, `assigneeIds` 25 phần tử → run ghi action `failed`, không có đề xuất; mô hình trả đúng kiểu → đề xuất như trước.

## Ma trận kiểm thử và tiêu chí hoàn thành chung

| Lệnh | Kỳ vọng |
| --- | --- |
| `npm run test:postgres` | xanh toàn bộ, gồm các test mới ở P1–P8, P10–P12 |
| `npm run test:legacy` | xanh; cột `auth_method` tồn tại trên SQLite |
| `npm run build` | thành công |
| `npm run test:next` | xanh |
| `npm audit --omit=dev` | không High/Critical (3 Moderate của `sprintf-js` qua CLI `mammoth` được chấp nhận, không nằm trên đường chạy của ứng dụng) |

Kiểm tra thủ công trên bản production (`npm run build && npm start` với database tạm):

1. Tài khoản mật khẩu: liên kết Google cần nhập mật khẩu; đổi email không mật khẩu bị từ chối; với mật khẩu thì nhận mã và đổi được; các tab khác bị đăng xuất, tab hiện tại giữ nguyên.
2. Tài khoản đăng nhập Google: đổi email không mật khẩu được trong 10 phút; sau đó thấy nút đăng nhập lại bằng Google.
3. Hủy rồi gửi lại mã trong 60 giây bị chặn với đếm ngược.
4. Nhập email đã thuộc tài khoản khác: giao diện vẫn sang bước nhập mã; hộp thư đó nhận thư cảnh báo, không có mã.
5. Trang Sao lưu hệ thống vẫn hiển thị khi có thư mục bản sao hỏng.
6. Vyvy không đọc URL trong bình luận của người khác; hơn 10 liên kết thì báo bỏ qua.

Tài liệu cần cập nhật khi hoàn tất: `README.md` (liên kết Google cần mật khẩu, đổi email với phiên Google), `OPERATIONS.md` và `docs/DEPLOYMENT.md` (P6), `docs/COMMENT_ASSISTANT.md` (P8, P11, P12), `.env.example` (P9).
