import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Notifications } from '../src/features/Notifications';

let mockScope = 'workspace-a';
let mockOffline = false;
const mockRead = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/core/push', () => ({ registerPush: jest.fn(), pushConfigured: true }));
jest.mock('../src/core/session', () => ({
  useSession: () => ({ scope: mockScope, session: { workspace: { id: mockScope } },
    online: !mockOffline, read: mockRead, api: jest.fn() }),
  refreshData: jest.fn(),
}));
let client: QueryClient;
const ui = () => <QueryClientProvider client={client}><Notifications onTask={() => {}} /></QueryClientProvider>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockScope = 'workspace-a'; mockOffline = false;
  mockRead.mockReset().mockImplementation(async (path: string) => {
    const query = new URLSearchParams(path.split('?')[1]);
    const scope = query.get('workspaceId'), page = Number(query.get('page'));
    const first = (page - 1) * 50;
    return { cached: mockOffline, updatedAt: Date.now(), value: {
      page, hasMore: page < 2, notifications: Array.from({ length: page === 1 ? 50 : 5 }, (_, i) => ({
        id: `${scope}-${first + i}`, title: `${scope} notice ${first + i + 1}`, message: '',
        createdAt: '2026-10-01T01:00:00Z', readAt: '2026-10-01T02:00:00Z',
      })),
    } };
  });
});
afterEach(async () => { await cleanup(); client.clear(); });

test('loads beyond 50, refreshes from page one, and resets on workspace change', async () => {
  const view = await render(ui());
  await screen.findByText('workspace-a notice 50');
  expect(screen.queryByText('workspace-a notice 51')).toBeNull();
  await fireEvent.press(screen.getByText('Xem thêm thông báo'));
  await screen.findByText('workspace-a notice 55');
  expect(screen.getByText('workspace-a notice 1')).toBeTruthy();
  expect(screen.queryByText('Xem thêm thông báo')).toBeNull();
  await act(async () => { screen.root?.props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.queryByText('workspace-a notice 55')).toBeNull());
  await waitFor(() => expect(mockRead).toHaveBeenLastCalledWith(expect.stringContaining('page=1'), expect.anything()));
  await fireEvent.press(screen.getByText('Xem thêm thông báo'));
  await screen.findByText('workspace-a notice 55');
  mockScope = 'workspace-b';
  await view.rerender(ui());
  await screen.findByText('workspace-b notice 1');
  expect(screen.queryByText('workspace-a notice 55')).toBeNull();
  expect(screen.queryByText('workspace-b notice 51')).toBeNull();
}, 30000);

test('cached pages remain readable offline and a failed next page preserves loaded notices', async () => {
  mockOffline = true;
  await render(ui());
  await screen.findByText('workspace-a notice 50');
  expect(screen.getByText('Đang xem thông báo đã lưu trên thiết bị.')).toBeTruthy();
  mockRead.mockRejectedValueOnce(new Error('Chưa tải trang này trên thiết bị.'));
  await fireEvent.press(screen.getByText('Xem thêm thông báo'));
  await screen.findByText('Chưa tải trang này trên thiết bị.');
  expect(screen.getByText('workspace-a notice 50')).toBeTruthy();
  await fireEvent.press(screen.getByText('Xem thêm thông báo'));
  await screen.findByText('workspace-a notice 55');
});
