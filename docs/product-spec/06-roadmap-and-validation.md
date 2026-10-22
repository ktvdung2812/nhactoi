# Roadmap, validation và điều kiện phát hành

Ngày 16/10/2026. Tài liệu này nối [định vị sản phẩm](01-product-and-competition.md) với [58 task](07-tasks.md), [10 wave](08-waves.md) và [test catalog](test-cases/README.md). Không ấn định ngày giao hàng khi chưa có baseline năng lực đội, lịch provider và kết quả test.

## 1. Mục tiêu và nguyên tắc ưu tiên

1. Làm dữ liệu/quyền/nhắc việc đáng tin trước khi tăng số lượng view và connector.
2. Chứng minh luồng dịch vụ của SME: biết việc nào cần xử lý và giảm bỏ sót kỳ, không chỉ tăng số task được tạo.
3. Thêm quản lý dự án và offline để giải quyết tình huống thực tế của đội vận hành.
4. Tích hợp Google để giữ thói quen của khách; Zalo/API chỉ mở khi quyền, điều kiện provider và tác dụng phụ đã có kiểm soát.
5. Bảo toàn baseline, dữ liệu và compatibility. Không dùng downgrade/migration để xóa hoặc mở quyền private.

Giá trị ưu tiên đánh giá theo mức độ đau của nhóm khách đã chọn, tần suất xảy ra, khả năng kiểm chứng bằng dữ liệu và dependency kỹ thuật. Không xếp feature chỉ vì đối thủ có hoặc vì dễ demo.

## 2. Mốc giá trị theo wave

| Wave | Mốc người dùng nhận được | Điều kiện để công bố đã có |
|---|---|---|
| W0 | Tính năng hiện hữu tìm thấy được, số liệu/ngày/tên gói đúng | Review spec/baseline, sửa UI/nghiệp vụ; readiness Google/OA được ghi riêng |
| W1 | Project, private/guest, ghế và nền tảng sync an toàn | ACL mọi bề mặt, migration/restore, revision/receipt/outbox/concurrency đạt |
| W2 | Một vòng quản lý khách–dịch vụ–việc–gia hạn | Dashboard đối soát, chi tùy chọn đúng, lịch sử và Android parity |
| W3 | Project nâng cao có fields, views, dependencies, timeline và templates | Gate dự án và recurrence qua mọi entrypoint, không mất quyền/dữ liệu |
| W4 | Planner và tạo/sửa task ở nơi mạng yếu | Android thật: restart/force-stop/TTL/queue/conflict và không mất draft |
| W5 | Lịch làm/delegate, automation bền vững, actual/estimate và SLA | Typed events, atomic actions, timer/capacity/SLA và export đối soát |
| W6 | Chuyển dữ liệu CSV/Trello có kiểm soát | Preview không tác dụng phụ, commit nguyên tử, source dedup, giữ JSON v1 |
| W7 | Dùng Google Calendar với task và hạn chung Nhắc Tôi | Consent/mapping/two-way/delete/conflict thực trên Google account |
| W8 | Thông báo OA cho nhân viên và khách đúng điều kiện | Template/recipient đủ điều kiện, delivery/callback/unknown và thử OA thật |
| W9 | Tích hợp bên ngoài và release tổng thể | Token/API/OpenAPI/webhook, recovery và các gate W2–W8 |

Đánh số wave thể hiện nhóm kết quả, không bắt buộc mọi việc chạy tuần tự. W2/W3/W4 có thể mở sau W1; W5/W6/W7/W8 theo dependency chi tiết. Calendar phụ thuộc planner W4-T01, không cần đợi toàn bộ offline. W8 có thể bắt đầu khi W2-T03 và nền tảng đã đạt. Tối đa ba lane triển khai và một điều phối; owner tích hợp giữ router/schema/types/backup và thứ tự migrations.

## 3. Pilot để kiểm chứng khách có Google vẫn chọn Nhắc Tôi

Pilot D04 nằm ngoài 58 task feature, không tự động mở hoạt động outreach. Dùng 5–8 doanh nghiệp phù hợp đã đồng ý tham gia, đang sử dụng Google Calendar/Tasks hoặc cách làm tương đương, trong khoảng một tháng. Chọn đa dạng đội dịch vụ/agency và ít nhất một tình huống cần Android mạng yếu. Không lấy số doanh nghiệp nhỏ này để tuyên bố kết quả đại diện toàn thị trường.

