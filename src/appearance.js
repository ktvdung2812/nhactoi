import { useEffect, useMemo, useRef, useState } from 'react';
import { APPEARANCE_DEFAULTS, APPEARANCE_FIELDS, APPEARANCE_PERSONAL_FIELDS, resolveAppearance } from '../shared/appearance.mjs';
import { getSavedTheme, setThemeOverride } from './theme.js';

const PERSONAL_EDITABLE = [...APPEARANCE_FIELDS, ...APPEARANCE_PERSONAL_FIELDS];
const DATASET = [['appearanceBackground', 'background'], ['appearanceDensity', 'density'], ['appearanceContrast', 'contrast'], ['appearanceMotion', 'motion']];

export function accentColors(hex, high = false) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16));
  const luminance = values => values.map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const color = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  let light = [...rgb], dark = [...rgb];
  // Keep accent text legible against both surface palettes (WCAG AA, or AAA for high contrast).
  while (luminance(light) > (high ? 0.1 : 0.17)) light = light.map(v => v * 0.92);
  while (luminance(dark) < (high ? 0.55 : 0.4)) dark = dark.map(v => v + (255 - v) * 0.08);
  return { light: color(light), dark: color(dark), onAccent: luminance(rgb) > 0.179 ? '#101214' : '#ffffff' };
}

export function appearanceStyle(preferences) {
  const colors = accentColors(preferences.accent, preferences.contrast === 'high');
  return {
    '--appearance-accent': preferences.accent,
    '--appearance-accent-light': colors.light,
    '--appearance-accent-dark': colors.dark,
    '--appearance-on-accent': colors.onAccent,
    '--font-sans': preferences.font === 'system' ? 'system-ui, -apple-system, "Segoe UI", sans-serif' : '"Be Vietnam Pro", system-ui, sans-serif',
    '--appearance-font-size': { small: '93.75%', medium: '100%', large: '112.5%', xlarge: '125%' }[preferences.fontSize],
    '--radius-control': preferences.corners === 'square' ? '3px' : '8px',
    '--radius-card': preferences.corners === 'square' ? '4px' : '12px',
    '--radius-dialog': preferences.corners === 'square' ? '6px' : '16px',
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

export function useAppearance({ api, userId, workspaceId, teamId, enabled, notify }) {
  const key = enabled && userId && workspaceId ? `${workspaceId}/${userId}/${teamId || ''}` : '';
  const [baseMode, setBaseMode] = useState(() => getSavedTheme());
  const defaults = useMemo(() => ({ ...APPEARANCE_DEFAULTS, mode: baseMode }), [baseMode]);
  const [state, setState] = useState({ key: '', ready: false, saved: null, team: null, accessibility: null });
  const [draft, setDraft] = useState(null);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [editingTeam, setEditingTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const currentKey = useRef(key);
  const readSequence = useRef(0);
  const saving = useRef(false);
  currentKey.current = key;
  const endpoint = `/appearance${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`;
  const ready = !!key && state.key === key && state.ready;
  const team = ready ? state.team : null;
  const accessibility = team ? state.accessibility : null;
  const effective = useMemo(() => ready ? resolveAppearance(state.saved || (team ? null : defaults), team) : defaults, [ready, state.saved, team, defaults]);
  const preferences = useMemo(() => {
    const base = ready ? (draft ? (editingTeam ? draft : resolveAppearance(draft, team)) : (editingTeam ? team.preferences : effective)) : defaults;
    // Personal accessibility settings stay in force inside teams, even while editing the team look.
    return accessibility ? { ...base, ...accessibility } : base;
  }, [ready, draft, editingTeam, team, effective, defaults, accessibility]);
  const editableFields = !team ? PERSONAL_EDITABLE : editingTeam ? APPEARANCE_FIELDS : team.editableFields;

  useEffect(() => {
    let canceled = false;
    setDraft(null);
    setPolicyDraft(null);
    setEditingTeam(false);
    setBusy(false);
    setState({ key, ready: false, saved: null, team: null, accessibility: null });
    if (!key) return;
    const load = () => {
      const sequence = ++readSequence.current;
      api(endpoint).then(result => {
        if (!canceled && sequence === readSequence.current) {
          if (!teamId && !result.preferences) setBaseMode(getSavedTheme());
          setState({ key, ready: true, saved: result.preferences, team: result.team, accessibility: result.accessibility || null });
        }
      }).catch(error => {
        if (!canceled && sequence === readSequence.current) setState(previous => ({
          ...previous, error: error.message,
          // Authentication/access errors must never retain a stale team policy.
          ready: previous.ready && ![401, 403, 404].includes(error.status),
        }));
      });
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { canceled = true; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [key, revision]);

  async function save(next = preferences, reset = false) {
    if (!ready || busy || saving.current) return;
    saving.current = true;
    readSequence.current += 1;
    const requestKey = key;
    setBusy(true);
    try {
      const policy = editingTeam && !reset;
      // Team scopes never store the personal accessibility overlay.
      const body = teamId && next ? Object.fromEntries(Object.entries(next).filter(([field]) => !APPEARANCE_PERSONAL_FIELDS.includes(field))) : next;
      const result = await api(policy ? `/teams/${encodeURIComponent(teamId)}/appearance` : endpoint, {
        method: reset ? 'DELETE' : 'PUT',
        ...(!reset ? { body: JSON.stringify(policy ? { preferences: body, editableFields: policyDraft || team.editableFields } : body) } : {}),
      });
      if (currentKey.current !== requestKey) return;
      readSequence.current += 1;
      setState(previous => policy ? { ...previous, team: result.team } : { ...previous, saved: result.preferences });
      setDraft(null);
      setPolicyDraft(null);
      notify(reset ? 'Đã khôi phục giao diện.' : policy ? 'Đã lưu giao diện và quyền tùy chỉnh của team.' : 'Đã lưu giao diện cá nhân.');
    } catch (error) {
      if (currentKey.current === requestKey) notify(error.message, true);
    } finally {
      saving.current = false;
      if (currentKey.current === requestKey) setBusy(false);
    }
  }
  useEffect(() => {
    if (ready && editingTeam && !team?.canManage) {
      setEditingTeam(false); setDraft(null); setPolicyDraft(null);
    }
  }, [ready, editingTeam, team?.canManage]);
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
  return { preferences, ready, busy, team, editingTeam, editableFields, themeDisabledReason: disabledReason,
    policyFields: policyDraft || team?.editableFields || [],
    error: state.key === key ? state.error : null,
    hasOverride: ready && !!state.saved, dirty: ready && (!!draft || !!policyDraft),
    change: (name, value) => { if (editableFields.includes(name)) setDraft({ ...preferences, [name]: value }); },
    setPolicyFields: setPolicyDraft,
    setEditingTeam: value => { setDraft(null); setPolicyDraft(null); setEditingTeam(value); },
    cancel: () => { setDraft(null); setPolicyDraft(null); },
    leave: () => { setDraft(null); setPolicyDraft(null); setEditingTeam(false); },
    save: () => save(), reset: () => save(null, true),
    retry: () => setRevision(n => n + 1) };
}
