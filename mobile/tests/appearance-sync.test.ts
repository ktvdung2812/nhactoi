import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import { MOBILE_APPEARANCE_FIELDS as sharedFields, APPEARANCE_DEFAULTS } from '../../shared/appearance.mjs';

// Load the actual theme exports, replacing only native modules for Node.
const stubs: Record<string, string> = {
  'react-native': 'export const AppState = {}; export const AccessibilityInfo = {}; export const Appearance = {}; export const useColorScheme = () => null;',
  'expo-status-bar': 'export const StatusBar = () => null;',
  './api': 'export class ApiError extends Error {} export const errorMessage = () => "";',
  './cache': 'export const cacheRead = () => {}; export const cacheWrite = () => {};',
  './session': 'export const useSession = () => {};',
};
const themeURL = new URL('../src/ui/theme.tsx', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../ui/theme' && context.parentURL?.endsWith('/src/core/appearance.ts')) return { url: themeURL, shortCircuit: true };
    if (specifier === './theme-core' && context.parentURL === themeURL) return { url: new URL('../src/ui/theme-core.ts', import.meta.url).href, shortCircuit: true };
    if (specifier in stubs && (context.parentURL?.endsWith('/src/core/appearance.ts') || context.parentURL === themeURL)) return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === themeURL) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { MOBILE_APPEARANCE_FIELDS, MOBILE_APPEARANCE_DEFAULTS } = await import('../src/ui/theme.tsx');
const { pickMobileFields, mergeForSave, effectiveMobileAppearance } = await import('../src/core/appearance.ts');

test('mobile fields and defaults match the shared appearance contract', () => {
  assert.deepEqual([...MOBILE_APPEARANCE_FIELDS], sharedFields);
  assert.deepEqual(MOBILE_APPEARANCE_DEFAULTS, Object.fromEntries(sharedFields.map((key: string) => [key, (APPEARANCE_DEFAULTS as Record<string, unknown>)[key]])));
});
test('picks only valid mobile fields', () => {
  assert.deepEqual(pickMobileFields({ mode: 'dark', accent: '#ABCDEF', hiddenNav: ['tasks'], extra: true }), { mode: 'dark', accent: '#abcdef' });
  assert.deepEqual(pickMobileFields({ mode: 'sepia', density: null, accent: null, motion: 'fast', fontSize: 3 }), {});
  assert.deepEqual(pickMobileFields({ accent: '#abc', contrast: 'high' }), { contrast: 'high' });
});
test('saving keeps web fields and ignores unknown edits', () => {
  assert.deepEqual(mergeForSave({ mode: 'light', hiddenNav: ['tasks'], sidebarWidth: 'wide' }, { mode: 'dark', unknown: true } as never), { mode: 'dark', hiddenNav: ['tasks'], sidebarWidth: 'wide' });
});
test('shared accessibility overrides the active profile', () => {
  assert.deepEqual(effectiveMobileAppearance({ mode: 'dark', contrast: 'standard', motion: 'system' }, { contrast: 'high', motion: 'reduced' }), { mode: 'dark', contrast: 'high', motion: 'reduced' });
  assert.deepEqual(effectiveMobileAppearance({ mode: 'invalid', accent: null }, { contrast: 'invalid' } as never), {});
  assert.deepEqual(effectiveMobileAppearance({ mode: 'dark' }, { mode: 'light', contrast: 'high' } as never), { mode: 'dark', contrast: 'high' });
});
test('null profiles use ThemeProvider defaults and retain accessibility', () => {
  assert.deepEqual(effectiveMobileAppearance(null, null), {});
  assert.deepEqual(effectiveMobileAppearance(null, { contrast: 'high' }), { contrast: 'high' });
});
