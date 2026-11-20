import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react-native";
// The CommonJS module itself: a namespace import is an interop copy that spyOn cannot patch.
const ReactNative = jest.requireActual<typeof import("react-native")>("react-native");
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  TextInput,
} from "react-native";
import {
  DateField,
  ErrorNotice,
  Field,
  FormPage,
  Loading,
  Select,
  Text,
  keyboardRevealDelta,
  readableWidth,
} from "../src/ui/kit";
import { dateLabel } from "../src/core/policy";

jest.mock("react-native-safe-area-context", () =>
  jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
// The real adaptive window imports the optional native folding module, which has no test host.
jest.mock("../src/ui/adaptive", () => ({
  useAdaptiveWindow: () => ({
    width: 1000,
    height: 800,
    foldingFeatures: [],
  }),
}));
jest.mock("@react-native-community/datetimepicker", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      createElement(View, { testID: "datetime-picker", ...props }),
  };
});

const setPlatform = (os: "ios" | "android") => {
  (Platform as unknown as { OS: string }).OS = os;
};

const dimensions = jest.spyOn(ReactNative, "useWindowDimensions");
const setFontScale = (fontScale: number) =>
  dimensions.mockReturnValue({
    width: 1032,
    height: 1376,
    scale: 2,
    fontScale,
  });

const form = (onBack = jest.fn()) => (
  <FormPage title="Tạo công việc" onBack={onBack}>
    <Text>Nội dung</Text>
  </FormPage>
);

beforeEach(() => {
  setPlatform("ios");
  setFontScale(1);
});
afterEach(cleanup);

test("on iOS the form scrolls fields above the keyboard instead of padding them", async () => {
  await render(form());
  expect(screen.getByTestId("form-scroll").props).toMatchObject({
    keyboardShouldPersistTaps: "handled",
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: "interactive",
  });
});

test("on Android the form keeps KeyboardAvoidingView and its own dismissal behavior", async () => {
  setPlatform("android");
  await render(form());
  expect(screen.getByTestId("form-scroll").props).toMatchObject({
    keyboardShouldPersistTaps: "handled",
    automaticallyAdjustKeyboardInsets: true,
  });
  expect(
    screen.getByTestId("form-scroll").props.keyboardDismissMode,
  ).toBeUndefined();
});

test("the form column keeps a readable width that scales with Dynamic Type", async () => {
  const view = await render(form());
  const column = () =>
    StyleSheet.flatten(
      screen.getByTestId("form-scroll").props.contentContainerStyle,
    );

  expect(column()).toMatchObject({ width: "100%", maxWidth: 760, alignSelf: "center" });

  setFontScale(1.5);
  await view.rerender(form());
  expect(column().maxWidth).toBe(1140);

  setFontScale(3.1); // AX5
  await view.rerender(form());
  expect(column().maxWidth).toBe(1330);

  setFontScale(0.8);
  await view.rerender(form());
  expect(column().maxWidth).toBe(760);
});

test("readableWidth accepts its own base width", () => {
  expect(readableWidth(1)).toBe(760);
  expect(readableWidth(3, 460)).toBe(805);
});

test("the FormPage back button shrinks to its label on wide screens", async () => {
  await render(form());
  expect(
    StyleSheet.flatten(screen.getByTestId("form-back").props.style),
  ).toMatchObject({ alignSelf: "flex-start" });
});

test("the iOS picker only commits from Xong, not from scrolling", async () => {
  const onChange = jest.fn();
  await render(<DateField label="Hạn" value={null} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText("Hạn: Chưa đặt"));
  expect(screen.getByTestId("datetime-picker").props).toMatchObject({
    mode: "datetime",
    display: "inline",
  });

  const first = new Date("2030-01-02T03:04:00.000Z");
  const second = new Date("2031-05-06T07:08:00.000Z");
  await act(async () =>
    screen
      .getByTestId("datetime-picker")
      .props.onValueChange(
        { nativeEvent: { timestamp: first.getTime(), utcOffset: 0 } },
        first,
      ),
  );
  await act(async () =>
    screen
      .getByTestId("datetime-picker")
      .props.onValueChange(
        { nativeEvent: { timestamp: second.getTime(), utcOffset: 0 } },
        second,
      ),
  );
  expect(onChange).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText("Xong"));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(second.toISOString());
  expect(screen.queryByTestId("datetime-picker")).toBeNull();
});

test("Hủy discards the pending iOS value", async () => {
  const onChange = jest.fn();
  await render(<DateField label="Hạn" value={null} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText("Hạn: Chưa đặt"));
  const picked = new Date("2032-02-03T04:05:00.000Z");
  await act(async () =>
    screen
      .getByTestId("datetime-picker")
      .props.onValueChange(
        { nativeEvent: { timestamp: picked.getTime(), utcOffset: 0 } },
        picked,
      ),
  );
  await fireEvent.press(screen.getByLabelText("Hủy"));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByTestId("datetime-picker")).toBeNull();
});

