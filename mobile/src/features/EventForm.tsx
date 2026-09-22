import React, { useEffect, useState, useRef } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useResource, useSession, refreshData } from "../core/session";
import type { CalendarEvent, Team } from "../core/types";
import { errorMessage } from "../core/api";
import {
  FormPage,
  Field,
  DateField,
  Select,
  Button,
  Loading,
  ErrorNotice,
  Text,
  s,
} from "../ui/kit";
export function EventForm({ id }: { id?: string }) {
  const { api, writable } = useSession();
  const result = useResource<{ event: CalendarEvent }>(
    `/calendar-events/${id}`,
    !!id,
  );
  const teams = useResource<{ teams: Team[] }>("/teams");
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [startsAt, setStartsAt] = useState<string | null>(() =>
      new Date(Date.now() + 3600000).toISOString(),
    ),
    [endsAt, setEndsAt] = useState<string | null>(() =>
      new Date(Date.now() + 7200000).toISOString(),
    ),
    [remindAt, setRemindAt] = useState<string | null>(null),
    [teamId, setTeamId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const hydrated = useRef(false);
  useEffect(() => {
    const e = result.data?.value.event;
    if (e && !hydrated.current) {
      hydrated.current = true;
      setTitle(e.title);
      setDescription(e.description);
      setStartsAt(e.starts_at);
      setEndsAt(e.ends_at);
      setRemindAt(e.remind_at);
      setTeamId(e.team_id || "");
    }
  }, [result.data]);
  const allowed =
    writable && (!id || !!result.data?.value.event.canEdit) && !result.error;
  async function save() {
    if (
      !title.trim() ||
      !startsAt ||
      !endsAt ||
      Date.parse(endsAt) <= Date.parse(startsAt) ||
      (remindAt && Date.parse(remindAt) > Date.parse(startsAt))
    ) {
      setError(
        "Nhập tên lịch hẹn; giờ kết thúc sau bắt đầu và giờ nhắc trước bắt đầu.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(id ? `/calendar-events/${id}` : "/calendar-events", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          title,
          description,
          startsAt,
          endsAt,
          remindAt,
          teamId: teamId || null,
        }),
      });
      await refreshData();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/calendar-events/${id}`, { method: "DELETE" });
      await refreshData();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormPage
      title={id ? "Lịch hẹn" : "Lịch hẹn mới"}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    >
      {id && result.isPending ? (
        <Loading />
      ) : id && result.error ? (
        <ErrorNotice message={errorMessage(result.error)} />
      ) : (
        <>
          <ErrorNotice
            message={error || (result.error ? errorMessage(result.error) : "")}
          />
          {!allowed && <Text style={s.muted}>Lịch hẹn chỉ được xem.</Text>}
          <Field
            label="Tên lịch hẹn"
            value={title}
            onChangeText={setTitle}
            editable={allowed}
            maxLength={200}
          />
          <Field
            label="Ghi chú"
            multiline
            value={description}
            onChangeText={setDescription}
            editable={allowed}
            maxLength={5000}
          />
          <DateField
            label="Bắt đầu"
            value={startsAt}
            onChange={setStartsAt}
            disabled={!allowed}
          />
          <DateField
            label="Kết thúc"
            value={endsAt}
            onChange={setEndsAt}
            disabled={!allowed}
          />
          <DateField
            label="Nhắc trước"
            value={remindAt}
            onChange={setRemindAt}
            disabled={!allowed}
            optional
          />
          <Text style={s.muted}>
            Lời nhắc gửi đến người tạo lịch, theo quy tắc hiện tại.
          </Text>
          <Select
            label="Team"
            value={teamId}
            onChange={setTeamId}
            disabled={!allowed}
            options={[
              { value: "", label: "Việc chung doanh nghiệp" },
              ...(teams.data?.value.teams || [])
                .filter((t) => !t.archivedAt || t.id === teamId)
                .map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Button
            label={busy ? "Đang lưu…" : "Lưu lịch hẹn"}
            disabled={busy || !allowed}
            onPress={() => void save()}
          />
          {id && allowed && (
            <Button
              label="Xóa lịch hẹn"
              secondary
              danger
              disabled={busy}
              onPress={() =>
                Alert.alert("Xóa lịch hẹn", title, [
                  { text: "Hủy", style: "cancel" },
                  {
                    text: "Xóa",
                    style: "destructive",
                    onPress: () => void remove(),
                  },
                ])
              }
            />
          )}
        </>
      )}
    </FormPage>
  );
}
