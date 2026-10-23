import React, { useEffect, useLayoutEffect, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  LogIn,
  CreditCard,
  ArrowUpRight,
  Bell,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { applyTheme } from "./theme.js";
import "./access-denied.css";
import "./error-pages.css";

const catalog = {
  400: [
    "Yêu cầu này",
    "hơi lạc nhịp.",
    "Thông tin gửi lên chưa đúng định dạng. Kiểm tra lại nội dung rồi thử gửi lần nữa nhé.",
    "BAD REQUEST",
    "ĐÚNG Ý, CHƯA ĐÚNG CÚ PHÁP.",
    "hmm?",
    "CHECK",
    "lavender",
    "form",
  ],
  401: [
    "Khoan đã,",
    "bạn là ai nhỉ?",
    "Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn. Đăng nhập lại để tiếp tục nha.",
    "WHO ARE YOU?",
    "NHẬN DIỆN ĐỒNG ĐỘI NÀO.",
    "hello?",
    "LOGIN",
    "mint",
    "key",
  ],
  402: [
    "Đến lúc",
    "gia hạn rồi.",
    "Gói dịch vụ cần được gia hạn để tiếp tục sử dụng tính năng này. Chủ không gian có thể kiểm tra tại Gói dịch vụ.",
    "LEVEL UP",
    "NẠP NĂNG LƯỢNG CHO ĐỘI NGŨ.",
    "renew!",
    "PLAN",
    "peach",
    "ticket",
  ],
  403: [
    "Không phận sự",
    "miễn vào",
    "Bạn xịn, nhưng cửa này cần quyền admin SaaS. Quay về làm việc lớn nha — tụi mình giữ cửa ở đây.",
    "VIP AREA",
    "OOPS! CHỖ NÀY CÓ BẢO VỆ.",
    "uh-oh.",
    "ADMIN",
    "lavender",
    "guard",
  ],
  404: [
    "Ủa, trang này",
    "đi đâu mất?",
    "Đường dẫn có thể đã đổi hoặc trang này chưa tồn tại. Về không gian làm việc rồi tìm lại nhé.",
    "LOST & FOUND",
    "TÌM BẠN KHẮP VŨ TRỤ.",
    "where?",
    "LOST",
    "lavender",
    "search",
  ],
  408: [
    "Chờ hơi lâu,",
    "hết giờ rồi.",
    "Yêu cầu mất quá nhiều thời gian để hoàn tất. Kiểm tra kết nối rồi thử lại nhé.",
    "TIME OUT",
    "TẠM DỪNG MỘT NHỊP THÔI.",
    "tick…",
    "WAIT",
    "peach",
    "clock",
  ],
  409: [
    "Có chút",
    "lệch sóng rồi.",
    "Dữ liệu đã thay đổi hoặc trùng với thông tin có sẵn. Quay lại xem phiên bản mới trước khi lưu tiếp nhé.",
    "SYNC CHECK",
    "ĐỒNG BỘ LẠI NHỊP NÀO.",
    "oops!",
    "SYNC",
    "mint",
    "form",
  ],
  410: [
    "Trang này đã",
    "chào tạm biệt.",
    "Nội dung ở đường dẫn này đã được gỡ. Bạn có thể quay về để tìm thông tin khác.",
    "MOVED ON",
    "HẸN GẶP Ở MỘT TRANG KHÁC.",
    "bye!",
    "GONE",
    "peach",
    "search",
  ],
  422: [
    "Gần đúng rồi,",
    "sửa chút nha.",
    "Có thông tin chưa hợp lệ trong biểu mẫu. Quay lại kiểm tra các trường được đánh dấu trước khi gửi.",
    "ONE MORE EDIT",
    "THÊM MỘT CHÚT CHỈNH CHU.",
    "edit!",
    "EDIT",
    "mint",
    "form",
  ],
  423: [
    "Cửa đang khóa,",
    "đợi chút nha.",
    "Tài khoản hoặc không gian này đang tạm ngưng. Liên hệ quản trị viên để kiểm tra và mở lại quyền sử dụng.",
    "LOCKED",
    "TẠM NGƯNG, CẦN KIỂM TRA.",
    "locked!",
    "LOCK",
    "lavender",
    "key",
  ],
  429: [
    "Từ từ thôi,",
    "nhanh quá rồi!",
    "Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Nghỉ một lát rồi thử lại nha.",
    "SLOW DOWN",
    "HÍT THỞ MỘT NHỊP ĐÃ.",
    "easy!",
    "CHILL",
    "mint",
    "clock",
  ],
  500: [
    "Server vừa",
    "vấp một nhịp.",
    "Hệ thống gặp lỗi khi xử lý yêu cầu. Thử lại sau ít phút; nếu lỗi vẫn còn, liên hệ quản trị viên nhé.",
    "PLOT TWIST",
    "LỖI Ở HỆ THỐNG, BẠN KHÔNG SAI.",
    "oops!",
    "FIXING",
    "peach",
    "repair",
  ],
  502: [
    "Tín hiệu này",
    "chưa tới nơi.",
    "Máy chủ chưa nhận được phản hồi hợp lệ từ dịch vụ kết nối. Chờ một chút rồi thử lại nha.",
    "SIGNAL LOST",
    "KẾT NỐI ĐANG LỆCH NHỊP.",
    "ping?",
    "RETRY",
    "lavender",
    "signal",
  ],
  503: [
    "Server đang",
    "nghỉ lấy sức.",
    "Dịch vụ tạm thời chưa sẵn sàng. Bạn có thể thử lại sau ít phút hoặc quay về không gian làm việc.",
    "BRB",
    "TẠM NGHỈ, CHƯA THỂ PHỤC VỤ.",
    "brb!",
    "PAUSE",
    "mint",
    "repair",
  ],
  504: [
    "Gọi server,",
    "chưa thấy trả lời.",
    "Dịch vụ kết nối phản hồi quá chậm. Chờ một chút rồi thử lại yêu cầu nhé.",
    "STILL WAITING",
    "ĐƯỜNG TRUYỀN CẦN THÊM THỜI GIAN.",
    "zzz…",
    "WAIT",
    "peach",
    "signal",
  ],
};
export const errorCatalog = Object.fromEntries(
  Object.entries(catalog).map(([code, value]) => [
    code,
    {
      title: `${value[0]} ${value[1]}`,
      description: value[2],
      category: Number(code) >= 500 ? "5xx" : "4xx",
    },
  ]),
);

export default function ErrorPage({
  code = 500,
  onBack,
  onRetry,
  onLogin,
  onBilling,
  preview = false,
  onPreviewBack,
}) {
  code =
    Number.isInteger(Number(code)) && Number(code) >= 400 && Number(code) <= 599
      ? Number(code)
      : 500;
  const variant =
    catalog[code] ||
    (code >= 500
      ? [
          "Hệ thống đang",
          "cần chỉnh nhịp.",
          "Dịch vụ gặp lỗi khi xử lý yêu cầu. Thử lại sau hoặc liên hệ quản trị viên nhé.",
          "SERVER ERROR",
          "TẠM DỪNG MỘT NHỊP THÔI.",
          "oops!",
          "FIXING",
          "peach",
          "repair",
        ]
      : [
          "Chỗ này đang",
          "có chút vướng.",
          "Yêu cầu chưa thể thực hiện. Kiểm tra thông tin hoặc quay về không gian làm việc nhé.",
          "CHECK AGAIN",
          "MÌNH THỬ MỘT HƯỚNG KHÁC NHA.",
          "hmm?",
          "CHECK",
          "lavender",
          "form",
        ]);
  const [
    headline,
    accent,
    description,
    sticker,
    eyebrow,
    bubble,
    sign,
    theme,
    mood,
  ] = variant;
  const retryable = [408, 429].includes(code) || code >= 500;
  const primary =
    code === 401 && onLogin
      ? ["Đăng nhập lại", onLogin]
      : code === 402 && onBilling
        ? ["Xem gói dịch vụ", onBilling]
        : retryable && onRetry
          ? ["Thử lại", onRetry]
          : ["Về không gian làm việc", onBack];
  const PrimaryIcon =
    primary[1] === onRetry
      ? RefreshCw
      : primary[1] === onLogin
        ? LogIn
        : primary[1] === onBilling
          ? CreditCard
          : ArrowLeft;
  const [paused, setPaused] = useState(false);
  // Next serves the catch-all 404 as a client-rendered error shell, so the
  // root layout's inline theme script never runs there; apply it before paint.
  useLayoutEffect(() => {
    if (!document.documentElement.dataset.theme) applyTheme();
  }, []);
  useEffect(() => {
    setPaused(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return (
    <main
      className={`no-entry error-theme-${theme} ${paused ? "motion-paused" : ""}`}
    >
      <header className="no-entry-header">
        <button
          className="no-entry-brand"
          onClick={onBack}
          aria-label="Nhắc tôi — về không gian làm việc"
        >
          <span>
            <Bell size={20} />
          </span>
          nhắc tôi<span className="no-entry-dot">.</span>
        </button>
        <span className="no-entry-header-tag">
          <span />{" "}
          {preview
            ? `XEM THỬ · LỖI ${code}`
            : code === 403
              ? "KHU VỰC QUẢN TRỊ"
              : `MÃ LỖI ${code}`}
        </span>
      </header>
      <section className="no-entry-content" aria-labelledby="no-entry-title">
        <div className="no-entry-art">
          <span className="no-entry-orbit orbit-one" aria-hidden="true">
            <Sparkles size={25} />
          </span>
          <span className="no-entry-orbit orbit-two" aria-hidden="true">
            ✳
          </span>
          <span className="no-entry-sticker" aria-hidden="true">
            {sticker} <ArrowUpRight size={16} />
          </span>
          <div className="no-entry-bubble" aria-hidden="true">
            {bubble}{" "}
            <span>{code === 403 ? "✋" : code >= 500 ? "⚡" : "✦"}</span>
          </div>
          {code === 403 ? (
            <svg
              className="no-entry-guard"
              viewBox="0 0 400 310"
              role="img"
              aria-labelledby="guard-title"
            >
              <title id="guard-title">
                Bảo vệ nhỏ đeo kính đen, giơ tay chặn lối vào khu vực admin
              </title>
              <ellipse
                className="guard-shadow"
                cx="208"
                cy="283"
                rx="111"
                ry="13"
                fill="#ddd6e9"
              />
              <g className="guard-body">
                <path
                  d="M154 236l-9 32c-3 9 1 15 11 15h28l1-43M240 239l10 31c3 8-1 13-11 13h-24l-6-43"
                  fill="#26242d"
                  stroke="#26242d"
                  strokeWidth="5"
                  strokeLinejoin="round"
                />
                <path
                  d="M131 158c-9-37-4-86 20-111 26-28 67-34 100-14 39 24 46 69 35 114l-3 24c19 19 26 49 9 69-19 24-165 24-186-3-19-24-6-54 25-79Z"
                  fill="#b4a0ed"
                  stroke="#27232f"
                  strokeWidth="5"
                />
                <path
                  d="M151 59c14-16 32-20 43-21"
                  fill="none"
                  stroke="#d4c6ff"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <path
                  d="M138 103l129 0"
                  stroke="#27232f"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <g className="guard-glasses">
                  <path
                    d="M142 92h45l-3 27c-3 21-36 20-40-1Z"
                    fill="#26242d"
                    stroke="#26242d"
                    strokeWidth="5"
                  />
                  <path
                    d="M215 92h45l-3 27c-3 21-36 20-40-1Z"
                    fill="#26242d"
                    stroke="#26242d"
                    strokeWidth="5"
                  />
                  <path
                    d="M187 103c11-7 18-7 28 0"
                    fill="none"
                    stroke="#26242d"
                    strokeWidth="6"
                  />
                  <path
                    d="M151 102h17M225 102h15"
                    stroke="#fbfaf7"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                </g>
                <path
                  className="guard-mouth"
                  d="M192 147q13 10 25-1"
                  fill="none"
                  stroke="#27232f"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M132 174q-32 21-45-7"
                  fill="none"
                  stroke="#27232f"
                  strokeWidth="21"
                  strokeLinecap="round"
                />
                <path
                  d="M132 173q-32 21-45-7"
                  fill="none"
                  stroke="#b4a0ed"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <g className="guard-hand">
                  <path
                    d="M89 172c-13-5-23-15-28-27l-7-19c-3-9 7-14 12-6l7 11-10-31c-3-9 8-12 12-4l8 22-4-32c-1-10 10-10 12-1l5 30 3-25c2-9 12-8 12 1l-1 40 9-10c6-7 14 0 10 7l-17 33q-8 14-23 11Z"
                    fill="#d1f17a"
                    stroke="#27232f"
                    strokeWidth="4"
                    strokeLinejoin="round"
                  />
                </g>
                <path
                  d="M276 170q27 13 14 32"
                  fill="none"
                  stroke="#27232f"
                  strokeWidth="19"
                  strokeLinecap="round"
                />
                <path
                  d="M276 170q27 13 14 32"
                  fill="none"
                  stroke="#b4a0ed"
                  strokeWidth="11"
                  strokeLinecap="round"
                />
                <g transform="rotate(-8 215 207)">
                  <rect
                    x="157"
                    y="184"
                    width="106"
                    height="49"
                    rx="8"
                    fill="#f8f5ee"
                    stroke="#27232f"
                    strokeWidth="3"
                  />
                  <circle cx="175" cy="198" r="3" fill="#b4a0ed" />
                  <text
                    x="210"
                    y="217"
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="800"
                    fontFamily="sans-serif"
                    fill="#27232f"
                  >
                    ADMIN
                  </text>
                </g>
              </g>
              <g className="guard-code" transform="rotate(9 320 85)">
                <rect
                  x="289"
                  y="58"
                  width="65"
                  height="48"
                  rx="10"
                  fill="#d1f17a"
                  stroke="#27232f"
                  strokeWidth="3"
                />
                <text
                  x="321"
                  y="89"
                  textAnchor="middle"
                  fontSize="23"
                  fontWeight="800"
                  fontFamily="sans-serif"
                  fill="#27232f"
                >
                  403
                </text>
              </g>
            </svg>
          ) : (
            <ErrorIllustration code={code} sign={sign} mood={mood} />
          )}
          <div className="no-entry-tape" aria-hidden="true">
            <span>
              {code === 403
                ? "ADMIN ONLY · ĐI NHẦM CỬA RỒI BẠN ƠI · ADMIN ONLY ·"
                : `${sticker} · NHẮC TÔI CÙNG BẠN GỠ RỐI · ${sticker} ·`}
            </span>
          </div>
        </div>
        <div className="no-entry-eyebrow">
          <span /> {eyebrow}
        </div>
        <h1 id="no-entry-title">
          {headline}
          <br />
          <span>
            {accent}
            <svg viewBox="0 0 300 16" aria-hidden="true">
              <path d="M5 11Q140 0 291 8" />
            </svg>
          </span>
          <i aria-hidden="true">✳</i>
        </h1>
        <p className="no-entry-copy">
          {code === 403 ? (
            <>
              Bạn xịn, nhưng cửa này cần quyền <strong>admin SaaS</strong>.
              <br className="no-entry-break" /> Quay về làm việc lớn nha — tụi
              mình giữ cửa ở đây.
            </>
          ) : (
            description
          )}
        </p>
        <div className="error-page-actions">
          <button className="no-entry-back" onClick={primary[1]}>
            <PrimaryIcon size={18} />
            <span>{primary[0]}</span>
            <span className="no-entry-shortcut" aria-hidden="true">
              ↗
            </span>
          </button>
          {primary[1] !== onBack && (
            <button className="error-back-secondary" onClick={onBack}>
              Về không gian làm việc
            </button>
          )}
        </div>
        <p className="no-entry-help">
          <ShieldCheck size={14} />
          {preview
            ? "Đây là bản xem thử giao diện, hệ thống không phát sinh lỗi này."
            : code === 403
              ? "Cần vào đây? Liên hệ quản trị viên để được cấp quyền."
              : `Nhắc tôi · Mã lỗi ${code} · Cần hỗ trợ? Liên hệ quản trị viên.`}
        </p>
      </section>
      {preview && onPreviewBack && (
        <button className="error-preview-back" onClick={onPreviewBack}>
          <ArrowLeft size={13} /> Tất cả trang lỗi
        </button>
      )}
      <footer className="no-entry-footer">
        <span>
          NHẮC TÔI <i>✦</i> ĐÚNG VIỆC. ĐÚNG QUYỀN.
        </span>
        <button onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? "Bật chuyển động" : "Dừng chuyển động"}
        </button>
      </footer>
    </main>
  );
}

function ErrorIllustration({ code, sign, mood }) {
  const repair = ["repair", "signal"].includes(mood);
  return (
    <svg
      className="no-entry-guard"
      viewBox="0 0 400 310"
      role="img"
      aria-labelledby="error-art-title"
    >
      <title id="error-art-title">
        {repair
          ? "Bạn nhỏ đang kiểm tra kết nối và sửa máy tính"
          : mood === "search"
            ? "Bạn nhỏ cầm kính lúp tìm đường"
            : mood === "clock"
              ? "Bạn nhỏ nhắc chờ một nhịp"
              : "Bạn nhỏ giúp kiểm tra thông tin"}
      </title>
      <ellipse
        className="guard-shadow"
        cx="208"
        cy="283"
        rx="111"
        ry="13"
        fill="var(--error-shadow, #ddd6e9)"
      />
      <g className="guard-body">
        <path
          d="M156 237l-8 33q-4 13 9 13h28l1-43M238 240l10 30q4 13-9 13h-24l-5-42"
          fill="#26242d"
          stroke="#26242d"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M131 158c-9-37-4-86 20-111 26-28 67-34 100-14 39 24 46 69 35 114l-3 24c19 19 26 49 9 69-19 24-165 24-186-3-19-24-6-54 25-79Z"
          fill="var(--error-character,#b4a0ed)"
          stroke="#27232f"
          strokeWidth="5"
        />
        <path
          d="M151 59c14-16 32-20 43-21"
          fill="none"
          stroke="#fff9"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <g className="error-eyes">
          <ellipse
            cx="174"
            cy="109"
            rx="13"
            ry="20"
            fill="#fffdf7"
            stroke="#27232f"
            strokeWidth="3"
          />
          <ellipse
            cx="232"
            cy="109"
            rx="13"
            ry="20"
            fill="#fffdf7"
            stroke="#27232f"
            strokeWidth="3"
          />
          <g className="error-pupils">
            <ellipse cx="177" cy="113" rx="6" ry="10" fill="#27232f" />
            <ellipse cx="235" cy="113" rx="6" ry="10" fill="#27232f" />
          </g>
        </g>
        <path
          d={repair ? "M191 151q12-12 23 0" : "M192 146q12 8 24 0"}
          fill="none"
          stroke="#27232f"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M132 174q-35 19-38-9M276 173q29 15 13 37"
          fill="none"
          stroke="#27232f"
          strokeWidth="19"
          strokeLinecap="round"
        />
        <path
          d="M132 174q-35 19-38-9M276 173q29 15 13 37"
          fill="none"
          stroke="var(--error-character,#b4a0ed)"
          strokeWidth="11"
          strokeLinecap="round"
        />
        {repair ? (
          <g className="error-laptop">
            <path
              d="M150 179h122l12 68H142Z"
              fill="#f8f5ee"
              stroke="#27232f"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <path
              d="M134 247h157l-9 11H146Z"
              fill="#d1f17a"
              stroke="#27232f"
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <path
              d="M192 205q19-17 38 0m-31 9q12-10 24 0"
              fill="none"
              stroke="#9480ba"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="211" cy="226" r="3" fill="#9480ba" />
            <path
              className="error-spark"
              d="m295 76-9 18h14l-9 18"
              stroke="#27232f"
              strokeWidth="4"
              fill="#d1f17a"
            />
          </g>
        ) : (
          <g transform="rotate(-8 215 208)">
            <rect
              x="157"
              y="184"
              width="106"
              height="49"
              rx="8"
              fill="#f8f5ee"
              stroke="#27232f"
              strokeWidth="3"
            />
            <circle
              cx="175"
              cy="198"
              r="3"
              fill="var(--error-character,#b4a0ed)"
            />
            <text
              x="210"
              y="217"
              textAnchor="middle"
              fontSize="20"
              fontWeight="800"
              fontFamily="sans-serif"
              fill="#27232f"
            >
              {sign}
            </text>
          </g>
        )}
        <g className="error-accessory">
          {mood === "search" ? (
            <>
              <path
                d="m93 162 17-30"
                stroke="#27232f"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <circle
                cx="123"
                cy="108"
                r="28"
                fill="#d1f17aaa"
                stroke="#27232f"
                strokeWidth="5"
              />
              <path
                d="M113 94q7-6 15-2"
                fill="none"
                stroke="#fff"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </>
          ) : mood === "clock" ? (
            <>
              <circle
                cx="89"
                cy="139"
                r="28"
                fill="#d1f17a"
                stroke="#27232f"
                strokeWidth="4"
              />
              <path
                d="M89 119v20l12 6"
                stroke="#27232f"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
              />
            </>
          ) : mood === "key" ? (
            <>
              <circle
                cx="81"
                cy="118"
                r="16"
                fill="#d1f17a"
                stroke="#27232f"
                strokeWidth="4"
              />
              <path
                d="M90 131l24 31m-8-10 8-6"
                stroke="#27232f"
                strokeWidth="7"
                strokeLinecap="round"
              />
            </>
          ) : repair ? (
            <>
              <path
                d="m76 110 28 48m-28-48-14-5-4-14 12 7 10-6 2-13 10 12-4 15"
                fill="#d1f17a"
                stroke="#27232f"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              <rect
                x="60"
                y="105"
                width="50"
                height="58"
                rx="6"
                fill="#d1f17a"
                stroke="#27232f"
                strokeWidth="4"
                transform="rotate(-12 85 134)"
              />
              <path
                d="M72 121h20m-19 10h21m-19 10h12"
                stroke="#27232f"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
        </g>
      </g>
      <g className="guard-code" transform="rotate(9 320 85)">
        <rect
          x="289"
          y="58"
          width="65"
          height="48"
          rx="10"
          fill="#d1f17a"
          stroke="#27232f"
          strokeWidth="3"
        />
        <text
          x="321"
          y="89"
          textAnchor="middle"
          fontSize="23"
          fontWeight="800"
          fontFamily="sans-serif"
          fill="#27232f"
        >
          {code}
        </text>
      </g>
    </svg>
  );
}
