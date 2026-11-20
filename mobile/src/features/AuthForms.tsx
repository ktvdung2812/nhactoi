import { useTheme } from "../ui/theme";
import React, { useEffect, useRef, useState } from "react";
import { View, type TextInput } from "react-native";
import { errorMessage, request } from "../core/api";
import { useSession } from "../core/session";
import { useKitStyles,
  Button,
  Card,
  ErrorNotice,
  Field,
  FormPage,
  Text,
} from "../ui/kit";

const GENERIC_RESET_MESSAGE =
  "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận. Vui lòng kiểm tra cả thư rác.";

export type RegistrationInput = {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
  industry?: string;
};

export type RecoveryResponse = {
  message: string;
  retryAfterSeconds: number;
};

type BackProps = { onBack: () => void };

/**
 * kit's Field spreads its remaining props onto TextInput and React 19 passes `ref` as a prop, so a
 * ref given here reaches the native input. Typed locally because TextInputProps omits `ref`.
 */
export const FocusableField = Field as (
  props: React.ComponentProps<typeof Field> & { ref?: React.Ref<TextInput> },
) => React.ReactElement;

// Shared with Login/Account; the single source lives in the UI kit.
export { keyboardAwareScrollProps, readableWidth } from "../ui/kit";

/** iOS strong-password suggestions must satisfy the same length rule the server enforces. */
const PASSWORD_RULES = "minlength: 8; maxlength: 256;";

function emailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordError(password: string, confirmation: string) {
  if (password.length < 8) return "Mật khẩu cần có ít nhất 8 ký tự.";
  if (password.length > 256) return "Mật khẩu không được dài quá 256 ký tự.";
  if (password !== confirmation) return "Mật khẩu xác nhận chưa khớp.";
  return "";
}

/** Registration form for a new workspace owner. A successful registration signs in. */
export function RegisterForm({
  onBack,
  onRegistered,
}: BackProps & { onRegistered?: () => void }) {
  const s = useKitStyles();
  const { register } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const workspaceRef = useRef<TextInput>(null);
  const industryRef = useRef<TextInput>(null);

  const submit = async () => {
    if (busy) return;
    const values: RegistrationInput = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      workspaceName: workspaceName.trim(),
      ...(industry.trim() ? { industry: industry.trim() } : {}),
    };
    if (!values.name || !values.workspaceName) {
      setError("Vui lòng nhập họ tên và tên doanh nghiệp.");
      return;
    }
    if (!emailIsValid(values.email)) {
      setError("Email chưa đúng định dạng.");
      return;
    }
    const passwordIssue = passwordError(password, confirmation);
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await register(values);
      onRegistered?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormPage
      title="Tạo tài khoản"
      onBack={() => {
        if (!busy) onBack();
      }}
    >
      <Card>
        <Text style={s.muted}>
          Tạo không gian làm việc để bắt đầu cùng đội nhóm.
        </Text>
        <ErrorNotice message={error} />
        {/* Each "next" key moves to the following field; only the last field submits. */}
        <FocusableField
          label="Họ và tên"
          testID="register-name"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!busy}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <FocusableField
          ref={emailRef}
          label="Email"
          testID="register-email"
          value={email}
          onChangeText={setEmail}
          maxLength={320}
          editable={!busy}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          // The email is the account name: iOS saves the new password under it.
          textContentType="username"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <FocusableField
          ref={passwordRef}
          label="Mật khẩu"
          testID="register-password"
          value={password}
          onChangeText={setPassword}
          maxLength={256}
          editable={!busy}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          passwordRules={PASSWORD_RULES}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmationRef.current?.focus()}
        />
        <FocusableField
          ref={confirmationRef}
          label="Nhập lại mật khẩu"
          testID="register-confirm"
          value={confirmation}
          onChangeText={setConfirmation}
          maxLength={256}
          editable={!busy}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          passwordRules={PASSWORD_RULES}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => workspaceRef.current?.focus()}
        />
        <FocusableField
          ref={workspaceRef}
          label="Tên doanh nghiệp"
          testID="register-workspace"
          value={workspaceName}
          onChangeText={setWorkspaceName}
          maxLength={160}
          editable={!busy}
          autoComplete="organization"
          textContentType="organizationName"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => industryRef.current?.focus()}
        />
        <FocusableField
          ref={industryRef}
          label="Ngành nghề (không bắt buộc)"
          testID="register-industry"
          value={industry}
          onChangeText={setIndustry}
          maxLength={120}
          editable={!busy}
          autoComplete="off"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Button
          testID="register-submit"
          label={busy ? "Đang tạo tài khoản…" : "Tạo tài khoản"}
          disabled={busy || !name.trim() || !email.trim() || !password || !confirmation || !workspaceName.trim()}
          onPress={() => void submit()}
        />
      </Card>
    </FormPage>
  );
}

type ForgotProps = BackProps & {
  onSent: (email: string, response: RecoveryResponse) => void;
};

