# Đặc tả chức năng Nhắc Tôi

Ngày lưu: **2026-10-16**. Trạng thái: **đặc tả mục tiêu để triển khai theo W0–W9**; tài liệu này không xác nhận các chức năng đề xuất đã được xây dựng hoặc kiểm thử đạt. Đọc cùng [baseline và quyết định](02-baseline-and-decisions.md), [tích hợp](04-integrations.md), [kiến trúc và dữ liệu](05-architecture-and-data.md), [58 task](07-tasks.md), [10 wave](08-waves.md) và [test case](test-cases/README.md).

Mục tiêu là giúp doanh nghiệp dịch vụ nhỏ quản lý công việc từ giao việc, xác nhận, nhắc, hoàn thành tới gia hạn và chăm sóc khách hàng; sau đó mở rộng chiều sâu quản lý dự án và sử dụng cá nhân. Mọi tính năng lõi phải có luồng sử dụng tương đương trên **Web và Android**. Giao diện có thể khác theo thiết bị, nhưng quyền, dữ liệu và kết quả nghiệp vụ phải giống nhau.

## 1. Quy ước, phạm vi và tiêu chí chung

- `FR-*` là nhóm yêu cầu chức năng ổn định. ID `Wn-Tnn` liên kết sang backlog; test case chi tiết có ID canonical hoặc alias trong [ma trận task–test](test-cases/README.md).
- **Quyết định đã chốt:** phạm vi Web/Android, dự án kế thừa/riêng tư/guest, guest tính ghế, Android ghi offline, Calendar hai chiều gồm deadline chung, Zalo qua OA từng doanh nghiệp, ba tầng tính năng và giữ mức giá/ghế hiện hữu.
- **Mặc định kỹ thuật đề xuất:** quy tắc chi tiết cần để triển khai nhất quán như retire custom field, xử lý dependency khi move, quyền chủ automation, cách tính SLA, catch-up sau downtime. Chúng được ghi rõ tại từng mục; không diễn đạt thành lời người dùng đã xác nhận.
- Dữ liệu nghiệp vụ không bị xóa, công khai hoặc thay nghĩa do đổi gói, mất mạng, conflict hay lỗi provider. Thao tác thất bại phải giữ dữ liệu người dùng đang nhập và giải thích cách xử lý phù hợp.
- Các nút, menu và form phản ánh quyền hiện tại; backend vẫn kiểm tra lại từng request. Thông báo lỗi đối tượng ngoài quyền không tiết lộ tên, nội dung hoặc sự tồn tại qua metadata, số đếm, file hoặc lịch sử.
- Thời điểm có giờ được lưu bằng instant chuẩn; lịch/ngày nghiệp vụ Việt Nam dùng `Asia/Ho_Chi_Minh`. Không lấy ngày UTC thay cho “hôm nay” của doanh nghiệp. Deadline chỉ có ngày là discovery riêng, chưa được tự thêm thành kiểu deadline mới.
- Mỗi màn hình danh sách có loading, thành công rỗng, lỗi có retry và dấu hiệu dữ liệu đang cũ/offline khi áp dụng. Empty không thay cho lỗi. Thao tác submit lặp phải được bảo vệ từ server, không chỉ disable nút.

## 2. FR-BASE — Bảo toàn và hoàn thiện chức năng hiện hữu

**Task:** W0-T02, W0-T03, W0-T04. **Nghiệm thu:** [W0–W1](test-cases/01-foundation.md).

Repo đã có nền tảng task, cột trạng thái, checklist, nhãn, người phối hợp, copy/template, automation, lịch hẹn, planner cá nhân, recurrence, nhắc và phản hồi nhắc, khách hàng/dịch vụ, thu–chi, billing và Android. Các mục này phải được kiểm chứng theo baseline thực tế; không xây phiên bản thứ hai chỉ vì một entrypoint UI còn thiếu.

1. Hiển thị và nối đúng các luồng nhãn, người phối hợp, copy, automation và template đang tồn tại. Task detail chỉ có một luồng checklist nhất quán, giữ thứ tự, người phụ trách, hạn và tiến độ.
2. Lọc người được giao bao gồm cả người chính và người phối hợp; một task chỉ xuất hiện một lần. Tổng và phân trang dùng cùng tập dữ liệu.
3. Lịch sử nhắc hiển thị đầy đủ các kênh đã có: email, FCM và Web Push; bổ sung Zalo ở W8. Tách trạng thái provider chấp nhận, thất bại, trạng thái giao/đọc nếu provider cung cấp và việc người dùng xác nhận công việc.
4. Thu/chi khách hàng phân loại bằng loại giao dịch, không suy từ dấu amount: thu 100, chi 40 đều lưu giá trị dương thì số dư là 60.
5. Hiển thị tên gói theo catalog, kể cả gói tùy chỉnh hoặc ngừng bán; không suy entitlement từ tên gói hay nội dung marketing.
6. Thống nhất “hôm nay”, quá hạn và mốc ngày theo giờ Việt Nam. Tiếp tục bảo toàn auth/session, reset mật khẩu, khóa tài khoản, Google login, file, trash, backup và các luồng hiện hữu được baseline xác nhận.

