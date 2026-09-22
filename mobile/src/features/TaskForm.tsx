import React, { useEffect, useState, useRef } from "react";
import { router } from "expo-router";
import { useResource, useSession, refreshData } from "../core/session";
import type { Task, Team, Member } from "../core/types";
import { errorMessage } from "../core/api";
import { statuses, priorities, repeats } from "../core/policy";
import {
  FormPage,
  Field,
  Select,
  DateField,
  Button,
  ErrorNotice,
  Loading,
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
    [dueAt, setDueAt] = useState<string | null>(() =>
      new Date(Date.now() + 86400000).toISOString(),
    ),
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
    if (!title.trim() || !dueAt) {
      setError("Nhập tên và hạn công việc.");
      return;
    }
    if (remindAt && Date.parse(remindAt) > Date.parse(dueAt)) {
      setError("Thời gian nhắc phải trước hạn công việc.");
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
          <DateField label="Hạn công việc" value={dueAt} onChange={setDueAt} />
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
