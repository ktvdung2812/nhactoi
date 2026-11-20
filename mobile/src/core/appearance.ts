import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { ApiError, errorMessage } from "./api";
import { cacheRead, cacheWrite } from "./cache";
import { useSession } from "./session";
import { sanitizeMobileAppearance, type MobileAppearance } from "../ui/theme";

type ServerPreferences = Record<string, unknown> | null;
type Accessibility = Partial<Pick<MobileAppearance, "contrast" | "motion">> | null;
type Profile = { preferences: ServerPreferences; accessibility: Accessibility; separate: boolean };
type Sync = { web: { separate: boolean }; mobile: { separate: boolean } };
type Cached = { preferences: Partial<MobileAppearance>; separate: boolean; webSeparate: boolean };
const path = "/appearance?platform=mobile";
const cachePath = "appearance.mobile.effective";
const soft = { soft: true };

export function pickMobileFields(value: unknown): Partial<MobileAppearance> {
  return sanitizeMobileAppearance(value);
}
export function mergeForSave(serverPrefs: ServerPreferences | undefined, edits: Partial<MobileAppearance>): Record<string, unknown> {
  return { ...(serverPrefs && typeof serverPrefs === "object" && !Array.isArray(serverPrefs) ? serverPrefs : {}), ...pickMobileFields(edits) };
}
export function effectiveMobileAppearance(preferences: ServerPreferences | undefined, accessibility: Accessibility | undefined): Partial<MobileAppearance> {
  return { ...pickMobileFields(preferences), ...pickMobileFields({ contrast: accessibility?.contrast, motion: accessibility?.motion }) };
}
function equal(a: object, b: object) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}

