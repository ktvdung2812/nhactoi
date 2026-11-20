import React from 'react';
import { Alert, Appearance, type AlertButton } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppearanceProvider, useAppearanceSettings } from '../src/core/appearance';
import * as appearanceModule from '../src/core/appearance';
import { useSession } from '../src/core/session';
import { request } from '../src/core/api';
import { cacheRead, cacheWrite } from '../src/core/cache';
import { ThemeProvider } from '../src/ui/theme';
import { AppearanceSettings } from '../src/features/AppearanceSettings';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('../src/core/session', () => ({ useSession: jest.fn() }));
jest.mock('../src/core/cache', () => ({ cacheRead: jest.fn(), cacheWrite: jest.fn(async () => {}) }));
jest.mock('../src/core/api', () => ({ request: jest.fn(), ApiError: class extends Error { status: number; constructor(code: number, message: string) { super(message); this.status = code; } }, errorMessage: (e: unknown) => e instanceof Error ? e.message : 'Lỗi' }));

let refreshAppearance: () => Promise<void>;
function Bridge() {
  const appearance = useAppearanceSettings();
  refreshAppearance = appearance.refresh;
  return <ThemeProvider preferences={appearance.preferences}>{appearance.cacheLoading ? <></> : <AppearanceSettings />}</ThemeProvider>;
}
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const profile = { preferences: { mode: 'light', hiddenNav: ['tasks'], contrast: 'standard' }, accessibility: { contrast: 'high', motion: 'reduced' }, separate: true };
const sync = { mobile: { separate: true }, web: { separate: true } };
let online = true;
const api = (token: string) => (path: string, options?: RequestInit) => request(path, token, options);
beforeEach(() => {
  online = true;
  jest.mocked(useSession).mockImplementation(() => ({ session: { token: 'token' }, scope: 'user-workspace', online, api: api('token') } as never));
  jest.mocked(cacheRead).mockResolvedValue(null);
  jest.mocked(request).mockImplementation(async (path: string, _token?: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return { preferences: JSON.parse(options.body as string), accessibility: profile.accessibility } as never;
    return (path === '/appearance/sync' ? sync : profile) as never;
  });
});
afterEach(cleanup);
async function mount() {
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true));
}

