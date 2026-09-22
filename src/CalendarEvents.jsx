import React, { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import useModalFocus from "./useModalFocus.js";
import "./services.css";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };

const local = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
};

export default function CalendarEvents({
  api,
  teams = [],
  events: controlledEvents,
  onChanged,
  embedded = false,
  openEventId = null,
  onEventOpened,
  onOpenService,
  createRequest = 0,
}) {
  const [localEvents, setLocalEvents] = useState([]);
  const [draft, setDraft] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [remove, setRemove] = useState(null);
  const createRequestRef = useRef(createRequest);
  const dialogRef = useRef(null);
  const errorRef = useRef(null);
  const titleRef = useRef(null);
  const errorFocusTarget = useRef(null);

  const events = controlledEvents ?? localEvents;

  const closeDialogs = () => {
    setDraft(null);
    setDetail(null);
    setRemove(null);
    setError("");
  };

  useModalFocus({
    open: Boolean(draft || detail || remove),
    dialogRef,
    onClose: closeDialogs,
    disabled: busy,
  });

  useEffect(() => {
    if (controlledEvents !== undefined) return undefined;
    let active = true;
    api("/calendar-events")
      .then(value => active && setLocalEvents(value.events || []))
      .catch(loadError => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, [api, revision, controlledEvents]);

  useEffect(() => {
    if (!openEventId) return;
    const event = events.find(item => String(item.id) === String(openEventId));
    if (!event) return;
    if (event.service_id) {
      onOpenService?.(event.service_id);
      onEventOpened?.();
      return;
    }
    setError("");
    setDetail(event);
    onEventOpened?.();
  }, [events, onEventOpened, onOpenService, openEventId]);

  useEffect(() => {
    if (createRequest === createRequestRef.current) return;
    createRequestRef.current = createRequest;
    openCreate();
  }, [createRequest]);

  useEffect(() => {
    if (!error || (!draft && !remove)) return undefined;
    const target = errorFocusTarget.current;
    errorFocusTarget.current = null;
    const frame = requestAnimationFrame(() => (target === "title" ? titleRef.current : errorRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [error, Boolean(draft || remove)]);

  function openCreate() {
    setError("");
    setDetail(null);
    setDraft({
      title: "",
      description: "",
      teamId: "",
      startsAt: local(new Date()),
      endsAt: local(Date.now() + 3600000),
      remindAt: "",
      status: "todo",
    });
  }

  function openEdit(event) {
    setError("");
    setDetail(null);
    setDraft({
      id: event.id,
      title: event.title,
      description: event.description,
      teamId: event.team_id || "",
      startsAt: local(event.starts_at),
      endsAt: local(event.ends_at),
      remindAt: local(event.remind_at),
      status: event.status || "todo",
    });
  }

  function openDetail(event) {
    if (event.service_id) {
      onOpenService?.(event.service_id);
      return;
    }
    setError("");
    setDetail(event);
  }

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      closeDialogs();
      setRevision(value => value + 1);
      await onChanged?.();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  function submitDraft(event) {
    event.preventDefault();
    if (!draft.title.trim()) {
      errorFocusTarget.current = "title";
      setError("Vui lòng nhập tên lịch hẹn.");
      return;
    }
    const startsAt = new Date(draft.startsAt);
    const endsAt = new Date(draft.endsAt);
    const remindAt = draft.remindAt ? new Date(draft.remindAt) : null;
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      setError("Thời gian kết thúc phải sau thời gian bắt đầu.");
      return;
    }
    if (remindAt && (!Number.isFinite(remindAt.getTime()) || remindAt > startsAt)) {
      setError("Thời gian nhắc phải trước lịch hẹn.");
      return;
    }
    const { id, ...value } = draft;
    act(() =>
      api(`/calendar-events${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          ...value,
          title: value.title.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          remindAt: remindAt ? remindAt.toISOString() : null,
        }),
      }),
    );
  }

  const cards = !embedded && (
    <section className="services-page">
      <header className="services-heading">
        <div>
          <h1>Lịch hẹn</h1>
          <p>Lịch hẹn và các kỳ gia hạn dịch vụ. Nhắc lịch hẹn được gửi cho người tạo.</p>
        </div>
        <button type="button" className="button" onClick={openCreate}>
          <Plus size={18} />Tạo lịch hẹn
        </button>
      </header>
      {!draft && !remove && !detail && error && <p role="alert" className="form-error">{error}</p>}
      <div className="service-grid">
        {events.map(event => (
          <article className="service-card" key={event.id}>
            <div className="service-card-head">
              <button type="button" className="service-card-title" onClick={() => openDetail(event)}>{event.title}</button>
              {event.canEdit && (
                <ActionMenu
                  label={`Thao tác ${event.title}`}
                  disabled={busy}
                  items={[
                    { label: "Chỉnh sửa", icon: Pencil, onSelect: () => openEdit(event) },
                    { label: "Xóa lịch hẹn", icon: Trash2, danger: true, onSelect: () => { setError(""); setRemove(event); } },
                  ]}
                />
              )}
            </div>
            <p>{new Date(event.starts_at).toLocaleString("vi-VN")} → {new Date(event.ends_at).toLocaleString("vi-VN")}</p>
            <p className="service-card-description">{event.description}</p>
            {event.service_id && <a className="button secondary" href={`/services?service=${encodeURIComponent(event.service_id)}`}>Xem dịch vụ gia hạn</a>}
            <small>
              {event.service_id ? "Gia hạn dịch vụ" : statuses[event.status || "todo"]}
              {" · "}
              {teams.find(team => team.id === event.team_id)?.name || "Toàn doanh nghiệp"}
              {event.remind_at ? ` · Nhắc ${new Date(event.remind_at).toLocaleString("vi-VN")}` : ""}
            </small>
          </article>
        ))}
      </div>
      {!events.length && <p>Chưa có lịch hẹn.</p>}
    </section>
  );

  return (
    <>
      {cards}

      {detail && (
        <div className="modal-backdrop">
          <section ref={dialogRef} className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-detail-title" tabIndex={-1}>
            <header>
              <h2 id="calendar-detail-title">{detail.title}</h2>
              <button type="button" className="icon-btn" disabled={busy} aria-label="Đóng" onClick={closeDialogs}><X /></button>
            </header>
            <div className="calendar-event-detail">
              <p><strong>Trạng thái:</strong> {statuses[detail.status || "todo"] || detail.status}</p>
              <p><strong>Thời gian:</strong> {new Date(detail.starts_at).toLocaleString("vi-VN")} → {new Date(detail.ends_at).toLocaleString("vi-VN")}</p>
              <p><strong>Phạm vi:</strong> {teams.find(team => team.id === detail.team_id)?.name || "Toàn doanh nghiệp"}</p>
              {detail.remind_at && <p><strong>Nhắc trước lúc:</strong> {new Date(detail.remind_at).toLocaleString("vi-VN")}</p>}
              {detail.description && <p className="service-card-description">{detail.description}</p>}
            </div>
            <div className="settings-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={closeDialogs}>Đóng</button>
              {detail.canEdit && <>
                <button type="button" className="button secondary" disabled={busy} onClick={() => openEdit(detail)}><Pencil size={16} />Chỉnh sửa</button>
                <button type="button" className="button danger" disabled={busy} onClick={() => { setRemove(detail); setDetail(null); }}><Trash2 size={16} />Xóa lịch hẹn</button>
              </>}
            </div>
          </section>
        </div>
      )}

      {draft && (
        <div className="modal-backdrop">
          <section ref={dialogRef} className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title" tabIndex={-1}>
            <header>
              <h2 id="calendar-dialog-title">{draft.id ? "Chỉnh sửa" : "Tạo"} lịch hẹn</h2>
              <button type="button" className="icon-btn" disabled={busy} aria-label="Đóng" onClick={closeDialogs}><X /></button>
            </header>
            {error && <div ref={errorRef} id="calendar-form-error" className="service-modal-error" role="alert" tabIndex={-1}>{error}</div>}
            <form onSubmit={submitDraft}>
              <fieldset disabled={busy} className="service-form-grid">
                <label>Tên lịch hẹn<input ref={titleRef} data-modal-autofocus required maxLength={200} aria-describedby={error ? "calendar-form-error" : undefined} value={draft.title} onChange={event => { setError(""); setDraft({ ...draft, title: event.target.value }); }} /></label>
                <label>Phạm vi<select value={draft.teamId} onChange={event => setDraft({ ...draft, teamId: event.target.value })}><option value="">Toàn doanh nghiệp</option>{teams.filter(team => !team.archivedAt).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                <label>Trạng thái<select name="status" value={draft.status || "todo"} onChange={event => setDraft({ ...draft, status: event.target.value })}>{Object.entries(statuses).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                {[['startsAt', 'Bắt đầu'], ['endsAt', 'Kết thúc'], ['remindAt', 'Nhắc trước lúc']].map(([id, name]) => <label key={id}>{name}<input name={id} type="datetime-local" required={id !== "remindAt"} value={draft[id]} onChange={event => setDraft({ ...draft, [id]: event.target.value })} /></label>)}
                <label>Mô tả<textarea maxLength={5000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
              </fieldset>
              <button type="submit" className="button" disabled={busy}>Lưu lịch hẹn</button>
            </form>
          </section>
        </div>
      )}

      {remove && (
        <div className="modal-backdrop">
          <section ref={dialogRef} className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-remove-title" tabIndex={-1}>
            <h2 id="calendar-remove-title">Xóa “{remove.title}”?</h2>
            {error && <div ref={errorRef} className="service-modal-error" role="alert" tabIndex={-1}>{error}</div>}
            <p>Lịch hẹn này sẽ không còn nhắc thông báo.</p>
            <div className="settings-actions"><button type="button" className="button secondary" disabled={busy} onClick={closeDialogs}>Hủy</button><button type="button" className="button danger" disabled={busy} onClick={() => act(() => api(`/calendar-events/${remove.id}`, { method: "DELETE" }))}>Xóa lịch hẹn</button></div>
          </section>
        </div>
      )}
    </>
  );
}