## 3. FR-PROJECT — Workspace, team, project và board

**Task:** W1-T03, W1-T04, W1-T06. **Nghiệm thu:** TC-FND-009–040 và các alias W1 tương ứng.

### 3.1. Tổ chức dữ liệu

Workspace là phạm vi doanh nghiệp và billing. Team tổ chức nhân sự. Project là phạm vi tập hợp công việc và kiểm soát truy cập mới. Giai đoạn này mỗi project có **một board**; không thêm mô hình nhiều board/project chưa cần thiết.

Mỗi task thuộc một project; checklist, comment, file, activity, nhãn và các liên kết task phải truy cập qua quyền của task/project. Dữ liệu cũ trong phạm vi chung và từng team được backfill vào project mặc định tương ứng, kể cả scope rỗng. Giữ ID task và toàn bộ quan hệ; cột trùng tên không bị gộp vì trùng nhãn.

Client cũ thiếu `projectId` tạo task vào project mặc định của phạm vi cũ. Sửa task hiện hữu không tự chuyển project. Endpoint cũ phải dùng ACL mới, không mở lại private project qua đường tương thích.

### 3.2. Chế độ truy cập

| Chế độ | Ai được truy cập | Điều cần hiển thị và kiểm tra |
|---|---|---|
| Kế thừa workspace | Nhân sự nội bộ có quyền workspace tương ứng | Guest không được quyền chung chỉ vì có membership để tính ghế |
| Kế thừa team | Thành viên team hợp lệ và quyền quản trị workspace | Rời team mất quyền kế thừa; kiểm tra lại các job và cache |
| Riêng tư | Thành viên được thêm trực tiếp; owner/admin workspace luôn có quyền | UI ghi rõ quyền owner/admin; không diễn đạt là chỉ người được mời mới thấy |
| Có khách ngoài | Guest được thêm trực tiếp vào project với viewer/commenter/editor | Chia sẻ project không chia sẻ toàn bộ doanh nghiệp |

Quyền quản trị **SaaS/platform** không tự cấp quyền đọc task, khách hàng, file hoặc dữ liệu doanh nghiệp. Quyền nghiệp vụ cần membership hợp lệ độc lập.

### 3.3. Vai trò

| Vai trò | Quyền nghiệp vụ | Giới hạn |
|---|---|---|
| Owner/admin workspace | Truy cập project trong workspace, quản lý thành viên/gói theo quyền workspace hiện hữu | Không vượt sang workspace khác; quản trị SaaS không tương đương vai trò này |
| Project manager | Quản lý project/cột và thành viên nội bộ đã thuộc workspace hợp lệ; làm việc với task | Không tự mời tài khoản mới để tiêu thụ ghế, đổi billing hoặc cấu hình workspace ngoài quyền |
| Editor nội bộ | Tạo/sửa task, checklist, nhãn và thao tác xóa mềm nội bộ theo quyền hiện hữu | Không tự quản lý membership hoặc nâng quyền |
| Commenter | Đọc, bình luận và phản hồi nhắc của chính mình khi là người nhận hợp lệ | Không sửa nội dung task, deadline, trạng thái hoặc phản hồi người khác |
| Viewer | Đọc và tải tệp được chia sẻ | Không comment, ack, checklist hoặc mutation khác |
| Guest editor | Tạo/sửa task và nội dung cộng tác được cấp trong project | Không xóa task, move cross-project, mời thành viên, quản lý integration/automation/workspace |
| Guest commenter/viewer | Quyền commenter/viewer giới hạn vào project được mời | Không có guest manager hoặc quyền danh bạ/CRM/tài chính/dịch vụ/billing toàn workspace |

Member picker, mention và gán việc chỉ trả người hợp lệ trong phạm vi; server không nhận ID ngoài quyền dù client biết ID. Thông tin khách hàng/dịch vụ gắn với task chỉ hiển thị những trường an toàn mà người xem được phép đọc; quyền đọc task không cấp quyền đọc tiền, credential hoặc toàn bộ CRM.

### 3.4. Copy, move, archive và restore

Copy phải kiểm tra quyền đọc nguồn và tạo ở đích, tạo ID mới cho cây dữ liệu được sao chép, kiểm tra assignee, nhãn/custom field, khách hàng và dependency tại đích. Không sao chép receipt, lịch sử delivery hoặc quyền bí mật vào đối tượng mới.

Move phải kiểm tra cả nguồn/đích, assignee, field và quan hệ phụ thuộc; không âm thầm giữ liên kết vượt project không hợp lệ. Sau move/đổi quyền, các projection, reminder và job cũ phải kiểm tra lại scope. Guest không được move cross-project.

Archive/xóa mềm giữ lịch sử và phục hồi theo quyền hiện tại. Trash, restore, file đã xóa mềm và export cũng phải dùng ACL; quyền trước khi xóa không bảo đảm quyền hiện nay.

