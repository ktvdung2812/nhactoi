import React, { useEffect, useId, useRef, useState } from "react";
import { Bot, LoaderCircle, Save, Search, ChevronDown, Check, CheckCircle2, AlertCircle } from "lucide-react";
import "./ai-settings.css";

function ModelSelect({ models, value, onChange, loading, disabled }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef(null);
  const input = useRef(null);
  const options = value && !models.some(m => m.id === value) ? [{ id: value, name: value }, ...models] : models;
  const filtered = options.filter(m => `${m.name} ${m.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(m => m.id === value);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);
  useEffect(() => { setActive(0); }, [models]);
  function choose(model) { onChange(model.id); setOpen(false); setQuery(""); input.current?.focus(); }
  return <div className="field ai-model-field">
    <label htmlFor={id}>Mô hình</label>
    <input type="hidden" name="model" value={value} />
    <div className="ai-model-select">
      <div className="ai-model-input" onClick={() => { if (!open) { setOpen(true); setQuery(""); setActive(0); } input.current?.focus(); }}>
        <Search size={17} aria-hidden="true" />
        <input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`}
          autoComplete="off" disabled={disabled} value={open ? query : selected?.name || ""} placeholder={loading ? "Đang tải model…" : "Tìm và chọn model…"}
          onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(""); setActive(0); } }}
          onBlur={() => setOpen(false)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={e => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault(); setOpen(true);
              setActive(current => !open ? 0 : Math.max(0, Math.min(filtered.length - 1, current + (e.key === "ArrowDown" ? 1 : -1))));
            }
            if (e.key === "Enter" && open) { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
          }} />
        {loading ? <LoaderCircle size={16} className="spin" /> : <ChevronDown size={16} aria-hidden="true" />}
      </div>
      {open && <div className="ai-model-dropdown">
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Danh sách mô hình">
          {filtered.map((model, index) => <li id={`${id}-option-${index}`} key={model.id} role="option" aria-selected={index === active}
            className={index === active ? "is-active" : ""} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(model)}>
            <span><strong>{model.name}</strong>{model.name !== model.id && <small>{model.id}</small>}</span>{model.id === value && <Check size={16} aria-label="Đang chọn" />}
          </li>)}
        </ul>
        {!filtered.length && <p role="status">{loading ? "Đang tải danh sách model…" : "Không tìm thấy model phù hợp."}</p>}
      </div>}
    </div>
    <small id={`${id}-help`}>{value || "Chọn model trong danh sách để lưu cấu hình."}</small>
  </div>;
}

export default function AiSettings({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState({ models: [], source: "" });
  const [modelsLoading, setModelsLoading] = useState(false);
  useEffect(() => {
    let active = true;
    api("/admin/ai-settings").then(result => { if (active) { setData(result); setProvider(result.provider); setModel(result.model); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    if (!data) return;
    let active = true;
    setModelsLoading(true); setCatalog({ models: [], source: "" });
    api(`/admin/ai-models?provider=${provider}`).then(result => { if (active) setCatalog(result); })
      .catch(() => { if (active) setCatalog({ models: [], source: "error" }); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [api, provider, data]);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (!model) { setError("Vui lòng chọn một mô hình trước khi lưu."); return; }
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api("/admin/ai-settings", { method: "PUT", body: JSON.stringify({
        enabled: form.has("enabled"), provider: form.get("provider"), model: form.get("model").trim(),
        apiKey: form.get("apiKey").trim(), clearApiKey: form.has("clearApiKey"), reason: form.get("reason").trim(),
      }) });
      setData(saved); setProvider(saved.provider); setModel(saved.model);
      setNotice("Đã lưu cấu hình AI và ghi nhật ký quản trị."); setRevision(v => v + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-card" id="ai-settings">
    <div className="settings-card-heading"><div><h2><Bot size={20} /> Trợ lý AI</h2><p>Chat, tìm công việc và soạn bản nháp. Nội dung trao đổi và dữ liệu được tra cứu sẽ được gửi tới nhà cung cấp đã chọn.</p></div></div>
    {data ? <form key={revision} className="settings-editor ai-settings-form" onSubmit={save}>
      {error && <p className="ai-settings-feedback is-error" role="alert"><AlertCircle size={18} />{error}</p>}
      {notice && <p className="ai-settings-feedback" role="status"><CheckCircle2 size={18} />{notice}</p>}
      <fieldset disabled={busy}>
        <label className="settings-check"><input type="checkbox" name="enabled" defaultChecked={data.enabled} /> Bật trợ lý AI</label>
        <div className="form-grid">
          <label className="field"><span>Nhà cung cấp</span><select name="provider" value={provider} onChange={e => { setProvider(e.target.value); setModel(e.target.value === data.provider ? data.model : ""); setCatalog({ models: [], source: "" }); setNotice(""); }}><option value="openrouter">OpenRouter</option><option value="anthropic">Anthropic</option></select></label>
          <ModelSelect key={provider} models={catalog.models} value={model} onChange={value => { setModel(value); setNotice(""); }} loading={modelsLoading} disabled={busy} />
        </div>
        {catalog.source === "fallback" && <p className="ai-catalog-note">Đang dùng danh sách dự phòng. Lưu khóa API đúng nhà cung cấp để tải danh sách đầy đủ; nếu đã lưu, hãy thử lại sau.</p>}
        {catalog.source === "error" && <p className="ai-catalog-note" role="status">Chưa tải được danh sách model. <button type="button" className="text-button" onClick={() => setData(current => ({ ...current }))}>Thử lại</button></p>}
        <label className="field"><span>Khóa API</span><input name="apiKey" type="password" autoComplete="new-password" maxLength={1000} placeholder={data.hasApiKey ? "Đã lưu · để trống để giữ nguyên" : "Chưa thiết lập"} /><small>Khóa được mã hóa trên máy chủ. Khi đổi nhà cung cấp, hãy nhập khóa mới.</small></label>
        <label className="settings-check"><input type="checkbox" name="clearApiKey" /> Xóa khóa API đã lưu</label>
        <label className="field"><span>Lý do thay đổi</span><input name="reason" minLength={3} maxLength={500} required /></label>
      </fieldset>
      <div className="ai-settings-actions"><button className="button primary" type="submit" disabled={busy || !model}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Lưu cấu hình AI</button></div>
    </form> : <p className="settings-summary" role={error ? "alert" : "status"}>{error || "Đang tải cấu hình…"}</p>}
  </section>;
}
