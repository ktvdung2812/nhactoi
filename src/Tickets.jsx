import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LifeBuoy,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import "./tickets.css";
import ActionMenu from "./ActionMenu.jsx";

const statuses = {
  open: "Mới tiếp nhận",
  in_progress: "Đang xử lý",
  waiting_customer: "Chờ bạn phản hồi",
  resolved: "Đã giải quyết",
};
const categories = {
  billing: "Thanh toán & thuê bao",
  account: "Tài khoản & liên hệ",
  technical: "Sự cố kỹ thuật",
  other: "Hỗ trợ khác",
};
const priorities = { low: "Thấp", normal: "Bình thường", high: "Cao" };
const time = (value) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";
const statusName = (value, admin) =>
  value === "waiting_customer" && admin
    ? "Chờ khách phản hồi"
    : statuses[value] || value;
function Options({ values }) {
  return Object.entries(values).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}
function Status({ value, admin }) {
  return (
    <span className={`ticket-status ticket-status-${value}`}>
      <i />
      {statusName(value, admin)}
    </span>
  );
}

function CreateTicket({ api, onClose, onCreated }) {
  const [draft, setDraft] = useState({
    subject: "",
    category: "billing",
    priority: "normal",
    message: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ref = useRef(null),
    busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.querySelector("input")?.focus();
    const keydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) onClose();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current.querySelectorAll(
            "button:not(:disabled),input,select,textarea",
          ),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const field = (name) => ({
    value: draft[name],
    onChange: (e) => setDraft((d) => ({ ...d, [name]: e.target.value })),
  });
  async function submit(e) {
    e.preventDefault();
    if (busyRef.current) return;
    if (!draft.subject.trim() || !draft.message.trim())
      return setError("Hãy nhập tiêu đề và nội dung cần hỗ trợ.");
    setBusy(true);
    setError("");
    try {
      const result = await api("/tickets", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      onCreated(result.ticket.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="ticket-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="ticket-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-create-title"
        ref={ref}
      >
        <header>
          <span className="ticket-symbol">
            <LifeBuoy size={24} />
          </span>
          <div>
            <small>NHẮC TÔI LUÔN LẮNG NGHE</small>
            <h2 id="ticket-create-title">Bạn cần hỗ trợ điều gì?</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Đóng yêu cầu hỗ trợ"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        <form onSubmit={submit}>
          <label className="field">
            <span>
              Tiêu đề yêu cầu <b>*</b>
            </span>
            <input
              {...field("subject")}
              required
              maxLength={160}
              placeholder="Ví dụ: Cần kiểm tra hóa đơn gia hạn tháng này"
            />
          </label>
          <div className="ticket-form-row">
            <label className="field">
              <span>Chủ đề</span>
              <select {...field("category")}>
                <Options values={categories} />
              </select>
            </label>
            <label className="field">
              <span>Mức ưu tiên</span>
              <select {...field("priority")}>
                <Options values={priorities} />
              </select>
            </label>
          </div>
          <label className="field">
            <span>
              Nội dung cần hỗ trợ <b>*</b>
            </span>
            <textarea
              {...field("message")}
              required
              maxLength={5000}
              rows={6}
              placeholder="Mô tả vấn đề, thời điểm xảy ra và mã hóa đơn (nếu có) để chúng tôi hỗ trợ bạn nhanh hơn."
            />
          </label>
          <p className="ticket-hint">
            Không gửi mật khẩu, mã OTP hoặc khóa API trong ticket.
          </p>
          {error && (
            <p className="ticket-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy}
            >
              Để sau
            </button>
            <button className="button" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Send size={16} />
              )}{" "}
              Gửi yêu cầu
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function Tickets({
  api,
  go,
  mode = "customer",
  ticketId = null,
  workspaceId = "",
  userId = "",
}) {
  const admin = mode === "admin",
    route = admin ? "admin/tickets" : "tickets",
    endpoint = `/${route}`;
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0),
    [creating, setCreating] = useState(false),
    [body, setBody] = useState("");
  const [busy, setBusy] = useState(false),
    [saveError, setSaveError] = useState(""),
    [notice, setNotice] = useState("");
  const [editStatus, setEditStatus] = useState("open"),
    [editPriority, setEditPriority] = useState("normal");
  const busyRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let canceled = false;
    const params = new URLSearchParams({
      q: search,
      status,
      category,
      page: String(page),
    });
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (userId) params.set("userId", userId);
    setLoading(true);
    setError("");
    api(
      ticketId
        ? `${endpoint}/${encodeURIComponent(ticketId)}`
        : `${endpoint}?${params}`,
    )
      .then((result) => {
        if (!canceled) {
          setData(result);
          if (result.ticket) {
            setEditStatus(result.ticket.status);
            setEditPriority(result.ticket.priority);
          }
        }
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    api,
    endpoint,
    ticketId,
    search,
    status,
    category,
    page,
    revision,
    workspaceId,
    userId,
  ]);
  async function mutate(path, method, payload, success, clearBody = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSaveError("");
    setNotice("");
    try {
      const result = await api(path, { method, body: JSON.stringify(payload) });
      setData(result);
      setEditStatus(result.ticket.status);
      setEditPriority(result.ticket.priority);
      if (clearBody) setBody("");
      setNotice(success);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const reload = () => setRevision((v) => v + 1);
  const back = () => go(route);
  const ticket = data?.ticket;
  const events = (data?.events || []).map((event) => ({
    ...event,
    event: true,
  }));
  const timeline = [...(data?.messages || []), ...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <section className="tickets">
      <div className={`page-heading ${admin || ticketId ? "ticket-heading-menu-only" : ""}`}>
        <div>
          <div className="eyebrow">
            {admin
              ? "NHẮC TÔI / CHĂM SÓC KHÁCH HÀNG"
              : "CÓ VƯỚNG MẮC? CÓ NHẮC TÔI"}
          </div>
          <h1>{ticketId ? "Chi tiết yêu cầu" : "Trung tâm hỗ trợ"}</h1>
          <p>
            {admin
              ? "Tiếp nhận, trao đổi và theo dõi yêu cầu hỗ trợ của khách hàng."
              : "Gửi yêu cầu, theo dõi tiến độ và trao đổi với đội ngũ hỗ trợ."}
          </p>
        </div>
        <div className="ticket-actions">
          {!admin && !ticketId && (
            <button className="button" onClick={() => setCreating(true)}>
              <Plus size={17} /> Tạo yêu cầu
            </button>
          )}
          <ActionMenu label="Thao tác hỗ trợ" items={[
            { label: "Làm mới", icon: RefreshCw, onSelect: reload, disabled: loading || busy },
          ]} />
        </div>
      </div>
      {ticketId && (
        <button className="ticket-back" onClick={back}>
          <ArrowLeft size={16} /> Tất cả yêu cầu
        </button>
      )}
      {notice && (
        <div className="ticket-notice" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {!ticketId && (
        <>
          <div className="ticket-stats">
            {Object.keys(statuses).map((value) => (
              <button
                key={value}
                className={status === value ? "selected" : ""}
                onClick={() => {
                  setStatus(status === value ? "" : value);
                  setPage(1);
                }}
                aria-pressed={status === value}
              >
                <span>
                  <i className={`ticket-dot ${value}`} />
                  {statusName(value, admin)}
                </span>
                <strong>{data?.counts?.[value] ?? "—"}</strong>
              </button>
            ))}
          </div>
          <div className="ticket-toolbar">
            <label className="ticket-search">
              <Search size={18} />
              <input
                aria-label="Tìm yêu cầu hỗ trợ"
                placeholder={
                  admin
                    ? "Tìm tiêu đề, người gửi, doanh nghiệp…"
                    : "Tìm tiêu đề hoặc mã yêu cầu…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Lọc trạng thái ticket"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.keys(statuses).map((value) => (
                <option key={value} value={value}>
                  {statusName(value, admin)}
                </option>
              ))}
            </select>
            <select
              aria-label="Lọc chủ đề ticket"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả chủ đề</option>
              <Options values={categories} />
            </select>
          </div>
          {(workspaceId || userId) && (
            <div className="ticket-scope">
              Đang lọc yêu cầu của{" "}
              {workspaceId ? "doanh nghiệp này" : "người dùng này"}.
              <button onClick={back}>Xem tất cả</button>
            </div>
          )}
        </>
      )}
      {loading ? (
        <div className="ticket-empty" role="status">
          <LoaderCircle size={28} className="spin" />
          <p>Đang tải yêu cầu hỗ trợ…</p>
        </div>
      ) : error ? (
        <div className="ticket-empty" role="alert">
          <LifeBuoy size={32} />
          <h2>Chưa tải được yêu cầu</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={reload}>
            Thử lại
          </button>
        </div>
      ) : ticketId && ticket ? (
        <>
          <div className="ticket-detail-layout">
            <div className="ticket-conversation">
              <header className="ticket-subject">
                <div>
                  <span className="ticket-number">#{ticket.number}</span>
                  <Status value={ticket.status} admin={admin} />
                </div>
                <h2>{ticket.subject}</h2>
                <p>
                  {categories[ticket.category]}
                  <span>·</span>Tạo lúc {time(ticket.createdAt)}
                </p>
              </header>
              <div className="ticket-timeline">
                {timeline.map((item) =>
                  item.event ? (
                    <div className="ticket-event" key={`event-${item.id}`}>
                      <Clock3 size={13} />
                      <span>
                        {item.actorName || "Hệ thống"} ·{" "}
                        {item.type === "priority"
                          ? `Ưu tiên: ${priorities[item.toValue] || item.toValue}`
                          : item.type === "status"
                            ? statusName(item.toValue, admin)
                            : "Đã tạo yêu cầu"}
                        <time>{time(item.createdAt)}</time>
                      </span>
                    </div>
                  ) : (
                    <article
                      className={`ticket-message ${item.isStaff ? "staff" : "customer"}`}
                      key={item.id}
                    >
                      <div className="ticket-message-heading">
                        <span className="ticket-avatar">
                          {item.isStaff ? (
                            <ShieldCheck size={19} />
                          ) : (
                            (item.author?.name || "?").trim().slice(0, 1)
                          )}
                        </span>
                        <div>
                          <strong>{item.author?.name || "Người dùng"}</strong>
                          <small>
                            {item.isStaff
                              ? "Đội ngũ hỗ trợ"
                              : "Người gửi yêu cầu"}
                          </small>
                        </div>
                        <time>{time(item.createdAt)}</time>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  ),
                )}
              </div>
              <form
                className="ticket-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (body.trim())
                    mutate(
                      `${endpoint}/${ticketId}/messages`,
                      "POST",
                      { body },
                      "Đã gửi phản hồi.",
                      true,
                    );
                }}
              >
                <label htmlFor="ticket-reply">
                  {admin
                    ? "Phản hồi khách hàng"
                    : "Trao đổi thêm với chúng tôi"}
                </label>
                <textarea
                  id="ticket-reply"
                  required
                  maxLength={5000}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    admin
                      ? "Nhập hướng dẫn hoặc thông tin cần bổ sung…"
                      : "Bạn có thông tin mới? Chia sẻ thêm tại đây…"
                  }
                  disabled={busy}
                />
                {!admin &&
                  ["resolved", "waiting_customer"].includes(ticket.status) && (
                    <p className="ticket-hint">
                      Gửi phản hồi sẽ mở lại yêu cầu để đội ngũ hỗ trợ tiếp tục
                      xử lý.
                    </p>
                  )}
                {saveError && (
                  <p className="ticket-error" role="alert">
                    {saveError}
                  </p>
                )}
                <footer>
                  <span>{body.length.toLocaleString("vi-VN")}/5.000 ký tự</span>
                  <button className="button" disabled={busy || !body.trim()}>
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Send size={16} />
                    )}{" "}
                    Gửi phản hồi
                  </button>
                </footer>
              </form>
            </div>
            <aside className="ticket-sidebar">
              <section className="ticket-info">
                <h3>Thông tin yêu cầu</h3>
                <dl>
                  <dt>Người gửi</dt>
                  <dd>
                    {ticket.requester?.name}
                    <small>{ticket.requester?.email}</small>
                    {admin && (
                      <button
                        className="ticket-link"
                        onClick={() => go(`admin/users/${ticket.requester.id}`)}
                      >
                        Xem liên hệ <ArrowUpRight size={13} />
                      </button>
                    )}
                  </dd>
                  <dt>Doanh nghiệp</dt>
                  <dd>
                    {ticket.workspace?.name}
                    {admin && (
                      <button
                        className="ticket-link"
                        onClick={() =>
                          go(`admin/workspaces/${ticket.workspace.id}`)
                        }
                      >
                        Xem hồ sơ <ArrowUpRight size={13} />
                      </button>
                    )}
                  </dd>
                  <dt>Ưu tiên</dt>
                  <dd>
                    <span className={`ticket-priority ${ticket.priority}`}>
                      {priorities[ticket.priority]}
                    </span>
                  </dd>
                  <dt>Cập nhật gần nhất</dt>
                  <dd>{time(ticket.updatedAt)}</dd>
                </dl>
              </section>
              {admin ? (
                <form
                  className="ticket-info"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate(
                      `${endpoint}/${ticketId}`,
                      "PATCH",
                      { status: editStatus, priority: editPriority },
                      "Đã cập nhật yêu cầu.",
                    );
                  }}
                >
                  <h3>Xử lý yêu cầu</h3>
                  <label className="field">
                    <span>Trạng thái</span>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      disabled={busy}
                    >
                      {Object.keys(statuses).map((value) => (
                        <option key={value} value={value}>
                          {statusName(value, true)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Mức ưu tiên</span>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      disabled={busy}
                    >
                      <Options values={priorities} />
                    </select>
                  </label>
                  <button
                    className="button"
                    disabled={
                      busy ||
                      (editStatus === ticket.status &&
                        editPriority === ticket.priority)
                    }
                  >
                    {busy && <LoaderCircle size={16} className="spin" />}Lưu cập
                    nhật
                  </button>
                </form>
              ) : (
                <div className="ticket-help">
                  <LifeBuoy size={24} />
                  <h3>Mọi trao đổi ở cùng một nơi</h3>
                  <p>
                    Bạn có thể quay lại đây để xem phản hồi. Yêu cầu hỗ trợ vẫn
                    sử dụng được khi thuê bao hết hạn.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : (
        <div className="ticket-list-panel">
          <header>
            <h2>
              {admin ? "Hộp thư hỗ trợ" : "Yêu cầu của bạn"}
              <span>{data?.total || 0}</span>
            </h2>
            <small>
              {admin
                ? "Toàn nền tảng"
                : "Yêu cầu bạn gửi trong không gian hiện tại"}
            </small>
          </header>
          {!data?.items?.length ? (
            <div className="ticket-empty">
              <span className="ticket-empty-symbol">
                <MessageSquare size={32} />
              </span>
              <h2>
                {search || status || category
                  ? "Chưa có yêu cầu phù hợp"
                  : "Chưa có yêu cầu hỗ trợ"}
              </h2>
              <p>
                {search || status || category
                  ? "Thử đổi từ khóa hoặc bộ lọc để tìm yêu cầu."
                  : admin
                    ? "Yêu cầu mới từ khách hàng sẽ xuất hiện tại đây."
                    : "Cần hỗ trợ thanh toán, tài khoản hay kỹ thuật? Chúng tôi ở đây."}
              </p>
              {!admin && (
                <button className="button" onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Tạo yêu cầu đầu tiên
                </button>
              )}
            </div>
          ) : (
            <div className="ticket-list">
              {data.items.map((item) => (
                <button
                  key={item.id}
                  className="ticket-row"
                  onClick={() => go(`${route}/${item.id}`)}
                >
                  <span className="ticket-row-icon">
                    <MessageSquare size={21} />
                  </span>
                  <span className="ticket-row-main">
                    <span className="ticket-number">
                      #{item.number} <span>· {categories[item.category]}</span>
                    </span>
                    <strong>{item.subject}</strong>
                    <small>
                      {admin
                        ? `${item.requester?.name} · ${item.workspace?.name} · `
                        : ""}
                      {time(item.updatedAt)}
                    </small>
                  </span>
                  <span className="ticket-row-meta">
                    <Status value={item.status} admin={admin} />
                    <span className={`ticket-priority ${item.priority}`}>
                      Ưu tiên {priorities[item.priority]?.toLowerCase()}
                    </span>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          )}
          {data?.total > 0 && (
            <footer className="ticket-pagination">
              <span>
                {(page - 1) * (data.pageSize || 20) + 1}–
                {Math.min(page * (data.pageSize || 20), data.total)} trong{" "}
                {data.total} yêu cầu
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="Trang ticket trước"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>Trang {page}</span>
                <button
                  className="icon-button"
                  aria-label="Trang ticket sau"
                  disabled={page * (data.pageSize || 20) >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </footer>
          )}
        </div>
      )}
      {creating && (
        <CreateTicket
          api={api}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            go(`${route}/${id}`);
          }}
        />
      )}
    </section>
  );
}
