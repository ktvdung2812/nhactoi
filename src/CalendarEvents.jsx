import React, { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import useModalFocus from "./useModalFocus.js";
import "./services.css";

const local = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
};

export default function CalendarEvents({ api, teams = [] }) {
  const [events, setEvents] = useState([]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [remove, setRemove] = useState(null);
  const dialogRef = useRef(null);
  const errorRef = useRef(null);
  const titleRef = useRef(null);
  const errorFocusTarget = useRef(null);

  const closeDialogs = () => {
    setDraft(null);
    setRemove(null);
    setError("");
  };

  useModalFocus({
    open: Boolean(draft || remove),
    dialogRef,
    onClose: closeDialogs,
    disabled: busy,
  });

  useEffect(() => {
    let active = true;
    api("/calendar-events")
      .then(value => active && setEvents(value.events))
      .catch(loadError => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, [api, revision]);

  useEffect(() => {
    if (!error || (!draft && !remove)) return undefined;
    const target = errorFocusTarget.current;
    errorFocusTarget.current = null;
    const frame = requestAnimationFrame(() => (target === "title" ? titleRef.current : errorRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [error, Boolean(draft || remove)]);

  function openCreate() {
    setError("");
    setDraft({
      title: "",
      description: "",
      teamId: "",
      startsAt: local(new Date()),
      endsAt: local(Date.now() + 3600000),
      remindAt: "",
    });
  }

  function openEdit(event) {
    setError("");
    setDraft({
      id: event.id,
      title: event.title,
      description: event.description,
      teamId: event.team_id || "",
      startsAt: local(event.starts_at),
      endsAt: local(event.ends_at),
      remindAt: local(event.remind_at),
    });
  }

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      closeDialogs();
      setRevision(value => value + 1);
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

  return (
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
      {!draft && !remove && error && <p role="alert" className="form-error">{error}</p>}
      <div className="service-grid">
        {events.map(event => (
          <article className="service-card" key={event.id}>
            <div className="service-card-head">
              <h3>{event.title}</h3>
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
              {teams.find(team => team.id === event.team_id)?.name || "Toàn doanh nghiệp"}
              {event.remind_at ? ` · Nhắc ${new Date(event.remind_at).toLocaleString("vi-VN")}` : ""}
            </small>
          </article>
        ))}
      </div>
      {!events.length && <p>Chưa có lịch hẹn.</p>}

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
                {[['startsAt', 'Bắt đầu'], ['endsAt', 'Kết thúc'], ['remindAt', 'Nhắc trước lúc']].map(([id, name]) => <label key={id}>{name}<input type="datetime-local" required={id !== "remindAt"} value={draft[id]} onChange={event => setDraft({ ...draft, [id]: event.target.value })} /></label>)}
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
    </section>
  );
}
