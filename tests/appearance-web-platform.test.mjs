import test from 'node:test';
import assert from 'node:assert/strict';
import { accentColors, appearanceEndpoint, appearancePreview, appearanceStyle, mergeAppearanceRead, shouldWriteSync } from '../src/appearance.js';
import { APPEARANCE_DEFAULTS } from '../shared/appearance.mjs';

const sync = { web: { separate: false }, mobile: { separate: true } };
const initial = { key: 'workspace/user/', ready: false, saved: null, team: null, accessibility: null };
const result = { preferences: { mode: 'light' }, team: null, accessibility: { contrast: 'standard', motion: 'system' }, separate: false };

test('default accent uses the dark preset and other accents remain legible', () => {
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const contrast of ['standard', 'high']) {
    assert.equal(appearanceStyle({ ...APPEARANCE_DEFAULTS, accent: '#245BC0', contrast })['--appearance-accent-dark'], '#7aa7ff');
    for (const accent of ['#245bc0', '#176b59', '#7747b8', '#b54d2a', '#a63266', '#475569']) {
      const dark = accentColors(accent, contrast === 'high').dark;
      for (const surface of ['#16181b', '#231e18', '#19212e'])
        assert.ok((luminance(dark) + 0.05) / (luminance(surface) + 0.05) >= 4.5, `${accent} on ${surface}`);
    }
  }
  assert.notEqual(accentColors('#176b59').dark, '#7aa7ff');
});

test('primary button pairs meet AA in both modes and interaction states', () => {
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const accent of ['#777777', '#808080', '#999999', '#ffff00', '#f5f5f5', '#000000', '#245bc0', '#176b59', '#7747b8', '#b54d2a', '#a63266', '#475569']) {
    for (const contrast of ['standard', 'high']) {
      const style = appearanceStyle({ ...APPEARANCE_DEFAULTS, accent, contrast });
      for (const mode of ['light', 'dark']) for (const state of ['', '-hover', '-active']) {
        const fill = style[`--appearance-button-${mode}${state}`], text = style[`--appearance-button-text-${mode}${state}`];
        const levels = [luminance(fill), luminance(text)].sort((a, b) => b - a);
        assert.ok((levels[0] + 0.05) / (levels[1] + 0.05) >= 4.5, `${accent} ${contrast} ${mode}${state}: ${text} on ${fill}`);
      }
    }
  }
  const defaults = appearanceStyle(APPEARANCE_DEFAULTS);
  assert.equal(defaults['--appearance-button-light'], '#245bc0');
  assert.equal(defaults['--appearance-button-text-light'], '#ffffff');
  assert.equal(defaults['--appearance-button-dark'], '#7aa7ff');
});

test('re-selecting the current scope sends no sync write; copy always writes', () => {
  const base = { ready: true, busy: false, saving: false, dirty: false, editingTeam: false, current: false };
  assert.equal(shouldWriteSync({ ...base, separate: false }), false);
  assert.equal(shouldWriteSync({ ...base, separate: true }), true);
  assert.equal(shouldWriteSync({ ...base, separate: true, current: true }), false);
  assert.equal(shouldWriteSync({ ...base, separate: false, current: true }), true);
  assert.equal(shouldWriteSync({ ...base, separate: true, copyFrom: 'all' }), true);
  assert.equal(shouldWriteSync({ ...base, separate: true, copyFrom: 'all', current: true }), true);
  for (const blocked of [{ ready: false }, { busy: true }, { saving: true }, { dirty: true }, { editingTeam: true }])
    for (const copyFrom of [undefined, 'all'])
      assert.equal(shouldWriteSync({ ...base, separate: true, copyFrom, ...blocked }), false, JSON.stringify(blocked));
});

test('web profile requests carry the platform and safely encode the team', () => {
  assert.equal(appearanceEndpoint(''), '/appearance?platform=web');
  const url = new URL(appearanceEndpoint('team & 1'), 'https://example.test');
  assert.equal(url.searchParams.get('platform'), 'web');
  assert.equal(url.searchParams.get('teamId'), 'team & 1');
});

