import { useEffect, useMemo, useRef, useState } from 'react';
import { APPEARANCE_DEFAULTS, APPEARANCE_FIELDS, APPEARANCE_PERSONAL_FIELDS, resolveAppearance } from '../shared/appearance.mjs';
import { getSavedTheme, setThemeOverride } from './theme.js';

const PERSONAL_EDITABLE = [...APPEARANCE_FIELDS, ...APPEARANCE_PERSONAL_FIELDS];
const DATASET = [['appearanceBackground', 'background'], ['appearanceDensity', 'density'], ['appearanceContrast', 'contrast'], ['appearanceMotion', 'motion']];

const luminance = values => values.map(v => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const color = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function buttonPair(hex, factor = 1) {
  let rgb = hex.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * factor));
  const dark = luminance([16, 18, 20]);
  const contrast = () => {
    const fill = luminance(rgb);
    return [(1.05 / (fill + 0.05)), (fill + 0.05) / (dark + 0.05)];
  };
  let [whiteRatio, darkRatio] = contrast();
  const text = whiteRatio >= darkRatio ? '#ffffff' : '#101214';
  while (Math.max(whiteRatio, darkRatio) < 4.5) {
    rgb = rgb.map(v => text === '#ffffff' ? Math.max(0, v - 1) : Math.min(255, v + 1));
    [whiteRatio, darkRatio] = contrast();
  }
  return { fill: color(rgb), text };
}

// The light surfaces a page can paint behind the active nav tint: neutral, warm and cool.
const LIGHT_SURFACES = [[255, 255, 255], [255, 252, 247], [250, 252, 255]];

const contrastRatio = (left, right) => {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

// The active nav draws accent text on color-mix(accent 10%, surface), so the
// accent must stay readable against a tint of itself, not only against the page.
const navTint = (rgb, surface) => rgb.map((value, index) => value * 0.1 + surface[index] * 0.9);

function navReadable(rgb) {
  return LIGHT_SURFACES.every(surface => contrastRatio(rgb, navTint(rgb, surface)) >= 4.6);
}

export function accentColors(hex, high = false) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16));
  let light = [...rgb], dark = [...rgb];
  // Keep accent text legible against both surface palettes (WCAG AA, or AAA for high contrast).
  while (luminance(light) > (high ? 0.1 : 0.17) || !navReadable(light)) light = light.map(v => v * 0.92);
  // Lighten in HSL so the dark-mode accent keeps its saturation instead of fading to a pastel.
  let [hue, saturation, lightness] = toHsl(rgb);
  while (luminance(dark) < (high ? 0.55 : 0.3) && lightness < 1) {
    lightness = Math.min(1, lightness + 0.02);
    dark = fromHsl(hue, saturation, lightness);
  }
  return { light: color(light), dark: hex.toLowerCase() === APPEARANCE_DEFAULTS.accent.toLowerCase() ? '#7aa7ff' : color(dark), onAccent: buttonPair(hex).text };
}

function toHsl(rgb) {
  const [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const d = max - min;
  const saturation = lightness > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, saturation, lightness];
}

function fromHsl(hue, saturation, lightness) {
  if (!saturation) return [lightness, lightness, lightness].map(v => v * 255);
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = t => {
    t = ((t % 1) + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)].map(v => v * 255);
}

