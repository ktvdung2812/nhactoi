import React, { useState } from "react";
import { ScrollView, RefreshControl, Pressable } from "react-native";
import { router } from "expo-router";
import { useResource, useSession, refreshData } from "../core/session";
import type { Notice } from "../core/types";
import { errorMessage } from "../core/api";
import { dateLabel } from "../core/policy";
import { registerPush, pushConfigured } from "../core/push";
import {
  Heading,
  Text,
  Card,
  Button,
  ErrorNotice,
  Loading,
  Empty,
  s,
  colors,
} from "../ui/kit";
export function Notifications({ onTask }: { onTask: (id: string) => void }) {
  const { api, session, online } = useSession();
  const result = useResource<{ notifications: Notice[] }>(
    `/mobile/notifications?workspaceId=${session?.workspace.id || ""}`,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  async function enable() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await registerPush(session.token, true);
      setStatus("Đã bật thông báo trên thiết bị.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(n: Notice) {
    setError("");
    try {
      if (online && !n.readAt) {
        await api(`/mobile/notifications/${n.id}/read`, { method: "PATCH" });
        void refreshData();
      }
      if (n.taskId) onTask(n.taskId);
      else if (n.entityType === "calendar_event" && n.entityId)
        router.push({ pathname: "/event/[id]", params: { id: n.entityId } });
      else if (n.entityType === "service" && n.entityId) router.push({ pathname: "/service/[id]", params: { id: n.entityId } });
      else setStatus("Thông báo này thuộc chức năng hiện có trên web.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={result.isRefetching}
          onRefresh={() => void result.refetch()}
          tintColor={colors.green}
        />
      }
    >
      <Heading>Thông báo</Heading>
      <Text style={s.muted}>Theo dõi lời nhắc và cập nhật từ đồng đội.</Text>
      <Button
        label="Bật thông báo điện thoại"
        secondary
        disabled={busy || !online}
        onPress={() => void enable()}
      />
      {!pushConfigured && (
        <Text style={s.muted}>Firebase chưa được cấu hình cho bản local.</Text>
      )}
      <ErrorNotice message={error} />
      {status && <Text>{status}</Text>}
      {result.isPending ? (
        <Loading />
      ) : result.error ? (
        <ErrorNotice message={errorMessage(result.error)} />
      ) : !result.data?.value.notifications.length ? (
        <Empty
          title="Bạn đã xem hết rồi"
          message="Lời nhắc và cập nhật mới sẽ xuất hiện tại đây."
        />
      ) : (
        result.data.value.notifications.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            onPress={() => void open(n)}
          >
            <Card>
              <Text style={s.cardTitle}>
                {!n.readAt ? "● " : ""}
                {n.title}
              </Text>
              <Text>{n.message}</Text>
              <Text style={s.muted}>{dateLabel(n.createdAt)}</Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
