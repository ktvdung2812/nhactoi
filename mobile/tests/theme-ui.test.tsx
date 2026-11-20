import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Appearance, StyleSheet } from 'react-native';
import { ThemeProvider, useTheme } from '../src/ui/theme';
import { Button, Card, Field, Text, useKitStyles } from '../src/ui/kit';

test('theme preferences reach text, controls, input selection and cards', async () => {
  await render(<ThemeProvider preferences={{ mode: 'dark', accent: '#d97706', font: 'system', fontSize: 'large', density: 'compact', corners: 'rounded' }}>
    <Card><Text testID="themed-text">Xin chào</Text><Field label="Tên" /><Button label="Lưu" onPress={() => {}} /></Card>
  </ThemeProvider>);
  const text = StyleSheet.flatten(screen.getByTestId('themed-text').props.style);
  expect(text.color).toBe('#f0f2f5');
  expect(text.fontSize).toBeCloseTo(15 * 1.12);
  expect(text.fontFamily).toBeUndefined();
  const input = screen.getByLabelText('Tên');
  const inputStyle = StyleSheet.flatten(input.props.style);
  expect(inputStyle.backgroundColor).toBe('#16181b');
  expect(inputStyle.borderRadius).toBe(8);
  expect(inputStyle.fontSize).toBeCloseTo(16 * 1.12);
  expect(input.props.selectionColor).toBe(input.props.cursorColor);
  expect(input.props.selectionColor).not.toBe('#245bc0');
  expect(input.props.keyboardAppearance).toBe('dark');
});

test('native override resets to the real system scheme when system mode is selected', async () => {
  let nativeScheme: 'light' | 'dark' = 'light';
  const set = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(value => {
    nativeScheme = value === 'unspecified' ? 'light' : value as 'light' | 'dark';
  });
  const get = jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => nativeScheme);
  function Probe() { const { scheme } = useTheme(); return <Text>{scheme}</Text>; }
  const tree = await render(<ThemeProvider preferences={{ mode: 'dark' }}><Probe /></ThemeProvider>);
  expect(set).toHaveBeenCalledWith('dark');
  expect(screen.getByText('dark')).toBeTruthy();
  await tree.rerender(<ThemeProvider preferences={{ mode: 'system' }}><Probe /></ThemeProvider>);
  expect(set).toHaveBeenCalledWith('unspecified');
  expect(screen.getByText('light')).toBeTruthy();
  await tree.unmount();
  set.mockRestore();
  get.mockRestore();
});

test('kit styles are shared by components using the same theme', async () => {
  const styles: ReturnType<typeof useKitStyles>[] = [];
  function Probe() { styles.push(useKitStyles()); return null; }
  await render(<ThemeProvider><Probe /><Probe /></ThemeProvider>);
  expect(styles[0]).toBe(styles[1]);
});
