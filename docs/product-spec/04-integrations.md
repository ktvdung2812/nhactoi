# Đặc tả tích hợp

Ngày cập nhật: **2026-10-16**. Trạng thái: **đặc tả mục tiêu, chưa xác nhận triển khai hoặc kiểm thử**. Các quyết định sản phẩm đã chốt được giữ nguyên; chi tiết hợp đồng kỹ thuật bổ sung trong tài liệu là mặc định thiết kế đề xuất, không phải mô tả API hiện hữu.

Đọc cùng [chức năng](03-functional-spec.md), [kiến trúc/dữ liệu](05-architecture-and-data.md), [58 task](07-tasks.md), [10 wave](08-waves.md) và [test tích hợp](test-cases/03-offline-imports-integrations.md).

## 1. Mục tiêu và ranh giới

Khách hàng tiếp tục dùng Google Calendar để xem lịch; Nhắc Tôi quản lý công việc chung, người chịu trách nhiệm, xác nhận, nhắc lại, khách hàng/dịch vụ và bằng chứng thực hiện. Không buộc khách hàng chuyển toàn bộ lịch hoặc tạo dữ liệu hai lần.

| Tích hợp | Phạm vi cam kết | Gói / wave | Ngoài phạm vi bắt buộc |
|---|---|---|---|
| CSV / Trello | Preview, mapping, import có kiểm tra quyền và chống trùng | Starter trở lên / W6 | Đồng bộ liên tục Trello; nhập mọi Power-Up/automation/comment/file |
| Google Calendar | Hai chiều trên lịch do ứng dụng tạo: kế hoạch cá nhân, deadline chung; cuộc hẹn theo trường cho phép; hiển thị kỳ gia hạn | Starter trở lên / W7 | Đọc tất cả lịch khác, free/busy toàn tài khoản, booking, Google Tasks connector |
| Zalo | OA riêng của doanh nghiệp; thông báo nhân viên và khách hàng qua mẫu được phép | Business / W8 | OA dùng chung của Nhắc Tôi để gửi thay mọi doanh nghiệp; tự động gửi khi chưa đủ điều kiện provider |
| Public API / webhook | API v1 có scope; sự kiện có chữ ký, retry và kiểm tra quyền | Business / W9 | Ghi billing, ghế, thành viên hoặc gia hạn tài chính qua API v1 |

Mọi tích hợp dùng cùng dịch vụ nghiệp vụ, ACL, entitlement, revision, mutation receipt và outbox với Web/Android. Callback hoặc token bên ngoài không tạo đường đặc quyền bỏ qua kiểm tra này. Tính năng chưa đạt gate provider thật phải giữ chưa phát hành/bật sender, kể cả mock test đã đạt.

## 2. CSV và Trello — W6-T01…T05

### 2.1 Luồng người dùng

1. Chọn project đích và nguồn CSV/Trello JSON trên Web hoặc Android; kiểm tra quyền tạo task và tính năng đích.
2. Chọn file, format ngày và mapping cột/người/nhãn/custom fields. File được đọc như dữ liệu, không thực thi nội dung.
3. Preview hiển thị số dòng hợp lệ, lỗi, trùng nguồn, phần không hỗ trợ và những giá trị sẽ tạo. Người dùng sửa mapping trước commit.
4. Xác nhận một lần với operation ID của lô. Server kiểm tra lại quyền, schema, liên kết và toàn bộ lô trong transaction.
5. Hiển thị imported/skipped/failed và liên kết task thực. Nếu response bị mất, truy vấn/retry cùng operation ID để đối soát, không lập lô mới.

Preview không ghi task, membership, expense, notification hoặc chạy automation. Dữ liệu staging nếu cần chỉ phục vụ preview, có thời hạn và cùng quyền project; không coi staging là import thành công.

### 2.2 Mapping và validation

