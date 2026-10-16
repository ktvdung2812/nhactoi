import React from 'react';
import {render,fireEvent,waitFor} from '@testing-library/react-native';
import {ZaloOa} from '../src/features/ZaloOa';
import {useSession,useResource} from '../src/core/session';
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
jest.mock('expo-router',()=>({router:{back:jest.fn()}}));
jest.mock('../src/core/session',()=>({useSession:jest.fn(),useResource:jest.fn()}));
const api=jest.fn(),refetch=jest.fn();
const data={configured:true,connection:{oaId:'OA',status:'active',senderReady:true,contract:{mode:'simulation'}},templates:[],recipients:[],deliveries:[{id:'delivery',sourceId:'task',status:'unknown',attempts:1}]};
beforeEach(()=>{jest.clearAllMocks();(useSession as jest.Mock).mockReturnValue({api,online:true,writable:true});(useResource as jest.Mock).mockReturnValue({data:{value:data,cached:false},refetch});});
it('blocks OA actions while offline without putting sends into task queue',async()=>{
 (useSession as jest.Mock).mockReturnValue({api,online:false,writable:false});const screen=await render(<ZaloOa/>);
 await fireEvent.press(screen.getByText('Xử lý hàng đợi OA'));await fireEvent.press(screen.getByText('Đối soát kết quả'));await fireEvent.press(screen.getByText('Ngắt kết nối OA'));expect(api).not.toHaveBeenCalled();
 expect(screen.getByText(/Không đưa thao tác OA/)).toBeTruthy();
});
it('unknown outcomes reconcile explicitly and never show provider receipt as work acknowledgement',async()=>{
 api.mockResolvedValue({delivery:{status:'accepted'}});const screen=await render(<ZaloOa/>);expect(screen.getByText(/xác nhận công việc là các trạng thái riêng biệt/)).toBeTruthy();
 await fireEvent.press(screen.getByText('Đối soát kết quả'));await waitFor(()=>expect(api).toHaveBeenCalledWith('/integrations/zalo-oa/deliveries/delivery/reconcile',{method:'POST',body:'{}'}));expect(refetch).toHaveBeenCalled();
});
it('missing real contract is displayed as blocked even though integration UI exists',async()=>{
 (useResource as jest.Mock).mockReturnValue({data:{value:{configured:false,connection:null,templates:[],recipients:[],deliveries:[]},cached:false},refetch});
 const screen=await render(<ZaloOa/>);expect(screen.getByText(/Gửi thật đang bị chặn/)).toBeTruthy();expect(screen.queryByText('Kết nối OA')).toBeNull();
});
