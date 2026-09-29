import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router } from "expo-router";
import { useResource, useSession } from "../core/session";
import type {
  CalendarEvent,
  Member,
  Task,
  Team,
} from "../core/types";
import { statuses, priorities, dateLabel } from "../core/policy";
import { errorMessage } from "../core/api";
import { HingeSafe } from "../ui/frames";
import {
  Text,
  Heading,
  Field,
  Select,
  Row,
  Button,
  Card,
  Empty,
  Loading,
  ErrorNotice,
  s,
  colors,
} from "../ui/kit";

export type WorkItem =
  | { kind: "task"; value: Task }
  | { kind: "event"; value: CalendarEvent };

export type WorkFilters = {
  search: string;
  team: string;
  status: string;
  assignee: string;
  due: string;
};

const eventStatus = (event: CalendarEvent): Task["status"] =>
  event.status && event.status in statuses ? event.status : "todo";

const itemStatus = (item: WorkItem) =>
  item.kind === "task" ? item.value.status : eventStatus(item.value);

const itemTeamId = (item: WorkItem) =>
  item.kind === "task" ? item.value.teamId : item.value.team_id;

const itemStart = (item: WorkItem) =>
  Date.parse((item.kind === "task" ? item.value.dueAt : item.value.starts_at) || "");

const itemEnd = (item: WorkItem) =>
  Date.parse((item.kind === "task" ? item.value.dueAt : item.value.ends_at) || "");

/**
 * Projects tasks and appointments onto the one work board. Service renewal
 * projections stay on the web board; mobile has no service detail route.
 */
export function projectWorkItems(
  tasks: Task[],
  events: CalendarEvent[],
  filters: WorkFilters,
  nowMs = Date.now(),
): WorkItem[] {
  const query = filters.search.toLocaleLowerCase("vi");
  const now = new Date(nowMs);
  const dayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dayEnd = dayStart + 86400000;
  const source: WorkItem[] = [
    ...tasks.map((value) => ({ kind: "task" as const, value })),
    ...events
      .filter((value) => !value.service_id)
      .map((value) => ({ kind: "event" as const, value })),
  ];
  return source
    .filter((item) => {
      const value = item.value;
      const text =
        `${value.title} ${value.description}`.toLocaleLowerCase("vi");
      const teamId = itemTeamId(item);
      const start = itemStart(item);
      const end = itemEnd(item);
      const status = itemStatus(item);
      const matchesDue =
        filters.due === "all" ||
        (filters.due === "overdue" && end < nowMs && status !== "done") ||
        (filters.due === "today" && start >= dayStart && start < dayEnd);
      return (
        (!query || text.includes(query)) &&
        (filters.team === "all" ||
          (filters.team === "common" ? !teamId : teamId === filters.team)) &&
        (filters.status === "all" || status === filters.status) &&
        (filters.assignee === "all" ||
          (item.kind === "task" && item.value.assigneeId === filters.assignee)) &&
        matchesDue
      );
    })
    .sort((a, b) => {
      const aDated = Number.isFinite(itemStart(a));
      const bDated = Number.isFinite(itemStart(b));
      if (aDated !== bDated) return aDated ? -1 : 1;
      const difference = itemStart(a) - itemStart(b);
      return Number.isFinite(difference)
        ? difference
        : a.kind === b.kind
          ? 0
          : a.kind === "task"
            ? -1
            : 1;
    });
}

function workGroups(items: WorkItem[]) {
  return Object.entries(statuses).map(([key, label]) => ({
    label,
    items: items.filter((item) => itemStatus(item) === key),
  }));
}

function CreateChooser({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: (path?: "/task/new" | "/event/new") => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onClose()}
    >
      <View style={styles.modalOverlay}>
        <HingeSafe>
          <View style={styles.modalCenter}>
            <View style={styles.modalCard}>
              <Heading>Tạo mới</Heading>
              <Text style={s.muted}>Chọn loại nội dung cần thêm vào bảng.</Text>
              <Button label="Công việc" onPress={() => onClose("/task/new")} />
              <Button
                label="Lịch hẹn"
                secondary
                onPress={() => onClose("/event/new")}
              />
              <Button label="Đóng" secondary onPress={() => onClose()} />
            </View>
          </View>
        </HingeSafe>
      </View>
    </Modal>
  );
}