| Nguồn | Đích và quy tắc |
|---|---|
| CSV title | Bắt buộc, trim theo validation task hiện hữu; báo dòng/cột khi rỗng |
| Description, priority, lifecycle/column | Dùng validation và danh sách cho phép của project; không tạo status tùy ý ngoài lifecycle chuẩn |
| Deadline | Parse format người dùng đã chọn; ngày mơ hồ không tự đoán; không âm thầm chọn giờ cho deadline chỉ có ngày |
| Assignee | Map tới người còn quyền project; không tự tạo tài khoản, invitation hoặc quyền |
| Labels/custom fields | Map trong project, validate đúng kiểu; option không tồn tại cần quyết định mapping trước commit |
| Trello list/card | Giữ source ID; list trùng tên không được gộp chỉ theo tên |
| Trello checklist | Giữ thứ tự, trạng thái và liên kết task mới; ID đích mới |
| Trello comment/attachment/Power-Up | Liệt kê rõ phần bỏ qua trong preview v1; không âm thầm báo nhập đầy đủ |

CSV hỗ trợ UTF-8/BOM, tiếng Việt, emoji, CRLF, quote, dấu phân cách và newline trong ô. Reject file sai cấu trúc/giới hạn cấu hình bằng lỗi rõ ràng; không cắt dữ liệu lặng lẽ. Giới hạn file/lô là giới hạn vận hành được công bố trong UI và hợp đồng trước triển khai, không thay đổi quota thương mại.

### 2.3 Tính nguyên tử và chống trùng

- Một dòng lỗi sau revalidation làm rollback toàn lô commit; không để project/task/checklist nửa chừng.
- Receipt ràng buộc operation ID với actor/workspace/project và hash payload. Retry cùng payload trả kết quả đã có sau kiểm tra quyền; cùng ID khác payload bị từ chối.
- Trello giữ mapping `(workspace, destination project, source board, source card)` duy nhất. Nhập lại mặc định **skip nguồn đã nhập**, không ghi đè chỉnh sửa trong Nhắc Tôi. Source mới vẫn được nhập.
- CSV dùng receipt chống retry cùng lô; một lô mới là yêu cầu nhập mới và phải preview rõ, không suy đoán hai hàng giống tiêu đề là cùng task.
- Import lịch sử không gửi reminder quá khứ, không kích hoạt automation `created` lịch sử, không sinh hàng loạt kỳ lặp tiếp theo. Những lịch tương lai hợp lệ chỉ bắt đầu từ dữ liệu sau commit theo chính sách nghiệp vụ.
- Giữ hợp đồng **JSON v1 append** hiện hữu; không áp quy tắc dedupe Trello ngược lại cho client cũ.
- Escape nội dung khi render và xử lý CSV formula injection khi xuất lại; không thay đổi nội dung người dùng một cách không được công bố.

Nghiệm thu: `TC-W6-*`, các ca import hiện hữu trong `tests/automation-events-transfer.test.mjs`, ACL và fault transaction. Không xem parser unit test là bằng chứng UI Android đã hoạt động.

## 3. Google Calendar — W0-T05, W7-T01…T05

### 3.1 Kết nối và quyền

- Google login và consent Calendar là hai kết nối chức năng riêng. Đăng nhập Google không tự bật Calendar; ngắt Calendar không phá Google login.
- Mỗi cặp `(user, workspace)` có một kết nối Google đang hoạt động, lưu Google account identity và sử dụng **lịch riêng do ứng dụng tạo**, scope mục tiêu `https://www.googleapis.com/auth/calendar.app.created`. Scope này không cho quyền đọc tùy ý lịch khác hoặc free/busy toàn bộ tài khoản.
- OAuth state ngắn hạn, dùng một lần, ràng buộc user/workspace/callback; callback sai hoặc hết hạn bị từ chối. Không nhận workspace từ callback để thay scope đã ràng buộc.
- Token provider được mã hóa server-side, có key version, không trả trong API/log/backup công khai. Refresh lỗi `invalid_grant` chuyển sang cần kết nối lại, dừng job liên quan.
- UI có trạng thái chưa kết nối/đang đồng bộ/đã đồng bộ/cần xử lý xung đột/cần kết nối lại/ngắt kết nối; hiển thị lần thành công gần nhất và lỗi có hành động khắc phục.
- Người dùng chọn bật nhóm projection. Kết nối chỉ xuất dữ liệu mà họ có quyền hiện tại; guest không được dùng tích hợp để nhận dữ liệu CRM hoặc project ngoài quyền.
- W0 xác minh OAuth client, callback HTTPS, scope thực, cấu hình test user, quota và điều kiện xác minh ứng dụng. Không khẳng định đủ điều kiện phát hành chỉ từ code.

