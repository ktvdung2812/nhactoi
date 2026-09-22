import React, { useState } from "react";
import { ScrollView, View, Pressable, RefreshControl } from "react-native";
import { router } from "expo-router";
import { useResource, useSession } from "../core/session";
import type { Task, CalendarEvent } from "../core/types";
import { dateLabel } from "../core/policy";
import { errorMessage } from "../core/api";
import {
  Heading,
  Text,
  Card,
  Button,
  Row,
  Loading,
  ErrorNotice,
  Empty,
  s,
  colors,
} from "../ui/kit";
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export function Calendar({ onTask }: { onTask: (id: string) => void }) {
  const { writable } = useSession();
  const tasks = useResource<{ tasks: Task[] }>("/tasks");
  const events = useResource<{ events: CalendarEvent[] }>("/calendar-events");
  const [month, setMonth] = useState(new Date()),
    [selected, setSelected] = useState(new Date());
  const count = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate(),
    offset =
      (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const dailyTasks = (tasks.data?.value.tasks || []).filter(
    (t) => dayKey(new Date(t.dueAt)) === dayKey(selected),
  );
  const dailyEvents = (
    events.data?.value.events.filter((e) => !e.service_id) || []
  ).filter((e) => dayKey(new Date(e.starts_at)) === dayKey(selected));
  return (
    <ScrollView
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={tasks.isRefetching || events.isRefetching}
          onRefresh={() => {
            void tasks.refetch();
            void events.refetch();
          }}
          tintColor={colors.green}
        />
      }
    >
      <Heading>Lịch của bạn</Heading>
      <Text style={s.muted}>Công việc và lịch hẹn, cùng một nơi.</Text>
      <Button
        label="＋ Tạo lịch hẹn"
        disabled={!writable}
        onPress={() => router.push("/event/new")}
      />
      <Card>
        <Row>
          <Button
            label="‹ Tháng trước"
            secondary
            onPress={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          />
          <Text style={s.cardTitle}>
            {month.toLocaleDateString("vi-VN", {
              month: "long",
              year: "numeric",
            })}
          </Text>
          <Button
            label="Tháng sau ›"
            secondary
            onPress={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          />
        </Row>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
            <Text
              key={d}
              style={{
                width: "14.285%",
                textAlign: "center",
                paddingVertical: 8,
                fontSize: 12,
              }}
            >
              {d}
            </Text>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <View key={"space" + i} style={{ width: "14.285%" }} />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const date = new Date(month.getFullYear(), month.getMonth(), i + 1),
              active = dayKey(date) === dayKey(selected);
            const has =
              (tasks.data?.value.tasks || []).some(
                (t) => dayKey(new Date(t.dueAt)) === dayKey(date),
              ) ||
              (
                events.data?.value.events.filter((e) => !e.service_id) || []
              ).some((e) => dayKey(new Date(e.starts_at)) === dayKey(date));
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={date.toLocaleDateString("vi-VN")}
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(date)}
                style={{
                  width: "14.285%",
                  minHeight: 52,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? colors.green : undefined,
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: active ? "white" : colors.ink }}>
                  {i + 1}
                </Text>
                <Text
                  style={{
                    fontSize: 9,
                    lineHeight: 10,
                    color: active ? "white" : colors.green,
                  }}
                >
                  {has ? "●" : " "}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Text style={s.cardTitle}>
        {selected.toLocaleDateString("vi-VN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </Text>
      {(tasks.isPending || events.isPending) && <Loading />}
      <ErrorNotice
        message={
          tasks.error
            ? errorMessage(tasks.error)
            : events.error
              ? errorMessage(events.error)
              : ""
        }
      />
      {!dailyTasks.length &&
        !dailyEvents.length &&
        !tasks.isPending &&
        !events.isPending && (
          <Empty
            title="Một ngày còn trống"
            message="Công việc và lịch hẹn trong ngày sẽ xuất hiện ở đây."
          />
        )}
      {dailyTasks.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onTask(t.id)}
          accessibilityRole="button"
        >
          <Card>
            <Text style={s.pill}>Công việc</Text>
            <Text style={s.cardTitle}>{t.title}</Text>
            <Text style={s.muted}>{dateLabel(t.dueAt)}</Text>
          </Card>
        </Pressable>
      ))}
      {dailyEvents.map((e) => (
        <Pressable
          key={e.id}
          onPress={() =>
            router.push({ pathname: "/event/[id]", params: { id: e.id } })
          }
          accessibilityRole="button"
        >
          <Card>
            <Text style={s.pill}>Lịch hẹn</Text>
            <Text style={s.cardTitle}>{e.title}</Text>
            <Text style={s.muted}>
              {dateLabel(e.starts_at)} –{" "}
              {new Date(e.ends_at).toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
