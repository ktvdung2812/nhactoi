# Sản phẩm, đối thủ và lý do lựa chọn Nhắc Tôi

Ngày chốt bản mô tả: 16/10/2026. Đây là phân tích sản phẩm và định hướng phát triển; tính năng đích không đồng nghĩa đã có trong ứng dụng. Đối chiếu hiện trạng tại [baseline](02-baseline-and-decisions.md), hành vi đích tại [functional spec](03-functional-spec.md), triển khai tại [tasks](07-tasks.md).

## 1. Vấn đề cần giải quyết

Nhắc Tôi phục vụ doanh nghiệp nhỏ cung cấp dịch vụ, agency và đội vận hành: một yêu cầu của khách thường liên quan người phụ trách, nhiều việc phải làm, lịch hẹn, hợp đồng/dịch vụ đến kỳ và tiền. Vấn đề không kết thúc ở việc đưa một dòng vào lịch. Người quản lý còn cần biết ai đã nhận việc, ai đang hoãn, việc nào quá hạn, khách nào chưa được chăm sóc và kỳ nào chưa được xử lý.

Luồng giá trị trung tâm là **khách hàng/dịch vụ → công việc → giao người → nhắc → xác nhận/hoãn → hoàn thành/gia hạn → bằng chứng và báo cáo**. Google Calendar tiếp tục là nơi xem lịch quen thuộc; Nhắc Tôi quản lý trách nhiệm và trạng thái nghiệp vụ. Tiếng Việt và tích hợp Zalo giúp tiếp cận thị trường, nhưng bản thân ngôn ngữ hoặc thêm một kênh nhắc chưa đủ tạo lợi thế bền vững.

Thứ tự khách hàng ưu tiên đã chốt: (1) SME dịch vụ/agency, (2) đội quản lý dự án cần khả năng gần Trello/monday, (3) cá nhân/freelancer. Không cố phục vụ mọi phân khúc bằng cùng một màn hình quản lý phức tạp ngay từ đầu.

## 2. Người dùng và công việc cần hoàn thành

| Nhóm | Tình huống thực tế | Kết quả họ cần | Phần Nhắc Tôi phải chứng minh |
|---|---|---|---|
| Chủ doanh nghiệp/điều phối | Sáng phải hỏi nhiều người về các việc còn treo | Biết việc quá hạn, chưa nhận, đang hoãn; truy được người và khách liên quan | Dashboard đáng tin, quyền rõ, không nhân số task theo số người được giao |
| Nhân viên kỹ thuật/dịch vụ | Nhận việc khi đang ở hiện trường, mạng chập chờn | Nhập/sửa việc, checklist, kế hoạch ngay; không mất nội dung | Android offline có queue bền vững, conflict rõ và sync không tạo bản sao |
| CSKH/vận hành gia hạn | Theo dõi phần mềm, bảo trì và hợp đồng | Không bỏ kỳ, giữ lịch sử chăm sóc, tạo việc và thông báo đúng người | Chính sách nhắc theo kỳ, task gia hạn và lịch sử; gia hạn không tự thành thanh toán |
| Quản lý dự án | Điều phối nhiều đầu việc, người và thời hạn | Kanban/list/calendar, dependency, timeline, mẫu và capacity | Dữ liệu nhất quán giữa views, không tự dời hạn hoặc phỏng đoán effort |
| Khách hàng/đối tác | Cần trao đổi trên một dự án cụ thể | Xem/bình luận/sửa phần được cấp mà không thấy nội bộ | Guest ACL, private project và giới hạn CRM/tài chính thực sự ở server |
| Cá nhân/freelancer | Có Google Tasks và Calendar nhưng nhiều cam kết với khách | Tách hạn cam kết khỏi lịch mình dự định làm; kiểm soát công việc dịch vụ | Planner gọn, Calendar dùng chung thói quen; có giá trị vượt một danh sách việc |

## 3. So sánh năng lực sản phẩm

Ma trận so sánh năng lực phổ biến của các sản phẩm, không phải cam kết mọi gói đều có cùng tính năng. Mức gói, quota và rollout phải đối chiếu nguồn chính thức khi chào bán; không cố định giá đối thủ trong spec này.

