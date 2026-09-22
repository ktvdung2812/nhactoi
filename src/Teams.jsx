import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import "./teams.css";
import ActionMenu from "./ActionMenu.jsx";
import WorkflowBoard from "./WorkflowBoard.jsx";

const TEAM_COLORS = ["green", "blue", "purple", "orange", "rose", "slate"];

const COLOR_META = {
  green: { label: "Lá non", className: "green" },
  blue: { label: "Biển xanh", className: "blue" },
  purple: { label: "Tím mơ", className: "purple" },
  orange: { label: "Cam ấm", className: "orange" },
  rose: { label: "Hồng đào", className: "rose" },
  slate: { label: "Xám đá", className: "slate" },
};

const STATUS_META = {
  todo: { label: "Cần làm", color: "blue", icon: CircleDot },
  doing: { label: "Đang làm", color: "orange", icon: Clock3 },
  done: { label: "Hoàn thành", color: "green", icon: Check },
};

const EMPTY_TEAM_FORM = { name: "", description: "", color: "green" };

function text(value) {
  return value == null ? "" : String(value);
}

function idKey(value) {
  return value == null ? "" : String(value);
}

function memberName(member) {
  return member?.name || member?.email || "Thành viên";
}

function memberInitials(member) {
  const value = memberName(member)
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map(part => part[0])
    .join("");
  return (value || "?").toUpperCase();
}

function memberTone(value) {
  const source = text(value);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 5;
}

