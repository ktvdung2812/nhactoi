import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquare,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import "./admin-details.css";
import ActionMenu from "./ActionMenu.jsx";

const PLAN_LABELS = {
  starter: "Starter",
  team: "Team",
  business: "Business",
};

const STATUS_LABELS = {
  active: "Đang hoạt động",
  trialing: "Dùng thử",
  past_due: "Chờ gia hạn",
  expired: "Hết hạn",
  canceled: "Đã hủy",
  pending: "Chờ thanh toán",
  partially_paid: "Thanh toán một phần",
  paid: "Đã thanh toán",
  failed: "Thất bại",
  refunded: "Đã hoàn tiền",
  suspended: "Tạm ngưng",
  disabled: "Đã khóa",
};

const ACTION_LABELS = {
  "workspace.suspend": "Tạm ngưng doanh nghiệp",
  "workspace.reactivate": "Mở lại doanh nghiệp",
  "workspace.profile.update": "Cập nhật hồ sơ doanh nghiệp",
  "user.disable": "Khóa tài khoản",
  "user.reactivate": "Mở lại tài khoản",
  "user.profile.update": "Cập nhật hồ sơ người dùng",
  "subscription.update": "Điều chỉnh thuê bao",
  "admin.grant": "Cấp quyền admin",
  "admin.revoke": "Thu hồi quyền admin",
  "settings.update": "Cập nhật cấu hình",
  "ticket.reply": "Phản hồi yêu cầu hỗ trợ",
  "ticket.update": "Cập nhật yêu cầu hỗ trợ",
};

const PROFILE_LIMITS = {
  name: 160,
  email: 254,
  industry: 120,
  contactEmail: 254,
  phone: 60,
  address: 300,
  website: 500,
  taxCode: 80,
  note: 2000,
  reason: 500,
};

function text(value, fallback = "—") {
  return value === null || value === undefined || String(value).trim() === ""
    ? fallback
    : String(value);
}

