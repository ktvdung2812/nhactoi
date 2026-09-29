import React, { useEffect, useState, useRef } from "react";
import { router } from "expo-router";
import { useResource, useSession, refreshData } from "../core/session";
import type { Task, Team, Member } from "../core/types";
import { errorMessage } from "../core/api";
import { statuses, priorities, repeats, recurrenceLabel } from "../core/policy";
import {
  FormPage,
  Field,
  Select,
  DateField,
  Button,
  ErrorNotice,
  Loading,
  Text,
  Row,
} from "../ui/kit";
export function TaskForm({ id }: { id?: string }) {
  const { api, writable, session } = useSession();
  const existing = useResource<{ task: Task }>(`/tasks/${id}`, !!id);
  const teams = useResource<{ teams: Team[] }>("/teams");
  const members = useResource<{ members: Member[] }>("/members");
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [teamId, setTeamId] = useState(""),
    [assigneeId, setAssigneeId] = useState(""),
    [status, setStatus] = useState("todo"),
    [priority, setPriority] = useState("medium"),
    [recurrence, setRecurrence] = useState("none"),
    [interval, setInterval] = useState("1"),
    [basis, setBasis] = useState<"due" | "completion">("due"),
    [weekdays, setWeekdays] = useState<number[]>([]),
    [dueAt, setDueAt] = useState<string | null>(null),
    [remindAt, setRemindAt] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const team = useResource<{ members: { userId: string; name: string }[] }>(
    `/teams/${teamId}`,
    !!teamId,
  );
  const hydrated = useRef(false);
  useEffect(() => {
    const t = existing.data?.value.task;
    if (t && !hydrated.current) {
      hydrated.current = true;
      setTitle(t.title);
      setDescription(t.description);
      setTeamId(t.teamId || "");
      setAssigneeId(t.assigneeId || "");
      setStatus(t.status);
      setPriority(t.priority);
      setRecurrence(t.recurrence);
      setInterval(String(t.recurrenceOptions?.interval || 1));
      setBasis(t.recurrenceOptions?.basis || "due");
      setWeekdays(t.recurrenceOptions?.weekdays || []);
      setDueAt(t.dueAt);
      setRemindAt(t.remindAt);
    }
  }, [existing.data]);
  const memberOptions = teamId
    ? (team.data?.value.members || []).map((m) => ({
        value: m.userId,
        label: m.name,
      }))
    : (members.data?.value.members || []).map((m) => ({
        value: m.id,
        label: m.name,
      }));
  async function save() {
    if (!title.trim()) {
      setError("Nhập tên công việc.");
      return;
    }
    if (recurrence !== "none" && !dueAt) {
      setError("Công việc lặp cần có hạn hoàn thành.");
      return;
    }
    if (remindAt && dueAt && Date.parse(remindAt) > Date.parse(dueAt)) {
      setError("Thời gian nhắc phải trước hạn công việc.");
      return;
    }
    if (recurrence !== "none" && (!Number.isInteger(Number(interval)) || Number(interval) < 1 || Number(interval) > 365)) {
      setError("Khoảng lặp phải là số nguyên từ 1 đến 365.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(id ? `/tasks/${id}` : "/tasks", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({
          title,
          description,
          teamId: teamId || null,
          assigneeId: assigneeId || null,
          status,
          priority,
          recurrence,
          recurrenceOptions: recurrence === "none" ? {} : { interval: Number(interval), basis, weekdays: recurrence === "weekly" ? weekdays : [] },
          dueAt,
          remindAt,
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
  return (
    <FormPage
      title={id ? "Sửa công việc" : "Công việc mới"}
      onBack={() => router.back()}
    >
      {id && existing.isPending ? (
        <Loading />
      ) : id && existing.error ? (
        <ErrorNotice message={errorMessage(existing.error)} />
      ) : (
        <>
          <ErrorNotice
            message={
              error || (existing.error ? errorMessage(existing.error) : "")
            }
          />
          <Field
            label="Tên công việc"
            value={title}
            onChangeText={setTitle}
            maxLength={240}
          />
          <Field
            label="Mô tả"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={5000}
          />
          <Select
            label="Team"
            disabled={
              !!id && !["owner", "admin"].includes(session?.user.role || "")
            }
            value={teamId}
            onChange={(v) => {
              setTeamId(v);
              setAssigneeId("");
            }}
            options={[
              { value: "", label: "Việc chung doanh nghiệp" },
              ...(teams.data?.value.teams || [])
                .filter((t) => !t.archivedAt || t.id === teamId)
                .map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Select
            label="Người phụ trách"
            value={assigneeId}
            onChange={setAssigneeId}
            options={[{ value: "", label: "Chưa giao" }, ...memberOptions]}
          />
          <Select
            label="Trạng thái"
            value={status}
            onChange={setStatus}
            options={Object.entries(statuses).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            label="Ưu tiên"
            value={priority}
            onChange={setPriority}
            options={Object.entries(priorities).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <DateField label="Hạn công việc (không bắt buộc)" value={dueAt} onChange={setDueAt} optional />
          <DateField
            label="Nhắc trước"
            value={remindAt}
            onChange={setRemindAt}
            optional
          />
          <Select
            label="Lặp lại"
            value={recurrence}
            onChange={setRecurrence}
            options={Object.entries(repeats).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          {recurrence !== "none" && <>
            <Field label="Khoảng lặp (1–365)" value={interval} onChangeText={setInterval} keyboardType="number-pad" />
            <Select label="Tính kỳ tiếp theo từ" value={basis} onChange={v => setBasis(v as "due" | "completion")} options={[{ value: "due", label: "Hạn kỳ trước" }, { value: "completion", label: "Lúc hoàn thành" }]} />
            {recurrence === "weekly" && <>
              <Text>Các thứ trong tuần (không chọn: cùng thứ với mốc tính kỳ)</Text>
              <Row>{[1, 2, 3, 4, 5, 6, 7].map(day => <Button key={day} label={`${weekdays.includes(day) ? "✓ " : ""}${day === 7 ? "Chủ nhật" : `Thứ ${day + 1}`}`} secondary={!weekdays.includes(day)} onPress={() => setWeekdays(days => days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort((a, b) => a - b))} />)}</Row>
              <Button label="Thứ 2–Thứ 6" secondary onPress={() => { setWeekdays([1, 2, 3, 4, 5]); setInterval("1"); }} />
            </>}
            <Text>{recurrenceLabel(recurrence, { interval: Number(interval), basis, weekdays: recurrence === "weekly" ? weekdays : [] })}</Text>
            <Text>Kỳ mới chỉ tạo sau khi hoàn thành. Tính từ hạn kỳ trước có thể tạo kỳ còn quá hạn nếu hoàn thành muộn.</Text>
          </>}
          <Button
            label={busy ? "Đang lưu…" : "Lưu công việc"}
            disabled={
              busy ||
              !writable ||
              !!existing.error ||
              !!existing.data?.value.task.teamArchived
            }
            onPress={() => void save()}
          />
        </>
      )}
    </FormPage>
  );
}
