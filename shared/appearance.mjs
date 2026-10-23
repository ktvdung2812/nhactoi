export const APPEARANCE_NAV_IDS = [
  'dashboard', 'tasks', 'today', 'upcoming', 'week', 'inbox',
  'projects', 'teams', 'customers', 'services', 'finance',
  'templates', 'automations', 'public-integrations', 'google-calendar', 'zalo-oa',
  'transfer', 'tickets', 'trash'
];
export const APPEARANCE_DEFAULTS = Object.freeze({
  mode: 'system', accent: '#176b59', background: 'default', font: 'vietnam',
  fontSize: 'medium', density: 'comfortable', corners: 'rounded',
  sidebarWidth: 'standard', contentWidth: 'full', hiddenNav: [], navOrder: APPEARANCE_NAV_IDS,
  contrast: 'standard', motion: 'system',
});
const choices = {
  mode: ['system', 'light', 'dark'], background: ['default', 'warm', 'cool'],
  font: ['vietnam', 'system'], fontSize: ['small', 'medium', 'large', 'xlarge'],
  density: ['comfortable', 'compact'], corners: ['rounded', 'square'],
  sidebarWidth: ['narrow', 'standard', 'wide'], contentWidth: ['full', 'centered'],
  contrast: ['standard', 'high'], motion: ['system', 'reduced'],
};
export function validateAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cấu hình giao diện không hợp lệ.');
  const result = { ...APPEARANCE_DEFAULTS };
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(APPEARANCE_DEFAULTS, key)) throw new Error('Tùy chọn giao diện không hợp lệ.');
    if (choices[key] && !choices[key].includes(entry)) throw new Error('Giá trị giao diện không hợp lệ.');
    if (key === 'accent' && (typeof entry !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry))) throw new Error('Màu nhấn phải có dạng #RRGGBB.');
    if (key === 'hiddenNav' || key === 'navOrder') {
      if (!Array.isArray(entry) || entry.length > APPEARANCE_NAV_IDS.length || new Set(entry).size !== entry.length || entry.some(id => !APPEARANCE_NAV_IDS.includes(id))) throw new Error('Danh sách menu không hợp lệ.');
    }
    result[key] = entry;
  }
  result.navOrder = [...result.navOrder, ...APPEARANCE_NAV_IDS.filter(id => !result.navOrder.includes(id))];
  return result;
}

// Accessibility needs follow the person everywhere; team admins cannot lock them.
export const APPEARANCE_PERSONAL_FIELDS = ['contrast', 'motion'];
export const APPEARANCE_FIELDS = Object.keys(APPEARANCE_DEFAULTS).filter(key => !APPEARANCE_PERSONAL_FIELDS.includes(key));
export function validateAppearancePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['preferences', 'editableFields'].includes(key))) throw new Error('Cấu hình quyền giao diện không hợp lệ.');
  const fields = value.editableFields;
  if (!Array.isArray(fields) || fields.length > APPEARANCE_FIELDS.length || new Set(fields).size !== fields.length || fields.some(key => !APPEARANCE_FIELDS.includes(key))) throw new Error('Quyền tùy chỉnh không hợp lệ.');
  return { preferences: validateAppearance(value.preferences), editableFields: fields };
}
export function resolveAppearance(personal, team) {
  const preferences = team
    ? { ...APPEARANCE_DEFAULTS, ...team.preferences, ...Object.fromEntries(Object.entries(personal || {}).filter(([key]) => team.editableFields.includes(key))) }
    : { ...APPEARANCE_DEFAULTS, ...personal };
  const order = preferences.navOrder || APPEARANCE_NAV_IDS;
  return { ...preferences, navOrder: [...order, ...APPEARANCE_NAV_IDS.filter(id => !order.includes(id))] };
}
