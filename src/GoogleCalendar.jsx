import {useGuardedApi,staleRequest} from './useGuardedApi.js';
import React, {useCallback,useEffect,useState} from 'react';
const labels={personal:'Kế hoạch cá nhân',deadline:'Hạn công việc',appointment:'Lịch hẹn',renewal:'Kỳ gia hạn'};
const states={active:'Đang kết nối',connecting:'Đang kết nối',disconnected:'Đã ngắt kết nối',reconnect:'Cần kết nối lại',needs_review:'Cần kiểm tra lịch đã tạo'};
export default function GoogleCalendar({api:request}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [api,isCurrent]=useGuardedApi(request,e=>{setData(null);setNotice('');setError(e.message);});
  const refresh=useCallback(async()=>{setData(await api('/integrations/google-calendar'));},[api]);
  useEffect(()=>{let live=true;setData(null);setBusy(false);setError('');setNotice('');api('/integrations/google-calendar').then(d=>live&&setData(d)).catch(e=>live&&!staleRequest(e)&&setError(e.message));return()=>{live=false;};},[api]);
  async function action(fn){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){if(!staleRequest(e))setError(e.message);}finally{if(isCurrent())setBusy(false);}}
  const c=data?.connection;
  return <section className="page-section"><h1>Google Calendar</h1>
    <p>Đồng bộ với lịch riêng do Nhắc Tôi tạo. Việc kết nối lịch cần consent riêng với đăng nhập Google.</p>
    {error&&<p role="alert" className="form-error">{error} <button disabled={busy} onClick={()=>void action(async()=>{})}>Tải lại</button></p>}{notice&&<p role="status">{notice}</p>}
 {error&&data&&<p role="status">Thông tin bên dưới là bản đã tải trước đó, chưa đối soát lại sau lỗi.</p>}
    {!data&&!error&&<p role="status">Đang tải kết nối…</p>}
    {data&&!data.configured&&<p role="status">Google Calendar chưa được cấu hình. Liên hệ quản trị hệ thống để bật kết nối.</p>}
    {c&&<><p>Trạng thái: {states[c.status]||c.status}</p>{c.lastSuccessAt&&<p>Đồng bộ thành công gần nhất: {new Date(c.lastSuccessAt).toLocaleString('vi-VN')}</p>}{c.error&&<p role="alert">{c.error}</p>}</>}
    {data?.configured&&<button disabled={busy||['connecting','needs_review'].includes(c?.status)} onClick={()=>void action(async()=>{const r=await api('/integrations/google-calendar/start',{method:'POST',body:'{}'});window.location.assign(r.url);})}>{c?'Kết nối lại Google':'Kết nối Google Calendar'}</button>}
    {c?.status==='active'&&<><fieldset disabled={busy}><legend>Hiển thị trên Google</legend>{Object.entries(labels).map(([kind,label])=><label key={kind}><input type="checkbox" checked={c.enabledKinds.includes(kind)} onChange={e=>void action(()=>api('/integrations/google-calendar',{method:'PATCH',body:JSON.stringify({enabledKinds:e.target.checked?[...c.enabledKinds,kind]:c.enabledKinds.filter(x=>x!==kind)})}))}/>{label}</label>)}</fieldset>
      <p>Hạn công việc hiển thị 15 phút và không đánh dấu bận. Gia hạn chỉ để xem; thay đổi trên Google không thu tiền hoặc gia hạn dịch vụ.</p>
      <button disabled={busy} onClick={()=>void action(async()=>{const r=await api('/integrations/google-calendar/sync',{method:'POST',body:'{}'});setNotice(r.ok?'Đã đối soát lịch.':'Còn thay đổi cần xử lý hoặc đang chờ thử lại.');})}>Đồng bộ ngay</button></>}
    {c&&c.status!=='disconnected'&&<button disabled={busy} onClick={()=>void action(async()=>{const r=await api('/integrations/google-calendar',{method:'DELETE'});setNotice(r.providerRevoked?'Đã dừng đồng bộ. Các sự kiện đã xuất vẫn ở Google.':'Đã dừng đồng bộ; chưa xác nhận thu hồi quyền bên Google.');})}>Ngắt kết nối</button>}
    {(data?.mappings||[]).filter(m=>['conflict','unknown','failed','suppressed'].includes(m.state)).map(m=><article key={m.id} style={{marginTop:16}}><h2>{labels[m.kind]}</h2><p>{m.error||'Liên kết đã bị tắt sau khi xóa ở Google.'}</p>
      {m.conflict&&<><p>Dữ liệu trong Nhắc Tôi</p><pre>{JSON.stringify(m.conflict.server,null,2)}</pre><p>Dữ liệu từ Google</p><pre>{JSON.stringify({start:m.conflict.event?.start,end:m.conflict.event?.end,...(m.kind==='appointment'?{title:m.conflict.event?.summary,description:m.conflict.event?.description}:{})},null,2)}</pre>
        {['local','google'].map(choice=><button key={choice} disabled={busy} onClick={()=>void action(()=>api(`/integrations/google-calendar/mappings/${m.id}/resolve`,{method:'POST',body:JSON.stringify({choice,expectedRevision:m.conflict.revision,expectedEtag:m.conflict.event?.etag||null})}))}>{choice==='local'?'Giữ dữ liệu Nhắc Tôi':'Áp dụng từ Google'}</button>)}</>}
      {['suppressed','failed'].includes(m.state)&&<button disabled={busy} onClick={()=>void action(()=>api(`/integrations/google-calendar/mappings/${m.id}/resolve`,{method:'POST',body:JSON.stringify({choice:'relink'})}))}>Liên kết lại</button>}
    </article>)}
  </section>;
}

