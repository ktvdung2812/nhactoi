import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  type TextProps,
  type TextInputProps,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { HingeSafe } from "./frames";
import { dateLabel } from "../core/policy";
export const colors = {
  ink: "#233d36",
  muted: "#6b7c73",
  green: "#176b59",
  pale: "#e8f3eb",
  bg: "#f4f6f2",
  line: "#dbe5dc",
  red: "#aa3535",
  orange: "#b76821",
  white: "#fff",
};
export function Text({ style, ...props }: TextProps) {
  return (
    <NativeText
      {...props}
      style={[
        {
          fontFamily: "BeVietnamPro_400Regular",
          fontSize: 15,
          color: colors.ink,
          lineHeight: 23,
        },
        style,
      ]}
    />
  );
}
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.heading}>
      {children}
    </Text>
  );
}
export function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
  danger = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        danger && { backgroundColor: "#fcebec" },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[
          s.buttonText,
          secondary && { color: colors.green },
          danger && { color: colors.red },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 110, textAlignVertical: "top" },
          style,
        ]}
      />
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
export function Row({ children }: { children: React.ReactNode }) {
  return <View style={s.row}>{children}</View>;
}
export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  ) : null;
}
export function Loading() {
  return (
    <View style={s.empty}>
      <ActivityIndicator color={colors.green} />
      <Text>Đang tải…</Text>
    </View>
  );
}
export function Empty({ title, message }: { title: string; message?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.cardTitle}>{title}</Text>
      {message && <Text style={s.muted}>{message}</Text>}
    </View>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((o) => o.value === value)?.label || "Chọn"}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[s.input, disabled && { opacity: 0.5 }]}
      >
        <Text>{options.find((o) => o.value === value)?.label || "Chọn"} ▾</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={[s.overlay, { padding: 0 }]}>
          <HingeSafe>
            <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
              <View style={s.dialog}>
                <Heading>{label}</Heading>
                <ScrollView>
                  {options.map((o) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: o.value === value }}
                      key={o.value}
                      style={[
                        s.option,
                        o.value === value && { backgroundColor: colors.pale },
                      ]}
                      onPress={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                    >
                      <Text>
                        {o.value === value ? "✓  " : ""}
                        {o.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Button label="Đóng" secondary onPress={() => setOpen(false)} />
              </View>
            </View>
          </HingeSafe>
        </View>
      </Modal>
    </View>
  );
}
export function DateField({
  label,
  value,
  onChange,
  optional = false,
  disabled = false,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  optional?: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null),
    [pending, setPending] = useState(new Date());
  const start = () => {
    setPending(value ? new Date(value) : new Date());
    setMode("date");
  };
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={start}
        style={s.input}
      >
        <Text>{dateLabel(value)}</Text>
      </Pressable>
      {optional && value && (
        <Button
          label="Bỏ thời gian"
          secondary
          disabled={disabled}
          onPress={() => onChange(null)}
        />
      )}
      {mode && (
        <DateTimePicker
          value={pending}
          mode={mode}
          is24Hour
          onChange={(event, date) => {
            if (event.type === "dismissed" || !date) {
              setMode(null);
              return;
            }
            if (mode === "date") {
              setPending(date);
              setMode("time");
            } else {
              onChange(date.toISOString());
              setMode(null);
            }
          }}
        />
      )}
    </View>
  );
}
export function FormPage({
  title,
  children,
  onBack,
}: {
  title: string;
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <HingeSafe>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              s.content,
              { width: "100%", maxWidth: 760, alignSelf: "center" },
            ]}
          >
            <Button label="‹ Quay lại" secondary onPress={onBack} />
            <Heading>{title}</Heading>
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </HingeSafe>
    </SafeAreaView>
  );
}
export const s = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  heading: {
    fontFamily: "BeVietnamPro_700Bold",
    fontSize: 26,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  cardTitle: {
    fontFamily: "BeVietnamPro_600SemiBold",
    fontSize: 17,
    lineHeight: 25,
  },
  muted: { color: colors.muted },
  label: {
    fontFamily: "BeVietnamPro_600SemiBold",
    fontSize: 13,
    lineHeight: 20,
  },
  field: { gap: 7 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 13,
    minHeight: 50,
    fontFamily: "BeVietnamPro_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  secondary: { backgroundColor: colors.pale },
  buttonText: {
    color: colors.white,
    fontFamily: "BeVietnamPro_600SemiBold",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  error: {
    color: colors.red,
    backgroundColor: "#fcebec",
    padding: 12,
    borderRadius: 10,
  },
  empty: { padding: 28, alignItems: "center", gap: 12 },
  overlay: {
    flex: 1,
    backgroundColor: "#142d2677",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 20,
    gap: 16,
    maxHeight: "80%",
    maxWidth: 500,
    width: "100%",
    alignSelf: "center",
  },
  option: { padding: 15, minHeight: 50, borderRadius: 10 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.pale,
    color: colors.green,
    fontSize: 12,
  },
  divider: { height: 1, backgroundColor: colors.line },
  link: { color: colors.green, fontFamily: "BeVietnamPro_600SemiBold" },
});
