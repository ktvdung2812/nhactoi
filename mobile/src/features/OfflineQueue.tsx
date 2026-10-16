import {router} from 'expo-router';
import React,{useState} from 'react';
import {useSession} from '../core/session';
import {errorMessage} from '../core/api';
import {Button,Card,Text,ErrorNotice,Row} from '../ui/kit';
export function OfflineQueue() {
  const {pending=[],sync,inspectPending,recoverPending,resolvePending,online,offlineError}=useSession();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Card><Text>Hàng đợi: {pending.length} thao tác chưa được máy chủ xác nhận</Text>
    <ErrorNotice message={error||offlineError||''}/>
    <Button label="Đồng bộ và kiểm tra quyền" secondary disabled={!online||busy} onPress={()=>void run(sync)}/>
    {pending.map(op=><Card key={op.id}>
      <Text>{({pending:'Đã lưu local · Chờ gửi',sending:'Đang đồng bộ / chờ đối soát',conflict:'Xung đột · Giữ cả hai bản',blocked:'Bị chặn · Nháp mã hóa được giữ lại'})[op.status]}</Text>
      {op.status!=='blocked'&&<><Text>{String(op.body.title||op.body.plannedDate||(op.path.endsWith('/plan')?'Kế hoạch cá nhân':op.path.includes('/checklists')?'Checklist':'Cập nhật công việc'))}</Text>{op.status==='conflict'&&<Text>Bản local: {String(op.body.title||'')} · {String(op.body.description||'')} · {String(op.body.plannedDate||op.body.dueAt||'')} · {String(op.body.status||'')}</Text>}</>}
      {!!op.error&&<Text>{op.error}</Text>}
      {(op.status==='conflict'||op.status==='blocked')&&<>
        <Button label="Tải bản máy chủ để so sánh" secondary disabled={!online||busy} onPress={()=>void run(()=>inspectPending(op.id))}/>
        {op.server&&<Text>Bản máy chủ: {String(op.server.title||'')} · {String(op.server.description||'')} · {String(op.server.plannedDate||op.server.dueAt||'')} · {String(op.server.status||'')}</Text>}
        {/^\/tasks(?:\/[^/]+)?$/.test(op.path)&&<Button label="Mở bản nháp để sửa" secondary disabled={!online||busy} onPress={()=>void run(async()=>{const id=await recoverPending(op.id);router.push(id?{pathname:'/task/edit',params:{id}}:'/task/new');})}/>}
        <Row>
        <Button label="Dùng bản server" secondary disabled={!online||busy||(!op.server||!op.currentRevision)} onPress={()=>void run(()=>resolvePending(op.id,'server'))}/>
        <Button label="Giữ local thành bản sửa mới" secondary disabled={!online||busy||(!op.server||!op.currentRevision)} onPress={()=>void run(()=>resolvePending(op.id,'local'))}/>
      </Row></>}
    </Card>)}
  </Card>;
}