export function TaskList({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const { session, writable, online } = useSession();
  const tasks = useResource<{ tasks: Task[] }>("/tasks");
  const events = useResource<{ events: CalendarEvent[] }>("/calendar-events");
  const teams = useResource<{ teams: Team[] }>("/teams");
  const members = useResource<{ members: Member[] }>("/members");
  const [search, setSearch] = useState(""),
    [team, setTeam] = useState("all"),
    [status, setStatus] = useState("all"),
    [assignee, setAssignee] = useState("all"),
    [due, setDue] = useState("all"),
    [filtersOpen, setFiltersOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const workspaceId = session?.workspace.id;
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const refetchTasks = tasks.refetch;
  const refetchEvents = events.refetch;
  const refreshWork = useCallback(() => {
    void refetchTasks();
    void refetchEvents();
  }, [refetchEvents, refetchTasks]);
  useEffect(() => {
    if (!online || !workspaceId) return;
    const refreshWhenActive = () => {
      if (AppState.currentState === "active") refreshWork();
    };
    const interval = setInterval(refreshWhenActive, 30000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshWork();
    });
    return () => {
      clearInterval(interval);
      listener.remove();
    };
  }, [online, refreshWork, workspaceId]);
  const items = useMemo(
    () =>
      projectWorkItems(
        tasks.data?.value.tasks || [],
        events.data?.value.events || [],
        { search, team, status, assignee, due },
        nowMs,
      ),
    [tasks.data, events.data, search, team, status, assignee, due, nowMs],
  );
  const groups = workGroups(items);
  const openCreate = () => setCreateOpen(true);
  const chooseCreate = (path?: "/task/new" | "/event/new") => {
    setCreateOpen(false);
    if (path) router.push(path);
  };
  const loading = tasks.isPending || events.isPending;
  const hasData = Boolean(
    tasks.data?.value.tasks || events.data?.value.events,
  );
  const error = tasks.error || events.error;
  const refresh = (
    <RefreshControl
      refreshing={tasks.isRefetching || events.isRefetching}
      onRefresh={() => {
        refreshWork();
      }}
      tintColor={colors.green}
    />
  );
  const retry = () => {
    refreshWork();
  };
  const header = (
    <View style={{ gap: 16, paddingBottom: 16 }}>
      <View>
        <Text style={[s.label, { color: colors.green }]}>KHÔNG GIAN LÀM VIỆC</Text>
        <Heading>Công việc của bạn</Heading>
        <Text style={s.muted}>{session?.workspace.name}</Text>
      </View>
      <Row>
        <Button label="＋ Tạo mới" disabled={!writable} onPress={openCreate} />
        <Button
          label={filtersOpen ? "Ẩn bộ lọc" : "Bộ lọc"}
          secondary
          onPress={() => setFiltersOpen((value) => !value)}
        />
      </Row>
      <Field
        label="Tìm công việc hoặc lịch hẹn"
        placeholder="Tên hoặc nội dung…"
        value={search}
        onChangeText={setSearch}
      />
      {filtersOpen && (
        <>
          <Select
            label="Team"
            value={team}
            onChange={setTeam}
            options={[
              { value: "all", label: "Tất cả team" },
              { value: "common", label: "Việc chung doanh nghiệp" },
              ...(teams.data?.value.teams || []).map((value) => ({
                value: value.id,
                label: value.name + (value.archivedAt ? " · Đã lưu trữ" : ""),
              })),
            ]}
          />
          <Row>
            <View style={{ flex: 1, minWidth: 145 }}>
              <Select
                label="Trạng thái"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "Tất cả" },
                  ...Object.entries(statuses).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 145 }}>
              <Select
                label="Thời gian"
                value={due}
                onChange={setDue}
                options={[
                  { value: "all", label: "Tất cả" },
                  { value: "today", label: "Hôm nay" },
                  { value: "overdue", label: "Quá hạn" },
                ]}
              />
            </View>
          </Row>
          <Select
            label="Người phụ trách"
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: "all", label: "Tất cả" },
              ...(members.data?.value.members || []).map((value) => ({
                value: value.id,
                label: value.name + (value.id === session?.user.id ? " (Tôi)" : ""),
              })),
            ]}
          />
        </>
      )}
      {error && <ErrorNotice message={errorMessage(error)} />}
      {(tasks.data?.cached || events.data?.cached) && (
        <Text style={s.muted}>
          Dữ liệu đã tải · {dateLabel(new Date(Math.max(tasks.data?.updatedAt || 0, events.data?.updatedAt || 0)).toISOString())}
        </Text>
      )}
    </View>
  );
  const empty = loading ? (
    <Loading />
  ) : !items.length && error && !hasData ? (
    <>
      <ErrorNotice message={errorMessage(error)} />
      <Button label="Thử lại" secondary onPress={retry} />
    </>
  ) : (
    <Empty
      title="Chưa có nội dung phù hợp"
      message="Thử thay đổi bộ lọc hoặc tạo một công việc hay lịch hẹn mới."
    />
  );
  const renderCard = (item: WorkItem) => {
    const isTask = item.kind === "task";
    const status = itemStatus(item);
    const end = itemEnd(item);
    const overdue = end < nowMs && status !== "done" && Number.isFinite(end);
    const onPress = () => {
      if (item.kind === "task") onSelect(item.value.id);
      else
        router.push({ pathname: "/event/[id]", params: { id: item.value.id } });
    };
    return (
      <Pressable
        testID={`${item.kind}-${item.value.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Mở ${isTask ? "công việc" : "lịch hẹn"} ${item.value.title}`}
        onPress={onPress}
        style={
          isTask && selectedId === item.value.id
            ? { borderColor: colors.green, borderWidth: 2, borderRadius: 18 }
            : undefined
        }
      >
        <Card>
          <Row>
            <Text style={s.pill}>{isTask ? "Công việc" : "Lịch hẹn"}</Text>
            <Text style={s.pill}>{statuses[status]}</Text>
            {isTask && item.value.priority === "high" && (
              <Text style={[s.pill, { color: colors.orange, backgroundColor: "#fff0dd" }]}>
                {priorities[item.value.priority]}
              </Text>
            )}
          </Row>
          <Text style={s.cardTitle}>{item.value.title}</Text>
          <Text style={s.muted} numberOfLines={2}>
            {item.value.description || "Chưa có mô tả"}
          </Text>
          <Text style={{ color: overdue ? colors.red : colors.muted }}>
            ◷ {isTask ? "Hạn: " : "Bắt đầu: "}
            {dateLabel(isTask ? item.value.dueAt : item.value.starts_at)}
            {!isTask && ` · Kết thúc ${dateLabel(item.value.ends_at)}`}
          </Text>
          {(isTask ? item.value.remindAt : item.value.remind_at) && (
            <Text style={s.muted}>
              Nhắc: {dateLabel(isTask ? item.value.remindAt : item.value.remind_at)}
            </Text>
          )}
          <Text style={s.muted}>
            {isTask
              ? `${item.value.teamName || "Việc chung"} · ${members.data?.value.members.find((member) => member.id === item.value.assigneeId)?.name || "Chưa giao"}`
              : teams.data?.value.teams.find((value) => value.id === item.value.team_id)?.name || "Việc chung"}
          </Text>
        </Card>
      </Pressable>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refresh}
      >
        {header}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={styles.boardColumns}
        >
          {groups.map((group) => (
            <View key={group.label} style={styles.boardColumn}>
              <Text style={s.cardTitle}>
                {group.label} · {group.items.length}
              </Text>
              {group.items.length ? (
                group.items.map((item) => (
                  <View key={`${item.kind}-${item.value.id}`} style={{ gap: 12 }}>
                    {renderCard(item)}
                  </View>
                ))
              ) : (
                <Text style={s.muted}>Trống</Text>
              )}
            </View>
          ))}
        </ScrollView>
        {!items.length && empty}
      </ScrollView>
      <CreateChooser visible={createOpen} onClose={chooseCreate} />
    </>
  );
}

const styles = StyleSheet.create({
  boardColumns: { gap: 12, paddingBottom: 8 },
  boardColumn: {
    width: 270,
    minHeight: 180,
    padding: 14,
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#eaf1ea",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#142d2677",
    justifyContent: "center",
    padding: 24,
  },
  modalCenter: { flex: 1, justifyContent: "center", alignItems: "center" },
  modalCard: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    gap: 16,
  },
});
