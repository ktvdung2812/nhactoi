import TaskTemplates from "./TaskTemplates.jsx";
import {GoogleAccount} from "./OperationsSettings.jsx";
import CalendarEvents from "./CalendarEvents.jsx";
import BoardTransfer from "./BoardTransfer.jsx";
import React, { useEffect, useState } from "react";
import {
  Bell,
  LayoutDashboard,
  CheckCheck,
  CalendarDays,
  Users,
  Wallet,
  CreditCard,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Check,
  Clock3,
  LogOut,
  List,
  LayoutGrid,
  Building2,
  Mail,
  Phone,
  Repeat2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Menu,
  Sparkles,
  LoaderCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  LifeBuoy,
  Trash2,
} from "lucide-react";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "./styles.css";
import Admin, { adminRoutes } from "./Admin.jsx";
import AccessDenied from "./AccessDenied.jsx";
import ErrorPage from "./ErrorPage.jsx";
import ErrorGallery from "./ErrorGallery.jsx";
import Tickets from "./Tickets.jsx";
import Teams from "./Teams.jsx";
import TaskBoard from "./TaskBoard.jsx";
import WorkflowBoard from "./WorkflowBoard.jsx";
import Services from "./Services.jsx";
import Automations from "./Automations.jsx";
import ActionMenu from "./ActionMenu.jsx";
import Trash, { MoveToTrashDialog } from "./Trash.jsx";
import TaskDetail from "./TaskDetail.jsx";

const money = (n) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
const dateLabel = (d, options = { day: "2-digit", month: "2-digit" }) =>
  d ? new Date(d).toLocaleDateString("vi-VN", options) : "Chưa đặt lịch";