export function appearanceStyle(preferences) {
  const colors = accentColors(preferences.accent, preferences.contrast === 'high');
  const buttonTokens = Object.fromEntries(['light', 'dark'].flatMap(mode => {
    const fill = mode === 'light' ? preferences.accent : colors.dark;
    return [['', 1], ['-hover', 0.95], ['-active', 0.9]].flatMap(([state, factor]) => {
      const pair = buttonPair(fill, factor);
      return [[`--appearance-button-${mode}${state}`, pair.fill], [`--appearance-button-text-${mode}${state}`, pair.text]];
    });
  }));
  return {
    '--appearance-accent': preferences.accent,
    '--appearance-accent-light': colors.light,
    '--appearance-accent-dark': colors.dark,
    ...buttonTokens,
    '--font-sans': preferences.font === 'system' ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : '"Be Vietnam Pro", system-ui, sans-serif',
    '--appearance-font-size': { small: '93.75%', medium: '100%', large: '112.5%', xlarge: '125%' }[preferences.fontSize],
    '--radius-control': preferences.corners === 'square' ? '4px' : '8px',
    '--radius-card': preferences.corners === 'square' ? '6px' : '12px',
    '--radius-dialog': preferences.corners === 'square' ? '8px' : '16px',
    '--appearance-sidebar-width': { narrow: '218px', standard: '248px', wide: '290px' }[preferences.sidebarWidth],
    '--appearance-content-width': preferences.contentWidth === 'centered' ? '1120px' : 'none',
    '--appearance-gap': preferences.density === 'compact' ? '12px' : '24px',
  };
}

export function themeDisabledReason({ ready, error, teamId, busy, dirty, editingTeam, editableFields }) {
  if (busy) return 'Đang lưu giao diện…';
  if (!ready && (teamId || !error)) return 'Chưa tải được cấu hình giao diện. Mở Cá nhân hóa để thử lại.';
  if (editingTeam) return 'Chọn chế độ trong biểu mẫu giao diện chung của team.';
  if (dirty) return 'Lưu hoặc hủy các thay đổi giao diện trước khi chuyển chế độ.';
  if (teamId && !editableFields.includes('mode')) return 'Chế độ sáng/tối do quản trị team quản lý.';
  return '';
}

// Re-selecting the scope that is already active must not rewrite it (and a
// copy always writes). Kept pure so it is testable without a DOM.
export function shouldWriteSync({ ready, busy, saving, dirty, editingTeam, separate, copyFrom, current }) {
  if (!ready || busy || saving || dirty || editingTeam) return false;
  return !!copyFrom || current !== separate;
}

export function appearanceEndpoint(teamId) {
  const query = new URLSearchParams({ platform: 'web' });
  if (teamId) query.set('teamId', teamId);
  return `/appearance?${query}`;
}

export function mergeAppearanceRead(previous, result, sync, dirty) {
  // The profile response identifies which profile was actually read, even if
  // the sync flags changed between the two concurrent requests.
  const flags = { ...sync, web: { ...sync.web, separate: result.separate } };
  const changed = previous.ready && JSON.stringify([previous.saved, previous.team, previous.accessibility, previous.sync?.web?.separate]) !==
    JSON.stringify([result.preferences, result.team, result.accessibility || null, flags.web.separate]);
  return { ...previous, ready: true, error: null, saved: result.preferences, team: result.team,
    accessibility: result.accessibility || null, sync: flags, remoteChanged: previous.remoteChanged || (dirty && changed) };
}

export function appearancePreview({ saved, team, accessibility, defaults, draft, editingTeam }) {
  const base = editingTeam ? team.preferences : resolveAppearance(saved || (team ? null : defaults), team);
  const allowedDraft = team && !editingTeam && draft
    ? Object.fromEntries(Object.entries(draft).filter(([field]) => team.editableFields.includes(field))) : draft;
  return { ...base, ...accessibility, ...allowedDraft };
}