### 3.2 Hợp đồng mapping

| Loại projection | Nhắc Tôi → Google | Google → Nhắc Tôi | Xóa ở Google |
|---|---|---|---|
| Personal plan | Khoảng thời gian của đúng người kết nối, tiêu đề task và liên kết an toàn | Đổi start/end cập nhật plan người đó, revision plan riêng; không đổi task deadline hoặc plan người khác | Xóa plan của người đó, giữ task |
| Shared deadline | `dueAt` thành event hiển thị 15 phút, `transparency=transparent`, reminders tắt | Đổi thời điểm bắt đầu cập nhật `dueAt` qua ACL/revision/pipeline nghiệp vụ | Unlink/suppress mapping; giữ task và deadline |
| Appointment | Tiêu đề, mô tả được phép, startsAt/endsAt và liên kết | Chỉ sửa tiêu đề/mô tả/thời gian được phép và còn quyền; không thay membership hoặc thông tin tài chính | Unlink; giữ cuộc hẹn trong Nhắc Tôi |
| Service renewal | Hiển thị mốc kỳ gia hạn, tên an toàn và liên kết được phép | Chỉ đọc về mặt nghiệp vụ; không gia hạn, thanh toán hoặc tạo khoản chi | Unlink; giữ dịch vụ/kỳ/tiền |

Mặc định kỹ thuật: với projection task, Google không được đổi assignee, completion, ACL, checklist hoặc recurrence. Thay tiêu đề/mô tả hiển thị ngoài trường được hỗ trợ không trở thành mutation task; UI báo trường không đồng bộ và lần projection tiếp theo đưa về giá trị Nhắc Tôi. Renewal luôn do Nhắc Tôi làm nguồn dữ liệu chính.

Deadline event dài 15 phút chỉ là cách biểu diễn, không phải duration công việc và không chặn thời gian bận. Google default reminders không được tự bật thêm một kênh nhắc trùng. Plan dùng duration của người dùng; thiếu duration không được suy thành deadline. Khi một bản ghi có cả plan và deadline, đó là hai loại mapping khác nhau, có nhãn rõ trong event và UI.

Personal plan chỉ có ngày được biểu diễn bằng all-day event một ngày, end date loại trừ theo Calendar. Plan có giờ dùng duration hiện hữu: mặc định 60 phút, số phút nguyên 15–1440 và kết thúc trong cùng ngày theo validation hiện tại của `server/personal-tasks.mjs`. Google đổi plan sang nhiều ngày, duration ngoài giới hạn hoặc vượt ngày phải báo cần xử lý, không cắt thời lượng. Việc hỗ trợ ngày cho personal plan không đồng nghĩa đã bổ sung deadline chỉ có ngày (D02).

Recurrence được xuất **mỗi task occurrence đã tồn tại thành một event riêng**. Không sinh Google RRULE và không tạo trước vô hạn kỳ tương lai. Complete task lặp qua Google không được hỗ trợ; completion trong Nhắc Tôi tạo successor đúng một lần rồi projection successor khi có dữ liệu hợp lệ.

### 3.3 Vòng đồng bộ

1. Mutation Nhắc Tôi commit business row, revision, event và outbox trong cùng transaction.
2. Worker claim job, đọc lại quyền và dữ liệu hiện tại, so mapping/base revision trước gửi. Dùng ID event do ứng dụng xác định theo ràng buộc Google để retry create không nhân event.
3. Gửi/patch với ETag khi thích hợp; lưu event ID, ETag, base snapshot và trạng thái mapping sau đối soát.
4. Google watch chỉ báo có thay đổi; **callback không chứa toàn bộ event**. Xác thực channel/resource/token ràng buộc, dedupe và lên lịch incremental sync.
5. Đọc mọi trang với tham số nhất quán; chỉ lưu `nextSyncToken` sau trang cuối được xử lý bền vững. Callback trùng/đảo thứ tự hoặc mất callback không được làm mất dữ liệu.
6. Renew watch trước hết hạn, có catch-up định kỳ và khi reconnect. `410 Gone` xóa trạng thái cache/token Google cần xây lại rồi full resync; không xóa task Nhắc Tôi.
7. Inbound chỉ xử lý event có mapping hợp lệ. Event lạ trong lịch không tự biến thành task; ID giả hoặc mapping khác tenant bị bỏ qua/báo lỗi phù hợp.