function formatDueDate(value) {
  if (!value) return "Chưa đặt hạn";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa đặt hạn";
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function isOverdue(task) {
  if (!task?.dueAt || task.status === "done") return false;
  const date = new Date(task.dueAt);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function normalizeRole(value) {
  return value === "lead" ? "lead" : "member";
}

function sameId(left, right) {
  return idKey(left) !== "" && idKey(left) === idKey(right);
}

function TeamAvatar({ member, size = "small", label }) {
  const accessibleLabel = label || memberName(member);
  return (
    <span
      className={`teams-avatar teams-avatar-${size} teams-avatar-tone-${memberTone(member?.id)}`}
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      {memberInitials(member)}
    </span>
  );
}

function TeamColorMark({ color = "green", size = "medium" }) {
  return (
    <span
      className={`teams-color-mark teams-color-${COLOR_META[color]?.className || "green"} teams-color-mark-${size}`}
      aria-hidden="true"
    >
      <span />
    </span>
  );
}

function RoleBadge({ role, muted = false }) {
  if (!role) return null;
  return (
    <span className={`teams-role-badge ${role} ${muted ? "muted" : ""}`}>
      {role === "lead" ? "Team lead" : "Thành viên"}
    </span>
  );
}

function ModalShell({ title, description, children, footer, onClose, dialogRef }) {
  return (
    <div
      className="teams-modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="teams-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teams-dialog-title"
        tabIndex={-1}
      >
        <header className="teams-modal-head">
          <div>
            <span className="teams-eyebrow">QUẢN LÝ TEAM</span>
            <h2 id="teams-dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="teams-icon-button"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </header>
        <div className="teams-modal-body">{children}</div>
        {footer && <footer className="teams-modal-foot">{footer}</footer>}
      </section>
    </div>
  );
}

function EmptyState({ icon: Icon = UsersRound, title, description, action }) {
  return (
    <div className="teams-empty">
      <span className="teams-empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function TeamForm({
  mode,
  form,
  setForm,
  creatorId,
  workspaceMembers,
  roster,
  setRoster,
  error,
  pending,
  onSubmit,
  onClose,
}) {
  const isCreate = mode === "create";
  const creatorIsSelected = roster.some(row => sameId(row.userId, creatorId));
  const selectedIds = new Set(roster.map(row => idKey(row.userId)));

  const toggleCreatorRoster = userId => {
    if (sameId(userId, creatorId)) return;
    setRoster(current =>
      current.some(row => sameId(row.userId, userId))
        ? current.filter(row => !sameId(row.userId, userId))
        : [...current, { userId, role: "member" }],
    );
  };

  return (
    <form className="teams-form" onSubmit={onSubmit}>
      <label className="teams-field">
        <span>Tên team <b>*</b></span>
        <input
          data-team-autofocus
          required
          autoComplete="off"
          maxLength={100}
          value={form.name}
          onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
          placeholder="Ví dụ: Team Kinh doanh"
        />
        <small>{form.name.length}/100 ký tự</small>
      </label>
      <label className="teams-field">
        <span>Mô tả</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={form.description}
          onChange={event => setForm(current => ({ ...current, description: event.target.value }))}
          placeholder="Team cùng phụ trách điều gì?"
        />
        <small>{form.description.length}/1000 ký tự</small>
      </label>
      <div className="teams-field">
        <span>Màu nhận diện</span>
        <div className="teams-color-picker" role="radiogroup" aria-label="Màu team">
          {TEAM_COLORS.map(color => (
            <button
              type="button"
              key={color}
              className={`teams-color-option teams-color-${color} ${form.color === color ? "selected" : ""}`}
              onClick={() => setForm(current => ({ ...current, color }))}
              aria-label={COLOR_META[color].label}
              aria-pressed={form.color === color}
            >
              <span />
              {form.color === color && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>

      {isCreate && (
        <div className="teams-field teams-form-roster-field">
          <div className="teams-field-heading">
            <span>Thành viên ban đầu</span>
            <small>{roster.length} người</small>
          </div>
          <p className="teams-form-note">
            Một người có thể tham gia nhiều team. Thành viên đã có trong doanh nghiệp không phát sinh thêm chỗ ngồi.
          </p>
          <div className="teams-picker-list">
            {workspaceMembers.map(member => {
              const selected = selectedIds.has(idKey(member.id));
              const isCreator = sameId(member.id, creatorId);
              return (
                <button
                  type="button"
                  key={member.id}
                  className={`teams-picker-row ${selected ? "selected" : ""}`}
                  onClick={() => toggleCreatorRoster(member.id)}
                  disabled={isCreator}
                  aria-pressed={selected}
                >
                  <TeamAvatar member={member} />
                  <span className="teams-picker-main">
                    <strong>{memberName(member)}</strong>
                    <small>{member.email || "Thành viên doanh nghiệp"}</small>
                  </span>
                  {isCreator ? (
                    <RoleBadge role="lead" />
                  ) : selected ? (
                    <Check className="teams-picker-check" size={16} />
                  ) : (
                    <UserPlus className="teams-picker-add" size={16} />
                  )}
                </button>
              );
            })}
            {workspaceMembers.length === 0 && (
              <p className="teams-inline-muted">Chưa có thành viên doanh nghiệp để thêm.</p>
            )}
          </div>
          {!creatorIsSelected && (
            <p className="teams-form-warning">Người tạo team cần được giữ lại với vai trò Team lead.</p>
          )}
        </div>
      )}

      {error && (
        <div className="teams-form-error" role="alert">
          <span><X size={15} /></span>
          {error}
        </div>
      )}
      <div className="teams-modal-actions">
        <button type="button" className="teams-button secondary" onClick={onClose} disabled={pending}>
          Huỷ
        </button>
        <button type="submit" className="teams-button primary" disabled={pending || (isCreate && !creatorIsSelected)}>
          {pending ? <LoaderCircle className="teams-spin" size={16} /> : <Check size={16} />}
          {isCreate ? "Tạo team" : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}

function RosterEditor({
  members,
  roster,
  setRoster,
  currentUserId,
  canChangeLeads,
  error,
  pending,
  onSubmit,
  onClose,
}) {
  const selectedById = new Map(roster.map(row => [idKey(row.userId), row]));
  const leadCount = roster.filter(row => normalizeRole(row.role) === "lead").length;

  function toggleMember(member) {
    const key = idKey(member.id);
    const current = selectedById.get(key);
    if (current) {
      if (!canChangeLeads && (current.role === "lead" || sameId(member.id, currentUserId))) return;
      setRoster(rows => rows.filter(row => !sameId(row.userId, member.id)));
      return;
    }
    setRoster(rows => [...rows, { userId: member.id, role: "member" }]);
  }

  function changeRole(memberId, role) {
    if (!canChangeLeads) return;
    setRoster(rows => rows.map(row => (sameId(row.userId, memberId) ? { ...row, role } : row)));
  }

  return (
    <form className="teams-form teams-roster-form" onSubmit={onSubmit}>
      <div className="teams-roster-summary">
        <span><Users size={16} /> {roster.length} người trong team</span>
        <span className={leadCount ? "" : "danger"}>{leadCount} Team lead</span>
      </div>
      <p className="teams-form-note">
        Team lead quản lý công việc và danh sách thành viên. Thành viên có thể tham gia các team khác trong cùng doanh nghiệp.
      </p>
      <div className="teams-roster-list">
        {members.map(member => {
          const row = selectedById.get(idKey(member.id));
          const selected = Boolean(row);
          const isSelfLead = sameId(member.id, currentUserId) && row?.role === "lead";
          const roleLocked = !canChangeLeads && (row?.role === "lead" || isSelfLead);
          return (
            <div className={`teams-roster-row ${selected ? "selected" : ""}`} key={member.id}>
              <button
                type="button"
                className="teams-roster-person"
                onClick={() => toggleMember(member)}
                disabled={roleLocked}
                aria-pressed={selected}
                title={selected ? "Gỡ khỏi team" : "Thêm vào team"}
              >
                <TeamAvatar member={member} />
                <span>
                  <strong>{memberName(member)}</strong>
                  <small>{member.email || "Thành viên doanh nghiệp"}</small>
                </span>
              </button>
              <div className="teams-roster-controls">
                {selected ? (
                  <>
                    <select
                      aria-label={`Vai trò của ${memberName(member)}`}
                      value={normalizeRole(row.role)}
                      disabled={!canChangeLeads || isSelfLead}
                      onChange={event => changeRole(member.id, event.target.value)}
                    >
                      <option value="member">Thành viên</option>
                      <option value="lead">Team lead</option>
                    </select>
                    <button
                      type="button"
                      className="teams-roster-remove"
                      onClick={() => toggleMember(member)}
                      disabled={roleLocked}
                      aria-label={`Gỡ ${memberName(member)} khỏi team`}
                      title={roleLocked ? "Không thể gỡ Team lead của bạn" : "Gỡ khỏi team"}
                    >
                      <UserMinus size={15} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="teams-add-member" onClick={() => toggleMember(member)}>
                    <UserPlus size={15} /> Thêm
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!canChangeLeads && (
        <div className="teams-permission-note">
          <ShieldCheck size={15} /> Bạn có thể thêm hoặc gỡ thành viên thường. Chỉ quản trị doanh nghiệp mới thay đổi Team lead.
        </div>
      )}
      {error && (
        <div className="teams-form-error" role="alert">
          <span><X size={15} /></span>
          {error}
        </div>
      )}
      <div className="teams-modal-actions">
        <button type="button" className="teams-button secondary" onClick={onClose} disabled={pending}>Huỷ</button>
        <button type="submit" className="teams-button primary" disabled={pending || leadCount < 1}>
          {pending ? <LoaderCircle className="teams-spin" size={16} /> : <Check size={16} />}
          Lưu thành viên
        </button>
      </div>
    </form>
  );
}

function ArchiveDialog({ team, pending, error, onConfirm, onClose }) {
  const archived = Boolean(team?.archivedAt);
  return (
    <div className="teams-confirm-body">
      <div className={`teams-confirm-icon ${archived ? "restore" : "archive"}`}>
        {archived ? <ArchiveRestore size={24} /> : <Archive size={24} />}
      </div>
      <h3>{archived ? "Khôi phục team?" : "Lưu trữ team?"}</h3>
      <p>
        {archived
          ? `“${team?.name || "Team này"}” sẽ hoạt động trở lại để mọi người tiếp tục cập nhật công việc.`
          : `“${team?.name || "Team này"}” sẽ giữ nguyên lịch sử nhưng dừng cập nhật và lời nhắc mới. Bạn có thể khôi phục team sau.`}
      </p>
      {error && <div className="teams-form-error" role="alert"><span><X size={15} /></span>{error}</div>}
      <div className="teams-modal-actions">
        <button type="button" className="teams-button secondary" onClick={onClose} disabled={pending}>Huỷ</button>
        <button type="button" className={`teams-button ${archived ? "primary" : "danger"}`} onClick={onConfirm} disabled={pending}>
          {pending ? <LoaderCircle className="teams-spin" size={16} /> : archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          {archived ? "Khôi phục team" : "Lưu trữ team"}
        </button>
      </div>
    </div>
  );
}

export default function Teams({
  api,
  go,
  me,
  members = [],
  teamId = null,
  revision = 0,
  onChanged,
  onTaskCreate,
  onTaskOpen,
  onTaskMove,
  onTaskTrash,
}) {
  const [teams, setTeams] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [detailTab, setDetailTab] = useState("board");
  const [taskView, setTaskView] = useState("board");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_TEAM_FORM);
  const [roster, setRoster] = useState([]);
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const dialogRef = useRef(null);
  const focusReturnRef = useRef(null);
  const pendingRef = useRef(false);
  pendingRef.current = pending;

  const workspaceRole = me?.user?.role;
  const canManageWorkspace = workspaceRole === "owner" || workspaceRole === "admin";
  const currentUserId = me?.user?.id;

  const workspaceMemberDirectory = useMemo(() => {
    const byId = new Map();
    [...members, ...(detail?.members || [])].forEach(member => {
      const key = idKey(member.id);
      if (key && !byId.has(key)) byId.set(key, member);
    });
    if (currentUserId && !byId.has(idKey(currentUserId)) && me?.user) {
      byId.set(idKey(currentUserId), {
        id: currentUserId,
        name: me.user.name,
        email: me.user.email,
        role: workspaceRole,
      });
    }
    return [...byId.values()].sort((left, right) => memberName(left).localeCompare(memberName(right), "vi"));
  }, [members, detail?.members, currentUserId, me?.user, workspaceRole]);

  const loadData = async () => {
    setLoading(true);
    setError("");
    setDetail(null);
    try {
      if (teamId) {
        const result = await api(`/teams/${encodeURIComponent(teamId)}`);
        setDetail(result);
      } else {
        const result = await api("/teams");
        setTeams(Array.isArray(result?.teams) ? result.teams : []);
      }
    } catch (loadError) {
      setError(loadError?.message || "Không thể tải dữ liệu team.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDetail(null);
    const path = teamId ? `/teams/${encodeURIComponent(teamId)}` : "/teams";
    api(path)
      .then(result => {
        if (cancelled) return;
        if (teamId) setDetail(result);
        else setTeams(Array.isArray(result?.teams) ? result.teams : []);
      })
      .catch(loadError => {
        if (!cancelled) setError(loadError?.message || "Không thể tải dữ liệu team.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, teamId, revision, retryCount]);

  useEffect(() => {
    if (!modal) return undefined;
    const origin = focusReturnRef.current;
    const focusFirst = () => {
      const target = dialogRef.current?.querySelector("[data-team-autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
      target?.focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);
    const handleKeyDown = event => {
      if (event.key === "Escape") {
        if (pendingRef.current) return;
        event.preventDefault();
        setModal(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (origin && typeof origin.focus === "function") origin.focus();
    };
  }, [modal?.kind]);

  function openDialog(kind, payload = {}, event) {
    focusReturnRef.current = event?.currentTarget || document.activeElement;
    setFormError("");
    setPending(false);
    if (kind === "create") {
      const creatorRow = currentUserId ? [{ userId: currentUserId, role: "lead" }] : [];
      setForm({ ...EMPTY_TEAM_FORM });
      setRoster(creatorRow);
    }
    if (kind === "edit") {
      const team = detail?.team;
      setForm({
        name: text(team?.name),
        description: text(team?.description),
        color: COLOR_META[team?.color] ? team.color : "green",
      });
    }
    if (kind === "members") {
      setRoster((detail?.members || []).map(member => ({ userId: member.id, role: normalizeRole(member.role) })));
    }
    setModal({ kind, ...payload });
  }

  function closeDialog() {
    if (pending) return;
    setModal(null);
    setFormError("");
  }

  async function finishMutation(successMessage) {
    if (typeof onChanged === "function") {
      try {
        await onChanged();
      } catch {
        // The local reload below still gives this surface a consistent state.
      }
    }
    setModal(null);
    setFormError("");
    setRetryCount(value => value + 1);
    if (successMessage) setError("");
  }

  async function submitTeam(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("Hãy nhập tên team.");
      return;
    }
    if (modal?.kind === "create" && !roster.some(row => normalizeRole(row.role) === "lead")) {
      setFormError("Team cần ít nhất một Team lead.");
      return;
    }
    setPending(true);
    setFormError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        color: form.color,
      };
      if (modal.kind === "create") {
        payload.members = roster.map(row => ({ userId: row.userId, role: normalizeRole(row.role) }));
      }
      const result = await api(modal.kind === "create" ? "/teams" : `/teams/${encodeURIComponent(detail?.team?.id || teamId)}`, {
        method: modal.kind === "create" ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      const createdId = result?.team?.id || result?.id;
      await finishMutation();
      if (modal.kind === "create" && createdId) go(`teams/${encodeURIComponent(createdId)}`);
    } catch (mutationError) {
      setFormError(mutationError?.message || "Không thể lưu team.");
    } finally {
      setPending(false);
    }
  }

  async function submitRoster(event) {
    event.preventDefault();
    if (!detail?.team?.id) return;
    if (!roster.some(row => normalizeRole(row.role) === "lead")) {
      setFormError("Team cần ít nhất một Team lead.");
      return;
    }
    if (!canManageWorkspace) {
      const currentLeads = (detail.members || []).filter(member => member.role === "lead").map(member => idKey(member.id)).sort();
      const nextLeads = roster.filter(row => row.role === "lead").map(row => idKey(row.userId)).sort();
      if (currentLeads.join(",") !== nextLeads.join(",")) {
        setFormError("Chỉ quản trị doanh nghiệp mới có thể thay đổi Team lead.");
        return;
      }
      const self = roster.find(row => sameId(row.userId, currentUserId));
      if (!self || self.role !== "lead") {
        setFormError("Bạn không thể tự rời hoặc hạ vai trò Team lead của mình.");
        return;
      }
    }
    setPending(true);
    setFormError("");
    try {
      await api(`/teams/${encodeURIComponent(detail.team.id)}/members`, {
        method: "PUT",
        body: JSON.stringify({ members: roster.map(row => ({ userId: row.userId, role: normalizeRole(row.role) })) }),
      });
      await finishMutation();
    } catch (mutationError) {
      setFormError(mutationError?.message || "Không thể cập nhật thành viên team.");
    } finally {
      setPending(false);
    }
  }

  async function updateArchive(archived) {
    if (!detail?.team?.id) return;
    setPending(true);
    setFormError("");
    try {
      await api(`/teams/${encodeURIComponent(detail.team.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived }),
      });
      await finishMutation();
    } catch (mutationError) {
      setFormError(mutationError?.message || "Không thể cập nhật trạng thái team.");
    } finally {
      setPending(false);
    }
  }

  const filteredTeams = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return teams
      .filter(team => filter === "all" || (filter === "archived" ? team.archivedAt : !team.archivedAt))
      .filter(team => !needle || `${team.name} ${team.description || ""}`.toLocaleLowerCase("vi").includes(needle))
      .sort((left, right) => {
        if (Boolean(left.archivedAt) !== Boolean(right.archivedAt)) return left.archivedAt ? 1 : -1;
        return text(left.name).localeCompare(text(right.name), "vi");
      });
  }, [teams, filter, search]);

  const activeTeam = detail?.team || null;
  const detailMembers = detail?.members || [];
  const detailTasks = detail?.tasks || [];
    const canEditTeam = Boolean(activeTeam && !activeTeam.archivedAt && (activeTeam.canManage || activeTeam.myRole === "lead" || canManageWorkspace));
  const canArchiveTeam = Boolean(activeTeam && (activeTeam.canArchive || canManageWorkspace));
  const detailMembersWithDirectory = useMemo(() => {
    const byId = new Map(detailMembers.map(member => [idKey(member.id), member]));
    return workspaceMemberDirectory.map(member => ({
      ...member,
      ...(byId.get(idKey(member.id)) || {}),
    }));
  }, [detailMembers, workspaceMemberDirectory]);

  function goToTeam(id) {
    go(`teams/${encodeURIComponent(id)}`);
  }

  function renderTeamCard(team) {
    const teamMembers = workspaceMemberDirectory.filter(member => (team.memberIds || []).some(memberId => sameId(memberId, member.id))).slice(0, 5);
    const memberCount = Number(team.memberCount || team.memberIds?.length || 0);
    return (
      <article className={`teams-card teams-card-${COLOR_META[team.color]?.className || "green"} ${team.archivedAt ? "archived" : ""}`} key={team.id}>
        <button type="button" className="teams-card-main" onClick={() => goToTeam(team.id)}>
          <div className="teams-card-topline">
            <TeamColorMark color={team.color} />
            <span className={`teams-status-badge ${team.archivedAt ? "archived" : "active"}`}>
              <i /> {team.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}
            </span>
            <ChevronRight className="teams-card-arrow" size={17} />
          </div>
          <h2>{team.name}</h2>
          <p>{team.description || "Chưa có mô tả cho team này."}</p>
          <div className="teams-card-bottom">
            <div className="teams-avatar-stack" aria-label={`${memberCount} thành viên`}>
              {teamMembers.map(member => <TeamAvatar key={member.id} member={member} />)}
              {memberCount > teamMembers.length && <span className="teams-avatar-more">+{memberCount - teamMembers.length}</span>}
              {!memberCount && <span className="teams-card-no-members">Chưa có thành viên</span>}
            </div>
            {team.myRole && <RoleBadge role={team.myRole} muted />}
          </div>
        </button>
        <div className="teams-card-stats">
          <span><strong>{team.openTaskCount ?? 0}</strong> việc đang mở</span>
          <span><strong>{team.completedTaskCount ?? 0}</strong> hoàn thành</span>
        </div>
      </article>
    );
  }

  function renderBoard() {
    return (
      <WorkflowBoard
        api={api}
        teamId={activeTeam.id}
        scopeKey={`${me?.workspace?.id}/${activeTeam.id}`}
        tasks={detailTasks}
        members={detailMembersWithDirectory}
        revision={revision}
        readOnly={Boolean(activeTeam.archivedAt || me?.workspace?.suspendedAt)}
        onOpen={(task) => onTaskOpen?.(task, { readOnly: Boolean(activeTeam.archivedAt || task.teamArchived) })}
        onCreate={(status, columnId) => onTaskCreate?.(activeTeam.id, status, columnId)}
        onTrash={onTaskTrash}
        onChanged={async () => {
          if (typeof onChanged === "function") await onChanged();
          setRetryCount(value => value + 1);
        }}
      />
    );
  }

  function renderTaskList() {
    return (
      <div className="teams-task-list">
        {detailTasks.length ? detailTasks.map(task => {
          const assignee = detailMembersWithDirectory.find(member => sameId(member.id, task.assigneeId));
          const status = STATUS_META[task.status] || STATUS_META.todo;
          return (
            <button
              type="button"
              className="teams-task-list-row"
              key={task.id}
              onClick={() => onTaskOpen?.(task, { readOnly: Boolean(activeTeam?.archivedAt || task.teamArchived) })}
            >
              <span className={`teams-status-dot ${status.color}`}><status.icon size={12} /></span>
              <span className="teams-task-list-main"><strong>{task.title}</strong><small>{task.description || "Chưa có mô tả"}</small></span>
              <span className="teams-task-list-status">{status.label}</span>
              <span className={`teams-task-list-due ${isOverdue(task) ? "overdue" : ""}`}>{formatDueDate(task.dueAt)}</span>
              {assignee ? <TeamAvatar member={assignee} size="tiny" /> : <span className="teams-task-unassigned">Chưa giao</span>}
            </button>
          );
        }) : <EmptyState icon={List} title="Chưa có công việc" description="Danh sách công việc của team sẽ xuất hiện ở đây." />}
      </div>
    );
  }

  if (loading) {
    return <div className="teams-page"><div className="teams-loading"><LoaderCircle className="teams-spin" size={22} /><span>Đang tải dữ liệu team…</span></div></div>;
  }

  if (error && !detail && teamId) {
    return (
      <div className="teams-page">
        <div className="teams-error-state" role="alert">
          <span><X size={18} /></span>
          <h2>Không thể mở team</h2>
          <p>{error}</p>
          <div><button type="button" className="teams-button secondary" onClick={() => go("teams")}><ArrowLeft size={15} /> Về danh sách team</button><button type="button" className="teams-button primary" onClick={() => setRetryCount(value => value + 1)}><RefreshCw size={15} /> Thử lại</button></div>
        </div>
      </div>
    );
  }

  if (teamId) {
    if (!activeTeam) return null;
    const openTaskCount = detailTasks.filter(task => task.status !== "done").length;
    const completedTaskCount = detailTasks.filter(task => task.status === "done").length;
    const activeModalKind = modal?.kind;
    const dialog = activeModalKind === "edit" ? (
      <ModalShell title="Chỉnh sửa thông tin team" description="Cập nhật tên, mô tả và màu nhận diện." onClose={closeDialog} dialogRef={dialogRef}>
        <TeamForm mode="edit" form={form} setForm={setForm} roster={roster} setRoster={setRoster} creatorId={currentUserId} workspaceMembers={workspaceMemberDirectory} error={formError} pending={pending} onSubmit={submitTeam} onClose={closeDialog} />
      </ModalShell>
    ) : activeModalKind === "members" ? (
      <ModalShell title="Thành viên team" description="Chọn những người cùng làm việc trong team này." onClose={closeDialog} dialogRef={dialogRef}>
        <RosterEditor members={detailMembersWithDirectory} roster={roster} setRoster={setRoster} currentUserId={currentUserId} canChangeLeads={canManageWorkspace} error={formError} pending={pending} onSubmit={submitRoster} onClose={closeDialog} />
      </ModalShell>
    ) : activeModalKind === "archive" ? (
      <ModalShell title={activeTeam.archivedAt ? "Khôi phục team" : "Lưu trữ team"} description="Bạn có thể thay đổi lựa chọn này sau." onClose={closeDialog} dialogRef={dialogRef}>
        <ArchiveDialog team={activeTeam} pending={pending} error={formError} onConfirm={() => updateArchive(!activeTeam.archivedAt)} onClose={closeDialog} />
      </ModalShell>
    ) : null;

    return (
      <div className="teams-page teams-detail-page">
        <div className="teams-detail-topbar">
          <div className="teams-detail-breadcrumb"><button type="button" className="teams-back-link" onClick={() => go("teams")}><ArrowLeft size={15} /> Tất cả team</button><ChevronRight size={14} /><span>{activeTeam.name}</span></div>
          <ActionMenu
            className="teams-detail-menu"
            label={`Thao tác team ${activeTeam.name}`}
            items={[
              canEditTeam && { label: "Chỉnh sửa", icon: Pencil, onSelect: trigger => openDialog("edit", {}, { currentTarget: trigger }) },
              canEditTeam && { label: "Thành viên", icon: UsersRound, onSelect: trigger => openDialog("members", {}, { currentTarget: trigger }) },
              canArchiveTeam && { label: activeTeam.archivedAt ? "Khôi phục" : "Lưu trữ", icon: activeTeam.archivedAt ? ArchiveRestore : Archive, danger: !activeTeam.archivedAt, onSelect: trigger => openDialog("archive", {}, { currentTarget: trigger }) },
            ]}
          />
        </div>
        <header className={`teams-detail-head teams-color-${COLOR_META[activeTeam.color]?.className || "green"}`}>
          <div className="teams-detail-identity"><TeamColorMark color={activeTeam.color} size="large" /><div><div className="teams-detail-title-line"><span className={`teams-status-badge ${activeTeam.archivedAt ? "archived" : "active"}`}><i /> {activeTeam.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}</span>{activeTeam.myRole && <RoleBadge role={activeTeam.myRole} />}</div><h1>{activeTeam.name}</h1><p>{activeTeam.description || "Team chưa có mô tả."}</p></div></div>

        </header>
        <div className="teams-detail-stats">
          <div><span className="teams-stat-icon blue"><LayoutGrid size={16} /></span><span><strong>{openTaskCount}</strong><small>Việc đang mở</small></span></div>
          <div><span className="teams-stat-icon green"><Check size={16} /></span><span><strong>{completedTaskCount}</strong><small>Đã hoàn thành</small></span></div>
          <div><span className="teams-stat-icon purple"><Users size={16} /></span><span><strong>{detailMembers.length}</strong><small>Thành viên</small></span></div>
        </div>
        <div className="teams-detail-tabs" role="tablist" aria-label="Nội dung team">
          <button type="button" role="tab" aria-selected={detailTab === "board"} className={detailTab === "board" ? "active" : ""} onClick={() => setDetailTab("board")}><LayoutGrid size={16} /> Bảng công việc <span>{detailTasks.length}</span></button>
          <button type="button" role="tab" aria-selected={detailTab === "members"} className={detailTab === "members" ? "active" : ""} onClick={() => setDetailTab("members")}><UsersRound size={16} /> Thành viên <span>{detailMembers.length}</span></button>
        </div>
        {detailTab === "board" ? (
          <section className="teams-board-section" aria-label="Bảng công việc">
            <div className="teams-section-toolbar"><div><span className="teams-eyebrow">TIẾN ĐỘ TEAM</span><h2>Công việc của {activeTeam.name}</h2></div><div className="teams-toolbar-actions"><div className="teams-view-toggle" role="group" aria-label="Kiểu hiển thị"><button type="button" className={taskView === "board" ? "active" : ""} onClick={() => setTaskView("board")} aria-label="Hiển thị Kanban"><LayoutGrid size={16} /></button><button type="button" className={taskView === "list" ? "active" : ""} onClick={() => setTaskView("list")} aria-label="Hiển thị danh sách"><List size={16} /></button></div>{!activeTeam.archivedAt && <button type="button" className="teams-button primary" onClick={() => onTaskCreate?.(activeTeam.id, "todo")}><Plus size={16} /> Tạo công việc</button>}</div></div>
            {activeTeam.archivedAt && <div className="teams-readonly-banner"><Archive size={16} /><span>Team đã lưu trữ. Bạn vẫn có thể xem lịch sử công việc; khôi phục team để tiếp tục cập nhật.</span></div>}
            {taskView === "board" ? renderBoard() : renderTaskList()}
          </section>
        ) : (
          <section className="teams-members-section"><div className="teams-section-toolbar"><div><span className="teams-eyebrow">CỘNG TÁC</span><h2>Những người trong team</h2></div>{canEditTeam && !activeTeam.archivedAt && <button type="button" className="teams-button primary" onClick={event => openDialog("members", {}, event)}><UserPlus size={16} /> Quản lý thành viên</button>}</div><div className="teams-members-grid">{detailMembers.length ? detailMembers.map(member => <article className="teams-member-card" key={member.id}><TeamAvatar member={member} size="large" /><div><strong>{memberName(member)}</strong><span>{member.email || "Thành viên doanh nghiệp"}</span></div><RoleBadge role={member.role} /></article>) : <EmptyState icon={UsersRound} title="Chưa có thành viên" description="Thêm thành viên để team có thể cùng cộng tác." />}</div></section>
        )}
        {dialog}
      </div>
    );
  }

  const activeCount = teams.filter(team => !team.archivedAt).length;
  const archivedCount = teams.filter(team => team.archivedAt).length;
  const createDialog = modal?.kind === "create" ? (
    <ModalShell title="Tạo team mới" description="Tổ chức công việc theo nhóm mà mọi người cùng phụ trách." onClose={closeDialog} dialogRef={dialogRef}>
      <TeamForm mode="create" form={form} setForm={setForm} creatorId={currentUserId} workspaceMembers={workspaceMemberDirectory} roster={roster} setRoster={setRoster} error={formError} pending={pending} onSubmit={submitTeam} onClose={closeDialog} />
    </ModalShell>
  ) : null;

  return (
    <div className="teams-page">
      <header className="teams-page-heading"><div><span className="teams-eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Teams</h1><p>Nhóm đúng người, gom đúng việc, giữ tiến độ rõ ràng.</p></div>{canManageWorkspace && <button type="button" className="teams-button primary" onClick={event => openDialog("create", {}, event)}><Plus size={17} /> Tạo team</button>}</header>
      <div className="teams-overview-strip"><span><i /> {activeCount} team đang hoạt động <b>·</b> {archivedCount} team đã lưu trữ</span><span className="teams-overview-note"><ShieldCheck size={14} /> Thành viên có thể tham gia nhiều team</span></div>
      <div className="teams-list-toolbar"><label className="teams-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm tên hoặc mô tả team…" aria-label="Tìm team" /></label><div className="teams-filter-tabs" role="group" aria-label="Lọc team"><button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>Đang hoạt động <span>{activeCount}</span></button><button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Đã lưu trữ <span>{archivedCount}</span></button><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Tất cả <span>{teams.length}</span></button></div></div>
      {error && <div className="teams-inline-error" role="alert"><span><X size={15} /></span>{error}<button type="button" onClick={() => setRetryCount(value => value + 1)}><RefreshCw size={14} /> Thử lại</button></div>}
      {filteredTeams.length ? <div className="teams-card-grid">{filteredTeams.map(renderTeamCard)}</div> : <EmptyState icon={UsersRound} title={search ? "Không tìm thấy team phù hợp" : filter === "archived" ? "Chưa có team được lưu trữ" : "Chưa có team nào"} description={search ? "Thử một từ khoá khác hoặc xoá bộ lọc tìm kiếm." : canManageWorkspace ? "Tạo team đầu tiên để bắt đầu phân chia công việc." : "Bạn sẽ thấy các team được tham gia tại đây."} action={canManageWorkspace && !search && filter !== "archived" && <button type="button" className="teams-button primary" onClick={event => openDialog("create", {}, event)}><Plus size={16} /> Tạo team đầu tiên</button>} />}
      {createDialog}
    </div>
  );
}