type State = { preferences: Partial<MobileAppearance>; loading: boolean; cacheLoading: boolean; error: string; separate: boolean; webSeparate: boolean; scopeKnown: boolean; syncUnavailable: boolean };
export function useMobileAppearance() {
  const { session, scope, online, api, loading: sessionLoading } = useSession();
  const token = session?.token;
  const identity = token ? JSON.stringify([scope, token]) : "";
  const stateIdentity = useRef(identity);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const coldComplete = useRef(false);
  const [state, setState] = useState<State>({ preferences: {}, loading: false, cacheLoading: !!token || !!sessionLoading, error: "", separate: false, webSeparate: false, scopeKnown: false, syncUnavailable: false });
  const update = useCallback((change: Partial<State>) => setState(previous => {
    const preferences = change.preferences && equal(previous.preferences, change.preferences) ? previous.preferences : change.preferences;
    const next = { ...previous, ...change, ...(preferences ? { preferences } : {}) };
    return equal(previous, next) ? previous : next;
  }), []);
  const effective = useRef<Partial<MobileAppearance>>({});
  const cachedScope = useRef({ separate: false, webSeparate: false });
  const ready = useRef(false);
  const serverApplied = useRef(false);
  const busy = useRef(false);
  const refreshPending = useRef(false);
  const generation = useRef(0);
  const identityCycle = useRef(0);
  const saveCache = useCallback((value: Cached) => {
    if (identity) void cacheWrite(scope, cachePath, value).catch(() => {});
  }, [identity, scope]);
  const refresh = useCallback(async () => {
    if (!token || !identity || stateIdentity.current !== identity) return;
    if (busy.current) { refreshPending.current = true; return; }
    if (!online) { update({ error: "Không có kết nối mạng." }); return; }
    const version = ++generation.current;
    const valid = () => identityRef.current === identity && generation.current === version;
    try {
      const [profileResult, sync] = await Promise.all([
        api<Profile | null>(path, undefined, soft).then(value => ({ value, error: null }), error => ({ value: null, error })),
        api<Sync>("/appearance/sync", undefined, soft).catch(error => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
      ]);
      if (!valid()) return;
      if (!sync && (!profileResult.error || (profileResult.error instanceof ApiError && profileResult.error.status === 404))) {
        ready.current = !profileResult.error;
        if (!profileResult.error) {
          effective.current = effectiveMobileAppearance(profileResult.value?.preferences, profileResult.value?.accessibility);
          serverApplied.current = true;
          cachedScope.current = { separate: false, webSeparate: false };
          saveCache({ preferences: effective.current, ...cachedScope.current });
        }
        update({ preferences: effective.current, error: "", separate: false, webSeparate: false, scopeKnown: false, syncUnavailable: true });
        return;
      }
      if (profileResult.error) {
        throw profileResult.error;
      }
      const profile = profileResult.value;
      effective.current = effectiveMobileAppearance(profile?.preferences, profile?.accessibility);
      ready.current = true;
      serverApplied.current = true;
      const separate = profile?.separate === true, webSeparate = sync!.web?.separate === true;
      cachedScope.current = { separate, webSeparate };
      update({ preferences: effective.current, error: "", separate, webSeparate, scopeKnown: true, syncUnavailable: false });
      saveCache({ preferences: effective.current, separate, webSeparate });
    } catch (error) {
      if (valid()) update({ error: errorMessage(error) });
    }
  }, [api, identity, online, saveCache, token, update]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    ++generation.current;
    ++identityCycle.current;
    stateIdentity.current = identity;
    ready.current = false; serverApplied.current = false; busy.current = false; refreshPending.current = false;
    cachedScope.current = { separate: false, webSeparate: false };
    if (!identity || !token) {
      effective.current = {};
      if (!sessionLoading) coldComplete.current = true;
      update({ preferences: {}, loading: false, cacheLoading: !coldComplete.current, error: "", separate: false, webSeparate: false, scopeKnown: false, syncUnavailable: false });
      return;
    }
    update({ loading: false, cacheLoading: !coldComplete.current, error: "", separate: false, webSeparate: false, scopeKnown: false, syncUnavailable: false });
    let live = true;
    const finishGate = () => {
      if (!live || identityRef.current !== identity) return;
      coldComplete.current = true;
      update({ cacheLoading: false });
      void refreshRef.current();
    };
    const timer = setTimeout(finishGate, 400);
    void cacheRead<unknown>(scope, cachePath).then(cached => {
      if (!live || identityRef.current !== identity || serverApplied.current || busy.current || !cached) return;
      const value = cached.value;
      const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      effective.current = pickMobileFields("preferences" in record ? record.preferences : record);
      cachedScope.current = { separate: record.separate === true, webSeparate: record.webSeparate === true };
      update({ preferences: effective.current, ...cachedScope.current });
    }).catch(() => {}).finally(() => {
      if (live && !coldComplete.current) { clearTimeout(timer); finishGate(); }
    });
    if (coldComplete.current) { clearTimeout(timer); void refreshRef.current(); }
    return () => { live = false; clearTimeout(timer); };
  }, [identity, scope, token, update]);
  useEffect(() => {
    if (!identity && !sessionLoading) { coldComplete.current = true; update({ cacheLoading: false }); }
  }, [identity, sessionLoading, update]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", next => { if (next === "active") void refresh(); });
    return () => listener.remove();
  }, [refresh]);
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && token && identity) void refresh();
    wasOnline.current = online;
  }, [online, token, identity, refresh]);

  const run = useCallback(async (action: "save" | "reset" | "sync", edits?: Partial<MobileAppearance>, separate?: boolean, copyFrom?: "all" | "web") => {
    if (!token || !identity || stateIdentity.current !== identity) return;
    if (!online) { update({ error: "Không có kết nối mạng." }); return; }
    if (busy.current) return;
    if (action === "save" && !ready.current) { update({ error: "Hãy tải giao diện từ máy chủ trước khi lưu." }); return; }
    busy.current = true;
    const version = ++generation.current;
    const cycle = identityCycle.current;
    const valid = () => identityRef.current === identity && generation.current === version;
    const before = effective.current;
    if (action === "save") effective.current = { ...before, ...pickMobileFields(edits) };
    update({ preferences: effective.current, loading: true, error: "" });
    try {
      if (action === "save") {
        // Fetch on every save so unrelated web settings are as fresh as possible.
        const fresh = await api<Profile | null>(path, undefined, soft);
        if (!valid()) return;
        const shared = effectiveMobileAppearance(fresh?.preferences, fresh?.accessibility);
        const result = await api<{ preferences: ServerPreferences; accessibility: Accessibility } | null>(path, { method: "PUT", body: JSON.stringify(mergeForSave(fresh?.preferences, { contrast: shared.contrast, motion: shared.motion, ...edits })) }, soft);
        if (!valid()) return;
        effective.current = effectiveMobileAppearance(result?.preferences, result?.accessibility);
        serverApplied.current = true;
        update({ preferences: effective.current });
        // Preserve scope metadata from the last authoritative sync response.
        saveCache({ preferences: effective.current, ...cachedScope.current });
        AccessibilityInfo.announceForAccessibility("Đã lưu giao diện");
      } else {
        if (action === "reset") await api(path, { method: "DELETE" }, soft);
        else await api("/appearance/sync", { method: "PUT", body: JSON.stringify({ platform: "mobile", separate, ...(copyFrom ? { copyFrom } : {}) }) }, soft);
        if (!valid()) return;
        ready.current = false;
        busy.current = false;
        refreshPending.current = false;
        await refresh();
      }
    } catch (error) {
      if (valid()) {
        if (action === "save") effective.current = before;
        update({ preferences: effective.current, error: errorMessage(error) });
      }
    } finally {
      // A post-mutation refresh increments generation; identity still owns the lock.
      if (identityRef.current === identity && identityCycle.current === cycle) {
        busy.current = false;
        update({ loading: false });
        if (refreshPending.current) { refreshPending.current = false; void refreshRef.current(); }
      }
    }
  }, [api, identity, online, refresh, saveCache, token, update]);
  const visible = stateIdentity.current === identity ? state : { ...state, preferences: token ? state.preferences : {}, loading: false, cacheLoading: !coldComplete.current && (!!token || !!sessionLoading), error: "", separate: false, webSeparate: false, scopeKnown: false, syncUnavailable: false };
  return { ...visible, save: (edits: Partial<MobileAppearance>) => run("save", edits), reset: () => run("reset"), setSeparate: (separate: boolean) => run("sync", undefined, separate), copyFrom: (source: "all" | "web") => run("sync", undefined, true, source), refresh };
}

type AppearanceSettings = ReturnType<typeof useMobileAppearance>;
const AppearanceContext = createContext<AppearanceSettings | null>(null);
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const value = useMobileAppearance();
  return React.createElement(AppearanceContext.Provider, { value }, children);
}
export function useAppearanceSettings() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("Thiếu AppearanceProvider");
  return value;
}
