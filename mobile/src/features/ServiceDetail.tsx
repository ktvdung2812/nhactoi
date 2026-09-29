import React, {useState} from 'react';
import {router} from 'expo-router';
import {useResource,useSession,refreshData} from '../core/session';
import {errorMessage} from '../core/api';
import {FormPage,Text,Button,Field,Loading,ErrorNotice,s} from '../ui/kit';
type Service = {id:string;name:string;provider:string;nextDate:string;amount:number;actualPaid:number|null;archivedAt:string|null;canEdit:boolean;note:string;cycle:string;intervalCount:number};
export function ServiceDetail({id}:{id:string}) {
 const {api,writable}=useSession();
 const result=useResource<{service:Service}>(`/services/${encodeURIComponent(id)}`);
 const [confirm,setConfirm]=useState(false),[amount,setAmount]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const service=result.data?.value.service;
 const allowed=writable&&service?.canEdit&&!service.archivedAt&&!result.data?.cached&&!result.error;
 async function renew(){
  if(!allowed||!service||busy)return;
  const paid=Number(amount);
  if(!amount.trim()||!Number.isSafeInteger(paid)||paid<0){setError('Nhập thực chi VND hợp lệ.');return;}
  setBusy(true);setError('');
  try{await api(`/services/${encodeURIComponent(id)}/renew`,{method:'POST',body:JSON.stringify({expectedDate:service.nextDate,amount:paid,note:'Ghi nhận trên ứng dụng Android'})});setConfirm(false);setNotice('Đã ghi nhận gia hạn. Thao tác này không chuyển tiền.');await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 return <FormPage title="Gia hạn dịch vụ" onBack={()=>router.canGoBack()?router.back():router.replace('/')}>
 {result.isPending?<Loading/>:result.error?<ErrorNotice message={errorMessage(result.error)}/>:service&&<>
 <Text style={s.cardTitle}>{service.name}</Text><Text>Nhà cung cấp: {service.provider||'Chưa đặt'}</Text>
 <Text>Ngày gia hạn: {service.nextDate.split('-').reverse().join('/')}</Text>
 <Text>Chi phí kỳ: {service.amount.toLocaleString('vi-VN')} đ</Text><Text>Chu kỳ: {service.intervalCount} {service.cycle==='year'?'năm':'tháng'}</Text>
 {!!service.note&&<Text>{service.note}</Text>}
 {!allowed&&<Text style={s.muted}>Chỉ xem. Cần kết nối và quyền sửa để ghi nhận gia hạn.</Text>}
 <ErrorNotice message={error}/>{!!notice&&<Text>{notice}</Text>}
 {confirm?<><Field label="Thực chi (VND)" value={amount} onChangeText={setAmount} keyboardType="numeric"/><Text>Xác nhận đã gia hạn với nhà cung cấp. Ngày tiếp theo sẽ được tính theo chu kỳ. Không tự chuyển tiền hoặc tạo khoản chi.</Text><Button label="Xác nhận ghi nhận gia hạn" disabled={!allowed||busy} onPress={()=>void renew()}/><Button label="Hủy" secondary disabled={busy} onPress={()=>setConfirm(false)}/></>:<Button label="Ghi nhận gia hạn" disabled={!allowed||busy} onPress={()=>{setAmount(String(service.amount));setConfirm(true);}}/>}
 </>}
 </FormPage>;
}
