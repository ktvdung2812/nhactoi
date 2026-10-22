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

test("already canceled requests never reach the network", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(request("/tasks", "token", { signal: controller.signal })).rejects.toMatchObject({ status: 499 });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("canceling while a successful response is decoded prevents its stale payload from being used", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { controller.abort(); return { tasks: ["old"] }; } } as Response);
  await expect(request("/tasks", "token", { signal: controller.signal })).rejects.toMatchObject({ status: 499 });
});

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

test('TC-W4-T04-A: revision conflict metadata remains available for explicit local/server comparison',async()=>{
  const payload={error:'Dữ liệu đã thay đổi.',details:{code:'revision_conflict',currentRevision:'server-revision'}};
  response(409,payload);
  await expect(request('/tasks/t','token',{method:'PATCH',body:'{}'})).rejects.toMatchObject({status:409,payload});
});
