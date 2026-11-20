import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type TextProps,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { HingeSafe } from "./frames";
import { getFontScaleEpoch, subscribeFontScaleEpoch } from "./font-scale";
import { useTheme, type Theme } from "./theme";
import { dateLabel } from "../core/policy";

/**
 * Shared form scroll props. `keyboardDismissMode` is read at spread time so the value follows the
 * platform the component actually renders on instead of the one the module first loaded under.
 */
/** Breathing room kept between a focused field and the keyboard edge. */
const KEYBOARD_REVEAL_MARGIN = 16;
/** A revealed field never rides higher than this below the top of the window. */
const KEYBOARD_REVEAL_TOP = 64;

/**
 * How far a form must scroll so a field of `height` at window-`y` ends `margin` above the
 * keyboard, without pushing its top above `topLimit`. Zero when the field is already clear.
 */
export function keyboardRevealDelta(
  y: number,
  height: number,
  keyboardTop: number,
  margin = KEYBOARD_REVEAL_MARGIN,
  topLimit = KEYBOARD_REVEAL_TOP,
) {
  const hidden = y + height + margin - keyboardTop;
  if (!(hidden > 0)) return 0;
  return Math.max(0, Math.min(hidden, y - topLimit));
}

type RevealField = (field: View | null) => void;
export const KeyboardRevealContext = createContext<RevealField | null>(null);

/**
 * iOS `automaticallyAdjustKeyboardInsets` only reacts to the keyboard appearing, so a multiline
 * field that grows while typing ends up under it and a field that just fits sits flush against
 * it. This gives a form scroll view the same reveal as an explicit step.
 */
