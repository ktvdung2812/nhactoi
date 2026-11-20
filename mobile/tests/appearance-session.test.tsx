import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppearanceProvider, useAppearanceSettings } from '../src/core/appearance';
import { Providers, useSession, queryClient } from '../src/core/session';
import { ApiError, request } from '../src/core/api';
import { cacheClear } from '../src/core/cache';
import { offlineDelete, offlineRead, offlineUpdate } from '../src/core/offline-store';
import { enqueue } from '../src/core/offline-state';

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: jest.fn(() => () => {}) } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('../src/core/cache', () => ({ cacheRead: jest.fn(async () => null), cacheWrite: jest.fn(async () => {}), cacheClear: jest.fn(async () => {}) }));
jest.mock('../src/core/files', () => ({ clearTemporaryFiles: jest.fn(async () => {}) }));
jest.mock('../src/core/api', () => ({ API_URL: 'https://test.local', request: jest.fn(), errorMessage: (error: Error) => error.message, ApiError: class extends Error { status: number; constructor(code: number, message: string) { super(message); this.status = code; } } }));
const fixture = { token: 'bearer', expiresAt: '2099-01-01T00:00:00Z', verifiedAt: Date.now(), user: { id: 'appearance-test', name: 'User', email: 'test@test.local', role: 'owner' }, workspace: { id: 'a', name: 'A' }, subscription: { status: 'active', plan: 'team', currentPeriodEnd: '2099-01-01T00:00:00Z' } };
let session: ReturnType<typeof useSession>, appearance: ReturnType<typeof useAppearanceSettings>;
function Probe() { session = useSession(); appearance = useAppearanceSettings(); return null; }
afterEach(async () => { await cleanup(); queryClient.clear(); });
test.each([['/appearance?platform=mobile', 403], ['/appearance?platform=mobile', 404], ['/appearance/sync', 403], ['/appearance/sync', 404]] as const)('%s error %i does not cancel other requests, quarantine drafts, or clear cache', async (failedPath, status) => {
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  jest.mocked(request).mockReset();
  jest.mocked(request).mockImplementation(async path => {
    if (path === '/mobile/auth/login') return fixture as never;
    if (path === failedPath) throw new ApiError(status, 'appearance failure');
    if (path === '/appearance/sync') return { web: { separate: false }, mobile: { separate: false } } as never;
    if (path.startsWith('/appearance')) return { preferences: {}, accessibility: null, separate: false } as never;
    return {} as never;
  });
  await render(<Providers><AppearanceProvider><Probe /></AppearanceProvider></Providers>);
  await waitFor(() => expect(session.loading).toBe(false));
  await act(async () => session.login('user', 'password'));
  const scope = session.scope;
  await offlineDelete(scope);
  await offlineUpdate(scope, state => { enqueue(state, { id: 'pending', path: '/tasks', method: 'POST', body: { title: 'Draft' } }); });
  jest.mocked(cacheClear).mockClear();
  let complete!: (value: unknown) => void;
  jest.mocked(request).mockImplementation(async path => {
    if (path === '/unrelated') return await new Promise<unknown>(resolve => { complete = resolve; }) as never;
    if (path === failedPath) throw new ApiError(status, 'appearance failure');
    if (path === '/appearance/sync') return { web: { separate: false }, mobile: { separate: false } } as never;
    if (path.startsWith('/appearance')) return { preferences: {}, accessibility: null, separate: false } as never;
    return {} as never;
  });
  let unrelated!: Promise<unknown>;
  await act(async () => { unrelated = session.api('/unrelated'); await appearance.refresh(); });
  await act(async () => { complete({ ok: true }); await expect(unrelated).resolves.toEqual({ ok: true }); });
  const state = await offlineRead(scope);
  expect(state.denied?.['*']).toBeFalsy();
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0].status).not.toBe('blocked');
  expect(cacheClear).not.toHaveBeenCalled();
  await offlineDelete(scope);
});

test.each([403, 404])('mutation failures with status %i preserve drafts and cache through Providers', async status => {
  jest.mocked(request).mockReset();
  jest.mocked(request).mockImplementation(async path => {
    if (path === '/mobile/auth/login') return fixture as never;
    if (path === '/appearance/sync') return { web: { separate: false }, mobile: { separate: false } } as never;
    if (path.startsWith('/appearance')) return { preferences: { mode: 'light' }, accessibility: null, separate: false } as never;
    return {} as never;
  });
  await render(<Providers><AppearanceProvider><Probe /></AppearanceProvider></Providers>);
  await waitFor(() => expect(session.loading).toBe(false));
  await act(async () => session.login('user', 'password'));
  await waitFor(() => expect(appearance.scopeKnown).toBe(true));
  const scope = session.scope;
  await offlineDelete(scope);
  await offlineUpdate(scope, state => {
    enqueue(state, { id: 'pending', path: '/tasks', method: 'POST', body: { title: 'Draft' } });
    state.drafts['task-form:new'] = { title: 'Saved draft' };
  });
  jest.mocked(cacheClear).mockClear();
  for (const [action, failedMethod] of [['save', 'GET'], ['save', 'PUT'], ['reset', 'DELETE'], ['setSeparate', 'PUT']] as const) {
    const target = action === 'setSeparate' ? '/appearance/sync' : '/appearance?platform=mobile';
    jest.mocked(request).mockImplementation(async (path, _token, options) => {
      if (path === target && (options?.method || 'GET') === failedMethod) throw new ApiError(status, `${action} failure`);
      if (path === '/appearance/sync') return { web: { separate: false }, mobile: { separate: false } } as never;
      if (path.startsWith('/appearance')) return { preferences: { mode: 'light' }, accessibility: null, separate: false } as never;
      return {} as never;
    });
    await act(async () => {
      if (action === 'save') await appearance.save({ mode: 'dark' });
      else if (action === 'reset') await appearance.reset();
      else await appearance.setSeparate(true);
    });
    expect(appearance.error).toBe(`${action} failure`);
    const state = await offlineRead(scope);
    expect(state.denied?.['*']).toBeFalsy();
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].status).not.toBe('blocked');
    expect(await session.readDraft('task-form:new')).toEqual({ title: 'Saved draft' });
    expect(cacheClear).not.toHaveBeenCalled();
  }
  await offlineDelete(scope);
});
