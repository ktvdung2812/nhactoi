import React,{useEffect,useState} from 'react';

export default function OperationsDashboard({api,members=[],teams=[],onOpenTask}) {
  const [data,setData]=useState(null),[projects,setProjects]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [filters,setFilters]=useState({projectId:'',teamId:'',assigneeId:'',status:'',from:'',to:'',group:'all',page:1});
  const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''));
  const path=`/operations-dashboard?${query}`;
  useEffect(()=>{let live=true;api('/projects').then(r=>{if(live)setProjects(r.projects);}).catch(()=>{});return()=>{live=false;};},[api]);
  useEffect(()=>{let live=true;setLoading(true);setData(null);setError('');api(path).then(r=>{if(live)setData(r);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[api,path,refresh]);
  useEffect(()=>{const tick=()=>{if(document.visibilityState!=='hidden')setRefresh(n=>n+1);};const timer=setInterval(tick,30000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick);};},[]);
  const filter=(key,value)=>setFilters(f=>({...f,[key]:value,page:1}));
  const select=(key,label,options)=><label className="field"><span>{label}</span><select value={filters[key]} onChange={e=>filter(key,e.target.value)}><option value="">Tất cả</option>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>;
  return <section className="panel services-panel kit ops-report" aria-label="Báo cáo vận hành">
    <header><h2>Báo cáo vận hành</h2><p>Task và lượt giao được đếm riêng trong phạm vi bạn có quyền xem.</p></header>
    <div className="ops-report-filters">
      {select('projectId','Dự án',projects.map(p=>[p.id,p.name]))}{select('teamId','Đội nhóm',teams.map(t=>[t.id,t.name]))}{select('assigneeId','Người được giao',members.map(m=>[m.id,m.name]))}
      {select('status','Trạng thái',[['todo','Cần làm'],['doing','Đang làm'],['done','Hoàn thành']])}
      <label className="field"><span>Từ ngày đến hạn</span><input type="date" value={filters.from} onChange={e=>filter('from',e.target.value)}/></label>
      <label className="field"><span>Đến ngày đến hạn</span><input type="date" value={filters.to} onChange={e=>filter('to',e.target.value)}/></label>
    </div>
    <div className="ops-report-toolbar">
      <button className="button secondary" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Làm mới báo cáo</button>
      {loading?<p role="status">Đang tính báo cáo…</p>:data&&<p>Cập nhật: {new Date(data.generatedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} (Việt Nam)</p>}
    </div>
    {error&&<p role="alert">{error} · Không có báo cáo mới. Thử làm mới lại.</p>}
    {data&&<>
      <div className="renewal-summary">{[['all','Task',data.summary.taskCount],['overdue','Task quá hạn',data.summary.overdueTaskCount],['unacknowledged','Lượt chưa xác nhận',data.summary.unacknowledgedAssignmentCount],['snoozed','Task đang hoãn',data.summary.snoozedTaskCount]].map(([key,label,value])=><button key={key} aria-pressed={filters.group===key} className="panel renewal-stat" onClick={()=>filter('group',key)}><span>{label}</span><strong>{value}</strong></button>)}</div>
      <p>{data.summary.assignmentCount} lượt giao · {data.summary.completedTaskCount} task hoàn thành</p>
      {data.tasks.length?<ul className="ops-report-list">{data.tasks.map(t=><li key={t.id}><button className="text-button" onClick={()=>onOpenTask(t)}>{t.title}</button> · {t.assignmentCount} lượt giao · {t.unacknowledgedCount} chưa xác nhận{t.overdue?' · Quá hạn':''}{t.snoozedCount?' · Đang hoãn':''}</li>)}</ul>:<p>Không có task phù hợp.</p>}
      <div className="task-pagination"><button className="button secondary" disabled={filters.page===1||loading} onClick={()=>setFilters(f=>({...f,page:f.page-1}))}>Trang trước</button><span role="status">Trang {data.page} · {data.total} task</span><button className="button secondary" disabled={!data.hasMore||loading} onClick={()=>setFilters(f=>({...f,page:f.page+1}))}>Trang sau</button></div>
    </>}
  </section>;
}
