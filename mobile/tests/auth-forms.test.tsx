import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { TextInput } from "react-native";
import {
  PasswordRecovery,
  RegisterForm,
} from "../src/features/AuthForms";
import { request } from "../src/core/api";
import { useSession } from "../src/core/session";

jest.mock("../src/core/session", () => ({
  useSession: jest.fn(),
}));
jest.mock("../src/core/api", () => ({
  request: jest.fn(),
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Có lỗi xảy ra.",
}));
jest.mock("../src/ui/frames", () => ({
  HingeSafe: ({ children }: { children: React.ReactNode }) => children,
}));

const register = jest.fn();
const transport = jest.mocked(request);
const session = jest.mocked(useSession);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  register.mockResolvedValue(undefined);
  session.mockReturnValue(
    { register } as unknown as ReturnType<typeof useSession>,
  );
});

afterEach(cleanup);

async function fill(testID: string, value: string) {
  await fireEvent.changeText(screen.getByTestId(testID), value);
}

test("registration validates confirmation and signs in with the workspace payload", async () => {
  const onRegistered = jest.fn();
  await render(<RegisterForm onBack={jest.fn()} onRegistered={onRegistered} />);

  await fill("register-name", "Nguyễn An");
  await fill("register-email", "AN@EXAMPLE.COM");
  await fill("register-password", "password123");
  await fill("register-confirm", "password123");
  await fill("register-workspace", "Đội Nhắc Tôi");
  await fill("register-industry", "Dịch vụ");
  await fireEvent.press(screen.getByTestId("register-submit"));

  await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  expect(register).toHaveBeenCalledWith({
    name: "Nguyễn An",
    email: "an@example.com",
    password: "password123",
    workspaceName: "Đội Nhắc Tôi",
    industry: "Dịch vụ",
  });
  expect(onRegistered).toHaveBeenCalledTimes(1);
});

test("password recovery sends a code, blocks resend during throttle, and resets the password", async () => {
  const onComplete = jest.fn();
  transport
    .mockResolvedValueOnce({
      message: "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận.",
      retryAfterSeconds: 60,
    })
    .mockResolvedValueOnce({ ok: true });
  await render(<PasswordRecovery onBack={jest.fn()} onComplete={onComplete} />);

  await fill("forgot-email", "user@example.com");
  await fireEvent.press(screen.getByTestId("forgot-submit"));
  await waitFor(() => expect(screen.getByTestId("reset-code")).toBeTruthy());

  expect(screen.getByTestId("reset-resend").props.accessibilityState).toEqual(
    expect.objectContaining({ disabled: true }),
  );
  await fill("reset-code", "123456");
  await fill("reset-password", "newpassword123");
  await fill("reset-confirm", "newpassword123");
  await fireEvent.press(screen.getByTestId("reset-submit"));

  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  expect(transport).toHaveBeenNthCalledWith(
    1,
    "/auth/forgot-password",
    undefined,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    }),
  );
  expect(transport).toHaveBeenNthCalledWith(
    2,
    "/auth/reset-password",
    undefined,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        email: "user@example.com",
        code: "123456",
        password: "newpassword123",
      }),
    }),
  );
  expect(onComplete).toHaveBeenCalledWith(
    "Đổi mật khẩu thành công. Bạn có thể đăng nhập ngay bây giờ.",
  );
});

test("registration keeps the API request disabled when confirmation does not match", async () => {
  await render(<RegisterForm onBack={jest.fn()} />);
  await fill("register-name", "Nguyễn An");
  await fill("register-email", "an@example.com");
  await fill("register-password", "password123");
  await fill("register-confirm", "different123");
  await fill("register-workspace", "Đội Nhắc Tôi");

  expect(screen.getByTestId("register-submit").props.accessibilityState).toEqual(
    expect.objectContaining({ disabled: false }),
  );
  await fireEvent.press(screen.getByTestId("register-submit"));
  expect(register).not.toHaveBeenCalled();
  expect(screen.getByText("Mật khẩu xác nhận chưa khớp.")).toBeTruthy();
});

test("an invalid reset code keeps the reset form open and shows the server error", async () => {
  transport
    .mockResolvedValueOnce({
      message: "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận.",
      retryAfterSeconds: 0,
    })
    .mockRejectedValueOnce(new Error("Mã xác nhận không hợp lệ hoặc đã hết hạn."));
  await render(<PasswordRecovery onBack={jest.fn()} />);

  await fill("forgot-email", "user@example.com");
  await fireEvent.press(screen.getByTestId("forgot-submit"));
  await waitFor(() => expect(screen.getByTestId("reset-code")).toBeTruthy());
  await fill("reset-code", "123456");
  await fill("reset-password", "newpassword123");
  await fill("reset-confirm", "newpassword123");
  await fireEvent.press(screen.getByTestId("reset-submit"));

  await waitFor(() =>
    expect(
      screen.getByText("Mã xác nhận không hợp lệ hoặc đã hết hạn."),
    ).toBeTruthy(),
  );
  expect(screen.getByTestId("reset-code")).toBeTruthy();
  expect(screen.getByTestId("reset-password").props.value).toBe(
    "newpassword123",
  );
});