Outbound timeout sau Google có thể đã nhận: đối soát event ID trước create lại; không tuyên bố thất bại chắc chắn hoặc đổi sang ID mới. Callback đến trước response outbound vẫn nhận diện được logical mapping.

### 3.4 Xung đột, xóa và mất quyền

- Giữ base snapshot/revision để so ba phía: bản đã đồng bộ, Nhắc Tôi hiện tại và Google hiện tại. Nếu chỉ một phía đổi trường được hỗ trợ thì áp dụng sau kiểm tra quyền; cùng trường đổi khác nhau cần người dùng lựa chọn.
- Chọn bản Nhắc Tôi đẩy theo revision/ETag mới; chọn Google đi qua business mutation mới. Nếu dữ liệu đổi tiếp trong lúc chọn, báo conflict mới; không bỏ qua optimistic concurrency.
- Shared deadline đổi thành công phải cập nhật tất cả mapping còn được phép của task. Gắn causation/source và so giá trị canonical để tránh echo-loop.
- Google đổi timed event thành all-day không tự chuyển thành hạn 00:00/09:00. Giữ deadline hiện có, báo cần xử lý; date-only deadline thuộc discovery.
- Xóa projection tạo tombstone/suppression bền vững theo mapping; full resync không tự tạo lại. Chỉ thao tác liên kết lại rõ ràng mới xóa suppression.
- Xóa task/plan phía Nhắc Tôi lên lịch dọn projection tương ứng. Nếu quyền token đã mất, có thể không dọn được bản sao bên Google; UI nêu đúng phần chưa xóa, không báo đã xóa tất cả.
- Thu hồi project access, khóa người dùng, suspend workspace hoặc ngắt tích hợp phải chặn send/apply tiếp theo. Dữ liệu đã xuất trước đó vào tài khoản Google là bản sao bên thứ ba; cleanup chỉ theo quyền provider còn lại.

Nghiệm thu: `TC-W7-*`, `TC-X09`; fake transport kiểm tra race/410/page/ETag; W7-T05 phải có tài khoản Google thật và bằng chứng create/edit/delete/revoke/reconnect, timezone/DST. Chưa thực hiện trong đợt lưu spec này.

## 4. Google Tasks — discovery D01, không phải connector đã cam kết

Google Calendar và Google Tasks là sản phẩm liên quan nhưng API khác nhau. Task xuất hiện trên Calendar UI không khiến Calendar API quản lý được task đó.

Ngày 16/10/2026 đã đọc lại trực tiếp discovery bằng HTTP GET: status 200, body không bị cắt, revision `20261013`. Vẫn cần kiểm tra lại khi triển khai vì hợp đồng provider có thể thay đổi:

- `Tasks.due` là **ngày được lên lịch**, không phải deadline độc lập; API chỉ giữ phần ngày và bỏ thời gian. Không map `due` vào `task.dueAt` để hứa nhắc đúng giờ.
- Schema API chưa thể hiện đầy đủ các trường mới trên UI như deadline riêng, start/end, duration, recurrence, starred hoặc attachments. Không hứa round-trip chúng dựa trên ảnh giao diện.
- `assignmentInfo` chỉ đọc; trạng thái API chủ yếu `needsAction`/`completed`, không biểu diễn lifecycle doing/ack/snooze/team responsibilities của Nhắc Tôi.
- Không có Calendar-style watch/syncToken cho Google Tasks; connector tương lai cần polling và chính sách `showCompleted`, `showHidden`, `showDeleted`, paging, xung đột/xóa riêng.

