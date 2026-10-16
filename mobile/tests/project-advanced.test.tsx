import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {ProjectAdvanced} from '../src/features/ProjectAdvanced';
import {useResource,useSession,refreshData} from '../src/core/session';
import {shareGeneratedText} from '../src/core/files';
import type {Project} from '../src/core/types';
jest.mock('expo-router',()=>({router:{push:jest.fn()}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'test-operation-1234'}));
jest.mock('../src/core/session',()=>({useResource:jest.fn(),useSession:jest.fn(),refreshData:jest.fn()}));
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
jest.mock('../src/core/files',()=>({shareGeneratedText:jest.fn()}));
jest.setTimeout(20000);
const api=jest.fn(),session=jest.mocked(useSession),resource=jest.mocked(useResource);
const project={id:'p',name:'Project',canEdit:true,canManage:false,readonly:false} as Project;
const task={id:'task',title:'Typed task',revision:'r1',status:'todo',dueAt:'2030-01-01T10:00:00Z',startAt:null,customValues:{number:0,check:false}};
beforeEach(()=>{jest.clearAllMocks();api.mockResolvedValue({});session.mockReturnValue({api,online:true,writable:true} as unknown as ReturnType<typeof useSession>);resource.mockImplementation((path:string)=>({data:{value:path.includes('/tasks?')?{tasks:[task],fields:[{id:'number',name:'Estimate',type:'number',position:0,options:[],retiredAt:null},{id:'check',name:'Confirmed',type:'checkbox',position:1,options:[],retiredAt:null}],pageSize:25,total:1,config:{layout:'list'}}:path.endsWith('/views')?{views:[]}:path.endsWith('/dependencies')?{dependencies:[]}:{templates:[]}},isPending:false}) as never);});
afterEach(cleanup);
test('Android custom fields preserve numeric zero and false through the real editor payload',async()=>{await render(<ProjectAdvanced project={project}/>);await fireEvent.press(screen.getByLabelText('Trường và lịch chung'));await fireEvent.changeText(screen.getByLabelText('Estimate'),'2');await fireEvent.press(screen.getByLabelText('Lưu giá trị trường'));expect(api).toHaveBeenCalledWith('/tasks/task/fields',{method:'PUT',body:JSON.stringify({values:{number:2,check:false},expectedRevision:'r1'})});await waitFor(()=>expect(refreshData).toHaveBeenCalled());});
test('Android failed field update preserves input for correction and reports the error',async()=>{api.mockRejectedValueOnce(new Error('Dữ liệu đã thay đổi'));await render(<ProjectAdvanced project={project}/>);await fireEvent.press(screen.getByLabelText('Trường và lịch chung'));await fireEvent.changeText(screen.getByLabelText('Estimate'),'10');await fireEvent.press(screen.getByLabelText('Lưu giá trị trường'));await waitFor(()=>expect(screen.getByText('Dữ liệu đã thay đổi')).toBeTruthy());expect(screen.getByDisplayValue('10')).toBeTruthy();expect(refreshData).not.toHaveBeenCalled();});
test.each(['offline','viewer'])('Android %s cannot queue or submit premium writes',async mode=>{if(mode==='offline')session.mockReturnValue({api,online:false,writable:true} as unknown as ReturnType<typeof useSession>);await render(<ProjectAdvanced project={mode==='viewer'?{...project,canEdit:false}:project}/>);await fireEvent.press(screen.getByLabelText('Trường và lịch chung'));await fireEvent.press(screen.getByLabelText('Lưu giá trị trường'));await fireEvent.press(screen.getByLabelText('Lưu ngày bắt đầu'));expect(api).not.toHaveBeenCalled();});

test('Android CSV export refreshes authorization, preserves false/zero and escapes formula cells',async()=>{
 api.mockResolvedValueOnce({tasks:[{...task,title:'  =FORMULA()'}],fields:[{id:'number',name:'Number'},{id:'check',name:'Check'}]});
 await render(<ProjectAdvanced project={project}/>);await fireEvent.press(screen.getByLabelText('Xuất CSV trang này'));
 await waitFor(()=>expect(shareGeneratedText).toHaveBeenCalled());expect(api.mock.calls[0][0]).toContain('/projects/p/tasks?');
 const csv=jest.mocked(shareGeneratedText).mock.calls[0][1];expect(csv).toContain("'  =FORMULA()");expect(csv).toContain('"0","false"');
});