test("a pending forgot request ignores a second keyboard submit", async () => {
  const pending = deferred<{
    message: string;
    retryAfterSeconds: number;
  }>();
  transport.mockImplementationOnce(() => pending.promise);
  await render(<PasswordRecovery onBack={jest.fn()} />);

  await fill("forgot-email", "user@example.com");
  await fireEvent.press(screen.getByTestId("forgot-submit"));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  await fireEvent(screen.getByTestId("forgot-email"), "submitEditing");
  expect(transport).toHaveBeenCalledTimes(1);

  pending.resolve({ message: "Kiểm tra hộp thư.", retryAfterSeconds: 60 });
  await waitFor(() => expect(screen.getByTestId("reset-code")).toBeTruthy());
});

const focusedTestIDs = () =>
  (TextInput.prototype.focus as jest.Mock).mock.contexts.map(
    (input) => (input as { props: { testID?: string } }).props.testID,
  );

test("registration's next key walks every field and only the last field submits", async () => {
  await render(<RegisterForm onBack={jest.fn()} />);
  for (const testID of [
    "register-name",
    "register-email",
    "register-password",
    "register-confirm",
    "register-workspace",
  ]) {
    expect(screen.getByTestId(testID).props).toMatchObject({
      returnKeyType: "next",
      submitBehavior: "submit",
    });
    await fireEvent(screen.getByTestId(testID), "submitEditing");
  }
  // The confirmation used to submit before the workspace and industry fields were filled.
  expect(focusedTestIDs()).toEqual([
    "register-email",
    "register-password",
    "register-confirm",
    "register-workspace",
    "register-industry",
  ]);
  expect(screen.queryByText("Vui lòng nhập họ tên và tên doanh nghiệp.")).toBeNull();
  expect(register).not.toHaveBeenCalled();

  await fill("register-name", "Nguyễn An");
  await fill("register-email", "an@example.com");
  await fill("register-password", "password123");
  await fill("register-confirm", "password123");
  await fill("register-workspace", "Đội Nhắc Tôi");
  await fireEvent(screen.getByTestId("register-industry"), "submitEditing");
  await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
});

test("auth emails are the iOS AutoFill username and new passwords carry the server's rules", async () => {
  await render(<RegisterForm onBack={jest.fn()} />);
  expect(screen.getByTestId("register-email").props).toMatchObject({
    textContentType: "username",
    keyboardType: "email-address",
    autoCorrect: false,
  });
  for (const testID of ["register-password", "register-confirm"]) {
    expect(screen.getByTestId(testID).props).toMatchObject({
      textContentType: "newPassword",
      passwordRules: "minlength: 8; maxlength: 256;",
    });
  }
  await cleanup();

  await render(<PasswordRecovery onBack={jest.fn()} />);
  expect(screen.getByTestId("forgot-email").props).toMatchObject({
    textContentType: "username",
    returnKeyType: "send",
  });
});

test("a complete reset code moves to the new password because the number pad has no return key", async () => {
  transport.mockResolvedValueOnce({ message: "Kiểm tra hộp thư.", retryAfterSeconds: 0 });
  await render(<PasswordRecovery onBack={jest.fn()} />);
  await fill("forgot-email", "user@example.com");
  await fireEvent.press(screen.getByTestId("forgot-submit"));
  await waitFor(() => expect(screen.getByTestId("reset-code")).toBeTruthy());

  await fill("reset-code", "123");
  expect(focusedTestIDs()).toEqual([]);
  // A one-tap AutoFill from Mail can deliver the code with spaces.
  await fill("reset-code", "123 456");
  expect(screen.getByTestId("reset-code").props.value).toBe("123456");
  expect(focusedTestIDs()).toEqual(["reset-password"]);
  // Editing an already complete code does not steal focus again.
  await fill("reset-code", "123456");
  expect(focusedTestIDs()).toEqual(["reset-password"]);

  await fireEvent(screen.getByTestId("reset-password"), "submitEditing");
  expect(focusedTestIDs()).toEqual(["reset-password", "reset-confirm"]);
  expect(screen.getByTestId("reset-password").props).toMatchObject({
    passwordRules: "minlength: 8; maxlength: 256;",
  });
});