Đầu ra D01: ma trận trường thực sự đọc/ghi được, scope consent, chi phí polling/quota, cách map vào personal plan date thay vì deadline, xử lý recurrence/complete/delete, và đánh giá giá trị với pilot. Chỉ sau quyết định sản phẩm mới thêm task triển khai/gate. D02 date-only deadline và D03 booking cũng ngoài 58 task.

## 5. Zalo OA — W0-T06, W8-T01…T04

### 5.1 Kết nối doanh nghiệp

- Một workspace liên kết OA do doanh nghiệp sở hữu/được ủy quyền. Không dùng credential OA của workspace khác hoặc OA chung để vượt điều kiện người nhận.
- Owner/admin có entitlement Business cấu hình OA, consent, template và registry người nhận. Guest không quản trị tích hợp; quyền nghiệp vụ gửi vẫn phải kiểm tra theo nguồn task/dịch vụ.
- Lưu OA ID, trạng thái ủy quyền, token mã hóa/key version, template ID/version/status/purpose, registry recipient và bằng chứng điều kiện gửi. Không mặc định số điện thoại là recipient hợp lệ.
- W0-T06 ghi rõ API/phiên bản đang được OA hỗ trợ, loại mẫu/phí/quota/policy hiện hành và tài khoản thử. Tên thương mại/chính sách provider có thể thay đổi; adapter phải theo hợp đồng được xác minh, không bịa endpoint.

### 5.2 Mục đích và preview

| Tình huống | Yêu cầu trước enqueue |
|---|---|
| Nhắc nhân viên | Template được duyệt cho thông báo nội bộ, nội dung thể hiện “Thông báo nội bộ” khi policy yêu cầu; người nhận đủ điều kiện |
| Thông báo giao dịch/dịch vụ | Nghiệp vụ thật, đúng mục đích và tham số đã duyệt; không chèn thông điệp khác qua biến |
| Nhắc trước hết hạn | Kiểm tra template chăm sóc phù hợp, điều kiện người nhận và thời điểm |
| Sau hết hạn/quảng bá | Không mặc định là chăm sóc; đánh giá mục đích quảng bá và điều kiện riêng theo policy |

Preview hiển thị OA gửi, recipient, template/version, mục đích, tham số và CTA. Nội dung thực phải khớp preview trong giới hạn render của provider. Mẫu pending/rejected/inactive, thiếu tham số, CTA sai, opt-out hoặc mất điều kiện nhận đều chặn gửi. Không chuyển kênh/mục đích để lách lỗi template.

### 5.3 Gửi và lịch sử

- Outbox dedupe logical delivery theo workspace/OA/source/cycle/recipient/purpose; từng attempt có record riêng.
- Revalidate nguồn còn hiệu lực, kỳ gia hạn chưa đổi, task chưa xong, recipient/ACL/gói/template trước từng attempt.
- Provider nhận thành công được ghi accepted. Delivered/read chỉ ghi khi provider có bằng chứng tương ứng. Không biến read thành ack công việc; ack là thao tác nghiệp vụ riêng.
- Timeout không xác định sau send chuyển `unknown`, giữ request/message correlation; dùng callback/lookup provider để đối soát nếu hỗ trợ. Không hứa exactly-once khi provider không cung cấp idempotency/lookup đáng tin cậy.
- 429/lỗi tạm thời dùng retry/backoff/Retry-After. Lỗi template/recipient/token vĩnh viễn dừng để sửa; có trần attempt được công bố trong policy vận hành.
- Callback kiểm chứng theo cơ chế provider thực, OA binding và message identity; dedupe, chống replay trái phép, không cho callback đảo thứ tự làm lùi trạng thái đã chứng minh.
- Disconnect/downgrade dừng sender nhưng giữ lịch sử đúng quyền; không xóa bằng chứng đã gửi.

W8-T04 chỉ đạt khi có OA/template/recipient thật được phép. Đợt soạn tài liệu không ủy quyền gửi tin thực tới khách hàng/nhân viên; thử provider sau này phải dùng người nhận thử phù hợp.

