import React, { useEffect, useState } from 'react';
import ProjectAdvanced from './ProjectAdvanced.jsx';
import ProjectImport from './ProjectImport.jsx';
const roles = { viewer: 'Chỉ xem', commenter: 'Bình luận', editor: 'Chỉnh sửa', manager: 'Quản lý' };
export default function Projects({ api, me, teams = [], onOpenTask, onChanged }) {
  const [projects,setProjects]=useState([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null);
  const [name,setName]=useState(''),[mode,setMode]=useState('workspace'),[team,setTeam]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('viewer'),[invite,setInvite]=useState('');
  const [people,setPeople]=useState([]),[person,setPerson]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
  const admin=['owner','admin'].includes(me.user.role), guest=me.user.memberType==='guest';
  useEffect(()=>{let live=true;setDetail(old=>old?.project.id===selected?old:null);setError('');
    Promise.all([api('/projects'),selected?api(`/projects/${selected}`):null,guest?null:api('/members')])
      .then(([list,d,m])=>{if(live){setProjects(list.projects);setDetail(d);setPeople(m?.members||[]);}}).catch(e=>{if(live){setDetail(null);setError(e.message);}});
    return()=>{live=false;};},[api,selected,version,guest]);
  useEffect(()=>{const update=()=>setVersion(v=>v+1);const timer=setInterval(update,30000);window.addEventListener("focus",update);return()=>{clearInterval(timer);window.removeEventListener("focus",update);};},[]);
  async function change(fn){setBusy(true);setError('');try{await fn();setVersion(v=>v+1);await onChanged?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const project=detail?.project;
  return <section className="page-section">
    <h1>Dự án</h1><p>Owner và admin của doanh nghiệp có quyền truy cập mọi dự án, kể cả dự án riêng tư.</p>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <label>Dự án<select aria-label="Dự án" value={selected} onChange={e=>{setSelected(e.target.value);setInvite('');}}><option value="">Chọn dự án</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}{p.readonly?' · Chỉ đọc':''}</option>)}</select></label>
    {admin&&!guest&&<form onSubmit={e=>{e.preventDefault();void change(async()=>{const r=await api('/projects',{method:'POST',body:JSON.stringify({name,accessMode:mode,teamId:mode==='team'?team:null})});setSelected(r.project.id);setName('');});}}>
      <h2>Tạo dự án</h2><label>Tên dự án<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Phạm vi<select value={mode} onChange={e=>setMode(e.target.value)}><option value="workspace">Kế thừa doanh nghiệp</option><option value="team">Kế thừa team</option><option value="private">Riêng tư</option></select></label>
      {mode==='team'&&<label>Team<select required value={team} onChange={e=>setTeam(e.target.value)}><option value="">Chọn team</option>{teams.filter(t=>!t.archivedAt).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <button disabled={busy} className="button">Tạo dự án</button>
    </form>}
    {project&&<><h2>{project.name}</h2><p>Vai trò: {roles[project.myRole]}{project.readonly?' · Chỉ đọc':''}</p>
      <h3>Thành viên</h3><ul>{detail.members.map(m=><li key={m.id}>{m.name}{m.memberType==='guest'?' (khách)':''} · {roles[m.role]}
        {project.canManage&&<><select aria-label={`Vai trò ${m.name}`} disabled={busy} value={m.directRole||m.role} onChange={e=>void change(()=>api(`/projects/${selected}/members/${m.id}`,{method:'PUT',body:JSON.stringify({role:e.target.value})}))}>{Object.entries(roles).filter(([id])=>m.memberType!=='guest'||id!=='manager').map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
          {m.directRole&&<button disabled={busy} onClick={()=>void change(()=>api(`/projects/${selected}/members/${m.id}`,{method:'DELETE'}))}>Bỏ quyền trực tiếp</button>}</>}
      </li>)}</ul>
      {project.canManage&&<><form onSubmit={e=>{e.preventDefault();void change(()=>api(`/projects/${selected}/members/${person}`,{method:'PUT',body:JSON.stringify({role:'editor'})}));}}><label>Thêm nhân sự<select required value={person} onChange={e=>setPerson(e.target.value)}><option value="">Chọn nhân sự</option>{people.filter(m=>!detail.members.some(x=>x.id===m.id)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button disabled={busy||!person}>Thêm vào dự án</button></form>
        {admin&&me.workspace.kind!=='personal'&&<form onSubmit={e=>{e.preventDefault();void change(async()=>{const r=await api('/invitations',{method:'POST',body:JSON.stringify({email,memberType:'guest',projectId:selected,projectRole:role})});setInvite(r.inviteUrl);});}}><h3>Mời khách ngoài</h3><p>Khách dùng một ghế doanh nghiệp, chỉ truy cập dự án được cấp.</p><label>Email khách<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Quyền khách<select value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roles).filter(([id])=>id!=='manager').map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button disabled={busy||!me.subscription?.capabilities?.includes('guests')}>Tạo liên kết mời</button></form>}
        {invite&&<label>Liên kết mời<input readOnly value={invite} onFocus={e=>e.target.select()}/></label>}
      </>}
      <ProjectImport key={project.id+'-import'} api={api} project={project} onChanged={onChanged} onOpenTask={onOpenTask}/>
      <ProjectAdvanced key={project.id} api={api} project={project} members={detail.members} onOpenTask={onOpenTask} onChanged={onChanged}/>
    </>}
  </section>;
}
