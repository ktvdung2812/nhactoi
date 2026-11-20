import React from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useAppearanceSettings } from "../core/appearance";
import { useTheme, type MobileAppearance } from "../ui/theme";
import { Button, ErrorNotice, FormPage, Heading, Text } from "../ui/kit";

const SWATCHES = [["#245bc0", "Xanh dương"], ["#176b59", "Xanh lá"], ["#7747b8", "Tím"], ["#b54d2a", "Cam đất"], ["#a63266", "Hồng đậm"], ["#475569", "Xám"]] as const;
const choices = [
  ["mode", "Chế độ", [["system", "Theo hệ thống"], ["light", "Sáng"], ["dark", "Tối"]]],
  ["background", "Nền", [["default", "Mặc định"], ["warm", "Ấm"], ["cool", "Lạnh"]]],
  ["font", "Phông chữ", [["vietnam", "Be Vietnam Pro"], ["system", "Phông hệ thống"]]],
  ["fontSize", "Cỡ chữ", [["small", "Nhỏ"], ["medium", "Vừa"], ["large", "Lớn"], ["xlarge", "Rất lớn"]]],
  ["density", "Mật độ", [["comfortable", "Thoáng"], ["compact", "Gọn"]]],
  ["corners", "Góc", [["square", "Gần vuông"], ["rounded", "Bo tròn"]]],
] as const;

export function AppearanceSettings() {
  const appearance = useAppearanceSettings();
  const { colors, radius, preferences } = useTheme();
  const disabled = appearance.loading;
  const accent = typeof preferences.accent === "string" ? preferences.accent.toLowerCase() : "";
  const option = (label: string, selected: boolean, onPress: () => void, name?: string, optionDisabled = disabled) => (
    <Pressable key={name || label} accessibilityRole="radio" accessibilityLabel={name || label}
      accessibilityState={{ checked: selected, disabled: optionDisabled }} disabled={optionDisabled} onPress={onPress}
      style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10,
        borderWidth: selected ? 2 : 1, borderColor: selected ? colors.accent : colors.line,
        borderRadius: radius.control, backgroundColor: selected ? colors.pale : colors.surface }}>
      <Text style={{ color: colors.ink }}>{label}</Text>
    </Pressable>
  );
  const change = (field: keyof MobileAppearance, value: string) => void appearance.save({ [field]: value });
  const confirmCopy = (source: "all" | "web") => Alert.alert("Sao chép giao diện?", "Giao diện điện thoại hiện tại sẽ bị ghi đè.", [
    { text: "Hủy", style: "cancel" },
    { text: "Sao chép", onPress: () => void appearance.copyFrom(source) },
  ]);
  return <FormPage title="Giao diện" onBack={() => router.back()}>
    <ErrorNotice message={appearance.error} />
    {appearance.error ? <Button label="Thử tải lại" secondary onPress={() => void appearance.refresh()} /> : null}
    <Heading>Phạm vi áp dụng</Heading>
    {appearance.syncUnavailable ? <Text style={{ color: colors.muted }}>Máy chủ chưa hỗ trợ đồng bộ giao diện.</Text> : <>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {option("Đồng bộ với web", !appearance.separate, () => { if (appearance.separate) void appearance.setSeparate(false); }, undefined, disabled || !appearance.scopeKnown)}
        {option("Chỉ cho điện thoại", appearance.separate, () => { if (!appearance.separate) void appearance.setSeparate(true); }, undefined, disabled || !appearance.scopeKnown)}
      </View>
      <Text style={{ color: colors.muted }}>{!appearance.scopeKnown ? "Đang tải trạng thái đồng bộ…" : appearance.webSeparate ? "Web đang dùng giao diện riêng. Chế độ đồng bộ dùng giao diện chung." : "Web: đang đồng bộ"}</Text>
    </>}
    {appearance.scopeKnown && appearance.separate && <View style={{ gap: 8 }}>
      <Button label="Sao chép từ giao diện chung" secondary disabled={disabled} onPress={() => confirmCopy("all")} />
      {appearance.webSeparate && <Button label="Sao chép từ web" secondary disabled={disabled} onPress={() => confirmCopy("web")} />}
    </View>}
    {choices.map(([field, title, options]) => <View key={field} style={{ gap: 8 }}>
      <Heading>{title}</Heading>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map(([value, label]) => option(label, preferences[field] === value, () => change(field, value), `${title}: ${label}`))}
      </View>
      {field === "mode" && <View style={{ gap: 8 }}>
        <Heading>Màu nhấn</Heading>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SWATCHES.map(([color, name]) => <Pressable key={color} accessibilityRole="radio" accessibilityLabel={`Màu ${name}`}
            accessibilityState={{ checked: accent === color, disabled }} disabled={disabled}
            onPress={() => change("accent", color)} style={{ width: 48, height: 48, padding: 5, borderWidth: 2,
              borderColor: accent === color ? colors.ink : colors.line, borderRadius: radius.control }}>
            <View style={{ flex: 1, backgroundColor: color, borderRadius: radius.control }} />
          </Pressable>)}
        </View>
        {accent && !SWATCHES.some(([color]) => color === accent) ? <Text style={{ color: colors.muted }}>Màu hiện tại: {accent}</Text> : null}
      </View>}
    </View>)}
    <Heading>Trợ năng — luôn áp dụng trên mọi thiết bị</Heading>
    {([
      ["contrast", "Tương phản cao", "high", "standard"],
      ["motion", "Giảm chuyển động", "reduced", "system"],
    ] as const).map(([field, label, on, off]) => <Pressable key={field} accessibilityRole="switch" accessibilityLabel={label}
      accessibilityState={{ checked: preferences[field] === on, disabled }} disabled={disabled}
      onPress={() => change(field, preferences[field] === on ? off : on)}
      style={{ minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.ink }}>{label}: {preferences[field] === on ? "Bật" : "Tắt"}</Text>
    </Pressable>)}
    <Button label="Khôi phục mặc định" secondary disabled={disabled} onPress={() => Alert.alert("Khôi phục mặc định?", appearance.separate ? "Giao diện riêng của điện thoại sẽ được đặt lại." : "Giao diện chung sẽ được đặt lại; cài đặt trợ năng cũng sẽ trở về mặc định trên mọi thiết bị.", [{ text: "Hủy", style: "cancel" }, { text: "Khôi phục", onPress: () => void appearance.reset() }])} />
  </FormPage>;
}
