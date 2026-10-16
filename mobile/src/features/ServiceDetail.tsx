import React, {useState} from 'react';
import {Switch} from 'react-native';
import {router} from 'expo-router';
import * as Crypto from 'expo-crypto';
import {useResource,useSession,refreshData} from '../core/session';
import {errorMessage} from '../core/api';
import {FormPage,Text,Button,Field,Loading,ErrorNotice,Select,s} from '../ui/kit';
type Service = {id:string;revision?:string;name:string;provider:string;nextDate:string;amount:number;actualPaid:number|null;archivedAt:string|null;canEdit:boolean;note:string;cycle:string;intervalCount:number;customerId?:string|null;reminderTime?:string|null;reminderMode?:string};
type Renewal={id:string;previous_date:string;next_date:string;amount:number;expense_id:string|null;note:string;actor_name:string;created_at:string};
type Interaction={id:string;note:string;actor_name:string;happened_at:string};
type Confirm={date:string;revision?:string;operationId:string};
export function ServiceDetail({id}:{id:string}) {
 const {api,writable,online,session}=useSession();
 const result=useResource<{service:Service}>(`/services/${encodeURIComponent(id)}`);
 const service=result.data?.value.service;
 const history=useResource<{history:Renewal[]}>(`/services/${encodeURIComponent(id)}/history`);
 const interactions=useResource<{interactions:Interaction[]}>(`/customers/${encodeURIComponent(service?.customerId||'')}/interactions`,!!service?.customerId);
 const [confirm,setConfirm]=useState<Confirm|null>(null),[amount,setAmount]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [recordExpense,setRecordExpense]=useState(false),[createTask,setCreateTask]=useState(false),[submitted,setSubmitted]=useState<string|null>(null);
 const [care,setCare]=useState(''),[careType,setCareType]=useState('call');
 const allowed=writable&&online!==false&&service?.canEdit&&!service.archivedAt&&!result.data?.cached&&!result.error;
 const finance=['owner','admin'].includes(session?.user.role||'');
 async function renew(){
  if(!allowed||!service||!confirm||busy)return;
  const paid=Number(amount);
  if(!amount.trim()||!Number.isSafeInteger(paid)||paid<0){setError('Nhập chi phí kỳ gia hạn VND hợp lệ.');return;}
  const body=submitted||JSON.stringify({expectedDate:confirm.date,expectedRevision:confirm.revision,operationId:confirm.operationId,amount:paid,recordExpense,createTask,note:'Ghi nhận trên ứng dụng Android'});
  setBusy(true);setError('');setSubmitted(body);
  try{await api(`/services/${encodeURIComponent(id)}/renew`,{method:'POST',body});setConfirm(null);setSubmitted(null);setNotice('Đã ghi nhận gia hạn. Thao tác này không chuyển tiền.');await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 async function createCurrentTask(){
  if(!allowed||!service||busy)return;
  setBusy(true);setError('');
  try{await api(`/services/${encodeURIComponent(id)}/renewal-task`,{method:'POST',body:JSON.stringify({expectedDate:service.nextDate,expectedRevision:service.revision,operationId:Crypto.randomUUID()})});setNotice('Đã có một công việc cho kỳ hiện tại. Hoàn thành việc không tự gia hạn hoặc ghi chi.');await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 async function saveCare(){
  if(!allowed||!service?.customerId||busy||!care.trim())return;
  setBusy(true);setError('');
  try{await api(`/customers/${encodeURIComponent(service.customerId)}/interactions`,{method:'POST',body:JSON.stringify({type:careType,note:care})});setCare('');setNotice('Đã lưu lịch sử chăm sóc.');await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <FormPage title="Gia hạn dịch vụ" onBack={()=>router.canGoBack()?router.back():router.replace('/')}>
 {result.isPending?<Loading/>:result.error?<ErrorNotice message={errorMessage(result.error)}/>:service&&<>
 <Text style={s.cardTitle}>{service.name}</Text><Text>Nhà cung cấp: {service.provider||'Chưa đặt'}</Text>
 <Text>Ngày gia hạn: {service.nextDate.split('-').reverse().join('/')}</Text>
 <Text>Chi phí kỳ: {service.amount.toLocaleString('vi-VN')} đ</Text><Text>Chu kỳ: {service.intervalCount} {service.cycle==='year'?'năm':'tháng'}</Text>
 <Text>Nhắc {service.reminderMode==='milestone'?'theo mốc trước hạn và ngày hết hạn':'hằng ngày'} · {service.reminderTime||'Giữ giờ cũ'}</Text>
 {!!service.note&&<Text>{service.note}</Text>}
 {!allowed&&<Text style={s.muted}>Chỉ xem. Cần kết nối và quyền sửa để ghi nhận gia hạn.</Text>}
 <ErrorNotice message={error}/>{!!notice&&<Text accessibilityRole="alert">{notice}</Text>}
 {confirm?<>
 <Field label="Chi phí kỳ gia hạn (VND)" value={amount} onChangeText={setAmount} keyboardType="numeric" editable={!busy&&!submitted}/>
 <Text>Ghi khoản chi (cần quyền tài chính)</Text><Switch accessibilityLabel="Ghi khoản chi" value={recordExpense} onValueChange={setRecordExpense} disabled={!finance||busy||!!submitted}/>
 <Text>Tạo việc cho kỳ mới</Text><Switch accessibilityLabel="Tạo việc cho kỳ mới" value={createTask} onValueChange={setCreateTask} disabled={busy||!!submitted}/>
 <Text>Xác nhận gia hạn kỳ {confirm.date.split('-').reverse().join('/')}. Gia hạn không đồng nghĩa đã thanh toán. Khoản chi chỉ được tạo khi bật ghi chi; thao tác không chuyển tiền.</Text>
 {!!submitted&&!!error&&<Text>Giữ nguyên yêu cầu để thử lại an toàn. Nếu dữ liệu đã đổi, hủy biểu mẫu và tải lại; dữ liệu nhập vẫn được giữ khi lỗi.</Text>}
 <Button label="Xác nhận ghi nhận gia hạn" disabled={!allowed||busy} onPress={()=>void renew()}/>
 <Button label="Hủy" secondary disabled={busy} onPress={()=>{setConfirm(null);setSubmitted(null);}}/>
 </>:<Button label="Ghi nhận gia hạn" disabled={!allowed||busy} onPress={()=>{setAmount(String(service.amount));setRecordExpense(false);setCreateTask(false);setSubmitted(null);setConfirm({date:service.nextDate,revision:service.revision,operationId:Crypto.randomUUID()});}}/>}
 <Button label="Tạo việc cho kỳ hiện tại" secondary disabled={!allowed||busy} onPress={()=>void createCurrentTask()}/>
 <Text style={s.cardTitle}>Lịch sử gia hạn</Text>
 {history.isPending?<Loading/>:history.error?<ErrorNotice message={errorMessage(history.error)}/>:<>
 {history.data?.cached&&<Text>Dữ liệu lịch sử đã lưu trên thiết bị.</Text>}
 {(history.data?.value.history||[]).map(item=><Text key={item.id}>{item.previous_date} → {item.next_date} · {item.amount.toLocaleString('vi-VN')} đ · {item.expense_id?'Đã ghi khoản chi':'Không ghi khoản chi'} · {item.actor_name||'Thành viên'}{item.note?`\n${item.note}`:''}</Text>)}
 {!history.data?.value.history?.length&&<Text>Chưa có lần gia hạn nào.</Text>}</>}
 {!!service.customerId&&<>
 <Text style={s.cardTitle}>Chăm sóc khách hàng</Text>
 {interactions.error?<ErrorNotice message={errorMessage(interactions.error)}/>:interactions.isPending?<Loading/>:(interactions.data?.value.interactions||[]).map(item=><Text key={item.id}>{item.actor_name||'Thành viên'} · {new Date(item.happened_at).toLocaleString('vi-VN')}\n{item.note}</Text>)}
 <Select label="Loại tương tác" value={careType} onChange={setCareType} disabled={!allowed||busy} options={[{value:'call',label:'Cuộc gọi'},{value:'email',label:'Email'},{value:'meeting',label:'Cuộc gặp'},{value:'message',label:'Tin nhắn'},{value:'other',label:'Khác'}]}/>
 <Field label="Nội dung chăm sóc" value={care} onChangeText={setCare} multiline maxLength={5000} editable={!!allowed&&!busy}/>
 <Button label="Lưu chăm sóc" disabled={!allowed||busy||!care.trim()} onPress={()=>void saveCare()}/>
 </>}
 <Button label="Làm mới dịch vụ" secondary onPress={()=>void refreshData()}/>
 </>}
 </FormPage>;
}
