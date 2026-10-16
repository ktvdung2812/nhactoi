# Hoàn thiện kế hoạch kiểm thử 58 task / 10 wave

Run `test-plan-review-2026-10-16`, ngày 16/10/2026. Đây là lần đối soát và chạy lại trên working tree hiện tại. Khi bắt đầu, repo đã có năm tài liệu catalog, checklist task/wave và các suite W0–W9; giữ nguyên phần triển khai đó, không coi chúng là test mới của lượt này. Kết quả dưới đây thay thế việc suy từ báo cáo lịch sử, nhưng không thay trạng thái toàn ca bằng tổng số test pass.

## Phạm vi hoàn thiện

- Đối chiếu **275 mục bắt buộc** trong yêu cầu, giữ hai ca `TC-W2-T03-H/I` từ spec hiện có; đủ **277 checklist case**, **58 task**, **10 wave** và **12 ca xuyên suốt**.
- Giữ **80 ID `TC-FND-001`–`080`** và 79 alias W0–W1; tổng **308 ca canonical**, không tính alias thành ca mới. Sửa các task liên quan bị thiếu của FND-030/037/039/071/075.
- Cập nhật cột tái sử dụng và hồ sơ thực thi của **84 ca W2/W3/W5**, phân biệt assertion hiện có với UI/biến thể chưa kiểm. Đối soát đủ **114 ca W4/W6–W9**.
- Bỏ liên kết H/I bị lặp trong ma trận README. Các mặc định kỹ thuật vẫn là đề xuất; Google Tasks connector, deadline chỉ có ngày và booking vẫn thuộc discovery.
- Thêm **11 test tự động `TC-W2-T03-E`** trong `tests/service-renewal-faults.test.mjs`: lỗi tại từng lần ghi, snapshot 15 bảng không đổi, retry/replay cùng operation ID giữ một tập tác dụng phụ. [Hồ sơ riêng](2026-10-16-service-renewal-faults.md) ghi từng ranh giới và actual; giữ ID catalog hiện có.
- Checklist giữ nguyên trạng thái chưa nghiệm thu khi thiếu bằng chứng. Không tạo/sửa task trên bảng ngoài repo; không thay đổi mã sản phẩm hoặc dependency.

[Review cấu trúc](../../../../artifacts/test-plan-review-2026-10-16/catalog-validation.json): **PASS**, 1.327 liên kết kiểm tra không lỗi; đủ ID/checklist/anchor, không trùng canonical ID. Đây là kiểm tra tài liệu, không là test chức năng hay bằng chứng E2E.

## Snapshot và môi trường

- HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree dirty có sẵn. [Snapshot trước khi chạy](../../../../artifacts/test-plan-review-2026-10-16/snapshot-before.json) giữ SHA-256 của 432 file; [git status ban đầu](../../../../artifacts/test-plan-review-2026-10-16/working-tree-before.txt). Không reset hoặc commit thay đổi người dùng.
- macOS `26.7.1`, arm64; Node `v24.21.0`, npm `11.19.0`; Next `16.3.8`, Expo `57.0.26`, React Native `0.86.3`; schema ứng dụng `14`.
- Đã đọc hướng dẫn kiểm thử Next được cài tại `node_modules/next/dist/docs/01-app/02-guides/testing/index.md` và `testing/playwright.md`. Không sửa API Next/Expo trong lượt này.
- `.env.test.local` trỏ tới DB khác ứng dụng nhưng xác thực bị từ chối, SQLSTATE `28000`: [preflight BLOCKED](../../../../artifacts/test-plan-review-2026-10-16/postgres-preflight.json). Không thay credential hoặc chuyển test DB sang SQLite.
- Tạo **cluster PostgreSQL 17.2 riêng**, chỉ lắng nghe loopback, database `nhactoi_test_plan`; override `TEST_DATABASE_URL` riêng cho runner, giữ nguyên các file `.env`. Mỗi suite dùng schema tạm/cleanup của `tests/database-helpers.mjs`; ca cạnh tranh dùng process/connection và barrier theo suite hiện có. [Môi trường thử](../../../../artifacts/test-plan-review-2026-10-16/postgres-cluster.json).
- Production Next build ở thư mục riêng `artifacts/test-plan-review-2026-10-16/next-build`, ID **`D0dvc51AlFsBmYja0zI-3`**. Các manifest server/runtime/mobile xác nhận source đầu/cuối không đổi trong từng lượt. Full suite đầu chưa bao gồm 11 test gia hạn mới; lần PostgreSQL cuối có manifest riêng và bao gồm chúng.
- Fixture, tài khoản, đồng hồ và biến thể của các suite theo chính mã test, không tự gán toàn bộ ma trận BASE/REPORT-5 cho mọi assertion. Provider/transport trong suite là giả lập. Build APK chưa cài lên thiết bị thật. Lệnh `adb devices -l` không trả thiết bị kết nối ở lần kiểm tra này; [inventory](../../../../artifacts/test-plan-review-2026-10-16/android-devices.txt).

## Kết quả chạy lại

Expected chung của mỗi lệnh: runner tự hoàn tất, exit 0, mọi assertion được chọn đạt; build tạo artifact tương ứng. Lỗi cố ý từ fault injection được suite kiểm tra rollback, không phải lỗi runner.

