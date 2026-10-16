import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {ProjectImport} from '../src/features/ProjectImport';
import {useResource,useSession,refreshData} from '../src/core/session';
import {pickTextFile} from '../src/core/files';
import {ApiError} from '../src/core/api';
import type {Project} from '../src/core/types';
jest.mock('expo-router',()=>({router:{push:jest.fn()}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'import-operation-1234'}));
jest.mock('../src/core/session',()=>({useResource:jest.fn(),useSession:jest.fn(),refreshData:jest.fn()}));
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
jest.mock('../src/core/files',()=>({pickTextFile:jest.fn()}));
const api=jest.fn(),session=jest.mocked(useSession),resource=jest.mocked(useResource),picker=jest.mocked(pickTextFile);
const project={id:'private',name:'Private',canEdit:true,canManage:true,readonly:false} as Project;
const meta={limits:{maxBytes:524288,maxRows:500,maxLists:40},users:[],labels:[],columns:[{id:'todo',name:'Todo',status:'todo'}],fields:[],canWriteStart:false};
const preview={valid:true,previewToken:'fingerprint',headers:['title'],suggestedMapping:{title:'title'},sourceUsers:[],sourceLabels:[],sourceLists:[],summary:{ready:1,skipped:0,failed:0},errors:[],warnings:[],sample:[{line:2,title:'Việt 🎉',status:'todo'}],sampleLimit:20};
beforeEach(()=>{jest.clearAllMocks();session.mockReturnValue({api,online:true,writable:true} as unknown as ReturnType<typeof useSession>);resource.mockReturnValue({data:{value:meta},isPending:false} as never);picker.mockResolvedValue({name:'input.csv',content:'title\nViệt 🎉'});api.mockImplementation(async(path:string)=>path.endsWith('/preview')?preview:{imported:1,skipped:0,failed:0,taskIds:['task-one']});});
afterEach(cleanup);
async function openAndPick(){await render(<ProjectImport project={project}/>);await fireEvent.press(screen.getByLabelText('Nhập CSV / Trello vào dự án'));await fireEvent.press(screen.getByLabelText('Chọn tệp nhập'));await waitFor(()=>expect(screen.getByLabelText('Xác nhận nhập lô')).toBeTruthy());}
test('Android file/preview/commit shows actual counters and calls common API, no write before confirmation',async()=>{
 await openAndPick();expect(picker).toHaveBeenCalledWith(524288);expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][0]).toBe('/projects/private/import/preview');
 await fireEvent.press(screen.getByLabelText('Xác nhận nhập lô'));await waitFor(()=>expect(screen.getByText('Đã nhập 1, bỏ qua 0, lỗi 0.')).toBeTruthy());expect(JSON.parse(api.mock.calls[1][1].body)).toMatchObject({source:'csv',content:'title\nViệt 🎉',previewToken:'fingerprint',operationId:'import-operation-1234'});expect(screen.queryByLabelText('Xác nhận nhập lô')).toBeNull();expect(refreshData).toHaveBeenCalled();
});
test('Android lost commit response holds payload and retries same operation, never reports definite failure',async()=>{
 let commits=0;api.mockImplementation(async(path:string)=>{if(path.endsWith('/preview'))return preview;if(commits++===0)throw new ApiError(503,'Mất mạng');return{imported:1,skipped:0,failed:0,taskIds:['task-one']};});
 await openAndPick();await fireEvent.press(screen.getByLabelText('Xác nhận nhập lô'));await waitFor(()=>expect(screen.getByText(/Chưa xác định kết quả/)).toBeTruthy());await fireEvent.press(screen.getByLabelText('Chọn tệp nhập'));expect(picker).toHaveBeenCalledTimes(1);
 await fireEvent.press(screen.getByLabelText('Đối soát / thử lại cùng lô'));await waitFor(()=>expect(screen.getByText('Đã nhập 1, bỏ qua 0, lỗi 0.')).toBeTruthy());const bodies=api.mock.calls.filter(([path])=>path.endsWith('/commit')).map(([,options])=>options.body);expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
});
test('Android validation errors show row and retain editable content; corrected file re-previews',async()=>{
 api.mockResolvedValueOnce({...preview,valid:false,errors:[{row:2,column:'title',message:'Tiêu đề rỗng'}],summary:{ready:1,skipped:0,failed:1}});
 await render(<ProjectImport project={project}/>);await fireEvent.press(screen.getByLabelText('Nhập CSV / Trello vào dự án'));await fireEvent.press(screen.getByLabelText('Chọn tệp nhập'));await waitFor(()=>expect(screen.getByText('Dòng 2, cột title: Tiêu đề rỗng')).toBeTruthy());expect(screen.queryByLabelText('Xác nhận nhập lô')).toBeNull();
 await fireEvent.press(screen.getByLabelText('Sửa nội dung tệp'));await fireEvent.changeText(screen.getByLabelText('Nội dung tệp nhập'),'title\nĐã sửa');await fireEvent.press(screen.getByLabelText('Xem trước lô nhập'));await waitFor(()=>expect(screen.getByLabelText('Xác nhận nhập lô')).toBeTruthy());expect(JSON.parse(api.mock.calls[1][1].body).content).toBe('title\nĐã sửa');
});
test.each(['offline','viewer'])('Android %s never puts import into task queue or calls commit',async mode=>{
 if(mode==='offline')session.mockReturnValue({api,online:false,writable:true} as unknown as ReturnType<typeof useSession>);
 await render(<ProjectImport project={mode==='viewer'?{...project,canEdit:false}:project}/>);await fireEvent.press(screen.getByLabelText('Nhập CSV / Trello vào dự án'));await fireEvent.press(screen.getByLabelText('Chọn tệp nhập'));await fireEvent.press(screen.getByLabelText('Xem trước lô nhập'));expect(picker).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();
});
test('Android schema conflict retains file and requires fresh preview',async()=>{
 api.mockImplementation(async(path:string)=>{if(path.endsWith('/preview'))return preview;throw new ApiError(409,'Schema đã đổi');});await openAndPick();await fireEvent.press(screen.getByLabelText('Xác nhận nhập lô'));await waitFor(()=>expect(screen.getByText('Schema đã đổi')).toBeTruthy());expect(screen.queryByLabelText('Đối soát / thử lại cùng lô')).toBeNull();expect(screen.getByText('Tệp: input.csv')).toBeTruthy();await fireEvent.press(screen.getByLabelText('Xem trước lô nhập'));await waitFor(()=>expect(screen.getByLabelText('Xác nhận nhập lô')).toBeTruthy());
});

test('Android unknown result followed by revoked ACL retains original operation for later reconciliation',async()=>{
 let commits=0;api.mockImplementation(async(path:string)=>{if(path.endsWith('/preview'))return preview;if(commits++===0)throw new ApiError(503,'Mất phản hồi');throw new ApiError(403,'Quyền đã đổi');});
 await openAndPick();await fireEvent.press(screen.getByLabelText('Xác nhận nhập lô'));await waitFor(()=>expect(screen.getByText(/Chưa xác định kết quả/)).toBeTruthy());await fireEvent.press(screen.getByLabelText('Đối soát / thử lại cùng lô'));await waitFor(()=>expect(screen.getByText('Quyền đã đổi')).toBeTruthy());expect(screen.getByLabelText('Đối soát / thử lại cùng lô')).toBeTruthy();await fireEvent.press(screen.getByLabelText('Chọn tệp nhập'));expect(picker).toHaveBeenCalledTimes(1);
});
