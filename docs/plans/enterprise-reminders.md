# Nhắc việc nâng cao cho doanh nghiệp

Ngày đối chiếu: 26/09/2026.

Trạng thái cập nhật 27/09/2026: đã triển khai đợt đầu gồm nhắc nhiều mốc, báo trưởng nhóm, nhận việc/hoãn nhắc, chính sách team tối thiểu, email retry và push gia hạn. Hướng dẫn hiện hành ở [README](../../README.md#nhắc-nhiều-mốc-nhận-việc-và-hoãn-nhắc).

Phần đối chiếu bên dưới ghi lại hiện trạng **trước đợt triển khai** ngày 26/09, không dùng để kết luận tính năng hiện tại. Lịch lặp nâng cao, ủy quyền, chính sách ngày làm việc/kênh tùy chọn và báo cáo chuyên sâu vẫn chưa triển khai.

## Phạm vi

Chỉ tập trung vào nhắc việc cho cá nhân và team trong Nhắc tôi. Không mở rộng sang ERP, tài chính, nhân sự hoặc quản trị doanh nghiệp ngoài phạm vi nhắc việc.

Nhắc tôi đã có nền tảng nhắc việc và cộng tác theo team. Phần còn thiếu chủ yếu là quy tắc nhắc nâng cao và theo dõi phản hồi sau khi nhắc.

## Đối chiếu với dự án hiện tại

| Chức năng đề xuất | Dự án hiện có | Cần bổ sung |
| --- | --- | --- |
| Nhắc nhiều cấp | Mỗi công việc có một thời điểm nhắc; gửi cho người phụ trách và người được giao thêm. Có chống gửi trùng. | Nhiều mốc nhắc trước/sau hạn; nhắc tiếp khi chưa xử lý; tự báo trưởng nhóm theo điều kiện. |
| Xác nhận nhận việc | Có trạng thái Cần làm → Đang làm → Hoàn thành và đánh dấu thông báo đã đọc. | Nút **Đã nhận việc**, lưu người/thời điểm xác nhận; nhắc lại khi chưa xác nhận. Đọc thông báo chưa thể hiện việc đã được nhận. |
| Lịch lặp nâng cao | Có lặp ngày, tuần, tháng. Khi hoàn thành, tạo kỳ tiếp theo dựa trên hạn kỳ trước. | Lặp theo ngày làm việc, thứ/ngày cụ thể, xử lý ngày nghỉ; chọn tính kỳ tiếp theo từ lịch cố định hoặc thời điểm hoàn thành. |
| Ủy quyền khi vắng mặt | Có đổi người phụ trách và giao nhiều người. | Người thay thế theo khoảng thời gian; chuyển lời nhắc khi nghỉ phép; lịch sử bàn giao. |
| Chính sách nhắc theo team | Có phân quyền team. Chức năng cá nhân hóa cho phép admin kiểm soát tùy chỉnh giao diện. | Cấu hình riêng cho nhắc việc: giờ làm việc, giờ yên lặng, tần suất, kênh gửi và phạm vi thành viên được thay đổi. |
| Theo dõi hiệu quả nhắc | Có thống kê việc đang mở, đến hạn, quá hạn, hoàn thành; lịch sử thao tác và dữ liệu chống gửi nhắc trùng. | Danh sách chưa xác nhận, lịch sử từng lần nhắc/hoãn, thời gian phản hồi và báo cáo tình trạng gửi thông báo. |

## Những nền tảng có thể mở rộng

### Bộ xử lý nhắc việc

- Đã xử lý nhắc cho công việc và mục checklist có người được giao.
- Mỗi lịch nhắc chỉ tạo một thông báo cho từng người nhận nhờ khóa chống gửi trùng.
- Chưa tự nhắc lại liên tục hoặc chuyển cấp khi quá hạn.
- Máy chủ phải chạy để xử lý lịch nhắc.

Nguồn: [`processReminders` trong server/index.mjs](../../server/index.mjs), [schema `task_reminder_deliveries`](../../server/db.mjs).

### Công việc lặp

- Hỗ trợ ngày, tuần, tháng; tính lịch theo giờ Việt Nam.
- Hoàn thành kỳ hiện tại mới tạo kỳ tiếp theo, dựa trên hạn của kỳ trước.
- Lặp công việc và lặp thông báo nhắc là hai hành vi khác nhau; hiện có lặp công việc nhưng chưa có chính sách lặp nhắc khi chưa xử lý.

Nguồn: `nextRecurrence` và `applyTaskStatusTransition` trong [server/index.mjs](../../server/index.mjs).

### Tự động hóa

- Đã có sự kiện tạo việc, đổi trạng thái và chạy thủ công.
- Có hành động đổi trạng thái, ưu tiên, người phụ trách và thêm bình luận.
- Chưa có sự kiện theo thời gian như “quá hạn 2 giờ”.

Nguồn: [server/automations.mjs](../../server/automations.mjs).

### Kênh thông báo

- Thông báo trong ứng dụng được lưu trên máy chủ.
- Email nhắc việc hoạt động khi cấu hình SMTP.
- Đã có mã gửi push Android qua FCM, hàng đợi và cơ chế thử lại khi lỗi. Đây là thử lại việc gửi thông báo, không phải nhắc lại theo nghiệp vụ khi người dùng chưa xử lý.
- Push thực tế phụ thuộc cấu hình Firebase. Tài liệu hiện ghi chưa kiểm thử giao nhận push thật; không coi sự hiện diện của mã nguồn là bằng chứng kênh này đã vận hành thực tế.

Nguồn: [server/mobile.mjs](../../server/mobile.mjs), [hướng dẫn Android](../ANDROID.md).

### Chính sách team và dữ liệu theo dõi

- Có quyền theo workspace/team, lịch sử thao tác công việc và trạng thái đã đọc thông báo.
- Chính sách cá nhân hóa vừa bổ sung chỉ kiểm soát giao diện, chưa kiểm soát nhắc việc.
- Có thể tận dụng nền tảng phân quyền và lịch sử hiện có, nhưng cần dữ liệu nghiệp vụ riêng để phân biệt đã gửi, đã đọc, đã nhận việc, hoãn nhắc và hoàn thành.

Nguồn: [server/teams.mjs](../../server/teams.mjs), [server/task-details.mjs](../../server/task-details.mjs), [server/appearance.mjs](../../server/appearance.mjs), [src/App.jsx](../../src/App.jsx).

## Thứ tự triển khai đề xuất

1. **Chính sách nhắc theo team + nhiều mốc nhắc + báo trưởng nhóm khi quá hạn.** Admin cấu hình quy tắc chung và phạm vi thành viên được thay đổi; kết hợp giờ làm việc, giờ yên lặng và giới hạn tần suất để tránh nhắc quá nhiều.
2. **Xác nhận nhận việc + “Nhắc lại sau”.** Tách việc hoãn thông báo khỏi việc đổi hạn công việc; lưu lịch sử người thực hiện và thời điểm.
3. **Lịch lặp nâng cao.** Bổ sung ngày làm việc, lịch theo thứ/ngày cụ thể và cách tính kỳ tiếp theo.
4. **Ủy quyền và báo cáo chuyên sâu.** Bổ sung người thay thế theo thời gian và báo cáo dựa trên dữ liệu gửi nhắc, xác nhận, hoãn, hoàn thành.

### Tình huống mục tiêu cho đợt đầu

**Nhắc trước hạn 1 giờ → quá hạn 2 giờ nhắc người thực hiện → quá hạn 1 ngày báo trưởng nhóm.**

Các mốc trên là ví dụ, không phải giá trị mặc định đã chốt. Admin team cấu hình mốc, người nhận và phạm vi thành viên được tùy chỉnh.