## 4. FR-PLAN — Gói tính năng, ghế và hạ gói

**Task:** W1-T02, W1-T05. **Nghiệm thu:** TC-FND-041–052, TC-W1-T05-E và TC-X10.

| Gói | Giá/tháng và ghế hiện hữu | Tính năng mục tiêu bổ sung |
|---|---|---|
| Starter | 199.000đ; 3 ghế | Dự án cơ bản, planner cá nhân, Android offline, CSV/Trello, Google Calendar, báo cáo vận hành |
| Team | 499.000đ; 10 ghế | Starter và private project, custom fields, dependencies/timeline/templates, time tracking, lịch làm/delegate, automation nâng cao |
| Business | 999.000đ; 50 ghế | Team và guest, Zalo OA, public API/webhook, SLA/portfolio/capacity |

Giữ chức năng baseline đã cam kết; không dùng spec này để rút tính năng đang bán hoặc thay quota AI/storage/automation. Gói tùy chỉnh tiếp tục dùng catalog và entitlement có mã ổn định. Bảng trên không tự cấp thêm quota gửi provider, AI hay lưu trữ.

Một user có quyền truy cập workspace tính **một ghế**, dù tham gia nhiều project; guest cũng vậy. Invitation còn hiệu lực giữ ghế trước khi accept; accept không cộng thêm lần hai. Hết hạn hoặc revoke lời mời giải phóng reservation đúng một lần. Chuyển guest ↔ nội bộ không nhân số ghế.

Invite, accept, thay đổi membership và checkout/hạ gói dùng cùng kiểm tra ghế nguyên tử. Khi nhiều thao tác tranh ghế cuối, không cho tổng ghế đã dùng và giữ chỗ vượt limit. Workspace vượt limit gói đích phải xử lý membership/invitation trước checkout; hệ thống không tự đuổi người để khớp gói.

Hạ gói không xóa dữ liệu hoặc biến private project thành công khai. Người còn quyền được đọc/export dữ liệu hiện có; premium write/sender bị dừng tại backend. Private project mất entitlement trở thành chỉ đọc theo phạm vi bị khóa. Guest hiện hữu chỉ đọc và vẫn tính ghế; không mời mới hoặc tăng quyền. Worker, API token và integration phải dùng entitlement hiện tại, không tin snapshot cũ.

## 5. FR-TASK — Vòng đời task, giao việc và nhắc

**Task:** W1-T07–T10; W0-T03; liên quan W3-T06 và W4-T05.

### 5.1. Task và recurrence

Task gồm tiêu đề, mô tả, ưu tiên, lifecycle, cột, người chính/người phối hợp, deadline có giờ hoặc không hạn, checklist, nhãn, liên kết được phép và kế hoạch cá nhân riêng. Custom columns vẫn ánh xạ vào lifecycle `todo`/`doing`/`done`; đổi tên/cột không tạo lifecycle tùy ý làm hỏng báo cáo và recurrence.

Bảo toàn recurrence ngày/tuần/tháng/năm, khoảng lặp, ngày trong tuần và cơ sở từ deadline hoặc ngày hoàn thành theo hành vi đã có. Kỳ tiếp theo được sinh khi hoàn thành occurrence hiện tại. Complete qua form, Kanban, automation, Android offline hoặc public API đều dùng một pipeline và chỉ sinh **một** successor dù retry/cạnh tranh. Không sinh trước cả chuỗi vô hạn và không dùng Google RRULE thay hệ thống này.

Task không có deadline không được tự đặt deadline hay sinh nhắc hạn giả. Ngày dự định làm và thời lượng cá nhân không phải deadline chung. Validation/revision lỗi phải giữ draft, không đánh dấu task đã hoàn thành chỉ vì client optimistic update.

### 5.2. Giao việc, ack và snooze

Người chính và người phối hợp đều nằm trong phạm vi giao việc; báo cáo phân biệt một task với nhiều lượt giao. Xác nhận đã nhận việc và hoãn nhắc là phản hồi của người nhận trong chu kỳ hiện tại; không tương đương hoàn thành và không sửa phản hồi của người khác.

Ghi typed event cho create, lifecycle, assignment/unassignment, đổi deadline, ack, snooze và các thay đổi nghiệp vụ được chọn. Event gồm actor, nguồn, thời gian server và dữ liệu cần tái dựng chu kỳ. Đổi deadline/giao lại phải giữ chu kỳ cũ và cập nhật chu kỳ phản hồi theo quy tắc chung; đổi nhãn hoặc thứ tự collaborator không tự reset ack.

History chỉ phản ánh sự kiện có bằng chứng. Dữ liệu trước rollout thiếu typed event phải ghi “chưa xác định”, không dựng ack hoặc SLA từ trạng thái hiện tại.

### 5.3. Độ tin cậy mutation và delivery

