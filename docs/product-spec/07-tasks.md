# Backlog triển khai Nhắc Tôi — 58 task

Ngày lập: 2026-10-16. Đây là backlog **đặc tả**, chưa phải task đã tạo trên bảng công việc và không phải báo cáo tính năng đã hoàn thành. `Wn-Tnn` là ID ổn định trong bộ spec. Trạng thái mặc định của các task triển khai: **Chưa triển khai theo spec này**; task tài liệu W0-T01 chỉ đạt khi kiểm tra hoàn chỉnh bộ spec. Việc lưu tài liệu không tự hoàn thành các gate hoặc các ca `NOT RUN`.

Đọc cùng [spec chức năng](03-functional-spec.md), [tích hợp](04-integrations.md), [kiến trúc/dữ liệu](05-architecture-and-data.md), [waves](08-waves.md) và [test catalog](test-cases/README.md). Mỗi mục sau có phạm vi, đầu ra, dependency và điều kiện nghiệm thu để giao trực tiếp cho kỹ sư hoặc agent. Task không được coi là xong chỉ vì đã có UI; API, quyền, dữ liệu, lỗi và bằng chứng phải cùng đáp ứng.

Đối chiếu evidence và nợ từng mã tại [sổ nghiệm thu 58 task](test-cases/runs/2026-10-16-acceptance-ledger.md). [Lượt đối soát kế hoạch](test-cases/runs/2026-10-16-test-plan-review.md) xác nhận đủ checklist 58 task; kết quả regression không tự đánh dấu các case chưa đủ bằng chứng.

Tiến độ thực thi mới nhất ở [báo cáo triển khai](10-implementation-status.md): mã nguồn W0–W9 và hồi quy nội bộ đang được hoàn thiện; các checklist chưa có đủ bằng chứng toàn case vẫn chưa đánh dấu đạt.

## Quy ước giao việc và hoàn thành

- **Dependency cứng** phải đạt trước khi merge/bật chức năng phụ thuộc; có thể chuẩn bị thiết kế/fixture trên hợp đồng đã chốt nhưng không coi mock là nghiệm thu end-to-end.
- **Web + Android** áp dụng cho chức năng cốt lõi. Một task ghi rõ UI nền tảng khác không thay đổi yêu cầu parity của wave. Quản trị chuyên sâu có thể ở Web theo spec; Android không được gọi API để vượt quyền.
- **Definition of Done chung:** sửa trong service nghiệp vụ đang dùng; validation và quyền ở server; migration/backup/restore nếu đổi dữ liệu; API/client tương thích theo hợp đồng; UI đủ loading/empty/error/conflict; test bắt buộc đạt; cập nhật spec và bằng chứng. Không thêm framework hoặc dịch vụ vận hành mới nếu hạ tầng hiện tại đáp ứng.
- **Test:** `TC-Wn-Tnn-A…F` nghĩa là từng ca độc lập A đến F trong tài liệu được liên kết. W0/W1 dùng alias ánh xạ tới `TC-FND-*`; phải chạy toàn bộ ca chuẩn liên quan, không đếm alias thành test mới. Các ca TC-X áp dụng theo phạm vi wave đã triển khai.
- **Quyền và gói:** tính năng được phép là giao giữa quyền hiện tại và entitlement. Không dựa vào tên gói, UI hoặc token cũ. Guest tính ghế; invitation hợp lệ giữ ghế; dữ liệu private không tự công khai khi downgrade.
- **Bằng chứng:** lưu commit/build/schema, môi trường, fixture, expected/actual và log/ảnh/provider ID đã che secret. Có sẵn suite liên quan không có nghĩa ca đã đạt; test chưa chạy ghi `NOT RUN`.

| Wave | Số task | Mục tiêu |
|---|---:|---|
| W0 | 6 | Spec, baseline, sửa nền tảng, readiness provider |
| W1 | 11 | Project, quyền, ghế, revision, idempotency, outbox |
| W2 | 5 | Vận hành SME và gia hạn dịch vụ |
| W3 | 6 | Dự án nâng cao |
| W4 | 5 | Planner và Android offline |
| W5 | 6 | Lịch làm việc, automation, time/capacity/SLA |
| W6 | 5 | Import CSV/Trello |
| W7 | 5 | Google Calendar hai chiều |
| W8 | 4 | Zalo OA doanh nghiệp |
| W9 | 5 | Public API, webhook và gate phát hành |
| **Tổng** | **58** | Discovery được liệt kê riêng, không cộng vào 58 |

## W0 — Đặc tả, baseline và sửa nền tảng

<a id="w0-t01"></a>
### W0-T01 — Hoàn thiện bộ spec và truy vết

