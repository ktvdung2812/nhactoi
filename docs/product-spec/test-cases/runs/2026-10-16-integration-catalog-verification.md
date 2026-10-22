# Đối soát catalog và kiểm chứng W4, W6–W9

Ngày chạy: 2026-10-16. HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9`, working tree có sẵn được giữ nguyên. Node `v24.21.0`, PostgreSQL `17.2`, schema `14`. Đây là lượt kiểm chứng hiện tại, không thay thế lịch sử chạy trước hoặc nghiệm thu toàn bộ biến thể của một case.

## Catalog

[Catalog offline/import/tích hợp](../03-offline-imports-integrations.md) có **114/114** ID bắt buộc theo kế hoạch: W4 26, W6 21, W7 25, W8 18 và W9 24. Không thiếu/trùng ID, mỗi hàng giữ đủ các cột metadata, thao tác, expected, phần tái sử dụng và hồ sơ thực thi. Account/fixture/thời gian/nền tảng và requirement kế thừa metadata chung của từng task.

## Kết quả thực thi

| Lượt | Kết quả thực tế | Phân loại |
|---|---|---|
| Cấu hình `.env.test.local` đang có | Runner exit 1; 10 PASS, 75 lỗi khởi tạo PostgreSQL: role `nhactoi` không tồn tại. Chưa tạo được fixture cho các ca DB | **BLOCKED môi trường**; không ghi thành lỗi nghiệp vụ hoặc PASS |
| Database thử độc lập trên PostgreSQL local | Runner exit 0; **85/85 PASS**, 0 FAIL, 0 SKIP; 53.308 giây | **PASS phần API/DB/unit/transport giả lập đã chạy** |

Đã tạo database riêng `nhactoi_plan_tests_20261016` trên PostgreSQL local, dùng role local hiện hữu và override `TEST_DATABASE_URL` riêng trong lệnh. Không sửa `.env`, `.env.test.local`, role hay database ứng dụng. Mỗi suite tiếp tục tạo/dọn schema ngẫu nhiên bằng `tests/database-helpers.mjs`.

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/nhactoi_plan_tests_20261016 \
node --env-file-if-exists=.env.test.local --test --test-concurrency=2 --test-timeout=60000 \
  tests/android-offline-replay.test.mjs tests/planner-pagination.test.mjs \
  tests/project-imports.test.mjs tests/import-offline-acl.test.mjs \
  tests/google-calendar.test.mjs tests/google-calendar-transport.test.mjs \
  tests/zalo-oa.test.mjs tests/zalo-oa-transport.test.mjs tests/zalo-restore.test.mjs \
  tests/public-api.test.mjs tests/cross-wave-downgrade.test.mjs
```

Các assertion bao gồm replay qua HTTP/PostgreSQL, revision và receipt; import atomic/source dedupe/ACL; Google OAuth state, reconnect/disconnect race, projection, paging và conflict; OA quyền/template/unknown/callback/lease; API token/contract, webhook SSRF/HMAC/backoff; luồng X08/X09/X10/X11. Các suite cạnh tranh tương ứng có connection/process độc lập và barrier. Các lỗi fault injection xuất hiện trong log là lỗi cố ý được assertion đối soát rollback; runner cuối vẫn exit 0.

## Bằng chứng và giới hạn

- [Manifest và kết quả](../../../../artifacts/plan-verification-2026-10-16/integrations/manifest.json).
- [Log cấu hình ban đầu bị chặn](../../../../artifacts/plan-verification-2026-10-16/integrations/configured-database-attempt.log).
- [Log PostgreSQL riêng 85/85](../../../../artifacts/plan-verification-2026-10-16/integrations/isolated-postgres.log).
- [SHA-256 source/lockfile](../../../../artifacts/plan-verification-2026-10-16/integrations/source-snapshot.json): 189 file, chụp ngay sau khi runner khởi chạy và đối chiếu sau khi hoàn tất; không file nào thay đổi giữa hai mốc. Artifact đang lưu local, chưa tải lên kho bằng chứng chung.

Không thêm code production hoặc test mới trong lượt này vì suite phù hợp đã tồn tại. Provider Google/OA và webhook receiver là giả lập; Android chỉ chạy state qua Node và HTTP, chưa chạy APK/SQLCipher vật lý. Không chạy browser E2E. W4-T05, W7-T05, W8-T04 và gate phát hành vẫn cần bằng chứng tương ứng; **85 test PASS không nâng các gate đó hoặc toàn bộ 114 ca thành PASS**. Các hồ sơ catalog `NOT RUN` giữ expected baseline; actual của lượt này được lưu riêng tại báo cáo và manifest trên.
