import React, { useEffect, useRef, useState } from "react";
import {
  Bell,
  ShieldCheck,
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Receipt,
  ScrollText,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Clock3,
  MessageSquare,
  ChevronDown,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Search,
  RefreshCw,
  Menu,
  X,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  LockKeyhole,
  TrendingUp,
  CircleDollarSign,
  Eye,
  Sparkles,
} from "lucide-react";
import "./admin.css";
import ErrorPage from "./ErrorPage.jsx";
import AdminSettings from "./AdminSettings.jsx";
import AdminDetails from "./AdminDetails.jsx";
import Tickets from "./Tickets.jsx";
import ActionMenu from "./ActionMenu.jsx";

const sections = [
  [
    "overview",
    "Tổng quan",
    LayoutDashboard,
    "Theo dõi hoạt động và thuê bao trên toàn hệ thống.",
  ],
  [
    "workspaces",
    "Doanh nghiệp",
    Building2,
    "Tra cứu thông tin liên hệ, thuê bao và hỗ trợ doanh nghiệp.",
  ],
  [
    "users",
    "Người dùng",
    Users,
    "Quản lý thông tin liên hệ và lịch sử hỗ trợ người dùng.",
  ],
  [
    "subscriptions",
    "Thuê bao",
    CreditCard,
    "Theo dõi gói dịch vụ, chu kỳ và thời hạn sử dụng.",
  ],
  [
    "orders",
    "Thanh toán",
    Receipt,
    "Tra cứu hóa đơn thuê bao và trạng thái từ BillGateway.",
  ],
  [
    "tickets",
    "Tickets hỗ trợ",
    MessageSquare,
    "Tiếp nhận và xử lý yêu cầu hỗ trợ khách hàng.",
  ],
  [
    "audit",
    "Nhật ký quản trị",
    ScrollText,
    "Mỗi thay đổi đều có người thực hiện, thời gian và lý do.",
  ],
  [
    "settings",
    "Cấu hình",
    Settings2,
    "Quản lý gói dịch vụ, thông tin ứng dụng và các kết nối hệ thống.",
  ],
];
export const adminRoutes = sections.map(([id]) => `admin/${id}`);
const formatMoney = (v) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(v || 0);
const date = (v, time = false) =>
  v
    ? new Date(v).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "—";