function dateLabel(value, withTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function money(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function planLabel(value, names = PLAN_LABELS) {
  return names?.[value] || PLAN_LABELS[value] || text(value, "Chưa có gói");
}

function statusLabel(value) {
  return STATUS_LABELS[value] || text(value, "Chưa xác định");
}

function initials(value) {
  const result = String(value || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return result || "?";
}

function statusValue(item, kind) {
  if (kind === "users") return item?.disabledAt ? "disabled" : "active";
  return item?.suspendedAt ? "suspended" : "active";
}

function errorMessage(error) {
  return (
    error?.message || "Chưa tải được thông tin chi tiết. Vui lòng thử lại."
  );
}

function normalizedList(value) {
  return Array.isArray(value) ? value : [];
}

function validateEmail(value, label = "Email") {
  if (!value) return `${label} là thông tin bắt buộc.`;
  if (value.length > PROFILE_LIMITS.email || !/^\S+@\S+\.\S+$/.test(value))
    return `${label} chưa đúng định dạng.`;
  return "";
}

function validateReason(value) {
  const reason = String(value || "").trim();
  if (!reason) return "Vui lòng nhập lý do thay đổi.";
  if (reason.length < 3) return "Lý do cần có ít nhất 3 ký tự.";
  if (reason.length > PROFILE_LIMITS.reason)
    return `Lý do không được dài quá ${PROFILE_LIMITS.reason} ký tự.`;
  return "";
}

function validateName(value, label = "Tên") {
  const name = String(value || "").trim();
  if (!name) return `${label} là thông tin bắt buộc.`;
  if (name.length < 2) return `${label} cần có ít nhất 2 ký tự.`;
  if (name.length > PROFILE_LIMITS.name)
    return `${label} không được dài quá ${PROFILE_LIMITS.name} ký tự.`;
  return "";
}

function displayAuditAction(value) {
  return ACTION_LABELS[value] || text(value, "Thay đổi quản trị");
}

function invokeChanged(callback, payload) {
  if (typeof callback !== "function") return;
  try {
    Promise.resolve(callback(payload)).catch(() => {});
  } catch {
    // The detail mutation already succeeded; a refresh callback is best effort.
  }
}

function StatusBadge({ value }) {
  const normalized = String(value || "unknown").replace(/[^a-z0-9_-]/gi, "");
  return (
    <span className={`admin-details-badge badge-${normalized}`}>
      <i />
      {statusLabel(value)}
    </span>
  );
}

function RoleBadge({ admin = false }) {
  return (
    <span className={`admin-details-role ${admin ? "is-admin" : ""}`}>
      {admin ? <ShieldCheck size={14} /> : <UserRound size={14} />}
      {admin ? "Admin SaaS" : "Người dùng"}
    </span>
  );
}

function TechnicalDetails({ children }) {
  return (
    <details className="admin-details-technical">
      <summary>Thông tin kỹ thuật</summary>
      <div>{children}</div>
    </details>
  );
}

function EmptyState({ children = "Chưa có dữ liệu." }) {
  return <div className="admin-details-empty">{children}</div>;
}

function Panel({
  title,
  description,
  icon: Icon,
  action,
  children,
  className = "",
}) {
  return (
    <section className={`admin-details-panel ${className}`}>
      <div className="admin-details-panel-head">
        <div>
          <h2>
            {Icon && <Icon size={17} />}
            {title}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailValue({ label, value, icon: Icon, children }) {
  return (
    <div className="admin-details-value">
      <span>
        {Icon && <Icon size={14} />}
        {label}
      </span>
      <strong>{children || text(value)}</strong>
    </div>
  );
}

function ProfileInput({
  label,
  name,
  value,
  onChange,
  type = "text",
  required,
  ...props
}) {
  return (
    <label className="admin-details-field">
      <span>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </span>
      <input
        name={name}
        type={type}
        value={value || ""}
        onChange={onChange}
        required={required}
        {...props}
      />
    </label>
  );
}

function ProfileTextarea({ label, name, value, onChange, ...props }) {
  return (
    <label className="admin-details-field admin-details-field-wide">
      <span>{label}</span>
      <textarea
        name={name}
        value={value || ""}
        onChange={onChange}
        {...props}
      />
    </label>
  );
}

function ErrorState({ error, retry, back }) {
  return (
    <div className="admin-details-state" role="alert">
      <AlertCircle size={30} />
      <h2>Chưa tải được dữ liệu</h2>
      <p>{errorMessage(error)}</p>
      <div className="admin-details-state-actions">
        <button type="button" className="button secondary" onClick={back}>
          <ArrowLeft size={16} /> Quay lại danh sách
        </button>
        <button type="button" className="button" onClick={retry}>
          <RefreshCw size={16} /> Thử lại
        </button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="admin-details-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={30} />
      <p>Đang tải thông tin chi tiết…</p>
    </div>
  );
}

function UserProfile({
  user,
  editing,
  draft,
  setDraft,
  profileError,
  onCancel,
  onSubmit,
  saving,
}) {
  const change = (name) => (event) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  return (
    <Panel
      title="Thông tin liên hệ"
      description="Thông tin dùng để liên hệ và hỗ trợ tài khoản."
      icon={UserRound}
      className="admin-details-profile-panel"
    >
      {editing ? (
        <form className="admin-details-form" onSubmit={onSubmit} noValidate>
          <div className="admin-details-form-grid">
            <ProfileInput
              label="Họ và tên"
              name="name"
              value={draft.name}
              onChange={change("name")}
              maxLength={PROFILE_LIMITS.name}
              required
            />
            <ProfileInput
              label="Email"
              name="email"
              value={draft.email}
              onChange={change("email")}
              type="email"
              maxLength={PROFILE_LIMITS.email}
              required
            />
          </div>
          <div className="admin-details-readonly-row">
            <DetailValue label="Vai trò nền tảng" icon={ShieldCheck}>
              <RoleBadge admin={user.isPlatformAdmin} />
            </DetailValue>
            <DetailValue
              label="Ngày tạo"
              icon={CalendarDays}
              value={dateLabel(user.createdAt)}
            />
          </div>
          <label className="admin-details-field admin-details-field-wide">
            <span>
              Lý do thay đổi <b aria-hidden="true">*</b>
            </span>
            <textarea
              name="reason"
              value={draft.reason || ""}
              onChange={change("reason")}
              maxLength={PROFILE_LIMITS.reason}
              placeholder="Ví dụ: Cập nhật thông tin theo yêu cầu của người dùng"
              required
            />
          </label>
          {profileError && (
            <div className="admin-details-form-error" role="alert">
              <AlertCircle size={15} /> {profileError}
            </div>
          )}
          <div className="admin-details-form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Hủy
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      ) : (
        <div className="admin-details-profile-body">
          <div className="admin-details-profile-identity">
            <span className="admin-details-avatar">{initials(user.name)}</span>
            <div>
              <strong>{text(user.name)}</strong>
              <a href={`mailto:${user.email || ""}`}>
                <Mail size={13} /> {text(user.email)}
              </a>
            </div>
          </div>
          <div className="admin-details-profile-fields">
            <DetailValue label="Trạng thái">
              <StatusBadge value={statusValue(user, "users")} />
            </DetailValue>
            <DetailValue label="Vai trò nền tảng">
              <RoleBadge admin={user.isPlatformAdmin} />
            </DetailValue>
            <DetailValue label="Ngày tạo" value={dateLabel(user.createdAt)} />
            <DetailValue
              label="Doanh nghiệp liên quan"
              value={user.workspaceCount}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function UserBusinesses({ workspaces, go, planNames }) {
  return (
    <Panel
      title="Doanh nghiệp liên quan"
      description="Tra cứu thuê bao, thanh toán và đầu mối hỗ trợ."
      icon={Building2}
      action={
        <span className="admin-details-count">
          {workspaces.length} doanh nghiệp
        </span>
      }
    >
      {workspaces.length === 0 ? (
        <EmptyState>Chưa có doanh nghiệp liên quan.</EmptyState>
      ) : (
        <div className="admin-details-table-wrap">
          <table className="admin-details-table">
            <thead>
              <tr>
                <th scope="col">Doanh nghiệp</th>
                <th scope="col">Thuê bao</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">
                  <span className="sr-only">Mở</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td>
                    <button
                      type="button"
                      className="admin-details-identity-link"
                      onClick={() => go(`admin/workspaces/${workspace.id}`)}
                    >
                      <span className="admin-details-mini-icon">
                        <Building2 size={14} />
                      </span>
                      <span>
                        <strong>{text(workspace.name)}</strong>
                        <small>
                          {text(workspace.industry, "Chưa đặt ngành nghề")}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <strong className="admin-details-table-primary">
                      {planLabel(workspace.plan, planNames)}
                    </strong>
                    <small>
                      {statusLabel(
                        workspace.status || workspace.subscriptionStatus,
                      )}
                    </small>
                  </td>
                  <td>
                    <StatusBadge
                      value={workspace.suspendedAt ? "suspended" : "active"}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-details-icon-link"
                      aria-label={`Mở doanh nghiệp ${workspace.name || ""}`}
                      onClick={() => go(`admin/workspaces/${workspace.id}`)}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AuditPanel({ rows }) {
  return (
    <Panel
      title="Nhật ký hỗ trợ và thay đổi"
      description="Lịch sử cập nhật thông tin liên hệ, ghi chú hỗ trợ và dịch vụ."
      icon={FileText}
      action={
        <span className="admin-details-count">{rows.length} mục mới nhất</span>
      }
      className="admin-details-audit-panel"
    >
      {rows.length === 0 ? (
        <EmptyState>Chưa có thay đổi quản trị nào.</EmptyState>
      ) : (
        <div className="admin-details-audit-list">
          {rows.map((row) => (
            <div
              className="admin-details-audit-row"
              key={row.id || `${row.createdAt}-${row.action}`}
            >
              <span className="admin-details-audit-icon">
                <Clock3 size={14} />
              </span>
              <div className="admin-details-audit-main">
                <strong>{displayAuditAction(row.action)}</strong>
                <span>{text(row.reason, "Không có lý do")}</span>
              </div>
              <div className="admin-details-audit-meta">
                <strong>{text(row.actorName, "Hệ thống / CLI")}</strong>
                <small>{dateLabel(row.createdAt, true)}</small>
              </div>
              {(row.id || row.targetId) && (
                <TechnicalDetails>
                  {row.id && <code>Nhật ký: {row.id}</code>}
                  {row.targetId && <code>Mục tiêu: {row.targetId}</code>}
                </TechnicalDetails>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function WorkspaceProfile({
  workspace,
  editing,
  draft,
  setDraft,
  profileError,
  onEdit,
  onCancel,
  onSubmit,
  saving,
}) {
  const change = (name) => (event) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  return (
    <Panel
      title="Thông tin doanh nghiệp"
      description="Thông tin liên hệ và hồ sơ thanh toán của doanh nghiệp."
      icon={Building2}
      action={
        !editing && (
          <ActionMenu
            label={`Thao tác hồ sơ doanh nghiệp ${workspace.name || ""}`}
            items={[
              {
                label: "Chỉnh sửa",
                icon: Edit3,
                disabled: saving,
                onSelect: onEdit,
              },
            ]}
          />
        )
      }
      className="admin-details-profile-panel"
    >
      {editing ? (
        <form className="admin-details-form" onSubmit={onSubmit} noValidate>
          <div className="admin-details-form-grid">
            <ProfileInput
              label="Tên doanh nghiệp"
              name="name"
              value={draft.name}
              onChange={change("name")}
              maxLength={PROFILE_LIMITS.name}
              required
            />
            <ProfileInput
              label="Ngành nghề"
              name="industry"
              value={draft.industry}
              onChange={change("industry")}
              maxLength={PROFILE_LIMITS.industry}
            />
            <ProfileInput
              label="Email liên hệ"
              name="contactEmail"
              value={draft.contactEmail}
              onChange={change("contactEmail")}
              type="email"
              maxLength={PROFILE_LIMITS.contactEmail}
            />
            <ProfileInput
              label="Số điện thoại"
              name="phone"
              value={draft.phone}
              onChange={change("phone")}
              type="tel"
              maxLength={PROFILE_LIMITS.phone}
            />
            <ProfileInput
              label="Website"
              name="website"
              value={draft.website}
              onChange={change("website")}
              type="url"
              maxLength={PROFILE_LIMITS.website}
            />
            <ProfileInput
              label="Mã số thuế"
              name="taxCode"
              value={draft.taxCode}
              onChange={change("taxCode")}
              maxLength={PROFILE_LIMITS.taxCode}
            />
            <ProfileTextarea
              label="Địa chỉ"
              name="address"
              value={draft.address}
              onChange={change("address")}
              maxLength={PROFILE_LIMITS.address}
            />
            <ProfileTextarea
              label="Ghi chú hỗ trợ"
              name="note"
              value={draft.note}
              onChange={change("note")}
              maxLength={PROFILE_LIMITS.note}
            />
          </div>
          <label className="admin-details-field admin-details-field-wide">
            <span>
              Lý do thay đổi <b aria-hidden="true">*</b>
            </span>
            <textarea
              name="reason"
              value={draft.reason || ""}
              onChange={change("reason")}
              maxLength={PROFILE_LIMITS.reason}
              placeholder="Ví dụ: Cập nhật thông tin liên hệ doanh nghiệp"
              required
            />
          </label>
          {profileError && (
            <div className="admin-details-form-error" role="alert">
              <AlertCircle size={15} /> {profileError}
            </div>
          )}
          <div className="admin-details-form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Hủy
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {saving ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      ) : (
        <div className="admin-details-workspace-profile">
          <div className="admin-details-workspace-status">
            <span className="admin-details-avatar workspace">
              {initials(workspace.name)}
            </span>
            <div>
              <strong>{text(workspace.name)}</strong>
              <span>{text(workspace.industry, "Chưa đặt ngành nghề")}</span>
              <StatusBadge value={statusValue(workspace, "workspaces")} />
            </div>
          </div>
          <div className="admin-details-profile-fields workspace-fields">
            <DetailValue label="Email liên hệ" icon={Mail}>
              {workspace.contactEmail ? (
                <a href={`mailto:${workspace.contactEmail}`}>
                  {workspace.contactEmail}
                </a>
              ) : (
                "—"
              )}
            </DetailValue>
            <DetailValue
              label="Điện thoại"
              icon={Phone}
              value={workspace.phone}
            />
            <DetailValue label="Website" icon={Globe2}>
              {workspace.website ? (
                <a href={workspace.website} target="_blank" rel="noreferrer">
                  {workspace.website.replace(/^https?:\/\//, "")}
                  <ExternalLink size={12} />
                </a>
              ) : (
                "—"
              )}
            </DetailValue>
            <DetailValue label="Mã số thuế" value={workspace.taxCode} />
            <DetailValue
              label="Địa chỉ"
              icon={MapPin}
              value={workspace.address}
            />
            <DetailValue
              label="Ngày tạo"
              icon={CalendarDays}
              value={dateLabel(workspace.createdAt)}
            />
            {workspace.note && (
              <DetailValue label="Ghi chú hỗ trợ" value={workspace.note} />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function SubscriptionPanel({ subscription, planNames }) {
  if (!subscription) {
    return (
      <Panel
        title="Thuê bao"
        description="Thông tin gói dịch vụ hiện tại."
        icon={CreditCard}
      >
        <EmptyState>Doanh nghiệp chưa có thông tin thuê bao.</EmptyState>
      </Panel>
    );
  }
  return (
    <Panel
      title="Thuê bao"
      description="Thông tin gói dịch vụ hiện tại."
      icon={CreditCard}
    >
      <div className="admin-details-subscription">
        <div className="admin-details-subscription-plan">
          <span className="admin-details-mini-icon">
            <CreditCard size={16} />
          </span>
          <div>
            <strong>{planLabel(subscription.plan, planNames)}</strong>
            <small>
              {subscription.cycle === "yearly" ? "Theo năm" : "Theo tháng"}
            </small>
          </div>
          <StatusBadge value={subscription.status} />
        </div>
        <div className="admin-details-subscription-grid">
          <DetailValue
            label="Trạng thái"
            value={statusLabel(subscription.status)}
          />
          <DetailValue
            label="Chu kỳ"
            value={subscription.cycle === "yearly" ? "Hàng năm" : "Hàng tháng"}
          />
          <DetailValue
            label="Hết hạn"
            value={dateLabel(subscription.currentPeriodEnd)}
          />
          <DetailValue
            label="Số chỗ sử dụng"
            value={subscription.memberCount}
          />
        </div>
      </div>
    </Panel>
  );
}

function OrdersPanel({ orders, planNames }) {
  return (
    <Panel
      title="Thanh toán gần đây"
      description="Mười hóa đơn mới nhất của doanh nghiệp."
      icon={ReceiptText}
      action={
        <span className="admin-details-count">{orders.length} hóa đơn</span>
      }
    >
      {orders.length === 0 ? (
        <EmptyState>Chưa có hóa đơn nào.</EmptyState>
      ) : (
        <div className="admin-details-table-wrap">
          <table className="admin-details-table orders-table">
            <thead>
              <tr>
                <th scope="col">Gói / chu kỳ</th>
                <th scope="col">Số tiền</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id || `${order.createdAt}-${order.amount}`}>
                  <td>
                    <strong className="admin-details-table-primary">
                      {planLabel(order.plan, planNames)}
                    </strong>
                    <small>
                      {order.cycle === "yearly" ? "Theo năm" : "Theo tháng"}
                    </small>
                    {order.paymentCode && (
                      <small>Mã thanh toán {order.paymentCode}</small>
                    )}
                    {order.id && (
                      <TechnicalDetails>
                        <code>{order.id}</code>
                      </TechnicalDetails>
                    )}
                  </td>
                  <td className="admin-details-money">
                    {money(order.amount)}
                    {order.status === "partially_paid" ? (
                      <small>Đã nhận {money(order.amountPaid)}</small>
                    ) : Number(order.taxAmount) > 0 ? (
                      <small>Gồm VAT {money(order.taxAmount)}</small>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge value={order.status} />
                  </td>
                  <td>{dateLabel(order.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DetailHeader({ kind, entity, onBack, onTickets, onEdit, editing, saving }) {
  const label = kind === "users" ? "Người dùng" : "Doanh nghiệp";
  return (
    <>
      <div className="admin-details-breadcrumb" aria-label="Điều hướng">
        <button type="button" className="admin-details-back" onClick={onBack}>
          <ArrowLeft size={16} /> Quay lại {label.toLowerCase()}
        </button>
      </div>
      <div className="admin-details-heading">
        <div>
          <span className="admin-details-eyebrow">
            NHẮC TÔI / QUẢN TRỊ / {label.toUpperCase()}
          </span>
          <h1>{text(entity?.name, "Chi tiết")}</h1>
          <p>
            {kind === "users"
              ? text(entity?.email)
              : text(entity?.industry, "Thông tin doanh nghiệp")}
          </p>
        </div>
        <div className="admin-details-heading-actions">
          <StatusBadge value={statusValue(entity, kind)} />
          {onTickets && (
            <ActionMenu
              label={`Thao tác với ${label.toLowerCase()} ${entity?.name || ""}`}
              items={[
                ...(onEdit ? [{
                  label: "Chỉnh sửa thông tin liên hệ",
                  icon: Edit3,
                  disabled: editing || saving,
                  onSelect: onEdit,
                }] : []),
                {
                  label: "Xem tickets hỗ trợ",
                  icon: MessageSquare,
                  onSelect: onTickets,
                },
              ]}
            />
          )}
        </div>
      </div>
    </>
  );
}

function UserDetailsBody({
  data,
  go,
  planNames,
  editing,
  draft,
  setDraft,
  profileError,
  onCancel,
  onSubmit,
  saving,
}) {
  const user = data.user || {};
  const workspaces = normalizedList(data.workspaces);
  const audit = normalizedList(data.audit).slice(0, 10);
  return (
    <>
      <UserProfile
        user={user}
        editing={editing}
        draft={draft}
        setDraft={setDraft}
        profileError={profileError}
        onCancel={onCancel}
        onSubmit={onSubmit}
        saving={saving}
      />
      <UserBusinesses workspaces={workspaces} go={go} planNames={planNames} />
      <AuditPanel rows={audit} />
    </>
  );
}

function WorkspaceDetailsBody({
  data,
  go,
  planNames,
  editing,
  draft,
  setDraft,
  profileError,
  onEdit,
  onCancel,
  onSubmit,
  saving,
}) {
  const workspace = data.workspace || {};
  const owner = data.owner || {};
  const subscription = data.subscription || null;
  const orders = normalizedList(data.orders).slice(0, 10);
  const audit = normalizedList(data.audit).slice(0, 10);
  return (
    <>
      <WorkspaceProfile
        workspace={workspace}
        editing={editing}
        draft={draft}
        setDraft={setDraft}
        profileError={profileError}
        onEdit={onEdit}
        onCancel={onCancel}
        onSubmit={onSubmit}
        saving={saving}
      />
      <Panel
        title="Đầu mối liên hệ"
        description="Người đại diện tài khoản để trao đổi về dịch vụ và thanh toán."
        icon={UserRound}
      >
        <div className="admin-details-profile-body admin-support-contact">
          <span className="admin-details-avatar">{initials(owner.name)}</span>
          <div>
            {owner.id ? (
              <button
                className="admin-details-text-button"
                onClick={() => go(`admin/users/${owner.id}`)}
              >
                {text(owner.name)} <ArrowUpRight size={14} />
              </button>
            ) : (
              <strong>Chưa có đầu mối liên hệ</strong>
            )}
            {owner.email && <a href={`mailto:${owner.email}`}>{owner.email}</a>}
          </div>
        </div>
      </Panel>
      <div className="admin-details-two-columns">
        <SubscriptionPanel subscription={subscription} planNames={planNames} />
        <OrdersPanel orders={orders} planNames={planNames} />
      </div>
      <AuditPanel rows={audit} />
    </>
  );
}

export default function AdminDetails({
  kind = "users",
  id,
  api,
  go,
  onChanged,
  planNames = PLAN_LABELS,
}) {
  const detailKind = kind === "workspaces" ? "workspaces" : "users";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [notice, setNotice] = useState("");
  const entity = data?.[detailKind === "users" ? "user" : "workspace"] || null;
  const back = () => go?.(`admin/${detailKind}`);
  const retry = () => setRevision((value) => value + 1);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setEditing(false);
    setProfileError("");
    if (!id || typeof api !== "function") {
      setError(new Error("Liên kết chi tiết không hợp lệ."));
      setLoading(false);
      return () => {
        canceled = true;
      };
    }
    api(`/admin/${detailKind}/${encodeURIComponent(id)}`)
      .then((result) => {
        if (!canceled) setData(result || {});
      })
      .catch((reason) => {
        if (!canceled) setError(reason);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, detailKind, id, revision]);

  useEffect(() => {
    if (!entity || editing) return;
    if (detailKind === "users") {
      setDraft({
        name: entity.name || "",
        email: entity.email || "",
        reason: "",
      });
    } else {
      setDraft({
        name: entity.name || "",
        industry: entity.industry || "",
        contactEmail: entity.contactEmail || "",
        phone: entity.phone || "",
        address: entity.address || "",
        website: entity.website || "",
        taxCode: entity.taxCode || "",
        note: entity.note || "",
        reason: "",
      });
    }
  }, [detailKind, entity, editing]);

  function openEditor() {
    setNotice("");
    setProfileError("");
    if (detailKind === "users") {
      setDraft({
        name: entity?.name || "",
        email: entity?.email || "",
        reason: "",
      });
    } else {
      setDraft({
        name: entity?.name || "",
        industry: entity?.industry || "",
        contactEmail: entity?.contactEmail || "",
        phone: entity?.phone || "",
        address: entity?.address || "",
        website: entity?.website || "",
        taxCode: entity?.taxCode || "",
        note: entity?.note || "",
        reason: "",
      });
    }
    setEditing(true);
  }

  function cancelEditor() {
    setEditing(false);
    setProfileError("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    const values = { ...draft, name: String(draft.name || "").trim() };
    const nameError = validateName(
      values.name,
      detailKind === "users" ? "Họ và tên" : "Tên doanh nghiệp",
    );
    if (nameError) return setProfileError(nameError);
    if (detailKind === "users") {
      values.email = String(values.email || "")
        .trim()
        .toLowerCase();
      const emailError = validateEmail(values.email);
      if (emailError) return setProfileError(emailError);
    } else if (
      values.contactEmail &&
      validateEmail(String(values.contactEmail).trim(), "Email liên hệ")
    ) {
      return setProfileError(
        validateEmail(String(values.contactEmail).trim(), "Email liên hệ"),
      );
    }
    const reasonError = validateReason(values.reason);
    if (reasonError) return setProfileError(reasonError);
    const payload =
      detailKind === "users"
        ? {
            name: values.name,
            email: values.email,
            reason: String(values.reason).trim(),
          }
        : {
            name: values.name,
            industry: String(values.industry || "").trim(),
            contactEmail: String(values.contactEmail || "").trim(),
            phone: String(values.phone || "").trim(),
            address: String(values.address || "").trim(),
            website: String(values.website || "").trim(),
            taxCode: String(values.taxCode || "").trim(),
            note: String(values.note || "").trim(),
            reason: String(values.reason).trim(),
          };
    setProfileSaving(true);
    setProfileError("");
    try {
      const result = await api(
        `/admin/${detailKind}/${encodeURIComponent(id)}/profile`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      const changed = result?.[detailKind === "users" ? "user" : "workspace"];
      if (changed)
        setData((current) => ({
          ...(current || {}),
          [detailKind === "users" ? "user" : "workspace"]: {
            ...(current?.[detailKind === "users" ? "user" : "workspace"] || {}),
            ...changed,
          },
        }));
      else
        setData((current) => ({
          ...(current || {}),
          [detailKind === "users" ? "user" : "workspace"]: {
            ...(current?.[detailKind === "users" ? "user" : "workspace"] || {}),
            ...payload,
          },
        }));
      setEditing(false);
      setNotice("Đã lưu thông tin và ghi nhật ký quản trị.");
      setRevision((value) => value + 1);
      invokeChanged(onChanged, {
        type: "profile",
        kind: detailKind,
        id,
        result,
      });
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="admin-details-page">
      <DetailHeader
        kind={detailKind}
        entity={entity}
        onBack={back}
        onEdit={detailKind === "users" ? openEditor : null}
        editing={editing}
        saving={profileSaving}
        onTickets={
          !loading && !error && entity
            ? () =>
                go(
                  `admin/tickets?${detailKind === "users" ? "userId" : "workspaceId"}=${encodeURIComponent(id)}`,
                )
            : null
        }
      />
      {notice && !loading && (
        <div className="admin-details-notice" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {error ? (
        <ErrorState error={error} retry={retry} back={back} />
      ) : loading || !data ? (
        <LoadingState />
      ) : detailKind === "users" ? (
        <UserDetailsBody
          data={data}
          go={go}
          planNames={planNames}
          editing={editing}
          draft={draft}
          setDraft={setDraft}
          profileError={profileError}
          onCancel={cancelEditor}
          onSubmit={submitProfile}
          saving={profileSaving}
        />
      ) : (
        <WorkspaceDetailsBody
          data={data}
          go={go}
          planNames={planNames}
          editing={editing}
          draft={draft}
          setDraft={setDraft}
          profileError={profileError}
          onEdit={openEditor}
          onCancel={cancelEditor}
          onSubmit={submitProfile}
          saving={profileSaving}
        />
      )}
    </div>
  );
}