### Các bước thực hiện

1. **Baseline:** quan sát quy trình hiện tại, số khách/dịch vụ/việc, cách giao nhận, các lần đôn đốc, kỳ bỏ sót và công nhập liệu. Chốt định nghĩa chỉ số trước khi dùng sản phẩm; lấy dữ liệu lịch sử có bằng chứng, không suy từ trí nhớ thành số chính xác.
2. **Onboarding:** đưa một quy trình thật vào sản phẩm bằng nhập dữ liệu nhỏ hoặc nhập tay; người phụ trách xác nhận quyền, assignee, mốc và loại thông báo. Kết nối Calendar có consent, không bắt chuyển toàn bộ hệ thống.
3. **Sử dụng:** cho đội dùng luồng đã nghiệm thu; thu event tối thiểu đủ đo activation/ack/completion/renewal, ghi lỗi/conflict/support. Chỉ dùng thông báo thật khi recipient/provider đã được phép.
4. **Đánh giá:** so với baseline của cùng đội, làm rõ tuần bất thường và việc sử dụng song song công cụ khác. Phỏng vấn lý do tiếp tục/ngừng, thử thanh toán gói đúng nhu cầu.
5. **Quyết định:** ưu tiên sửa chất lượng/onboarding nếu khách chưa đạt first value; chỉ mở feature mới khi có nhu cầu lặp lại và người mua cụ thể. Thay giá/quota cần quyết định riêng D05.

### Chỉ số và cách đọc

| Chỉ số | Định nghĩa/bằng chứng | Không diễn giải thành |
|---|---|---|
| First value | Từ onboarding đến một vòng giao→ack→xử lý có dữ liệu thật; luồng dịch vụ đo thêm đến kỳ/gia hạn thích hợp | Tạo tài khoản hoặc tạo task demo là đã nhận giá trị |
| Adoption | Người có việc được giao và có hành động hợp lệ theo tuần; tách người quản lý/nhân viên/guest | Số login hoặc tổng member bằng số người dùng hiệu quả |
| Công đôn đốc | Số lần và thời gian người quản lý phải hỏi lại, cùng phương pháp trước/sau | Số notification gửi nhiều hơn nghĩa là giảm công việc |
| Xử lý kỳ dịch vụ | Kỳ đến hạn được xử lý/hoãn có lý do/bỏ sót, đối soát service cycle | Click renewal là đã thu tiền hoặc khách đã thanh toán |
| Nhận việc/đúng hạn | Thời gian ack theo assignment cycle; completion cycle có deadline snapshot; task count tách riêng | Gửi push thành công là đã đọc/nhận; dữ liệu thiếu event là đạt SLA |
| Sync/offline | Pending được giải quyết, conflict cần xử lý, draft mất, duplicate mutation và độ trễ từ reconnect dùng được | App force-stop vẫn phải sync, hoặc response provider lost chắc chắn là fail |
| Chi phí vận hành | Thời gian setup, hỗ trợ, sửa mapping, xử lý delivery unknown, chi phí provider | Chỉ giá subscription mà bỏ công thiết lập và rủi ro dữ liệu |
| Ý định trả tiền/thanh toán | Lý do, gói lựa chọn, invoice/payment có bằng chứng; phân biệt lời nói và giao dịch | Câu “thấy hữu ích” là khách mua |

Đặt mục tiêu kinh doanh cùng doanh nghiệp trước pilot; không bịa ngưỡng thành công thương mại khi chưa có baseline. Đối với correctness, ngưỡng release là không còn P0/P1 bắt buộc thất bại hoặc chưa chạy; mất/rò dữ liệu, ghi tiền trùng và queue gây mutation trái quyền luôn là lỗi chặn.

## 4. Kiểm thử và evidence

