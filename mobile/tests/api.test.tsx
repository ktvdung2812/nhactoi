import { request } from "../src/core/api";

const fetchMock = jest.mocked(fetch);

function response(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => fetchMock.mockReset());

test("rejected login explains invalid credentials instead of an expired session", async () => {
  response(401, { error: "email or password is incorrect" });
  await expect(
    request("/mobile/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email: "test@example.invalid", password: "test" }),
    }),
  ).rejects.toMatchObject({
    status: 401,
    message: "Email hoặc mật khẩu chưa đúng.",
  });
});

test("an invalid authenticated session still explains session expiry", async () => {
  response(401, { error: "authentication required" });
  await expect(request("/me", "expired-test-token")).rejects.toMatchObject({
    status: 401,
    message: "Phiên đăng nhập đã hết hạn.",
  });
});

test("server errors during login are not reported as wrong credentials", async () => {
  response(500, { error: "internal server error" });
  await expect(
    request("/mobile/auth/login", undefined, { method: "POST" }),
  ).rejects.toMatchObject({
    status: 500,
    message: "Máy chủ gặp lỗi. Hãy thử lại.",
  });
});
