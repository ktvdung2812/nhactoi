import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TaskForm } from "../src/features/TaskForm";
import { useResource, useSession } from "../src/core/session";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("../src/core/session", () => ({ refreshData: jest.fn(), useResource: jest.fn(), useSession: jest.fn() }));
jest.mock("../src/ui/frames", () => ({ HingeSafe: ({ children }: { children: React.ReactNode }) => children }));
const api = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); api.mockResolvedValue({ ok: true });
  jest.mocked(useSession).mockReturnValue({ api, writable: true, session: { user: { role: 'owner' } } } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useResource).mockImplementation((path: string) => ({ isPending: false, data: { value: path === '/teams' ? { teams: [] } : path === '/members' ? { members: [] } : { task: {
    id: 't', revision: 'original-revision', title: 'Lặp', description: '', status: 'todo', priority: 'medium', teamId: null, assigneeId: null,
    dueAt: '2030-01-01T02:00:00Z', remindAt: null, recurrence: 'weekly', recurrenceOptions: { interval: 2, basis: 'completion', weekdays: [1, 3] },
  } } } }) as never);
});
afterEach(cleanup);
test('editing content preserves advanced recurrence and changing frequency clears weekly-only options', async () => {
  await render(<TaskForm id="t" />);
  await fireEvent.changeText(screen.getByLabelText('Tên công việc'), 'Đổi tên');
  await fireEvent.press(screen.getByLabelText('Lưu công việc'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1].body).recurrenceOptions).toEqual({ interval: 2, basis: 'completion', weekdays: [1, 3] });
  await fireEvent.press(screen.getByLabelText('Lặp lại: Hàng tuần'));
  await fireEvent.press(screen.getByText('Hàng năm'));
  await fireEvent.press(screen.getByLabelText('Lưu công việc'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(api.mock.calls[1][1].body)).toMatchObject({ recurrence: 'yearly', recurrenceOptions: { interval: 2, basis: 'completion', weekdays: [] } });
});
test('invalid intervals block writes and workday preset resets interval', async () => {
  await render(<TaskForm id="t" />);
  await fireEvent.changeText(screen.getByLabelText('Khoảng lặp (1–365)'), '0');
  await fireEvent.press(screen.getByLabelText('Lưu công việc'));
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText('Khoảng lặp phải là số nguyên từ 1 đến 365.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Thứ 2–Thứ 6'));
  await fireEvent.press(screen.getByLabelText('Lưu công việc'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1].body).recurrenceOptions).toEqual({ interval: 1, basis: 'completion', weekdays: [1, 2, 3, 4, 5] });
});
test('a background update does not replace the draft revision or silently overwrite remote edits', async () => {
  const view = await render(<TaskForm id="t" />);
  await fireEvent.changeText(screen.getByLabelText('Tên công việc'), 'Bản nháp trên điện thoại');
  const original = jest.mocked(useResource).getMockImplementation()!;
  jest.mocked(useResource).mockImplementation((path: string) => {
    const result = original(path) as any;
    if (result.data?.value.task) result.data.value.task = { ...result.data.value.task, revision: 'new-revision', status: 'done' };
    return result;
  });
  await view.rerender(<TaskForm id="t" />);
  api.mockRejectedValueOnce(new Error('Dữ liệu đã thay đổi trên thiết bị khác.'));
  await fireEvent.press(screen.getByLabelText('Lưu công việc'));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({ expectedRevision: 'original-revision', title: 'Bản nháp trên điện thoại' });
  expect(screen.getByText('Dữ liệu đã thay đổi trên thiết bị khác.')).toBeTruthy();
  expect(screen.getByLabelText('Tên công việc').props.value).toBe('Bản nháp trên điện thoại');
});
