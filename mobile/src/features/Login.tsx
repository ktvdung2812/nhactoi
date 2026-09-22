import React, { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HingeSafe } from "../ui/frames";
import { useSession } from "../core/session";
import { errorMessage } from "../core/api";
import { PasswordRecovery, RegisterForm } from "./AuthForms";
import {
  Text,
  Heading,
  Card,
  Field,
  Button,
  ErrorNotice,
  s,
  colors,
} from "../ui/kit";
export function Login() {
  const { login, error: sessionError } = useSession();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [mode, setMode] = useState<"login" | "register" | "recovery">("login"),
    [busy, setBusy] = useState(false);
  const switchMode = (next: "login" | "register" | "recovery") => {
    if (busy) return;
    setPassword("");
    setError("");
    setSuccess("");
    setMode(next);
  };

  if (mode === "register")
    return <RegisterForm onBack={() => switchMode("login")} />;
  if (mode === "recovery")
    return (
      <PasswordRecovery
        onBack={() => switchMode("login")}
        onComplete={(message) => {
          setPassword("");
          setSuccess(message);
          setMode("login");
        }}
      />
    );
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Measure the hinge-safe region after reserving space for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <HingeSafe>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 460,
                alignSelf: "center",
                gap: 24,
              }}
            >
              <View style={{ gap: 8 }}>
                <Text
                  style={{
                    fontFamily: "BeVietnamPro_700Bold",
                    fontSize: 18,
                    color: colors.green,
                  }}
                >
                  ◉ nhắc tôi
                </Text>
                <Heading>Việc hôm nay,{"\n"}nhẹ đầu hơn.</Heading>
                <Text style={s.muted}>
                  Công việc, đồng đội và những điều cần nhớ.
                </Text>
              </View>
              <Card>
                <Text style={s.cardTitle}>Chào bạn trở lại</Text>
                {success ? <Text style={{ color: colors.green }}>{success}</Text> : null}
                <ErrorNotice message={error || sessionError} />
                <Field
                  label="Email"
                  testID="login-email"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                />
                <Field
                  label="Mật khẩu"
                  testID="login-password"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  onSubmitEditing={() => void submit()}
                />
                <Button
                  testID="login-submit"
                  label={busy ? "Đang đăng nhập…" : "Đăng nhập"}
                  disabled={busy || !email.trim() || !password}
                  onPress={() => void submit()}
                />
                <View style={{ gap: 8 }}>
                  <Button
                    testID="login-forgot"
                    label="Quên mật khẩu?"
                    secondary
                    disabled={busy}
                    onPress={() => switchMode("recovery")}
                  />
                  <Button
                    testID="login-register"
                    label="Tạo tài khoản mới"
                    secondary
                    disabled={busy}
                    onPress={() => switchMode("register")}
                  />
                </View>
                <Text style={[s.muted, { fontSize: 13 }]}>
                  Dùng tài khoản doanh nghiệp Nhắc tôi đã có.
                </Text>
              </Card>
              <Text style={[s.muted, { textAlign: "center", fontSize: 12 }]}>
                Nhắc đúng lúc · Làm cùng nhau
              </Text>
            </View>
          </ScrollView>
        </HingeSafe>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
