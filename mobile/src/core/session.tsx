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
  scope: string;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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
    [error, setError] = useState("");
  const current = useRef<Session | null>(null),
    epoch = useRef(0),
    transitioning = useRef(false),
    controllers = useRef(new Set<AbortController>());
  const update = useCallback(async (s: Session | null) => {
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
    cancel();
    current.current = null;
    transitioning.current = false;
    setSwitching(false);
    setSession(null);
    await persistSession(() => SecureStore.deleteItemAsync(SESSION_KEY));
    await cacheClear();
    await clearTemporaryFiles();
  }, [cancel]);
  const refresh = useCallback(async () => {
    void drainRevocations().catch(() => {});
    const before = current.current;
    if (!before || transitioning.current) return;
    const version = epoch.current;
    const mustVerify = !canReadOffline(before);
    if (mustVerify) setLoading(true);
    try {
      const me = await request<
        Omit<Session, "token" | "expiresAt" | "verifiedAt">
      >("/me", before.token);
      if (version !== epoch.current) return;
      await update({ ...before, ...me, verifiedAt: Date.now() });
      setOnline(true);
      setError("");
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
        if (!canReadOffline(before)) {
          await clear();
          setError("Cần kết nối lại để xác minh quyền truy cập.");
        }
      } else setError(e instanceof Error ? e.message : "Không tải được phiên.");
    } finally {
      if (mustVerify) setLoading(false);
    }
  }, [clear, update]);
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
        void queryClient.invalidateQueries();
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
      const s = current.current;
      if (!s) throw new ApiError(401, "Vui lòng đăng nhập.");
      if (transitioning.current)
        throw new ApiError(409, "Đang chuyển doanh nghiệp. Vui lòng chờ.");
      const version = epoch.current,
        controller = new AbortController();
      controllers.current.add(controller);
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort);
      try {
        const value = await request<T>(path, s.token, {
          ...options,
          signal: controller.signal,
        });
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
            await cacheClear(cacheScope(API_URL, s.user.id, s.workspace.id));
          }
        }
        throw e;
      } finally {
        controllers.current.delete(controller);
        options.signal?.removeEventListener("abort", abort);
      }
    },
    [clear, cancel],
  );
  const read = useCallback(
    async <T,>(path: string, signal?: AbortSignal) => {
      const s = current.current;
      if (!s) throw new ApiError(401, "Vui lòng đăng nhập.");
      const version = epoch.current;
      const scope = cacheScope(API_URL, s.user.id, s.workspace.id);
      try {
        const value = await api<T>(path, { signal });
        if (version !== epoch.current)
          throw new ApiError(499, "Doanh nghiệp đã thay đổi.");
        await cacheWrite(scope, path, value);
        if (version !== epoch.current)
          throw new ApiError(499, "Phiên làm việc đã thay đổi.");
        return { value, cached: false, updatedAt: Date.now() };
      } catch (e) {
        if (e instanceof ApiError && e.status === 0 && canReadOffline(s)) {
          const cached = await cacheRead<T>(scope, path);
          if (
            cached &&
            version === epoch.current &&
            Date.now() - cached.updatedAt < 86400000
          )
            return { ...cached, cached: true };
        }
        throw e;
      }
    },
    [api],
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
    await update({ ...value, verifiedAt: Date.now() });
    setOnline(true);
    setError("");
  };
  const logout = async () => {
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
        scope,
        error,
        login,
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
