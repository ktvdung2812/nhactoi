import { useTaskMutation } from './useTaskMutation.js';
import PublicIntegrations from "./PublicIntegrations.jsx";
import WebPushSettings from "./WebPushSettings.jsx";
import RecurrenceFields from "./RecurrenceFields.jsx";
import WeekCalendar from "./WeekCalendar.jsx";
import PersonalTasks from "./PersonalTasks.jsx";
import Appearance from "./Appearance.jsx";
import { useAppearance } from "./appearance.js";
import Projects from "./Projects.jsx";
import GoogleCalendar from "./GoogleCalendar.jsx";
import ZaloOa from "./ZaloOa.jsx";
import TaskTemplates from "./TaskTemplates.jsx";
import AssistantChat from "./AssistantChat.jsx";
import {GoogleAccount} from "./OperationsSettings.jsx";
import Account, { ThemeSettings } from "./Account.jsx";
import ThemeToggle, { ThemeToggleButton } from "./ThemeToggle.jsx";
import { useTheme } from "./theme.js";
import BoardTransfer from "./BoardTransfer.jsx";
import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Inbox,
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
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  X,
  Check,
  Clock3,
  LogOut,
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
  Moon,
  Sun,
  Zap,
  Palette,
} from "lucide-react";
import Admin from "./Admin.jsx";
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
import CustomerDetail from "./CustomerDetail.jsx";
import { readRoute } from "./routes.js";
import { planningDay } from "../shared/personal-planning.mjs";
import { useNow } from "./PlannerDashboard.jsx";
import OperationsDashboard from "./OperationsDashboard.jsx";
import {WorkSettings,WorkReports} from "./WorkManagement.jsx";

const money = (n) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
const dateLabel = (d, options = { day: "2-digit", month: "2-digit" }) =>
  d ? new Date(d).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...options }) : "Chưa đặt lịch";
