import React,{useState} from 'react';
import {router} from 'expo-router';
import {useResource,refreshData} from '../core/session';
import {FormPage,Text,Field,Button,Loading,ErrorNotice} from '../ui/kit';
import {errorMessage} from '../core/api';
export function Services(){
 const result=useResource<{services:{id:string;name:string;nextDate:string;provider:string;archivedAt:string|null}[]}>('/services');
 const [search,setSearch]=useState('');
 const rows=(result.data?.value.services||[]).filter(s=>!s.archivedAt&&`${s.name} ${s.provider}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
 return <FormPage title="Dịch vụ và gia hạn" onBack={()=>router.back()}>
 <Field label="Tìm dịch vụ" value={search} onChangeText={setSearch}/>
 <Button label="Làm mới dịch vụ" secondary onPress={()=>void refreshData()}/>
 {result.isPending?<Loading/>:result.error?<ErrorNotice message={errorMessage(result.error)}/>:<>
 {result.data?.cached&&<Text>Dữ liệu đã lưu trên thiết bị. Cần online để gia hạn.</Text>}
 {rows.map(s=><Button key={s.id} secondary label={`${s.name} · ${s.nextDate}`} onPress={()=>router.push({pathname:'/service/[id]',params:{id:s.id}})}/>)}
 {!rows.length&&<Text>Không có dịch vụ phù hợp.</Text>}</>}
 </FormPage>;
}
