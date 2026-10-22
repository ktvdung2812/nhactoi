import React,{useEffect,useRef,useState} from 'react';

const fields={title:'Tiêu đề',description:'Mô tả',status:'Trạng thái (todo/doing/done)',priority:'Ưu tiên (low/medium/high)',dueAt:'Hạn',remindAt:'Nhắc lúc',startAt:'Bắt đầu',assignees:'Người được giao (cách bằng |)',labels:'Nhãn (cách bằng |)',column:'Cột',recurrence:'Lặp (none/daily/weekly/monthly/yearly)',recurrenceOptions:'Tùy chọn lặp JSON'};
const initial=()=>({source:'csv',content:'',delimiter:',',dateFormat:'iso',userMapping:{},labelMapping:{},listMapping:{},listStatuses:{},fieldOptionMapping:{}});
export default function ProjectImport({api,project,onChanged,onOpenTask}){
  const [open,setOpen]=useState(false),[meta,setMeta]=useState(null),[draft,setDraft]=useState(initial),[analysis,setAnalysis]=useState(null),[preview,setPreview]=useState(null);
  const [name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[result,setResult]=useState(null),[unknown,setUnknown]=useState(false);
  const running=useRef(false),live=useRef(true),base=`/projects/${project.id}/import`;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;if(open&&project.canEdit)api(base).then(value=>active&&setMeta(value)).catch(e=>active&&setError(e.message));return()=>{active=false;};},[open,api,base,project.canEdit]);
  function update(next){setDraft(old=>({...old,...next}));setPreview(null);setResult(null);setError('');}
  function map(group,key,value){update({[group]:{...draft[group],[key]:value}});}
  async function inspect(body=draft){if(running.current)return;running.current=true;setBusy(true);setError('');try{const p=await api(base+'/preview',{method:'POST',body:JSON.stringify(body)});if(live.current){setAnalysis(p);setPreview(p);}}catch(e){if(live.current)setError(e.message);}finally{running.current=false;if(live.current)setBusy(false);}}
  async function commit(){if(running.current)return;running.current=true;setBusy(true);setError('');const body=pending||{...draft,previewToken:preview.previewToken,operationId:crypto.randomUUID()};setPending(body);
    try{const value=await api(base+'/commit',{method:'POST',body:JSON.stringify(body)});if(!live.current)return;setResult(value);setPending(null);setUnknown(false);setPreview(null);try{await onChanged?.();}catch(e){if(live.current)setError('Đã nhập lô; chưa làm mới được danh sách: '+e.message);}}
    catch(e){if(!live.current)return;setError(e.message);if(!unknown&&[400,403,404,409,413,422].includes(e.status)){setPending(null);setUnknown(false);setPreview(null);}else setUnknown(true);}
    finally{running.current=false;if(live.current)setBusy(false);}
  }
  const mapping=draft.mapping||analysis?.suggestedMapping||{},headers=analysis?.headers||[];
  function mapColumn(key,value){const next={...mapping};if(value)next[key]=value;else delete next[key];update({mapping:next});}
  return <details className="td-panel kit project-import" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Nhập CSV / Trello vào dự án</summary>
    {!project.canEdit?<p>Cần quyền chỉnh sửa và kết nối mạng để nhập dữ liệu.</p>:<>
      <p>Preview chưa nhập dữ liệu. CSV là lô mới mỗi lần xác nhận; Trello bỏ qua card nguồn đã nhập. JSON v1 vẫn dùng luồng dữ liệu bảng hiện có.</p>
      {meta&&<p>Tối đa {meta.limits.maxBytes.toLocaleString('vi-VN')} byte/tệp, {meta.limits.maxRows} task, {meta.limits.maxLists} list; request JSON tối đa 1 MiB. Ngày deadline cần đủ giờ và timezone; không tự chọn giờ.</p>}
      <fieldset disabled={busy||!!pending||!meta}><legend>Nguồn và mapping</legend>
        <label>Nguồn nhập<select value={draft.source} onChange={e=>{setDraft({...initial(),source:e.target.value});setAnalysis(null);setPreview(null);setResult(null);setName('');}}><option value="csv">CSV UTF-8</option><option value="trello">Trello JSON</option></select></label>
        <label>Chọn tệp<input type="file" accept={draft.source==='csv'?'.csv,text/csv':'.json,application/json'} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setError('');setPreview(null);try{if(file.size>meta.limits.maxBytes)throw new Error('Tệp vượt giới hạn đã công bố');const content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(!live.current)return;const next={...initial(),source:draft.source,content};setName(file.name);setDraft(next);setAnalysis(null);setPreview(null);setResult(null);await inspect(next);}catch(e){setError(e.message);}}}/></label>
        {name&&<p>Tệp: {name}</p>}
        {draft.source==='csv'&&<label>Dấu phân cách<select value={draft.delimiter} onChange={e=>{update({delimiter:e.target.value,mapping:undefined});setAnalysis(null);}}><option value=",">Dấu phẩy</option><option value=";">Chấm phẩy</option><option value={'\t'}>Tab</option></select></label>}
        <label>Định dạng ngày<select value={draft.dateFormat} onChange={e=>update({dateFormat:e.target.value})}><option value="iso">YYYY-MM-DD</option><option value="dmy">dd/MM/yyyy</option><option value="mdy">MM/dd/yyyy</option></select></label>
        {draft.content&&<details><summary>Sửa nội dung tệp</summary><textarea aria-label="Nội dung tệp nhập" rows={8} value={draft.content} onChange={e=>update({content:e.target.value})}/></details>}
        {draft.source==='csv'&&headers.length>0&&<><h3>Map header</h3>{Object.entries(fields).filter(([key])=>key!=='startAt'||meta?.canWriteStart).map(([key,label])=><label key={key}>{label}<select value={mapping[key]||''} onChange={e=>mapColumn(key,e.target.value)}><option value="">{key==='title'?'Chọn cột bắt buộc':'Không nhập'}</option>{headers.map(h=><option key={h} value={h}>{h}</option>)}</select></label>)}
          {(meta?.fields||[]).map(f=><div key={f.id}><label>{f.name} ({f.type})<select value={mapping.customFields?.[f.id]||''} onChange={e=>{const custom={...mapping.customFields};if(e.target.value)custom[f.id]=e.target.value;else delete custom[f.id];update({mapping:{...mapping,customFields:custom}});}}><option value="">Không nhập</option>{headers.map(h=><option key={h} value={h}>{h}</option>)}</select></label>
            {mapping.customFields?.[f.id]&&f.options.map(o=><label key={o.id}>Giá trị nguồn cho {o.name}<input placeholder="Để trống nếu tệp đã dùng ID option" value={Object.entries(draft.fieldOptionMapping[f.id]||{}).find(([,v])=>v===o.id)?.[0]||''} onChange={e=>{const options=Object.fromEntries(Object.entries(draft.fieldOptionMapping[f.id]||{}).filter(([,v])=>v!==o.id));if(e.target.value)options[e.target.value]=o.id;map('fieldOptionMapping',f.id,options);}}/></label>)}</div>)}
        </>}
        {(analysis?.sourceUsers||[]).map(u=><label key={u.id}>Người nguồn: {u.name}<select value={Object.hasOwn(draft.userMapping,u.id)?draft.userMapping[u.id]??'__skip':''} onChange={e=>map('userMapping',u.id,e.target.value==='__skip'?null:e.target.value)}><option value="">Cần chọn mapping</option><option value="__skip">Bỏ gán</option>{meta?.users.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
        {(analysis?.sourceLabels||[]).map(l=><label key={l.id}>Nhãn nguồn: {l.name}<select value={Object.hasOwn(draft.labelMapping,l.id)?draft.labelMapping[l.id]??'__skip':''} onChange={e=>{const next={...draft.labelMapping};if(e.target.value==='')delete next[l.id];else next[l.id]=e.target.value==='__skip'?null:e.target.value;update({labelMapping:next});}}><option value="">{draft.source==='trello'?'Giữ mapping nguồn / tạo nhãn mới':'Cần chọn mapping'}</option><option value="__skip">Bỏ nhãn</option>{meta?.labels.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
        {(analysis?.sourceLists||[]).map(l=><div key={l.id}><label>Cột nguồn: {l.name} · {l.id}<select value={draft.listMapping[l.id]||''} onChange={e=>{const target=meta.columns.find(c=>c.id===e.target.value);update({listMapping:{...draft.listMapping,[l.id]:e.target.value},...(draft.source==='trello'&&target?{listStatuses:{...draft.listStatuses,[l.id]:target.status}}:{})});}}><option value="">{draft.source==='trello'?'Giữ mapping nguồn / tạo cột mới':'Cần chọn cột'}</option>{meta?.columns.map(c=><option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}</select></label>{draft.source==='trello'&&<label>Trạng thái list {l.name}<select value={draft.listStatuses[l.id]||'todo'} onChange={e=>map('listStatuses',l.id,e.target.value)}><option value="todo">Chưa làm</option><option value="doing">Đang làm</option><option value="done">Hoàn thành</option></select></label>}</div>)}
        <button type="button" disabled={!draft.content} onClick={()=>void inspect()}>Xem trước lô nhập</button>
      </fieldset>
      {busy&&<p role="status">Đang xử lý lô nhập…</p>}
      {error&&<p role="alert">{error}</p>}
      {preview&&<><p>Dự kiến: {preview.summary.ready} task mới, {preview.summary.skipped} nguồn bỏ qua, {preview.summary.failed} dòng có lỗi. Chưa ghi dữ liệu.</p>
        {preview.errors.slice(0,50).map((e,i)=><p role="alert" key={i}>Dòng {e.row}, cột {e.column}: {e.message}</p>)}{preview.errors.length>50&&<p>Còn {preview.errors.length-50} lỗi; sửa các lỗi trên rồi preview lại.</p>}
        {preview.warnings.map((w,i)=><p key={i}>{w.message}: {w.count}</p>)}
        <ol>{preview.sample.map((t,i)=><li key={i}>{t.title} · {t.skipped?'Bỏ qua':t.archived?'Lưu trữ':t.status} {t.dueAt||''}</li>)}</ol><p>Hiển thị tối đa {preview.sampleLimit} task mẫu.</p>
        {preview.valid&&!result&&<button type="button" disabled={busy||!!pending} onClick={()=>void commit()}>Xác nhận nhập lô</button>}
      </>}
      {unknown&&<p role="status">Chưa xác định kết quả. Lô có thể đã nhập; giữ nguyên mã lô để đối soát, không tạo lô khác.</p>}
      {pending&&!busy&&<button type="button" onClick={()=>void commit()}>Đối soát / thử lại cùng lô</button>}
      {result&&<div role="status"><p>Đã nhập {result.imported}, bỏ qua {result.skipped}, lỗi {result.failed}.</p>{result.taskIds.slice(0,20).map(id=><button key={id} type="button" onClick={()=>onOpenTask?.(id)}>Mở task {id}</button>)}</div>}
    </>}
  </details>;
}
