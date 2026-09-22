import React, { useMemo, useState, useEffect } from "react";
import { Pressable, SectionList, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { useResource, useSession } from "../core/session";
import type { Task, Team, Member, Column } from "../core/types";
import { statuses, priorities, dateLabel } from "../core/policy";
import { errorMessage } from "../core/api";
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
export function TaskList({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const { session, writable } = useSession();
  const tasks = useResource<{ tasks: Task[] }>("/tasks");
  const teams = useResource<{ teams: Team[] }>("/teams");
  const members = useResource<{ members: Member[] }>("/members");
  const [search, setSearch] = useState(""),
    [team, setTeam] = useState("all"),
    [status, setStatus] = useState("all"),
    [assignee, setAssignee] = useState("all"),
    [due, setDue] = useState("all"),
    [grouped, setGrouped] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const board = useResource<{ columns: Column[] }>(
    `/boards?teamId=${team === "all" || team === "common" ? "" : encodeURIComponent(team)}`,
    team !== "all" && grouped,
  );
  const items = useMemo(() => {
    const now = new Date(nowMs),
      end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      ).getTime();
    return (tasks.data?.value.tasks || [])
      .filter(
        (t) =>
          (!search ||
            `${t.title} ${t.description}`
              .toLocaleLowerCase("vi")
              .includes(search.toLocaleLowerCase("vi"))) &&
          (team === "all" ||
            (team === "common" ? !t.teamId : t.teamId === team)) &&
          (status === "all" || t.status === status) &&
          (assignee === "all" || t.assigneeId === assignee) &&
          (due === "all" ||
            (due === "overdue" &&
              Date.parse(t.dueAt) < nowMs &&
              t.status !== "done") ||
            (due === "today" &&
              Date.parse(t.dueAt) < end &&
              Date.parse(t.dueAt) >=
                new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate(),
                ).getTime())),
      )
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }, [tasks.data, search, team, status, assignee, due, nowMs]);
  const groups = grouped
    ? team !== "all" && board.data?.value.columns
      ? board.data.value.columns
          .filter((c) => !c.archivedAt)
          .map((c) => ({
            label: c.name,
            items: items.filter(
              (t) =>
                t.columnId === c.id ||
                (!t.columnId &&
                  board.data?.value.columns.find(
                    (first) => !first.archivedAt && first.status === t.status,
                  )?.id === c.id),
            ),
          }))
      : Object.entries(statuses).map(([key, label]) => ({
          label,
          items: items.filter((t) => t.status === key),
        }))
    : [{ label: "", items }];
  return (
    <SectionList
      sections={
        tasks.error || tasks.isPending || !items.length
          ? []
          : groups
              .filter((group) => group.items.length)
              .map((group) => ({ label: group.label, data: group.items }))
      }
      keyExtractor={(task) => task.id}
      stickySectionHeadersEnabled={false}
      initialNumToRender={8}
      windowSize={7}
      extraData={selectedId}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={tasks.isRefetching}
          onRefresh={() => void tasks.refetch()}
          tintColor={colors.green}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <View>
            <Text style={[s.label, { color: colors.green }]}>
              KHÔNG GIAN LÀM VIỆC
            </Text>
            <Heading>Công việc của bạn</Heading>
            <Text style={s.muted}>{session?.workspace.name}</Text>
          </View>
          <Row>
            <Button
              label="＋ Tạo công việc"
              disabled={!writable}
              onPress={() => router.push("/task/new")}
            />
            <Button
              label={grouped ? "Xem danh sách" : "Nhóm theo cột"}
              secondary
              onPress={() => setGrouped((v) => !v)}
            />
          </Row>
          <Field
            label="Tìm công việc"
            placeholder="Tên hoặc nội dung…"
            value={search}
            onChangeText={setSearch}
          />
          <Button
            label={
              filtersOpen
                ? "Ẩn bộ lọc"
                : `Bộ lọc${[team, status, assignee, due].filter((value) => value !== "all").length ? " · Đang áp dụng" : ""}`
            }
            secondary
            onPress={() => setFiltersOpen((value) => !value)}
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
                  ...(teams.data?.value.teams || []).map((t) => ({
                    value: t.id,
                    label: t.name + (t.archivedAt ? " · Đã lưu trữ" : ""),
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
                    label="Hạn công việc"
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
                  ...(members.data?.value.members || []).map((m) => ({
                    value: m.id,
                    label: m.name + (m.id === session?.user.id ? " (Tôi)" : ""),
                  })),
                ]}
              />
            </>
          )}
          {tasks.data?.cached && (
            <Text style={s.muted}>
              Dữ liệu đã tải ·{" "}
              {dateLabel(new Date(tasks.data.updatedAt).toISOString())}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        tasks.isPending ? (
          <Loading />
        ) : tasks.error ? (
          <>
            <ErrorNotice message={errorMessage(tasks.error)} />
            <Button
              label="Thử lại"
              secondary
              onPress={() => void tasks.refetch()}
            />
          </>
        ) : (
          <Empty
            title="Chưa có công việc phù hợp"
            message="Thử thay đổi bộ lọc hoặc tạo một công việc mới."
          />
        )
      }
      renderSectionHeader={({ section }) =>
        section.label ? (
          <Text style={[s.cardTitle, { paddingVertical: 12 }]}>
            {section.label} · {section.data.length}
          </Text>
        ) : null
      }
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      renderItem={({ item: task }) => (
        <Pressable
          key={task.id}
          testID={`task-${task.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Mở công việc ${task.title}`}
          onPress={() => onSelect(task.id)}
          style={
            selectedId === task.id
              ? {
                  borderColor: colors.green,
                  borderWidth: 2,
                  borderRadius: 18,
                }
              : undefined
          }
        >
          <Card>
            <Row>
              <Text style={s.pill}>{statuses[task.status]}</Text>
              {task.priority === "high" && (
                <Text
                  style={[
                    s.pill,
                    { color: colors.orange, backgroundColor: "#fff0dd" },
                  ]}
                >
                  {priorities[task.priority]}
                </Text>
              )}
            </Row>
            <Text style={s.cardTitle}>{task.title}</Text>
            <Text style={s.muted} numberOfLines={2}>
              {task.description || "Chưa có mô tả"}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color:
                  task.status !== "done" && Date.parse(task.dueAt) < nowMs
                    ? colors.red
                    : colors.muted,
              }}
            >
              ◷ {dateLabel(task.dueAt)}
            </Text>
            <Text style={s.muted}>
              {task.teamName || "Việc chung"} ·{" "}
              {members.data?.value.members.find((m) => m.id === task.assigneeId)
                ?.name || "Chưa giao"}
            </Text>
          </Card>
        </Pressable>
      )}
    />
  );
}
