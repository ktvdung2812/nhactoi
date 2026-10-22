import React, { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Bell, CalendarDays, ChevronDown, ChevronUp, Clock, Copy, GripVertical, ListChecks, Pencil, Plus, Trash2, UserRound } from "lucide-react";

function reorderIds(items, fromId, beforeId) {
  const ids = items.map((item) => item.id);
  const from = ids.indexOf(fromId);
  if (from < 0) return null;
  const next = ids.filter((id) => id !== fromId);
  const index = beforeId == null ? next.length : next.indexOf(beforeId);
  if (index < 0) return null;
  next.splice(index, 0, fromId);
  return next.every((id, position) => id === ids[position]) ? null : next;
}

function showDate(value) {
  if (!value) return "Chọn ngày";
  const [year, month, day] = String(value).split("-");
  return day && month && year ? `${day}/${month}/${year}` : "Chọn ngày";
}

function todayKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function isoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase();
}

function assigneeLabel(item, members) {
  const ids = (item.assigneeIds || []).filter((id) => members.some((member) => member.id === id));
  if (!ids.length) return "Chưa giao";
  const name = members.find((member) => member.id === ids[0])?.name || item.assignees?.find((person) => person.id === ids[0])?.name || "Thành viên";
  return ids.length === 1 ? name : `${name}, +${ids.length - 1}`;
}