test("the Android date then time dialog still commits on the second set", async () => {
  setPlatform("android");
  const onChange = jest.fn();
  await render(<DateField label="Hạn" value={null} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText("Hạn: Chưa đặt"));
  expect(screen.getByTestId("datetime-picker").props.mode).toBe("date");

  const day = new Date("2030-01-02T03:04:00.000Z");
  await act(async () =>
    screen.getByTestId("datetime-picker").props.onChange({ type: "set" }, day),
  );
  expect(screen.getByTestId("datetime-picker").props.mode).toBe("time");

  const at = new Date("2030-01-02T10:11:00.000Z");
  await act(async () =>
    screen.getByTestId("datetime-picker").props.onChange({ type: "set" }, at),
  );
  expect(onChange).toHaveBeenCalledWith(at.toISOString());
  expect(screen.queryByTestId("datetime-picker")).toBeNull();
});

test("dismissing the Android dialog does not change the value", async () => {
  setPlatform("android");
  const onChange = jest.fn();
  await render(<DateField label="Hạn" value={null} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText("Hạn: Chưa đặt"));
  await act(async () =>
    screen
      .getByTestId("datetime-picker")
      .props.onChange({ type: "dismissed" }, undefined),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByTestId("datetime-picker")).toBeNull();
});

test("DateField is a button whose label reads the formatted date", async () => {
  const value = "2030-01-02T03:04:00.000Z";
  await render(<DateField label="Hạn" value={value} onChange={jest.fn()} />);
  expect(screen.getByLabelText(`Hạn: ${dateLabel(value)}`).props).toMatchObject(
    { accessibilityRole: "button" },
  );
});

test("the visible Field label is hidden from screen readers and the input names itself", async () => {
  await render(<Field label="Email" value="" onChangeText={jest.fn()} />);
  expect(
    screen.getByText("Email", { includeHiddenElements: true }).props,
  ).toMatchObject({
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants",
  });
  expect(screen.getByLabelText("Email").props.accessibilityLabel).toBe("Email");
});

test("Field forwards its ref to the TextInput for focus chains", async () => {
  const ref = React.createRef<TextInput>();
  const focus = TextInput.prototype.focus as jest.Mock;
  await render(
    <Field ref={ref} label="Email" value="" onChangeText={jest.fn()} />,
  );
  expect(ref.current).not.toBeNull();
  ref.current?.focus();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(focus.mock.contexts[0]).toBe(ref.current);
});

test("Select options expose their label and selected state without the check glyph", async () => {
  await render(
    <Select
      label="Trạng thái"
      value="doing"
      onChange={jest.fn()}
      options={[
        { value: "todo", label: "Cần làm" },
        { value: "doing", label: "Đang làm" },
      ]}
    />,
  );
  await fireEvent.press(screen.getByLabelText("Trạng thái: Đang làm"));
  expect(screen.getByLabelText("Đang làm").props.accessibilityState).toEqual({
    selected: true,
  });
  expect(screen.getByLabelText("Cần làm").props.accessibilityState).toEqual({
    selected: false,
  });
});

test("ErrorNotice announces a changed message on iOS", async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  const view = await render(<ErrorNotice message="Lỗi đầu tiên" />);
  expect(announce).toHaveBeenCalledWith("Lỗi đầu tiên");
  await view.rerender(<ErrorNotice message="Lỗi thứ hai" />);
  expect(announce).toHaveBeenLastCalledWith("Lỗi thứ hai");
  expect(announce).toHaveBeenCalledTimes(2);
  announce.mockRestore();
});

test("ErrorNotice does not announce on Android, where the alert role is spoken", async () => {
  setPlatform("android");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  await render(<ErrorNotice message="Lỗi" />);
  expect(announce).not.toHaveBeenCalled();
  announce.mockRestore();
});

test("Loading fills and centers the available space", async () => {
  await render(<Loading />);
  expect(
    StyleSheet.flatten(screen.getByText("Đang tải…").parent?.props.style),
  ).toMatchObject({
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  });
});

describe("keyboardRevealDelta", () => {
  it("leaves a field that already clears the keyboard alone", () => {
    expect(keyboardRevealDelta(200, 52, 374)).toBe(0);
  });

  it("opens a margin for a field sitting flush against the keyboard", () => {
    // Bottom edge at 375 against a keyboard top of 374, as measured on the Duo outer display.
    expect(keyboardRevealDelta(323, 52, 374)).toBe(17);
  });

  it("brings a grown multiline field fully above the keyboard", () => {
    expect(keyboardRevealDelta(322, 172, 374)).toBe(136);
  });

  it("never pushes a field taller than the pane above the top limit", () => {
    expect(keyboardRevealDelta(100, 600, 374)).toBe(36);
    expect(keyboardRevealDelta(40, 600, 374)).toBe(0);
  });
});
