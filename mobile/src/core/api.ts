export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? "http://127.0.0.1:3100" : "")
).replace(/\/$/, "");
if (!API_URL || (!__DEV__ && !API_URL.startsWith("https://")))
  throw new Error("Bản phát hành cần EXPO_PUBLIC_API_URL sử dụng HTTPS.");
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: Record<string, unknown>,
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
const authMessages: Record<string, string> = {
  "email is already registered": "Email này đã được sử dụng. Hãy đăng nhập hoặc khôi phục mật khẩu.",
  "email is invalid": "Địa chỉ email không hợp lệ.",
  "password must be between 8 and 256 characters": "Mật khẩu phải có từ 8 đến 256 ký tự.",
  "user account is disabled": "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.",
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
  if (options.signal?.aborted) throw new ApiError(499, "Yêu cầu đã hủy.");
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
    if (options.signal?.aborted) throw new ApiError(499, "Yêu cầu đã hủy.");
    if (!res.ok) {
      const raw = data.error?.message || data.error || data.message;
      const fallbackMessage =
        res.status === 401 && path === "/mobile/auth/login"
          ? "Email hoặc mật khẩu chưa đúng."
          : res.status === 404 && ["/mobile/auth/register", "/auth/forgot-password", "/auth/reset-password"].includes(path)
          ? "Máy chủ chưa hỗ trợ chức năng này. Vui lòng liên hệ quản trị viên để cập nhật hệ thống."
          : messages[res.status];
      const authMessage = typeof raw === "string" &&
        (path.startsWith("/auth/") || path.startsWith("/mobile/auth/"))
        ? authMessages[raw] : undefined;
      const message =
        typeof raw === "string" && /[À-ỹ]/.test(raw)
          ? raw
          : authMessage || fallbackMessage ||
            "Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.";
      throw new ApiError(res.status, message, data);
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