export default function TaskChecklists({ base, taskRevision, checklists = [], members = [], writable, disabled, mutate }) {
  const [itemDrafts, setItemDrafts] = useState({});
  const [newTitle, setNewTitle] = useState("");
  const [editingList, setEditingList] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [panel, setPanel] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [dropBefore, setDropBefore] = useState(null);
  const draggedRef = useRef(null), newTitleRevision = useRef(), itemDraftRevisions = useRef({});
  const count = checklists.reduce((sum, list) => sum + list.items.length, 0);
  const complete = checklists.reduce((sum, list) => sum + list.items.filter((item) => item.completed).length, 0);

  useEffect(() => {
    if (!panel) return undefined;
    function close(event) {
      if (event.key === "Escape") setPanel(null);
    }
    function outside(event) {
      if (!event.target.closest?.(".td-tasklist-pop")) setPanel(null);
    }
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [panel]);

  function moveLists(index, direction) {
    const ids = checklists.map((list) => list.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    mutate(`${base}/checklists/order`, "PUT", { ids }, "Đã sắp xếp checklist.");
  }

  function moveItems(list, fromId, beforeId, expectedRevision = taskRevision) {
    const ids = reorderIds(list.items, fromId, beforeId);
    if (!ids) return;
    mutate(`${base}/checklists/${encodeURIComponent(list.id)}/order`, "PUT", { ids, expectedRevision }, "Đã sắp xếp mục checklist.");
  }

  return (
    <section className="td-panel td-tasklists">
      <div className="td-section-heading">
        <h2><ListChecks size={18} />Task list<span className="td-count">{complete}/{count}</span></h2>
      </div>
      {!checklists.length && <p className="td-empty">Chưa có checklist. Thêm checklist để tách các nhóm việc nhỏ.</p>}
      <div className="td-tasklist-stack">
        {checklists.map((list, index) => {
          const done = list.items.filter((item) => item.completed).length;
          const percent = list.items.length ? Math.round((done / list.items.length) * 100) : 0;
          const listPath = `${base}/checklists/${encodeURIComponent(list.id)}`;
          return (
            <section className="td-tasklist" key={list.id} aria-label={list.title}>
              <div className="td-tasklist-head">
                {editingList?.id === list.id ? (
                  <form className="td-tasklist-rename" onSubmit={(event) => {
                    event.preventDefault();
                    mutate(listPath, "PATCH", { title: editingList.title, expectedRevision: editingList.revision }, "Đã đổi tên checklist.", () => setEditingList(null));
                  }}>
                    <input aria-label="Tên checklist mới" autoFocus required maxLength={240} value={editingList.title} disabled={disabled} onChange={(event) => setEditingList({ ...editingList, title: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setEditingList(null); }} />
                  </form>
                ) : <h3>{list.title}</h3>}
                <span>{done}/{list.items.length}</span>
                {writable && <>
                  <button type="button" className="td-tasklist-icon" aria-label={`Đưa checklist ${list.title} lên trên`} disabled={disabled || index === 0} onClick={() => moveLists(index, -1)}><ChevronUp size={15} /></button>
                  <button type="button" className="td-tasklist-icon" aria-label={`Đưa checklist ${list.title} xuống dưới`} disabled={disabled || index === checklists.length - 1} onClick={() => moveLists(index, 1)}><ChevronDown size={15} /></button>
                  <button type="button" className="td-tasklist-icon" aria-label={`Đổi tên checklist ${list.title}`} disabled={disabled} onClick={() => setEditingList({ id: list.id, title: list.title, revision: taskRevision })}><Pencil size={14} /></button>
                  <button type="button" className="td-tasklist-icon" aria-label={`Sao chép checklist ${list.title}`} disabled={disabled} onClick={() => mutate(`${listPath}/copy`, "POST", {}, "Đã sao chép checklist.")}><Copy size={14} /></button>
                  <button type="button" className="td-tasklist-icon danger" aria-label={`Xóa checklist ${list.title}`} disabled={disabled} onClick={() => setConfirm({ id: list.id, title: list.title, revision: taskRevision })}><Trash2 size={14} /></button>
                </>}
              </div>
              {confirm?.id === list.id && (
                <div className="td-tasklist-confirm" role="region" aria-label="Xác nhận xóa checklist">
                  <p>Xóa checklist “{confirm.title}” và các mục bên trong?</p>
                  <button type="button" className="button secondary" disabled={disabled} onClick={() => setConfirm(null)}>Hủy</button>
                  <button type="button" className="button td-danger" disabled={disabled} onClick={() => mutate(listPath, "DELETE", { expectedRevision: confirm.revision }, "Đã xóa checklist.", () => setConfirm(null))}>Xóa</button>
                </div>
              )}
              {list.items.length > 0 && (
                <div className="td-tasklist-progress">
                  <span>{percent}%</span>
                  <progress aria-label={`Tiến độ ${list.title}`} max={100} value={percent} />
                </div>
              )}
              <div className="td-tasklist-items" aria-label={`Mục trong ${list.title}`}>
                {list.items.map((item, itemIndex) => {
                  const itemPath = `${listPath}/items/${encodeURIComponent(item.id)}`;
                  const overdue = !item.completed && item.dueAt && item.dueAt < todayKey();
                  const assignedIds = (item.assigneeIds || []).filter((id) => members.some((member) => member.id === id));
                  return (
                    <div
                      className={`td-tasklist-row ${item.completed ? "is-done" : ""} ${dropBefore === item.id ? "is-drop-before" : ""}`}
                      key={item.id}
                      onDragOver={(event) => {
                        if (draggedRef.current?.listId !== list.id || draggedRef.current.itemId === item.id) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDropBefore(item.id);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const active = draggedRef.current;
                        draggedRef.current = null;
                        setDropBefore(null);
                        if (!active || active.listId !== list.id) return;
                        moveItems(list, active.itemId, item.id, active.revision);
                      }}
                    >
                      <div className="td-tasklist-main">
                        <span
                          className="td-tasklist-grip"
                          draggable={writable && !disabled}
                          role="button"
                          tabIndex={writable && !disabled ? 0 : -1}
                          aria-label={`Kéo mục ${item.title} để sắp xếp`}
                          title="Kéo để sắp xếp. Dùng mũi tên lên xuống khi đang chọn tay cầm."
                          onDragStart={(event) => {
                            if (!writable || disabled) { event.preventDefault(); return; }
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            draggedRef.current = { listId: list.id, itemId: item.id, revision: taskRevision };
                          }}
                          onDragEnd={() => { draggedRef.current = null; setDropBefore(null); }}
                          onKeyDown={(event) => {
                            if (!writable || disabled) return;
                            if (event.key === "ArrowUp" && itemIndex > 0) { event.preventDefault(); moveItems(list, item.id, list.items[itemIndex - 1].id); }
                            if (event.key === "ArrowDown" && itemIndex < list.items.length - 1) { event.preventDefault(); moveItems(list, item.id, list.items[itemIndex + 2]?.id || null); }
                          }}
                        >
                          <GripVertical size={15} aria-hidden="true" />
                        </span>
                        <input type="checkbox" aria-label={`Hoàn thành ${item.title}`} checked={Boolean(item.completed)} disabled={disabled} onChange={(event) => mutate(itemPath, "PATCH", { completed: event.target.checked }, event.target.checked ? "Đã hoàn thành mục checklist." : "Đã mở lại mục checklist.")} />
                        {editingItem?.id === item.id ? (
                          <form className="td-tasklist-rename" onSubmit={(event) => { event.preventDefault(); mutate(itemPath, "PATCH", { title: editingItem.title, expectedRevision: editingItem.revision }, "Đã đổi tên mục checklist.", () => setEditingItem(null)); }}>
                            <input aria-label="Tên mục checklist mới" autoFocus required maxLength={240} value={editingItem.title} disabled={disabled} onChange={(event) => setEditingItem({ ...editingItem, title: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setEditingItem(null); }} />
                          </form>
                        ) : writable ? (
                          <button type="button" className="td-tasklist-title" disabled={disabled} onClick={() => setEditingItem({ id: item.id, title: item.title, revision: taskRevision })}>{item.title}</button>
                        ) : <span className="td-tasklist-title">{item.title}</span>}
                      </div>
                      <div className="td-tasklist-meta">
                        <div className={`td-tasklist-pop ${panel?.itemId === item.id && panel.field === "start" ? "is-open" : ""}`}>
                          <button type="button" className="td-tasklist-field" aria-label={`Ngày bắt đầu mục ${item.title}`} disabled={disabled} onClick={() => setPanel(panel?.itemId === item.id && panel.field === "start" ? null : { itemId: item.id, field: "start" })}>
                            <CalendarDays size={13} /><span>Bắt đầu</span><span>{showDate(item.startAt)}</span>
                          </button>
                          {panel?.itemId === item.id && panel.field === "start" && (
                            <div className="td-tasklist-panel" role="dialog" aria-label={`Chọn ngày bắt đầu ${item.title}`}>
                              <input type="date" aria-label="Ngày bắt đầu" disabled={disabled} max={item.dueAt || undefined} value={item.startAt || ""} onChange={(event) => mutate(itemPath, "PATCH", { startAt: event.target.value || null }, event.target.value ? "Đã cập nhật ngày bắt đầu." : "Đã xoá ngày bắt đầu.", () => setPanel(null))} />
                              {item.startAt && <button type="button" className="td-text-button" disabled={disabled} onClick={() => mutate(itemPath, "PATCH", { startAt: null }, "Đã xoá ngày bắt đầu.", () => setPanel(null))}>Xoá ngày bắt đầu</button>}
                            </div>
                          )}
                        </div>
                        <div className={`td-tasklist-pop ${panel?.itemId === item.id && panel.field === "due" ? "is-open" : ""}`}>
                          <button type="button" className="td-tasklist-field" aria-label={`Hạn mục ${item.title}`} disabled={disabled} onClick={() => setPanel(panel?.itemId === item.id && panel.field === "due" ? null : { itemId: item.id, field: "due" })}>
                            <Clock size={13} /><span>Hạn</span><span>{showDate(item.dueAt)}</span>
                          </button>
                          {overdue && <span className="td-tasklist-overdue">Quá hạn</span>}
                          {panel?.itemId === item.id && panel.field === "due" && (
                            <div className="td-tasklist-panel" role="dialog" aria-label={`Chọn hạn ${item.title}`}>
                              <input type="date" aria-label="Hạn" disabled={disabled} min={item.startAt || undefined} value={item.dueAt || ""} onChange={(event) => mutate(itemPath, "PATCH", { dueAt: event.target.value || null }, event.target.value ? "Đã cập nhật hạn." : "Đã xoá hạn.", () => setPanel(null))} />
                              {item.dueAt && <button type="button" className="td-text-button" disabled={disabled} onClick={() => mutate(itemPath, "PATCH", { dueAt: null }, "Đã xoá hạn.", () => setPanel(null))}>Xoá hạn</button>}
                            </div>
                          )}
                        </div>
                        <div className={`td-tasklist-pop align-end ${panel?.itemId === item.id && panel.field === "assignee" ? "is-open" : ""}`}>
                          <button type="button" className="td-tasklist-field td-tasklist-person" aria-label={`Người phụ trách mục ${item.title}`} title="Gán từ thành viên thẻ" disabled={disabled} onClick={() => setPanel(panel?.itemId === item.id && panel.field === "assignee" ? null : { itemId: item.id, field: "assignee" })}>
                            <UserRound size={13} /><span>{assigneeLabel(item, members)}</span>
                          </button>
                          {panel?.itemId === item.id && panel.field === "assignee" && (
                            <div className="td-tasklist-panel td-tasklist-members" role="dialog" aria-label={`Thành viên thẻ cho ${item.title}`}>
                              <p>Thành viên thẻ</p>
                              {!members.length && <p className="td-tasklist-note">Thẻ chưa có thành viên. Thêm người phụ trách của công việc trước khi gán mục.</p>}
                              {assignedIds.length > 0 && <button type="button" className="td-tasklist-clear" disabled={disabled} onClick={() => mutate(itemPath, "PATCH", { assigneeIds: [] }, "Đã bỏ người phụ trách.")}>Bỏ gán tất cả</button>}
                              {members.map((member) => {
                                const checked = assignedIds.includes(member.id);
                                return (
                                  <label key={member.id}>
                                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => {
                                      const assigneeIds = checked ? assignedIds.filter((id) => id !== member.id) : [...assignedIds, member.id];
                                      mutate(itemPath, "PATCH", { assigneeIds }, assigneeIds.length ? "Đã giao người phụ trách." : "Đã bỏ người phụ trách.");
                                    }} />
                                    <span className="td-tasklist-avatar" aria-hidden="true">{initials(member.name)}</span>
                                    <span>{member.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className={`td-tasklist-pop align-end ${panel?.itemId === item.id && panel.field === "remind" ? "is-open" : ""}`}>
                          <button type="button" className={`td-tasklist-icon ${item.remindAt ? "is-on" : ""}`} aria-label={`Nhắc việc cho mục ${item.title}`} title={item.completed ? "Mục đã hoàn thành" : "Nhắc những người được gán mục này"} disabled={disabled || item.completed} onClick={() => setPanel(panel?.itemId === item.id && panel.field === "remind" ? null : { itemId: item.id, field: "remind" })}>
                            <Bell size={15} />
                          </button>
                          {panel?.itemId === item.id && panel.field === "remind" && (
                            <div className="td-tasklist-panel" role="dialog" aria-label={`Nhắc việc ${item.title}`}>
                              <p>Nhắc người được gán mục này.</p>
                              <input type="datetime-local" aria-label="Thời điểm nhắc" disabled={disabled} value={localDateTime(item.remindAt)} onChange={(event) => mutate(itemPath, "PATCH", { remindAt: isoDateTime(event.target.value) }, event.target.value ? "Đã cập nhật lịch nhắc." : "Đã xoá lịch nhắc.", () => setPanel(null))} />
                              {item.remindAt && <button type="button" className="td-text-button" disabled={disabled} onClick={() => mutate(itemPath, "PATCH", { remindAt: null }, "Đã xoá lịch nhắc.", () => setPanel(null))}>Xoá nhắc</button>}
                            </div>
                          )}
                        </div>
                        {writable && (
                          <div className="td-tasklist-hover">
                            <button type="button" className="td-tasklist-icon" aria-label={`Chuyển mục ${item.title} thành công việc`} title="Chuyển thành công việc mới trong Cần làm" disabled={disabled} onClick={() => mutate(`${itemPath}/convert`, "POST", {}, "Đã chuyển mục thành công việc.", undefined, true)}><ArrowRightLeft size={14} /></button>
                            <button type="button" className="td-tasklist-icon danger" aria-label={`Xóa mục ${item.title}`} disabled={disabled} onClick={() => mutate(itemPath, "DELETE", undefined, "Đã xóa mục checklist.")}><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {writable && (
                <form className="td-tasklist-add" onSubmit={(event) => {
                  event.preventDefault();
                  mutate(`${listPath}/items`, "POST", { title: itemDrafts[list.id] || "", expectedRevision: itemDraftRevisions.current[list.id] ?? taskRevision }, "Đã thêm mục checklist.", () => setItemDrafts((current) => ({ ...current, [list.id]: "" })));
                }}>
                  <input aria-label={`Mục mới trong ${list.title}`} placeholder="Thêm một mục..." required maxLength={240} disabled={disabled} value={itemDrafts[list.id] || ""} onChange={(event) => { if (!itemDrafts[list.id]) itemDraftRevisions.current[list.id] = taskRevision; setItemDrafts({ ...itemDrafts, [list.id]: event.target.value }); }} />
                  <button className="button secondary" disabled={disabled || !itemDrafts[list.id]?.trim()}>Thêm</button>
                </form>
              )}
            </section>
          );
        })}
      </div>
      {writable && (
        <form className="td-tasklist-add td-tasklist-new" onSubmit={(event) => {
          event.preventDefault();
          mutate(`${base}/checklists`, "POST", { title: newTitle, expectedRevision: newTitleRevision.current ?? taskRevision }, "Đã thêm checklist.", () => setNewTitle(""));
        }}>
          <input aria-label="Tên checklist mới" placeholder="Tên checklist mới..." required maxLength={240} disabled={disabled} value={newTitle} onChange={(event) => { if (!newTitle) newTitleRevision.current = taskRevision; setNewTitle(event.target.value); }} />
          <button className="button secondary" disabled={disabled || !newTitle.trim()}><Plus size={15} />Thêm checklist</button>
        </form>
      )}
    </section>
  );
}