| Nhu cầu | Trello | monday work management | Google Calendar | Google Tasks | Nhắc Tôi: hiện trạng → đích |
|---|---|---|---|---|---|
| Tổ chức công việc | Board/list/card, checklist, nhãn, thành viên; hệ sinh thái Power-Ups | Board/item, cột dữ liệu, nhiều view và workflow | Event, lịch chia sẻ, người dự, nhắc lịch | Danh sách, task/subtask, đánh dấu hoàn thành và tác vụ cá nhân | Task/team/board đã có → project độc lập, view và ACL dự án |
| Lập lịch | Ngày, calendar/timeline và planner tùy gói/sản phẩm | Calendar/timeline, phụ thuộc và tự động hóa tùy gói | Mạnh về lịch hẹn, lịch lặp, thời gian bận, tổ chức họp | Tác vụ có lịch, nhắc/lặp và hiển thị trong hệ sinh thái Google; UI không đồng nhất với API | Planner cá nhân tách deadline đã có → hai chiều qua Calendar và Android planner đầy đủ |
| Trách nhiệm công việc | Thành viên, comment, checklist; có thể tùy biến workflow | Assignee, status, automation, báo cáo quản lý | Phản hồi lời mời là phản hồi tham dự; không tương đương xác nhận nhận việc | Một số ngữ cảnh Workspace hỗ trợ giao việc từ Docs/Chat; không nên nói Tasks hoàn toàn không có giao việc | Giao nhiều người, ack/snooze, nhắc theo trạng thái → sự kiện có cấu trúc và SLA theo chu kỳ |
| Dự án nâng cao | Custom fields, templates, views, automation phụ thuộc gói | Custom columns, dependencies, dashboards, workload/time tracking phụ thuộc gói | Không phải hệ quản lý dự án với ACL và dependency cho task nghiệp vụ | Không thay thế bộ quản lý dự án đa chiều | Nhãn/checklist/mẫu task đã có → custom fields, DAG, timeline, project templates |
| Dịch vụ và gia hạn | Có thể dựng bằng card, custom fields và automation | Có thể cấu hình board/workflow và tích hợp phù hợp | Có thể đặt event lặp/nhắc nhưng phải tự liên kết ngữ cảnh nghiệp vụ | Có thể tạo việc lặp, cần quy trình ngoài để quản lý kỳ/hợp đồng/tiền | Khách, dịch vụ, lịch sử gia hạn và thu–chi đã có → một luồng liên kết, tiền tùy chọn, báo cáo vận hành |
| Cộng tác bên ngoài | Guest/board permissions theo gói | Guest/shareable/private boards theo gói | Chia sẻ calendar và mời event theo quyền | Phụ thuộc bề mặt Workspace; không suy ra private project ACL từ task list | Chưa có mô hình guest dự án hoàn chỉnh → guest tính ghế và quyền theo project |
| Tự động hóa và mở rộng | Automation, Power-Ups, REST API/webhooks | Automation/integrations, API/webhooks | Calendar API hỗ trợ event, watch và incremental sync | Tasks API quản lý lists/tasks; khả năng hẹp hơn UI | Automation cơ bản + API nội bộ → typed/scheduled automation, API v1 và webhook Business |
| Kênh địa phương | Tích hợp qua bên thứ ba/cấu hình | Tích hợp qua bên thứ ba/cấu hình | Thông báo trong hệ sinh thái Google | Thông báo trong hệ sinh thái Google | Email/FCM/Web Push → thêm OA của từng doanh nghiệp, mẫu và người nhận hợp lệ |
| Offline Android | Phải kiểm tra phạm vi của ứng dụng theo phiên bản | Phải kiểm tra phạm vi của ứng dụng theo phiên bản | Có trải nghiệm offline tùy bề mặt; không suy ra khả năng đồng bộ mọi nghiệp vụ | Có ứng dụng riêng; không khẳng định kém hơn nếu chưa thử | Cache chỉ đọc có giới hạn đã có → tạo/sửa task offline bền vững, có xử lý conflict |

Không sử dụng ma trận này để tuyên bố Trello/monday không làm được quản lý dịch vụ: hai sản phẩm có thể cấu hình hoặc mở rộng. Cơ hội của Nhắc Tôi là giảm công cấu hình và công đối soát cho một luồng dịch vụ cụ thể, với tổng chi phí vận hành hợp lý.

## 4. Google Calendar: kiểm tra đúng phần sản phẩm và API

Calendar đã giải quyết tốt việc đặt lịch, nhắc trước sự kiện, lịch lặp, chia sẻ lịch, mời người tham gia và nhìn lịch theo ngày/tuần/tháng. Một số khả năng như lịch đặt hẹn, giờ làm việc/vị trí làm việc hay chức năng Workspace phụ thuộc tài khoản/gói. Nhắc Tôi không lấy việc “có lịch và có nhắc” làm lý do duy nhất để khách trả tiền.

Connector được chọn sử dụng một calendar ứng dụng tạo cho từng người/workspace, consent riêng với Google login. Scope `calendar.app.created` không đồng nghĩa được đọc mọi lịch của người dùng, free/busy bên ngoài hoặc quản lý Google Tasks. Google Calendar UI có hiển thị Tasks không làm Tasks thành Calendar events có thể CRUD bằng Calendar API.