Revision tổng hợp của task thay đổi khi các child quan trọng thay đổi; kế hoạch cá nhân có revision riêng theo `(task, user)`. Hai client sửa cùng revision phải tạo conflict thay vì mất chỉnh sửa; người dùng được giữ bản nhập để đối chiếu.

Mỗi operation có ID và payload ổn định sau khi gửi. Task, event, receipt, recurrence và job liên quan commit nguyên tử. Retry cùng ID/payload trả kết quả đã ghi nếu người gọi còn quyền; cùng ID/payload khác bị từ chối. Receipt không mở đường đọc dữ liệu sau thu hồi quyền.

Outbox bền vững, có claim/retry/lease và kiểm tra lại quyền, task, assignment, kỳ và entitlement trước gửi. Giữ mô hình một worker triển khai trước mắt; các guard vẫn phải chịu overlap/restart. Provider timeout sau khi có thể đã nhận tạo trạng thái “chưa rõ”, cần đối soát; không hứa exactly-once end-to-end khi provider không hỗ trợ.

## 6. FR-SERVICE — Khách hàng, vận hành và gia hạn

**Task:** W2-T01–T05. **Nghiệm thu:** [W2](test-cases/02-business-projects-automation.md).

### 6.1. Dashboard vận hành

Dashboard trả danh sách phân trang cho task quá hạn, lượt chưa xác nhận, task đang hoãn, tiến độ và các nhóm vận hành có dữ liệu. Filter project/team/người được giao/trạng thái và khoảng ngày dùng cùng ACL cho tổng lẫn chi tiết. Không nhân task bởi join nhiều người; nhãn thống kê ghi rõ “task” hay “lượt giao”.

Drill-down tới danh sách giữ filter. Ack/done/đổi deadline trên thiết bị khác phải được phản ánh qua refresh/invalidation; không đếm đồng thời trạng thái trước và sau. Người thiếu quyền CRM/tài chính không được xem số tiền chỉ vì có task liên kết.

Fixture nghiệm thu bắt buộc: 5 task, 6 lượt giao, 2 task quá hạn, 2 lượt chưa xác nhận và 1 task hoãn. Các nhóm có thể giao nhau; không bắt tổng mọi widget bằng số task.

### 6.2. Chính sách nhắc gia hạn

Dịch vụ có chu kỳ, ngày neo, kỳ hiện tại, mốc hết hạn, bật/tắt theo dõi, chính sách mốc/hằng ngày và giờ nhắc. Dữ liệu cũ giữ hành vi đã có; dịch vụ mới mặc định **09:00 giờ Việt Nam**. Chính sách hiển thị được trước khi lưu.

Dedup theo dịch vụ/kỳ/mốc hoặc ngày nghiệp vụ/người/kênh tương ứng. Tick lại hoặc restart không tạo logical reminder mới. Đổi kỳ/ngày, archive hoặc tắt theo dõi làm job cũ hết hiệu lực ngay khi worker kiểm tra lại.

**Mặc định đề xuất cho downtime:** chỉ xử lý mốc mới nhất còn hợp lệ của kỳ hiện tại; chế độ hằng ngày không gửi bù từng ngày lịch sử. Lịch sử cần cho biết job được gửi, bỏ qua hoặc xử lý catch-up vì lý do gì.

### 6.3. Giao dịch gia hạn

Người có quyền có thể tạo việc cần gia hạn cho kỳ hiện tại trước khi gia hạn thực tế. Một kỳ dịch vụ chỉ có một liên kết task gia hạn chính; thao tác lặp hoặc hai thiết bị cạnh tranh trả lại task đã có, không sinh nhiều việc cho cùng kỳ. Task giữ liên kết tới dịch vụ trong phạm vi quyền, người phụ trách hợp lệ và ngày đến hạn tương ứng; không đưa credential/thu–chi vào phần chia sẻ cho guest. Hoàn thành task không tự gia hạn dịch vụ hoặc ghi khoản chi: thao tác gia hạn phải được thực hiện qua luồng nghiệp vụ dưới đây.

Luồng: mở dịch vụ → xem kỳ/ngày mới dự kiến → chọn tạo công việc liên quan theo cấu hình → tùy chọn ghi khoản chi → kiểm tra dữ liệu → xác nhận một giao dịch. **Ghi chi mặc định tắt. Gia hạn không đồng nghĩa đã thanh toán.** Người bật ghi chi phải có quyền tài chính; giá trị, loại giao dịch và liên kết kỳ được xác thực server.

Kỳ mới, lịch sử gia hạn, task liên quan, khoản chi tùy chọn, event/receipt/outbox phải cùng commit hoặc rollback. Retry response bị mất không nhân kỳ/task/expense; hai thiết bị cùng gia hạn cùng revision chỉ có một thay đổi hợp lệ. Lỗi giữ dữ liệu nhập để người dùng xử lý, không tự tiến thêm kỳ.

Tính chu kỳ giữ anchor qua tháng ngắn/năm nhuận: anchor ngày 31 có thể thành 28/2 rồi trở lại 31/3. Ngày/tiền sai, số không an toàn hoặc một dòng bulk không hợp lệ không được ghi một phần.