Test catalog đã mô tả Given/When/Then, dữ liệu chuẩn, vai trò, lớp, API/UI/DB/side effects và suite cần tái sử dụng. Mỗi task phải gắn requirement/test trước khi hoàn tất, không gom viết test sang W9. Gate độc lập đọc bằng chứng theo build, không lấy ảnh UI hoặc tổng pass thay assertion dữ liệu/quyền.

Các nhóm bằng chứng:

- Unit/component: parsing, tính lịch, policy, UI state; không chứng minh thiết bị hay provider thật.
- PostgreSQL/API: tenant ownership, row locks, unique constraints, transaction, revision/receipt và worker. Dùng process/connection độc lập cho concurrency.
- Legacy/import/recovery: snapshot cũ, WAL, schema version, relation/checksum/file, sender state và khóa giải mã.
- Web runtime/browser: production Next HTTP riêng với thao tác trình duyệt; keyboard, narrow/wide, loading/error và UI↔API consistency.
- Android thật: network/restart/force-stop/upgrade/SQLCipher/secure storage/TalkBack; build APK thành công chưa đủ gate.
- Provider thật: Google và OA tài khoản được phép, request/event/template/channel ID và kết quả đã che secret. Mock chỉ kiểm tra adapter/contract.

`NOT RUN`, `FAIL`, `BLOCKED`, `PASS` là kết quả chạy; mức Có sẵn/Cần mở rộng/Chưa viết/Thủ công là trạng thái triển khai test. Không dùng hai trục này thay thế nhau. [Mẫu hồ sơ](test-cases/README.md) là chuẩn ghi nhận.

## 5. Rollout và vận hành

1. **Baseline và backup:** chụp schema, snapshot dữ liệu và lockfiles/dirty build; kiểm tra restore ở môi trường riêng trước migration quan trọng. Không chạy test với database sản xuất.
2. **Expand/backfill:** thêm entity/relations bằng migrations mới, validate ownership/count/FK; đọc/ghi legacy giữ nghĩa. Không rewrite migration đã áp dụng.
3. **Bật theo phạm vi:** dùng cấu hình/feature flags hiện hữu hoặc cơ chế tối thiểu cho tính năng mới; pilot workspace trước. UI chỉ hiển thị quyền thực; server và worker luôn enforce dù flag/client cũ.
4. **Theo dõi:** transaction failure, conflict, receipt replay, outbox age/attempt/unknown, sender suppressed, sync cursor/watch health và quota. Log dùng ID, không chứa token hoặc nội dung private không cần thiết.
5. **Dừng an toàn:** tắt sender/connector hoặc premium write mà không xóa dữ liệu; giữ draft và lịch sử. Sau restore sender mặc định tắt, đối soát sent/unknown trước khi mở lại.
6. **Khôi phục:** rollback ứng dụng chỉ khi schema còn tương thích; nếu không thì dùng recovery đã thử. Backup cũ không tự biết các mutation xảy ra sau snapshot; cần đối soát nguồn dữ liệu/provider, không hứa khôi phục không mất giao dịch ngoài cửa sổ backup.

Multiworker scale, connector Google Tasks, date-only deadline, booking và thay đổi pricing không tự trở thành phần rollout này. Giữ deployment single sender đến khi có kế hoạch scale riêng đã nghiệm thu.

## 6. Điều kiện hoàn thành và cập nhật kế hoạch

- Đủ sản phẩm spec, data/interface contracts, tasks/dependencies, tests và evidence tương ứng; không để requirement chỉ nằm trong chat.
- Mỗi wave đạt gate của chính nó; blocker OAuth/OA được ghi rõ và chỉ chặn phạm vi tích hợp phụ thuộc, không làm thất bại phần nội bộ đã đạt.
- Release có tuyên bố đầy đủ toàn roadmap phải đạt W9-T05 và W2–W8 gates. Release một phần phải ghi đúng tính năng được bật, không quảng cáo connector chưa qua provider gate.
- Pilot không được tự gửi email/Zalo hoặc tuyển khách nếu chưa có yêu cầu thực hiện; spec này chỉ mô tả hoạt động nghiên cứu được đề xuất.
- Khi đổi quyết định: ghi ID, ngày, lý do, nguồn bằng chứng, task/test/data migration liên quan và cách giữ tương thích. Không sửa âm thầm expected test cho khớp một lỗi implementation.
