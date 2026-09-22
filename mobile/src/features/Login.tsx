import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HingeSafe } from "../ui/frames";
import { useSession } from "../core/session";
import { errorMessage } from "../core/api";
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
    [busy, setBusy] = useState(false);
  async function submit() {
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
      <HingeSafe>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
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
                <ErrorNotice message={error || sessionError} />
                <Field
                  label="Email"
                  testID="login-email"
                  value={email}
                  onChangeText={setEmail}
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
                <Text style={[s.muted, { fontSize: 13 }]}>
                  Dùng tài khoản doanh nghiệp Nhắc tôi đã có.
                </Text>
              </Card>
              <Text style={[s.muted, { textAlign: "center", fontSize: 12 }]}>
                Nhắc đúng lúc · Làm cùng nhau
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </HingeSafe>
    </SafeAreaView>
  );
}