Android có danh sách dịch vụ, chi tiết, lịch sử chăm sóc và gia hạn tương đương Web. Gia hạn, thu–chi và thao tác tài chính chỉ online; không nhập nhằng với queue task offline.

## 7. FR-PM — Custom fields, views, dependencies, timeline và templates

**Task:** W3-T01–T06. **Nghiệm thu:** [W3](test-cases/02-business-projects-automation.md).

### 7.1. Custom fields

Các kiểu đầu tiên: text, number, date, single selection, multiple selection, checkbox. Field có ID ổn định, tên, kiểu, thứ tự và option ID theo project. Phân biệt `0`, `false`, rỗng và null; không ép mọi giá trị thành chuỗi. Filter, sort và export dùng kiểu thực; ngày field dạng date không tự biến thành deadline có giờ.

Đổi tên/thứ tự không làm mất giá trị. **Mặc định đề xuất:** field đã có dữ liệu không đổi kiểu trực tiếp; retire field/option giữ dữ liệu cũ để đọc/export, chặn chọn mới. Gói không còn quyền premium vẫn đọc giá trị theo ACL nhưng không ghi premium. Input sai kiểu hoặc option ngoài project bị từ chối nguyên tử.

### 7.2. Views

Kanban/list/calendar dùng cùng tập task được phép và cùng ngữ nghĩa filter. Calendar chỉ biểu diễn đối tượng có ngày phù hợp; task không ngày vẫn thấy ở list/Inbox và không được gán ngày giả. Có saved view cá nhân và dùng chung project; chia sẻ view không chia sẻ thêm task.

Saved view lưu điều kiện và thứ tự cần thiết, không giữ bản snapshot dữ liệu vượt ACL. Khi field/member bị retire hoặc mất quyền, hiển thị điều kiện không còn hợp lệ; không âm thầm dùng cache cũ hoặc đổi filter thành “tất cả”.

### 7.3. Dependencies và timeline

V1 chỉ có finish-to-start trong cùng project. Graph phải là DAG, chặn self-link, cycle, cạnh trùng và cạnh khác project; kiểm tra chịu được hai request cạnh tranh. Blocking là cảnh báo và quan hệ hiển thị, không tự cấm hoàn thành hoặc tự dời ngày.

**Mặc định đề xuất:** archive/xóa mềm không là hoàn thành; giữ cạnh để restore. Chặn move trước khi người dùng giải quyết các cạnh sẽ vượt project. Reopen tiền nhiệm làm trạng thái cảnh báo được tính lại.

Timeline sử dụng ngày bắt đầu và deadline chung. Start không được sau deadline. Chỉnh timeline dùng revision/ACL chung, không dời các task phụ thuộc tự động hoặc kế hoạch cá nhân. Task thiếu ngày hiển thị tình trạng chưa đủ lịch thay vì suy đoán ngày.

### 7.4. Project templates

Template gồm cấu trúc project/board, task/checklist, field và dependency hợp lệ, ngày tương đối theo mốc bắt đầu do người dùng chọn. Áp dụng tạo ID mới và remap toàn bộ quan hệ nội bộ; không sao chép lịch sử thực thi hoặc receipt.

Preview nêu người phụ trách/khách hàng/field không còn hợp lệ và yêu cầu mapping trước commit; không tự tạo user hoặc gán dữ liệu ngoài quyền. Áp dụng là giao dịch idempotent: không để project nửa chừng hoặc hai instance vì retry. Tính ngày tương đối phải đúng qua tháng, năm và ngày nhuận.

## 8. FR-PERSONAL — Planner cá nhân và nhập nhanh

**Task:** W4-T01; liên quan W7-T02. **Nghiệm thu:** [W4](test-cases/03-offline-imports-integrations.md).

Inbox, Today, Upcoming và Week là các cách nhìn vào cùng task/kế hoạch cá nhân. Người dùng lên lịch ngày làm, thời điểm và thời lượng cho mình mà không đổi deadline chung hoặc kế hoạch người khác. Một task có thể có nhiều người được giao với kế hoạch riêng độc lập.

Task chưa có deadline vẫn có thể lên kế hoạch; bỏ kế hoạch đưa task về cách nhìn phù hợp mà không xóa task. Mốc hết lịch hẹn lúc đúng nửa đêm được xử lý theo end-exclusive, không chiếm thêm ngày kế tiếp.

Nhập nhanh tiếng Việt phải có preview cho các giá trị suy ra trước khi lưu. Ngày/giờ mơ hồ hoặc không hợp lệ yêu cầu sửa/chọn rõ, không âm thầm chọn giữa các cách hiểu. Không cần AI bắt buộc cho nhập task cơ bản; các tính năng AI hiện hữu vẫn theo quyền và quota đã có.

## 9. FR-OFFLINE — Android tạo/sửa offline bền vững

