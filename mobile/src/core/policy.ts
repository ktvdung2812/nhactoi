export const OFFLINE_TTL = 24 * 60 * 60 * 1000;
export function canReadOffline(
  session: { expiresAt: string; verifiedAt: number },
  now = Date.now(),
) {
  return (
    now >= session.verifiedAt &&
    now - session.verifiedAt < OFFLINE_TTL &&
    now < Date.parse(session.expiresAt)
  );
}
export function cacheScope(
  origin: string,
  userId: string,
  workspaceId: string,
) {
  return JSON.stringify([origin, userId, workspaceId]);
}
export function isWritable(
  session: {
    workspace: { suspendedAt?: string | null };
    subscription: { status: string; currentPeriodEnd: string };
  },
  online: boolean,
) {
  return (
    online &&
    !session.workspace.suspendedAt &&
    !["expired", "canceled"].includes(session.subscription.status) &&
    Date.parse(session.subscription.currentPeriodEnd) > Date.now()
  );
}
export const statuses = {
  todo: "Cần làm",
  doing: "Đang làm",
  done: "Hoàn thành",
};
export const priorities = { low: "Thấp", medium: "Bình thường", high: "Cao" };
export const repeats = {
  none: "Không lặp",
  daily: "Hàng ngày",
  weekly: "Hàng tuần",
  monthly: "Hàng tháng",
  yearly: "Hàng năm",
};
export function dateLabel(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Chưa đặt";
}

export function recurrenceLabel(recurrence: string, options?: { interval: number; weekdays: number[]; basis: "due" | "completion" }) {
  if (recurrence === "none") return "Không lặp lại";
  const unit = ({ daily: "ngày", weekly: "tuần", monthly: "tháng", yearly: "năm" } as Record<string, string>)[recurrence];
  const days = options?.weekdays?.length ? ` (${options.weekdays.map(d => d === 7 ? "CN" : `T${d + 1}`).join(", ")})` : "";
  return `Mỗi ${options?.interval || 1} ${unit}${days}, ${options?.basis === "completion" ? "từ lúc hoàn thành" : "từ hạn kỳ trước"}`;
}
