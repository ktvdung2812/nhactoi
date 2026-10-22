import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react-native';
import {Planner} from '../src/features/Planner';
import {useResource,useSession} from '../src/core/session';
jest.mock('../src/core/session',()=>({useResource:jest.fn(),useSession:jest.fn(),refreshData:jest.fn(async()=>{})}));
jest.mock('../src/ui/frames',()=>({HingeSafe:({children}:{children:React.ReactNode})=>children}));
const api=jest.fn();
const task={id:'t',title:'Không hạn',description:'',status:'todo',priority:'medium',dueAt:null,teamId:null,plannedDate:null,planRevision:'plan-r1'};
beforeEach(()=>{api.mockReset();api.mockResolvedValue({pending:true});jest.mocked(useSession).mockReturnValue({api,taskWritable:true,session:{user:{id:'u'}}} as never);jest.mocked(useResource).mockReturnValue({isPending:false,data:{value:{tasks:[task]}}} as never);});
afterEach(cleanup);
test('TC-W4-T01-A/B: Inbox plan uses its independent revision and never writes task deadline',async()=>{
  await render(<Planner onTask={jest.fn()}/>);
  await fireEvent.press(screen.getByLabelText('Xem kế hoạch: Hôm nay'));await fireEvent.press(screen.getByText('Inbox'));
  await fireEvent.press(screen.getByLabelText('Sắp lịch: Không hạn'));
  await fireEvent.changeText(screen.getByLabelText('Ngày dự định (YYYY-MM-DD)'),'2028-02-29');
  await fireEvent.changeText(screen.getByLabelText('Giờ bắt đầu (HH:mm, tùy chọn)'),'09:30');
  await fireEvent.press(screen.getByLabelText('Lưu kế hoạch cá nhân'));
  await waitFor(()=>expect(api).toHaveBeenCalledTimes(1));
  expect(api.mock.calls[0][0]).toBe('/tasks/t/plan');
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({expectedRevision:'plan-r1',plannedDate:'2028-02-29',plannedTime:'09:30',plannedDuration:60});
  expect(screen.getByText('Đã lưu kế hoạch local · Chờ đồng bộ.')).toBeTruthy();
});
test('TC-W4-T01-C: ambiguous quick date blocks submission; valid preview is shown before add',async()=>{
  await render(<Planner onTask={jest.fn()}/>);
  await fireEvent.changeText(screen.getByLabelText('Nhập nhanh tiếng Việt'),'Gọi An 02/03');
  expect(screen.getByLabelText('Xác nhận thêm việc').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Nhập nhanh tiếng Việt'),'ngày mai 9h Gọi An');
  expect(screen.getByText('Xem trước: Gọi An')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Xác nhận thêm việc'));await waitFor(()=>expect(api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({title:'Gọi An',assigneeId:'u'});
});

test('bounded personal pages reset when changing view while retaining quick-entry draft',async()=>{
 jest.mocked(useResource).mockReturnValue({isPending:false,data:{value:{tasks:[],total:51,hasMore:true}}} as never);
 await render(<Planner onTask={jest.fn()}/>);
 expect(jest.mocked(useResource).mock.calls.at(-1)?.[0]).toMatch(/^\/personal-tasks\?view=today&date=\d{4}-\d{2}-\d{2}&page=1&pageSize=50$/);
 await fireEvent.changeText(screen.getByLabelText('Nhập nhanh tiếng Việt'),'Giữ bản nháp');
 await fireEvent.press(screen.getByLabelText('Trang kế hoạch tiếp'));
 expect(jest.mocked(useResource).mock.calls.at(-1)?.[0]).toContain('page=2');
 await fireEvent.press(screen.getByLabelText('Xem kế hoạch: Hôm nay'));await fireEvent.press(screen.getByText('Inbox'));
 expect(jest.mocked(useResource).mock.calls.at(-1)?.[0]).toContain('view=inbox');
 expect(jest.mocked(useResource).mock.calls.at(-1)?.[0]).toContain('page=1');
 expect(screen.getByDisplayValue('Giữ bản nháp')).toBeTruthy();
});
