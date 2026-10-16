import { useGuardedApi, staleRequest } from './useGuardedApi.js';
import React, { useEffect, useState } from 'react';

// Template and automation dialogs must be able to select beyond the first page.
export default function TaskPicker({ api: request, label = 'Công việc', value, onChange, projectId, teamId, personal = false, selectedTask = null, disabled = false }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState({tasks:[],total:0,hasMore:false});
  const [selected, setSelected] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [denied,setDenied]=useState(false);
  const [api]=useGuardedApi(request,()=>{setResult({tasks:[],total:0,hasMore:false});setSelected(null);setDenied(true);},`${projectId||''}:${teamId||''}:${personal}`);
  useEffect(() => {
    let active = true; setLoading(true);
    const query = new URLSearchParams({page:String(page),pageSize:'30',q:search,...(projectId?{projectId}:teamId!==undefined?{teamId:teamId||'common'}:{})});
    const timer = setTimeout(() => api(`${personal?'/personal-tasks':'/tasks'}?${query}${personal?'&openOnly=true':''}`).then(data => { if(active){setResult(data);setDenied(false);setError('');} })
      .catch(e=>{if(active&&!staleRequest(e)){setResult({tasks:[],total:0,hasMore:false});setError(e.message);}}).finally(()=>{if(active)setLoading(false);}), 150);
    return()=>{active=false;clearTimeout(timer);};
  },[api,search,page,projectId,teamId,retry,personal]);
  const chosen = selectedTask?.id===value ? selectedTask : selected;
  const options = denied ? [] : chosen?.id===value && !result.tasks.some(t=>t.id===value) ? [chosen,...result.tasks] : result.tasks;
  return <div className="task-extras-field">
    <label>{label}<input aria-label={`Tìm ${label.toLowerCase()}`} value={search} disabled={disabled} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Tìm theo tên công việc"/></label>
    <select aria-label={label} required disabled={disabled || loading || Boolean(error)} value={value} onChange={e=>{setSelected(options.find(t=>t.id===e.target.value)||null);onChange(e.target.value,options.find(t=>t.id===e.target.value)||null);}}>
      <option value="">Chọn công việc</option>{options.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
    </select>
    {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></p>:<small role="status">{loading?'Đang tải…':`${result.total} công việc · Trang ${page}`}</small>}
    <div className="task-picker-pager"><button type="button" className="task-extras-button secondary" disabled={loading||page===1} onClick={()=>setPage(n=>n-1)}>Trước</button><button type="button" className="task-extras-button secondary" disabled={loading||!result.hasMore} onClick={()=>setPage(n=>n+1)}>Tiếp</button></div>
  </div>;
}
