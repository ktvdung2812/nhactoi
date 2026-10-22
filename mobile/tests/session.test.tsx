import React from "react";
import {offlineRead,offlineDelete} from "../src/core/offline-store";
import { act, render, waitFor, cleanup } from "@testing-library/react-native";
import { Providers, useSession, useResource, queryClient } from "../src/core/session";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { request, ApiError } from "../src/core/api";
import { cacheWrite, cacheClear } from "../src/core/cache";
import * as SecureStore from "expo-secure-store";
import type { Session } from "../src/core/types";
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => {}) },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../src/core/cache", () => ({
  cacheRead: jest.fn(async () => null),
  cacheWrite: jest.fn(async () => {}),
  cacheClear: jest.fn(async () => {}),
}));
jest.mock("../src/core/files", () => ({
  clearTemporaryFiles: jest.fn(async () => {}),
}));
jest.mock("../src/core/api", () => ({
  API_URL: "https://test.local",
  request: jest.fn(),
  ApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
const fixture: Session = {
  token: "bearer",
  expiresAt: "2099-01-01T00:00:00Z",
  verifiedAt: Date.now(),
  user: { id: "u", name: "User", email: "test@test.local", role: "owner" },
  workspace: { id: "a", name: "A" },
  subscription: {
    status: "active",
    plan: "team",
    currentPeriodEnd: "2099-01-01T00:00:00Z",
  },
};
let context: ReturnType<typeof useSession>;
function Probe() {
  context = useSession();
  return null;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const transport = jest.mocked(request);
beforeEach(() => {
  // Session changes clear the cache while old observers are still mounted.
  // Their later unmount can schedule five-minute GC timers on removed queries.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
  });
  transport.mockReset();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});
afterEach(async () => {
  await cleanup();
  queryClient.clear();
});
async function signedIn(children?: React.ReactNode) {
  await render(
    <Providers>
      <Probe />
      {children}
    </Providers>,
  );
  await waitFor(() => expect(context.loading).toBe(false));
  transport.mockResolvedValueOnce(fixture);
  await act(async () => context.login("user", "password"));
}

test("reconnect refreshes active service and notification queries after session verification", async () => {
  function Resources() {
    useResource("/services");
    useResource("/mobile/notifications?page=1");
    return null;
  }
  transport.mockImplementation((path) => Promise.resolve(path.includes("auth/login") || path === "/me" ? fixture : { revision: 1 }));
  await signedIn(<Resources />);
  await waitFor(() => expect(queryClient.getQueryData([context.scope, "/services"])).toBeDefined());
  const listener = jest.mocked(NetInfo.addEventListener).mock.calls.at(-1)![0];
  await act(async () => listener({ isConnected: false } as never));
  transport.mockClear();
  transport.mockImplementation((path) => Promise.resolve(path === "/me" ? fixture : { revision: 2 }));
  await act(async () => listener({ isConnected: true, isInternetReachable: true } as never));
  await waitFor(() => {
    for (const path of ["/services", "/mobile/notifications?page=1"])
      expect(queryClient.getQueryData([context.scope, path])).toMatchObject({ value: { revision: 2 } });
  });
});

test("foreground polling refreshes active resources and pauses in background", async () => {
  jest.useFakeTimers();
  const originalState = AppState.currentState;
  AppState.currentState = "active";
  function Resources() { useResource("/services"); return null; }
  try {
    transport.mockImplementation((path) => Promise.resolve(path.includes("auth/login") || path === "/me" ? fixture : { revision: 1 }));
    await signedIn(<Resources />);
    transport.mockClear();
    await act(async () => jest.advanceTimersByTime(30000));
    expect(transport.mock.calls.some(([path]) => path === "/services")).toBe(true);
    AppState.currentState = "background";
    transport.mockClear();
    await act(async () => jest.advanceTimersByTime(30000));
    expect(transport).not.toHaveBeenCalled();
  } finally { AppState.currentState = originalState; jest.useRealTimers(); }
});

test("a canceled older read cannot overwrite the cache populated by a newer response", async () => {
  await signedIn();
  const delayed = deferred<unknown>(), controller = new AbortController();
  transport.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce({ tasks: [{ id: "new" }] });
  const older = context.read("/tasks", controller.signal);
  const rejected = expect(older).rejects.toMatchObject({ status: 499 });
  await waitFor(()=>expect(transport.mock.calls.filter(([path])=>path==="/tasks")).toHaveLength(1));
  controller.abort();
  await act(async () => { await context.read("/tasks"); });
  await act(async () => { delayed.resolve({ tasks: [{ id: "old" }] }); await rejected; });
  expect(cacheWrite).toHaveBeenCalledTimes(1);
  expect(cacheWrite).toHaveBeenLastCalledWith(context.scope, "/tasks", { tasks: [{ id: "new" }] });
});

test("mobile registration stores the returned bearer session", async () => {
  await render(
    <Providers>
      <Probe />
    </Providers>,
  );
  await waitFor(() => expect(context.loading).toBe(false));
  const registered = { ...fixture, token: "registered-bearer" };
  transport.mockResolvedValueOnce(registered);

  await act(async () =>
    context.register({
      name: "Người dùng mới",
      email: "new@example.local",
      password: "password123",
      workspaceName: "Không gian mới",
      industry: "Dịch vụ",
    }),
  );

  expect(transport).toHaveBeenCalledWith("/mobile/auth/register", undefined, {
    method: "POST",
    body: JSON.stringify({
      name: "Người dùng mới",
      email: "new@example.local",
      password: "password123",
      workspaceName: "Không gian mới",
      industry: "Dịch vụ",
    }),
  });
  expect(context.session?.token).toBe("registered-bearer");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "nhactoi.session",
    expect.stringContaining('"token":"registered-bearer"'),
  );
});

test("workspace transition blocks new reads and ignores an old /me response", async () => {
  await signedIn();
  const oldMe = deferred<Session>(),
    switchResponse = deferred<Session>();
  transport.mockImplementation((path) => {
    if (path === "/me") return oldMe.promise;
    if (path === "/mobile/workspaces/switch") return switchResponse.promise;
    return Promise.resolve({ tasks: [{ id: "task-b" }] });
  });
  let refresh!: Promise<void>, switching!: Promise<void>;
  await act(async () => {
    refresh = context.refresh();
    switching = context.switchWorkspace("b");
  });
  await expect(context.read("/tasks")).rejects.toMatchObject({ status: 409 });
  expect(cacheWrite).not.toHaveBeenCalled();
  await act(async () => {
    switchResponse.resolve({ ...fixture, workspace: { id: "b", name: "B" } });
    await switching;
  });
  await act(async () => {
    oldMe.resolve(fixture);
    await refresh;
  });
  expect(context.session?.workspace.id).toBe("b");
  await act(async () => {
    await context.read("/tasks");
  });
  expect(cacheWrite).toHaveBeenLastCalledWith(
    JSON.stringify(["https://test.local", "u", "b"]),
    "/tasks",
    { tasks: [{ id: "task-b" }] },
  );
});
test("a delayed detail response cannot restore cache after a permission denial", async () => {
  await signedIn();
  const delayed = deferred<unknown>();
  transport.mockImplementation((path) =>
    path === "/tasks/old/detail"
      ? delayed.promise
      : Promise.reject(new ApiError(403, "revoked")),
  );
  const read = context.read("/tasks/old/detail");
  const rejection = expect(read).rejects.toMatchObject({ status: 499 });
  await act(async () => {
    await expect(context.api("/tasks/old/collaboration")).rejects.toMatchObject(
      { status: 403 },
    );
  });
  expect(cacheClear).toHaveBeenCalledWith(
    JSON.stringify(["https://test.local", "u", "a"]),
  );
  await act(async () => {
    delayed.resolve({ task: { title: "revoked title" } });
    await rejection;
  });
  expect(cacheWrite).not.toHaveBeenCalled();
});
test("lost workspace switch response logs out instead of retaining uncertain cache scope", async () => {
  await signedIn();
  transport.mockRejectedValue(new ApiError(0, "connection lost"));
  await act(async () => {
    await expect(context.switchWorkspace("b")).rejects.toMatchObject({
      status: 0,
    });
  });
  expect(context.session).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("nhactoi.session");
});
test("expired offline permission hides content until verification and clears on server failure", async () => {
  await signedIn();
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 86400001);
  let reject!: (reason: unknown) => void;
  transport.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  let refresh!: Promise<void>;
  try {
    await act(async () => {
      refresh = context.refresh();
    });
    expect(context.loading).toBe(true);
    await act(async () => {
      reject(new ApiError(503, "unavailable"));
      await refresh;
    });
    expect(context.loading).toBe(false);
    expect(context.session).toBeNull();
    expect(cacheClear).toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});

test('TC-W4-T02/03/04: offline task writes persist, comment stays outside queue, logout requires an explicit draft choice', async()=>{
  await signedIn();
  await offlineDelete(context.scope);
  const listener=jest.mocked(NetInfo.addEventListener).mock.calls.at(-1)![0];
  await act(async()=>listener({isConnected:false} as never));
  transport.mockClear();
  let queued:unknown;
  await act(async()=>{queued=await context.api('/tasks',{method:'POST',body:JSON.stringify({title:'Offline task'})});});
  expect(queued).toMatchObject({pending:true});
  expect(transport).not.toHaveBeenCalled();
  expect((await offlineRead(context.scope)).operations).toHaveLength(1);
  await expect(context.api('/tasks/t/comments',{method:'POST',body:JSON.stringify({body:'Do not send'})})).rejects.toMatchObject({status:0});
  await act(async()=>{await context.saveDraft('comment:t',{body:'Keep encrypted'});});
  const scope=context.scope;
  await expect(context.logout()).rejects.toThrow('Còn nháp');
  await act(async()=>context.logout('keep'));
  expect(context.session).toBeNull();
  expect((await offlineRead(scope)).drafts['comment:t']).toEqual({body:'Keep encrypted'});
  expect((await offlineRead(scope)).operations).toHaveLength(1);
  await offlineDelete(scope);
});

test('TC-W4-T04-E/G: reconnect verifies the session before replay; revocation retains encrypted operation without sending it',async()=>{
  await signedIn();
  await offlineDelete(context.scope);
  const listener=jest.mocked(NetInfo.addEventListener).mock.calls.at(-1)![0];
  await act(async()=>listener({isConnected:false} as never));
  await act(async()=>{await context.api('/tasks',{method:'POST',body:JSON.stringify({title:'Pending private title'})});});
  const scope=context.scope;transport.mockClear();transport.mockRejectedValue(new ApiError(401,'Revoked'));
  await act(async()=>listener({isConnected:true,isInternetReachable:true} as never));
  await waitFor(()=>expect(context.session).toBeNull());
  expect(transport.mock.calls.filter(([path])=>path==='/tasks')).toHaveLength(0);
  expect((await offlineRead(scope)).operations).toHaveLength(1);
  await offlineDelete(scope);
});

test('personal page changes keep encrypted pending-plan context and never send its UI snapshot', async () => {
  await signedIn();
  const scope=context.scope!;
  await offlineDelete(scope);
  const listener=jest.mocked(NetInfo.addEventListener).mock.calls.at(-1)![0];
  await act(async()=>listener({isConnected:false} as never));
  const snapshot={id:'plan-task',title:'Keep across pages',status:'todo',assigneeId:'u',dueAt:null,plannedDate:'2028-02-28',planRevision:'p1'};
  await act(async()=>{await context.api('/tasks/plan-task/plan',{method:'PATCH',body:JSON.stringify({_offlineTask:snapshot,expectedRevision:'p1',plannedDate:'2028-02-29'})});});
  const queued=(await offlineRead(scope)).operations[0];
  expect(queued.snapshot).toEqual(snapshot);expect(queued.body).toEqual({expectedRevision:'p1',plannedDate:'2028-02-29'});
  const read=await context.read<{tasks:{id:string;plannedDate:string;pending:boolean}[]}>('/personal-tasks?view=upcoming&date=2028-02-28&page=1&pageSize=50');
  expect(read.cached).toBe(true);expect(read.value.tasks).toEqual([expect.objectContaining({id:'plan-task',plannedDate:'2028-02-29',pending:true})]);
  transport.mockImplementation(path=>Promise.resolve(path==='/me'?fixture:{planRevision:'p2'}));
  await act(async()=>listener({isConnected:true,isInternetReachable:true} as never));
  await waitFor(async()=>expect((await offlineRead(scope)).operations).toHaveLength(0));
  const call=transport.mock.calls.find(([path])=>path==='/tasks/plan-task/plan');
  expect(JSON.parse(String(call?.[2]?.body))).toEqual({expectedRevision:'p1',plannedDate:'2028-02-29',operationId:queued.id});
  await offlineDelete(scope);
});