const localInput = (d) => {
  const t = new Date(d || Date.now());
  return new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const navItems = [
  ["dashboard", "Tổng quan", LayoutDashboard],
  ["tasks", "Công việc", CheckCheck],
  ["calendar", "Lịch nhắc", CalendarDays],
  ["customers", "Khách hàng", Users],
  ["finance", "Thu & chi", Wallet],
  ["teams", "Teams", Users],
  ["team", "Thành viên", Users],
  ["tickets", "Hỗ trợ", LifeBuoy],
  ["services", "Dịch vụ định kỳ", CalendarDays],
  ["automations", "Tự động hóa", Sparkles],
  ["events", "Lịch hẹn", CalendarDays],
  ["transfer", "Nhập / xuất bảng", Copy],
  ["account", "Tài khoản", ShieldCheck],
  ["templates", "Mẫu công việc", Copy],
  ["trash", "Thùng rác cấp 2", Trash2],
];
function readRoute() {
  if (!["/", "/index.html"].includes(location.pathname)) return "not-found";
  const current = location.hash.replace(/^#\/?/, "");
  if (!current) return "dashboard";
  if (current === "admin") return "admin/overview";
  if (
    [
      ...navItems.map(([id]) => id),
      "billing",
      "errors",
      ...adminRoutes,
    ].includes(current) ||
    /^errors\/[45]\d{2}$/.test(current) ||
    /^admin\/(users|workspaces|tickets)\/[A-Za-z0-9_-]+$/.test(current) ||
    /^tickets\/[A-Za-z0-9_-]+$/.test(current) ||
    /^tasks\/[A-Za-z0-9_-]+$/.test(current) ||
    /^teams\/[A-Za-z0-9_-]+$/.test(current) ||
    /^admin\/tickets\?(workspaceId|userId)=[A-Za-z0-9_-]+$/.test(current)
  )
    return current;
  return "not-found";
}
async function api(path, options = {}) {
  const r = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  }).catch(() => {
    const error = new Error(
      "Chưa kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.",
    );
    error.status = 503;
    throw error;
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raw = String(data.error?.message || data.error || data.message || "");
    const known = {
      "file uploads are disabled": "Tải tệp đang được tắt. Liên hệ quản trị viên SaaS để bật lưu trữ.",
      "file must not be empty": "Tệp đang trống. Vui lòng chọn tệp có nội dung.",
      "X-File-Name is invalid": "Tên tệp không hợp lệ hoặc dài quá 240 ký tự.",
      "a task can have at most 100 attachments": "Mỗi công việc được đính kèm tối đa 100 tệp và liên kết.",
      "attachmentIds must contain at most 10 items": "Mỗi bình luận được đính kèm tối đa 10 tệp.",
      "attachment is not available for this task": "Tệp không còn trong công việc này. Bỏ tệp khỏi bản nháp rồi chọn lại để gửi.",
      "attachment is not available for this user": "Chỉ có thể gửi kèm tệp do bạn tải lên.",
      "attachment is already attached to a comment": "Tệp đã được gửi trong một bình luận khác. Bỏ tệp khỏi bản nháp hoặc chọn tệp mới.",
      "maxFileSizeMb must be an integer from 1 to 50": "Dung lượng mỗi tệp phải là số nguyên từ 1 đến 50 MB.",
      "localPath must be an absolute path": "Vui lòng nhập đường dẫn tuyệt đối của thư mục lưu tệp.",
      "localPath must be under the project data directory or outside the project": "Chọn thư mục trong data hoặc một thư mục riêng ngoài dự án; không dùng thư mục mã nguồn hay thư mục web công khai.",
      "localPath cannot contain symbolic links": "Chọn đường dẫn thật của thư mục, không dùng liên kết tượng trưng.",
      "localPath must be private": "Thư mục cần quyền riêng tư (0700). Chọn một thư mục mới hoặc điều chỉnh quyền trên máy chủ.",
      "localPath is not writable": "Máy chủ chưa có quyền ghi vào thư mục này. Kiểm tra đường dẫn và quyền ghi.",
      "localPath cannot be inspected": "Máy chủ không đọc được thông tin thư mục. Kiểm tra đường dẫn và quyền truy cập.",
      "localPath must be a directory": "Đường dẫn phải trỏ tới thư mục lưu tệp.",
      "email or password is incorrect": "Email hoặc mật khẩu chưa đúng.",
      "email is already registered": path.startsWith("/admin/")
        ? "Email này đã được sử dụng bởi tài khoản khác."
        : "Email đã có tài khoản. Vui lòng đăng nhập.",
      "email is already a workspace member":
        "Email này đã là thành viên của không gian.",
      "invitation is invalid or expired":
        "Liên kết mời không hợp lệ, đã được dùng hoặc đã hết hạn.",
      "authenticate as the invited email to accept this invitation":
        "Vui lòng đăng nhập bằng đúng email được mời.",
      "email is invalid": "Địa chỉ email không hợp lệ.",
      "workspace is suspended; contact support":
        "Không gian đang tạm ngưng. Vui lòng liên hệ quản trị viên SaaS.",
    };
    const adminFieldNames = {
      name: "Tên",
      email: "Email",
      reason: "Lý do thay đổi",
      industry: "Ngành nghề",
      contactEmail: "Email liên hệ",
      phone: "Số điện thoại",
      address: "Địa chỉ",
      website: "Website",
      taxCode: "Mã số thuế",
      note: "Ghi chú",
      publicAppUrl: "Địa chỉ ứng dụng",
      localPath: "Thư mục lưu tệp",
      "plan.name": "Tên gói",
      "plan.seats": "Giới hạn thành viên",
      "billgateway.apiUrl": "Địa chỉ BillGateway",
      "smtp.host": "Máy chủ SMTP",
      "smtp.port": "Cổng SMTP",
      "smtp.from": "Địa chỉ người gửi",
    };
    const fieldError = raw.match(/^([\w.]+) is (required|invalid|too long)$/);
    const adminValidation =
      path.startsWith("/admin/") && fieldError && adminFieldNames[fieldError[1]]
        ? `${adminFieldNames[fieldError[1]]} ${fieldError[2] === "required" ? "không được để trống" : fieldError[2] === "too long" ? "vượt quá độ dài cho phép" : "không hợp lệ"}.`
        : null;
    const seatLimit = raw.match(/plan allows at most (\d+) members/);
    const fallback = {
      400: "Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.",
      401: "Vui lòng đăng nhập để tiếp tục.",
      402: "Thuê bao đã hết hạn. Chủ không gian có thể gia hạn tại Gói dịch vụ.",
      403: "Tài khoản không có quyền thực hiện thao tác này.",
      404: "Không tìm thấy dữ liệu hoặc liên kết đã hết hạn.",
      409: "Thông tin đã tồn tại hoặc không còn phù hợp. Vui lòng kiểm tra lại.",
      413: "Tệp vượt quá dung lượng cho phép. Vui lòng chọn tệp nhỏ hơn.",
      423: "Tài khoản hoặc không gian đã tạm ngưng. Vui lòng liên hệ quản trị viên SaaS.",
      429: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.",
      500: "Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.",
      502: "Chưa kết nối được cổng thanh toán. Vui lòng thử lại sau.",
      503: "Dịch vụ chưa sẵn sàng. Vui lòng kiểm tra cấu hình máy chủ.",
    };
    const error = new Error(
      known[raw] ||
        adminValidation ||
        ((path.startsWith("/admin/") ||
          path.startsWith("/tickets") ||
          path.startsWith("/teams") ||
          path.startsWith("/tasks") ||
          path.startsWith("/trash") || path.startsWith("/task-templates") || path.startsWith("/task-labels") || path.startsWith("/calendar-events") || path.startsWith("/board-transfer") || path.startsWith("/automations") || path.startsWith("/services") || path.startsWith("/boards") || path.startsWith("/customers")) &&
        [400, 403, 409, 422].includes(r.status) &&
        /[^\x00-\x7F]/.test(raw)
          ? raw
          : null) ||
        (seatLimit
          ? `Gói hiện tại cho phép tối đa ${seatLimit[1]} thành viên, bao gồm lời mời đang chờ.`
          : fallback[r.status]) ||
        raw ||
        "Không thể thực hiện. Vui lòng thử lại.",
    );
    error.status = r.status;
    throw error;
  }
  return data;
}
function Avatar({ name = "?", small = false, index = 0 }) {
  return (
    <span className={`avatar tone-${index % 5} ${small ? "small" : ""}`}>
      {name
        .split(" ")
        .filter(Boolean)
        .slice(-2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
function Button({ children, icon: Icon = Plus, secondary = false, ...props }) {
  return (
    <button className={secondary ? "button secondary" : "button"} {...props}>
      {Icon && <Icon size={17} />} {children}
    </button>
  );
}
function Empty({
  title = "Chưa có dữ liệu",
  text = "Thêm mục đầu tiên để bắt đầu quản lý.",
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <CheckCheck size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {React.cloneElement(children, { "aria-label": label })}
    </label>
  );
}
export default function App() {
  const [me, setMe] = useState(null),
    [loading, setLoading] = useState(true),
    [data, setData] = useState({
      tasks: [],
      customers: [],
      members: [],
      transactions: [],
      notifications: [],
    });
  const [page, setPage] = useState(readRoute),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [view, setView] = useState("board"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [noticeOpen, setNoticeOpen] = useState(false),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [billing, setBilling] = useState(null),
    [cycle, setCycle] = useState("yearly"),
    [calendar, setCalendar] = useState(new Date()),
    [financeType, setFinanceType] = useState("all"),
    [invitation, setInvitation] = useState(null),
    [workspaces, setWorkspaces] = useState(null),
    [bootError, setBootError] = useState(null),
    [previewToast, setPreviewToast] = useState("");
  const [trashTarget, setTrashTarget] = useState(null);
  const [teamsRevision, setTeamsRevision] = useState(0);
  const [taskTeamFilter, setTaskTeamFilter] = useState("all");
  const [taskTeamId, setTaskTeamId] = useState("");
  const [taskReturnPage, setTaskReturnPage] = useState(null);
  useEffect(() => {
    if (modal?.type === "task")
      setTaskTeamId(modal.item?.teamId || modal.teamId || "");
  }, [modal]);
  useEffect(() => {
    setTaskTeamFilter("all");
    setModal(null);
    setTrashTarget(null);
    setTaskReturnPage(null);
  }, [me?.workspace?.id]);
  useEffect(() => {
    if (
      !["all", "common"].includes(taskTeamFilter) &&
      !(data.teams || []).some((t) => t.id === taskTeamFilter && !t.archivedAt)
    )
      setTaskTeamFilter("all");
  }, [data.teams, taskTeamFilter]);
  const notify = (message, error = false) => setToast({ message, error });
  async function refresh() {
    const [m, d] = await Promise.all([api("/me"), api("/dashboard")]);
    setMe(m);
    setData(d);
    setTeamsRevision((v) => v + 1);
    setBootError(null);
  }
  async function loadSession() {
    setLoading(true);
    setBootError(null);
    try {
      await refresh();
    } catch (e) {
      if (e.status === 401) setMe(null);
      else setBootError(e.status || 500);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadSession();
  }, []);
  useEffect(() => {
    if (!previewToast) return;
    const timer = setTimeout(() => setPreviewToast(""), 3000);
    return () => clearTimeout(timer);
  }, [previewToast]);
  useEffect(() => {
    const onHashChange = () => setPage(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    if (!me) return;
    let canceled = false;
    const timer = setInterval(
      () =>
        api("/dashboard")
          .then((d) => {
            if (!canceled) {
              setData(d);
              setMe((m) =>
                m
                  ? {
                      ...m,
                      workspace: d.workspace,
                      subscription: d.subscription,
                    }
                  : m,
              );
            }
          })
          .catch((e) => {
            if (!canceled && e.status === 401) setMe(null);
          }),
      30000,
    );
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [me?.workspace?.id]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (page === "billing" && me)
      api("/billing")
        .then(setBilling)
        .catch((e) => notify(e.message, true));
  }, [page, me]);
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") {
        setModal(null);
        setNoticeOpen(false);
        setMobile(false);
        setWorkspaces(null);
      }
      if (e.defaultPrevented) return;
      if (e.key === "Tab") {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return;
        const focusable = [
          ...dialog.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary",
          ),
        ];
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const tasks = data.tasks || [],
    teams = data.teams || [],
    customers = data.customers || [],
    members = data.members || [],
    transactions = data.transactions || [],
    notifications = data.notifications || [];
  const now = new Date(),
    today = localDay(),
    isToday = (d) => d && localDay(new Date(d)) === today;
  const openTasks = tasks.filter((t) => t.status !== "done"),
    overdue = openTasks.filter((t) => t.dueAt && new Date(t.dueAt) < now),
    dueToday = tasks.filter((t) => isToday(t.dueAt)),
    completed = tasks.filter((t) => t.status === "done");
  const monthTransactions = transactions.filter(
    (t) => t.date?.slice(0, 7) === today.slice(0, 7),
  );
  const income = monthTransactions
      .filter((t) => t.type === "income")
      .reduce((a, t) => a + t.amount, 0),
    expense = monthTransactions
      .filter((t) => t.type === "expense")
      .reduce((a, t) => a + t.amount, 0);
  const role = me?.user?.role,
    canManage = role === "owner" || role === "admin",
    unread = notifications.filter((n) => !n.readAt && !n.isRead);
  useEffect(() => {
    if (me && page === "finance" && !canManage) go("dashboard");
  }, [me?.user?.role, page]);
  const teamScopedTasks = tasks.filter(
    (t) =>
      taskTeamFilter === "all" ||
      (taskTeamFilter === "common" ? !t.teamId : t.teamId === taskTeamFilter),
  );
  const filteredTasks = teamScopedTasks.filter(
    (t) =>
      (filter === "all" ||
        (filter === "overdue"
          ? t.status !== "done" && new Date(t.dueAt) < now
          : filter === "today"
            ? isToday(t.dueAt)
            : t.status === filter)) &&
      `${t.title} ${t.description || ""} ${t.category || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const calendarMonthTasks = teamScopedTasks
    .filter((task) => {
      const due = new Date(task.dueAt);
      return task.dueAt && due.getFullYear() === calendar.getFullYear()
        && due.getMonth() === calendar.getMonth();
    })
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const person = (id) => members.find((m) => m.id === id),
    client = (id) => customers.find((c) => c.id === id);
  const selectedTaskTeam = teams.find((t) => t.id === taskTeamId);
  const preserveHistoricalAssignee =
    modal?.item?.teamId === taskTeamId &&
    (modal?.readOnly || modal?.item?.status === "done");
  const taskAssignees = taskTeamId
    ? members.filter(
        (m) =>
          selectedTaskTeam?.memberIds?.includes(m.id) ||
          (preserveHistoricalAssignee && m.id === modal?.item?.assigneeId),
      )
    : members;
  const preferredAssignee = modal?.item ? modal.item.assigneeId : me?.user?.id;
  const defaultTaskAssignee = taskAssignees.some(
    (m) => m.id === preferredAssignee,
  )
    ? preferredAssignee
    : "";
  const createFilteredTask = (status = "todo", columnId = null) =>
    setModal({
      type: "task",
      status, columnId,
      teamId: teams.some((t) => t.id === taskTeamFilter && !t.archivedAt)
        ? taskTeamFilter
        : null,
    });
  function renderTaskTeamFilter() {
    return (
      <label className="task-team-filter">
        <Users size={16} />
        <span>Phạm vi công việc</span>
        <select
          aria-label="Lọc công việc theo team"
          value={taskTeamFilter}
          onChange={(e) => setTaskTeamFilter(e.target.value)}
        >
          <option value="all">Tất cả team của bạn</option>
          <option value="common">Việc chung của doanh nghiệp</option>
          {teams
            .filter((t) => !t.archivedAt)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </label>
    );
  }
  async function openTeamTask(options) {
    try {
      await refresh();
      setModal({ type: "task", ...options });
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function action(fn, success) {
    setBusy(true);
    try {
      const result = await fn();
      await refresh();
      if (success) notify(success);
      return result;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function requestTrash(entityType, item) {
    setModal(null);
    setTrashTarget({ entityType, item });
  }
  async function afterTrashMoved() {
    if (trashTarget?.entityType === "task" && page === `tasks/${trashTarget.item.id}`)
      go(taskReturnPage || (trashTarget.item.teamId ? `teams/${trashTarget.item.teamId}` : "tasks"));
    setTrashTarget(null);
    notify("Đã chuyển vào Thùng rác cấp 2. Bạn có thể khôi phục tại đó.");
    try { await refresh(); }
    catch (error) { notify(`Đã chuyển vào thùng rác. ${error.message}`, true); }
  }
  async function moveBoardTask(task, status) {
    const workspaceId = me.workspace.id;
    const result = await api(`/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setData((current) => current.workspace?.id !== workspaceId ? current : ({
      ...current,
      tasks: [
        ...current.tasks.map((item) => item.id === result.task.id ? result.task : item),
        ...(result.nextTask && !current.tasks.some((item) => item.id === result.nextTask.id) ? [result.nextTask] : []),
      ],
    }));
    return result;
  }
  async function complete(t) {
    await action(
      () =>
        api(`/tasks/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: t.status === "done" ? "todo" : "done",
          }),
        }),
      t.status === "done" ? "Đã mở lại công việc" : "Đã hoàn thành công việc",
    );
  }
  function go(p) {
    if (!["/", "/index.html"].includes(location.pathname)) {
      location.assign(`/#/${p}`);
      return;
    }
    if (page.startsWith("admin/") && !p.startsWith("admin/")) {
      refresh().catch((e) => {
        if (e.status === 401) setMe(null);
        else notify(e.message, true);
      });
    }
    location.hash = `/${p}`;
    setPage(p);
    setSearch("");
    setFilter("all");
    setMobile(false);
    setWorkspaces(null);
  }
  function openTaskDetail(task) {
    setTaskReturnPage(page.startsWith("teams/") ? page : "tasks");
    setModal(null);
    setNoticeOpen(false);
    go(`tasks/${task.id}`);
  }
  async function submitModal(e) {
    e.preventDefault();
    if (modal.readOnly) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    let path,
      method = "POST",
      payload = f;
    if (modal.type === "task") {
      path = "/tasks" + (modal.item ? `/${modal.item.id}` : "");
      method = modal.item ? "PATCH" : "POST";
      payload = {
        ...f,
        dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null,
        remindAt: f.remindAt ? new Date(f.remindAt).toISOString() : null,
        assigneeId: f.assigneeId || null,
        customerId: f.customerId || null,
        teamId: taskTeamId || null,
        ...(!modal.item && modal.columnId && (taskTeamId || null) === (modal.teamId || null) && f.status === modal.status ? { columnId: modal.columnId } : {}),
      };
    }
    if (modal.type === "customer") {
      path = "/customers" + (modal.item ? `/${modal.item.id}` : "");
      method = modal.item ? "PATCH" : "POST";
    }
    if (modal.type === "finance") {
      path = "/transactions";
      payload = {
        ...f,
        amount: Number(f.amount),
        customerId: f.customerId || null,
      };
    }
    if (modal.type === "invite") path = "/invitations";
    const result = await action(
      () => api(path, { method, body: JSON.stringify(payload) }),
      "Đã lưu thành công",
    );
    if (result) {
      setModal(null);
      if (modal.type === "invite") setInvitation(result.inviteUrl);
      if (modal.type === "task" && !modal.item && result.task) openTaskDetail(result.task);
    }
  }
  function TaskRow({ task: t, compact = false }) {
    const p = person(t.assigneeId),
      c = client(t.customerId),
      late = t.status !== "done" && t.dueAt && new Date(t.dueAt) < now;
    return (
      <div className={`task-row ${t.status === "done" ? "completed" : ""}`}>
        <button
          className={`check-task ${t.status === "done" ? "checked" : ""}`}
          aria-label={`${t.status === "done" ? "Mở lại" : "Hoàn thành"} ${t.title}`}
          onClick={() => complete(t)}
          disabled={busy}
        >
          {t.status === "done" && <Check size={13} />}
        </button>
        <button
          className="task-title"
          onClick={() => openTaskDetail(t)}
        >
          <strong>{t.title}</strong>
          <span>
            {t.teamName ? `${t.teamName} · ` : "Việc chung · "}
            {c?.name || t.category || "Công việc nội bộ"}{" "}
            {t.recurrence && t.recurrence !== "none" && <Repeat2 size={12} />}
          </span>
        </button>
        {!compact && (
          <span className={`tag priority-${t.priority}`}>
            {priorities[t.priority]}
          </span>
        )}
        <span className={`due ${late ? "late" : ""}`}>
          <Clock3 size={13} />
          {isToday(t.dueAt) ? "Hôm nay" : dateLabel(t.dueAt)}
          {t.dueAt && (
            <small>
              {new Date(t.dueAt).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
        </span>
        {p ? (
          <Avatar name={p.name} small index={members.indexOf(p)} />
        ) : (
          <span className="unassigned" title="Chưa giao">
            —
          </span>
        )}
        {!compact && (
          <span className={`status status-${t.status}`}>
            <i />
            {statuses[t.status]}
          </span>
        )}
      </div>
    );
  }
  if (page === "errors") return <ErrorGallery go={go} />;
  if (page.startsWith("errors/"))
    return (
      <>
        <ErrorPage
          code={Number(page.split("/")[1])}
          preview
          onBack={() => go("dashboard")}
          onPreviewBack={() => go("errors")}
          onRetry={() =>
            setPreviewToast("Đây là bản xem thử. Không gửi lại yêu cầu thật.")
          }
          onLogin={() =>
            setPreviewToast(
              "Bản xem thử: nút này sẽ mở trang đăng nhập khi gặp lỗi 401.",
            )
          }
          onBilling={() =>
            setPreviewToast(
              "Bản xem thử: nút này sẽ mở trang gia hạn gói dịch vụ.",
            )
          }
        />
        {previewToast && (
          <div className="error-preview-toast" role="status">
            {previewToast}
          </div>
        )}
      </>
    );
  if (page === "not-found")
    return <ErrorPage code={404} onBack={() => go("dashboard")} />;
  if (loading)
    return (
      <div className="loading-screen">
        <span className="brand-mark">
          <Bell />
        </span>
        <LoaderCircle className="spin" /> Đang mở không gian làm việc…
      </div>
    );
  if (bootError)
    return (
      <ErrorPage
        code={bootError}
        onBack={() => {
          go("dashboard");
          loadSession();
        }}
        onRetry={loadSession}
      />
    );
  if (!me) return <Auth onLogin={refresh} notify={notify} toast={toast} />;
  const inviteToken = new URLSearchParams(location.search).get("invite");
  if (inviteToken)
    return (
      <AcceptInvitation
        token={inviteToken}
        me={me}
        onAccepted={refresh}
        onLogout={() => setMe(null)}
      />
    );
  if (page.startsWith("admin/")) {
    if (me.user.isPlatformAdmin)
      return <Admin page={page} me={me} api={api} go={go} />;
    return <AccessDenied onBack={() => go("dashboard")} />;
  }
  const title =
    navItems.find((n) => n[0] === page.split("/")[0])?.[1] ||
    (page === "billing" ? "Gói dịch vụ" : "Tổng quan");
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go("dashboard");
          }}
        >
          <span className="brand-mark">
            <Bell size={22} />
            <i />
          </span>
          nhắc tôi<span className="brand-dot">.</span>
        </a>
        <button
          className="workspace-switch"
          aria-expanded={!!workspaces}
          onClick={async () => {
            if (workspaces) return setWorkspaces(null);
            try {
              setWorkspaces((await api("/workspaces")).workspaces);
            } catch (e) {
              notify(e.message, true);
            }
          }}
        >
          <span className="workspace-icon">
            <Building2 size={19} />
          </span>
          <span>
            <strong>{me.workspace.name}</strong>
            <small>Không gian làm việc</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {workspaces && (
          <div className="workspace-menu">
            <span>CHỌN KHÔNG GIAN</span>
            {workspaces.map((w) => (
              <button
                key={w.id}
                disabled={busy}
                onClick={async () => {
                  if (w.id !== me.workspace.id) {
                    const result = await action(
                      () =>
                        api("/workspaces/switch", {
                          method: "POST",
                          body: JSON.stringify({ workspaceId: w.id }),
                        }),
                      "Đã chuyển không gian",
                    );
                    if (!result) return;
                    setInvitation(null);
                  }
                  go("dashboard");
                }}
              >
                <Building2 size={16} />
                <strong>{w.name}</strong>
                {w.id === me.workspace.id && <Check size={15} />}
              </button>
            ))}
            <button onClick={() => go("team")}>
              <Users size={16} /> Quản lý thành viên
            </button>
          </div>
        )}
        <div className="nav-caption">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {navItems
            .filter((n) => n[0] !== "finance" || canManage)
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={page.split("/")[0] === id ? "active" : ""}
                onClick={() => go(id)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {id === "tasks" && <b>{openTasks.length}</b>}
                {id === "calendar" && unread.length > 0 && (
                  <i className="nav-dot" />
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          {me.user.isPlatformAdmin && (
            <button
              className="billing-nav"
              onClick={() => go("admin/overview")}
            >
              <ShieldCheck size={18} /> Quản trị SaaS <ArrowUpRight size={14} />
            </button>
          )}
          <div className="plan-promo">
            <span className="promo-icon">
              <Sparkles size={18} />
            </span>
            <strong>Cùng nhau, làm được nhiều hơn</strong>
            <p>Một nơi cho công việc, khách hàng và đội ngũ.</p>
            <button onClick={() => go("billing")}>
              Khám phá gói dịch vụ <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={`billing-nav ${page === "billing" ? "selected" : ""}`}
            onClick={() => go("billing")}
          >
            <CreditCard size={18} /> Gói dịch vụ
          </button>
          <div className="profile">
            <Avatar name={me.user.name} />
            <div>
              <strong>{me.user.name}</strong>
              <small>
                {role === "owner"
                  ? "Chủ không gian"
                  : role === "admin"
                    ? "Quản trị viên"
                    : "Thành viên"}
              </small>
            </div>
            <button
              className="icon-button"
              title="Đăng xuất"
              onClick={async () => {
                await api("/auth/logout", { method: "POST" });
                setMe(null);
              }}
            >
              <LogOut size={17} />
            </button>
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
              onClick={() => setMobile(true)}
              aria-label="Mở menu"
            >
              <Menu size={20} />
            </button>
            <span>Không gian làm việc</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <span className="today-label">
              <CalendarDays size={15} />
              {dateLabel(now, {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
            <span className="top-divider" />
            <button
              className="notification-trigger icon-button"
              aria-label="Thông báo"
              onClick={() => setNoticeOpen(!noticeOpen)}
            >
              <Bell size={19} />
              {unread.length > 0 && <i />}
            </button>
            <Avatar name={me.user.name} small />
          </div>
        </header>
        <div className="page-content">
          {page.split("/")[0] === "teams" && (
            <Teams
              key={`${me.workspace.id}/${page}`}
              api={api}
              go={go}
              me={me}
              members={members}
              teamId={page.split("/")[1] || null}
              revision={teamsRevision}
              onChanged={refresh}
              onTaskMove={moveBoardTask}
              onTaskTrash={(task) => requestTrash("task", task)}
              onTaskCreate={(teamId, status = "todo", columnId = null) =>
                openTeamTask({ teamId, status, columnId })
              }
              onTaskOpen={openTaskDetail}
            />
          )}
          {page === "templates" && <TaskTemplates key={me.workspace.id} api={api} teams={teams} tasks={tasks} onOpen={openTaskDetail} onChanged={refresh}/>}
          {page === "account" && <><PageHeading title="Tài khoản" subtitle="Quản lý các phương thức đăng nhập của bạn."/><GoogleAccount api={api}/></>}
          {page === "events" && <CalendarEvents key={me.workspace.id} api={api} teams={teams}/>}
          {page === "transfer" && <><PageHeading title="Nhập / xuất bảng" subtitle="Di chuyển dữ liệu công việc giữa các bảng."/><BoardTransfer key={me.workspace.id} api={api} teams={teams} onChanged={refresh}/></>}
          {page === "automations" && <Automations api={api} me={me} teams={teams} tasks={tasks} members={members} onChanged={refresh}/>}
          {page === "services" && <Services key={me.workspace.id} api={api} me={me} members={members} customers={customers} teams={teams} />}
          {page === "trash" && (
            <Trash key={me.workspace.id} api={api} me={me} onChanged={refresh} />
          )}
          {page.startsWith("tasks/") && (
            <TaskDetail
              key={`${me.workspace.id}/${page}`}
              taskId={page.split("/")[1]}
              api={api}
              me={me}
              members={members}
              customers={customers}
              revision={teamsRevision}
              onChanged={refresh}
              onEdit={(task) => openTeamTask({ item: task, readOnly: task.teamArchived })}
              onTrash={(task) => requestTrash("task", task)}
              onBack={(task) => go(taskReturnPage || (task?.teamId ? `teams/${task.teamId}` : "tasks"))}
            />
          )}
          {page.split("/")[0] === "tickets" && (
            <Tickets
              key={`${me.workspace.id}/${page}`}
              api={api}
              go={go}
              ticketId={page.split("/")[1] || null}
            />
          )}
          {me.workspace.suspendedAt && (
            <div className="admin-warning" role="status">
              <strong>Không gian đang tạm ngưng.</strong> Bạn vẫn có thể xem dữ
              liệu và thanh toán thuê bao. Liên hệ quản trị viên SaaS để mở lại
              thao tác cập nhật và lời nhắc.
            </div>
          )}
          {page === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MỖI NGÀY, NHẸ NHÀNG HƠN</div>
                  <h1>
                    Chào {me.user.name.split(" ").slice(-1)[0]}, ngày mới tốt
                    lành <span className="sun">☀</span>
                  </h1>
                  <p>
                    Bắt đầu từ những việc quan trọng. Nhắc tôi sẽ nhớ phần còn
                    lại.
                  </p>
                </div>
                <Button onClick={() => setModal({ type: "task" })}>
                  Tạo công việc
                </Button>
              </div>
              <div className="overview-strip">
                <span>
                  <span className="live-dot" /> Không gian của bạn đang sẵn sàng
                </span>
                <button
                  onClick={() => {
                    go("tasks");
                    setFilter("today");
                  }}
                >
                  <span>Bạn có{" "}
                  <b>
                    {dueToday.filter((t) => t.status !== "done").length} việc
                  </b>{" "}
                  cần hoàn thành hôm nay</span> <ArrowRight size={15} />
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={CheckCheck}
                  color="green"
                  title="Công việc đang mở"
                  value={openTasks.length}
                  foot={`${completed.length} công việc đã hoàn thành`}
                  onClick={() => go("tasks")}
                />
                <Stat
                  icon={CalendarDays}
                  color="blue"
                  title="Đến hạn hôm nay"
                  value={dueToday.filter((t) => t.status !== "done").length}
                  foot="Sắp xếp một ngày thật hiệu quả"
                  onClick={() => {
                    go("tasks");
                    setFilter("today");
                  }}
                />
                <Stat
                  icon={Clock3}
                  color="orange"
                  title="Công việc quá hạn"
                  value={overdue.length}
                  foot={
                    overdue.length
                      ? "Cần bạn dành chút thời gian"
                      : "Mọi việc đang đúng tiến độ"
                  }
                  onClick={() => {
                    go("tasks");
                    setFilter("overdue");
                  }}
                />
                <Stat
                  icon={canManage ? Wallet : Users}
                  color="purple"
                  title={canManage ? "Thu trong tháng" : "Thành viên đội ngũ"}
                  value={canManage ? money(income) : members.length}
                  foot={
                    canManage
                      ? `Chi trong tháng: ${money(expense)}`
                      : "Cùng cộng tác trong không gian"
                  }
                  onClick={() => go(canManage ? "finance" : "team")}
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel today-panel">
                  <div className="panel-head">
                    <div>
                      <h2>
                        Công việc cần chú ý{" "}
                        <span className="count-pill">{openTasks.length}</span>
                      </h2>
                      <p>Một việc hoàn thành, một điều nhẹ lòng.</p>
                    </div>
                    <button className="text-button" onClick={() => go("tasks")}>
                      Xem tất cả <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="small-tabs">
                    <button
                      className={filter === "all" ? "active" : ""}
                      onClick={() => setFilter("all")}
                    >
                      Sắp đến hạn
                    </button>
                    <button
                      className={filter === "today" ? "active" : ""}
                      onClick={() => setFilter("today")}
                    >
                      Hôm nay{" "}
                      <span>
                        {dueToday.filter((t) => t.status !== "done").length}
                      </span>
                    </button>
                    <button
                      className={filter === "overdue" ? "active" : ""}
                      onClick={() => setFilter("overdue")}
                    >
                      Quá hạn <span>{overdue.length}</span>
                    </button>
                  </div>
                  <div className="task-table compact">
                    {(filter === "overdue"
                      ? overdue
                      : filter === "today"
                        ? dueToday.filter((t) => t.status !== "done")
                        : openTasks
                    )
                      .sort(
                        (a, b) =>
                          new Date(a.dueAt || "2099-01-01") -
                          new Date(b.dueAt || "2099-01-01"),
                      )
                      .slice(0, 5)
                      .map((t) => (
                        <TaskRow key={t.id} task={t} compact />
                      ))}
                    {!(
                      filter === "overdue"
                        ? overdue
                        : filter === "today"
                          ? dueToday.filter((t) => t.status !== "done")
                          : openTasks
                    ).length && (
                      <Empty
                        title="Mọi việc đã được sắp xếp"
                        text="Bạn có thể thêm công việc và đặt lịch nhắc ngay tại đây."
                      />
                    )}
                  </div>
                  <button
                    className="add-inline"
                    onClick={() => setModal({ type: "task" })}
                  >
                    <Plus size={16} /> Thêm một công việc mới
                  </button>
                </section>
                <section className="panel reminder-panel">
                  <div className="panel-head">
                    <div>
                      <h2>
                        <Bell size={17} /> Lịch nhắc sắp tới
                      </h2>
                      <p>Đúng lúc, đúng việc.</p>
                    </div>
                    <span className="soft-icon">
                      <CalendarDays size={18} />
                    </span>
                  </div>
                  <div className="reminder-timeline">
                    {openTasks
                      .filter((t) => t.remindAt && new Date(t.remindAt) >= now)
                      .sort(
                        (a, b) => new Date(a.remindAt) - new Date(b.remindAt),
                      )
                      .slice(0, 4)
                      .map((t, i) => (
                        <button
                          key={t.id}
                          className="timeline-item"
                          onClick={() => openTaskDetail(t)}
                        >
                          <span className={`timeline-dot dot-${i % 3}`} />
                          <div>
                            <small>
                              {isToday(t.remindAt)
                                ? "HÔM NAY"
                                : dateLabel(t.remindAt)}{" "}
                              <span>
                                ·{" "}
                                {new Date(t.remindAt).toLocaleTimeString(
                                  "vi-VN",
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                              </span>
                            </small>
                            <strong>{t.title}</strong>
                            <span className="timeline-category">
                              {t.category || "Công việc"}
                              {t.recurrence !== "none" && t.recurrence && (
                                <Repeat2 size={12} />
                              )}
                            </span>
                          </div>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    {!openTasks.some(
                      (t) => t.remindAt && new Date(t.remindAt) >= now,
                    ) && (
                      <Empty
                        title="Chưa có lịch nhắc"
                        text="Đặt thời điểm nhắc khi tạo công việc."
                      />
                    )}
                  </div>
                  <button
                    className="reminder-footer"
                    onClick={() => go("calendar")}
                  >
                    Mở lịch của bạn <ArrowUpRight size={16} />
                  </button>
                </section>
                <section className="panel cash-panel">
                  <div className="panel-head">
                    <div>
                      <h2>
                        {canManage
                          ? "Dòng tiền tháng này"
                          : "Tiến độ công việc"}
                      </h2>
                      <p>
                        {canManage
                          ? "Biết rõ thu chi, an tâm vận hành."
                          : "Từng bước nhỏ, kết quả lớn."}
                      </p>
                    </div>
                    <span className="month-tag">
                      Tháng {now.getMonth() + 1}, {now.getFullYear()}
                    </span>
                  </div>
                  {canManage ? (
                    <>
                      <div className="cash-summary">
                        <div>
                          <span>
                            <i className="income-dot" /> Tổng thu
                          </span>
                          <strong>{money(income)}</strong>
                        </div>
                        <div>
                          <span>
                            <i className="expense-dot" /> Tổng chi
                          </span>
                          <strong>{money(expense)}</strong>
                        </div>
                        <div>
                          <span>Chênh lệch</span>
                          <strong className="text-green">
                            {money(income - expense)}
                          </strong>
                        </div>
                      </div>
                      <div className="bar-chart">
                        {Array.from({ length: 4 }, (_, i) => {
                          const tx = monthTransactions.filter(
                              (t) =>
                                Math.min(
                                  3,
                                  Math.floor(
                                    (Number(t.date.slice(-2)) - 1) / 8,
                                  ),
                                ) === i,
                            ),
                            inc = tx
                              .filter((t) => t.type === "income")
                              .reduce((a, t) => a + t.amount, 0),
                            exp = tx
                              .filter((t) => t.type === "expense")
                              .reduce((a, t) => a + t.amount, 0),
                            max = Math.max(income, expense, 1);
                          return (
                            <div className="bar-group" key={i}>
                              <div className="bar-pair">
                                <div
                                  className="bar income-bar"
                                  style={{
                                    height: Math.max((inc / max) * 110, 3),
                                  }}
                                  title={`Thu: ${money(inc)}`}
                                />
                                <div
                                  className="bar expense-bar"
                                  style={{
                                    height: Math.max((exp / max) * 110, 3),
                                  }}
                                  title={`Chi: ${money(exp)}`}
                                />
                              </div>
                              <span>
                                {i === 3
                                  ? "25–cuối tháng"
                                  : `${i * 8 + 1}–${(i + 1) * 8}`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="progress-large">
                      <strong>
                        {tasks.length
                          ? Math.round((completed.length / tasks.length) * 100)
                          : 0}
                        %
                      </strong>
                      <p>
                        {completed.length}/{tasks.length} công việc hoàn thành
                      </p>
                      <progress
                        value={completed.length}
                        max={tasks.length || 1}
                      />
                    </div>
                  )}
                </section>
                <section className="panel team-panel">
                  <div className="panel-head">
                    <div>
                      <h2>Nhịp làm việc của đội ngũ</h2>
                      <p>Cùng nhau giữ mọi việc đúng hẹn.</p>
                    </div>
                    <button className="text-button" onClick={() => go("team")}>
                      Chi tiết <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="team-progress">
                    {members.slice(0, 4).map((m, i) => {
                      const ts = tasks.filter((t) => t.assigneeId === m.id),
                        done = ts.filter((t) => t.status === "done").length;
                      return (
                        <div className="member-progress" key={m.id}>
                          <Avatar name={m.name} small index={i} />
                          <div>
                            <div>
                              <strong>{m.name}</strong>
                              <span>
                                {done}/{ts.length} việc
                              </span>
                            </div>
                            <progress value={done} max={ts.length || 1} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="team-note">
                    <span className="tiny-leaf">✦</span> Mỗi đóng góp đều tạo
                    nên tiến độ chung.
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "tasks" && (
            <>
              <PageHeading
                title="Công việc"
                subtitle="Mọi việc trong tầm mắt. Mọi người cùng một nhịp."
                action={
                  <Button onClick={() => createFilteredTask()}>
                    Tạo công việc
                  </Button>
                }
              />
              <div className="toolbar">
                <div className="filter-tabs">
                  {[
                    ["all", "Tất cả"],
                    ["todo", "Cần làm"],
                    ["doing", "Đang làm"],
                    ["done", "Hoàn thành"],
                    ["overdue", "Quá hạn"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="view-toggle">
                  <button
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                    aria-label="Danh sách"
                  >
                    <List size={17} />
                  </button>
                  <button
                    className={view === "board" ? "active" : ""}
                    onClick={() => setView("board")}
                    aria-label="Bảng công việc"
                  >
                    <LayoutGrid size={17} />
                  </button>
                </div>
              </div>
              <div className="task-search-toolbar">
                <SearchBox
                  value={search}
                  setValue={setSearch}
                  placeholder="Tìm tên công việc, mô tả, nhóm dịch vụ…"
                />
                {renderTaskTeamFilter()}
              </div>
              {view === "list" ? (
                <section className="panel task-list">
                  <div className="table-labels">
                    <span>CÔNG VIỆC</span>
                    <span>ƯU TIÊN</span>
                    <span>HẠN HOÀN THÀNH</span>
                    <span>GIAO CHO</span>
                    <span>TRẠNG THÁI</span>
                  </div>
                  {filteredTasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                  {!filteredTasks.length && (
                    <Empty
                      title="Không có công việc phù hợp"
                      action={
                        <Button onClick={() => createFilteredTask()}>
                          Tạo công việc
                        </Button>
                      }
                    />
                  )}
                </section>
              ) : taskTeamFilter !== "all" ? (
                <WorkflowBoard api={api} teamId={taskTeamFilter === "common" ? null : taskTeamFilter}
                  scopeKey={`${me.workspace.id}/${taskTeamFilter}`} tasks={filteredTasks} members={members}
                  readOnly={Boolean(me.workspace.suspendedAt)} revision={teamsRevision}
                  onOpen={openTaskDetail} onCreate={createFilteredTask} onChanged={refresh}
                  onTrash={(task) => requestTrash("task", task)} />
              ) : (
                <TaskBoard
                  scopeKey={`${me.workspace.id}/${taskTeamFilter}`}
                  tasks={filteredTasks}
                  members={members}
                  readOnly={Boolean(me.workspace.suspendedAt)}
                  onOpen={openTaskDetail}
                  onCreate={createFilteredTask}
                  onMove={moveBoardTask}
                  onTrash={(task) => requestTrash("task", task)}
                />
              )}
            </>
          )}
          {page === "calendar" && (
            <>
              <PageHeading
                title="Lịch nhắc"
                subtitle="Một lịch chung cho lịch hẹn, công việc và các kỳ gia hạn."
                action={
                  <Button onClick={() => createFilteredTask()}>
                    Thêm lịch nhắc
                  </Button>
                }
              />
              {renderTaskTeamFilter()}
              <div className="calendar-layout">
                <section className="panel calendar-panel">
                  <div className="calendar-header">
                    <h2>
                      Tháng {calendar.getMonth() + 1}, {calendar.getFullYear()}
                    </h2>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => setCalendar(new Date())}
                      >
                        Hôm nay
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Tháng trước"
                        onClick={() =>
                          setCalendar(
                            new Date(
                              calendar.getFullYear(),
                              calendar.getMonth() - 1,
                              1,
                            ),
                          )
                        }
                      >
                        <ChevronLeft size={19} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Tháng sau"
                        onClick={() =>
                          setCalendar(
                            new Date(
                              calendar.getFullYear(),
                              calendar.getMonth() + 1,
                              1,
                            ),
                          )
                        }
                      >
                        <ChevronRight size={19} />
                      </button>
                    </div>
                  </div>
                  <div className="calendar-agenda" aria-label="Công việc trong tháng">
                    <p className="calendar-agenda-hint">Lịch theo ngày · Chạm vào công việc để xem chi tiết.</p>
                    {calendarMonthTasks.length === 0 && (
                      <p className="calendar-agenda-empty">Chưa có công việc trong tháng này.</p>
                    )}
                    {calendarMonthTasks.map((task, index) => (
                      <React.Fragment key={task.id}>
                        {(index === 0 || localDay(new Date(task.dueAt)) !== localDay(new Date(calendarMonthTasks[index - 1].dueAt))) && (
                          <h3 className="calendar-agenda-date">
                            {dateLabel(task.dueAt, { weekday: "long", day: "2-digit", month: "2-digit" })}
                          </h3>
                        )}
                        <button className="calendar-agenda-task" onClick={() => openTaskDetail(task)}>
                          <strong>{task.title}</strong>
                          <span>{new Date(task.dueAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · {task.teamName || "Việc chung"}</span>
                          <span className={`calendar-agenda-status status-${task.status}`}>{statuses[task.status] || task.status}</span>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="calendar-grid">
                    {[
                      "Thứ 2",
                      "Thứ 3",
                      "Thứ 4",
                      "Thứ 5",
                      "Thứ 6",
                      "Thứ 7",
                      "Chủ nhật",
                    ].map((x) => (
                      <div className="weekday" key={x}>
                        {x}
                      </div>
                    ))}
                    {Array.from({ length: 42 }, (_, i) => {
                      const offset =
                          (new Date(
                            calendar.getFullYear(),
                            calendar.getMonth(),
                            1,
                          ).getDay() +
                            6) %
                          7,
                        d = new Date(
                          calendar.getFullYear(),
                          calendar.getMonth(),
                          i - offset + 1,
                        ),
                        day = localDay(d),
                        dayTasks = teamScopedTasks.filter(
                          (t) => t.dueAt && localDay(new Date(t.dueAt)) === day,
                        );
                      return (
                        <div
                          key={i}
                          className={`calendar-cell ${d.getMonth() !== calendar.getMonth() ? "muted" : ""} ${day === today ? "current" : ""}`}
                        >
                          <button
                            className="day-number"
                            aria-label={`Thêm việc ngày ${dateLabel(d)}`}
                            onClick={() =>
                              setModal({
                                type: "task",
                                date: day,
                                teamId: ["all", "common"].includes(
                                  taskTeamFilter,
                                )
                                  ? null
                                  : taskTeamFilter,
                              })
                            }
                          >
                            {d.getDate()}
                          </button>
                          {dayTasks.slice(0, 3).map((t) => (
                            <button
                              key={t.id}
                              className={`calendar-task status-${t.status}`}
                              title={`${t.teamName || "Việc chung"} · ${t.title}`}
                              onClick={() =>
                                openTaskDetail(t)
                              }
                            >
                              {t.title}
                            </button>
                          ))}
                          {dayTasks.length > 3 && (
                            <small>+{dayTasks.length - 3} công việc</small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
              <p className="hint">
                <Bell size={14} /> Lịch hiển thị theo giờ trên thiết bị. Nhắc
                việc được lưu và xử lý trên máy chủ.
              </p>
            </>
          )}
          {page === "customers" && (
            <>
              <PageHeading
                title="Khách hàng"
                subtitle="Ghi nhớ khách hàng. Chăm sóc đúng thời điểm."
                action={
                  <Button onClick={() => setModal({ type: "customer" })}>
                    Thêm khách hàng
                  </Button>
                }
              />
              <SearchBox
                value={search}
                setValue={setSearch}
                placeholder="Tìm khách hàng, công ty, số điện thoại…"
              />
              <div className="customer-grid">
                {customers
                  .filter((c) =>
                    `${c.name} ${c.company} ${c.phone}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((c, i) => (
                    <button
                      className="panel customer-card"
                      key={c.id}
                      onClick={() => setModal({ type: "customer", item: c })}
                    >
                      <div>
                        <Avatar name={c.name} index={i} />
                        <span className="service-tag">
                          {c.service || "Khách hàng"}
                        </span>
                      </div>
                      <h3>{c.name}</h3>
                      <p>{c.company || "Khách hàng cá nhân"}</p>
                      <span>
                        <Mail size={15} />
                        {c.email || "Chưa có email"}
                      </span>
                      <span>
                        <Phone size={15} />
                        {c.phone || "Chưa có số điện thoại"}
                      </span>
                      <footer>
                        <span>
                          {
                            openTasks.filter((t) => t.customerId === c.id)
                              .length
                          }{" "}
                          công việc đang mở
                        </span>
                        <ArrowUpRight size={17} />
                      </footer>
                    </button>
                  ))}
              </div>
              {!customers.length && (
                <Empty
                  title="Chào đón khách hàng đầu tiên"
                  action={
                    <Button onClick={() => setModal({ type: "customer" })}>
                      Thêm khách hàng
                    </Button>
                  }
                />
              )}
            </>
          )}
          {page === "finance" && canManage && (
            <>
              <PageHeading
                title="Thu & chi"
                subtitle="Sổ thu chi rõ ràng, dòng tiền trong tầm tay."
                action={
                  <Button onClick={() => setModal({ type: "finance" })}>
                    Ghi thu / chi
                  </Button>
                }
              />
              <div className="stats-grid three">
                <Stat
                  icon={ArrowDownLeft}
                  color="green"
                  title="Tổng thu tháng này"
                  value={money(income)}
                  foot={`${monthTransactions.filter((t) => t.type === "income").length} khoản thu`}
                />
                <Stat
                  icon={ArrowUpRight}
                  color="orange"
                  title="Tổng chi tháng này"
                  value={money(expense)}
                  foot={`${monthTransactions.filter((t) => t.type === "expense").length} khoản chi`}
                />
                <Stat
                  icon={Wallet}
                  color="blue"
                  title="Chênh lệch thu – chi"
                  value={money(income - expense)}
                  foot={`Tháng ${now.getMonth() + 1}/${now.getFullYear()}`}
                />
              </div>
              <section className="panel">
                <div className="panel-head">
                  <h2>Lịch sử giao dịch</h2>
                  <select
                    aria-label="Loại giao dịch"
                    value={financeType}
                    onChange={(e) => setFinanceType(e.target.value)}
                  >
                    <option value="all">Tất cả giao dịch</option>
                    <option value="income">Khoản thu</option>
                    <option value="expense">Khoản chi</option>
                  </select>
                </div>
                <div className="finance-table">
                  {transactions
                    .filter(
                      (t) => financeType === "all" || t.type === financeType,
                    )
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((t) => (
                      <div className="transaction-row" key={t.id}>
                        <span className={`transaction-icon ${t.type}`}>
                          {t.type === "income" ? (
                            <ArrowDownLeft size={19} />
                          ) : (
                            <ArrowUpRight size={19} />
                          )}
                        </span>
                        <div>
                          <strong>{t.title}</strong>
                          <small>
                            {t.category}
                            {client(t.customerId)
                              ? ` · ${client(t.customerId).name}`
                              : ""}
                          </small>
                        </div>
                        <span>{dateLabel(t.date)}</span>
                        <strong
                          className={
                            t.type === "income" ? "text-green" : "text-orange"
                          }
                        >
                          {t.type === "income" ? "+" : "−"}
                          {money(t.amount)}
                        </strong>
                        <ActionMenu label={`Thao tác thu chi ${t.title}`} disabled={busy || Boolean(me.workspace.suspendedAt)} items={[
                          { label: "Chuyển vào thùng rác", icon: Trash2, danger: true, onSelect: () => requestTrash("transaction", t) },
                        ]} />
                      </div>
                    ))}
                  {!transactions.length && (
                    <Empty
                      title="Sổ thu chi đang trống"
                      action={
                        <Button onClick={() => setModal({ type: "finance" })}>
                          Ghi giao dịch đầu tiên
                        </Button>
                      }
                    />
                  )}
                </div>
              </section>
              <p className="hint">
                Sổ quản lý nội bộ, ghi nhận số tiền bằng VND.
              </p>
            </>
          )}
          {page === "team" && (
            <>
              <PageHeading
                title="Thành viên doanh nghiệp"
                subtitle={`${me.workspace.name} · ${members.length} thành viên cùng cộng tác`}
                action={
                  canManage && (
                    <Button onClick={() => setModal({ type: "invite" })}>
                      Mời thành viên
                    </Button>
                  )
                }
              />
              <section className="panel">
                <div className="panel-head">
                  <h2>Thành viên không gian</h2>
                  <span className="tag priority-low">Không gian riêng tư</span>
                </div>
                {members.map((m, i) => (
                  <div className="team-row" key={m.id}>
                    <Avatar name={m.name} index={i} />
                    <div>
                      <strong>
                        {m.name} {m.id === me.user.id && <small>(Bạn)</small>}
                      </strong>
                      <span>{m.email}</span>
                    </div>
                    <span className={`role-tag ${m.role}`}>
                      {m.role === "owner"
                        ? "Chủ không gian"
                        : m.role === "admin"
                          ? "Quản trị viên"
                          : "Thành viên"}
                    </span>
                    <span className="team-task-count">
                      {openTasks.filter((t) => t.assigneeId === m.id).length}{" "}
                      việc đang mở
                    </span>
                  </div>
                ))}
              </section>
              <div className="info-card">
                <ShieldCheck size={22} />
                <div>
                  <strong>Cộng tác với quyền truy cập phù hợp</strong>
                  <p>
                    Thành viên có thể tham gia nhiều team. Công việc theo team
                    chỉ hiển thị với người trong team và quản trị doanh nghiệp.
                    Quản trị viên quản lý team, thu chi và lời mời; chủ doanh
                    nghiệp quản lý thuê bao.
                  </p>
                </div>
              </div>
              {invitation && (
                <div className="invite-result">
                  <h3>Liên kết mời đã sẵn sàng</h3>
                  <p>
                    Sao chép và gửi riêng cho người được mời. Hệ thống chưa gửi
                    email.
                  </p>
                  <div>
                    <input readOnly value={invitation} />
                    <Button
                      icon={Copy}
                      onClick={() =>
                        navigator.clipboard
                          .writeText(invitation)
                          .then(() => notify("Đã sao chép liên kết"))
                          .catch(() =>
                            notify(
                              "Hãy sao chép liên kết trong ô bên cạnh.",
                              true,
                            ),
                          )
                      }
                    >
                      Sao chép
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {page === "billing" && (
            <>
              <PageHeading
                title="Một gói phù hợp. Nhiều việc nhẹ hơn."
                subtitle="Lựa chọn theo quy mô đội ngũ, thanh toán linh hoạt qua BillGateway."
              />
              <div className="subscription-banner">
                <span className="soft-icon">
                  <CreditCard size={23} />
                </span>
                <div>
                  <strong>
                    Gói hiện tại:{" "}
                    {me.subscription?.status === "trialing"
                      ? "Dùng thử"
                      : {
                          starter: "Starter",
                          team: "Team",
                          business: "Business",
                        }[me.subscription?.plan] || "Dùng thử"}
                  </strong>
                  <p>
                    {me.subscription?.currentPeriodEnd
                      ? `Có hiệu lực đến ${dateLabel(me.subscription.currentPeriodEnd, { day: "2-digit", month: "2-digit", year: "numeric" })}`
                      : "Thông tin thuê bao đang được cập nhật"}{" "}
                    ·{" "}
                    {me.subscription?.status === "active"
                      ? "Đang hoạt động"
                      : me.subscription?.status === "expired"
                        ? "Đã hết hạn"
                        : "Trải nghiệm không gian của bạn"}
                  </p>
                </div>
                <span className="tag priority-low">
                  {me.subscription?.status === "active"
                    ? "Đang sử dụng"
                    : "Thuê bao"}
                </span>
              </div>
              <div className="pricing-period">
                <div>
                  <button
                    className={cycle === "monthly" ? "active" : ""}
                    onClick={() => setCycle("monthly")}
                  >
                    Hàng tháng
                  </button>
                  <button
                    className={cycle === "yearly" ? "active" : ""}
                    onClick={() => setCycle("yearly")}
                  >
                    Hàng năm <span>Tiết kiệm hơn</span>
                  </button>
                </div>
              </div>
              {!billing ? (
                <div className="empty">
                  <LoaderCircle className="spin" /> Đang tải gói dịch vụ…
                </div>
              ) : (
                <>
                  <div className="pricing-grid">
                    {billing.plans.map((p, i) => (
                      <section
                        className={`pricing-card ${i === 1 ? "recommended" : ""}`}
                        key={p.id}
                      >
                        {i === 1 && (
                          <div className="recommended-label">
                            DÀNH CHO ĐỘI NGŨ ĐANG PHÁT TRIỂN
                          </div>
                        )}
                        <div className="plan-icon">
                          {i === 0 ? (
                            <Bell />
                          ) : i === 1 ? (
                            <Users />
                          ) : (
                            <Building2 />
                          )}
                        </div>
                        <h2>{p.name}</h2>
                        <p>
                          {i === 0
                            ? "Khởi đầu gọn gàng, làm việc chủ động."
                            : i === 1
                              ? "Kết nối đội ngũ, chăm sóc khách hàng."
                              : "Vận hành nhiều hơn, quản lý tập trung."}
                        </p>
                        <div className="plan-price">
                          {money(
                            cycle === "monthly"
                              ? p.monthlyPrice
                              : p.yearlyPrice,
                          )}
                          <span>/{cycle === "monthly" ? "tháng" : "năm"}</span>
                        </div>
                        <Button
                          secondary={i !== 1}
                          icon={ArrowUpRight}
                          disabled={
                            busy || role !== "owner" || !billing.configured
                          }
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await api("/billing/checkout", {
                                method: "POST",
                                body: JSON.stringify({ plan: p.id, cycle }),
                              });
                              const u = new URL(r.checkoutUrl);
                              if (!["http:", "https:"].includes(u.protocol))
                                throw new Error(
                                  "Đường dẫn thanh toán không hợp lệ",
                                );
                              window.location.assign(u.href);
                            } catch (e) {
                              notify(e.message, true);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {role === "owner"
                            ? billing.configured
                              ? "Chọn gói này"
                              : "Chưa kết nối thanh toán"
                            : "Chủ không gian quản lý gói"}
                        </Button>
                        <ul>
                          <li>
                            <Check size={16} />
                            {p.memberLimit} thành viên
                          </li>
                          {p.features
                            .filter((f) => !f.startsWith("Tối đa"))
                            .map((f, j) => (
                              <li key={j}>
                                <Check size={16} />
                                {f}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                  <p className="pricing-note">
                    <ShieldCheck size={16} />
                    {billing.configured
                      ? "Thanh toán qua BillGateway. Gói được kích hoạt sau khi xác nhận thanh toán."
                      : "Giá minh họa cho môi trường thử nghiệm. Cần cấu hình BillGateway để mở thanh toán."}
                  </p>
                  <p className="billing-policy">
                    Gia hạn cùng gói sẽ nối tiếp hạn hiện tại. Đổi gói bắt đầu
                    kỳ mới khi thanh toán; thời gian còn lại của gói cũ không
                    được cộng dồn.
                  </p>
                  {billing.orders?.length > 0 && (
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Lịch sử thuê bao</h2>
                      </div>
                      {billing.orders.map((o) => (
                        <div className="order-row" key={o.id}>
                          <span>
                            {o.plan} · {o.cycle === "yearly" ? "Năm" : "Tháng"}
                          </span>
                          <strong>{money(o.amount)}</strong>
                          <span>
                            {o.status === "paid"
                              ? "Đã thanh toán"
                              : o.status === "pending"
                                ? "Chờ thanh toán"
                                : o.status}
                          </span>
                          {o.checkoutUrl && o.status === "pending" && (
                            <a
                              href={o.checkoutUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Thanh toán <ExternalLink size={13} />
                            </a>
                          )}
                          {role === "owner" && o.status === "pending" && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={async () => {
                                const result = await action(
                                  () =>
                                    api(`/billing/orders/${o.id}/refresh`, {
                                      method: "POST",
                                    }),
                                  "Đã kiểm tra trạng thái hóa đơn",
                                );
                                if (result) setBilling(await api("/billing"));
                              }}
                            >
                              <RefreshCw size={14} /> Kiểm tra thanh toán
                            </button>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              nhắc tôi<span>.</span> <span>Nhớ việc nhỏ. Làm điều lớn.</span>
            </span>
            <span>
              <span className="live-dot" /> Dữ liệu được lưu trên máy chủ
            </span>
          </footer>
        </div>
      </main>
      {noticeOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setNoticeOpen(false)} />
          <aside className="notification-drawer">
            <div className="panel-head">
              <h2>
                Thông báo <span className="count-pill">{unread.length}</span>
              </h2>
              <button
                className="icon-button"
                aria-label="Đóng thông báo"
                onClick={() => setNoticeOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            {notifications.length ? (
              notifications.map((n) => (
                <button
                  className={`notice-item ${!n.readAt && !n.isRead ? "unread" : ""}`}
                  key={n.id}
                  onClick={async () => {
                    await action(() =>
                      api(`/notifications/${n.id}/read`, { method: "PATCH" }),
                    );
                    const t = tasks.find((t) => t.id === n.taskId);
                    if (t) openTaskDetail(t);
                  }}
                >
                  <Bell size={19} />
                  <div>
                    <strong>{n.title || "Đến giờ nhắc việc"}</strong>
                    <p>{n.message || n.body}</p>
                    <small>
                      {dateLabel(n.createdAt)}{" "}
                      {n.createdAt &&
                        new Date(n.createdAt).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                    </small>
                  </div>
                </button>
              ))
            ) : (
              <Empty
                title="Chưa có thông báo"
                text="Lời nhắc sẽ xuất hiện khi đến thời gian bạn đã đặt."
              />
            )}
            <div className="hint drawer-hint">
              Máy chủ xử lý lịch nhắc cả khi bạn đóng trình duyệt. Thông báo
              hiển thị khi mở ứng dụng.
            </div>
          </aside>
        </>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
                <h2 id="modal-title">
                  {modal.type === "task"
                    ? modal.item
                      ? "Chi tiết công việc"
                      : "Tạo công việc mới"
                    : modal.type === "customer"
                      ? modal.item
                        ? "Thông tin khách hàng"
                        : "Thêm khách hàng"
                      : modal.type === "finance"
                        ? "Ghi khoản thu / chi"
                        : "Mời thành viên"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Đóng"
                onClick={() => setModal(null)}
              >
                <X size={21} />
              </button>
            </div>
            <form onSubmit={submitModal}>
              {modal.type === "task" && (
                <fieldset
                  className="task-editor-fields"
                  disabled={modal.readOnly}
                >
                  {modal.readOnly && (
                    <p className="hint">
                      Team đã lưu trữ. Bạn có thể xem lịch sử công việc; khôi
                      phục team để tiếp tục cập nhật.
                    </p>
                  )}
                  <Field label="Tên công việc *">
                    <input
                      autoFocus
                      required
                      name="title"
                      maxLength={200}
                      defaultValue={modal.item?.title}
                      placeholder="Ví dụ: Nhắc khách gia hạn dịch vụ"
                    />
                  </Field>
                  <Field label="Mô tả">
                    <textarea
                      name="description"
                      rows={3}
                      defaultValue={modal.item?.description}
                      placeholder="Thông tin cần nhớ, yêu cầu hoặc ghi chú…"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Team phụ trách">
                      <select
                        name="teamId"
                        value={taskTeamId}
                        onChange={(e) => setTaskTeamId(e.target.value)}
                        disabled={Boolean(modal.item && !canManage)}
                      >
                        <option value="">Việc chung của doanh nghiệp</option>
                        {teams
                          .filter((t) => !t.archivedAt || t.id === taskTeamId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.archivedAt ? " (Đã lưu trữ)" : ""}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Trạng thái">
                      <select
                        name="status"
                        defaultValue={
                          modal.item?.status || modal.status || "todo"
                        }
                      >
                        {Object.entries(statuses).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Mức ưu tiên">
                      <select
                        name="priority"
                        defaultValue={modal.item?.priority || "medium"}
                      >
                        {Object.entries(priorities).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Hạn hoàn thành *">
                      <input
                        required
                        type="datetime-local"
                        name="dueAt"
                        defaultValue={
                          modal.item?.dueAt
                            ? localInput(modal.item.dueAt)
                            : `${modal.date || today}T17:00`
                        }
                      />
                    </Field>
                    <Field label="Nhắc vào lúc">
                      <input
                        type="datetime-local"
                        name="remindAt"
                        defaultValue={
                          modal.item?.remindAt
                            ? localInput(modal.item.remindAt)
                            : ""
                        }
                      />
                    </Field>
                    <Field label="Người phụ trách">
                      <select
                        key={taskTeamId}
                        name="assigneeId"
                        defaultValue={defaultTaskAssignee}
                      >
                        <option value="">Chưa giao</option>
                        {taskAssignees.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {taskTeamId &&
                              !selectedTaskTeam?.memberIds?.includes(m.id) &&
                              " (không còn trong team)"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Khách hàng">
                      <select
                        name="customerId"
                        defaultValue={modal.item?.customerId || ""}
                      >
                        <option value="">Không gắn khách hàng</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Nhóm dịch vụ">
                      <input
                        name="category"
                        defaultValue={modal.item?.category || ""}
                        placeholder="Bảo trì, kế toán, spa…"
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Lặp lại sau khi hoàn thành">
                      <select
                        name="recurrence"
                        defaultValue={modal.item?.recurrence || "none"}
                      >
                        <option value="none">Không lặp lại</option>
                        <option value="daily">Hàng ngày</option>
                        <option value="weekly">Hàng tuần</option>
                        <option value="monthly">Hàng tháng</option>
                      </select>
                    </Field>
                  </div>
                  <p className="hint">
                    <Bell size={14} /> Lịch nhắc được gửi trong ứng dụng. Email
                    chỉ gửi khi máy chủ được cấu hình SMTP.
                  </p>
                </fieldset>
              )}
              {modal.type === "customer" && (
                <>
                  <Field label="Tên khách hàng *">
                    <input
                      autoFocus
                      required
                      name="name"
                      defaultValue={modal.item?.name}
                      maxLength={150}
                    />
                  </Field>
                  <Field label="Công ty / đơn vị">
                    <input
                      name="company"
                      defaultValue={modal.item?.company}
                      maxLength={150}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Email">
                      <input
                        type="email"
                        name="email"
                        defaultValue={modal.item?.email}
                      />
                    </Field>
                    <Field label="Số điện thoại">
                      <input
                        name="phone"
                        defaultValue={modal.item?.phone}
                        maxLength={30}
                      />
                    </Field>
                  </div>
                  <Field label="Dịch vụ sử dụng">
                    <input
                      name="service"
                      defaultValue={modal.item?.service}
                      placeholder="Ví dụ: Bảo trì định kỳ"
                      maxLength={100}
                    />
                  </Field>
                </>
              )}
              {modal.type === "finance" && (
                <>
                  <div className="form-grid">
                    <Field label="Loại giao dịch">
                      <select name="type">
                        <option value="income">Khoản thu</option>
                        <option value="expense">Khoản chi</option>
                      </select>
                    </Field>
                    <Field label="Số tiền (VND) *">
                      <input
                        required
                        name="amount"
                        type="number"
                        min="1"
                        max="999999999999"
                        step="1"
                        placeholder="0"
                      />
                    </Field>
                  </div>
                  <Field label="Nội dung *">
                    <input
                      autoFocus
                      required
                      name="title"
                      placeholder="Ví dụ: Thu phí dịch vụ tháng 9"
                      maxLength={200}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Ngày ghi nhận *">
                      <input
                        type="date"
                        name="date"
                        required
                        defaultValue={today}
                      />
                    </Field>
                    <Field label="Danh mục">
                      <input
                        name="category"
                        placeholder="Dịch vụ, văn phòng…"
                        maxLength={100}
                      />
                    </Field>
                  </div>
                  <Field label="Khách hàng liên quan">
                    <select name="customerId">
                      <option value="">Không gắn khách hàng</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {modal.type === "invite" && (
                <>
                  <p className="modal-description">
                    Tạo liên kết mời dành riêng cho email bên dưới để cùng quản
                    lý công việc.
                  </p>
                  <Field label="Email thành viên *">
                    <input
                      autoFocus
                      required
                      type="email"
                      name="email"
                      placeholder="ten@congty.vn"
                    />
                  </Field>
                  <Field label="Vai trò">
                    <select name="role">
                      <option value="member">
                        Thành viên — Công việc và khách hàng
                      </option>
                      <option value="admin">
                        Quản trị viên — Thêm quyền thu chi và mời người
                      </option>
                    </select>
                  </Field>
                  <p className="hint">
                    Sau khi tạo, bạn có thể sao chép liên kết để gửi cho người
                    được mời.
                  </p>
                </>
              )}
              <div className="modal-actions">
                {modal.item && !modal.readOnly && !me.workspace.suspendedAt && (modal.type === "task" || (modal.type === "customer" && canManage)) && (
                  <ActionMenu className="modal-trash-menu" label="Thao tác bản ghi" disabled={busy} items={[
                    { label: "Chuyển vào thùng rác", icon: Trash2, danger: true, onSelect: () => requestTrash(modal.type, modal.item) },
                  ]} />
                )}
                <Button
                  secondary
                  icon={null}
                  type="button"
                  onClick={() => setModal(null)}
                >
                  {modal.readOnly ? "Đóng" : "Hủy"}
                </Button>
                {!modal.readOnly && (
                  <Button
                    icon={busy ? LoaderCircle : Check}
                    disabled={busy}
                    type="submit"
                  >
                    {busy
                      ? "Đang lưu…"
                      : modal.type === "invite"
                        ? "Tạo liên kết mời"
                        : "Lưu thông tin"}
                  </Button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
      {trashTarget && (
        <MoveToTrashDialog target={trashTarget} api={api} onClose={() => setTrashTarget(null)} onMoved={afterTrashMoved} />
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}{" "}
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Đóng thông báo">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({ icon: Icon, color, title, value, foot, onClick }) {
  return (
    <button
      className={`stat-card ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div>
        <span>{title}</span>
        <span className={`stat-icon ${color}`}>
          <Icon size={19} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{foot}</small>
    </button>
  );
}
function PageHeading({ title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function SearchBox({ value, setValue, placeholder }) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button aria-label="Xóa tìm kiếm" onClick={() => setValue("")}>
          <X size={16} />
        </button>
      )}
    </label>
  );
}
function Auth({ onLogin, notify, toast }) {
  const [googleEnabled,setGoogleEnabled]=useState(false);
  useEffect(()=>{api("/auth/google/config").then(d=>setGoogleEnabled(d.enabled)).catch(()=>{});},[]);
  const token = new URLSearchParams(location.search).get("invite");
  const [mode, setMode] = useState(token ? "invite" : "login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      await api(mode === "invite" ? "/invitations/accept" : `/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ ...body, ...(token ? { token } : {}) }),
      });
      if (token && mode === "invite")
        history.replaceState({}, "", location.pathname);
      await onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Bell size={24} />
            <i />
          </span>
          nhắc tôi<span className="brand-dot">.</span>
        </a>
        <div className="auth-story-body">
          <span className="eyebrow">NHỚ VIỆC NHỎ. LÀM ĐIỀU LỚN.</span>
          <h1>
            Việc đâu vào đấy.
            <br />
            Ngày thêm
            <br />
            <em>nhẹ nhàng.</em>
          </h1>
          <p>
            Một không gian cho công việc, lịch nhắc,
            <br />
            khách hàng và cả đội ngũ của bạn.
          </p>
          <div className="auth-task-preview">
            <span className="checked">
              <Check size={15} />
            </span>
            <div>
              <strong>Nhắc khách gia hạn dịch vụ</strong>
              <span>Hôm nay, 09:00 · Đã hoàn thành</span>
            </div>
            <span className="preview-spark">✦</span>
          </div>
          <div className="auth-feature-row">
            <span>
              <Check size={15} /> Nhắc đúng hẹn
            </span>
            <span>
              <Check size={15} /> Cộng tác dễ dàng
            </span>
          </div>
        </div>
        <span className="auth-copyright">
          © {new Date().getFullYear()} Nhắc tôi · Dành cho những đội ngũ tận
          tâm
        </span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form">
          <span className="welcome-icon">
            <Bell size={25} />
          </span>
          <h2>
            {mode === "login"
              ? "Chào mừng bạn trở lại"
              : mode === "invite"
                ? "Gia nhập đội ngũ"
                : "Khởi đầu một ngày ngăn nắp"}
          </h2>
          <p>
            {mode === "login"
              ? "Đăng nhập để tiếp tục những việc đang làm."
              : mode === "invite"
                ? "Tạo tài khoản để nhận lời mời vào không gian."
                : "Tạo không gian riêng và dùng thử trong 14 ngày."}
          </p>
          <form onSubmit={submit}>
            {mode !== "login" && (
              <Field label="Họ và tên">
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Tên của bạn"
                  maxLength={100}
                />
              </Field>
            )}
            {mode !== "invite" && (
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="ban@congty.vn"
                />
              </Field>
            )}
            <Field label="Mật khẩu">
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 10}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login" ? "Nhập mật khẩu" : "Ít nhất 10 ký tự"
                }
              />
            </Field>
            {mode === "register" && (
              <>
                <Field label="Tên không gian / doanh nghiệp">
                  <input
                    name="workspaceName"
                    required
                    placeholder="Ví dụ: An Nhiên Studio"
                    maxLength={150}
                  />
                </Field>
                <Field label="Lĩnh vực dịch vụ">
                  <select name="industry">
                    <option>Dịch vụ tổng hợp</option>
                    <option>Kế toán & tư vấn</option>
                    <option>Spa & làm đẹp</option>
                    <option>Bảo trì & kỹ thuật</option>
                    <option>Marketing & sáng tạo</option>
                    <option>Giáo dục & đào tạo</option>
                    <option>Bất động sản</option>
                  </select>
                </Field>
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <Button
              type="submit"
              icon={busy ? LoaderCircle : ArrowRight}
              disabled={busy}
            >
              {busy
                ? "Đang xử lý…"
                : mode === "login"
                  ? "Vào không gian làm việc"
                  : mode === "invite"
                    ? "Tham gia không gian"
                    : "Tạo không gian miễn phí"}
            </Button>
          </form>
          {
            <p className="auth-switch">
              {mode === "login"
                ? token
                  ? "Chưa có tài khoản?"
                  : "Chưa có không gian riêng?"
                : "Đã có tài khoản?"}{" "}
              <button
                onClick={() => {
                  setMode(
                    mode === "login"
                      ? token
                        ? "invite"
                        : "register"
                      : "login",
                  );
                  setError("");
                }}
              >
                {mode === "login"
                  ? token
                    ? "Tạo tài khoản từ lời mời"
                    : "Dùng thử miễn phí"
                  : "Đăng nhập"}
              </button>
            </p>
          }
          {googleEnabled && <a className="button secondary" href="/api/auth/google/start">Tiếp tục với Google</a>}
          <div className="auth-security">
            <ShieldCheck size={15} /> Dữ liệu riêng cho từng không gian làm việc
          </div>
        </div>
      </section>
    </div>
  );
}

function AcceptInvitation({ token, me, onAccepted, onLogout }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await api("/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      history.replaceState({}, "", location.pathname);
      await onAccepted();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="invite-page">
      <section className="auth-form panel">
        <span className="welcome-icon">
          <Users size={25} />
        </span>
        <h2>Bạn có lời mời vào đội ngũ</h2>
        <p>
          Bạn đang đăng nhập bằng <strong>{me.user.email}</strong>. Chỉ tài
          khoản đúng email được mời mới có thể tham gia.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Button
          icon={busy ? LoaderCircle : Check}
          disabled={busy}
          onClick={accept}
        >
          Nhận lời mời
        </Button>
        <p className="auth-switch">
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                onLogout();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Đăng nhập bằng tài khoản khác
          </button>
        </p>
        <button
          className="text-button"
          onClick={() => {
            history.replaceState({}, "", location.pathname);
            onAccepted();
          }}
        >
          Về không gian hiện tại
        </button>
      </section>
    </div>
  );
}
