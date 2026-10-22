import React,{useEffect,useRef,useState} from 'react';
import {randomUUID} from 'expo-crypto';
import {router} from 'expo-router';
import {useResource,useSession,refreshData} from '../core/session';
import {errorMessage,ApiError} from '../core/api';
import {pickTextFile} from '../core/files';
import type {Project} from '../core/types';
import {Text,Card,Field,Select,Button,ErrorNotice,Loading} from '../ui/kit';

type Choice={id:string;name:string};
type Metadata={limits:{maxBytes:number;maxRows:number;maxLists:number};users:Choice[];labels:Choice[];columns:(Choice&{status:string})[];fields:(Choice&{type:string;options:Choice[]})[];canWriteStart:boolean};
type Mapping=Record<string,string|Record<string,string>>;
type Draft={source:string;content:string;delimiter:string;dateFormat:string;mapping?:Mapping;userMapping:Record<string,string|null>;labelMapping:Record<string,string|null>;listMapping:Record<string,string>;listStatuses:Record<string,string>;fieldOptionMapping:Record<string,Record<string,string>>};
type Preview={valid:boolean;previewToken:string;headers:string[];suggestedMapping:Mapping;sourceUsers:Choice[];sourceLabels:Choice[];sourceLists:Choice[];summary:{ready:number;skipped:number;failed:number};errors:{row:number;column:string;message:string}[];warnings:{message:string;count:number}[];sample:{line:number;title:string;status:string;dueAt:string|null;skipped:boolean;archived:boolean}[];sampleLimit:number};
type Commit=Draft&{operationId:string;previewToken:string};
type Result={imported:number;skipped:number;failed:number;taskIds:string[]};
const fields:Record<string,string>={title:'Tiêu đề',description:'Mô tả',status:'Trạng thái (todo/doing/done)',priority:'Ưu tiên (low/medium/high)',dueAt:'Hạn',remindAt:'Nhắc lúc',startAt:'Bắt đầu',assignees:'Người được giao (cách bằng |)',labels:'Nhãn (cách bằng |)',column:'Cột',recurrence:'Lặp (none/daily/weekly/monthly/yearly)',recurrenceOptions:'Tùy chọn lặp JSON'};
const initial=():Draft=>({source:'csv',content:'',delimiter:',',dateFormat:'iso',userMapping:{},labelMapping:{},listMapping:{},listStatuses:{},fieldOptionMapping:{}});
export function ProjectImport({project}:{project:Project}){
  const{api,online,writable}=useSession(),base=`/projects/${project.id}/import`;
  const[open,setOpen]=useState(false),[draft,setDraft]=useState<Draft>(initial),[analysis,setAnalysis]=useState<Preview|null>(null),[preview,setPreview]=useState<Preview|null>(null);
  const[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Commit|null>(null),[result,setResult]=useState<Result|null>(null),[unknown,setUnknown]=useState(false),[editContent,setEditContent]=useState(false);
  const running=useRef(false),live=useRef(true);
  const options=useResource<Metadata>(base,open&&project.canEdit&&online),meta=options.error?undefined:options.data?.value;
  const disabled=busy||!!pending||!online||!writable||!project.canEdit||!meta;
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  function update(next:Partial<Draft>){setDraft(old=>({...old,...next}));setPreview(null);setResult(null);setError('');}
  async function inspect(body=draft){if(running.current||!online||!writable||!project.canEdit)return;running.current=true;setBusy(true);setError('');try{const p=await api<Preview>(base+'/preview',{method:'POST',body:JSON.stringify(body)});if(live.current){setAnalysis(p);setPreview(p);}}catch(e){if(live.current)setError(errorMessage(e));}finally{running.current=false;if(live.current)setBusy(false);}}
  async function pick(){if(disabled||!meta)return;setPreview(null);try{const file=await pickTextFile(meta.limits.maxBytes);if(!file||!live.current)return;const next={...initial(),source:draft.source,content:file.content};setName(file.name);setDraft(next);setAnalysis(null);setPreview(null);setResult(null);await inspect(next);}catch(e){if(live.current)setError(errorMessage(e));}}
  async function commit(){if(running.current||!online||!writable||!project.canEdit||!pending&&!preview?.valid)return;running.current=true;setBusy(true);setError('');const body=pending||{...draft,previewToken:preview!.previewToken,operationId:randomUUID()};setPending(body);
    try{const value=await api<Result>(base+'/commit',{method:'POST',body:JSON.stringify(body)});if(!live.current)return;setResult(value);setPending(null);setUnknown(false);setPreview(null);try{await refreshData();}catch(e){if(live.current)setError('Đã nhập lô; chưa làm mới danh sách: '+errorMessage(e));}}
    catch(e){if(!live.current)return;setError(errorMessage(e));if(!unknown&&e instanceof ApiError&&[400,403,404,409,413,422].includes(e.status)){setPending(null);setUnknown(false);setPreview(null);}else setUnknown(true);}
    finally{running.current=false;if(live.current)setBusy(false);}
  }
  const mapping=draft.mapping||analysis?.suggestedMapping||{},headers=analysis?.headers||[],custom=(typeof mapping.customFields==='object'?mapping.customFields:{});
  function mapColumn(key:string,value:string){const next={...mapping};if(value)next[key]=value;else delete next[key];update({mapping:next});}
  return <Card><Button label={open?'Đóng nhập CSV / Trello':'Nhập CSV / Trello vào dự án'} secondary onPress={()=>setOpen(!open)}/>{open&&<>
    <Text>Preview chưa ghi dữ liệu. CSV tạo lô mới; Trello bỏ qua card nguồn đã nhập. JSON v1 giữ append ở luồng dữ liệu bảng.</Text>
    {!online&&<Text>Import cần mạng; không đưa lô nhập vào queue task offline.</Text>}
    {!project.canEdit&&<Text>Cần quyền chỉnh sửa dự án.</Text>}
    {options.isPending&&online&&project.canEdit&&<Loading/>}<ErrorNotice message={error||(options.error?errorMessage(options.error):'')}/>
    {meta&&<Text>Tối đa {meta.limits.maxBytes} byte/tệp, {meta.limits.maxRows} task, {meta.limits.maxLists} list. Request JSON tối đa 1 MiB. Hạn cần đủ giờ và timezone, ví dụ 2028-02-29T09:00+07:00.</Text>}
    <Select label="Nguồn nhập" value={draft.source} disabled={disabled} options={[{value:'csv',label:'CSV UTF-8'},{value:'trello',label:'Trello JSON'}]} onChange={value=>{setDraft({...initial(),source:value});setAnalysis(null);setPreview(null);setResult(null);setName('');}}/>
    <Button label="Chọn tệp nhập" disabled={disabled} onPress={()=>void pick()}/>{name&&<Text>Tệp: {name}</Text>}
    {draft.source==='csv'&&<Select label="Dấu phân cách" value={draft.delimiter} disabled={disabled} options={[{value:',',label:'Dấu phẩy'},{value:';',label:'Chấm phẩy'},{value:'\t',label:'Tab'}]} onChange={value=>{update({delimiter:value,mapping:undefined});setAnalysis(null);}}/>}
    <Select label="Định dạng ngày" value={draft.dateFormat} disabled={disabled} options={[{value:'iso',label:'YYYY-MM-DD'},{value:'dmy',label:'dd/MM/yyyy'},{value:'mdy',label:'MM/dd/yyyy'}]} onChange={value=>update({dateFormat:value})}/>
    {!!draft.content&&<Button label={editContent?'Ẩn nội dung tệp':'Sửa nội dung tệp'} secondary disabled={disabled} onPress={()=>setEditContent(!editContent)}/>}
    {editContent&&<Field label="Nội dung tệp nhập" value={draft.content} editable={!disabled} multiline onChangeText={content=>update({content})}/>}
    {draft.source==='csv'&&headers.length>0&&<>
      {Object.entries(fields).filter(([key])=>key!=='startAt'||meta?.canWriteStart).map(([key,label])=><Select key={key} label={'Header: '+label} value={String(mapping[key]||'')} disabled={disabled} options={[{value:'',label:key==='title'?'Chọn cột bắt buộc':'Không nhập'},...headers.map(h=>({value:h,label:h}))]} onChange={value=>mapColumn(key,value)}/>)}
      {meta?.fields.map(f=><Card key={f.id}><Select label={`Header: ${f.name} (${f.type})`} value={custom[f.id]||''} disabled={disabled} options={[{value:'',label:'Không nhập'},...headers.map(h=>({value:h,label:h}))]} onChange={value=>{const next={...custom};if(value)next[f.id]=value;else delete next[f.id];update({mapping:{...mapping,customFields:next}});}}/>
        {custom[f.id]&&f.options.map(o=><Field key={o.id} label={`Giá trị nguồn cho ${o.name}`} value={Object.entries(draft.fieldOptionMapping[f.id]||{}).find(([,v])=>v===o.id)?.[0]||''} editable={!disabled} placeholder="Để trống nếu tệp dùng ID option" onChangeText={value=>{const next=Object.fromEntries(Object.entries(draft.fieldOptionMapping[f.id]||{}).filter(([,v])=>v!==o.id));if(value)next[value]=o.id;update({fieldOptionMapping:{...draft.fieldOptionMapping,[f.id]:next}});}}/>)}</Card>)}
    </>}
    {analysis?.sourceUsers.map(u=><Select key={u.id} label={'Người nguồn: '+u.name} value={Object.hasOwn(draft.userMapping,u.id)?draft.userMapping[u.id]??'__skip':''} disabled={disabled} options={[{value:'',label:'Cần chọn mapping'},{value:'__skip',label:'Bỏ gán'},...(meta?.users||[]).map(p=>({value:p.id,label:p.name}))]} onChange={value=>update({userMapping:{...draft.userMapping,[u.id]:value==='__skip'?null:value}})}/>)}
    {analysis?.sourceLabels.map(l=><Select key={l.id} label={'Nhãn nguồn: '+l.name} value={Object.hasOwn(draft.labelMapping,l.id)?draft.labelMapping[l.id]??'__skip':''} disabled={disabled} options={[{value:'',label:draft.source==='trello'?'Giữ mapping nguồn / tạo nhãn mới':'Cần chọn mapping'},{value:'__skip',label:'Bỏ nhãn'},...(meta?.labels||[]).map(p=>({value:p.id,label:p.name}))]} onChange={value=>{const next={...draft.labelMapping};if(value==='')delete next[l.id];else next[l.id]=value==='__skip'?null:value;update({labelMapping:next});}}/>)}
    {analysis?.sourceLists.map(l=><Card key={l.id}><Select label={`Cột nguồn: ${l.name} · ${l.id}`} value={draft.listMapping[l.id]||''} disabled={disabled} options={[{value:'',label:draft.source==='trello'?'Giữ mapping nguồn / tạo cột mới':'Cần chọn cột'},...(meta?.columns||[]).map(c=>({value:c.id,label:`${c.name} (${c.status})`}))]} onChange={value=>{const col=meta?.columns.find(c=>c.id===value);update({listMapping:{...draft.listMapping,[l.id]:value},...(draft.source==='trello'&&col?{listStatuses:{...draft.listStatuses,[l.id]:col.status}}:{})});}}/>
      {draft.source==='trello'&&<Select label={'Trạng thái list '+l.name} value={draft.listStatuses[l.id]||'todo'} disabled={disabled} options={[{value:'todo',label:'Chưa làm'},{value:'doing',label:'Đang làm'},{value:'done',label:'Hoàn thành'}]} onChange={value=>update({listStatuses:{...draft.listStatuses,[l.id]:value}})}/>}</Card>)}
    <Button label="Xem trước lô nhập" disabled={disabled||!draft.content} onPress={()=>void inspect()}/>
    {busy&&<Text accessibilityLiveRegion="polite">Đang xử lý lô nhập…</Text>}
    {preview&&<><Text>Dự kiến {preview.summary.ready} task mới, {preview.summary.skipped} nguồn bỏ qua, {preview.summary.failed} dòng lỗi. Chưa ghi dữ liệu.</Text>{preview.errors.slice(0,50).map((e,i)=><ErrorNotice key={i} message={`Dòng ${e.row}, cột ${e.column}: ${e.message}`}/>)}{preview.errors.length>50&&<Text>Còn {preview.errors.length-50} lỗi; sửa rồi xem trước lại.</Text>}{preview.warnings.map((w,i)=><Text key={i}>{w.message}: {w.count}</Text>)}{preview.sample.map((t,i)=><Text key={i}>{t.title} · {t.skipped?'Bỏ qua':t.archived?'Lưu trữ':t.status} {t.dueAt||''}</Text>)}<Text>Hiển thị tối đa {preview.sampleLimit} task mẫu.</Text>{preview.valid&&!result&&<Button label="Xác nhận nhập lô" disabled={disabled} onPress={()=>void commit()}/>}</>}
    {unknown&&<Text accessibilityLiveRegion="polite">Chưa xác định kết quả. Lô có thể đã nhập; giữ nguyên mã lô để đối soát.</Text>}
    {pending&&<Button label="Đối soát / thử lại cùng lô" disabled={busy||!online||!writable||!project.canEdit} onPress={()=>void commit()}/>}
    {result&&<><Text accessibilityLiveRegion="polite">Đã nhập {result.imported}, bỏ qua {result.skipped}, lỗi {result.failed}.</Text>{result.taskIds.slice(0,20).map(id=><Button key={id} label={'Mở task '+id} secondary onPress={()=>router.push({pathname:'/task/[id]',params:{id}})}/>)}</>}
  </>}</Card>;
}