**Task:** W4-T02–T05; phụ thuộc nền tảng revision/idempotency. **Nghiệm thu:** [W4](test-cases/03-offline-imports-integrations.md), TC-X01/X08/X09.

### 9.1. Phạm vi thao tác

| Được queue offline | Chỉ draft hoặc cần online |
|---|---|
| Tạo task trong project còn quyền đã kiểm chứng | Comment chỉ lưu bản nháp, chưa gửi |
| Sửa tiêu đề, mô tả, ưu tiên, deadline, trạng thái/cột trong cùng project | Xóa/move task, upload file và thay quyền cần online |
| Chọn assignee/nhãn từ tập hợp cache còn hợp lệ | Gia hạn, tài chính, cấu hình tích hợp cần online |
| Checklist và kế hoạch cá nhân | Timer/time entry và thao tác ngoài phạm vi queue cần online |

### 9.2. Dữ liệu local và quyền

Dùng SQLCipher cho draft/outbox bền vững; tách khỏi read cache có thể xóa. Scope gồm origin, user và workspace, không cho đọc/gửi chéo tài khoản hoặc server. TTL quyền offline tối đa **24 giờ**, đồng thời không vượt thời hạn phiên; quyền ghi còn bị giới hạn bởi thời hạn write eligibility đã biết, gồm `currentPeriodEnd` của thuê bao. Gói hết hạn sớm hơn session phải khóa ghi, không tự xóa nháp. Lùi đồng hồ thiết bị không kéo dài TTL.

Khi hết TTL/phiên hoặc phát hiện mất quyền, UI ẩn nội dung bảo vệ và queue bị khóa/cách ly; không xóa nháp âm thầm. 401/423 hay workspace 403/404 có thể xóa read cache theo chính sách hiện hữu nhưng không được đồng thời xóa draft/outbox. Revocation khi thiết bị hoàn toàn offline được phát hiện ở reconnect hoặc hết TTL; không hứa thu hồi tức thời khi không có kết nối.

### 9.3. Queue, conflict và vòng đời app

Mỗi resource có tối đa một operation đang gửi. Payload và operation ID không đổi sau send; chỉnh sửa tiếp theo giữ thành draft riêng tới khi ACK revision mới. Task tạm phải resolve ID server trước khi gửi mutation checklist/planner phụ thuộc. UI phân biệt đã lưu local, đang chờ gửi, đang đồng bộ, conflict, bị chặn và đã xác nhận server.

Server commit rồi mất response phải retry cùng operation ID và nhận receipt; không tạo task/recurrence thứ hai. Web thay đổi trong khi Android offline dẫn tới conflict khi revision không còn hợp lệ. Giữ cả bản local và bản server để người dùng chọn; chọn local là mutation mới trên revision hiện tại, không force overwrite bằng request cũ.

Đóng/mở app, restart, reboot và nâng APK không làm mất pending operations hoặc khóa giải mã. Không cam kết background sync khi force-stop; khi mở lại phải tiếp tục đúng trạng thái. Hết dung lượng/DB lỗi phải báo không lưu được, không báo “đã lưu” rồi mất nội dung.

Logout có pending cho lựa chọn: đồng bộ trước khi thoát nếu có mạng/quyền, giữ dữ liệu mã hóa và khóa theo tài khoản, hoặc xóa theo lựa chọn rõ của người dùng. Response tới muộn từ workspace/phiên cũ không được phục hồi cache hay gửi queue trong scope mới.

## 10. FR-WORK — Lịch làm việc và ủy quyền nhận nhắc

**Task:** W5-T01. **Nghiệm thu:** [W5](test-cases/02-business-projects-automation.md).

Lịch làm việc là tính năng opt-in. Mặc định cấu hình ban đầu thứ Hai–thứ Sáu, 09:00–12:00 và 13:00–18:00, có danh sách ngày nghỉ/override rõ ràng. Không tự bật cho dữ liệu cũ hoặc viết lại lịch sử.

Kết hợp lịch làm, ngày nghỉ và quiet hours để chọn thời điểm nhắc hợp lệ. Recurrence tương lai bị dời tới ngày làm tiếp theo vẫn giữ anchor; không drift vì liên tục cộng trên ngày đã dời. Các biên bắt đầu/kết thúc ca phải có định nghĩa và test thống nhất.

Delegate là ủy quyền nhận nhắc trong khoảng hiệu lực, không phải chuyển assignee, không thay người chịu trách nhiệm hoặc cấp ACL. Delegate phải đã có quyền đọc dữ liệu; worker kiểm tra lại trước gửi. Nếu một người đồng thời là assignee/lead/delegate, không gửi trùng cùng logical reminder.

## 11. FR-AUTO — Automation nâng cao

**Task:** W5-T02, W5-T06. **Nghiệm thu:** TC-W5-T02-A–G, TC-W5-T06-A–C.

Tái sử dụng engine hiện có; bổ sung sửa/duplicate rule, typed event triggers, scheduled triggers và điều kiện sử dụng field được hỗ trợ. UI hiển thị trigger, điều kiện, danh sách action, trạng thái bật/tắt và kết quả chạy có lý do.