Nhắc Tôi chỉ chiếu dữ liệu đã có mapping: kế hoạch cá nhân, deadline chung, lịch hẹn và mốc gia hạn. Mỗi loại có quyền sở hữu trường và quy tắc xóa riêng. Deadline chiếu bằng event 15 phút, trạng thái free, tắt reminder Google mặc định để tránh nhắc hai nơi; thay đổi giờ bắt đầu có quyền mới được cập nhật deadline chung. Chi tiết ở [spec tích hợp](04-integrations.md).

Booking và đọc lịch ngoài ứng dụng để tính rảnh/bận chưa thuộc connector đã chốt. Không đưa khả năng chỉ thấy trên Calendar UI thành cam kết có API công khai tương ứng.

## 5. Google Tasks: khác biệt UI và hợp đồng API

Tasks có danh sách việc, subtasks, trạng thái hoàn thành, ngày/giờ và lịch lặp trên các bề mặt Google phù hợp; tính năng UI như gắn sao, đặt thời lượng hoặc deadline có thể phụ thuộc rollout. Có thể tạo việc từ Gmail và giao việc trong một số ngữ cảnh Docs/Chat. Vì vậy không định vị Nhắc Tôi bằng tuyên bố tuyệt đối rằng Google “không có nhắc”, “không có lặp” hoặc “không giao việc được”.