| Lệnh / lớp bằng chứng | Actual | Kết quả | Log |
|---|---|---|---|
| `npm run test:postgres` — cuối, gồm 11 ca mới | **445/445**, 0 fail, 0 skip; 78,7 giây; source không đổi | PASS | [PostgreSQL cuối](../../../../artifacts/test-plan-review-2026-10-16/postgres-final.log) |
| `npm run test:postgres` — baseline trước 11 ca mới | 434/434, 0 fail, 0 skip; 73,6 giây | PASS | [PostgreSQL](../../../../artifacts/test-plan-review-2026-10-16/postgres.log) |
| `npm run test:legacy` — migration SQLite cũ | 19 ca có tên `[SQLite legacy]` đạt; runner tổng 84 gồm file không có ca khớp, không dùng 84 làm coverage | PASS | [Legacy](../../../../artifacts/test-plan-review-2026-10-16/legacy.log) |
| `node --test tests/web-denial-component-check.mjs tests/web-mutation-component-check.mjs` | 32/32; transport giả lập, không thao tác browser | PASS | [Component Web](../../../../artifacts/test-plan-review-2026-10-16/web-components.log) |
| `npm run build` với dist dir riêng | Exit 0, production build ID như trên | PASS | [Next build](../../../../artifacts/test-plan-review-2026-10-16/build.log) |
| `npm run test:next` với cùng dist dir và PostgreSQL thử | 1/1 HTTP production runtime, exit 0; không phải browser E2E | PASS | [Next HTTP](../../../../artifacts/test-plan-review-2026-10-16/next.log) |
| mobile `npm run typecheck` | Exit 0 | PASS | [Typecheck](../../../../artifacts/test-plan-review-2026-10-16/mobile-typecheck.log) |
| mobile `npm run lint` | Exit 0; cảnh báo module type hiện có | PASS | [Lint](../../../../artifacts/test-plan-review-2026-10-16/mobile-lint.log) |
| mobile `npm run test:unit` | 24/24, exit 0 | PASS | [Unit](../../../../artifacts/test-plan-review-2026-10-16/mobile-unit.log) |
| mobile `npm run test:components` | 23 suites, 111/111; Jest tự thoát, exit 0 | PASS | [Component Android](../../../../artifacts/test-plan-review-2026-10-16/mobile-components.log) |
| mobile `npm run build:android` | Exit 0; Gradle BUILD SUCCESSFUL; APK debug 275.951.730 bytes; 257,5 giây | PASS build | [APK build](../../../../artifacts/test-plan-review-2026-10-16/mobile-build.log) |

[Manifest PostgreSQL cuối](../../../../artifacts/test-plan-review-2026-10-16/final-postgres-manifest.json), [server baseline](../../../../artifacts/test-plan-review-2026-10-16/server-manifest.json), [runtime](../../../../artifacts/test-plan-review-2026-10-16/runtime-manifest.json) và [mobile](../../../../artifacts/test-plan-review-2026-10-16/mobile-manifest.json) lưu command, thời điểm, thời lượng, exit code, SHA-256 log và source trước/sau. [Build artifacts](../../../../artifacts/test-plan-review-2026-10-16/build-artifacts.json) lưu runtime, lockfile và APK hash; APK SHA-256 `17ecf078b1743d1f26c6122cac5d12ddb178e78d90caef77468234e198c1dca0`.

[Lượt kiểm chứng tích hợp riêng](2026-10-16-integration-catalog-verification.md) đạt 85/85 trên database thử khác, giữ cả lỗi cấu hình ban đầu. Các test đó nằm trong full suite, **không cộng lặp** vào 445 ca. Lượt riêng gia hạn 20/20 gồm 9 ca cũ và 11 ca mới; root bổ sung assertion HTTP 200 cho history/replay trước khi chạy full suite cuối. Hồ sơ lượt riêng giữ snapshot của chính lượt đó.

## Điều kiện nghiệm thu còn thiếu

| Phạm vi | Trạng thái lượt này | Điều kiện cần để nghiệm thu |
|---|---|---|
| Browser E2E, responsive, keyboard và toàn luồng Web/Android | NOT RUN | QA chạy từng biến thể trên build cụ thể, lưu ảnh/video và đối soát dữ liệu; component/HTTP không thay lớp này |
| W4-T05, SQLCipher vật lý, mạng/vòng đời/force-stop/TalkBack | BLOCKED thiết bị thật | Chuẩn bị thiết bị và cài APK; thử theo catalog, giữ draft/queue/TTL đúng hợp đồng |
| W7-T05 Google thật | BLOCKED provider | Manifest OAuth/scopes/test account/quota hợp lệ, consent riêng và request/event ID thật |
| W8-T04 OA thật | BLOCKED provider | OA/template/người nhận được phép, bằng chứng accepted/delivered/read và revoke thật |
| TC-X07 toàn ca hiệu năng | NOT RUN lượt này | Giữ kết quả tải lịch sử riêng; cần đủ API/query/memory/UI trên môi trường tham chiếu, không suy từ thời gian regression |
| W9-T05 phát hành đầy đủ | NOT RUN, chưa mở gate | Toàn P0/P1 thuộc gate có evidence đúng lớp; các gate provider/device bị chặn vẫn giữ chặn |

Cluster PostgreSQL tạm của full runner đã dừng và thư mục tạm đã dọn; kiểm tra trước dừng còn **0 schema test**. Xem `postgres-cleanup.json` trong cùng thư mục artifact. Database thử riêng của lượt tích hợp/gia hạn không phải database ứng dụng.

Các artifact được liên kết đang lưu **local**, chưa tải lên kho bằng chứng chung. Báo cáo chỉ ghi PASS ở đúng lớp đã chạy; 100% có test case trong catalog không đồng nghĩa 100% requirement đã nghiệm thu.
