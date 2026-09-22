import React, { useEffect, useState, useRef } from "react";
import { View, Pressable, BackHandler, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as NotificationsAPI from "expo-notifications";
import { router } from "expo-router";
import { useSession, refreshData } from "../core/session";
import { notificationTarget, registerPush, pushConfigured } from "../core/push";
import { TaskList } from "../features/TaskList";
import { TaskDetail } from "../features/TaskDetail";
import { Calendar } from "../features/Calendar";
import { Notifications } from "../features/Notifications";
import { Account } from "../features/Account";
import { Login } from "../features/Login";
import { Text, Empty, Loading, colors } from "../ui/kit";
import { useMeasuredWindow, position } from "../ui/frames";
import { errorMessage, API_URL } from "../core/api";
const tabs = [
  { id: "tasks", label: "Công việc", icon: "✓" },
  { id: "calendar", label: "Lịch", icon: "▦" },
  { id: "notifications", label: "Thông báo", icon: "♧" },
  { id: "account", label: "Tài khoản", icon: "◎" },
] as const;
type Tab = (typeof tabs)[number]["id"];
export default function Home() {
  const { session, loading, online, scope, switchWorkspace } = useSession();
  const [tab, setTab] = useState<Tab>("tasks"),
    [selection, setSelection] = useState<{ id: string; scope: string }>();
  const selected = selection?.scope === scope ? selection.id : undefined;
  const lastResponse = useRef("");
  const {
    attach: frameRef,
    onLayout: measureFrame,
    ...window
  } = useMeasuredWindow();
  const { layout } = window;
  const dual = layout.mode === "dual",
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
    setTab("tasks");
    setSelection({ id, scope });
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selected) {
        setSelection(undefined);
        return true;
      }
      if (tab !== "tasks") {
        setTab("tasks");
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [selected, tab]);
  const token = session?.token;
  useEffect(() => {
    if (!token) return;
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
  }, [token]);
  if (loading) return <Loading />;
  if (!session) return <Login />;
  const detailRegion =
    dual && layout.secondary ? layout.secondary : layout.primary;
  const fullRegion = layout.hinge
    ? layout.primary
    : {
        ...layout.primary,
        width: window.width - layout.primary.x,
        height: layout.primary.height,
      };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {!online && (
        <Text
          accessibilityRole="alert"
          style={{
            backgroundColor: "#fff0dd",
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
          style={[
            position(layout.navigationRegion),
            {
              backgroundColor: colors.white,
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
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tab === item.id ? colors.pale : undefined,
                }}
              >
                <Text
                  style={{
                    fontSize: 23,
                    lineHeight: 29,
                    color: tab === item.id ? colors.green : colors.muted,
                  }}
                >
                  {item.icon}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    lineHeight: 18,
                    textAlign: "center",
                    color: tab === item.id ? colors.green : colors.muted,
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
          style={[
            position(detailRegion),
            {
              display:
                tab === "tasks" && (!!selected || dual) ? "flex" : "none",
            },
          ]}
        >
          {selected ? (
            <TaskDetail
              key={scope + selected}
              id={selected}
              onBack={() => setSelection(undefined)}
            />
          ) : (
            <Empty
              title="Một việc tại một thời điểm"
              message="Chọn công việc để xem chi tiết và trao đổi."
            />
          )}
        </View>
        <View
          key={scope + "other"}
          style={[
            position(fullRegion),
            { display: tab === "tasks" ? "none" : "flex" },
          ]}
        >
          {tab === "calendar" ? (
            <Calendar onTask={openTask} />
          ) : tab === "notifications" ? (
            <Notifications onTask={openTask} />
          ) : tab === "account" ? (
            <Account />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
