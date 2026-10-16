# W1-T05 — Ghế, hết hạn lời mời và thanh toán cạnh tranh

Working tree HEAD `894f068ad4ad6288cbe467459fd4e0039c4764c9`, Node24/PostgreSQL17.2 chuyên biệt, schema14. Mỗi fixture dùng schema riêng; cạnh tranh dùng hai process API, hai connection riêng và connection điều phối giữ row lock workspace. Barrier chỉ mở sau khi `pg_stat_activity` xác nhận cả hai request đang đợi lock. Không dùng SQLite hoặc endpoint production phục vụ fault injection.

`tests/guest-invitations.test.mjs` bổ sung hai ca:

- **TC-W1-T05-D:** lời mời đang giữ ghế cuối; accept đã kiểm tra token và đang chờ lock cùng request mời mới. Đồng hồ fixture chuyển đúng `expiresAt` trước khi mở barrier. Accept trả409, không tạo user/member hoặc accepted receipt; lời mời mới thành công và tổng ghế bằng2. Thu hồi lời mời đã hết hạn cạnh tranh với một lời mời nữa không giải phóng ghế lần hai: revoke200, invite409, chỉ còn một reservation hợp lệ.
- **TC-W1-T05-E:** checkout gói Starter2 ghế cạnh tranh với mời thêm thành viên vào Business3 ghế. Nếu mời commit trước, checkout409 và không gọi gateway/không tạo order; nếu quote commit trước, order pending hợp lệ và lần settlement phải kiểm lại ghế. Paid callback ký bằng fixture secret cạnh tranh với lời mời: hoặc chuyển Starter thành công với2 ghế và chặn lời mời, hoặc giữ Business3 ghế và trả409 callback, không lưu paid event/paid order. Sau giảm ghế, retry callback có thể settle; replay không kéo dài kỳ lần nữa.

Hai ca đối soát business event, mutation receipt, notification/outbox và connector delivery trước/sau: không có tác dụng phụ nghiệp vụ thành công ngoài ý muốn. Chỉ gateway HTTP cục bộ giả lập được gọi; không phát sinh thanh toán thật.

Không viết lại ca đã có: `tests/cross-platform-sync.test.mjs:64` kiểm accept/revoke, hạ gói admin cạnh tranh lời mời và sửa giới hạn catalog cạnh tranh chuyển gói. `tests/billgateway-contract.test.mjs:325` kiểm reserved+active seats khi checkout/settlement và retry paid event bị chặn.

```bash
node --test --test-concurrency=1 --test-skip-pattern='\[SQLite legacy\]' \
  tests/guest-invitations.test.mjs tests/cross-platform-sync.test.mjs \
  tests/billgateway-contract.test.mjs
```

**12/12 PASS**, `artifacts/spec-all-2026-10-16/seat-expiry-checkout-races.log`. Hai ca mới đạt ngay lần chạy đầu; 10 ca còn lại là regression, không cộng lặp vào tổng requirement. Manifest `seat-expiry-checkout-manifest.json` ghi hash nguồn và runtime. Thay đổi chỉ nằm ở test và `tests/fixtures/sync-server.mjs` (clock/config fixture tùy chọn); không sửa production.

Bằng chứng này là API/PostgreSQL và gateway giả lập. Chưa chứng minh checkout browser, thanh toán provider thật hoặc toàn bộ chuỗi W1-T11 trên Web/Android.
