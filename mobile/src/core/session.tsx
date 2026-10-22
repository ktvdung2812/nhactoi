import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as SecureStore from "expo-secure-store";
import {
  QueryClient,
  useQuery,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ApiError, API_URL, request } from "./api";
import { cacheClear, cacheRead, cacheWrite } from "./cache";
import { cacheScope, canReadOffline, isWritable } from "./policy";
import type { Session } from "./types";
import { serialQueue } from "./serial";
import { clearTemporaryFiles } from "./files";
import * as Crypto from "expo-crypto";
import {offlineRead,offlineUpdate,offlineDelete} from './offline-store';
import {queueable,enqueue,projectOffline,resolveOperation,type Payload,type Operation} from './offline-state';
import {replayOffline,pendingCount} from './offline-sync';
const persistSession = serialQueue();
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000 },
    mutations: { retry: false },
  },
});
const SESSION_KEY = "nhactoi.session";
const REVOCATIONS_KEY = "nhactoi.pending-logouts";
let draining: Promise<void> | undefined;
function drainRevocations() {
  return (draining ??= (async () => {
    const stored = await SecureStore.getItemAsync(REVOCATIONS_KEY);
    const pending: string[] = stored ? JSON.parse(stored) : [];
    const remaining: string[] = [];
    for (const token of pending) {
      try {
        await request("/mobile/auth/logout", token, { method: "POST" });
      } catch (e) {
        if (!(e instanceof ApiError && [401, 404].includes(e.status)))
          remaining.push(token);
      }
    }
    await SecureStore.setItemAsync(REVOCATIONS_KEY, JSON.stringify(remaining));
  })().finally(() => {
    draining = undefined;
  }));
}
type Context = {
  session: Session | null;
  loading: boolean;
  online: boolean;
  writable: boolean;
  taskWritable: boolean;
  pending: Operation[];
  offlineError: string;
  sync: () => Promise<void>;
  saveDraft: (key:string,value:Payload|null) => Promise<void>;
  readDraft: (key:string) => Promise<Payload|undefined>;
  inspectPending: (id:string) => Promise<void>;
  recoverPending: (id:string) => Promise<string|undefined>;
  resolvePending: (id:string,choice:'server'|'local') => Promise<void>;
  scope: string;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    workspaceName: string;
    industry?: string;
  }) => Promise<void>;
  logout: (choice?: "sync"|"keep"|"delete") => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  read: <T>(
    path: string,
    signal?: AbortSignal,
  ) => Promise<{ value: T; cached: boolean; updatedAt: number }>;
};
const SessionContext = createContext<Context | null>(null);
export const useSession = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("Thiếu phiên ứng dụng");
  return ctx;
};
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(true),
    [switching, setSwitching] = useState(false),
    [error, setError] = useState(""),
    [pending,setPending]=useState<Operation[]>([]),
    [offlineError,setOfflineError]=useState("");
  const current = useRef<Session | null>(null),
    epoch = useRef(0),
    transitioning = useRef(false),
    controllers = useRef(new Set<AbortController>()),
    permissionClock=useRef<{wall:number;monotonic:number}|null>(null);
  const permissionNow=useCallback(()=>{const clock=permissionClock.current;return clock?Math.max(Date.now(),clock.wall+Math.max(0,performance.now()-clock.monotonic)):Date.now();},[]);
  const update = useCallback(async (s: Session | null) => {
    if(s && s.verifiedAt!==current.current?.verifiedAt)permissionClock.current={wall:Date.now(),monotonic:performance.now()};
    current.current = s;
    setSession(s);
    if (s)
      await persistSession(() =>
        SecureStore.setItemAsync(
          SESSION_KEY,
          JSON.stringify({ ...s, origin: API_URL }),
        ),
      );
    else await persistSession(() => SecureStore.deleteItemAsync(SESSION_KEY));
  }, []);
  const cancel = useCallback(() => {
    epoch.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    void clearTemporaryFiles().catch(() => {});
    queryClient.clear();
  }, []);
  const clear = useCallback(async () => {
    const prior=current.current;
    cancel();
    if(prior)void offlineUpdate(cacheScope(API_URL,prior.user.id,prior.workspace.id),state=>{for(const op of state.operations)delete op.server;}).catch(()=>{});
    current.current = null;
    transitioning.current = false;
    setSwitching(false);
    setSession(null);
    setPending([]);
    await persistSession(() => SecureStore.deleteItemAsync(SESSION_KEY));
    await cacheClear();
    await clearTemporaryFiles();
  }, [cancel]);
  const loadPending=useCallback(async(s:Session)=>{
    const version=epoch.current;
    try { const state=await offlineRead(cacheScope(API_URL,s.user.id,s.workspace.id));
      if(version===epoch.current){setPending(state.operations);setOfflineError('');}
    }catch {if(version===epoch.current)setOfflineError('Không mở được kho nháp mã hóa. Dữ liệu được giữ nguyên.');}
  },[]);
  const flush=useCallback(async(s:Session)=>{
    const version=epoch.current, scope=cacheScope(API_URL,s.user.id,s.workspace.id);
    if(!isWritable(s,true,permissionNow()))return;
    await replayOffline(scope,(path,options)=>request<Payload>(path,s.token,options),()=>version===epoch.current && !!current.current && canReadOffline(current.current,permissionNow()) && !transitioning.current);
    if(version===epoch.current)await loadPending(s);
  },[loadPending,permissionNow]);
  const refresh = useCallback(async () => {
    void drainRevocations().catch(() => {});
    const before = current.current;
    if (!before || transitioning.current) return;
    const version = epoch.current;
    const mustVerify = !canReadOffline(before,permissionNow());
    if (mustVerify) setLoading(true);
    try {
      const me = await request<
        Omit<Session, "token" | "expiresAt" | "verifiedAt">
      >("/me", before.token);
      if (version !== epoch.current) return;
      if (me.workspace.id !== before.workspace.id) cancel();
      permissionClock.current={wall:Date.now(),monotonic:performance.now()};
      const verified={ ...before, ...me, verifiedAt: Date.now(), lastSeenAt: Date.now() };
      await update(verified);
      setOnline(true);
      setError("");
      await loadPending(verified);
      try {await flush(verified);} catch(e) {
        if(e instanceof ApiError && [401,403,423].includes(e.status))throw e;
        if(e instanceof ApiError && e.status===0)setOnline(false);
        setOfflineError(e instanceof Error?e.message:'Chưa đồng bộ được; dữ liệu được giữ nguyên.');
        await loadPending(verified);
      }
      await queryClient.invalidateQueries(
        { queryKey: [cacheScope(API_URL, me.user.id, me.workspace.id)] },
        { cancelRefetch: false },
      );
    } catch (e) {
      if (version !== epoch.current) return;
      if (mustVerify) {
        await clear();
        setError("Cần kết nối lại để xác minh quyền truy cập.");
      } else if (e instanceof ApiError && [401, 403, 423].includes(e.status)) {
        await clear();
        setError(e.message);
      } else if (e instanceof ApiError && e.status === 0) {
        setOnline(false);
        if (canReadOffline(before,permissionNow())) {
          await update({...before,lastSeenAt:permissionNow()});
          await loadPending(before);
        }
        if (!canReadOffline(before,permissionNow())) {
          await clear();
          setError("Cần kết nối lại để xác minh quyền truy cập.");
        }
      } else setError(e instanceof Error ? e.message : "Không tải được phiên.");
    } finally {
      if (mustVerify) setLoading(false);
    }
  }, [cancel, clear, update, flush, loadPending,permissionNow]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await clearTemporaryFiles();
        const stored = await SecureStore.getItemAsync(SESSION_KEY);
        if (stored && live) {
          const value = JSON.parse(stored);
          if (
            value.origin === API_URL &&
            Date.parse(value.expiresAt) > Date.now()
          ) {
            permissionClock.current={wall:Date.now(),monotonic:performance.now()};
            current.current = value;
            setSession(value);
            await refresh();
          } else await clear();
        }
      } catch {
        if (live)
          setError("Không mở được dữ liệu đã lưu. Vui lòng đăng nhập lại.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [clear, refresh]);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected !== false && state.isInternetReachable !== false;
      setOnline(connected);
      if (connected) void refresh();
    });
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 30000);
    return () => {
      unsubscribe();
      listener.remove();
      clearInterval(interval);
    };
  }, [refresh]);
  const api = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      path=path.replace(/local%3A/gi,'local:');
      const s = current.current;
      if (!s) throw new ApiError(401, "Vui lòng đăng nhập.");
      if (transitioning.current)
        throw new ApiError(409, "Đang chuyển doanh nghiệp. Vui lòng chờ.");
      const method=(options.method||'GET').toUpperCase();
      if(!['GET','HEAD'].includes(method) && queueable(path,method)) {
        if(!canReadOffline(s,permissionNow()) || !isWritable(s,true,permissionNow()))throw new ApiError(402,'Quyền ghi đã hết hạn. Nháp được giữ nguyên.');
        const version=epoch.current, scope=cacheScope(API_URL,s.user.id,s.workspace.id);
        const body=options.body ? JSON.parse(String(options.body)) : {};
        const retryId=body._offlineOperationId;delete body._offlineOperationId;
        const snapshot=body._offlineTask;delete body._offlineTask;
        // Cross-project moves are never queued, including a form's hidden project field.
        if(method==='PATCH' && /^\/tasks\/[^/]+$/.test(path)) {
          const cached=await cacheRead<{task:{projectId?:string;teamId?:string|null}}>(scope,path) || await cacheRead<{task:{projectId?:string;teamId?:string|null}}>(scope,path+'/detail');
          if(!cached?.value.task && !path.includes('/local:') && (body.projectId!==undefined||body.teamId!==undefined))throw new ApiError(409,'Cần tải dự án hiện tại trước khi sửa công việc.');
          if(cached?.value.task && ((body.projectId && body.projectId!==cached.value.task.projectId) || (body.teamId!==undefined && body.teamId!==cached.value.task.teamId)))throw new ApiError(400,'Chuyển dự án hoặc team cần thao tác trực tuyến riêng.');
        }
        const operation=await offlineUpdate(scope,state=>{
          if(retryId){const previous=state.operations.find(op=>op.id===retryId);if(!previous||!['blocked','conflict'].includes(previous.status))throw new Error('Bản nháp này đã được xử lý hoặc còn đang gửi.');
            return resolveOperation(state,retryId,'local',Crypto.randomUUID(),previous.server||{},body.expectedRevision,body)!;
          }
          const queued=enqueue(state,{id:Crypto.randomUUID(),path,method,body});
          if(queued.resource.startsWith('plan:')&&snapshot&&snapshot.id===path.split('/')[2])queued.snapshot=snapshot;
          return queued;
        });
        if(version!==epoch.current)throw new ApiError(499,'Phiên làm việc đã thay đổi. Nháp được giữ trong tài khoản cũ.');
        await loadPending(s);
        // Verification precedes every reconnect replay, including network transitions
        // for which NetInfo has not yet emitted a reachability event.
        if(online)await refresh();
        if(version!==epoch.current || !current.current)throw new ApiError(499,'Phiên làm việc đã thay đổi. Nháp được giữ nguyên.');
        const state=await offlineRead(scope);
        const result=state.results[operation.id];
        if(result)return result as T;
        const remaining=state.operations.find(op=>op.id===operation.id);
        if(!remaining)return {ok:true,task:operation.localId?{id:state.ids[operation.localId]}:undefined} as T;
        if(remaining?.status==='blocked' || remaining?.status==='conflict')throw new ApiError(remaining.status==='conflict'?409:400,remaining.error||'Nháp cần được xử lý trong Hàng đợi.');
        return {pending:true,operationId:operation.id,task:{id:operation.localId,...body}} as T;
      }
      if(!['GET','HEAD'].includes(method) && !online)throw new ApiError(0,'Thao tác này cần kết nối mạng; chưa được đưa vào hàng đợi.');
      const version = epoch.current,
        controller = new AbortController();
      controllers.current.add(controller);
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort);
      try {
        if (options.signal?.aborted) throw new ApiError(499, "Yêu cầu đã hủy.");
        const value = await request<T>(path, s.token, {
          ...options,
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new ApiError(499, "Yêu cầu đã hủy.");
        if (version !== epoch.current)
          throw new ApiError(499, "Doanh nghiệp đã thay đổi.");
        setOnline(true);
        return value;
      } catch (e) {
        if (version === epoch.current && e instanceof ApiError) {
          if (e.status === 0) setOnline(false);
          if ([401, 423].includes(e.status)) await clear();
          if ([403, 404].includes(e.status)) {
            cancel();
            const scope=cacheScope(API_URL,s.user.id,s.workspace.id), taskId=path.startsWith('/tasks/')?path.split('/')[2]:'*';
            await offlineUpdate(scope,state=>{
              state.denied||={};state.denied[taskId]=true;for(const key of Object.keys(state.denied))if(key.startsWith('allow:'))delete state.denied[key];
              for(const op of state.operations)if(taskId==='*'||op.path.split('/')[2]===taskId){op.status='blocked';op.error='Quyền truy cập đã thay đổi; nháp được cách ly.';delete op.server;}
            });
            await loadPending(s);
            await cacheClear(scope);
          }
        }
        throw e;
      } finally {
        controllers.current.delete(controller);
        options.signal?.removeEventListener("abort", abort);
      }
    },
    [clear, cancel, online, refresh, loadPending,permissionNow],
  );
  const read = useCallback(
    async <T,>(path: string, signal?: AbortSignal) => {
      path=path.replace(/local%3A/gi,'local:');
      const s = current.current;
      if (!s) throw new ApiError(401, "Vui lòng đăng nhập.");
      const version = epoch.current;
      const scope = cacheScope(API_URL, s.user.id, s.workspace.id);
      if(!canReadOffline(s,permissionNow())) {await clear();throw new ApiError(401,'Cần kết nối lại để xác minh quyền. Nháp mã hóa được giữ lại.');}
      const state=await offlineRead(scope);
      if(path.includes('/local:')) {
        const id=path.split('/')[2];
        if(state.ids[id])path=path.replace(id,state.ids[id]);
        else {const value=projectOffline(state,path,null,s.user.id) as T;return {value,cached:true,updatedAt:Date.now()};}
      }
      if(!online) {
        const cached=await cacheRead<T>(scope,path);
        if(version!==epoch.current)throw new ApiError(499,'Phiên làm việc đã thay đổi.');
        if(cached && Date.now()-cached.updatedAt<86400000)return {...cached,value:projectOffline(state,path,cached.value,s.user.id) as T,cached:true};
        if(['/tasks','/personal-tasks'].includes(path.split('?')[0])&&state.operations.some(op=>op.path==='/tasks'||op.snapshot))return {value:projectOffline(state,path,{tasks:[]},s.user.id) as T,cached:true,updatedAt:Date.now()};
        throw new ApiError(0,'Chưa có bản tải trên thiết bị. Kết nối mạng để tải dữ liệu.');
      }
      try {
        const value = await api<T>(path, { signal });
        if (version !== epoch.current)
          throw new ApiError(499, "Doanh nghiệp đã thay đổi.");
        await cacheWrite(scope, path, value);
        if (version !== epoch.current)
          throw new ApiError(499, "Phiên làm việc đã thay đổi.");
        return { value:projectOffline(state,path,value,s.user.id) as T, cached: false, updatedAt: Date.now() };
      } catch (e) {
        if (e instanceof ApiError && e.status === 0 && canReadOffline(s,permissionNow())) {
          const cached = await cacheRead<T>(scope, path);
          if (
            cached &&
            version === epoch.current &&
            Date.now() - cached.updatedAt < 86400000
          )
            return { ...cached, value:projectOffline(state,path,cached.value,s.user.id) as T, cached: true };
        }
        throw e;
      }
    },
    [api,clear,online,permissionNow],
  );
  const login = async (email: string, password: string) => {
    cancel();
    const version = epoch.current;
    await cacheClear();
    const value = await request<Session>("/mobile/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (version !== epoch.current)
      throw new ApiError(499, "Yêu cầu đăng nhập đã hủy.");
    await update({ ...value, verifiedAt: Date.now(), lastSeenAt:Date.now() });
    await loadPending(value);
    setOnline(true);
    setError("");
  };
  const register = async (input: {
    name: string;
    email: string;
    password: string;
    workspaceName: string;
    industry?: string;
  }) => {
    cancel();
    const version = epoch.current;
    await cacheClear();
    const value = await request<Session>("/mobile/auth/register", undefined, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (version !== epoch.current)
      throw new ApiError(499, "Yêu cầu đăng ký đã hủy.");
    await update({ ...value, verifiedAt: Date.now(), lastSeenAt:Date.now() });
    await loadPending(value);
    setOnline(true);
    setError("");
  };
  const logout = async (choice?: 'sync'|'keep'|'delete') => {
    const s=current.current;
    if(s) {
      const scope=cacheScope(API_URL,s.user.id,s.workspace.id);
      const count=await pendingCount(scope);
      if(count && !choice)throw new Error('Còn nháp chưa gửi. Chọn đồng bộ, giữ mã hóa hoặc xóa rõ ràng.');
      if(choice==='sync') {
        await refresh();
        if(!current.current || await pendingCount(scope))throw new Error('Chưa đồng bộ hết hoặc còn nháp cần xử lý. Chưa đăng xuất.');
      }
      if(choice==='delete')await offlineDelete(scope);
    }
    const token = current.current?.token;
    if (token) {
      await draining?.catch(() => {});
      const stored = await SecureStore.getItemAsync(REVOCATIONS_KEY);
      const pending: string[] = stored ? JSON.parse(stored) : [];
      await SecureStore.setItemAsync(
        REVOCATIONS_KEY,
        JSON.stringify([...new Set([...pending, token])]),
      );
    }
    await clear();
    void drainRevocations().catch(() => {});
  };
  const switchWorkspace = async (id: string) => {
    if (transitioning.current)
      throw new ApiError(409, "Đang chuyển doanh nghiệp.");
    if (!online) throw new ApiError(0, "Cần kết nối để chuyển doanh nghiệp.");
    const s = current.current;
    if (!s || s.workspace.id === id) return;
    transitioning.current = true;
    setSwitching(true);
    cancel();
    const version = epoch.current;
    try {
      const value = await request<Session>(
        "/mobile/workspaces/switch",
        s.token,
        {
          method: "POST",
          body: JSON.stringify({ workspaceId: id }),
        },
      );
      if (version !== epoch.current)
        throw new ApiError(499, "Yêu cầu chuyển đã hủy.");
      cancel();
      await update({
        ...s,
        ...value,
        token: value.token || s.token,
        expiresAt: value.expiresAt || s.expiresAt,
        verifiedAt: Date.now(),
      });
    } catch (error) {
      // The server may have switched before the response was lost. Never retain the old
      // cache scope with a token whose current server workspace is unknown.
      if (version === epoch.current) await clear();
      throw error;
    } finally {
      transitioning.current = false;
      setSwitching(false);
      void queryClient.invalidateQueries();
    }
  };
  const saveDraft=async(key:string,value:Payload|null)=>{
    const s=current.current;if(!s || !canReadOffline(s,permissionNow()))throw new Error('Cần xác minh lại quyền trước khi lưu nháp.');
    await offlineUpdate(cacheScope(API_URL,s.user.id,s.workspace.id),state=>{if(value===null)delete state.drafts[key];else state.drafts[key]=value;});
  };
  const readDraft=async(key:string)=>{
    const s=current.current;if(!s || !canReadOffline(s,permissionNow()))return;
    const state=await offlineRead(cacheScope(API_URL,s.user.id,s.workspace.id));
    const taskId=key.replace(/^(comment:|task-form:)/,'');
    if((state.denied?.['*']&&!state.denied?.[`allow:${taskId}`])||state.denied?.[taskId])throw new Error('Nháp đang cách ly do quyền đã thay đổi. Cần kiểm tra quyền trong hàng đợi.');
    return state.drafts[key];
  };
  const inspectPending=async(id:string)=>{
    const s=current.current;if(!s)throw new Error('Vui lòng đăng nhập.');
    const scope=cacheScope(API_URL,s.user.id,s.workspace.id),version=epoch.current;
    const op=(await offlineRead(scope)).operations.find(o=>o.id===id);if(!op)return;
    if(op.path==='/tasks') {
      const projects=await api<{projects:{id:string;canEdit:boolean}[]}>('/projects');
      if(!projects.projects.some(project=>project.canEdit&&(!op.body.projectId||project.id===op.body.projectId)))throw new Error('Không còn quyền tạo công việc trong dự án. Nháp được cách ly.');
      if(version!==epoch.current)throw new Error('Phiên làm việc đã thay đổi.');
      await offlineUpdate(scope,state=>{const op=state.operations.find(o=>o.id===id);if(op)op.server={title:'Máy chủ chưa chấp nhận tạo mới. Hãy sửa bản nháp.'};});
      await loadPending(s);return;
    }
    const taskId=op.wire?.path.split('/')[2]||op.path.split('/')[2];
    const result=await api<Payload>(op.resource.startsWith('plan:')?`/personal-tasks?id=${encodeURIComponent(taskId)}`:`/tasks/${taskId}/detail`);
    const server=op.resource.startsWith('plan:')?(result.tasks as Payload[])?.find(t=>t.id===taskId):result.task as Payload;
    if(!server)throw new Error('Không còn quyền trên công việc. Nháp được cách ly.');
    const revision=(op.resource.startsWith('plan:')?server.planRevision:server.revision) as string;
    if(!revision)throw new Error('Máy chủ chưa trả revision hiện tại.');
    if(version!==epoch.current)throw new Error('Phiên làm việc đã thay đổi.');
    await offlineUpdate(scope,state=>{const op=state.operations.find(o=>o.id===id);if(op){op.server=server;op.currentRevision=revision;if(state.denied)delete state.denied[taskId];}});
    await loadPending(s);
  };
  const recoverPending=async(id:string)=>{
    await inspectPending(id);
    const s=current.current;if(!s)throw new Error('Vui lòng đăng nhập.');
    const scope=cacheScope(API_URL,s.user.id,s.workspace.id);
    const op=(await offlineRead(scope)).operations.find(o=>o.id===id);if(!op||!op.server)throw new Error('Cần kiểm tra quyền trước khi mở nháp.');
    if(!/^\/tasks(?:\/[^/]+)?$/.test(op.path))throw new Error('Mở công việc để sửa dữ liệu liên quan trước khi thử lại.');
    const taskId=op.path==='/tasks'?undefined:op.wire?.path.split('/')[2]||op.path.split('/')[2];
    await offlineUpdate(scope,state=>{
      state.drafts[`task-form:${taskId||'new'}`]={...op.server,...op.body,expectedRevision:op.currentRevision,_offlineOperationId:id};
      state.denied||={};state.denied[`allow:${taskId||'new'}`]=true;
    });
    await loadPending(s);return taskId;
  };
  const resolvePending=async(id:string,choice:'server'|'local')=>{
    const s=current.current;if(!s)throw new Error('Vui lòng đăng nhập.');
    const scope=cacheScope(API_URL,s.user.id,s.workspace.id);
    const op=(await offlineRead(scope)).operations.find(o=>o.id===id);if(!op)return;
    if(!op.server||!op.currentRevision)throw new Error('Hãy tải và xem bản máy chủ trước khi chọn.');
    await offlineUpdate(scope,state=>resolveOperation(state,id,choice,Crypto.randomUUID(),op.server!,op.currentRevision!));
    await loadPending(s);await refresh();
  };
  const scope = session
    ? cacheScope(API_URL, session.user.id, session.workspace.id)
    : "anonymous";
  return (
    <SessionContext.Provider
      value={{
        session,
        loading,
        online,
        writable: !switching && !!session && isWritable(session, online),
        taskWritable: !switching && !!session && canReadOffline(session) && isWritable(session,true),
        pending,offlineError,sync:refresh,saveDraft,readDraft,inspectPending,recoverPending,resolvePending,
        scope,
        error,
        login,
        register,
        logout,
        switchWorkspace,
        refresh,
        api,
        read,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
export function useResource<T>(path: string, enabled = true) {
  const { read, scope, session } = useSession();
  return useQuery({
    queryKey: [scope, path],
    queryFn: ({ signal }) => read<T>(path, signal),
    enabled: !!session && enabled,
    networkMode: "always",
  });
}
export async function refreshData() {
  await queryClient.invalidateQueries();
}
