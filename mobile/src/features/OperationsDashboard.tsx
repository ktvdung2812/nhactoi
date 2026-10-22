import React,{useState} from 'react';
import {router} from 'expo-router';
import {useResource,refreshData} from '../core/session';
import {FormPage,Text,Field,Button,Select,Loading,ErrorNotice} from '../ui/kit';
import {errorMessage} from '../core/api';
type Report={generatedAt:string;page:number;total:number;hasMore:boolean;summary:{taskCount:number;assignmentCount:number;overdueTaskCount:number;unacknowledgedAssignmentCount:number;snoozedTaskCount:number};tasks:{id:string;title:string;assignmentCount:number;unacknowledgedCount:number}[]};
export function OperationsDashboard(){
 const [filters,setFilters]=useState({projectId:'',teamId:'',assigneeId:'',status:'',group:'all',from:'',to:'',page:1});
 const projects=useResource<{projects:{id:string;name:string}[]}>('/projects');
 const teams=useResource<{teams:{id:string;name:string}[]}>('/teams');
 const members=useResource<{members:{id:string;name:string}[]}>('/members');
 const path='/operations-dashboard?'+new URLSearchParams(Object.entries(filters).filter(([,v])=>v!=='').map(([k,v])=>[k,String(v)]));
 const result=useResource<Report>(path),data=result.data?.value;
 const filter=(key:string,value:string)=>setFilters(f=>({...f,[key]:value,page:1}));
 return <FormPage title="Báo cáo vận hành" onBack={()=>router.back()}>
 <Select label="Dự án" value={filters.projectId} onChange={v=>filter('projectId',v)} options={[{value:'',label:'Tất cả'},...(projects.data?.value.projects||[]).map(p=>({value:p.id,label:p.name}))]}/>
 <Select label="Đội nhóm" value={filters.teamId} onChange={v=>filter('teamId',v)} options={[{value:'',label:'Tất cả'},...(teams.data?.value.teams||[]).map(p=>({value:p.id,label:p.name}))]}/>
 <Select label="Người được giao" value={filters.assigneeId} onChange={v=>filter('assigneeId',v)} options={[{value:'',label:'Tất cả'},...(members.data?.value.members||[]).map(p=>({value:p.id,label:p.name}))]}/>
 <Select label="Trạng thái" value={filters.status} onChange={v=>filter('status',v)} options={[{value:'',label:'Tất cả'},{value:'todo',label:'Cần làm'},{value:'doing',label:'Đang làm'},{value:'done',label:'Hoàn thành'}]}/>
 <Field label="Từ ngày đến hạn (YYYY-MM-DD)" value={filters.from} onChangeText={v=>filter('from',v)}/><Field label="Đến ngày đến hạn (YYYY-MM-DD)" value={filters.to} onChangeText={v=>filter('to',v)}/>
 <Select label="Nhóm vận hành" value={filters.group} onChange={v=>filter('group',v)} options={[{value:'all',label:'Tất cả'},{value:'overdue',label:'Quá hạn'},{value:'unacknowledged',label:'Chưa xác nhận'},{value:'snoozed',label:'Đang hoãn'}]}/>
 <Button label="Làm mới báo cáo" secondary onPress={()=>void refreshData()}/>
 {result.isPending?<Loading/>:result.error?<ErrorNotice message={errorMessage(result.error)}/>:data&&<>
 <Text>{result.data?.cached?'Dữ liệu đã lưu':'Cập nhật'}: {new Date(data.generatedAt).toLocaleString('vi-VN')}</Text>
 <Text>{data.summary.taskCount} task · {data.summary.assignmentCount} lượt giao</Text><Text>{data.summary.overdueTaskCount} task quá hạn · {data.summary.unacknowledgedAssignmentCount} lượt chưa xác nhận · {data.summary.snoozedTaskCount} task đang hoãn</Text>
 {data.tasks.map(t=><Button key={t.id} secondary label={`${t.title} · ${t.assignmentCount} lượt giao · ${t.unacknowledgedCount} chưa xác nhận`} onPress={()=>router.push({pathname:'/task/[id]',params:{id:t.id}})}/>)}
 {!data.tasks.length&&<Text>Không có task phù hợp.</Text>}<Text>Trang {data.page} · {data.total} task</Text>
 <Button label="Trang trước" secondary disabled={filters.page===1} onPress={()=>setFilters(f=>({...f,page:f.page-1}))}/><Button label="Trang sau" secondary disabled={!data.hasMore} onPress={()=>setFilters(f=>({...f,page:f.page+1}))}/>
 </>}
 </FormPage>;
}
