import { useTheme } from "../ui/theme";
import React, { useState } from "react";
import { ScrollView, RefreshControl, Pressable } from "react-native";
import { router } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSession, refreshData } from "../core/session";
import type { Notice } from "../core/types";
import { errorMessage } from "../core/api";
import { dateLabel } from "../core/policy";
import { registerPush, pushConfigured } from "../core/push";
import { useKitStyles,
  Heading,
  Text,
  Card,
  Button,
  ErrorNotice,
  Loading,
  Empty,
} from "../ui/kit";
export function Notifications({ onTask }: { onTask: (id: string) => void }) {
  const { scope } = useSession();
  return <NotificationList key={scope} onTask={onTask} />;
}
function NotificationList({ onTask }: { onTask: (id: string) => void }) {
  const s = useKitStyles();
  const { colors } = useTheme();
  const { api, read, scope, session, online } = useSession();
  const queryClient = useQueryClient();
  const path = `/mobile/notifications?workspaceId=${encodeURIComponent(session?.workspace.id || "")}`;
  const queryKey = [scope, path, "pages"];
  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => read<{
      notifications: Notice[]; page: number; hasMore: boolean;
    }>(`${path}&page=${pageParam}`, signal),
    getNextPageParam: (last) => last.value.hasMore ? last.value.page + 1 : undefined,
    enabled: !!session,
    networkMode: "always",
  });
  const notices = [...new Map(result.data?.pages.flatMap(page => page.value.notifications).map(n => [n.id, n])).values()];
  async function refresh() {
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<typeof result.data>(queryKey, data => data && ({
      ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1),
    }));
    await result.refetch();
  }
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
      contentContainerStyle={[s.content, { width: '100%', maxWidth: 760, alignSelf: 'center' }]}
      refreshControl={
        <RefreshControl
          refreshing={result.isRefetching}
          onRefresh={() => void refresh()}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surface}
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
      {result.error && <ErrorNotice message={errorMessage(result.error)} />}
      {result.data?.pages.some(page => page.cached) && <Text style={s.muted}>Đang xem thông báo đã lưu trên thiết bị.</Text>}
      {status && <Text>{status}</Text>}
      {result.isPending ? (
        <Loading />
      ) : !notices.length && !result.error ? (
        <Empty
          title="Bạn đã xem hết rồi"
          message="Lời nhắc và cập nhật mới sẽ xuất hiện tại đây."
        />
      ) : (
        notices.map((n) => (
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
      {result.hasNextPage && (
        <Button
          label={result.isFetchingNextPage ? "Đang tải…" : "Xem thêm thông báo"}
          secondary
          disabled={result.isFetching}
          onPress={() => void result.fetchNextPage()}
        />
      )}
    </ScrollView>
  );
}