test('refresh reports changed saved preferences or accessibility only while dirty', () => {
  const loaded = mergeAppearanceRead(initial, result, sync, false);
  assert.equal(loaded.remoteChanged, false);
  assert.equal(mergeAppearanceRead(loaded, result, sync, true).remoteChanged, false);
  const remote = { ...result, preferences: { mode: 'dark' } };
  const updated = mergeAppearanceRead(loaded, remote, sync, true);
  assert.equal(updated.remoteChanged, true);
  assert.equal(updated.saved.mode, 'dark');
  assert.equal(mergeAppearanceRead(loaded, remote, sync, false).remoteChanged, false);
  assert.equal(mergeAppearanceRead(loaded, { ...result, accessibility: { contrast: 'high', motion: 'system' } }, sync, true).remoteChanged, true);
  assert.equal(mergeAppearanceRead(updated, remote, sync, true).remoteChanged, true);
});

test('first read does not mistake the initial state for a remote update', () => {
  const loaded = mergeAppearanceRead(initial, result, sync, true);
  assert.equal(loaded.remoteChanged, false);
  assert.deepEqual(loaded.accessibility, result.accessibility);
  assert.deepEqual(loaded.sync, sync);
});

test('profile response wins if sync changes during concurrent reads', () => {
  const loaded = mergeAppearanceRead(initial, result, sync, false);
  const changed = mergeAppearanceRead(loaded, { ...result, separate: true }, sync, true);
  assert.equal(changed.sync.web.separate, true);
  assert.equal(changed.remoteChanged, true);
});

test('only edited fields remain in a draft when another device updates the base', () => {
  const preview = appearancePreview({ defaults: APPEARANCE_DEFAULTS, saved: { mode: 'dark', accent: '#176b59' },
    team: null, accessibility: { contrast: 'high', motion: 'reduced' }, draft: { mode: 'light' }, editingTeam: false });
  assert.equal(preview.mode, 'light');
  assert.equal(preview.accent, '#176b59');
  assert.equal(preview.contrast, 'high');
  assert.equal(preview.motion, 'reduced');
  assert.equal(appearancePreview({ defaults: APPEARANCE_DEFAULTS, saved: null, team: null,
    accessibility: { contrast: 'high', motion: 'reduced' }, draft: { contrast: 'standard' }, editingTeam: false }).contrast, 'standard');
});

test('team preview keeps personal accessibility and respects changed team locks', () => {
  const team = { preferences: { ...APPEARANCE_DEFAULTS, mode: 'dark' }, editableFields: ['accent'] };
  const common = { defaults: APPEARANCE_DEFAULTS, saved: { accent: '#176b59' }, team,
    accessibility: { contrast: 'high', motion: 'reduced' }, draft: { mode: 'light', accent: '#a63266' } };
  const personal = appearancePreview({ ...common, editingTeam: false });
  assert.equal(personal.mode, 'dark');
  assert.equal(personal.accent, '#a63266');
  assert.equal(personal.motion, 'reduced');
  const shared = appearancePreview({ ...common, editingTeam: true });
  assert.equal(shared.mode, 'light');
  assert.equal(shared.contrast, 'high');
});

test('the active nav keeps accent text readable on its own tint for any accent', () => {
  const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16));
  const luminance = hex => (Array.isArray(hex) ? hex : rgb(hex)).map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (left, right) => {
    const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };
  // The tint design-system.css paints under the active nav item.
  const tint = (accent, surface) => rgb(accent).map((value, index) => value * 0.1 + rgb(surface)[index] * 0.9);
  const accents = ['#00ff00', '#ff0000', '#999999', '#ffff00', '#245bc0', '#176b59', '#7747b8', '#b54d2a', '#a63266', '#475569', '#ffffff', '#000000'];
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51)
    accents.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
  for (const accent of accents) {
    const colors = accentColors(accent);
    for (const contrast of ['standard', 'high']) {
      const color = contrast === 'high' ? accentColors(accent, true) : colors;
      for (const surface of ['#ffffff', '#fffcf7', '#fafcff'])
        assert.ok(ratio(color.light, tint(color.light, surface)) >= 4.5,
          `${accent} ${contrast}: ${color.light} on ${'#' + tint(color.light, surface).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
      for (const surface of ['#16181b', '#231e18', '#19212e'])
        assert.ok(ratio(color.dark, tint(color.dark, surface)) >= 4.5, `${accent} ${contrast} dark on ${surface}`);
    }
  }
  // Darkening must not overshoot: the default accent stays exactly on brand.
  assert.equal(accentColors('#245bc0').light, '#245bc0');
  assert.equal(accentColors('#00ff00').light, '#007800');
});
