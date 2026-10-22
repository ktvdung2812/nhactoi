import React,{useEffect,useState} from 'react';
import {AppState} from 'react-native';
import {router} from 'expo-router';
import {useResource,useSession,refreshData} from '../core/session';
import {errorMessage} from '../core/api';
import {FormPage,Text,Field,Button,Select,Card,Loading,ErrorNotice} from '../ui/kit';
import type {Project} from '../core/types';
const scopes=['projects:read','tasks:read','tasks:write','customers:read','services:read'];
type Token={id:string;name:string;scopes:string[];revokedAt:string|null};
type Hook={id:string;name:string;url:string;active:boolean;keyVersion:number};
type Delivery={id:string;event_id:string;state:string;attempt_count:number;manual_retries:number;last_error:string|null};
type History={deliveries:Delivery[];total:number;page:number};
export function PublicIntegrations(){const {session}=useSession();return <PublicIntegrationsBody key={(session?.workspace.id||'')+':'+(session?.user.id||'')}/>;}
function PublicIntegrationsBody(){
 const {api,session,online,writable}=useSession(),admin=['owner','admin'].includes(session?.user.role||'');
 const tokens=useResource<{tokens:Token[]}>('/api-tokens'),projects=useResource<{projects:Project[]}>('/projects'),hooks=useResource<{subscriptions:Hook[];eventTypes:string[]}>('/webhooks',admin);
 const [name,setName]=useState(''),[hookName,setHookName]=useState(''),[url,setUrl]=useState(''),[projectId,setProject]=useState(''),[selected,setSelected]=useState(['projects:read','tasks:read']),[events,setEvents]=useState(['task.created']);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[secret,setSecret]=useState(''),[shown,setShown]=useState(false),[history,setHistory]=useState<(History&{id:string})|null>(null);
 const premium=!!session?.subscription.capabilities?.includes('public_api'),disabled=busy||!online||!!tokens.data?.cached,createDisabled=disabled||!writable||!premium;
 useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state!=='active'){setSecret('');setShown(false);}});return()=>listener.remove();},[]);
 async function act(fn:()=>Promise<unknown>){if(disabled)return;setBusy(true);setError('');try{await fn();await refreshData();await tokens.refetch();if(admin)await hooks.refetch();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const options=[{value:'',label:'Mọi dự án được quyền'},...(projects.data?.value.projects||[]).map(p=>({value:p.id,label:p.name}))];
 return <FormPage title="API và webhook" onBack={()=>router.back()}>
  <Text>Quyền kết nối giao với quyền hiện tại của người tạo và gói doanh nghiệp. API: 120 yêu cầu/token/phút.</Text>
  {!online&&<Text>Đang offline. Không thể tạo, thu hồi hoặc thay đổi kết nối.</Text>}{tokens.data?.cached&&<Text>Danh sách đã lưu, chưa đối soát quyền mới.</Text>}
  <ErrorNotice message={error||(tokens.error?errorMessage(tokens.error):'')||(hooks.error?errorMessage(hooks.error):'')}/>{tokens.isPending&&<Loading/>}
  {!!secret&&<Card><Text>Khóa chỉ hiển thị một lần. Lưu ở nơi quản lý bí mật trước khi rời màn hình.</Text>{shown?<Text selectable>{secret}</Text>:<Text>••••••••••••••••</Text>}<Button label={shown?'Ẩn nội dung khóa':'Hiện khóa để sao chép'} secondary onPress={()=>setShown(!shown)}/><Button label="Đã lưu, xóa khóa khỏi màn hình" secondary onPress={()=>{setSecret('');setShown(false);}}/></Card>}
  <Card><Text>API token của tôi</Text><Field label="Tên token" value={name} onChangeText={setName}/><Select label="Phạm vi dự án" value={projectId} onChange={setProject} options={options} disabled={createDisabled}/>
   {scopes.map(scope=><Select key={scope} label={scope} value={selected.includes(scope)?'yes':'no'} options={[{value:'yes',label:'Cho phép'},{value:'no',label:'Không cấp'}]} disabled={createDisabled} onChange={v=>setSelected(v==='yes'?[...selected,scope]:selected.filter(s=>s!==scope))}/>)}
   <Text>Scope khách hàng/dịch vụ cần token phạm vi doanh nghiệp riêng.</Text><Button label="Tạo token" disabled={createDisabled||!name.trim()||!selected.length} onPress={()=>void act(async()=>{const r=await api<{rawToken:string}>('/api-tokens',{method:'POST',body:JSON.stringify({name,scopes:selected,projectIds:projectId?[projectId]:[]})});setSecret(r.rawToken);setShown(false);setName('');})}/>
   {!premium&&<Text>Gói hiện tại không cấp public API; vẫn có thể thu hồi token cũ.</Text>}
  </Card>
  {tokens.data?.value.tokens.map(t=><Card key={t.id}><Text>{t.name} · {t.revokedAt?'Đã thu hồi':'Chưa thu hồi'}</Text><Text>{t.scopes.join(', ')}</Text>{!t.revokedAt&&<Button label={'Thu hồi '+t.name} disabled={disabled} onPress={()=>void act(()=>api('/api-tokens/'+t.id,{method:'DELETE'}))}/>}</Card>)}
  {admin&&<><Card><Text>Webhook</Text><Text>Bên nhận có thể nhận lại cùng event. 2xx chỉ xác nhận HTTP, không xác nhận xử lý nghiệp vụ.</Text><Field label="Tên webhook" value={hookName} onChangeText={setHookName}/><Field label="URL nhận HTTPS" value={url} onChangeText={setUrl} autoCapitalize="none"/><Select label="Project webhook" value={projectId} onChange={setProject} options={options} disabled={createDisabled}/>
   {(hooks.data?.value.eventTypes||[]).map(event=><Select key={event} label={event} disabled={createDisabled} value={events.includes(event)?'yes':'no'} options={[{value:'yes',label:'Gửi'},{value:'no',label:'Không gửi'}]} onChange={v=>setEvents(v==='yes'?[...events,event]:events.filter(e=>e!==event))}/>)}
   <Button label="Tạo webhook" disabled={createDisabled||!url.trim()||!hookName.trim()||!events.length} onPress={()=>void act(async()=>{const r=await api<{signingSecret:string}>('/webhooks',{method:'POST',body:JSON.stringify({name:hookName,url,events,projectIds:projectId?[projectId]:[]})});setSecret(r.signingSecret);setShown(false);setHookName('');setUrl('');})}/>
  </Card>{hooks.data?.value.subscriptions.map(h=><Card key={h.id}><Text>{h.name} · {h.active?'Đang bật':'Đã tắt'} · Khóa v{h.keyVersion}</Text><Text>{h.url}</Text>
   <Button label={(h.active?'Tắt ':'Bật ')+h.name} disabled={disabled||(!h.active&&createDisabled)} onPress={()=>void act(()=>api('/webhooks/'+h.id,{method:'PATCH',body:JSON.stringify({active:!h.active})}))}/>
   <Button label={'Đổi khóa '+h.name} disabled={createDisabled} onPress={()=>void act(async()=>{const r=await api<{signingSecret:string}>('/webhooks/'+h.id+'/rotate',{method:'POST',body:'{}'});setSecret(r.signingSecret);setShown(false);})}/>
   <Button label={'Lịch sử '+h.name} disabled={disabled} onPress={()=>void act(async()=>setHistory({id:h.id,...await api<History>('/webhooks/'+h.id+'/deliveries')}))}/>
  </Card>)}{history&&<Card><Text>Lịch sử gửi · {history.total} delivery</Text>{history.deliveries.map(d=><Card key={d.id}><Text>{d.state==='delivered'?'Đích đã phản hồi 2xx':d.state} · {d.attempt_count} lần thử</Text><Text>Event: {d.event_id}</Text><ErrorNotice message={d.last_error||''}/>{d.state==='failed'&&d.manual_retries<3&&<Button label={'Thử lại '+d.event_id} disabled={createDisabled} onPress={()=>void act(async()=>{await api(`/webhooks/${history.id}/deliveries/${d.id}/retry`,{method:'POST',body:'{}'});setHistory({id:history.id,...await api<History>('/webhooks/'+history.id+'/deliveries?page='+history.page)});})}/>}</Card>)}
   <Button label="Trang trước" disabled={disabled||history.page<=1} onPress={()=>void act(async()=>setHistory({id:history.id,...await api<History>('/webhooks/'+history.id+'/deliveries?page='+(history.page-1))}))}/>
   <Button label="Trang sau" disabled={disabled||history.page*25>=history.total} onPress={()=>void act(async()=>setHistory({id:history.id,...await api<History>('/webhooks/'+history.id+'/deliveries?page='+(history.page+1))}))}/>
  </Card>}</>}
 </FormPage>;
}
