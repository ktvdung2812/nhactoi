import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, type Palette } from '../src/ui/theme-core.ts';

function luminance(hex: string) {
  const value = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  return value.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
test('light defaults and corner scales', () => {
  const theme = resolveTheme(null, 'light');
  assert.deepEqual(theme.colors, { ink:'#1f2a3d', muted:'#5f6d84', accent:'#245bc0', onAccent:'#fff', pale:'#e8effb', bg:'#f3f5f9', surface:'#fff', line:'#dbe2ec', red:'#aa3535', redPale:'#fcebec', orange:'#9a5b0b', orangePale:'#fff0dd', overlay:'#101a2e77' });
  assert.deepEqual(theme.radius, { control:4, card:6, sheet:8 });
  assert.deepEqual(resolveTheme({ corners:'rounded' }, 'light').radius, { control:8, card:12, sheet:16 });
});
test('dark default tokens match web', () => {
  const { colors } = resolveTheme({ mode: 'dark' }, null);
  assert.deepEqual([colors.accent, colors.ink, colors.muted, colors.line], ['#7aa7ff', '#f0f2f5', '#8b94a2', '#2b3038']);
});
test('accessible palette combinations', () => {
  const pairs: [keyof Palette, keyof Palette][] = [['ink','bg'], ['ink','surface'], ['ink','pale'], ['muted','bg'], ['muted','surface'], ['muted','pale'], ['onAccent','accent'], ['accent','bg'], ['accent','surface'], ['accent','pale'], ['red','bg'], ['red','surface'], ['red','redPale'], ['orange','surface'], ['orange','orangePale'], ['orange','bg']];
  const accents = ['#245bc0','#d97706','#16a34a','#e11d48','#111827', ...Array.from({ length: 128 }, (_, i) => '#' + ((i * 2654435761 >>> 0) & 0xffffff).toString(16).padStart(6, '0'))];
  for (const mode of ['light', 'dark'] as const) for (const contrastLevel of ['standard','high'] as const)
    for (const background of ['default','warm','cool'] as const) for (const accent of accents) {
      const { colors } = resolveTheme({ mode, contrast: contrastLevel, background, accent }, null);
      for (const [a,b] of pairs) assert.ok(contrast(colors[a],colors[b]) >= (contrastLevel === 'high' ? 7 : 4.5), `${mode} ${contrastLevel} ${background} ${accent} ${a}/${b}: ${contrast(colors[a],colors[b])}`);
    }
});
test('warm light muted text has extra contrast on pale', () => {
  const { colors } = resolveTheme({ mode: 'light', background: 'warm' }, null);
  assert.ok(contrast(colors.muted, colors.pale) >= 4.55);
});
test('background and surface match web, and pale follows the accent', () => {
  const surfaces = {
    light: { default: ['#f3f5f9', '#fff'], warm: ['#faf6f0', '#fffcf7'], cool: ['#f1f5fb', '#fafcff'] },
    dark: { default: ['#101214', '#16181b'], warm: ['#181410', '#1e1a15'], cool: ['#10151e', '#151b26'] },
  } as const;
  for (const mode of ['light', 'dark'] as const) for (const background of ['default', 'warm', 'cool'] as const) {
    const pales = ['#245bc0', '#16a34a', '#e11d48', '#d97706'].map(accent => {
      const { colors } = resolveTheme({ mode, background, accent }, null);
      assert.deepEqual([colors.bg, colors.surface], [...surfaces[mode][background]]);
      return colors.pale;
    });
    assert.equal(new Set(pales).size, pales.length, `${mode} ${background}`);
  }
});
test('invalid appearance fields fall back through the sanitizer', () => {
  const junk = { mode: 'sepia', background: null, accent: '#xyz', contrast: 'extreme', corners: {}, unknown: true };
  assert.deepEqual(resolveTheme(junk as never, 'dark'), resolveTheme(null, 'dark'));
  assert.deepEqual(resolveTheme(null, null), resolveTheme(null, 'light'));
});