export function useAppearance({ api, userId, workspaceId, teamId, enabled, notify }) {
  const key = enabled && userId && workspaceId ? `${workspaceId}/${userId}/${teamId || ''}` : '';
  const [baseMode, setBaseMode] = useState(() => getSavedTheme());
  const defaults = useMemo(() => ({ ...APPEARANCE_DEFAULTS, mode: baseMode }), [baseMode]);
  const [state, setState] = useState({ key: '', ready: false, saved: null, team: null, accessibility: null });
  const [draft, setDraft] = useState(null);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [editingTeam, setEditingTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentKey = useRef(key);
  const keyVersion = useRef(0);
  const readSequence = useRef(0);
  const saving = useRef(false);
  const loadRef = useRef(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = !!draft || !!policyDraft;
  if (currentKey.current !== key) { currentKey.current = key; keyVersion.current += 1; }
  const endpoint = appearanceEndpoint(teamId);
  const ready = !!key && state.key === key && state.ready;
  const team = ready ? state.team : null;
  const accessibility = ready ? state.accessibility : null;
  const preferences = useMemo(() => ready ? appearancePreview({ saved: state.saved, team, accessibility, defaults, draft, editingTeam: editingTeam && !!team }) : defaults,
    [ready, state.saved, team, accessibility, defaults, draft, editingTeam]);
  const editableFields = !team ? PERSONAL_EDITABLE : editingTeam ? (team.canManage ? APPEARANCE_FIELDS : []) : team.editableFields;

  useEffect(() => {
    let canceled = false;
    setDraft(null);
    setPolicyDraft(null);
    setEditingTeam(false);
    setBusy(saving.current);
    setState({ key, ready: false, saved: null, team: null, accessibility: null });
    if (!key) return;
    const load = async () => {
      const sequence = ++readSequence.current;
      try {
        const [result, sync] = await Promise.all([api(endpoint), api('/appearance/sync')]);
        if (!canceled && sequence === readSequence.current) {
          if (!teamId && !result.preferences) setBaseMode(getSavedTheme());
          setState(previous => mergeAppearanceRead(previous, result, sync, dirtyRef.current));
        }
      } catch (error) {
        if (!canceled && sequence === readSequence.current) setState(previous => ({
          ...previous, error: error.message,
          // Authentication/access errors must never retain a stale team policy.
          ready: previous.ready && ![401, 403, 404].includes(error.status),
        }));
        throw error;
      }
    };
    loadRef.current = load;
    const refresh = () => { if (!saving.current) load().catch(() => {}); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    load().catch(() => {});
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => { canceled = true; loadRef.current = null; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, [key]);

  async function save(next = preferences, reset = false) {
    if (!ready || busy || saving.current || (editingTeam && !team?.canManage)) return;
    saving.current = true;
    readSequence.current += 1;
    const requestKey = key;
    const requestVersion = keyVersion.current;
    setBusy(true);
    try {
      const policy = editingTeam && !reset;
      // Team policies never store the personal accessibility overlay.
      const body = policy && next ? Object.fromEntries(Object.entries(next).filter(([field]) => !APPEARANCE_PERSONAL_FIELDS.includes(field))) : next;
      const result = await api(policy ? `/teams/${encodeURIComponent(teamId)}/appearance` : endpoint, {
        method: reset ? 'DELETE' : 'PUT',
        ...(!reset ? { body: JSON.stringify(policy ? { preferences: body, editableFields: policyDraft || team.editableFields } : body) } : {}),
      });
      if (currentKey.current !== requestKey || keyVersion.current !== requestVersion) return;
      readSequence.current += 1;
      setState(previous => policy ? { ...previous, team: result.team, remoteChanged: false } :
        { ...previous, saved: result.preferences, accessibility: result.accessibility || previous.accessibility, remoteChanged: false });
      setDraft(null);
      setPolicyDraft(null);
      dirtyRef.current = false;
      if (reset) await loadRef.current?.();
      notify(reset ? 'Đã khôi phục giao diện.' : policy ? 'Đã lưu giao diện và quyền tùy chỉnh của team.' : 'Đã lưu giao diện cá nhân.');
    } catch (error) {
      if (currentKey.current === requestKey && keyVersion.current === requestVersion) notify(error.message, true);
    } finally {
      saving.current = false;
      setBusy(false);
      if (keyVersion.current !== requestVersion) loadRef.current?.().catch(() => {});
    }
  }
  async function updateSync(separate, copyFrom) {
    if (!shouldWriteSync({ ready, busy, saving: saving.current, dirty: dirtyRef.current, editingTeam,
      separate, copyFrom, current: state.sync?.web.separate })) return;
    saving.current = true;
    readSequence.current += 1;
    const requestKey = key;
    const requestVersion = keyVersion.current;
    let updated = false;
    setBusy(true);
    try {
      const sync = await api('/appearance/sync', { method: 'PUT', body: JSON.stringify({ platform: 'web', separate, ...(copyFrom ? { copyFrom } : {}) }) });
      updated = true;
      if (currentKey.current !== requestKey || keyVersion.current !== requestVersion) return;
      setState(previous => ({ ...previous, sync }));
      await loadRef.current?.();
      if (currentKey.current === requestKey && keyVersion.current === requestVersion) notify(copyFrom ? 'Đã sao chép giao diện.' : 'Đã cập nhật phạm vi giao diện.');
    } catch (error) {
      if (currentKey.current === requestKey && keyVersion.current === requestVersion) {
        // A failed response can still mean that the server committed the switch.
        if (!updated) {
          try { await loadRef.current?.(); } catch { updated = true; }
        }
        if (currentKey.current === requestKey && keyVersion.current === requestVersion) {
          if (updated) setState(previous => ({ ...previous, ready: false }));
          notify(error.message, true);
        }
      }
    } finally {
      saving.current = false;
      setBusy(false);
      if (keyVersion.current !== requestVersion) loadRef.current?.().catch(() => {});
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!key) return;
    const root = document.documentElement;
    const style = appearanceStyle(preferences);
    Object.entries(style).forEach(([name, value]) => root.style.setProperty(name, value));
    root.dataset.appearance = '';
    DATASET.forEach(([name, field]) => { root.dataset[name] = preferences[field]; });
    // Until personal preferences load, keep the device theme controls usable.
    // An unknown team policy remains locked by the UI instead of being bypassed.
    if (ready) setThemeOverride(preferences.mode, mode => {
      if (editableFields.includes('mode')) saveRef.current({ ...preferences, mode });
    });
    else setThemeOverride(null);
    return () => {
      Object.keys(style).forEach(name => root.style.removeProperty(name));
      delete root.dataset.appearance;
      DATASET.forEach(([name]) => { delete root.dataset[name]; });
      setThemeOverride(null);
    };
  }, [key, ready, preferences, editableFields]);
  const disabledReason = themeDisabledReason({ ready, error: state.key === key ? state.error : null,
    teamId, busy, dirty: !!draft || !!policyDraft, editingTeam, editableFields });
  const syncDisabledReason = busy ? 'Đang lưu giao diện…' : !ready ? 'Chưa tải được cấu hình giao diện.' :
    editingTeam ? 'Phạm vi này chỉ áp dụng cho giao diện cá nhân.' : dirtyRef.current ? 'Lưu hoặc hủy các thay đổi giao diện trước.' : '';
  return { preferences, ready, busy, team, editingTeam, editableFields, themeDisabledReason: disabledReason,
    sync: ready ? state.sync : null, syncDisabledReason, remoteChanged: ready && !!state.remoteChanged,
    setSeparate: value => updateSync(value), copyFrom: source => updateSync(true, source),
    policyFields: policyDraft || team?.editableFields || [], teamAccessLost: editingTeam && !!team && !team.canManage,
    error: state.key === key ? state.error : null,
    hasOverride: ready && !!state.saved, dirty: ready && (!!draft || !!policyDraft),
    change: (name, value) => { if (editableFields.includes(name)) setDraft(previous => ({ ...previous, [name]: value })); },
    setPolicyFields: setPolicyDraft,
    setEditingTeam: value => { setDraft(null); setPolicyDraft(null); setEditingTeam(value); setState(previous => ({ ...previous, remoteChanged: false })); },
    cancel: () => { setDraft(null); setPolicyDraft(null); setState(previous => ({ ...previous, remoteChanged: false })); },
    leave: () => { setDraft(null); setPolicyDraft(null); setEditingTeam(false); setState(previous => ({ ...previous, remoteChanged: false })); },
    save: () => save(), reset: () => save(null, true),
    retry: () => loadRef.current?.().catch(() => {}) };
}