Một rule tối đa **10 actions**. Actions trong một lượt chạy phải thành công cùng nhau hoặc rollback; delivery ngoài DB được xếp outbox sau commit, không gọi provider giữa transaction rồi giả rollback được tin đã gửi. Duplicate rule tạo rule độc lập, không dùng chung ID hay lịch sử.

Trigger/run có durable dedup để tick/restart/retry không lặp tác dụng phụ. Causation guard ngăn vòng rule kích hoạt lẫn nhau. Bật lại rule hoặc import lịch sử không replay toàn bộ event cũ.

**Mặc định đề xuất:** rule thực thi bằng quyền hiện tại của chủ rule; chủ mất quyền, assignee không còn hợp lệ hoặc entitlement không đủ thì skip/fail có lý do. Không dùng quyền hệ thống để vượt ACL. Automation baseline đã bán được bảo toàn; phần nâng cao thuộc Team theo entitlement có mã, không dựa tên gói.

## 12. FR-TIME — Thời gian, capacity và portfolio

**Task:** W5-T03, W5-T04. **Nghiệm thu:** TC-W5-T03-A–F, TC-W5-T04-A–E.

Time tracking có nhập tay và start/stop timer. Một user chỉ có một timer active trong mỗi workspace, kể cả hai thiết bị cạnh tranh. Stop/retry không nhân time entry; actual time độc lập với planned duration. Không queue thao tác timer/time entry offline trong phiên đầu.

**Mặc định đề xuất:** lưu duration bằng giây nguyên, tổng hợp rồi định dạng; người dùng sửa entry của mình. Mất quyền ghi hoặc task bị xóa mềm đóng timer tại thời điểm server xử lý thay đổi, giữ lịch sử. Không nhận duration âm, không hợp lệ hoặc end trước start.

Ước lượng công việc theo từng assignee: giao hai người không tự chia đôi estimate. Không có estimate là **unknown**, không là 0. Capacity kết hợp lịch làm/ngày nghỉ, estimate theo người và kỳ xem. Đổi người/tuần chỉ chuyển tải một lần; actual vs planned phải có nhãn rõ, không trộn hai thước đo.

Portfolio tổng hợp nhiều project trong phạm vi người xem. Project ngoài quyền không xuất hiện trong tổng, biểu đồ, tooltip, export hoặc count. Độ mới của dữ liệu, trường thiếu estimate và mẫu số chưa đủ thông tin được thể hiện; không đánh giá “rảnh” từ dữ liệu unknown.

## 13. FR-SLA — Lịch sử trách nhiệm và báo cáo SLA

**Task:** W5-T05, W5-T06; phụ thuộc typed events W1-T07 và dashboard W2-T01.

SLA dựa trên structured events từ rollout: lúc giao, thay người, đổi deadline, ack, snooze, hoàn thành và reopen. Giữ snapshot chu kỳ trước khi deadline/assignment đổi. Không suy lịch sử từ một hàng task hiện tại hoặc coi dữ liệu cũ thiếu event là đáp ứng SLA.

Phân biệt số task duy nhất, số lượt giao và số chu kỳ. Hiển thị wall time và working time với lịch làm áp dụng, không dùng hai số thay thế nhau. Ví dụ thứ Sáu 16:00 tới thứ Hai 10:00 là 66 giờ wall time và 3 giờ working time với lịch mặc định, chưa có ngày nghỉ.

**Mặc định đề xuất:** tỷ lệ hoàn thành đúng hạn tính trên chu kỳ đã hoàn thành và có deadline snapshot; task không deadline không vào mẫu số đúng hạn. Reopen mở chu kỳ mới nhưng không xóa lần hoàn thành trước. Mẫu số bằng 0 hiển thị chưa có dữ liệu, không 0%/100% giả.

Filter và export phải đối soát được với event nguồn trong quyền hiện tại. Dashboard cache cũ cần ghi độ mới; API lỗi không được trình bày cached report như vừa tính xong. Báo cáo SLA thuộc Business; dữ liệu/history đã có vẫn được bảo toàn khi mất entitlement.

## 14. FR-INTEGRATION — Hành vi người dùng ở các tích hợp

**Chi tiết hợp đồng, scope, mapping và failure:** [04-integrations.md](04-integrations.md). Mục này giữ ý nghĩa nghiệp vụ mà UI phải thể hiện.

