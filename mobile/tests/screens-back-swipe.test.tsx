import React from 'react';
import { BackHandler, Platform, StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { getAdaptiveLayout } from '../src/ui/layout';
import { EdgeSwipeBack, isEdgeStart, shouldCompleteSwipe } from '../src/ui/kit';
import Home from '../src/app/index';
import { Services } from '../src/features/Services';
import { Projects } from '../src/features/Projects';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: async () => null, addNotificationResponseReceivedListener: () => ({ remove() {} }), addNotificationReceivedListener: () => ({ remove() {} }), addPushTokenListener: () => ({ remove() {} }) }));
jest.mock('../src/core/push', () => ({ notificationTarget: () => ({}), pushConfigured: false }));
jest.mock('../src/ui/frames', () => ({
  useMeasuredWindow: () => ({ attach: () => {}, onLayout: () => {}, layout: mockLayout, width: mockWidth }),
  position: (r: { x: number; y: number; width: number; height: number }) => ({ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height }),
  HingeSafe: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../src/core/session', () => ({
  refreshData: jest.fn(),
  useSession: () => ({
    api: jest.fn(),
    session: { token: 't', user: { id: 'u', role: 'owner' }, workspace: { id: 'w' }, subscription: { capabilities: [] } },
    scope: 'w',
    online: true,
    writable: true,
    loading: false,
    switchWorkspace: jest.fn(),
  }),
  useResource: (path: string) => ({ isPending: false, data: { value:
    path === '/services' ? { services: [{ id: 's', name: 'Miền', provider: 'P', nextDate: '2030-01-01', archivedAt: null }] } :
    path === '/services/s' ? { service: { id: 's', name: 'Miền', provider: 'P', nextDate: '2030-01-01', amount: 1, canEdit: true, cycle: 'year', intervalCount: 1, customerId: 'c' } } :
    path.endsWith('/history') ? { history: [] } : path.includes('/interactions') ? { interactions: [] } :
    path === '/projects' ? { projects: [{ id: 'p', name: 'Dự án A', myRole: 'manager', canManage: true }] } :
    path === '/projects/p' ? { project: { id: 'p', name: 'Dự án A', myRole: 'manager', canManage: true }, members: [] } :
    path === '/members' ? { members: [] } : path === '/teams' ? { teams: [] } : {} } }),
}));
jest.mock('../src/features/ProjectAdvanced', () => ({ ProjectAdvanced: () => null }));
jest.mock('../src/features/ProjectImport', () => ({ ProjectImport: () => null }));
jest.mock('../src/features/TaskList', () => ({ TaskList: ({ onSelect }: { onSelect: (id: string) => void }) => {
  const { Pressable, Text: NativeText } = require('react-native');
  return <Pressable testID="select-task" onPress={() => onSelect('t1')}><NativeText>select task</NativeText></Pressable>;
} }));
jest.mock('../src/features/TaskDetail', () => ({ TaskDetail: ({ id, onBack }: { id: string; onBack?: () => void }) => {
  const { Pressable, Text: NativeText } = require('react-native');
  return <><NativeText>{id}</NativeText><Pressable testID="task-back" onPress={() => onBack?.()}><NativeText>back</NativeText></Pressable></>;
} }));
jest.mock('../src/features/Planner', () => ({ Planner: () => null }));
jest.mock('../src/features/Notifications', () => ({ Notifications: () => null }));
jest.mock('../src/features/Account', () => ({ Account: () => null }));
jest.mock('../src/features/Login', () => ({ Login: () => null }));

const setPlatform = (os: 'ios' | 'android') => {
  (Platform as unknown as { OS: string }).OS = os;
};
const small = getAdaptiveLayout({ width: 360, height: 780, foldingFeatures: [] });
const large = getAdaptiveLayout({ width: 1280, height: 800, foldingFeatures: [] });
let mockWidth = 360, mockLayout = small;
const originalOS = Platform.OS;
afterEach(async () => {
  await cleanup();
  setPlatform(originalOS as 'ios' | 'android');
  jest.restoreAllMocks();
  mockWidth = 360;
  mockLayout = small;
});
const swipeEnabled = (testID: string) =>
  screen.getByTestId(testID, { includeHiddenElements: true }).props.accessibilityState.disabled === false;

test('edge start and completion thresholds are pure', () => {
  expect(isEdgeStart(0, 0)).toBe(true);
  expect(isEdgeStart(24, 0)).toBe(true);
  expect(isEdgeStart(24.5, 0)).toBe(false);
  expect(isEdgeStart(200, 20)).toBe(false);
  // A stale origin must not accept touches left of the pane (a pane that moved right).
  expect(isEdgeStart(5, 400)).toBe(false);
  expect(isEdgeStart(410, 400)).toBe(true);
  expect(shouldCompleteSwipe(80, 0)).toBe(false);
  expect(shouldCompleteSwipe(81, 0)).toBe(true);
  expect(shouldCompleteSwipe(10, 0.5)).toBe(false);
  expect(shouldCompleteSwipe(10, 0.51)).toBe(true);
});

