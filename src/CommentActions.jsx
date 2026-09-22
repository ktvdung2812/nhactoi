import React, { useState } from 'react';
import { Pencil, Trash2, Save, X } from 'lucide-react';
import ActionMenu from './ActionMenu.jsx';

export default function CommentActions({item,meta,api,base,disabled,onChanged}) {
 const [edit,setEdit]=useState(false),[confirm,setConfirm]=useState(false),[body,setBody]=useState(item.body),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function act(path,method,value){if(busy||disabled)return;setBusy(true);setError('');try{await api(path,{method,...(value!==undefined?{body:JSON.stringify(value)}:{})});setEdit(false);setConfirm(false);onChanged();}catch(e){setError(e.message)}finally{setBusy(false)}}
 if(!meta)return null;
 const path=`${base}/comments/${encodeURIComponent(item.id)}`;
 return <div className="td-comment-actions">
  {meta.editedAt&&<small>Đã chỉnh sửa</small>}
  <div className="td-reactions">{meta.reactions.map(r=><button key={r.emoji} type="button" className={r.mine?'is-selected':''} aria-label={`Phản ứng ${r.emoji}`} aria-pressed={r.mine} disabled={disabled||busy} onClick={()=>act(`${path}/reaction`,'PUT',{emoji:r.emoji,active:!r.mine})}>{r.emoji}{r.count>0&&<span>{r.count}</span>}</button>)}
   {meta.canEdit&&<ActionMenu label="Thao tác bình luận" disabled={disabled||busy} items={[{label:'Chỉnh sửa',icon:Pencil,onSelect:()=>{setBody(item.body);setEdit(true);setConfirm(false)}},{label:'Xóa bình luận',icon:Trash2,danger:true,onSelect:()=>{setConfirm(true);setEdit(false)}}]}/>}
  </div>
  {edit&&<form onSubmit={e=>{e.preventDefault();act(path,'PATCH',{body})}}><textarea aria-label="Sửa nội dung bình luận" value={body} maxLength={5000} disabled={busy} onChange={e=>setBody(e.target.value)} autoFocus/><div className="td-form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setEdit(false)}><X size={13}/>Hủy</button><button className="button" disabled={busy||(!body.trim()&&!item.attachments?.length)}><Save size={13}/>Lưu</button></div></form>}
  {confirm&&<div className="td-comment-delete" role="alert"><p>Xóa bình luận này? Các tệp vẫn được giữ trong đính kèm công việc.</p><button type="button" className="button secondary" disabled={busy} onClick={()=>setConfirm(false)}>Hủy</button><button type="button" className="button td-danger" disabled={busy} onClick={()=>act(path,'DELETE')}>Xóa bình luận</button></div>}
  {error&&<p className="td-comment-error" role="alert">{error}</p>}
 </div>;
}