const localInput = (d) => {
  const t = new Date(d || Date.now());
  return new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const navItems = [
  ["dashboard", "Tổng quan", LayoutDashboard],
  ["tasks", "Công việc", CheckCheck],
  ["today", "Hôm nay", Sun],
  ["upcoming", "Sắp tới", CalendarDays],
  ["week", "Lịch tuần", CalendarDays],
  ["inbox", "Inbox", Inbox],
  ["projects", "Dự án", Building2],
  ["teams", "Teams", Users],
  ["customers", "Khách hàng", Users],
  ["services", "Quản lý gia hạn", RefreshCw],
  ["finance", "Thu & chi", Wallet],
  ["transfer", "Nhập / xuất bảng", Copy],
  ["tickets", "Hỗ trợ", LifeBuoy],
  ["trash", "Thùng rác", Trash2],
  ["automations", "Tự động hóa", Sparkles],
  ["google-calendar", "Google Calendar", CalendarDays],
  ["public-integrations", "API và webhook", ShieldCheck],
  ["zalo-oa", "Zalo OA", CalendarDays],
  ["account", "Tài khoản", ShieldCheck],
  ["templates", "Mẫu công việc", Copy],
];

const navSections = [
  {
    id: "core",
    items: ["dashboard", "tasks"],
  },
  {
    id: "schedule",
    label: "Kế hoạch",
    items: ["today", "upcoming", "week", "inbox"],
  },
  {
    id: "workspace",
    label: "Không gian",
    items: ["projects", "teams", "customers", "services", "finance"],
  },
  {
    id: "utilities",
    label: "Tiện ích",
    collapsible: true,
    items: ["templates", "automations", "public-integrations", "google-calendar", "zalo-oa", "transfer", "tickets", "trash"],
  },
];
function migrateLegacyHashRoute() {
  if (!["/", "/index.html"].includes(location.pathname)) return;
  const legacy = location.hash.match(/^#\/(.+)$/)?.[1];
  if (!legacy) return null;
  const search = legacy.includes("?") ? "" : location.search;
  return `/${legacy}${search}`;
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
  const data = r.status === 204 ? {} : await r.json().catch(() => {
    if (r.ok) throw Object.assign(new Error("Chưa xác minh được phản hồi máy chủ. Giữ nguyên nội dung và thử lại để đối soát."), { status: 503 });
    return {};
  });
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
      "email is already registered": path.startsWith("/admin/") || path === "/me"
        ? "Email này đã được sử dụng bởi tài khoản khác."
        : "Email đã có tài khoản. Vui lòng đăng nhập.",
      "email is already a workspace member":
        "Email này đã là thành viên của không gian.",
      "invitation is invalid or expired":
        "Liên kết mời không hợp lệ, đã được dùng hoặc đã hết hạn.",
      "authenticate as the invited email to accept this invitation":
        "Vui lòng đăng nhập bằng đúng email được mời.",
      "email is invalid": "Địa chỉ email không hợp lệ.",
      "password must be between 8 and 256 characters":
        "Mật khẩu phải có từ 8 đến 256 ký tự.",
      "user account is disabled": "Tài khoản đã bị khóa.",
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
    const authFieldNames = {
      name: "Họ và tên",
      email: "Email",
      password: "Mật khẩu",
      workspaceName: "Tên không gian / doanh nghiệp",
      code: "Mã xác nhận",
    };
    const authValidation =
      [
        "/auth/login",
        "/auth/register",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/invitations/accept",
      ].includes(path) &&
      fieldError &&
      authFieldNames[fieldError[1]]
        ? `${authFieldNames[fieldError[1]]} ${
            fieldError[2] === "required"
              ? "không được để trống"
              : fieldError[2] === "too long"
                ? "vượt quá độ dài cho phép"
                : "không hợp lệ"
          }.`
        : null;
    const profileValidation =
      path === "/me" && fieldError &&
      { name: "Họ và tên", email: "Email" }[fieldError[1]]
        ? `${{ name: "Họ và tên", email: "Email" }[fieldError[1]]} ${fieldError[2] === "required" ? "không được để trống" : fieldError[2] === "too long" ? "vượt quá độ dài cho phép" : "không hợp lệ"}.`
        : null;
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
        ((path.startsWith("/ai/") || path.startsWith("/web-push/")) && /[^\x00-\x7F]/.test(raw) ? raw : null) ||
        (path.startsWith("/auth/") && [400, 403, 409, 429, 503].includes(r.status) && /[^\x00-\x7F]/.test(raw) ? raw : null) ||
        authValidation ||
        profileValidation ||
        adminValidation ||
        ((path.startsWith("/admin/") ||
          path.startsWith("/tickets") ||
          path.startsWith("/teams") || path.startsWith("/appearance") ||
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
    error.retryAfterSeconds = Number(r.headers.get("Retry-After")) || 0;
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
  const router = useRouter();
  const { isDark, toggleTheme } = useTheme();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [noticeOpen, setNoticeOpen] = useState(false),
    [mobile, setMobile] = useState(false),
    [sidebarHidden, setSidebarHidden] = useState(() => {
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem("nhactoi_sidebar_hidden");
          if (saved !== null) return saved === "true";
        } catch {}
        // Tablets keep the icon rail so page content has room to breathe.
        return window.innerWidth < 1024;
      }
      return false;
    }),
    [busy, setBusy] = useState(false),
    [billing, setBilling] = useState(null),
    [cycle, setCycle] = useState("yearly"),
    [financeType, setFinanceType] = useState("all"),
    [invitation, setInvitation] = useState(null),
    [workspaces, setWorkspaces] = useState(null),
    [bootError, setBootError] = useState(null),
    [previewToast, setPreviewToast] = useState("");
  const taskApi = useTaskMutation(api, `${me?.workspace?.id || ''}:${me?.user?.id || ''}`);
  const modalTaskApi = useTaskMutation(api, modal);
  const [trashTarget, setTrashTarget] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarMeta,setCalendarMeta]=useState({});
  const [calendarPage,setCalendarPage]=useState(1);
  const [selectedServiceId, setSelectedServiceId] = useState(() => new URLSearchParams(location.search).get("service"));
  const [teamsRevision, setTeamsRevision] = useState(0);
  const [taskTeamFilter, setTaskTeamFilter] = useState("all");
  const [taskTeamId, setTaskTeamId] = useState("");
  const [taskPage, setTaskPage] = useState(1), [customerTaskFilter, setCustomerTaskFilter] = useState("all"), [bootstrapReadError, setBootstrapReadError] = useState("");
  const [projects,setProjects]=useState([]),[taskProjectId,setTaskProjectId]=useState(""),[projectFilter,setProjectFilter]=useState("all"),[projectMembers,setProjectMembers]=useState([]);
  const [taskReturnPage, setTaskReturnPage] = useState(null);
  const [aiTaskId, setAiTaskId] = useState(null);
  const [selectedAiTaskId, setSelectedAiTaskId] = useState(null);
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      setMobile((prev) => !prev);
    } else {
      setSidebarHidden((prev) => {
        const next = !prev;
        try {
          localStorage.setItem("nhactoi_sidebar_hidden", String(next));
        } catch {}
        return next;
      });
    }
  };

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === "b") {
        const target = e.target;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const workspaceRef = useRef(null);
  const refreshSequence = useRef(0), calendarSequence = useRef(0);
  workspaceRef.current = me?.workspace?.id || null;
  useEffect(() => {
    const query = searchParams?.toString();
    setPage(readRoute(pathname, query ? `?${query}` : ""));
  }, [pathname, searchParams]);
  const handledPush = useRef(null);
  useEffect(() => {
    const notificationId = searchParams.get('notification');
    if (!me || !notificationId || handledPush.current === `${me.user.id}:${notificationId}`) return;
    handledPush.current = `${me.user.id}:${notificationId}`;
    (async () => {
      try {
        const target = await api(`/web-push/notifications/${encodeURIComponent(notificationId)}`);
        if (target.workspaceId !== workspaceRef.current) {
          await api('/workspaces/switch', { method: 'POST', body: JSON.stringify({ workspaceId: target.workspaceId }) });
          await refresh();
        }
        router.replace(target.path);
      } catch (error) {
        setToast({ message: error.message || 'Thông báo không còn khả dụng.', error: true });
        router.replace('/dashboard');
      }
    })();
  }, [me?.user.id, searchParams]);
  useEffect(() => {
    const legacyTarget = migrateLegacyHashRoute();
    if (!legacyTarget) return;
    router.replace(legacyTarget);
    setPage(readRoute());
  }, [router]);
  useEffect(() => {
    if (modal?.type === "task") {
      setTaskTeamId(modal.item?.teamId || modal.teamId || "");
      setTaskProjectId(modal.item?.projectId || (projectFilter!=="all"?projectFilter:""));
    }
  }, [modal]);
  useEffect(()=>{let live=true;setProjectMembers([]);if(taskProjectId)api(`/projects/${taskProjectId}/members`).then(r=>live&&setProjectMembers(r.members)).catch(e=>live&&notify(e.message));return()=>{live=false;};},[taskProjectId]);
  useEffect(() => {
    setTaskTeamFilter("all");
    setProjectFilter("all");
    setTaskProjectId("");
    setModal(null);
    setTrashTarget(null);
    setTaskReturnPage(null);
    setAiTaskId(null);
    setSelectedAiTaskId(null);
    setCalendarEvents([]);
    setCalendarMeta({});
    setSelectedServiceId(new URLSearchParams(location.search).get("service"));
  }, [me?.workspace?.id]);
  useEffect(() => {
    setSelectedServiceId(searchParams.get('service'));
  }, [searchParams]);
  useEffect(() => {
    const eventId = searchParams.get('event');
    if (!me || !eventId || page !== 'tasks') return;
    let canceled = false;
    api(`/calendar-events/${encodeURIComponent(eventId)}`).then(result => {
      if (!canceled) openUnifiedItem({ ...result.event, kind: 'event' });
    }).catch(error => { if (!canceled) setToast({ message: error.message, error: true }); });
    return () => { canceled = true; };
  }, [me?.workspace?.id, searchParams, page]);
  useEffect(() => {
    const active = (data.teams || []).filter((t) => !t.archivedAt);
    if (
      (active.length <= 1 && taskTeamFilter !== "all") ||
      (!["all", "common"].includes(taskTeamFilter) &&
        !active.some((t) => t.id === taskTeamFilter))
    ) {
      setTaskTeamFilter("all");
    }
  }, [data.teams, taskTeamFilter]);
  const notify = (message, error = false) => setToast({ message, error });
  const appearanceTeamId = page === "appearance" ? searchParams.get("team") || ""
    : page.startsWith("teams/") ? page.split("/")[1]
    : page.startsWith("tasks/") ? (data.tasks || []).find(task => task.id === page.split("/")[1])?.teamId || (taskReturnPage?.startsWith("teams/") ? taskReturnPage.split("/")[1] : "")
    : page === "tasks" && !["all", "common"].includes(taskTeamFilter) ? taskTeamFilter : "";
  const appearance = useAppearance({ api, userId: me?.user?.id, workspaceId: me?.workspace?.id,
    teamId: appearanceTeamId, enabled: !!me && !page.startsWith("admin/") && !["login", "register", "forgot-password", "reset-password"].includes(page), notify });
  const customerScope = modal?.type === "customer" ? modal.item?.id : page.startsWith("customers/") ? page.split("/")[1] : null;
  const taskBoardPage = page === "tasks" || page.startsWith("tasks/");
  const needsTasks = page === "dashboard" || taskBoardPage || Boolean(customerScope);
  const taskQuery = new URLSearchParams({ page: String(taskPage), pageSize: "50" });
  if (!needsTasks) taskQuery.set("tasks", "none");
  if (customerScope) {
    taskQuery.set("customerId", customerScope);
    if (modal?.type !== "customer" && customerTaskFilter === "open") taskQuery.set("openOnly", "true");
    else if (modal?.type !== "customer" && customerTaskFilter !== "all") taskQuery.set("status", customerTaskFilter);
  } else if (page === "dashboard") {
    taskQuery.set("openOnly", "true");
    if (["today", "overdue"].includes(filter)) taskQuery.set("due", filter);
  } else if (taskBoardPage) {
    if (taskTeamFilter !== "all") taskQuery.set("teamId", taskTeamFilter);
    if (projectFilter !== "all") taskQuery.set("projectId", projectFilter);
    if (search) taskQuery.set("q", search);
  }
  const dashboardPath = `/dashboard?${taskQuery}`;
  const calendarQuery=new URLSearchParams({page:String(calendarPage),pageSize:'50'});
  if(page==='dashboard'){calendarQuery.set('kind','event');calendarQuery.set('openOnly','true');if(['today','overdue'].includes(filter))calendarQuery.set('due',filter);}
  else if(taskBoardPage){if(taskTeamFilter!=='all')calendarQuery.set('teamId',taskTeamFilter);if(projectFilter!=='all')calendarQuery.set('kind','none');if(search)calendarQuery.set('q',search);}
  const calendarPath=`/calendar-events?${calendarQuery}`;
  useEffect(()=>{setCalendarPage(1);},[page,taskTeamFilter,projectFilter,search,filter]);
  useEffect(() => { setTaskPage(1); }, [page, customerScope, customerTaskFilter, taskTeamFilter, projectFilter, search, filter]);
  useEffect(() => { setCustomerTaskFilter("all"); }, [page]);
  async function refresh() {
    const sequence = ++refreshSequence.current, workspaceId = workspaceRef.current;
    const [m, d, p] = await Promise.all([api("/me"), api(dashboardPath), api("/projects")]);
    if (sequence !== refreshSequence.current || workspaceRef.current !== workspaceId) return;
    if (m.workspace.id !== d.workspace.id) throw new Error("Không gian đã thay đổi. Vui lòng làm mới dữ liệu.");
    setMe(m);
    setProjects(p.projects);
    if(m.user.memberType==='guest')setProjectFilter(current=>current==='all'?(p.projects[0]?.id||'all'):current);
    setData({ ...d, taskQuery: dashboardPath });
    setBootstrapReadError("");
    setTeamsRevision((v) => v + 1);
    setBootError(null);
  }
  async function loadCalendarEvents() {
    if(me?.user?.memberType==='guest') {setCalendarEvents([]);return {events:[]};}
    const workspaceId = workspaceRef.current;
    const sequence = ++calendarSequence.current;
    const result = await api(calendarPath);
    if (sequence === calendarSequence.current && workspaceRef.current === workspaceId) {setCalendarEvents(result.events || []);setCalendarMeta({...result,path:calendarPath});}
    return result;
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
    if (!me) return undefined;
    let canceled = false;
    const withCalendar = me.user.memberType!=="guest" && ["tasks", "dashboard"].includes(page);
    const load = () => {
      if (document.visibilityState === "hidden") return;
      const workspaceId = workspaceRef.current;
      const sequence = ++refreshSequence.current;
      const calendarRequest = withCalendar ? ++calendarSequence.current : null;
      Promise.all([api(dashboardPath), withCalendar ? api(calendarPath) : null])
        .then(([dashboard, calendarResult]) => {
          if (canceled || sequence !== refreshSequence.current || workspaceRef.current !== workspaceId) return;
          setData({ ...dashboard, taskQuery: dashboardPath });
          setBootstrapReadError("");
          setMe((current) => current ? { ...current, workspace: dashboard.workspace, subscription: dashboard.subscription } : current);
          setTeamsRevision((v) => v + 1);
          if (calendarResult && calendarRequest === calendarSequence.current) {setCalendarEvents(calendarResult.events || []);setCalendarMeta({...calendarResult,path:calendarPath});}
        })
        .catch(error => {
          if (!canceled && sequence === refreshSequence.current) { if (error.status === 401) setMe(null); else setBootstrapReadError(error.message); }
        });
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      canceled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [me?.workspace?.id, page, dashboardPath, calendarPath]);
  useEffect(() => {
    if (!previewToast) return;
    const timer = setTimeout(() => setPreviewToast(""), 3000);
    return () => clearTimeout(timer);
  }, [previewToast]);
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
    if (!page.startsWith("tasks/") && !aiTaskId) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector(".task-detail-modal");
    dialog?.focus({ preventScroll: true });
    if (dialog) dialog.scrollTop = 0;
    function onKey(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".modal-backdrop, .task-detail-modal .action-menu-popup, .task-detail-modal .td-tasklist-panel, .task-detail-modal .td-mention-list")) return;
      closeTaskDetail();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
    };
  }, [page, taskReturnPage, aiTaskId]);
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
        const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
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
  const tasks = data.taskQuery === dashboardPath ? data.tasks || [] : [],
    teams = data.teams || [],
    customers = data.customers || [],
    members = data.members || [],
    transactions = data.transactions || [],
    notifications = data.notifications || [];
  const customerTasks = modal?.type === "customer" && modal.item
    ? tasks.filter((task) => task.customerId === modal.item.id)
    : [];
  const now = useNow(),
    today = planningDay(now),
    isToday = (d) => d && planningDay(d) === today;
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
  const eventItems = calendarEvents.map((event) => ({
    ...event,
    id: event.id,
    kind: event.service_id ? "renewal" : "event",
    priority: "medium",
    status: event.status || "todo",
    dueAt: event.starts_at,
    endsAt: event.ends_at,
    remindAt: event.remind_at,
    teamId: event.team_id || null,
    teamName: teams.find((team) => team.id === event.team_id)?.name || null,
    category: event.service_id ? "Gia hạn dịch vụ" : "Lịch hẹn",
  }));
  const unifiedItems = [
    ...tasks.map((task) => ({ ...task, kind: "task" })),
    ...eventItems,
  ];
  const teamScopedItems = unifiedItems.filter(
    (item) =>
      (projectFilter === "all" || item.projectId === projectFilter) && (taskTeamFilter === "all" ||
      (taskTeamFilter === "common" ? !item.teamId : item.teamId === taskTeamFilter)),
  );
  const filteredItems = teamScopedItems.filter(
    (item) =>
      item.kind === "task" || `${item.title} ${item.description || ""} ${item.category || ""} ${item.teamName || ""} ${item.kind === "event" ? "lịch hẹn" : item.kind === "renewal" ? "gia hạn" : "công việc"}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const boardItems = unifiedItems.filter((item) => item.kind !== "renewal");
  const openBoard = boardItems.filter((item) => item.status !== "done");
  const overdueBoard = openBoard.filter((item) => item.dueAt && new Date(item.dueAt) < now);
  const dueTodayBoard = openBoard.filter((item) => isToday(item.dueAt));
  const dashboardItems = filter === "overdue" ? overdueBoard : filter === "today" ? dueTodayBoard : openBoard;
  const taskTotals = data.taskSummary || { total: tasks.length, open: openTasks.length, completed: completed.length, today: dueToday.length, overdue: overdue.length, byAssignee: members.map(member=>{const rows=tasks.filter(task=>task.assigneeId===member.id);return {id:member.id,total:rows.length,open:rows.filter(task=>task.status!=="done").length,completed:rows.filter(task=>task.status==="done").length};}), byCustomer: customers.map(customer=>{const rows=tasks.filter(task=>task.customerId===customer.id);return {id:customer.id,total:rows.length,open:rows.filter(task=>task.status!=="done").length,completed:rows.filter(task=>task.status==="done").length};}) };
  const boardCounts = { open: taskTotals.open + (calendarMeta.summary?.eventOpen??eventItems.filter(item=>item.kind!=="renewal" && item.status!=="done").length),
    today: taskTotals.today + (calendarMeta.summary?.eventToday??eventItems.filter(item=>item.kind!=="renewal" && item.status!=="done" && isToday(item.dueAt)).length),
    overdue: taskTotals.overdue + (calendarMeta.summary?.eventOverdue??eventItems.filter(item=>item.kind!=="renewal" && item.status!=="done" && item.dueAt && new Date(item.dueAt)<now).length) };
  const taskPagination = needsTasks && data.taskPage ? <><nav className="task-pagination" aria-label="Phân trang công việc">
    <button type="button" disabled={taskPage===1 || data.taskQuery!==dashboardPath} onClick={()=>setTaskPage(n=>n-1)}>Trang trước</button>
    <span role="status">{data.taskQuery!==dashboardPath ? "Đang tải…" : `Trang ${data.taskPage.page} · ${data.taskPage.total} công việc`}</span>
    <button type="button" disabled={!data.taskPage.hasMore || data.taskQuery!==dashboardPath} onClick={()=>setTaskPage(n=>n+1)}>Trang tiếp</button>
  </nav>
    {me.user.memberType!=='guest'&&!customerScope&&calendarMeta.total>0&&<nav className="task-pagination" aria-label="Phân trang lịch hẹn"><button disabled={calendarPage===1||calendarMeta.path!==calendarPath} onClick={()=>setCalendarPage(n=>n-1)}>Lịch hẹn trước</button><span role="status">{calendarMeta.path!==calendarPath?'Đang tải…':`Trang lịch hẹn ${calendarMeta.page} · ${calendarMeta.total} lịch hẹn/gia hạn`}</span><button disabled={!calendarMeta.hasMore||calendarMeta.path!==calendarPath} onClick={()=>setCalendarPage(n=>n+1)}>Lịch hẹn tiếp</button></nav>}
  </> : null;
  const person = (id) => members.find((m) => m.id === id),
    client = (id) => customers.find((c) => c.id === id);
  const selectedTaskTeam = teams.find((t) => t.id === taskTeamId);
  const preserveHistoricalAssignee =
    modal?.item?.teamId === taskTeamId &&
    (modal?.readOnly || modal?.item?.status === "done");
  const taskAssignees = taskProjectId ? projectMembers : taskTeamId
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
  const activeTaskTeams = teams.filter((t) => !t.archivedAt);
  const taskTeamOptions = activeTaskTeams.length > 1 ? [
    ["all", "Tất cả team của bạn"],
    ["common", "Việc chung của doanh nghiệp"],
    ...activeTaskTeams.map((t) => [t.id, t.name]),
  ] : [];
  const taskTeamLabel = taskTeamFilter === "all" ? "" : taskTeamOptions.find(([id]) => id === taskTeamFilter)?.[1] || "";
  function asBoardEvent(event) {
    return {
      ...event,
      kind: "event",
      dueAt: event.dueAt || event.starts_at,
      endsAt: event.endsAt || event.ends_at,
      remindAt: event.remindAt || event.remind_at || null,
      teamId: event.teamId ?? event.team_id ?? null,
      status: event.status || "todo",
    };
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
      try { await refresh(); }
      catch (error) {
        notify(`${success || 'Đã lưu thành công.'} Chưa làm mới được danh sách: ${error.message}`, true);
        return result;
      }
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
    if (trashTarget?.entityType === "task" && aiTaskId === trashTarget.item.id) setAiTaskId(null);
    if (trashTarget?.entityType === "task" && page === `tasks/${trashTarget.item.id}`)
      go(taskReturnPage || (trashTarget.item.teamId ? `teams/${trashTarget.item.teamId}` : "tasks"));
    if (trashTarget?.entityType === "customer" && page === `customers/${trashTarget.item.id}`)
      go("customers");
    setTrashTarget(null);
    notify("Đã chuyển vào Thùng rác cấp 2. Bạn có thể khôi phục tại đó.");
    try { await refresh(); }
    catch (error) { notify(`Đã chuyển vào thùng rác. ${error.message}`, true); }
  }
  async function moveBoardTask(task, status) {
    const workspaceId = me.workspace.id;
    const result = await taskApi(`/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, expectedRevision: task.revision }),
    });
    refreshSequence.current++;
    setData((current) => current.workspace?.id !== workspaceId ? current : ({
      ...current,
      tasks: [
        ...current.tasks.map((item) => item.id === result.task.id ? result.task : item),
        ...(result.nextTask && !current.tasks.some((item) => item.id === result.nextTask.id) ? [result.nextTask] : []),
      ],
    }));
    return result;
  }
  async function moveBoardItem(item, status) {
    if (item.kind === "event") {
      const workspaceId = workspaceRef.current;
      const result = await api(`/calendar-events/${encodeURIComponent(item.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      refreshSequence.current++;
      calendarSequence.current++;
      if (result.event && workspaceRef.current === workspaceId) {
        setCalendarEvents((current) => current.map((event) =>
          event.id === result.event.id
            ? { ...event, ...result.event }
            : event,
        ));
      }
      return result;
    }
    if (item.kind === "renewal") throw new Error("Kỳ gia hạn chỉ được xem từ trang Quản lý gia hạn.");
    return moveBoardTask(item, status);
  }
  async function complete(t) {
    await action(
      () =>
        taskApi(`/tasks/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: t.status === "done" ? "todo" : "done",
            expectedRevision: t.revision,
          }),
        }),
      t.status === "done" ? "Đã mở lại công việc" : "Đã hoàn thành công việc",
    );
  }
  function go(p) {
    if (page.startsWith("admin/") && !p.startsWith("admin/")) {
      refresh().catch((e) => {
        if (e.status === 401) setMe(null);
        else notify(e.message, true);
      });
    }
    const target = `/${p.replace(/^\/+/, "")}`;
    if (`${location.pathname}${location.search}` !== target)
      router.push(target);
    const nextUrl = new URL(target, location.origin);
    setPage(readRoute(nextUrl.pathname, nextUrl.search));
    setSearch("");
    setFilter("all");
    setMobile(false);
    setWorkspaces(null);
  }
  function openTaskDetail(task) {
    setTaskReturnPage(page.startsWith("teams/") || ["inbox", "today", "upcoming", "week"].includes(page) ? page : "tasks");
    setModal(null);
    setNoticeOpen(false);
    go(`tasks/${task.id}`);
  }
  function openAiTask(task) {
    if (page === "dashboard" && !dashboardItems.some(item => item.id === task.id)) go("tasks");
    if (page === "tasks" && !filteredItems.some(item => item.id === task.id)) {
      setSearch(""); setFilter("all"); setTaskTeamFilter("all");
    }
    setSelectedAiTaskId(task.id);
    setAiTaskId(task.id);
  }
  function closeTaskDetail(task) {
    if (aiTaskId) setAiTaskId(null);
    else go(taskReturnPage || (task?.teamId ? `teams/${task.teamId}` : "tasks"));
  }
  function openUnifiedItem(item) {
    setNoticeOpen(false);
    if (item.kind === "renewal") {
      setSelectedServiceId(item.service_id || null);
      go(item.service_id ? `services?service=${encodeURIComponent(item.service_id)}` : "services");
      return;
    }
    if (item.kind === "event") {
      const event = asBoardEvent(item);
      setModal({
        type: "task",
        appointment: true,
        item: event,
        teamId: event.teamId,
        readOnly: !event.canEdit || Boolean(me.workspace.suspendedAt),
      });
      if (page !== "tasks") go("tasks");
      return;
    }
    openTaskDetail(item);
  }
  async function submitModal(e) {
    e.preventDefault();
    if (modal.readOnly) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    let path,
      method = "POST",
      payload = f;
    if (modal.type === "task" && modal.appointment) {
      const startsAt = new Date(f.dueAt);
      const endsAt = new Date(f.endsAt);
      const remindAt = f.remindAt ? new Date(f.remindAt) : null;
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        notify("Thời gian kết thúc phải sau thời gian bắt đầu.", true);
        return;
      }
      if (remindAt && (!Number.isFinite(remindAt.getTime()) || remindAt > startsAt)) {
        notify("Thời gian nhắc phải trước giờ bắt đầu.", true);
        return;
      }
      const id = modal.item?.kind === "event" ? modal.item.id : null;
      const result = await action(() => api(`/calendar-events${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          title: String(f.title || "").trim(),
          expectedRevision: id ? modal.item.revision : undefined,
          description: f.description || "",
          teamId: taskTeamId || null,
          status: f.status,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          remindAt: remindAt ? remindAt.toISOString() : null,
        }),
      }), "Đã lưu thành công");
      if (result) {
        setModal(null);
        await loadCalendarEvents();
      }
      return;
    }
    if (modal.type === "task") {
      path = "/tasks" + (modal.item ? `/${modal.item.id}` : "");
      method = modal.item ? "PATCH" : "POST";
      payload = {
        ...f,
        expectedRevision: modal.item?.revision,
        recurrenceOptions: JSON.parse(f.recurrenceOptions || '{}'),
        dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null,
        remindAt: f.remindAt ? new Date(f.remindAt).toISOString() : null,
        projectId: taskProjectId || undefined,
        assigneeId: f.assigneeId || null,
        ...(me.user.memberType==='guest'?{}:{customerId: f.customerId || null}),
        teamId: taskProjectId ? projects.find(p=>p.id===taskProjectId)?.teamId || null : taskTeamId || null,
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
      () => modalTaskApi(path, { method, body: JSON.stringify(payload) }),
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
  const inviteToken = new URLSearchParams(location.search).get("invite");
  if (!me) return <Auth onLogin={refresh} onReset={() => setMe(null)} />;
  if (inviteToken)
    return (
      <AcceptInvitation
        token={inviteToken}
        me={me}
        onAccepted={refresh}
        onLogout={() => setMe(null)}
      />
    );
  if (["login", "register", "forgot-password", "reset-password"].includes(page))
    return <Auth onLogin={refresh} onReset={() => setMe(null)} />;
  if (page.startsWith("admin/")) {
    if (me.user.isPlatformAdmin)
      return <Admin page={page} me={me} api={api} go={go} />;
    return <AccessDenied onBack={() => go("dashboard")} />;
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="mobile-toggle icon-button" aria-label="Mở menu điều hướng" aria-expanded={mobile} onClick={() => setMobile(value => !value)}><Menu size={20} /></button>
          <div className="brand-box">
            <a
              href="/dashboard"
              className="brand"
              aria-label="Nhắc tôi — Tổng quan"
              onClick={(e) => {
                e.preventDefault();
                go("dashboard");
              }}
            >
              <span className="brand-mark">
                <Bell size={22} />
                <i />
              </span>
              <span className="brand-word">nhắc tôi<span className="brand-dot">.</span></span>
            </a>
          </div>
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
          <button className="icon-button" aria-label="Cá nhân hóa giao diện" title="Cá nhân hóa giao diện" onClick={() => go(`appearance${appearanceTeamId ? `?team=${encodeURIComponent(appearanceTeamId)}` : ""}`)}><Palette size={19} /></button>
          <ThemeToggleButton disabledReason={appearance.themeDisabledReason} />
          <button
            className="notification-trigger icon-button"
            aria-label="Thông báo"
            onClick={() => setNoticeOpen(!noticeOpen)}
          >
            <Bell size={19} />
            {unread.length > 0 && <i />}
          </button>
          <button
            className="icon-button"
            title={`Tài khoản (${me.user.name})`}
            aria-label="Tài khoản"
            onClick={() => go("account")}
            style={{ display: "inline-flex", padding: 0, border: "none", background: "transparent" }}
          >
            <Avatar name={me.user.name} small />
          </button>
          <button
            className="icon-button"
            title="Đăng xuất"
            aria-label="Đăng xuất"
            onClick={async () => {
              await api("/auth/logout", { method: "POST" });
              setMe(null);
            }}
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>

      <aside className={`sidebar ${sidebarHidden ? "hidden" : ""} ${mobile ? "open" : ""}`}>
        <button
          type="button"
          className="sidebar-edge-toggle sidebar-toggle-btn sidebar-collapse-btn"
          onClick={toggleSidebar}
          title={sidebarHidden ? "Phóng to menu trái (Ctrl+B)" : "Thu nhỏ menu trái (Ctrl+B)"}
          aria-label={sidebarHidden ? "Phóng to menu trái" : "Thu nhỏ menu trái"}
        >
          {sidebarHidden ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <div className="sidebar-inner">
          <div className="workspace-switch-wrap">
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
            <span className="workspace-icon" title={me.workspace.name}>
              <Building2 size={16} />
            </span>
            <span className="workspace-details">
              <strong>{me.workspace.name}</strong>
              <small>{taskTeamLabel || "Không gian làm việc"}</small>
            </span>
            <ChevronDown size={14} className="workspace-chevron" />
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
              {taskTeamOptions.length > 0 && <span>CHỌN TEAM</span>}
              {taskTeamOptions.map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={taskTeamFilter === id}
                  onClick={() => {
                    setTaskTeamFilter(id);
                    setWorkspaces(null);
                    if (page !== "tasks") go("tasks");
                  }}
                >
                  <Users size={16} />
                  <strong>{label}</strong>
                  {taskTeamFilter === id && <Check size={15} />}
                </button>
              ))}
              <button onClick={() => go("teams")}>
                <Users size={16} /> Quản lý thành viên
              </button>
            </div>
          )}
        </div>
        <nav className="sidebar-nav">
          {navSections.map((section) => {
            const sectionItems = navItems
              .filter(([id]) => section.items.includes(id))
              .filter(([id]) => me.user.memberType!=="guest" || ["tasks","projects","today","upcoming","inbox","week"].includes(id))
              .filter(([id]) => id!=="zalo-oa" || ["owner","admin"].includes(me.user.role))
              .filter(([id]) => !appearance.preferences.hiddenNav.includes(id))
              .filter((n) => (n[0] !== "finance" || canManage) && n[0] !== "account")
              .sort(([left], [right]) => appearance.preferences.navOrder.indexOf(left) - appearance.preferences.navOrder.indexOf(right));

            if (sectionItems.length === 0) return null;

            if (section.collapsible) {
              const isSectionActive = sectionItems.some(([id]) => page.split("/")[0] === id);
              const isOpen = utilitiesOpen || isSectionActive;

              return (
                <div key={section.id} className="nav-section nav-section-collapsible">
                  <button
                    type="button"
                    className="nav-caption nav-section-toggle"
                    onClick={() => setUtilitiesOpen(!isOpen)}
                    aria-expanded={isOpen}
                    title={section.label}
                  >
                    <span className="nav-caption-text">{section.label}</span>
                    <ChevronDown size={13} className={`nav-chevron ${isOpen ? "open" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="nav-group">
                      {sectionItems.map(([id, label, Icon]) => (
                        <button
                          key={id}
                          className={page.split("/")[0] === id ? "active" : ""}
                          title={label}
                          onClick={() => go(id)}
                        >
                          <Icon size={19} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={section.id} className="nav-section">
                {section.label && (
                  <div className="nav-caption">
                    <span className="nav-caption-text">{section.label}</span>
                  </div>
                )}
                <div className="nav-group">
                  {sectionItems.map(([id, label, Icon]) => (
                    <button
                      key={id}
                      className={page.split("/")[0] === id ? "active" : ""}
                      title={label}
                      onClick={() => go(id)}
                    >
                      <Icon size={19} />
                      <span>{label}</span>
                      {id === "tasks" && <b>{taskTotals.open + (calendarMeta.summary?.open??calendarEvents.filter((event) => (event.status || "todo") !== "done").length)}</b>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {me.user.isPlatformAdmin && (
            <button
              className="billing-nav"
              title="Quản trị SaaS"
              onClick={() => go("admin/overview")}
            >
              <ShieldCheck size={18} /> Quản trị SaaS <ArrowUpRight size={14} />
            </button>
          )}
          <div className="plan-promo">
            <span className="promo-icon">
              <Sparkles size={15} />
            </span>
            <strong>Cùng nhau, làm được nhiều hơn</strong>
            <p>Một nơi cho công việc, khách hàng và đội ngũ.</p>
            <button type="button" onClick={() => go("billing")}>
              <span>Khám phá gói dịch vụ</span> <ArrowUpRight size={13} />
            </button>
          </div>

        </div>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <main className={`main ${sidebarHidden ? "sidebar-collapsed" : ""}`}>
        <div className="page-content">
          {bootstrapReadError && <div role="alert">Không thể làm mới dữ liệu: {bootstrapReadError} <button type="button" onClick={()=>refresh().catch(e=>setBootstrapReadError(e.message))}>Thử lại</button></div> }
          {page === "week" && <WeekCalendar key={me.workspace.id} api={api} me={me} refreshToken={data.tasks} onOpenTask={openTaskDetail} onOpenEvent={event => openUnifiedItem({ ...event, kind: event.service_id ? "renewal" : "event", dueAt: event.starts_at, endsAt: event.ends_at, teamId: event.team_id })} onChanged={refresh} />}
          {["inbox", "today", "upcoming"].includes(page) && <PersonalTasks key={me.workspace.id} api={api} me={me} view={page} refreshToken={data.tasks} onOpen={openTaskDetail} onChanged={refresh} />}
          {page === "appearance" && <Appearance key={`${me.workspace.id}/${appearanceTeamId}`} appearance={appearance} teams={teams} teamId={appearanceTeamId} go={go} canManage={canManage} />}
          {(page.split("/")[0] === "teams" || (page.startsWith("tasks/") && taskReturnPage?.startsWith("teams/"))) && (
            <Teams
              key={`${me.workspace.id}/${page.startsWith("tasks/") ? taskReturnPage : page}`}
              api={api}
              go={go}
              me={me}
              members={members}
              teamId={(page.startsWith("tasks/") ? taskReturnPage : page).split("/")[1] || null}
              revision={teamsRevision}
              onChanged={refresh}
              onTaskMove={moveBoardTask}
              onTaskTrash={(task) => requestTrash("task", task)}
              onTaskCreate={(teamId, status = "todo", columnId = null) =>
                openTeamTask({ teamId, status, columnId })
              }
              onTaskOpen={openTaskDetail}
              selectedTaskId={selectedAiTaskId}
              memberTaskCounts={taskTotals.byAssignee}
              onInvite={canManage ? () => setModal({ type: "invite" }) : null}
              invitation={invitation}
            />
          )}
          {page === "public-integrations" && <PublicIntegrations key={me.workspace.id} api={api} me={me}/> }
          {page === "google-calendar" && <GoogleCalendar key={me.workspace.id} api={api}/> }
          {page === "zalo-oa" && <ZaloOa key={me.workspace.id} api={api}/> }
          {page === "projects" && <Projects key={me.workspace.id} api={api} me={me} teams={teams} onOpenTask={openTaskDetail} onChanged={refresh}/> }
          {page === "templates" && <TaskTemplates key={me.workspace.id} api={api} teams={teams} tasks={tasks} onOpen={openTaskDetail} onChanged={refresh} readOnly={Boolean(me.workspace.suspendedAt) || ["expired", "canceled"].includes(me.subscription?.status) || Boolean(me.subscription?.currentPeriodEnd && Date.parse(me.subscription.currentPeriodEnd) <= Date.now())}/>}
          {page === "account" && <>
            <PageHeading title="Tài khoản" subtitle="Quản lý thông tin cá nhân và các phương thức đăng nhập của bạn." />
            <div className="account-sections">
              <Account key={me.user.id} api={api} user={me.user} onSaved={(user) => {
                setMe((current) => current ? { ...current, user } : current);
                setData((current) => ({
                  ...current,
                  members: (current.members || []).map((member) => member.id === user.id
                    ? { ...member, name: user.name, email: user.email } : member),
                }));
              }} />
              <WebPushSettings key={`push-${me.user.id}`} api={api} />
              <ThemeSettings disabledReason={appearance.themeDisabledReason} />
              <button className="button" onClick={() => go("appearance")}><Palette size={16} /> Cá nhân hóa toàn bộ giao diện</button>
              <GoogleAccount api={api} />
            </div>
          </>}
          {page === "transfer" && <><PageHeading title="Nhập / xuất bảng" subtitle="Di chuyển dữ liệu công việc giữa các bảng."/><BoardTransfer key={me.workspace.id} api={api} teams={teams} onChanged={refresh}/></>}
          {page === "automations" && <Automations api={api} me={me} teams={teams} tasks={tasks} members={members} onChanged={refresh}/>}
          {page === "services" && <Services key={me.workspace.id} api={api} me={me} members={members} customers={customers} teams={teams} selectedServiceId={selectedServiceId} onSelectedServiceOpened={() => setSelectedServiceId(null)} />}
          {page === "trash" && (
            <Trash key={me.workspace.id} api={api} me={me} onChanged={refresh} />
          )}
          {page.startsWith("customers/") && (
            <CustomerDetail
              key={`${me.workspace.id}/${page}`}
              customerId={page.split("/")[1]}
              customers={customers}
              tasks={tasks}
              taskSummary={taskTotals.byCustomer.find(item=>item.id===page.split("/")[1])}
              taskPagination={taskPagination}
              onTaskFilterChange={setCustomerTaskFilter}
              services={data.services || []}
              transactions={data.transactions || []}
              members={members}
              teams={teams}
              me={me}
              onBack={() => go("customers")}
              onEdit={(c) => setModal({ type: "customer", item: c })}
              onTrash={(c) => requestTrash("customer", c)}
              onTaskOpen={openTaskDetail}
              onTaskCreate={(c) => setModal({ type: "task", customerId: c.id })}
              onTaskComplete={complete}
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
                  Thêm
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
                    {boardCounts.today} việc
                  </b>{" "}
                  cần hoàn thành hôm nay</span> <ArrowRight size={15} />
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={CheckCheck}
                  color="green"
                  title="Đang mở"
                  value={boardCounts.open}
                  foot={`${taskTotals.completed} công việc đã hoàn thành`}
                  onClick={() => go("tasks")}
                />
                <Stat
                  icon={CalendarDays}
                  color="blue"
                  title="Đến hạn hôm nay"
                  value={boardCounts.today}
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
                  value={boardCounts.overdue}
                  foot={
                    boardCounts.overdue
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
                  onClick={() => go(canManage ? "finance" : "teams")}
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel today-panel dashboard-board-span">
                  <div className="panel-head">
                    <div>
                      <h2>
                        Bảng công việc{" "}
                        <span className="count-pill">{dashboardItems.length}</span>
                      </h2>
                      <p>Công việc, lịch hẹn và lịch nhắc trên cùng một bảng.</p>
                    </div>
                    <button className="text-button" onClick={() => go("tasks")}>
                      Mở trang bảng <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="small-tabs">
                    <button
                      className={filter === "all" ? "active" : ""}
                      onClick={() => setFilter("all")}
                    >
                      Đang mở
                    </button>
                    <button
                      className={filter === "today" ? "active" : ""}
                      onClick={() => setFilter("today")}
                    >
                      Hôm nay{" "}
                      <span>
                        {boardCounts.today}
                      </span>
                    </button>
                    <button
                      className={filter === "overdue" ? "active" : ""}
                      onClick={() => setFilter("overdue")}
                    >
                      Quá hạn <span>{boardCounts.overdue}</span>
                    </button>
                  </div>
                  {taskPagination}
                  <TaskBoard
                    selectedTaskId={selectedAiTaskId}
                    scopeKey={`dashboard/${me.workspace.id}/${filter}`}
                    tasks={dashboardItems}
                    members={members}
                    readOnly={Boolean(me.workspace.suspendedAt)}
                    onOpen={openUnifiedItem}
                    onCreate={(status) => setModal({ type: "task", status })}
                    onMove={moveBoardItem}
                    canMove={(item) => item.kind === "task" ? !item.teamArchived : item.kind === "event" && item.canEdit}
                    onTrash={(item) => requestTrash("task", item)}
                    canTrash={(item) => item.kind === "task"}
                  />
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
                        {taskTotals.total
                          ? Math.round((taskTotals.completed / taskTotals.total) * 100)
                          : 0}
                        %
                      </strong>
                      <p>
                        {taskTotals.completed}/{taskTotals.total} công việc hoàn thành
                      </p>
                      <progress
                        value={taskTotals.completed}
                        max={taskTotals.total || 1}
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
                    <button className="text-button" onClick={() => go("teams")}>
                      Chi tiết <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="team-progress">
                    {members.slice(0, 4).map((m, i) => {
                      const counts = taskTotals.byAssignee.find(item => item.id === m.id) || { total: 0, completed: 0 };
                      const done = counts.completed;
                      return (
                        <div className="member-progress" key={m.id}>
                          <Avatar name={m.name} small index={i} />
                          <div>
                            <div>
                              <strong>{m.name}</strong>
                              <span>
                                {done}/{counts.total} việc
                              </span>
                            </div>
                            <progress value={done} max={counts.total || 1} />
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
              <div className="dashboard-reports">
                <OperationsDashboard key={me.workspace.id} api={api} members={members} teams={teams} onOpenTask={openTaskDetail}/>
                <WorkSettings key={me.workspace.id+":work"} api={api} me={me} members={members}/>
                <WorkReports key={me.workspace.id+":reports"} api={api}/>
              </div>
            </>
          )}
          {(page === "tasks" || (page.startsWith("tasks/") && (!taskReturnPage || taskReturnPage === "tasks"))) && (
            <>
              <PageHeading
                title="Công việc"
                subtitle="Công việc, lịch hẹn và lịch nhắc trên cùng một bảng."
                action={
                  <label className="page-heading-filter">
                    <span>Dự án</span>
                    <select aria-label="Lọc dự án" value={projectFilter} onChange={e=>{setProjectFilter(e.target.value);setTaskTeamFilter("all");}}><option value="all">Tất cả dự án</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  </label>
                }
              />
              {taskPagination}
              <WorkflowBoard
                showColumnTabs
                toolbarRight={<SearchBox value={search} setValue={setSearch} placeholder="Tìm công việc, lịch hẹn, nhóm dịch vụ…" />}
                selectedTaskId={selectedAiTaskId}
                api={api}
                teamId={teams.some((team) => team.id === taskTeamFilter) ? taskTeamFilter : null}
                projectId={projectFilter==='all'?null:projectFilter}
                scopeKey={`${me.workspace.id}/${taskTeamFilter}/${projectFilter}`}
                tasks={filteredItems}
                members={members}
                placeByStatus={projectFilter==='all'}
                countNoun="mục"
                readOnly={Boolean(me.workspace.suspendedAt)}
                onOpen={openUnifiedItem}
                onCreate={createFilteredTask}
                onStatusMove={moveBoardItem}
                onTrash={(item) => requestTrash("task", item)}
                canTrash={(item) => item.kind === "task"}
                canMove={(item) => item.kind === "task" ? !item.teamArchived : item.kind === "event" && item.canEdit}
                onChanged={refresh}
              />
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
                      onClick={() => go(`customers/${c.id}`)}
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
                            taskTotals.byCustomer.find(item=>item.id===c.id)?.open || 0
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
                      : me.subscription?.planName || me.subscription?.plan || "Chưa có gói"}
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
                    {billing.plans.length === 0 && <p className="empty">Hiện chưa có gói đang bán. Vui lòng liên hệ hỗ trợ để gia hạn.</p>}
                    {billing.plans.map((p) => (
                      <section
                        className={`pricing-card ${p.id === "team" ? "recommended" : ""}`}
                        key={p.id}
                      >
                        {p.id === "team" && (
                          <div className="recommended-label">
                            DÀNH CHO ĐỘI NGŨ ĐANG PHÁT TRIỂN
                          </div>
                        )}
                        <div className="plan-icon"><Users /></div>
                        <h2>{p.name}</h2>
                        <p>Dành cho đội ngũ tối đa {p.memberLimit.toLocaleString("vi-VN")} thành viên.</p>
                        <div className="plan-price">
                          {money(
                            cycle === "monthly"
                              ? p.monthlyPrice
                              : p.yearlyPrice,
                          )}
                          <span>/{cycle === "monthly" ? "tháng" : "năm"}</span>
                        </div>
                        <Button
                          secondary={p.id !== "team"}
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
      {!page.startsWith("admin/") && <AssistantChat
        key={`${me.user.id}/${me.workspace.id}`}
        api={api}
        me={me}
        hidden={Boolean(modal) || page.startsWith("tasks/") || noticeOpen}
        onOpenTask={openAiTask}
        selectedTaskId={selectedAiTaskId}
        inactive={Boolean(aiTaskId)}
        onDraft={draft => { setTaskTeamId(""); setModal({ type: "task", draft }); }}
        onSettings={() => go("admin/settings")}
      />}
      {(page.startsWith("tasks/") || aiTaskId) && (
        <div
          className="task-detail-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTaskDetail();
          }}
        >
          <div className="task-detail-modal" role="dialog" aria-modal="true" aria-label="Chi tiết công việc" tabIndex={-1}>
            <button type="button" className="task-detail-modal-close icon-button" aria-label="Đóng chi tiết công việc" onClick={closeTaskDetail}>
              <X size={18} />
            </button>
            <TaskDetail
              key={`${me.workspace.id}/${aiTaskId || page}`}
              taskId={aiTaskId || page.split("/")[1]}
              api={api}
              me={me}
              members={members}
              customers={customers}
              revision={teamsRevision}
              onChanged={refresh}
              onEdit={(task) => openTeamTask({ item: task, readOnly: task.teamArchived })}
              onTrash={(task) => requestTrash("task", task)}
              onBack={closeTaskDetail}
            />
          </div>
        </div>
      )}
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
                    setNoticeOpen(false);
                    if (n.serviceId || n.type === "service_renewal") {
                      const serviceId = n.serviceId || n.entityId;
                      setSelectedServiceId(serviceId || null);
                      go(serviceId ? `services?service=${encodeURIComponent(serviceId)}` : "services");
                    } else if (n.entityType === "calendar_event" && n.entityId) {
                      const known = calendarEvents.find((event) => String(event.id) === String(n.entityId));
                      if (known) openUnifiedItem(asBoardEvent(known));
                      else {
                        try {
                          const result = await api(`/calendar-events/${encodeURIComponent(n.entityId)}`);
                          openUnifiedItem(asBoardEvent(result.event));
                        } catch (error) {
                          notify(error.message, true);
                        }
                      }
                    } else {
                      const t = tasks.find((t) => t.id === n.taskId);
                      if (t) openTaskDetail(t);
                      else if (n.taskId) { try { const result = await api(`/tasks/${encodeURIComponent(n.taskId)}`); openTaskDetail(result.task); } catch(error) { notify(error.message, true); } }
                    }
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
            className={`modal ${modal.type === "customer" && modal.item ? "customer-detail-modal" : ""}`}
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
                      ? "Chi tiết"
                      : "Thêm vào bảng"
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
            <div className={modal.type === "customer" && modal.item ? "customer-detail-layout" : undefined}>
            <form className="modal-form-grid" onSubmit={submitModal}>
              {modal.type === "task" && (
                <fieldset
                  className="task-editor-fields"
                  disabled={modal.readOnly}
                >
                  {modal.readOnly && (
                    <p className="hint">
                      {modal.appointment
                        ? "Mục này chỉ được xem."
                        : "Team đã lưu trữ. Bạn có thể xem lịch sử công việc; khôi phục team để tiếp tục cập nhật."}
                    </p>
                  )}
                  <div className="task-editor-summary">
                    <Field label="Tên *">
                      <input
                        autoFocus
                        required
                        name="title"
                        maxLength={200}
                        defaultValue={modal.item?.title || modal.draft?.title}
                        placeholder="Ví dụ: Nhắc khách gia hạn dịch vụ"
                      />
                    </Field>
                    <Field label="Mô tả">
                      <textarea
                        name="description"
                        rows={3}
                        defaultValue={modal.item?.description || modal.draft?.description}
                        placeholder="Thông tin cần nhớ, yêu cầu hoặc ghi chú…"
                      />
                    </Field>
                  </div>
                  <div className="form-grid">
                    {!modal.item && (
                      <Field label="Loại">
                        <select
                          value={modal.appointment ? "event" : "task"}
                          onChange={(e) => setModal((current) => ({ ...current, appointment: e.target.value === "event", teamId: taskTeamId }))}
                        >
                          <option value="task">Công việc</option>
                          <option value="event">Lịch hẹn</option>
                        </select>
                      </Field>
                    )}
                    <Field label="Team phụ trách">
                      <select
                        name="teamId"
                        value={taskTeamId}
                        onChange={(e) => setTaskTeamId(e.target.value)}
                        disabled={Boolean((!modal.appointment && taskProjectId) || (modal.item && !canManage))}
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
                    {!modal.appointment && <Field label="Dự án"><select aria-label="Dự án công việc" value={taskProjectId} onChange={e=>{setTaskProjectId(e.target.value);const p=projects.find(p=>p.id===e.target.value);if(p)setTaskTeamId(p.teamId||'');}}><option value="">Dự án mặc định của team</option>{projects.map(p=><option disabled={!p.canEdit&&p.id!==modal.item?.projectId} key={p.id} value={p.id}>{p.name}{p.readonly?' (chỉ đọc)':''}</option>)}</select></Field>}
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
                    {!modal.appointment && (
                      <Field label="Mức ưu tiên">
                        <select
                          name="priority"
                          defaultValue={modal.item?.priority || modal.draft?.priority || "medium"}
                        >
                          {Object.entries(priorities).map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Field label={modal.appointment ? "Bắt đầu *" : "Hạn hoàn thành (không bắt buộc)"}>
                      <input
                        required={modal.appointment}
                        type="datetime-local"
                        name="dueAt"
                        defaultValue={
                          modal.item?.dueAt
                            ? localInput(modal.item.dueAt)
                            : modal.draft?.dueAt ? localInput(modal.draft.dueAt) : modal.appointment ? `${modal.date || today}T17:00` : ""
                        }
                      />
                    </Field>
                    {modal.appointment && (
                      <Field label="Kết thúc *">
                        <input
                          required
                          type="datetime-local"
                          name="endsAt"
                          defaultValue={modal.item?.endsAt ? localInput(modal.item.endsAt) : ""}
                        />
                      </Field>
                    )}
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
                    {!modal.appointment && <>
                    <Field label="Người phụ trách">
                      <select
                        key={`${taskTeamId}/${taskProjectId}/${defaultTaskAssignee}`}
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
                        defaultValue={modal.item?.customerId || modal.customerId || ""}
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
                    <RecurrenceFields task={modal.item} />
                    </>}
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
                  <Button
                    className="button secondary modal-trash-button"
                    icon={Trash2}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (modal.item?.kind === "event") {
                        if (!window.confirm(`Xóa “${modal.item.title}”?`)) return;
                        const result = await action(
                          () => api(`/calendar-events/${encodeURIComponent(modal.item.id)}`, { method: "DELETE" }),
                          "Đã xóa lịch hẹn",
                        );
                        if (result) {
                          setModal(null);
                          await loadCalendarEvents();
                        }
                        return;
                      }
                      requestTrash(modal.type, modal.item);
                    }}
                  >
                    {modal.item?.kind === "event" ? "Xóa lịch hẹn" : "Xóa"}
                  </Button>
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
              {modal.type === "customer" && modal.item && (
                <aside className="customer-related-tasks" aria-label="Công việc liên quan đến khách hàng">
                  <div className="customer-tasks-heading">
                    <h3>Công việc liên quan</h3>
                    <span className="count-pill">{data.taskPage?.total || 0}</span>
                  </div>
                  <p className="customer-tasks-hint">Các công việc bạn có quyền xem, bao gồm việc đã hoàn thành.</p>
                  {taskPagination}
                  {customerTasks.length ? (
                    <ul className="customer-tasks-list">
                      {customerTasks.map((task) => (
                        <li key={task.id}>
                          <a className="customer-task-link" href={`/tasks/${encodeURIComponent(task.id)}`} target="_blank" rel="noopener noreferrer">
                            <span className={`status ${task.status}`}>{statuses[task.status] || task.status}</span>
                            <strong>{task.title}</strong>
                            <span className="customer-task-meta"><CalendarDays size={14} />{task.dueAt ? dateLabel(task.dueAt) : "Chưa có hạn hoàn thành"}</span>
                            <span className="customer-task-meta"><Users size={14} />{person(task.assigneeId)?.name || "Chưa phân công"}</span>
                            <span className="customer-task-open">Mở công việc <ExternalLink size={13} /><span className="sr-only"> trong tab mới</span></span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="customer-tasks-empty">Chưa có công việc liên quan đến khách hàng này.</p>}
                </aside>
              )}
            </div>
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
function authModeForPath(pathname, token) {
  if (token && pathname === "/") return "invite";
  if (pathname === "/register") return "register";
  if (pathname === "/forgot-password") return "forgot";
  if (pathname === "/reset-password") return "reset";
  return "login";
}

function Auth({ onLogin, onReset }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = new URLSearchParams(location.search).get("invite");
  const pushId = new URLSearchParams(location.search).get("notification");
  const afterLoginPath = pushId && /^[a-zA-Z0-9_-]{1,200}$/.test(pushId)
    ? `/dashboard?notification=${encodeURIComponent(pushId)}` : '/dashboard';
  const routeMode = authModeForPath(pathname, token);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [mode, setMode] = useState(routeMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      const saved = localStorage.getItem("nhactoi_remember_me");
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [loginEmail, setLoginEmail] = useState(() => {
    try {
      const savedRemember = localStorage.getItem("nhactoi_remember_me");
      if (savedRemember !== "false") {
        return localStorage.getItem("nhactoi_remember_email") || "";
      }
      return "";
    } catch {
      return "";
    }
  });
  const [cooldown, setCooldown] = useState(0);
  const [devAccounts, setDevAccounts] = useState([]);
  const [devMenuOpen, setDevMenuOpen] = useState(false);

  useEffect(() => {
    api("/auth/google/config")
      .then((data) => setGoogleEnabled(data.enabled))
      .catch(() => {});
    api("/auth/dev-accounts")
      .then((data) => {
        if (data.enabled && Array.isArray(data.accounts)) {
          setDevAccounts(data.accounts);
        }
      })
      .catch(() => {});
  }, []);

  async function handleDevLogin(email) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await api("/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      try {
        localStorage.setItem("nhactoi_remember_me", "true");
        localStorage.setItem("nhactoi_remember_email", email);
      } catch {}
      router.replace(afterLoginPath);
      await onLogin();
    } catch (err) {
      setError(err.message || "Đăng nhập nhanh thất bại.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setMode(routeMode);
    setError("");
  }, [routeMode]);
  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function navigateMode(nextMode) {
    if (busy) return;
    setMode(nextMode);
    setError("");
    setNotice("");
    if (token && (nextMode === "login" || nextMode === "invite")) return;
    router.push({ login: "/login", register: "/register", forgot: "/forgot-password", reset: "/reset-password", invite: "/" }[nextMode]);
  }

  function validateEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    if (!email) return "Email không được để trống.";
    if (email.length > 320) return "Email vượt quá độ dài cho phép.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "Địa chỉ email không hợp lệ.";
    return "";
  }

  async function resendCode() {
    const email = resetEmail.trim().toLowerCase();
    const emailError = validateEmail(email);
    if (emailError) return setError(emailError);
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetEmail(email);
      setCooldown(Number(result.retryAfterSeconds) || 60);
      setNotice(result.message || "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận.");
    } catch (reason) {
      setError(reason.message);
      if (reason.status === 429) setCooldown(Number(reason.retryAfterSeconds) || 60);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      if (mode === "forgot") {
        const email = String(body.email || "").trim().toLowerCase();
        const emailError = validateEmail(email);
        if (emailError) throw new Error(emailError);
        const result = await api("/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setResetEmail(email);
        setCooldown(Number(result.retryAfterSeconds) || 60);
        setNotice(result.message || "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận.");
        router.replace("/reset-password");
        return;
      }
      if (mode === "reset") {
        const email = String(body.email || "").trim().toLowerCase();
        const emailError = validateEmail(email);
        if (emailError) throw new Error(emailError);
        if (!/^\d{6}$/.test(String(body.code || "").trim()))
          throw new Error("Mã xác nhận phải gồm 6 chữ số.");
        if (String(body.password || "") !== String(body.confirmPassword || ""))
          throw new Error("Mật khẩu nhập lại không khớp.");
        await api("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            email,
            code: String(body.code || "").trim(),
            password: body.password,
          }),
        });
        onReset();
        setLoginEmail(email);
        setResetEmail(email);
        setNotice("Đặt lại mật khẩu thành công. Đăng nhập bằng mật khẩu mới.");
        router.replace("/login");
        return;
      }
      if (mode === "register" && body.password !== body.confirmPassword)
        throw new Error("Mật khẩu nhập lại không khớp.");
      const remember = mode === "login" ? rememberMe : true;
      await api(mode === "invite" ? "/invitations/accept" : `/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ ...body, remember, ...(token ? { token } : {}) }),
      });
      if (mode === "login") {
        try {
          if (rememberMe) {
            localStorage.setItem("nhactoi_remember_me", "true");
            localStorage.setItem("nhactoi_remember_email", String(body.email || loginEmail).trim());
          } else {
            localStorage.setItem("nhactoi_remember_me", "false");
            localStorage.removeItem("nhactoi_remember_email");
          }
        } catch {}
      }
      if (!token || mode === "invite") router.replace(afterLoginPath);
      await onLogin();
    } catch (reason) {
      setError(reason.message || "Không thể thực hiện. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "login"
      ? "Chào mừng bạn trở lại"
      : mode === "register"
        ? "Khởi đầu một ngày ngăn nắp"
        : mode === "invite"
          ? "Gia nhập đội ngũ"
          : mode === "forgot"
            ? "Khôi phục mật khẩu"
            : "Đặt mật khẩu mới";
  const description =
    mode === "login"
      ? "Đăng nhập để tiếp tục những việc đang làm."
      : mode === "register"
        ? "Tạo không gian riêng và dùng thử trong 14 ngày."
        : mode === "invite"
          ? "Tạo tài khoản để nhận lời mời vào không gian."
          : mode === "forgot"
            ? "Nhập email để nhận mã xác nhận đặt lại mật khẩu."
            : "Nhập mã trong email và chọn một mật khẩu mới.";

  return (
    <div className="auth-page">
      <ThemeToggle className="auth-theme-toggle" />
      <section className="auth-story">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            if (busy) return;
            router.push("/");
          }}
        >
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
          <h2>{title}</h2>
          <p>{description}</p>
          {notice && (
            <div className="form-success" role="status">
              <CheckCircle2 size={16} /> {notice}
            </div>
          )}
          <form key={mode} onSubmit={submit}>
            {mode === "forgot" && (
              <Field label="Email">
                <input disabled={busy}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="ban@congty.vn"
                  maxLength={320}
                />
              </Field>
            )}
            {mode === "reset" && (
              <>
                <Field label="Email">
                  <input disabled={busy}
                    name="email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(event) => {
                      setResetEmail(event.target.value);
                      setError("");
                    }}
                    autoComplete="email"
                    placeholder="ban@congty.vn"
                    maxLength={320}
                  />
                </Field>
                <Field label="Mã xác nhận">
                  <input disabled={busy}
                    name="code"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                  />
                </Field>
                <Field label="Mật khẩu mới">
                  <input disabled={busy}
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={256}
                    autoComplete="new-password"
                    placeholder="Từ 8 đến 256 ký tự"
                  />
                </Field>
                <Field label="Nhập lại mật khẩu mới">
                  <input disabled={busy}
                    name="confirmPassword"
                    type="password"
                    required
                    minLength={8}
                    maxLength={256}
                    autoComplete="new-password"
                    placeholder="Nhập lại mật khẩu mới"
                  />
                </Field>
              </>
            )}
            {mode !== "login" && mode !== "forgot" && mode !== "reset" && (
              <Field label="Họ và tên">
                <input disabled={busy}
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Tên của bạn"
                  maxLength={120}
                />
              </Field>
            )}
            {(mode === "login" || mode === "register") && (
              <Field label="Email">
                <input disabled={busy}
                  name="email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(event) => {
                    setLoginEmail(event.target.value);
                    setNotice("");
                    setError("");
                  }}
                  autoComplete="email"
                  placeholder="ban@congty.vn"
                  maxLength={320}
                />
              </Field>
            )}
            {mode !== "forgot" && mode !== "reset" && (
              <Field label="Mật khẩu">
                <input disabled={busy}
                  name="password"
                  type="password"
                  required
                  minLength={mode === "login" ? 1 : 8}
                  maxLength={256}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "login" ? "Nhập mật khẩu" : "Từ 8 đến 256 ký tự"
                  }
                />
              </Field>
            )}
            {mode === "login" && (
              <div className="auth-row-options">
                <label className="auth-remember">
                  <input
                    disabled={busy}
                    type="checkbox"
                    name="remember"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span>Ghi nhớ đăng nhập</span>
                </label>
                <button
                  type="button"
                  className="auth-forgot-link"
                  disabled={busy}
                  onClick={() => navigateMode("forgot")}
                >
                  Quên mật khẩu?
                </button>
              </div>
            )}
            {mode === "register" && (
              <>
                <Field label="Nhập lại mật khẩu">
                  <input disabled={busy} name="confirmPassword" type="password" required
                    minLength={8} maxLength={256} autoComplete="new-password" />
                </Field>
                <Field label="Tên không gian / doanh nghiệp">
                  <input disabled={busy}
                    name="workspaceName"
                    required
                    placeholder="Ví dụ: An Nhiên Studio"
                    maxLength={160}
                  />
                </Field>
                <Field label="Lĩnh vực dịch vụ">
                  <select name="industry" disabled={busy}>
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
              icon={busy ? LoaderCircle : mode === "forgot" ? Mail : ArrowRight}
              disabled={busy}
            >
              {busy
                ? "Đang xử lý…"
                : mode === "login"
                  ? "Vào không gian làm việc"
                  : mode === "register"
                    ? "Tạo không gian miễn phí"
                    : mode === "invite"
                      ? "Tham gia không gian"
                      : mode === "forgot"
                        ? "Gửi mã xác nhận"
                        : "Đặt lại mật khẩu"}
            </Button>
          </form>
          {mode === "reset" && (
            <p className="auth-switch">
              <button type="button" onClick={resendCode} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? `Gửi lại mã sau ${cooldown}s` : "Gửi lại mã"}
              </button>
            </p>
          )}

          {(mode === "forgot" || mode === "reset") && (
            <p className="auth-switch">
              <button type="button" disabled={busy} onClick={() => navigateMode("login")}>
                Quay lại đăng nhập
              </button>
            </p>
          )}
          {(mode === "login" || mode === "register" || mode === "invite") && (
            <p className="auth-switch">
              {mode === "login"
                ? token
                  ? "Chưa có tài khoản?"
                  : "Chưa có không gian riêng?"
                : "Đã có tài khoản?"}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  navigateMode(mode === "login" ? (token ? "invite" : "register") : "login")
                }
              >
                {mode === "login"
                  ? token
                    ? "Tạo tài khoản từ lời mời"
                    : "Đăng ký"
                  : "Đăng nhập"}
              </button>
            </p>
          )}
          {googleEnabled && !busy && ["login", "register", "invite"].includes(mode) && (
            <a className="button secondary" href="/api/auth/google/start">
              Tiếp tục với Google
            </a>
          )}
          {devAccounts.length > 0 && mode === "login" && (
            <div className="dev-quick-login-wrap">
              <div className="dev-quick-login-divider">
                <span>Môi trường Dev</span>
              </div>
              <button
                type="button"
                className={`dev-quick-login-btn ${devMenuOpen ? "active" : ""}`}
                disabled={busy}
                onClick={() => setDevMenuOpen((prev) => !prev)}
                aria-expanded={devMenuOpen}
              >
                <Zap size={15} className="dev-zap-icon" />
                <span>Đăng nhập nhanh (Dev)</span>
                <ChevronDown size={14} className={`dev-chevron ${devMenuOpen ? "open" : ""}`} />
              </button>
              {devMenuOpen && (
                <div className="dev-accounts-panel">
                  <div className="dev-accounts-hint">
                    Chọn tài khoản tạo sẵn để vào nhanh:
                  </div>
                  <div className="dev-accounts-list">
                    {devAccounts.map((acc) => (
                      <button
                        key={acc.email}
                        type="button"
                        className="dev-account-card"
                        disabled={busy}
                        onClick={() => handleDevLogin(acc.email)}
                        title={`Đăng nhập với ${acc.name} (${acc.role})`}
                      >
                        <span className={`dev-account-avatar ${acc.roleKey || ""}`}>
                          {acc.name.charAt(0)}
                        </span>
                        <div className="dev-account-details">
                          <div className="dev-account-name-row">
                            <strong className="dev-account-name">{acc.name}</strong>
                            <span className={`dev-badge dev-badge-${acc.roleKey || "member"}`}>
                              {acc.badge || acc.role}
                            </span>
                          </div>
                          <span className="dev-account-email">{acc.email}</span>
                        </div>
                        <ArrowRight size={14} className="dev-account-arrow" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="auth-security">
            <ShieldCheck size={15} /> Dữ liệu riêng cho từng không gian làm việc
          </div>
        </div>
      </section>
    </div>
  );
}

function AcceptInvitation({ token, me, onAccepted, onLogout }) {
  const router = useRouter();
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
      router.replace(location.pathname);
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
            router.replace(location.pathname);
            onAccepted();
          }}
        >
          Về không gian hiện tại
        </button>
      </section>
    </div>
  );
}