## 6. Public API v1 — W9-T01, T02, T04

### 6.1 Principal và token

Token có tên, creator, workspace, scope, giới hạn project, created/revoked/last-used timestamps. Raw token entropy cao chỉ hiện một lần; DB chỉ lưu hash để xác minh. Không ghi raw token trong URL, log hoặc export.

Quyền hiệu lực = **token scope ∩ ACL hiện tại của creator ∩ entitlement hiện tại**. Project filter chỉ thu hẹp quyền. Creator bị khóa, token thu hồi, mất project access hoặc downgrade phải có hiệu lực ở request tiếp theo; cache capability của client không giữ quyền cũ.

Scope đề xuất cho v1: `projects:read`, `tasks:read`, `tasks:write`, `customers:read`, `services:read`. Scope task write chỉ áp dụng hành động mà role người tạo được phép. Không có scope billing/member/seat/renewal-write. Credential quản trị webhook vẫn theo owner/admin và quyền dữ liệu subscription.

### 6.2 Surface và hợp đồng

Namespace mục tiêu `/api/v1`; đây là API mới cần triển khai, không khẳng định endpoint đang tồn tại.

| Nhóm | Hành vi v1 |
|---|---|
| Projects | List/detail những project được phép; không quản trị membership trong v1 |
| Tasks | List/detail/create/update và thao tác lifecycle/delete theo role, cùng pipeline Web/Android |
| Checklist | Đọc/thêm/sửa/xóa/hoàn thành item theo task ACL; cập nhật task revision tổng hợp |
| Labels | Đọc danh mục được phép, gắn/bỏ nhãn trên task; không tự tạo ngoài project |
| Custom fields | Đọc định nghĩa và đọc/ghi giá trị đã định kiểu theo entitlement; không dùng payload tùy ý để sửa schema |
| Customers/services | Read-only allowlist theo quyền nghiệp vụ; không xuất credential, dữ liệu tiền hoặc trường nhạy cảm chỉ vì có task link |

- JSON schema allowlist, size limits, ISO timestamp có timezone cho thời điểm, ID opaque. Từ chối mass assignment như workspace/role/creator bất hợp lệ.
- Mutation nhận operation ID/idempotency key và expected revision theo hợp đồng công bố; cùng semantics với W1. Response trả entity/revision mới, ID operation và lỗi có mã máy đọc được.
- `401` cho credential không hợp lệ, `403` cho hành động biết rõ nhưng không được phép, `404` cho resource không tồn tại/ngoài phạm vi cần che giấu, `409` cho conflict revision hoặc tái dùng operation khác payload; validation và rate limit có mã chi tiết ổn định.
- Paging dùng cursor opaque ràng buộc filter/sort/scope, sort có tie-break ID; giới hạn page và rate là cấu hình vận hành được công bố trong OpenAPI trước gate. Không hứa snapshot bất biến qua nhiều trang khi dữ liệu đang thay đổi; contract phải nêu rõ semantics.
- Read không tạo nghiệp vụ/outbox. Rate-limit rejection/validation/ACL failure không ghi mutation thành công. Có `Retry-After` khi policy hỗ trợ.
- OpenAPI ghi mọi request/response/error, auth scope, revision/idempotency, paging, giới hạn và ví dụ executable. Breaking contract phải version hoặc có lộ trình tương thích; không sửa snapshot test để bỏ qua lỗi.

## 7. Webhook — W9-T03, T04

### 7.1 Subscription và event

Subscription gồm workspace, creator, project filter, loại event, HTTPS destination, signing secret version, active state và lịch sử thử. Tạo/edit/retry đều kiểm tra quyền. Dữ liệu xuất allowlist và không rộng hơn những gì creator được đọc hiện tại.

Envelope mục tiêu: `eventId`, `schemaVersion`, `eventType`, `occurredAt`, `workspaceId`, resource identity/revision, `data` allowlist và causation/operation identity khi có. Event ID ổn định qua retry; delivery attempt ID riêng. Không gửi token, nội dung credential hoặc metadata người ngoài quyền.

