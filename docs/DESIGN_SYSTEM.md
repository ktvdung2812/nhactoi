# Quy chuẩn giao diện Nhắc tôi

Nguồn cấu hình dùng chung: `src/design-system.css`, được import cuối trong `src/main.jsx`.
CSS của từng chức năng chỉ giữ bố cục và các trạng thái riêng; kích thước chữ tham chiếu token, không tự thu nhỏ chữ khi màn hình hẹp.

## Typography

Font giao diện: **Be Vietnam Pro**, tải nội bộ đủ các trọng lượng 400, 500, 600, 700. `system-ui` là font dự phòng. Khối mã/JSON dùng monospace.

| Vai trò | Token | Kích thước mặc định |
| --- | --- | --- |
| Tiêu đề trang | `--font-page-title` | 28px; 24px ở màn hình ≤1000px |
| Tiêu đề khu vực / modal | `--font-section-title` | 18px |
| Tiêu đề thẻ | `--font-card-title` | 16px |
| Nội dung, nút thao tác | `--text-base`, `--font-control` | 14px |
| Nhãn biểu mẫu / nội dung phụ | `--text-sm` | 13px |
| Thời gian, badge, chú thích | `--text-xs` | 12px tối thiểu |
| Ô nhập trên điện thoại | `--text-lg` | 16px |
| Chỉ số / giá | `--text-3xl` đến `--text-6xl` | 24–40px theo không gian |

Line-height: nội dung 1.6, tiêu đề 1.35, nút và ô nhập 1.5. Chỉ số và tiêu đề minh họa Gen Z có thang hiển thị riêng; vẫn dùng chung font, nội dung phụ và nút. Không ép tiêu đề trang lỗi xuống kích thước tiêu đề quản trị.

## Thành phần

- Nút và ô nhập cao tối thiểu 40px, 44px trên điện thoại.
- Bo góc: điều khiển 8px, thẻ 12px, modal 16px.
- Padding thẻ nội dung 20px, 16px trên điện thoại; giữ khoảng cách và vùng cuộn riêng của bảng/Kanban.
- Cụm thao tác phụ dùng menu ba chấm dọc; hành động chính giữ nút có nhãn.
- Thu hẹp màn hình bằng xuống dòng/chuyển cột/cuộn trong bảng, không giảm nhãn xuống 7–10px.
- Giữ trạng thái focus, disabled và reduced-motion; không ẩn hành động chỉ để làm vừa khung.

## Khi thêm trang

Dùng `.page-heading`, `.button`, `.panel`/`.td-panel`, `.field` và `ActionMenu` khi phù hợp. Với component riêng, tham chiếu cùng token. Không thêm font-family khác hoặc trọng lượng font chưa được tải. Xác minh tên dài, ô nhập và menu ở desktop, tablet và điện thoại.
