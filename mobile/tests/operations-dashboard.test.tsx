import React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react-native';
import {OperationsDashboard} from '../src/features/OperationsDashboard';
import {useResource} from '../src/core/session';
jest.mock('expo-router',()=>({router:{back:jest.fn(),push:jest.fn()}}));
jest.mock('../src/core/session',()=>({useResource:jest.fn(),refreshData:jest.fn()}));
jest.mock('../src/core/api',()=>({errorMessage:(e:Error)=>e.message}));
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
let state='success';
beforeEach(()=>{state='success';jest.mocked(useResource).mockImplementation((path:string)=>{
 if(!path.startsWith('/operations-dashboard'))return {data:{value:{projects:[],teams:[],members:[]}}} as never;
 if(state==='error')return {error:new Error('Mất kết nối báo cáo')} as never;
 if(state==='loading')return {isPending:true} as never;
 return {data:{cached:state==='cached',value:{generatedAt:'2026-09-22T04:00:00Z',page:1,total:state==='empty'?0:5,hasMore:true,summary:{taskCount:5,assignmentCount:6,overdueTaskCount:2,unacknowledgedAssignmentCount:2,snoozedTaskCount:1},tasks:state==='empty'?[]:[{id:'task-1',title:'Gọi khách',assignmentCount:2,unacknowledgedCount:1}]}}} as never;
});});afterEach(cleanup);
test('TC-W2-T01-A/B task and assignment labels are separate; paging keeps the API query',async()=>{
 await render(<OperationsDashboard/>);expect(screen.getByText('5 task · 6 lượt giao')).toBeTruthy();expect(screen.getByText('2 task quá hạn · 2 lượt chưa xác nhận · 1 task đang hoãn')).toBeTruthy();
 await fireEvent.press(screen.getByLabelText('Trang sau'));expect(jest.mocked(useResource).mock.calls.some(([path])=>path.startsWith('/operations-dashboard?')&&path.includes('page=2'))).toBe(true);
});
test.each(['error','empty','cached'])('TC-W2-T01-E %s is presented distinctly',async mode=>{
 state=mode;await render(<OperationsDashboard/>);
 if(mode==='error'){expect(screen.getByText('Mất kết nối báo cáo')).toBeTruthy();expect(screen.queryByText('Không có task phù hợp.')).toBeNull();}
 if(mode==='empty')expect(screen.getByText('Không có task phù hợp.')).toBeTruthy();
 if(mode==='cached')expect(screen.getByText(/Dữ liệu đã lưu:/)).toBeTruthy();
});