Event v1 lấy từ typed events đã commit: task create/update/lifecycle, assignment/deadline thay đổi và các thay đổi checklist/labels/custom values được công bố. API không tự định nghĩa event từ chuỗi audit text cũ. Import lịch sử không phát event webhook lịch sử; thay đổi hợp lệ sau import vẫn phát bình thường.

### 7.2 Vận chuyển và chữ ký

- At-least-once delivery; consumer phải dedupe theo event ID. Không hứa thứ tự toàn cục; consumer dùng revision hoặc đọc API để đối soát khi cần.
- Mặc định kỹ thuật đề xuất: HMAC-SHA256 trên `timestamp + "." + rawBody`, header chứa timestamp, signature version và key ID; verify bằng constant-time comparison trước parse/apply. Ví dụ consumer cho cửa sổ replay mặc định 5 phút và đồng hồ đồng bộ. Retry ký lại timestamp nhưng giữ event ID.
- Rotate secret tạo version mới; outbound mới dùng secret mới, consumer có cửa sổ chấp nhận version cũ theo cấu hình công bố. Không đưa raw secret cũ vào list API/log.
- Chỉ HTTPS đích public; kiểm tra URL, DNS và IP lúc kết nối, gồm IPv6/mapped IPv6, localhost/private/link-local/metadata. Mặc định không follow redirect để tránh đưa payload/secret sang đích khác. Re-resolve/revalidate trước retry; DNS rebinding không vượt guard.
- Timeout, 429 và 5xx retry có jitter/backoff và trần; phần lớn 4xx dừng theo contract. `Retry-After` bị giới hạn bởi policy, không làm queue ngủ vô hạn. Manual retry giữ event ID và vẫn kiểm quyền.
- Revalidate ACL/entitlement trước mỗi lần gửi; quyền mất sau enqueue làm suppressed có lý do, không phát payload nhạy cảm đã snapshot trước đó.
- Receiver nhận rồi mất response có thể nhận lại. History trình bày event/attempt riêng, không ghi chắc chắn consumer đã áp dụng chỉ từ response gửi.

## 8. Trạng thái vận hành và nghiệm thu

Mỗi connection có owner/workspace/provider identity, trạng thái, lần thành công gần nhất, lỗi đã redaction, khả năng reconnect và lịch sử thao tác. Mỗi job có correlation đến operation/event/source/cycle, retry schedule và lý do failed/suppressed/unknown. UI Web/Android đọc cùng nguồn trạng thái; thông báo chung không lộ private title trên màn hình khóa.

Không lưu payload provider không cần thiết vô thời hạn. Retention và cleanup áp dụng theo chính sách dữ liệu của sản phẩm; secret không có trong evidence. Thu hồi quyền kiểm tra tại read/enqueue/send/apply, không chỉ lúc cấu hình.

Các gate liên quan: W6-T05 import; W7-T05 Google thật; W8-T04 OA thật; W9-T04 contract và W9-T05 release. Bằng chứng phải ghi build, fixture, runtime, account/provider thử đã che secret, expected/actual và ID tương quan. Hiện trạng các ca: **NOT RUN**; dùng `BLOCKED` khi đã xác định cụ thể điều kiện provider chưa đáp ứng.

## 9. Nguồn chính thức và giới hạn kiểm chứng

Các URL dưới đây là nguồn cần giữ trong hồ sơ triển khai và đối chiếu lại trước phát hành; việc lưu spec này không phải một lần kiểm thử provider mới:

- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).
- [Calendar events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).
- [Calendar incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).
- [Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push).
- [Calendar create events](https://developers.google.com/workspace/calendar/api/guides/create-events).
- [Google Tasks task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks).
- [Google Tasks list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list).
- [Google Tasks discovery](https://tasks.googleapis.com/$discovery/rest?version=v1).
- [Trello export documentation](https://support.atlassian.com/trello/docs/exporting-data-from-trello/).
- [Zalo Developers](https://developers.zalo.me/) và [Zalo Cloud](https://zalo.cloud/): dùng tài liệu/API/policy/template gắn với OA thật; W0-T06 phải ghi phiên bản và bằng chứng cụ thể.