test('saves only mobile edits while preserving web fields and shared accessibility', async () => {
  await mount();
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true));
  const put = jest.mocked(request).mock.calls.find(call => call[2]?.method === 'PUT');
  expect(JSON.parse(put![2]!.body as string)).toEqual({ mode: 'dark', hiddenNav: ['tasks'], contrast: 'high', motion: 'reduced' });
});
test('failed save rolls the preview back and reports the error', async () => {
  await mount();
  jest.mocked(request).mockRejectedValueOnce(new Error('Lưu thất bại'));
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await screen.findByText('Lưu thất bại');
  expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true);
});
test('copying from web requires confirmation', async () => {
  await mount();
  await fireEvent.press(screen.getByLabelText('Sao chép từ web'));
  expect(jest.mocked(request).mock.calls.filter(call => call[2]?.method === 'PUT')).toHaveLength(0);
  const buttons = alert.mock.calls.at(-1)![2] as AlertButton[];
  await act(async () => buttons.find(button => button.text === 'Sao chép')!.onPress!());
  expect(jest.mocked(request).mock.calls.some(call => call[0] === '/appearance/sync' && call[2]?.body === JSON.stringify({ platform: 'mobile', separate: true, copyFrom: 'web' }))).toBe(true);
});
test('offline changes show an error without a request', async () => {
  online = false;
  jest.mocked(cacheRead).mockResolvedValue({ value: { mode: 'light' }, updatedAt: 1 });
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true));
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  expect(screen.getByText('Không có kết nối mạng.')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
test('switching to the shared profile refreshes the active appearance', async () => {
  await mount();
  jest.mocked(request).mockImplementation(async (path: string, _token?: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return { mobile: { separate: false }, web: { separate: true } } as never;
    return (path === '/appearance/sync' ? { mobile: { separate: false }, web: { separate: true } } : { ...profile, separate: false, preferences: { mode: 'dark' } }) as never;
  });
  await fireEvent.press(screen.getByLabelText('Đồng bộ với web'));
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true));
  expect(screen.getByLabelText('Đồng bộ với web').props.accessibilityState.checked).toBe(true);
  expect(screen.queryByLabelText('Sao chép từ web')).toBeNull();
});
test('reselecting either active scope never sends a sync update', async () => {
  await mount();
  expect(screen.getByLabelText('Chỉ cho điện thoại').props.accessibilityState.checked).toBe(true);
  expect(screen.getByLabelText('Màu Xanh dương').props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByLabelText('Chỉ cho điện thoại'));
  expect(jest.mocked(request).mock.calls.some(call => call[0] === '/appearance/sync' && call[2]?.method === 'PUT')).toBe(false);
  jest.mocked(request).mockImplementation(async (path: string, _token?: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return {} as never;
    return (path === '/appearance/sync' ? { mobile: { separate: false }, web: { separate: false } } : { ...profile, separate: false }) as never;
  });
  await fireEvent.press(screen.getByLabelText('Đồng bộ với web'));
  await waitFor(() => expect(screen.getByLabelText('Đồng bộ với web').props.accessibilityState.checked).toBe(true));
  jest.mocked(request).mockClear();
  await fireEvent.press(screen.getByLabelText('Đồng bộ với web'));
  expect(request).not.toHaveBeenCalled();
});
test.each([false, true])('reselecting scope %s does not call setSeparate', async separate => {
  const setSeparate = jest.fn();
  const hook = jest.spyOn(appearanceModule, 'useAppearanceSettings').mockReturnValue({ separate, setSeparate, scopeKnown: true, loading: false, error: '', syncUnavailable: false, webSeparate: false } as never);
  try {
    await render(<ThemeProvider><AppearanceSettings /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText(separate ? 'Chỉ cho điện thoại' : 'Đồng bộ với web'));
    expect(setSeparate).not.toHaveBeenCalled();
  } finally { hook.mockRestore(); }
});
test('ignores a late response from the previous workspace', async () => {
  let current = { session: { token: 'first' }, scope: 'first', online: true, api: api('first') };
  jest.mocked(useSession).mockImplementation(() => current as never);
  let finishFirst!: (value: unknown) => void;
  const first = new Promise(resolve => { finishFirst = resolve; });
  jest.mocked(request).mockImplementation(async (path: string, token?: string) => {
    if (path === '/appearance/sync') return sync as never;
    return (token === 'first' ? await first : { ...profile, preferences: { mode: 'dark' } }) as never;
  });
  const tree = await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await waitFor(() => expect(request).toHaveBeenCalledWith('/appearance?platform=mobile', 'first', undefined));
  current = { session: { token: 'second' }, scope: 'second', online: true, api: api('second') };
  await tree.rerender(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true));
  await act(async () => finishFirst(profile));
  expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true);
});

test('refresh requested during a save runs after the save completes', async () => {
  await mount();
  let finish!: (value: unknown) => void;
  jest.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await act(async () => refreshAppearance());
  const before = jest.mocked(request).mock.calls.length;
  await act(async () => finish({ preferences: { mode: 'dark' }, accessibility: profile.accessibility }));
  await waitFor(() => expect(jest.mocked(request).mock.calls.length).toBe(before + 3));
});

test('signing out ignores a late save and clears the visible theme', async () => {
  const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');
  jest.mocked(request).mockImplementation(async (path: string) => (path === '/appearance/sync' ? sync : { ...profile, preferences: { mode: 'dark' } }) as never);
  let current: any = { session: { token: 'token' }, scope: 'user-workspace', online: true, api: api('token') };
  jest.mocked(useSession).mockImplementation(() => current);
  const tree = await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await screen.findByLabelText('Chế độ: Tối');
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true));
  expect(setColorScheme).toHaveBeenCalledWith('dark');
  let finish!: (value: unknown) => void;
  jest.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  await fireEvent.press(screen.getByLabelText('Chế độ: Sáng'));
  current = { session: null, scope: '', online: true, api: api('') };
  await tree.rerender(<AppearanceProvider><Bridge /></AppearanceProvider>);
  expect(setColorScheme).toHaveBeenLastCalledWith('unspecified');
  await act(async () => finish({ preferences: { mode: 'dark' }, accessibility: profile.accessibility }));
  expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(false);
  setColorScheme.mockRestore();
});

test('a slow cache does not block startup or the server refresh indefinitely', async () => {
  jest.useFakeTimers();
  jest.mocked(cacheRead).mockImplementation(() => new Promise(() => {}));
  try {
    await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
    expect(screen.queryByLabelText('Chế độ: Sáng')).toBeNull();
    await act(async () => jest.advanceTimersByTime(400));
    await waitFor(() => expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true));
  } finally { jest.useRealTimers(); }
});