test('the wrapper exposes the pan handler and marks itself disabled when off', async () => {
  await render(<EdgeSwipeBack testID="swipe" enabled={false} onBack={jest.fn()}><></></EdgeSwipeBack>);
  const props = screen.getByTestId('swipe').props;
  expect(typeof props.onStartShouldSetResponderCapture).toBe('function');
  expect(typeof props.onMoveShouldSetResponderCapture).toBe('function');
  expect(props.accessibilityState.disabled).toBe(true);
});

test('home enables the detail edge swipe on iOS single pane and the back control closes it', async () => {
  setPlatform('ios');
  await render(<Home />);
  await fireEvent.press(screen.getByTestId('select-task'));
  expect(swipeEnabled('home-task-swipe-back')).toBe(true);
  await fireEvent.press(screen.getByTestId('task-back'));
  expect(screen.queryByText('t1')).toBeNull();
});

test('home disables the edge swipe when the window is dual', async () => {
  setPlatform('ios');
  mockWidth = 1280;
  mockLayout = large;
  await render(<Home />);
  await fireEvent.press(screen.getByTestId('select-task'));
  expect(screen.getByText('t1')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('home-task-list-pane', { includeHiddenElements: true }).props.style).display).toBe('flex');
  expect(swipeEnabled('home-task-swipe-back')).toBe(false);
});

test('one Android hardware back closes exactly one open task detail', async () => {
  setPlatform('android');
  const spy = jest.spyOn(BackHandler, 'addEventListener');
  await render(<Home />);
  await fireEvent.press(screen.getByTestId('select-task'));
  expect(screen.getByText('t1')).toBeTruthy();
  expect(swipeEnabled('home-task-swipe-back')).toBe(false);
  const listener = spy.mock.calls[spy.mock.calls.length - 1][1] as () => boolean;
  let handled = false;
  await act(async () => {
    handled = listener();
  });
  expect(handled).toBe(true);
  expect(screen.queryByText('t1')).toBeNull();
});

test('services shows an empty detail pane in dual mode with no selection', async () => {
  setPlatform('ios');
  mockWidth = 1280;
  mockLayout = large;
  await render(<Services />);
  expect(screen.getByText('Chọn một dịch vụ')).toBeTruthy();
  expect(screen.getByText('Chi tiết dịch vụ sẽ hiển thị ở đây.')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('services-detail-pane').props.style).display).toBe('flex');
  expect(swipeEnabled('services-swipe-back')).toBe(false);
});

test('projects shows an empty detail pane in dual mode with no selection', async () => {
  setPlatform('ios');
  mockWidth = 1280;
  mockLayout = large;
  await render(<Projects layout={mockLayout} />);
  expect(screen.getByText('Chọn một dự án')).toBeTruthy();
  expect(screen.getByText('Chi tiết dự án sẽ hiển thị ở đây.')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('projects-detail-pane').props.style).display).toBe('flex');
  expect(swipeEnabled('projects-swipe-back')).toBe(false);
});

test('services enables the edge swipe on iOS single pane and the back control closes the detail', async () => {
  setPlatform('ios');
  await render(<Services />);
  await fireEvent.press(screen.getByLabelText('Miền · 2030-01-01'));
  expect(swipeEnabled('services-swipe-back')).toBe(true);
  await fireEvent.press(screen.getByLabelText('‹ Quay lại'));
  expect(StyleSheet.flatten(screen.getByTestId('services-detail-pane', { includeHiddenElements: true }).props.style).display).toBe('none');
});

test('home registers its back handler once so an open project handles back first', async () => {
  setPlatform('android');
  const spy = jest.spyOn(BackHandler, 'addEventListener');
  await render(<Home />);
  const backListeners = () => spy.mock.calls.filter(([name]) => name === 'hardwareBackPress');
  expect(backListeners()).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('select-task'));
  await fireEvent.press(screen.getByLabelText('Dự án'));
  // Home did not re-register on selection or tab changes.
  expect(backListeners()).toHaveLength(1);
  await fireEvent.press(screen.getByLabelText('Dự án: Chọn dự án'));
  await fireEvent.press(screen.getByLabelText('Dự án A'));
  // Opening a project registers the Projects handler, which is now the newest one.
  expect(backListeners()).toHaveLength(2);
  const newest = backListeners()[1][1] as () => boolean;
  let handled = false;
  await act(async () => {
    handled = newest();
  });
  expect(handled).toBe(true);
  // Only the project closed: the Projects tab is still selected and its picker is back to empty.
  expect(screen.getByLabelText('Dự án').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Dự án: Chọn dự án')).toBeTruthy();
});

test('back with a task kept behind another tab returns to that task instead of clearing it', async () => {
  setPlatform('android');
  const spy = jest.spyOn(BackHandler, 'addEventListener');
  await render(<Home />);
  await fireEvent.press(screen.getByTestId('select-task'));
  await fireEvent.press(screen.getByLabelText('Tài khoản'));
  expect(screen.queryByText('t1')).toBeNull();
  const listener = spy.mock.calls[spy.mock.calls.length - 1][1] as () => boolean;
  let handled = false;
  await act(async () => {
    handled = listener();
  });
  expect(handled).toBe(true);
  // The invisible selection survives; back left the Account tab and shows the task again.
  expect(screen.getByText('t1')).toBeTruthy();
});
