import React,{useState} from 'react';
import {Linking} from 'react-native';
import {router} from 'expo-router';
import {useResource,useSession,refreshData} from '../core/session';
import {FormPage,Text,Button,Select,Loading,ErrorNotice,Card} from '../ui/kit';
import {API_URL,errorMessage} from '../core/api';
const names:Record<string,string>={personal:'Kế hoạch cá nhân',deadline:'Hạn công việc',appointment:'Lịch hẹn',renewal:'Kỳ gia hạn'};
type Mapping={id:string;kind:string;state:string;error?:string;conflict?:{server:unknown;revision:string;event:{etag:string;start?:unknown;end?:unknown;summary?:string}}};
type Connection={id:string;status:string;enabledKinds:string[];lastSuccessAt?:string;error?:string};
type CalendarData={configured:boolean;connection:Connection|null;mappings:Mapping[]};
export function GoogleCalendar(){
  const {api,online,writable}=useSession(),result=useResource<CalendarData>('/integrations/google-calendar');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const data=result.data?.value,c=data?.connection,disabled=busy||!online||!writable||!!result.data?.cached;
  async function act(fn:()=>Promise<unknown>){if(disabled)return;setBusy(true);setError('');setNotice('');try{await fn();await refreshData();await result.refetch();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <FormPage title="Google Calendar" onBack={()=>router.back()}>
    <Text>Đăng nhập Google và kết nối Calendar có consent riêng.</Text>
    <Text>Kết nối tài khoản trong trình duyệt tại {API_URL}/google-calendar. Đăng nhập đúng tài khoản và doanh nghiệp cần đồng bộ.</Text>
    {data?.configured&&<Button label="Mở trang kết nối Google Calendar" disabled={disabled} onPress={()=>void act(()=>Linking.openURL(new URL('/google-calendar',API_URL).href))}/>}
    {!online&&<Text>Đang offline. Đồng bộ và thay đổi kết nối cần internet.</Text>}
    <ErrorNotice message={error||errorMessageIf(result.error)}/>{notice&&<Text>{notice}</Text>}
    {result.isPending&&<Loading/>}{data&&!data.configured&&<Text>Quản trị viên chưa bật Google Calendar.</Text>}
    {c&&<><Text>Trạng thái: {({active:'Đang kết nối',connecting:'Đang kết nối',reconnect:'Cần kết nối lại',disconnected:'Đã ngắt kết nối',needs_review:'Cần kiểm tra lịch Google'} as Record<string,string>)[c.status]||c.status}</Text>
      {result.data?.cached&&<Text>Dữ liệu kết nối đã lưu, chưa đối soát mới.</Text>}{c.lastSuccessAt&&<Text>Đồng bộ thành công gần nhất: {new Date(c.lastSuccessAt).toLocaleString('vi-VN')}</Text>}<ErrorNotice message={c.error}/>
      {c.status==='active'&&<>{Object.entries(names).map(([kind,label])=><Select key={kind} label={label} value={c.enabledKinds.includes(kind)?'on':'off'} disabled={disabled} options={[{value:'on',label:'Đồng bộ'},{value:'off',label:'Tắt'}]} onChange={value=>void act(()=>api('/integrations/google-calendar',{method:'PATCH',body:JSON.stringify({enabledKinds:value==='on'?[...c.enabledKinds,kind]:c.enabledKinds.filter(k=>k!==kind)})}))}/>)}
      <Button label="Đồng bộ ngay" disabled={disabled} onPress={()=>void act(async()=>{const r=await api<{ok?:boolean}>('/integrations/google-calendar/sync',{method:'POST',body:'{}'});setNotice(r.ok?'Đã đối soát lịch.':'Còn thay đổi chờ gửi hoặc cần xử lý.');})}/></>}
      {c.status!=='disconnected'&&<Button label="Ngắt kết nối Calendar" secondary disabled={disabled} onPress={()=>void act(async()=>{const r=await api<{providerRevoked:boolean}>('/integrations/google-calendar',{method:'DELETE'});setNotice(r.providerRevoked?'Đã dừng đồng bộ; bản sao sự kiện vẫn ở Google.':'Đã dừng đồng bộ, chưa xác nhận thu hồi quyền Google.');})}/>}</>}
    {data?.mappings.filter(m=>['conflict','unknown','failed','suppressed'].includes(m.state)).map(m=><Card key={m.id}><Text>{names[m.kind]}</Text><ErrorNotice message={m.error}/>{m.conflict&&<>
      <Text>Nhắc Tôi: {JSON.stringify(m.conflict.server)}</Text><Text>Google: {JSON.stringify({start:m.conflict.event.start,end:m.conflict.event.end})}</Text>
      {['local','google'].map(choice=><Button key={choice} label={choice==='local'?'Giữ dữ liệu Nhắc Tôi':'Áp dụng từ Google'} disabled={disabled} onPress={()=>void act(()=>api(`/integrations/google-calendar/mappings/${m.id}/resolve`,{method:'POST',body:JSON.stringify({choice,expectedRevision:m.conflict!.revision,expectedEtag:m.conflict!.event.etag||null})}))}/>)}</>}
      {['suppressed','failed'].includes(m.state)&&<Button label="Liên kết lại" disabled={disabled} onPress={()=>void act(()=>api(`/integrations/google-calendar/mappings/${m.id}/resolve`,{method:'POST',body:JSON.stringify({choice:'relink'})}))}/>}</Card>)}
  </FormPage>;
}
function errorMessageIf(error:unknown){return error?errorMessage(error):'';}