export function useKeyboardReveal() {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const reveal = useCallback<RevealField>((field) => {
    if (Platform.OS !== "ios" || !field) return;
    const keyboard = Keyboard.metrics();
    if (!keyboard) return;
    field.measureInWindow((_x, y, _width, height) => {
      const delta = keyboardRevealDelta(y, height, keyboard.screenY);
      if (delta > 0)
        scroll.current?.scrollTo({ y: offset.current + delta, animated: true });
    });
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  return { scroll, reveal, onScroll };
}

export const keyboardAwareScrollProps = {
  keyboardShouldPersistTaps: "handled",
  automaticallyAdjustKeyboardInsets: true,
  get keyboardDismissMode(): "interactive" | undefined {
    return Platform.OS === "ios" ? "interactive" : undefined;
  },
} satisfies Pick<
  ScrollViewProps,
  | "keyboardShouldPersistTaps"
  | "automaticallyAdjustKeyboardInsets"
  | "keyboardDismissMode"
>;

/** A readable column that widens with Dynamic Type, like UIKit's readable content guide. */
export const readableWidth = (fontScale: number, base = 760) =>
  Math.round(base * Math.min(Math.max(fontScale || 1, 1), 1.75));

export function Text({ style, ...props }: TextProps) {
  const { colors, fontScale, fontFamily } = useTheme();
  const textStyle = StyleSheet.flatten(style) || {};
  // A live system font-size change leaves mounted text measured at the old size; remounting
  // this stateless host node (see ./font-scale) makes Fabric measure it again.
  const fontScaleEpoch = useSyncExternalStore(
    subscribeFontScaleEpoch,
    getFontScaleEpoch,
    getFontScaleEpoch,
  );
  return (
    <NativeText
      key={fontScaleEpoch}
      {...props}
      style={[
        {
          fontFamily: "BeVietnamPro_400Regular",
          fontSize: 15,
          color: colors.ink,
          lineHeight: 23,
        },
        style,
        { fontSize: (textStyle.fontSize ?? 15) * fontScale,
          lineHeight: (textStyle.lineHeight ?? 23) * fontScale,
          ...(fontFamily === "system" ? { fontFamily: undefined, fontWeight: textStyle.fontFamily?.includes("700") ? "700" : textStyle.fontFamily?.includes("600") ? "600" : textStyle.fontWeight } : {}) },
      ]}
    />
  );
}
export function Heading({ children }: { children: React.ReactNode }) {
  const s = useKitStyles();
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
  const s = useKitStyles();
  const { colors } = useTheme();
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
        danger && { backgroundColor: colors.redPale },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[
          s.buttonText,
          secondary && { color: colors.accent },
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
  ref,
  onFocus,
  onBlur,
  onContentSizeChange,
  ...props
}: TextInputProps & { label: string; ref?: React.Ref<TextInput> }) {
  const s = useKitStyles();
  const { colors, scheme } = useTheme();
  const reveal = useContext(KeyboardRevealContext);
  const box = useRef<View>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revealSoon = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reveal?.(box.current), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <View ref={box} style={s.field}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={s.label}
      >
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        keyboardAppearance={scheme}
        {...props}
        onFocus={(event) => {
          focused.current = true;
          // Wait for the keyboard animation so its final frame is what gets measured.
          revealSoon(450);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          focused.current = false;
          clearTimeout(timer.current);
          onBlur?.(event);
        }}
        onContentSizeChange={(event) => {
          // A growing multiline field has to keep its newest line above the keyboard.
          if (focused.current) revealSoon(60);
          onContentSizeChange?.(event);
        }}
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
  const s = useKitStyles();
  return <View style={s.card}>{children}</View>;
}
export function Row({ children }: { children: React.ReactNode }) {
  const s = useKitStyles();
  return <View style={s.row}>{children}</View>;
}
export function ErrorNotice({ message }: { message?: string }) {
  const s = useKitStyles();
  // iOS does not announce a dynamically inserted `alert` element, so speak it explicitly.
  useEffect(() => {
    if (message && Platform.OS === "ios")
      AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return message ? (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  ) : null;
}
export function Loading() {
  const s = useKitStyles();
  const { colors } = useTheme();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text>Đang tải…</Text>
    </View>
  );
}
export function Empty({ title, message }: { title: string; message?: string }) {
  const s = useKitStyles();
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
  const s = useKitStyles();
  const { colors, reduceMotion } = useTheme();
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
        animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={() => setOpen(false)}
      >
        <View style={[s.overlay, { padding: 0 }]}>
          <HingeSafe testID="select-hinge-safe">
            <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
              <View style={s.dialog}>
                <Heading>{label}</Heading>
                <ScrollView>
                  {options.map((o) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: o.value === value }}
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
  const s = useKitStyles();
  const { reduceMotion, scheme } = useTheme();
  const [mode, setMode] = useState<"date" | "time" | null>(null),
    [iosOpen, setIosOpen] = useState(false),
    [pending, setPending] = useState(new Date());
  const shown = dateLabel(value);
  const start = () => {
    setPending(value ? new Date(value) : new Date());
    if (Platform.OS === "ios") setIosOpen(true);
    else setMode("date");
  };
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        disabled={disabled}
        onPress={start}
        style={s.input}
      >
        <Text>{shown}</Text>
      </Pressable>
      {optional && value && (
        <Button
          label="Bỏ thời gian"
          secondary
          disabled={disabled}
          onPress={() => onChange(null)}
        />
      )}
      {Platform.OS === "ios" ? (
        // iOS renders the picker inline. Every wheel tick fires a change, so keep the value
        // local until "Xong" and never commit from the picker's own callback.
        <Modal
          visible={iosOpen}
          transparent
          animationType={reduceMotion ? "none" : "fade"}
          onRequestClose={() => setIosOpen(false)}
        >
          <View style={[s.overlay, { padding: 0 }]}>
            <HingeSafe testID="date-hinge-safe">
              <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
                <View style={s.dialog}>
                  <Heading>{label}</Heading>
                  <DateTimePicker
                    value={pending}
                    mode="datetime"
                    display="inline"
                    themeVariant={scheme}
                    onValueChange={(_event, date) => setPending(date)}
                  />
                  <Row>
                    <Button
                      label="Hủy"
                      secondary
                      onPress={() => setIosOpen(false)}
                    />
                    <Button
                      label="Xong"
                      onPress={() => {
                        onChange(pending.toISOString());
                        setIosOpen(false);
                      }}
                    />
                  </Row>
                </View>
              </View>
            </HingeSafe>
          </View>
        </Modal>
      ) : mode ? (
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
      ) : null}
    </View>
  );
}
/** Distance from the wrapper's left edge that may start the back gesture. */
const EDGE_SWIPE_START = 24;
/** Horizontal travel that proves the touch is a swipe rather than a scroll. */
const EDGE_SWIPE_CLAIM = 12;
/** A swipe must be this much more horizontal than vertical. */
const EDGE_SWIPE_RATIO = 1.5;
/** Release travel or velocity that closes the detail. */
const EDGE_SWIPE_DISTANCE = 80;
const EDGE_SWIPE_VELOCITY = 0.5;

/** A touch may only become a back swipe when it began inside the edge band. */
export function isEdgeStart(pageX: number, originX: number) {
  return (
    typeof pageX === "number" &&
    pageX >= originX &&
    pageX - originX <= EDGE_SWIPE_START
  );
}

/** Release travel or velocity that should close the detail. */
export function shouldCompleteSwipe(dx: number, vx: number) {
  return dx > EDGE_SWIPE_DISTANCE || vx > EDGE_SWIPE_VELOCITY;
}

/**
 * iOS-style left-edge swipe-back for a detail that replaces a list without a route push.
 * Children keep their own touches: the gesture is claimed only after a touch that began at
 * the left edge turns into a predominantly horizontal drag.
 */
export function EdgeSwipeBack({
  enabled,
  onBack,
  children,
  testID,
}: {
  enabled: boolean;
  onBack: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  // `locationX` is relative to the deepest touched child in RN 0.86, so compare page space
  // against the wrapper's own page origin instead.
  const origin = useRef(0);
  // The origin is measured asynchronously; until a fresh reading lands after a re-render, a
  // touch is not treated as an edge start rather than judged against a stale pane position.
  const measured = useRef(false);
  const host = useRef<View>(null);
  const edgeStart = useRef(false);
  const [drag] = useState(() => new Animated.Value(0));
  const live = useRef({ enabled, onBack });
  useLayoutEffect(() => {
    live.current = { enabled, onBack };
  }, [enabled, onBack]);
  // onLayout only fires when this wrapper's own frame changes. A pane that moves (a rail
  // appearing, a fold posture change) re-renders its children, so re-read the origin after
  // every render as well.
  useEffect(() => {
    // Nothing to measure while the swipe is off (Android, dual) or the pane is hidden.
    if (!enabled) return;
    measured.current = false;
    host.current?.measureInWindow?.((x, _y, width) => {
      if (!(width > 0)) return;
      origin.current = x;
      measured.current = true;
    });
  });
  // The handlers read these refs only while a gesture is in progress, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        const { pageX } = event.nativeEvent;
        edgeStart.current =
          live.current.enabled &&
          measured.current &&
          isEdgeStart(pageX, origin.current);
        // A press belongs to the child under it; only a drag can become a swipe.
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_event, gesture) => {
        if (!live.current.enabled || !edgeStart.current) return false;
        const horizontal = Math.abs(gesture.dx);
        return (
          horizontal > EDGE_SWIPE_CLAIM &&
          horizontal > Math.abs(gesture.dy) * EDGE_SWIPE_RATIO
        );
      },
      onPanResponderGrant: () => drag.setValue(0),
      onPanResponderMove: (_event, gesture) =>
        drag.setValue(Math.max(0, gesture.dx)),
      onPanResponderRelease: (_event, gesture) => {
        edgeStart.current = false;
        drag.setValue(0);
        if (
          live.current.enabled &&
          shouldCompleteSwipe(gesture.dx, gesture.vx)
        )
          live.current.onBack();
      },
      onPanResponderTerminate: () => {
        edgeStart.current = false;
        drag.setValue(0);
      },
    }),
  );
  return (
    <Animated.View
      ref={host}
      testID={testID}
      {...pan.panHandlers}
      accessibilityHint={
        enabled ? "Vuốt từ mép trái để quay lại" : undefined
      }
      accessibilityState={{ disabled: !enabled }}
      onLayout={() => {
        host.current?.measureInWindow?.((x, _y, width) => {
          if (!(width > 0)) return;
          origin.current = x;
          measured.current = true;
        });
      }}
      style={{ flex: 1, transform: [{ translateX: drag }] }}
    >
      {children}
    </Animated.View>
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
  const s = useKitStyles();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const { fontScale: preferenceScale } = useTheme();
  const { scroll, reveal, onScroll } = useKeyboardReveal();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Measure the hinge-safe region after reserving space for the keyboard. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        enabled={Platform.OS !== "ios"}
      >
        <HingeSafe testID="form-hinge-safe">
          <ScrollView
            ref={scroll}
            testID="form-scroll"
            onScroll={onScroll}
            scrollEventThrottle={16}
            {...keyboardAwareScrollProps}
            contentContainerStyle={[
              s.content,
              {
                width: "100%",
                maxWidth: readableWidth(fontScale * preferenceScale),
                alignSelf: "center",
              },
            ]}
          >
            <View testID="form-back" style={{ alignSelf: "flex-start" }}>
              <Button label="‹ Quay lại" secondary onPress={onBack} />
            </View>
            <Heading>{title}</Heading>
            <KeyboardRevealContext.Provider value={reveal}>
              {children}
            </KeyboardRevealContext.Provider>
          </ScrollView>
        </HingeSafe>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function createKitStyles(theme: Theme) {
  const { colors, radius, space } = theme;
  return StyleSheet.create({
  content: { padding: 20 * space, gap: 16 * space, paddingBottom: 40 * space },
  heading: {
    fontFamily: "BeVietnamPro_700Bold",
    fontSize: 26,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 18 * space,
    gap: 12 * space,
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
  field: { gap: 7 * space },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.control,
    padding: 13 * space,
    minHeight: 50,
    fontFamily: theme.fontFamily === "vietnam" ? "BeVietnamPro_400Regular" : undefined,
    fontSize: 16 * theme.fontScale,
    lineHeight: 24 * theme.fontScale,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingHorizontal: 16 * space,
    paddingVertical: 12 * space,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  secondary: { backgroundColor: colors.pale },
  buttonText: {
    color: colors.onAccent,
    fontFamily: "BeVietnamPro_600SemiBold",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10 * space,
  },
  error: {
    color: colors.red,
    backgroundColor: colors.redPale,
    padding: 12 * space,
    borderRadius: radius.control,
  },
  empty: { padding: 28 * space, alignItems: "center", gap: 12 * space },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 28 * space,
    gap: 12 * space,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: 24 * space,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: 20 * space,
    gap: 16 * space,
    maxHeight: "80%",
    maxWidth: 500,
    width: "100%",
    alignSelf: "center",
  },
  option: { padding: 15 * space, minHeight: 50, borderRadius: radius.control },
  pill: {
    paddingHorizontal: 10 * space,
    paddingVertical: 4 * space,
    borderRadius: radius.control,
    backgroundColor: colors.pale,
    color: colors.accent,
    fontSize: 12,
  },
  divider: { height: 1, backgroundColor: colors.line },
  link: { color: colors.accent, fontFamily: "BeVietnamPro_600SemiBold" },
  });
}
const kitStyles = new WeakMap<Theme, ReturnType<typeof createKitStyles>>();
export function useKitStyles() {
  const theme = useTheme();
  let styles = kitStyles.get(theme);
  if (!styles) { styles = createKitStyles(theme); kitStyles.set(theme, styles); }
  return styles;
}
