import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { request } from "./api";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
export const pushConfigured = !!Constants.expoConfig?.extra?.pushConfigured;
export async function installationId() {
  let id = await SecureStore.getItemAsync("nhactoi.installation");
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync("nhactoi.installation", id);
  }
  return id;
}
export async function registerPush(token: string, ask = false) {
  if (!pushConfigured)
    throw new Error(
      "Bản local chưa cấu hình Firebase. Hộp thư trong ứng dụng vẫn hoạt động.",
    );
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Nhắc việc và cộng tác",
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  const permission = ask
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    if (ask)
      throw new Error(
        "Thông báo đang tắt. Bạn có thể bật trong Cài đặt Android.",
      );
    return false;
  }
  const native = await Notifications.getDevicePushTokenAsync();
  await request(`/mobile/devices/${await installationId()}`, token, {
    method: "PUT",
    body: JSON.stringify({ fcmToken: native.data, platform: "android" }),
  });
  return true;
}
export async function unregisterPush(token?: string) {
  await Notifications.dismissAllNotificationsAsync();
  if (pushConfigured)
    await Notifications.unregisterForNotificationsAsync().catch(() => {});
  if (token)
    await request(`/mobile/devices/${await installationId()}`, token, {
      method: "DELETE",
    }).catch(() => {});
  await SecureStore.deleteItemAsync("nhactoi.installation");
}
export function notificationTarget(data: Record<string, unknown>) {
  const idPattern = /^[A-Za-z0-9_-]+$/;
  const workspaceId =
    typeof data.workspaceId === "string" && idPattern.test(data.workspaceId)
      ? data.workspaceId
      : undefined;
  const userId = typeof data.userId === "string" ? data.userId : undefined;
  const taskId =
    typeof data.taskId === "string" && idPattern.test(data.taskId)
      ? data.taskId
      : undefined;
  const eventId =
    data.entityType === "calendar_event" &&
    typeof data.entityId === "string" &&
    idPattern.test(data.entityId)
      ? data.entityId
      : undefined;
  return { workspaceId, userId, taskId, eventId };
}