| Tích hợp / task | Luồng và kết quả bắt buộc |
|---|---|
| CSV/Trello — W6-T01–T05 | Chọn nguồn → mapping → preview imported/skipped/errors → commit nguyên tử và idempotent. Preview không ghi hoặc gửi. Không tự tạo user; import lịch sử không phát lại thông báo/automation; JSON v1 giữ append |
| Google Calendar — W7-T01–T05 | Consent riêng Google login; lịch do app tạo theo user/workspace; xem và chỉnh thời gian hai chiều theo quyền. Personal plan không đổi deadline; deadline chung đổi qua business pipeline. Delete event không xóa task; renewal projection không cho gia hạn/thanh toán từ Google |
| Zalo OA — W8-T01–T04 | Doanh nghiệp kết nối OA của mình → chọn template đúng mục đích/người nhận đủ điều kiện → preview → gửi/đối soát/lịch sử. Phân biệt nội bộ, giao dịch, chăm sóc và quảng bá; Business guard tại cấu hình và worker |
| Public API/webhooks — W9-T01–T04 | Token có scope, thu hồi được, hiệu lực giao ACL creator và entitlement; API dùng cùng nghiệp vụ Web/Android. Webhook ký, có event ID/version, retry và recheck quyền; consumer phải dedupe vì at-least-once |

Đăng nhập Google không tự cấp Calendar consent. Calendar scope app-created không đọc tất cả lịch khác hoặc free/busy toàn tài khoản. Google Tasks hiển thị trong Google Calendar không có nghĩa Calendar API đọc/ghi được Tasks.

Google Tasks connector, deadline date-only và booking còn ở discovery. Đặc biệt trường `due` của Google Tasks là ngày được lịch hóa theo giới hạn API đã nghiên cứu, không được ánh xạ mặc nhiên thành deadline chung có giờ của Nhắc Tôi. Không đưa connector chưa chốt vào quảng cáo hoặc gate bắt buộc W0–W9.

## 15. FR-UX — Tính nhất quán Web/Android và khả năng truy cập

Các chức năng lõi trong từng wave phải có luồng dùng được trên cả Web và Android; không coi API có sẵn là đã đạt mobile parity. Android cần form, list/detail, error/conflict và permission states theo chức năng, không chỉ read-only shell.

Web hỗ trợ bàn phím/focus của modal, nhãn field và thông báo lỗi có thể đọc bằng screen reader. Android hỗ trợ TalkBack, cỡ chữ lớn, vùng chạm phù hợp; không truyền trạng thái chỉ bằng màu. Chuỗi tiếng Việt, tiêu đề/mô tả dài và màn hình nhỏ không làm nút lưu/xử lý lỗi biến mất.

Mọi thay đổi quyền/gói/phiên phải có hiệu lực ở thao tác tiếp theo; UI không dựa vào capability cũ để khẳng định thao tác sẽ thành công. Response stale sau đổi workspace/đăng xuất không được phục hồi dữ liệu. Offline/pending/conflict/unknown delivery là trạng thái riêng, không gộp thành “thất bại” hoặc “đã xong”.

File và rich text phải render như dữ liệu, không thực thi script/URL nguy hiểm. Download/upload kiểm tra quyền thực, filename/path/MIME/kích thước theo chính sách hiện có; danh tính nguồn không miễn kiểm tra. CSV export chống formula injection khi người nhận mở spreadsheet.

## 16. Điều kiện hoàn thành chức năng và truy vết

Một chức năng chỉ hoàn thành khi backend, Web/Android thuộc phạm vi, migration/compatibility và error states được triển khai, có test phù hợp và bằng chứng đủ cho gate. Không dùng số test pass hoặc độ phủ dòng thay cho ma trận quyền/luồng nghiệp vụ.

| Nhóm yêu cầu | Task chính | Test chi tiết |
|---|---|---|
| FR-BASE | W0-T02–T04 | [Foundation](test-cases/01-foundation.md) |
| FR-PROJECT, FR-PLAN | W1-T02–T06 | [Foundation](test-cases/01-foundation.md) |
| FR-TASK | W1-T07–T11 | [Foundation](test-cases/01-foundation.md), recurrence gates W3/W4 |
| FR-SERVICE | W2-T01–T05 | [Business](test-cases/02-business-projects-automation.md) |
| FR-PM | W3-T01–T06 | [Business](test-cases/02-business-projects-automation.md) |
| FR-PERSONAL, FR-OFFLINE | W4-T01–T05 | [Offline/integrations](test-cases/03-offline-imports-integrations.md) |
| FR-WORK, FR-AUTO, FR-TIME, FR-SLA | W5-T01–T06 | [Business](test-cases/02-business-projects-automation.md) |
| FR-INTEGRATION | W6-T01–T05, W7-T01–T05, W8-T01–T04, W9-T01–T04 | [Offline/integrations](test-cases/03-offline-imports-integrations.md) |
| FR-UX và luồng kết hợp | Mọi task UI; W9-T05 | [Cross-cutting/release](test-cases/04-cross-cutting-and-release.md) |

Mọi kết quả chạy mới bắt đầu `NOT RUN`; provider/thiết bị chưa sẵn sàng ghi `BLOCKED`, không `PASS`. Kiểm tra component/source không thay browser hoặc thiết bị thật. Gate Google/OA thật chưa đạt chỉ chặn phần phát hành tích hợp tương ứng; các wave nội bộ độc lập được nghiệm thu theo dependency trong [08-waves.md](08-waves.md).
