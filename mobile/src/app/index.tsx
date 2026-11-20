import { useTheme } from "../ui/theme";
import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { View, Pressable, BackHandler, Alert, ScrollView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as NotificationsAPI from "expo-notifications";
import { router } from "expo-router";
import { useSession, refreshData } from "../core/session";
import { notificationTarget, registerPush, pushConfigured } from "../core/push";
import { TaskList } from "../features/TaskList";
import { TaskDetail } from "../features/TaskDetail";
import { Notifications } from "../features/Notifications";
import { Planner } from "../features/Planner";
import { Projects } from "../features/Projects";
import { Account } from "../features/Account";
import { Login } from "../features/Login";
import { Text, Empty, Loading, EdgeSwipeBack } from "../ui/kit";
import { useMeasuredWindow, position } from "../ui/frames";
import { errorMessage, API_URL } from "../core/api";
const tabs = [
  { id: "tasks", label: "Công việc", icon: "✓" },
  { id: "planner", label: "Kế hoạch", icon: "◷" },
  { id: "projects", label: "Dự án", icon: "▧" },
  { id: "notifications", label: "Thông báo", icon: "♧" },
  { id: "account", label: "Tài khoản", icon: "◎" },
] as const;
type Tab = (typeof tabs)[number]["id"];
/** Navigation labels and icons stop growing here so five tabs still fit a cover display. */
const NAV_MAX_FONT_SCALE = 1.3;
export default function Home({initialTaskId, onInitialBack, listenForPush = true}: {initialTaskId?: string; onInitialBack?: () => void; listenForPush?: boolean} = {}) {
  const { colors, radius } = useTheme();
  const { session, loading, online, scope, switchWorkspace } = useSession();
  const [tab, setTab] = useState<Tab>("tasks"),
    [selection, setSelection] = useState<{ id: string; scope: string } | undefined>(() => initialTaskId ? {id: initialTaskId, scope} : undefined);
  const selected = selection?.scope === scope ? selection.id : undefined;
  const lastResponse = useRef("");
  const {
    attach: frameRef,
    onLayout: measureFrame,
    ...window
  } = useMeasuredWindow();
  const { layout } = window;
  const dual = layout.mode === "dual" && !!layout.secondary,
    rail = layout.navigation === "rail";
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const switchRef = useRef(switchWorkspace);
  useEffect(() => {
    switchRef.current = switchWorkspace;
  }, [switchWorkspace]);
  const openTask = (id: string) => {
    setSelection({ id, scope });
  };
  // Android dispatches back to the newest listener first. Home registers once, at mount, so a
  // child screen's own handler (an open project, a service) always runs before it; the latest
  // tab/selection is read from a ref instead of re-registering on every change.
  const backState = useRef({ selected, tab, onInitialBack });
  useLayoutEffect(() => {
    backState.current = { selected, tab, onInitialBack };
  }, [selected, tab, onInitialBack]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      const current = backState.current;
      const detailVisible =
        current.tab === "tasks" ||
        current.tab === "planner" ||
        current.tab === "notifications";
      // A selection kept while another tab is showing is invisible: back leaves that tab first.
      if (current.selected && detailVisible) {
        if (current.onInitialBack) current.onInitialBack();
        else setSelection(undefined);
        return true;
      }
      if (current.tab !== "tasks") {
        setTab("tasks");
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, []);
  const token = session?.token;
  useEffect(() => {
    if (!token || !listenForPush) return;
    let live = true;
    if (pushConfigured) void registerPush(token).catch(() => {});
    const handle = async (
      response: NotificationsAPI.NotificationResponse | null,
    ) => {
      const current = sessionRef.current;
      if (
        !live ||
        !current ||
        !response ||
        response.notification.request.identifier === lastResponse.current
      )
        return;
      const target = notificationTarget(
        response.notification.request.content.data || {},
      );
      if (target.userId && target.userId !== current.user.id) return;
      lastResponse.current = response.notification.request.identifier;
      try {
        if (target.workspaceId && target.workspaceId !== current.workspace.id)
          await switchRef.current(target.workspaceId);
        if (target.taskId) {
          setTab("tasks");
          setSelection({
            id: target.taskId,
            scope: JSON.stringify([
              API_URL,
              current.user.id,
              target.workspaceId || current.workspace.id,
            ]),
          });
        } else if (target.eventId)
          router.push({
            pathname: "/event/[id]",
            params: { id: target.eventId },
          });
        else if (target.serviceId) router.push({ pathname: "/service/[id]", params: { id: target.serviceId } });
        else setTab("notifications");
        await NotificationsAPI.clearLastNotificationResponseAsync();
      } catch (e) {
        lastResponse.current = "";
        Alert.alert("Không mở được thông báo", errorMessage(e));
      }
    };
    void NotificationsAPI.getLastNotificationResponseAsync().then(handle);
    const tapped = NotificationsAPI.addNotificationResponseReceivedListener(
      (r) => void handle(r),
    );
    const received = NotificationsAPI.addNotificationReceivedListener(
      () => void refreshData(),
    );
    const changed = NotificationsAPI.addPushTokenListener(() => {
      if (pushConfigured) void registerPush(token).catch(() => {});
    });
    return () => {
      live = false;
      tapped.remove();
      received.remove();
      changed.remove();
    };
  }, [token, listenForPush]);
  if (loading) return <Loading />;
  if (!session) return <Login />;
  const supportsTaskDetail = tab === "tasks" || tab === "planner" || tab === "notifications";
  const detailRegion =
    dual && layout.secondary ? layout.secondary : layout.primary;
  const fullRegion = (selected && dual && supportsTaskDetail) || (layout.hinge && !(tab === "projects" && dual))
    ? layout.primary
    : {
        ...layout.primary,
        width: window.width - layout.primary.x,
        height: dual && tab === "projects" && layout.secondary
          ? Math.max(layout.primary.y + layout.primary.height, layout.secondary.y + layout.secondary.height) - layout.primary.y
          : layout.primary.height,
      };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {!online && (
        <Text
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.orangePale,
            color: colors.orange,
            padding: 5,
            fontSize: 11,
            textAlign: "center",
            marginLeft: layout.primary.x,
            width: layout.primary.width,
          }}
        >
          Ngoại tuyến · Dữ liệu đã tải
        </Text>
      )}
      <View ref={frameRef} onLayout={measureFrame} style={{ flex: 1 }}>
        <View
          testID="home-navigation-region"
          style={[
            position(layout.navigationRegion),
            {
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderRightWidth: rail ? 1 : 0,
              borderTopWidth: rail ? 0 : 1,
            },
          ]}
        >
          <ScrollView
            horizontal={!rail}
            contentContainerStyle={{
              flexGrow: 1,
              flexDirection: rail ? "column" : "row",
              padding: 4,
              gap: 4,
            }}
          >
            {tabs.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: tab === item.id }}
                onPress={() => setTab(item.id)}
                style={{
                  flex: rail ? undefined : 1,
                  paddingVertical: 8,
                  minHeight: 60,
                  minWidth: rail ? undefined : 70,
                  borderRadius: radius.card,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tab === item.id ? colors.pale : undefined,
                }}
              >
                <Text
                  maxFontSizeMultiplier={NAV_MAX_FONT_SCALE}
                  style={{
                    fontSize: 23,
                    lineHeight: 29,
                    color: tab === item.id ? colors.accent : colors.muted,
                  }}
                >
                  {item.icon}
                </Text>
                {/* Like system tab bars, labels stop growing at large text sizes instead of
                    disappearing: the glyph icons alone are not self-explanatory. */}
                <Text
                  maxFontSizeMultiplier={NAV_MAX_FONT_SCALE}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={{
                    fontSize: 11,
                    lineHeight: 18,
                    textAlign: "center",
                    color: tab === item.id ? colors.accent : colors.muted,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View
          key={scope + "list"}
          testID="home-task-list-pane"
          style={[
            position(layout.primary),
            {
              display: tab === "tasks" && (!selected || dual) ? "flex" : "none",
            },
          ]}
        >
          <TaskList selectedId={selected} onSelect={openTask} />
        </View>
        <View
          testID="home-task-detail-pane"
          style={[
            position(detailRegion),
            {
              display:
                supportsTaskDetail && (!!selected || (tab === "tasks" && dual)) ? "flex" : "none",
            },
          ]}
        >
          {selected ? (
            <EdgeSwipeBack
              testID="home-task-swipe-back"
              enabled={Platform.OS === "ios" && !dual}
              onBack={() =>
                onInitialBack ? onInitialBack() : setSelection(undefined)
              }
            >
              <TaskDetail
                key={scope + selected}
                id={selected}
                onBack={() => onInitialBack ? onInitialBack() : setSelection(undefined)}
              />
            </EdgeSwipeBack>
          ) : (
            <Empty
              title="Một việc tại một thời điểm"
              message="Chọn công việc để xem chi tiết và trao đổi."
            />
          )}
        </View>
        <View
          key={scope + "other"}
          testID="home-other-pane"
          style={[
            position(fullRegion),
            { display: tab === "tasks" || (!!selected && supportsTaskDetail && !dual) ? "none" : "flex" },
          ]}
        >
          {tab === "planner" ? <Planner onTask={openTask}/> : tab === "projects" ? <Projects layout={layout}/> : tab === "notifications" ? (
            <Notifications onTask={openTask} />
          ) : tab === "account" ? (
            <Account />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