Ngày 16/10/2026 đã GET trực tiếp [Tasks API discovery](https://tasks.googleapis.com/$discovery/rest?version=v1): HTTP 200, không bị cắt body, revision `20261013`. Hợp đồng trả về xác nhận:

- `due` là **ngày dự kiến làm/hiển thị trên lịch**, không phải deadline. API bỏ phần giờ khi ghi và không cho đọc/ghi giờ dự kiến qua trường này.
- `Task` có title, notes, status, parent/position, completed, deleted/hidden và thông tin liên kết; không có trường writable tương ứng deadline mới, start/end, duration, recurrence, starred hoặc đính kèm như một hệ thống task đầy đủ.
- Status chỉ có `needsAction` hoặc `completed`; không ánh xạ đầy đủ todo/doing/done, ack và snooze bằng cách đổi tên trường.
- `assignmentInfo` là output-only; không thể dùng nó để tự tạo cơ chế giao việc Nhắc Tôi sang mọi người dùng Google.
- Các methods gồm delete, move, clear, update, patch, insert, list, get; không có watch. List có `updatedMin`, phân trang, `showAssigned`, `showCompleted`, `showHidden`, `showDeleted`; không có syncToken kiểu Calendar.
- Muốn thấy task đã hoàn thành từ UI Google có thể phải lấy cả hidden; chỉ mặc định `showCompleted` không đủ. Không tự coi task không có trong một trang là đã bị xóa.

**Quyết định:** Google Tasks connector thuộc discovery D01, không nằm trong 58 task bắt buộc. Nếu nghiên cứu sau này, phải chọn rõ mapping một phần, polling/deletion/reconciliation và UX cảnh báo mất thông tin. Không hứa đồng bộ đầy đủ và không ghi Google `due` vào deadline Nhắc Tôi.

## 6. Khi khách hàng đã có Calendar và Tasks, vì sao chọn Nhắc Tôi?

Khách hàng phù hợp là người đã dùng Google nhưng vẫn phải nhắn hỏi tiến độ, đối chiếu danh sách khách/hợp đồng hoặc tự tạo nhiều nhắc cho cùng một kỳ dịch vụ. Lý do mua phải đo được ở công việc đó, không phải yêu cầu họ bỏ lịch đang dùng.

| Nỗi đau còn lại | Giá trị đề xuất | Bằng chứng cần tạo trong pilot |
|---|---|---|
| Đã nhắc nhưng không biết ai nhận | Xác nhận/hoãn theo người, nhắc theo chu kỳ và trạng thái thực | Giảm số lần hỏi lại; thời gian nhận việc đo bằng sự kiện |
| Kỳ gia hạn nằm rải rác trên sheet/lịch/chat | Hồ sơ dịch vụ, mốc nhắc, task và lịch sử gia hạn cùng một luồng | Tỷ lệ kỳ được xử lý, số kỳ bỏ sót, thời gian chuẩn bị báo cáo |
| Nhập lặp giữa công việc và lịch cá nhân | Giữ Calendar làm lịch quen thuộc; mapping hai chiều có chủ sở hữu rõ | Tỷ lệ sync thành công, conflict được xử lý, không có sự kiện trùng |
| Dùng điện thoại ở nơi mạng yếu | Tạo/sửa task offline, giữ bản nháp và giải quyết xung đột | Không mất draft; tỷ lệ queue được giải quyết; thời gian đồng bộ |
| Khách/đối tác cần xem một phần công việc | Guest theo project, không thấy CRM/thu–chi nội bộ | Người ngoài hoàn thành được luồng cộng tác, test rò dữ liệu đạt |
| Cần gửi thông báo trong kênh khách đang dùng | OA doanh nghiệp với template và người nhận hợp lệ | Tỷ lệ provider chấp nhận/giao theo bằng chứng; không đánh đồng đã đọc với ack |

Thông điệp sản phẩm đề xuất: **“Theo dõi việc của đội và kỳ dịch vụ của khách, biết ai đã nhận, còn gì chưa xong; vẫn dùng Google Calendar như thường.”** Đây là thông điệp cần kiểm chứng, không phải lời chứng thực khách hàng đã có.

Nếu khách chỉ cần danh sách việc cá nhân, nhắc ngày giờ và lịch họp, Google có thể đã đủ. Không buộc mua bằng cách khóa dữ liệu hay hạ thấp sản phẩm khác. Khách đang phụ thuộc nhiều vào portfolio/custom workflow của monday hoặc hệ Power-Ups sâu của Trello cần đánh giá khả năng chuyển đổi trước; import không có nghĩa tương đương toàn bộ sản phẩm nguồn.

## 7. Chiến lược tiếp nhận và phạm vi ưu tiên

1. Chọn một luồng dịch vụ lặp đang gây tốn công, nhập một tập nhỏ có preview và mapping.
2. Giao việc cho nhóm thật, dùng xác nhận/hoãn và báo cáo vận hành trước khi mở nhiều tùy biến.
3. Kết nối Calendar theo người có nhu cầu; thông báo rõ dữ liệu nào được đưa ra bên ngoài.
4. Mở Android offline, dự án riêng và guest khi đúng tình huống; chỉ bật Zalo khi OA/mẫu/người nhận đáp ứng điều kiện.
5. Đo giá trị và hành vi trả tiền thật trong pilot; ưu tiên lại roadmap dựa trên bằng chứng.

Không thêm AI agent tự hành, ERP/kế toán đầy đủ, marketplace, booking hay Google Tasks sync vào phạm vi chỉ để chạy theo bảng so sánh. AI và cấu hình hiện hữu được bảo toàn; mọi thay đổi quota/pricing cần quyết định riêng. [Roadmap và validation](06-roadmap-and-validation.md) mô tả thử nghiệm cụ thể.

## 8. Nguồn và giới hạn kiểm chứng

| Nguồn chính thức | Phần dùng để đối chiếu | Trạng thái bằng chứng |
|---|---|---|
| [Trello features](https://trello.com/tour), [pricing](https://trello.com/pricing), [Atlassian Trello support](https://support.atlassian.com/trello/) | Boards/cards/views/automation/Power-Ups và điều kiện gói | Nguồn tham chiếu; không thực hiện lại kiểm thử tài khoản trả phí trong đợt lưu spec |
| [monday work management](https://monday.com/work-management), [pricing](https://monday.com/pricing), [support](https://support.monday.com/hc/en-us) | Boards, custom columns, workflow, báo cáo và điều kiện gói | Nguồn tham chiếu; không dùng giá/quota chưa xác nhận làm cam kết |
| [Calendar Help](https://support.google.com/calendar/), [Tasks Help](https://support.google.com/tasks/) | Hành vi ứng dụng và điều kiện tài khoản/rollout | Cần kiểm tra lại bề mặt/gói khi viết tài liệu tiếp thị |
| [Calendar API](https://developers.google.com/workspace/calendar/api/guides/overview), [authorization](https://developers.google.com/workspace/calendar/api/auth), [sync](https://developers.google.com/workspace/calendar/api/guides/sync), [push](https://developers.google.com/workspace/calendar/api/guides/push) | Scope, event, incremental sync và notifications | Nguồn hợp đồng để triển khai W0-T05/W7; không chứng minh OAuth/provider gate đã đạt |
| [Tasks discovery](https://tasks.googleapis.com/$discovery/rest?version=v1), [Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks) | Trường dữ liệu và khả năng API | Discovery được kiểm tra trực tiếp ngày 16/10/2026, revision 20261013 |
| [Zalo Developers](https://developers.zalo.me/), [Zalo Cloud](https://zalo.cloud/), [Zalo OA](https://oa.zalo.me/) | OA, template, mục đích và điều kiện gửi | W0-T06 phải lưu phiên bản tài liệu/chính sách và kết quả readiness của OA thực tế |

Các nguồn bên ngoài có thể thay đổi. Khi một thay đổi ảnh hưởng mapping, quyền, điều kiện gửi hoặc tính khả thi, cập nhật decision log, task và expected test cùng nhau. Không tự chuyển một giới hạn API thành kết luận Google/Trello/monday không có chức năng tương ứng trên UI.
