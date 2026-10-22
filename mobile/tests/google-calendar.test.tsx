import React from 'react';
import {Linking} from 'react-native';
import {render,fireEvent,waitFor} from '@testing-library/react-native';
import {GoogleCalendar} from '../src/features/GoogleCalendar';
import {useSession,useResource,refreshData} from '../src/core/session';
import {API_URL} from '../src/core/api';
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
jest.mock('expo-router',()=>({router:{back:jest.fn()}}));
jest.mock('../src/core/session',()=>({useSession:jest.fn(),useResource:jest.fn(),refreshData:jest.fn()}));
const api=jest.fn(),refetch=jest.fn();
const data={configured:true,connection:{id:'connection',status:'active',enabledKinds:['personal','deadline']},mappings:[]};
beforeEach(()=>{jest.clearAllMocks();(useSession as jest.Mock).mockReturnValue({api,online:true,writable:true});(useResource as jest.Mock).mockReturnValue({data:{value:data,cached:false},refetch});});
it('shows independent consent and locks Calendar actions offline',async()=>{
 (useSession as jest.Mock).mockReturnValue({api,online:false,writable:false});
 const screen=await render(<GoogleCalendar/>);expect(screen.getByText(/consent riêng/)).toBeTruthy();
 await fireEvent.press(screen.getByText('Đồng bộ ngay'));await fireEvent.press(screen.getByText('Ngắt kết nối Calendar'));expect(api).not.toHaveBeenCalled();
});
it('opens the configured Web consent page without transferring credentials to the URL',async()=>{
 const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
 const screen=await render(<GoogleCalendar/>);await fireEvent.press(screen.getByText('Mở trang kết nối Google Calendar'));
 expect(open).toHaveBeenCalledWith(new URL('/google-calendar',API_URL).href);open.mockRestore();
});
it('reports pending sync honestly and refreshes after reconciliation',async()=>{
 api.mockResolvedValue({ok:false,pending:1});const screen=await render(<GoogleCalendar/>);await fireEvent.press(screen.getByText('Đồng bộ ngay'));
 await waitFor(()=>expect(screen.getByText('Còn thay đổi chờ gửi hoặc cần xử lý.')).toBeTruthy());expect(refreshData).toHaveBeenCalled();
});
it('resolves a conflict using the reviewed server revision and provider ETag',async()=>{
 (useResource as jest.Mock).mockReturnValue({data:{value:{...data,mappings:[{id:'map1',kind:'deadline',state:'conflict',conflict:{revision:'revision1',server:{dueAt:'2030-01-01'},event:{etag:'etag1',start:{dateTime:'2030-01-02T01:00:00Z'}}}}]},cached:false},refetch});
 api.mockResolvedValue({ok:true});const screen=await render(<GoogleCalendar/>);await fireEvent.press(screen.getByText('Áp dụng từ Google'));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('/integrations/google-calendar/mappings/map1/resolve',{method:'POST',body:JSON.stringify({choice:'google',expectedRevision:'revision1',expectedEtag:'etag1'})}));
});
