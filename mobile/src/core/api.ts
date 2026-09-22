export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? "http://127.0.0.1:3100" : "")
).replace(/\/$/, "");
if (!API_URL || (!__DEV__ && !API_URL.startsWith("https://")))
  throw new Error("Bản phát hành cần EXPO_PUBLIC_API_URL sử dụng HTTPS.");
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const messages: Record<number, string> = {
  401: "Phiên đăng nhập đã hết hạn.",
  402: "Thuê bao đã hết hạn. Hiện chỉ có thể xem dữ liệu.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Dữ liệu không còn tồn tại hoặc bạn không có quyền xem.",
  409: "Dữ liệu đã thay đổi. Hãy tải lại rồi thử tiếp.",
  413: "Tệp vượt quá dung lượng cho phép.",
  423: "Tài khoản đã bị khóa.",
  429: "Bạn thao tác quá nhanh. Hãy thử lại sau.",
  500: "Máy chủ gặp lỗi. Hãy thử lại.",
  503: "Chưa kết nối được máy chủ.",
};
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Không thực hiện được. Hãy thử lại.";
}
export async function request<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort);
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const raw = data.error?.message || data.error || data.message;
      const message =
        typeof raw === "string" && /[À-ỹ]/.test(raw)
          ? raw
          : messages[res.status] ||
            "Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.";
      throw new ApiError(res.status, message);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new ApiError(499, "Yêu cầu đã hủy.");
    throw new ApiError(0, "Mất kết nối máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
