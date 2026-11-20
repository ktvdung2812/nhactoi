import { useTheme } from "../ui/theme";
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { hingeSafeRegion, position, useMeasuredWindow } from "../ui/frames";
import { useSession } from "../core/session";
import { errorMessage } from "../core/api";
import {
  FocusableField,
  keyboardAwareScrollProps,
  PasswordRecovery,
  readableWidth,
  RegisterForm,
} from "./AuthForms";
import { useKitStyles,
  Text,
  Card,
  Button,
  ErrorNotice,
  KeyboardRevealContext,
  useKeyboardReveal,
} from "../ui/kit";

/** Decorative hero text stops growing here so the sign-in form stays reachable at AX sizes. */
const HERO_MAX_FONT_SCALE = 1.4;
export function Login() {
  const s = useKitStyles();
  const { colors } = useTheme();
  const { login, error: sessionError } = useSession();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [mode, setMode] = useState<"login" | "register" | "recovery">("login"),
    [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const { attach, onLayout, ...window } = useMeasuredWindow();
  const { fontScale, foldingFeatures, width, height } = window;
  const fold = window.layout?.posture === "tabletop"
    ? foldingFeatures.find((feature) => feature.orientation === "HORIZONTAL" && feature.isSeparating)
    : undefined;
  const {
    scroll: outerScroll,
    reveal: revealInOuter,
    onScroll: onOuterScroll,
  } = useKeyboardReveal();
  const {
    scroll: controlsScroll,
    reveal: revealInControls,
    onScroll: onControlsScroll,
  } = useKeyboardReveal();
  const margin = 8;
  const topHeight = fold ? Math.max(0, Math.min(height, fold.bounds.top - margin)) : 0;
  const bottomY = fold ? Math.max(0, Math.min(height, fold.bounds.bottom + margin)) : 0;
  const region = fold ? { x: 0, y: 0, width, height } : hingeSafeRegion(width, height, foldingFeatures);
  const columnStyle = { width: "100%" as const, maxWidth: readableWidth(fontScale, 460), alignSelf: "center" as const, gap: 24 };
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
      {/* Android: measure the hinge-safe region after reserving space for the keyboard.
          iOS: padding never scrolls the focused field into view (it stayed under the keyboard on
          the iPhone Duo cover display), so the native scroll view insets itself instead. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        enabled={Platform.OS !== "ios"}
      >
        <View ref={attach} onLayout={onLayout} style={{ flex: 1 }}>
          <View testID="login-hinge-safe" style={position(region)}>
          <ScrollView
            testID="login-scroll"
            ref={outerScroll}
            onScroll={onOuterScroll}
            scrollEventThrottle={16}
            {...keyboardAwareScrollProps}
            scrollEnabled={!fold}
            contentContainerStyle={{ flexGrow: 1, justifyContent: fold ? "flex-start" : "center" }}
          >
            <ScrollView
              testID="login-hero-scroll"
              scrollEnabled={!!fold}
              style={fold ? { height: topHeight, flexGrow: 0 } : { flexGrow: 0 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: fold ? 24 : 12 }}
            >
            <View testID="login-column" style={columnStyle}>
              <View style={{ gap: 8 }}>
                <Text
                  accessibilityLabel="Nhắc tôi"
                  maxFontSizeMultiplier={HERO_MAX_FONT_SCALE}
                  style={{
                    fontFamily: "BeVietnamPro_700Bold",
                    fontSize: 18,
                    color: colors.accent,
                  }}
                >
                  ◉ nhắc tôi
                </Text>
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={HERO_MAX_FONT_SCALE}
                  style={s.heading}
                >
                  Việc hôm nay,{"\n"}nhẹ đầu hơn.
                </Text>
                <Text
                  maxFontSizeMultiplier={HERO_MAX_FONT_SCALE}
                  style={s.muted}
                >
                  Công việc, đồng đội và những điều cần nhớ.
                </Text>
              </View>
            </View>
            </ScrollView>
            <ScrollView
              testID="login-controls-scroll"
              ref={controlsScroll}
              onScroll={onControlsScroll}
              scrollEventThrottle={16}
              {...keyboardAwareScrollProps}
              scrollEnabled={!!fold}
              style={fold ? { height: height - bottomY, marginTop: bottomY - topHeight, flexGrow: 0 } : { flexGrow: 0 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: fold ? 24 : 12 }}
            >
            <View style={columnStyle}>
              {/* Keep the focused field clear of the iOS keyboard instead of flush against it;
                  in tabletop posture only the lower pane scrolls. */}
              <KeyboardRevealContext.Provider
                value={fold ? revealInControls : revealInOuter}
              >
              <Card>
                <Text style={s.cardTitle}>Chào bạn trở lại</Text>
                {success ? <Text style={{ color: colors.accent }}>{success}</Text> : null}
                <ErrorNotice message={error || sessionError} />
                <FocusableField
                  label="Email"
                  testID="login-email"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  // Apple: an email used as the account name is `.username` so Password AutoFill
                  // offers the saved login instead of contact email suggestions.
                  textContentType="username"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <FocusableField
                  ref={passwordRef}
                  label="Mật khẩu"
                  testID="login-password"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
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
              </KeyboardRevealContext.Provider>
              <Text
                maxFontSizeMultiplier={HERO_MAX_FONT_SCALE}
                style={[s.muted, { textAlign: "center", fontSize: 12 }]}
              >
                Nhắc đúng lúc · Làm cùng nhau
              </Text>
            </View>
            </ScrollView>
          </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
