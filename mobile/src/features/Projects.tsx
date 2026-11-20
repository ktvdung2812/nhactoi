import React, { useEffect, useState } from 'react';
import { ProjectAdvanced } from './ProjectAdvanced';
import { ProjectImport } from './ProjectImport';
import { BackHandler, Platform, ScrollView, View } from 'react-native';
import { position } from '../ui/frames';
import type { AdaptiveLayout } from '../ui/layout';
import { useResource, useSession, refreshData } from '../core/session';
import type { Project, ProjectMember, Member, Team } from '../core/types';
import { errorMessage } from '../core/api';
import { useKitStyles, Heading, Text, Field, Select, Button, Card, Empty, ErrorNotice, Loading, EdgeSwipeBack } from '../ui/kit';
const roles = [{value:'viewer',label:'Chỉ xem'},{value:'commenter',label:'Bình luận'},{value:'editor',label:'Chỉnh sửa'},{value:'manager',label:'Quản lý'}];
export function Projects({layout}: {layout?: AdaptiveLayout} = {}) {
  const s = useKitStyles();
  const {api,session,writable,online}=useSession();
  const [id,setId]=useState(''),[name,setName]=useState(''),[mode,setMode]=useState('workspace'),[teamId,setTeamId]=useState('');
  const [person,setPerson]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('viewer'),[invite,setInvite]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const guest=session?.user.memberType==='guest',admin=['owner','admin'].includes(session?.user.role||'');
  const list=useResource<{projects:Project[]}>('/projects');
  const detail=useResource<{project:Project;members:ProjectMember[]}>(`/projects/${id}`,!!id);
  const people=useResource<{members:Member[]}>('/members',!guest);
  const teams=useResource<{teams:Team[]}>('/teams',!guest);
  const project=id && !detail.error ? detail.data?.value.project : undefined;
  const disabled=!online||!writable||busy;
  const dual=layout?.mode==='dual' && !!layout.secondary;
  useEffect(()=>{
    if(!id) return;
    const listener=BackHandler.addEventListener('hardwareBackPress',()=>{setId('');return true;});
    return ()=>listener.remove();
  },[id]);
  const primary=layout?.primary;
  const secondary=dual ? layout?.secondary : primary;
  const local=(region: NonNullable<typeof primary>)=>position({...region,x:region.x-(primary?.x||0),y:region.y-(primary?.y||0)});
  async function change(fn:()=>Promise<unknown>){setError('');setBusy(true);try{await fn();await refreshData();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <View style={{flex:1}}>
    <View testID="projects-list-pane" style={primary ? [local(primary),{display:!id||dual?'flex':'none'}] : {flex:1}}>
    <ScrollView contentContainerStyle={[s.content,{width:'100%',maxWidth:760,alignSelf:'center'}]}>
    <Heading>Dự án</Heading><Text>Owner và admin doanh nghiệp có quyền với mọi dự án, kể cả riêng tư.</Text>
    <ErrorNotice message={error || (list.error?errorMessage(list.error):detail.error?errorMessage(detail.error):'')}/>
    {list.isPending&&<Loading/>}
    <Select label="Dự án" value={id} onChange={value=>{setId(value);setInvite('');}} options={[{value:'',label:'Chọn dự án'},...(list.error?[]:list.data?.value.projects||[]).filter(p=>!(p.id===id&&detail.error)).map(p=>({value:p.id,label:p.name+(p.readonly?' · Chỉ đọc':'')}))]}/>
    {admin&&!guest&&<Card><Text style={s.cardTitle}>Tạo dự án</Text><Field label="Tên dự án" value={name} onChangeText={setName} maxLength={120}/><Select label="Phạm vi" value={mode} onChange={setMode} options={[{value:'workspace',label:'Kế thừa doanh nghiệp'},{value:'team',label:'Kế thừa team'},{value:'private',label:'Riêng tư'}]}/>
      {mode==='team'&&<Select label="Team của dự án" value={teamId} onChange={setTeamId} options={[{value:'',label:'Chọn team'},...(teams.data?.value.teams||[]).filter(t=>!t.archivedAt).map(t=>({value:t.id,label:t.name}))]}/>}
      <Button label="Tạo dự án" disabled={disabled||!name.trim()||(mode==='team'&&!teamId)} onPress={()=>void change(async()=>{const r=await api<{project:Project}>('/projects',{method:'POST',body:JSON.stringify({name,accessMode:mode,teamId:mode==='team'?teamId:null})});setId(r.project.id);setName('');})}/>
    </Card>}
    </ScrollView>
    </View>
    <View testID="projects-detail-pane" style={secondary ? [local(secondary),{display:id||dual?'flex':'none'}] : {display:id?'flex':'none',flex:1}}>
    <EdgeSwipeBack testID="projects-swipe-back" enabled={Platform.OS==='ios'&&!dual&&!!id} onBack={()=>setId('')}>
    {!id&&dual&&<Empty title="Chọn một dự án" message="Chi tiết dự án sẽ hiển thị ở đây."/>}
    <ScrollView style={{flex:1}} contentContainerStyle={[s.content,{width:'100%',maxWidth:760,alignSelf:'center'}]} keyboardShouldPersistTaps="handled">
    {layout&&!!id&&<Button label="‹ Dự án" secondary onPress={()=>setId('')}/>}
    {id&&detail.isPending&&<Loading/>}
    {id&&<ErrorNotice message={error || (detail.error?errorMessage(detail.error):'')}/>}
    {project&&<><Card><Text style={s.cardTitle}>{project.name}</Text><Text>{project.readonly?'Chỉ đọc':'Vai trò: '+(roles.find(r=>r.value===project.myRole)?.label||project.myRole)}</Text>
      {(detail.data?.value.members||[]).map(member=><Card key={member.id}><Text>{member.name}{member.memberType==='guest'?' (khách)':''}</Text>
        {project.canManage?<><Select label={`Vai trò ${member.name}`} value={member.directRole||member.role} disabled={disabled} options={roles.filter(r=>member.memberType!=='guest'||r.value!=='manager')} onChange={value=>void change(()=>api(`/projects/${id}/members/${member.id}`,{method:'PUT',body:JSON.stringify({role:value})}))}/>
          {member.directRole&&<Button label={`Bỏ quyền ${member.name}`} disabled={disabled} secondary onPress={()=>void change(()=>api(`/projects/${id}/members/${member.id}`,{method:'DELETE'}))}/>}</>:<Text>{roles.find(r=>r.value===member.role)?.label}</Text>}
      </Card>)}
      {project.canManage&&<><Select label="Thêm nhân sự" value={person} onChange={setPerson} options={[{value:'',label:'Chọn nhân sự'},...(people.data?.value.members||[]).filter(m=>!detail.data?.value.members.some(x=>x.id===m.id)).map(m=>({value:m.id,label:m.name}))]}/><Button label="Thêm vào dự án" disabled={disabled||!person} onPress={()=>void change(()=>api(`/projects/${id}/members/${person}`,{method:'PUT',body:JSON.stringify({role:'editor'})}))}/>
        {admin&&<><Field label="Email khách" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/><Select label="Quyền khách" value={role} onChange={setRole} options={roles.filter(r=>r.value!=='manager')}/><Text>Khách dùng một ghế doanh nghiệp.</Text><Button label="Tạo liên kết mời" disabled={disabled||!email.includes('@')||!session?.subscription.capabilities?.includes('guests')} onPress={()=>void change(async()=>{const r=await api<{inviteUrl:string}>('/invitations',{method:'POST',body:JSON.stringify({email,memberType:'guest',projectId:id,projectRole:role})});setInvite(r.inviteUrl);})}/></>}
      </>}
      {invite&&<Text selectable accessibilityLabel="Liên kết mời">{invite}</Text>}
    </Card><ProjectImport key={project.id+'-import'} project={project}/><ProjectAdvanced key={project.id} project={project}/></>}
    </ScrollView>
    </EdgeSwipeBack>
    </View>
  </View>;
}
