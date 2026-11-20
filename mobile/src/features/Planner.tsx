import React,{useEffect,useState} from 'react';
import {ScrollView} from 'react-native';
import {useResource,useSession,refreshData} from '../core/session';
import type {Task} from '../core/types';
import {planningDay,personalTaskGroups,parseQuickTask} from '../../../shared/personal-planning.mjs';
import {errorMessage} from '../core/api';
import { useKitStyles,Text,Heading,Field,DateField,Select,Button,Row,Card,Loading,ErrorNotice} from '../ui/kit';
import {dateLabel} from '../core/policy';
export function Planner({onTask}:{onTask:(id:string)=>void}) {
  const s = useKitStyles();
  const {api,session,taskWritable}=useSession();
  const [view,setView]=useState('today'),[now,setNow]=useState(new Date()),[text,setText]=useState(''),[manualDue,setManualDue]=useState<string|null|undefined>(undefined);
  const scope=`${view}:${planningDay(now)}`;
  const [paging,setPaging]=useState({scope,page:1});
  const page=paging.scope===scope?paging.page:1;
  const result=useResource<{tasks:Task[];total?:number;hasMore?:boolean}>(`/personal-tasks?view=${view}&date=${planningDay(now)}&page=${page}&pageSize=50`);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [editor,setEditor]=useState<{task:Task;date:string;time:string;duration:string}|null>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);
  const parsed=parseQuickTask(text,now),dueAt=manualDue===undefined?parsed.dueAt:manualDue;
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  async function add(){
    const response=await api<{pending?:boolean}>('/tasks',{method:'POST',body:JSON.stringify({title:parsed.title,dueAt,remindAt:null,assigneeId:session?.user.id})});
    setText('');setManualDue(undefined);setMessage(response.pending?'Đã lưu local · Chờ đồng bộ.':'Máy chủ đã xác nhận công việc.');
  }
  async function plan(remove=false) {
    if(!editor)return;
    const {task,date,time,duration}=editor;
    if(!remove&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date))throw new Error('Ngày kế hoạch phải hợp lệ, dạng YYYY-MM-DD.');
    if(!remove&&time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Giờ kế hoạch phải có dạng HH:mm.');
    if(!Number.isInteger(Number(duration))||Number(duration)<15||Number(duration)>1440)throw new Error('Thời lượng phải là 15–1440 phút.');
    if(!remove&&time&&Number(time.slice(0,2))*60+Number(time.slice(3))+Number(duration)>1440)throw new Error('Kế hoạch phải kết thúc trong cùng ngày.');
    const response=await api<{pending?:boolean}>(`/tasks/${task.id}/plan`,{method:'PATCH',body:JSON.stringify({_offlineTask:task,expectedRevision:task.planRevision,plannedDate:remove?null:date,plannedTime:remove?null:time||null,plannedDuration:Number(duration)})});
    setEditor(null);setMessage(response.pending?'Đã lưu kế hoạch local · Chờ đồng bộ.':'Máy chủ đã xác nhận kế hoạch. Hạn công việc giữ nguyên.');
  }
  const tasks=result.data?.value.tasks||[],groups=personalTaskGroups(tasks,view,now);
  return <ScrollView contentContainerStyle={[s.content, { width: '100%', maxWidth: 760, alignSelf: 'center' }]} keyboardShouldPersistTaps="handled"><Heading>Kế hoạch của tôi</Heading>
    <Select label="Xem kế hoạch" value={view} onChange={setView} options={[{value:'inbox',label:'Inbox'},{value:'today',label:'Hôm nay'},{value:'upcoming',label:'Sắp tới'},{value:'week',label:'Tuần này'}]}/>
    <ErrorNotice message={error||(result.error?errorMessage(result.error):'')}/>{!!message&&<Text accessibilityLiveRegion="polite">{message}</Text>}
    <Card><Field label="Nhập nhanh tiếng Việt" value={text} onChangeText={value=>{setText(value);setManualDue(undefined);}} placeholder="mai 9h gửi báo giá"/>
      {!!text&&<><Text>Xem trước: {parsed.title}</Text><Text>Hạn: {dateLabel(dueAt)} · UTC+7</Text>{parsed.error&&manualDue===undefined&&<ErrorNotice message={parsed.error}/>}</>}
      <DateField label="Chọn hạn cụ thể" value={dueAt} onChange={setManualDue} optional/>
      <Button label="Xác nhận thêm việc" disabled={busy||!taskWritable||!parsed.title||!!(parsed.error&&manualDue===undefined)||session?.user.memberType==='guest'} onPress={()=>void run(add)}/>
      {session?.user.memberType==='guest'&&<Text>Khách tạo việc trong dự án được mời bằng form Công việc mới.</Text>}
    </Card>
    {editor&&<Card><Text>Kế hoạch riêng: {editor.task.title}</Text>
      <Field label="Ngày dự định (YYYY-MM-DD)" value={editor.date} onChangeText={date=>setEditor({...editor,date})}/>
      <Field label="Giờ bắt đầu (HH:mm, tùy chọn)" value={editor.time} onChangeText={time=>setEditor({...editor,time})}/>
      <Field label="Thời lượng (phút)" keyboardType="number-pad" value={editor.duration} onChangeText={duration=>setEditor({...editor,duration})}/>
      <Row><Button label="Lưu kế hoạch cá nhân" disabled={busy||!taskWritable} onPress={()=>void run(()=>plan())}/><Button label="Bỏ kế hoạch" secondary disabled={busy||!taskWritable} onPress={()=>void run(()=>plan(true))}/><Button label="Hủy" secondary onPress={()=>setEditor(null)}/></Row>
    </Card>}
    {result.data&&<Text accessibilityLiveRegion="polite">Trang {page} · {result.data.value.total??"Chưa đối soát"} công việc trên máy chủ{result.data.cached?" · Bản lưu trên thiết bị":""}. Nháp local hiển thị thêm khi thuộc cách xem này.</Text>}
    {result.isPending?<Loading/>:groups.length?groups.map(group=><Card key={group.label}><Text style={s.cardTitle}>{group.label}</Text>{group.tasks.map(task=><Card key={task.id}>
      <Button label={task.title} secondary onPress={()=>onTask(task.id)}/><Text>Hạn chung: {dateLabel(task.dueAt)}</Text><Text>Dự định: {task.plannedDate||'Chưa lên lịch'} {task.plannedTime||''} {task.plannedDate?`· ${task.plannedDuration||60} phút`:''}</Text>
      {task.pending&&<Text>Đã lưu local · Chờ đồng bộ</Text>}
      <Button label={`Sắp lịch: ${task.title}`} secondary disabled={busy||!taskWritable} onPress={()=>setEditor({task,date:task.plannedDate||planningDay(now),time:task.plannedTime||'',duration:String(task.plannedDuration||60)})}/>
    </Card>)}</Card>):<Text>Chưa có công việc trong cách nhìn này.</Text>}
    <Row><Button label="Trang kế hoạch trước" secondary disabled={page===1||result.isPending} onPress={()=>setPaging({scope,page:page-1})}/><Button label="Trang kế hoạch tiếp" secondary disabled={!result.data?.value.hasMore||result.isPending} onPress={()=>setPaging({scope,page:page+1})}/></Row>
  </ScrollView>;
}
