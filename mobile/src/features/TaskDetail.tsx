import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { router } from "expo-router";
import type { DocumentPickerAsset } from "expo-document-picker";
import { useResource, useSession, refreshData } from "../core/session";
import type { Detail, Column, Member } from "../core/types";
import { dateLabel, statuses, priorities } from "../core/policy";
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
    reactions: { emoji: string; count: number; mine: boolean }[];
  }[];
};
export function TaskDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { api, session, writable, online } = useSession();
  const base = `/tasks/${encodeURIComponent(id)}`;
  const result = useResource<Detail>(base + "/detail");
  const collaboration = useResource<Collaboration>(base + "/collaboration");
  const policy = useResource<{ enabled: boolean; maxFileSizeMb: number }>(
    base + "/upload-policy",
  );
  const task = result.data?.value.task;
  const board = useResource<{ columns: Column[] }>(
    `/boards?teamId=${task?.teamId || ""}`,
    !!task,
  );
  const [error, setError] = useState(""),
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
  const canWrite =
    writable &&
    !!result.data?.value.canWrite &&
    !result.error &&
    !result.data?.cached;
  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    after?: () => void,
  ) {
    if (!canWrite || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  async function send() {
    if (!session || busy || !canWrite) return;
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
      await api(base + "/comments", {
        method: "POST",
        body: JSON.stringify({
          body: comment,
          mentionIds,
          attachmentIds: updated.map((f) => f.id),
        }),
      });
      setComment("");
      setFiles([]);
      setMentionIds([]);
      await refreshData();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function selectFiles() {
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
    if (!session || busy) return;
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
      <Heading>{task.title}</Heading>
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
      <Card>
        <Text>{task.description || "Chưa có mô tả."}</Text>
        <Text style={s.muted}>◷ Hạn: {dateLabel(task.dueAt)}</Text>
        <Text style={s.muted}>
          ♧ {task.assigneeName || "Chưa giao"} · {task.teamName || "Việc chung"}
        </Text>
        <Text style={s.muted}>Nhắc: {dateLabel(task.remindAt)}</Text>
        <Select
          label="Chuyển sang cột"
          disabled={disabled}
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
        {canWrite && (
          <>
            <Field
              label="Bình luận"
              multiline
              value={comment}
              onChangeText={setComment}
              maxLength={5000}
            />
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
                disabled={busy || (!comment.trim() && !files.length)}
                onPress={() => void send()}
              />
            </Row>
          </>
        )}
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
              }}
            >
              <Text style={s.label}>
                {c.authorName} · {dateLabel(c.createdAt)}
              </Text>
              <Text>{c.body}</Text>
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
                    disabled={disabled}
                    onPress={() =>
                      void mutate(base + `/comments/${c.id}/reaction`, "PUT", {
                        emoji: r.emoji,
                        active: !r.mine,
                      })
                    }
                  />
                ))}
                {canWrite && meta?.canEdit && (
                  <>
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
                    <Button
                      label="Xóa bình luận"
                      secondary
                      danger
                      disabled={busy}
                      onPress={() =>
                        remove(base + `/comments/${c.id}`, "Xóa bình luận này?")
                      }
                    />
                  </>
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
