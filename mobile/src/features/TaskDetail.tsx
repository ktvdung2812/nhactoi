import React, { useEffect, useRef, useState } from "react";
import {TaskWork} from "./WorkManagement";
import {
  Alert,
  Linking,
  ScrollView,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { DocumentPickerAsset } from "expo-document-picker";
import { useResource, useSession, refreshData } from "../core/session";
import type { Detail, Column, Member, AssistantConfig, AiRun, AiSource, AiAction } from "../core/types";
import { dateLabel, statuses, priorities, recurrenceLabel } from "../core/policy";
import { queueable } from "../core/offline-state";
import { errorMessage } from "../core/api";
import { pickFiles, uploadFile, openAttachment } from "../core/files";
import {
  Text,
  Heading,
  Card,
  Row,
  Button,
  Field,
  Select,
  ErrorNotice,
  Loading,
  s,
  colors,
} from "../ui/kit";
type Collaboration = {
  watching: boolean;
  members: Member[];
  comments: {
    id: string;
    canEdit: boolean;
    canDelete?: boolean;
    reactions: { emoji: string; count: number; mine: boolean }[];
  }[];
};
type TaskExtras = {
  assigneeIds: string[];
  labelIds: string[];
  labels: { id: string; name: string; color: string }[];
  members: Member[];
};
type Reminders = {
  canRespond: boolean;
  recipients: { id: string; name: string; acknowledged_at?: string; snoozed_until?: string; snooze_sent_at?: string }[];
  history: { id: string; name: string; created_at: string; email_status?: string; push_status?: string; web_push_statuses?: Record<string, number> }[];
  zaloHistory?: { id:string; name:string; created_at:string; status:string; attempts:number; error?:string }[];
};
function deliveryStatus(status?: string) {
  return ({ delivered:"Đã chuyển tới người nhận",read:"Người nhận đã đọc",retry:"Chờ thử lại",sending:"Đang gửi",suppressed:"Đã chặn",sent: "Nhà cung cấp đã tiếp nhận", accepted: "Nhà cung cấp đã tiếp nhận", pending: "Đang chờ gửi", failed: "Gửi thất bại", skipped: "Đã bỏ qua", unknown: "Chưa rõ kết quả" } as Record<string, string>)[status || ""] || (status ? "Chưa rõ kết quả" : "Không có lượt gửi");
}
function AiEvidence({ sources = [], actions = [], token, onError }: { sources?: AiSource[]; actions?: AiAction[]; token?: string; onError: (message: string) => void }) {
  const filePath = (source: AiSource) => /^\/api\/tasks\/([^/?#]+)\/attachments\/([^/?#]+)\/download$/.exec(source.url || "");
  async function openSource(source: AiSource) {
    try {
      const path = filePath(source);
      if (source.kind === "task" && source.taskId) router.push({ pathname: "/task/[id]", params: { id: source.taskId } });
      else if (path && token) await openAttachment(decodeURIComponent(path[1]), { id: decodeURIComponent(path[2]), title: source.title || "Tài liệu", kind: "file" }, token);
      else if (source.url && /^https?:\/\//i.test(source.url)) await Linking.openURL(source.url);
    } catch (reason) { onError(errorMessage(reason)); }
  }
  return <>
    {sources.length > 0 && <View style={{ gap: 5 }}><Text style={s.label}>Nguồn tham chiếu</Text>{sources.map((source, index) => <View key={source.id || index}>
      <Text style={s.muted}>{source.title || source.url || "Ngữ cảnh công việc"} · {({ read: "Đã đọc", partial: "Đọc một phần", failed: "Chưa đọc được", unread: "Chưa đọc", unsupported: "Chưa hỗ trợ", summarized: "Đã đọc và tóm tắt" } as Record<string, string>)[source.status] || source.status}{(source.detail || source.note || source.error) ? ` · ${source.detail || source.note || source.error}` : ""}</Text>
      {(source.kind === "task" && source.taskId || (filePath(source) ? !!token : /^https?:\/\//i.test(source.url || ""))) && <Button label={`Mở nguồn ${source.title || source.url}`} secondary onPress={() => void openSource(source)} />}
    </View>)}</View>}
    {actions.length > 0 && <View style={{ gap: 5 }}><Text style={s.label}>Kết quả thao tác</Text>{actions.map((action, index) => <Text key={action.id || index} style={s.muted}>{action.summary || action.name}{action.status ? ` · ${{ completed: "Hoàn tất", failed: "Chưa thực hiện" }[action.status] || action.status}` : ""}{action.error ? ` · ${action.error}` : ""}</Text>)}</View>}
  </>;
}
export function TaskDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { api, session, writable, taskWritable = writable, online, saveDraft, readDraft } = useSession();
  const base = `/tasks/${encodeURIComponent(id)}`;
  const result = useResource<Detail>(base + "/detail");
  const collaboration = useResource<Collaboration>(base + "/collaboration", !id.startsWith("local:"));
  const extras = useResource<TaskExtras>(base + "/extras", !id.startsWith("local:"));
  const labels = useResource<{ labels: TaskExtras["labels"] }>(`/task-labels${result.data?.value.task.projectId ? `?projectId=${encodeURIComponent(result.data.value.task.projectId)}` : ""}`);
  const policy = useResource<{ enabled: boolean; maxFileSizeMb: number }>(
    base + "/upload-policy", !id.startsWith("local:"),
  );
  const reminders = useResource<Reminders>(base + "/reminders", !id.startsWith("local:"));
  const aiConfig = useResource<AssistantConfig>("/ai/config", !id.startsWith("local:"));
  const aiRuns = useResource<{ runs: AiRun[] }>(base + "/ai-runs", !id.startsWith("local:"));
  const assistant = aiConfig.data?.value.assistant;
  const runSignature = JSON.stringify(aiRuns.data?.value.runs || []);
  const previousRuns = useRef<string | null>(null);
  const refetchAi = useRef(aiRuns.refetch), refetchDetail = useRef(result.refetch), refetchCollaboration = useRef(collaboration.refetch);
  useEffect(() => { refetchAi.current = aiRuns.refetch; refetchDetail.current = result.refetch; refetchCollaboration.current = collaboration.refetch; }, [aiRuns.refetch, result.refetch, collaboration.refetch]);
  useEffect(() => {
    if (!online || id.startsWith("local:")) return;
    const timer = setInterval(() => { void refetchAi.current(); }, 3000);
    return () => clearInterval(timer);
  }, [online, id]);
  useEffect(() => { previousRuns.current = null; }, [id]);
  useEffect(() => {
    if (previousRuns.current !== null && previousRuns.current !== runSignature) { void refetchDetail.current(); void refetchCollaboration.current(); }
    previousRuns.current = runSignature;
  }, [runSignature]);
  const commentOperation = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const sending = useRef(false);
  const [commentCursor, setCommentCursor] = useState(0);
  const task = result.data?.value.task;
  const board = useResource<{ columns: Column[] }>(
    `/boards?${task?.projectId ? `projectId=${encodeURIComponent(task.projectId)}` : `teamId=${task?.teamId || ""}`}`,
    !!task,
  );
  const [error, setError] = useState(""),
    [localMessage,setLocalMessage]=useState(""),
    [busy, setBusy] = useState(false),
    [comment, setComment] = useState(""),
    [listTitle, setListTitle] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [mentionIds, setMentionIds] = useState<string[]>([]),
    [files, setFiles] = useState<{ file: DocumentPickerAsset; id?: string }[]>(
      [],
    ),
    [edit, setEdit] = useState<{
      path: string;
      field: "title" | "body";
      text: string;
    } | null>(null),
    [linkTitle, setLinkTitle] = useState(""),
    [linkUrl, setLinkUrl] = useState("");
  const mention = /(^|\s)@([^\s@]*)$/.exec(comment.slice(0, commentCursor));
  const suggestedAssistant = assistant?.enabled && mention && [assistant.name, assistant.handle].some(value => value.toLocaleLowerCase().includes(mention[2].toLocaleLowerCase())) ? assistant : null;
  const canComment = taskWritable && !!(result.data?.value.canComment ?? result.data?.value.canWrite) && !result.error;
  function pickAssistant() {
    if (!mention || !suggestedAssistant) return;
    const start = commentCursor - mention[2].length - 1;
    const insertion = `@${suggestedAssistant.handle} `;
    setComment(comment.slice(0, start) + insertion + comment.slice(commentCursor));
    setCommentCursor(start + insertion.length);
  }
  async function retryAi(run: AiRun) {
    if (!online || !canComment || busy) return;
    setBusy(true); setError("");
    try { await api(`${base}/ai-runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" }); await aiRuns.refetch(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  const canWrite =
    taskWritable &&
    !!result.data?.value.canWrite &&
    !result.error;
  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    after?: () => void,
  ) {
    if ((/\/comments\//.test(path) ? !canComment : !canWrite) || busy) return;
    if(!online&&!queueable(path,method)){setError('Thao tác này cần kết nối mạng; chưa được đưa vào hàng đợi.');return;}
    setBusy(true);
    setError("");
    try {
      await api(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(queueable(path,method)?{...(body as object),expectedRevision:task?.revision}:body) } : {}),
      });
      after?.();
      await refreshData();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const remove = (path: string, title: string) =>
    Alert.alert("Xác nhận xóa", title, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: () => void mutate(path, "DELETE"),
      },
    ]);
  async function copyTask() {
    if (!canWrite || busy || !task) return;
    setBusy(true);
    setError("");
    try {
      const copied = await api<{ task: { id: string } }>(base + "/copy", {
        method: "POST",
        body: JSON.stringify({ dueAt: task.dueAt }),
      });
      await refreshData();
      router.push({ pathname: "/task/[id]", params: { id: copied.task.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!session || sending.current || busy || !canComment || !online) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = [...files];
      for (let i = 0; i < updated.length; i++) {
        if (!updated[i].id) {
          const uploaded = await uploadFile(id, updated[i].file, session.token);
          updated[i] = { ...updated[i], id: uploaded.id };
          setFiles([...updated]);
        }
      }
      const payload = { body: comment.trim(), mentionIds, attachmentIds: updated.map((f) => f.id) };
      const fingerprint = JSON.stringify(payload);
      if (commentOperation.current?.fingerprint !== fingerprint) commentOperation.current = { fingerprint, operationId: Crypto.randomUUID() };
      await api(base + "/comments", {
        method: "POST",
        body: JSON.stringify({ ...payload, operationId: commentOperation.current.operationId }),
      });
      commentOperation.current = null;
      setComment("");
      setFiles([]);
      setMentionIds([]);
      if (saveDraft) await saveDraft(`comment:${id}`, null).catch(() => setLocalMessage("Đã gửi bình luận; chưa xóa được bản nháp trên thiết bị."));
      await refreshData();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function selectFiles() {
    if(!online)return;
    try {
      const chosen = await pickFiles(
        policy.data?.value.maxFileSizeMb || 10,
        true,
      );
      if (files.length + chosen.length > 10)
        throw new Error("Tối đa 10 tệp/bình luận.");
      setFiles((v) => [...v, ...chosen.map((file) => ({ file }))]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function upload() {
    if (!session || busy || !online) return;
    try {
      const chosen = await pickFiles(policy.data?.value.maxFileSizeMb || 10);
      if (!chosen.length) return;
      setBusy(true);
      await uploadFile(id, chosen[0], session.token);
      await refreshData();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (result.isPending) return <Loading />;
  if (result.error || !task)
    return (
      <View style={s.content}>
        <Button label="‹ Công việc" secondary onPress={onBack} />
        <ErrorNotice message={errorMessage(result.error)} />
        <Button label="Thử lại" onPress={() => void result.refetch()} />
      </View>
    );
  const data = result.data!.value,
    disabled = !canWrite || busy;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={result.isRefetching}
          onRefresh={() => void result.refetch()}
          tintColor={colors.green}
        />
      }
    >
      <Row>
        <Button label="‹ Công việc" secondary onPress={onBack} />
        <Button
          label="Chỉnh sửa"
          secondary
          disabled={disabled}
          onPress={() =>
            router.push({ pathname: "/task/edit", params: { id } })
          }
        />
      </Row>
      <Button label="Sao chép công việc" secondary disabled={disabled || !online} onPress={() => void copyTask()} />
      <Heading>{task.title}</Heading>
      {!id.startsWith("local:")&&<TaskWork key={id} taskId={id} canWrite={canWrite&&!result.data?.cached}/> }
      {task.pending&&<Text accessibilityLiveRegion="polite">Đã lưu trên thiết bị · chờ máy chủ xác nhận. Xem trạng thái tại Tài khoản → Hàng đợi.</Text>}
      <Button label={task.status==='done'?'Mở lại công việc':'Hoàn thành công việc'} disabled={disabled} onPress={()=>void mutate(base,'PATCH',{status:task.status==='done'?'todo':'done'})}/>
      <Row>
        <Text style={s.pill}>{statuses[task.status]}</Text>
        <Text style={s.pill}>Ưu tiên {priorities[task.priority]}</Text>
      </Row>
      {!canWrite && (
        <Text style={s.muted}>
          {!online
            ? "Đang xem bản đã tải. Kết nối lại để chỉnh sửa."
            : "Công việc hiện chỉ được xem."}
        </Text>
      )}
      <ErrorNotice message={error} />
      {!!localMessage&&<Text accessibilityLiveRegion="polite">{localMessage}</Text>}
      {reminders.error && <ErrorNotice message={errorMessage(reminders.error)} />}
      {reminders.data && <Card><Text style={s.cardTitle}>Nhận việc & nhắc lại</Text>
        {reminders.data.value.recipients.map(person=><Text key={person.id}>{person.name}: {person.acknowledged_at ? "đã nhận việc" : "chưa xác nhận"}{person.snoozed_until && !person.snooze_sent_at ? ` · hoãn đến ${dateLabel(person.snoozed_until)}` : ""}</Text>)}
        {reminders.data.value.canRespond && <><Button label="Đã nhận việc" disabled={disabled || task.status==='done' || !!reminders.error} onPress={()=>void mutate(base+'/reminders/acknowledge','POST',{})}/>
        <Button label="Nhắc lại sau 1 giờ" secondary disabled={disabled || task.status==='done' || !!reminders.error} onPress={()=>void mutate(base+'/reminders/snooze','POST',{minutes:60})}/><Text style={s.muted}>Hoãn nhắc chỉ áp dụng cho bạn; hạn công việc giữ nguyên.</Text></>}
      </Card>}
      <Card>
        <Text>{task.description || "Chưa có mô tả."}</Text>
        <Text style={s.muted}>◷ Hạn: {dateLabel(task.dueAt)}</Text>
        <Text style={s.muted}>◷ Bắt đầu chung: {dateLabel(task.startAt)}</Text>
        <Text style={s.muted}>
          ♧ {task.assigneeName || "Chưa giao"} · {task.teamName || "Việc chung"}
        </Text>
        <Text style={s.muted}>Nhắc: {dateLabel(task.remindAt)}</Text>
        <Text style={s.muted}>{recurrenceLabel(task.recurrence, task.recurrenceOptions)}</Text>
        <Select
          label="Chuyển sang cột"
          disabled={disabled || !online}
          value={
            task.columnId ||
            board.data?.value.columns.find(
              (c) => !c.archivedAt && c.status === task.status,
            )?.id ||
            ""
          }
          options={(board.data?.value.columns || [])
            .filter((c) => !c.archivedAt)
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(columnId) =>
            void mutate(`/boards/tasks/${id}/move`, "POST", { columnId })
          }
        />
        {collaboration.data && (
          <Button
            label={
              collaboration.data.value.watching
                ? "Đang theo dõi · Bỏ theo dõi"
                : "Theo dõi cập nhật"
            }
            secondary
            disabled={disabled}
            onPress={() =>
              void mutate(base + "/watch", "PUT", {
                watching: !collaboration.data?.value.watching,
              })
            }
          />
        )}
      </Card>
      <Card>
        <Text style={s.cardTitle}>Người phối hợp & nhãn</Text>
        {extras.isPending || labels.isPending ? <Loading /> : <>
          {(extras.error || labels.error) && <>
            <ErrorNotice message={errorMessage(extras.error || labels.error)} />
            <Button label="Tải lại nhãn và người phối hợp" secondary onPress={() => { void extras.refetch(); void labels.refetch(); }} />
          </>}
          {extras.data && <>
            <Text style={s.label}>Người phối hợp</Text>
            <Row>{extras.data.value.members.filter(member => member.id !== task.assigneeId).map(member => {
              const selected = extras.data!.value.assigneeIds.includes(member.id);
              return <Button key={member.id} label={`${selected ? "Bỏ" : "Thêm"} người phối hợp ${member.name}`} secondary={!selected}
                disabled={disabled || !!extras.error || (online && !!extras.data?.cached)}
                onPress={() => void mutate(base + "/extras", "PUT", {
                  assigneeIds: selected ? extras.data!.value.assigneeIds.filter(value => value !== member.id) : [...extras.data!.value.assigneeIds, member.id],
                  labelIds: extras.data!.value.labelIds,
                })} />;
            })}</Row>
            {!extras.data.value.assigneeIds.length && <Text style={s.muted}>Chưa có người phối hợp.</Text>}
            <Text style={s.label}>Nhãn</Text>
            <Row>{(labels.data?.value.labels || extras.data.value.labels).map(label => {
              const selected = extras.data!.value.labelIds.includes(label.id);
              return <Button key={label.id} label={`${selected ? "Bỏ" : "Thêm"} nhãn ${label.name}`} secondary={!selected}
                disabled={disabled || !!extras.error || !!labels.error || (online && (!!extras.data?.cached || !!labels.data?.cached))}
                onPress={() => void mutate(base + "/extras", "PUT", {
                  assigneeIds: extras.data!.value.assigneeIds,
                  labelIds: selected ? extras.data!.value.labelIds.filter(value => value !== label.id) : [...extras.data!.value.labelIds, label.id],
                })} />;
            })}</Row>
            {!extras.data.value.labelIds.length && <Text style={s.muted}>Chưa có nhãn.</Text>}
          </>}
        </>}
      </Card>
      {reminders.data && <Card>
        <Text style={s.cardTitle}>Lịch sử gửi lời nhắc</Text>
        <Text style={s.muted}>Nhà cung cấp tiếp nhận chưa có nghĩa người nhận đã đọc hoặc xác nhận công việc.</Text>
        {reminders.data.value.history?.map(entry => <View key={entry.id} style={{ gap: 4 }}>
          <Text>{entry.name} · {dateLabel(entry.created_at)}</Text>
          <Text>Email: {deliveryStatus(entry.email_status)}</Text>
          <Text>FCM: {deliveryStatus(entry.push_status)}</Text>
          <Text>Web Push: {Object.entries(entry.web_push_statuses || {}).map(([status, count]) => `${deliveryStatus(status)} (${count})`).join("; ") || "Không có lượt gửi"}</Text>
        </View>)}
        {reminders.data.value.zaloHistory?.map(entry=><View key={entry.id}><Text>Zalo OA · {entry.name} · {dateLabel(entry.created_at)}</Text><Text>{deliveryStatus(entry.status)} · {entry.attempts} lượt</Text>{entry.error&&<Text>{entry.error}</Text>}</View>)}
        {!reminders.data.value.history?.length&&!reminders.data.value.zaloHistory?.length && <Text style={s.muted}>Chưa có lượt gửi lời nhắc.</Text>}
        {reminders.data.cached && <Text style={s.muted}>Đang xem lịch sử đã tải.</Text>}
      </Card>}
      <Card>
        <Text style={s.cardTitle}>Checklist</Text>
        {data.checklists.map((list) => (
          <View key={list.id} style={{ gap: 10 }}>
            <Row>
              <Text style={[s.label, { flex: 1 }]}>
                {list.title} · {list.items.filter((i) => i.completed).length}/
                {list.items.length}
              </Text>
              {canWrite && (
                <>
                  <Button
                    label="Sửa tên"
                    secondary
                    disabled={busy}
                    onPress={() =>
                      setEdit({
                        path: base + `/checklists/${list.id}`,
                        field: "title",
                        text: list.title,
                      })
                    }
                  />
                  <Button
                    label="Xóa"
                    secondary
                    danger
                    disabled={busy}
                    onPress={() =>
                      remove(base + `/checklists/${list.id}`, list.title)
                    }
                  />
                </>
              )}
            </Row>
            {list.items.map((item) => (
              <View key={item.id}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.title}
                  accessibilityState={{ checked: item.completed, disabled }}
                  disabled={disabled}
                  style={{
                    minHeight: 48,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                  onPress={() =>
                    void mutate(
                      base + `/checklists/${list.id}/items/${item.id}`,
                      "PATCH",
                      { completed: !item.completed },
                    )
                  }
                >
                  <Text style={{ fontSize: 22, color: colors.green }}>
                    {item.completed ? "☑" : "☐"}
                  </Text>
                  <Text
                    style={{
                      flex: 1,
                      textDecorationLine: item.completed
                        ? "line-through"
                        : "none",
                    }}
                  >
                    {item.title}
                  </Text>
                </Pressable>
                {canWrite && (
                  <Row>
                    <Button
                      label="Đổi tên mục"
                      secondary
                      disabled={busy}
                      onPress={() =>
                        setEdit({
                          path:
                            base + `/checklists/${list.id}/items/${item.id}`,
                          field: "title",
                          text: item.title,
                        })
                      }
                    />
                    <Button
                      label="Xóa mục"
                      secondary
                      danger
                      disabled={busy}
                      onPress={() =>
                        remove(
                          base + `/checklists/${list.id}/items/${item.id}`,
                          item.title,
                        )
                      }
                    />
                  </Row>
                )}
              </View>
            ))}
            {canWrite && (
              <>
                <Field
                  label={`Mục mới trong ${list.title}`}
                  value={drafts[list.id] || ""}
                  onChangeText={(v) =>
                    setDrafts((d) => ({ ...d, [list.id]: v }))
                  }
                  maxLength={240}
                />
                <Button
                  label="Thêm mục"
                  secondary
                  disabled={busy || !drafts[list.id]?.trim()}
                  onPress={() =>
                    void mutate(
                      base + `/checklists/${list.id}/items`,
                      "POST",
                      { title: drafts[list.id] },
                      () => setDrafts((d) => ({ ...d, [list.id]: "" })),
                    )
                  }
                />
              </>
            )}
            <View style={s.divider} />
          </View>
        ))}
        {canWrite && (
          <>
            <Field
              label="Tên checklist mới"
              value={listTitle}
              onChangeText={setListTitle}
              maxLength={200}
            />
            <Button
              label="Thêm checklist"
              secondary
              disabled={busy || !listTitle.trim()}
              onPress={() =>
                void mutate(
                  base + "/checklists",
                  "POST",
                  { title: listTitle },
                  () => setListTitle(""),
                )
              }
            />
          </>
        )}
      </Card>
      {edit && (
        <Card>
          <Field
            label="Nội dung chỉnh sửa"
            multiline
            value={edit.text}
            onChangeText={(text) => setEdit({ ...edit, text })}
          />
          <Row>
            <Button
              label="Lưu thay đổi"
              disabled={disabled || !edit.text.trim()}
              onPress={() =>
                void mutate(
                  edit.path,
                  "PATCH",
                  { [edit.field]: edit.text },
                  () => setEdit(null),
                )
              }
            />
            <Button
              label="Hủy chỉnh sửa"
              secondary
              onPress={() => setEdit(null)}
            />
          </Row>
        </Card>
      )}
      <Card>
        <Text style={s.cardTitle}>Tệp và liên kết</Text>
        {data.attachments.length === 0 && (
          <Text style={s.muted}>Chưa có đính kèm.</Text>
        )}
        {data.attachments.map((file) => (
          <View key={file.id} style={{ gap: 6 }}>
            <Button
              label={`↗ ${file.originalName || file.title}`}
              secondary
              disabled={!online || busy}
              onPress={() => {
                if (session)
                  void openAttachment(id, file, session.token).catch((e) =>
                    setError(errorMessage(e)),
                  );
              }}
            />
            {canWrite && (
              <Button
                label="Gỡ đính kèm"
                secondary
                danger
                disabled={busy}
                onPress={() =>
                  remove(base + `/attachments/${file.id}`, file.title)
                }
              />
            )}
          </View>
        ))}
        {canWrite && (
          <>
            {policy.data?.value.enabled && (
              <Button
                label="Tải tệp lên"
                secondary
                disabled={busy}
                onPress={() => void upload()}
              />
            )}
            <Field
              label="Tên liên kết"
              value={linkTitle}
              onChangeText={setLinkTitle}
            />
            <Field
              label="Địa chỉ HTTPS"
              autoCapitalize="none"
              value={linkUrl}
              onChangeText={setLinkUrl}
              keyboardType="url"
            />
            <Button
              label="Thêm liên kết"
              secondary
              disabled={busy || !linkTitle.trim() || !linkUrl.trim()}
              onPress={() =>
                void mutate(
                  base + "/attachments",
                  "POST",
                  { title: linkTitle, url: linkUrl },
                  () => {
                    setLinkTitle("");
                    setLinkUrl("");
                  },
                )
              }
            />
          </>
        )}
      </Card>
      <Card>
        <Text style={s.cardTitle}>Trao đổi</Text>
        {canComment && (
          <>
            <Field
              label="Bình luận"
              multiline
              value={comment}
              onChangeText={text => { setComment(text); setCommentCursor(text.length); }}
              onSelectionChange={event => setCommentCursor(event.nativeEvent.selection.end)}
              editable={!busy}
              maxLength={5000}
            />
            {suggestedAssistant && <Button label={`@${suggestedAssistant.handle} · ${suggestedAssistant.name} · Trợ lý AI`} secondary onPress={pickAssistant} />}
            {assistant?.enabled && <Text style={s.muted}>Gọi @{assistant.handle} để đọc ngữ cảnh và thực hiện yêu cầu trong quyền của bạn.</Text>}
            {saveDraft&&<Row><Button label="Lưu nháp bình luận" secondary onPress={()=>void saveDraft(`comment:${id}`,{body:comment,mentionIds}).then(()=>setLocalMessage('Đã lưu nháp mã hóa; bình luận chưa gửi.')).catch(e=>setError(errorMessage(e)))}/><Button label="Khôi phục bình luận" secondary onPress={()=>void readDraft(`comment:${id}`).then(d=>{if(d){setComment(String(d.body||''));setMentionIds((d.mentionIds||[]) as string[]);}}).catch(e=>setError(errorMessage(e)))}/></Row>}
            {!online&&<Text>Bình luận ngoại tuyến chỉ lưu nháp, không tự gửi khi có mạng.</Text>}
            <Select
              label="Nhắc tên thành viên"
              value=""
              options={[
                { value: "", label: "Chọn người cần nhắc" },
                ...(collaboration.data?.value.members || [])
                  .filter((m) => !mentionIds.includes(m.id))
                  .map((m) => ({ value: m.id, label: m.name })),
              ]}
              onChange={(id) => {
                if (id) setMentionIds((v) => [...v, id]);
              }}
            />
            <Row>
              {mentionIds.map((id) => (
                <Button
                  key={id}
                  label={`@${collaboration.data?.value.members.find((m) => m.id === id)?.name} ×`}
                  secondary
                  onPress={() =>
                    setMentionIds((v) => v.filter((x) => x !== id))
                  }
                />
              ))}
            </Row>
            {files.map((f, i) => (
              <Button
                key={f.file.uri + i}
                secondary
                label={`${f.file.name}${f.id ? " · Đã tải" : ""} ×`}
                disabled={busy}
                onPress={() => setFiles((v) => v.filter((_, j) => i !== j))}
              />
            ))}
            <Row>
              {policy.data?.value.enabled && (
                <Button
                  label="Đính kèm"
                  secondary
                  disabled={busy}
                  onPress={() => void selectFiles()}
                />
              )}
              <Button
                label={busy ? "Đang gửi…" : "Gửi bình luận"}
                disabled={busy || !online || (!comment.trim() && !files.length)}
                onPress={() => void send()}
              />
            </Row>
          </>
        )}
        {aiRuns.error && <ErrorNotice message={`Chưa cập nhật được trạng thái trợ lý: ${errorMessage(aiRuns.error)}`} />}
        {(aiRuns.data?.value.runs || []).map(run => <View key={run.id} style={{ gap: 6, paddingVertical: 8 }}>
          <Text accessibilityLiveRegion="polite">{assistant?.name || "Trợ lý AI"} · {({ queued: "Đang chờ", reading: "Đang đọc ngữ cảnh", executing: "Đang thực hiện", completed: "Hoàn tất", failed: "Có lỗi", cancelled: "Đã dừng" } as Record<string, string>)[run.status] || run.status}</Text>
          {run.error ? <ErrorNotice message={run.error} /> : null}
          <Button label="Xem yêu cầu gốc" secondary onPress={() => { const original = data.comments.find(value => value.id === run.commentId); Alert.alert("Yêu cầu gốc", original?.body || "Bình luận đã được xóa."); }} />
          {run.status !== "completed" && <AiEvidence sources={run.sources} actions={run.actions} token={session?.token} onError={setError} />}
          {run.canRetry && <Button label="Thử lại yêu cầu AI" disabled={!canComment || busy || !online} secondary onPress={() => void retryAi(run)} />}
        </View>)}
        {data.comments.map((c) => {
          const meta = collaboration.data?.value.comments.find(
            (m) => m.id === c.id,
          );
          return (
            <View
              key={c.id}
              style={{
                gap: 8,
                paddingTop: 12,
                borderTopWidth: 1,
                borderColor: colors.line,
                ...(c.authorType === "assistant" ? { backgroundColor: colors.pale, padding: 12, borderRadius: 12 } : {}),
              }}
            >
              <Text style={s.label}>
                {c.authorName}{c.authorType === "assistant" ? " · AI" : ""} · {dateLabel(c.createdAt)}
              </Text>
              {c.replyToCommentId && <Button label="Trả lời bình luận gốc" secondary onPress={() => { const original = data.comments.find(value => value.id === c.replyToCommentId); Alert.alert("Bình luận gốc", original?.body || "Bình luận đã được xóa."); }} />}
              <Text selectable>{c.body}</Text>
              <AiEvidence sources={c.sources} actions={c.actions} token={session?.token} onError={setError} />
              {c.attachments.map((a) => (
                <Text key={a.id} style={s.muted}>
                  📎 {a.title}
                </Text>
              ))}
              <Row>
                {meta?.reactions.map((r) => (
                  <Button
                    key={r.emoji}
                    label={`${r.emoji} ${r.count || ""}`}
                    secondary={!r.mine}
                    disabled={!canComment || busy}
                    onPress={() =>
                      void mutate(base + `/comments/${c.id}/reaction`, "PUT", {
                        emoji: r.emoji,
                        active: !r.mine,
                      })
                    }
                  />
                ))}
                {canComment && meta?.canEdit && (
                    <Button
                      label="Sửa bình luận"
                      secondary
                      disabled={busy}
                      onPress={() =>
                        setEdit({
                          path: base + `/comments/${c.id}`,
                          field: "body",
                          text: c.body,
                        })
                      }
                    />
                )}
                {canComment && (meta?.canDelete ?? meta?.canEdit) && (
                    <Button
                      label="Xóa bình luận"
                      secondary
                      danger
                      disabled={busy}
                      onPress={() =>
                        remove(base + `/comments/${c.id}`, "Xóa bình luận này?")
                      }
                    />
                )}
              </Row>
            </View>
          );
        })}
      </Card>
      <Card>
        <Text style={s.cardTitle}>Lịch sử</Text>
        {data.activity.map((a) => (
          <View key={a.id}>
            <Text>
              {a.actorName} {a.summary}
            </Text>
            <Text style={s.muted}>{dateLabel(a.createdAt)}</Text>
          </View>
        ))}
      </Card>
      {canWrite && (
        <Button
          label="Chuyển vào thùng rác"
          secondary
          danger
          disabled={busy}
          onPress={() =>
            Alert.alert("Chuyển vào thùng rác", task.title, [
              { text: "Hủy", style: "cancel" },
              {
                text: "Xóa công việc",
                style: "destructive",
                onPress: () => void mutate(base, "DELETE", undefined, onBack),
              },
            ])
          }
        />
      )}
    </ScrollView>
  );
}
