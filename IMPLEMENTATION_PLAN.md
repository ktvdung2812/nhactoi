# Triển khai các chức năng tham khảo từ task-crm

Phạm vi: sáu giai đoạn đã được người dùng phê duyệt. Quyền SaaS admin vẫn giới hạn thanh toán, liên hệ, hỗ trợ và cấu hình; nghiệp vụ thuộc doanh nghiệp/team.

- [x] 1. Bảng công việc linh hoạt: cột riêng, ánh xạ trạng thái, thứ tự task/cột và thu gọn được lưu, lưu trữ/khôi phục cột.
- [x] 2. Mẫu và thông tin task: mẫu task/checklist, sao chép, nhãn, nhiều người phụ trách, sắp xếp checklist, chuyển checklist thành task.
- [x] 3. Cộng tác: nhắc tên, theo dõi, sửa/xóa bình luận, phản ứng, thông báo theo quyền.
- [x] 4. Dịch vụ và khách hàng: hợp đồng/gia hạn, chi phí, nhắc hạn, lịch sử gia hạn và chăm sóc.
- [x] 5. Tự động hóa: quy tắc theo sự kiện, nút nhiều bước, nhật ký chạy/lỗi, bật/tắt.
- [x] 6. Vận hành/tích hợp: kho S3/Drive, chuyển kho, sao lưu/khôi phục/lịch sao lưu, Google login, nhập/xuất bảng và lịch sự kiện.

## Trạng thái ngày 22/09/2026

Đã triển khai mã nguồn và giao diện cho sáu giai đoạn trên. Schema được nâng lên phiên bản 17, giữ dữ liệu hiện có. Các quyền doanh nghiệp/team được kiểm tra ở API; quyền quản trị SaaS không thay thế quyền nghiệp vụ.

### Đã xác minh

- 52/52 kiểm thử tự động đạt: gồm phân quyền, migration, giao dịch/hoàn tác, cột và trạng thái, mẫu/checklist, cộng tác, dịch vụ, tự động hóa, nhập/xuất, tệp và sao lưu/khôi phục trên dữ liệu thử riêng.
- Bản build sản xuất thành công; còn cảnh báo kích thước bundle JavaScript trên 500 KB.
- Kiểm tra trực quan các luồng mới trên môi trường `nhactoi.test`: bảng/chi tiết task ở desktop, tablet 820px và điện thoại 375px; biểu mẫu dịch vụ, tự động hóa, lịch hẹn trên mobile; thư viện mẫu và trang cấu hình quản trị.
- Sửa bảng tổng hợp hiển thị task theo trạng thái, giữ thứ tự checklist khi xuất/nhập, và chọn công việc nguồn bằng tên trong thư viện mẫu.

### Giới hạn và bước cấu hình còn lại

- S3/MinIO/R2, Google Shared Drive và Google OAuth đã có API, adapter và trang cấu hình. Chưa xác nhận kết nối thật vì chưa có thông tin xác thực của quản trị viên; các ca kho ngoài hiện dùng adapter thử nghiệm.
- Chuyển kho hiện hỗ trợ tệp trên máy chủ → kho ngoài đang chọn, tối đa 10 tệp/lần; chưa chuyển trực tiếp giữa hai kho ngoài. Tệp cũ tiếp tục dùng cấu hình kho ban đầu.
- Thông báo cộng tác, gia hạn và lịch hẹn hiện gửi trong ứng dụng. Lịch hẹn nhắc người tạo; chưa đồng bộ Google Calendar.
- Khôi phục sao lưu thực hiện ngoại tuyến bằng CLI, không ghi đè DB đang chạy. Chưa tự động dọn các bản sao hoàn chỉnh cũ.
- Kiểm tra responsive đã thực hiện trên các luồng nêu trên; chưa phải kiểm thử mọi tổ hợp dữ liệu và mọi thiết bị.

Hướng dẫn cấu hình và vận hành: [OPERATIONS.md](OPERATIONS.md).


## Rà soát giao diện responsive — 22/09/2026

- Kiểm tra bằng trình duyệt 24 trang chính (16 trang nghiệp vụ và 8 trang SaaS admin) ở các chiều rộng 320, 375, 414, 768, 820, 1024, 1440, 1920px. Sau sửa, 192 lượt đo không có tràn ngang toàn trang. Các vùng Kanban/bảng dữ liệu vẫn được phép cuộn ngang riêng; ô nhập URL dài cuộn nội dung bên trong là hành vi dự kiến.
- Kiểm tra trực quan và mở/đóng biểu mẫu: công việc, khách hàng, thu chi, thành viên team, ticket, dịch vụ, quy tắc tự động, lịch hẹn, mẫu công việc, nhật ký quản trị; kiểm tra form thêm cột ở 844×390. Không gửi các biểu mẫu này và không thay đổi dữ liệu nghiệp vụ.
- Kiểm tra chi tiết task/team/ticket/người dùng/doanh nghiệp, menu cột và menu dòng quản trị; các nút thêm task nằm cùng đáy cột ở tablet.
- Đã sửa: thẻ giá quá hẹp trên tablet; cụm nhập/xuất bảng tràn ngang; mô tả nhật ký bị ép thành cột chữ rất hẹp trên mobile; đường dẫn/cấu hình dài và các flex/grid con; nút hành động quản trị khó tìm khi bảng cuộn ngang; thống kê task/cột bị lặp. Bổ sung khoảng cách biểu mẫu cấu hình và viền focus cho nút chọn tệp.
- Build sản xuất thành công. Lần này tập trung bố cục và thao tác UI; không chạy lại nghiệp vụ backend hay thử mọi tổ hợp dữ liệu/thiết bị thật. Danh sách dịch vụ/mẫu/quy tắc hiện trống nên khả năng xuống dòng tên dài được rà thêm trong CSS, chưa xác minh với mọi dữ liệu thực tế.
