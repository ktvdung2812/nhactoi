import React, { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  ExternalLink,
  Mail,
  Pencil,
  Phone,
  Plus,
  Repeat2,
  Trash2,
  Users,
  Wallet,
  Briefcase,
  Layers,
} from "lucide-react";
import "./customer-detail.css";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };

const money = (n) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);

const dateLabel = (d, options = { day: "2-digit", month: "2-digit", year: "numeric" }) =>
  d ? new Date(d).toLocaleDateString("vi-VN", options) : "Chưa đặt lịch";

function Avatar({ name = "?", index = 0, size = "normal" }) {
  const letters = name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
  return (
    <span className={`avatar tone-${index % 5} ${size === "large" ? "large" : size === "small" ? "small" : ""}`}>
      {letters || "?"}
    </span>
  );
}

export default function CustomerDetail({
  customerId,
  customers = [],
  tasks = [],
  services = [],
  transactions = [],
  members = [],
  teams = [],
  me,
  onBack,
  onEdit,
  onTrash,
  onTaskOpen,
  onTaskCreate,
  onTaskComplete,
}) {
  const [tab, setTab] = useState("tasks");
  const [taskFilter, setTaskFilter] = useState("all");

  const customerIndex = customers.findIndex((c) => c.id === customerId);
  const customer = customerIndex >= 0 ? customers[customerIndex] : null;

  if (!customer) {
    return (
      <div className="customer-detail-page not-found-state">
        <button className="customer-back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Quay lại danh sách khách hàng</span>
        </button>
        <div className="panel customer-empty-panel">
          <h3>Không tìm thấy thông tin khách hàng</h3>
          <p>Khách hàng có thể đã bị xóa hoặc không thuộc không gian làm việc này.</p>
          <button className="button" onClick={onBack}>
            Trở về danh sách
          </button>
        </div>
      </div>
    );
  }

  const role = me?.workspace?.role;
  const canManage = role === "owner" || role === "admin";
  const isSuspended = Boolean(me?.workspace?.suspendedAt);

  // Related data
  const customerTasks = tasks.filter((t) => t.customerId === customer.id);
  const openTasks = customerTasks.filter((t) => t.status !== "done");
  const doneTasks = customerTasks.filter((t) => t.status === "done");

  const filteredTasks = customerTasks.filter((t) => {
    if (taskFilter === "open") return t.status !== "done";
    if (taskFilter === "done") return t.status === "done";
    if (taskFilter === "todo") return t.status === "todo";
    if (taskFilter === "doing") return t.status === "doing";
    return true;
  });

  const customerServices = services.filter((s) => s.customerId === customer.id);
  const customerTransactions = transactions.filter((t) => t.customerId === customer.id);
  const totalIncome = customerTransactions
    .filter((t) => t.kind === "income" || t.kind === "in" || (!t.kind && Number(t.amount) > 0))
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const getPerson = (id) => members.find((m) => m.id === id);
  const getTeam = (id) => teams.find((tm) => tm.id === id);

  return (
    <div className="customer-detail-page">
      <div className="customer-detail-nav">
        <button className="customer-back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Quay lại danh sách khách hàng</span>
        </button>
      </div>

      {/* Customer Header Card */}
      <section className="panel customer-hero-card">
        <div className="customer-hero-main">
          <Avatar name={customer.name} index={customerIndex >= 0 ? customerIndex : 0} size="large" />
          <div className="customer-hero-info">
            <div className="customer-title-row">
              <h2>{customer.name}</h2>
              {customer.service && (
                <span className="service-tag">{customer.service}</span>
              )}
            </div>
            <p className="customer-company">
              <Briefcase size={15} />
              {customer.company || "Khách hàng cá nhân"}
            </p>
            <div className="customer-contacts">
              {customer.email ? (
                <a href={`mailto:${customer.email}`} className="customer-contact-link">
                  <Mail size={15} />
                  <span>{customer.email}</span>
                </a>
              ) : (
                <span className="customer-contact-item muted">
                  <Mail size={15} />
                  <span>Chưa có email</span>
                </span>
              )}
              {customer.phone ? (
                <a href={`tel:${customer.phone}`} className="customer-contact-link">
                  <Phone size={15} />
                  <span>{customer.phone}</span>
                </a>
              ) : (
                <span className="customer-contact-item muted">
                  <Phone size={15} />
                  <span>Chưa có số điện thoại</span>
                </span>
              )}
              {customer.createdAt && (
                <span className="customer-contact-item">
                  <CalendarDays size={15} />
                  <span>Tạo ngày {dateLabel(customer.createdAt)}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="customer-hero-actions">
          <button
            className="button secondary"
            onClick={() => onEdit?.(customer)}
            disabled={isSuspended || !canManage}
            title={!canManage ? "Chỉ chủ không gian hoặc quản trị viên mới có quyền chỉnh sửa" : undefined}
          >
            <Pencil size={15} />
            <span>Chỉnh sửa</span>
          </button>
          {canManage && !isSuspended && (
            <button
              className="button danger secondary"
              onClick={() => onTrash?.(customer)}
              title="Chuyển vào thùng rác"
            >
              <Trash2 size={15} />
              <span>Xóa</span>
            </button>
          )}
        </div>
      </section>

      {/* Stats Overview Grid */}
      <div className="customer-stats-grid">
        <div className="panel customer-stat-card">
          <div className="stat-icon-wrap primary">
            <CheckCheck size={20} />
          </div>
          <div>
            <span className="stat-label">Công việc đang mở</span>
            <strong className="stat-value">
              {openTasks.length} <small>/ {customerTasks.length}</small>
            </strong>
          </div>
        </div>

        <div className="panel customer-stat-card">
          <div className="stat-icon-wrap accent">
            <Layers size={20} />
          </div>
          <div>
            <span className="stat-label">Dịch vụ & Gia hạn</span>
            <strong className="stat-value">{customerServices.length}</strong>
          </div>
        </div>

        {canManage && (
          <div className="panel customer-stat-card">
            <div className="stat-icon-wrap success">
              <Wallet size={20} />
            </div>
            <div>
              <span className="stat-label">Tổng thu từ khách hàng</span>
              <strong className="stat-value">{money(totalIncome)}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="customer-tabs-bar">
        <button
          className={`customer-tab-btn ${tab === "tasks" ? "active" : ""}`}
          onClick={() => setTab("tasks")}
        >
          <CheckCheck size={16} />
          <span>Công việc ({customerTasks.length})</span>
        </button>
        <button
          className={`customer-tab-btn ${tab === "services" ? "active" : ""}`}
          onClick={() => setTab("services")}
        >
          <CalendarDays size={16} />
          <span>Dịch vụ ({customerServices.length})</span>
        </button>
        {canManage && (
          <button
            className={`customer-tab-btn ${tab === "finance" ? "active" : ""}`}
            onClick={() => setTab("finance")}
          >
            <Wallet size={16} />
            <span>Thu & chi ({customerTransactions.length})</span>
          </button>
        )}
      </div>

      {/* Tab 1: Tasks */}
      {tab === "tasks" && (
        <div className="customer-tab-content">
          <div className="customer-tasks-toolbar">
            <div className="customer-filter-chips">
              <button
                className={`filter-chip ${taskFilter === "all" ? "active" : ""}`}
                onClick={() => setTaskFilter("all")}
              >
                Tất cả ({customerTasks.length})
              </button>
              <button
                className={`filter-chip ${taskFilter === "open" ? "active" : ""}`}
                onClick={() => setTaskFilter("open")}
              >
                Đang mở ({openTasks.length})
              </button>
              <button
                className={`filter-chip ${taskFilter === "done" ? "active" : ""}`}
                onClick={() => setTaskFilter("done")}
              >
                Đã xong ({doneTasks.length})
              </button>
            </div>
            <button
              className="button small"
              onClick={() => onTaskCreate?.(customer)}
              disabled={isSuspended}
            >
              <Plus size={15} />
              <span>Thêm công việc</span>
            </button>
          </div>

          {filteredTasks.length > 0 ? (
            <div className="customer-tasks-list-panel panel">
              {filteredTasks.map((t) => {
                const assigned = getPerson(t.assigneeId);
                const tm = getTeam(t.teamId);
                const isDone = t.status === "done";
                const isLate = !isDone && t.dueAt && new Date(t.dueAt) < new Date();

                return (
                  <div key={t.id} className={`task-row ${isDone ? "completed" : ""}`}>
                    <button
                      className={`check-task ${isDone ? "checked" : ""}`}
                      aria-label={`${isDone ? "Mở lại" : "Hoàn thành"} ${t.title}`}
                      onClick={() => onTaskComplete?.(t)}
                      disabled={isSuspended}
                    >
                      {isDone && <Check size={13} />}
                    </button>
                    <button
                      className="task-title"
                      onClick={() => onTaskOpen?.(t)}
                    >
                      <strong>{t.title}</strong>
                      <span>
                        {tm ? `${tm.name} · ` : "Việc chung · "}
                        {t.category || customer.name}
                        {t.recurrence && t.recurrence !== "none" && <Repeat2 size={12} />}
                      </span>
                    </button>
                    <span className={`tag priority-${t.priority || "medium"}`}>
                      {priorities[t.priority] || "Trung bình"}
                    </span>
                    <span className={`due ${isLate ? "late" : ""}`}>
                      <Clock3 size={13} />
                      {dateLabel(t.dueAt)}
                    </span>
                    <div className="task-assignee">
                      {assigned ? (
                        <>
                          <Avatar name={assigned.name} size="small" />
                          <span className="assignee-name">{assigned.name}</span>
                        </>
                      ) : (
                        <span className="unassigned muted">Chưa phân công</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel customer-empty-tab">
              <p>
                {customerTasks.length === 0
                  ? "Chưa có công việc nào liên quan đến khách hàng này."
                  : "Không có công việc nào phù hợp với bộ lọc hiện tại."}
              </p>
              <button
                className="button secondary small"
                onClick={() => onTaskCreate?.(customer)}
                disabled={isSuspended}
              >
                <Plus size={15} />
                <span>Tạo công việc ngay</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Services */}
      {tab === "services" && (
        <div className="customer-tab-content">
          {customerServices.length > 0 ? (
            <div className="panel customer-services-table-panel">
              <table className="customer-data-table">
                <thead>
                  <tr>
                    <th>Tên dịch vụ / Gói</th>
                    <th>Chu kỳ</th>
                    <th>Chi phí</th>
                    <th>Hạn gia hạn</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {customerServices.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.cycle === "yearly" ? "Hàng năm" : s.cycle === "monthly" ? "Hàng tháng" : "Một lần"}</td>
                      <td>{money(s.amount)}</td>
                      <td>{dateLabel(s.currentPeriodEnd || s.renewalDate)}</td>
                      <td>
                        <span className={`status-badge ${s.status === "active" ? "badge-active" : "badge-inactive"}`}>
                          {s.status === "active" ? "Đang hoạt động" : "Tạm ngưng"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel customer-empty-tab">
              <p>Chưa có gói dịch vụ hoặc hợp đồng nào được gán cho khách hàng này.</p>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Finance */}
      {tab === "finance" && canManage && (
        <div className="customer-tab-content">
          {customerTransactions.length > 0 ? (
            <div className="panel customer-finance-table-panel">
              <table className="customer-data-table">
                <thead>
                  <tr>
                    <th>Ngày ghi</th>
                    <th>Hạng mục</th>
                    <th>Mô tả</th>
                    <th>Khoản tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {customerTransactions.map((tx) => {
                    const isIncome = tx.kind === "income" || tx.kind === "in" || (!tx.kind && Number(tx.amount) > 0);
                    return (
                      <tr key={tx.id}>
                        <td>{dateLabel(tx.createdAt || tx.date)}</td>
                        <td>
                          <span className="tx-category">{tx.category || "Dịch vụ"}</span>
                        </td>
                        <td>{tx.description || tx.title || "—"}</td>
                        <td className={`tx-amount ${isIncome ? "income" : "expense"}`}>
                          {isIncome ? "+" : "-"}{money(Math.abs(Number(tx.amount)))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel customer-empty-tab">
              <p>Chưa có giao dịch thu / chi nào được ghi nhận cho khách hàng này.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
