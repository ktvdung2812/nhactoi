import React, { useState } from "react";
import { Alert, Linking, ScrollView } from "react-native";
import { useResource, useSession } from "../core/session";
import { errorMessage } from "../core/api";
import { unregisterPush } from "../core/push";
import { dateLabel } from "../core/policy";
import { Heading, Text, Card, Button, Select, ErrorNotice, s } from "../ui/kit";
export function Account() {
  const { session, switchWorkspace, logout, online } = useSession();
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
  async function exit() {
    setBusy(true);
    try {
      await unregisterPush();
      await logout();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Heading>Tài khoản</Heading>
      <Card>
        <Text style={s.cardTitle}>{session.user.name}</Text>
        <Text>{session.user.email}</Text>
        <Text style={s.muted}>{session.workspace.name}</Text>
      </Card>
      <ErrorNotice message={error} />
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
          Gói hiện tại: {session.subscription.plan}
        </Text>
        <Text>
          Hạn sử dụng: {dateLabel(session.subscription.currentPeriodEnd)}
        </Text>
        <Text style={s.muted}>
          Các thao tác ghi tuân theo quyền và trạng thái doanh nghiệp.
        </Text>
      </Card>
      <Card>
        <Text style={s.cardTitle}>Dữ liệu trên thiết bị</Text>
        <Text style={s.muted}>
          Xem dữ liệu đã tải trong tối đa 24 giờ kể từ lần xác minh quyền gần
          nhất. Đăng xuất sẽ xóa bản lưu trên thiết bị.
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
            "Dữ liệu đã tải trên thiết bị sẽ được xóa.",
            [
              { text: "Hủy", style: "cancel" },
              {
                text: "Đăng xuất",
                style: "destructive",
                onPress: () => void exit(),
              },
            ],
          )
        }
      />
    </ScrollView>
  );
}
