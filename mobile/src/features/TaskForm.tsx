import React, { useEffect, useState, useRef } from "react";
import { router } from "expo-router";
import { useResource, useSession, refreshData } from "../core/session";
import type { Task, Team, Member, Project, ProjectMember } from "../core/types";
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
  const { api, writable, taskWritable = writable, session, saveDraft, readDraft } = useSession();
  const existing = useResource<{ task: Task }>(`/tasks/${id}`, !!id);
  const guest=session?.user.memberType==='guest';
  const projects=useResource<{projects:Project[]}>("/projects");
  const [projectId,setProjectId]=useState('');
  const projectMembers=useResource<{members:ProjectMember[]}>(`/projects/${projectId}/members`,!!projectId);
  const teams = useResource<{ teams: Team[] }>("/teams",!guest);
  const members = useResource<{ members: Member[] }>("/members",!guest);
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
    `/teams/${teamId}?tasks=none`,
    !!teamId && !guest,
  );
  const hydrated = useRef(false);
  const revision = useRef<string | undefined>(undefined);
  const retryOperation=useRef<string|undefined>(undefined);
  useEffect(() => {
    const t = existing.data?.value.task;
    if (t && !hydrated.current) {
      hydrated.current = true;
      revision.current = t.revision;
      setTitle(t.title);
      setDescription(t.description);
      setTeamId(t.teamId || "");
      setProjectId(t.projectId||'');
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
  const memberOptions = projectId ? (projectMembers.data?.value.members||[]).map(m=>({value:m.id,label:m.name})) : teamId
    ? (team.data?.value.members || []).map((m) => ({
        value: m.userId,
        label: m.name,
      }))
    : (members.data?.value.members || []).map((m) => ({
        value: m.id,
        label: m.name,
      }));
  const draftKey=`task-form:${id||'new'}`;
  const [draftMessage,setDraftMessage]=useState('');
  const payload=()=>({_offlineOperationId:retryOperation.current,expectedRevision:id?revision.current:undefined,title,description,projectId:projectId||undefined,
    teamId:projectId?projects.data?.value.projects.find(p=>p.id===projectId)?.teamId||null:teamId||null,
    assigneeId:assigneeId||null,status,priority,recurrence,recurrenceOptions:recurrence==='none'?{}:{interval:Number(interval),basis,weekdays:recurrence==='weekly'?weekdays:[]},dueAt,remindAt});
  async function restoreDraft() {
    try {const d=await readDraft(draftKey);if(!d){setDraftMessage('Không có nháp đã lưu.');return;}
      setTitle(String(d.title||''));setDescription(String(d.description||''));setProjectId(String(d.projectId||''));setTeamId(String(d.teamId||''));setAssigneeId(String(d.assigneeId||''));
      setStatus(String(d.status||'todo'));setPriority(String(d.priority||'medium'));setRecurrence(String(d.recurrence||'none'));setDueAt(d.dueAt as string|null);setRemindAt(d.remindAt as string|null);
      const options=d.recurrenceOptions as {interval?:number;basis?:'due'|'completion';weekdays?:number[]};setInterval(String(options?.interval||1));setBasis(options?.basis||'due');setWeekdays(options?.weekdays||[]);
      revision.current=d.expectedRevision as string|undefined;retryOperation.current=d._offlineOperationId as string|undefined;setDraftMessage('Đã khôi phục bản nháp; chưa gửi máy chủ.');
    }catch(e){setError(errorMessage(e));}
  }
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
      const result=await api<{pending?:boolean;task?:{id:string}}>(id ? `/tasks/${id}` : "/tasks", {
        method:id?'PATCH':'POST',body:JSON.stringify(payload()),
      });
      if(saveDraft)await saveDraft(draftKey,null);
      await refreshData();
      if(result?.pending && result.task?.id)router.replace({pathname:'/task/[id]',params:{id:result.task.id}});
      else router.back();
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
          {saveDraft && <Row><Button label="Lưu nháp mã hóa" secondary disabled={busy||!taskWritable} onPress={()=>void saveDraft(draftKey,payload()).then(()=>setDraftMessage('Đã lưu nháp mã hóa trên thiết bị.')).catch(e=>setError(errorMessage(e)))}/><Button label="Khôi phục nháp" secondary onPress={()=>void restoreDraft()}/></Row>}
          {!!draftMessage&&<Text>{draftMessage}</Text>}
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
          <Select label="Dự án công việc" value={projectId} onChange={value=>{setProjectId(value);setAssigneeId('');const p=projects.data?.value.projects.find(p=>p.id===value);if(p)setTeamId(p.teamId||'');}} options={[{value:'',label:'Dự án mặc định của team'},...(projects.data?.value.projects||[]).filter(p=>p.canEdit||p.id===existing.data?.value.task.projectId).map(p=>({value:p.id,label:p.name+(p.readonly?' · Chỉ đọc':'')}))]}/>
          <Select
            label="Team"
            disabled={
              !!projectId || (!!id && !["owner", "admin"].includes(session?.user.role || ""))
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
              !taskWritable ||
              (!!projectId && projects.data?.value.projects.find(p=>p.id===projectId)?.canEdit===false) ||
              (guest&&!projectId) ||
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