- **Mục tiêu:** mọi mô tả cần để triển khai nằm trong `docs/product-spec/`, không phụ thuộc đọc lại chat.
- **Phạm vi/đầu ra:** phân tích hiện trạng và cạnh tranh; định vị SME; quyết định và giả định; chức năng Web/Android; tích hợp; dữ liệu/quyền; 58 task; 10 wave; test, fixture và ma trận truy vết. Nguồn bên ngoài có URL/ngày kiểm chứng; phân biệt UI sản phẩm với khả năng API.
- **Phụ thuộc:** không có.
- **Nghiệm thu:** đủ phạm vi đã chốt; quyết định người dùng và mặc định đề xuất được phân biệt; không trình bày backlog như chức năng đã có; ID, link và dependency nhất quán; không có requirement bắt buộc thiếu test/review.
- **Test/review:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T01-A…C`.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T01-A](test-cases/01-foundation.md#alias-tc-w0-t01-a) — kết quả riêng cho requirement `RQ-W0-T01-A`.
- [ ] [TC-W0-T01-B](test-cases/01-foundation.md#alias-tc-w0-t01-b) — kết quả riêng cho requirement `RQ-W0-T01-B`.
- [ ] [TC-W0-T01-C](test-cases/01-foundation.md#alias-tc-w0-t01-c) — kết quả riêng cho requirement `RQ-W0-T01-C`.
- [ ] Review/baseline/readiness có ngày, nguồn và bằng chứng môi trường/provider; điều kiện còn thiếu ghi BLOCKED và gate bị ảnh hưởng.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w0-t02"></a>
### W0-T02 — Ghi nhận baseline và môi trường kiểm thử

- **Mục tiêu:** có mốc đối chiếu trước triển khai, bảo toàn thay đổi người dùng.
- **Phạm vi/đầu ra:** working tree/HEAD/lockfile hash, runtime Node/Next/Expo, schema và dependency; đọc AGENTS và tài liệu đúng phiên bản; chạy các suite hiện có bằng database thử riêng và ghi lỗi đã tồn tại.
- **Phụ thuộc:** không có.
- **Nghiệm thu:** không reset thay đổi sẵn có; không tự nâng dependency để làm test pass; báo cáo phân biệt đã chạy/skip/blocked; source/component không được ghi thành browser E2E hoặc thiết bị thật. Chưa cài dependency thì ghi thiếu môi trường, không suy kết quả build.
- **Test/review:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T02-A…C`; lệnh/manifest ở [test README](test-cases/README.md).

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T02-A](test-cases/01-foundation.md#alias-tc-w0-t02-a) — kết quả riêng cho requirement `RQ-W0-T02-A`.
- [ ] [TC-W0-T02-B](test-cases/01-foundation.md#alias-tc-w0-t02-b) — kết quả riêng cho requirement `RQ-W0-T02-B`.
- [ ] [TC-W0-T02-C](test-cases/01-foundation.md#alias-tc-w0-t02-c) — kết quả riêng cho requirement `RQ-W0-T02-C`.
- [ ] Review/baseline/readiness có ngày, nguồn và bằng chứng môi trường/provider; điều kiện còn thiếu ghi BLOCKED và gate bị ảnh hưởng.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w0-t03"></a>
### W0-T03 — Hoàn thiện lối truy cập các chức năng hiện hữu

- **Mục tiêu:** người dùng tìm và sử dụng được nhãn, người phối hợp, copy, automation và template đang có nền tảng nghiệp vụ.
- **Phạm vi/đầu ra:** UI và quyền cho các thao tác trên Web/Android; chỉ một luồng checklist rõ ràng trong detail; lịch sử nhắc đủ email/FCM/Web Push và kênh mở rộng sau này. Không viết lại nghiệp vụ có sẵn.
- **Phụ thuộc:** W0-T02.
- **Nghiệm thu:** thao tác lưu đúng qua thiết bị khác; copy dùng ID mới, giữ checklist/recurrence hợp lệ; direct URL/API không vượt quyền; lịch sử phân biệt accepted/failed và ack công việc, không suy accepted là đã đọc.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T03-A…E`; TC-X01/X03/X04/X05/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T03-A](test-cases/01-foundation.md#alias-tc-w0-t03-a) — kết quả riêng cho requirement `RQ-W0-T03-A`.
- [ ] [TC-W0-T03-B](test-cases/01-foundation.md#alias-tc-w0-t03-b) — kết quả riêng cho requirement `RQ-W0-T03-B`.
- [ ] [TC-W0-T03-C](test-cases/01-foundation.md#alias-tc-w0-t03-c) — kết quả riêng cho requirement `RQ-W0-T03-C`.
- [ ] [TC-W0-T03-D](test-cases/01-foundation.md#alias-tc-w0-t03-d) — kết quả riêng cho requirement `RQ-W0-T03-D`.
- [ ] [TC-W0-T03-E](test-cases/01-foundation.md#alias-tc-w0-t03-e) — kết quả riêng cho requirement `RQ-W0-T03-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w0-t04"></a>
### W0-T04 — Sửa các sai lệch nghiệp vụ và hiển thị

- **Mục tiêu:** số tiền, tên gói, người được giao và ngày hôm nay có nghĩa chính xác.
- **Phạm vi/đầu ra:** phân loại thu/chi theo loại giao dịch thay vì dấu amount; tên gói lấy catalog; lọc cả assignee chính/phối hợp; ngày hôm nay theo UTC+7.
- **Phụ thuộc:** W0-T02.
- **Nghiệm thu:** thu 100/chi 40 đều dương cho balance 60; tên tùy chỉnh không đổi quyền; một task nhiều người không lặp; ngày đổi đúng 17:00 UTC và không sửa deadline đã lưu.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T04-A…D`; TC-X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T04-A](test-cases/01-foundation.md#alias-tc-w0-t04-a) — kết quả riêng cho requirement `RQ-W0-T04-A`.
- [ ] [TC-W0-T04-B](test-cases/01-foundation.md#alias-tc-w0-t04-b) — kết quả riêng cho requirement `RQ-W0-T04-B`.
- [ ] [TC-W0-T04-C](test-cases/01-foundation.md#alias-tc-w0-t04-c) — kết quả riêng cho requirement `RQ-W0-T04-C`.
- [ ] [TC-W0-T04-D](test-cases/01-foundation.md#alias-tc-w0-t04-d) — kết quả riêng cho requirement `RQ-W0-T04-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w0-t05"></a>
### W0-T05 — Readiness Google Calendar

- **Mục tiêu:** xác định chính xác điều kiện cho connector Calendar trước W7.
- **Phạm vi/đầu ra:** manifest OAuth client/scopes/callback/test users, trạng thái xác minh/quota, tài liệu provider và kế hoạch test account. Consent Calendar riêng với Google login; hướng mặc định là `calendar.app.created` và lịch app tạo.
- **Phụ thuộc:** W0-T01.
- **Nghiệm thu:** state/user/workspace/callback được ràng buộc trong thiết kế; scope không bị mô tả thành quyền đọc lịch khác/freebusy; thiếu xác minh/tài khoản được ghi rõ với người xử lý. Review readiness hoàn tất không có nghĩa gate Google thật đã đạt.
- **Test/review:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T05-A…C`; TC-X01. Điều kiện bên ngoài chưa đạt chỉ chặn W7 thật, không chặn W1–W6 độc lập.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T05-A](test-cases/01-foundation.md#alias-tc-w0-t05-a) — kết quả riêng cho requirement `RQ-W0-T05-A`.
- [ ] [TC-W0-T05-B](test-cases/01-foundation.md#alias-tc-w0-t05-b) — kết quả riêng cho requirement `RQ-W0-T05-B`.
- [ ] [TC-W0-T05-C](test-cases/01-foundation.md#alias-tc-w0-t05-c) — kết quả riêng cho requirement `RQ-W0-T05-C`.
- [ ] Review/baseline/readiness có ngày, nguồn và bằng chứng môi trường/provider; điều kiện còn thiếu ghi BLOCKED và gate bị ảnh hưởng.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w0-t06"></a>
### W0-T06 — Readiness Zalo OA và template

- **Mục tiêu:** xác định OA, API, mẫu và người nhận đủ điều kiện cho W8.
- **Phạm vi/đầu ra:** mỗi doanh nghiệp dùng OA của mình; kiểm chứng authorization, API chính thức, template/CTA/mục đích và recipient eligibility; tài khoản/người nhận thử được cho phép.
- **Phụ thuộc:** W0-T01.
- **Nghiệm thu:** có bảng mẫu nội bộ/giao dịch/chăm sóc/quảng bá và điều kiện hiện hành; thiếu template/OA/token được ghi blocked ở gate liên quan; không dùng OA/token ngoài phạm vi hoặc gửi thật chỉ để kiểm tra readiness.
- **Test/review:** [nền tảng](test-cases/01-foundation.md), `TC-W0-T06-A…C`. Provider chưa sẵn sàng không chặn wave nội bộ độc lập.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W0-T06-A](test-cases/01-foundation.md#alias-tc-w0-t06-a) — kết quả riêng cho requirement `RQ-W0-T06-A`.
- [ ] [TC-W0-T06-B](test-cases/01-foundation.md#alias-tc-w0-t06-b) — kết quả riêng cho requirement `RQ-W0-T06-B`.
- [ ] [TC-W0-T06-C](test-cases/01-foundation.md#alias-tc-w0-t06-c) — kết quả riêng cho requirement `RQ-W0-T06-C`.
- [ ] Review/baseline/readiness có ngày, nguồn và bằng chứng môi trường/provider; điều kiện còn thiếu ghi BLOCKED và gate bị ảnh hưởng.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W1 — Nền tảng quyền và dữ liệu đáng tin cậy

<a id="w1-t01"></a>
### W1-T01 — Migration, backup và restore phiên bản mới

- **Mục tiêu:** nâng cấp từ SQLite legacy và PostgreSQL hiện tại mà không mất quan hệ/dữ liệu.
- **Phạm vi/đầu ra:** mapping legacy, migration có version, transaction/backfill, manifest file/khóa mã hóa, backup/restore bao gồm các thực thể mới; startup đồng thời và schema version không tương thích.
- **Phụ thuộc:** W0-T02.
- **Nghiệm thu:** giữ IDs/FKs/count/file; chạy lại không nhân dữ liệu; lỗi giữa chừng rollback/recover đúng; SQLite WAL được đọc đúng và từ chối target không rỗng; checksum/manifest hỏng bị chặn; restore chưa tự bật sender, thiếu khóa giải mã báo rõ.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T01-A…F`; TC-X11. Migration sản xuất dùng PostgreSQL thật, không thay bằng SQLite fixture.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T01-A](test-cases/01-foundation.md#alias-tc-w1-t01-a) — kết quả riêng cho requirement `RQ-W1-T01-A`.
- [ ] [TC-W1-T01-B](test-cases/01-foundation.md#alias-tc-w1-t01-b) — kết quả riêng cho requirement `RQ-W1-T01-B`.
- [ ] [TC-W1-T01-C](test-cases/01-foundation.md#alias-tc-w1-t01-c) — kết quả riêng cho requirement `RQ-W1-T01-C`.
- [ ] [TC-W1-T01-D](test-cases/01-foundation.md#alias-tc-w1-t01-d) — kết quả riêng cho requirement `RQ-W1-T01-D`.
- [ ] [TC-W1-T01-E](test-cases/01-foundation.md#alias-tc-w1-t01-e) — kết quả riêng cho requirement `RQ-W1-T01-E`.
- [ ] [TC-W1-T01-F](test-cases/01-foundation.md#alias-tc-w1-t01-f) — kết quả riêng cho requirement `RQ-W1-T01-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t02"></a>
### W1-T02 — Entitlement bằng mã và thực thi tại backend

- **Mục tiêu:** phân phối Starter/Team/Business đúng chức năng, giữ giá/ghế/baseline đã cam kết.
- **Phạm vi/đầu ra:** mã capability/entitlement, dữ liệu session cho UI, guard server và worker; mapping gói hiện tại/tùy chỉnh/ngừng bán; xử lý đổi gói và snapshot hóa đơn.
- **Phụ thuộc:** W0-T04.
- **Nghiệm thu:** quyền không suy từ tên gói; Starter 199k/3, Team 499k/10, Business 999k/50 được giữ; session cũ không vượt backend mới; downgrade dừng premium write/sender nhưng giữ authorized read/export và private data. Không thay giá hay quota AI/storage/automation thương mại trong task này.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T02-A…E`; TC-X10.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T02-A](test-cases/01-foundation.md#alias-tc-w1-t02-a) — kết quả riêng cho requirement `RQ-W1-T02-A`.
- [ ] [TC-W1-T02-B](test-cases/01-foundation.md#alias-tc-w1-t02-b) — kết quả riêng cho requirement `RQ-W1-T02-B`.
- [ ] [TC-W1-T02-C](test-cases/01-foundation.md#alias-tc-w1-t02-c) — kết quả riêng cho requirement `RQ-W1-T02-C`.
- [ ] [TC-W1-T02-D](test-cases/01-foundation.md#alias-tc-w1-t02-d) — kết quả riêng cho requirement `RQ-W1-T02-D`.
- [ ] [TC-W1-T02-E](test-cases/01-foundation.md#alias-tc-w1-t02-e) — kết quả riêng cho requirement `RQ-W1-T02-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t03"></a>
### W1-T03 — Project, một board và backfill quan hệ

- **Mục tiêu:** tạo đơn vị project ổn định cho quyền và quản lý công việc.
- **Phạm vi/đầu ra:** project/board/column/task references; project mặc định cho scope workspace/team cũ kể cả scope rỗng; backfill không gộp cột theo tên; chuẩn hóa đường tạo/sửa task cũ.
- **Phụ thuộc:** W1-T01, W1-T02.
- **Nghiệm thu:** mỗi project một board; IDs/quan hệ child giữ đúng; task legacy thiếu projectId vào project mặc định đúng phạm vi; update legacy không tự chuyển project; migration chạy lại không tạo thêm board/project mặc định.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T03-A…D`.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T03-A](test-cases/01-foundation.md#alias-tc-w1-t03-a) — kết quả riêng cho requirement `RQ-W1-T03-A`.
- [ ] [TC-W1-T03-B](test-cases/01-foundation.md#alias-tc-w1-t03-b) — kết quả riêng cho requirement `RQ-W1-T03-B`.
- [ ] [TC-W1-T03-C](test-cases/01-foundation.md#alias-tc-w1-t03-c) — kết quả riêng cho requirement `RQ-W1-T03-C`.
- [ ] [TC-W1-T03-D](test-cases/01-foundation.md#alias-tc-w1-t03-d) — kết quả riêng cho requirement `RQ-W1-T03-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t04"></a>
### W1-T04 — Project ACL xuyên toàn hệ thống

- **Mục tiêu:** project kế thừa workspace/team, private và guest có quyền nhất quán ở mọi entrypoint.
- **Phạm vi/đầu ra:** role owner/admin/project manager/editor/commenter/viewer; guest chỉ editor/commenter/viewer; guard dùng chung cho detail/children/file/search/AI/report/export/import/trash/notification/worker và legacy APIs.
- **Phụ thuộc:** W1-T03.
- **Nghiệm thu:** owner/admin workspace truy cập private theo chính sách; SaaS admin không tự có quyền nghiệp vụ. Guest không quản lý thành viên/tích hợp/billing/CRM/tài chính/dịch vụ/danh bạ, xóa task hoặc move xuyên project; selector/count không rò metadata. Copy/move/restore kiểm tra cả nguồn/đích/assignee/custom fields/dependency; job chờ được revalidate.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T04-A…F`; TC-X01/X02/X03/X08/X10. Ma trận phải bao phủ direct API, không chỉ nút UI.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T04-A](test-cases/01-foundation.md#alias-tc-w1-t04-a) — kết quả riêng cho requirement `RQ-W1-T04-A`.
- [ ] [TC-W1-T04-B](test-cases/01-foundation.md#alias-tc-w1-t04-b) — kết quả riêng cho requirement `RQ-W1-T04-B`.
- [ ] [TC-W1-T04-C](test-cases/01-foundation.md#alias-tc-w1-t04-c) — kết quả riêng cho requirement `RQ-W1-T04-C`.
- [ ] [TC-W1-T04-D](test-cases/01-foundation.md#alias-tc-w1-t04-d) — kết quả riêng cho requirement `RQ-W1-T04-D`.
- [ ] [TC-W1-T04-E](test-cases/01-foundation.md#alias-tc-w1-t04-e) — kết quả riêng cho requirement `RQ-W1-T04-E`.
- [ ] [TC-W1-T04-F](test-cases/01-foundation.md#alias-tc-w1-t04-f) — kết quả riêng cho requirement `RQ-W1-T04-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t05"></a>
### W1-T05 — Guest, lời mời, ghế và downgrade nguyên tử

- **Mục tiêu:** không vượt seat limit hoặc làm mất dữ liệu khi thay gói.
- **Phạm vi/đầu ra:** guest membership/invitation; một người một ghế/workspace bất kể số project; pending invitation hợp lệ giữ ghế; cùng cơ chế khóa nguyên tử cho invite/accept/revoke/expire/checkout/downgrade.
- **Phụ thuộc:** W1-T02, W1-T04.
- **Nghiệm thu:** hai lời mời tranh ghế cuối chỉ một thành công; accept không đếm ghế hai lần; retry không nhân invitation/charge; số ghế vượt gói nhỏ chặn checkout cho đến khi xử lý; không tự xóa người. Guest sau downgrade readonly, vẫn tính ghế; private data không đổi visibility.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T05-A…G`; TC-X10; dùng process/connection PostgreSQL độc lập với barrier.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T05-A](test-cases/01-foundation.md#alias-tc-w1-t05-a) — kết quả riêng cho requirement `RQ-W1-T05-A`.
- [ ] [TC-W1-T05-B](test-cases/01-foundation.md#alias-tc-w1-t05-b) — kết quả riêng cho requirement `RQ-W1-T05-B`.
- [ ] [TC-W1-T05-C](test-cases/01-foundation.md#alias-tc-w1-t05-c) — kết quả riêng cho requirement `RQ-W1-T05-C`.
- [ ] [TC-W1-T05-D](test-cases/01-foundation.md#alias-tc-w1-t05-d) — kết quả riêng cho requirement `RQ-W1-T05-D`.
- [ ] [TC-W1-T05-E](test-cases/01-foundation.md#alias-tc-w1-t05-e) — kết quả riêng cho requirement `RQ-W1-T05-E`.
- [ ] [TC-W1-T05-F](test-cases/01-foundation.md#alias-tc-w1-t05-f) — kết quả riêng cho requirement `RQ-W1-T05-F`.
- [ ] [TC-W1-T05-G](test-cases/01-foundation.md#alias-tc-w1-t05-g) — kết quả riêng cho requirement `RQ-W1-T05-G`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t06"></a>
### W1-T06 — UI project, vai trò và thành viên Web/Android

- **Mục tiêu:** quản lý và hiểu quyền project trên hai nền tảng.
- **Phạm vi/đầu ra:** danh sách/chọn project, tạo/sửa visibility được phép, membership/role/invitation, trạng thái ghế và thông báo bị chặn; refresh khi quyền thay đổi.
- **Phụ thuộc:** W1-T05.
- **Nghiệm thu:** thao tác quyền hợp lệ nhất quán hai client; deep-link/API không vượt quyền; picker không lộ người ngoài phạm vi; màn hình đang mở phản ánh quyền mới và không phục hồi cache nhạy cảm từ response cũ.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T06-A…D`; TC-X01/X02/X04/X05.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T06-A](test-cases/01-foundation.md#alias-tc-w1-t06-a) — kết quả riêng cho requirement `RQ-W1-T06-A`.
- [ ] [TC-W1-T06-B](test-cases/01-foundation.md#alias-tc-w1-t06-b) — kết quả riêng cho requirement `RQ-W1-T06-B`.
- [ ] [TC-W1-T06-C](test-cases/01-foundation.md#alias-tc-w1-t06-c) — kết quả riêng cho requirement `RQ-W1-T06-C`.
- [ ] [TC-W1-T06-D](test-cases/01-foundation.md#alias-tc-w1-t06-d) — kết quả riêng cho requirement `RQ-W1-T06-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t07"></a>
### W1-T07 — Sự kiện nghiệp vụ có cấu trúc

- **Mục tiêu:** lịch sử và báo cáo dựa trên sự kiện thật thay vì suy từ trạng thái hiện tại.
- **Phạm vi/đầu ra:** typed lifecycle/assignment/deadline/ack/snooze/status events, actor/source/time/snapshot, chu kỳ giao việc và deadline; event commit cùng mutation.
- **Phụ thuộc:** W1-T03, W1-T04.
- **Nghiệm thu:** rollback không có success event; reassign/đổi hạn giữ chu kỳ trước; đổi nhãn hoặc chỉ thứ tự assignee không reset ack; custom columns vẫn dùng lifecycle todo/doing/done; dữ liệu trước rollout chưa có bằng chứng lịch sử ghi unknown, không backfill SLA giả.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T07-A…E`; TC-X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T07-A](test-cases/01-foundation.md#alias-tc-w1-t07-a) — kết quả riêng cho requirement `RQ-W1-T07-A`.
- [ ] [TC-W1-T07-B](test-cases/01-foundation.md#alias-tc-w1-t07-b) — kết quả riêng cho requirement `RQ-W1-T07-B`.
- [ ] [TC-W1-T07-C](test-cases/01-foundation.md#alias-tc-w1-t07-c) — kết quả riêng cho requirement `RQ-W1-T07-C`.
- [ ] [TC-W1-T07-D](test-cases/01-foundation.md#alias-tc-w1-t07-d) — kết quả riêng cho requirement `RQ-W1-T07-D`.
- [ ] [TC-W1-T07-E](test-cases/01-foundation.md#alias-tc-w1-t07-e) — kết quả riêng cho requirement `RQ-W1-T07-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t08"></a>
### W1-T08 — Revision tổng hợp task và kế hoạch cá nhân

- **Mục tiêu:** phát hiện ghi đè đồng thời mà không gây conflict giữa kế hoạch riêng của các người dùng.
- **Phạm vi/đầu ra:** task aggregate revision bao gồm child edit có liên quan; personal-plan revision riêng theo `(task,user)`; conflict response cho client; tương thích client legacy theo hợp đồng.
- **Phụ thuộc:** W1-T04, W1-T07.
- **Nghiệm thu:** cùng revision hai mutation chỉ một thắng; checklist/nhãn/assignee thay đổi revision đúng; personal plans độc lập; sửa shared deadline không ghi đè plan; legacy API không bỏ qua ACL hoặc tự mở tính năng mới ngoài quyền.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T08-A…E`; TC-X09; mở rộng test stale update/concurrent processes hiện có.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T08-A](test-cases/01-foundation.md#alias-tc-w1-t08-a) — kết quả riêng cho requirement `RQ-W1-T08-A`.
- [ ] [TC-W1-T08-B](test-cases/01-foundation.md#alias-tc-w1-t08-b) — kết quả riêng cho requirement `RQ-W1-T08-B`.
- [ ] [TC-W1-T08-C](test-cases/01-foundation.md#alias-tc-w1-t08-c) — kết quả riêng cho requirement `RQ-W1-T08-C`.
- [ ] [TC-W1-T08-D](test-cases/01-foundation.md#alias-tc-w1-t08-d) — kết quả riêng cho requirement `RQ-W1-T08-D`.
- [ ] [TC-W1-T08-E](test-cases/01-foundation.md#alias-tc-w1-t08-e) — kết quả riêng cho requirement `RQ-W1-T08-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t09"></a>
### W1-T09 — Mutation receipt và idempotency

- **Mục tiêu:** retry sau mất phản hồi không tạo task/recurrence/sự kiện/tiền trùng.
- **Phạm vi/đầu ra:** operation ID và payload fingerprint bất biến sau gửi; receipt gắn principal/scope; business rows/events/receipt/outbox và recurrence successor cùng transaction; replay kiểm tra quyền hiện tại.
- **Phụ thuộc:** W1-T08.
- **Nghiệm thu:** cùng ID/payload trả kết quả cũ, payload khác bị từ chối; process cạnh tranh tạo một mutation; crash tại mốc commit không có partial result; receipt không lộ chéo tenant hoặc sau revoke; complete task lặp tạo đúng một successor.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T09-A…F`; TC-X08/X09/X11/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T09-A](test-cases/01-foundation.md#alias-tc-w1-t09-a) — kết quả riêng cho requirement `RQ-W1-T09-A`.
- [ ] [TC-W1-T09-B](test-cases/01-foundation.md#alias-tc-w1-t09-b) — kết quả riêng cho requirement `RQ-W1-T09-B`.
- [ ] [TC-W1-T09-C](test-cases/01-foundation.md#alias-tc-w1-t09-c) — kết quả riêng cho requirement `RQ-W1-T09-C`.
- [ ] [TC-W1-T09-D](test-cases/01-foundation.md#alias-tc-w1-t09-d) — kết quả riêng cho requirement `RQ-W1-T09-D`.
- [ ] [TC-W1-T09-E](test-cases/01-foundation.md#alias-tc-w1-t09-e) — kết quả riêng cho requirement `RQ-W1-T09-E`.
- [ ] [TC-W1-T09-F](test-cases/01-foundation.md#alias-tc-w1-t09-f) — kết quả riêng cho requirement `RQ-W1-T09-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t10"></a>
### W1-T10 — Durable outbox, retry và revalidation

- **Mục tiêu:** tác dụng phụ bền vững và không tiếp tục gửi khi quyền/nghiệp vụ đã thay đổi.
- **Phạm vi/đầu ra:** claim/lease/attempt/backoff/terminal/suppressed/unknown, identity logical delivery, source snapshot, revalidate khi gửi; giữ mô hình triển khai single worker hiện tại, không thêm message broker.
- **Phụ thuộc:** W1-T07, W1-T09.
- **Nghiệm thu:** restart không mất job; claim cạnh tranh và lease recovery đúng; completed/deleted/reassigned/downgrade trước gửi được chặn; 429/5xx/lỗi vĩnh viễn phân loại; timeout sau provider nhận phải unknown/đối soát theo provider, không hứa exactly-once; log không chứa secret.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T10-A…G`; TC-X07/X10/X11/X12. Tái sử dụng kiểm thử overlapping workers đã có.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T10-A](test-cases/01-foundation.md#alias-tc-w1-t10-a) — kết quả riêng cho requirement `RQ-W1-T10-A`.
- [ ] [TC-W1-T10-B](test-cases/01-foundation.md#alias-tc-w1-t10-b) — kết quả riêng cho requirement `RQ-W1-T10-B`.
- [ ] [TC-W1-T10-C](test-cases/01-foundation.md#alias-tc-w1-t10-c) — kết quả riêng cho requirement `RQ-W1-T10-C`.
- [ ] [TC-W1-T10-D](test-cases/01-foundation.md#alias-tc-w1-t10-d) — kết quả riêng cho requirement `RQ-W1-T10-D`.
- [ ] [TC-W1-T10-E](test-cases/01-foundation.md#alias-tc-w1-t10-e) — kết quả riêng cho requirement `RQ-W1-T10-E`.
- [ ] [TC-W1-T10-F](test-cases/01-foundation.md#alias-tc-w1-t10-f) — kết quả riêng cho requirement `RQ-W1-T10-F`.
- [ ] [TC-W1-T10-G](test-cases/01-foundation.md#alias-tc-w1-t10-g) — kết quả riêng cho requirement `RQ-W1-T10-G`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w1-t11"></a>
### W1-T11 — Gate tích hợp nền tảng

- **Mục tiêu:** chỉ mở rộng nghiệp vụ khi migration/quyền/ghế/concurrency đủ tin cậy.
- **Phụ thuộc:** W1-T01 đến W1-T10.
- **Đầu ra:** báo cáo upgrade→private project→guest→đổi gói→backup/restore→Web/Android; ma trận đường truy cập và fault/concurrency có bằng chứng.
- **Nghiệm thu:** toàn bộ P0/P1 thuộc W1 đạt; không dùng tổng test pass che đường chưa thử; giữ khả năng rollback/recovery đã diễn tập; các requirement chưa làm không được ghi pass nhờ suite baseline.
- **Test:** [nền tảng](test-cases/01-foundation.md), `TC-W1-T11-A…C`; TC-X02/X07/X11 trong phạm vi W1.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W1-T11-A](test-cases/01-foundation.md#alias-tc-w1-t11-a) — kết quả riêng cho requirement `RQ-W1-T11-A`.
- [ ] [TC-W1-T11-B](test-cases/01-foundation.md#alias-tc-w1-t11-b) — kết quả riêng cho requirement `RQ-W1-T11-B`.
- [ ] [TC-W1-T11-C](test-cases/01-foundation.md#alias-tc-w1-t11-c) — kết quả riêng cho requirement `RQ-W1-T11-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W2 — Vận hành SME và dịch vụ

<a id="w2-t01"></a>
### W2-T01 — Dashboard vận hành phân trang

- **Mục tiêu:** quản lý biết việc quá hạn, chưa xác nhận, đang hoãn và người cần hỗ trợ.
- **Phạm vi/đầu ra:** bộ lọc project/team/assignee/thời gian, tập task và assignment count phân biệt, phân trang ổn định, empty/loading/error và thời điểm cập nhật.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** fixture R đúng 5 task/6 lượt giao/2 task quá hạn/2 lượt chưa ack/1 task hoãn; join nhiều assignee không nhân task; ACL áp dụng cả tổng và chi tiết; ack/done/đổi hạn cập nhật đúng qua thiết bị.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W2-T01-A…E`; TC-X02/X05/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W2-T01-A](test-cases/02-business-projects-automation.md#tc-w2-t01-a) — kết quả riêng cho requirement `RQ-W2-T01-A`.
- [ ] [TC-W2-T01-B](test-cases/02-business-projects-automation.md#tc-w2-t01-b) — kết quả riêng cho requirement `RQ-W2-T01-B`.
- [ ] [TC-W2-T01-C](test-cases/02-business-projects-automation.md#tc-w2-t01-c) — kết quả riêng cho requirement `RQ-W2-T01-C`.
- [ ] [TC-W2-T01-D](test-cases/02-business-projects-automation.md#tc-w2-t01-d) — kết quả riêng cho requirement `RQ-W2-T01-D`.
- [ ] [TC-W2-T01-E](test-cases/02-business-projects-automation.md#tc-w2-t01-e) — kết quả riêng cho requirement `RQ-W2-T01-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w2-t02"></a>
### W2-T02 — Giờ và chính sách nhắc gia hạn

- **Mục tiêu:** nhắc đúng mốc và không làm thay đổi hành vi dịch vụ đã tồn tại.
- **Phạm vi/đầu ra:** milestone/daily, giờ theo ngày Việt Nam; dữ liệu cũ giữ chính sách cũ; dịch vụ mới mặc định 09:00; outbox/dedup theo kỳ và mốc/ngày.
- **Phụ thuộc:** W1-T11, W1-T10.
- **Nghiệm thu:** tick lại/restart không nhân nhắc; thay kỳ/ngày/tắt/archive hủy hiệu lực job cũ; catch-up chỉ mốc mới nhất còn hợp lệ, daily không phát bù từng ngày; quy tắc giờ/lịch làm opt-in không tự áp lên legacy.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W2-T02-A…E`; TC-X06/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W2-T02-A](test-cases/02-business-projects-automation.md#tc-w2-t02-a) — kết quả riêng cho requirement `RQ-W2-T02-A`.
- [ ] [TC-W2-T02-B](test-cases/02-business-projects-automation.md#tc-w2-t02-b) — kết quả riêng cho requirement `RQ-W2-T02-B`.
- [ ] [TC-W2-T02-C](test-cases/02-business-projects-automation.md#tc-w2-t02-c) — kết quả riêng cho requirement `RQ-W2-T02-C`.
- [ ] [TC-W2-T02-D](test-cases/02-business-projects-automation.md#tc-w2-t02-d) — kết quả riêng cho requirement `RQ-W2-T02-D`.
- [ ] [TC-W2-T02-E](test-cases/02-business-projects-automation.md#tc-w2-t02-e) — kết quả riêng cho requirement `RQ-W2-T02-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w2-t03"></a>
### W2-T03 — Gia hạn, task và khoản chi tùy chọn

- **Mục tiêu:** một lần gia hạn tạo đúng nghiệp vụ, không tự coi là thanh toán.
- **Phạm vi/đầu ra:** kỳ/lịch sử/task liên quan và expense tùy chọn cùng transaction/idempotency; mặc định expense tắt; validation tiền/ngày và anchor cuối tháng; giao diện xác nhận nội dung nghiệp vụ rõ.
- **Phụ thuộc:** W2-T02, W1-T09.
- **Nghiệm thu:** retry/mất response/concurrent devices không nhân kỳ/task/tiền; revision cũ conflict; lỗi giữa chừng rollback toàn bộ; bulk có phần tử lỗi không ghi một phần; 31/01→cuối tháng 02→31/03 giữ anchor; bật chi chỉ tạo một expense đúng kỳ.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W2-T03-A…I`; TC-X06/X12. Ca H/I kiểm chứng tạo task cho kỳ hiện tại không trùng và complete task không tự gia hạn/ghi tiền.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W2-T03-A](test-cases/02-business-projects-automation.md#tc-w2-t03-a) — kết quả riêng cho requirement `RQ-W2-T03-A`.
- [ ] [TC-W2-T03-B](test-cases/02-business-projects-automation.md#tc-w2-t03-b) — kết quả riêng cho requirement `RQ-W2-T03-B`.
- [ ] [TC-W2-T03-C](test-cases/02-business-projects-automation.md#tc-w2-t03-c) — kết quả riêng cho requirement `RQ-W2-T03-C`.
- [ ] [TC-W2-T03-D](test-cases/02-business-projects-automation.md#tc-w2-t03-d) — kết quả riêng cho requirement `RQ-W2-T03-D`.
- [ ] [TC-W2-T03-E](test-cases/02-business-projects-automation.md#tc-w2-t03-e) — kết quả riêng cho requirement `RQ-W2-T03-E`.
- [ ] [TC-W2-T03-F](test-cases/02-business-projects-automation.md#tc-w2-t03-f) — kết quả riêng cho requirement `RQ-W2-T03-F`.
- [ ] [TC-W2-T03-G](test-cases/02-business-projects-automation.md#tc-w2-t03-g) — kết quả riêng cho requirement `RQ-W2-T03-G`.
- [ ] [TC-W2-T03-H](test-cases/02-business-projects-automation.md#tc-w2-t03-h) — kết quả riêng cho requirement `RQ-W2-T03-H`.
- [ ] [TC-W2-T03-I](test-cases/02-business-projects-automation.md#tc-w2-t03-i) — kết quả riêng cho requirement `RQ-W2-T03-I`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w2-t04"></a>
### W2-T04 — Android: dịch vụ, chăm sóc và gia hạn

- **Mục tiêu:** nhân sự vận hành thao tác dịch vụ trên Android với cùng nghiệp vụ Web.
- **Phạm vi/đầu ra:** service list/detail, care history, renewal form/history, refresh và conflict; reuse backend W2.
- **Phụ thuộc:** W2-T01, W2-T03.
- **Nghiệm thu:** hai nền tảng nhìn cùng lịch sử; lỗi giữ nội dung nhập; finance/renewal online-only, không vào offline task queue; readonly/permission loss thể hiện rõ.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W2-T04-A…C`; TC-X04/X05.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W2-T04-A](test-cases/02-business-projects-automation.md#tc-w2-t04-a) — kết quả riêng cho requirement `RQ-W2-T04-A`.
- [ ] [TC-W2-T04-B](test-cases/02-business-projects-automation.md#tc-w2-t04-b) — kết quả riêng cho requirement `RQ-W2-T04-B`.
- [ ] [TC-W2-T04-C](test-cases/02-business-projects-automation.md#tc-w2-t04-c) — kết quả riêng cho requirement `RQ-W2-T04-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w2-t05"></a>
### W2-T05 — Gate SME end-to-end

- **Phụ thuộc:** W2-T01 đến W2-T04.
- **Đầu ra:** bằng chứng Web/Android cho khách hàng→dịch vụ→task→ack/snooze→gia hạn→chi tùy chọn→kỳ mới; đối soát dashboard/history/tiền/outbox.
- **Nghiệm thu:** xử lý xong dừng nhắc cũ; kỳ mới có một lịch nhắc; không gửi/ghi tiền ngoài ý định; đủ P0/P1 W2 và bằng chứng ACL theo quyền nghiệp vụ.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W2-T05-A…C`; TC-X02/X04/X06/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W2-T05-A](test-cases/02-business-projects-automation.md#tc-w2-t05-a) — kết quả riêng cho requirement `RQ-W2-T05-A`.
- [ ] [TC-W2-T05-B](test-cases/02-business-projects-automation.md#tc-w2-t05-b) — kết quả riêng cho requirement `RQ-W2-T05-B`.
- [ ] [TC-W2-T05-C](test-cases/02-business-projects-automation.md#tc-w2-t05-c) — kết quả riêng cho requirement `RQ-W2-T05-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W3 — Dự án nâng cao

<a id="w3-t01"></a>
### W3-T01 — Custom fields có kiểu

- **Mục tiêu:** tùy biến thông tin dự án mà vẫn lọc/export chính xác.
- **Phạm vi/đầu ra:** text/number/date/single selection/multiple selection/checkbox; cấu hình theo project; validation, filter/sort/export Web/Android và quyền Team trở lên.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** phân biệt null/rỗng/0/false; option ngoài scope hoặc sai kiểu bị chặn; rename/reorder giữ ID; mặc định đề xuất field có dữ liệu không đổi kiểu trực tiếp, retire giữ giá trị cũ; downgrade chặn premium writes, giữ authorized read/export.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T01-A…E`; TC-X03.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T01-A](test-cases/02-business-projects-automation.md#tc-w3-t01-a) — kết quả riêng cho requirement `RQ-W3-T01-A`.
- [ ] [TC-W3-T01-B](test-cases/02-business-projects-automation.md#tc-w3-t01-b) — kết quả riêng cho requirement `RQ-W3-T01-B`.
- [ ] [TC-W3-T01-C](test-cases/02-business-projects-automation.md#tc-w3-t01-c) — kết quả riêng cho requirement `RQ-W3-T01-C`.
- [ ] [TC-W3-T01-D](test-cases/02-business-projects-automation.md#tc-w3-t01-d) — kết quả riêng cho requirement `RQ-W3-T01-D`.
- [ ] [TC-W3-T01-E](test-cases/02-business-projects-automation.md#tc-w3-t01-e) — kết quả riêng cho requirement `RQ-W3-T01-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w3-t02"></a>
### W3-T02 — Views nhất quán và saved views

- **Mục tiêu:** cùng một công việc được nhìn theo Kanban/list/calendar với bộ lọc nhất quán.
- **Phạm vi/đầu ra:** query/filter/sort dùng chung; personal/shared saved views; hiển thị task không ngày trong list/Inbox; invalid view configuration rõ ràng.
- **Phụ thuộc:** W1-T11, W3-T01.
- **Nghiệm thu:** cùng filter cho tập dữ liệu tương ứng; shared view không mở rộng ACL; view cá nhân không lộ; tham chiếu đã mất quyền không phục hồi cache nhạy cảm; pagination không trùng do join.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T02-A…D`; TC-X02/X04/X05/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T02-A](test-cases/02-business-projects-automation.md#tc-w3-t02-a) — kết quả riêng cho requirement `RQ-W3-T02-A`.
- [ ] [TC-W3-T02-B](test-cases/02-business-projects-automation.md#tc-w3-t02-b) — kết quả riêng cho requirement `RQ-W3-T02-B`.
- [ ] [TC-W3-T02-C](test-cases/02-business-projects-automation.md#tc-w3-t02-c) — kết quả riêng cho requirement `RQ-W3-T02-C`.
- [ ] [TC-W3-T02-D](test-cases/02-business-projects-automation.md#tc-w3-t02-d) — kết quả riêng cho requirement `RQ-W3-T02-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w3-t03"></a>
### W3-T03 — Dependency finish-to-start trong project

- **Mục tiêu:** thấy việc chờ việc trước, giữ dependency graph hợp lệ.
- **Phạm vi/đầu ra:** cạnh cùng project, DAG, cảnh báo blocked dựa lifecycle, UI thêm/bỏ cạnh; không tự reschedule hoặc chặn hoàn thành bắt buộc trong v1.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** self-link/cycle/cross-project bị chặn cả khi concurrent; cạnh trùng không nhân; archive/xóa mềm không coi là done, giữ cạnh cho restore; move làm cạnh vượt project bị chặn đến khi xử lý; reopen cập nhật cảnh báo.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T03-A…F`; TC-X02/X05.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T03-A](test-cases/02-business-projects-automation.md#tc-w3-t03-a) — kết quả riêng cho requirement `RQ-W3-T03-A`.
- [ ] [TC-W3-T03-B](test-cases/02-business-projects-automation.md#tc-w3-t03-b) — kết quả riêng cho requirement `RQ-W3-T03-B`.
- [ ] [TC-W3-T03-C](test-cases/02-business-projects-automation.md#tc-w3-t03-c) — kết quả riêng cho requirement `RQ-W3-T03-C`.
- [ ] [TC-W3-T03-D](test-cases/02-business-projects-automation.md#tc-w3-t03-d) — kết quả riêng cho requirement `RQ-W3-T03-D`.
- [ ] [TC-W3-T03-E](test-cases/02-business-projects-automation.md#tc-w3-t03-e) — kết quả riêng cho requirement `RQ-W3-T03-E`.
- [ ] [TC-W3-T03-F](test-cases/02-business-projects-automation.md#tc-w3-t03-f) — kết quả riêng cho requirement `RQ-W3-T03-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w3-t04"></a>
### W3-T04 — Timeline và ngày chung của task

- **Mục tiêu:** xem/sửa start/deadline chung mà không trộn với lịch làm việc cá nhân.
- **Phạm vi/đầu ra:** timeline dự án, shared start/deadline, dependency visualization; Web/Android phù hợp màn hình; giữ personal-plan riêng.
- **Phụ thuộc:** W3-T02, W3-T03.
- **Nghiệm thu:** start sau deadline bị từ chối; không tự dời task phụ thuộc hoặc plan cá nhân; task thiếu ngày thể hiện rõ, không suy ngày giả; UTC+7/cuối năm/ngày nhuận đúng; revisions và quyền dùng pipeline chung.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T04-A…D`; TC-X06/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T04-A](test-cases/02-business-projects-automation.md#tc-w3-t04-a) — kết quả riêng cho requirement `RQ-W3-T04-A`.
- [ ] [TC-W3-T04-B](test-cases/02-business-projects-automation.md#tc-w3-t04-b) — kết quả riêng cho requirement `RQ-W3-T04-B`.
- [ ] [TC-W3-T04-C](test-cases/02-business-projects-automation.md#tc-w3-t04-c) — kết quả riêng cho requirement `RQ-W3-T04-C`.
- [ ] [TC-W3-T04-D](test-cases/02-business-projects-automation.md#tc-w3-t04-d) — kết quả riêng cho requirement `RQ-W3-T04-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w3-t05"></a>
### W3-T05 — Project templates và ngày tương đối

- **Mục tiêu:** tái sử dụng quy trình dự án an toàn.
- **Phạm vi/đầu ra:** template tasks/checklists/columns/custom fields/dependencies, ngày tương đối theo anchor, preview mapping assignee/customer; clone bằng IDs mới và transaction/idempotency.
- **Phụ thuộc:** W3-T01, W3-T03.
- **Nghiệm thu:** quan hệ nội bộ đích đúng; không mang membership/quyền ngoài scope; người/khách không còn hợp lệ được yêu cầu xử lý mapping trước commit; lỗi không tạo project nửa chừng; retry chỉ một instance; ngày nhuận/cuối tháng đúng.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T05-A…D`; TC-X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T05-A](test-cases/02-business-projects-automation.md#tc-w3-t05-a) — kết quả riêng cho requirement `RQ-W3-T05-A`.
- [ ] [TC-W3-T05-B](test-cases/02-business-projects-automation.md#tc-w3-t05-b) — kết quả riêng cho requirement `RQ-W3-T05-B`.
- [ ] [TC-W3-T05-C](test-cases/02-business-projects-automation.md#tc-w3-t05-c) — kết quả riêng cho requirement `RQ-W3-T05-C`.
- [ ] [TC-W3-T05-D](test-cases/02-business-projects-automation.md#tc-w3-t05-d) — kết quả riêng cho requirement `RQ-W3-T05-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w3-t06"></a>
### W3-T06 — Gate dự án nâng cao

- **Phụ thuộc:** W3-T02 đến W3-T05.
- **Đầu ra:** luồng dự án với custom fields/views/dependencies/timeline/template; kiểm tra vai trò, downgrade và recurrence qua mọi entrypoint.
- **Nghiệm thu:** complete từ form/Kanban/automation/Android đều một successor; cùng trạng thái ở các view; không mất field/quan hệ hoặc vượt quyền; toàn bộ P0/P1 W3 đạt.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W3-T06-A…C`; TC-X02/X04/X05/X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W3-T06-A](test-cases/02-business-projects-automation.md#tc-w3-t06-a) — kết quả riêng cho requirement `RQ-W3-T06-A`.
- [ ] [TC-W3-T06-B](test-cases/02-business-projects-automation.md#tc-w3-t06-b) — kết quả riêng cho requirement `RQ-W3-T06-B`.
- [ ] [TC-W3-T06-C](test-cases/02-business-projects-automation.md#tc-w3-t06-c) — kết quả riêng cho requirement `RQ-W3-T06-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W4 — Planner và Android offline

<a id="w4-t01"></a>
### W4-T01 — Inbox, Today, Upcoming và Week

- **Mục tiêu:** có cách lập kế hoạch cá nhân tiện lợi bên cạnh quản lý chung.
- **Phạm vi/đầu ra:** planner Web/Android trên personal-plan model; quick entry có preview để xác nhận cách hiểu ngày/giờ; task không ngày trong Inbox.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** dời plan không đổi dueAt/người khác; các view cùng nguồn dữ liệu; ngày mơ hồ không tự chọn; nửa đêm/cuối năm đúng; không tạo reminder khi chỉ xem hoặc lọc.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W4-T01-A…D`; TC-X04/X05/X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W4-T01-A](test-cases/03-offline-imports-integrations.md#tc-w4-t01-a) — kết quả riêng cho requirement `RQ-W4-T01-A`.
- [ ] [TC-W4-T01-B](test-cases/03-offline-imports-integrations.md#tc-w4-t01-b) — kết quả riêng cho requirement `RQ-W4-T01-B`.
- [ ] [TC-W4-T01-C](test-cases/03-offline-imports-integrations.md#tc-w4-t01-c) — kết quả riêng cho requirement `RQ-W4-T01-C`.
- [ ] [TC-W4-T01-D](test-cases/03-offline-imports-integrations.md#tc-w4-t01-d) — kết quả riêng cho requirement `RQ-W4-T01-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w4-t02"></a>
### W4-T02 — SQLCipher cho draft và outbox Android

- **Mục tiêu:** giữ dữ liệu nhập khi offline hoặc app bị đóng, tách khỏi cache đọc dùng một lần.
- **Phạm vi/đầu ra:** encrypted durable drafts/operations/conflicts, scope origin/user/workspace, key lifecycle và local migration; disposable cache vẫn tuân policy xác thực hiện tại.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** restart/reboot/upgrade giữ operation ID; account/workspace/origin khác không đọc được; hết dung lượng/DB lỗi không giả báo đã lưu hoặc tự xóa nháp; log/temp không lộ nội dung/khóa. Đây là Android offline, không tự mở offline write cho Web service worker.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W4-T02-A…E`; TC-X01/X03/X08/X11.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W4-T02-A](test-cases/03-offline-imports-integrations.md#tc-w4-t02-a) — kết quả riêng cho requirement `RQ-W4-T02-A`.
- [ ] [TC-W4-T02-B](test-cases/03-offline-imports-integrations.md#tc-w4-t02-b) — kết quả riêng cho requirement `RQ-W4-T02-B`.
- [ ] [TC-W4-T02-C](test-cases/03-offline-imports-integrations.md#tc-w4-t02-c) — kết quả riêng cho requirement `RQ-W4-T02-C`.
- [ ] [TC-W4-T02-D](test-cases/03-offline-imports-integrations.md#tc-w4-t02-d) — kết quả riêng cho requirement `RQ-W4-T02-D`.
- [ ] [TC-W4-T02-E](test-cases/03-offline-imports-integrations.md#tc-w4-t02-e) — kết quả riêng cho requirement `RQ-W4-T02-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w4-t03"></a>
### W4-T03 — Queue replay, pending overlay và temp IDs

- **Mục tiêu:** tạo/sửa task offline và đồng bộ một lần khi có kết nối được xác thực.
- **Phạm vi/đầu ra:** pending UI; create/edit title/description/priority/deadline/status/column trong project, cached allowed assignees/labels, checklist, personal-plan; dependency giữa temp task và child; một in-flight operation/resource.
- **Phụ thuộc:** W4-T02, W1-T09.
- **Nghiệm thu:** operation/payload đã gửi bất biến; sửa tiếp nằm ở draft mới chờ ACK/revision; parent ID resolve trước child; mất response rồi force-stop/replay không tạo trùng; server refetch không xóa pending overlay; comment chỉ là draft. Delete/move/upload/finance/renewal/permissions/integration/timer online-only.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W4-T03-A…E`; TC-X08/X09/X11.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W4-T03-A](test-cases/03-offline-imports-integrations.md#tc-w4-t03-a) — kết quả riêng cho requirement `RQ-W4-T03-A`.
- [ ] [TC-W4-T03-B](test-cases/03-offline-imports-integrations.md#tc-w4-t03-b) — kết quả riêng cho requirement `RQ-W4-T03-B`.
- [ ] [TC-W4-T03-C](test-cases/03-offline-imports-integrations.md#tc-w4-t03-c) — kết quả riêng cho requirement `RQ-W4-T03-C`.
- [ ] [TC-W4-T03-D](test-cases/03-offline-imports-integrations.md#tc-w4-t03-d) — kết quả riêng cho requirement `RQ-W4-T03-D`.
- [ ] [TC-W4-T03-E](test-cases/03-offline-imports-integrations.md#tc-w4-t03-e) — kết quả riêng cho requirement `RQ-W4-T03-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w4-t04"></a>
### W4-T04 — Conflict, TTL, quyền và logout

- **Mục tiêu:** không mất nháp hoặc âm thầm ghi đè khi online state thay đổi.
- **Phạm vi/đầu ra:** local/server conflict comparison và chọn rõ; TTL 24 giờ bị chặn bởi session expiry/write eligibility; quarantine encrypted queue khi mất quyền; logout sync/keep encrypted/delete; chống stale response và đổi lùi giờ.
- **Phụ thuộc:** W4-T03.
- **Nghiệm thu:** chọn server không ghi, chọn local tạo mutation mới theo revision mới; 401/423/403/404 đúng scope ngừng gửi/hide cache; queue không gửi sang user/workspace/origin khác; local TTL không kéo dài vì đổi đồng hồ. Offline hoàn toàn chỉ phát hiện revoke lúc reconnect hoặc hết TTL, không hứa thu hồi tức thời.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W4-T04-A…G`; TC-X01/X06/X08/X09.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W4-T04-A](test-cases/03-offline-imports-integrations.md#tc-w4-t04-a) — kết quả riêng cho requirement `RQ-W4-T04-A`.
- [ ] [TC-W4-T04-B](test-cases/03-offline-imports-integrations.md#tc-w4-t04-b) — kết quả riêng cho requirement `RQ-W4-T04-B`.
- [ ] [TC-W4-T04-C](test-cases/03-offline-imports-integrations.md#tc-w4-t04-c) — kết quả riêng cho requirement `RQ-W4-T04-C`.
- [ ] [TC-W4-T04-D](test-cases/03-offline-imports-integrations.md#tc-w4-t04-d) — kết quả riêng cho requirement `RQ-W4-T04-D`.
- [ ] [TC-W4-T04-E](test-cases/03-offline-imports-integrations.md#tc-w4-t04-e) — kết quả riêng cho requirement `RQ-W4-T04-E`.
- [ ] [TC-W4-T04-F](test-cases/03-offline-imports-integrations.md#tc-w4-t04-f) — kết quả riêng cho requirement `RQ-W4-T04-F`.
- [ ] [TC-W4-T04-G](test-cases/03-offline-imports-integrations.md#tc-w4-t04-g) — kết quả riêng cho requirement `RQ-W4-T04-G`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w4-t05"></a>
### W4-T05 — Gate Android thật và lỗi mạng/vòng đời

- **Phụ thuộc:** W4-T01, W4-T04.
- **Đầu ra:** APK/build và hồ sơ thiết bị thật: airplane mode, Wi-Fi không internet, Wi-Fi/4G, app background, force-stop, mở lại, session expiry và permission loss.
- **Nghiệm thu:** không mất draft/queue; UI phân biệt pending/saved/synced/conflict; offline complete task lặp tạo một successor; cached assignee/label hết quyền giữ nháp để sửa; các hành động online-only không lọt queue. Không cam kết background sync khi người dùng force-stop.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W4-T05-A…E`; TC-X04/X05/X08/X09/X11.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W4-T05-A](test-cases/03-offline-imports-integrations.md#tc-w4-t05-a) — kết quả riêng cho requirement `RQ-W4-T05-A`.
- [ ] [TC-W4-T05-B](test-cases/03-offline-imports-integrations.md#tc-w4-t05-b) — kết quả riêng cho requirement `RQ-W4-T05-B`.
- [ ] [TC-W4-T05-C](test-cases/03-offline-imports-integrations.md#tc-w4-t05-c) — kết quả riêng cho requirement `RQ-W4-T05-C`.
- [ ] [TC-W4-T05-D](test-cases/03-offline-imports-integrations.md#tc-w4-t05-d) — kết quả riêng cho requirement `RQ-W4-T05-D`.
- [ ] [TC-W4-T05-E](test-cases/03-offline-imports-integrations.md#tc-w4-t05-e) — kết quả riêng cho requirement `RQ-W4-T05-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W5 — Lịch làm việc, automation và báo cáo nâng cao

<a id="w5-t01"></a>
Hồ sơ triển khai W5: [kết quả kiểm thử nội bộ ngày 16/10/2026](test-cases/runs/2026-10-16-w5-internal.md). Checklist gate vẫn giữ mở cho các bằng chứng Web/thiết bị chưa chạy.

### W5-T01 — Lịch làm việc, ngày nghỉ và delegate

- **Mục tiêu:** tính nhắc/thời gian làm việc theo doanh nghiệp khi bật chủ động.
- **Phạm vi/đầu ra:** opt-in work calendar, mặc định thứ Hai–Sáu 09–12/13–18, holiday/override; delegate có thời gian hiệu lực và ACL sẵn; tương tác quiet hours và recurrence tương lai.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** không tự bật cho dữ liệu cũ; dịch tới workday giữ recurrence anchor; không sửa lịch sử; delegate chỉ nhận nhắc, không reassign/grant ACL; một người có nhiều vai trò không nhân cùng logical reminder; revoke trước send được revalidate.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T01-A…F`; TC-X02/X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T01-A](test-cases/02-business-projects-automation.md#tc-w5-t01-a) — kết quả riêng cho requirement `RQ-W5-T01-A`.
- [ ] [TC-W5-T01-B](test-cases/02-business-projects-automation.md#tc-w5-t01-b) — kết quả riêng cho requirement `RQ-W5-T01-B`.
- [ ] [TC-W5-T01-C](test-cases/02-business-projects-automation.md#tc-w5-t01-c) — kết quả riêng cho requirement `RQ-W5-T01-C`.
- [ ] [TC-W5-T01-D](test-cases/02-business-projects-automation.md#tc-w5-t01-d) — kết quả riêng cho requirement `RQ-W5-T01-D`.
- [ ] [TC-W5-T01-E](test-cases/02-business-projects-automation.md#tc-w5-t01-e) — kết quả riêng cho requirement `RQ-W5-T01-E`.
- [ ] [TC-W5-T01-F](test-cases/02-business-projects-automation.md#tc-w5-t01-f) — kết quả riêng cho requirement `RQ-W5-T01-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w5-t02"></a>
### W5-T02 — Automation nâng cao có sự kiện và lịch

- **Mục tiêu:** tự động hóa quy trình có thể giải thích, tránh vòng lặp và phát lại lịch sử.
- **Phạm vi/đầu ra:** edit/duplicate, typed/scheduled triggers, custom field conditions, tối đa 10 actions/lượt, durable dedup, causation chain/loop guard và lịch sử skip/fail.
- **Phụ thuộc:** W5-T01, W3-T01, W1-T10.
- **Nghiệm thu:** 11 actions bị chặn; một action fail rollback phần nghiệp vụ của lượt; chạy theo quyền hiện tại chủ rule; tick/restart/retry không nhân; import hoặc enable lại không replay old triggers; thiếu quyền/assignee/downgrade có lý do, không dùng quyền hệ thống vượt scope.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T02-A…G`; TC-X06/X10/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T02-A](test-cases/02-business-projects-automation.md#tc-w5-t02-a) — kết quả riêng cho requirement `RQ-W5-T02-A`.
- [ ] [TC-W5-T02-B](test-cases/02-business-projects-automation.md#tc-w5-t02-b) — kết quả riêng cho requirement `RQ-W5-T02-B`.
- [ ] [TC-W5-T02-C](test-cases/02-business-projects-automation.md#tc-w5-t02-c) — kết quả riêng cho requirement `RQ-W5-T02-C`.
- [ ] [TC-W5-T02-D](test-cases/02-business-projects-automation.md#tc-w5-t02-d) — kết quả riêng cho requirement `RQ-W5-T02-D`.
- [ ] [TC-W5-T02-E](test-cases/02-business-projects-automation.md#tc-w5-t02-e) — kết quả riêng cho requirement `RQ-W5-T02-E`.
- [ ] [TC-W5-T02-F](test-cases/02-business-projects-automation.md#tc-w5-t02-f) — kết quả riêng cho requirement `RQ-W5-T02-F`.
- [ ] [TC-W5-T02-G](test-cases/02-business-projects-automation.md#tc-w5-t02-g) — kết quả riêng cho requirement `RQ-W5-T02-G`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w5-t03"></a>
### W5-T03 — Manual time và timer

- **Mục tiêu:** ghi actual time độc lập planned duration.
- **Phạm vi/đầu ra:** time entry và timer theo user/workspace; một active timer/người/workspace; UI Web/Android, validation và quyền; thời lượng giây nguyên, tổng hợp trước định dạng.
- **Phụ thuộc:** W3-T02.
- **Nghiệm thu:** concurrent start chỉ một timer; retry stop chỉ một entry; âm/end trước start bị chặn; user sửa entry của mình; mất quyền ghi hoặc xóa mềm task đóng timer tại lúc server xử lý và giữ lịch sử; timer/time entry online-only.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T03-A…F`; TC-X06/X10.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T03-A](test-cases/02-business-projects-automation.md#tc-w5-t03-a) — kết quả riêng cho requirement `RQ-W5-T03-A`.
- [ ] [TC-W5-T03-B](test-cases/02-business-projects-automation.md#tc-w5-t03-b) — kết quả riêng cho requirement `RQ-W5-T03-B`.
- [ ] [TC-W5-T03-C](test-cases/02-business-projects-automation.md#tc-w5-t03-c) — kết quả riêng cho requirement `RQ-W5-T03-C`.
- [ ] [TC-W5-T03-D](test-cases/02-business-projects-automation.md#tc-w5-t03-d) — kết quả riêng cho requirement `RQ-W5-T03-D`.
- [ ] [TC-W5-T03-E](test-cases/02-business-projects-automation.md#tc-w5-t03-e) — kết quả riêng cho requirement `RQ-W5-T03-E`.
- [ ] [TC-W5-T03-F](test-cases/02-business-projects-automation.md#tc-w5-t03-f) — kết quả riêng cho requirement `RQ-W5-T03-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w5-t04"></a>
### W5-T04 — Estimate từng assignee, capacity và portfolio

- **Mục tiêu:** biết tải công việc thực tế mà không suy đoán ước lượng.
- **Phạm vi/đầu ra:** planned effort theo assignee, actual time, capacity theo work calendar, portfolio theo phạm vi được cấp; filters/pagination/export và unknown state.
- **Phụ thuộc:** W5-T01, W5-T03, W3-T04. Lịch làm/ngày nghỉ phải sẵn sàng trước khi nghiệm thu mẫu số capacity.
- **Nghiệm thu:** task hai người 3h/1h đúng tải riêng, không chia đều; thiếu estimate là unknown, không 0; holiday/override/reassign/đổi tuần cập nhật đúng; không nhân task/time; ACL áp dụng cả tổng/charts/export.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T04-A…E`; TC-X02/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T04-A](test-cases/02-business-projects-automation.md#tc-w5-t04-a) — kết quả riêng cho requirement `RQ-W5-T04-A`.
- [ ] [TC-W5-T04-B](test-cases/02-business-projects-automation.md#tc-w5-t04-b) — kết quả riêng cho requirement `RQ-W5-T04-B`.
- [ ] [TC-W5-T04-C](test-cases/02-business-projects-automation.md#tc-w5-t04-c) — kết quả riêng cho requirement `RQ-W5-T04-C`.
- [ ] [TC-W5-T04-D](test-cases/02-business-projects-automation.md#tc-w5-t04-d) — kết quả riêng cho requirement `RQ-W5-T04-D`.
- [ ] [TC-W5-T04-E](test-cases/02-business-projects-automation.md#tc-w5-t04-e) — kết quả riêng cho requirement `RQ-W5-T04-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w5-t05"></a>
### W5-T05 — SLA từ lịch sử có cấu trúc

- **Mục tiêu:** đo xác nhận/hoàn thành và đúng hạn từ bằng chứng lịch sử, không viết lại quá khứ.
- **Phạm vi/đầu ra:** assignment cycles, deadline snapshots, task-vs-assignment counts, wall/working-time, data availability và giải thích mẫu số; export cùng semantics.
- **Phụ thuộc:** W2-T01, W5-T01, W1-T07.
- **Nghiệm thu:** legacy thiếu events là unknown; reassign/đổi hạn/reopen giữ chu kỳ cũ; tỷ lệ đúng hạn trên completed cycles có deadline; task không hạn không vào mẫu số; thứ Sáu 16:00→thứ Hai 10:00 là 66h wall/3h working theo lịch mặc định; không chia 0 hay lộ dữ liệu ngoài quyền.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T05-A…F`; TC-X02/X06/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T05-A](test-cases/02-business-projects-automation.md#tc-w5-t05-a) — kết quả riêng cho requirement `RQ-W5-T05-A`.
- [ ] [TC-W5-T05-B](test-cases/02-business-projects-automation.md#tc-w5-t05-b) — kết quả riêng cho requirement `RQ-W5-T05-B`.
- [ ] [TC-W5-T05-C](test-cases/02-business-projects-automation.md#tc-w5-t05-c) — kết quả riêng cho requirement `RQ-W5-T05-C`.
- [ ] [TC-W5-T05-D](test-cases/02-business-projects-automation.md#tc-w5-t05-d) — kết quả riêng cho requirement `RQ-W5-T05-D`.
- [ ] [TC-W5-T05-E](test-cases/02-business-projects-automation.md#tc-w5-t05-e) — kết quả riêng cho requirement `RQ-W5-T05-E`.
- [ ] [TC-W5-T05-F](test-cases/02-business-projects-automation.md#tc-w5-t05-f) — kết quả riêng cho requirement `RQ-W5-T05-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w5-t06"></a>
### W5-T06 — Gate automation và báo cáo

- **Phụ thuộc:** W5-T02, W5-T04, W5-T05.
- **Đầu ra:** đối soát mutation/event/outbox/actual/estimate/SLA/dashboard/export; các mốc fault có rollback evidence.
- **Nghiệm thu:** không event ma hoặc thiếu event đã commit; report hiển thị độ mới/lỗi trung thực; rule retry không làm sai thống kê; đủ P0/P1 W5 và các vai trò/gói liên quan.
- **Test:** [nghiệp vụ](test-cases/02-business-projects-automation.md), `TC-W5-T06-A…C`; TC-X02/X07/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W5-T06-A](test-cases/02-business-projects-automation.md#tc-w5-t06-a) — kết quả riêng cho requirement `RQ-W5-T06-A`.
- [ ] [TC-W5-T06-B](test-cases/02-business-projects-automation.md#tc-w5-t06-b) — kết quả riêng cho requirement `RQ-W5-T06-B`.
- [ ] [TC-W5-T06-C](test-cases/02-business-projects-automation.md#tc-w5-t06-c) — kết quả riêng cho requirement `RQ-W5-T06-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W6 — Di chuyển dữ liệu từ CSV và Trello

Đã có triển khai và [hồ sơ kiểm thử nội bộ W6](test-cases/runs/2026-10-16-w6-imports.md). Checklist yêu cầu UI/browser/device thật chưa được đánh dấu đạt từ API hoặc component.

<a id="w6-t01"></a>
### W6-T01 — CSV parser và mapping

- **Mục tiêu:** nhập dữ liệu phổ biến có preview và lỗi rõ theo dòng/cột.
- **Phạm vi/đầu ra:** UTF-8/BOM, quote/newline/CRLF, header/date/custom-field mapping; validation tiêu đề/ngày/kiểu; giới hạn file/lô được công bố theo cấu hình triển khai.
- **Phụ thuộc:** W1-T11, W3-T01.
- **Nghiệm thu:** tiếng Việt/emoji/multiline giữ nguyên; ngày mơ hồ yêu cầu định dạng, ngày sai không tự sửa; thiếu/trùng header xử lý rõ; không tạo dữ liệu khi chỉ parse/preview; không bỏ validation custom fields.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W6-T01-A…D`; TC-X03/X06.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W6-T01-A](test-cases/03-offline-imports-integrations.md#tc-w6-t01-a) — kết quả riêng cho requirement `RQ-W6-T01-A`.
- [ ] [TC-W6-T01-B](test-cases/03-offline-imports-integrations.md#tc-w6-t01-b) — kết quả riêng cho requirement `RQ-W6-T01-B`.
- [ ] [TC-W6-T01-C](test-cases/03-offline-imports-integrations.md#tc-w6-t01-c) — kết quả riêng cho requirement `RQ-W6-T01-C`.
- [ ] [TC-W6-T01-D](test-cases/03-offline-imports-integrations.md#tc-w6-t01-d) — kết quả riêng cho requirement `RQ-W6-T01-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w6-t02"></a>
### W6-T02 — Import Trello có source identity

- **Mục tiêu:** chuyển lists/cards/checklists/labels sang project mà không nhân dữ liệu hoặc tài khoản.
- **Phạm vi/đầu ra:** adapter dữ liệu export Trello, source list/card IDs, mapping assignee, cảnh báo các phần không hỗ trợ; list trùng tên vẫn độc lập.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** quan hệ/thứ tự đúng; không tự tạo user/member; source ID đã nhập mặc định skip, không ghi đè chỉnh sửa đích; comment/attachment/automation không hỗ trợ được liệt kê trước commit, không âm thầm bỏ.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W6-T02-A…D`; TC-X08.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W6-T02-A](test-cases/03-offline-imports-integrations.md#tc-w6-t02-a) — kết quả riêng cho requirement `RQ-W6-T02-A`.
- [ ] [TC-W6-T02-B](test-cases/03-offline-imports-integrations.md#tc-w6-t02-b) — kết quả riêng cho requirement `RQ-W6-T02-B`.
- [ ] [TC-W6-T02-C](test-cases/03-offline-imports-integrations.md#tc-w6-t02-c) — kết quả riêng cho requirement `RQ-W6-T02-C`.
- [ ] [TC-W6-T02-D](test-cases/03-offline-imports-integrations.md#tc-w6-t02-d) — kết quả riêng cho requirement `RQ-W6-T02-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w6-t03"></a>
### W6-T03 — Preview và commit nguyên tử/idempotent

- **Mục tiêu:** người dùng biết kết quả trước khi nhập và retry an toàn.
- **Phạm vi/đầu ra:** tách preview khỏi commit; validate lại ACL/schema/mapping tại commit; transaction và operation receipt cho toàn lô; imported history source flag; giữ hợp đồng JSON v1 append.
- **Phụ thuộc:** W6-T01, W6-T02, W1-T09.
- **Nghiệm thu:** preview không mutation/send; lỗi một dòng hoặc fault rollback toàn lô; retry/concurrent commit một lần; không phát historical reminders/created automation hoặc sinh hàng loạt recurrence; JSON v1 không đổi thành upsert ngoài ý định.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W6-T03-A…F`; TC-X08.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W6-T03-A](test-cases/03-offline-imports-integrations.md#tc-w6-t03-a) — kết quả riêng cho requirement `RQ-W6-T03-A`.
- [ ] [TC-W6-T03-B](test-cases/03-offline-imports-integrations.md#tc-w6-t03-b) — kết quả riêng cho requirement `RQ-W6-T03-B`.
- [ ] [TC-W6-T03-C](test-cases/03-offline-imports-integrations.md#tc-w6-t03-c) — kết quả riêng cho requirement `RQ-W6-T03-C`.
- [ ] [TC-W6-T03-D](test-cases/03-offline-imports-integrations.md#tc-w6-t03-d) — kết quả riêng cho requirement `RQ-W6-T03-D`.
- [ ] [TC-W6-T03-E](test-cases/03-offline-imports-integrations.md#tc-w6-t03-e) — kết quả riêng cho requirement `RQ-W6-T03-E`.
- [ ] [TC-W6-T03-F](test-cases/03-offline-imports-integrations.md#tc-w6-t03-f) — kết quả riêng cho requirement `RQ-W6-T03-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w6-t04"></a>
### W6-T04 — Giao diện import Web/Android

- **Mục tiêu:** hoàn thành chọn file→map→preview→sửa lỗi→commit trên hai nền tảng.
- **Phạm vi/đầu ra:** file picker, mapping, summary imported/skipped/failed, trạng thái progress/unknown/retry; dùng backend chung.
- **Phụ thuộc:** W6-T03.
- **Nghiệm thu:** summary khớp DB; network timeout sau commit không bị mô tả chắc chắn là thất bại; retry giữ operation ID; lỗi giữ mapping nhập và không tạo bản sao; quyền thiếu hiển thị đúng, direct API vẫn bị chặn.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W6-T04-A…C`; TC-X04/X05.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W6-T04-A](test-cases/03-offline-imports-integrations.md#tc-w6-t04-a) — kết quả riêng cho requirement `RQ-W6-T04-A`.
- [ ] [TC-W6-T04-B](test-cases/03-offline-imports-integrations.md#tc-w6-t04-b) — kết quả riêng cho requirement `RQ-W6-T04-B`.
- [ ] [TC-W6-T04-C](test-cases/03-offline-imports-integrations.md#tc-w6-t04-c) — kết quả riêng cho requirement `RQ-W6-T04-C`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w6-t05"></a>
### W6-T05 — Gate import và an toàn dữ liệu

- **Phụ thuộc:** W6-T04.
- **Đầu ra:** hồ sơ file tại/vượt giới hạn, Unicode/HTML/CSV formula safety, import private project và hồi quy report/planner/recurrence.
- **Nghiệm thu:** payload hiển thị như dữ liệu; export không kích hoạt formula injection; bộ đếm/quan hệ/ACL đúng; đủ P0/P1 W6; import+offline+revoke không rò dữ liệu hoặc replay trái quyền.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W6-T05-A…D`; TC-X02/X03/X07/X08.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W6-T05-A](test-cases/03-offline-imports-integrations.md#tc-w6-t05-a) — kết quả riêng cho requirement `RQ-W6-T05-A`.
- [ ] [TC-W6-T05-B](test-cases/03-offline-imports-integrations.md#tc-w6-t05-b) — kết quả riêng cho requirement `RQ-W6-T05-B`.
- [ ] [TC-W6-T05-C](test-cases/03-offline-imports-integrations.md#tc-w6-t05-c) — kết quả riêng cho requirement `RQ-W6-T05-C`.
- [ ] [TC-W6-T05-D](test-cases/03-offline-imports-integrations.md#tc-w6-t05-d) — kết quả riêng cho requirement `RQ-W6-T05-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W7 — Google Calendar hai chiều

<a id="w7-t01"></a>
### W7-T01 — Consent, lịch riêng và token

- **Mục tiêu:** kết nối Calendar độc lập Google login, phạm vi tối thiểu.
- **Phạm vi/đầu ra:** consent `calendar.app.created`, dedicated app-created calendar/user/workspace, encrypted tokens và reconnect/disconnect UI; state và callback ràng buộc scope.
- **Phụ thuộc:** W0-T05, W1-T11; provider readiness cần đủ cho nghiệm thu thật.
- **Nghiệm thu:** login không cấp Calendar ngầm; state sai/hết hạn/tái dùng bị chặn; refresh/reconnect không gắn nhầm workspace; token không lộ; scope này không bị sử dụng như quyền đọc calendars khác/freebusy.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W7-T01-A…D`; TC-X01/X03.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W7-T01-A](test-cases/03-offline-imports-integrations.md#tc-w7-t01-a) — kết quả riêng cho requirement `RQ-W7-T01-A`.
- [ ] [TC-W7-T01-B](test-cases/03-offline-imports-integrations.md#tc-w7-t01-b) — kết quả riêng cho requirement `RQ-W7-T01-B`.
- [ ] [TC-W7-T01-C](test-cases/03-offline-imports-integrations.md#tc-w7-t01-c) — kết quả riêng cho requirement `RQ-W7-T01-C`.
- [ ] [TC-W7-T01-D](test-cases/03-offline-imports-integrations.md#tc-w7-t01-d) — kết quả riêng cho requirement `RQ-W7-T01-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w7-t02"></a>
### W7-T02 — Outbound projections và identity

- **Mục tiêu:** khách vẫn dùng Google để xem giờ làm, hạn chung, cuộc hẹn và kỳ dịch vụ.
- **Phạm vi/đầu ra:** mapping personal-plan/shared-deadline/appointment/renewal; source IDs/revisions và dedup; outbox; one event per existing task occurrence, không RRULE.
- **Phụ thuộc:** W7-T01, W4-T01, W1-T10.
- **Nghiệm thu:** personal event đúng thời lượng; deadline là event hiển thị 15 phút free/transparent, reminders Google off mặc định; không đưa tiền/credential vào event; retry sau provider accept không tạo trùng; projection không nhân nhắc trong Nhắc Tôi.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W7-T02-A…E`; TC-X02/X06/X09.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W7-T02-A](test-cases/03-offline-imports-integrations.md#tc-w7-t02-a) — kết quả riêng cho requirement `RQ-W7-T02-A`.
- [ ] [TC-W7-T02-B](test-cases/03-offline-imports-integrations.md#tc-w7-t02-b) — kết quả riêng cho requirement `RQ-W7-T02-B`.
- [ ] [TC-W7-T02-C](test-cases/03-offline-imports-integrations.md#tc-w7-t02-c) — kết quả riêng cho requirement `RQ-W7-T02-C`.
- [ ] [TC-W7-T02-D](test-cases/03-offline-imports-integrations.md#tc-w7-t02-d) — kết quả riêng cho requirement `RQ-W7-T02-D`.
- [ ] [TC-W7-T02-E](test-cases/03-offline-imports-integrations.md#tc-w7-t02-e) — kết quả riêng cho requirement `RQ-W7-T02-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w7-t03"></a>
### W7-T03 — Inbound, watch, incremental sync và conflict

- **Mục tiêu:** xử lý chỉnh sửa Google qua đúng nghiệp vụ/ACL/revision của Nhắc Tôi.
- **Phạm vi/đầu ra:** watch signal, paginated incremental sync, syncToken chỉ lưu sau trang cuối, renewal watch/catch-up, HTTP 410 full Google-cache resync; ETag/revision/correlation ngăn echo.
- **Phụ thuộc:** W7-T02, W1-T08, W1-T09.
- **Nghiệm thu:** personal edit chỉ đổi plan người đó; shared deadline edit đúng quyền đổi dueAt qua pipeline chung; appointment chỉ allowed fields; renewal readonly không renew/pay/expense; callback sai/trùng/đảo thứ tự không sai tenant; cùng trường conflict yêu cầu chọn; full resync không xóa task.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W7-T03-A…G`; TC-X02/X06/X09/X11.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W7-T03-A](test-cases/03-offline-imports-integrations.md#tc-w7-t03-a) — kết quả riêng cho requirement `RQ-W7-T03-A`.
- [ ] [TC-W7-T03-B](test-cases/03-offline-imports-integrations.md#tc-w7-t03-b) — kết quả riêng cho requirement `RQ-W7-T03-B`.
- [ ] [TC-W7-T03-C](test-cases/03-offline-imports-integrations.md#tc-w7-t03-c) — kết quả riêng cho requirement `RQ-W7-T03-C`.
- [ ] [TC-W7-T03-D](test-cases/03-offline-imports-integrations.md#tc-w7-t03-d) — kết quả riêng cho requirement `RQ-W7-T03-D`.
- [ ] [TC-W7-T03-E](test-cases/03-offline-imports-integrations.md#tc-w7-t03-e) — kết quả riêng cho requirement `RQ-W7-T03-E`.
- [ ] [TC-W7-T03-F](test-cases/03-offline-imports-integrations.md#tc-w7-t03-f) — kết quả riêng cho requirement `RQ-W7-T03-F`.
- [ ] [TC-W7-T03-G](test-cases/03-offline-imports-integrations.md#tc-w7-t03-g) — kết quả riêng cho requirement `RQ-W7-T03-G`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w7-t04"></a>
### W7-T04 — Conflict UI, xóa/unlink và thu hồi quyền

- **Mục tiêu:** thao tác xóa ở Google không làm mất công việc chung, ngắt nối có trạng thái trung thực.
- **Phạm vi/đầu ra:** conflict choice, persistent suppression tombstone, reconnect/revoke/cleanup state; xử lý all-day không tương đương timed deadline.
- **Phụ thuộc:** W7-T03.
- **Nghiệm thu:** xóa personal event bỏ plan, giữ task; xóa deadline/appointment/renewal chỉ unlink/suppress, giữ nghiệp vụ; resync không tự tạo lại mapping bị tắt; mất ACL/token dừng sync; cleanup thất bại không tuyên bố đã xóa bản bên Google; all-day conversion không tự chọn giờ.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W7-T04-A…E`; TC-X01/X06/X09/X11.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W7-T04-A](test-cases/03-offline-imports-integrations.md#tc-w7-t04-a) — kết quả riêng cho requirement `RQ-W7-T04-A`.
- [ ] [TC-W7-T04-B](test-cases/03-offline-imports-integrations.md#tc-w7-t04-b) — kết quả riêng cho requirement `RQ-W7-T04-B`.
- [ ] [TC-W7-T04-C](test-cases/03-offline-imports-integrations.md#tc-w7-t04-c) — kết quả riêng cho requirement `RQ-W7-T04-C`.
- [ ] [TC-W7-T04-D](test-cases/03-offline-imports-integrations.md#tc-w7-t04-d) — kết quả riêng cho requirement `RQ-W7-T04-D`.
- [ ] [TC-W7-T04-E](test-cases/03-offline-imports-integrations.md#tc-w7-t04-e) — kết quả riêng cho requirement `RQ-W7-T04-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w7-t05"></a>
### W7-T05 — Gate tài khoản Google thật

- **Phụ thuộc:** W7-T04 và điều kiện provider thực W0-T05.
- **Đầu ra:** event/request IDs và ảnh/log đã che secret cho create/edit/delete/reconnect hai chiều, UTC+7/timezone khác/DST/all-day; regression Google login.
- **Nghiệm thu:** đủ P0/P1 W7; event ngoài mapping không tự nhập task; Tasks hiển thị trong Calendar không được mô tả là Tasks connector; không dùng Google Tasks `due` làm deadline. Mock không thay account thật.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W7-T05-A…D`; TC-X06/X09/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W7-T05-A](test-cases/03-offline-imports-integrations.md#tc-w7-t05-a) — kết quả riêng cho requirement `RQ-W7-T05-A`.
- [ ] [TC-W7-T05-B](test-cases/03-offline-imports-integrations.md#tc-w7-t05-b) — kết quả riêng cho requirement `RQ-W7-T05-B`.
- [ ] [TC-W7-T05-C](test-cases/03-offline-imports-integrations.md#tc-w7-t05-c) — kết quả riêng cho requirement `RQ-W7-T05-C`.
- [ ] [TC-W7-T05-D](test-cases/03-offline-imports-integrations.md#tc-w7-t05-d) — kết quả riêng cho requirement `RQ-W7-T05-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W8 — Zalo OA cho nhân sự và khách hàng

<a id="w8-t01"></a>
### W8-T01 — OA theo workspace và registry

- **Mục tiêu:** doanh nghiệp kết nối OA của chính mình với quyền Business.
- **Phạm vi/đầu ra:** OA connection/token mã hóa, template/recipient registry, consent/eligibility references, UI quản trị và guard backend/worker.
- **Phụ thuộc:** W0-T06, W1-T11.
- **Nghiệm thu:** OA/token không dùng chéo workspace; mất quyền/thu hồi token/downgrade ngừng send; giữ authorized history; secret không lộ; chỉ người có quyền cấu hình được thay OA.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W8-T01-A…D`; TC-X02/X03/X10.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W8-T01-A](test-cases/03-offline-imports-integrations.md#tc-w8-t01-a) — kết quả riêng cho requirement `RQ-W8-T01-A`.
- [ ] [TC-W8-T01-B](test-cases/03-offline-imports-integrations.md#tc-w8-t01-b) — kết quả riêng cho requirement `RQ-W8-T01-B`.
- [ ] [TC-W8-T01-C](test-cases/03-offline-imports-integrations.md#tc-w8-t01-c) — kết quả riêng cho requirement `RQ-W8-T01-C`.
- [ ] [TC-W8-T01-D](test-cases/03-offline-imports-integrations.md#tc-w8-t01-d) — kết quả riêng cho requirement `RQ-W8-T01-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w8-t02"></a>
### W8-T02 — Mục đích và preview template

- **Mục tiêu:** dùng template đúng thông báo nội bộ/giao dịch/chăm sóc/quảng bá.
- **Phạm vi/đầu ra:** mapping sự kiện→purpose→approved template/CTA/recipient; preview biến thực; pre-expiry renewal care và post-expiry promotional theo điều kiện provider hiện hành.
- **Phụ thuộc:** W8-T01, W2-T03.
- **Nghiệm thu:** pending/rejected/inactive template không được gửi; nội bộ có mục đích “Thông báo nội bộ” phù hợp; tham số/CTA sai hoặc người nhận không đủ điều kiện/từ chối nhận bị chặn; preview khớp payload thực, không tự gửi khi preview.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W8-T02-A…E`; TC-X03/X05.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W8-T02-A](test-cases/03-offline-imports-integrations.md#tc-w8-t02-a) — kết quả riêng cho requirement `RQ-W8-T02-A`.
- [ ] [TC-W8-T02-B](test-cases/03-offline-imports-integrations.md#tc-w8-t02-b) — kết quả riêng cho requirement `RQ-W8-T02-B`.
- [ ] [TC-W8-T02-C](test-cases/03-offline-imports-integrations.md#tc-w8-t02-c) — kết quả riêng cho requirement `RQ-W8-T02-C`.
- [ ] [TC-W8-T02-D](test-cases/03-offline-imports-integrations.md#tc-w8-t02-d) — kết quả riêng cho requirement `RQ-W8-T02-D`.
- [ ] [TC-W8-T02-E](test-cases/03-offline-imports-integrations.md#tc-w8-t02-e) — kết quả riêng cho requirement `RQ-W8-T02-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w8-t03"></a>
### W8-T03 — Delivery, callback và đối soát timeout

- **Mục tiêu:** gửi có kiểm soát, trạng thái chính xác và callback không vượt tenant.
- **Phạm vi/đầu ra:** outbox delivery/attempt, dedup, send-time revalidation, callback authentication, mapping provider ID, trạng thái unknown và reconciliation khi timeout.
- **Phụ thuộc:** W8-T02, W1-T10.
- **Nghiệm thu:** retry một logical delivery; trước send kiểm tra task/kỳ/người nhận/quyền/gói/template; timeout sau accept không gửi lại mù; 429/tạm thời/vĩnh viễn đúng policy; callback giả/trùng/đảo thứ tự/khác OA không làm sai trạng thái hoặc rò dữ liệu.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W8-T03-A…E`; TC-X02/X10/X11/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W8-T03-A](test-cases/03-offline-imports-integrations.md#tc-w8-t03-a) — kết quả riêng cho requirement `RQ-W8-T03-A`.
- [ ] [TC-W8-T03-B](test-cases/03-offline-imports-integrations.md#tc-w8-t03-b) — kết quả riêng cho requirement `RQ-W8-T03-B`.
- [ ] [TC-W8-T03-C](test-cases/03-offline-imports-integrations.md#tc-w8-t03-c) — kết quả riêng cho requirement `RQ-W8-T03-C`.
- [ ] [TC-W8-T03-D](test-cases/03-offline-imports-integrations.md#tc-w8-t03-d) — kết quả riêng cho requirement `RQ-W8-T03-D`.
- [ ] [TC-W8-T03-E](test-cases/03-offline-imports-integrations.md#tc-w8-t03-e) — kết quả riêng cho requirement `RQ-W8-T03-E`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w8-t04"></a>
### W8-T04 — Gate OA thật và lịch sử đa kênh

- **Phụ thuộc:** W8-T03 và provider prerequisites W0-T06.
- **Đầu ra:** gửi thử người nhận nội bộ và khách hàng được phép; template/token revoke tests; lịch sử thống nhất với email/push và provider evidence.
- **Nghiệm thu:** phân biệt accepted/delivered/read với ack công việc; thiếu OA/mẫu/recipient ghi BLOCKED; mock pass không mở gate gửi thật; đủ P0/P1 W8 và không gửi ngoài nhóm thử được phép.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W8-T04-A…D`; TC-X10/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W8-T04-A](test-cases/03-offline-imports-integrations.md#tc-w8-t04-a) — kết quả riêng cho requirement `RQ-W8-T04-A`.
- [ ] [TC-W8-T04-B](test-cases/03-offline-imports-integrations.md#tc-w8-t04-b) — kết quả riêng cho requirement `RQ-W8-T04-B`.
- [ ] [TC-W8-T04-C](test-cases/03-offline-imports-integrations.md#tc-w8-t04-c) — kết quả riêng cho requirement `RQ-W8-T04-C`.
- [ ] [TC-W8-T04-D](test-cases/03-offline-imports-integrations.md#tc-w8-t04-d) — kết quả riêng cho requirement `RQ-W8-T04-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## W9 — Public API, webhook và nghiệm thu cuối

<a id="w9-t01"></a>
### W9-T01 — API token có scope và thu hồi

- **Mục tiêu:** tích hợp ngoài không có quyền rộng hơn người tạo hoặc gói hiện tại.
- **Phạm vi/đầu ra:** create/list/revoke token, raw hiển thị một lần và hash storage; scope/project binding; effective permission = token scope ∩ creator ACL ∩ entitlement; audit và redaction.
- **Phụ thuộc:** W1-T11.
- **Nghiệm thu:** raw không khôi phục từ API/log/DB; token revoked/creator locked/mất ACL có hiệu lực ngay ở server; read token không write; scope A không đọc B; downgrade chặn premium API; receipt replay cũng kiểm tra quyền.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W9-T01-A…D`; TC-X01/X02/X03/X10.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W9-T01-A](test-cases/03-offline-imports-integrations.md#tc-w9-t01-a) — kết quả riêng cho requirement `RQ-W9-T01-A`.
- [ ] [TC-W9-T01-B](test-cases/03-offline-imports-integrations.md#tc-w9-t01-b) — kết quả riêng cho requirement `RQ-W9-T01-B`.
- [ ] [TC-W9-T01-C](test-cases/03-offline-imports-integrations.md#tc-w9-t01-c) — kết quả riêng cho requirement `RQ-W9-T01-C`.
- [ ] [TC-W9-T01-D](test-cases/03-offline-imports-integrations.md#tc-w9-t01-d) — kết quả riêng cho requirement `RQ-W9-T01-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w9-t02"></a>
### W9-T02 — API v1 dùng cùng nghiệp vụ

- **Mục tiêu:** đọc/ghi công việc qua hợp đồng có version, không tạo đường tắt bỏ validation.
- **Phạm vi/đầu ra:** task/checklist/labels/custom fields; project reads và customer/service reads được phép; pagination/filter/sort, revision/idempotency, validation, rate limiting và error contract. Không thêm member/billing/renewal writes vào v1.
- **Phụ thuộc:** W9-T01, W3-T01.
- **Nghiệm thu:** lifecycle/ACL/events/reminders/recurrence giống Web/Android; status lỗi và retry đúng; tổng/cursor không rò dữ liệu; payload sai/oversize/mass assignment bị chặn; endpoint ngoài public surface không nhận token để vượt phạm vi; limit và Retry-After theo policy công bố.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W9-T02-A…F`; TC-X02/X03/X07.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W9-T02-A](test-cases/03-offline-imports-integrations.md#tc-w9-t02-a) — kết quả riêng cho requirement `RQ-W9-T02-A`.
- [ ] [TC-W9-T02-B](test-cases/03-offline-imports-integrations.md#tc-w9-t02-b) — kết quả riêng cho requirement `RQ-W9-T02-B`.
- [ ] [TC-W9-T02-C](test-cases/03-offline-imports-integrations.md#tc-w9-t02-c) — kết quả riêng cho requirement `RQ-W9-T02-C`.
- [ ] [TC-W9-T02-D](test-cases/03-offline-imports-integrations.md#tc-w9-t02-d) — kết quả riêng cho requirement `RQ-W9-T02-D`.
- [ ] [TC-W9-T02-E](test-cases/03-offline-imports-integrations.md#tc-w9-t02-e) — kết quả riêng cho requirement `RQ-W9-T02-E`.
- [ ] [TC-W9-T02-F](test-cases/03-offline-imports-integrations.md#tc-w9-t02-f) — kết quả riêng cho requirement `RQ-W9-T02-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w9-t03"></a>
### W9-T03 — Webhook có chữ ký và chống SSRF

- **Mục tiêu:** bên ngoài nhận sự kiện an toàn với hợp đồng at-least-once rõ ràng.
- **Phạm vi/đầu ra:** subscription scope, versioned payload/event ID, chữ ký raw bytes, secret rotation, retries/backoff/terminal/manual retry, ACL revalidation; HTTPS và kiểm tra DNS/IP/redirect tại thời điểm kết nối.
- **Phụ thuộc:** W9-T01, W1-T10.
- **Nghiệm thu:** subscription/payload không vượt creator quyền; chặn localhost/private/link-local/IPv6/mapped IP/DNS rebinding/redirect nội bộ; retry giữ event ID; consumer dedupe; revoke/downgrade sau enqueue không gửi canary; timeout/429/5xx/4xx phân loại, không retry vô hạn; secret không log.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W9-T03-A…F`; TC-X02/X10/X11/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W9-T03-A](test-cases/03-offline-imports-integrations.md#tc-w9-t03-a) — kết quả riêng cho requirement `RQ-W9-T03-A`.
- [ ] [TC-W9-T03-B](test-cases/03-offline-imports-integrations.md#tc-w9-t03-b) — kết quả riêng cho requirement `RQ-W9-T03-B`.
- [ ] [TC-W9-T03-C](test-cases/03-offline-imports-integrations.md#tc-w9-t03-c) — kết quả riêng cho requirement `RQ-W9-T03-C`.
- [ ] [TC-W9-T03-D](test-cases/03-offline-imports-integrations.md#tc-w9-t03-d) — kết quả riêng cho requirement `RQ-W9-T03-D`.
- [ ] [TC-W9-T03-E](test-cases/03-offline-imports-integrations.md#tc-w9-t03-e) — kết quả riêng cho requirement `RQ-W9-T03-E`.
- [ ] [TC-W9-T03-F](test-cases/03-offline-imports-integrations.md#tc-w9-t03-f) — kết quả riêng cho requirement `RQ-W9-T03-F`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w9-t04"></a>
### W9-T04 — OpenAPI, ví dụ consumer và contract tests

- **Mục tiêu:** hợp đồng public có thể dùng và kiểm chứng từ tài liệu.
- **Phạm vi/đầu ra:** OpenAPI đúng API v1, ví dụ auth/revision/idempotency/pagination/errors, consumer verify signature trên raw bytes và dedupe event; kiểm tra backward compatibility.
- **Phụ thuộc:** W9-T02, W9-T03.
- **Nghiệm thu:** ví dụ chạy được với fixture mà không sửa semantics; responses đúng schema, không lộ trường ngoài hợp đồng; chữ ký sai bị chặn và duplicate không xử lý hai lần; negative fixtures phá schema làm contract test fail, không tự cập nhật snapshot để che breaking change.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W9-T04-A…D`; TC-X03/X12.

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W9-T04-A](test-cases/03-offline-imports-integrations.md#tc-w9-t04-a) — kết quả riêng cho requirement `RQ-W9-T04-A`.
- [ ] [TC-W9-T04-B](test-cases/03-offline-imports-integrations.md#tc-w9-t04-b) — kết quả riêng cho requirement `RQ-W9-T04-B`.
- [ ] [TC-W9-T04-C](test-cases/03-offline-imports-integrations.md#tc-w9-t04-c) — kết quả riêng cho requirement `RQ-W9-T04-C`.
- [ ] [TC-W9-T04-D](test-cases/03-offline-imports-integrations.md#tc-w9-t04-d) — kết quả riêng cho requirement `RQ-W9-T04-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


<a id="w9-t05"></a>
### W9-T05 — Gate phát hành toàn hệ thống

- **Mục tiêu:** phát hành phạm vi hoàn chỉnh chỉ khi có bằng chứng đúng lớp trên Web/Android/provider.
- **Phụ thuộc:** W9-T04; W2-T05, W3-T06, W4-T05, W5-T06, W6-T05, W7-T05, W8-T04.
- **Đầu ra:** release manifest, toàn bộ task→test→build evidence, migration/restore rehearsal, vận hành/cảnh báo và feature/sender enablement rõ.
- **Nghiệm thu:** luồng project→guest→import→offline→automation→Google/Zalo/API/webhook nhất quán; downgrade/revoke ngăn tác dụng phụ; restore giữ quyền/receipt/queue và chưa tự bật sender; toàn bộ requirement bắt buộc đủ bằng chứng. Provider gate blocked thì tích hợp đó không được bật/phát hành; milestone nội bộ độc lập đã đạt được ghi riêng, không đổi blocked thành pass.
- **Test:** [offline/tích hợp](test-cases/03-offline-imports-integrations.md), `TC-W9-T05-A…D`; [TC-X01–TC-X12](test-cases/04-cross-cutting-and-release.md).

<!-- TEST-CHECKLIST -->

**Checklist kiểm thử bắt buộc** (chưa đánh dấu đạt):

- [ ] [TC-W9-T05-A](test-cases/03-offline-imports-integrations.md#tc-w9-t05-a) — kết quả riêng cho requirement `RQ-W9-T05-A`.
- [ ] [TC-W9-T05-B](test-cases/03-offline-imports-integrations.md#tc-w9-t05-b) — kết quả riêng cho requirement `RQ-W9-T05-B`.
- [ ] [TC-W9-T05-C](test-cases/03-offline-imports-integrations.md#tc-w9-t05-c) — kết quả riêng cho requirement `RQ-W9-T05-C`.
- [ ] [TC-W9-T05-D](test-cases/03-offline-imports-integrations.md#tc-w9-t05-d) — kết quả riêng cho requirement `RQ-W9-T05-D`.
- [ ] Đủ biến thể thành công, input sai, API trực tiếp với quyền sai, failure/retry liên quan và đối soát API/UI/DB/tác dụng phụ.
- [ ] Mọi P0/P1 áp dụng có actual, build/snapshot và evidence đúng lớp; dùng [mẫu hồ sơ chạy](test-cases/README.md#mẫu-hồ-sơ-chạy), không suy PASS từ suite tương tự.


## Discovery — Ngoài 58 task bắt buộc

Các mục sau là nghiên cứu/kiểm chứng, không được lén biến thành dependency phát hành hoặc tính năng đã cam kết.

| ID | Câu hỏi/đầu ra | Ràng buộc |
|---|---|---|
| D01 | Google Tasks connector: đánh giá lợi ích người dùng, API mapping, import hay sync, poll cost và conflict | `due` của API là scheduled date, bỏ giờ, không dùng làm deadline; không suy API hỗ trợ toàn bộ Tasks UI; chưa triển khai connector |
| D02 | Deadline chỉ có ngày: chọn nghĩa ngày/hạn/nhắc và migration tương thích | Không ép all-day Google event thành timestamp không có quyết định |
| D03 | Booking lịch hẹn: đánh giá nhu cầu, quyền freebusy, API khả dụng và quy trình khách hàng | Scope app-created không đọc lịch khác; không hứa Calendar appointment booking API đầy đủ |
| D04 | Pilot 5–8 SME đang dùng Google, khoảng một tháng: định lượng giảm đuổi việc/bỏ lỡ gia hạn và khả năng trả tiền | Chuẩn bị kịch bản/đo lường; không tự gửi lời mời/liên hệ khách ngoài chỉ dẫn cụ thể |
| D05 | Dựa pilot điều chỉnh ưu tiên hoặc đề xuất gói/giá | Giữ giá/ghế/quota đã chốt cho roadmap này cho đến quyết định thay đổi được ghi nhận |

## Cập nhật backlog khi triển khai

Mỗi task sau khi bắt đầu cần thêm người phụ trách, branch/PR hoặc board ID thực, ngày bắt đầu, kết quả gate và evidence. Nếu tạo trên bảng công việc, giữ `Wn-Tnn` trong tiêu đề/metadata và ghi mapping ID thực tại đây; không trình bày planning ID như board ID. Thay đổi requirement phải cập nhật spec chức năng, test expected và dependency trước khi đánh dấu hoàn thành. Chỉ bổ sung task mới khi có phạm vi mới rõ ràng; không đổi số 58 để che thiếu việc trong một task cũ.
