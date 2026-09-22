import React from "react";
import { ArrowLeft, ArrowUpRight, Bell, Sparkles } from "lucide-react";
import { errorCatalog } from "./ErrorPage.jsx";
export default function ErrorGallery({ go }) {
  return (
    <main className="error-gallery">
      <header className="error-gallery-header">
        <button
          className="no-entry-brand"
          onClick={() => go("dashboard")}
          aria-label="Nhắc tôi — về không gian làm việc"
        >
          <span>
            <Bell size={20} />
          </span>
          nhắc tôi<span className="no-entry-dot">.</span>
        </button>
        <button onClick={() => go("dashboard")}>
          <ArrowLeft size={14} /> Về không gian
        </button>
      </header>
      <div className="no-entry-eyebrow">
        <span /> BỘ SƯU TẬP TRANG LỖI
      </div>
      <h1>
        Lỗi một nhịp.
        <br />
        Vẫn đúng vibe <span style={{ color: "#a58cbd" }}>nhắc tôi.</span>
      </h1>
      <p className="error-gallery-intro">
        Một chút dễ thương khi mọi thứ chưa như ý. Mỗi trang đều có lời giải
        thích, hướng xử lý và một bạn nhỏ đồng hành.
      </p>
      <div className="error-gallery-note">
        <Sparkles size={16} />
        <span>
          Đây là khu vực xem thử thiết kế. Mở các trang bên dưới không tạo lỗi
          hệ thống và không thay đổi dữ liệu.
        </span>
      </div>
      {["4xx", "5xx"].map((family) => (
        <section key={family}>
          <h2>
            {family === "4xx"
              ? "4xx · Kiểm tra lại yêu cầu"
              : "5xx · Hệ thống cần một nhịp nghỉ"}
          </h2>
          <div className="error-gallery-grid">
            {Object.entries(errorCatalog)
              .filter(([, c]) => c.category === family)
              .map(([code, c]) => (
                <button
                  key={code}
                  data-family={family}
                  className="error-gallery-card"
                  onClick={() => go(`errors/${code}`)}
                >
                  <div>
                    <b>{code}</b>
                    <ArrowUpRight size={20} />
                  </div>
                  <strong>{c.title}</strong>
                  <p>{c.description}</p>
                  <small>Xem trang và chuyển động →</small>
                </button>
              ))}
          </div>
        </section>
      ))}
      <p className="error-gallery-footer">
        Minh họa SVG chuyển động · Có nút dừng / bật · Tôn trọng tùy chọn giảm
        chuyển động · Tối ưu cho điện thoại
      </p>
    </main>
  );
}
