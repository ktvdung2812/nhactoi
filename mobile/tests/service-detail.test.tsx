import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {ServiceDetail} from '../src/features/ServiceDetail';
import {useResource,useSession} from '../src/core/session';
jest.mock('expo-router',()=>({router:{back:jest.fn(),canGoBack:()=>true,replace:jest.fn()}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'service-operation-test-1'}));
jest.mock('../src/core/session',()=>({useResource:jest.fn(),useSession:jest.fn(),refreshData:jest.fn()}));
jest.mock('../src/core/api',()=>({errorMessage:(e:unknown)=>e instanceof Error?e.message:'Lỗi'}));
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
const api=jest.fn();let cached=false,nextDate='2026-10-01',online=true,revision='revision-1';
beforeEach(()=>{cached=false;nextDate='2026-10-01';online=true;revision='revision-1';api.mockReset();api.mockResolvedValue({ok:true});jest.mocked(useSession).mockImplementation(()=>({api,writable:true,online,session:{user:{role:'owner'}}} as unknown as ReturnType<typeof useSession>));
 jest.mocked(useResource).mockImplementation((path:string)=>({data:{cached,value:path.endsWith('/history')?{history:[]}:path.includes('/interactions')?{interactions:[]}:{service:{id:'service-1',revision,name:'Tên miền',provider:'Nhà cung cấp',nextDate,amount:200000,actualPaid:null,archivedAt:null,canEdit:true,note:'',cycle:'year',intervalCount:1,customerId:'customer-1',reminderTime:'09:00',reminderMode:'daily'}}}} as never));});
afterEach(cleanup);
test('TC-W2-T04-A renewal freezes period/revision and defaults expense off',async()=>{
 await render(<ServiceDetail id="service-1"/>);
 await fireEvent.press(screen.getByLabelText('Ghi nhận gia hạn'));expect(api).not.toHaveBeenCalled();
 await fireEvent.press(screen.getByLabelText('Xác nhận ghi nhận gia hạn'));
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(1));
 expect(api.mock.calls[0][0]).toBe('/services/service-1/renew');
 expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({expectedDate:'2026-10-01',expectedRevision:'revision-1',operationId:'service-operation-test-1',amount:200000,recordExpense:false,createTask:false,note:'Ghi nhận trên ứng dụng Android'});
});
test.each(['cached','offline'])('TC-W2-T04-B %s service is read-only and never queues renewal or care',async mode=>{
 cached=mode==='cached';online=mode!=='offline';await render(<ServiceDetail id="service-1"/>);await fireEvent.press(screen.getByLabelText('Ghi nhận gia hạn'));await fireEvent.press(screen.getByLabelText('Tạo việc cho kỳ hiện tại'));await fireEvent.press(screen.getByLabelText('Lưu chăm sóc'));expect(api).not.toHaveBeenCalled();expect(screen.queryByLabelText('Xác nhận ghi nhận gia hạn')).toBeNull();
});
test('TC-W2-T04-C background refresh cannot change period/revision being confirmed',async()=>{
 const view=await render(<ServiceDetail id="service-1"/>);await fireEvent.press(screen.getByLabelText('Ghi nhận gia hạn'));
 nextDate='2027-10-01';revision='revision-2';await view.rerender(<ServiceDetail id="service-1"/>);await fireEvent.press(screen.getByLabelText('Xác nhận ghi nhận gia hạn'));
 await waitFor(()=>expect(api).toHaveBeenCalledTimes(1));expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({expectedDate:'2026-10-01',expectedRevision:'revision-1'});
});
test('TC-W2-T04-C lost response keeps inputs and retries the immutable operation',async()=>{
 api.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({ok:true});await render(<ServiceDetail id="service-1"/>);await fireEvent.press(screen.getByLabelText('Ghi nhận gia hạn'));
 await fireEvent.changeText(screen.getByLabelText('Chi phí kỳ gia hạn (VND)'),'345000');await fireEvent(screen.getByLabelText('Ghi khoản chi'),'valueChange',true);
 await fireEvent.press(screen.getByLabelText('Xác nhận ghi nhận gia hạn'));await screen.findByText('Mất kết nối');expect(screen.getByLabelText('Chi phí kỳ gia hạn (VND)').props.value).toBe('345000');
 await fireEvent.press(screen.getByLabelText('Xác nhận ghi nhận gia hạn'));await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));expect(api.mock.calls[1]).toEqual(api.mock.calls[0]);expect(JSON.parse(api.mock.calls[0][1].body).recordExpense).toBe(true);
});
test('TC-W2-T04-A/C care sends to linked customer and keeps draft on error',async()=>{
 api.mockRejectedValueOnce(new Error('Chưa lưu được'));await render(<ServiceDetail id="service-1"/>);await fireEvent.changeText(screen.getByLabelText('Nội dung chăm sóc'),'Khách cần báo giá');await fireEvent.press(screen.getByLabelText('Lưu chăm sóc'));await screen.findByText('Chưa lưu được');expect(screen.getByLabelText('Nội dung chăm sóc').props.value).toBe('Khách cần báo giá');expect(api.mock.calls[0][0]).toBe('/customers/customer-1/interactions');
});