const plans = { starter: "Starter", team: "Team", business: "Business" };
const labels = {
  active: "Đang hoạt động",
  trialing: "Dùng thử",
  past_due: "Chờ gia hạn",
  expired: "Hết hạn",
  canceled: "Đã hủy",
  pending: "Chờ thanh toán",
  paid: "Đã thanh toán",
  failed: "Thất bại",
  refunded: "Đã hoàn tiền",
  suspended: "Tạm ngưng",
  disabled: "Đã khóa",
  admin: "Admin SaaS",
  open: "Mới tiếp nhận",
  in_progress: "Đang xử lý",
  waiting_customer: "Chờ khách phản hồi",
  resolved: "Đã giải quyết",
};
const actionLabels = {
  "workspace.suspend": "Tạm ngưng doanh nghiệp",
  "workspace.reactivate": "Mở lại doanh nghiệp",
  "user.disable": "Khóa tài khoản",
  "user.reactivate": "Mở lại tài khoản",
  "subscription.update": "Điều chỉnh thuê bao",
  "admin.grant": "Cấp quyền admin",
  "admin.revoke": "Thu hồi quyền admin",
  "user.profile.update": "Cập nhật hồ sơ người dùng",
  "workspace.profile.update": "Cập nhật thông tin doanh nghiệp",
  "settings.update": "Cập nhật cấu hình nền tảng",
  "storage.update": "Cập nhật lưu trữ tệp",
  "ticket.reply": "Phản hồi yêu cầu hỗ trợ",
  "ticket.update": "Cập nhật yêu cầu hỗ trợ",
};
function Badge({ value }) {
  return (
    <span className={`admin-badge badge-${value}`}>
      <i />
      {labels[value] || value}
    </span>
  );
}
function Identity({ name, sub, icon: Icon = Building2 }) {
  return (
    <div className="admin-identity">
      <span className="admin-identity-icon">
        <Icon size={17} />
      </span>
      <span>
        <strong>{name || "—"}</strong>
        <small>{sub || "—"}</small>
      </span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function isoInput(value) {
  const d = new Date(value);
  return Number.isNaN(+d)
    ? ""
    : new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function Admin({ page, me, api, go }) {
  const section = page.split("?")[0].split("/")[1] || "overview";
  const ticketFilters = new URLSearchParams(page.split("?")[1] || "");
  const detailId = ["users", "workspaces"].includes(section)
    ? page.split("/")[2]
    : null;
  const [planNames, setPlanNames] = useState(plans);
  const [mobile, setMobile] = useState(false),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [index, setIndex] = useState(1);
  const [result, setResult] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState(null),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [toast, setToast] = useState("");
  useEffect(() => {
    let canceled = false;
    api("/admin/settings")
      .then((data) => {
        if (!canceled)
          setPlanNames(
            Object.fromEntries(data.plans.map((p) => [p.id, p.name])),
          );
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [api, revision]);
  const dialogRef = useRef(null),
    previousFocus = useRef(null),
    savingRef = useRef(false);
  savingRef.current = saving;
  const current = sections.find(([id]) => id === section) || sections[0];
  const isList = !["overview", "settings", "tickets"].includes(section);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(q);
      setIndex(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    setQ("");
    setQuery("");
    setStatus("");
    setIndex(1);
    setMobile(false);
    setDialog(null);
  }, [section, detailId]);
  useEffect(() => {
    if (detailId || section === "tickets") {
      setLoading(false);
      setError("");
      return;
    }
    let canceled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q: query,
      status,
      page: String(index),
    });
    api(`/admin/${section}${isList ? `?${params}` : ""}`)
      .then((data) => {
        if (!canceled) setResult(data);
      })
      .catch((e) => {
        if (!canceled)
          setError({ message: e.message, status: e.status || 500 });
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [section, detailId, query, status, index, revision]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!dialog) return;
    previousFocus.current = document.activeElement;
    dialogRef.current
      ?.querySelector(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
      )
      ?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !savingRef.current) setDialog(null);
      if (e.key !== "Tab") return;
      const nodes = [
        ...(dialogRef.current?.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary",
        ) || []),
      ];
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previousFocus.current?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    if (saving)
      dialogRef.current
        ?.querySelector(
          "textarea:not(:disabled), input:not(:disabled), select:not(:disabled)",
        )
        ?.focus();
  }, [saving]);
  function open(type, item) {
    setSaveError("");
    setDialog({ type, item });
  }
  function navigate(id) {
    setMobile(false);
    go(`admin/${id}`);
  }
  async function submit(e) {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    const { item, type } = dialog;
    let endpoint, payload;
    if (type === "subscription") {
      endpoint = `/subscriptions/${item.workspaceId}`;
      payload = {
        ...fields,
        currentPeriodEnd: new Date(fields.currentPeriodEnd).toISOString(),
      };
    } else if (type === "workspace") {
      endpoint = `/workspaces/${item.id}`;
      payload = { suspended: !item.suspendedAt, reason: fields.reason };
    } else {
      endpoint = `/users/${item.id}`;
      payload = { disabled: !item.disabledAt, reason: fields.reason };
    }
    setSaving(true);
    setSaveError("");
    try {
      await api(`/admin${endpoint}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setDialog(null);
      setRevision((v) => v + 1);
      setToast("Đã lưu thay đổi và ghi nhật ký quản trị.");
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const statusOptions =
    section === "workspaces"
      ? ["active", "suspended"]
      : section === "users"
        ? ["active", "disabled", "admin"]
        : section === "subscriptions"
          ? ["active", "trialing", "past_due", "expired", "canceled"]
          : section === "orders"
            ? ["pending", "paid", "failed", "refunded", "expired"]
            : [];
  const items = result?.items || [];
  if (
    !detailId &&
    section !== "tickets" &&
    error &&
    ([401, 403, 429].includes(error.status) || error.status >= 500)
  )
    return (
      <ErrorPage
        code={error.status}
        onBack={() => go("dashboard")}
        onRetry={() => setRevision((v) => v + 1)}
        onLogin={() => location.reload()}
      />
    );
  return (
    <div className="app-shell admin-shell">
      <aside className={`sidebar admin-sidebar ${mobile ? "open" : ""}`}>
        <a
          href="/admin/overview"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Bell size={22} />
            <i />
          </span>
          nhắc tôi<span className="brand-dot">.</span>
        </a>
        <div className="admin-context">
          <span>
            <ShieldCheck size={20} />
          </span>
          <div>
            <strong>Quản trị SaaS</strong>
            <small>Toàn bộ nền tảng</small>
          </div>
          <span className="admin-live" />
        </div>
        <div className="nav-caption">QUẢN LÝ NỀN TẢNG</div>
        <nav aria-label="Quản trị SaaS">
          {sections.map(([id, name, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="admin-access-note">
            <LockKeyhole size={17} />
            <p>
              Quyền quản trị riêng biệt.
              <br />
              Thay đổi được lưu nhật ký.
            </p>
          </div>
          <button className="billing-nav" onClick={() => go("dashboard")}>
            <ArrowLeft size={17} /> Về không gian làm việc
          </button>
          <div className="profile">
            <span className="avatar tone-0">
              <ShieldCheck size={19} />
            </span>
            <div>
              <strong>{me.user.name}</strong>
              <small>Quản trị viên SaaS</small>
            </div>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Mở menu quản trị"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Quản trị SaaS</span>
            <ChevronRight size={14} />
            <strong>{current[1]}</strong>
          </div>
          <span className="admin-top-label">
            <ShieldCheck size={15} /> Nền tảng Nhắc tôi
          </span>
        </header>
        <div className="page-content admin-content">
          {!detailId && section !== "tickets" && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">NHẮC TÔI / ADMIN</div>
                <h1>
                  {section === "overview" ? "Tổng quan nền tảng" : current[1]}
                </h1>
                <p>{current[3]}</p>
              </div>
              <ActionMenu
                label={`Thao tác ${current[1].toLowerCase()}`}
                items={[
                  {
                    label: "Làm mới",
                    icon: RefreshCw,
                    onSelect: () => setRevision((v) => v + 1),
                    disabled: loading,
                  },
                ]}
              />
            </div>
          )}
          {isList && !detailId && (
            <div className="admin-toolbar">
              <label className="admin-search">
                <Search size={18} />
                <input
                  aria-label="Tìm kiếm quản trị"
                  placeholder={
                    section === "orders"
                      ? "Tìm mã hóa đơn, doanh nghiệp…"
                      : section === "audit"
                        ? "Tìm hành động, người thực hiện, lý do…"
                        : "Tìm theo tên hoặc email…"
                  }
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button aria-label="Xóa tìm kiếm" onClick={() => setQ("")}>
                    <X size={16} />
                  </button>
                )}
              </label>
              {statusOptions.length > 0 && (
                <select
                  aria-label="Lọc trạng thái"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setIndex(1);
                  }}
                >
                  <option value="">Tất cả trạng thái</option>
                  {statusOptions.map((v) => (
                    <option key={v} value={v}>
                      {labels[v]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {section === "tickets" ? (
            <Tickets
              key={page}
              mode="admin"
              api={api}
              go={go}
              ticketId={page.split("?")[0].split("/")[2] || null}
              workspaceId={ticketFilters.get("workspaceId") || ""}
              userId={ticketFilters.get("userId") || ""}
            />
          ) : detailId ? (
            <AdminDetails
              key={`${section}/${detailId}`}
              planNames={planNames}
              kind={section}
              id={detailId}
              api={api}
              go={go}
              me={me}
              onChanged={() => setRevision((v) => v + 1)}
            />
          ) : error ? (
            <div className="admin-state" role="alert">
              <AlertCircle size={30} />
              <h2>Chưa tải được dữ liệu</h2>
              <p>{error.message}</p>
              <button
                className="button secondary"
                onClick={() => setRevision((v) => v + 1)}
              >
                Thử lại
              </button>
            </div>
          ) : loading ? (
            <div className="admin-state" role="status">
              <LoaderCircle className="spin" size={28} />
              <p>Đang tải dữ liệu quản trị…</p>
            </div>
          ) : (
            result && (
              <>
                {section === "overview" && (
                  <Overview
                    data={result}
                    navigate={navigate}
                    planNames={planNames}
                  />
                )}
                {section === "settings" && (
                  <AdminSettings
                    data={result}
                    api={api}
                    onSaved={(data) => {
                      setResult(data);
                      setPlanNames(
                        Object.fromEntries(
                          data.plans.map((p) => [p.id, p.name]),
                        ),
                      );
                      setToast("Đã lưu cấu hình và ghi nhật ký quản trị.");
                    }}
                    openPreview={() => go("errors")}
                  />
                )}
                {isList && (
                  <section className="panel admin-list">
                    <div className="admin-list-heading">
                      <h2>
                        {current[1]}{" "}
                        <span className="count-pill">{result.total || 0}</span>
                      </h2>
                      <span>Dữ liệu toàn hệ thống</span>
                    </div>
                    {items.length ? (
                      <div className="admin-table-wrap" role="region" aria-label="Bảng dữ liệu quản trị, cuộn ngang để xem thêm" tabIndex={0}>
                        <table className="admin-table">
                          <thead>
                            <tr>
                              {(section === "workspaces"
                                ? [
                                    "Doanh nghiệp",
                                    "Đầu mối liên hệ",
                                    "Thuê bao",
                                    "Trạng thái",
                                    "",
                                  ]
                                : section === "users"
                                  ? [
                                      "Người dùng",
                                      "Quyền",
                                      "Doanh nghiệp",
                                      "Ngày tạo",
                                      "Trạng thái",
                                      "",
                                    ]
                                  : section === "subscriptions"
                                    ? [
                                        "Doanh nghiệp",
                                        "Gói dịch vụ",
                                        "Chu kỳ",
                                        "Hết hạn",
                                        "Trạng thái",
                                        "",
                                      ]
                                    : section === "orders"
                                      ? [
                                          "Hóa đơn / Doanh nghiệp",
                                          "Gói / Chu kỳ",
                                          "Số tiền",
                                          "Trạng thái",
                                          "Ngày tạo",
                                          "",
                                        ]
                                      : [
                                          "Thời gian",
                                          "Người thực hiện",
                                          "Hành động",
                                          "Lý do",
                                          "",
                                        ]
                              ).map((h, i) => (
                                <th key={i} scope="col">
                                  {h || (
                                    <span className="sr-only">Thao tác</span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.id || item.workspaceId}>
                                {section === "workspaces" && (
                                  <>
                                    <td>
                                      <a
                                        className="admin-identity-link"
                                        href={`/admin/workspaces/${encodeURIComponent(item.id)}`}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          go(`admin/workspaces/${encodeURIComponent(item.id)}`);
                                        }}
                                      >
                                        <Identity
                                          name={item.name}
                                          sub={
                                            item.industry ||
                                            "Chưa đặt ngành nghề"
                                          }
                                        />
                                      </a>
                                    </td>
                                    <td>
                                      <strong>{item.ownerName || "—"}</strong>
                                      <small>{item.ownerEmail}</small>
                                    </td>
                                    <td>
                                      <strong>
                                        {planNames[item.plan] || "—"}
                                      </strong>
                                      <small>
                                        {labels[item.subscriptionStatus] ||
                                          "Chưa có thuê bao"}
                                      </small>
                                    </td>
                                    <td>
                                      <Badge
                                        value={
                                          item.suspendedAt
                                            ? "suspended"
                                            : "active"
                                        }
                                      />
                                    </td>
                                    <td>
                                      <ActionMenu
                                        label={`Thao tác với doanh nghiệp ${item.name || ""}`}
                                        items={[
                                          {
                                            label: "Chi tiết",
                                            icon: Eye,
                                            onSelect: () =>
                                              go(
                                                `admin/workspaces/${encodeURIComponent(item.id)}`,
                                              ),
                                          },
                                        ]}
                                      />
                                    </td>
                                  </>
                                )}
                                {section === "users" && (
                                  <>
                                    <td>
                                      <a
                                        className="admin-identity-link"
                                        href={`/admin/users/${encodeURIComponent(item.id)}`}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          go(`admin/users/${encodeURIComponent(item.id)}`);
                                        }}
                                      >
                                        <Identity
                                          name={item.name}
                                          sub={item.email}
                                          icon={Users}
                                        />
                                      </a>
                                    </td>
                                    <td>
                                      {item.isPlatformAdmin ? (
                                        <span className="admin-role">
                                          <ShieldCheck size={14} /> Admin SaaS
                                        </span>
                                      ) : (
                                        "Người dùng"
                                      )}
                                    </td>
                                    <td>{item.workspaceCount}</td>
                                    <td>{date(item.createdAt)}</td>
                                    <td>
                                      <Badge
                                        value={
                                          item.disabledAt
                                            ? "disabled"
                                            : "active"
                                        }
                                      />
                                    </td>
                                    <td>
                                      <ActionMenu
                                        label={`Thao tác với người dùng ${item.name || item.email || ""}`}
                                        items={[
                                          {
                                            label: "Chi tiết",
                                            icon: Eye,
                                            onSelect: () =>
                                              go(
                                                `admin/users/${encodeURIComponent(item.id)}`,
                                              ),
                                          },
                                        ]}
                                      />
                                    </td>
                                  </>
                                )}
                                {section === "subscriptions" && (
                                  <>
                                    <td>
                                      <Identity
                                        name={item.workspaceName}
                                        sub={`${item.memberCount} chỗ sử dụng`}
                                      />
                                    </td>
                                    <td>
                                      <span className="admin-plan">
                                        {planNames[item.plan]}
                                      </span>
                                    </td>
                                    <td>
                                      {item.cycle === "yearly"
                                        ? "Hàng năm"
                                        : "Hàng tháng"}
                                    </td>
                                    <td>{date(item.currentPeriodEnd, true)}</td>
                                    <td>
                                      <Badge value={item.status} />
                                    </td>
                                    <td>
                                      <ActionMenu
                                        label={`Thao tác với thuê bao ${item.workspaceName || ""}`}
                                        items={[
                                          {
                                            label: "Điều chỉnh",
                                            icon: CreditCard,
                                            onSelect: () =>
                                              open("subscription", item),
                                          },
                                        ]}
                                      />
                                    </td>
                                  </>
                                )}
                                {section === "orders" && (
                                  <>
                                    <td>
                                      <strong>{item.workspaceName}</strong>
                                      <small
                                        className="admin-mono"
                                        title={item.id}
                                      >
                                        {item.id}
                                      </small>
                                    </td>
                                    <td>
                                      <strong>{planNames[item.plan]}</strong>
                                      <small>
                                        {item.cycle === "yearly"
                                          ? "Theo năm"
                                          : "Theo tháng"}
                                      </small>
                                    </td>
                                    <td className="admin-money">
                                      {formatMoney(item.amount)}
                                    </td>
                                    <td>
                                      <Badge value={item.status} />
                                    </td>
                                    <td>{date(item.createdAt, true)}</td>
                                    <td>
                                      <ActionMenu
                                        label={`Thao tác với hóa đơn ${item.id || ""}`}
                                        items={[
                                          {
                                            label: "Chi tiết",
                                            icon: Eye,
                                            onSelect: () => open("order", item),
                                          },
                                        ]}
                                      />
                                    </td>
                                  </>
                                )}
                                {section === "audit" && (
                                  <>
                                    <td>{date(item.createdAt, true)}</td>
                                    <td>
                                      <strong>
                                        {item.actorName || "Hệ thống / CLI"}
                                      </strong>
                                      <small>
                                        {item.actorEmail ||
                                          "Cấp quyền qua máy chủ"}
                                      </small>
                                    </td>
                                    <td>
                                      <strong>
                                        {actionLabels[item.action] ||
                                          item.action}
                                      </strong>
                                      <small title={item.targetId}>
                                        {item.targetName ||
                                          (item.targetType === "settings"
                                            ? "Cấu hình nền tảng"
                                            : item.targetId)}
                                      </small>
                                    </td>
                                    <td className="admin-reason">
                                      {item.reason}
                                    </td>
                                    <td>
                                      <ActionMenu
                                        label={`Thao tác nhật ký ${item.id || item.targetName || ""}`}
                                        items={[
                                          {
                                            label: "Chi tiết",
                                            icon: Eye,
                                            onSelect: () => open("audit", item),
                                          },
                                        ]}
                                      />
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="admin-state compact">
                        <Search size={28} />
                        <h3>Chưa có kết quả</h3>
                        <p>
                          {q || status
                            ? "Thử đổi từ khóa hoặc bộ lọc để tìm dữ liệu."
                            : "Dữ liệu sẽ xuất hiện khi có hoạt động trên nền tảng."}
                        </p>
                        {(q || status) && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setQ("");
                              setStatus("");
                              setIndex(1);
                            }}
                          >
                            Xóa bộ lọc
                          </button>
                        )}
                      </div>
                    )}
                    <div className="admin-pagination">
                      <span>
                        {result.total
                          ? `${(index - 1) * (result.pageSize || 20) + 1}–${Math.min(index * (result.pageSize || 20), result.total)} trong ${result.total} bản ghi`
                          : "0 bản ghi"}
                      </span>
                      <div>
                        <button
                          className="icon-button"
                          aria-label="Trang trước"
                          disabled={index === 1}
                          onClick={() => setIndex((n) => n - 1)}
                        >
                          <ChevronLeft size={17} />
                        </button>
                        <span>Trang {index}</span>
                        <button
                          className="icon-button"
                          aria-label="Trang sau"
                          disabled={
                            index * (result.pageSize || 20) >= result.total
                          }
                          onClick={() => setIndex((n) => n + 1)}
                        >
                          <ChevronRight size={17} />
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )
          )}
          <div className="admin-footer">
            <ShieldCheck size={14} />
            <span>Khu vực quản trị nền tảng · Nhắc tôi</span>
            <span>Giờ hiển thị theo thiết bị của bạn</span>
          </div>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setDialog(null);
          }}
        >
          <section
            ref={dialogRef}
            className={`modal admin-modal ${dialog.type === "audit" ? "audit-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-dialog-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">QUẢN TRỊ SAAS</span>
                <h2 id="admin-dialog-title">
                  {dialog.type === "workspace"
                    ? dialog.item.suspendedAt
                      ? "Mở lại doanh nghiệp"
                      : "Quản lý doanh nghiệp"
                    : dialog.type === "user"
                      ? dialog.item.disabledAt
                        ? "Mở khóa tài khoản"
                        : "Khóa tài khoản"
                      : dialog.type === "subscription"
                        ? "Điều chỉnh thuê bao"
                        : dialog.type === "order"
                          ? "Chi tiết hóa đơn"
                          : "Chi tiết nhật ký"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Đóng hộp thoại"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                <X size={21} />
              </button>
            </div>
            {["order", "audit"].includes(dialog.type) ? (
              <ReadDetail
                planNames={planNames}
                type={dialog.type}
                item={dialog.item}
                onClose={() => setDialog(null)}
              />
            ) : (
              <form onSubmit={submit}>
                <div className="admin-dialog-context">
                  <strong>
                    {dialog.item.name || dialog.item.workspaceName}
                  </strong>
                  <span>
                    {dialog.item.email ||
                      dialog.item.ownerEmail ||
                      planNames[dialog.item.plan]}
                  </span>
                </div>
                {dialog.type === "subscription" ? (
                  <>
                    <div className="form-grid">
                      <Field label="Gói dịch vụ">
                        <select name="plan" defaultValue={dialog.item.plan}>
                          {Object.entries(planNames).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Chu kỳ">
                        <select name="cycle" defaultValue={dialog.item.cycle}>
                          <option value="monthly">Hàng tháng</option>
                          <option value="yearly">Hàng năm</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Trạng thái thuê bao">
                      <select name="status" defaultValue={dialog.item.status}>
                        {[
                          "active",
                          "trialing",
                          "past_due",
                          "expired",
                          "canceled",
                        ].map((s) => (
                          <option key={s} value={s}>
                            {labels[s]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Hết hạn (giờ thiết bị)">
                      <input
                        type="datetime-local"
                        name="currentPeriodEnd"
                        required
                        defaultValue={isoInput(dialog.item.currentPeriodEnd)}
                      />
                    </Field>
                    <p className="admin-warning">
                      Điều chỉnh quyền sử dụng trực tiếp. Thao tác này không tạo
                      hóa đơn và không ghi nhận doanh thu thanh toán.
                    </p>
                  </>
                ) : (
                  <p className="admin-warning">
                    {dialog.type === "workspace"
                      ? dialog.item.suspendedAt
                        ? "Doanh nghiệp sẽ có thể tiếp tục cập nhật dữ liệu và nhận lời nhắc theo thời hạn thuê bao."
                        : "Tạm ngưng sẽ chặn cập nhật công việc, khách hàng, thu chi và dừng gửi lời nhắc. Thành viên vẫn được xem dữ liệu và thanh toán thuê bao."
                      : dialog.item.disabledAt
                        ? "Người dùng sẽ có thể đăng nhập lại. Các phiên đã thu hồi không được khôi phục."
                        : "Tài khoản sẽ bị chặn đăng nhập và thu hồi các phiên đang hoạt động. Dữ liệu của người dùng được giữ lại."}
                  </p>
                )}
                <Field label="Lý do thay đổi *">
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                    rows={3}
                    placeholder="Ghi rõ lý do để lưu vào nhật ký quản trị…"
                  />
                </Field>
                {saveError && (
                  <div className="admin-form-error" role="alert">
                    <AlertCircle size={17} />
                    {saveError}
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={saving}
                    onClick={() => setDialog(null)}
                  >
                    Hủy
                  </button>
                  <button className="button" disabled={saving}>
                    {saving ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    {saving
                      ? "Đang lưu…"
                      : dialog.type === "workspace"
                        ? dialog.item.suspendedAt
                          ? "Mở lại doanh nghiệp"
                          : "Tạm ngưng doanh nghiệp"
                        : dialog.type === "user"
                          ? dialog.item.disabledAt
                            ? "Mở khóa tài khoản"
                            : "Khóa tài khoản"
                          : "Lưu điều chỉnh"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Overview({ data, navigate, planNames = plans }) {
  const stats = data.stats || {};
  return (
    <>
      <div className="admin-overview-banner">
        <div>
          <span className="eyebrow">MỘT GÓC NHÌN, TOÀN BỘ NỀN TẢNG</span>
          <h2>Mỗi doanh nghiệp, một nhịp làm việc.</h2>
          <p>Theo dõi tăng trưởng và giữ dịch vụ vận hành thông suốt.</p>
        </div>
        <div className="admin-banner-icon">
          <Building2 size={42} />
          <span>
            <ShieldCheck size={23} />
          </span>
        </div>
      </div>
      <div className="admin-metrics">
        {[
          [
            "Doanh nghiệp",
            stats.workspaces,
            `${stats.suspendedWorkspaces || 0} không gian tạm ngưng`,
            Building2,
            "workspaces",
          ],
          [
            "Người dùng",
            stats.users,
            "Tổng tài khoản trên nền tảng",
            Users,
            "users",
          ],
          [
            "Thuê bao hiệu lực",
            stats.activeSubscriptions,
            "Gói đang hoạt động, còn thời hạn",
            CreditCard,
            "subscriptions",
          ],
          [
            "MRR ước tính",
            formatMoney(stats.mrr),
            "Gói năm quy đổi về một tháng",
            TrendingUp,
            "subscriptions",
          ],
        ].map(([title, value, hint, Icon, target]) => (
          <button
            className="admin-metric"
            key={title}
            onClick={() => navigate(target)}
          >
            <div>
              <span>{title}</span>
              <Icon size={19} />
            </div>
            <strong>{value || 0}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      <div className="admin-revenue-strip">
        <div>
          <span className="admin-revenue-icon">
            <CircleDollarSign size={23} />
          </span>
          <span>
            <small>Thanh toán đã xác nhận · Toàn thời gian</small>
            <strong>{formatMoney(stats.paidRevenue)}</strong>
          </span>
        </div>
        <button onClick={() => navigate("orders")}>
          <span>
            <b>{stats.pendingOrders || 0}</b> hóa đơn chờ thanh toán
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
      <div className="admin-overview-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Doanh nghiệp mới</h2>
              <p>Những không gian vừa tham gia</p>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("workspaces")}
            >
              Xem tất cả
              <ArrowUpRight size={15} />
            </button>
          </div>
          {data.recentWorkspaces?.length ? (
            data.recentWorkspaces.map((w) => (
              <div className="admin-recent" key={w.id}>
                <Identity
                  name={w.name}
                  sub={w.ownerEmail || w.industry || date(w.createdAt)}
                />
                <span className="admin-plan">
                  {planNames[w.plan] || "Dùng thử"}
                </span>
              </div>
            ))
          ) : (
            <div className="admin-state compact">
              <Building2 size={26} />
              <p>Chưa có doanh nghiệp.</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Thanh toán gần đây</h2>
              <p>Trạng thái đồng bộ từ BillGateway</p>
            </div>
            <button className="text-button" onClick={() => navigate("orders")}>
              Tra cứu
              <ArrowUpRight size={15} />
            </button>
          </div>
          {data.recentOrders?.length ? (
            data.recentOrders.map((o) => (
              <div className="admin-recent" key={o.id}>
                <div>
                  <strong>{o.workspaceName}</strong>
                  <small>
                    {planNames[o.plan]} · {date(o.createdAt)}
                  </small>
                </div>
                <div className="admin-recent-right">
                  <strong>{formatMoney(o.amount)}</strong>
                  <Badge value={o.status} />
                </div>
              </div>
            ))
          ) : (
            <div className="admin-state compact">
              <Receipt size={27} />
              <h3>Chưa có thanh toán</h3>
              <p>Hóa đơn thuê bao mới sẽ xuất hiện tại đây.</p>
            </div>
          )}
        </section>
      </div>
      <p className="admin-metric-note">
        MRR dùng giá gói hiện tại của thuê bao active còn hạn, chưa gồm dùng
        thử. Đây là chỉ số ước tính; số tiền đã thu lấy từ hóa đơn được xác
        nhận.
      </p>
    </>
  );
}
function ReadDetail({ type, item, onClose, planNames = plans }) {
  if (type === "order")
    return (
      <div className="admin-detail">
        <dl>
          {[
            ["Mã hóa đơn", item.id],
            ["Doanh nghiệp", item.workspaceName],
            [
              "Gói dịch vụ",
              `${planNames[item.plan]} · ${item.cycle === "yearly" ? "Hàng năm" : "Hàng tháng"}`,
            ],
            ["Số tiền", formatMoney(item.amount)],
            ["Trạng thái", labels[item.status]],
            ["Mã BillGateway", item.providerPaymentId || "Chưa có"],
            ["Ngày tạo", date(item.createdAt, true)],
            ["Đã thanh toán lúc", date(item.paidAt, true)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="admin-warning">
          Trạng thái thanh toán chỉ được xác nhận qua BillGateway. Điều chỉnh
          thuê bao thủ công không thay đổi hóa đơn.
        </p>
      </div>
    );
  return <AuditDetail item={item} onClose={onClose} />;
}

const auditFields = {
  changedSecretFields: "Khóa kết nối đã cập nhật",
  name: "Tên hiển thị",
  email: "Email",
  industry: "Ngành nghề",
  contactEmail: "Email liên hệ",
  phone: "Số điện thoại",
  address: "Địa chỉ",
  website: "Website",
  taxCode: "Mã số thuế",
  note: "Ghi chú hỗ trợ",
  publicAppUrl: "Địa chỉ ứng dụng",
  localPath: "Thư mục lưu tệp",
  maxFileSizeMb: "Dung lượng tối đa mỗi tệp (MB)",
  apiUrl: "Địa chỉ API",
  projectId: "Mã dự án",
  hasApiKey: "Khóa API",
  hasWebhookSecret: "Khóa webhook",
  host: "Máy chủ SMTP",
  port: "Cổng SMTP",
  secure: "SSL/TLS trực tiếp",
  user: "Tên đăng nhập SMTP",
  from: "Người gửi",
  hasPassword: "Mật khẩu SMTP",
  enabled: "Gửi email",
  monthly: "Giá tháng",
  yearly: "Giá năm",
  seats: "Giới hạn thành viên",
  suspendedAt: "Trạng thái doanh nghiệp",
  disabledAt: "Trạng thái tài khoản",
  isPlatformAdmin: "Quyền quản trị",
  plan: "Gói dịch vụ",
  cycle: "Chu kỳ thanh toán",
  status: "Trạng thái",
  priority: "Mức ưu tiên",
  messageId: "Mã phản hồi",
  currentPeriodEnd: "Ngày hết hạn",
};
function auditValue(key, value) {
  key = key.split(".").at(-1);
  if (key === "changedSecretFields")
    return {
      label: Array.isArray(value)
        ? value
            .map(
              (field) =>
                ({
                  "billgateway.apiKey": "Khóa API BillGateway",
                  "billgateway.webhookSecret": "Khóa webhook",
                  "smtp.password": "Mật khẩu SMTP",
                })[field] || field,
            )
            .join(", ")
        : "Không thay đổi",
      tone: "neutral",
    };
  if (["monthly", "yearly"].includes(key))
    return { label: formatMoney(value), tone: "neutral" };
  if (["hasApiKey", "hasWebhookSecret", "hasPassword"].includes(key))
    return {
      label: value ? "Đã lưu" : "Chưa thiết lập",
      tone: value ? "good" : "neutral",
    };
  if (value === undefined) return { label: "Chưa ghi nhận", tone: "neutral" };
  if (key === "suspendedAt" || key === "disabledAt")
    return value
      ? {
          label: key === "suspendedAt" ? "Tạm ngưng" : "Đã khóa",
          detail: `Từ ${date(value, true)}`,
          tone: "warning",
        }
      : { label: "Đang hoạt động", tone: "good" };
  if (key === "isPlatformAdmin")
    return {
      label: value ? "Quản trị viên SaaS" : "Người dùng",
      tone: value ? "accent" : "neutral",
    };
  if (value === null || value === "")
    return { label: "Chưa thiết lập", tone: "neutral" };
  if (key === "plan")
    return { label: plans[value] || String(value), tone: "accent" };
  if (key === "cycle")
    return {
      label:
        value === "monthly"
          ? "Hàng tháng"
          : value === "yearly"
            ? "Hàng năm"
            : String(value),
      tone: "neutral",
    };
  if (key === "status")
    return {
      label: labels[value] || String(value),
      tone: ["active", "trialing"].includes(value) ? "good" : "warning",
    };
  if (key === "priority")
    return {
      label:
        { low: "Thấp", normal: "Bình thường", high: "Cao" }[value] ||
        String(value),
      tone: value === "high" ? "warning" : "neutral",
    };
  if (key === "currentPeriodEnd")
    return { label: date(value, true), tone: "neutral" };
  return {
    label:
      typeof value === "boolean"
        ? value
          ? "Có"
          : "Không"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
    tone: "neutral",
  };
}
function flattenAudit(value, prefix = "") {
  const result = {};
  for (const [key, entry] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object") {
      if (
        Array.isArray(entry) &&
        entry.every((child) => typeof child !== "object" || child === null)
      )
        result[path] = entry;
      else if (Array.isArray(entry))
        for (const child of entry) {
          if (child && typeof child === "object")
            Object.assign(
              result,
              flattenAudit(child, `${path}.${child.id || "item"}`),
            );
        }
      else Object.assign(result, flattenAudit(entry, path));
    } else result[path] = entry;
  }
  return result;
}
function auditFieldLabel(key) {
  const parts = key.split(".");
  const field = auditFields[parts.at(-1)] || parts.at(-1);
  if (parts[0] === "plans") return `${plans[parts[1]] || parts[1]} · ${field}`;
  if (parts[0] === "billgateway") return `BillGateway · ${field}`;
  if (parts[0] === "smtp") return `Email · ${field}`;
  return field;
}
function AuditDetail({ item, onClose }) {
  const before = flattenAudit(
    item.before && typeof item.before === "object" ? item.before : {},
  );
  const after = flattenAudit(
    item.after && typeof item.after === "object" ? item.after : {},
  );
  const changed = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const targetType =
    item.targetType === "workspace"
      ? "Doanh nghiệp"
      : item.targetType === "user"
        ? "Tài khoản"
        : item.targetType === "settings"
          ? "Cấu hình nền tảng"
          : item.targetType === "ticket"
            ? "Yêu cầu hỗ trợ"
            : "Đối tượng";
  const actor = item.actorName || item.actorEmail || "Quản trị hệ thống";
  const initials = actor
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="audit-detail">
      <div className="audit-event-summary">
        <span className="audit-event-icon">
          <ScrollText size={23} />
        </span>
        <div>
          <h3>{actionLabels[item.action] || "Cập nhật thông tin"}</h3>
          <p>
            {targetType}
            <span>·</span>
            <strong>
              {item.targetName ||
                (item.targetType === "settings"
                  ? "Nhắc tôi"
                  : "Tên không còn khả dụng")}
            </strong>
          </p>
        </div>
        <span className="audit-recorded">
          <CheckCircle2 size={12} /> Đã ghi nhận
        </span>
      </div>
      <div className="audit-meta-grid">
        <div className="audit-meta-person">
          <span className="audit-avatar" aria-hidden="true">
            {item.actorName || item.actorEmail ? (
              initials
            ) : (
              <ShieldCheck size={18} />
            )}
          </span>
          <div>
            <span className="audit-label">Người thực hiện</span>
            <strong>{actor}</strong>
            <small>{item.actorEmail || "Thực hiện qua máy chủ"}</small>
          </div>
        </div>
        <div className="audit-meta-time">
          <Clock3 size={19} />
          <div>
            <span className="audit-label">Thời gian thực hiện</span>
            <strong>{date(item.createdAt, true)}</strong>
            <small>Theo giờ trên thiết bị</small>
          </div>
        </div>
      </div>
      <div className="audit-reason-box">
        <MessageSquare size={17} />
        <div>
          <span className="audit-label">Lý do thay đổi</span>
          <p>{item.reason || "Không có lý do được ghi lại."}</p>
        </div>
      </div>
      <section className="audit-changes" aria-label="Nội dung thay đổi">
        <div className="audit-section-heading">
          <h3>Nội dung thay đổi</h3>
          <span>
            {changed.length
              ? `${changed.length} cập nhật`
              : "Không đổi dữ liệu"}
          </span>
        </div>
        {changed.length ? (
          changed.map((key) => (
            <div className="audit-change" key={key}>
              <h4>{item.action === "storage.update" && key === "enabled" ? "Cho phép tải tệp" : auditFieldLabel(key)}</h4>
              <div className="audit-comparison">
                {[before, after].map((snapshot, index) => {
                  const value = auditValue(key, snapshot[key]);
                  return (
                    <React.Fragment key={index}>
                      {index === 1 && (
                        <ArrowRight
                          size={18}
                          className="audit-change-arrow"
                          aria-hidden="true"
                        />
                      )}
                      <div
                        className={`audit-value ${index === 1 ? "is-after" : ""}`}
                      >
                        <span className="audit-value-caption">
                          {index === 0 ? "Trước thay đổi" : "Sau thay đổi"}
                        </span>
                        <strong className={`audit-value-${value.tone}`}>
                          <i />
                          {value.label}
                        </strong>
                        {value.detail && <small>{value.detail}</small>}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <p className="audit-no-change">
            Dữ liệu được giữ nguyên. Thao tác vẫn được lưu lại trong nhật ký.
          </p>
        )}
      </section>
      <details className="audit-technical">
        <summary>
          <span>Thông tin kỹ thuật</span>
          <ChevronDown size={16} />
        </summary>
        <div className="audit-technical-body">
          <dl>
            <div>
              <dt>Mã nhật ký</dt>
              <dd>{item.id}</dd>
            </div>
            <div>
              <dt>Mã đối tượng</dt>
              <dd>{item.targetId}</dd>
            </div>
            <div>
              <dt>Loại thao tác</dt>
              <dd>{item.action}</dd>
            </div>
          </dl>
          <div className="admin-audit-diff">
            {[
              ["Dữ liệu trước", item.before],
              ["Dữ liệu sau", item.after],
            ].map(([label, value]) => (
              <div key={label}>
                <h3>{label}</h3>
                <pre>{JSON.stringify(value ?? null, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      </details>
      <div className="audit-detail-footer">
        <span>
          <ShieldCheck size={14} /> Bản ghi chỉ xem
        </span>
        <button className="button" onClick={onClose}>
          <CheckCircle2 size={16} /> Đã hiểu
        </button>
      </div>
    </div>
  );
}