/** Requests a password reset code and hands the normalized email to the code form. */
export function ForgotPasswordForm({ onBack, onSent }: ForgotProps) {
  const s = useKitStyles();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const normalized = email.trim().toLowerCase();
    if (!emailIsValid(normalized)) {
      setError("Email chưa đúng định dạng.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        message?: string;
        retryAfterSeconds?: number;
      }>("/auth/forgot-password", undefined, {
        method: "POST",
        body: JSON.stringify({ email: normalized }),
      });
      onSent(normalized, {
        message: result.message || GENERIC_RESET_MESSAGE,
        retryAfterSeconds: Math.max(0, result.retryAfterSeconds ?? 60),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormPage
      title="Khôi phục mật khẩu"
      onBack={() => {
        if (!busy) onBack();
      }}
    >
      <Card>
        <Text style={s.muted}>
          Nhập email tài khoản. Nếu email hợp lệ, mã xác nhận sẽ được gửi đến
          hộp thư của bạn.
        </Text>
        <ErrorNotice message={error} />
        <Field
          label="Email"
          testID="forgot-email"
          value={email}
          onChangeText={setEmail}
          maxLength={320}
          editable={!busy}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="username"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
        />
        <Button
          testID="forgot-submit"
          label={busy ? "Đang gửi mã…" : "Gửi mã xác nhận"}
          disabled={busy || !email.trim()}
          onPress={() => void submit()}
        />
      </Card>
    </FormPage>
  );
}

type ResetProps = BackProps & {
  email: string;
  message?: string;
  retryAfterSeconds?: number;
  onResend?: () => Promise<RecoveryResponse>;
  onComplete: (message: string) => void;
};

/** Verifies the six-digit code and changes the password. */
export function ResetPasswordForm({
  email,
  message,
  retryAfterSeconds = 60,
  onBack,
  onResend,
  onComplete,
}: ResetProps) {
  const s = useKitStyles();
  const { colors } = useTheme();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(message || "");
  const [retryAfter, setRetryAfter] = useState(Math.max(0, retryAfterSeconds));
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const submit = async () => {
    if (busy || resending) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Mã xác nhận gồm 6 chữ số.");
      return;
    }
    const passwordIssue = passwordError(password, confirmation);
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request<{ ok: true }>("/auth/reset-password", undefined, {
        method: "POST",
        body: JSON.stringify({ email, code, password }),
      });
      setCode("");
      setPassword("");
      setConfirmation("");
      onComplete("Đổi mật khẩu thành công. Bạn có thể đăng nhập ngay bây giờ.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!onResend || retryAfter > 0 || busy || resending) return;
    setResending(true);
    setError("");
    try {
      const result = await onResend();
      setNotice(result.message || GENERIC_RESET_MESSAGE);
      setRetryAfter(Math.max(0, result.retryAfterSeconds));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <FormPage
      title="Đặt lại mật khẩu"
      onBack={() => {
        if (!busy && !resending) onBack();
      }}
    >
      <Card>
        <Text style={s.muted}>
          Nếu email thuộc tài khoản đang hoạt động, hãy kiểm tra hộp thư của{" "}
          <Text style={{ fontFamily: "BeVietnamPro_600SemiBold" }}>
            {email}
          </Text>{" "}
          để tìm mã xác nhận. Mã có hiệu lực trong 15 phút và chỉ dùng một lần.
        </Text>
        {notice ? (
          <Text testID="reset-message" style={{ color: colors.accent }}>
            {notice}
          </Text>
        ) : null}
        <ErrorNotice message={error} />
        <FocusableField
          label="Mã xác nhận (6 chữ số)"
          testID="reset-code"
          value={code}
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            // The number pad has no return key on iPhone: move on once the code is complete,
            // including when iOS fills it from Mail with one tap.
            if (digits.length === 6 && code.length !== 6) passwordRef.current?.focus();
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!busy && !resending}
        />
        <FocusableField
          ref={passwordRef}
          label="Mật khẩu mới"
          testID="reset-password"
          value={password}
          onChangeText={setPassword}
          maxLength={256}
          editable={!busy && !resending}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          passwordRules={PASSWORD_RULES}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => confirmationRef.current?.focus()}
        />
        <FocusableField
          ref={confirmationRef}
          label="Nhập lại mật khẩu mới"
          testID="reset-confirm"
          value={confirmation}
          onChangeText={setConfirmation}
          maxLength={256}
          editable={!busy && !resending}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          passwordRules={PASSWORD_RULES}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Button
          testID="reset-submit"
          label={busy ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
          disabled={busy || resending || code.length !== 6 || !password || !confirmation}
          onPress={() => void submit()}
        />
        {onResend ? (
          <View style={{ gap: 8 }}>
            <Button
              testID="reset-resend"
              label={
                resending
                  ? "Đang gửi lại mã…"
                  : retryAfter > 0
                    ? `Gửi lại mã sau ${retryAfter}s`
                    : "Gửi lại mã"
              }
              secondary
              disabled={busy || resending || retryAfter > 0}
              onPress={() => void resend()}
            />
            {retryAfter > 0 ? (
              <Text style={[s.muted, { textAlign: "center", fontSize: 12 }]}>
                Vì lý do bảo mật, bạn có thể yêu cầu mã mới sau {retryAfter} giây.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>
    </FormPage>
  );
}

/** Complete email -> code -> password recovery flow for the login screen. */
export function PasswordRecovery({
  onBack,
  onComplete,
}: BackProps & { onComplete?: (message: string) => void }) {
  const [sent, setSent] = useState<
    { email: string; response: RecoveryResponse } | undefined
  >();

  const send = async (email: string): Promise<RecoveryResponse> => {
    const result = await request<{
      message?: string;
      retryAfterSeconds?: number;
    }>("/auth/forgot-password", undefined, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return {
      message: result.message || GENERIC_RESET_MESSAGE,
      retryAfterSeconds: Math.max(0, result.retryAfterSeconds ?? 60),
    };
  };

  if (!sent) {
    return (
      <ForgotPasswordForm
        onBack={onBack}
        onSent={(email, response) => setSent({ email, response })}
      />
    );
  }

  return (
    <ResetPasswordForm
      email={sent.email}
      message={sent.response.message}
      retryAfterSeconds={sent.response.retryAfterSeconds}
      onBack={onBack}
      onResend={() => send(sent.email)}
      onComplete={(message) => {
        if (onComplete) onComplete(message);
        else onBack();
      }}
    />
  );
}