test('fetches fresh web-only fields before saving and announces success', async () => {
  const { AccessibilityInfo } = require('react-native');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  await mount();
  jest.mocked(request).mockImplementation(async (path: string, _token?: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return { preferences: JSON.parse(options.body as string), accessibility: profile.accessibility } as never;
    return (path === '/appearance/sync' ? sync : { ...profile, preferences: { mode: 'light', hiddenNav: ['new-web-value'] } }) as never;
  });
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await waitFor(() => expect(announce).toHaveBeenCalledWith('Đã lưu giao diện'));
  const put = jest.mocked(request).mock.calls.find(call => call[2]?.method === 'PUT');
  expect(JSON.parse(put![2]!.body as string).hiddenNav).toEqual(['new-web-value']);
  announce.mockRestore();
});

test('a missing sync endpoint hides scope controls without a retry error', async () => {
  const { ApiError } = require('../src/core/api');
  jest.mocked(cacheRead).mockResolvedValue({ value: { preferences: { mode: 'dark' }, separate: true, webSeparate: true }, updatedAt: 1 });
  jest.mocked(request).mockImplementation(async (path: string) => {
    if (path === '/appearance/sync') throw new ApiError(404, 'missing');
    return profile as never;
  });
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await screen.findByText('Máy chủ chưa hỗ trợ đồng bộ giao diện.');
  expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true);
  expect(screen.queryByLabelText('Đồng bộ với web')).toBeNull();
  expect(screen.queryByText('missing')).toBeNull();
  expect(screen.getByLabelText('Tương phản cao').props.accessibilityState.checked).toBe(true);
  expect(cacheWrite).toHaveBeenCalledWith('user-workspace', 'appearance.mobile.effective', {
    preferences: { mode: 'light', contrast: 'high', motion: 'reduced' }, separate: false, webSeparate: false,
  });
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await waitFor(() => expect(jest.mocked(request).mock.calls.some(call => call[0] === '/appearance?platform=mobile' && call[2]?.method === 'PUT')).toBe(true));
});

test('a missing sync endpoint with a null profile uses defaults without an error', async () => {
  const { ApiError } = require('../src/core/api');
  jest.mocked(request).mockImplementation(async (path: string) => {
    if (path === '/appearance/sync') throw new ApiError(404, 'missing');
    return null as never;
  });
  let latest: ReturnType<typeof useAppearanceSettings>;
  function Probe() { latest = useAppearanceSettings(); return <Bridge />; }
  await render(<AppearanceProvider><Probe /></AppearanceProvider>);
  await screen.findByText('Máy chủ chưa hỗ trợ đồng bộ giao diện.');
  expect(latest!.error).toBe('');
  expect(latest!.preferences).toEqual({});
  expect(screen.getByLabelText('Chế độ: Theo hệ thống').props.accessibilityState.checked).toBe(true);
  expect(screen.getByLabelText('Tương phản cao').props.accessibilityState.checked).toBe(false);
  expect(screen.queryByText('Thử tải lại')).toBeNull();
  expect(cacheWrite).toHaveBeenCalledWith('user-workspace', 'appearance.mobile.effective', { preferences: {}, separate: false, webSeparate: false });
});

test('a downgraded server drops cached scope before resetting the shared profile', async () => {
  const { ApiError } = require('../src/core/api');
  jest.mocked(cacheRead).mockResolvedValue({ value: { preferences: { mode: 'dark' }, separate: true, webSeparate: true }, updatedAt: 1 });
  jest.mocked(request).mockImplementation(async (path: string) => {
    if (path === '/appearance/sync') throw new ApiError(404, 'missing');
    return profile as never;
  });
  let latest: ReturnType<typeof useAppearanceSettings>;
  function Probe() { latest = useAppearanceSettings(); return <Bridge />; }
  await render(<AppearanceProvider><Probe /></AppearanceProvider>);
  await screen.findByText('Máy chủ chưa hỗ trợ đồng bộ giao diện.');
  expect(latest!.separate).toBe(false);
  expect(latest!.webSeparate).toBe(false);
  expect(screen.queryByText('Giao diện riêng của điện thoại sẽ được đặt lại.')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Khôi phục mặc định'));
  expect(alert.mock.calls.at(-1)![1]).toBe('Giao diện chung sẽ được đặt lại; cài đặt trợ năng cũng sẽ trở về mặc định trên mọi thiết bị.');
});

test('a null profile uses defaults and can be saved', async () => {
  jest.mocked(request).mockImplementation(async (path: string, _token?: string, options?: RequestInit) => {
    if (path === '/appearance/sync') return sync as never;
    return (options?.method === 'PUT' ? { preferences: JSON.parse(options.body as string), accessibility: null } : null) as never;
  });
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await waitFor(() => expect(screen.getByLabelText('Đồng bộ với web').props.accessibilityState.disabled).toBe(false));
  expect(screen.getByLabelText('Chế độ: Theo hệ thống').props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByLabelText('Chế độ: Tối'));
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true));
});

