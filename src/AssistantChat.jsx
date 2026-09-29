import React, { useEffect, useRef, useState } from "react";
import { Bot, Sparkles, X, Send, Plus, History, Trash2, Maximize2, Minimize2, LoaderCircle, ArrowUpRight, MessageCircle, RefreshCw } from "lucide-react";
import "./assistant-chat.css";
import AssistantMarkdown from "./AssistantMarkdown.js";

const prompts = ["Tìm những công việc đang làm", "Tóm tắt các việc ưu tiên cao", "Giúp tôi soạn một công việc mới"];
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const taskStatuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const dueLabel = value => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export default function AssistantChat({ api, me, onOpenTask, onDraft, onSettings, selectedTaskId, inactive = false, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [deleting, setDeleting] = useState(null);
  const panel = useRef(null);
  const transcript = useRef(null);
  const composer = useRef(null);
  const launcher = useRef(null);
  const alive = useRef(true);
  const request = useRef(0);
  const sending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);

  async function load() {
    const version = ++request.current;
    setLoading(true); setError("");
    try {
      const [settings, history] = await Promise.all([api("/ai/config"), api("/ai/conversations")]);
      if (!alive.current || request.current !== version) return;
      setConfig(settings); setConversations(history.conversations);
    } catch (e) { if (alive.current && request.current === version) setError(e.message); }
    finally { if (alive.current && request.current === version) setLoading(false); }
  }
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => {
    const container = transcript.current;
    if (!open || !container) return;
    const reply = [...container.querySelectorAll(".assistant-message.assistant")].at(-1);
    container.scrollTop = pending || !reply ? container.scrollHeight
      : container.scrollTop + reply.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
  }, [open, messages, pending, historyOpen]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, loading]);

  function close() { setOpen(false); requestAnimationFrame(() => launcher.current?.focus()); }
  function fresh() {
    if (sending.current || loading) return;
    setConversationId(null); setMessages([]); setInput(""); setError(""); setHistoryOpen(false); setDeleting(null);
    composer.current?.focus();
  }
  async function selectConversation(id) {
    if (sending.current || loading) return;
    const version = ++request.current;
    setLoading(true); setError("");
    try {
      const result = await api(`/ai/conversations/${encodeURIComponent(id)}`);
      if (!alive.current || request.current !== version) return;
      setMessages(result.messages); setConversationId(id); setInput(""); setHistoryOpen(false); setDeleting(null);
    } catch (e) { if (alive.current && request.current === version) setError(e.message); }
    finally { if (alive.current && request.current === version) setLoading(false); }
  }
  async function removeConversation(id) {
    if (sending.current || loading) return;
    setLoading(true); setError("");
    try {
      await api(`/ai/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!alive.current) return;
      setConversations(current => current.filter(c => c.id !== id));
      if (conversationId === id) { setConversationId(null); setMessages([]); setInput(""); }
      setDeleting(null);
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  }
  async function send(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending.current || loading || !config?.ready) return;
    sending.current = true; setBusy(true); setError(""); setPending(message);
    try {
      const result = await api("/ai/chat", { method: "POST", body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }) });
      if (!alive.current) return;
      setConversationId(result.conversationId); setMessages(result.messages); setInput(""); setPending("");
      const history = await api("/ai/conversations");
      if (alive.current) setConversations(history.conversations);
    } catch (e) { if (alive.current) setError(e.message); }
    finally {
      sending.current = false;
      if (alive.current) { setBusy(false); setPending(""); composer.current?.focus(); }
    }
  }

  if (hidden) return null;
  return <>
    <button ref={launcher} type="button" inert={inactive} className={`assistant-launcher ${open ? "is-open" : ""}`} onClick={() => setOpen(v => !v)} aria-label={open ? "Thu gọn trợ lý AI" : "Mở trợ lý AI"} aria-expanded={open} aria-controls="assistant-panel">
      {open ? <X size={22} /> : <Sparkles size={22} />}<span>Trợ lý AI</span>
    </button>
    {open && <aside ref={panel} inert={inactive} id="assistant-panel" className={`assistant-panel ${expanded ? "is-expanded" : ""}`} aria-label="Trợ lý AI" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <header className="assistant-header">
        <div className="assistant-avatar"><Bot size={23} /></div>
        <div className="assistant-heading"><h2>Trợ lý Nhắc tôi</h2><p>{me.workspace.name}</p></div>
        <button className="icon-button" type="button" disabled={busy || loading} onClick={() => { setHistoryOpen(v => !v); setDeleting(null); }} aria-label="Lịch sử trò chuyện" aria-expanded={historyOpen}><History size={18} /></button>
        <button className="icon-button" type="button" disabled={busy || loading} onClick={fresh} aria-label="Cuộc trò chuyện mới"><Plus size={19} /></button>
        <button className="icon-button assistant-expand" type="button" onClick={() => setExpanded(v => !v)} aria-label={expanded ? "Thu nhỏ cửa sổ chat" : "Mở rộng thành cột bên phải"} title={expanded ? "Trở về cửa sổ nổi" : "Ghim chat ở cột bên phải"} aria-pressed={expanded}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button className="icon-button" type="button" onClick={close} aria-label="Đóng trợ lý AI"><X size={19} /></button>
      </header>
      {historyOpen ? <div className="assistant-history">
        <h3>Cuộc trò chuyện gần đây</h3>
        {!conversations.length && <p className="assistant-muted">Chưa có cuộc trò chuyện nào.</p>}
        {conversations.map(c => <div key={c.id} className={`assistant-history-row ${c.id === conversationId ? "is-active" : ""}`}>
          <button type="button" disabled={loading} className="assistant-history-select" onClick={() => selectConversation(c.id)}><MessageCircle size={17} /><span><strong>{c.title}</strong><small>{new Date(c.updatedAt).toLocaleString("vi-VN")}</small></span></button>
          {deleting === c.id ? <div className="assistant-delete-confirm"><span>Xóa hội thoại này?</span><button type="button" disabled={loading} onClick={() => removeConversation(c.id)}>Xóa</button><button type="button" onClick={() => setDeleting(null)}>Hủy</button></div> : <button type="button" className="icon-button" aria-label={`Xóa hội thoại ${c.title}`} disabled={loading} onClick={() => setDeleting(c.id)}><Trash2 size={16} /></button>}
        </div>)}
      </div> : <div ref={transcript} className="assistant-messages" role="log" aria-label="Nội dung trò chuyện" aria-live="polite" aria-busy={busy || loading}>
        {loading && <p className="assistant-loading"><LoaderCircle size={18} className="spin" /> Đang tải…</p>}
        {!messages.length && !pending && !loading && <div className="assistant-welcome">
          <div className="assistant-welcome-icon"><Sparkles size={30} /></div>
          <span className="assistant-eyebrow">MỘT NGƯỜI CÙNG NHỚ VIỆC</span>
          <h3>Hôm nay, tôi có thể<br />giúp bạn việc gì?</h3>
          <p>Tìm việc cần làm, nắm tiến độ hoặc bắt đầu một công việc mới bằng lời nhắn.</p>
          {config?.ready ? <div className="assistant-prompts">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => { setInput(prompt); composer.current?.focus(); }}>{prompt}<ArrowUpRight size={16} /></button>)}</div> : config && <div className="assistant-setup"><strong>Trợ lý chưa được bật</strong><p>Quản trị viên SaaS cần chọn mô hình và cấu hình khóa API để bắt đầu trò chuyện.</p>{me.user.isPlatformAdmin && <button className="button secondary" type="button" onClick={() => { close(); onSettings(); }}>Cấu hình AI</button>}</div>}
        </div>}
        {messages.map(message => <article key={message.id} className={`assistant-message ${message.role}`}>
          <span className="assistant-message-label">{message.role === "user" ? "Bạn" : "Trợ lý Nhắc tôi"}</span>
          <div className="assistant-message-content">{message.role === "assistant" ? <AssistantMarkdown content={message.content} references={message.references} onOpenTask={onOpenTask} selectedTaskId={selectedTaskId} /> : message.content}</div>
          {message.references?.length > 0 && <div className="assistant-references">
            <span className="assistant-reference-heading">Công việc liên quan <span>{message.references.length}</span></span>
            {message.references.map(ref => <button type="button" key={ref.id} className={ref.id === selectedTaskId ? "is-selected" : undefined} aria-pressed={ref.id === selectedTaskId} onClick={() => onOpenTask(ref)}>
              <span className="assistant-reference-body"><strong>{ref.title}</strong><span className="assistant-reference-meta">
                {taskStatuses[ref.status] && <span className={`assistant-task-status ${ref.status}`}>{taskStatuses[ref.status]}</span>}
                {dueLabel(ref.dueAt) && <span>Hạn: {dueLabel(ref.dueAt)}</span>}
              </span></span><ArrowUpRight size={16} />
            </button>)}
          </div>}
          {message.drafts?.map((draft, index) => <div className="assistant-draft" key={index}><span className="assistant-eyebrow">BẢN NHÁP CÔNG VIỆC</span><strong>{draft.title}</strong>{draft.description && <p>{draft.description}</p>}<small>{new Date(draft.dueAt).toLocaleString("vi-VN")} · Ưu tiên {priorities[draft.priority] || "Trung bình"}</small><button type="button" className="button secondary" onClick={() => { close(); onDraft(draft); }}><Plus size={16} /> Kiểm tra và tạo</button><small>Chỉ được lưu khi bạn xác nhận trong biểu mẫu.</small></div>)}
        </article>)}
        {pending && <><article className="assistant-message user"><span className="assistant-message-label">Bạn</span><div className="assistant-message-content">{pending}</div></article><p className="assistant-loading" role="status"><LoaderCircle size={17} className="spin" /> Đang tìm thông tin và soạn trả lời…</p></>}
      </div>}
      {error && <div className="assistant-error" role="alert"><span>{error}</span>{!config && <button type="button" className="icon-button" aria-label="Thử tải lại trợ lý" onClick={load}><RefreshCw size={16} /></button>}</div>}
      {!historyOpen && <form className="assistant-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="assistant-input">Tin nhắn cho trợ lý AI</label>
        <div className="assistant-input-row"><textarea ref={composer} id="assistant-input" placeholder={config?.ready ? "Nhắn cho trợ lý…" : "Trợ lý đang chờ cấu hình…"} value={input} maxLength={6000} rows={2} disabled={!config?.ready || loading} readOnly={busy} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} /><button type="submit" aria-label="Gửi tin nhắn" disabled={!input.trim() || busy || loading || !config?.ready}>{busy ? <LoaderCircle size={19} className="spin" /> : <Send size={19} />}</button></div>
        <p>Enter để gửi · Shift + Enter xuống dòng</p>
        <small>AI có thể nhầm. Hãy kiểm tra thông tin trước khi sử dụng.</small>
      </form>}
    </aside>}
  </>;
}
