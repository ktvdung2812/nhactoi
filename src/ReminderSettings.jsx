import { useTaskMutation } from './useTaskMutation.js';
import React, {useEffect,useState,useRef} from 'react';
import './reminders.css';
const date=value=>value?new Date(value).toLocaleString('vi-VN'):'Chưa nhận';
const delivery={accepted:'Nhà cung cấp đã chấp nhận',delivered:'Đã chuyển tới người nhận',read:'Người nhận đã đọc',retry:'Chờ thử lại',sending:'Đang gửi',suppressed:'Đã chặn',pending:'Đang chờ',sent:'Nhà cung cấp đã chấp nhận',failed:'Gửi lỗi',skipped:'Đã bỏ qua',unknown:'Chưa rõ kết quả — cần đối soát'};
function Steps({value,onChange,disabled}) {
 return <div className="reminder-steps">{value.map((step,index)=><fieldset key={index} disabled={disabled} className="reminder-step"><legend>Mốc {index+1}</legend>
  <label>Số phút so với hạn<input aria-label={`Số phút mốc ${index+1}`} type="number" min={-43200} max={43200} required value={step.offsetMinutes} onChange={e=>onChange(value.map((s,i)=>i===index?{...s,offsetMinutes:e.target.value===''?'':Number(e.target.value)}:s))}/></label>
  <label>Người nhận<select value={step.audience} onChange={e=>onChange(value.map((s,i)=>i===index?{...s,audience:e.target.value}:s))}><option value="assignees">Người được giao</option><option value="leads">Trưởng nhóm / quản trị việc chung</option></select></label>
  <label>Điều kiện<select value={step.condition} onChange={e=>onChange(value.map((s,i)=>i===index?{...s,condition:e.target.value}:s))}><option value="incomplete">Chưa hoàn thành</option><option value="unacknowledged">Chưa xác nhận nhận việc</option></select></label>
  {value.length>1&&<button type="button" className="button secondary" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Bỏ mốc {index+1}</button>}
 </fieldset>)}<p className="td-muted">Số âm: trước hạn; số dương: sau hạn. Ví dụ −60 là trước 1 giờ, 1440 là sau 1 ngày.</p>
 {value.length<6&&<button type="button" disabled={disabled} className="button secondary" onClick={()=>onChange([...value,{offsetMinutes:1440,audience:'assignees',condition:'incomplete'}])}>Thêm mốc nhắc</button>}</div>;
}
export function ReminderPolicy({api,teamId=null,readOnly=false,onSaved}) {
 const [data,setData]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const path='/reminder-policy'+(teamId?'?teamId='+encodeURIComponent(teamId):'');
 useEffect(()=>{let alive=true;setData(null);setDraft(null);api(path).then(r=>{if(alive){setData(r);setDraft(r.policy);setError('');}}).catch(e=>alive&&setError(e.message));return()=>{alive=false};},[api,path]);
 const disabled=readOnly||!data?.canManage||busy;
 async function save(e){e.preventDefault();if(disabled)return;setBusy(true);setError('');setNotice('');try{const r=await api(path,{method:'PUT',body:JSON.stringify(draft)});setDraft(r.policy);onSaved?.();setNotice('Đã lưu chính sách nhắc. Áp dụng cho các công việc chưa hoàn thành trong phạm vi này.');}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <details className="td-panel reminder-panel"><summary>Chính sách nhắc {teamId?'của team':'cho việc chung'}</summary>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{draft&&<form onSubmit={save}>
 <fieldset disabled={disabled} className="reminder-fields">
 <label className="reminder-check"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Bật chuỗi nhắc nâng cao</label>
 <p>Lịch nhắc riêng của công việc vẫn được giữ. Mỗi mốc gửi một lần/người; hoàn thành công việc sẽ dừng nhắc. Nhắc “chưa nhận việc” dừng với người đã xác nhận.</p>
 <Steps value={draft.steps} onChange={steps=>setDraft({...draft,steps})} disabled={disabled}/>
 <label className="reminder-check"><input type="checkbox" checked={draft.allowMemberOverride} onChange={e=>setDraft({...draft,allowMemberOverride:e.target.checked})}/>Cho thành viên tùy chỉnh chuỗi nhắc từng việc</label>
 <div className="reminder-times"><label>Yên lặng từ (giờ Việt Nam)<input type="time" value={draft.quietStart||''} onChange={e=>setDraft({...draft,quietStart:e.target.value||null})}/></label><label>Đến<input type="time" value={draft.quietEnd||''} onChange={e=>setDraft({...draft,quietEnd:e.target.value||null})}/></label><label>Cách nhau ít nhất (phút)<input type="number" min={15} max={1440} required value={draft.minIntervalMinutes} onChange={e=>setDraft({...draft,minIntervalMinutes:Number(e.target.value)})}/></label></div>
 <p>Giờ yên lặng hoãn nhắc công việc đến lần xử lý tiếp theo ngoài khoảng này. Khoảng cách tối thiểu áp dụng cho các mốc nâng cao của cùng công việc/người; không thay đổi nhắc gia hạn dịch vụ.</p>
 </fieldset>{data.canManage&&!readOnly&&<button className="button" disabled={busy}>{busy?'Đang lưu…':'Lưu chính sách nhắc'}</button>}
 </form>}</details>;
}
export default function TaskReminders({api:request,task,readOnly=false,revision=0,onChanged}) {
 const [data,setData]=useState(null),[draft,setDraft]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[minutes,setMinutes]=useState(60),[reload,setReload]=useState(0);
 const api=useTaskMutation(request,task.id);
 const pending=useRef(false);
 const base=`/tasks/${encodeURIComponent(task.id)}/reminders`;
 useEffect(()=>{let alive=true;setData(null);api(base).then(r=>{if(alive){setData(r);setDraft({enabled:r.effectivePolicy.enabled,steps:r.effectivePolicy.steps});setError('');}}).catch(e=>alive&&setError(e.message));return()=>{alive=false};},[api,base,reload,revision]);
 async function act(path,body,method='POST'){
  if(pending.current||readOnly||task.status==='done')return;
  pending.current=true;setBusy(true);setError('');setNotice('');
  try{await api(path,{method,body:JSON.stringify({...body,...(/\/(acknowledge|snooze)$/.test(path)?{expectedRevision:task.revision}:{})})});setNotice('Đã lưu.');setReload(v=>v+1);await onChanged?.();}catch(e){setError(e.message)}finally{pending.current=false;setBusy(false);}
 }
 const disabled=readOnly||busy||task.status==='done'||!data;
 return <section className="td-panel reminder-panel"><h2>Nhận việc & nhắc lại</h2>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {data&&<><p>Đã đọc thông báo không đồng nghĩa đã nhận việc. Hoãn nhắc chỉ áp dụng cho bạn và giữ nguyên hạn công việc.</p>
 {data.canRespond&&<div className="reminder-actions"><button className="button" disabled={disabled} onClick={()=>act(base+'/acknowledge',{})}>Đã nhận việc</button>
 <label>Nhắc lại sau<select disabled={disabled} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}><option value={15}>15 phút</option><option value={60}>1 giờ</option><option value={240}>4 giờ</option><option value={1440}>1 ngày</option></select></label><button className="button secondary" disabled={disabled} onClick={()=>act(base+'/snooze',{minutes})}>Hoãn nhắc của tôi</button></div>}
 <ul>{data.recipients.map(u=><li key={u.id}><strong>{u.name}</strong>: {u.acknowledged_at?`đã nhận lúc ${date(u.acknowledged_at)}`:'chưa xác nhận'}{u.snoozed_until&&Date.parse(u.snoozed_until)>Date.now()?` · hoãn đến ${date(u.snoozed_until)}`:''}</li>)}</ul>
 <details><summary>Các mốc nhắc nâng cao</summary><p>{data.effectivePolicy.enabled?'Đang bật':'Đang tắt'}. Quản lý cấu hình chính sách tại trang Teams. Với việc chung, cấu hình ở bên dưới.</p>
 {draft&&<form onSubmit={e=>{e.preventDefault();act(base,draft,'PUT')}}><label className="reminder-check"><input type="checkbox" checked={draft.enabled} disabled={disabled||!data.canConfigure} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Bật cho công việc này</label><Steps value={draft.steps} onChange={steps=>setDraft({...draft,steps})} disabled={disabled||!data.canConfigure}/>{data.canConfigure&&<div className="reminder-actions"><button className="button" disabled={disabled}>Lưu mốc riêng</button><button type="button" className="button secondary" disabled={disabled} onClick={()=>act(base,{inherit:true},'PUT')}>Dùng chính sách chung</button></div>}</form>}</details>
 {data.canRespond&&<button className="button secondary" disabled={disabled} onClick={()=>act(base+'/test',{})}>Gửi nhắc thử cho tôi</button>}
 <details><summary>Lịch sử gửi gần nhất ({data.history.length})</summary><p>Nhà cung cấp chấp nhận không đồng nghĩa đã đọc hoặc đã xác nhận nhận việc. FCM “đã bỏ qua” có thể do chưa đăng ký thiết bị. Web Push ghi trạng thái theo từng trình duyệt. Email chờ cần SMTP được cấu hình.</p>{data.history.length?<ul>{data.history.map(h=><li key={h.id}>{date(h.created_at)} · {h.name} · {h.title}<br/>Trong ứng dụng: {h.read_at?'đã đọc':'chưa đọc'} · Email: {delivery[h.email_status]||'Không có'} · FCM: {delivery[h.push_status]||'Không có'} · Web Push: {Object.entries(h.web_push_statuses||{}).map(([status,count])=>`${delivery[status]||status}: ${count}`).join('; ')||'Không có'}{h.email_error&&<span> · {h.email_error}</span>}</li>)}</ul>:<p>Chưa gửi lời nhắc cho công việc này.</p>}{(data.zaloHistory||[]).length>0&&<><h3>Zalo OA</h3><ul>{data.zaloHistory.map(h=><li key={h.id}>{date(h.created_at)} · {h.name||'Người nhận'} · {delivery[h.status]||h.status} · {h.attempts} lượt{h.error&&<span> · {h.error}</span>}</li>)}</ul></>}<button className="button secondary" disabled={disabled} onClick={()=>act(base+'/retry-email',{})}>Thử lại email bị lỗi của tôi</button></details>
 </>}{!task.teamId&&<ReminderPolicy key={task.id} api={api} readOnly={readOnly} onSaved={()=>setReload(v=>v+1)}/>}</section>;
}