test('a server without either appearance endpoint keeps the cached look', async () => {
  const { ApiError } = require('../src/core/api');
  jest.mocked(cacheRead).mockResolvedValue({ value: { preferences: { mode: 'dark' }, separate: true, webSeparate: true }, updatedAt: 1 });
  jest.mocked(request).mockRejectedValue(new ApiError(404, 'missing'));
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await screen.findByText('Máy chủ chưa hỗ trợ đồng bộ giao diện.');
  expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true);
  expect(screen.queryByText('missing')).toBeNull();
});

test('scope stays disabled with cached metadata while offline', async () => {
  online = false;
  jest.mocked(cacheRead).mockResolvedValue({ value: { preferences: { mode: 'dark', accent: null }, separate: true, webSeparate: true }, updatedAt: 1 });
  await render(<AppearanceProvider><Bridge /></AppearanceProvider>);
  await screen.findByText('Đang tải trạng thái đồng bộ…');
  expect(screen.getByLabelText('Chỉ cho điện thoại').props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true);
});

test('a background refresh does not disable controls or replace unchanged preferences', async () => {
  let latest: ReturnType<typeof useAppearanceSettings>;
  function Probe() { latest = useAppearanceSettings(); return <Bridge />; }
  await render(<AppearanceProvider><Probe /></AppearanceProvider>);
  await waitFor(() => expect(screen.getByLabelText('Chế độ: Sáng').props.accessibilityState.checked).toBe(true));
  const original = latest!.preferences;
  let finish!: (value: unknown) => void;
  jest.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
  await act(async () => { void refreshAppearance(); });
  expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.disabled).toBe(false);
  await act(async () => { finish(profile); });
  await waitFor(() => expect(latest!.preferences).toBe(original));
});

test('only the first cache gates navigation and a late workspace cache can still apply', async () => {
  jest.useFakeTimers();
  let current = { session: { token: 'first' }, scope: 'first', online: true, api: api('first') };
  jest.mocked(useSession).mockImplementation(() => current as never);
  let finishCache!: (value: { value: unknown; updatedAt: number } | null) => void;
  let finishServer!: (value: unknown) => void;
  let mounts = 0, unmounts = 0;
  function Navigation() { React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []); return <Bridge />; }
  function Gate() { const value = useAppearanceSettings(); return value.cacheLoading ? null : <Navigation />; }
  jest.mocked(cacheRead).mockImplementation((scope: string) => scope === 'first' ? Promise.resolve(null) : new Promise(resolve => { finishCache = resolve; }));
  jest.mocked(request).mockImplementation(async (path: string, token?: string) => path === '/appearance/sync' ? sync as never : token === 'first' ? profile as never : await new Promise<unknown>(resolve => { finishServer = resolve; }) as never);
  try {
    const tree = await render(<AppearanceProvider><Gate /></AppearanceProvider>);
    await act(async () => {});
    expect(mounts).toBe(1);
    current = { session: { token: 'second' }, scope: 'second', online: true, api: api('second') };
    await tree.rerender(<AppearanceProvider><Gate /></AppearanceProvider>);
    expect(mounts).toBe(1); expect(unmounts).toBe(0);
    await act(async () => jest.advanceTimersByTime(400));
    await act(async () => finishCache({ value: { preferences: { mode: 'dark' }, separate: true, webSeparate: false }, updatedAt: 1 }));
    expect(screen.getByLabelText('Chế độ: Tối').props.accessibilityState.checked).toBe(true);
    await act(async () => finishServer(profile));
    expect(unmounts).toBe(0);
  } finally { jest.useRealTimers(); }
});
