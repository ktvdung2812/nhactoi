import React, { useState } from "react";
import {OfflineQueue} from "./OfflineQueue";
import {router} from "expo-router";
import { Alert, Linking, ScrollView } from "react-native";
import { useResource, useSession } from "../core/session";
import type { AssistantConfig } from "../core/types";
import { errorMessage } from "../core/api";
import { unregisterPush } from "../core/push";
import { dateLabel } from "../core/policy";
import { Heading, Text, Card, Button, Select, Field, ErrorNotice, s } from "../ui/kit";
export function Account() {
  const { session, switchWorkspace, logout, online, api } = useSession();
  const [invitation,setInvitation]=useState('');
  const spaces = useResource<{ workspaces: { id: string; name: string }[] }>(
    "/workspaces",
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!session) return null;
  async function change(id: string) {
    setBusy(true);
    setError("");
    try {
      await switchWorkspace(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exit(choice: "sync"|"keep"|"delete") {
    setBusy(true);
    try {
      await unregisterPush();
      await logout(choice);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Heading>Tài khoản</Heading>
      <Button label="Lịch làm việc và ủy quyền" secondary onPress={()=>router.push("/work-management")}/>
      <Button label="Tải công việc và SLA" secondary onPress={()=>router.push("/work-reports")}/>
      <Button label="Tự động hóa" secondary onPress={()=>router.push("/automations")}/>
      <Button label="Báo cáo vận hành" secondary onPress={()=>router.push("/operations")}/>
      {session.user.memberType!=="guest"&&<Button label="Dịch vụ và gia hạn" secondary onPress={()=>router.push("/service")}/>}
      {session.user.memberType!=="guest"&&<Button label="API và webhook" secondary onPress={()=>router.push("/public-integrations")}/>}
      {session.user.memberType!=="guest"&&<Button label="Google Calendar" secondary onPress={()=>router.push("/google-calendar")}/>}
      {session.user.memberType!=="guest"&&["owner","admin"].includes(session.user.role)&&<Button label="Zalo OA" secondary onPress={()=>router.push("/zalo-oa")}/>}
      <Card>
        <Text style={s.cardTitle}>{session.user.name}</Text>
        <Text>{session.user.email}</Text>
        <Text style={s.muted}>{session.workspace.name}</Text>
      </Card>
      <ErrorNotice message={error} />
      <Card>
        <Text style={s.cardTitle}>Tham gia dự án được mời</Text>
        <Field label="Liên kết mời" value={invitation} onChangeText={setInvitation} autoCapitalize="none"/>
        <Button label="Chấp nhận lời mời" disabled={!online||busy||!invitation.trim()} onPress={()=>void (async()=>{
          setBusy(true);setError('');
          try { let token=invitation.trim();if(token.includes('://'))token=new URL(token).searchParams.get('invite')||'';
            if(!token)throw new Error('Liên kết mời không hợp lệ.');
            const result=await api<{workspace:{id:string}}>('/invitations/accept',{method:'POST',body:JSON.stringify({token})});
            await switchWorkspace(result.workspace.id);setInvitation('');
          }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
        })()}/>
      </Card>
      <Select
        label="Doanh nghiệp đang làm việc"
        value={session.workspace.id}
        disabled={!online || busy}
        options={(
          spaces.data?.value.workspaces || [
            { id: session.workspace.id, name: session.workspace.name },
          ]
        ).map((w) => ({ value: w.id, label: w.name }))}
        onChange={(id) => void change(id)}
      />
      <Card>
        <Text style={s.cardTitle}>
          Gói hiện tại: {session.subscription.planName || session.subscription.plan}
        </Text>
        <Text>
          Hạn sử dụng: {dateLabel(session.subscription.currentPeriodEnd)}
        </Text>
        <Text style={s.muted}>
          Các thao tác ghi tuân theo quyền và trạng thái doanh nghiệp.
        </Text>
      </Card>
      <AssistantSettings key={session.workspace.id}/>
      <OfflineQueue/>
      <Card>
        <Text style={s.cardTitle}>Dữ liệu trên thiết bị</Text>
        <Text style={s.muted}>
          Xem dữ liệu đã tải trong tối đa 24 giờ kể từ lần xác minh quyền gần
          nhất. Hàng đợi và nháp được mã hóa riêng; khi đăng xuất, bạn chọn giữ hoặc xóa.
        </Text>
        <Text style={s.muted}>
          Kết nối: {online ? "Đang trực tuyến" : "Đang ngoại tuyến"}
        </Text>
      </Card>
      <Button
        label="Cài đặt thông báo Android"
        secondary
        onPress={() => void Linking.openSettings()}
      />
      <Button
        label="Đăng xuất"
        secondary
        danger
        disabled={busy}
        onPress={() =>
          Alert.alert(
            "Đăng xuất",
            "Cache đọc sẽ được xóa. Chọn cách xử lý nháp và hàng đợi chưa gửi.",
            [
              { text: "Đồng bộ trước", onPress:()=>void exit("sync") },
              { text: "Giữ nháp mã hóa", onPress:()=>void exit("keep") },
              { text: "Xóa nháp và thoát", style:"destructive", onPress:()=>void exit("delete") },
            ], {cancelable:true},
          )
        }
      />
    </ScrollView>
  );
}

function AssistantSettings() {
  const { api, session, online, writable } = useSession();
  const config = useResource<AssistantConfig>("/ai/config");
  const [edited, setDraft] = useState<AssistantConfig["assistant"] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const value = config.data?.value;
  const draft = edited ?? value?.assistant;
  const canManage = value?.canManageAssistant ?? value?.assistant?.canManage ?? (!!session && ["owner", "admin"].includes(session.user.role) && session.user.memberType !== "guest");
  const disabled = !canManage || !online || !writable || busy;
  async function save() {
    if (disabled || !draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<AssistantConfig>("/ai/workspace-settings", { method: "PUT", body: JSON.stringify({ name: draft.name.trim(), handle: draft.handle.trim().replace(/^@/, ""), enabled: draft.enabled }) });
      setDraft(result.assistant); await config.refetch(); setNotice("Đã cập nhật trợ lý của không gian.");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Card>
    <Text style={s.cardTitle}>Trợ lý trong bình luận</Text>
    <Text style={s.muted}>Gọi trợ lý bằng @ trong công việc. Phản hồi được chia sẻ với mọi người có quyền xem công việc.</Text>
    <ErrorNotice message={error || (config.error ? errorMessage(config.error) : "")} />
    {draft && <>
      <Select label="Trợ lý trong bình luận" disabled={disabled} value={draft.enabled ? "on" : "off"} options={[{ value: "on", label: "Bật" }, { value: "off", label: "Tắt" }]} onChange={next => setDraft({ ...draft, enabled: next === "on" })} />
      <Field label="Tên trợ lý" value={draft.name} editable={!disabled} maxLength={60} onChangeText={name => setDraft({ ...draft, name })} />
      <Field label="Tên gọi sau @" value={draft.handle} editable={!disabled} maxLength={32} autoCapitalize="none" autoCorrect={false} onChangeText={handle => setDraft({ ...draft, handle })} />
      <Text style={s.muted}>Tên gọi gồm 2–32 chữ Latin, số hoặc dấu gạch dưới; bắt đầu bằng chữ.</Text>
      <Text style={s.muted}>{value?.ready ? `Mô hình: ${value.model} · ${value.provider}` : "Nhà cung cấp AI chưa sẵn sàng. Liên hệ quản trị viên để kiểm tra cấu hình AI."}</Text>
      <Text style={s.muted}>Ảnh: {value?.capabilities?.images ? "Có hỗ trợ" : "Chưa hỗ trợ"} · PDF: {value?.capabilities?.pdf ? "Có hỗ trợ" : "Chưa hỗ trợ"}.</Text>
      {canManage ? <Button label={busy ? "Đang lưu…" : "Lưu trợ lý"} disabled={disabled || !draft.name.trim() || !draft.handle.trim()} onPress={() => void save()} /> : <Text style={s.muted}>Chủ sở hữu hoặc quản trị viên có thể thay đổi cấu hình này.</Text>}
    </>}
    {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
  </Card>;
}