export function GoogleCalendarSettings({api:request}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [api,isCurrent]=useGuardedApi(request,e=>{setData(null);setNotice('');setError(e.message);});
  useEffect(()=>{let live=true;setData(null);setBusy(false);setError('');setNotice('');api('/admin/google-calendar').then(d=>live&&setData(d)).catch(e=>live&&!staleRequest(e)&&setError(e.message));return()=>{live=false;};},[api]);
  return <section className="panel settings-card"><h2>Đồng bộ Google Calendar</h2><p>Consent Calendar tách riêng khỏi đăng nhập Google. Chỉ bật sau khi OAuth, callback và tài khoản thử đã được kiểm tra.</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{data&&<form className="settings-editor" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);setBusy(true);setError('');try{await api('/admin/google-calendar',{method:'PUT',body:JSON.stringify({enabled:f.has('enabled'),clientId:f.get('clientId'),clientSecret:f.get('clientSecret'),reason:f.get('reason')})});setData(await api('/admin/google-calendar'));form.elements.clientSecret.value='';setNotice('Đã lưu cấu hình Calendar.');}catch(err){if(!staleRequest(err))setError(err.message);}finally{if(isCurrent())setBusy(false);}}}><fieldset disabled={busy}>
    <label><input type="checkbox" name="enabled" defaultChecked={data.enabled}/>Bật kết nối Calendar</label>
    <label className="field"><span>OAuth Client ID</span><input name="clientId" maxLength={300} defaultValue={data.clientId}/></label>
    <label className="field"><span>Client Secret</span><input name="clientSecret" type="password" autoComplete="new-password" maxLength={1000} placeholder={data.hasSecret?'Đã lưu; để trống để giữ nguyên':'Chưa cấu hình'}/></label>
    <label className="field"><span>Callback cần đăng ký</span><input readOnly value={data.redirectUri}/></label><label className="field"><span>Watch callback HTTPS</span><input readOnly value={data.watchUrl}/></label>
    <label className="field"><span>Lý do thay đổi</span><input name="reason" required minLength={3} maxLength={500}/></label></fieldset><button disabled={busy}>Lưu cấu hình Calendar</button></form>}</section>;
}
