import { useTheme } from "../ui/theme";
import React,{useEffect,useState} from 'react';
import {BackHandler,Platform,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {useResource,refreshData} from '../core/session';
import {FormPage,Text,Field,Button,Empty,Loading,ErrorNotice,EdgeSwipeBack} from '../ui/kit';
import {errorMessage} from '../core/api';
import {useMeasuredWindow,position} from '../ui/frames';
import {ServiceDetail} from './ServiceDetail';
export function Services({initialId,onInitialBack}:{initialId?:string;onInitialBack?:()=>void}={}){
  const { colors } = useTheme();
 const result=useResource<{services:{id:string;name:string;nextDate:string;provider:string;archivedAt:string|null}[]}>('/services');
 const [search,setSearch]=useState(''),[selected,setSelected]=useState(initialId||'');
 const {attach,onLayout,layout}=useMeasuredWindow();
 const dual=layout.mode==='dual'&&!!layout.secondary;
 useEffect(()=>{
  if(!selected)return;
  const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(onInitialBack)onInitialBack();else setSelected('');return true;});
  return ()=>listener.remove();
 },[selected,onInitialBack]);
 const rows=(result.data?.value.services||[]).filter(s=>!s.archivedAt&&`${s.name} ${s.provider}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
 const close=()=>onInitialBack?onInitialBack():setSelected('');
 return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}><View ref={attach} onLayout={onLayout} style={{flex:1}}>
 <View testID="services-list-pane" style={[position(layout.primary),{display:!selected||dual?'flex':'none'}]}>
 <FormPage title="Dịch vụ và gia hạn" onBack={()=>router.back()}>
 <Field label="Tìm dịch vụ" value={search} onChangeText={setSearch}/>
 <Button label="Làm mới dịch vụ" secondary onPress={()=>void refreshData()}/>
 {result.isPending?<Loading/>:result.error?<ErrorNotice message={errorMessage(result.error)}/>:<>
 {result.data?.cached&&<Text>Dữ liệu đã lưu trên thiết bị. Cần online để gia hạn.</Text>}
 {rows.map(s=><Button key={s.id} secondary label={`${s.name} · ${s.nextDate}`} onPress={()=>setSelected(s.id)}/>)}
 {!rows.length&&<Text>Không có dịch vụ phù hợp.</Text>}</>}
 </FormPage>
 </View>
 <View testID="services-detail-pane" style={[position(dual?layout.secondary!:layout.primary),{display:selected||dual?'flex':'none'}]}>
 <EdgeSwipeBack testID="services-swipe-back" enabled={Platform.OS==='ios'&&!dual&&!!selected} onBack={close}>
 {selected ? <ServiceDetail key={selected} id={selected} onBack={close}/> : <Empty title="Chọn một dịch vụ" message="Chi tiết dịch vụ sẽ hiển thị ở đây."/>}
 </EdgeSwipeBack>
 </View>
 </View></SafeAreaView>;
}
