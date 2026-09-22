import { request } from "../src/core/api";

const fetchMock = jest.mocked(fetch);
beforeEach(() => fetchMock.mockReset());

test.each(["/mobile/auth/register", "/auth/forgot-password", "/auth/reset-password"])(
  "missing authentication endpoint %s explains the server update requirement",
  async (path) => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 404,
      json: async () => ({ error: "route was not found" }),
    } as Response);
    await expect(request(path, undefined, { method: "POST" }))
      .rejects.toMatchObject({ status: 404, message: "Máy chủ chưa hỗ trợ chức năng này. Vui lòng liên hệ quản trị viên để cập nhật hệ thống." });
  },
);

test("missing task retains the resource access message", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false, status: 404, json: async () => ({ error: "task was not found" }),
  } as Response);
  await expect(request("/tasks/missing", "test-token"))
    .rejects.toMatchObject({ status: 404, message: "Dữ liệu không còn tồn tại hoặc bạn không có quyền xem." });
});

test("registration explains an existing email and offers recovery", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false, status: 409,
    json: async () => ({ error: "email is already registered" }),
  } as Response);
  await expect(request("/mobile/auth/register", undefined, { method: "POST" }))
    .rejects.toMatchObject({ status: 409, message: "Email này đã được sử dụng. Hãy đăng nhập hoặc khôi phục mật khẩu." });
});

test("recovery preserves an actionable SMTP configuration error", async () => {
  const message = "Chức năng khôi phục mật khẩu chưa được cấu hình email. Vui lòng liên hệ quản trị viên.";
  fetchMock.mockResolvedValueOnce({
    ok: false, status: 503, json: async () => ({ error: message }),
  } as Response);
  await expect(request("/auth/forgot-password", undefined, { method: "POST" }))
    .rejects.toMatchObject({ status: 503, message });
});
